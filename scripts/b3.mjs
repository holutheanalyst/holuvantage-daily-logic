import { generatePuzzle } from '../public/js/engine.js';
const s=Date.now(); const p=generatePuzzle('a','hard'); console.log('hard',Date.now()-s,p.level,p.clues);
