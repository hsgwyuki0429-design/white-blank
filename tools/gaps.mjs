// 通れない通路がないかを、幾何のほうから確かめる。
// リンクがあっても、天井が低すぎたり戸口が狭すぎたりすれば人は通れない。
import { World, CELL, LEVEL, CEIL_LOW, ceilHeight, aperture, V_OPEN, V_STAIR } from '../src/world.js';

const BODY_H = 1.74, BODY_W = 0.64;
const seeds = [1, 7, 12345, 999, 4242, 31337, 8080, 55555];
const R = 16;
let bad = 0;

const cellTop = (w, x, y, z) => {
  const v = w.linked(x, y, z, 2) ? w.vfeat(x, y, z) : null;
  return (v && v.kind === V_OPEN) ? LEVEL : ceilHeight(w.seed, x, y, z);
};
const hasStair = (w, x, y, z) => {
  const v = w.linked(x, y, z, 2) ? w.vfeat(x, y, z) : null;
  return !!v && v.kind === V_STAIR;
};

for (const seed of seeds) {
  const w = new World(seed);
  let n = 0, lowRoom = 0, lowGate = 0, narrow = 0;
  for (let x = -R; x <= R; x++) for (let y = -8; y <= 4; y++) for (let z = -R; z <= R; z++) {
    if (!w.open(x, y, z) || !w.linkBits(x, y, z)) continue;
    const tA = cellTop(w, x, y, z);
    if (tA < BODY_H + 0.06) lowRoom++;
    for (const [d, dx, dz] of [[0, 1, 0], [1, -1, 0], [4, 0, 1], [5, 0, -1]]) {
      if (!w.linked(x, y, z, d)) continue;
      n++;
      const openTop = Math.min(tA, cellTop(w, x + dx, y, z + dz));
      if (openTop < BODY_H + 0.06) { lowGate++; continue; }
      const blocked = hasStair(w, x, y, z) || hasStair(w, x + dx, y, z + dz);
      if (blocked || openTop < 2.10) continue;
      const ap = aperture(seed, x, y, z, d);
      if (!ap) continue;
      const h = Math.min(ap.h, openTop - 0.14);
      if (ap.w < BODY_W + 0.2 || h < BODY_H + 0.06) narrow++;
    }
  }
  if (lowRoom || lowGate || narrow) bad++;
  console.log(`種 ${String(seed).padStart(6)}  通路 ${String(n).padStart(6)}  ` +
    `立てない部屋 ${lowRoom}  くぐれない高さ ${lowGate}  狭すぎる戸口 ${narrow}`);
}
console.log(`\n最低の天井 ${CEIL_LOW}m / 背丈 ${BODY_H}m / 体の幅 ${BODY_W}m`);
console.log(bad ? `${bad} 種で通れない場所あり` : 'どの通路も、人が通れる寸法がある');
process.exit(bad ? 1 : 0);
