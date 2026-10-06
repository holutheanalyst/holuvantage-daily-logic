import { generatePuzzle, validatePuzzle, countSolutions, solve, solveLevel, isValidPartial } from '../public/js/engine.js';
const p=generatePuzzle('2026-10-00','easy');
let s=Date.now(); isValidPartial(p.givens,6); console.log('valid',Date.now()-s);
s=Date.now(); countSolutions(p.givens,6,2); console.log('count',Date.now()-s);
s=Date.now(); console.log(solve(p.givens,6)?.length); console.log('solve',Date.now()-s);
