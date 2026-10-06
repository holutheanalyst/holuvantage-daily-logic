import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyPuzzle, signGuest, verifyGuest, replayMoves, computeStreaks, isPremium, canPlayTheme,
  hintAllowance, validNickname, sanitizeThemes, puzzleNumber, weekStart, scoreAttempt, chooseHint,
  newAchievements, marketFor, dailySeed,
} from '../lib/core.js';
import { nextLogicalCell, EMPTY } from '../public/js/engine.js';
import { mergePlan } from '../lib/merge.js';

const SECRET = 'test-secret';

test('daily puzzle selection is deterministic per date + difficulty and secret-dependent', () => {
  const a = buildDailyPuzzle(SECRET, '2026-10-06', 'medium');
  const b = buildDailyPuzzle(SECRET, '2026-10-06', 'medium');
  assert.deepEqual(a.givens, b.givens);
  assert.notDeepEqual(a.givens, buildDailyPuzzle(SECRET, '2026-10-07', 'medium').givens);
  assert.notEqual(dailySeed('other', '2026-10-06', 'medium', 1), dailySeed(SECRET, '2026-10-06', 'medium', 1));
  assert.notDeepEqual(a.givens, buildDailyPuzzle(SECRET, '2026-10-06', 'medium', 2).givens);
  assert.equal(a.puzzle_no, 6);
});

test('guest tokens verify and reject tampering', () => {
  const id = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
  const t = signGuest(SECRET, id);
  assert.equal(verifyGuest(SECRET, t), id);
  assert.equal(verifyGuest('wrong', t), null);
  assert.equal(verifyGuest(SECRET, t.slice(0, -2) + 'xx'), null);
  assert.equal(verifyGuest(SECRET, `11111111-1111-1111-1111-111111111111.${t.split('.')[1]}`), null);
  assert.equal(verifyGuest(SECRET, 'garbage'), null);
});

test('move replay validates solution and counts mistakes server-side', () => {
  const p = buildDailyPuzzle(SECRET, '2026-10-06', 'easy');
  const empties = p.givens.map((v, i) => (v === EMPTY ? i : -1)).filter((i) => i >= 0);
  const perfect = empties.map((i) => [i, p.solution[i]]);
  assert.deepEqual(replayMoves(p, perfect).mistakes, 0);
  assert.equal(replayMoves(p, perfect).solved, true);
  const wrongFirst = [[empties[0], p.solution[empties[0]] === 1 ? 2 : 1], ...perfect];
  const r = replayMoves(p, wrongFirst);
  assert.equal(r.mistakes, 1);
  assert.equal(r.solved, true);
  assert.equal(r.rowFlags[Math.floor(empties[0] / 6)], 'mistake');
  assert.equal(replayMoves(p, perfect.slice(1)).solved, false);
  const given = p.givens.findIndex((v) => v !== EMPTY);
  assert.equal(replayMoves(p, [[given, 1]]).ok, false, 'cannot overwrite a given');
  assert.equal(replayMoves(p, [[999, 1]]).ok, false);
  assert.equal(replayMoves(p, [[empties[0], 7]]).ok, false);
  assert.equal(replayMoves(p, 'nope').ok, false);
});

test('implausibly fast solves are flagged', () => {
  const p = buildDailyPuzzle(SECRET, '2026-10-06', 'hard');
  const fast = scoreAttempt({ difficulty: 'hard', givens: p.givens, startedAt: 0, now: 1000, mistakes: 0, hints: 0 });
  assert.equal(fast.plausible, false);
  const ok = scoreAttempt({ difficulty: 'hard', givens: p.givens, startedAt: 0, now: 300000, mistakes: 0, hints: 0 });
  assert.equal(ok.plausible, true);
});

test('hints fix a wrong tile first, then give a logical next step', () => {
  const p = buildDailyPuzzle(SECRET, '2026-10-06', 'medium');
  const grid = p.givens.slice();
  const i = grid.indexOf(EMPTY);
  grid[i] = p.solution[i] === 1 ? 2 : 1;
  assert.deepEqual(chooseHint(p.givens, p.solution, grid, 8, nextLogicalCell), { index: i, value: p.solution[i], kind: 'fix' });
  const h = chooseHint(p.givens, p.solution, p.givens, 8, nextLogicalCell);
  assert.equal(h.value, p.solution[h.index]);
});

test('streaks', () => {
  assert.deepEqual(computeStreaks([], '2026-10-06'), { current: 0, best: 0, completedToday: false, missedDays: 0 });
  const s = computeStreaks(['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-06'], '2026-10-06');
  assert.equal(s.current, 3); assert.equal(s.best, 3); assert.equal(s.completedToday, true); assert.equal(s.missedDays, 1);
  assert.equal(computeStreaks(['2026-10-04', '2026-10-05'], '2026-10-06').current, 2, 'alive until end of today');
  assert.equal(computeStreaks(['2026-10-03', '2026-10-04'], '2026-10-06').current, 0, 'broken after a missed day');
  assert.equal(computeStreaks(['2026-10-03', '2026-10-05'], '2026-10-06', 1).current, 2, 'grace day');
});

test('subscription entitlement', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  assert.equal(isPremium([], now), false);
  assert.equal(isPremium([{ status: 'active', current_period_end: '2026-11-01T00:00:00Z' }], now), true);
  assert.equal(isPremium([{ status: 'active', current_period_end: '2026-10-01T00:00:00Z' }], now), false);
  assert.equal(isPremium([{ status: 'cancelled', current_period_end: '2026-11-01T00:00:00Z' }], now), false);
  assert.equal(isPremium([{ status: 'non_renewing', current_period_end: '2026-11-01T00:00:00Z' }], now), true);
  assert.equal(hintAllowance(true, 0), Infinity);
  assert.equal(hintAllowance(false, 0), 1);
  assert.equal(hintAllowance(false, 5), 2);
});

test('theme selection rules', () => {
  const p = { free_theme: 'football' };
  assert.equal(canPlayTheme(p, 'classic', false), true);
  assert.equal(canPlayTheme(p, 'football', false), true);
  assert.equal(canPlayTheme(p, 'cricket', false), false);
  assert.equal(canPlayTheme(p, 'cricket', true), true);
  assert.equal(canPlayTheme(p, 'hacker', true), false);
  assert.deepEqual(sanitizeThemes(['football', 'football', 'cricket', 'x']), ['football', 'cricket']);
  assert.equal(sanitizeThemes([]), null);
  assert.equal(sanitizeThemes(['classic', 'football', 'cricket', 'geography']), null);
});

test('nicknames', () => {
  assert.equal(validNickname('SwiftFalcon123'), true);
  assert.equal(validNickname('ab'), false);
  assert.equal(validNickname('<script>'), false);
  assert.equal(validNickname('HoluVantageAdmin'), false);
});

test('dates, markets and achievements', () => {
  assert.equal(puzzleNumber('2026-10-01'), 1);
  assert.equal(weekStart('2026-10-08'), '2026-10-05');
  assert.equal(marketFor('NG'), 'NG'); assert.equal(marketFor('FR'), 'US'); assert.equal(marketFor('UK'), 'GB');
  assert.deepEqual(newAchievements({ have: ['first_solve'], totalCompleted: 3, streak: 3, mistakes: 0, hints: 0, timeMs: 1, difficulty: 'easy', themesPlayed: ['classic'] }), ['streak_3', 'flawless']);
});

test('guest-to-account migration plan keeps the better result per puzzle', () => {
  const guest = [{ id: 'g1', puzzle_id: 1, score: 900 }, { id: 'g2', puzzle_id: 2, score: 500 }];
  const account = [{ id: 'a1', puzzle_id: 1, score: 950 }, { id: 'a3', puzzle_id: 3, score: 100 }];
  const plan = mergePlan(guest, account);
  assert.deepEqual(plan.moveScoreIds, ['g2']);
  assert.deepEqual(plan.dropGuestScoreIds, ['g1']);
  const plan2 = mergePlan([{ id: 'g1', puzzle_id: 1, score: 990 }], account);
  assert.deepEqual(plan2.moveScoreIds, ['g1']);
  assert.deepEqual(plan2.dropAccountScoreIds, ['a1']);
});
