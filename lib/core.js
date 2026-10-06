// Pure server-side logic (no I/O) — tested in tests/.
import crypto from 'node:crypto';
import { EMPTY, SIZES, DIFFICULTIES, computeScore, minPlausibleMs, generateValidPuzzle, fingerprint } from '../public/js/engine.js';

export const THEMES = ['classic', 'football', 'cricket', 'geography'];
export const EPOCH = '2026-10-01'; // Puzzle #1
export const STREAK_GRACE_DAYS = 0; // set to 1 to forgive a single missed day

// ---------- Dates (UTC) ----------
export const todayUTC = (now = new Date()) => now.toISOString().slice(0, 10);
export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const puzzleNumber = (dateStr) => dayDiff(EPOCH, dateStr) + 1;
export const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export function weekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(dateStr, -dow);
}

// ---------- Daily puzzle seeds ----------
export function dailySeed(secret, date, difficulty, version) {
  return crypto.createHmac('sha256', secret).update(`${date}:${difficulty}:${version}`).digest('hex');
}
export function buildDailyPuzzle(secret, date, difficulty, version = 1) {
  const seed = dailySeed(secret, date, difficulty, version);
  const p = generateValidPuzzle(seed, difficulty);
  return {
    puzzle_date: date, difficulty, version, puzzle_no: puzzleNumber(date), size: p.n,
    givens: p.givens, solution: p.solution, level: p.level, fingerprint: fingerprint(p.givens),
  };
}

// ---------- Guest tokens ----------
const b64 = (buf) => Buffer.from(buf).toString('base64url');
export function signGuest(secret, playerId) {
  return `${playerId}.${b64(crypto.createHmac('sha256', secret).update(`guest:${playerId}`).digest())}`;
}
export function verifyGuest(secret, token) {
  if (typeof token !== 'string' || token.length > 200) return null;
  const [id, sig] = token.split('.');
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const expected = signGuest(secret, id).split('.')[1];
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? id : null;
}

// ---------- Move replay (server-side score validation) ----------
// moves: [[cellIndex, value], ...]; value 0 = clear, 1/2 = tiles.
export function replayMoves({ givens, solution, size }, moves, hintedCells = []) {
  if (!Array.isArray(moves) || moves.length > 3000) return { ok: false, error: 'Invalid moves' };
  const grid = givens.slice();
  const hinted = new Set(hintedCells);
  const rowFlags = Array(size).fill('clean');
  let mistakes = 0;
  for (const m of moves) {
    if (!Array.isArray(m) || m.length !== 2) return { ok: false, error: 'Invalid move' };
    const [i, v] = m;
    if (!Number.isInteger(i) || i < 0 || i >= grid.length || givens[i] !== EMPTY) return { ok: false, error: 'Invalid cell' };
    if (![0, 1, 2].includes(v)) return { ok: false, error: 'Invalid value' };
    if (v !== 0 && v !== solution[i] && !hinted.has(i)) { mistakes++; rowFlags[Math.floor(i / size)] = 'mistake'; }
    grid[i] = v;
  }
  for (const i of hinted) { const r = Math.floor(i / size); if (rowFlags[r] === 'clean') rowFlags[r] = 'hint'; }
  const solved = grid.every((v, i) => v === solution[i]);
  return { ok: true, solved, mistakes, rowFlags };
}

export function scoreAttempt({ difficulty, givens, startedAt, now, mistakes, hints }) {
  const timeMs = Math.max(0, now - startedAt);
  const plausible = timeMs >= minPlausibleMs(givens);
  return { timeMs, plausible, score: computeScore({ difficulty, timeMs, mistakes, hints }) };
}

// ---------- Hints ----------
export function chooseHint(givens, solution, grid, size, nextLogicalCell) {
  for (let i = 0; i < grid.length; i++) {
    if (givens[i] === EMPTY && grid[i] !== EMPTY && grid[i] !== solution[i]) return { index: i, value: solution[i], kind: 'fix' };
  }
  const logical = nextLogicalCell(grid, size);
  if (logical >= 0 && grid[logical] === EMPTY) return { index: logical, value: solution[logical], kind: 'next' };
  const empty = grid.findIndex((v) => v === EMPTY);
  return empty >= 0 ? { index: empty, value: solution[empty], kind: 'reveal' } : null;
}

// ---------- Streaks ----------
// dates: array of YYYY-MM-DD with a ranked completion (any order, duplicates allowed).
export function computeStreaks(dates, today, grace = STREAK_GRACE_DAYS) {
  const days = [...new Set(dates)].sort();
  if (!days.length) return { current: 0, best: 0, completedToday: false, missedDays: 0 };
  let best = 1, run = 1;
  for (let k = 1; k < days.length; k++) {
    const gap = dayDiff(days[k - 1], days[k]) - 1;
    run = gap <= grace ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const last = days[days.length - 1];
  const sinceLast = dayDiff(last, today);
  const current = sinceLast <= 1 + grace ? run : 0;
  const missedDays = Math.max(0, dayDiff(days[0], today) + 1 - days.length - (last === today ? 0 : 1));
  return { current, best, completedToday: last === today, missedDays };
}

// ---------- Entitlements ----------
const ACTIVE = new Set(['active', 'trialing', 'non_renewing']);
export function isPremium(subscriptions = [], now = new Date()) {
  return subscriptions.some((s) => ACTIVE.has(s.status) && s.current_period_end && new Date(s.current_period_end) > now);
}
export function canPlayTheme(player, theme, premium, premiumOnlyThemes = []) {
  if (!THEMES.includes(theme) && !premiumOnlyThemes.includes(theme)) return false;
  if (premium) return true;
  if (premiumOnlyThemes.includes(theme)) return false;
  return theme === 'classic' || player.free_theme === theme;
}
export const FREE_HINTS = 1, REWARDED_HINTS = 1;
export function hintAllowance(premium, rewardedUsed) {
  return premium ? Infinity : FREE_HINTS + Math.min(rewardedUsed, REWARDED_HINTS);
}

// ---------- Profile validation ----------
const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'bitch', 'whore', 'slut', 'rape', 'nazi', 'admin', 'holuvantage'];
export function validNickname(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(name)) return false;
  const lower = name.toLowerCase();
  return !BLOCKED.some((w) => lower.includes(w));
}
export function sanitizeThemes(list) {
  if (!Array.isArray(list)) return null;
  const clean = [...new Set(list.filter((t) => THEMES.includes(t)))];
  return clean.length >= 1 && clean.length <= 3 ? clean : null;
}
const ADJ = ['Swift', 'Clever', 'Bright', 'Calm', 'Bold', 'Keen', 'Sharp', 'Quick', 'Steady', 'Lucky', 'Brave', 'Witty'];
const NOUN = ['Falcon', 'Tiger', 'Otter', 'Comet', 'River', 'Maple', 'Puma', 'Heron', 'Orbit', 'Cedar', 'Lynx', 'Zebra'];
export function randomNickname(rand = Math.random) {
  return `${ADJ[Math.floor(rand() * ADJ.length)]}${NOUN[Math.floor(rand() * NOUN.length)]}${100 + Math.floor(rand() * 900)}`;
}

// ---------- Achievements ----------
export function newAchievements({ have, totalCompleted, streak, mistakes, hints, timeMs, difficulty, themesPlayed }) {
  const earned = [];
  const add = (code, cond) => cond && !have.includes(code) && earned.push(code);
  add('first_solve', totalCompleted >= 1);
  add('streak_3', streak >= 3);
  add('streak_7', streak >= 7);
  add('streak_30', streak >= 30);
  add('flawless', mistakes === 0 && hints === 0);
  add('speedster', difficulty === 'hard' && timeMs < 180000 && mistakes === 0);
  add('all_themes', THEMES.every((t) => themesPlayed.includes(t)));
  return earned;
}

// ---------- Markets & pricing ----------
export const MARKETS = {
  GB: { currency: 'GBP', symbol: '£', monthly: 299, yearly: 2499, provider: 'stripe' },
  US: { currency: 'USD', symbol: '$', monthly: 399, yearly: 2999, provider: 'stripe' },
  NG: { currency: 'NGN', symbol: '₦', monthly: 150000, yearly: null, provider: 'paystack' },
  IN: { currency: 'INR', symbol: '₹', monthly: 14900, yearly: null, provider: 'razorpay' },
};
export const marketFor = (country) => (MARKETS[country] ? country : (country === 'UK' ? 'GB' : 'US'));

export const isValidDifficulty = (d) => DIFFICULTIES.includes(d);
export { SIZES };
