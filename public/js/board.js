// Accessible, touch- and keyboard-friendly puzzle board shared by daily and endless modes.
import { EMPTY, A, B, findConflicts, isSolved } from './engine.js';
import { THEMES, tileSvg } from './themes.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Board {
  // opts: { root, size, givens, theme, moves?, hints?[{index,value}], onChange(grid, moves), onSolved(moves), checkCell?(i,v)->bool }
  constructor(opts) {
    Object.assign(this, opts);
    this.n = opts.size;
    this.grid = opts.givens.slice();
    this.hinted = new Set();
    this.moves = [];
    this.history = [];
    this.pen = 'cycle';
    this.focus = this.grid.indexOf(EMPTY) >= 0 ? this.grid.indexOf(EMPTY) : 0;
    this.locked = false;
    for (const h of opts.hints || []) { this.grid[h.index] = h.value; this.hinted.add(h.index); }
    for (const [i, v] of opts.moves || []) { if (!this.hinted.has(i)) this.grid[i] = v; this.moves.push([i, v]); }
    this.render();
  }

  label(i) {
    const r = Math.floor(i / this.n) + 1, c = (i % this.n) + 1, v = this.grid[i];
    const t = THEMES[this.theme];
    const what = v === A ? t.a.label : v === B ? t.b.label : 'empty';
    const extra = this.givens[i] ? ', fixed clue' : this.hinted.has(i) ? ', hint' : '';
    const bad = this.conflicts?.has(i) ? ', breaks a rule' : '';
    return `Row ${r}, column ${c}: ${what}${extra}${bad}`;
  }

  render() {
    const n = this.n;
    this.root.innerHTML = `
      <div class="board" role="grid" aria-label="Puzzle grid, ${n} by ${n}" style="--n:${n}">
        ${Array.from({ length: n }, (_, r) => `<div role="row" class="board-row">${Array.from({ length: n }, (_, c) => {
          const i = r * n + c;
          return `<button type="button" role="gridcell" class="cell" data-i="${i}" tabindex="${i === this.focus ? 0 : -1}"></button>`;
        }).join('')}</div>`).join('')}
      </div>
      <div class="pens" role="radiogroup" aria-label="Tile to place">
        ${[['cycle', 'Tap to cycle', '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M17 8a6 6 0 1 0 1.5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 4v4.5H14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
           ['a', esc(THEMES[this.theme].a.label), `<span class="pen-tile tile-a">${tileSvg(this.theme, 'a', 20)}</span>`],
           ['b', esc(THEMES[this.theme].b.label), `<span class="pen-tile tile-b">${tileSvg(this.theme, 'b', 20)}</span>`],
           ['erase', 'Erase', '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>']]
          .map(([k, name, icon]) => `<button type="button" role="radio" class="pen" data-pen="${k}" aria-checked="${this.pen === k}" aria-label="${name}">${icon}<span>${name}</span></button>`).join('')}
      </div>
      <p class="sr-only" aria-live="polite" data-live></p>`;
    this.cells = [...this.root.querySelectorAll('.cell')];
    this.live = this.root.querySelector('[data-live]');
    this.root.querySelector('.board').addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (cell) { this.setFocus(+cell.dataset.i, false); this.apply(+cell.dataset.i); }
    });
    this.root.querySelector('.board').addEventListener('keydown', (e) => this.onKey(e));
    this.root.querySelector('.pens').addEventListener('click', (e) => {
      const p = e.target.closest('.pen');
      if (p) this.setPen(p.dataset.pen);
    });
    this.paint();
  }

  setPen(pen) {
    this.pen = pen;
    this.root.querySelectorAll('.pen').forEach((p) => p.setAttribute('aria-checked', String(p.dataset.pen === pen)));
  }

  setFocus(i, move = true) {
    this.cells[this.focus]?.setAttribute('tabindex', '-1');
    this.focus = i;
    this.cells[i].setAttribute('tabindex', '0');
    if (move) this.cells[i].focus();
  }

  onKey(e) {
    const target = e.target.closest?.('.cell');
    if (target && +target.dataset.i !== this.focus) this.setFocus(+target.dataset.i, false);
    const n = this.n, i = this.focus, r = Math.floor(i / n), c = i % n;
    const go = { ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1] }[e.key];
    if (go) {
      e.preventDefault();
      const [nr, nc] = go;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n) this.setFocus(nr * n + nc);
      return;
    }
    if (e.key === '1') { e.preventDefault(); this.apply(i, A); }
    else if (e.key === '2') { e.preventDefault(); this.apply(i, B); }
    else if (['0', 'Backspace', 'Delete'].includes(e.key)) { e.preventDefault(); this.apply(i, EMPTY); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); }
  }

  apply(i, forced) {
    if (this.locked || this.givens[i] || this.hinted.has(i)) {
      if (this.givens[i] || this.hinted.has(i)) this.say('That tile is fixed.');
      return;
    }
    const cur = this.grid[i];
    let v = forced;
    if (v === undefined) {
      v = this.pen === 'a' ? A : this.pen === 'b' ? B : this.pen === 'erase' ? EMPTY : (cur === EMPTY ? A : cur === A ? B : EMPTY);
    }
    if (v === cur) return;
    this.history.push([i, cur]);
    this.set(i, v);
  }

  set(i, v) {
    this.grid[i] = v;
    this.moves.push([i, v]);
    const el = this.cells[i];
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    this.paint();
    this.onChange?.(this.grid, this.moves);
    if (isSolved(this.grid, this.n)) {
      this.locked = true;
      this.root.querySelector('.board').classList.add('solved');
      this.say('Puzzle complete!');
      this.onSolved?.(this.moves);
    }
  }

  undo() {
    if (this.locked) return;
    const last = this.history.pop();
    if (!last) return this.say('Nothing to undo.');
    this.set(last[0], last[1]);
  }

  reset() {
    if (this.locked) return;
    const changed = this.grid.some((v, i) => !this.givens[i] && !this.hinted.has(i) && v !== EMPTY);
    if (!changed) return;
    for (let i = 0; i < this.grid.length; i++) {
      if (!this.givens[i] && !this.hinted.has(i) && this.grid[i] !== EMPTY) { this.grid[i] = EMPTY; this.moves.push([i, EMPTY]); }
    }
    this.history = [];
    this.paint();
    this.onChange?.(this.grid, this.moves);
    this.say('Board cleared.');
  }

  applyHint(index, value) {
    this.hinted.add(index);
    this.grid[index] = value;
    this.history = this.history.filter(([i]) => i !== index);
    this.paint();
    this.cells[index].classList.add('hint-flash');
    this.say(`Hint: ${this.label(index)}`);
    this.onChange?.(this.grid, this.moves);
    if (isSolved(this.grid, this.n)) { this.locked = true; this.onSolved?.(this.moves); }
  }

  paint() {
    this.conflicts = findConflicts(this.grid, this.n);
    this.cells.forEach((el, i) => {
      const v = this.grid[i];
      el.className = `cell${v === A ? ' tile-a' : v === B ? ' tile-b' : ''}${this.givens[i] ? ' given' : ''}${this.hinted.has(i) ? ' hinted' : ''}${this.conflicts.has(i) ? ' conflict' : ''}${el.classList.contains('pop') ? ' pop' : ''}`;
      el.innerHTML = v ? tileSvg(this.theme, v === A ? 'a' : 'b', 24) : '';
      el.setAttribute('aria-label', this.label(i));
    });
    this.onConflicts?.(this.conflicts.size);
  }

  say(msg) { if (this.live) { this.live.textContent = ''; setTimeout(() => { this.live.textContent = msg; }, 30); } }
}
