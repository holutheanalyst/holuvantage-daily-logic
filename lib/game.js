// Player, puzzle, attempt, leaderboard and account handlers.
import crypto from 'node:crypto';
import { nextLogicalCell } from '../public/js/engine.js';
import {
  THEMES, todayUTC, addDays, isDateStr, weekStart, buildDailyPuzzle, signGuest, verifyGuest, replayMoves,
  scoreAttempt, chooseHint, computeStreaks, isPremium, canPlayTheme, hintAllowance, REWARDED_HINTS, validNickname,
  sanitizeThemes, randomNickname, newAchievements, isValidDifficulty, MARKETS, marketFor, EPOCH,
} from './core.js';
import { mergePlan } from './merge.js';
import { db, must, fail, env, identify, requirePlayer, readJson, rateLimit, clientIp } from './server.js';
import { providerConfigured, cancelAllSubscriptions } from './billing.js';

const FREE_THEME_LOCK_DAYS = 7;

// ---------- Shared loaders ----------
async function loadPlayer(playerId) {
  const player = must(await db().from('players').select('*').eq('id', playerId).maybeSingle());
  if (!player) fail(404, 'Player not found');
  const subs = must(await db().from('subscriptions').select('provider, plan, status, current_period_end').eq('player_id', playerId));
  return { player, subs, premium: isPremium(subs) };
}

export async function ensureDailyPuzzle(date, difficulty) {
  const existing = must(await db().from('daily_puzzles').select('*').eq('puzzle_date', date).eq('difficulty', difficulty).eq('status', 'active').maybeSingle());
  if (existing) return existing;
  const versions = must(await db().from('daily_puzzles').select('version').eq('puzzle_date', date).eq('difficulty', difficulty));
  let version = versions.reduce((m, r) => Math.max(m, r.version), 0) + 1;
  for (let tries = 0; tries < 5; tries++, version++) {
    const row = buildDailyPuzzle(env('PUZZLE_SECRET'), date, difficulty, version);
    const { data, error } = await db().from('daily_puzzles').insert(row).select('*').maybeSingle();
    if (!error) return data;
    if (error.code !== '23505') { console.error(error); fail(500, 'Could not create puzzle'); }
    const raced = must(await db().from('daily_puzzles').select('*').eq('puzzle_date', date).eq('difficulty', difficulty).eq('status', 'active').maybeSingle());
    if (raced) return raced; // another request created it; otherwise fingerprint clash → next version
  }
  fail(500, 'Could not create a unique puzzle');
}

const publicPuzzle = (p) => ({ id: p.id, date: p.puzzle_date, number: p.puzzle_no, difficulty: p.difficulty, size: p.size, givens: p.givens });

async function streakData(playerId) {
  const rows = must(await db().from('scores').select('puzzle_date, theme').eq('player_id', playerId).eq('ranked', true));
  const today = todayUTC();
  const overall = computeStreaks(rows.map((r) => r.puzzle_date), today);
  const themes = {};
  for (const t of THEMES) {
    const s = computeStreaks(rows.filter((r) => r.theme === t).map((r) => r.puzzle_date), today);
    if (s.best) themes[t] = { current: s.current, best: s.best };
  }
  return { overall, themes, themesPlayed: [...new Set(rows.map((r) => r.theme))], total: rows.length };
}

// ---------- Config ----------
export async function getConfig(req) {
  const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const prices = Object.fromEntries(Object.entries(MARKETS).map(([k, m]) => [k, { ...m, available: providerConfigured(m.provider) }]));
  return {
    supabaseUrl: env('SUPABASE_URL'),
    supabaseAnonKey: env('SUPABASE_ANON_KEY'),
    siteUrl: process.env.SITE_URL || '',
    market: marketFor(country),
    prices,
    epoch: EPOCH,
    serverNow: Date.now(),
    ads: process.env.ADS_PROVIDER === 'adsense' && process.env.ADSENSE_CLIENT
      ? { provider: 'adsense', client: process.env.ADSENSE_CLIENT, slots: { home: process.env.ADSENSE_SLOT_HOME || '', result: process.env.ADSENSE_SLOT_RESULT || '' } }
      : { provider: 'none' },
  };
}

// ---------- Players ----------
async function createPlayer(fields) {
  for (let i = 0; i < 6; i++) {
    const { data, error } = await db().from('players').insert({ nickname: randomNickname(), ...fields }).select('*').single();
    if (!error) return data;
    if (error.code !== '23505') { console.error(error); fail(500, 'Could not create player'); }
  }
  fail(500, 'Could not create player');
}

export async function createGuest(req) {
  rateLimit(`guest:${clientIp(req)}`, 30, 3600_000);
  const body = await readJson(req);
  const themes = sanitizeThemes(body.themes) || ['classic'];
  const free = themes.find((t) => t !== 'classic') || null;
  const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const player = await createPlayer({ themes, free_theme: free, free_theme_set_at: free ? new Date().toISOString() : null, market: marketFor(country) });
  return { token: signGuest(env('GUEST_SECRET'), player.id), playerId: player.id };
}

export async function getMe(req) {
  const id = await identify(req);
  let playerId = id.playerId;
  if (!playerId && id.user) {
    const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
    playerId = (await createPlayer({ user_id: id.user.id, market: marketFor(country) })).id;
  }
  const { player, subs, premium } = await loadPlayer(playerId);
  await db().from('players').update({ last_seen_at: new Date().toISOString() }).eq('id', playerId);
  const today = todayUTC();
  const attempts = must(await db().from('attempts')
    .select('status, mode, theme, daily_puzzles!inner(puzzle_date, difficulty)')
    .eq('player_id', playerId).eq('mode', 'daily').eq('daily_puzzles.puzzle_date', today));
  const todayStatus = {};
  for (const a of attempts) todayStatus[a.daily_puzzles.difficulty] = { status: a.status, theme: a.theme };
  const streaks = await streakData(playerId);
  const achievements = must(await db().from('achievements').select('code, earned_at').eq('player_id', playerId));
  const groups = must(await db().from('group_members').select('groups(id, name, code, owner_id)').eq('player_id', playerId))
    .map((g) => ({ ...g.groups, owner: g.groups.owner_id === playerId, owner_id: undefined }));
  const scoreAgg = must(await db().from('scores').select('time_ms').eq('player_id', playerId));
  const avgTimeMs = scoreAgg.length ? Math.round(scoreAgg.reduce((s, r) => s + r.time_ms, 0) / scoreAgg.length) : 0;
  let rank = null;
  const rankedToday = must(await db().from('scores').select('difficulty').eq('player_id', playerId).eq('puzzle_date', today).eq('ranked', true)).map((s) => s.difficulty);
  if (rankedToday.length) {
    const d = ['hard', 'medium', 'easy'].find((x) => rankedToday.includes(x));
    const rows = must(await db().rpc('leaderboard', { p_from: today, p_to: today, p_difficulty: d, p_theme: null, p_group: null, p_player: playerId, p_limit: 0 }));
    const mine = rows.find((r) => r.player_id === playerId);
    if (mine) rank = { difficulty: d, rank: Number(mine.rank), of: Number(mine.total_players) };
  }
  const nextThemeChange = player.free_theme_set_at ? addDays(player.free_theme_set_at.slice(0, 10), FREE_THEME_LOCK_DAYS) : null;
  return {
    player: {
      nickname: player.nickname, themes: player.themes, freeTheme: player.free_theme, market: player.market,
      marketingConsent: player.marketing_consent, isAccount: Boolean(player.user_id), email: id.user?.email || null,
      freeThemeChangeableFrom: nextThemeChange && nextThemeChange > today ? nextThemeChange : null,
    },
    premium,
    subscriptions: subs,
    isAdmin: id.isAdmin,
    today, todayStatus, rank,
    streak: { current: streaks.overall.current, best: streaks.overall.best, completedToday: streaks.overall.completedToday, missedDays: streaks.overall.missedDays },
    themeStreaks: streaks.themes,
    stats: { completed: streaks.total, avgTimeMs },
    achievements, groups,
  };
}

export async function updateMe(req) {
  const { playerId } = await requirePlayer(req);
  const body = await readJson(req);
  const { player } = await loadPlayer(playerId);
  const patch = {};
  if (body.nickname !== undefined) {
    if (!validNickname(body.nickname)) fail(400, 'Nicknames are 3–20 letters, numbers or underscores.');
    patch.nickname = body.nickname;
  }
  if (body.themes !== undefined) {
    const t = sanitizeThemes(body.themes);
    if (!t) fail(400, 'Choose between 1 and 3 themes.');
    patch.themes = t;
  }
  if (body.freeTheme !== undefined) {
    if (!THEMES.includes(body.freeTheme) || body.freeTheme === 'classic') fail(400, 'Invalid theme');
    if (body.freeTheme !== player.free_theme) {
      const today = todayUTC();
      if (player.free_theme_set_at && addDays(player.free_theme_set_at.slice(0, 10), FREE_THEME_LOCK_DAYS) > today) {
        fail(400, `You can change your free theme once every ${FREE_THEME_LOCK_DAYS} days.`);
      }
      patch.free_theme = body.freeTheme;
      patch.free_theme_set_at = new Date().toISOString();
    }
  }
  if (body.marketingConsent !== undefined) patch.marketing_consent = Boolean(body.marketingConsent);
  if (body.market !== undefined) {
    if (!MARKETS[body.market]) fail(400, 'Invalid market');
    patch.market = body.market;
  }
  if (Object.keys(patch).length) {
    const { error } = await db().from('players').update(patch).eq('id', playerId);
    if (error?.code === '23505') fail(409, 'That nickname is taken.');
    if (error) fail(500, 'Could not save');
  }
  return { ok: true };
}

// ---------- Puzzles & attempts ----------
function resolveDate(raw, premium) {
  const today = todayUTC();
  if (!raw || raw === today) return { date: today, mode: 'daily' };
  if (!isDateStr(raw) || raw > today || raw < EPOCH) fail(400, 'Invalid date');
  if (!premium) fail(403, 'The puzzle archive is part of HoluVantage All Themes.', { code: 'premium_required' });
  return { date: raw, mode: 'archive' };
}

async function attemptPayload(attempt, puzzle, playerId) {
  const out = {
    attempt: {
      id: attempt.id, status: attempt.status, mode: attempt.mode, theme: attempt.theme,
      startedAt: Date.parse(attempt.started_at), hintsUsed: attempt.hints_used,
      hints: attempt.hinted_cells.map((i) => ({ index: i, value: puzzle.solution[i] })),
    },
    puzzle: publicPuzzle(puzzle),
    serverNow: Date.now(),
  };
  if (attempt.status === 'completed') out.result = await resultFor(attempt, puzzle, playerId);
  return out;
}

export async function startAttempt(req) {
  const { playerId } = await requirePlayer(req);
  rateLimit(`start:${playerId}`, 60, 3600_000);
  const body = await readJson(req);
  if (!isValidDifficulty(body.difficulty)) fail(400, 'Invalid difficulty');
  const { player, premium } = await loadPlayer(playerId);
  const theme = body.theme || 'classic';
  if (!canPlayTheme(player, theme, premium)) fail(403, 'Unlock every theme with HoluVantage All Themes.', { code: 'premium_required' });
  const { date, mode } = resolveDate(body.date, premium);
  const puzzle = await ensureDailyPuzzle(date, body.difficulty);
  if (mode === 'daily') {
    const existing = must(await db().from('attempts').select('*').eq('player_id', playerId).eq('puzzle_id', puzzle.id).eq('mode', 'daily').maybeSingle());
    if (existing) return attemptPayload(existing, puzzle, playerId);
  }
  const { data, error } = await db().from('attempts').insert({ player_id: playerId, puzzle_id: puzzle.id, theme, mode }).select('*').single();
  if (error?.code === '23505') {
    const existing = must(await db().from('attempts').select('*').eq('player_id', playerId).eq('puzzle_id', puzzle.id).eq('mode', 'daily').single());
    return attemptPayload(existing, puzzle, playerId);
  }
  if (error) fail(500, 'Could not start');
  return attemptPayload(data, puzzle, playerId);
}

async function loadAttempt(playerId, attemptId) {
  if (typeof attemptId !== 'string' || !/^[0-9a-f-]{36}$/.test(attemptId)) fail(400, 'Invalid attempt');
  const attempt = must(await db().from('attempts').select('*').eq('id', attemptId).eq('player_id', playerId).maybeSingle());
  if (!attempt) fail(404, 'Attempt not found');
  const puzzle = must(await db().from('daily_puzzles').select('*').eq('id', attempt.puzzle_id).single());
  return { attempt, puzzle };
}

export async function useHint(req) {
  const { playerId } = await requirePlayer(req);
  const body = await readJson(req);
  const { attempt, puzzle } = await loadAttempt(playerId, body.attemptId);
  if (attempt.status !== 'started') fail(409, 'Puzzle already completed');
  const n = puzzle.size;
  const grid = body.grid;
  if (!Array.isArray(grid) || grid.length !== n * n || grid.some((v, i) => ![0, 1, 2].includes(v) || (puzzle.givens[i] && v !== puzzle.givens[i]))) fail(400, 'Invalid grid');
  const { premium } = await loadPlayer(playerId);
  let rewarded = attempt.rewarded_hints;
  if (body.rewarded && !premium) {
    if (process.env.ADS_PROVIDER !== 'adsense') fail(400, 'Rewarded hints are not available');
    if (rewarded >= REWARDED_HINTS) fail(403, 'No more rewarded hints for this puzzle.', { code: 'no_hints' });
    rewarded += 1;
  }
  if (attempt.hints_used >= hintAllowance(premium, rewarded)) fail(403, 'You have used your free hint for this puzzle.', { code: 'no_hints', canReward: rewarded < REWARDED_HINTS });
  const hint = chooseHint(puzzle.givens, puzzle.solution, grid, n, nextLogicalCell);
  if (!hint) fail(409, 'Nothing left to hint');
  const updated = must(await db().from('attempts').update({
    hints_used: attempt.hints_used + 1, rewarded_hints: rewarded,
    hinted_cells: [...new Set([...attempt.hinted_cells, hint.index])],
  }).eq('id', attempt.id).eq('hints_used', attempt.hints_used).eq('status', 'started').select('id'));
  if (!updated.length) fail(409, 'Please try again');
  return { hint, hintsUsed: attempt.hints_used + 1 };
}

async function resultFor(attempt, puzzle, playerId) {
  const score = must(await db().from('scores').select('*').eq('attempt_id', attempt.id).maybeSingle());
  if (!score) return null;
  const streaks = await streakData(playerId);
  const out = {
    score: score.score, timeMs: score.time_ms, mistakes: score.mistakes, hints: score.hints, ranked: score.ranked,
    rowFlags: score.row_flags, theme: score.theme, difficulty: score.difficulty, number: puzzle.puzzle_no, date: puzzle.puzzle_date,
    streak: streaks.overall.current, bestStreak: streaks.overall.best, themeStreak: streaks.themes[score.theme]?.current || 0,
    rank: null, percentile: null,
  };
  if (score.ranked) {
    const rows = must(await db().rpc('leaderboard', { p_from: score.puzzle_date, p_to: score.puzzle_date, p_difficulty: score.difficulty, p_theme: null, p_group: null, p_player: playerId, p_limit: 0 }));
    const mine = rows.find((r) => r.player_id === playerId);
    if (mine) {
      out.rank = Number(mine.rank); out.of = Number(mine.total_players);
      if (out.of >= 20) out.percentile = Math.max(1, Math.round(100 * (1 - (out.rank - 1) / out.of)));
    }
  }
  return out;
}

export async function submitAttempt(req) {
  const { playerId } = await requirePlayer(req);
  rateLimit(`submit:${playerId}`, 120, 3600_000);
  const body = await readJson(req);
  const { attempt, puzzle } = await loadAttempt(playerId, body.attemptId);
  if (attempt.status === 'completed') return { result: await resultFor(attempt, puzzle, playerId), duplicate: true };
  const replay = replayMoves({ givens: puzzle.givens, solution: puzzle.solution, size: puzzle.size }, body.moves, attempt.hinted_cells);
  if (!replay.ok) fail(400, replay.error);
  if (!replay.solved) fail(400, 'The puzzle is not solved yet.', { code: 'not_solved' });
  const now = Date.now();
  const { timeMs, plausible, score } = scoreAttempt({
    difficulty: puzzle.difficulty, givens: puzzle.givens, startedAt: Date.parse(attempt.started_at), now,
    mistakes: replay.mistakes, hints: attempt.hints_used,
  });
  const claimed = must(await db().from('attempts').update({ status: 'completed', completed_at: new Date(now).toISOString() })
    .eq('id', attempt.id).eq('status', 'started').select('id'));
  if (!claimed.length) {
    const fresh = must(await db().from('attempts').select('*').eq('id', attempt.id).single());
    return { result: await resultFor(fresh, puzzle, playerId), duplicate: true };
  }
  const ranked = attempt.mode === 'daily' && plausible;
  must(await db().from('scores').insert({
    attempt_id: attempt.id, player_id: playerId, puzzle_id: puzzle.id, puzzle_date: puzzle.puzzle_date,
    difficulty: puzzle.difficulty, theme: attempt.theme, score, time_ms: Math.min(timeMs, 2_000_000_000),
    mistakes: replay.mistakes, hints: attempt.hints_used, ranked, row_flags: replay.rowFlags,
  }), 'insert score');
  const streaks = await streakData(playerId);
  const have = must(await db().from('achievements').select('code').eq('player_id', playerId)).map((a) => a.code);
  const earned = newAchievements({
    have, totalCompleted: streaks.total, streak: streaks.overall.current, mistakes: replay.mistakes,
    hints: attempt.hints_used, timeMs, difficulty: puzzle.difficulty, themesPlayed: streaks.themesPlayed,
  });
  if (earned.length) await db().from('achievements').upsert(earned.map((code) => ({ player_id: playerId, code })), { ignoreDuplicates: true });
  const result = await resultFor({ ...attempt, status: 'completed' }, puzzle, playerId);
  return { result: { ...result, newAchievements: earned, unrankedReason: !ranked && attempt.mode === 'daily' ? 'too_fast' : null } };
}

// ---------- Leaderboards ----------
export async function getLeaderboard(req, query) {
  const id = await identify(req, { require: false });
  const period = query.period === 'weekly' ? 'weekly' : 'daily';
  const date = isDateStr(query.date) && query.date <= todayUTC() ? query.date : todayUTC();
  const difficulty = isValidDifficulty(query.difficulty) ? query.difficulty : null;
  const theme = THEMES.includes(query.theme) ? query.theme : null;
  let group = null;
  if (query.group) {
    if (!/^[0-9a-f-]{36}$/.test(query.group) || !id.playerId) fail(400, 'Invalid group');
    const member = must(await db().from('group_members').select('group_id').eq('group_id', query.group).eq('player_id', id.playerId).maybeSingle());
    if (!member) fail(403, 'Join this group to see its leaderboard.');
    group = query.group;
  }
  const from = period === 'weekly' ? weekStart(date) : date;
  const to = period === 'weekly' ? addDays(from, 6) : date;
  const rows = must(await db().rpc('leaderboard', { p_from: from, p_to: to, p_difficulty: difficulty, p_theme: theme, p_group: group, p_player: id.playerId, p_limit: 50 }));
  return {
    period, from, to, difficulty, theme,
    total: rows[0] ? Number(rows[0].total_players) : 0,
    rows: rows.map((r) => ({
      rank: Number(r.rank), nickname: r.nickname, score: Number(r.total_score), timeMs: Number(r.total_time),
      mistakes: Number(r.total_mistakes), plays: Number(r.plays), me: r.player_id === id.playerId,
    })),
  };
}

export async function getStats(req) {
  const { playerId } = await requirePlayer(req);
  const { premium } = await loadPlayer(playerId);
  const stats = must(await db().rpc('player_stats', { p_player: playerId }));
  if (premium) return { premium, stats };
  return { premium, stats: { completed: stats.completed, avg_time_ms: stats.avg_time_ms, recent: stats.recent.slice(0, 5) } };
}

// ---------- Groups (classroom / team leaderboards) ----------
export async function createGroup(req) {
  const { playerId } = await requirePlayer(req);
  const body = await readJson(req);
  const name = String(body.name || '').trim();
  if (name.length < 3 || name.length > 40 || /[<>]/.test(name)) fail(400, 'Group names are 3–40 characters.');
  const owned = must(await db().from('groups').select('id').eq('owner_id', playerId));
  if (owned.length >= 10) fail(400, 'You can own up to 10 groups.');
  for (let i = 0; i < 5; i++) {
    const code = crypto.randomBytes(4).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase().padEnd(6, 'X');
    const { data, error } = await db().from('groups').insert({ code, name, owner_id: playerId }).select('id, code, name').single();
    if (!error) {
      must(await db().from('group_members').insert({ group_id: data.id, player_id: playerId }));
      return data;
    }
    if (error.code !== '23505') fail(500, 'Could not create group');
  }
  fail(500, 'Could not create group');
}

export async function joinGroup(req) {
  const { playerId } = await requirePlayer(req);
  rateLimit(`join:${playerId}`, 20, 3600_000);
  const body = await readJson(req);
  const code = String(body.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) fail(400, 'Group codes are 6 letters or numbers.');
  const group = must(await db().from('groups').select('id, name, code').eq('code', code).maybeSingle());
  if (!group) fail(404, 'No group with that code.');
  await db().from('group_members').upsert({ group_id: group.id, player_id: playerId }, { ignoreDuplicates: true });
  return group;
}

export async function leaveGroup(req) {
  const { playerId } = await requirePlayer(req);
  const body = await readJson(req);
  if (!/^[0-9a-f-]{36}$/.test(String(body.groupId))) fail(400, 'Invalid group');
  const group = must(await db().from('groups').select('owner_id').eq('id', body.groupId).maybeSingle());
  if (!group) fail(404, 'Group not found');
  if (group.owner_id === playerId) must(await db().from('groups').delete().eq('id', body.groupId));
  else must(await db().from('group_members').delete().eq('group_id', body.groupId).eq('player_id', playerId));
  return { ok: true };
}

// ---------- Account: claim, export, delete ----------
export async function claimGuest(req) {
  const id = await identify(req);
  if (!id.user) fail(401, 'Sign in first');
  const body = await readJson(req);
  const guestId = verifyGuest(env('GUEST_SECRET'), body.guestToken);
  if (!guestId) fail(400, 'Invalid guest session');
  const guest = must(await db().from('players').select('*').eq('id', guestId).maybeSingle());
  if (!guest || guest.user_id) return { merged: false };
  if (!id.playerId) {
    must(await db().from('players').update({ user_id: id.user.id }).eq('id', guestId).is('user_id', null));
    return { merged: true, mode: 'attached' };
  }
  const accountId = id.playerId;
  const guestScores = must(await db().from('scores').select('id, attempt_id, puzzle_id, score').eq('player_id', guestId).eq('ranked', true));
  const accountScores = must(await db().from('scores').select('id, attempt_id, puzzle_id, score').eq('player_id', accountId).eq('ranked', true));
  const plan = mergePlan(guestScores, accountScores);
  const attemptOf = (list, ids) => list.filter((s) => ids.includes(s.id)).map((s) => s.attempt_id);
  const dropAttempts = [...attemptOf(guestScores, plan.dropGuestScoreIds), ...attemptOf(accountScores, plan.dropAccountScoreIds)];
  if (dropAttempts.length) must(await db().from('attempts').delete().in('id', dropAttempts));
  // Unfinished guest daily attempts that clash with the account's attempts are dropped.
  const accountDaily = must(await db().from('attempts').select('puzzle_id').eq('player_id', accountId).eq('mode', 'daily')).map((a) => a.puzzle_id);
  if (accountDaily.length) must(await db().from('attempts').delete().eq('player_id', guestId).eq('mode', 'daily').in('puzzle_id', accountDaily));
  must(await db().from('attempts').update({ player_id: accountId }).eq('player_id', guestId));
  must(await db().from('scores').update({ player_id: accountId }).eq('player_id', guestId));
  const ach = must(await db().from('achievements').select('code, earned_at').eq('player_id', guestId));
  if (ach.length) await db().from('achievements').upsert(ach.map((a) => ({ ...a, player_id: accountId })), { ignoreDuplicates: true });
  const groups = must(await db().from('group_members').select('group_id').eq('player_id', guestId));
  if (groups.length) await db().from('group_members').upsert(groups.map((g) => ({ group_id: g.group_id, player_id: accountId })), { ignoreDuplicates: true });
  await db().from('groups').update({ owner_id: accountId }).eq('owner_id', guestId);
  await db().from('analytics_events').update({ player_id: accountId }).eq('player_id', guestId);
  await db().from('reports').update({ player_id: accountId }).eq('player_id', guestId);
  const account = must(await db().from('players').select('themes, free_theme').eq('id', accountId).single());
  const patch = {};
  if (account.themes.length === 1 && account.themes[0] === 'classic' && guest.themes.length) patch.themes = guest.themes;
  if (!account.free_theme && guest.free_theme) { patch.free_theme = guest.free_theme; patch.free_theme_set_at = guest.free_theme_set_at; }
  if (Object.keys(patch).length) must(await db().from('players').update(patch).eq('id', accountId));
  must(await db().from('players').delete().eq('id', guestId));
  return { merged: true, mode: 'merged' };
}

export async function exportData(req) {
  const { playerId, user } = await requirePlayer(req);
  const q = (t, cols = '*') => db().from(t).select(cols).eq('player_id', playerId).then((r) => must(r));
  const player = must(await db().from('players').select('nickname, themes, free_theme, market, marketing_consent, created_at, last_seen_at').eq('id', playerId).single());
  return {
    exportedAt: new Date().toISOString(), email: user?.email || null, player,
    attempts: await q('attempts', 'id, theme, mode, status, started_at, completed_at, hints_used'),
    scores: await q('scores', 'puzzle_date, difficulty, theme, score, time_ms, mistakes, hints, ranked, created_at'),
    achievements: await q('achievements', 'code, earned_at'),
    subscriptions: await q('subscriptions', 'provider, plan, status, currency, current_period_end, created_at'),
    payments: await q('payments', 'provider, amount_minor, currency, status, created_at'),
    groups: await q('group_members', 'joined_at, groups(name)'),
    analyticsEvents: await q('analytics_events', 'event, props, created_at'),
  };
}

export async function deleteAccount(req) {
  const id = await identify(req);
  if (id.playerId) {
    await cancelAllSubscriptions(id.playerId);
    must(await db().from('players').delete().eq('id', id.playerId));
  }
  if (id.user) {
    const { error } = await db().auth.admin.deleteUser(id.user.id);
    if (error) { console.error(error); fail(500, 'Your game data was deleted, but the sign-in record could not be removed. Please report this.'); }
  }
  return { ok: true };
}

// ---------- Analytics & reports ----------
const EVENTS = new Set(['game_started', 'game_completed', 'game_abandoned', 'hint_used', 'share_clicked', 'share_completed',
  'theme_selected', 'leaderboard_viewed', 'subscription_started', 'subscription_cancelled', 'ad_impression',
  'rewarded_ad_started', 'rewarded_ad_completed', 'endless_started', 'endless_completed', 'install_prompted']);

export async function trackEvent(req) {
  rateLimit(`event:${clientIp(req)}`, 120, 60_000);
  const body = await readJson(req);
  if (!EVENTS.has(body.event)) fail(400, 'Unknown event');
  const props = body.props && typeof body.props === 'object' && !Array.isArray(body.props) ? body.props : {};
  if (JSON.stringify(props).length > 1000) fail(400, 'Props too large');
  const id = await identify(req, { require: false }).catch(() => ({}));
  must(await db().from('analytics_events').insert({ player_id: id.playerId || null, event: body.event, props }));
  return { ok: true };
}

export async function createReport(req) {
  rateLimit(`report:${clientIp(req)}`, 5, 3600_000);
  const body = await readJson(req);
  const message = String(body.message || '').trim();
  if (message.length < 3 || message.length > 1000) fail(400, 'Please write between 3 and 1000 characters.');
  const id = await identify(req, { require: false }).catch(() => ({}));
  const puzzleId = Number.isInteger(body.puzzleId) ? body.puzzleId : null;
  must(await db().from('reports').insert({ player_id: id.playerId || null, puzzle_id: puzzleId, message }));
  return { ok: true };
}
