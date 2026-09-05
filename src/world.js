// 無限に広がる地下の生成。
//
// 世界は保存しない。セルの座標とシードから、必要になった分だけ組み立て直す。
// だから引き返せば、さっきと寸分たがわぬ通路がまたそこにある。
//
// 連結性の保証:
//   1. チャンク内の開いたセルは全域木で必ず全部つながる
//   2. 隣り合うチャンクの境界面には、必ず1つ以上の出入口を開ける
//   → 無限のチャンク格子がひとつながりになる

import { hash32, hashUnit, rngFor, shuffle } from './rng.js';

export const CW = 6, CY = 5, CD = 6;        // 1チャンクのセル数 (x, y, z)
export const NCELL = CW * CY * CD;
export const CELL = 3.4;                     // セルの水平寸法 (m)
export const LEVEL = 2.7;                    // 1階層の高さ (m)
export const TILES = 4;                      // 床面をこの数で分割して穴を表現する
export const TILE = CELL / TILES;

// 方向 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z
export const DX = [1, -1, 0, 0, 0, 0];
export const DY = [0, 0, 1, -1, 0, 0];
export const DZ = [0, 0, 0, 0, 1, -1];
export const OPP = [1, 0, 3, 2, 5, 4];
const HDIRS = [0, 1, 4, 5];                  // 水平4方向

// 縦のつなぎ方
export const V_SHAFT = 0;   // 落下穴。落ちるだけ
export const V_STAIR = 1;   // 階段。登れる

const fdiv = (a, b) => Math.floor(a / b);
const fmod = (a, b) => ((a % b) + b) % b;
export const idx = (x, y, z) => (y * CD + z) * CW + x;

/** チャンク1つ分のセルデータ。 */
class Chunk {
  constructor(kx, ky, kz) {
    this.kx = kx; this.ky = ky; this.kz = kz;
    this.solid = new Uint8Array(NCELL);   // 1 = 岩。掘られていない
    this.link = new Uint8Array(NCELL);    // 方向dへ通れるなら bit d。両側のセルに同じことを書く
    this.vfeat = new Uint8Array(NCELL);   // +Yリンクの様子: 下位4bit=種別+1 / 上位4bit=向きや隅
    this.carved = false;                  // 迷路を掘ったか
    this.mesh = null;                     // 後でmesher.jsが入れる
  }
}

/**
 * 岩と空洞の分布だけを決める第一段階。
 * 隣のチャンクの出入口を決めるときに参照するので、リンク生成とは分けてある。
 */
function genBase(seed, kx, ky, kz) {
  const c = new Chunk(kx, ky, kz);
  const rng = rngFor(seed, kx, ky, kz, 0x9E37);

  // チャンクごとに性格を変える。詰まった区画と、抜けた区画。
  const t = rng();
  const density = t < 0.18 ? 0.06 : t < 0.72 ? 0.20 : 0.36;
  // 深いところほど岩が増える（下るほど狭く、息苦しく）
  const depthBias = Math.min(0.14, Math.max(0, -ky) * 0.012);

  for (let i = 0; i < NCELL; i++) {
    c.solid[i] = rng() < density + depthBias ? 1 : 0;
  }

  // 空洞が分断されていたら、小さい方を岩に戻す。
  // ここで「チャンク内の空洞は必ずひとつながり」が保証される。
  const seen = new Int8Array(NCELL);
  let best = null, bestN = 0;
  const stack = [];
  for (let s = 0; s < NCELL; s++) {
    if (c.solid[s] || seen[s]) continue;
    const group = [];
    stack.length = 0; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const i = stack.pop(); group.push(i);
      const x = i % CW, z = ((i / CW) | 0) % CD, y = (i / (CW * CD)) | 0;
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (nx < 0 || nx >= CW || ny < 0 || ny >= CY || nz < 0 || nz >= CD) continue;
        const j = idx(nx, ny, nz);
        if (seen[j] || c.solid[j]) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    if (group.length > bestN) { bestN = group.length; best = group; }
  }
  if (best) {
    const keep = new Int8Array(NCELL);
    for (const i of best) keep[i] = 1;
    for (let i = 0; i < NCELL; i++) if (!keep[i]) c.solid[i] = 1;
  } else {
    // 全部岩になってしまった稀な場合。真ん中に1本だけ空洞を通す。
    for (let y = 0; y < CY; y++) c.solid[idx(CW >> 1, y, CD >> 1)] = 0;
  }
  return c;
}

/** チャンク内の迷路を掘る（全域木＋少しの環）。 */
function carveMaze(c, seed) {
  const rng = rngFor(seed, c.kx, c.ky, c.kz, 0x1B7D);
  const { solid, link } = c;

  let start = -1;
  for (let i = 0; i < NCELL; i++) if (!solid[i]) { start = i; break; }
  if (start < 0) return;

  // 再帰的バックトラッカ。行き止まりの多い、素直に迷う迷路になる。
  const seen = new Uint8Array(NCELL);
  const stack = [start];
  seen[start] = 1;
  const horiz = [0, 1, 4, 5], vert = [2, 3], order = new Array(6);
  while (stack.length) {
    const i = stack[stack.length - 1];
    const x = i % CW, z = ((i / CW) | 0) % CD, y = (i / (CW * CD)) | 0;
    // 縦は「後回しにしがち」なだけで、必ず最後に試す。
    // ここで縦を読み飛ばすと、縦にしか繋がらないセルが取り残されて孤立する。
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
      link[i] |= 1 << d; link[j] |= 1 << OPP[d];
      seen[j] = 1; stack.push(j); moved = true; break;
    }
    if (!moved) stack.pop();
  }

  // まれに、広間をひとつ。ずっと同じ幅の通路だと、世界の広さが伝わらない。
  const halls = rng() < 0.55 ? 1 : 0;
  for (let n = 0; n < halls; n++) {
    const hx = 1 + Math.floor(rng() * (CW - 3)), hz = 1 + Math.floor(rng() * (CD - 3));
    const hy = Math.floor(rng() * CY);
    let ok = true;
    for (let a = 0; a < 2 && ok; a++) for (let b = 0; b < 2; b++)
      if (solid[idx(hx + a, hy, hz + b)]) { ok = false; break; }
    if (!ok) continue;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const i = idx(hx + a, hy, hz + b);
      if (a === 0) { const j = idx(hx + 1, hy, hz + b); link[i] |= 1 << 0; link[j] |= 1 << 1; }
      if (b === 0) { const j = idx(hx + a, hy, hz + 1); link[i] |= 1 << 4; link[j] |= 1 << 5; }
    }
  }

  // 保険。万一取り残されたセルがあれば、隣の空洞と手をつながせる。
  for (let i = 0; i < NCELL; i++) {
    if (solid[i] || seen[i]) continue;
    const x = i % CW, z = ((i / CW) | 0) % CD, y = (i / (CW * CD)) | 0;
    for (let d = 0; d < 6; d++) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      if (nx < 0 || nx >= CW || ny < 0 || ny >= CY || nz < 0 || nz >= CD) continue;
      const j = idx(nx, ny, nz);
      if (solid[j]) continue;
      link[i] |= 1 << d; link[j] |= 1 << OPP[d];
      seen[i] = 1; break;
    }
  }

  // 環を足す。行き止まりだらけだと、戻る道が一本しかなくて息が詰まる。
  for (let i = 0; i < NCELL; i++) {
    if (solid[i]) continue;
    const x = i % CW, z = ((i / CW) | 0) % CD, y = (i / (CW * CD)) | 0;
    for (const d of [0, 2, 4]) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      if (nx >= CW || ny >= CY || nz >= CD) continue;
      const j = idx(nx, ny, nz);
      if (solid[j] || (link[i] & (1 << d))) continue;
      const p = d === 2 ? 0.05 : 0.13;
      if (rng() < p) { link[i] |= 1 << d; link[j] |= 1 << OPP[d]; }
    }
  }
}

/**
 * 境界面に出入口を開ける。
 * 面を共有する2チャンクのうち座標の小さい方を基準に乱数を引くので、
 * 両側がそれぞれ独立に計算しても、まったく同じ位置に穴が開く。
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
    if (axis === 0) {
      const ax = near ? CW - 1 : 0, bx = near ? 0 : CW - 1;
      for (let y = 0; y < CY; y++) for (let z = 0; z < CD; z++)
        if (!c.solid[idx(ax, y, z)] && !n.solid[idx(bx, y, z)]) cand.push(idx(ax, y, z));
    } else if (axis === 1) {
      const ay = near ? CY - 1 : 0, by = near ? 0 : CY - 1;
      for (let x = 0; x < CW; x++) for (let z = 0; z < CD; z++)
        if (!c.solid[idx(x, ay, z)] && !n.solid[idx(x, by, z)]) cand.push(idx(x, ay, z));
    } else {
      const az = near ? CD - 1 : 0, bz = near ? 0 : CD - 1;
      for (let x = 0; x < CW; x++) for (let y = 0; y < CY; y++)
        if (!c.solid[idx(x, y, az)] && !n.solid[idx(x, y, bz)]) cand.push(idx(x, y, az));
    }
    if (!cand.length) continue;
    shuffle(rng, cand);
    const count = axis === 1
      ? 1 + (rng() < 0.45 ? 1 : 0)
      : 1 + (rng() < 0.6 ? 1 : 0) + (rng() < 0.25 ? 1 : 0);
    for (let k = 0; k < Math.min(count, cand.length); k++) c.link[cand[k]] |= 1 << d;
  }
}

// ─── 縦のつなぎ目 ────────────────────────────────────────────────

/**
 * 上下のつなぎ目を、階段か落下穴かに振り分ける。
 *
 * 落下穴は一方通行だ。落ちた先が階段のない窪地だったら、そこで世界は終わってしまう。
 * 実際それは起きる。種によっては、始まりの場所そのものが出られない穴の底になる。
 *
 * そこで「歩いて往復できる辺」＝水平リンクと階段だけを使って連結成分を数え、
 * ばらけている間だけ落下穴を階段に変える。必要な数しか変えないので、穴は穴のまま残る。
 * チャンク内が往復できれば、境界の水平な出入口を通じて世界全体が往復できる。
 */
function assignVertical(c, seed) {
  const { solid, link, vfeat } = c;
  const kind = (i) => (vfeat[i] & 0x0f) - 1;
  const shafts = [];

  // 段のあるものと、ひと続きに傾いたもの。どちらも登れる坂だが、見え方がまるで違う
  const stairAt = (i, x, y, z) => {
    const h = hash32(seed, c.kx * CW + x, c.ky * CY + y, c.kz * CD + z, 0x57A1);
    vfeat[i] = (V_STAIR + 1) | (HDIRS[(h >>> 7) & 3] << 4) | ((h >>> 21) % 100 < 42 ? 0x80 : 0);
  };

  for (let y = 0; y < CY; y++) for (let z = 0; z < CD; z++) for (let x = 0; x < CW; x++) {
    const i = idx(x, y, z);
    if (!(link[i] & 4)) continue;
    const h = hash32(seed, c.kx * CW + x, c.ky * CY + y, c.kz * CD + z, 0x57A1);
    if (h % 100 < 46) stairAt(i, x, y, z);
    else { vfeat[i] = (V_SHAFT + 1) | (((h >>> 9) & 3) << 4); shafts.push(i); }
  }

  // 往復できる辺だけで連結成分を数える
  const par = new Int32Array(NCELL);
  for (let i = 0; i < NCELL; i++) par[i] = i;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a === b) return false; par[a] = b; return true; };

  let comps = 0;
  for (let i = 0; i < NCELL; i++) if (!solid[i]) comps++;
  for (let y = 0; y < CY; y++) for (let z = 0; z < CD; z++) for (let x = 0; x < CW; x++) {
    const i = idx(x, y, z);
    if (solid[i]) continue;
    if ((link[i] & 1) && x + 1 < CW && uni(i, idx(x + 1, y, z))) comps--;
    if ((link[i] & 16) && z + 1 < CD && uni(i, idx(x, y, z + 1))) comps--;
    if ((link[i] & 4) && y + 1 < CY && kind(i) === V_STAIR && uni(i, idx(x, y + 1, z))) comps--;
  }

  // ばらけている塊を、落下穴を階段に変えてつなぐ
  shuffle(rngFor(seed, c.kx, c.ky, c.kz, 0x571A), shafts);
  for (const i of shafts) {
    if (comps <= 1) break;
    const x = i % CW, z = ((i / CW) | 0) % CD, y = (i / (CW * CD)) | 0;
    if (y + 1 >= CY) continue;                    // チャンクの外へ抜ける縦は、ここでは判断できない
    if (!uni(i, idx(x, y + 1, z))) continue;
    stairAt(i, x, y, z);
    comps--;
  }
}

export function decodeVFeat(v) {
  if (!v) return null;
  const kind = (v & 0x0f) - 1;
  if (kind === V_SHAFT) return { kind, corner: (v >> 4) & 3 };
  return { kind, dir: (v >> 4) & 7, smooth: (v & 0x80) !== 0 };
}

/**
 * つなぎ目が床面(4x4タイル)のどこを抜くか。ビット i + j*4 が立っていたらそのタイルは無い。
 * 抜いた残りが必ず四辺すべてに接して繋がるように形を選んである。
 * そうしないと、穴の向こう側の通路へ渡れなくなる。
 */
export function holeMask(v) {
  let m = 0;
  if (v.kind === V_SHAFT) {
    const i0 = (v.corner === 1 || v.corner === 2) ? 2 : 0;
    const j0 = (v.corner === 2 || v.corner === 3) ? 2 : 0;
    for (let j = j0; j < j0 + 2; j++) for (let i = i0; i < i0 + 2; i++) m |= 1 << (i + j * 4);
  } else {
    // 階段は中央半分を占める。手前1マスぶんは頭がぶつからないので床を残す。
    const along = v.dir === 0 || v.dir === 1 ? 0 : 1;   // 0: x方向に登る / 1: z方向
    const rev = v.dir === 1 || v.dir === 5;
    for (let r = 1; r < 4; r++) {
      const a = rev ? 3 - r : r;
      for (let p = 1; p <= 2; p++) {
        const i = along === 0 ? a : p, j = along === 0 ? p : a;
        m |= 1 << (i + j * 4);
      }
    }
  }
  return m;
}

/** 角を45度に落とすか。両隣が壁のときだけ。0:(-X,-Z) 1:(+X,-Z) 2:(+X,+Z) 3:(-X,+Z) */
const CORNER_DIRS = [[1, 5], [0, 5], [0, 4], [1, 4]];
export function chamferAt(seed, gx, gy, gz, link) {
  let m = 0;
  for (let c = 0; c < 4; c++) {
    const [d1, d2] = CORNER_DIRS[c];
    if ((link & (1 << d1)) || (link & (1 << d2))) continue;
    if ((hash32(seed, gx, gy, gz, 0xC0A0 + c) % 100) < 24) m |= 1 << c;
  }
  return m;
}

/** 無限世界。チャンクを必要に応じて作り、覚えておく。 */
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
      assignVertical(c, this.seed);
      c.carved = true;
    }
    this.full.set(k, c);
    return c;
  }

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

  /** そのセルが空洞か。 */
  open(x, y, z) {
    const c = this.chunk(fdiv(x, CW), fdiv(y, CY), fdiv(z, CD));
    return !c.solid[idx(fmod(x, CW), fmod(y, CY), fmod(z, CD))];
  }

  /** セルから方向dへ通り抜けられるか。リンクは両側に書いてあるので隣を見にいかなくていい。 */
  linked(x, y, z, d) {
    const c = this.chunk(fdiv(x, CW), fdiv(y, CY), fdiv(z, CD));
    return (c.link[idx(fmod(x, CW), fmod(y, CY), fmod(z, CD))] & (1 << d)) !== 0;
  }

  /** そのセルの6方向ぶんのリンクビット。 */
  linkBits(x, y, z) {
    const c = this.chunk(fdiv(x, CW), fdiv(y, CY), fdiv(z, CD));
    return c.link[idx(fmod(x, CW), fmod(y, CY), fmod(z, CD))];
  }

  /** そのセルの天井のつなぎ目。上とつながっていなければ null。 */
  vfeat(x, y, z) {
    const c = this.chunk(fdiv(x, CW), fdiv(y, CY), fdiv(z, CD));
    return decodeVFeat(c.vfeat[idx(fmod(x, CW), fmod(y, CY), fmod(z, CD))]);
  }
}

export { fdiv, fmod };
