// 無限に広がる地下の生成。
//
// 世界は保存しない。セルの座標とシードから、必要になった分だけ組み立て直す。
// だから引き返せば、さっきと寸分たがわぬ通路がまたそこにある。
//
// 歩ける保証は3つの局所的な規則でできている:
//   1. チャンク内の開いたセルは全域木で必ず全部つながる
//   2. 隣り合うチャンクの境界面には、必ず1つ以上の出入口を開ける
//   3. 落下は一方通行なので、往復できる辺だけで数え直して足りなければ階段を足す
//
// 「座標だけで決まる純粋な関数」と「チャンクが持つデータ」を分けてあるのが肝。
// 純粋な側（天井の高さ、戸口の大きさ、吹き抜けの位置、縦のつなぎ方）は
// 隣のチャンクを作らなくても答えが出るので、生成が再帰しない。

import { hash32, rngFor, shuffle } from './rng.js';

export * from './dims.js';
import {
  CW, CY, CD, NCELL, CELL, LEVEL, SLAB, CEIL_STD, CEIL_LOW,
  WALL, ROOM_MAX, ROOM_MIN, RISE_T, LANDING,
  DX, DY, DZ, OPP, HDIRS, V_SHAFT, V_STAIR, V_OPEN,
  fdiv, fmod, idx, MIN_GAP, MIN_HEAD, PARAPET, PARAPET_T,
} from './dims.js';
import {
  landmarkOf, inLandmark, lmRock, lmLinked, lmForceOpen, lmVFeat, lmRoom, lmSill, lmSolids,
} from './landmarks.js';
export * from './landmarks.js';

// ─── 座標だけで決まるもの ────────────────────────────────────────

const VG = 11;   // 吹き抜けを置く粗い格子の目（セル数）

/**
 * 巨大な空洞。粗い格子の目ひとつにつき、多くて一箇所。
 * 目の内側に収まるよう余白をとってあるので、あるセルが中にいるかどうかは
 * その座標が属する目ひとつを見れば決まる。隣を調べなくていい。
 */
export function voidBox(seed, gx, gz) {
  const vx = fdiv(gx, VG), vz = fdiv(gz, VG);
  const h = hash32(seed, vx, vz, 0x0DEC);
  if (h % 100 >= 32) return null;
  const w = 3 + ((h >>> 7) % 3), d = 3 + ((h >>> 10) % 3);
  const x0 = vx * VG + 2 + ((h >>> 13) % (VG - 4 - w));
  const z0 = vz * VG + 2 + ((h >>> 17) % (VG - 4 - d));
  const y1 = 2 - ((h >>> 21) % 6);
  const y0 = y1 - (10 + ((h >>> 24) % 15));     // 10〜24階ぶん。深いものは60mを超える
  return { x0, x1: x0 + w - 1, z0, z1: z0 + d - 1, y0, y1 };
}

export function inVoid(seed, gx, gy, gz) {
  if (inLandmark(seed, gx, gy, gz)) return false;      // ランドマークが優先
  const b = voidBox(seed, gx, gz);
  return !!b && gx >= b.x0 && gx <= b.x1 && gz >= b.z0 && gz <= b.z1 && gy >= b.y0 && gy <= b.y1;
}

/** そのセルの天井までの高さ。低い天井のセルは上とつながれない（後で効いてくる）。 */
export function ceilHeight(seed, gx, gy, gz) {
  const lm = lmRoom(seed, gx, gy, gz);
  if (lm) return lm.ceil;
  if (inBig(seed, gx, gy, gz)) return CEIL_STD;
  return (hash32(seed, gx, gy, gz, 0x10C0) % 100) < 13 ? CEIL_LOW : CEIL_STD;
}
export const isLowCeil = (seed, gx, gy, gz) => ceilHeight(seed, gx, gy, gz) < CEIL_STD;

// ─── 裂け目と、そこに架かる橋 ────────────────────────────────────
// X方向にどこまでも長く、Z方向は狭く、Y方向にひたすら深い溝。
// ところどころに橋が架かっていて、渡りながら見わたすと、
// 手の届かない高さと距離に、同じような橋がいくつも見える。

const CGX = 64, CGZ = 20;

export function chasmBox(seed, gx, gz) {
  const cx = fdiv(gx, CGX), cz = fdiv(gz, CGZ);
  const h = hash32(seed, cx, cz, 0x0C1A);
  if (h % 100 >= 30) return null;
  const len = 26 + ((h >>> 7) % 18);            // 26〜43セル（145〜240m）
  const wid = 2 + ((h >>> 12) % 2);
  const x0 = cx * CGX + 6 + ((h >>> 15) % (CGX - 12 - len));
  const z0 = cz * CGZ + 6 + ((h >>> 20) % (CGZ - 12 - wid));
  const y1 = 1 - ((h >>> 24) % 4);
  const y0 = y1 - (16 + ((h >>> 27) % 14));     // 16〜29階（43〜78m）
  return { x0, x1: x0 + len - 1, z0, z1: z0 + wid - 1, y0, y1 };
}

export function inChasm(seed, gx, gy, gz) {
  if (inLandmark(seed, gx, gy, gz)) return false;      // ランドマークが優先
  const b = chasmBox(seed, gx, gz);
  return !!b && gx >= b.x0 && gx <= b.x1 && gz >= b.z0 && gz <= b.z1 && gy >= b.y0 && gy <= b.y1;
}

/** 裂け目を横断する橋。だいたい7セルに1本、高さはばらばら。 */
export function isBridge(seed, gx, gy, gz) {
  const b = chasmBox(seed, gx, gz);
  if (!b || gx <= b.x0 || gx >= b.x1 || gz < b.z0 || gz > b.z1) return false;
  if (gy <= b.y0 || gy >= b.y1) return false;
  const h = hash32(seed, b.x0, b.z0, gx, 0xB41D);
  if (h % 7 !== 0) return false;
  return gy === b.y0 + 1 + ((h >>> 8) % (b.y1 - b.y0 - 1));
}

export const inBig = (seed, gx, gy, gz) =>
  inVoid(seed, gx, gy, gz) || inChasm(seed, gx, gy, gz);

/** 橋の欄干。越えられないが、見わたせる。裂け目に沿う向きの口だけ持ち上げる。 */
export function linkSill(seed, gx, gy, gz, d) {
  const ls = lmSill(seed, gx, gy, gz, d);
  if (ls) return ls;
  if (d > 1) return 0;                                    // 裂け目に沿う向きだけ
  if (isBridge(seed, gx, gy, gz) || isBridge(seed, gx + DX[d], gy, gz)) return PARAPET;
  return 0;
}
export const walkable = (seed, gx, gy, gz, d) => linkSill(seed, gx, gy, gz, d) < 0.5;

/**
 * 縦のつなぎ方の素案。大空間の中は必ず「床なし」。
 * 後でチャンクが、往復できないぶんだけ落下穴を階段に書き換える。
 * 床なしだけは書き換えない——上下のチャンクが独立に同じ答えを出す必要があるから。
 */
export function baseVFeat(seed, gx, gy, gz) {
  const lv = lmVFeat(seed, gx, gy, gz);
  if (lv) return lv;
  if (inLandmark(seed, gx, gy, gz)) return { kind: V_SHAFT, corner: 0 };
  // ランドマークの戸口をまたいだ先が、床のない吹き抜けであってはいけない。
  // 出たとたんに落ちる、では出入口の意味がない。
  if (lmForceOpen(seed, gx, gy + 1, gz)) {
    const h = hash32(seed, gx, gy, gz, 0x57A1);
    return { kind: V_SHAFT, corner: (h >>> 9) & 3 };
  }
  if (inVoid(seed, gx, gy, gz) && inVoid(seed, gx, gy + 1, gz)) return { kind: V_OPEN };
  if (inChasm(seed, gx, gy, gz) && inChasm(seed, gx, gy + 1, gz)) return { kind: V_OPEN };
  const h = hash32(seed, gx, gy, gz, 0x57A1);
  const r = h % 100;
  if (r < 14) return { kind: V_OPEN };
  if (r < 60) return { kind: V_STAIR, dir: HDIRS[(h >>> 7) & 3], smooth: ((h >>> 21) % 100) < 42 };
  return { kind: V_SHAFT, corner: (h >>> 9) & 3 };
}

/** 上とつながっているセルに床があるか。大空間の途中には床がない。 */
export function hasFloorBelow(seed, gx, gy, gz) {
  return baseVFeat(seed, gx, gy - 1, gz).kind !== V_OPEN;
}

/**
 * 部屋の広がり。セルの境界から WALL 以上は必ず岩を残す。
 * 大きさは3セル角のかたまりごとに決めるので、通路は何セルか同じ幅で続き、
 * かたまりの境で変わる。変わるところが、そのまま戸口になる。
 */
/**
 * 通路の幅は、走る向きに沿って変えない。
 * 途中で理由もなく狭まると、掘った通路ではなく凸凹の壁に見えてしまう。
 * だから幅は「その通路がどの高さの、どの筋か」だけで決まる。
 */
function corridorWidth(seed, axis, gy, perp) {
  return ROOM_MIN + ((hash32(seed, axis, gy, perp, 0x2C00) % 128) / 128) * 1.05;
}

export function roomSize(seed, gx, gy, gz, link) {
  if (inBig(seed, gx, gy, gz)) return { w: ROOM_MAX, d: ROOM_MAX };
  const hasX = (link & 3) !== 0, hasZ = (link & 48) !== 0;
  const h = hash32(seed, fdiv(gx, 3), gy, fdiv(gz, 3), 0x2100 + (hasX ? 1 : 0) + (hasZ ? 2 : 0));
  const r1 = (h % 128) / 128, r2 = ((h >>> 9) % 128) / 128;
  if (hasX && !hasZ) return { w: ROOM_MAX, d: corridorWidth(seed, 0, gy, gz) };
  if (hasZ && !hasX) return { w: corridorWidth(seed, 1, gy, gx), d: ROOM_MAX };
  if (hasX && hasZ) {
    const big = ((h >>> 18) % 100) < 38;
    return big ? { w: ROOM_MAX, d: ROOM_MAX }
               : { w: 2.7 + r1 * 1.5, d: 2.7 + r2 * 1.5 };
  }
  return { w: ROOM_MIN + r1 * 1.3, d: ROOM_MIN + r2 * 1.3 };
}

// ─── 箱 ──────────────────────────────────────────────────────────
// すべて世界座標の直方体。y0/y1 は床の上面と天井の下面。

/** セルの中に彫られた部屋。 */

/**
 * 階段の向き。部屋の形より先に決まっていないと堂々めぐりになる。
 *
 * 誰かが「上の階へ行きたいから」架けた階段に見えてほしい。
 * だから、登りきった先にちゃんと道が続いていて、
 * 下からはまっすぐ入ってこられて、
 * 階段が下の階の出口を塞がない向きを選ぶ。
 */
export function stairAxis(link, up, v) {
  let best = -1, bestScore = -1e9;
  for (const d of [0, 1, 4, 5]) {
    let sc = 0;
    if (up & (1 << d)) sc += 6;              // 登りきった先に道がある
    if (link & (1 << OPP[d])) sc += 4;       // 下からまっすぐ入ってこられる
    if (link & (1 << d)) sc -= 7;            // 階段が下の階の出口を塞ぐ
    if (up & (1 << OPP[d])) sc -= 3;         // 上の道が階段の真上に開いてしまう
    if (d === v.dir) sc += 1;                // 同点なら素案どおり
    if (sc > bestScore) { bestScore = sc; best = d; }
  }
  const dir = best;
  const deg = ((link & 1) ? 1 : 0) + ((link & 2) ? 1 : 0)
            + ((link & 16) ? 1 : 0) + ((link & 32) ? 1 : 0);
  return { dir, axis: (dir === 0 || dir === 1) ? 0 : 1, sign: (dir === 0 || dir === 4) ? 1 : -1, deg };
}

/**
 * 階段が立つ柱の、部屋の形。
 * 上下でずれていると階段が岩に刺さるので、下の部屋に合わせて両方そろえる。
 * 上の階に横道が残っているなら、階段の脇に細い通路を空けておく。
 */
function stairColumn(world, gx, gy, gz) {
  const seed = world.seed;
  if (inLandmark(seed, gx, gy, gz)) return null;   // ランドマークの形はランドマークが決める
  const link = world.linkBits(gx, gy, gz);
  let ly = gy, lower = link;
  if ((link & 8) && world.vfeat(gx, gy - 1, gz) && world.vfeat(gx, gy - 1, gz).kind === V_STAIR) {
    ly = gy - 1; lower = world.linkBits(gx, gy - 1, gz);
  } else if (!((link & 4) && world.vfeat(gx, gy, gz) && world.vfeat(gx, gy, gz).kind === V_STAIR)) {
    return null;
  }
  const v = world.vfeat(gx, ly, gz);
  const up = world.linkBits(gx, ly + 1, gz);
  const a = stairAxis(lower, up, v);
  const both = lower | up;
  // 階段の脇に通路を空けるのは、上下のどちらかに本当に横道があるときだけ。
  // なければ部屋いっぱいに広げて、左右をそのまま岩の壁にする。
  const negBit = a.axis === 0 ? 32 : 2, posBit = a.axis === 0 ? 16 : 1;
  let needNeg = (both & negBit) !== 0, needPos = (both & posBit) !== 0;
  if ((lower & (1 << a.dir)) && !needNeg && !needPos) needNeg = true;   // 登り切った先にも道がある
  const lanes = (needNeg ? 1 : 0) + (needPos ? 1 : 0);
  const { w, d } = roomSize(seed, gx, ly, gz, lower);
  const perp = Math.max(a.axis === 0 ? d : w, 1.55 + lanes * 0.88);
  return { axis: a.axis, sign: a.sign, dir: a.dir, needNeg, needPos, lanes, perp, ly, v };
}

export function roomOf(world, gx, gy, gz) {
  const seed = world.seed;
  const link = world.linkBits(gx, gy, gz);
  const yF = gy * LEVEL;
  const ox = gx * CELL, oz = gz * CELL;
  let y1 = yF + ceilHeight(seed, gx, gy, gz);
  const upOpen = (link & 4) && world.vfeat(gx, gy, gz).kind === V_OPEN;

  const lm = lmRoom(seed, gx, gy, gz);
  if (lm) {
    if (upOpen) y1 = yF + LEVEL;
    if (lm.full) {
      return { x0: ox, x1: ox + CELL, z0: oz, z1: oz + CELL, y0: yF, y1,
               link, w: CELL, d: CELL, big: true, lm };
    }
    const cx0 = ox + CELL / 2, cz0 = oz + CELL / 2;
    return { x0: cx0 - lm.w / 2, x1: cx0 + lm.w / 2, z0: cz0 - lm.d / 2, z1: cz0 + lm.d / 2,
             y0: yF, y1, link, w: lm.w, d: lm.d, big: false, lm };
  }

  if (inBig(seed, gx, gy, gz)) {
    // 大空間の中は、セルいっぱいに彫る。隣とぴったり面で接するので、
    // 梁のような継ぎ目がいっさい出ない。
    if (upOpen) y1 = yF + LEVEL;
    const px = isBridge(seed, gx, gy, gz) ? PARAPET_T : 0;   // 橋は欄干のぶんだけ引っこむ
    return { x0: ox + px, x1: ox + CELL - px, z0: oz, z1: oz + CELL,
             y0: yF, y1, link, w: CELL - px * 2, d: CELL, big: true };
  }
  let w, d;
  const col = stairColumn(world, gx, gy, gz);
  if (col) {
    // 走る向きは目いっぱい。横は上の階に必要なぶんだけ
    w = col.axis === 0 ? ROOM_MAX : col.perp;
    d = col.axis === 0 ? col.perp : ROOM_MAX;
  } else {
    ({ w, d } = roomSize(seed, gx, gy, gz, link));
  }
  const cx = ox + CELL / 2, cz = oz + CELL / 2;
  return { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2,
           y0: yF, y1, link, w, d, big: false, col };
}

/**
 * 隣の部屋へ貫く喉。d は 0(+X) か 4(+Z)。
 * 幅がそろっているところは素通しにし、変わるところだけ戸口になる。
 */
export function throatOf(world, A, gx, gy, gz, d) {
  if (!(A.link & (1 << d))) return null;
  const nx = gx + DX[d], nz = gz + DZ[d];
  const B = roomOf(world, nx, gy, nz);
  const seed = world.seed;
  const along = d === 0;
  const p0 = along ? Math.max(A.z0, B.z0) : Math.max(A.x0, B.x0);
  const p1 = along ? Math.min(A.z1, B.z1) : Math.min(A.x1, B.x1);
  if (p1 - p0 < 0.5) return null;
  const perpA = along ? A.d : A.w, perpB = along ? B.d : B.w;
  const h = hash32(seed, gx, gy, gz, 0xA9E0 + d);
  let w = p1 - p0;
  if (A.big && B.big) {
    // 大空間どうしは面で接しているだけ。絞らない
    const sill = linkSill(seed, gx, gy, gz, d);
    return { lo: along ? A.x1 : A.z1, hi: along ? B.x0 : B.z0,
             p0, p1, y0: A.y0 + sill, y1: Math.min(A.y1, B.y1), along, A, B };
  }
  if (Math.abs(perpA - perpB) > 0.12 || (h % 100) < 24) {
    w = Math.max(1.35, Math.min(w, 1.35 + ((h >>> 7) % 100) / 100 * 1.9));
  }
  const mid = (p0 + p1) / 2;
  const q0 = Math.max(p0, mid - w / 2), q1 = Math.min(p1, mid + w / 2);
  const sill = linkSill(seed, gx, gy, gz, d);
  let top = Math.min(A.y1, B.y1);
  if (!sill && top - A.y0 >= 2.4 && ((h >>> 16) % 100) < 42) {
    top = A.y0 + 2.05 + ((h >>> 22) % 100) / 100 * 0.35;
  }
  return {
    lo: along ? A.x1 : A.z1, hi: along ? B.x0 : B.z0,
    p0: q0, p1: q1, y0: A.y0 + sill, y1: top, along, A, B,
  };
}

/** 床と天井の板を貫く縦穴。 */
export function shaftOf(world, A, gx, gy, gz) {
  const v = world.vfeat(gx, gy, gz);
  if (!v) return null;
  const B = roomOf(world, gx, gy + 1, gz);
  const ix0 = Math.max(A.x0, B.x0), ix1 = Math.min(A.x1, B.x1);
  const iz0 = Math.max(A.z0, B.z0), iz1 = Math.min(A.z1, B.z1);
  if (ix1 - ix0 < 0.5 || iz1 - iz0 < 0.5) return null;
  const box = { y0: A.y1, y1: B.y0, v, A, B };
  if (v.kind === V_OPEN) return { ...box, x0: ix0, x1: ix1, z0: iz0, z1: iz1 };
  if (v.kind === V_STAIR) {
    const p = stairPlan(A, v);
    if (p.axis === 0) {
      const a0 = p.sign > 0 ? A.x0 : A.x1 - p.run;
      const qc = (A.z0 + A.z1) / 2 + p.off, hw = p.width / 2;
      return { ...box, x0: Math.max(ix0, a0), x1: Math.min(ix1, a0 + p.run),
               z0: Math.max(iz0, qc - hw), z1: Math.min(iz1, qc + hw), stair: p };
    }
    const a0 = p.sign > 0 ? A.z0 : A.z1 - p.run;
    const qc = (A.x0 + A.x1) / 2 + p.off, hw = p.width / 2;
    return { ...box, x0: Math.max(ix0, qc - hw), x1: Math.min(ix1, qc + hw),
             z0: Math.max(iz0, a0), z1: Math.min(iz1, a0 + p.run), stair: p };
  }
  // 落下穴。隅に寄せた四角。歩ける縁を必ず残す
  const s = Math.min(2.5, ix1 - ix0 - 0.95, iz1 - iz0 - 0.95);
  if (s < 0.8) return { ...box, x0: ix0, x1: ix1, z0: iz0, z1: iz1 };
  const cnr = v.corner;
  const x0 = (cnr === 1 || cnr === 2) ? ix1 - s : ix0;
  const z0 = (cnr === 2 || cnr === 3) ? iz1 - s : iz0;
  return { ...box, x0, x1: x0 + s, z0, z1: z0 + s };
}

/** 階段の据え方。横に道がなければ部屋いっぱいに広げ、左右を岩のままにする。 */
/** 階段の据え方。横に道がなければ部屋いっぱいに広げ、左右をそのまま岩にする。 */
export function stairPlan(A, v) {
  if (v && v.lm) {
    // ランドマークの階段は、通路の幅いっぱいに架かっている
    const axis = (v.dir === 0 || v.dir === 1) ? 0 : 1;
    const sign = (v.dir === 0 || v.dir === 4) ? 1 : -1;
    const len = axis === 0 ? A.w : A.d, perp = axis === 0 ? A.d : A.w;
    return { axis, sign, dir: v.dir, run: Math.max(2.2, len - LANDING),
             width: perp, off: 0, full: true, perp };
  }
  const c = A.col || { axis: (v.dir === 0 || v.dir === 1) ? 0 : 1,
                       sign: (v.dir === 0 || v.dir === 4) ? 1 : -1, dir: v.dir,
                       needNeg: true, needPos: true, lanes: 2 };
  const len = c.axis === 0 ? A.w : A.d;
  const perp = c.axis === 0 ? A.d : A.w;
  const run = Math.max(2.0, len - LANDING);
  const width = Math.max(1.5, perp - c.lanes * 0.88);
  // 通路の要らない側へ寄せて、そちら側は壁に密着させる
  const off = ((c.needNeg ? 1 : 0) - (c.needPos ? 1 : 0)) * (perp - width) / 2;
  return { axis: c.axis, sign: c.sign, dir: c.dir, run, width, off, full: c.lanes === 0, perp };
}

// ─── チャンク ────────────────────────────────────────────────────

class Chunk {
  constructor(kx, ky, kz) {
    this.kx = kx; this.ky = ky; this.kz = kz;
    this.solid = new Uint8Array(NCELL);   // 1 = 岩。掘られていない
    this.link = new Uint8Array(NCELL);    // 方向dへ通れるなら bit d。両側のセルに同じことを書く
    this.stair = new Uint8Array(NCELL);   // 素案の落下穴を階段に書き換えた印
    this.carved = false;
  }
  gx(i) { return this.kx * CW + (i % CW); }
  gy(i) { return this.ky * CY + ((i / (CW * CD)) | 0); }
  gz(i) { return this.kz * CD + (((i / CW) | 0) % CD); }
}

/** 岩と空洞の分布だけを決める第一段階。隣のチャンクからも覗かれるので、リンク生成とは分ける。 */
function genBase(seed, kx, ky, kz) {
  const c = new Chunk(kx, ky, kz);
  const rng = rngFor(seed, kx, ky, kz, 0x9E37);
  const t = rng();
  const density = t < 0.18 ? 0.06 : t < 0.72 ? 0.20 : 0.36;
  const depthBias = Math.min(0.14, Math.max(0, -ky) * 0.012);

  for (let i = 0; i < NCELL; i++) c.solid[i] = rng() < density + depthBias ? 1 : 0;
  for (let i = 0; i < NCELL; i++) {
    const gx = c.gx(i), gy = c.gy(i), gz = c.gz(i);
    if (inLandmark(seed, gx, gy, gz)) { c.solid[i] = lmRock(seed, gx, gy, gz) ? 1 : 0; continue; }
    if (lmForceOpen(seed, gx, gy, gz)) { c.solid[i] = 0; continue; }   // 出入口の外側
    if (inBig(seed, gx, gy, gz)) c.solid[i] = 0;
  }

  // 空洞がばらけていたら、細い道を通してひとつにする。
  // 消してしまうと、せっかくの巨大空洞まで無かったことになりかねない。
  const comp = new Int32Array(NCELL).fill(-1);
  const reps = [], sizes = [];
  const stack = [];
  for (let s = 0; s < NCELL; s++) {
    if (c.solid[s] || comp[s] >= 0) continue;
    const id = reps.length; reps.push(s); sizes.push(0);
    stack.length = 0; stack.push(s); comp[s] = id;
    while (stack.length) {
      const i = stack.pop(); sizes[id]++;
      const x = i % CW, z = ((i / CW) | 0) % CD, y = (i / (CW * CD)) | 0;
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (nx < 0 || nx >= CW || ny < 0 || ny >= CY || nz < 0 || nz >= CD) continue;
        const j = idx(nx, ny, nz);
        if (comp[j] >= 0 || c.solid[j]) continue;
        comp[j] = id; stack.push(j);
      }
    }
  }
  if (!reps.length) {
    for (let y = 0; y < CY; y++) c.solid[idx(CW >> 1, y, CD >> 1)] = 0;
    return c;
  }
  let main = 0;
  for (let k = 1; k < reps.length; k++) if (sizes[k] > sizes[main]) main = k;
  const dst = reps[main];
  const bx = dst % CW, bz = ((dst / CW) | 0) % CD, by = (dst / (CW * CD)) | 0;
  for (let k = 0; k < reps.length; k++) {
    if (k === main) continue;
    let x = reps[k] % CW, z = ((reps[k] / CW) | 0) % CD, y = (reps[k] / (CW * CD)) | 0;
    const dig = () => {
      const i = idx(x, y, z);
      if (!inLandmark(seed, c.gx(i), c.gy(i), c.gz(i))) c.solid[i] = 0;
    };
    while (x !== bx) { x += Math.sign(bx - x); dig(); }
    while (z !== bz) { z += Math.sign(bz - z); dig(); }
    while (y !== by) { y += Math.sign(by - y); dig(); }
  }
  return c;
}

/** 上へつなげるか。低い天井のセルからは伸ばせない。 */
function canLinkUp(seed, c, i) {
  return !isLowCeil(seed, c.gx(i), c.gy(i), c.gz(i));
}

/**
 * 迷路の骨格として縦につないでよいか。
 * 床のない縦（吹き抜け）を骨格に使うと、その下端が「落ちて入るだけの袋小路」になる。
 * 吹き抜けは骨格ではなく、あくまで景色として足す。
 */
function structuralUp(seed, c, i) {
  if (!canLinkUp(seed, c, i)) return false;
  const gx = c.gx(i), gy = c.gy(i), gz = c.gz(i);
  if (inBig(seed, gx, gy, gz) && inBig(seed, gx, gy + 1, gz)) return true;
  return baseVFeat(seed, gx, gy, gz).kind !== V_OPEN;
}

/** チャンク内の迷路を掘る（全域木＋少しの環）。 */
function carveMaze(c, seed) {
  const rng = rngFor(seed, c.kx, c.ky, c.kz, 0x1B7D);
  const { solid, link } = c;

  // ランドマークの骨格を先に置く。迷路の側はここに触れない。
  const lmRoots = [];
  for (let y = 0; y < CY; y++) for (let z = 0; z < CD; z++) for (let x = 0; x < CW; x++) {
    const i = idx(x, y, z);
    if (solid[i]) continue;
    const gx = c.gx(i), gy = c.gy(i), gz = c.gz(i);
    let touched = false;
    for (let d = 0; d < 6; d++) {
      const r = lmLinked(seed, gx, gy, gz, d);
      if (r === null) continue;
      touched = true;
      if (!r) continue;
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      if (nx < 0 || nx >= CW || ny < 0 || ny >= CY || nz < 0 || nz >= CD) continue;
      const j = idx(nx, ny, nz);
      if (solid[j]) continue;
      link[i] |= 1 << d; link[j] |= 1 << OPP[d];
    }
    if (touched) lmRoots.push(i);
  }

  // 大空間の中は、はじめから全部ひと続きにしておく。
  // ただし橋の真下だけはつながない。橋の床は岩のままでなければならない。
  for (let y = 0; y < CY; y++) for (let z = 0; z < CD; z++) for (let x = 0; x < CW; x++) {
    const i = idx(x, y, z);
    if (!inBig(seed, c.gx(i), c.gy(i), c.gz(i))) continue;
    for (const d of [0, 2, 4]) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      if (nx >= CW || ny >= CY || nz >= CD) continue;
      const j = idx(nx, ny, nz);
      if (!inBig(seed, c.gx(j), c.gy(j), c.gz(j))) continue;
      if (d === 2 && isBridge(seed, c.gx(j), c.gy(j), c.gz(j))) continue;
      link[i] |= 1 << d; link[j] |= 1 << OPP[d];
    }
  }

  let start = -1;
  for (let i = 0; i < NCELL; i++) if (!solid[i]) { start = i; break; }
  if (start < 0) return;

  const seen = new Uint8Array(NCELL);
  const stack = [start];
  seen[start] = 1;
  for (const i of lmRoots) if (!seen[i]) { seen[i] = 1; stack.push(i); }
  const horiz = [0, 1, 4, 5], vert = [2, 3], order = new Array(6);
  while (stack.length) {
    const i = stack[stack.length - 1];
    const x = i % CW, z = ((i / CW) | 0) % CD, y = (i / (CW * CD)) | 0;
    shuffle(rng, horiz); shuffle(rng, vert);
    if (rng() < 0.78) {
      order[0] = horiz[0]; order[1] = horiz[1]; order[2] = horiz[2]; order[3] = horiz[3];
      order[4] = vert[0]; order[5] = vert[1];
    } else {
      order[0] = vert[0]; order[1] = horiz[0]; order[2] = horiz[1];
      order[3] = vert[1]; order[4] = horiz[2]; order[5] = horiz[3];
    }
    let moved = false;
    for (let k = 0; k < 6; k++) {
      const d = order[k];
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      if (nx < 0 || nx >= CW || ny < 0 || ny >= CY || nz < 0 || nz >= CD) continue;
      const j = idx(nx, ny, nz);
      if (seen[j] || solid[j]) continue;
      if (lmLinked(seed, c.gx(i), c.gy(i), c.gz(i), d) !== null) continue;
      if (d === 2 && !structuralUp(seed, c, i)) continue;
      if (d === 3 && !structuralUp(seed, c, j)) continue;
      link[i] |= 1 << d; link[j] |= 1 << OPP[d];
      seen[j] = 1; stack.push(j); moved = true; break;
    }
    if (!moved) stack.pop();
  }
  // 取りこぼしたセルを、すでに繋がっている側へ手繰り寄せる。
  // つなぐ相手は必ず「もう繋がっているセル」に限る。
  // 取りこぼしどうしを結んでしまうと、本体から切り離された島ができてしまう。
  for (let pass = 0; pass < CY + CW + CD; pass++) {
    let grew = false;
    for (let i = 0; i < NCELL; i++) {
      if (solid[i] || seen[i]) continue;
      const x = i % CW, z = ((i / CW) | 0) % CD, y = (i / (CW * CD)) | 0;
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (nx < 0 || nx >= CW || ny < 0 || ny >= CY || nz < 0 || nz >= CD) continue;
        const j = idx(nx, ny, nz);
        if (solid[j] || !seen[j]) continue;
        if (lmLinked(seed, c.gx(i), c.gy(i), c.gz(i), d) !== null) continue;
        if (d === 2 && !structuralUp(seed, c, i)) continue;
        if (d === 3 && !structuralUp(seed, c, j)) continue;
        link[i] |= 1 << d; link[j] |= 1 << OPP[d];
        seen[i] = 1; grew = true; break;
      }
    }
    if (!grew) break;
  }
  // それでも届かなかったセルは、掘られなかったことにする（岩のまま）
  for (let i = 0; i < NCELL; i++) if (!solid[i] && !seen[i]) link[i] = 0;

  // 環。行き止まりだらけだと、戻る道が一本しかなくて息が詰まる
  for (let i = 0; i < NCELL; i++) {
    if (solid[i]) continue;
    const x = i % CW, z = ((i / CW) | 0) % CD, y = (i / (CW * CD)) | 0;
    for (const d of [0, 2, 4]) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      if (nx >= CW || ny >= CY || nz >= CD) continue;
      const j = idx(nx, ny, nz);
      if (solid[j] || (link[i] & (1 << d))) continue;
      if (lmLinked(seed, c.gx(i), c.gy(i), c.gz(i), d) !== null) continue;
      if (d === 2 && !canLinkUp(seed, c, i)) continue;
      // 床のない縦を、まだ何ともつながっていないセルに足さない。
      // それ一本きりになると、落ちて入るだけの袋小路ができる
      if (d === 2 && !structuralUp(seed, c, i) && !link[i]) continue;
      if (rng() < (d === 2 ? 0.05 : 0.13)) { link[i] |= 1 << d; link[j] |= 1 << OPP[d]; }
    }
  }

  // 大空間の壁に、あちこちの高さから穴を開ける。
  // 見上げれば道が見えるのに、そこへは行けない——という眺めがこれで生まれる。
  // 橋の両端と、いちばん底には、必ず出入口を作る。
  for (let y = 0; y < CY; y++) for (let z = 0; z < CD; z++) for (let x = 0; x < CW; x++) {
    const i = idx(x, y, z);
    const gx = c.gx(i), gy = c.gy(i), gz = c.gz(i);
    if (!inBig(seed, gx, gy, gz)) continue;
    const bottom = !inBig(seed, gx, gy - 1, gz);
    const bridge = isBridge(seed, gx, gy, gz);
    for (const d of HDIRS) {
      const nx = x + DX[d], nz = z + DZ[d];
      if (nx < 0 || nx >= CW || nz < 0 || nz >= CD) continue;
      const j = idx(nx, y, nz);
      if (solid[j] || inBig(seed, c.gx(j), gy, c.gz(j))) continue;
      const p = bridge ? 0.92 : bottom ? 0.75 : 0.16;
      if (rng() < p) { link[i] |= 1 << d; link[j] |= 1 << OPP[d]; }
    }
  }

  // まれに広間をひとつ。ずっと同じ幅の通路だと、世界の広さが伝わらない
  if (rng() < 0.55) {
    const hx = 1 + Math.floor(rng() * (CW - 3)), hz = 1 + Math.floor(rng() * (CD - 3));
    const hy = Math.floor(rng() * CY);
    let ok = true;
    for (let a = 0; a < 2 && ok; a++) for (let b = 0; b < 2; b++)
      if (solid[idx(hx + a, hy, hz + b)]) { ok = false; break; }
    if (ok) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const i = idx(hx + a, hy, hz + b);
      if (a === 0) { const j = idx(hx + 1, hy, hz + b); link[i] |= 1; link[j] |= 2; }
      if (b === 0) { const j = idx(hx + a, hy, hz + 1); link[i] |= 16; link[j] |= 32; }
    }
  }
}

/**
 * 境界面に出入口を開ける。
 * 面を共有する2チャンクのうち座標の小さい方を基準に乱数を引くので、
 * 両側がそれぞれ独立に計算しても、まったく同じ位置に穴が開く。
 * 巨大な空洞をまたぐところは、必ず開ける。壁で真っ二つにするわけにはいかない。
 */
function openBorders(c, seed, baseOf) {
  for (let d = 0; d < 6; d++) {
    const n = baseOf(c.kx + DX[d], c.ky + DY[d], c.kz + DZ[d]);
    const lx = c.kx + (DX[d] < 0 ? -1 : 0);
    const ly = c.ky + (DY[d] < 0 ? -1 : 0);
    const lz = c.kz + (DZ[d] < 0 ? -1 : 0);
    const axis = d >> 1;
    const rng = rngFor(seed, lx, ly, lz, 0x4D00 + axis);
    const near = DX[d] > 0 || DY[d] > 0 || DZ[d] > 0;

    const cand = [];
    const push = (a, bSolid) => {
      if (c.solid[a] || bSolid) return;
      const gx = c.gx(a), gy = c.gy(a), gz = c.gz(a);
      const lr = lmLinked(seed, gx, gy, gz, d);
      if (lr !== null) { if (lr) c.link[a] |= 1 << d; return; }
      if (axis === 1) {
        // 縦は低い天井をまたげない。床のない縦も境界には開けない——
        // 向こう側が「落ちて入るだけ」の袋小路になりかねない
        const ly = d === 2 ? gy : gy - 1;
        if (isLowCeil(seed, gx, ly, gz)) return;
        if (baseVFeat(seed, gx, ly, gz).kind === V_OPEN) return;
      }
      if (inBig(seed, gx, gy, gz) && inBig(seed, gx + DX[d], gy + DY[d], gz + DZ[d])) {
        if (!(d === 2 && isBridge(seed, gx, gy + 1, gz))) c.link[a] |= 1 << d;
        return;                                           // 大空間どうしは無条件
      }
      cand.push(a);
    };
    if (axis === 0) {
      const ax = near ? CW - 1 : 0, bx = near ? 0 : CW - 1;
      for (let y = 0; y < CY; y++) for (let z = 0; z < CD; z++)
        push(idx(ax, y, z), n.solid[idx(bx, y, z)]);
    } else if (axis === 1) {
      const ay = near ? CY - 1 : 0, by = near ? 0 : CY - 1;
      for (let x = 0; x < CW; x++) for (let z = 0; z < CD; z++)
        push(idx(x, ay, z), n.solid[idx(x, by, z)]);
    } else {
      const az = near ? CD - 1 : 0, bz = near ? 0 : CD - 1;
      for (let x = 0; x < CW; x++) for (let y = 0; y < CY; y++)
        push(idx(x, y, az), n.solid[idx(x, y, bz)]);
    }
    if (!cand.length) continue;
    shuffle(rng, cand);
    const count = axis === 1
      ? 1 + (rng() < 0.45 ? 1 : 0)
      : 1 + (rng() < 0.6 ? 1 : 0) + (rng() < 0.25 ? 1 : 0);
    for (let k = 0; k < Math.min(count, cand.length); k++) c.link[cand[k]] |= 1 << d;
  }
}

/**
 * 落ちたきり戻れない場所をなくす。
 *
 * 落下も吹き抜けも一方通行だ。素朴に作ると数%のセルが「行けるが帰れない」窪地になり、
 * 運が悪いと始まりの場所そのものが出られない穴の底になる。
 *
 * そこで「立てるセル」＝床のあるセルだけを点とし、往復できる辺——水平リンクと階段——
 * だけで連結成分を数える。ばらけている間だけ落下穴を階段に書き換え、
 * それでも足りなければ横の壁を抜く。吹き抜けだけは書き換えない。
 * 上下のチャンクが、互いを作らずに同じ答えを出せなくなってしまうから。
 */
function repairWalk(c, seed) {
  const { solid, link, stair } = c;
  const floorOf = new Uint8Array(NCELL);
  for (let i = 0; i < NCELL; i++) {
    if (solid[i] || !link[i]) continue;
    floorOf[i] = !(link[i] & 8) || baseVFeat(seed, c.gx(i), c.gy(i) - 1, c.gz(i)).kind !== V_OPEN ? 1 : 0;
  }
  const par = new Int32Array(NCELL);
  for (let i = 0; i < NCELL; i++) par[i] = i;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a === b) return false; par[a] = b; return true; };

  const kindOf = (i) => stair[i] ? V_STAIR : baseVFeat(seed, c.gx(i), c.gy(i), c.gz(i)).kind;

  // 階段を架けたなら、登りきった先に道を通す。
  // 「上の階へ行きたいから架けた」ように見えてほしい。
  for (let y = 0; y + 1 < CY; y++) for (let z = 0; z < CD; z++) for (let x = 0; x < CW; x++) {
    const i = idx(x, y, z);
    if (solid[i] || !(link[i] & 4) || kindOf(i) !== V_STAIR) continue;
    if (inLandmark(seed, c.gx(i), c.gy(i), c.gz(i))) continue;
    const j = idx(x, y + 1, z);
    const a = stairAxis(link[i], link[j], baseVFeat(seed, c.gx(i), c.gy(i), c.gz(i)));
    if (link[j] & (1 << a.dir)) continue;
    const nx = x + DX[a.dir], nz = z + DZ[a.dir];
    if (nx < 0 || nx >= CW || nz < 0 || nz >= CD) continue;
    const k = idx(nx, y + 1, nz);
    if (solid[k] || !link[k]) continue;
    link[j] |= 1 << a.dir; link[k] |= 1 << OPP[a.dir];
  }

  let comps = 0;
  for (let i = 0; i < NCELL; i++) if (!solid[i] && floorOf[i]) comps++;
  const shafts = [];

  for (let y = 0; y < CY; y++) for (let z = 0; z < CD; z++) for (let x = 0; x < CW; x++) {
    const i = idx(x, y, z);
    if (solid[i] || !floorOf[i]) continue;
    const gx = c.gx(i), gy = c.gy(i), gz = c.gz(i);
    if ((link[i] & 1) && x + 1 < CW && floorOf[idx(x + 1, y, z)]
        && walkable(seed, gx, gy, gz, 0) && uni(i, idx(x + 1, y, z))) comps--;
    if ((link[i] & 16) && z + 1 < CD && floorOf[idx(x, y, z + 1)] && uni(i, idx(x, y, z + 1))) comps--;
    if ((link[i] & 4) && y + 1 < CY) {
      const k = kindOf(i);
      if (k === V_STAIR) { if (uni(i, idx(x, y + 1, z))) comps--; }
      else if (k === V_SHAFT) shafts.push(i);
    }
  }

  // 天井の面から上のチャンクへ登る道を必ず一本残す。
  // チャンク内はこのあと必ずひとつながりになるので、
  // 「落ちて入った区画からは必ず登って出られる」が世界じゅうで成り立つ。
  {
    const top = [], y = CY - 1;
    let hasUp = false;
    for (let z = 0; z < CD; z++) for (let x = 0; x < CW; x++) {
      const i = idx(x, y, z);
      if (solid[i] || !(link[i] & 4)) continue;
      if (inLandmark(seed, c.gx(i), c.gy(i), c.gz(i))) { hasUp = true; continue; }
      const k = kindOf(i);
      if (k === V_STAIR) hasUp = true;
      else if (k === V_SHAFT) top.push(i);
    }
    if (!hasUp && top.length) {
      stair[top[hash32(seed, c.kx, c.ky, c.kz, 0x70F) % top.length]] = 1;
    }
  }

  shuffle(rngFor(seed, c.kx, c.ky, c.kz, 0x571A), shafts);
  for (const i of shafts) {
    if (inLandmark(seed, c.gx(i), c.gy(i), c.gz(i))) continue;
    if (comps <= 1) break;
    const x = i % CW, z = ((i / CW) | 0) % CD, y = (i / (CW * CD)) | 0;
    if (!uni(i, idx(x, y + 1, z))) continue;
    stair[i] = 1; comps--;
  }
  if (comps > 1) {
    // それでも離れていたら、壁をひとつ抜く
  for (let y = 0; y < CY && comps > 1; y++)
    for (let z = 0; z < CD && comps > 1; z++)
      for (let x = 0; x < CW && comps > 1; x++) {
        const i = idx(x, y, z);
        if (solid[i] || !floorOf[i]) continue;
        for (const d of [0, 4]) {
          const nx = x + DX[d], nz = z + DZ[d];
          if (nx >= CW || nz >= CD) continue;
          const j = idx(nx, y, nz);
          if (solid[j] || !floorOf[j] || find(i) === find(j)) continue;
          if (lmLinked(seed, c.gx(i), c.gy(i), c.gz(i), d) !== null) continue;
          link[i] |= 1 << d; link[j] |= 1 << OPP[d];
          uni(i, j); comps--;
        }
      }
  }

  // それでも取り残された塊には、上へ登る道を与える。
  // ここを通れば上のチャンクへ出られて、そちらは丸ごとひとつながりになっている。
  const bucket = new Map();
  for (let i = 0; i < NCELL; i++) {
    if (solid[i] || !link[i] || !floorOf[i]) continue;
    const r = find(i);
    let b = bucket.get(r);
    if (!b) { b = { n: 0, up: [] }; bucket.set(r, b); }
    b.n++;
    if ((link[i] & 4) && kindOf(i) === V_SHAFT) b.up.push(i);
  }
  let mainRoot = null, best = -1;
  for (const [r, b] of bucket) if (b.n > best) { best = b.n; mainRoot = r; }
  for (const [r, b] of bucket) {
    if (r === mainRoot || !b.up.length) continue;
    const pick = b.up.filter((i) => !inLandmark(seed, c.gx(i), c.gy(i), c.gz(i)));
    if (pick.length) stair[pick[hash32(seed, c.kx, c.ky, c.kz, r) % pick.length]] = 1;
  }
}

// ─── 世界 ────────────────────────────────────────────────────────

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.base = new Map();
    this.full = new Map();
  }
  static key(kx, ky, kz) { return kx + ',' + ky + ',' + kz; }

  baseChunk(kx, ky, kz) {
    const k = World.key(kx, ky, kz);
    let c = this.base.get(k);
    if (!c) { c = genBase(this.seed, kx, ky, kz); this.base.set(k, c); }
    return c;
  }

  chunk(kx, ky, kz) {
    const k = World.key(kx, ky, kz);
    let c = this.full.get(k);
    if (c) return c;
    c = this.baseChunk(kx, ky, kz);
    if (!c.carved) {
      carveMaze(c, this.seed);
      openBorders(c, this.seed, (a, b, d) => this.baseChunk(a, b, d));
      repairWalk(c, this.seed);
      c.carved = true;
    }
    this.full.set(k, c);
    return c;
  }

  at(x, y, z) { return this.chunk(fdiv(x, CW), fdiv(y, CY), fdiv(z, CD)); }
  local(x, y, z) { return idx(fmod(x, CW), fmod(y, CY), fmod(z, CD)); }

  open(x, y, z) { return !this.at(x, y, z).solid[this.local(x, y, z)]; }
  linked(x, y, z, d) { return (this.at(x, y, z).link[this.local(x, y, z)] & (1 << d)) !== 0; }
  linkBits(x, y, z) { return this.at(x, y, z).link[this.local(x, y, z)]; }

  /** そのセルの天井のつなぎ目。上とつながっていなければ null。 */
  vfeat(x, y, z) {
    const c = this.at(x, y, z), i = this.local(x, y, z);
    if (!(c.link[i] & 4)) return null;
    if (c.stair[i]) {
      const h = hash32(this.seed, x, y, z, 0x57A1);
      return { kind: V_STAIR, dir: HDIRS[(h >>> 7) & 3], smooth: ((h >>> 21) % 100) < 42 };
    }
    return baseVFeat(this.seed, x, y, z);
  }

  /** 立てる床があるか。吹き抜けの途中には床がない。 */
  hasFloor(x, y, z) {
    return !this.linked(x, y, z, 3) || hasFloorBelow(this.seed, x, y, z);
  }

  ceil(x, y, z) { return ceilHeight(this.seed, x, y, z); }

  /** 遠すぎるチャンクの記憶を捨てる。世界は覚えていなくても再現できる。 */
  forgetFar(cx, cy, cz, radius) {
    const kx = fdiv(cx, CW), ky = fdiv(cy, CY), kz = fdiv(cz, CD);
    for (const map of [this.full, this.base]) {
      for (const key of map.keys()) {
        const p = key.split(',');
        if (Math.abs(+p[0] - kx) > radius || Math.abs(+p[1] - ky) > radius || Math.abs(+p[2] - kz) > radius) {
          map.delete(key);
        }
      }
    }
  }
}

export { fdiv, fmod };
