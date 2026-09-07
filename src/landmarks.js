// 誰かが、何かの目的で掘った空間。
//
// 通常の迷路とは別の理屈で作られた、大きなランドマーク。
// 粗い格子ひと目につき多くて一つ。周りの目より「強い」ときだけ置くので、
// 隣り合って連続することがない。
//
// すべて座標とシードだけで決まる純粋な関数。チャンクの作られる順に依存しない。
// 遠ざかれば忘れられ、戻れば同じものがまた組み上がる。

import {
  CELL, LEVEL, CEIL_STD, ROOM_MAX, DX, DY, DZ, OPP, MIN_GAP, MIN_HEAD, fdiv,
  V_SHAFT, V_STAIR, V_OPEN, PARAPET,
} from './dims.js';
import { hash32 } from './rng.js';
import { LANDMARK_CATALOG, selectLandmark, compileLandmark } from './landmark-catalog.js';
export { LANDMARK_CATALOG, RARITY_WEIGHT } from './landmark-catalog.js';

export const LM_CATHEDRAL = 0;   // 白い柱の大広間
export const LM_COMPRESSION = 1; // 圧縮通路
export const LM_STAIRHALL = 2;   // 階段だけの大広間
export const LM_STACKED = 3;     // 多層通路空間
export const LM_NESTED = 4;      // 部屋の中の部屋
export const LM_DESCENT = 5;     // 異常に深い降下空間
export const LM_NAMES = ['cathedral', 'compression', 'stairs', 'stacked', 'nested', 'descent',
  ...LANDMARK_CATALOG.map(e => e.id)];

const CG = 24;          // ランドマークを置く粗い格子（セル数）＝ 134m
const MARGIN = 2;       // 粗い目のふちに残す余白

const score = (seed, cx, cz) => hash32(seed, cx, cz, 0x1AA7);

/** 粗い目 (cx,cz) のランドマーク。周り8目より強いときだけ置く。 */
function boxAtCoarse(seed, cx, cz) {
  const h = score(seed, cx, cz);
  // Preserve every legacy candidate, its kind, dimensions and seed. New places only
  // occupy previously empty winners, with the same exclusion grid and priority.
  if (h % 100 >= 86) return null;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dz) continue;
    if (score(seed, cx + dx, cz + dz) > h) return null;   // 隣に強いものがあれば譲る
  }
  const entry = h % 100 >= 58 ? selectLandmark(hash32(seed, cx, cz, 0x100CA7) / 4294967296) : null;
  const kind = entry ? LANDMARK_CATALOG.indexOf(entry) + 6 : (h >>> 7) % 6;
  const r = (n, k) => ((h >>> k) % 1024) / 1024 * n;

  let W, D, H;
  switch (kind) {
    case LM_CATHEDRAL:   W = 8 + ((h >>> 11) % 4); D = 12 + ((h >>> 14) % 6); H = 6 + ((h >>> 17) % 7); break;
    case LM_COMPRESSION: W = 14 + ((h >>> 11) % 4); D = 8 + ((h >>> 14) % 2); H = 5 + ((h >>> 17) % 3); break;
    case LM_STAIRHALL:   W = 8 + ((h >>> 11) % 3); D = 8 + ((h >>> 14) % 3); H = 8 + ((h >>> 17) % 6); break;
    case LM_STACKED:     W = 4 + ((h >>> 11) % 2); D = 7 + ((h >>> 14) % 4); H = 12 + ((h >>> 17) % 7); break;
    case LM_NESTED:      W = 11; D = 11; H = 3 + ((h >>> 17) % 3); break;
    default:             W = 3; D = 3; H = 9 + ((h >>> 17) % 8); break;
  }
  if (entry) [W, D, H] = entry.size;
  const spanX = CG - MARGIN * 2 - W, spanZ = CG - MARGIN * 2 - D;
  if (spanX < 1 || spanZ < 1) return null;
  const x0 = cx * CG + MARGIN + ((h >>> 20) % spanX);
  const z0 = cz * CG + MARGIN + ((h >>> 23) % spanZ);
  const y1 = 1 - ((h >>> 26) % 5);
  const y0 = y1 - H + 1;
  const L = { kind, seed: hash32(seed, cx, cz, 0x5AFE), W, D, H,
              x0, x1: x0 + W - 1, z0, z1: z0 + D - 1, y0, y1 };
  if (entry) {
    L.id = entry.id; L.rarity = entry.rarity;
    Object.defineProperty(L, 'gates', { enumerable: true, get: () => compiled(entry).gates });
    return L;
  }
  L.params = paramsOf(L);
  L.spine = spineOf(L);
  L.gates = gatesOf(L);
  return L;
}

// Bounded recipe cache: geometry is still built and released by the chunk streamer.
// Only eight recently queried designs occupy cell arrays at once.
const designs = new Map();
function compiled(entry) {
  if (designs.has(entry.id)) {
    const c = designs.get(entry.id); designs.delete(entry.id); designs.set(entry.id, c); return c;
  }
  const c = compileLandmark(entry);
  if (designs.size >= 8) designs.delete(designs.keys().next().value);
  designs.set(entry.id, c); return c;
}

const cache = new Map();
function coarse(seed, cx, cz) {
  const k = seed + ':' + cx + ':' + cz;
  if (cache.has(k)) return cache.get(k);
  if (cache.size > 4096) cache.clear();
  const v = boxAtCoarse(seed, cx, cz);
  cache.set(k, v);
  return v;
}

/** その座標を含むランドマーク。なければ null。 */
export function landmarkOf(seed, gx, gy, gz) {
  const L = coarse(seed, fdiv(gx, CG), fdiv(gz, CG));
  if (!L) return null;
  return (gx >= L.x0 && gx <= L.x1 && gz >= L.z0 && gz <= L.z1 && gy >= L.y0 && gy <= L.y1) ? L : null;
}

/** 粗い目の中のランドマーク（範囲の外でも返す）。デバッグと試験に使う。 */
export function landmarkNear(seed, gx, gz) {
  return coarse(seed, fdiv(gx, CG), fdiv(gz, CG));
}

/** 世界を走査してランドマークを列挙する。試験とデバッグ移動に使う。 */
export function findLandmarks(seed, kind, radius = 12) {
  const out = [];
  for (let cz = -radius; cz <= radius; cz++) for (let cx = -radius; cx <= radius; cx++) {
    const L = coarse(seed, cx, cz);
    if (L && (kind === undefined || L.kind === kind)) out.push(L);
  }
  return out;
}

// ─── 出入口 ──────────────────────────────────────────────────────

/** 外周のn番目の位置。外向きの方角つき。 */
function perimeter(L, n, iy) {
  const h = hash32(L.seed, n, iy, 0x9A7E);
  const per = 2 * (L.W + L.D) - 4;
  let t = h % per;
  let ix, iz, dir;
  if (t < L.W) { ix = t; iz = 0; dir = 5; }
  else if ((t -= L.W) < L.D - 1) { ix = L.W - 1; iz = t + 1; dir = 0; }
  else if ((t -= L.D - 1) < L.W - 1) { ix = L.W - 2 - t; iz = L.D - 1; dir = 4; }
  else { t -= L.W - 1; ix = 0; iz = L.D - 2 - t; dir = 1; }
  return { ix, iy, iz, dir };
}

/** ランドマークの出入口。最低2つ。 */
function gatesOf(L) {
  const g = [];
  const h = L.seed;
  if (L.kind === LM_COMPRESSION) {
    // 細い側の端から入り、広間の向こう側へ抜ける
    g.push({ ix: 0, iy: 0, iz: (L.D >> 1), dir: 1 });
    g.push({ ix: L.W - 1, iy: 0, iz: 1 + ((h >>> 3) % (L.D - 2)), dir: 0 });
    if (h % 3 === 0) g.push({ ix: L.params.neck + ((h >>> 6) % L.params.hall), iy: 0, iz: L.D - 1, dir: 4 });
    return g;
  }
  if (L.kind === LM_DESCENT) {
    g.push({ ...perimeter(L, 0, L.H - 1) });      // 上から入って
    g.push({ ...perimeter(L, 1, 0) });            // 下へ抜ける
    return g;
  }
  if (L.kind === LM_STACKED) {
    const n = 3 + (h % 3);
    for (let i = 0; i < n; i++) g.push(perimeter(L, i, (i * 5 + (h >>> 4)) % L.H));
    return g;
  }
  if (L.kind === LM_STAIRHALL || L.kind === LM_DESCENT) {
    // 螺旋の下端と上端に、ちょうど口を開ける
    const first = L.spine[0], last = L.spine[L.spine.length - 1];
    const exit = last.rTop + (L.kind === LM_STAIRHALL ? 2 : 1);
    g.push({ ...ringPos(L, first.r), iy: 0, dir: ringOut(L, first.r) });
    g.push({ ...ringPos(L, exit), iy: L.H - 1, dir: ringOut(L, exit) });
    return g;
  }
  // 大広間と入れ子。床のある階だけに開ける
  const n = 2 + (h % 3);
  for (let i = 0; i < n; i++) g.push(perimeter(L, i, 0));
  if (L.kind === LM_CATHEDRAL) {
    const b = 1 + (h % 3);
    for (let i = 0; i < b; i++) g.push(perimeter(L, 10 + i, 1 + ((h >>> (i * 3)) % (L.H - 1))));
  }
  return g;
}

function gateBits(L, ix, iy, iz) {
  let m = 0;
  for (const g of L.gates) if (g.ix === ix && g.iy === iy && g.iz === iz) m |= 1 << g.dir;
  return m;
}

/** ランドマークごとの細部。設計思想は固定、寸法は seed で動く。 */
function paramsOf(L) {
  const h = L.seed;
  switch (L.kind) {
    case LM_CATHEDRAL:
      return { px: 1 + ((h >>> 2) % 3 === 0 ? 1 : 0), pz: 1 + ((h >>> 5) % 3 === 0 ? 1 : 0),
               ox: (h >>> 8) % 2, oz: (h >>> 10) % 2 };
    case LM_COMPRESSION:
      return { neck: 6 + (h % 3), hall: L.W - (6 + (h % 3)) };
    case LM_NESTED:
      return { a: [1 + (h % 2), 1 + ((h >>> 3) % 2), 1 + ((h >>> 6) % 2), 1 + ((h >>> 9) % 2)] };
    default:
      return {};
  }
}

// ─── 外周をひとつながりに数える ──────────────────────────────────
// 大広間や降下空間の「回廊」は、外周をぐるりと回る一本の道として扱う。

const ringLen = (L) => 2 * (L.W + L.D) - 4;

/** 外周のk番目のセル（左上から時計まわり）。 */
function ringPos(L, k) {
  const n = ringLen(L);
  let t = ((k % n) + n) % n;
  if (t < L.W) return { ix: t, iz: 0 };
  t -= L.W;
  if (t < L.D - 1) return { ix: L.W - 1, iz: t + 1 };
  t -= L.D - 1;
  if (t < L.W - 1) return { ix: L.W - 2 - t, iz: L.D - 1 };
  t -= L.W - 1;
  return { ix: 0, iz: L.D - 2 - t };
}
function ringIndexOf(L, ix, iz) {
  const W = L.W, D = L.D;
  if (iz === 0) return ix;
  if (ix === W - 1) return W + iz - 1;
  if (iz === D - 1) return W + (D - 1) + (W - 2 - ix);
  if (ix === 0) return W + (D - 1) + (W - 1) + (D - 2 - iz);
  return -1;
}
/** 外周のkから k+1 へ進む向き。 */
function ringDir(L, k) {
  const a = ringPos(L, k), b = ringPos(L, k + 1);
  if (b.ix > a.ix) return 0; if (b.ix < a.ix) return 1;
  if (b.iz > a.iz) return 4; return 5;
}
/** 外周のkから、ランドマークの外を向く方角。 */
function ringOut(L, k) {
  const p = ringPos(L, k);
  if (p.iz === 0) return 5;
  if (p.iz === L.D - 1) return 4;
  if (p.ix === 0) return 1;
  return 0;
}
const onRing = (L, ix, iz) => ix === 0 || iz === 0 || ix === L.W - 1 || iz === L.D - 1;

/** 螺旋の設計。各階に一本ずつ、外周を回りながら登る階段を置く。 */
function spineOf(L) {
  if (L.kind !== LM_STAIRHALL && L.kind !== LM_DESCENT) return null;
  const n = ringLen(L);
  const step = L.kind === LM_DESCENT ? 2 : 3;
  const out = [];
  let r = L.seed % n;
  for (let k = 0; k + 1 < L.H; k++) {
    const rTop = r + step;
    out.push({ level: k, r, rTop, stair: rTop, dir: ringDir(L, rTop) });
    r = rTop;
  }
  if (!out.length) out.push({ level: 0, r: L.seed % n, rTop: L.seed % n, stair: -1, dir: 0 });
  return out;
}

// ─── セルの決まり ────────────────────────────────────────────────

const cellOf = { x0: CELL / 2, z0: CELL / 2 };
function pillar(size, y0, y1, bot, top) {
  const h = size / 2;
  return { x0: CELL / 2 - h, x1: CELL / 2 + h, z0: CELL / 2 - h, z1: CELL / 2 + h, y0, y1, bot, top };
}

/** 箱の中で、同じ階の掘られた隣とだけ結ぶ。 */
function nbrs(L, ix, iz, isRock, iy) {
  let m = 0;
  for (const [d, dx, dz] of [[0, 1, 0], [1, -1, 0], [4, 0, 1], [5, 0, -1]]) {
    const jx = ix + dx, jz = iz + dz;
    if (jx < 0 || jx >= L.W || jz < 0 || jz >= L.D) continue;
    if (isRock(jx, iy, jz)) continue;
    m |= 1 << d;
  }
  return m;
}

/**
 * ランドマークの中のセルの決まり。null ならランドマークの外。
 *   rock    … 掘らない
 *   full    … 部屋をセルいっぱいに彫る（隣とぴったり接する）
 *   w,d     … full でないときの部屋の広さ（セル中央）
 *   ceil    … 天井までの高さ
 *   up      … 上へのつなぎ {kind:'open'|'stair'|'shaft', dir}
 *   hlink   … 横のつながり(6bitのうち0,1,4,5)
 *   parapet … その向きの口に腰までの欄干を立てる
 *   solids  … セルの中に残す岩（セル原点からの相対 m）
 */
export function lmCell(seed, gx, gy, gz) {
  const L = landmarkOf(seed, gx, gy, gz);
  if (!L) return null;
  const c = shape(L, gx - L.x0, gy - L.y0, gz - L.z0);
  if (c && !c.rock) c.hlink |= gateBits(L, gx - L.x0, gy - L.y0, gz - L.z0);
  return c;
}

function shape(L, ix, iy, iz) {
  if (L.kind >= 6) {
    const c = compiled(LANDMARK_CATALOG[L.kind - 6]);
    // lmCell adds gate bits. Never mutate the shared compiled recipe.
    return { ...c.cells[c.index(ix, iy, iz)] };
  }
  switch (L.kind) {
    case LM_CATHEDRAL: return cathedral(L, ix, iy, iz);
    case LM_COMPRESSION: return compression(L, ix, iy, iz);
    case LM_STAIRHALL: return stairHall(L, ix, iy, iz);
    case LM_STACKED: return stacked(L, ix, iy, iz);
    case LM_NESTED: return nested(L, ix, iy, iz);
    default: return descent(L, ix, iy, iz);
  }
}

// 01 白い柱の大広間 ──────────────────────────────────────────────
// 狭い迷路から、突然ここへ出る。同じ柱がどこまでも繰り返されて距離感が狂う。
function cathedral(L, ix, iy, iz) {
  const P = L.params, top = iy === L.H - 1;
  const solids = [];
  const isGate = gateBits(L, ix, iy, iz) !== 0;
  if (!isGate && ix % P.px === P.ox % P.px && iz % P.pz === P.oz % P.pz) {
    const r = hash32(L.seed, ix, iz, 0xC011) % 100;
    let size = 1.95, lo = 0, hi = L.H - 1, has = true;
    if (r < 9) has = false;                                   // 一本だけ無い
    else if (r < 18) size = 3.2;                              // 一本だけ太い
    else if (r < 27) hi = Math.max(0, Math.floor(L.H * 0.45)); // 途中で終わる
    else if (r < 36) lo = Math.floor(L.H * 0.5);              // 天井から垂れている
    if (has && iy >= lo && iy <= hi) {
      solids.push(pillar(size, 0, top ? CEIL_STD : LEVEL,
                         iy === lo && lo > 0, iy === hi && hi < L.H - 1));
    }
  }
  return { rock: false, full: true, ceil: CEIL_STD,
           up: top ? null : { kind: 'open' },
           hlink: nbrs(L, ix, iz, () => false, iy), parapet: 0, solids };
}

// 02 圧縮通路 ────────────────────────────────────────────────────
// だんだん低く、だんだん狭くなり、抜けた瞬間に広間が開ける。
function compression(L, ix, iy, iz) {
  const P = L.params, mid = L.D >> 1;
  const corridorRock = (jx, jy, jz) => jx < P.neck && !(jy === 0 && jz === mid);
  if (ix < P.neck) {
    if (corridorRock(ix, iy, iz)) return { rock: true };
    const t = P.neck > 1 ? ix / (P.neck - 1) : 1;
    return { rock: false, full: false, w: ROOM_MAX,
             d: 3.6 + (MIN_GAP + 0.10 - 3.6) * t,
             ceil: CEIL_STD + (MIN_HEAD - CEIL_STD) * t,
             up: null, hlink: (ix > 0 ? 2 : 0) | 1, parapet: 0, solids: [] };
  }
  const top = iy === L.H - 1;
  let hlink = nbrs(L, ix, iz, corridorRock, iy);
  if (ix === P.neck && iz === mid && iy === 0) hlink |= 2;
  return { rock: false, full: true, ceil: CEIL_STD,
           up: top ? null : { kind: 'open' }, hlink, parapet: 0, solids: [] };
}

// 03 階段だけの大広間 ────────────────────────────────────────────
// 吹き抜けの壁づたいに、いくつもの階段。渡れるのは一本だけで、
// 残りは「そこにあるのに、どうやって行くのか分からない」ものになる。
function decoSpans(L, iy) {
  const n = ringLen(L), out = [];
  const h = hash32(L.seed, iy, 0xDEC0);
  if (h % 100 < 48 && iy + 1 < L.H) out.push({ r: (h >>> 7) % n, len: 2, stair: true });
  const g = hash32(L.seed, iy - 1, 0xDEC0);
  if (g % 100 < 48 && iy > 0) out.push({ r: ((g >>> 7) % n) + 2, len: 2, stair: false });
  return out;
}
function stairHall(L, ix, iy, iz) {
  const top = iy === L.H - 1;
  const openCell = (solidTop) => ({ rock: false, full: true, ceil: CEIL_STD,
    up: (top || solidTop) ? null : { kind: 'open' }, hlink: nbrs(L, ix, iz, () => false, iy),
    parapet: 0, solids: [] });
  if (!onRing(L, ix, iz)) return openCell(false);

  const n = ringLen(L), k = ringIndexOf(L, ix, iz);
  const spans = [];
  const sp = L.spine[iy];
  if (sp) spans.push({ r: sp.r, len: ((sp.rTop - sp.r) % n + n) % n, stair: true, spine: true });
  const below = iy > 0 ? L.spine[iy - 1] : null;
  if (below) spans.push({ r: below.rTop, len: 2, stair: false, spine: true });
  for (const d of decoSpans(L, iy)) spans.push(d);

  const on = (s, q) => (((q - s.r) % n) + n) % n <= s.len;
  const here = spans.filter((s) => on(s, k));
  const platAt = (q, level) => {
    if (level < 0 || level >= L.H) return false;
    const ss = [];
    const s2 = L.spine[level];
    if (s2) ss.push({ r: s2.r, len: ((s2.rTop - s2.r) % n + n) % n });
    const b2 = level > 0 ? L.spine[level - 1] : null;
    if (b2) ss.push({ r: b2.rTop, len: 2 });
    for (const d of decoSpans(L, level)) ss.push(d);
    return ss.some((s) => (((q - s.r) % n) + n) % n <= s.len);
  };
  if (!here.length) return openCell(platAt(k, iy + 1));
  const isStair = here.some((s) => s.stair && (((k - s.r) % n + n) % n) === s.len);
  const isTop = here.some((s) => !s.stair && (((k - s.r) % n + n) % n) === 0 && iy > 0);
  let hlink = 0, parapet = 0;
  const fwd = ringDir(L, k), bwd = OPP[ringDir(L, (k - 1 + n) % n)];
  if (!isStair && platAt(k + 1, iy)) hlink |= 1 << fwd;
  if (!isTop && platAt(k - 1, iy)) hlink |= 1 << bwd;
  if (!isStair && !isTop) {
    for (const [d, dx, dz] of [[0, 1, 0], [1, -1, 0], [4, 0, 1], [5, 0, -1]]) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jx >= L.W || jz < 0 || jz >= L.D || onRing(L, jx, jz)) continue;
      hlink |= 1 << d; parapet |= 1 << d;        // 吹き抜けを覗く。腰までの欄干つき
    }
  }
  // 上の階が踊り場なら、ここは天井でなければならない。でないと上に床がなくなる。
  let up = null;
  if (isStair && !top) up = { kind: 'stair', dir: ringDir(L, k) };
  else if (!top && !platAt(k, iy + 1)) up = { kind: 'open' };
  return { rock: false, full: true, ceil: CEIL_STD, up, hlink, parapet, solids: [] };
}

// 04 / 06 回廊のある縦長空間 ────────────────────────────────────
// 外周が各階の通路になり、真ん中が吹き抜け。
// 少し前に歩いた道を、数十メートル離れた別の高さから見ることになる。
function gallery(L, ix, iy, iz, stairAt) {
  const top = iy === L.H - 1;
  if (!onRing(L, ix, iz)) {
    return { rock: false, full: true, ceil: CEIL_STD,
             up: top ? null : { kind: 'open' }, hlink: 0, parapet: 0, solids: [] };
  }
  const n = ringLen(L), k = ringIndexOf(L, ix, iz);
  const st = stairAt(iy), stBelow = iy > 0 ? stairAt(iy - 1) : -1;
  const isStair = st >= 0 && ((st % n) + n) % n === k;
  const isTop = stBelow >= 0 && ((stBelow % n) + n) % n === k;
  let hlink = 0, parapet = 0;
  if (!isStair) hlink |= 1 << ringDir(L, k);
  if (!isTop) hlink |= 1 << OPP[ringDir(L, (k - 1 + n) % n)];
  if (!isStair && !isTop) {
    for (const [d, dx, dz] of [[0, 1, 0], [1, -1, 0], [4, 0, 1], [5, 0, -1]]) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jx >= L.W || jz < 0 || jz >= L.D || onRing(L, jx, jz)) continue;
      hlink |= 1 << d; parapet |= 1 << d;
    }
  }
  return { rock: false, full: true, ceil: CEIL_STD,
           up: isStair && !top ? { kind: 'stair', dir: ringDir(L, k) } : null,
           hlink, parapet, solids: [] };
}
const stackedStair = (L) => (iy) =>
  (iy >= L.H - 1 ? -1 : (hash32(L.seed, iy, 0x57AC) >>> 7) % ringLen(L));
const spineStair = (L) => (iy) => (L.spine[iy] ? L.spine[iy].rTop : -1);
const stacked = (L, ix, iy, iz) => gallery(L, ix, iy, iz, stackedStair(L));
const descent = (L, ix, iy, iz) => gallery(L, ix, iy, iz, spineStair(L));

// 05 部屋の中の部屋 ──────────────────────────────────────────────
function shellHoles(L, r, tag) {
  const out = new Set();
  const per = 2 * ((r.x1 - r.x0 + 1) + (r.z1 - r.z0 + 1)) - 4;
  if (per < 4) return out;
  const h = hash32(L.seed, tag, 0x8E11);
  for (let i = 0; i < 2; i++) {
    let t = ((h >>> (i * 9)) % per), W = r.x1 - r.x0 + 1, D = r.z1 - r.z0 + 1;
    let ix, iz;
    if (t < W) { ix = r.x0 + t; iz = r.z0; }
    else if ((t -= W) < D - 1) { ix = r.x1; iz = r.z0 + t + 1; }
    else if ((t -= D - 1) < W - 1) { ix = r.x1 - 1 - t; iz = r.z1; }
    else { t -= W - 1; ix = r.x0; iz = r.z1 - 1 - t; }
    out.add(ix + ',' + iz);
  }
  return out;
}
function nested(L, ix, iy, iz) {
  const P = L.params, top = iy === L.H - 1;
  const mid = { x0: P.a[0], x1: L.W - 1 - P.a[1], z0: P.a[2], z1: L.D - 1 - P.a[3] };
  const inn = { x0: mid.x0 + 2, x1: mid.x1 - 2, z0: mid.z0 + 2, z1: mid.z1 - 2 };
  const hm = shellHoles(L, mid, 0), hi2 = shellHoles(L, inn, 1);
  const edge = (r, jx, jz) => jx >= r.x0 && jx <= r.x1 && jz >= r.z0 && jz <= r.z1
                              && (jx === r.x0 || jx === r.x1 || jz === r.z0 || jz === r.z1);
  const isRock = (jx, jy, jz) => {
    if (edge(mid, jx, jz)) return !hm.has(jx + ',' + jz);
    if (inn.x1 >= inn.x0 && inn.z1 >= inn.z0 && edge(inn, jx, jz)) return !hi2.has(jx + ',' + jz);
    return false;
  };
  if (isRock(ix, iy, iz)) return { rock: true };
  return { rock: false, full: true, ceil: CEIL_STD,
           up: top ? null : { kind: 'open' },
           hlink: nbrs(L, ix, iz, isRock, iy), parapet: 0, solids: [] };
}


// ─── 世界の側から使う窓口 ────────────────────────────────────────

const cellCache = new Map();
function cellAt(seed, gx, gy, gz) {
  const k = (seed >>> 0) + ':' + gx + ':' + gy + ':' + gz;
  if (cellCache.has(k)) return cellCache.get(k);
  if (cellCache.size > 20000) cellCache.clear();
  const v = lmCell(seed, gx, gy, gz);
  cellCache.set(k, v);
  return v;
}

/** そのセルはランドマークの一部か。岩も含む。 */
export const inLandmark = (seed, gx, gy, gz) => cellAt(seed, gx, gy, gz) !== null;

/** 掘られていないランドマークの岩か。 */
export function lmRock(seed, gx, gy, gz) {
  const c = cellAt(seed, gx, gy, gz);
  return !!c && !!c.rock;
}

/** ランドマークが決める結び。null なら「ランドマークとは無関係」。 */
export function lmLinked(seed, gx, gy, gz, d) {
  const a = cellAt(seed, gx, gy, gz);
  const b = cellAt(seed, gx + DX[d], gy + DY[d], gz + DZ[d]);
  if (!a && !b) return null;
  if ((a && a.rock) || (b && b.rock)) return false;
  if (d === 2) return !!(a && a.up);
  if (d === 3) return !!(b && b.up);
  const ah = a ? (a.hlink >> d) & 1 : 0;
  const bh = b ? (b.hlink >> OPP[d]) & 1 : 0;
  return !!(ah || bh);
}

/** ランドマークの出入口の外側にあたるセルは、必ず掘られていなければならない。 */
export function lmForceOpen(seed, gx, gy, gz) {
  if (cellAt(seed, gx, gy, gz)) return false;
  for (let d = 0; d < 6; d++) {
    const b = cellAt(seed, gx + DX[d], gy + DY[d], gz + DZ[d]);
    if (b && !b.rock && ((b.hlink >> OPP[d]) & 1)) return true;
  }
  return false;
}

/** ランドマークの縦のつなぎ。 */
export function lmVFeat(seed, gx, gy, gz) {
  const a = cellAt(seed, gx, gy, gz);
  if (!a || a.rock || !a.up) return null;
  if (a.up.kind === 'open') return { kind: V_OPEN };
  if (a.up.kind === 'stair') return { kind: V_STAIR, dir: a.up.dir, smooth: false, lm: true };
  return { kind: V_SHAFT, corner: 0 };
}

/** ランドマークの部屋の形。 */
export function lmRoom(seed, gx, gy, gz) {
  const a = cellAt(seed, gx, gy, gz);
  if (!a || a.rock) return null;
  return a;
}

/** 欄干のある口か。 */
export function lmSill(seed, gx, gy, gz, d) {
  if (d === 2 || d === 3) return 0;
  const a = cellAt(seed, gx, gy, gz);
  const b = cellAt(seed, gx + DX[d], gy + DY[d], gz + DZ[d]);
  const am = a && !a.rock && ((a.parapet >> d) & 1);
  const bm = b && !b.rock && ((b.parapet >> OPP[d]) & 1);
  return (am || bm) ? PARAPET : 0;
}

/** セルの中に残された岩の塊（柱など）。 */
export function lmSolids(seed, gx, gy, gz) {
  const a = cellAt(seed, gx, gy, gz);
  return a && !a.rock && a.solids.length ? a.solids : null;
}
