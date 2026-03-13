const https = require('https');

function getToken() {
  const fromEnv = process.env.MERCADOPAGO_ACCESS_TOKEN;
  return fromEnv || '';
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function doRequest(opts, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const status = res.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          if (status >= 200 && status < 300) {
            resolve(json);
          } else {
            const err = new Error(json && json.message ? json.message : `HTTP ${status}`);
            err.status = status;
            err.details = json;
            reject(err);
          }
        } catch (e) {
          const err = new Error('Invalid JSON response from Mercado Pago');
          err.status = status;
          err.details = data;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  try {
    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const amount = Number(body.amount || body.transaction_amount || 0);
    const description = body.description || 'Pagamento de venda no sistema';
    const payerEmail = (body.payer && body.payer.email) || body.payerEmail || 'cliente@pdv.com';
    const token = getToken();
    if (!token) {
      return json(res, 400, { error: 'Access Token não configurado' });
    }
    if (!amount || amount <= 0) {
      return json(res, 400, { error: 'Valor inválido' });
    }

    const idemKey = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const opts = {
      method: 'POST',
      hostname: 'api.mercadopago.com',
      path: '/v1/payments',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Idempotency-Key': idemKey
      }
    };

    const payload = {
      transaction_amount: Math.round(amount * 100) / 100,
      description,
      payment_method_id: 'pix',
      payer: { email: payerEmail }
    };
    const externalRef = body.external_reference || body.externalRef || null;
    if (externalRef) payload.external_reference = String(externalRef);
    const host = req.headers['x-forwarded-host'] || req.headers['host'] || '';
    const baseUrl = host ? `https://${host}` : '';
    if (baseUrl) payload.notification_url = `${baseUrl}/api/webhook/mercadopago`;

    const resp = await doRequest(opts, payload);
    const id = resp && resp.id;
    const pio = resp && resp.point_of_interaction && resp.point_of_interaction.transaction_data || {};
    const qrCode = pio.qr_code || '';
    const qrBase64 = pio.qr_code_base64 || '';
    return json(res, 200, { txid: String(id || ''), payload: qrCode, qr_base64: qrBase64, rawStatus: resp && resp.status });
  } catch (e) {
    const status = e.status || 500;
    return json(res, status, { error: e.message || 'Erro ao criar cobrança Pix', details: e.details || null });
  }
};
