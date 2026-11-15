// Headless playtest: builds nothing, serves dist/, loads the game with URL params,
// lets it run, captures screenshots + console errors + sim stats.
// usage: node tools/screenshot.mjs "track=spa&mode=race&autopilot" seconds out.png [cam]
import { createRequire } from 'module';
import http from 'http'; import fs from 'fs'; import path from 'path';
const { chromium } = createRequire(import.meta.url)('playwright');
const [qs = 'track=spa&mode=race&autopilot', secs = '8', out = 'shots/shot.png', camIdx = '0'] = process.argv.slice(2);
const root = path.resolve('dist');
const srv = http.createServer((req, res) => {
  const p = path.join(root, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); });
}).listen(0);
const port = srv.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const t0 = Date.now();
await page.goto(`http://localhost:${port}/?autostart&${qs}`);
await page.waitForFunction(() => window.__game && window.__game.session, null, { timeout: 120000 });
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await page.evaluate((c) => window.__game.setCam(+c), camIdx);
const start = Date.now();
await page.evaluate((s) => window.__game.advance(s), +secs);
await page.waitForTimeout(1500);
const stats = await page.evaluate(() => { const g = window.__game, p = g.player; return { simTime: g.session.time.toFixed(1), speed: (p.car.speed * 3.6).toFixed(0), lap: p.lap, pos: p.pos, s: p.s.toFixed(0), off: p.car.offTrack }; });
const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 3000) requestAnimationFrame(f); else r((n / 3).toFixed(1)); }; requestAnimationFrame(f); }));
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out, timeout: 180000 });
console.log('stats', JSON.stringify(stats), 'fps(swiftshader)', fps, 'wall', ((Date.now() - start) / 1000).toFixed(0) + 's');
console.log(errors.slice(0, 15).join('\n') || 'no console errors');
await browser.close(); srv.close();
