// HoluVantage Daily Logic — single-page app.
import {
  store, loadConfig, api, ApiError, ensureGuest, hasIdentity, signedIn, sendMagicLink, consumeAuthRedirect,
  claimGuestProgress, signOut, consent, setConsent, track, showAd, rewardedAvailable, showRewarded,
  fmtTime, fmtMoney, esc, serverNow,
} from './api.js';
import { Board } from './board.js';
import { THEMES, THEME_ORDER, tileSvg, applyTheme } from './themes.js';
import { resultText, renderShare } from './share.js';

const app = document.getElementById('app');
const DIFFS = ['easy', 'medium', 'hard'];
const DIFF_INFO = { easy: '6 × 6 · gentle', medium: '8 × 8 · steady', hard: '10 × 10 · deep thinking' };
const ACH = {
  first_solve: ['First solve', 'Completed your first daily puzzle'],
  streak_3: ['On a roll', '3 day streak'], streak_7: ['Week strong', '7 day streak'], streak_30: ['Unbreakable', '30 day streak'],
  flawless: ['Flawless', 'Solved with no mistakes or hints'], speedster: ['Speedster', 'Hard puzzle under 3 minutes, no mistakes'],
  all_themes: ['Explorer', 'Played every theme'],
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
let cfg = null;
let me = null;
let cleanup = null;
let installPrompt = null;
let flash = null; // one-off message for the next view

// ---------- Helpers ----------
function view(html) {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  app.innerHTML = html;
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  if (flash) {
    const box = app.querySelector('[data-flash]');
    if (box) { box.textContent = flash; box.hidden = false; }
    flash = null;
  }
}
const qs = (sel, root = app) => root.querySelector(sel);
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
const playable = (theme) => me && (me.premium || theme === 'classic' || me.player.freeTheme === theme);
function currentTheme() {
  const t = store.get('theme');
  if (t && THEMES[t] && playable(t)) return t;
  return me?.player.freeTheme && playable(me.player.freeTheme) ? me.player.freeTheme : 'classic';
}
const puzzleDateLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
function nextResetLabel() {
  const now = new Date(serverNow());
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function errorCard(e, retry = true) {
  return `<div class="card error" role="alert"><h2>Something went wrong</h2><p>${esc(e.message || e)}</p>
    ${retry ? '<button class="btn primary" data-retry>Try again</button>' : ''}</div>`;
}
function bindRetry() { qs('[data-retry]')?.addEventListener('click', () => route()); }

async function loadMe(force = false) {
  if (me && !force) return me;
  try { me = await api('me'); }
  catch (e) {
    if (e.status === 401) { me = null; return null; }
    throw e;
  }
  applyTheme(currentTheme());
  return me;
}

function premiumNote(text) {
  return `<div class="card upsell"><p>${text}</p><a class="btn primary" href="#/pricing">See All Themes</a></div>`;
}

// ---------- Onboarding ----------
function viewOnboarding(step = 1) {
  if (step === 1) {
    view(`<section class="onboard card">
      <div class="brand-mark big" aria-hidden="true"><span class="tile-a">${tileSvg('classic', 'a', 28)}</span><span class="tile-b">${tileSvg('classic', 'b', 28)}</span><span class="tile-b">${tileSvg('classic', 'b', 28)}</span><span class="tile-a">${tileSvg('classic', 'a', 28)}</span></div>
      <h1>Welcome to HoluVantage Daily Logic</h1>
      <p class="lead">One daily logic puzzle. Choose your theme. Build your streak.</p>
      <ul class="ticks"><li>Fill the grid with two kinds of tile.</li><li>Balance every row and column.</li><li>A fresh puzzle every day, for everyone.</li></ul>
      <button class="btn primary big" data-next>Get started</button>
      <p class="muted">Already play on another device? <a href="#/account">Sign in</a></p>
    </section>`);
    qs('[data-next]').addEventListener('click', () => viewOnboarding(2));
    return;
  }
  const chosen = new Set(['classic']);
  view(`<section class="onboard card">
    <h1>Choose what you enjoy.</h1>
    <p class="lead">You’ll get a daily puzzle based on your interests. Pick 1 to 3.</p>
    <div class="theme-grid" role="group" aria-label="Interests">
      ${THEME_ORDER.map((t) => `<button type="button" class="theme-card" data-theme-pick="${t}" aria-pressed="${chosen.has(t)}" style="--a:${THEMES[t].a.bg};--af:${THEMES[t].a.fg};--b:${THEMES[t].b.bg};--bf:${THEMES[t].b.fg}">
        <span class="tc-tiles" aria-hidden="true"><span class="ta">${tileSvg(t, 'a', 22)}</span><span class="tb">${tileSvg(t, 'b', 22)}</span></span>
        <strong>${THEMES[t].name}</strong><span class="muted small">${THEMES[t].tagline}</span></button>`).join('')}
    </div>
    <p class="muted small">Free play includes Classic plus your first other pick. Every theme uses the same daily grid.</p>
    <p class="form-error" role="alert" data-err hidden></p>
    <button class="btn primary big" data-start>Play today’s puzzle</button>
  </section>`);
  app.querySelectorAll('[data-theme-pick]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.themePick;
    if (chosen.has(t)) { if (chosen.size > 1) chosen.delete(t); }
    else if (chosen.size < 3) chosen.add(t);
    app.querySelectorAll('[data-theme-pick]').forEach((x) => x.setAttribute('aria-pressed', String(chosen.has(x.dataset.themePick))));
  }));
  qs('[data-start]').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    const themes = THEME_ORDER.filter((t) => chosen.has(t));
    try {
      if (hasIdentity()) await api('me', { method: 'PATCH', body: { themes } });
      else await ensureGuest(themes);
      themes.forEach((t) => track('theme_selected', { theme: t, source: 'onboarding' }));
      store.set('onboarded', true);
      store.set('theme', themes.find((t) => t !== 'classic') || 'classic');
      await loadMe(true);
      go('#/play?d=easy');
    } catch (e) {
      const err = qs('[data-err]'); err.textContent = e.message; err.hidden = false; ev.target.disabled = false;
    }
  });
}

// ---------- Home ----------
async function viewHome() {
  if (!hasIdentity()) return store.get('onboarded') ? viewOnboarding(2) : viewOnboarding(1);
  view('<div class="loading" aria-busy="true">Loading today’s puzzle…</div>');
  try { await loadMe(true); } catch (e) { view(errorCard(e)); return bindRetry(); }
  if (!me) return viewOnboarding(1);
  const theme = currentTheme();
  const t = THEMES[theme];
  const status = me.todayStatus;
  const next = DIFFS.find((d) => status[d]?.status !== 'completed');
  const preferred = store.get('difficulty');
  const primary = preferred && status[preferred]?.status !== 'completed' ? preferred : next;
  const doneAny = DIFFS.some((d) => status[d]?.status === 'completed');
  const number = Math.round((Date.parse(`${me.today}T00:00:00Z`) - Date.parse(`${cfg.epoch}T00:00:00Z`)) / 86400000) + 1;
  view(`
    <p class="flash" data-flash hidden role="status"></p>
    <section class="hero card">
      <p class="eyebrow">Today’s puzzle · #${number} · ${puzzleDateLabel(me.today)}</p>
      <h1>One puzzle. One theme. One daily challenge.</h1>
      <p class="lead">Playing in <strong>${t.name}</strong>. ${me.streak.current ? `You’re on a ${me.streak.current} day streak — keep it going.` : 'Solve today to start a streak.'}</p>
      ${primary
        ? `<a class="btn primary big" href="#/play?d=${primary}">${status[primary]?.status === 'started' ? 'Resume' : 'Play Today’s Puzzle'} <span class="btn-sub">${cap(primary)}</span></a>`
        : `<p class="done-today">All three puzzles solved today. New puzzles at ${nextResetLabel()} your time.</p>`}
      <div class="diff-row">
        ${DIFFS.map((d) => {
          const s = status[d]?.status;
          return `<a class="diff ${s || ''}" href="#/play?d=${d}"><strong>${cap(d)}</strong><span class="small muted">${DIFF_INFO[d]}</span>
            <span class="badge">${s === 'completed' ? '✓ Solved' : s === 'started' ? 'In progress' : 'Play'}</span></a>`;
        }).join('')}
      </div>
    </section>
    <section class="grid-2">
      <div class="card stat-card">
        <h2>Streak</h2>
        <div class="big-num" data-streak>${me.streak.current}<span> day${me.streak.current === 1 ? '' : 's'}</span></div>
        <p class="muted">Your best streak is ${me.streak.best} day${me.streak.best === 1 ? '' : 's'}.</p>
        ${Object.keys(me.themeStreaks).length ? `<ul class="theme-streaks">${Object.entries(me.themeStreaks).map(([k, v]) => `<li><span class="dot" style="background:${THEMES[k].a.bg}"></span>${THEMES[k].name}: ${v.current} day${v.current === 1 ? '' : 's'}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="card stat-card">
        <h2>Your play</h2>
        <dl class="kv">
          <dt>Completed</dt><dd>${me.stats.completed}</dd>
          <dt>Average time</dt><dd>${me.stats.completed ? fmtTime(me.stats.avgTimeMs) : '—'}</dd>
          <dt>Today’s rank</dt><dd>${me.rank ? `#${me.rank.rank} of ${me.rank.of} (${cap(me.rank.difficulty)})` : 'Solve to get ranked'}</dd>
          <dt>Themes</dt><dd>${me.player.themes.map((x) => THEMES[x].name).join(', ')}</dd>
        </dl>
      </div>
    </section>
    <nav class="quick card" aria-label="More">
      <a href="#/themes" class="quick-link">Choose Theme</a>
      <a href="#/leaderboard" class="quick-link">Leaderboard</a>
      <a href="/how-to-play" class="quick-link">How to Play</a>
      <a href="#/stats" class="quick-link">My Stats</a>
      ${doneAny ? `<a href="#/play?d=${DIFFS.find((d) => status[d]?.status === 'completed')}" class="quick-link">Share Result</a>` : ''}
      <a href="#/archive" class="quick-link">Archive${me.premium ? '' : ' 🔒'}</a>
      <a href="/endless" class="quick-link">Endless Logic</a>
      ${installPrompt ? '<button type="button" class="quick-link" data-install>Install app</button>' : ''}
    </nav>
    <div class="ad-slot" data-ad hidden></div>`);
  qs('[data-install]')?.addEventListener('click', doInstall);
  showAd('home', qs('[data-ad]'), { premium: me.premium });
}

async function doInstall() {
  if (!installPrompt) return;
  installPrompt.prompt();
  track('install_prompted');
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  route();
}

// ---------- Theme chooser ----------
async function viewThemes() {
  if (!hasIdentity()) return viewOnboarding(1);
  await loadMe();
  const cur = currentTheme();
  view(`<section class="card">
    <h1>Choose your theme</h1>
    <p class="lead">Every theme uses the same daily grid and rules. Pick the look you enjoy.</p>
    <p class="flash" data-flash hidden role="status"></p>
    <div class="theme-grid">
      ${THEME_ORDER.map((t) => {
        const ok = playable(t);
        const canClaim = !ok && !me.premium && !me.player.freeTheme;
        return `<button type="button" class="theme-card ${ok ? '' : 'locked'}" data-pick="${t}" aria-pressed="${t === cur}" style="--a:${THEMES[t].a.bg};--af:${THEMES[t].a.fg};--b:${THEMES[t].b.bg};--bf:${THEMES[t].b.fg}">
          <span class="tc-tiles" aria-hidden="true"><span class="ta">${tileSvg(t, 'a', 22)}</span><span class="tb">${tileSvg(t, 'b', 22)}</span></span>
          <strong>${THEMES[t].name}${ok ? '' : ' 🔒'}</strong><span class="muted small">${ok ? THEMES[t].tagline : canClaim ? 'Choose as your free theme' : 'Included in All Themes'}</span></button>`;
      }).join('')}
    </div>
    <p class="form-error" role="alert" data-err hidden></p>
    ${me.premium ? '' : `<p class="muted small">Free play: Classic plus one free theme${me.player.freeTheme ? ` (yours is ${THEMES[me.player.freeTheme].name})` : ''}. You can switch your free theme once a week in <a href="#/account">Account</a>.</p>`}
  </section>`);
  app.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
    const t = b.dataset.pick;
    const err = qs('[data-err]');
    if (!playable(t)) {
      if (!me.premium && !me.player.freeTheme) {
        try { await api('me', { method: 'PATCH', body: { freeTheme: t } }); await loadMe(true); }
        catch (e) { err.textContent = e.message; err.hidden = false; return; }
      } else return go('#/pricing');
    }
    store.set('theme', t);
    applyTheme(t);
    track('theme_selected', { theme: t, source: 'picker' });
    flash = `${THEMES[t].name} selected.`;
    go('#/');
  }));
}

// ---------- Play ----------
async function viewPlay(params) {
  const difficulty = DIFFS.includes(params.d) ? params.d : 'easy';
  const date = params.date || null;
  if (!hasIdentity()) { await ensureGuest(['classic']).catch(() => {}); if (!hasIdentity()) return viewOnboarding(1); }
  view('<div class="loading" aria-busy="true">Preparing your puzzle…</div>');
  let data;
  try {
    await loadMe();
    store.set('difficulty', difficulty);
    data = await api('attempt/start', { method: 'POST', body: { difficulty, theme: currentTheme(), date } });
  } catch (e) {
    if (e.body?.code === 'premium_required') { view(premiumNote(esc(e.message))); return; }
    view(errorCard(e)); return bindRetry();
  }
  const { attempt, puzzle } = data;
  const theme = attempt.theme;
  applyTheme(theme);
  if (attempt.status === 'completed' && data.result) return viewResult(data.result, puzzle, { already: true });
  const offset = data.serverNow - Date.now();
  const movesKey = `moves.${attempt.id}`;
  const saved = store.get(movesKey, []);
  const isArchive = attempt.mode === 'archive';
  view(`<section class="play">
    <header class="play-head">
      <div><span class="eyebrow">${isArchive ? 'Archive' : 'Daily'} #${puzzle.number} · ${puzzleDateLabel(puzzle.date)}</span>
        <h1 class="play-title">${THEMES[theme].name} · ${cap(difficulty)}</h1></div>
      <dl class="play-stats">
        <div><dt>Time</dt><dd data-timer>00:00</dd></div>
        <div><dt>Conflicts</dt><dd data-conf>0</dd></div>
        <div><dt>Streak</dt><dd>${me?.streak.current ?? 0}</dd></div>
      </dl>
    </header>
    <details class="rules"><summary>How to play</summary>
      <ol><li>Fill every square with a ${esc(THEMES[theme].a.label.toLowerCase())} or a ${esc(THEMES[theme].b.label.toLowerCase())}.</li>
      <li>Each row and column has the same number of each.</li>
      <li>No more than two of the same tile side by side.</li>
      <li>No two rows (or two columns) can be identical.</li></ol>
      <p class="small muted">Tap a square to cycle tiles, or choose a tile below. Keyboard: arrows to move, 1 and 2 to place, 0 to clear, Ctrl+Z to undo. Mistakes are counted when you finish.</p>
    </details>
    <div data-board></div>
    <div class="controls">
      <button type="button" class="btn" data-undo>Undo</button>
      <button type="button" class="btn" data-reset>Reset</button>
      <button type="button" class="btn" data-hint>Hint${me?.premium ? '' : ` (${Math.max(0, 1 - attempt.hintsUsed)} left)`}</button>
    </div>
    <div class="reset-confirm" data-reset-confirm hidden>
      <span>Clear all your tiles?</span><button type="button" class="btn danger" data-reset-yes>Clear</button><button type="button" class="btn ghost" data-reset-no>Keep</button>
    </div>
    <p class="hint-text" role="status" data-msg></p>
    <div data-reward hidden></div>
  </section>`);
  let finished = false;
  const board = new Board({
    root: qs('[data-board]'), size: puzzle.size, givens: puzzle.givens, theme, moves: saved, hints: attempt.hints,
    onChange: (_g, moves) => store.set(movesKey, moves),
    onConflicts: (n) => { const el = qs('[data-conf]'); if (el) el.textContent = n; },
    onSolved: async (moves) => {
      finished = true;
      clearInterval(timer);
      qs('[data-msg]').textContent = 'Checking your solution…';
      try {
        const r = await api('attempt/submit', { method: 'POST', body: { attemptId: attempt.id, moves } });
        store.del(movesKey);
        track('game_completed', { difficulty, theme, mode: attempt.mode });
        setTimeout(() => viewResult(r.result, puzzle, {}), 700);
      } catch (e) {
        finished = false;
        board.locked = false;
        qs('[data-msg]').textContent = e.message;
      }
    },
  });
  board.onConflicts?.(board.conflicts.size);
  const tick = () => { const el = qs('[data-timer]'); if (el) el.textContent = fmtTime(Date.now() + offset - attempt.startedAt); };
  tick();
  const timer = setInterval(tick, 1000);
  if (attempt.status === 'started' && !saved.length) track('game_started', { difficulty, theme, mode: attempt.mode });
  cleanup = () => { clearInterval(timer); if (!finished) track('game_abandoned', { difficulty, theme }); };

  qs('[data-undo]').addEventListener('click', () => board.undo());
  qs('[data-reset]').addEventListener('click', () => { qs('[data-reset-confirm]').hidden = false; qs('[data-reset-yes]').focus(); });
  qs('[data-reset-no]').addEventListener('click', () => { qs('[data-reset-confirm]').hidden = true; });
  qs('[data-reset-yes]').addEventListener('click', () => { board.reset(); qs('[data-reset-confirm]').hidden = true; });
  const hintBtn = qs('[data-hint]');
  const askHint = async (rewarded = false) => {
    hintBtn.disabled = true;
    const msg = qs('[data-msg]');
    try {
      const r = await api('attempt/hint', { method: 'POST', body: { attemptId: attempt.id, grid: board.grid, rewarded } });
      board.applyHint(r.hint.index, r.hint.value);
      track('hint_used', { difficulty, rewarded });
      msg.textContent = r.hint.kind === 'fix' ? 'That highlighted tile was wrong — it’s been corrected.' : 'Here’s a tile you can work out next.';
      if (!me?.premium) hintBtn.textContent = 'Hint (0 left)';
    } catch (e) {
      msg.textContent = e.message;
      if (e.body?.code === 'no_hints' && e.body.canReward && await rewardedAvailable()) {
        const box = qs('[data-reward]');
        box.hidden = false;
        box.innerHTML = '<button type="button" class="btn" data-watch>Watch a short ad for one more hint</button> <a class="btn ghost" href="#/pricing">Unlimited hints</a>';
        qs('[data-watch]').addEventListener('click', async () => {
          box.hidden = true;
          if (await showRewarded()) askHint(true);
          else msg.textContent = 'No ad was available just now. Please try again later.';
        });
      } else if (e.body?.code === 'no_hints') {
        qs('[data-reward]').hidden = false;
        qs('[data-reward]').innerHTML = '<a class="btn ghost" href="#/pricing">Get unlimited hints with All Themes</a>';
      }
    } finally { hintBtn.disabled = false; }
  };
  hintBtn.addEventListener('click', () => askHint(false));
}

// ---------- Result ----------
function viewResult(result, puzzle, { already }) {
  if (!result) { view(errorCard('Result not found.')); return bindRetry(); }
  applyTheme(result.theme);
  const shareUrl = cfg.siteUrl || location.origin;
  const text = resultText({ number: result.number, theme: result.theme, difficulty: result.difficulty, rowFlags: result.rowFlags, timeMs: result.timeMs, streak: result.streak, url: shareUrl });
  const others = DIFFS.filter((d) => d !== result.difficulty && me?.todayStatus?.[d]?.status !== 'completed');
  view(`<section class="result card">
    <p class="eyebrow">${result.ranked ? 'Daily' : 'Practice'} #${result.number} · ${THEMES[result.theme].name} · ${cap(result.difficulty)}</p>
    <h1 class="complete">${already ? 'Already solved today' : 'Puzzle Complete!'}</h1>
    <dl class="result-stats">
      <div><dt>Time</dt><dd>${fmtTime(result.timeMs)}</dd></div>
      <div><dt>Mistakes</dt><dd>${result.mistakes}</dd></div>
      <div><dt>Score</dt><dd>${result.score}</dd></div>
      <div><dt>Streak</dt><dd class="${already ? '' : 'bump'}">${result.streak}</dd></div>
      <div><dt>Best streak</dt><dd>${result.bestStreak}</dd></div>
      <div><dt>Hints</dt><dd>${result.hints}</dd></div>
    </dl>
    ${result.rank ? `<p class="rank-line">${result.percentile ? `Top ${Math.max(1, 101 - result.percentile)}% today · ` : ''}Rank #${result.rank} of ${result.of} on ${cap(result.difficulty)}.</p>` : ''}
    ${result.themeStreak ? `<p class="muted">${THEMES[result.theme].name} streak: ${result.themeStreak} day${result.themeStreak === 1 ? '' : 's'}.</p>` : ''}
    ${result.unrankedReason === 'too_fast' ? '<p class="muted">This solve was faster than we can verify, so it is not ranked.</p>' : ''}
    ${!result.ranked && !result.unrankedReason ? '<p class="muted">Archive puzzles do not count towards streaks or leaderboards.</p>' : ''}
    ${(result.newAchievements || []).length ? `<div class="achievements-new">${result.newAchievements.map((a) => `<span class="ach">🏅 ${esc(ACH[a]?.[0] || a)}</span>`).join('')}</div>` : ''}
    <h2>Share Result</h2>
    <div data-share></div>
    <div class="share-row">
      ${others.length ? `<a class="btn primary" href="#/play?d=${others[0]}">Play ${cap(others[0])}</a>` : ''}
      <a class="btn" href="#/themes">Play Another Theme</a>
      <a class="btn" href="#/leaderboard?difficulty=${result.difficulty}">View Leaderboard</a>
    </div>
    <p class="muted small">Next daily puzzles at ${nextResetLabel()} your time. Themes share the same daily grid, so a new theme gives you a fresh look tomorrow.</p>
  </section>
  ${me?.premium ? '' : '<div class="card upsell slim"><p>Unlock every theme, the full archive and unlimited hints with <strong>HoluVantage All Themes</strong>.</p><a class="btn ghost" href="#/pricing">See pricing</a></div>'}
  <div class="ad-slot" data-ad hidden></div>`);
  renderShare(qs('[data-share]'), text, shareUrl);
  if (!already && !matchMedia('(prefers-reduced-motion: reduce)').matches && !document.documentElement.classList.contains('reduce-motion')) confetti();
  showAd('result', qs('[data-ad]'), { premium: me?.premium });
  me = null; // refresh streaks next time
}

function confetti() {
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 24; i++) {
    const s = document.createElement('i');
    s.style.left = `${Math.random() * 100}%`;
    s.style.animationDelay = `${Math.random() * 0.3}s`;
    s.style.background = i % 2 ? 'var(--tile-a-bg)' : 'var(--tile-b-bg)';
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1800);
}

// ---------- Leaderboard ----------
async function viewLeaderboard(params) {
  const period = params.period === 'weekly' ? 'weekly' : 'daily';
  const difficulty = DIFFS.includes(params.difficulty) ? params.difficulty : '';
  const theme = THEMES[params.theme] ? params.theme : '';
  const group = params.group || '';
  view('<div class="loading" aria-busy="true">Loading leaderboard…</div>');
  let data;
  try {
    if (hasIdentity()) await loadMe().catch(() => {});
    const q = new URLSearchParams({ period, ...(difficulty && { difficulty }), ...(theme && { theme }), ...(group && { group }) });
    data = await api(`leaderboard?${q}`);
    track('leaderboard_viewed', { period, difficulty, theme, group: Boolean(group) });
  } catch (e) { view(errorCard(e)); return bindRetry(); }
  const link = (over) => `#/leaderboard?${new URLSearchParams({ period, difficulty, theme, group, ...over })}`;
  const groups = me?.groups || [];
  view(`<section class="card">
    <h1>Leaderboard</h1>
    <div class="tabs" role="tablist" aria-label="Period">
      <a role="tab" aria-selected="${period === 'daily'}" href="${link({ period: 'daily' })}">Today</a>
      <a role="tab" aria-selected="${period === 'weekly'}" href="${link({ period: 'weekly' })}">This week</a>
    </div>
    <div class="filters">
      <label>Difficulty <select data-f="difficulty"><option value="">All (global)</option>${DIFFS.map((d) => `<option value="${d}" ${d === difficulty ? 'selected' : ''}>${cap(d)}</option>`).join('')}</select></label>
      <label>Theme <select data-f="theme"><option value="">All themes</option>${THEME_ORDER.map((t) => `<option value="${t}" ${t === theme ? 'selected' : ''}>${THEMES[t].name}</option>`).join('')}</select></label>
      ${groups.length ? `<label>Group <select data-f="group"><option value="">Everyone</option>${groups.map((g) => `<option value="${g.id}" ${g.id === group ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>` : ''}
    </div>
    <p class="muted small">${period === 'daily' ? `Puzzle date ${puzzleDateLabel(data.from)} (UTC)` : `Week of ${puzzleDateLabel(data.from)}`} · ${data.total} player${data.total === 1 ? '' : 's'} · Ranked by score, then time, then mistakes.</p>
    ${data.rows.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table class="board-table">
      <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Score</th><th scope="col">Time</th><th scope="col">Mistakes</th>${period === 'weekly' ? '<th scope="col">Solves</th>' : ''}</tr></thead>
      <tbody>${data.rows.map((r) => `<tr class="${r.me ? 'me' : ''}"><td>${r.rank}</td><td>${esc(r.nickname)}${r.me ? ' <span class="you">you</span>' : ''}</td><td>${r.score}</td><td>${fmtTime(r.timeMs)}</td><td>${r.mistakes}</td>${period === 'weekly' ? `<td>${r.plays}</td>` : ''}</tr>`).join('')}</tbody>
    </table></div>` : '<p class="empty">No solves yet. Be the first on the board today.</p>'}
    <p class="small muted">Players appear by nickname only. Change yours in <a href="#/account">Account</a>.</p>
  </section>`);
  app.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => go(link({ [s.dataset.f]: s.value }))));
}

// ---------- Stats ----------
async function viewStats() {
  if (!hasIdentity()) return viewOnboarding(1);
  view('<div class="loading" aria-busy="true">Loading your stats…</div>');
  let data;
  try { await loadMe(); data = await api('stats'); } catch (e) { view(errorCard(e)); return bindRetry(); }
  const s = data.stats;
  const earned = new Set(me.achievements.map((a) => a.code));
  view(`<section class="card">
    <h1>My Stats</h1>
    <dl class="result-stats">
      <div><dt>Completed</dt><dd>${s.completed}</dd></div>
      <div><dt>Average time</dt><dd>${s.completed ? fmtTime(s.avg_time_ms) : '—'}</dd></div>
      <div><dt>Current streak</dt><dd>${me.streak.current}</dd></div>
      <div><dt>Best streak</dt><dd>${me.streak.best}</dd></div>
      <div><dt>Missed days</dt><dd>${me.streak.missedDays}</dd></div>
    </dl>
    ${Object.keys(me.themeStreaks).length ? `<h2>Theme streaks</h2><ul class="theme-streaks">${Object.entries(me.themeStreaks).map(([k, v]) => `<li><span class="dot" style="background:${THEMES[k].a.bg}"></span>${THEMES[k].name}: ${v.current} (best ${v.best})</li>`).join('')}</ul>` : ''}
    <h2>Achievements</h2>
    <ul class="ach-list">${Object.entries(ACH).map(([k, [name, desc]]) => `<li class="${earned.has(k) ? 'earned' : ''}"><strong>${earned.has(k) ? '🏅' : '○'} ${name}</strong><span class="small muted">${desc}</span></li>`).join('')}</ul>
  </section>
  ${data.premium ? `<section class="card"><h2>Advanced statistics</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table class="board-table"><thead><tr><th scope="col">Difficulty</th><th scope="col">Solves</th><th scope="col">Average</th><th scope="col">Best</th><th scope="col">Avg mistakes</th><th scope="col">Best score</th><th scope="col">Flawless</th></tr></thead>
    <tbody>${DIFFS.filter((d) => s.by_difficulty[d]).map((d) => { const x = s.by_difficulty[d]; return `<tr><td>${cap(d)}</td><td>${x.plays}</td><td>${fmtTime(x.avg_time_ms)}</td><td>${fmtTime(x.best_time_ms)}</td><td>${x.avg_mistakes}</td><td>${x.best_score}</td><td>${x.flawless}</td></tr>`; }).join('') || '<tr><td colspan="7">Play a few puzzles to see this.</td></tr>'}</tbody></table></div>
    <h3>Solve times</h3>${bars(s.time_buckets, { under_1m: 'Under 1 min', '1_3m': '1–3 min', '3_10m': '3–10 min', over_10m: 'Over 10 min' })}
    <h3>Themes played</h3>${bars(s.by_theme, Object.fromEntries(THEME_ORDER.map((t) => [t, THEMES[t].name])))}
  </section>` : premiumNote('See solve-time breakdowns, personal bests and theme history with All Themes.')}
  ${s.recent?.length ? `<section class="card"><h2>Recent solves</h2><ul class="recent">${s.recent.map((r) => `<li>${puzzleDateLabel(r.puzzle_date)} · ${cap(r.difficulty)} · ${THEMES[r.theme]?.name || r.theme} · ${fmtTime(r.time_ms)} · ${r.score} pts</li>`).join('')}</ul></section>` : ''}`);
}
function bars(obj, labels) {
  const entries = Object.keys(labels).map((k) => [labels[k], Number(obj?.[k] || 0)]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return `<ul class="bars">${entries.map(([l, v]) => `<li><span class="bar-label">${esc(l)}</span><span class="bar" style="--w:${(100 * v) / max}%"></span><span class="bar-val">${v}</span></li>`).join('')}</ul>`;
}

// ---------- Archive ----------
async function viewArchive() {
  if (!hasIdentity()) return viewOnboarding(1);
  await loadMe();
  if (!me.premium) { view(`<section class="card"><h1>Puzzle archive</h1><p class="lead">Replay every past daily puzzle in any theme.</p></section>${premiumNote('The archive is included in HoluVantage All Themes.')}`); return; }
  const yesterday = new Date(Date.parse(`${me.today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  view(`<section class="card"><h1>Puzzle archive</h1>
    <p class="lead">Pick any past day. Archive solves are just for practice and don’t affect streaks or leaderboards.</p>
    ${yesterday < cfg.epoch ? '<p class="empty">The archive fills up from tomorrow.</p>' : `<label class="field">Date <input type="date" data-date min="${cfg.epoch}" max="${yesterday}" value="${yesterday}"></label>
    <div class="share-row">${DIFFS.map((d) => `<button class="btn" data-arch="${d}">${cap(d)}</button>`).join('')}</div>`}
  </section>`);
  app.querySelectorAll('[data-arch]').forEach((b) => b.addEventListener('click', () => go(`#/play?d=${b.dataset.arch}&date=${qs('[data-date]').value}`)));
}

// ---------- Pricing ----------
async function viewPricing(params) {
  if (hasIdentity()) await loadMe().catch(() => {});
  const marketKey = params.market && cfg.prices[params.market] ? params.market : (me?.player.market || cfg.market);
  const m = cfg.prices[marketKey];
  const plan = params.plan === 'yearly' && m.yearly ? 'yearly' : 'monthly';
  const price = plan === 'yearly' ? m.yearly : m.monthly;
  view(`<section class="card pricing">
    <h1>Pricing</h1>
    ${params.checkout === 'cancelled' ? '<p class="flash" role="status">Checkout cancelled. You have not been charged.</p>' : ''}
    <label class="field inline">Region <select data-market>${Object.entries({ GB: 'United Kingdom (£)', US: 'United States & elsewhere ($)', NG: 'Nigeria (₦)', IN: 'India (₹)' }).map(([k, l]) => `<option value="${k}" ${k === marketKey ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    ${m.yearly ? `<div class="tabs" role="tablist" aria-label="Billing period"><a role="tab" aria-selected="${plan === 'monthly'}" href="#/pricing?market=${marketKey}&plan=monthly">Monthly</a><a role="tab" aria-selected="${plan === 'yearly'}" href="#/pricing?market=${marketKey}&plan=yearly">Yearly</a></div>` : ''}
    <div class="grid-2">
      <div class="plan">
        <h2>Free</h2><p class="price">${fmtMoney(0, m.currency)}</p><p class="muted">Start free</p>
        <ul class="ticks"><li>Classic theme</li><li>One more theme of your choice</li><li>Daily puzzle in three difficulties</li><li>Streaks and leaderboards</li><li>One hint per puzzle</li><li>Endless Logic practice</li><li>Supported by ads (with your consent)</li></ul>
      </div>
      <div class="plan featured">
        <h2>HoluVantage All Themes</h2><p class="price">${fmtMoney(price, m.currency)}<span>/${plan === 'yearly' ? 'year' : 'month'}</span></p><p class="muted">Unlock every theme</p>
        <ul class="ticks"><li>All themes, including future seasonal themes</li><li>Full puzzle archive</li><li>Unlimited hints and archive practice</li><li>No advertising</li><li>Advanced statistics</li></ul>
        ${me?.premium ? '<p class="done-today">You have All Themes. Thank you!</p>'
          : m.available ? `<button class="btn primary big" data-buy>Upgrade</button>`
          : '<p class="muted">Payments in this region open soon. Everything free stays free in the meantime.</p>'}
        <p class="form-error" role="alert" data-err hidden></p>
        <p class="small muted">Cancel any time from your account. Shown in your local currency.</p>
      </div>
    </div>
  </section>`);
  qs('[data-market]').addEventListener('change', (e) => go(`#/pricing?market=${e.target.value}&plan=${plan}`));
  qs('[data-buy]')?.addEventListener('click', async (e) => {
    const err = qs('[data-err]');
    if (!signedIn()) { flash = 'Create a free account (or sign in) so your pass is saved to you, then choose Upgrade again.'; return go('#/account'); }
    e.target.disabled = true;
    try {
      if (me && me.player.market !== marketKey) await api('me', { method: 'PATCH', body: { market: marketKey } });
      const r = await api('billing/checkout', { method: 'POST', body: { plan, market: marketKey } });
      track('subscription_started', { market: marketKey, plan });
      location.href = r.url;
    } catch (x) { err.textContent = x.message; err.hidden = false; e.target.disabled = false; }
  });
}

// ---------- Account ----------
async function viewAccount(params) {
  if (hasIdentity()) {
    try { await loadMe(true); } catch (e) { view(errorCard(e)); return bindRetry(); }
  }
  const p = me?.player;
  const sub = me?.subscriptions?.find((s) => ['active', 'trialing', 'non_renewing'].includes(s.status) && new Date(s.current_period_end) > new Date());
  const c = consent() || { analytics: false, ads: false };
  view(`<p class="flash" data-flash hidden role="status"></p>
  ${params.checkout === 'success' ? `<p class="flash" role="status">${me?.premium ? 'Welcome to All Themes! Every theme is now unlocked.' : 'Payment received. Your pass activates within a minute — refresh this page shortly.'}</p>` : ''}
  <section class="card">
    <h1>Account</h1>
    ${p?.isAccount
      ? `<p>Signed in as <strong>${esc(p.email)}</strong>.</p><button class="btn" data-signout>Sign out</button>`
      : `<p class="lead">${p ? 'You’re playing as a guest. Create a free account to keep your streak safe and play on any device — your progress comes with you.' : 'Sign in to restore your progress.'}</p>
         <form class="inline-form" data-signin><label class="field">Email <input type="email" name="email" required autocomplete="email" placeholder="you@example.com"></label>
         <button class="btn primary">Email me a sign-in link</button></form>
         <p class="hint-text" role="status" data-signin-msg></p>
         <p class="small muted">No password needed. We only use your email to sign you in and for receipts.</p>`}
  </section>
  ${p ? `<section class="card">
    <h2>Profile</h2>
    <form class="inline-form" data-nick><label class="field">Nickname <input name="nickname" value="${esc(p.nickname)}" pattern="[A-Za-z0-9_]{3,20}" required maxlength="20"></label><button class="btn">Save</button></form>
    <fieldset class="field"><legend>Interests</legend><div class="chips">${THEME_ORDER.map((t) => `<label class="chip"><input type="checkbox" name="interest" value="${t}" ${p.themes.includes(t) ? 'checked' : ''}> ${THEMES[t].name}</label>`).join('')}</div></fieldset>
    ${me.premium ? '' : `<label class="field">Free theme <select data-free ${p.freeThemeChangeableFrom ? 'disabled' : ''}><option value="" ${p.freeTheme ? '' : 'selected'} disabled>Choose…</option>${THEME_ORDER.filter((t) => t !== 'classic').map((t) => `<option value="${t}" ${t === p.freeTheme ? 'selected' : ''}>${THEMES[t].name}</option>`).join('')}</select></label>
      ${p.freeThemeChangeableFrom ? `<p class="small muted">You can change your free theme again on ${puzzleDateLabel(p.freeThemeChangeableFrom)}.</p>` : ''}`}
    <label class="chip"><input type="checkbox" data-marketing ${p.marketingConsent ? 'checked' : ''}> Email me occasional product news (optional)</label>
    <label class="chip"><input type="checkbox" data-motion ${store.get('reduceMotion') ? 'checked' : ''}> Reduce motion</label>
    <p class="hint-text" role="status" data-profile-msg></p>
  </section>
  <section class="card">
    <h2>HoluVantage All Themes</h2>
    ${sub ? `<p>Status: <strong>${sub.status === 'non_renewing' ? 'Ends' : 'Renews'} ${new Date(sub.current_period_end).toLocaleDateString()}</strong> (${sub.plan}).</p>
      <button class="btn" data-manage>Manage or cancel</button>`
      : `<p>You’re on the free plan.</p><a class="btn primary" href="#/pricing">See All Themes</a>`}
    <p class="hint-text" role="status" data-manage-msg></p>
  </section>
  <section class="card">
    <h2>Groups</h2>
    <p class="muted">Create a private leaderboard for a class, club or team, or join one with a code.</p>
    ${me.groups.length ? `<ul class="group-list">${me.groups.map((g) => `<li><strong>${esc(g.name)}</strong> · code <code>${esc(g.code)}</code> <a href="#/leaderboard?group=${g.id}">Leaderboard</a> <button class="btn ghost small" data-leave="${g.id}">${g.owner ? 'Delete' : 'Leave'}</button></li>`).join('')}</ul>` : ''}
    <form class="inline-form" data-join><label class="field">Join with code <input name="code" maxlength="6" pattern="[A-Za-z0-9]{6}" required></label><button class="btn">Join</button></form>
    <form class="inline-form" data-create><label class="field">New group name <input name="name" minlength="3" maxlength="40" required></label><button class="btn">Create</button></form>
    <p class="hint-text" role="status" data-group-msg></p>
  </section>` : ''}
  <section class="card">
    <h2>Privacy</h2>
    <label class="chip"><input type="checkbox" data-c="analytics" ${c.analytics ? 'checked' : ''}> Usage measurement</label>
    <label class="chip"><input type="checkbox" data-c="ads" ${c.ads ? 'checked' : ''}> Advertising cookies</label>
    <p class="small muted">See our <a href="/privacy">Privacy Policy</a> and <a href="/cookies">Cookie Policy</a>.</p>
    ${p ? `<div class="share-row"><button class="btn" data-export>Download my data</button><button class="btn danger" data-delete>Delete my ${p.isAccount ? 'account' : 'data'}</button></div>
    <div class="reset-confirm" data-del-confirm hidden><label class="field">Type DELETE to confirm <input data-del-input autocomplete="off"></label><button class="btn danger" data-del-yes>Delete everything</button><button class="btn ghost" data-del-no>Cancel</button></div>
    <p class="hint-text" role="status" data-privacy-msg></p>` : ''}
  </section>
  <section class="card">
    <h2>Report a problem</h2>
    <form data-report><label class="field">What happened? <textarea name="message" minlength="3" maxlength="1000" rows="3" required></textarea></label><button class="btn">Send</button></form>
    <p class="hint-text" role="status" data-report-msg></p>
  </section>
  ${me?.isAdmin ? '<p><a class="btn ghost" href="/admin">Open admin</a></p>' : ''}
  ${installPrompt ? '<p><button class="btn ghost" data-install>Install the app</button></p>' : ''}`);

  qs('[data-install]')?.addEventListener('click', doInstall);
  qs('[data-signin]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = qs('[data-signin-msg]');
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try { await sendMagicLink(e.target.email.value.trim()); msg.textContent = 'Check your inbox for a sign-in link. You can close this tab.'; }
    catch (x) { msg.textContent = x.message; }
    btn.disabled = false;
  });
  qs('[data-signout]')?.addEventListener('click', async () => { await signOut(); me = null; flash = 'Signed out.'; go('#/account'); });
  const save = async (body, msgSel = '[data-profile-msg]') => {
    const msg = qs(msgSel);
    try { await api('me', { method: 'PATCH', body }); msg.textContent = 'Saved.'; await loadMe(true); }
    catch (x) { msg.textContent = x.message; }
  };
  qs('[data-nick]')?.addEventListener('submit', (e) => { e.preventDefault(); save({ nickname: e.target.nickname.value.trim() }); });
  app.querySelectorAll('[name="interest"]').forEach((cb) => cb.addEventListener('change', () => {
    const themes = [...app.querySelectorAll('[name="interest"]:checked')].map((x) => x.value);
    if (themes.length < 1 || themes.length > 3) { cb.checked = !cb.checked; qs('[data-profile-msg]').textContent = 'Choose between 1 and 3 interests.'; return; }
    save({ themes });
  }));
  qs('[data-free]')?.addEventListener('change', (e) => save({ freeTheme: e.target.value }).then(() => route()));
  qs('[data-marketing]')?.addEventListener('change', (e) => save({ marketingConsent: e.target.checked }));
  qs('[data-motion]')?.addEventListener('change', (e) => { store.set('reduceMotion', e.target.checked); document.documentElement.classList.toggle('reduce-motion', e.target.checked); });
  qs('[data-manage]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await api('billing/manage', { method: 'POST' }); if (r.url) location.href = r.url; else { qs('[data-manage-msg]').textContent = r.message; track('subscription_cancelled'); } }
    catch (x) { qs('[data-manage-msg]').textContent = x.message; e.target.disabled = false; }
  });
  qs('[data-join]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const g = await api('groups/join', { method: 'POST', body: { code: e.target.code.value } }); flash = `Joined ${g.name}.`; route(); }
    catch (x) { qs('[data-group-msg]').textContent = x.message; }
  });
  qs('[data-create]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const g = await api('groups', { method: 'POST', body: { name: e.target.name.value } }); flash = `Created ${g.name}. Share code ${g.code} with your group.`; route(); }
    catch (x) { qs('[data-group-msg]').textContent = x.message; }
  });
  app.querySelectorAll('[data-leave]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('groups/leave', { method: 'POST', body: { groupId: b.dataset.leave } }); route(); }
    catch (x) { qs('[data-group-msg]').textContent = x.message; }
  }));
  app.querySelectorAll('[data-c]').forEach((cb) => cb.addEventListener('change', () => {
    setConsent({ analytics: qs('[data-c="analytics"]').checked, ads: qs('[data-c="ads"]').checked });
    if (!qs('[data-c="ads"]').checked) flash = 'Advertising turned off. Reload the page to remove any ads already shown.';
  }));
  qs('[data-export]')?.addEventListener('click', async () => {
    try {
      const data = await api('account/export');
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: 'holuvantage-daily-logic-data.json' });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (x) { qs('[data-privacy-msg]').textContent = x.message; }
  });
  qs('[data-delete]')?.addEventListener('click', () => { qs('[data-del-confirm]').hidden = false; qs('[data-del-input]').focus(); });
  qs('[data-del-no]')?.addEventListener('click', () => { qs('[data-del-confirm]').hidden = true; });
  qs('[data-del-yes]')?.addEventListener('click', async (e) => {
    if (qs('[data-del-input]').value.trim() !== 'DELETE') { qs('[data-privacy-msg]').textContent = 'Type DELETE to confirm.'; return; }
    e.target.disabled = true;
    try {
      await api('account', { method: 'DELETE' });
      store.del('session'); store.del('guest'); store.del('onboarded'); store.del('theme'); me = null;
      flash = 'Your data has been deleted.';
      go('#/');
    } catch (x) { qs('[data-privacy-msg]').textContent = x.message; e.target.disabled = false; }
  });
  qs('[data-report]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('report', { method: 'POST', body: { message: e.target.message.value } }); e.target.reset(); qs('[data-report-msg]').textContent = 'Thanks — we’ve received your report.'; }
    catch (x) { qs('[data-report-msg]').textContent = x.message; }
  });
}

// ---------- Consent banner ----------
function consentBanner() {
  if (consent()) return;
  const el = document.createElement('div');
  el.className = 'consent';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Privacy choices');
  el.innerHTML = `<p>We store your game progress on this device so the game works. With your permission we also measure how the game is used and show ads to keep it free. <a href="/cookies">Learn more</a></p>
    <div class="share-row"><button class="btn primary" data-all>Accept all</button><button class="btn" data-essential>Essential only</button></div>`;
  document.body.appendChild(el);
  const done = (c) => { setConsent(c); el.remove(); };
  el.querySelector('[data-all]').addEventListener('click', () => done({ analytics: true, ads: true }));
  el.querySelector('[data-essential]').addEventListener('click', () => done({ analytics: false, ads: false }));
}

// ---------- Router ----------
async function route() {
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  const p = path || '/';
  document.querySelectorAll('.site-nav a').forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === `#${p}`));
  try {
    if (p === '/' || p === '') await viewHome();
    else if (p === '/play') await viewPlay(params);
    else if (p === '/leaderboard') await viewLeaderboard(params);
    else if (p === '/stats') await viewStats();
    else if (p === '/themes') await viewThemes();
    else if (p === '/archive') await viewArchive();
    else if (p === '/pricing') await viewPricing(params);
    else if (p === '/account') await viewAccount(params);
    else if (p === '/welcome') viewOnboarding(1);
    else go('#/');
  } catch (e) {
    console.error(e);
    view(errorCard(e instanceof ApiError ? e : new Error('Something went wrong.')));
    bindRetry();
  }
}

async function boot() {
  if (store.get('reduceMotion')) document.documentElement.classList.add('reduce-motion');
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try { cfg = await loadConfig(); } catch (e) { view(errorCard(e)); return bindRetry(); }
  const auth = consumeAuthRedirect();
  if (auth === 'signed_in') {
    try {
      const r = await claimGuestProgress();
      flash = r?.merged ? 'Signed in. Your guest progress is now saved to your account.' : 'Signed in. Welcome back!';
    } catch (e) { flash = `Signed in, but we couldn’t move your guest progress: ${e.message}`; }
    store.set('onboarded', true);
  } else if (auth) flash = auth;
  consentBanner();
  window.addEventListener('hashchange', route);
  route();
}
boot();
