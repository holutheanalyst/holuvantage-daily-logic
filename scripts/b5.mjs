import { generateSolution, createRng, generatePuzzle, validatePuzzle } from '../public/js/engine.js';
const d=process.argv[2];
for (let i=0;i<10;i++){ let s=Date.now(); generateSolution({easy:6,medium:8}[d], createRng('2026-10-0'+i+'|'+d)); console.log(i,'sol',Date.now()-s); s=Date.now(); const p=generatePuzzle('2026-10-0'+i,d); console.log(i,'gen',Date.now()-s, p.level); }
