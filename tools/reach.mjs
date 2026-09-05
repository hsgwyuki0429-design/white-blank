// 落下穴は一方通行。だから「行けるところから、必ず帰ってこられるか」を確かめる。
// 行き先の集合と、帰ってこられる集合が一致していなければ、どこかに窪地がある。
import { World, DX, DY, DZ, OPP, V_STAIR } from '../src/world.js';

const R = Number(process.argv[3] || 22);
const seeds = process.argv[2] ? [Number(process.argv[2])] : [1, 7, 12345, 999, 4242, 31337, 8080, 55555];
const inBox = (x, y, z) => Math.abs(x) <= R && Math.abs(z) <= R && y >= -14 && y <= 6;

let bad = 0;
for (const seed of seeds) {
  const w = new World(seed);
  let start = null;
  for (let r = 0; r < 20 && !start; r++)
    for (let x = -r; x <= r && !start; x++) for (let z = -r; z <= r && !start; z++)
      if (w.open(x, 0, z)) start = [x, 0, z];

  // 進める向き（前向き）と、そこから来られる向き（後ろ向き）
  function edges(x, y, z, back) {
    const out = [];
    for (const d of [0, 1, 4, 5]) if (w.linked(x, y, z, d)) out.push([x + DX[d], y, z + DZ[d]]);
    if (w.linked(x, y, z, 2)) {                       // 上へ
      const v = w.vfeat(x, y, z);
      if (back ? true : v.kind === V_STAIR) out.push([x, y + 1, z]);
    }
    if (w.linked(x, y, z, 3)) {                       // 下へ
      const v = w.vfeat(x, y - 1, z);
      if (back ? v.kind === V_STAIR : true) out.push([x, y - 1, z]);
    }
    return out;
  }

  function flood(back) {
    const seen = new Set([start.join(',')]);
    const q = [start];
    for (let h = 0; h < q.length; h++) {
      const [x, y, z] = q[h];
      for (const n of edges(x, y, z, back)) {
        if (!inBox(...n)) continue;
        const k = n.join(',');
        if (seen.has(k)) continue;
        seen.add(k); q.push(n);
      }
    }
    return seen;
  }

  const fwd = flood(false);      // 行けるところ
  const rev = flood(true);       // 帰ってこられるところ
  // 箱のふちは、外を回れば帰れる道を切ってしまうので数えない
  const inner = (k) => { const [x, y, z] = k.split(',').map(Number);
    return Math.abs(x) <= R - 10 && Math.abs(z) <= R - 10 && y >= -9 && y <= 4; };
  const trapped = [...fwd].filter((k) => inner(k) && !rev.has(k));
  const innerN = [...fwd].filter(inner).length;
  const deepest = [...fwd].reduce((m, k) => Math.min(m, +k.split(',')[1]), 0);
  if (trapped.length) bad++;
  console.log(`種 ${String(seed).padStart(6)}  到達 ${String(fwd.size).padStart(5)}セル  ` +
    `最深 ${String(deepest).padStart(3)}階  内側${innerN}中 帰れない ${trapped.length}` +
    (trapped.length ? '  例: ' + trapped.slice(0, 3).join(' / ') : ''));
}
console.log(bad ? `\n${bad} 種で窪地あり` : '\nどの種でも、行った先から必ず帰ってこられる');
process.exit(bad ? 1 : 0);
