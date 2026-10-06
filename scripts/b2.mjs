import { generateSolution, createRng, generatePuzzle } from '../public/js/engine.js';
for (const n of [6,8,10]) { const s=Date.now(); generateSolution(n, createRng('x'+n)); console.log('sol',n,Date.now()-s); }
for (const d of ['easy','medium']) { const s=Date.now(); const p=generatePuzzle('a',d); console.log(d,Date.now()-s,p.level,p.clues); }
