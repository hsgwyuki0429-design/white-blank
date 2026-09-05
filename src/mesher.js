// セルの集まりを、実際に目に見える面と、ぶつかる面に変換する。
//
// 白一色の世界なので、形は陰影でしか読めない。
// だから頂点ごとに「どれだけ隅に近いか」を焼き込んで、凹んだところを暗くしている。
// 見た目は細かく割った面、当たり判定は粗い面。役割が違うので別々に吐く。

import * as THREE from 'three';
import {
  CW, CY, CD, NCELL, CELL, LEVEL, TILES, TILE, idx,
  holeMask, chamferAt, V_STAIR,
} from './world.js';
import { hash32 } from './rng.js';

const WALL_SUB = 3;          // 壁の分割数（陰影の滑らかさ）
const RAO = 0.85;            // 隅の陰りが届く距離 (m)
const KAO = 0.40;            // 陰りの濃さ。sRGBに出ると眠くなるので、線形では強めに焼く
const STEPS = 9;             // 階段の段数
const INNER = [0.3, 0.3, 0.7, 0.3, 0.7, 0.7, 0.3, 0.7];   // 継ぎ目を避けるUV
const MARK_SIZE = 0.46;      // 壁の印の大きさ (m)

// 壁4方向の面内座標系。u = 面内の横方向, v = 上。cross(u, v) が内向き法線になるよう選んである。
// [dir, 原点(セル内0..1), u軸ベクトル, u=0側に接する方向, u=1側に接する方向]
const WALL_DEF = [
  [0, [1, 0, 0], [0, 0, 1], 5, 4],   // +X の壁
  [1, [0, 0, 1], [0, 0, -1], 4, 5],  // -X の壁
  [4, [1, 0, 1], [-1, 0, 0], 0, 1],  // +Z の壁
  [5, [0, 0, 0], [1, 0, 0], 1, 0],   // -Z の壁
];
const WALL_N = [[-1, 0, 0], [1, 0, 0], null, null, [0, 0, -1], [0, 0, 1]];

// 角の落とし: 0:(-X,-Z) 1:(+X,-Z) 2:(+X,+Z) 3:(-X,+Z)
const CORNER_TILE = [[0, 0], [TILES - 1, 0], [TILES - 1, TILES - 1], [0, TILES - 1]];
// 角のタイルを三角にするとき、落とす頂点（cyc = P00,P01,P11,P10 上の位置）
const CORNER_DROP = [0, 3, 2, 1];

/** 隅からの距離で陰りを作る。occ は各辺が壁かどうか。 */
function shade(dists, occ, tint) {
  let o = 0;
  for (let i = 0; i < 4; i++) if (occ[i]) o += Math.exp(-dists[i] / RAO);
  return tint * (1 - Math.min(o, 1.65) * KAO);
}

class Builder {
  constructor() {
    this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.idx = [];
    this.mpos = []; this.mnrm = []; this.muv = [];   // 壁の印（別マテリアル）
    this.tri = [];                                   // 当たり判定の三角形（9個ずつ）
  }
  /** p0→p1→p2→p3 を法線側から見て反時計まわりに。 */
  quad(p0, p1, p2, p3, n, c0, c1, c2, c3, uv) {
    const b = this.pos.length / 3;
    for (const p of [p0, p1, p2, p3]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) this.nrm.push(n[0], n[1], n[2]);
    for (const c of [c0, c1, c2, c3]) this.col.push(c, c, c);
    if (uv) this.uv.push(...uv); else this.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    // 明暗差の小さいほうの対角線で割る。そうしないと四角ごとに斜めの筋が出る
    if (Math.abs(c0 - c2) > Math.abs(c1 - c3)) {
      this.idx.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
    } else {
      this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  tri3(p0, p1, p2, n, c0, c1, c2, uv) {
    const b = this.pos.length / 3;
    for (const p of [p0, p1, p2]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 3; i++) this.nrm.push(n[0], n[1], n[2]);
    for (const c of [c0, c1, c2]) this.col.push(c, c, c);
    if (uv) this.uv.push(...uv); else this.uv.push(0, 0, 1, 0, 1, 1);
    this.idx.push(b, b + 1, b + 2);
  }
  /** 当たり判定用。見た目とは別に、粗い面だけ積む。 */
  hit(p0, p1, p2, p3) {
    this.tri.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
    if (p3) this.tri.push(p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
  }
  mark(p0, p1, p2, p3, n, g) {
    const u0 = (g % 4) / 4, v0 = ((g >> 2) & 3) / 4, s = 1 / 4;
    for (const p of [p0, p1, p2, p0, p2, p3]) this.mpos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 6; i++) this.mnrm.push(n[0], n[1], n[2]);
    this.muv.push(u0, v0, u0 + s, v0, u0 + s, v0 + s, u0, v0, u0 + s, v0 + s, u0, v0 + s);
  }
}

// 方向 → run/perp のベクトル（階段用）
const RUN = { 0: [1, 0, 0], 1: [-1, 0, 0], 4: [0, 0, 1], 5: [0, 0, -1] };
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const neg = (a) => [-a[0], -a[1], -a[2]];

// 方向の対から角番号を引く表
const CORNER_OF = {};
[[1, 5, 0], [0, 5, 1], [0, 4, 2], [1, 4, 3]].forEach(([a, b, c]) => {
  CORNER_OF[a + ':' + b] = c; CORNER_OF[b + ':' + a] = c;
});

function emitCell(b, world, gx, gy, gz, link) {
  const seed = world.seed;
  const ox = gx * CELL, oy = gy * LEVEL, oz = gz * CELL;
  const tint = 1 - Math.min(0.16, Math.max(0, -gy) * 0.006);   // 深いほど、わずかに重く
  const wall = [];
  for (let d = 0; d < 6; d++) wall[d] = (link & (1 << d)) === 0;
  const cham = chamferAt(seed, gx, gy, gz, link);
  const t = TILE / CELL;

  // ── 壁 ──────────────────────────────────────────────
  for (const [d, org, uv, dA, dB] of WALL_DEF) {
    if (!wall[d]) continue;
    const n = WALL_N[d];
    const cutA = (cham >> CORNER_OF[d + ':' + dA]) & 1;
    const cutB = (cham >> CORNER_OF[d + ':' + dB]) & 1;
    const s0 = cutA ? t : 0, s1 = cutB ? 1 - t : 1;
    const o = [ox + org[0] * CELL, oy, oz + org[2] * CELL];
    const occ = [wall[dA] ? 1 : 0, wall[dB] ? 1 : 0, 1, wall[2] ? 1 : 0.35];
    const P = (s, h) => [o[0] + uv[0] * CELL * s, o[1] + h * LEVEL, o[2] + uv[2] * CELL * s];
    const S = (s, h) => shade([s * CELL, (1 - s) * CELL, h * LEVEL, (1 - h) * LEVEL], occ, tint);
    for (let a = 0; a < WALL_SUB; a++) for (let c = 0; c < WALL_SUB; c++) {
      const sa = s0 + (s1 - s0) * (a / WALL_SUB), sb = s0 + (s1 - s0) * ((a + 1) / WALL_SUB);
      const ha = c / WALL_SUB, hb = (c + 1) / WALL_SUB;
      b.quad(P(sa, ha), P(sb, ha), P(sb, hb), P(sa, hb), n,
             S(sa, ha), S(sb, ha), S(sb, hb), S(sa, hb),
             [sa, ha, sb, ha, sb, hb, sa, hb]);
    }
    b.hit(P(s0, 0), P(s1, 0), P(s1, 1), P(s0, 1));

    // 壁の印。同じ場所には、いつ戻ってきても同じ形が刻まれている。
    const mh = hash32(seed, gx, gy, gz, d, 0x3A5D);
    if (mh % 1000 < 42) {
      const ms = s0 + (s1 - s0) * (0.22 + 0.56 * (((mh >>> 10) & 255) / 255));
      const mt = 0.30 + 0.34 * (((mh >>> 18) & 127) / 127);
      const du = MARK_SIZE / CELL / 2, dv = MARK_SIZE / LEVEL / 2;
      const off = (p) => [p[0] + n[0] * 0.012, p[1], p[2] + n[2] * 0.012];
      b.mark(off(P(ms - du, mt - dv)), off(P(ms + du, mt - dv)),
             off(P(ms + du, mt + dv)), off(P(ms - du, mt + dv)), n, (mh >>> 26) & 15);
    }
  }

  // ── 角の斜め落とし ───────────────────────────────────
  for (let c = 0; c < 4; c++) {
    if (!((cham >> c) & 1)) continue;
    const [ci, cj] = CORNER_TILE[c];
    const cx = ox + (ci === 0 ? 0 : CELL), cz = oz + (cj === 0 ? 0 : CELL);
    const sx = ci === 0 ? 1 : -1, sz = cj === 0 ? 1 : -1;
    const p0 = [cx + sx * TILE, oy, cz], p1 = [cx, oy, cz + sz * TILE];
    const n = [sx * Math.SQRT1_2, 0, sz * Math.SQRT1_2];   // セルの内側を向く
    const A = sx * sz > 0 ? p1 : p0, B = sx * sz > 0 ? p0 : p1;
    const top = (p) => [p[0], oy + LEVEL, p[2]];
    const sh = shade([0.3, CELL, 0.3, CELL], [1, 0, 1, 0], tint);
    b.quad(A, B, top(B), top(A), n, sh * 1.06, sh * 1.06, sh * 1.12, sh * 1.12);
    b.hit(A, B, top(B), top(A));
  }

  // ── 床と天井 ─────────────────────────────────────────
  const floorMask = (link & 8) ? holeMask(world.vfeat(gx, gy - 1, gz)) : 0;
  const ceilMask = (link & 4) ? holeMask(world.vfeat(gx, gy, gz)) : 0;
  const focc = [wall[1] ? 1 : 0, wall[0] ? 1 : 0, wall[5] ? 1 : 0, wall[4] ? 1 : 0];
  for (const up of [true, false]) {
    const mask = up ? floorMask : ceilMask;
    const y = up ? oy : oy + LEVEL;
    const n = up ? [0, 1, 0] : [0, -1, 0];
    const base = up ? 1 : 0.93;                    // 天井はほんの少し暗く
    const S = (fx, fz) => shade([fx, CELL - fx, fz, CELL - fz], focc, tint) * base;
    for (let j = 0; j < TILES; j++) for (let i = 0; i < TILES; i++) {
      if ((mask >> (i + j * TILES)) & 1) continue;
      const x0 = ox + i * TILE, x1 = x0 + TILE, z0 = oz + j * TILE, z1 = z0 + TILE;
      // P00 → P01 → P11 → P10 が上向きの反時計まわり
      const cyc = [[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]];
      const uvc = [[i / TILES, j / TILES], [i / TILES, (j + 1) / TILES],
                   [(i + 1) / TILES, (j + 1) / TILES], [(i + 1) / TILES, j / TILES]];
      const sc = [S(x0 - ox, z0 - oz), S(x0 - ox, z1 - oz), S(x1 - ox, z1 - oz), S(x1 - ox, z0 - oz)];
      // 角を落としたタイルは、四角ではなく三角で貼る（斜めの壁とぴったり合う）
      let drop = -1;
      for (let c = 0; c < 4; c++) {
        if (!((cham >> c) & 1)) continue;
        const [ci, cj] = CORNER_TILE[c];
        if (ci === i && cj === j) drop = CORNER_DROP[c];
      }
      const seq = up ? [0, 1, 2, 3] : [3, 2, 1, 0];
      if (drop >= 0) {
        const k = seq.filter((v) => v !== drop);
        b.tri3(cyc[k[0]], cyc[k[1]], cyc[k[2]], n, sc[k[0]], sc[k[1]], sc[k[2]],
               [...uvc[k[0]], ...uvc[k[1]], ...uvc[k[2]]]);
      } else {
        b.quad(cyc[seq[0]], cyc[seq[1]], cyc[seq[2]], cyc[seq[3]], n,
               sc[seq[0]], sc[seq[1]], sc[seq[2]], sc[seq[3]],
               [...uvc[seq[0]], ...uvc[seq[1]], ...uvc[seq[2]], ...uvc[seq[3]]]);
      }
    }
    // 当たり判定は横一列をまとめて粗く
    for (let j = 0; j < TILES; j++) {
      let i = 0;
      while (i < TILES) {
        if ((mask >> (i + j * TILES)) & 1) { i++; continue; }
        let e = i;
        while (e < TILES && !((mask >> (e + j * TILES)) & 1)) e++;
        const x0 = ox + i * TILE, x1 = ox + e * TILE, z0 = oz + j * TILE, z1 = z0 + TILE;
        b.hit([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]);
        i = e;
      }
    }
  }

  // ── 階段、あるいは斜路 ───────────────────────────────
  if (link & 4) {
    const v = world.vfeat(gx, gy, gz);
    if (v.kind === V_STAIR) {
      (v.smooth ? emitSlope : emitStair)(b, ox, oy, oz, v.dir, tint);
    }
  }
}

function emitStair(b, ox, oy, oz, dir, tint) {
  const R = RUN[dir], P = cross([0, 1, 0], R);
  const W = CELL / 2, center = [ox + CELL / 2, oy, oz + CELL / 2];
  const B = add(center, R, -CELL / 2);
  const pt = (t, p, h) => [
    B[0] + R[0] * t * CELL + P[0] * p, B[1] + h, B[2] + R[2] * t * CELL + P[2] * p];
  const nR = neg(R), nP = neg(P);
  const dim = tint * 0.90, lit = tint * 1.0;

  for (let k = 0; k < STEPS; k++) {
    const t0 = k / STEPS, t1 = (k + 1) / STEPS, h0 = t0 * LEVEL, h1 = t1 * LEVEL;
    // 蹴込み（手前を向く縦面）— 段の底ほど暗い
    b.quad(pt(t0, -W / 2, h0), pt(t0, -W / 2, h1), pt(t0, W / 2, h1), pt(t0, W / 2, h0), nR,
           dim, lit, lit, dim, INNER);
    // 踏面
    b.quad(pt(t0, -W / 2, h1), pt(t1, -W / 2, h1), pt(t1, W / 2, h1), pt(t0, W / 2, h1), [0, 1, 0],
           dim * 0.97, lit, lit, dim * 0.97, INNER);
    // 側面（階段は塊なので、床から段の高さまで）
    b.quad(pt(t0, W / 2, 0), pt(t0, W / 2, h1), pt(t1, W / 2, h1), pt(t1, W / 2, 0), P,
           dim, lit, lit, dim, INNER);
    b.quad(pt(t0, -W / 2, 0), pt(t1, -W / 2, 0), pt(t1, -W / 2, h1), pt(t0, -W / 2, h1), nP,
           dim, dim, lit, lit, INNER);
  }
  // 上りきった先の縦面
  b.quad(pt(1, -W / 2, 0), pt(1, W / 2, 0), pt(1, W / 2, LEVEL), pt(1, -W / 2, LEVEL), R,
         dim, dim, lit, lit, INNER);

  // 当たり判定は段差を均した坂。ここで刻むと足が引っかかって歩けたものではない。
  b.hit(pt(0, -W / 2, 0), pt(0, W / 2, 0), pt(1, W / 2, LEVEL), pt(1, -W / 2, LEVEL));
  b.hit(pt(0, W / 2, 0), pt(1, W / 2, 0), pt(1, W / 2, LEVEL));
  b.hit(pt(0, -W / 2, 0), pt(1, -W / 2, LEVEL), pt(1, -W / 2, 0));
  b.hit(pt(1, -W / 2, 0), pt(1, W / 2, 0), pt(1, W / 2, LEVEL), pt(1, -W / 2, LEVEL));
}

/**
 * ひと続きに傾いた坂。
 * 床にも壁にも平行でない面がひとつ混じるだけで、白い直方体の連なりが急に立体に見える。
 */
function emitSlope(b, ox, oy, oz, dir, tint) {
  const R = RUN[dir], P = cross([0, 1, 0], R);
  const W = CELL / 2, center = [ox + CELL / 2, oy, oz + CELL / 2];
  const B = add(center, R, -CELL / 2);
  const pt = (t, p, h) => [
    B[0] + R[0] * t * CELL + P[0] * p, B[1] + h, B[2] + R[2] * t * CELL + P[2] * p];
  const nP = neg(P);
  const N = 5;                                     // 陰影のために刻む
  const dim = tint * 0.87, lit = tint * 1.0;
  // 坂の上面。法線は run と上のあいだを向く
  const len = Math.hypot(CELL, LEVEL);
  const sn = [-R[0] * LEVEL / len, CELL / len, -R[2] * LEVEL / len];
  for (let k = 0; k < N; k++) {
    const t0 = k / N, t1 = (k + 1) / N;
    const s0 = tint * (0.90 + 0.10 * t0), s1 = tint * (0.90 + 0.10 * t1);
    b.quad(pt(t0, -W / 2, t0 * LEVEL), pt(t1, -W / 2, t1 * LEVEL),
           pt(t1, W / 2, t1 * LEVEL), pt(t0, W / 2, t0 * LEVEL), sn,
           s0 * 0.9, s1 * 0.9, s1, s0,
           [0.15, t0, 0.15, t1, 0.85, t1, 0.85, t0]);
  }
  // 横腹は直角三角形
  b.tri3(pt(0, W / 2, 0), pt(1, W / 2, LEVEL), pt(1, W / 2, 0), P, dim, lit, dim, INNER);
  b.tri3(pt(0, -W / 2, 0), pt(1, -W / 2, 0), pt(1, -W / 2, LEVEL), nP, dim, dim, lit, INNER);
  b.quad(pt(1, -W / 2, 0), pt(1, W / 2, 0), pt(1, W / 2, LEVEL), pt(1, -W / 2, LEVEL), R,
         dim, dim, lit, lit, INNER);

  b.hit(pt(0, -W / 2, 0), pt(0, W / 2, 0), pt(1, W / 2, LEVEL), pt(1, -W / 2, LEVEL));
  b.hit(pt(0, W / 2, 0), pt(1, W / 2, 0), pt(1, W / 2, LEVEL));
  b.hit(pt(0, -W / 2, 0), pt(1, -W / 2, LEVEL), pt(1, -W / 2, 0));
  b.hit(pt(1, -W / 2, 0), pt(1, W / 2, 0), pt(1, W / 2, LEVEL), pt(1, -W / 2, LEVEL));
}

/** チャンク1つぶんの見た目と当たり判定を作る。 */
export function buildChunk(world, kx, ky, kz) {
  const c = world.chunk(kx, ky, kz);
  const b = new Builder();
  const triStart = new Int32Array(NCELL + 1);
  for (let y = 0; y < CY; y++) for (let z = 0; z < CD; z++) for (let x = 0; x < CW; x++) {
    const i = idx(x, y, z);
    triStart[i] = b.tri.length / 9;
    if (c.solid[i]) continue;
    emitCell(b, world, kx * CW + x, ky * CY + y, kz * CD + z, c.link[i]);
  }
  triStart[NCELL] = b.tri.length / 9;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  geom.setIndex(b.idx);
  geom.computeBoundingSphere();

  let marks = null;
  if (b.mpos.length) {
    marks = new THREE.BufferGeometry();
    marks.setAttribute('position', new THREE.Float32BufferAttribute(b.mpos, 3));
    marks.setAttribute('normal', new THREE.Float32BufferAttribute(b.mnrm, 3));
    marks.setAttribute('uv', new THREE.Float32BufferAttribute(b.muv, 2));
    marks.computeBoundingSphere();
  }
  return { geom, marks, tri: new Float32Array(b.tri), triStart, verts: b.pos.length / 3 };
}
