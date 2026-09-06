// 岩の塊から、空洞を彫る。
//
// 空洞は「箱の合併」でできている。
//   部屋の箱 … セルの中に、まわりの岩を残して彫った直方体
//   喉の箱   … 隣の部屋とのあいだの岩を貫く通り道
//   縦穴の箱 … 床と天井の板を貫く穴
//
// 貼るのは「箱の面のうち、他の箱に塞がれていない部分」だけ。
// 箱どうしは面でぴったり接するので、こうして得た面は必ず閉じている。
// 壁を立てているのではなく岩を彫っているから、
// 宙で切れた薄板のような壁は、原理的に生まれない。

import * as THREE from 'three';
import {
  CW, CY, CD, NCELL, CELL, LEVEL, idx, roomOf, throatOf, shaftOf,
} from './world.js';
import { hash32 } from './rng.js';

const RAO = 0.85;            // 隅の陰りが届く距離 (m)
const KAO = 0.46;            // 陰りの濃さ
const SUB = 1.25;            // 面を刻む目安の幅 (m)
const STEPS = 9;
const MARK_SIZE = 0.52;

/** 隅からの距離で陰りを作る。d は各辺までの距離、occ はその辺が岩かどうか。 */
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
    if (Math.abs(c0 - c2) > Math.abs(c1 - c3)) this.idx.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
    else this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** 法線を指定して貼る。向きが逆なら勝手に裏返す。 */
  quadN(p0, p1, p2, p3, n, c0, c1, c2, c3, uv) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) this.quad(p3, p2, p1, p0, n, c3, c2, c1, c0, uv);
    else this.quad(p0, p1, p2, p3, n, c0, c1, c2, c3, uv);
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

// ─── 面を貼る ────────────────────────────────────────────────────

const PT = {
  y: (u, v, c) => [u, c, v],
  x: (u, v, c) => [c, v, u],
  z: (u, v, c) => [u, v, c],
};
const NRM = {
  y: (s) => [0, s, 0], x: (s) => [s, 0, 0], z: (s) => [0, 0, s],
};
const FLIP = (kind, s) => (kind === 'z' ? s < 0 : s > 0);

/**
 * 平面上の矩形を貼る。hole があればそのまわりを4枚に割る。
 * sh(u,v) は明るさ。collide=false なら見た目だけ。
 */
function emitFace(b, kind, coord, s, u0, u1, v0, v1, hole, sh, collide = true) {
  if (u1 - u0 < 0.004 || v1 - v0 < 0.004) return;
  const parts = [];
  if (hole) {
    const hu0 = Math.max(u0, hole.u0), hu1 = Math.min(u1, hole.u1);
    const hv0 = Math.max(v0, hole.v0), hv1 = Math.min(v1, hole.v1);
    if (hu1 <= hu0 + 0.004 || hv1 <= hv0 + 0.004) parts.push([u0, u1, v0, v1]);
    else {
      if (hv0 > v0 + 0.004) parts.push([u0, u1, v0, hv0]);
      if (hv1 < v1 - 0.004) parts.push([u0, u1, hv1, v1]);
      if (hu0 > u0 + 0.004) parts.push([u0, hu0, hv0, hv1]);
      if (hu1 < u1 - 0.004) parts.push([hu1, u1, hv0, hv1]);
    }
  } else parts.push([u0, u1, v0, v1]);

  const P = PT[kind], n = NRM[kind](s), flip = FLIP(kind, s);
  for (const [a0, a1, c0, c1] of parts) {
    if (a1 - a0 < 0.004 || c1 - c0 < 0.004) continue;
    const nu = Math.max(1, Math.round((a1 - a0) / SUB));
    const nv = Math.max(1, Math.round((c1 - c0) / SUB));
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const ua = a0 + (a1 - a0) * (i / nu), ub = a0 + (a1 - a0) * ((i + 1) / nu);
      const va = c0 + (c1 - c0) * (j / nv), vb = c0 + (c1 - c0) * ((j + 1) / nv);
      const q = [P(ua, va, coord), P(ub, va, coord), P(ub, vb, coord), P(ua, vb, coord)];
      const sc = [sh(ua, va), sh(ub, va), sh(ub, vb), sh(ua, vb)];
      const uv = [ua * 0.25, va * 0.25, ub * 0.25, va * 0.25, ub * 0.25, vb * 0.25, ua * 0.25, vb * 0.25];
      if (flip) b.quad(q[3], q[2], q[1], q[0], n, sc[3], sc[2], sc[1], sc[0],
                       [uv[6], uv[7], uv[4], uv[5], uv[2], uv[3], uv[0], uv[1]]);
      else b.quad(q[0], q[1], q[2], q[3], n, sc[0], sc[1], sc[2], sc[3], uv);
    }
    if (collide) b.hit(P(a0, c0, coord), P(a1, c0, coord), P(a1, c1, coord), P(a0, c1, coord));
  }
}

/** 喉の内側4面。岩を貫いた通り道の、厚みそのもの。 */
/**
 * 喉の内側4面。ただし受け持つのは [lo, hi] の範囲だけ。
 * 喉はセルの境をまたぐので、両側のセルが自分の側の半分ずつを出す。
 * こうしないと、当たり判定を引く箱と、実際に面がある場所がずれる。
 */
function emitThroat(b, t, tint, lo, hi) {
  if (hi - lo < 0.01) return;
  const base = tint * 0.90;
  const sh = (u, v) => base;
  if (t.along) {                                   // X方向の喉
    emitFace(b, 'z', t.p0, 1, lo, hi, t.y0, t.y1, null, sh);
    emitFace(b, 'z', t.p1, -1, lo, hi, t.y0, t.y1, null, sh);
    emitFace(b, 'y', t.y0, 1, lo, hi, t.p0, t.p1, null, (u, v) => tint * 0.97);
    emitFace(b, 'y', t.y1, -1, lo, hi, t.p0, t.p1, null, (u, v) => base * 0.86);
  } else {                                         // Z方向の喉
    emitFace(b, 'x', t.p0, 1, lo, hi, t.y0, t.y1, null, sh);
    emitFace(b, 'x', t.p1, -1, lo, hi, t.y0, t.y1, null, sh);
    emitFace(b, 'y', t.y0, 1, t.p0, t.p1, lo, hi, null, (u, v) => tint * 0.97);
    emitFace(b, 'y', t.y1, -1, t.p0, t.p1, lo, hi, null, (u, v) => base * 0.86);
  }
}

/** 縦穴の内側4面。床と天井の板の厚みが、ここで見える。 */
function emitShaft(b, s, tint) {
  if (s.y1 - s.y0 < 0.01) return;               // 板がないなら縁もない
  const sh = () => tint * 0.86;
  emitFace(b, 'x', s.x0, 1, s.z0, s.z1, s.y0, s.y1, null, sh);
  emitFace(b, 'x', s.x1, -1, s.z0, s.z1, s.y0, s.y1, null, sh);
  emitFace(b, 'z', s.z0, 1, s.x0, s.x1, s.y0, s.y1, null, sh);
  emitFace(b, 'z', s.z1, -1, s.x0, s.x1, s.y0, s.y1, null, sh);
}

// ─── セルひとつ分 ────────────────────────────────────────────────

function emitCell(b, world, gx, gy, gz, link) {
  const seed = world.seed;
  const A = roomOf(world, gx, gy, gz);
  const tint = 1 - Math.min(0.16, Math.max(0, -gy) * 0.006);

  const up = shaftOf(world, A, gx, gy, gz);
  const below = (link & 8) ? roomOf(world, gx, gy - 1, gz) : null;
  const dn = below ? shaftOf(world, below, gx, gy - 1, gz) : null;
  const tXp = throatOf(world, A, gx, gy, gz, 0);
  const tZp = throatOf(world, A, gx, gy, gz, 4);
  const tXn = (link & 2) ? throatOf(world, roomOf(world, gx - 1, gy, gz), gx - 1, gy, gz, 0) : null;
  const tZn = (link & 32) ? throatOf(world, roomOf(world, gx, gy, gz - 1), gx, gy, gz - 1, 4) : null;

  // 隅の陰りは「そこが本当に岩の隅か」で決まる。
  // 面がそのまま隣へ続いているところに影を落とすと、セルの境目が透けて見えてしまう。
  const openness = (t, span) => (t ? Math.min(1, (t.p1 - t.p0) / span) : 0);
  const zSpan = A.z1 - A.z0, xSpan = A.x1 - A.x0;
  const oXn = 1 - 0.94 * openness(tXn, zSpan), oXp = 1 - 0.94 * openness(tXp, zSpan);
  const oZn = 1 - 0.94 * openness(tZn, xSpan), oZp = 1 - 0.94 * openness(tZp, xSpan);
  const covers = (s) => (s && s.x0 <= A.x0 + 0.02 && s.x1 >= A.x1 - 0.02
                           && s.z0 <= A.z0 + 0.02 && s.z1 >= A.z1 - 0.02) ? 0.08 : 0.85;
  const oDn = covers(dn), oUp = covers(up);
  const focc = [oXn, oXp, oZn, oZp];

  emitFace(b, 'y', A.y0, 1, A.x0, A.x1, A.z0, A.z1,
    dn ? { u0: dn.x0, u1: dn.x1, v0: dn.z0, v1: dn.z1 } : null,
    (u, v) => shade(u - A.x0, A.x1 - u, v - A.z0, A.z1 - v, focc, tint));
  emitFace(b, 'y', A.y1, -1, A.x0, A.x1, A.z0, A.z1,
    up ? { u0: up.x0, u1: up.x1, v0: up.z0, v1: up.z1 } : null,
    (u, v) => shade(u - A.x0, A.x1 - u, v - A.z0, A.z1 - v, focc, tint) * 0.90);

  // 4つの壁。喉の断面ぶんだけ穴があく
  const wall = (kind, coord, s, p0, p1, t, d, n, oa, ob) => {
    emitFace(b, kind, coord, s, p0, p1, A.y0, A.y1,
      t ? { u0: t.p0, u1: t.p1, v0: t.y0, v1: t.y1 } : null,
      (u, v) => shade(u - p0, p1 - u, v - A.y0, A.y1 - v, [oa, ob, oDn, oUp], tint));
    if (t) return;
    // 壁の印。同じ場所には、いつ戻ってきても同じ形が刻まれている
    const mh = hash32(seed, gx, gy, gz, d, 0x3A5D);
    if (mh % 1000 >= 52) return;
    const ms = p0 + (p1 - p0) * (0.26 + 0.48 * (((mh >>> 10) & 255) / 255));
    const mt = A.y0 + (A.y1 - A.y0) * (0.34 + 0.30 * (((mh >>> 18) & 127) / 127));
    const h = MARK_SIZE / 2, o = 0.012;
    const P = PT[kind];
    const q = [P(ms - h, mt - h, coord + n[0] * o + n[1] * o + n[2] * o),
               P(ms + h, mt - h, coord + n[0] * o + n[1] * o + n[2] * o),
               P(ms + h, mt + h, coord + n[0] * o + n[1] * o + n[2] * o),
               P(ms - h, mt + h, coord + n[0] * o + n[1] * o + n[2] * o)];
    b.mark(q[0], q[1], q[2], q[3], n, (mh >>> 26) & 15);
  };
  wall('x', A.x1, -1, A.z0, A.z1, tXp, 0, [-1, 0, 0], oZn, oZp);
  wall('x', A.x0, 1, A.z0, A.z1, tXn, 1, [1, 0, 0], oZn, oZp);
  wall('z', A.z1, -1, A.x0, A.x1, tZp, 4, [0, 0, -1], oXn, oXp);
  wall('z', A.z0, 1, A.x0, A.x1, tZn, 5, [0, 0, 1], oXn, oXp);

  const bxp = (gx + 1) * CELL, bxn = gx * CELL;
  const bzp = (gz + 1) * CELL, bzn = gz * CELL;
  if (tXp) emitThroat(b, tXp, tint, tXp.lo, bxp);
  if (tXn) emitThroat(b, tXn, tint, bxn, tXn.hi);
  if (tZp) emitThroat(b, tZp, tint, tZp.lo, bzp);
  if (tZn) emitThroat(b, tZn, tint, bzn, tZn.hi);
  if (up) {
    emitShaft(b, up, tint);
    if (up.stair) emitStair(b, A, up, tint);
  }
}

/** 階段。行き止まりなら部屋いっぱいに広がり、左右はそのまま岩の壁になる。 */
function emitStair(b, A, sb, tint) {
  const p = sb.stair, ax = p.axis, sg = p.sign;
  const aMin = ax === 0 ? A.x0 : A.z0, aMax = ax === 0 ? A.x1 : A.z1;
  const qMin = ax === 0 ? A.z0 : A.x0, qMax = ax === 0 ? A.z1 : A.x1;
  const near = sg > 0 ? aMin : aMax;
  const qc = (qMin + qMax) / 2 + p.off, hw = p.width / 2;
  const q0 = Math.max(qMin + 0.012, qc - hw), q1 = Math.min(qMax - 0.012, qc + hw);
  const y0 = A.y0;
  const pt = (t, q, h) => (ax === 0
    ? [near + sg * t * p.run, y0 + h, q]
    : [q, y0 + h, near + sg * t * p.run]);
  const nA = ax === 0 ? [sg, 0, 0] : [0, 0, sg];
  const nB = ax === 0 ? [-sg, 0, 0] : [0, 0, -sg];
  const nQ0 = ax === 0 ? [0, 0, -1] : [-1, 0, 0];
  const nQ1 = ax === 0 ? [0, 0, 1] : [1, 0, 0];
  const dim = tint * 0.86, lit = tint;

  if (sb.v.smooth) {
    const N = 6, len = Math.hypot(p.run, LEVEL);
    const sn = [nA[0] * -LEVEL / len, p.run / len, nA[2] * -LEVEL / len];
    for (let k = 0; k < N; k++) {
      const t0 = k / N, t1 = (k + 1) / N, h0 = t0 * LEVEL, h1 = t1 * LEVEL;
      const c0 = tint * (0.90 + 0.10 * t0), c1 = tint * (0.90 + 0.10 * t1);
      b.quadN(pt(t0, q0, h0), pt(t1, q0, h1), pt(t1, q1, h1), pt(t0, q1, h0), sn, c0 * .93, c1 * .93, c1, c0);
      if (!p.full) {
        b.quadN(pt(t0, q0, 0), pt(t1, q0, 0), pt(t1, q0, h1), pt(t0, q0, h0), nQ0, dim, dim, lit, lit);
        b.quadN(pt(t0, q1, 0), pt(t1, q1, 0), pt(t1, q1, h1), pt(t0, q1, h0), nQ1, dim, dim, lit, lit);
      }
    }
  } else {
    for (let k = 0; k < STEPS; k++) {
      const t0 = k / STEPS, t1 = (k + 1) / STEPS;
      const h0 = t0 * LEVEL, h1 = t1 * LEVEL;
      b.quadN(pt(t0, q0, h0), pt(t0, q1, h0), pt(t0, q1, h1), pt(t0, q0, h1), nB, dim, dim, lit, lit);
      b.quadN(pt(t0, q0, h1), pt(t1, q0, h1), pt(t1, q1, h1), pt(t0, q1, h1), [0, 1, 0], dim, lit, lit, dim);
      if (!p.full) {
        b.quadN(pt(t0, q0, 0), pt(t1, q0, 0), pt(t1, q0, h1), pt(t0, q0, h1), nQ0, dim, dim, lit, lit);
        b.quadN(pt(t0, q1, 0), pt(t1, q1, 0), pt(t1, q1, h1), pt(t0, q1, h1), nQ1, dim, dim, lit, lit);
      }
    }
  }
  b.quadN(pt(1, q0, 0), pt(1, q1, 0), pt(1, q1, LEVEL), pt(1, q0, LEVEL), nA, dim, dim, lit, lit);

  // 見た目は段でも、当たり判定はならした坂
  b.hit(pt(0, q0, 0), pt(0, q1, 0), pt(1, q1, LEVEL), pt(1, q0, LEVEL));
  b.hit(pt(0, q0, 0), pt(1, q0, 0), pt(1, q0, LEVEL));
  b.hit(pt(0, q1, 0), pt(1, q1, LEVEL), pt(1, q1, 0));
  b.hit(pt(1, q0, 0), pt(1, q1, 0), pt(1, q1, LEVEL), pt(1, q0, LEVEL));
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
