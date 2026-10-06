// Endless Logic: unlimited random puzzles, no account, separate from the daily challenge.
// Safe to embed on web game portals; uses a portal SDK only if the host page provides one.
import { generateValidPuzzle, computeScore, EMPTY } from './engine.js';
import { Board } from './board.js';
import { THEMES, THEME_ORDER, applyTheme } from './themes.js';
import { store, fmtTime, track } from './api.js';
import { resultText, renderShare } from './share.js';

const root = document.getElementById('endless');
const portal = {
  start() { try { window.CrazyGames?.SDK?.game?.gameplayStart?.(); window.PokiSDK?.gameplayStart?.(); } catch {} },
  stop() { try { window.CrazyGames?.SDK?.game?.gameplayStop?.(); window.PokiSDK?.gameplayStop?.(); } catch {} },
  happy() { try { window.CrazyGames?.SDK?.game?.happytime?.(); } catch {} },
};
let difficulty = store.get('endless.difficulty', 'easy');
let theme = store.get('endless.theme', 'classic');
let timer = null;

function header(best) {
  return `<div class="endless-head">
    <label class="field inline">Difficulty <select data-d>${['easy', 'medium', 'hard'].map((d) => `<option value="${d}" ${d === difficulty ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join('')}</select></label>
    <label class="field inline">Theme <select data-t>${THEME_ORDER.map((t) => `<option value="${t}" ${t === theme ? 'selected' : ''}>${THEMES[t].name}</option>`).join('')}</select></label>
    <span class="muted small">Best: ${best ? `${best} pts` : '—'} · Solved: ${store.get(`endless.solved.${difficulty}`, 0)}</span>
  </div>`;
}

function newPuzzle() {
  clearInterval(timer);
  applyTheme(theme);
  root.innerHTML = '<div class="loading" aria-busy="true">Building a fresh puzzle…</div>';
  setTimeout(() => play(generateValidPuzzle(`endless-${Date.now()}-${Math.random()}`, difficulty)), 30);
}

function play(p) {
  const best = store.get(`endless.best.${difficulty}`, 0);
  let mistakes = 0;
  const rowFlags = Array(p.n).fill('clean');
  const started = Date.now();
  root.innerHTML = `${header(best)}
    <div class="play-head"><h1 class="play-title">Endless Logic · ${THEMES[theme].name}</h1>
      <dl class="play-stats"><div><dt>Time</dt><dd data-timer>00:00</dd></div><div><dt>Mistakes</dt><dd data-m>0</dd></div><div><dt>Score</dt><dd data-s>—</dd></div></dl></div>
    <div data-board></div>
    <div class="controls"><button class="btn" data-undo>Undo</button><button class="btn" data-restart>Restart</button><button class="btn" data-new>New puzzle</button></div>
    <p class="hint-text" role="status" data-msg>Each row and column holds equal numbers of each tile, no three in a row, and no identical rows or columns.</p>`;
  const board = new Board({
    root: root.querySelector('[data-board]'), size: p.n, givens: p.givens, theme,
    onChange: (grid, moves) => {
      const [i, v] = moves[moves.length - 1] || [];
      if (v && v !== p.solution[i]) { mistakes++; rowFlags[Math.floor(i / p.n)] = 'mistake'; root.querySelector('[data-m]').textContent = mistakes; }
    },
    onSolved: () => {
      clearInterval(timer);
      portal.stop(); portal.happy();
      const timeMs = Date.now() - started;
      const score = computeScore({ difficulty, timeMs, mistakes, hints: 0 });
      root.querySelector('[data-s]').textContent = score;
      store.set(`endless.solved.${difficulty}`, store.get(`endless.solved.${difficulty}`, 0) + 1);
      if (score > best) store.set(`endless.best.${difficulty}`, score);
      track('endless_completed', { difficulty, theme });
      const url = `${location.origin}/endless`;
      const box = document.createElement('section');
      box.className = 'card result';
      box.innerHTML = `<h2 class="complete">Puzzle Complete!</h2><p>${fmtTime(timeMs)} · ${mistakes} mistake${mistakes === 1 ? '' : 's'} · ${score} points${score > best ? ' · New best!' : ''}</p>
        <div data-share></div><button class="btn primary" data-again>Next puzzle</button>
        <p class="small muted">Want a daily challenge with streaks and leaderboards? <a href="/" target="_top">Play HoluVantage Daily Logic</a></p>`;
      root.appendChild(box);
      renderShare(box.querySelector('[data-share]'), resultText({ theme, difficulty, rowFlags, timeMs, endless: true, url }), url);
      box.querySelector('[data-again]').addEventListener('click', newPuzzle);
      box.querySelector('[data-again]').focus();
    },
  });
  root.querySelector('[data-undo]').addEventListener('click', () => board.undo());
  root.querySelector('[data-restart]').addEventListener('click', () => play(p));
  root.querySelector('[data-new]').addEventListener('click', newPuzzle);
  root.querySelector('[data-d]').addEventListener('change', (e) => { difficulty = e.target.value; store.set('endless.difficulty', difficulty); newPuzzle(); });
  root.querySelector('[data-t]').addEventListener('change', (e) => { theme = e.target.value; store.set('endless.theme', theme); applyTheme(theme); play(p); });
  timer = setInterval(() => { const el = root.querySelector('[data-timer]'); if (el) el.textContent = fmtTime(Date.now() - started); }, 1000);
  portal.start();
  track('endless_started', { difficulty, theme });
  void EMPTY;
}

newPuzzle();
