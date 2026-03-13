const https = require('https');
const crypto = require('crypto');

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data || ''));
    req.on('error', reject);
  });
}

function verifySignature(req, raw) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET || '';
  if (!secret) return false;
  const sigHeader = req.headers['x-signature'] || '';
  const parts = String(sigHeader).split(',').map(s => s.trim());
  const map = {};
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k && v) map[k] = v;
  }
  const provided = map['v1'] || '';
  const ts = map['ts'] || '';
  if (!provided || !ts) return false;
  const payload = `${ts}.${raw}`;
  const h = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return h === provided;
  }
}

function doRequest(opts) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        const code = res.statusCode || 500;
        try {
          const j = data ? JSON.parse(data) : {};
          if (code >= 200 && code < 300) resolve(j);
          else {
            const err = new Error(j && j.message ? j.message : `HTTP ${code}`);
            err.status = code;
            err.details = j;
            reject(err);
          }
        } catch (e) {
          const err = new Error('Invalid JSON from Mercado Pago');
          err.status = code;
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
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  try {
    const raw = await readRawBody(req);
    if (!verifySignature(req, raw)) {
      return json(res, 401, { error: 'Unauthorized' });
    }
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }

    const type = body.type || body.topic || '';
    const action = body.action || '';
    let paymentId = null;
    if (body?.data?.id) paymentId = body.data.id;
    if (!paymentId && body?.data?.payment?.id) paymentId = body.data.payment.id;
    if (!paymentId && body?.id) paymentId = body.id;
    if (!paymentId && req.query && req.query.id) paymentId = req.query.id;

    const isPaymentUpdated = (type === 'payment.updated') || (type === 'payment' && action === 'payment.updated');
    if (!isPaymentUpdated || !paymentId) {
      return json(res, 200, { ok: true, ignored: true });
    }

    const token = process.env.MERCADOPAGO_ACCESS_TOKEN || '';
    if (!token) {
      return json(res, 500, { error: 'Access Token ausente' });
    }
    const opts = {
      method: 'GET',
      hostname: 'api.mercadopago.com',
      path: `/v1/payments/${encodeURIComponent(String(paymentId))}`,
      headers: { 'Authorization': `Bearer ${token}` }
    };
    const resp = await doRequest(opts);
    const status = resp?.status || 'unknown';
    const externalRef = resp?.external_reference || null;

    const approved = status === 'approved';

    console.log(JSON.stringify({
      source: 'mercadopago_webhook',
      event: 'payment.updated',
      payment_id: String(paymentId),
      status,
      external_reference: externalRef,
      ts: Date.now()
    }));

    return json(res, 200, {
      ok: true,
      payment_id: String(paymentId),
      status,
      external_reference: externalRef,
      approved
    });
  } catch (e) {
    const code = e.status || 500;
    return json(res, code, { error: e.message || 'Webhook error', details: e.details || null });
  }
}
