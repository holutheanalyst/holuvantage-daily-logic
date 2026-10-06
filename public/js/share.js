// Shareable result text and share targets. Never reveals the solution.
import { THEMES } from './themes.js';
import { fmtTime, track, esc } from './api.js';

const FLAG = { clean: '🟩', mistake: '🟨', hint: '🟦' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function resultText({ number, theme, difficulty, rowFlags = [], timeMs, streak, endless = false, url }) {
  const rows = rowFlags.map((f) => FLAG[f] || FLAG.clean);
  const lines = [];
  const per = rows.length <= 6 ? rows.length : Math.ceil(rows.length / 2);
  for (let i = 0; i < rows.length; i += per) lines.push(rows.slice(i, i + per).join(' '));
  return [
    'HoluVantage Daily Logic',
    endless ? 'Endless Logic' : `Puzzle #${number}`,
    '',
    THEMES[theme]?.name || 'Classic',
    cap(difficulty),
    '',
    ...lines,
    '',
    `Solved in ${fmtTime(timeMs)}`,
    ...(streak ? [`${streak} day streak`] : []),
    '',
    endless ? 'Play Endless Logic:' : 'Play today’s puzzle:',
    url,
  ].join('\n');
}

// Renders share buttons into `el`. All targets open real share URLs or copy text.
export function renderShare(el, text, url) {
  const enc = encodeURIComponent;
  const targets = [
    ['WhatsApp', `https://wa.me/?text=${enc(text)}`],
    ['X', `https://twitter.com/intent/tweet?text=${enc(text)}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`],
    ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`],
  ];
  el.innerHTML = `
    <pre class="share-preview" aria-label="Result preview">${esc(text)}</pre>
    <div class="share-row">
      ${navigator.share ? '<button type="button" class="btn primary" data-native>Share…</button>' : ''}
      <button type="button" class="btn" data-copy>Copy result</button>
      ${targets.map(([name, href]) => `<a class="btn ghost" href="${href}" target="_blank" rel="noopener noreferrer" data-target="${name}">${name}</a>`).join('')}
    </div>
    <p class="hint-text" role="status" data-status></p>`;
  const status = el.querySelector('[data-status]');
  el.querySelector('[data-native]')?.addEventListener('click', async () => {
    track('share_clicked', { target: 'native' });
    try { await navigator.share({ text }); track('share_completed', { target: 'native' }); } catch {}
  });
  el.querySelector('[data-copy]').addEventListener('click', async () => {
    track('share_clicked', { target: 'copy' });
    try { await navigator.clipboard.writeText(text); status.textContent = 'Copied to clipboard.'; track('share_completed', { target: 'copy' }); }
    catch { status.textContent = 'Copy failed. Select the text above and copy it.'; }
  });
  el.querySelectorAll('[data-target]').forEach((a) => a.addEventListener('click', () => {
    track('share_clicked', { target: a.dataset.target });
    track('share_completed', { target: a.dataset.target });
  }));
}
