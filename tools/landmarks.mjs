// ランドマークが、ちゃんと「入れて、渡れて、帰ってこられる」かを確かめる。
// 見た目の話ではなく、幾何と到達可能性の話。
import {
  World, roomOf, throatOf, walkable, findLandmarks, landmarkOf, LM_NAMES,
  DX, DY, DZ, OPP, MIN_GAP, MIN_HEAD, V_STAIR,
} from '../src/world.js';

const SEEDS = process.argv[2] ? [Number(process.argv[2])] : [1, 7, 12345, 999, 4242, 31337];
const RADIUS = 6;                     // 探す粗い目の広さ
let fail = 0;
const bad = (msg) => { fail++; console.log('  NG  ' + msg); };

/** 立てる場所どうしの、前向きの辺。落ちる先まで追う。 */
function walkGraph(w, seed, box) {
  const inBox = (x, y, z) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1
                          && z >= box.z0 && z <= box.z1;
  const fall = (x, y, z) => {
    for (let n = 0; n < 60; n++) {
      if (!inBox(x, y, z) || !w.open(x, y, z)) return null;
      if (w.hasFloor(x, y, z)) return [x, y, z];
      y--;
    }
    return null;
  };
  const fwd = new Map(), rev = new Map();
  const add = (a, b) => {
    if (!fwd.has(a)) fwd.set(a, []);
    if (!rev.has(b)) rev.set(b, []);
    fwd.get(a).push(b); rev.get(b).push(a);
  };
  const stand = [];
  for (let y = box.y0; y <= box.y1; y++) for (let z = box.z0; z <= box.z1; z++)
    for (let x = box.x0; x <= box.x1; x++) {
      if (!w.open(x, y, z) || !w.linkBits(x, y, z) || !w.hasFloor(x, y, z)) continue;
      const a = x + ',' + y + ',' + z;
      stand.push([x, y, z]);
      for (const d of [0, 1, 4, 5]) {
        if (!w.linked(x, y, z, d) || !walkable(seed, x, y, z, d)) continue;
        const t = fall(x + DX[d], y, z + DZ[d]);
        if (t) add(a, t.join(','));
      }
      const v = w.vfeat(x, y, z);
      if (v && v.kind === V_STAIR) add(a, x + ',' + (y + 1) + ',' + z);
      if (w.linked(x, y, z, 3)) { const t = fall(x, y - 1, z); if (t) add(a, t.join(',')); }
    }
  const flood = (E, from) => {
    const seen = new Set([from]), q = [from];
    for (let h = 0; h < q.length; h++) for (const n of (E.get(q[h]) || []))
      if (!seen.has(n)) { seen.add(n); q.push(n); }
    return seen;
  };
  return { stand, flood, fwd, rev };
}

const sig = (w, L) => {
  let h = 0;
  for (let x = L.x0; x <= L.x1; x++) for (let y = L.y0; y <= L.y1; y++) for (let z = L.z0; z <= L.z1; z++)
    h = (h * 31 + (w.open(x, y, z) ? w.linkBits(x, y, z) + 1 : 0)) | 0;
  return h;
};

const found = new Map();
for (const seed of SEEDS) {
  const w = new World(seed), w2 = new World(seed);
  for (const L of findLandmarks(seed, undefined, RADIUS)) {
    const name = LM_NAMES[L.kind];
    found.set(name, (found.get(name) || 0) + 1);
    const tag = `種${seed} ${name} ${L.W}x${L.D}x${L.H} @${L.x0},${L.y0},${L.z0}`;

    // 囲みが正しいか
    if (L.x1 - L.x0 + 1 !== L.W || L.z1 - L.z0 + 1 !== L.D || L.y1 - L.y0 + 1 !== L.H)
      bad(tag + ' … 囲みの寸法が合わない');
    if (landmarkOf(seed, L.x0 - 1, L.y0, L.z0) === L) bad(tag + ' … 囲みの外にはみ出している');
    if (landmarkOf(seed, L.x0, L.y0, L.z0) !== L) bad(tag + ' … 囲みの中が空');

    // 同じ種なら同じ形
    if (sig(w, L) !== sig(w2, L)) bad(tag + ' … 作り直すと形が変わる');

    // 出入口
    if (L.gates.length < 2) bad(tag + ' … 出入口が2つ未満');

    // 幾何が壊れていないか
    let nan = 0, tight = 0, low = 0;
    for (let x = L.x0; x <= L.x1; x++) for (let y = L.y0; y <= L.y1; y++) for (let z = L.z0; z <= L.z1; z++) {
      if (!w.open(x, y, z) || !w.linkBits(x, y, z)) continue;
      const A = roomOf(w, x, y, z);
      for (const v of [A.x0, A.x1, A.y0, A.y1, A.z0, A.z1]) if (!Number.isFinite(v)) nan++;
      if (A.y1 - A.y0 < MIN_HEAD - 0.05) low++;
      for (const d of [0, 4]) {
        if (!w.linked(x, y, z, d) || !walkable(seed, x, y, z, d)) continue;
        const t = throatOf(w, A, x, y, z, d);
        if (!t) { tight++; continue; }
        if (t.p1 - t.p0 < MIN_GAP - 0.05 || t.y1 - t.y0 < MIN_HEAD - 0.05) tight++;
      }
    }
    if (nan) bad(tag + ` … 座標に NaN/Infinity が ${nan}`);
    if (low) bad(tag + ` … 立てない高さの部屋が ${low}`);
    if (tight) bad(tag + ` … 通れない口が ${tight}`);

    // 入って、渡って、帰ってこられるか
    const box = { x0: L.x0 - 3, x1: L.x1 + 3, y0: L.y0 - 3, y1: L.y1 + 3, z0: L.z0 - 3, z1: L.z1 + 3 };
    const G = walkGraph(w, seed, box);
    const outside = [];
    for (const g of L.gates) {
      const x = L.x0 + g.ix + DX[g.dir], y = L.y0 + g.iy + DY[g.dir], z = L.z0 + g.iz + DZ[g.dir];
      if (w.open(x, y, z) && w.hasFloor(x, y, z)) outside.push(x + ',' + y + ',' + z);
    }
    if (outside.length < 2) { bad(tag + ' … 外から立って入れる口が2つ未満'); continue; }
    let pair = 0;
    for (const a of outside) {
      const f = G.flood(G.fwd, a), r = G.flood(G.rev, a);
      for (const b of outside) if (b !== a && f.has(b) && r.has(b)) pair++;
    }
    if (!pair) bad(tag + ' … 口から口へ、行って帰ってこられない');

    // 中にどれだけ立てる場所があるか（空っぽでないこと）
    const inside = G.stand.filter((c) => landmarkOf(seed, c[0], c[1], c[2]) === L).length;
    if (inside < 4) bad(tag + ` … 中に立てる場所が ${inside} しかない`);
  }
}

console.log('\n見つかったランドマーク: ' + [...found].map(([k, v]) => `${k} ${v}`).join(' / '));
for (const n of LM_NAMES) if (!found.has(n)) bad(`${n} が一つも生成されなかった`);
console.log(fail ? `\n${fail} 件の問題` : '\nすべてのランドマークが、入れて・渡れて・帰ってこられる');
process.exit(fail ? 1 : 0);
