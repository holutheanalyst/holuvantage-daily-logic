// Payments: Stripe (GBP/USD), Paystack (NGN), Razorpay (INR).
// All secrets come from server-side environment variables. Webhooks are signature-verified.
import crypto from 'node:crypto';
import { MARKETS } from './core.js';
import { db, must, fail, identify, readJson, readRaw, env } from './server.js';

const SITE = () => (process.env.SITE_URL || '').replace(/\/$/, '');
const stripePrice = (currency, plan) => process.env[`STRIPE_PRICE_${currency}_${plan.toUpperCase()}`];

export function providerConfigured(provider) {
  const e = process.env;
  if (provider === 'stripe') return Boolean(e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET && e.STRIPE_PRICE_GBP_MONTHLY && e.STRIPE_PRICE_USD_MONTHLY);
  if (provider === 'paystack') return Boolean(e.PAYSTACK_SECRET_KEY && e.PAYSTACK_PLAN_NGN_MONTHLY);
  if (provider === 'razorpay') return Boolean(e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET && e.RAZORPAY_WEBHOOK_SECRET && e.RAZORPAY_PLAN_INR_MONTHLY);
  return false;
}

// ---------- Provider API helpers ----------
function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out); else out.append(key, String(v));
  }
  return out;
}
async function call(url, opts, label) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) { console.error(label, res.status, text.slice(0, 500)); fail(502, `Payment provider error (${label})`); }
  return body;
}
const stripe = (path, params, method = 'POST') => call(`https://api.stripe.com/v1/${path}`, {
  method, headers: { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: method === 'GET' ? undefined : formEncode(params || {}),
}, 'stripe');
const paystack = (path, payload, method = 'POST') => call(`https://api.paystack.co/${path}`, {
  method, headers: { Authorization: `Bearer ${env('PAYSTACK_SECRET_KEY')}`, 'Content-Type': 'application/json' },
  body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
}, 'paystack');
const razorpay = (path, payload, method = 'POST') => call(`https://api.razorpay.com/v1/${path}`, {
  method, headers: {
    Authorization: `Basic ${Buffer.from(`${env('RAZORPAY_KEY_ID')}:${env('RAZORPAY_KEY_SECRET')}`).toString('base64')}`,
    'Content-Type': 'application/json',
  },
  body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
}, 'razorpay');

async function upsertSub(row) {
  must(await db().from('subscriptions').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'provider,provider_ref' }), 'upsert sub');
}
async function recordPayment(row) {
  must(await db().from('payments').upsert(row, { onConflict: 'provider,provider_ref' }), 'payment');
}
async function logEvent(provider, eventId) {
  if (eventId) await db().from('webhook_events').upsert({ provider, event_id: String(eventId) }, { ignoreDuplicates: true });
}
const iso = (unix) => (unix ? new Date(unix * 1000).toISOString() : null);

// ---------- Checkout ----------
export async function checkout(req) {
  const id = await identify(req);
  if (!id.user || !id.playerId) fail(401, 'Create a free account first so your pass is saved to you.', { code: 'account_required' });
  const body = await readJson(req);
  const plan = body.plan === 'yearly' ? 'yearly' : 'monthly';
  const player = must(await db().from('players').select('market').eq('id', id.playerId).single());
  const marketKey = MARKETS[body.market] ? body.market : (player.market || 'US');
  const market = MARKETS[marketKey];
  if (plan === 'yearly' && !market.yearly) fail(400, 'Yearly billing is not available in this region yet.');
  if (!providerConfigured(market.provider)) fail(503, 'Payments are not available in your region yet.');
  const active = must(await db().from('subscriptions').select('id').eq('player_id', id.playerId).in('status', ['active', 'trialing', 'non_renewing']).gt('current_period_end', new Date().toISOString()));
  if (active.length) fail(409, 'You already have HoluVantage All Themes.');
  const success = `${SITE()}/#/account?checkout=success`;
  const cancel = `${SITE()}/#/pricing?checkout=cancelled`;

  if (market.provider === 'stripe') {
    const price = stripePrice(market.currency, plan);
    if (!price) fail(503, 'This plan is not available yet.');
    const session = await stripe('checkout/sessions', {
      mode: 'subscription', success_url: success, cancel_url: cancel, client_reference_id: id.playerId,
      customer_email: id.user.email, allow_promotion_codes: 'true',
      line_items: { 0: { price, quantity: 1 } },
      metadata: { player_id: id.playerId, plan },
      subscription_data: { metadata: { player_id: id.playerId, plan } },
    });
    return { url: session.url };
  }
  if (market.provider === 'paystack') {
    const r = await paystack('transaction/initialize', {
      email: id.user.email, amount: market.monthly, currency: 'NGN', plan: env('PAYSTACK_PLAN_NGN_MONTHLY'),
      callback_url: success, metadata: { player_id: id.playerId, plan },
    });
    return { url: r.data.authorization_url };
  }
  const sub = await razorpay('subscriptions', {
    plan_id: env('RAZORPAY_PLAN_INR_MONTHLY'), total_count: 120, quantity: 1, customer_notify: 1,
    notes: { player_id: id.playerId, plan },
  });
  await upsertSub({ player_id: id.playerId, provider: 'razorpay', provider_ref: sub.id, plan, status: 'created', currency: 'INR' });
  return { url: sub.short_url };
}

// ---------- Manage / cancel ----------
export async function manage(req) {
  const id = await identify(req);
  if (!id.playerId) fail(401, 'Sign in first');
  const subs = must(await db().from('subscriptions').select('*').eq('player_id', id.playerId).in('status', ['active', 'trialing', 'non_renewing']).order('updated_at', { ascending: false }));
  const sub = subs[0];
  if (!sub) fail(404, 'No active subscription');
  if (sub.provider === 'stripe') {
    const s = await stripe('billing_portal/sessions', { customer: sub.provider_customer, return_url: `${SITE()}/#/account` });
    return { url: s.url };
  }
  if (sub.provider === 'paystack') {
    const r = await paystack(`subscription/${encodeURIComponent(sub.provider_customer)}/manage/link`, null, 'GET');
    return { url: r.data.link };
  }
  await razorpay(`subscriptions/${encodeURIComponent(sub.provider_ref)}/cancel`, { cancel_at_cycle_end: 1 });
  await upsertSub({ ...sub, status: 'non_renewing' });
  return { cancelled: true, message: 'Your pass will not renew. You keep access until the end of this billing period.' };
}

// Used when an account is deleted: stop all future billing immediately (best effort, logged).
export async function cancelAllSubscriptions(playerId) {
  const subs = must(await db().from('subscriptions').select('*').eq('player_id', playerId).in('status', ['active', 'trialing', 'non_renewing', 'created']));
  for (const s of subs) {
    try {
      if (s.provider === 'stripe') await stripe(`subscriptions/${encodeURIComponent(s.provider_ref)}`, null, 'DELETE');
      else if (s.provider === 'razorpay') await razorpay(`subscriptions/${encodeURIComponent(s.provider_ref)}/cancel`, { cancel_at_cycle_end: 0 });
      else if (s.provider === 'paystack' && s.provider_customer && s.provider_token) await paystack('subscription/disable', { code: s.provider_customer, token: s.provider_token });
    } catch (e) {
      console.error('cancel failed', s.provider, s.provider_ref, e.message);
      fail(502, 'We could not cancel your subscription automatically. Please cancel it first from your account page, then delete your account.');
    }
  }
}

// ---------- Webhooks ----------
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function verifyStripeSignature(raw, header, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v]));
  const sigs = String(header || '').split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!parts.t || !sigs.length || Math.abs(nowSec - Number(parts.t)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  return sigs.some((s) => safeEqual(s, expected));
}
export const verifyPaystackSignature = (raw, header, secret) =>
  Boolean(header) && safeEqual(crypto.createHmac('sha512', secret).update(raw).digest('hex'), header);
export const verifyRazorpaySignature = (raw, header, secret) =>
  Boolean(header) && safeEqual(crypto.createHmac('sha256', secret).update(raw).digest('hex'), header);

async function stripeSubToRow(sub, fallbackPlayer) {
  const playerId = sub.metadata?.player_id || fallbackPlayer;
  if (!playerId) return null;
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id;
  const plan = sub.metadata?.plan || (priceId && [process.env.STRIPE_PRICE_GBP_YEARLY, process.env.STRIPE_PRICE_USD_YEARLY].includes(priceId) ? 'yearly' : 'monthly');
  let status = sub.status;
  if (status === 'canceled') status = 'cancelled';
  else if (sub.cancel_at_period_end && status === 'active') status = 'non_renewing';
  return {
    player_id: playerId, provider: 'stripe', provider_ref: sub.id, provider_customer: sub.customer, plan, status,
    currency: String(sub.currency || item?.price?.currency || '').toUpperCase(),
    current_period_end: iso(sub.current_period_end ?? item?.current_period_end),
  };
}

export async function stripeWebhook(req) {
  const raw = await readRaw(req, 1_000_000);
  if (!verifyStripeSignature(raw, req.headers['stripe-signature'], env('STRIPE_WEBHOOK_SECRET'))) fail(400, 'Bad signature');
  const event = JSON.parse(raw);
  const obj = event.data?.object || {};
  switch (event.type) {
    case 'checkout.session.completed': {
      if (obj.mode !== 'subscription' || !obj.subscription) break;
      const sub = await stripe(`subscriptions/${encodeURIComponent(obj.subscription)}`, null, 'GET');
      const row = await stripeSubToRow(sub, obj.client_reference_id);
      if (row) await upsertSub(row);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const existing = must(await db().from('subscriptions').select('player_id').eq('provider', 'stripe').eq('provider_ref', obj.id).maybeSingle());
      const row = await stripeSubToRow(obj, existing?.player_id);
      if (row) await upsertSub(row);
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const subId = obj.subscription || obj.parent?.subscription_details?.subscription;
      const sub = subId ? must(await db().from('subscriptions').select('player_id').eq('provider', 'stripe').eq('provider_ref', subId).maybeSingle()) : null;
      const playerId = sub?.player_id || obj.subscription_details?.metadata?.player_id || obj.parent?.subscription_details?.metadata?.player_id || null;
      await recordPayment({
        player_id: playerId, provider: 'stripe', provider_ref: obj.id,
        amount_minor: event.type === 'invoice.paid' ? obj.amount_paid : obj.amount_due,
        currency: String(obj.currency).toUpperCase(), status: event.type === 'invoice.paid' ? 'succeeded' : 'failed',
      });
      break;
    }
    default: break;
  }
  await logEvent('stripe', event.id);
  return { received: true };
}

export async function paystackWebhook(req) {
  const raw = await readRaw(req, 1_000_000);
  if (!verifyPaystackSignature(raw, req.headers['x-paystack-signature'], env('PAYSTACK_SECRET_KEY'))) fail(400, 'Bad signature');
  const event = JSON.parse(raw);
  const d = event.data || {};
  const customer = d.customer?.customer_code;
  const existing = customer ? must(await db().from('subscriptions').select('*').eq('provider', 'paystack').eq('provider_ref', customer).maybeSingle()) : null;
  let meta = d.metadata;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
  const playerId = meta?.player_id || existing?.player_id;
  if (event.event === 'charge.success' && playerId) {
    await recordPayment({ player_id: playerId, provider: 'paystack', provider_ref: d.reference, amount_minor: d.amount, currency: d.currency || 'NGN', status: 'succeeded' });
    if (d.plan && customer) {
      const end = new Date(Date.now() + 32 * 86400000).toISOString();
      await upsertSub({ ...(existing || {}), player_id: playerId, provider: 'paystack', provider_ref: customer, plan: 'monthly', status: 'active', currency: 'NGN', current_period_end: end });
    }
  } else if (event.event === 'subscription.create' && existing) {
    await upsertSub({ ...existing, provider_customer: d.subscription_code, provider_token: d.email_token, status: 'active', current_period_end: d.next_payment_date || existing.current_period_end });
  } else if (event.event === 'subscription.not_renew' && existing) {
    await upsertSub({ ...existing, status: 'non_renewing' });
  } else if (event.event === 'subscription.disable' && existing) {
    await upsertSub({ ...existing, status: 'cancelled' });
  } else if (event.event === 'invoice.payment_failed' && existing) {
    await upsertSub({ ...existing, status: 'past_due' });
  }
  await logEvent('paystack', `${event.event}:${d.id || d.reference || d.subscription_code || ''}`);
  return { received: true };
}

export async function razorpayWebhook(req) {
  const raw = await readRaw(req, 1_000_000);
  if (!verifyRazorpaySignature(raw, req.headers['x-razorpay-signature'], env('RAZORPAY_WEBHOOK_SECRET'))) fail(400, 'Bad signature');
  const event = JSON.parse(raw);
  const sub = event.payload?.subscription?.entity;
  if (sub) {
    const existing = must(await db().from('subscriptions').select('*').eq('provider', 'razorpay').eq('provider_ref', sub.id).maybeSingle());
    const playerId = existing?.player_id || sub.notes?.player_id;
    if (playerId) {
      const map = { 'subscription.activated': 'active', 'subscription.charged': 'active', 'subscription.resumed': 'active',
        'subscription.pending': 'past_due', 'subscription.halted': 'halted', 'subscription.paused': 'paused',
        'subscription.cancelled': 'cancelled', 'subscription.completed': 'cancelled' };
      const status = map[event.event];
      if (status) {
        await upsertSub({ ...(existing || {}), player_id: playerId, provider: 'razorpay', provider_ref: sub.id, plan: 'monthly', currency: 'INR',
          status: existing?.status === 'non_renewing' && status === 'active' ? 'non_renewing' : status,
          current_period_end: iso(sub.current_end) || existing?.current_period_end || null });
      }
      const pay = event.payload?.payment?.entity;
      if (event.event === 'subscription.charged' && pay) {
        await recordPayment({ player_id: playerId, provider: 'razorpay', provider_ref: pay.id, amount_minor: pay.amount, currency: pay.currency, status: 'succeeded' });
      }
    }
  }
  await logEvent('razorpay', req.headers['x-razorpay-event-id'] || `${event.event}:${sub?.id || ''}:${event.created_at || ''}`);
  return { received: true };
}
