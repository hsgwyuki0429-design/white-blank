// 世界の寸法。world.js と landmarks.js の両方が使うので、ここに置いて循環参照を避ける。

export const CW = 6, CY = 4, CD = 6;         // 1チャンクのセル数 (x, y, z)
export const NCELL = CW * CY * CD;
export const CELL = 5.6;                     // セルの水平寸法 (m)
export const LEVEL = 2.7;                    // 1階層の高さ (m)
export const SLAB = 0.28;                    // 床と天井の厚み (m)
export const CEIL_STD = LEVEL - SLAB;        // ふつうの天井までの高さ
export const CEIL_LOW = 1.94;                // 突然かがむことになる天井（背丈1.74がやっと通る）

export const WALL = 0.50;                    // 部屋のふちに残す岩の厚み (m)
export const ROOM_MAX = CELL - WALL * 2;     // いちばん広い部屋 (4.6m)
export const ROOM_MIN = 1.95;                // いちばん狭い通路
export const RISE_T = 0.80;                  // 階段が部屋のどこまでで登りきるか
export const LANDING = 0.95;                 // 上りきった先に残す踊り場の奥行き

// 方向 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z
export const DX = [1, -1, 0, 0, 0, 0];
export const DY = [0, 0, 1, -1, 0, 0];
export const DZ = [0, 0, 0, 0, 1, -1];
export const OPP = [1, 0, 3, 2, 5, 4];
export const HDIRS = [0, 1, 4, 5];

// 縦のつなぎ方
export const V_SHAFT = 0;   // 落下穴。床にあいた四角い穴
export const V_STAIR = 1;   // 階段か斜路。登れる
export const V_OPEN = 2;    // 床そのものがない。吹き抜け

export const fdiv = (a, b) => Math.floor(a / b);
export const fmod = (a, b) => ((a % b) + b) % b;
export const idx = (x, y, z) => (y * CD + z) * CW + x;

// 体の寸法。通れるかどうかの判断はぜんぶここを基準にする
export const PARAPET = 1.28;                 // 越えられないが見わたせる欄干の高さ
export const PARAPET_T = 0.46;               // その厚み

export const BODY_H = 1.74, BODY_R = 0.32;
export const MIN_GAP = 1.05;                 // これより狭い必須通路は作らない
export const MIN_HEAD = 1.90;                // これより低い必須通路は作らない
