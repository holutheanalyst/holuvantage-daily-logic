// HoluVantage Daily Logic — puzzle engine.
// Pure, deterministic functions shared by the browser and the server.
// Puzzle: a two-tile balance grid. Rules:
//  1. Every row and column holds the same number of each tile.
//  2. No more than two identical tiles may sit next to each other in a row or column.
//  3. No two rows are identical, and no two columns are identical.

export const EMPTY = 0, A = 1, B = 2;
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const SIZES = { easy: 6, medium: 8, hard: 10 };
// Max logical level a difficulty may need: 1 = basic rules only, 2 = one-step "what if" reasoning.
const MAX_LEVEL = { easy: 1, medium: 1, hard: 2 };
// Minimum share of clues kept, so easy stays gentle.
const MIN_CLUE_RATIO = { easy: 0.45, medium: 0.3, hard: 0 };

// ---------- Seeded randomness ----------
export function hashString(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

export function createRng(seed) {
  let [a, b, c, d] = hashString(String(seed));
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- Geometry ----------
const lineCache = new Map();
export function lines(n) {
  if (!lineCache.has(n)) {
    const rows = [], cols = [];
    for (let r = 0; r < n; r++) rows.push(Array.from({ length: n }, (_, c) => r * n + c));
    for (let c = 0; c < n; c++) cols.push(Array.from({ length: n }, (_, r) => r * n + c));
    lineCache.set(n, { rows, cols, all: rows.concat(cols) });
  }
  return lineCache.get(n);
}

export const opposite = (v) => (v === A ? B : A);

// ---------- Validity ----------
function lineKey(grid, line) {
  let s = '';
  for (const i of line) { if (!grid[i]) return null; s += grid[i]; }
  return s;
}

// True when no rule is broken by the filled cells (empty cells allowed).
export function isValidPartial(grid, n) {
  const half = n / 2;
  const { rows, cols, all } = lines(n);
  for (const line of all) {
    let ca = 0, cb = 0;
    for (let k = 0; k < n; k++) {
      const v = grid[line[k]];
      if (v === A) ca++; else if (v === B) cb++;
      if (k >= 2 && v && v === grid[line[k - 1]] && v === grid[line[k - 2]]) return false;
    }
    if (ca > half || cb > half) return false;
  }
  for (const group of [rows, cols]) {
    const seen = new Set();
    for (const line of group) {
      const key = lineKey(grid, line);
      if (key) { if (seen.has(key)) return false; seen.add(key); }
    }
  }
  return true;
}

export const isFull = (grid) => grid.every((v) => v !== EMPTY);
export const isSolved = (grid, n) => isFull(grid) && isValidPartial(grid, n);

// Cells currently breaking a rule — used for on-screen feedback.
export function findConflicts(grid, n) {
  const bad = new Set();
  const half = n / 2;
  const { rows, cols, all } = lines(n);
  for (const line of all) {
    let ca = 0, cb = 0;
    for (let k = 0; k < n; k++) {
      const v = grid[line[k]];
      if (v === A) ca++; else if (v === B) cb++;
      if (k >= 2 && v && v === grid[line[k - 1]] && v === grid[line[k - 2]]) {
        bad.add(line[k]); bad.add(line[k - 1]); bad.add(line[k - 2]);
      }
    }
    if (ca > half) line.forEach((i) => grid[i] === A && bad.add(i));
    if (cb > half) line.forEach((i) => grid[i] === B && bad.add(i));
  }
  for (const group of [rows, cols]) {
    const seen = new Map();
    for (const line of group) {
      const key = lineKey(grid, line);
      if (!key) continue;
      if (seen.has(key)) { line.forEach((i) => bad.add(i)); seen.get(key).forEach((i) => bad.add(i)); }
      else seen.set(key, line);
    }
  }
  return bad;
}

// ---------- Logical propagation ----------
// Applies the basic deductions until nothing changes. Returns false on contradiction.
export function propagate(grid, n) {
  const half = n / 2;
  const { all } = lines(n);
  let changed = true;
  while (changed) {
    changed = false;
    for (const line of all) {
      for (let k = 0; k + 2 < n; k++) {
        const i0 = line[k], i1 = line[k + 1], i2 = line[k + 2];
        const v0 = grid[i0], v1 = grid[i1], v2 = grid[i2];
        if (v0 && v0 === v1 && !v2) { grid[i2] = opposite(v0); changed = true; }
        else if (v1 && v1 === v2 && !v0) { grid[i0] = opposite(v1); changed = true; }
        else if (v0 && v0 === v2 && !v1) { grid[i1] = opposite(v0); changed = true; }
      }
      let ca = 0, cb = 0, ce = 0;
      for (const i of line) { const v = grid[i]; if (v === A) ca++; else if (v === B) cb++; else ce++; }
      if (ce && (ca === half || cb === half)) {
        const fill = ca === half ? B : A;
        for (const i of line) if (!grid[i]) grid[i] = fill;
        changed = true;
      }
    }
    if (!isValidPartial(grid, n)) return false;
  }
  return true;
}

// Level 2: try each value in each empty cell; if it leads to a contradiction, the other value is forced.
function trialStep(grid, n) {
  for (let i = 0; i < grid.length; i++) {
    if (grid[i]) continue;
    for (const v of [A, B]) {
      const copy = grid.slice();
      copy[i] = v;
      if (!propagate(copy, n)) { grid[i] = opposite(v); return true; }
    }
  }
  return false;
}

// Returns the lowest logical level that solves the puzzle (1, 2) or 3 if it needs guessing.
export function solveLevel(givens, n) {
  const g = givens.slice();
  if (!propagate(g, n)) return 3;
  if (isSolved(g, n)) return 1;
  while (true) {
    if (!trialStep(g, n)) return 3;
    if (!propagate(g, n)) return 3;
    if (isSolved(g, n)) return 2;
  }
}

// Counts solutions up to `limit` (backtracking with propagation).
export function countSolutions(givens, n, limit = 2) {
  let count = 0;
  const walk = (g) => {
    if (count >= limit) return;
    if (!propagate(g, n)) return;
    const idx = g.indexOf(EMPTY);
    if (idx === -1) { if (isValidPartial(g, n)) count++; return; }
    for (const v of [A, B]) { const c = g.slice(); c[idx] = v; walk(c); if (count >= limit) return; }
  };
  walk(givens.slice());
  return count;
}

export function solve(givens, n) {
  let found = null;
  const walk = (g) => {
    if (found || !propagate(g, n)) return;
    const idx = g.indexOf(EMPTY);
    if (idx === -1) { if (isValidPartial(g, n)) found = g; return; }
    for (const v of [A, B]) { const c = g.slice(); c[idx] = v; walk(c); if (found) return; }
  };
  walk(givens.slice());
  return found;
}

// ---------- Generation ----------
const rowCache = new Map();
function validRows(n) {
  if (!rowCache.has(n)) {
    const out = [];
    const build = (row, ca, cb) => {
      if (row.length === n) { out.push(row.slice()); return; }
      for (const v of [A, B]) {
        if (v === A && ca === n / 2) continue;
        if (v === B && cb === n / 2) continue;
        const k = row.length;
        if (k >= 2 && row[k - 1] === v && row[k - 2] === v) continue;
        row.push(v); build(row, ca + (v === A), cb + (v === B)); row.pop();
      }
    };
    build([], 0, 0);
    rowCache.set(n, out);
  }
  return rowCache.get(n);
}

export function generateSolution(n, rand) {
  const candidates = validRows(n);
  const rows = [];
  const fits = (row) => {
    const r = rows.length;
    for (let c = 0; c < n; c++) {
      if (r >= 2 && rows[r - 1][c] === row[c] && rows[r - 2][c] === row[c]) return false;
      let count = 0;
      for (let k = 0; k < r; k++) if (rows[k][c] === row[c]) count++;
      if (count + 1 > n / 2) return false;
    }
    return !rows.some((x) => x.join('') === row.join(''));
  };
  const place = () => {
    if (rows.length === n) {
      const grid = rows.flat();
      return isValidPartial(grid, n) ? grid : null;
    }
    for (const row of shuffle(candidates.slice(), rand)) {
      if (!fits(row)) continue;
      rows.push(row);
      const done = place();
      if (done) return done;
      rows.pop();
    }
    return null;
  };
  return place();
}

export function generatePuzzle(seed, difficulty) {
  const n = SIZES[difficulty];
  if (!n) throw new Error('Unknown difficulty');
  const rand = createRng(`${seed}|${difficulty}`);
  const solution = generateSolution(n, rand);
  const givens = solution.slice();
  const minClues = Math.ceil(n * n * MIN_CLUE_RATIO[difficulty]);
  let clues = n * n;
  for (const idx of shuffle([...givens.keys()], rand)) {
    if (clues <= minClues) break;
    const keep = givens[idx];
    givens[idx] = EMPTY;
    if (countSolutions(givens, n, 2) !== 1 || solveLevel(givens, n) > MAX_LEVEL[difficulty]) givens[idx] = keep;
    else clues--;
  }
  return { n, difficulty, givens, solution, level: solveLevel(givens, n), clues };
}

// Full pre-publication check. Returns { ok, errors }.
export function validatePuzzle(p) {
  const errors = [];
  const n = SIZES[p.difficulty];
  if (!n || p.n !== n) errors.push('size does not match difficulty');
  if (!Array.isArray(p.givens) || p.givens.length !== n * n) errors.push('bad givens');
  if (!Array.isArray(p.solution) || !isSolved(p.solution, n)) errors.push('solution breaks the rules');
  if (errors.length) return { ok: false, errors };
  if (p.givens.some((v, i) => v !== EMPTY && v !== p.solution[i])) errors.push('givens contradict solution');
  if (!isValidPartial(p.givens, n)) errors.push('givens contain contradictory clues');
  const count = countSolutions(p.givens, n, 2);
  if (count === 0) errors.push('no solution');
  if (count > 1) errors.push('more than one solution');
  const solved = solve(p.givens, n);
  if (!solved || solved.join('') !== p.solution.join('')) errors.push('intended solution not reachable');
  const level = solveLevel(p.givens, n);
  if (level > MAX_LEVEL[p.difficulty]) errors.push(`needs level ${level} reasoning, above ${p.difficulty}`);
  return { ok: errors.length === 0, errors, level };
}

// Generates a validated puzzle, regenerating with a new seed if needed.
export function generateValidPuzzle(seed, difficulty, maxTries = 8) {
  for (let t = 0; t < maxTries; t++) {
    const p = generatePuzzle(t ? `${seed}#${t}` : seed, difficulty);
    if (validatePuzzle(p).ok) return { ...p, seedSuffix: t };
  }
  throw new Error('Could not generate a valid puzzle');
}

export function fingerprint(grid) {
  return hashString(grid.join('')).map((x) => x.toString(16).padStart(8, '0')).join('');
}

// ---------- Scoring ----------
const SCORE_BASE = { easy: 1000, medium: 2000, hard: 3000 };
const SCORE_TIME = { easy: 2, medium: 3, hard: 4 }; // points lost per second
export function computeScore({ difficulty, timeMs, mistakes, hints }) {
  const base = SCORE_BASE[difficulty];
  const secs = Math.max(0, Math.round(timeMs / 1000));
  const raw = base - secs * SCORE_TIME[difficulty] - mistakes * 50 - hints * 150;
  return Math.max(Math.round(base * 0.1), Math.round(raw));
}

// Minimum believable solve time: ~0.25s per empty cell.
export function minPlausibleMs(givens) {
  return givens.filter((v) => v === EMPTY).length * 250;
}

// One logical next step from the current grid (for hints). Returns index or -1.
export function nextLogicalCell(grid, n) {
  const g = grid.slice();
  if (!propagate(g, n)) return -1;
  for (let i = 0; i < g.length; i++) if (!grid[i] && g[i]) return i;
  return -1;
}
