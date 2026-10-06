import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePuzzle, generateValidPuzzle, validatePuzzle, isSolved, isValidPartial, countSolutions,
  findConflicts, computeScore, SIZES, EMPTY, A, B, nextLogicalCell, solveLevel,
} from '../public/js/engine.js';

test('generation is deterministic for the same seed', () => {
  for (const d of ['easy', 'medium', 'hard']) {
    const a = generatePuzzle('seed-1', d), b = generatePuzzle('seed-1', d);
    assert.deepEqual(a.givens, b.givens);
    assert.deepEqual(a.solution, b.solution);
  }
});

test('different seeds give different puzzles', () => {
  assert.notDeepEqual(generatePuzzle('x', 'medium').givens, generatePuzzle('y', 'medium').givens);
});

test('every generated puzzle passes full validation across many seeds', () => {
  for (const d of ['easy', 'medium', 'hard']) {
    for (let i = 0; i < 12; i++) {
      const p = generateValidPuzzle(`batch-${i}`, d);
      const v = validatePuzzle(p);
      assert.ok(v.ok, `${d} #${i}: ${v.errors}`);
      assert.equal(p.n, SIZES[d]);
      assert.equal(countSolutions(p.givens, p.n, 2), 1);
      assert.ok(isSolved(p.solution, p.n));
    }
  }
});

test('difficulty classification', () => {
  for (let i = 0; i < 6; i++) {
    assert.equal(solveLevel(generatePuzzle(`e${i}`, 'easy').givens, 6), 1);
    assert.equal(solveLevel(generatePuzzle(`m${i}`, 'medium').givens, 8), 1);
    assert.ok(solveLevel(generatePuzzle(`h${i}`, 'hard').givens, 10) <= 2);
  }
});

test('validation rejects broken puzzles', () => {
  const p = generatePuzzle('bad', 'easy');
  const tampered = { ...p, givens: p.givens.map((v, i) => (i === p.givens.findIndex((x) => x) ? (v === A ? B : A) : v)) };
  assert.equal(validatePuzzle(tampered).ok, false);
  const ambiguous = { ...p, givens: Array(36).fill(EMPTY) };
  assert.equal(validatePuzzle(ambiguous).ok, false);
});

test('rules: triples, counts and duplicate lines are detected', () => {
  const n = 6, g = Array(36).fill(EMPTY);
  g[0] = g[1] = g[2] = A;
  assert.equal(isValidPartial(g, n), false);
  assert.deepEqual([...findConflicts(g, n)].sort(), [0, 1, 2]);
  const full = generatePuzzle('dup', 'easy').solution.slice();
  for (let c = 0; c < 6; c++) full[6 + c] = full[c];
  assert.equal(isValidPartial(full, n), false);
});

test('next logical cell is a correct deduction', () => {
  const p = generatePuzzle('hint', 'medium');
  const i = nextLogicalCell(p.givens, p.n);
  assert.ok(i >= 0 && p.givens[i] === EMPTY);
});

test('score calculation', () => {
  assert.equal(computeScore({ difficulty: 'easy', timeMs: 60000, mistakes: 0, hints: 0 }), 880);
  assert.equal(computeScore({ difficulty: 'hard', timeMs: 120000, mistakes: 2, hints: 1 }), 3000 - 480 - 100 - 150);
  assert.equal(computeScore({ difficulty: 'medium', timeMs: 1e9, mistakes: 99, hints: 9 }), 200);
});
