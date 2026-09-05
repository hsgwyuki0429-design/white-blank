// セルの集まりを、目に見える面と、ぶつかる面に変換する。
//
// 白一色なので、形は陰影だけで読む。線で縁取ることはしない。
// 代わりに、床と天井に厚みを持たせ、開口を絞り、天井の高さを場所ごとに変えた。
// 実体があれば、影が落ちる。影が落ちれば、そこに境目があるとわかる。

import * as THREE from 'three';
import {
  CW, CY, CD, NCELL, CELL, LEVEL, SLAB, TILES, TILE, idx,
  ceilHeight, aperture, chamferAt, chamferSize, holeMask, V_STAIR, V_OPEN,
} from './world.js';
import { hash32 } from './rng.js';

const WALL_SUB = 4;          // 壁の分割数（陰影の滑らかさ）
const RAO = 0.72;            // 隅の陰りが届く距離 (m)
const KAO = 0.44;            // 陰りの濃さ。sRGBに出ると眠くなるので線形では強めに焼く
const STEPS = 8;             // 階段の段数
const RISE_T = 0.75;         // run のどこまでで登りきるか。残りは上階の踊り場
const MARK_SIZE = 0.50;
const INNER = [0.3, 0.3, 0.7, 0.3, 0.7, 0.7, 0.3, 0.7];

// 壁4方向の面内座標系。u = 面内の横方向, v = 上。cross(u, v) が内向き法線になる。
// [dir, 原点(セル内0..1), u軸, u=0側の方向, u=1側の方向, uが世界の正方向か]
const WALL_DEF = [
  [0, [1, 0, 0], [0, 0, 1], 5, 4, 1],
  [1, [0, 0, 1], [0, 0, -1], 4, 5, -1],
  [4, [1, 0, 1], [-1, 0, 0], 0, 1, -1],
  [5, [0, 0, 0], [1, 0, 0], 1, 0, 1],
];
const WALL_N = [[-1, 0, 0], [1, 0, 0], null, null, [0, 0, -1], [0, 0, 1]];
const RUN = { 0: [1, 0, 0], 1: [-1, 0, 0], 4: [0, 0, 1], 5: [0, 0, -1] };
const CORNER_DIRS = { '1:5': 0, '5:1': 0, '0:5': 1, '5:0': 1, '0:4': 2, '4:0': 2, '1:4': 3, '4:1': 3 };

const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const neg = (a) => [-a[0], -a[1], -a[2]];

/** 隅からの距離で陰りを作る。occ は各辺がどれだけ塞がっているか。 */
function shade(d0, d1, d2, d3, occ, tint) {
  let o = 0;
  if (occ[0]) o += occ[0] * Math.exp(-d0 / RAO);
  if (occ[1]) o += occ[1] * Math.exp(-d1 / RAO);
  if (occ[2]) o += occ[2] * Math.exp(-d2 / RAO);
  if (occ[3]) o += occ[3] * Math.exp(-d3 / RAO);
  return tint * (1 - Math.min(o, 1.55) * KAO);
}

class Builder {
  constructor() {
    this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.idx = [];
    this.mpos = []; this.mnrm = []; this.muv = [];
    this.tri = [];
  }
  quad(p0, p1, p2, p3, n, c0, c1, c2, c3, uv) {
    const b = this.pos.length / 3;
    for (const p of [p0, p1, p2, p3]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) this.nrm.push(n[0], n[1], n[2]);
    for (const c of [c0, c1, c2, c3]) this.col.push(c, c, c);
    if (uv) this.uv.push(...uv); else this.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    // 明暗差の小さいほうの対角線で割る。そうしないと四角ごとに斜めの筋が出る
    if (Math.abs(c0 - c2) > Math.abs(c1 - c3)) this.idx.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
    else this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** 3頂点以上の凸多角形を扇状に貼る。col は頂点ごとの明るさ。 */
  fan(pts, n, cols, uvs) {
    const b = this.pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      this.pos.push(pts[i][0], pts[i][1], pts[i][2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.col.push(cols[i], cols[i], cols[i]);
      this.uv.push(uvs ? uvs[i][0] : 0, uvs ? uvs[i][1] : 0);
    }
    for (let i = 1; i + 1 < pts.length; i++) this.idx.push(b, b + i, b + i + 1);
  }
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

/** 半平面 f(p) >= 0 で多角形を切る（Sutherland-Hodgman）。角を斜めに落とすのに使う。 */
function clipHalf(poly, f) {
  if (!poly.length) return poly;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = f(a), db = f(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** 角落としで、床や天井のタイルを削る。 */
function clipCorners(poly, cham) {
  for (let c = 0; c < 4; c++) {
    const k = chamferSize(cham, c);
    if (!k) continue;
    const cut = k * TILE;
    if (c === 0) poly = clipHalf(poly, (p) => p[0] + p[1] - cut);
    else if (c === 1) poly = clipHalf(poly, (p) => (CELL - p[0]) + p[1] - cut);
    else if (c === 2) poly = clipHalf(poly, (p) => (CELL - p[0]) + (CELL - p[1]) - cut);
    else poly = clipHalf(poly, (p) => p[0] + (CELL - p[1]) - cut);
    if (poly.length < 3) return [];
  }
  return poly;
}

/** そのセルの壁がどこまで立ち上がるか。吹き抜けなら上のセルへ続く。 */
function cellTop(world, gx, gy, gz) {
  const v = world.linked(gx, gy, gz, 2) ? world.vfeat(gx, gy, gz) : null;
  return (v && v.kind === V_OPEN) ? LEVEL : ceilHeight(world.seed, gx, gy, gz);
}
/** そのセルに階段（斜路）が立っているか。あるなら中央半分が塞がる。 */
function hasStair(world, gx, gy, gz) {
  const v = world.linked(gx, gy, gz, 2) ? world.vfeat(gx, gy, gz) : null;
  return !!v && v.kind === V_STAIR;
}

function emitCell(b, world, gx, gy, gz, link) {
  const seed = world.seed;
  const ox = gx * CELL, oz = gz * CELL, yF = gy * LEVEL;
  const up = (link & 4) ? world.vfeat(gx, gy, gz) : null;
  const dn = (link & 8) ? world.vfeat(gx, gy - 1, gz) : null;
  const hasFloor = !dn || dn.kind !== V_OPEN;
  const hasCeil = !up || up.kind !== V_OPEN;
  const ch = ceilHeight(seed, gx, gy, gz);
  const top = hasCeil ? ch : LEVEL;              // 吹き抜けなら上のセルへ壁が続く
  const tint = 1 - Math.min(0.16, Math.max(0, -gy) * 0.006);
  const wall = [];
  for (let d = 0; d < 6; d++) wall[d] = (link & (1 << d)) === 0;
  const cham = chamferAt(seed, gx, gy, gz, link);
  const tt = TILE / CELL;

  // ── 壁 ──────────────────────────────────────────────
  for (const [d, org, uv, dA, dB, sgn] of WALL_DEF) {
    const nx = gx + (d === 0 ? 1 : d === 1 ? -1 : 0);
    const nz = gz + (d === 4 ? 1 : d === 5 ? -1 : 0);
    let openTop = 0, ap = null;
    if (!wall[d]) {
      // 通り抜けられる高さは、両側の低いほうまで。その上は「まぐさ」になる。
      openTop = Math.min(top, cellTop(world, nx, gy, nz));
      // 階段は部屋の中央半分を塞ぐ。そこへ細い戸口を置くと通れなくなる。
      // 天井が低すぎるところも、絞ると人が通れない。
      const blocked = hasStair(world, gx, gy, gz) || hasStair(world, nx, gy, nz);
      if (!blocked && openTop >= 2.10) ap = aperture(seed, gx, gy, gz, d);
      if (!ap && openTop >= top) continue;      // 壁いっぱいに開いていて、まぐさも要らない
    }

    const n = WALL_N[d];
    const kA = chamferSize(cham, CORNER_DIRS[d + ':' + dA]);
    const kB = chamferSize(cham, CORNER_DIRS[d + ':' + dB]);
    const s0 = kA * tt, s1 = 1 - kB * tt;
    if (s1 - s0 < 0.02) continue;
    const o = [ox + org[0] * CELL, yF, oz + org[2] * CELL];
    const occ = [wall[dA] ? 1 : 0, wall[dB] ? 1 : 0, hasFloor ? 0.8 : 0.15, hasCeil ? 0.8 : 0.15];
    const P = (s, h) => [o[0] + uv[0] * CELL * s, o[1] + h, o[2] + uv[2] * CELL * s];
    const S = (s, h) => shade(s * CELL, (1 - s) * CELL, h, top - h, occ, tint);

    const panel = (a0, a1, h0, h1) => {
      if (a1 - a0 < 0.004 || h1 - h0 < 0.01) return;
      const nu = Math.max(1, Math.round((a1 - a0) * CELL / 1.15));
      const nv = Math.max(1, Math.round((h1 - h0) / 0.75));
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const sa = a0 + (a1 - a0) * (i / nu), sb = a0 + (a1 - a0) * ((i + 1) / nu);
        const ha = h0 + (h1 - h0) * (j / nv), hb = h0 + (h1 - h0) * ((j + 1) / nv);
        b.quad(P(sa, ha), P(sb, ha), P(sb, hb), P(sa, hb), n,
               S(sa, ha), S(sb, ha), S(sb, hb), S(sa, hb),
               [sa, ha / LEVEL, sb, ha / LEVEL, sb, hb / LEVEL, sa, hb / LEVEL]);
      }
      b.hit(P(a0, h0), P(a1, h0), P(a1, h1), P(a0, h1));
    };

    if (wall[d]) {
      panel(s0, s1, 0, top);
      // 壁の印。同じ場所には、いつ戻ってきても同じ形が刻まれている
      const mh = hash32(seed, gx, gy, gz, d, 0x3A5D);
      if (mh % 1000 < 46) {
        const ms = s0 + (s1 - s0) * (0.24 + 0.52 * (((mh >>> 10) & 255) / 255));
        const mt = top * (0.34 + 0.32 * (((mh >>> 18) & 127) / 127));
        const du = MARK_SIZE / CELL / 2, dv = MARK_SIZE / 2;
        const off = (p) => [p[0] + n[0] * 0.014, p[1], p[2] + n[2] * 0.014];
        b.mark(off(P(ms - du, mt - dv)), off(P(ms + du, mt - dv)),
               off(P(ms + du, mt + dv)), off(P(ms - du, mt + dv)), n, (mh >>> 26) & 15);
      }
    } else if (ap) {
      // 人ひとり分の戸口。両側のセルが同じ計算をするので、穴の位置はぴたりと合う
      const dh = Math.min(ap.h, openTop - 0.14);
      const half = ap.w / CELL / 2;
      const sc = 0.5 + sgn * ap.off / CELL;
      const a0 = Math.max(s0, sc - half), a1 = Math.min(s1, sc + half);
      panel(s0, a0, 0, top);
      panel(a1, s1, 0, top);
      if (dh < top) panel(a0, a1, dh, top);
    } else {
      // まぐさ。隣より天井が高いぶんだけ、上に壁が残る
      panel(s0, s1, openTop, top);
    }
  }

  // ── 角の斜め落とし ───────────────────────────────────
  for (let c = 0; c < 4; c++) {
    const k = chamferSize(cham, c);
    if (!k) continue;
    const cut = k * TILE;
    const cx = ox + (c === 1 || c === 2 ? CELL : 0), cz = oz + (c === 2 || c === 3 ? CELL : 0);
    const sx = (c === 1 || c === 2) ? -1 : 1, sz = (c === 2 || c === 3) ? -1 : 1;
    const p0 = [cx + sx * cut, yF, cz], p1 = [cx, yF, cz + sz * cut];
    const n = [sx * Math.SQRT1_2, 0, sz * Math.SQRT1_2];
    const A = sx * sz > 0 ? p1 : p0, B = sx * sz > 0 ? p0 : p1;
    const hi = (p) => [p[0], yF + top, p[2]];
    const lo = shade(0.35, CELL, 0.35, CELL, [1, 0, 1, 0], tint);
    b.quad(A, B, hi(B), hi(A), n, lo * 0.99, lo * 0.99, lo * 1.14, lo * 1.14);
    b.hit(A, B, hi(B), hi(A));
  }

  // ── 床と天井 ─────────────────────────────────────────
  const focc = [wall[1] ? 1 : 0, wall[0] ? 1 : 0, wall[5] ? 1 : 0, wall[4] ? 1 : 0];
  const plane = (y, upward, mask, base) => {
    const n = upward ? [0, 1, 0] : [0, -1, 0];
    const S = (fx, fz) => shade(fx, CELL - fx, fz, CELL - fz, focc, tint) * base;
    for (let j = 0; j < TILES; j++) for (let i = 0; i < TILES; i++) {
      if ((mask >> (i + j * TILES)) & 1) continue;
      const x0 = i * TILE, x1 = x0 + TILE, z0 = j * TILE, z1 = z0 + TILE;
      let poly = clipCorners([[x0, z0], [x0, z1], [x1, z1], [x1, z0]], cham);
      if (poly.length < 3) continue;
      if (!upward) poly = poly.slice().reverse();
      b.fan(poly.map((p) => [ox + p[0], y, oz + p[1]]), n,
            poly.map((p) => S(p[0], p[1])), poly.map((p) => [p[0] / CELL, p[1] / CELL]));
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
  };

  if (hasFloor) {
    const mask = dn ? holeMask(dn) : 0;
    plane(yF, true, mask, 1);
    // 穴のふち。床に厚みがあることは、覗きこんだときにだけわかる
    const lip = shade(0.2, CELL, 0.2, CELL, [1, 0, 0, 0], tint) * 0.88;
    for (let j = 0; j < TILES; j++) for (let i = 0; i < TILES; i++) {
      if ((mask >> (i + j * TILES)) & 1) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        const gone = ni < 0 || ni >= TILES || nj < 0 || nj >= TILES
          ? false : ((mask >> (ni + nj * TILES)) & 1) === 1;
        if (!gone) continue;
        const ex = ox + (i + (di > 0 ? 1 : 0)) * TILE, ez = oz + (j + (dj > 0 ? 1 : 0)) * TILE;
        const ux = dj !== 0 ? TILE : 0, uz = di !== 0 ? TILE : 0;
        const p0 = [ex, yF, ez], p1 = [ex + ux, yF, ez + uz];
        const q0 = [ex, yF - SLAB, ez], q1 = [ex + ux, yF - SLAB, ez + uz];
        const n = [di, 0, dj];
        if (di + dj > 0) b.quad(p0, q0, q1, p1, n, lip, lip * 0.8, lip * 0.8, lip);
        else b.quad(p1, q1, q0, p0, n, lip, lip * 0.8, lip * 0.8, lip);
        b.hit(p0, q0, q1, p1);
      }
    }
  }
  if (hasCeil) plane(yF + ch, false, up ? holeMask(up) : 0, 0.9);

  // ── 階段、あるいは斜路 ───────────────────────────────
  if (up && up.kind === V_STAIR) {
    (up.smooth ? emitSlope : emitStair)(b, ox, yF, oz, up.dir, tint);
  }
}

/** 段のある階段。上りきった先の一列は上階の床が受け持つので、そこが踊り場になる。 */
function emitStair(b, ox, yF, oz, dir, tint) {
  const R = RUN[dir], P = cross([0, 1, 0], R);
  const W = CELL / 2, center = [ox + CELL / 2, yF, oz + CELL / 2];
  const B = add(center, R, -CELL / 2);
  const pt = (t, p, h) => [
    B[0] + R[0] * t * CELL + P[0] * p, B[1] + h, B[2] + R[2] * t * CELL + P[2] * p];
  const nR = neg(R), nP = neg(P);
  const dim = tint * 0.88, lit = tint;

  for (let k = 0; k < STEPS; k++) {
    const t0 = (k / STEPS) * RISE_T, t1 = ((k + 1) / STEPS) * RISE_T;
    const h0 = (k / STEPS) * LEVEL, h1 = ((k + 1) / STEPS) * LEVEL;
    b.quad(pt(t0, -W / 2, h0), pt(t0, -W / 2, h1), pt(t0, W / 2, h1), pt(t0, W / 2, h0), nR,
           dim, lit, lit, dim, INNER);
    b.quad(pt(t0, -W / 2, h1), pt(t1, -W / 2, h1), pt(t1, W / 2, h1), pt(t0, W / 2, h1), [0, 1, 0],
           dim * 0.97, lit, lit, dim * 0.97, INNER);
    b.quad(pt(t0, W / 2, 0), pt(t0, W / 2, h1), pt(t1, W / 2, h1), pt(t1, W / 2, 0), P,
           dim, lit, lit, dim, INNER);
    b.quad(pt(t0, -W / 2, 0), pt(t1, -W / 2, 0), pt(t1, -W / 2, h1), pt(t0, -W / 2, h1), nP,
           dim, dim, lit, lit, INNER);
  }
  stairSolid(b, pt, W, tint, R);
}

/** ひと続きに傾いた坂。床にも壁にも平行でない面が、白い箱の連なりを立体に見せる。 */
function emitSlope(b, ox, yF, oz, dir, tint) {
  const R = RUN[dir], P = cross([0, 1, 0], R);
  const W = CELL / 2, center = [ox + CELL / 2, yF, oz + CELL / 2];
  const B = add(center, R, -CELL / 2);
  const pt = (t, p, h) => [
    B[0] + R[0] * t * CELL + P[0] * p, B[1] + h, B[2] + R[2] * t * CELL + P[2] * p];
  const nP = neg(P);
  const run = RISE_T * CELL, len = Math.hypot(run, LEVEL);
  const sn = [-R[0] * LEVEL / len, run / len, -R[2] * LEVEL / len];
  const dim = tint * 0.88, lit = tint;
  const N = 5;
  for (let k = 0; k < N; k++) {
    const t0 = (k / N) * RISE_T, t1 = ((k + 1) / N) * RISE_T;
    const h0 = (k / N) * LEVEL, h1 = ((k + 1) / N) * LEVEL;
    const s0 = tint * (0.90 + 0.10 * (k / N)), s1 = tint * (0.90 + 0.10 * ((k + 1) / N));
    b.quad(pt(t0, -W / 2, h0), pt(t1, -W / 2, h1), pt(t1, W / 2, h1), pt(t0, W / 2, h0), sn,
           s0 * 0.9, s1 * 0.9, s1, s0, [0.15, t0, 0.15, t1, 0.85, t1, 0.85, t0]);
    b.quad(pt(t0, W / 2, 0), pt(t0, W / 2, h0), pt(t1, W / 2, h1), pt(t1, W / 2, 0), P,
           dim, lit, lit, dim, INNER);
    b.quad(pt(t0, -W / 2, 0), pt(t1, -W / 2, 0), pt(t1, -W / 2, h1), pt(t0, -W / 2, h0), nP,
           dim, dim, lit, lit, INNER);
  }
  stairSolid(b, pt, W, tint, R);
}

/** 階段も斜路も、塊としては同じ。上りきった先の縦面と、判定用のならした坂。 */
function stairSolid(b, pt, W, tint, R) {
  const dim = tint * 0.88, lit = tint;
  const T = RISE_T;
  b.quad(pt(T, -W / 2, 0), pt(T, W / 2, 0), pt(T, W / 2, LEVEL), pt(T, -W / 2, LEVEL),
         R, dim, dim, lit, lit, INNER);
  // 見た目は段でも、当たり判定はならした坂。刻むと足が引っかかって歩けたものではない
  b.hit(pt(0, -W / 2, 0), pt(0, W / 2, 0), pt(T, W / 2, LEVEL), pt(T, -W / 2, LEVEL));
  b.hit(pt(0, W / 2, 0), pt(T, W / 2, 0), pt(T, W / 2, LEVEL));
  b.hit(pt(0, -W / 2, 0), pt(T, -W / 2, LEVEL), pt(T, -W / 2, 0));
  b.hit(pt(T, -W / 2, 0), pt(T, W / 2, 0), pt(T, W / 2, LEVEL), pt(T, -W / 2, LEVEL));
}

/** チャンク1つぶんの見た目と当たり判定を作る。 */
export function buildChunk(world, kx, ky, kz) {
  const c = world.chunk(kx, ky, kz);
  const b = new Builder();
  const triStart = new Int32Array(NCELL + 1);
  for (let y = 0; y < CY; y++) for (let z = 0; z < CD; z++) for (let x = 0; x < CW; x++) {
    const i = idx(x, y, z);
    triStart[i] = b.tri.length / 9;
    if (c.solid[i] || !c.link[i]) continue;
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
