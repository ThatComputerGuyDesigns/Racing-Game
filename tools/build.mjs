// Bundles the game into dist/ (index.html + game.js). No manual steps.
import * as esbuild from 'esbuild';
import fs from 'fs';
fs.mkdirSync('dist', { recursive: true });
await esbuild.build({
  entryPoints: ['src/game/main.js'], bundle: true, minify: true, format: 'esm',
  target: 'es2020', outfile: 'dist/game.js', sourcemap: false, logLevel: 'warning',
});
fs.copyFileSync('index.html', 'dist/index.html');
// artifact.html: same page without the document skeleton (the claude.ai host adds its own)
const html = fs.readFileSync('index.html', 'utf8')
  .replace(/<!doctype html>\s*/i, '').replace(/<\/?html[^>]*>\s*/gi, '').replace(/<\/?head>\s*/gi, '').replace(/<\/?body>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '').replace(/<meta name="viewport"[^>]*>\s*/i, '');
fs.writeFileSync('dist/artifact.html', html);
console.log('built dist/ (' + (fs.statSync('dist/game.js').size / 1024).toFixed(0) + ' KB)');
