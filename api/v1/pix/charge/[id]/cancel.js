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
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  try {
    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const { id } = req.query || {};
    if (!id) return json(res, 400, { error: 'ID do pagamento ausente' });
    const token = getToken();
    if (!token) return json(res, 400, { error: 'Access Token não configurado' });

    const opts = {
      method: 'PUT',
      hostname: 'api.mercadopago.com',
      path: `/v1/payments/${encodeURIComponent(id)}`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    };
    const payload = { status: 'cancelled' };
    const resp = await doRequest(opts, payload);
    return json(res, 200, { ok: true, rawStatus: resp && resp.status });
  } catch (e) {
    const status = e.status || 500;
    return json(res, status, { error: e.message || 'Erro ao cancelar pagamento', details: e.details || null });
  }
};
