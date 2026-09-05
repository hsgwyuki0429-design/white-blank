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

export const CW = 6, CY = 5, CD = 6;        // 1チャンクのセル数 (x, y, z)
export const NCELL = CW * CY * CD;
export const CELL = 4.0;                     // セルの水平寸法 (m)
export const LEVEL = 2.6;                    // 1階層の高さ (m)
export const SLAB = 0.24;                    // 床と天井の厚み (m)
export const CEIL_STD = LEVEL - SLAB;        // ふつうの天井までの高さ
export const CEIL_LOW = 1.92;                // 突然かがむことになる天井（背丈1.74がやっと通る）
export const TILES = 4;                      // 床面をこの数で分割して穴を表現する
export const TILE = CELL / TILES;

// 方向 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z
export const DX = [1, -1, 0, 0, 0, 0];
export const DY = [0, 0, 1, -1, 0, 0];
export const DZ = [0, 0, 0, 0, 1, -1];
export const OPP = [1, 0, 3, 2, 5, 4];
const HDIRS = [0, 1, 4, 5];                  // 水平4方向

// 縦のつなぎ方
export const V_SHAFT = 0;   // 落下穴。床にあいた四角い穴
export const V_STAIR = 1;   // 階段か斜路。登れる
export const V_OPEN = 2;    // 床そのものがない。吹き抜け

const fdiv = (a, b) => Math.floor(a / b);
const fmod = (a, b) => ((a % b) + b) % b;
export const idx = (x, y, z) => (y * CD + z) * CW + x;

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
  const b = voidBox(seed, gx, gz);
  return !!b && gx >= b.x0 && gx <= b.x1 && gz >= b.z0 && gz <= b.z1 && gy >= b.y0 && gy <= b.y1;
}

/** そのセルの天井までの高さ。低い天井のセルは上とつながれない（後で効いてくる）。 */
export function ceilHeight(seed, gx, gy, gz) {
  if (inVoid(seed, gx, gy, gz)) return CEIL_STD;
  return (hash32(seed, gx, gy, gz, 0x10C0) % 100) < 13 ? CEIL_LOW : CEIL_STD;
}
export const isLowCeil = (seed, gx, gy, gz) => ceilHeight(seed, gx, gy, gz) < CEIL_STD;

/**
 * 縦のつなぎ方の素案。吹き抜けの中は必ず「床なし」。
 * 後でチャンクが、往復できないぶんだけ落下穴を階段に書き換える。
 * 床なしだけは書き換えない——上下のチャンクが独立に同じ答えを出す必要があるから。
 */
export function baseVFeat(seed, gx, gy, gz) {
  if (inVoid(seed, gx, gy, gz) && inVoid(seed, gx, gy + 1, gz)) {
    return { kind: V_OPEN };
  }
  const h = hash32(seed, gx, gy, gz, 0x57A1);
  const r = h % 100;
  if (r < 16) return { kind: V_OPEN };
  if (r < 60) return { kind: V_STAIR, dir: HDIRS[(h >>> 7) & 3], smooth: ((h >>> 21) % 100) < 42 };
  return { kind: V_SHAFT, corner: (h >>> 9) & 3 };
}

/** 上とつながっているセルに床があるか。吹き抜けの途中には床がない。 */
export function hasFloorBelow(seed, gx, gy, gz) {
  return baseVFeat(seed, gx, gy - 1, gz).kind !== V_OPEN;
}

// 戸口。壁いっぱいに開いているか、人ひとり分に絞られているか
export function aperture(seed, gx, gy, gz, d) {
  const lx = gx + (DX[d] < 0 ? -1 : 0), lz = gz + (DZ[d] < 0 ? -1 : 0);
  const h = hash32(seed, lx, gy, lz, 0xA9E0 + (d >> 1));
  if (h % 100 < 60) return null;                       // 壁いっぱい
  const w = 1.15 + ((h >>> 7) % 100) / 100 * 1.15;     // 1.15〜2.30m
  const y = 1.90 + ((h >>> 14) % 100) / 100 * 0.40;    // 高さ
  const off = (((h >>> 21) % 100) / 100 - 0.5) * (CELL - w - 1.3);
  return { w, h: y, off };
}

/** 角を45度に落とす。両隣が壁のときだけ。0:(-X,-Z) 1:(+X,-Z) 2:(+X,+Z) 3:(-X,+Z) */
const CORNER_DIRS = [[1, 5], [0, 5], [0, 4], [1, 4]];
export function chamferAt(seed, gx, gy, gz, link) {
  let m = 0;
  for (let c = 0; c < 4; c++) {
    const [d1, d2] = CORNER_DIRS[c];
    if ((link & (1 << d1)) || (link & (1 << d2))) continue;
    const h = hash32(seed, gx, gy, gz, 0xC0A0 + c) % 100;
    if (h < 12) m |= 2 << (c * 2);          // 大きく落とす（2タイル）
    else if (h < 30) m |= 1 << (c * 2);     // 小さく落とす（1タイル）
  }
  return m;
}
export const chamferSize = (m, c) => (m >> (c * 2)) & 3;

/**
 * つなぎ目が床面(4x4タイル)のどこを抜くか。ビット i + j*4 が立っていたらそのタイルは無い。
 * 抜いた残りが必ず四辺すべてに接して連結する形しか選ばない。
 * そうしないと、穴の向こう側の通路へ渡れなくなる。
 */
export function holeMask(v) {
  if (v.kind === V_OPEN) return 0xffff;                // 床そのものがない
  let m = 0;
  if (v.kind === V_SHAFT) {
    const i0 = (v.corner === 1 || v.corner === 2) ? 2 : 0;
    const j0 = (v.corner === 2 || v.corner === 3) ? 2 : 0;
    for (let j = j0; j < j0 + 2; j++) for (let i = i0; i < i0 + 2; i++) m |= 1 << (i + j * 4);
  } else {
    // 階段は中央半分を占める。いちばん奥の一列は残す——そこが上りきった先の踊り場になる。
    const along = v.dir === 0 || v.dir === 1 ? 0 : 1;
    const rev = v.dir === 1 || v.dir === 5;
    for (let r = 0; r < 3; r++) {
      const a = rev ? 3 - r : r;
      for (let p = 1; p <= 2; p++) {
        const i = along === 0 ? a : p, j = along === 0 ? p : a;
        m |= 1 << (i + j * 4);
      }
    }
  }
  return m;
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
  // 巨大な空洞の中は必ず掘れている
  for (let i = 0; i < NCELL; i++) {
    if (inVoid(seed, c.gx(i), c.gy(i), c.gz(i))) c.solid[i] = 0;
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
    while (x !== bx) { x += Math.sign(bx - x); c.solid[idx(x, y, z)] = 0; }
    while (z !== bz) { z += Math.sign(bz - z); c.solid[idx(x, y, z)] = 0; }
    while (y !== by) { y += Math.sign(by - y); c.solid[idx(x, y, z)] = 0; }
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
  if (inVoid(seed, gx, gy, gz) && inVoid(seed, gx, gy + 1, gz)) return true;
  return baseVFeat(seed, gx, gy, gz).kind !== V_OPEN;
}

/** チャンク内の迷路を掘る（全域木＋少しの環）。 */
function carveMaze(c, seed) {
  const rng = rngFor(seed, c.kx, c.ky, c.kz, 0x1B7D);
  const { solid, link } = c;

  // 巨大な空洞の中は、はじめから全部ひと続きにしておく
  for (let y = 0; y < CY; y++) for (let z = 0; z < CD; z++) for (let x = 0; x < CW; x++) {
    const i = idx(x, y, z);
    if (!inVoid(seed, c.gx(i), c.gy(i), c.gz(i))) continue;
    for (const d of [0, 2, 4]) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      if (nx >= CW || ny >= CY || nz >= CD) continue;
      const j = idx(nx, ny, nz);
      if (!inVoid(seed, c.gx(j), c.gy(j), c.gz(j))) continue;
      link[i] |= 1 << d; link[j] |= 1 << OPP[d];
    }
  }

  let start = -1;
  for (let i = 0; i < NCELL; i++) if (!solid[i]) { start = i; break; }
  if (start < 0) return;

  const seen = new Uint8Array(NCELL);
  const stack = [start];
  seen[start] = 1;
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
      if (d === 2 && !structuralUp(seed, c, i)) continue;
      if (d === 3 && !structuralUp(seed, c, j)) continue;
      link[i] |= 1 << d; link[j] |= 1 << OPP[d];
      seen[j] = 1; stack.push(j); moved = true; break;
    }
    if (!moved) stack.pop();
  }
  // すでに空洞どうしが繋がっている（吹き抜けの先など）なら、その先も辿らせる
  for (let i = 0; i < NCELL; i++) {
    if (solid[i] || seen[i]) continue;
    const x = i % CW, z = ((i / CW) | 0) % CD, y = (i / (CW * CD)) | 0;
    for (let d = 0; d < 6; d++) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      if (nx < 0 || nx >= CW || ny < 0 || ny >= CY || nz < 0 || nz >= CD) continue;
      const j = idx(nx, ny, nz);
      if (solid[j]) continue;
      if (d === 2 && !structuralUp(seed, c, i)) continue;
      if (d === 3 && !structuralUp(seed, c, j)) continue;
      link[i] |= 1 << d; link[j] |= 1 << OPP[d];
      seen[i] = 1; break;
    }
  }

  // 環。行き止まりだらけだと、戻る道が一本しかなくて息が詰まる
  for (let i = 0; i < NCELL; i++) {
    if (solid[i]) continue;
    const x = i % CW, z = ((i / CW) | 0) % CD, y = (i / (CW * CD)) | 0;
    for (const d of [0, 2, 4]) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      if (nx >= CW || ny >= CY || nz >= CD) continue;
      const j = idx(nx, ny, nz);
      if (solid[j] || (link[i] & (1 << d))) continue;
      if (d === 2 && !canLinkUp(seed, c, i)) continue;
      // 床のない縦を、まだ何ともつながっていないセルに足さない。
      // それ一本きりになると、落ちて入るだけの袋小路ができる
      if (d === 2 && !structuralUp(seed, c, i) && !link[i]) continue;
      if (rng() < (d === 2 ? 0.05 : 0.13)) { link[i] |= 1 << d; link[j] |= 1 << OPP[d]; }
    }
  }

  // 巨大な空洞の壁に、あちこちの高さから穴を開ける。
  // 見上げれば道が見えるのに、そこへは行けない——という眺めがこれで生まれる。
  for (let y = 0; y < CY; y++) for (let z = 0; z < CD; z++) for (let x = 0; x < CW; x++) {
    const i = idx(x, y, z);
    if (!inVoid(seed, c.gx(i), c.gy(i), c.gz(i))) continue;
    const bottom = !inVoid(seed, c.gx(i), c.gy(i) - 1, c.gz(i));
    for (const d of HDIRS) {
      const nx = x + DX[d], nz = z + DZ[d];
      if (nx < 0 || nx >= CW || nz < 0 || nz >= CD) continue;
      const j = idx(nx, y, nz);
      if (solid[j] || inVoid(seed, c.gx(j), c.gy(j), c.gz(j))) continue;
      if (rng() < (bottom ? 0.75 : 0.16)) { link[i] |= 1 << d; link[j] |= 1 << OPP[d]; }
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
      if (axis === 1) {
        // 縦は低い天井をまたげない。床のない縦も境界には開けない——
        // 向こう側が「落ちて入るだけ」の袋小路になりかねない
        const ly = d === 2 ? gy : gy - 1;
        if (isLowCeil(seed, gx, ly, gz)) return;
        if (baseVFeat(seed, gx, ly, gz).kind === V_OPEN) return;
      }
      if (inVoid(seed, gx, gy, gz) && inVoid(seed, gx + DX[d], gy + DY[d], gz + DZ[d])) {
        c.link[a] |= 1 << d;                              // 空洞どうしは無条件
        return;
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

  let comps = 0;
  for (let i = 0; i < NCELL; i++) if (!solid[i] && floorOf[i]) comps++;
  const kindOf = (i) => stair[i] ? V_STAIR : baseVFeat(seed, c.gx(i), c.gy(i), c.gz(i)).kind;
  const shafts = [];

  for (let y = 0; y < CY; y++) for (let z = 0; z < CD; z++) for (let x = 0; x < CW; x++) {
    const i = idx(x, y, z);
    if (solid[i] || !floorOf[i]) continue;
    if ((link[i] & 1) && x + 1 < CW && floorOf[idx(x + 1, y, z)] && uni(i, idx(x + 1, y, z))) comps--;
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
    stair[b.up[hash32(seed, c.kx, c.ky, c.kz, r) % b.up.length]] = 1;
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
