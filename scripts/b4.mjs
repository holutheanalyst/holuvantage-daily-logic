import { generateSolution, createRng, generatePuzzle, validatePuzzle } from '../public/js/engine.js';
for (let i=0;i<10;i++){ let s=Date.now(); generateSolution(10, createRng('2026-10-0'+i+'|hard')); const a=Date.now()-s; s=Date.now(); const p=generatePuzzle('2026-10-0'+i,'hard'); const b=Date.now()-s; s=Date.now(); const v=validatePuzzle(p); console.log(i,a,b,Date.now()-s,v.ok,p.level); }
