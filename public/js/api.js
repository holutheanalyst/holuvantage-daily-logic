// Client: config, storage, Supabase email sign-in (no SDK), API calls, consent, analytics and ads.
export const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(`hvdl.${k}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(`hvdl.${k}`, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(`hvdl.${k}`); } catch {} },
};

let config = null;
let clockOffset = 0;
export const serverNow = () => Date.now() + clockOffset;

export async function loadConfig() {
  if (config) return config;
  const t0 = Date.now();
  const res = await fetch('/api/config');
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(res.status === 503 ? 'The daily puzzle is being set up. Please check back shortly — Endless Logic is open now.' : (b.error || 'Could not reach the server.'));
  }
  config = await res.json();
  clockOffset = config.serverNow - Math.round((t0 + Date.now()) / 2);
  return config;
}

// ---------- Auth (Supabase GoTrue REST, implicit magic-link flow) ----------
function saveSession(s) {
  store.set('session', { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: Math.floor(Date.now() / 1000) + Number(s.expires_in || 3600) });
}
export const signedIn = () => Boolean(store.get('session'));

export async function sendMagicLink(email) {
  const c = await loadConfig();
  const redirect = `${location.origin}/`;
  const res = await fetch(`${c.supabaseUrl}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, {
    method: 'POST', headers: { apikey: c.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, create_user: true }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(res.status === 429 ? 'Too many sign-in emails. Please wait a minute and try again.' : (b.msg || b.error_description || 'Could not send the sign-in link.'));
  }
}

// Reads tokens from the URL after the magic link redirect. Returns 'signed_in', an error message, or null.
export function consumeAuthRedirect() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.get('access_token') && h.get('refresh_token')) {
    saveSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_in: h.get('expires_in') });
    history.replaceState(null, '', `${location.pathname}#/`);
    return 'signed_in';
  }
  if (h.get('error')) {
    history.replaceState(null, '', `${location.pathname}#/account`);
    return h.get('error_description') || 'That sign-in link is invalid or has expired.';
  }
  return null;
}

async function accessToken() {
  const s = store.get('session');
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  const c = await loadConfig();
  const res = await fetch(`${c.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: c.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!res.ok) { store.del('session'); return null; }
  const fresh = await res.json();
  saveSession(fresh);
  return fresh.access_token;
}

export async function signOut() {
  const c = await loadConfig();
  const token = await accessToken().catch(() => null);
  if (token) fetch(`${c.supabaseUrl}/auth/v1/logout`, { method: 'POST', headers: { apikey: c.supabaseAnonKey, Authorization: `Bearer ${token}` } }).catch(() => {});
  store.del('session');
}

// ---------- API ----------
export class ApiError extends Error { constructor(status, body) { super(body.error || 'Request failed'); this.status = status; this.body = body; } }

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = await accessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (store.get('guest')) headers['X-Guest-Token'] = store.get('guest');
  }
  let res;
  try {
    res = await fetch(`/api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { error: 'You appear to be offline. Check your connection and try again.' });
  }
  const data = await res.json().catch(() => ({ error: 'Unexpected server response' }));
  if (!res.ok) {
    if (res.status === 401 && headers['X-Guest-Token']) store.del('guest');
    if (res.status === 401 && headers.Authorization) store.del('session');
    throw new ApiError(res.status, data);
  }
  return data;
}

export const hasIdentity = () => signedIn() || Boolean(store.get('guest'));

export async function ensureGuest(themes) {
  if (hasIdentity()) return;
  const r = await api('guest', { method: 'POST', body: { themes }, auth: false });
  store.set('guest', r.token);
}

// After sign-in, attach any guest progress to the account.
export async function claimGuestProgress() {
  const guest = store.get('guest');
  if (!guest || !signedIn()) return null;
  try {
    const r = await api('account/claim', { method: 'POST', body: { guestToken: guest } });
    store.del('guest');
    return r;
  } catch (e) {
    if (e.status === 400) store.del('guest');
    throw e;
  }
}

// ---------- Consent ----------
export const consent = () => store.get('consent'); // { analytics: bool, ads: bool } | null
export function setConsent(c) { store.set('consent', { analytics: Boolean(c.analytics), ads: Boolean(c.ads), at: Date.now() }); }

// ---------- Analytics (only with consent) ----------
export function track(event, props = {}) {
  if (!consent()?.analytics) return;
  api('event', { method: 'POST', body: { event, props } }).catch(() => {});
}

// ---------- Ads (provider abstraction; nothing loads without consent or for premium players) ----------
let adsLoaded = false;
function loadAdScript(client) {
  if (adsLoaded) return;
  window.adsbygoogle = window.adsbygoogle || [];
  window.adBreak = window.adConfig = (o) => window.adsbygoogle.push(o);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  s.crossOrigin = 'anonymous';
  document.head.appendChild(s);
  window.adConfig({ preloadAdBreaks: 'on', sound: 'on' });
  adsLoaded = true;
}
export async function showAd(slotName, container, { premium } = {}) {
  container.innerHTML = '';
  container.hidden = true;
  const c = await loadConfig();
  if (premium || c.ads.provider !== 'adsense' || !consent()?.ads || !c.ads.slots[slotName]) return;
  loadAdScript(c.ads.client);
  container.hidden = false;
  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.dataset.adClient = c.ads.client;
  ins.dataset.adSlot = c.ads.slots[slotName];
  ins.dataset.adFormat = 'auto';
  ins.dataset.fullWidthResponsive = 'true';
  container.append(Object.assign(document.createElement('span'), { className: 'ad-label', textContent: 'Advertisement' }), ins);
  try { (window.adsbygoogle = window.adsbygoogle || []).push({}); track('ad_impression', { slot: slotName }); } catch {}
}

// Rewarded ad via Google's H5 Games Ad Placement API, when available. Resolves true if the ad was watched.
export async function rewardedAvailable() {
  const c = await loadConfig();
  if (c.ads.provider !== 'adsense' || !consent()?.ads) return false;
  loadAdScript(c.ads.client);
  return true;
}
export function showRewarded() {
  return new Promise((resolve) => {
    let rewarded = false;
    track('rewarded_ad_started');
    window.adBreak({
      type: 'reward', name: 'hint',
      beforeReward: (showAdFn) => showAdFn(),
      adViewed: () => { rewarded = true; track('rewarded_ad_completed'); },
      adDismissed: () => {},
      adBreakDone: () => resolve(rewarded),
    });
  });
}

// ---------- Formatting ----------
export function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
export function fmtMoney(minor, currency) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100); }
  catch { return `${(minor / 100).toFixed(2)} ${currency}`; }
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
