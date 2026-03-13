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

function doRequest(opts) {
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
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  try {
    const { id } = req.query || {};
    if (!id) return json(res, 400, { error: 'ID do pagamento ausente' });
    const token = getToken();
    if (!token) return json(res, 400, { error: 'Access Token não configurado' });

    const opts = {
      method: 'GET',
      hostname: 'api.mercadopago.com',
      path: `/v1/payments/${encodeURIComponent(id)}`,
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };
    const resp = await doRequest(opts);
    const raw = (resp && resp.status) || 'unknown';
    let status = 'pending';
    if (raw === 'approved') status = 'paid';
    if (raw === 'cancelled' || raw === 'cancelled') status = 'cancelled';
    if (raw === 'rejected') status = 'rejected';
    return json(res, 200, { status, rawStatus: raw });
  } catch (e) {
    const status = e.status || 500;
    return json(res, status, { error: e.message || 'Erro ao consultar status do Pix', details: e.details || null });
  }
};
