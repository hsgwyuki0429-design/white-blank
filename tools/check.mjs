// 実際に登り、落ち、扉をくぐれるか。目で見るのではなく数字で確かめる。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = join(process.cwd(), normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(f);
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('no'); }
});
await new Promise((r) => server.listen(8098, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  ignoreDefaultArgs: ['--headless=old'],
  args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--use-gl=angle', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const bad = [];
page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));

const results = [];
const ok = (n, pass, extra = '') => { results.push({ n, pass, extra }); };

for (const seedName of ['しろ', 'あお', 'seed-3']) {
  await page.goto('http://127.0.0.1:8098/?t=' + Date.now(), { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__wb, null, { timeout: 15000 });
  await page.fill('#seedinput', seedName);
  await page.dispatchEvent('#seedinput', 'change');
  await page.click('#start');
  await page.waitForFunction(() => window.__wb.playing, null, { timeout: 20000 });
  await page.waitForTimeout(500);

  // ── 階段を登れるか ──────────────────────────────────
  const stair = await page.evaluate(() => {
    const w = window.__wb.world;
    for (let r = 0; r < 16; r++)
      for (let dy = -2; dy <= 2; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (!w.open(dx, dy, dz)) continue;
        if (w.linkBits(dx, dy, dz) & 8) continue;   // 床に穴のあるセルは登る前に落ちる
        const v = w.vfeat(dx, dy, dz);
        if (!v || v.kind !== 1) continue;
        const D = { 0: [1, 0], 1: [-1, 0], 4: [0, 1], 5: [0, -1] }[v.dir];
        return { x: dx, y: dy, z: dz, dir: v.dir, dx: D[0], dz: D[1] };
      }
    return null;
  });
  if (stair) {
    const y1 = await page.evaluate((s) => {
      window.__wb.put((s.x + .5) * 3.4 - s.dx * 1.5, s.y * 2.7 + 0.5, (s.z + .5) * 3.4 - s.dz * 1.5);
      window.__wb.look(Math.atan2(-s.dx, -s.dz), -0.1);
      window.__wb.sim(0.6);                       // まず床に落ち着かせる
      window.__wb.sim(6, ['KeyW']);               // 6秒ぶん登る
      return window.__wb.body.y;
    }, stair);
    const y0 = stair.y * 2.7;
    ok(`${seedName} 階段を登る`, y1 - y0 > 2.3, `登った高さ=${(y1 - y0).toFixed(2)}m (1階層=2.7m)`);
  } else ok(`${seedName} 階段を登る`, false, '階段が見つからない');

  // ── 落下穴に落ちられるか ────────────────────────────
  const shaft = await page.evaluate(() => {
    const w = window.__wb.world;
    for (let r = 0; r < 16; r++)
      for (let dy = -2; dy <= 2; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (!w.open(dx, dy, dz)) continue;
        const v = w.vfeat(dx, dy, dz);
        if (!v || v.kind !== 0) continue;
        // 穴は隅寄せの2x2。その中心の上に立たせる
        const i0 = (v.corner === 1 || v.corner === 2) ? 2 : 0;
        const j0 = (v.corner === 2 || v.corner === 3) ? 2 : 0;
        return { x: dx * 3.4 + (i0 + 1) * 0.85, y: (dy + 1) * 2.7 + 0.4, z: dz * 3.4 + (j0 + 1) * 0.85, cell: dy };
      }
    return null;
  });
  if (shaft) {
    const st = await page.evaluate((s) => {
      window.__wb.put(s.x, s.y, s.z);
      window.__wb.sim(4);
      const b = window.__wb.body;
      return { y: b.y, g: b.grounded, vy: b.vy };
    }, shaft);
    const level = Math.floor((st.y + 0.35) / 2.7);
    ok(`${seedName} 穴に落ちて着地`, st.g && level <= shaft.cell,
       `着地=${st.g} 到達階層=${level} (穴のあった階層=${shaft.cell})`);
  } else ok(`${seedName} 穴に落ちて着地`, false, '穴が見つからない');

  // ── 壁に印を刻めるか ────────────────────────────────
  const mark = await page.evaluate(async () => {
    const w = window.__wb.world, b = window.__wb.body;
    // 壁のあるセルを探して、その壁を向く
    for (let r = 0; r < 10; r++)
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (!w.open(dx, 0, dz)) continue;
        const bits = w.linkBits(dx, 0, dz);
        for (const [d, yaw] of [[0, -Math.PI / 2], [1, Math.PI / 2], [4, Math.PI], [5, 0]]) {
          if (bits & (1 << d)) continue;
          window.__wb.put((dx + .5) * 3.4, 0.1, (dz + .5) * 3.4);
          window.__wb.look(yaw, 0);
          return true;
        }
      }
    return false;
  });
  if (mark) {
    await page.evaluate(() => window.__wb.sim(0.5));
    await page.waitForTimeout(900);            // 見えている面が揃うのを待つ
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(200);
    const n1 = await page.evaluate(() => JSON.parse(localStorage.getItem('wb:marks:' + document.body.dataset.seed) || '[]').length);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(200);
    const n2 = await page.evaluate(() => JSON.parse(localStorage.getItem('wb:marks:' + document.body.dataset.seed) || '[]').length);
    ok(`${seedName} 印を刻んで消す`, n1 === 1 && n2 === 0, `刻んだ後=${n1} 消した後=${n2}`);
  } else ok(`${seedName} 印を刻んで消す`, false, '壁が見つからない');

  // ── 扉をくぐれるか ──────────────────────────────────
  await page.evaluate(() => {
    const d = window.__wb.doorPos(), g = window.__wb.goal();
    const n = { 0: [-1, 0, 0], 1: [1, 0, 0], 4: [0, 0, -1], 5: [0, 0, 1] }[g.dir];
    window.__wb.put(d.x + n[0] * 1.8, g.y * 2.7 + 0.1, d.z + n[2] * 1.8);
    window.__wb.look(Math.atan2(n[0], n[2]), 0);
  });
  await page.evaluate(() => { window.__wb.sim(0.4); window.__wb.sim(4, ['KeyW']); });
  const cleared = await page.evaluate(() => !document.getElementById('clear').hidden);
  ok(`${seedName} 扉に入る`, cleared, cleared ? '' : '届かなかった');

  // ── 長く歩いても世界から抜け落ちないか ──────────────
  const wander = await page.evaluate(() => {
    const w = window.__wb.world, b = window.__wb.body;
    const YAW = { 0: -Math.PI / 2, 1: Math.PI / 2, 4: Math.PI, 5: 0 };
    const BACK = { 0: 1, 1: 0, 4: 5, 5: 4 };
    let last = -1, outside = 0, minY = 0, maxY = 0, dist = 0;
    let px = b.x, pz = b.z;
    for (let n = 0; n < 110; n++) {
      const cx = Math.floor(b.x / 3.4), cy = Math.floor((b.y + 0.35) / 2.7), cz = Math.floor(b.z / 3.4);
      if (!w.open(cx, cy, cz)) outside++;               // 岩の中にいたら異常
      minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y);
      const bits = w.linkBits(cx, cy, cz);
      const opts = [0, 1, 4, 5].filter((d) => bits & (1 << d));
      if (opts.length) {
        const fwd = opts.filter((d) => d !== BACK[last]);
        const d = (fwd.length ? fwd : opts)[Math.floor(Math.random() * (fwd.length || opts.length))];
        last = d;
        window.__wb.look(YAW[d], 0);
      }
      window.__wb.sim(1.4, ['KeyW']);
      dist += Math.hypot(b.x - px, b.z - pz); px = b.x; pz = b.z;
    }
    return { outside, minY, maxY, dist, chunks: window.__wb.chunks, y: b.y, g: b.grounded };
  });
  ok(`${seedName} 長く歩いても壁の中に落ちない`,
     wander.outside === 0 && wander.minY > -400 && wander.chunks <= 30,
     `${wander.dist.toFixed(0)}m 歩行 / 岩の中=${wander.outside}回 / 深さ ${wander.minY.toFixed(1)}〜${wander.maxY.toFixed(1)}m / チャンク数=${wander.chunks}`);

  // ── 同じ種なら同じ世界か ────────────────────────────
  const sig = await page.evaluate(() => {
    const w = window.__wb.world; let h = 0;
    for (let x = -6; x < 6; x++) for (let y = -2; y < 2; y++) for (let z = -6; z < 6; z++)
      h = (h * 31 + (w.open(x, y, z) ? w.linkBits(x, y, z) + 1 : 0)) | 0;
    return h;
  });
  await page.evaluate((s) => window.__wb.setup(s), await page.evaluate(() => +document.body.dataset.seed));
  const sig2 = await page.evaluate(() => {
    const w = window.__wb.world; let h = 0;
    for (let x = -6; x < 6; x++) for (let y = -2; y < 2; y++) for (let z = -6; z < 6; z++)
      h = (h * 31 + (w.open(x, y, z) ? w.linkBits(x, y, z) + 1 : 0)) | 0;
    return h;
  });
  ok(`${seedName} 作り直しても同じ世界`, sig === sig2, `${sig} / ${sig2}`);
}

let fail = 0;
for (const r of results) {
  if (!r.pass) fail++;
  console.log(`${r.pass ? ' OK ' : 'NG  '} ${r.n}${r.extra ? '   … ' + r.extra : ''}`);
}
if (bad.length) { console.log('\n例外:'); bad.forEach((b) => console.log('  ' + b)); }
console.log(`\n${results.length - fail} / ${results.length} 通過`);
await browser.close(); server.close();
process.exit(fail || bad.length ? 1 : 0);
