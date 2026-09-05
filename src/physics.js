// 体と、壁のぶつかり。
//
// 体はカプセル（縦に並べた4つの球で近似）。世界の側は三角形の集まり。
// めり込んだぶんだけ押し返す、を数回くり返して落ち着かせる。
// 階段は見た目こそ段だが、判定用には均した坂を積んであるので足を取られない。

import { CELL, LEVEL, CW, CY, CD, idx, fdiv, fmod } from './world.js';

export const R = 0.32;          // 体の半径
export const HEIGHT = 1.74;     // 背丈
export const EYE = 1.58;        // 目の高さ
const SPH = [0.34, 0.70, 1.06, 1.42];   // 球の中心（足元から）
const GROUND_Y = 0.55;          // これより上を向いた面は「立てる床」
const GRAVITY = 22;
const TERMINAL = 42;

/** 点pに最も近い三角形abc上の点。 */
function closestOnTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v; return;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = bx + (cx - bx) * w; out[1] = by + (cy - by) * w; out[2] = bz + (cz - bz) * w; return;
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
}

/** 読み込み済みチャンクの三角形を、位置から引ける形にしておく箱。 */
export class Colliders {
  constructor() { this.chunks = new Map(); }
  set(key, mesh) { this.chunks.set(key, mesh); }
  delete(key) { this.chunks.delete(key); }
  clear() { this.chunks.clear(); }

  /** 直方体に重なるセルの三角形すべてに fn(tri, offset) を呼ぶ。 */
  each(x0, y0, z0, x1, y1, z1, fn) {
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cy0 = Math.floor(y0 / LEVEL), cy1 = Math.floor(y1 / LEVEL);
    const cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cz = cz0; cz <= cz1; cz++)
        for (let cx = cx0; cx <= cx1; cx++) {
          const m = this.chunks.get(fdiv(cx, CW) + ',' + fdiv(cy, CY) + ',' + fdiv(cz, CD));
          if (!m) continue;
          const i = idx(fmod(cx, CW), fmod(cy, CY), fmod(cz, CD));
          const s = m.triStart[i], e = m.triStart[i + 1];
          for (let t = s; t < e; t++) fn(m.tri, t * 9);
        }
  }
}

const cp = [0, 0, 0];

/**
 * 位置を動かし、壁に押し戻される。
 * body: { x,y,z, vx,vy,vz, grounded, gnx,gny,gnz, impact }
 */
export function step(body, col, dt) {
  // 接地している間は重力を積まない。
  // 積むと、坂を登る上向きの速度を毎フレーム打ち消してしまい、
  // フレームが遅い機械ほど階段が登れなくなる。
  if (!body.grounded) body.vy = Math.max(-TERMINAL, body.vy - GRAVITY * dt);

  const dist = Math.hypot(body.vx, body.vy, body.vz) * dt;
  const n = Math.min(10, Math.max(1, Math.ceil(dist / 0.20)));
  const h = dt / n;

  const wasFalling = body.vy;
  body.grounded = false;
  body.gny = 0;
  let hitCeil = false;

  for (let s = 0; s < n; s++) {
    body.x += body.vx * h; body.y += body.vy * h; body.z += body.vz * h;

    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      // 押し戻すたびに位置が変わるので、そのつど拾い直す
      col.each(body.x - R - 0.1, body.y - 0.1, body.z - R - 0.1,
               body.x + R + 0.1, body.y + HEIGHT + 0.1, body.z + R + 0.1,
        (tri, o) => {
          for (let k = 0; k < SPH.length; k++) {
            const sx = body.x, sy = body.y + SPH[k], sz = body.z;
            closestOnTri(sx, sy, sz,
              tri[o], tri[o + 1], tri[o + 2], tri[o + 3], tri[o + 4], tri[o + 5],
              tri[o + 6], tri[o + 7], tri[o + 8], cp);
            let dx = sx - cp[0], dy = sy - cp[1], dz = sz - cp[2];
            let len = Math.hypot(dx, dy, dz);
            if (len >= R) continue;
            if (len < 1e-5) {
              // ちょうど面の上。三角形の法線で逃がす
              const ux = tri[o + 3] - tri[o], uy = tri[o + 4] - tri[o + 1], uz = tri[o + 5] - tri[o + 2];
              const vx2 = tri[o + 6] - tri[o], vy2 = tri[o + 7] - tri[o + 1], vz2 = tri[o + 8] - tri[o + 2];
              dx = uy * vz2 - uz * vy2; dy = uz * vx2 - ux * vz2; dz = ux * vy2 - uy * vx2;
              len = Math.hypot(dx, dy, dz) || 1;
              dx /= len; dy /= len; dz /= len; len = 0;
            } else { dx /= len; dy /= len; dz /= len; }
            const push = R - len;
            body.x += dx * push; body.y += dy * push; body.z += dz * push;
            moved = true;

            if (dy > GROUND_Y) {
              if (dy > body.gny) { body.gnx = dx; body.gny = dy; body.gnz = dz; }
              body.grounded = true;
            } else if (dy < -0.5) hitCeil = true;

            // 面に食い込む向きの速度を殺す
            const vd = body.vx * dx + body.vy * dy + body.vz * dz;
            if (vd < 0) { body.vx -= dx * vd; body.vy -= dy * vd; body.vz -= dz * vd; }
          }
        });
      if (!moved) break;
    }
  }
  if (hitCeil && body.vy > 0) body.vy = 0;
  body.impact = body.grounded && wasFalling < -6 ? -wasFalling : 0;
  return body;
}
