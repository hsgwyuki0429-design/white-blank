// 落下も吹き抜けも一方通行。だから「行けるところから、必ず帰ってこられるか」を確かめる。
// 前向きの辺をぜんぶ作ってから逆向きに辿り、集合が一致するかを見る。
import { World, DX, DZ, V_STAIR, V_OPEN } from '../src/world.js';

const R = Number(process.argv[3] || 20);
const seeds = process.argv[2] ? [Number(process.argv[2])] : [1, 7, 12345, 999, 4242, 31337, 8080, 55555];
const YLO = -16, YHI = 6;
const inBox = (x, y, z) => Math.abs(x) <= R && Math.abs(z) <= R && y >= YLO && y <= YHI;

let bad = 0;
for (const seed of seeds) {
  const w = new World(seed);

  /** 床のないセルに入ると、床のあるところまで落ちる。 */
  const fall = (x, y, z) => {
    for (let n = 0; n < 40; n++) {
      if (!inBox(x, y, z) || !w.open(x, y, z)) return null;
      if (w.hasFloor(x, y, z)) return [x, y, z];
      y--;
    }
    return null;
  };

  // 前向きの辺
  const fwdE = new Map(), revE = new Map();
  const add = (a, b) => {
    if (!fwdE.has(a)) fwdE.set(a, []);
    if (!revE.has(b)) revE.set(b, []);
    fwdE.get(a).push(b); revE.get(b).push(a);
  };
  const stand = [];
  for (let y = YLO; y <= YHI; y++) for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) {
    if (!w.open(x, y, z) || !w.hasFloor(x, y, z)) continue;
    const a = x + ',' + y + ',' + z;
    stand.push([x, y, z]);
    for (const d of [0, 1, 4, 5]) {
      if (!w.linked(x, y, z, d)) continue;
      const t = fall(x + DX[d], y, z + DZ[d]);
      if (t) add(a, t.join(','));
    }
    const v = w.vfeat(x, y, z);
    if (v && v.kind === V_STAIR) add(a, x + ',' + (y + 1) + ',' + z);
    if (w.linked(x, y, z, 3)) {
      const t = fall(x, y - 1, z);
      if (t) add(a, t.join(','));
    }
  }

  // 原点にいちばん近い「立てる場所」から始める。箱のふちから始めると外に出られない
  let start = null, bestD = Infinity;
  for (const c of stand) {
    const d = c[0] * c[0] + c[2] * c[2] + Math.abs(c[1]) * 30;
    if (d < bestD) { bestD = d; start = c; }
  }

  const flood = (E) => {
    const seen = new Set([start.join(',')]), q = [start.join(',')];
    for (let h = 0; h < q.length; h++) for (const n of (E.get(q[h]) || [])) {
      if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
    return seen;
  };
  const fwd = flood(fwdE), rev = flood(revE);
  const inner = (k) => { const [x, y, z] = k.split(',').map(Number);
    return Math.abs(x) <= R - 8 && Math.abs(z) <= R - 8 && y >= YLO + 5 && y <= YHI - 2; };
  const trapped = [...fwd].filter((k) => inner(k) && !rev.has(k));
  const innerN = [...fwd].filter(inner).length;
  const deepest = [...fwd].reduce((mn, k) => Math.min(mn, +k.split(',')[1]), 0);
  if (trapped.length) bad++;
  console.log(`種 ${String(seed).padStart(6)}  立てる場所 ${String(stand.length).padStart(5)}  ` +
    `到達 ${String(fwd.size).padStart(5)}  最深 ${String(deepest).padStart(3)}階  ` +
    `内側${innerN}中 帰れない ${trapped.length}` + (trapped.length ? '  例: ' + trapped.slice(0, 3).join(' / ') : ''));
}
console.log(bad ? `\n${bad} 種で窪地あり` : '\nどの種でも、行った先から必ず帰ってこられる');
process.exit(bad ? 1 : 0);
