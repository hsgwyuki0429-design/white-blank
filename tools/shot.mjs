// ヘッドレスのChromiumで実際に遊んで、絵と診断を持ち帰る。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const b = await readFile(f);
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end('no'); }
});
await new Promise((r) => server.listen(8099, r));

const browser = await chromium.launch({
  executablePath: process.env.WB_CHROME || '/opt/pw-browsers/chromium',
  ignoreDefaultArgs: ['--headless=old'],
  args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--use-gl=angle', '--disable-gpu-sandbox', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto('http://127.0.0.1:8099/?t=' + Date.now(), { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__wb, null, { timeout: 15000 });

const seed = process.argv[2] || 'しろ';
await page.fill('#seedinput', seed);
await page.dispatchEvent('#seedinput', 'change');
const t0 = Date.now();
await page.click('#start');
await page.waitForFunction(() => window.__wb.playing, null, { timeout: 20000 });
const bootMs = Date.now() - t0;

const shots = [];
async function shot(name) {
  await page.waitForTimeout(420);
  const f = `shots/${name}.png`;
  await page.screenshot({ path: f });
  shots.push(f);
}

await page.waitForTimeout(900);
for (let i = 0; i < 4; i++) {
  await page.evaluate((a) => window.__wb.look(a, -0.06), (i * Math.PI) / 2);
  await shot('look' + i);
}

// 迷路を実際に辿って歩く。開いている方向へ、行き止まりなら曲がる
const CELL = 5.6, LEVEL = 2.7;
const DIRYAW = { 0: -Math.PI / 2, 1: Math.PI / 2, 4: Math.PI, 5: 0 };
let lastDir = -1;
for (let leg = 0; leg < 10; leg++) {
  const dir = await page.evaluate(([last]) => {
    const b = window.__wb.body, w = window.__wb.world;
    const cx = Math.floor(b.x / 5.6), cy = Math.floor((b.y + 0.35) / 2.7), cz = Math.floor(b.z / 5.6);
    const bits = w.linkBits(cx, cy, cz);
    const opts = [0, 1, 4, 5].filter((d) => bits & (1 << d));
    if (!opts.length) return -1;
    const back = { 0: 1, 1: 0, 4: 5, 5: 4 }[last];
    const fwd = opts.filter((d) => d !== back);
    return (fwd.length ? fwd : opts)[Math.floor(Math.random() * (fwd.length || opts.length))];
  }, [lastDir]);
  if (dir < 0) break;
  lastDir = dir;
  await page.evaluate((y) => window.__wb.look(y, -0.05), DIRYAW[dir]);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1300);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(220);
  if (leg % 2 === 1) await shot('walk' + leg);
}

// 特徴のある場所を探して撮る
async function visit(name, finder) {
  const at = await page.evaluate(finder);
  if (!at) { console.error('見つからず: ' + name); return; }
  await page.evaluate((a) => { window.__wb.put(a[0], a[1], a[2]); window.__wb.look(a[3], a[4]); }, at);
  await page.waitForTimeout(700);
  await shot(name);
}

async function findVertical(name, want) {
  await visit(name, new Function('want', `
    const w = window.__wb.world, b = window.__wb.body;
    const c0 = [Math.floor(b.x / 5.6), Math.floor((b.y + .35) / 2.7), Math.floor(b.z / 5.6)];
    for (let r = 0; r < 16; r++)
      for (let dy = -2; dy <= 2; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = c0[0] + dx, y = c0[1] + dy, z = c0[2] + dz;
        if (!w.open(x, y, z) || !w.linked(x, y, z, 2)) continue;
        const v = w.vfeat(x, y, z);
        if (v.kind !== 1 || !!v.smooth !== ${want}) continue;
        const yaw = { 0: -Math.PI / 2, 1: Math.PI / 2, 4: Math.PI, 5: 0 }[v.dir];
        return [(x + .5) * 5.6 + Math.sin(yaw) * 2.3, y * 2.7 + .1, (z + .5) * 5.6 + Math.cos(yaw) * 2.3, yaw, 0.16];
      }
    return null;`));
}
await findVertical('stair', false);
await findVertical('slope', true);

await visit('void', () => {
  const w = window.__wb.world, b = window.__wb.body;
  const c0 = [Math.floor(b.x / 5.6), Math.floor(b.z / 5.6)];
  for (let r = 0; r < 40; r++)
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = c0[0] + dx, z = c0[1] + dz;
      for (let y = 3; y > -22; y--) {
        if (!window.__wb.isVoid(x, y, z)) continue;
        if (window.__wb.isVoid(x, y - 1, z)) continue;      // 底を探す
        window.__wb.setCenter(x, y, z);
        return [(x + .5) * 5.6, y * 2.7 + 0.1, (z + .5) * 5.6, 0.9, 0.62];
      }
    }
  return null;
});

await visit('low', () => {
  const w = window.__wb.world, b = window.__wb.body;
  const c0 = [Math.floor(b.x / 5.6), Math.floor((b.y + .35) / 2.7), Math.floor(b.z / 5.6)];
  for (let r = 0; r < 16; r++)
    for (let dy = -2; dy <= 2; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = c0[0] + dx, y = c0[1] + dy, z = c0[2] + dz;
      if (!w.open(x, y, z) || !window.__wb.isLow(x, y, z) || !w.hasFloor(x, y, z)) continue;
      const bits = w.linkBits(x, y, z);
      for (const [d, yaw] of [[0, -Math.PI / 2], [1, Math.PI / 2], [4, Math.PI], [5, 0]]) {
        if (!(bits & (1 << d))) continue;
        return [(x + .5) * 5.6 - Math.sin(yaw) * 1.6, y * 2.7 + .1, (z + .5) * 5.6 - Math.cos(yaw) * 1.6, yaw, 0.05];
      }
    }
  return null;
});

await visit('bridge', () => {
  const w = window.__wb.world, b = window.__wb.body;
  const c0 = [Math.floor(b.x / 5.6), Math.floor(b.z / 5.6)];
  for (let r = 0; r < 60; r++)
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = c0[0] + dx, z = c0[1] + dz;
      for (let y = 2; y > -32; y--) {
        if (!window.__wb.isBridge(x, y, z)) continue;
        window.__wb.setCenter(x, y, z);
        return [(x + .5) * 5.6, y * 2.7 + 0.1, (z + .5) * 5.6, -Math.PI / 2, 0.02];
      }
    }
  return null;
});

await visit('shaft', () => {
  const w = window.__wb.world, b = window.__wb.body;
  const c0 = [Math.floor(b.x / 5.6), Math.floor((b.y + .35) / 2.7), Math.floor(b.z / 5.6)];
  for (let r = 0; r < 14; r++)
    for (let dy = -2; dy <= 2; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = c0[0] + dx, y = c0[1] + dy, z = c0[2] + dz;
      if (!w.open(x, y, z)) continue;
      const v = w.vfeat(x, y, z);
      if (!v || v.kind !== 0) continue;
      // 穴は「そのセルの天井」にあるので、ひとつ上の階から覗きこむ
      return [(x + .5) * 5.6, (y + 1) * 2.7 + .1, (z + .5) * 5.6, 0.7, -0.72];
    }
  return null;
});

await visit('door', () => {
  const d = window.__wb.doorPos(), g = window.__wb.goal();
  const n = { 0: [-1, 0, 0], 1: [1, 0, 0], 4: [0, 0, -1], 5: [0, 0, 1] }[g.dir];
  const yaw = Math.atan2(n[0], n[2]);   // 扉のほうを向く
  return [(g.x + .5) * 5.6 + n[0] * 0.9, g.y * 2.7 + 0.1, (g.z + .5) * 5.6 + n[2] * 0.9, yaw, 0.0];
});

// ランドマークをひとつずつ撮る
for (const name of ['cathedral', 'compression', 'stairs', 'stacked', 'nested', 'descent']) {
  const info = await page.evaluate((n) => window.__wb.jump(n), name);
  if (!info) { console.error('見つからず: ' + name); continue; }
  await page.waitForTimeout(900);
  await shot('lm-' + name);
}

const stats = await page.evaluate(() => {
  const r = window.__wb.renderer.info.render;
  const b = window.__wb.body;
  return {
    tris: r.triangles, calls: r.calls, chunks: window.__wb.chunks,
    pos: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)],
    grounded: b.grounded, goal: window.__wb.goal(),
  };
});

// 何コマ出るか
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t = performance.now();
  (function f() { n++; performance.now() - t < 1000 ? requestAnimationFrame(f) : res(n); })();
}));

console.log(JSON.stringify({ bootMs, fps, ...stats, shots, errors: errors.slice(0, 12) }, null, 1));
await browser.close();
server.close();
