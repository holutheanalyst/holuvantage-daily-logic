// End-to-end API journey against the local harness (scripts/dev-server.mjs). Run: node tests/e2e.mjs
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const BASE = 'http://localhost:8787/api/';
const psql = (sql) => execFileSync('psql', ['-h', '/var/tmp/pgt', '-p', '5499', '-U', 'postgres', '-d', 'e2e', '-tAc', sql]).toString().trim();
let passed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };

async function call(path, { method = 'GET', body, guest, user, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (guest) h['X-Guest-Token'] = guest;
  if (user) h.Authorization = `Bearer tok:${user}`;
  const res = await fetch(BASE + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  return { status: res.status, data: await res.json() };
}
const solutionOf = (puzzleId) => psql(`select array_to_json(solution) from daily_puzzles where id=${puzzleId}`).replace(/[[\]]/g, '').split(',').map(Number);
const movesFor = (puzzle, solution) => puzzle.givens.map((v, i) => (v ? null : [i, solution[i]])).filter(Boolean);
const backdate = (attemptId, mins) => psql(`update attempts set started_at = now() - interval '${mins} minutes' where id='${attemptId}'`);

console.log('Config & guest');
const cfg = await call('config');
assert.equal(cfg.status, 200); assert.equal(cfg.data.market, 'GB'); assert.ok(!JSON.stringify(cfg.data).includes('service')); ok('config is public-safe');
const g1 = await call('guest', { method: 'POST', body: { themes: ['classic', 'football'] } });
assert.equal(g1.status, 200); const G1 = g1.data.token; ok('guest created');
const me1 = await call('me', { guest: G1 });
assert.equal(me1.data.player.freeTheme, 'football'); assert.equal(me1.data.premium, false); ok('free theme = first non-classic pick');
assert.equal((await call('me', { guest: G1.slice(0, -3) + 'abc' })).status, 401); ok('tampered guest token rejected');
assert.equal((await call('me')).status, 401); ok('no identity → 401');

console.log('Daily play');
const st = await call('attempt/start', { method: 'POST', guest: G1, body: { difficulty: 'easy', theme: 'football' } });
assert.equal(st.status, 200); const { attempt, puzzle } = st.data;
assert.ok(!('solution' in puzzle) && !JSON.stringify(st.data).includes('"solution"')); ok('solution never sent to client');
assert.equal(puzzle.size, 6); assert.equal(puzzle.givens.length, 36);
const again = await call('attempt/start', { method: 'POST', guest: G1, body: { difficulty: 'easy', theme: 'football' } });
assert.equal(again.data.attempt.id, attempt.id); ok('refresh resumes the same attempt');
const sol = solutionOf(puzzle.id);
const h1 = await call('attempt/hint', { method: 'POST', guest: G1, body: { attemptId: attempt.id, grid: puzzle.givens } });
assert.equal(h1.status, 200); assert.equal(h1.data.hint.value, sol[h1.data.hint.index]); ok('hint is correct');
const h2 = await call('attempt/hint', { method: 'POST', guest: G1, body: { attemptId: attempt.id, grid: puzzle.givens } });
assert.equal(h2.status, 403); assert.equal(h2.data.code, 'no_hints'); ok('free hint limit enforced');
const badGrid = await call('attempt/hint', { method: 'POST', guest: G1, body: { attemptId: attempt.id, grid: [1, 2] } });
assert.equal(badGrid.status, 400); ok('invalid grid rejected');
let moves = movesFor(puzzle, sol);
const partial = await call('attempt/submit', { method: 'POST', guest: G1, body: { attemptId: attempt.id, moves: moves.slice(2) } });
assert.equal(partial.status, 400); assert.equal(partial.data.code, 'not_solved'); ok('unsolved submit rejected');
const givenIdx = puzzle.givens.findIndex((v) => v);
assert.equal((await call('attempt/submit', { method: 'POST', guest: G1, body: { attemptId: attempt.id, moves: [[givenIdx, 1], ...moves] } })).status, 400); ok('cannot overwrite clues');
const wrongIdx = moves.find(([i]) => i !== h1.data.hint.index)[0];
moves = [[wrongIdx, sol[wrongIdx] === 1 ? 2 : 1], ...moves];
backdate(attempt.id, 3);
const sub = await call('attempt/submit', { method: 'POST', guest: G1, body: { attemptId: attempt.id, moves, score: 999999 } });
assert.equal(sub.status, 200); const r = sub.data.result;
assert.equal(r.mistakes, 1); assert.equal(r.hints, 1); assert.equal(r.ranked, true); assert.equal(r.streak, 1);
assert.ok(r.timeMs >= 179000 && r.timeMs < 200000, 'server-measured time'); assert.ok(r.score < 1000);
assert.equal(r.rowFlags[Math.floor(wrongIdx / 6)], 'mistake');
if (Math.floor(wrongIdx / 6) !== Math.floor(h1.data.hint.index / 6)) assert.equal(r.rowFlags[Math.floor(h1.data.hint.index / 6)], 'hint'); ok('server computes score, time, mistakes; ignores client score');
assert.ok(r.newAchievements.includes('first_solve')); ok('achievement awarded');
const dup = await call('attempt/submit', { method: 'POST', guest: G1, body: { attemptId: attempt.id, moves } });
assert.equal(dup.data.duplicate, true); assert.equal(dup.data.result.score, r.score); ok('duplicate submission is idempotent');
assert.equal(psql(`select count(*) from scores where attempt_id='${attempt.id}'`), '1'); ok('only one score row');

const fast = await call('attempt/start', { method: 'POST', guest: G1, body: { difficulty: 'medium', theme: 'classic' } });
const fsol = solutionOf(fast.data.puzzle.id);
const fres = await call('attempt/submit', { method: 'POST', guest: G1, body: { attemptId: fast.data.attempt.id, moves: movesFor(fast.data.puzzle, fsol) } });
assert.equal(fres.data.result.ranked, false); assert.equal(fres.data.result.unrankedReason, 'too_fast'); ok('implausibly fast solve is unranked');

assert.equal((await call('attempt/start', { method: 'POST', guest: G1, body: { difficulty: 'easy', theme: 'cricket' } })).data.code, 'premium_required'); ok('locked theme enforced server-side');
assert.equal((await call('attempt/start', { method: 'POST', guest: G1, body: { difficulty: 'easy', theme: 'classic', date: '2026-10-02' } })).data.code, 'premium_required'); ok('archive requires premium');
assert.equal((await call('attempt/start', { method: 'POST', guest: G1, body: { difficulty: 'easy', theme: 'classic', date: '2099-01-01' } })).status, 400); ok('future dates rejected');
assert.equal((await call('attempt/start', { method: 'POST', guest: G1, body: { difficulty: 'insane' } })).status, 400); ok('bad difficulty rejected');
const other = await call('guest', { method: 'POST', body: { themes: ['classic'] } });
assert.equal((await call('attempt/submit', { method: 'POST', guest: other.data.token, body: { attemptId: attempt.id, moves } })).status, 404); ok("cannot submit another player's attempt");

console.log('Leaderboards & stats');
const lb = await call('leaderboard?period=daily&difficulty=easy', { guest: G1 });
assert.equal(lb.data.rows.length, 1); assert.ok(lb.data.rows[0].me); assert.ok(!('player_id' in lb.data.rows[0])); ok('leaderboard shows nickname only, flags me');
assert.equal((await call('leaderboard?period=daily&difficulty=medium')).data.rows.length, 0); ok('unranked solves excluded');
assert.equal((await call('leaderboard?period=weekly&theme=football')).data.rows.length, 1); ok('weekly + theme leaderboard');
const me2 = (await call('me', { guest: G1 })).data;
assert.equal(me2.streak.current, 1); assert.equal(me2.themeStreaks.football.current, 1); assert.equal(me2.todayStatus.easy.status, 'completed'); assert.equal(me2.rank.rank, 1); ok('streaks, theme streaks, today status, rank');
const stats = (await call('stats', { guest: G1 })).data;
assert.equal(stats.premium, false); assert.ok(!('by_difficulty' in stats.stats)); ok('advanced stats hidden for free');

console.log('Profile');
assert.equal((await call('me', { method: 'PATCH', guest: G1, body: { nickname: '<b>x</b>' } })).status, 400); ok('nickname validation');
const nick2 = (await call('me', { guest: other.data.token })).data.player.nickname;
assert.equal((await call('me', { method: 'PATCH', guest: G1, body: { nickname: nick2 } })).status, 409); ok('nickname uniqueness');
assert.equal((await call('me', { method: 'PATCH', guest: G1, body: { freeTheme: 'cricket' } })).status, 400); ok('free theme switch locked for 7 days');
assert.equal((await call('me', { method: 'PATCH', guest: G1, body: { themes: ['classic', 'football', 'cricket', 'geography'] } })).status, 400); ok('max 3 interests');

console.log('Groups');
const grp = await call('groups', { method: 'POST', guest: G1, body: { name: 'Class 7B' } });
assert.equal(grp.status, 200);
assert.equal((await call('groups/join', { method: 'POST', guest: other.data.token, body: { code: grp.data.code } })).status, 200);
const glb = await call(`leaderboard?group=${grp.data.id}`, { guest: other.data.token });
assert.equal(glb.status, 200); assert.equal(glb.data.rows.length, 1); ok('group leaderboard');
const g3 = await call('guest', { method: 'POST', body: {} });
assert.equal((await call(`leaderboard?group=${grp.data.id}`, { guest: g3.data.token })).status, 403); ok('non-members cannot view group board');

console.log('Accounts & migration');
assert.equal((await call('account/claim', { method: 'POST', user: 'ada@example.com', body: { guestToken: G1 } })).data.mode, 'attached'); ok('guest attached to new account');
assert.equal((await call('me', { guest: G1 })).status, 401); ok('old guest token retired');
const acct = (await call('me', { user: 'ada@example.com' })).data;
assert.equal(acct.streak.current, 1); assert.equal(acct.player.isAccount, true); assert.equal(acct.groups.length, 1); ok('streak, scores and groups kept after sign-in');
// Second device: a new guest plays the same easy puzzle better, then signs in → merge keeps the better score.
const g4 = (await call('guest', { method: 'POST', body: { themes: ['classic', 'geography'] } })).data.token;
const s4 = (await call('attempt/start', { method: 'POST', guest: g4, body: { difficulty: 'easy', theme: 'classic' } })).data;
backdate(s4.attempt.id, 1);
const r4 = (await call('attempt/submit', { method: 'POST', guest: g4, body: { attemptId: s4.attempt.id, moves: movesFor(s4.puzzle, solutionOf(s4.puzzle.id)) } })).data.result;
assert.ok(r4.score > r.score);
assert.equal((await call('account/claim', { method: 'POST', user: 'ada@example.com', body: { guestToken: g4 } })).data.mode, 'merged');
const lb2 = await call('leaderboard?period=daily&difficulty=easy', { user: 'ada@example.com' });
assert.equal(lb2.data.rows.length, 1); assert.equal(lb2.data.rows[0].score, r4.score); ok('merge keeps one ranked score per puzzle (the better one)');

console.log('Admin');
assert.equal((await call('admin/metrics', { user: 'ada@example.com' })).status, 403); ok('non-admin blocked');
assert.equal((await call('admin/metrics', { guest: g3.data.token })).status, 403); ok('guest blocked from admin');
const m = await call('admin/metrics', { user: 'admin@example.com' });
assert.equal(m.status, 200); assert.ok(m.data.players_total >= 3); ok('admin metrics');
const gen = await call('admin/puzzles/generate', { method: 'POST', user: 'admin@example.com', body: { days: 2 } });
assert.equal(gen.data.generated, 6); ok('generate future puzzles');
const list = (await call('admin/puzzles', { user: 'admin@example.com' })).data.puzzles;
const easyToday = list.find((p) => p.id === puzzle.id);
assert.equal(easyToday.started, 1); assert.equal(easyToday.completionRate, 100); ok('puzzle health');
assert.equal((await call('admin/puzzles/validate', { method: 'POST', user: 'admin@example.com', body: { id: puzzle.id } })).data.ok, true); ok('validate puzzle');
const tomorrow = list.find((p) => p.puzzle_no === puzzle.number + 1 && p.difficulty === 'hard');
const rep = await call('admin/puzzles/replace', { method: 'POST', user: 'admin@example.com', body: { id: tomorrow.id } });
assert.equal(rep.data.ok, true); assert.equal(rep.data.replacement.version, 2); ok('replace faulty puzzle with validated one');
assert.equal((await call('report', { method: 'POST', guest: g3.data.token, body: { message: 'Grid looks odd', puzzleId: puzzle.id } })).status, 200);
const reps = (await call('admin/reports', { user: 'admin@example.com' })).data.reports;
assert.equal(reps.length, 1);
assert.equal((await call('admin/reports', { method: 'PATCH', user: 'admin@example.com', body: { id: reps[0].id, status: 'resolved' } })).status, 200); ok('reports flow');

console.log('Payments (webhooks)');
const adaPlayer = psql("select p.id from players p join auth.users u on u.id=p.user_id where u.email='ada@example.com'");
const stripeBody = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', data: { object: {
  id: 'sub_1', customer: 'cus_1', status: 'active', currency: 'gbp', cancel_at_period_end: false, metadata: { player_id: adaPlayer, plan: 'monthly' },
  items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, price: { id: 'price_gbp_m', currency: 'gbp' } }] } } } });
assert.equal((await call('webhooks/stripe', { method: 'POST', raw: stripeBody, headers: { 'stripe-signature': 't=1,v1=bad' } })).status, 400); ok('stripe bad signature rejected');
const t = Math.floor(Date.now() / 1000);
const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${stripeBody}`).digest('hex');
assert.equal((await call('webhooks/stripe', { method: 'POST', raw: stripeBody, headers: { 'stripe-signature': `t=${t},v1=${sig}` } })).status, 200);
const prem = (await call('me', { user: 'ada@example.com' })).data;
assert.equal(prem.premium, true); ok('stripe subscription → premium');
assert.equal((await call('attempt/start', { method: 'POST', user: 'ada@example.com', body: { difficulty: 'hard', theme: 'cricket' } })).status, 200); ok('premium unlocks all themes');
const arch = await call('attempt/start', { method: 'POST', user: 'ada@example.com', body: { difficulty: 'easy', theme: 'cricket', date: '2026-10-02' } });
assert.equal(arch.status, 200); assert.equal(arch.data.attempt.mode, 'archive'); ok('premium archive access');
backdate(arch.data.attempt.id, 2);
const ar = (await call('attempt/submit', { method: 'POST', user: 'ada@example.com', body: { attemptId: arch.data.attempt.id, moves: movesFor(arch.data.puzzle, solutionOf(arch.data.puzzle.id)) } })).data.result;
assert.equal(ar.ranked, false); ok('archive solves are not ranked');
assert.ok('by_difficulty' in (await call('stats', { user: 'ada@example.com' })).data.stats); ok('advanced stats for premium');
const inv = JSON.stringify({ id: 'evt_2', type: 'invoice.paid', data: { object: { id: 'in_1', subscription: 'sub_1', amount_paid: 299, currency: 'gbp' } } });
const sig2 = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${inv}`).digest('hex');
await call('webhooks/stripe', { method: 'POST', raw: inv, headers: { 'stripe-signature': `t=${t},v1=${sig2}` } });
assert.equal(psql("select amount_minor from payments where provider_ref='in_1'"), '299'); ok('stripe payment recorded');
const cancelled = stripeBody.replace('"status":"active"', '"status":"canceled"');
const sig3 = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${cancelled}`).digest('hex');
await call('webhooks/stripe', { method: 'POST', raw: cancelled, headers: { 'stripe-signature': `t=${t},v1=${sig3}` } });
assert.equal((await call('me', { user: 'ada@example.com' })).data.premium, false); ok('cancellation removes premium');

const ngGuest = psql("insert into players (nickname, market) values ('NgPlayer1','NG') returning id").split('\n')[0];
const pay = JSON.stringify({ event: 'charge.success', data: { reference: 'ref_1', amount: 150000, currency: 'NGN', plan: { plan_code: 'PLN_test' }, customer: { customer_code: 'CUS_1' }, metadata: { player_id: ngGuest } } });
assert.equal((await call('webhooks/paystack', { method: 'POST', raw: pay, headers: { 'x-paystack-signature': 'bad' } })).status, 400);
const psig = crypto.createHmac('sha512', 'sk_paystack_test').update(pay).digest('hex');
assert.equal((await call('webhooks/paystack', { method: 'POST', raw: pay, headers: { 'x-paystack-signature': psig } })).status, 200);
assert.equal(psql(`select status from subscriptions where player_id='${ngGuest}'`), 'active'); ok('paystack charge → active subscription');
const inGuest = psql("insert into players (nickname, market) values ('InPlayer1','IN') returning id").split('\n')[0];
const rz = JSON.stringify({ event: 'subscription.charged', created_at: 1, payload: { subscription: { entity: { id: 'sub_rz1', current_end: t + 30 * 86400, notes: { player_id: inGuest } } }, payment: { entity: { id: 'pay_rz1', amount: 14900, currency: 'INR' } } } });
const rsig = crypto.createHmac('sha256', 'rzp_whsec').update(rz).digest('hex');
assert.equal((await call('webhooks/razorpay', { method: 'POST', raw: rz, headers: { 'x-razorpay-signature': rsig } })).status, 200);
assert.equal(psql(`select status from subscriptions where player_id='${inGuest}'`), 'active'); ok('razorpay charge → active subscription');
const co = await call('billing/checkout', { method: 'POST', guest: g3.data.token, body: { plan: 'monthly' } });
assert.equal(co.status, 401); assert.equal(co.data.code, 'account_required'); ok('checkout requires an account');

console.log('Analytics, export, deletion');
assert.equal((await call('event', { method: 'POST', guest: g3.data.token, body: { event: 'share_completed', props: { target: 'copy' } } })).status, 200);
assert.equal((await call('event', { method: 'POST', body: { event: 'drop_tables' } })).status, 400); ok('analytics allow-list');
const exp = (await call('account/export', { user: 'ada@example.com' })).data;
assert.equal(exp.email, 'ada@example.com'); assert.ok(exp.scores.length >= 2); ok('data export');
assert.equal((await call('account', { method: 'DELETE', user: 'ada@example.com' })).status, 200);
assert.equal(psql("select count(*) from auth.users where email='ada@example.com'"), '0');
assert.equal(psql(`select count(*) from scores where player_id='${adaPlayer}'`), '0'); ok('account deletion removes player, scores and login');
assert.equal((await call('account', { method: 'DELETE', guest: g3.data.token })).status, 200);
assert.equal((await call('me', { guest: g3.data.token })).status, 401); ok('guest data deletion');
assert.equal((await call('nope')).status, 404); ok('unknown route 404');
assert.equal((await call('me', { method: 'PATCH', guest: other.data.token, raw: '{not json' , headers: { 'Content-Type': 'application/json' } })).status, 400); ok('malformed JSON rejected');

console.log(`\nAll ${passed} end-to-end checks passed.`);
