// Local test harness: serves public/, runs the API router, proxies /rest/v1 to a local PostgREST
// and fakes the two Supabase Auth endpoints the server uses. Test tokens look like "tok:<email>".
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const PORT = 8787;
const JWT_SECRET = 'local-test-jwt-secret-local-test-jwt-secret-0123';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload); return `${h}.${p}.${crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const serviceKey = jwt({ role: 'service_role', iss: 'local' });

Object.assign(process.env, {
  SUPABASE_URL: `http://localhost:${PORT}`, SUPABASE_ANON_KEY: jwt({ role: 'anon' }), SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  PUZZLE_SECRET: 'local-puzzle-secret', GUEST_SECRET: 'local-guest-secret', SITE_URL: `http://localhost:${PORT}`,
  ADMIN_EMAILS: 'admin@example.com',
  STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRICE_GBP_MONTHLY: 'price_gbp_m', STRIPE_PRICE_USD_MONTHLY: 'price_usd_m',
  STRIPE_PRICE_GBP_YEARLY: 'price_gbp_y', STRIPE_PRICE_USD_YEARLY: 'price_usd_y',
  PAYSTACK_SECRET_KEY: 'sk_paystack_test', PAYSTACK_PLAN_NGN_MONTHLY: 'PLN_test',
  RAZORPAY_KEY_ID: 'rzp_test', RAZORPAY_KEY_SECRET: 'rzp_secret', RAZORPAY_WEBHOOK_SECRET: 'rzp_whsec', RAZORPAY_PLAN_INR_MONTHLY: 'plan_test',
});
const { default: router } = await import('../api/router.js');
const psql = (sql) => execFileSync('psql', ['-h', '/var/tmp/pgt', '-p', '5499', '-U', 'postgres', '-d', 'e2e', '-tAc', sql]).toString().trim();

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain' };
const root = path.resolve('public');

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/rest/v1')) {
    const target = `http://localhost:3001${url.pathname.slice(8)}${url.search}`;
    const chunks = []; for await (const c of req) chunks.push(c);
    const headers = { ...req.headers }; delete headers.host; delete headers['content-length'];
    const r = await fetch(target, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => !['content-encoding', 'transfer-encoding'].includes(k))));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  if (url.pathname === '/auth/v1/user') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token.startsWith('tok:')) { res.writeHead(401); return res.end('{"msg":"invalid"}'); }
    const email = token.slice(4).replace(/'/g, '');
    let id = psql(`select id from auth.users where email='${email}'`);
    if (!id) id = psql(`insert into auth.users (email) values ('${email}') returning id`).split('\n')[0];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ id, email, email_confirmed_at: '2026-01-01T00:00:00Z' }));
  }
  const del = url.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/);
  if (del && req.method === 'DELETE') { psql(`delete from auth.users where id='${del[1]}'`); res.writeHead(200); return res.end('{}'); }
  if (url.pathname.startsWith('/api/')) {
    req.url = `/api/router?route=${encodeURIComponent(url.pathname.slice(5))}${url.search ? `&${url.search.slice(1)}` : ''}`;
    req.headers['x-vercel-ip-country'] ||= 'GB';
    return router(req, res);
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!path.extname(p)) p += '.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(PORT, () => console.log(`dev server on http://localhost:${PORT}`));
