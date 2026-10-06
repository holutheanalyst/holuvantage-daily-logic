// Admin console: metrics, puzzle health and reports. Server enforces admin access on every call.
import { api, signedIn, esc, fmtTime, fmtMoney } from './api.js';

const root = document.getElementById('admin');
const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);

async function load() {
  if (!signedIn()) { root.innerHTML = '<div class="card"><p>Sign in with an admin account first.</p><a class="btn primary" href="/#/account">Sign in</a></div>'; return; }
  root.innerHTML = '<div class="loading">Loading…</div>';
  let m, pz, rp;
  try { [m, pz, rp] = await Promise.all([api('admin/metrics'), api('admin/puzzles'), api('admin/reports')]); }
  catch (e) { root.innerHTML = `<div class="card error"><p>${esc(e.message)}</p></div>`; return; }
  const maxDau = Math.max(1, ...m.dau.map((d) => d.players));
  root.innerHTML = `
  <section class="card"><h1>Admin</h1>
    <dl class="result-stats">
      <div><dt>DAU today</dt><dd>${m.dau.at(-1)?.players ?? 0}</dd></div>
      <div><dt>MAU</dt><dd>${m.mau}</dd></div>
      <div><dt>Players</dt><dd>${m.players_total}</dd></div>
      <div><dt>Accounts</dt><dd>${m.accounts_total}</dd></div>
      <div><dt>Completion</dt><dd>${pct(m.completion_rate_30d)}</dd></div>
      <div><dt>Open reports</dt><dd>${m.open_reports}</dd></div>
    </dl>
    <h2>Daily active players (30 days)</h2>
    <div class="dau" role="img" aria-label="Daily active players for the last 30 days">${m.dau.map((d) => `<span title="${d.d}: ${d.players}" style="height:${(100 * d.players) / maxDau}%"></span>`).join('') || '<p class="muted">No data yet.</p>'}</div>
    <div class="grid-2">
      <div><h3>Retention</h3><dl class="kv"><dt>Day 1</dt><dd>${pct(m.retention.d1)}</dd><dt>Day 7</dt><dd>${pct(m.retention.d7)}</dd><dt>Day 30</dt><dd>${pct(m.retention.d30)}</dd></dl>
        <h3>Engagement (30 days)</h3><dl class="kv"><dt>Sessions per player</dt><dd>${m.sessions_per_player_30d ?? '—'}</dd><dt>Share rate</dt><dd>${pct(m.share_rate_30d)}</dd><dt>Hints per solve</dt><dd>${m.hint_usage_30d ?? '—'}</dd>
        ${Object.entries(m.avg_time_ms).map(([k, v]) => `<dt>Avg time ${k}</dt><dd>${fmtTime(v)}</dd>`).join('')}</dl></div>
      <div><h3>Theme popularity (30 days)</h3><dl class="kv">${Object.entries(m.theme_popularity).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('') || '<dt>—</dt><dd></dd>'}</dl>
        <h3>Subscriptions</h3><dl class="kv"><dt>Conversion</dt><dd>${pct(m.subscription_conversion)}</dd>${Object.entries(m.subscriptions_active).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
        <h3>Revenue (30 days)</h3><dl class="kv">${Object.entries(m.revenue_30d).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${fmtMoney(v, k)}</dd>`).join('') || '<dt>None yet</dt><dd></dd>'}</dl></div>
    </div>
    <p class="small muted">Month-3 targets: 5,000 daily players and Day-7 retention of 20% or more. Below that, flag the product for review.</p>
  </section>
  <section class="card"><h2>Puzzle health</h2>
    <form class="inline-form" data-gen><label class="field">Generate upcoming days <input type="number" name="days" min="1" max="31" value="7"></label><button class="btn">Generate</button></form>
    <p class="hint-text" role="status" data-msg></p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table class="board-table"><thead><tr><th>Date</th><th>Difficulty</th><th>#</th><th>v</th><th>Status</th><th>Started</th><th>Done</th><th>Reports</th><th>Actions</th></tr></thead>
    <tbody>${pz.puzzles.map((p) => `<tr><td>${p.puzzle_date}</td><td>${p.difficulty}</td><td>${p.puzzle_no}</td><td>${p.version}</td>
      <td>${p.status}${p.disabled_reason ? ` <span class="small muted">(${esc(p.disabled_reason)})</span>` : ''}</td><td>${p.started}</td><td>${pct(p.completionRate)}</td><td>${p.openReports}</td>
      <td><button class="btn small" data-act="validate" data-id="${p.id}">Validate</button>${p.status === 'active' ? ` <button class="btn small" data-act="replace" data-id="${p.id}">Replace</button> <button class="btn small danger" data-act="disable" data-id="${p.id}">Disable</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
  </section>
  <section class="card"><h2>Reported issues</h2>
    ${rp.reports.length ? `<ul class="group-list">${rp.reports.map((r) => `<li><span class="small muted">${new Date(r.created_at).toLocaleString()}${r.puzzle_id ? ` · puzzle ${r.puzzle_id}` : ''} · ${r.status}</span><br>${esc(r.message)}
      <button class="btn small" data-report="${r.id}" data-status="${r.status === 'open' ? 'resolved' : 'open'}">${r.status === 'open' ? 'Resolve' : 'Reopen'}</button></li>`).join('')}</ul>` : '<p class="muted">No reports.</p>'}
  </section>`;
  const msg = root.querySelector('[data-msg]');
  root.querySelector('[data-gen]').addEventListener('submit', async (e) => {
    e.preventDefault(); msg.textContent = 'Generating…';
    try { const r = await api('admin/puzzles/generate', { method: 'POST', body: { days: Number(e.target.days.value) } }); msg.textContent = `${r.generated} puzzles ready.`; setTimeout(load, 800); }
    catch (x) { msg.textContent = x.message; }
  });
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.act, id = Number(b.dataset.id);
    if (act !== 'validate' && b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirm'; return; }
    try {
      const r = await api(`admin/puzzles/${act}`, { method: 'POST', body: { id } });
      msg.textContent = act === 'validate' ? (r.ok ? `Puzzle ${id} is valid (level ${r.level}).` : `Puzzle ${id} failed: ${r.errors.join(', ')}`) : `Done: ${act} puzzle ${id}.`;
      if (act !== 'validate') setTimeout(load, 800);
    } catch (x) { msg.textContent = x.message; }
  }));
  root.querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('admin/reports', { method: 'PATCH', body: { id: b.dataset.report, status: b.dataset.status } }); load(); }
    catch (x) { msg.textContent = x.message; }
  }));
}
load();
