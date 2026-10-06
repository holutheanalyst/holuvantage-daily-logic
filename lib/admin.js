// Admin-only handlers. Access requires a signed-in, email-confirmed account listed in ADMIN_EMAILS.
import { validatePuzzle, SIZES } from '../public/js/engine.js';
import { DIFFICULTIES } from '../public/js/engine.js';
import { todayUTC, addDays, isDateStr } from './core.js';
import { db, must, fail, identify, readJson } from './server.js';
import { ensureDailyPuzzle } from './game.js';

async function requireAdmin(req) {
  const id = await identify(req);
  if (!id.isAdmin) fail(403, 'Admins only');
  return id;
}

export async function metrics(req) {
  await requireAdmin(req);
  return must(await db().rpc('admin_metrics'));
}

export async function listPuzzles(req, query) {
  await requireAdmin(req);
  const today = todayUTC();
  const from = isDateStr(query.from) ? query.from : addDays(today, -7);
  const to = isDateStr(query.to) ? query.to : addDays(today, 14);
  const puzzles = must(await db().from('daily_puzzles').select('id, puzzle_date, difficulty, version, puzzle_no, level, status, disabled_reason, created_at')
    .gte('puzzle_date', from).lte('puzzle_date', to).order('puzzle_date', { ascending: false }).order('difficulty'));
  const ids = puzzles.map((p) => p.id);
  const attempts = ids.length ? must(await db().from('attempts').select('puzzle_id, status').in('puzzle_id', ids)) : [];
  const health = {};
  for (const a of attempts) {
    const h = (health[a.puzzle_id] ||= { started: 0, completed: 0 });
    h.started++; if (a.status === 'completed') h.completed++;
  }
  const reports = ids.length ? must(await db().from('reports').select('puzzle_id').in('puzzle_id', ids).eq('status', 'open')) : [];
  const reportCount = {};
  for (const r of reports) reportCount[r.puzzle_id] = (reportCount[r.puzzle_id] || 0) + 1;
  return {
    from, to,
    puzzles: puzzles.map((p) => {
      const h = health[p.id] || { started: 0, completed: 0 };
      return { ...p, started: h.started, completed: h.completed, completionRate: h.started ? Math.round((100 * h.completed) / h.started) : null, openReports: reportCount[p.id] || 0 };
    }),
  };
}

export async function generateFuture(req) {
  await requireAdmin(req);
  const body = await readJson(req);
  const days = Math.min(Math.max(parseInt(body.days, 10) || 7, 1), 31);
  const today = todayUTC();
  const created = [];
  for (let i = 0; i < days; i++) {
    for (const d of DIFFICULTIES) {
      const p = await ensureDailyPuzzle(addDays(today, i), d);
      created.push({ date: p.puzzle_date, difficulty: d, id: p.id });
    }
  }
  return { generated: created.length, created };
}

async function loadPuzzle(id) {
  if (!Number.isInteger(id)) fail(400, 'Invalid puzzle id');
  const p = must(await db().from('daily_puzzles').select('*').eq('id', id).maybeSingle());
  if (!p) fail(404, 'Puzzle not found');
  return p;
}

export async function validate(req) {
  await requireAdmin(req);
  const body = await readJson(req);
  const p = await loadPuzzle(body.id);
  const result = validatePuzzle({ n: p.size, difficulty: p.difficulty, givens: p.givens, solution: p.solution });
  return { id: p.id, ok: result.ok, errors: result.errors, level: result.level, expectedSize: SIZES[p.difficulty] };
}

export async function disable(req) {
  await requireAdmin(req);
  const body = await readJson(req);
  const p = await loadPuzzle(body.id);
  const reason = String(body.reason || 'Disabled by admin').slice(0, 200);
  must(await db().from('daily_puzzles').update({ status: 'disabled', disabled_reason: reason }).eq('id', p.id));
  return { ok: true };
}

export async function replace(req) {
  await requireAdmin(req);
  const body = await readJson(req);
  const p = await loadPuzzle(body.id);
  if (p.status === 'active') {
    must(await db().from('daily_puzzles').update({ status: 'disabled', disabled_reason: String(body.reason || 'Replaced by admin').slice(0, 200) }).eq('id', p.id));
  }
  const fresh = await ensureDailyPuzzle(p.puzzle_date, p.difficulty);
  const check = validatePuzzle({ n: fresh.size, difficulty: fresh.difficulty, givens: fresh.givens, solution: fresh.solution });
  return { ok: check.ok, replacement: { id: fresh.id, version: fresh.version } };
}

export async function listReports(req) {
  await requireAdmin(req);
  return { reports: must(await db().from('reports').select('id, puzzle_id, message, status, created_at').order('created_at', { ascending: false }).limit(200)) };
}

export async function updateReport(req) {
  await requireAdmin(req);
  const body = await readJson(req);
  if (!/^[0-9a-f-]{36}$/.test(String(body.id)) || !['open', 'resolved'].includes(body.status)) fail(400, 'Invalid request');
  must(await db().from('reports').update({ status: body.status }).eq('id', body.id));
  return { ok: true };
}
