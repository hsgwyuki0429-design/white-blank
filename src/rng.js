// 決定論的な乱数まわり。
// この世界は「保存」されない。座標とシードから毎回同じものを計算し直すだけ。

const imul = Math.imul;

/** 任意個の32bit整数を1本のハッシュに畳み込む（順序に依存）。 */
export function hash32(...vals) {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < vals.length; i++) {
    let v = vals[i] | 0;
    // 32bitを4バイトに分けて混ぜる（負の座標でも均等に散る）
    for (let b = 0; b < 4; b++) {
      h ^= (v >>> (b * 8)) & 0xff;
      h = imul(h, 0x01000193);
    }
  }
  // 仕上げの雪崩（murmur3 finalizer）
  h ^= h >>> 16; h = imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** ハッシュから直接 [0,1) を取る。状態を持たない判定に。 */
export function hashUnit(...vals) {
  return hash32(...vals) / 4294967296;
}

/** 32bitシードから始まる高速PRNG。 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = imul(t ^ (t >>> 15), t | 1);
    t ^= t + imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 座標などからPRNGを作る。チャンク生成の入口。 */
export function rngFor(...vals) {
  return mulberry32(hash32(...vals));
}

/** 配列をその場でシャッフル（Fisher-Yates）。 */
export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/** 人が読める種文字列 → 32bit。空なら時刻から。 */
export function seedFromString(str) {
  if (!str) return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i) & 0xff;
    h = imul(h, 0x01000193);
    h ^= (str.charCodeAt(i) >>> 8) & 0xff;
    h = imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = imul(h, 0x85ebca6b); h ^= h >>> 16;
  return h >>> 0;
}

const SYLL_A = ['シ', 'ク', 'ラ', 'ヴ', 'ネ', 'ト', 'ミ', 'ハ', 'ゼ', 'ル', 'オ', 'カ'];
const SYLL_B = ['ロ', 'ナ', 'メ', 'ド', 'サ', 'イ', 'ム', 'テ', 'ワ', 'ギ', 'ヨ', 'ペ'];
const SYLL_C = ['ン', 'ス', 'リ', 'フ', 'ア', 'ツ', 'エ', 'ヤ', 'グ', 'ホ'];

/** 32bitシードを、口に出せる名前に戻す（同じ種＝同じ名前）。 */
export function seedName(seed) {
  const s = seed >>> 0;
  return SYLL_A[s % 12] + SYLL_B[(s >>> 5) % 12] + SYLL_C[(s >>> 11) % 10]
       + SYLL_A[(s >>> 17) % 12] + '-' + (s % 1000).toString().padStart(3, '0');
}
