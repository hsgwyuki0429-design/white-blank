// 通れない通路がないかを、幾何のほうから確かめる。
// リンクがあることと、体が通ることは別の話だ。
import { World, roomOf, throatOf, walkable, DX, DZ } from '../src/world.js';

const BODY_H = 1.74, BODY_W = 0.64;
const seeds = [1, 7, 12345, 999, 4242, 31337, 8080, 55555];
const R = 14;
let bad = 0;

for (const seed of seeds) {
  const w = new World(seed);
  let n = 0, lowRoom = 0, sealed = 0, lowGate = 0, narrow = 0;
  let minW = 99, minH = 99;
  for (let x = -R; x <= R; x++) for (let y = -8; y <= 4; y++) for (let z = -R; z <= R; z++) {
    if (!w.open(x, y, z) || !w.linkBits(x, y, z)) continue;
    const A = roomOf(w, x, y, z);
    if (A.y1 - A.y0 < BODY_H + 0.06) lowRoom++;
    for (const d of [0, 4]) {
      if (!w.linked(x, y, z, d)) continue;
      n++;
      const t = throatOf(w, A, x, y, z, d);
      if (!t) { sealed++; continue; }
      if (!walkable(seed, x, y, z, d)) continue;      // 欄干は越えられなくてよい
      const tw = t.p1 - t.p0, th = t.y1 - t.y0;
      minW = Math.min(minW, tw); minH = Math.min(minH, th);
      if (th < BODY_H + 0.06) lowGate++;
      if (tw < BODY_W + 0.2) narrow++;
    }
  }
  if (lowRoom || sealed || lowGate || narrow) bad++;
  console.log(`種 ${String(seed).padStart(6)}  通路 ${String(n).padStart(6)}  ` +
    `立てない部屋 ${lowRoom}  塞がった口 ${sealed}  低すぎ ${lowGate}  狭すぎ ${narrow}  ` +
    `最小 ${minW.toFixed(2)}m幅 / ${minH.toFixed(2)}m高`);
}
console.log(`\n背丈 ${BODY_H}m / 体の幅 ${BODY_W}m`);
console.log(bad ? `${bad} 種で通れない場所あり` : 'どの通路も、人が通れる寸法がある');
process.exit(bad ? 1 : 0);
