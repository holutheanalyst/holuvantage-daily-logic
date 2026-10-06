// HTTP, database and identity helpers for the API.
import { createClient } from '@supabase/supabase-js';
import { verifyGuest } from './core.js';

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

export function env(name, required = true) {
  const v = process.env[name];
  if (required && !v) fail(503, `Server not configured (${name})`);
  return v || '';
}

let client;
export function db() {
  if (!client) {
    client = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
// Unwraps a Supabase response, turning errors into 500s.
export function must({ data, error }, context = 'db') {
  if (error) { console.error(context, error); fail(500, 'Database error'); }
  return data;
}

export async function readRaw(req, limit = 200_000) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) fail(413, 'Body too large'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}
export async function readJson(req) {
  const raw = await readRaw(req);
  if (!raw) return {};
  try { const v = JSON.parse(raw); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch {}
  fail(400, 'Invalid JSON');
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

// ---------- Identity ----------
// Returns { user, playerId, isAdmin } from a Supabase session JWT or a signed guest token.
export async function identify(req, { require = true } = {}) {
  const auth = req.headers.authorization || '';
  const guest = req.headers['x-guest-token'];
  let user = null, playerId = null;
  if (auth.startsWith('Bearer ')) {
    const { data, error } = await db().auth.getUser(auth.slice(7));
    if (error || !data?.user) fail(401, 'Session expired. Please sign in again.');
    user = data.user;
    const row = must(await db().from('players').select('id').eq('user_id', user.id).maybeSingle());
    playerId = row?.id || null;
  } else if (guest) {
    playerId = verifyGuest(env('GUEST_SECRET'), guest);
    if (!playerId) fail(401, 'Invalid guest session');
    const row = must(await db().from('players').select('id, user_id').eq('id', playerId).maybeSingle());
    if (!row) fail(401, 'Guest session not found');
    if (row.user_id) fail(401, 'This progress now belongs to an account. Please sign in.');
  }
  if (require && !playerId && !user) fail(401, 'Not signed in');
  const admins = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const isAdmin = Boolean(user?.email && user.email_confirmed_at && admins.includes(user.email.toLowerCase()));
  return { user, playerId, isAdmin };
}

export async function requirePlayer(req) {
  const id = await identify(req);
  if (!id.playerId) fail(409, 'No player profile yet', { code: 'no_player' });
  return id;
}

// Simple per-instance rate limiter (best effort; pair with Vercel Firewall rules in production).
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) { buckets.set(key, { count: 1, reset: now + windowMs }); return; }
  if (++b.count > max) fail(429, 'Too many requests. Please slow down.');
  if (buckets.size > 5000) buckets.clear();
}
export const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
