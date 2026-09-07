// 100 authored excavations. Coordinates are cells, boxes are half-open.
// Recipes run only when their coarse world cell is visited; no meshes are stored here.
import { CEIL_STD, DX, DZ, OPP } from './dims.js';

export const RARITY_WEIGHT = Object.freeze({ common: 12, uncommon: 5, rare: 1, very_rare: 0.15 });
const entries = [];
function add(name, category, rarity, size, discovery, build) {
  const id = `LM_${String(entries.length + 1).padStart(3, '0')}`;
  entries.push(Object.freeze({ id, name, category, rarity, size: Object.freeze(size), discovery, build }));
}
// e: excavate (x,z,width,depth,height,floor=0); b: retain rock (x,z,w,d,height,floor=0).
// Each design has its own arrangement, entrance view and close-range discovery.

// 001–010: thresholds — a recognizable opening announces a different space.
add('針の門', 'threshold', 'common', [7,5,8], '細い縦の切れ目を抜けると、門の背面だけが広い。', p=>{
  p.e(0,1,7,3,2); p.e(3,0,1,5,8); p.e(5,0,2,5,4);
});
add('倒れた額縁', 'threshold', 'common', [9,7,5], '横長の開口の脇に、額縁の厚みを回り込む通路。', p=>{
  p.e(0,0,9,7,5); p.b(3,1,2,5,5); p.e(3,2,2,3,1); p.e(3,3,2,1,3);
});
add('鍵穴の広間', 'threshold', 'common', [9,9,7], '低い柄のような道の先で、頭上だけが膨らむ。', p=>{
  p.e(0,4,9,1,1); p.e(5,2,3,5,4); p.e(4,3,5,3,7); p.e(6,1,1,7,5);
});
add('食い違う門柱', 'threshold', 'common', [8,7,6], '前後にずれた壁の隙間を、視点をずらして見つける。', p=>{
  p.e(0,0,8,7,6); p.b(2,0,1,4,6); p.b(4,3,1,4,6); p.b(6,1,1,2,3);
});
add('三角の喉', 'threshold', 'common', [9,7,5], '段状に尖った開口の先には横向きの小室。', p=>{
  p.e(0,0,2,7,5); p.e(2,1,2,5,4); p.e(4,2,2,3,3); p.e(6,3,3,1,1); p.e(8,1,1,5,2);
});
add('二重の地平線', 'threshold', 'common', [9,5,6], '壁を横切る二本の隙間。下だけを歩いて通れる。', p=>{
  p.e(0,0,9,5,6); p.b(4,0,1,5,6); p.e(4,0,1,5,1); p.e(4,0,1,5,1,4);
});
add('十字の欠落', 'threshold', 'uncommon', [9,9,8], '十字形の空洞を抜け、背後からその輪郭を読み直す。', p=>{
  p.e(0,0,9,9,8); p.b(4,0,1,9,8); p.e(4,4,1,1,8); p.e(4,1,1,7,2,3);
});
add('門のない蝶番', 'threshold', 'uncommon', [7,7,5], 'L字の厚い岩に、一人分の折り返しが隠れている。', p=>{
  p.e(0,0,7,7,5); p.b(2,2,1,4,5); p.b(2,5,4,1,5); p.e(2,3,1,1,1); p.e(4,5,1,1,2);
});
add('天井へ続く戸口', 'threshold', 'rare', [11,7,12], '通常の戸口が、上へ行くほど横へ枝分かれする。', p=>{
  p.e(0,0,11,7,2); p.e(4,2,3,3,12); p.e(2,2,7,3,2,5); p.e(0,2,11,3,2,10);
});
add('巨大な括弧', 'threshold', 'rare', [13,9,10], '向き合う角括弧の間に、誰も座らない細い待合室。', p=>{
  p.e(0,0,13,9,10); p.b(3,2,1,5,10); p.b(9,2,1,5,10);
  p.b(3,2,3,1,10); p.b(3,6,3,1,10); p.b(7,2,3,1,10); p.b(7,6,3,1,10);
  p.e(3,4,1,1,1); p.e(9,4,1,1,1);
});

// 011–020: roofs — light, shadow and the profile of the excavated ceiling.
add('片側だけの屋根', 'roof', 'common', [8,7,6], '低い庇の先端を境に、天井が片側だけ消える。', p=>{
  p.e(0,0,8,7,2); p.e(0,3,8,4,6); p.e(6,0,2,7,6);
});
add('白い鋸歯', 'roof', 'common', [11,5,6], '天井の山が連なるが、最奥の山には横穴がある。', p=>{
  p.e(0,0,11,5,2); for(let x=1;x<10;x+=3){p.e(x,0,1,5,6);p.e(x+1,0,1,5,4);} p.e(8,0,3,1,6);
});
add('裏返った階段', 'roof', 'common', [8,6,8], '床は平らなのに、頭上の階段だけが降りてくる。', p=>{
  for(let x=0;x<8;x++) p.e(x,0,1,6,8-x); p.e(6,2,2,2,2);
});
add('天井の島', 'roof', 'common', [9,9,7], '低い天井の島を周回すると、中心に一筋の抜け。', p=>{
  p.e(0,0,9,9,7); p.b(2,2,5,5,5,2); p.e(4,4,1,1,7); p.e(4,2,1,2,3);
});
add('肋骨の屋根', 'roof', 'common', [11,7,7], '左右から出る肋骨が中央では触れず、白い細道を残す。', p=>{
  p.e(0,0,11,7,7); for(let x=2;x<10;x+=3){p.b(x,0,1,3,3,4);p.b(x,4,1,3,3,4);} p.b(9,3,1,1,2,5);
});
add('天井の井戸', 'roof', 'common', [7,7,11], '小さな部屋の中央から、逆向きの井戸を見上げる。', p=>{
  p.e(0,0,7,7,1); p.e(2,2,3,3,4); p.e(3,3,1,1,11); p.e(3,1,1,5,2);
});
add('折り紙の谷', 'roof', 'uncommon', [9,9,7], '中央だけ低い谷形の天井。両側の高い溝で遠近が逆転する。', p=>{
  for(let z=0;z<9;z++) p.e(0,z,9,1,2+Math.abs(z-4)); p.e(7,3,2,3,7);
});
add('空中の格子窓', 'roof', 'uncommon', [9,9,8], '天井近くの格子越しに、さらに高い空洞を見つける。', p=>{
  p.e(0,0,9,9,8); for(let a=1;a<9;a+=3){p.b(a,0,1,9,1,4);p.b(0,a,9,1,1,4);}
  p.b(1,1,1,1,4); p.b(7,7,1,1,4);
});
add('片翼のヴォールト', 'roof', 'rare', [13,7,10], '片翼だけ広がる段状の大屋根。低い端から奥へ回れる。', p=>{
  p.e(0,0,13,7,2); for(let x=0;x<11;x++) p.e(x,2,1,3,3+Math.floor(x*0.7)); p.e(10,0,3,7,10);
});
add('空白のカセット', 'roof', 'rare', [11,11,9], '四つの深い天井窪みのうち、一つだけ底が見えないほど深い。', p=>{
  p.e(0,0,11,11,2); p.e(1,1,4,4,5);p.e(6,1,4,4,7);p.e(1,6,4,4,4);p.e(6,6,4,4,9);p.e(4,4,3,3,3);
});

// 021–030: retained masses — solid silhouettes with passage-sized negative space.
add('割れた骰子', 'mass', 'common', [7,7,5], 'ずれた二つの塊の間を斜めに回り込む。', p=>{
  p.e(0,0,7,7,5);p.b(2,1,2,3,3);p.b(4,3,2,3,4);p.e(2,2,2,1,1);
});
add('石の櫛', 'mass', 'common', [9,7,5], '櫛の歯のあいだへ入ると、根元だけに横道がある。', p=>{
  p.e(0,0,9,7,5);p.b(1,5,7,1,4);for(let x=1;x<8;x+=2)p.b(x,2,1,3,4);p.e(1,4,7,1,1);
});
add('封じない封筒', 'mass', 'common', [9,7,6], '折れた封筒のような壁。中央の小さな折り目を通れる。', p=>{
  p.e(0,0,9,7,6);for(let x=1;x<8;x++)p.b(x,1+Math.min(x-1,7-x),1,1,6);p.e(4,4,1,1,1);
});
add('白いアンビル', 'mass', 'common', [9,7,5], '太い台座から左右へ張り出す天秤状の塊。裏に低い抜け道。', p=>{
  p.e(0,0,9,7,5);p.b(4,2,1,3,3);p.b(2,2,5,3,1,3);p.e(4,3,1,1,1);
});
add('立方体の骨', 'mass', 'common', [9,9,7], '箱の辺だけが残り、空っぽの内部を斜めに横切れる。', p=>{
  p.e(0,0,9,9,7);for(const x of [2,6])for(const z of [2,6])p.b(x,z,1,1,6);
  p.b(2,2,5,1,1,5);p.b(2,6,5,1,1,5);p.b(2,2,1,5,1,5);p.b(6,2,1,5,1,5);
});
add('欠けた円盤', 'mass', 'common', [9,7,7], '段状の円盤を横から見ると薄板。欠けた下端から向こうへ。', p=>{
  p.e(0,0,9,7,7);p.b(3,3,3,1,6);p.b(2,3,5,1,4,1);p.b(1,3,7,1,2,2);p.e(4,3,1,1,2);
});
add('分かれた錨', 'mass', 'uncommon', [9,9,8], '錨の縦軸が床の手前で裂け、二本の通路をつくる。', p=>{
  p.e(0,0,9,9,8);p.b(4,4,1,1,6);p.b(2,4,5,1,1,5);p.b(2,2,1,5,2);p.b(6,2,1,5,2);p.b(2,6,5,1,2);
});
add('石の糸巻き', 'mass', 'uncommon', [9,9,7], '細い芯と広い上端。芯の裏に小さな穴が貫通する。', p=>{
  p.e(0,0,9,9,7);p.b(3,3,3,3,5);p.b(1,1,7,7,1,5);p.e(3,4,3,1,1);
});
add('浮力のない船', 'mass', 'rare', [13,7,7], '船底に似た段状の巨塊。支えの間から底の影を見る。', p=>{
  p.e(0,0,13,7,7);p.b(3,3,7,1,1,2);p.b(2,2,9,3,1,3);p.b(1,1,11,5,1,4);p.b(3,3,1,1,2);p.b(9,3,1,1,2);
});
add('巨大な結び目', 'mass', 'rare', [11,11,9], '直角に折れた二本の帯が上下を入れ替える。中心を歩いてほどく。', p=>{
  p.e(0,0,11,11,9);p.b(2,2,7,1,1,5);p.b(8,2,1,7,6);p.b(2,8,7,1,1,2);p.b(2,2,1,7,3);
  p.e(2,4,1,1,1);p.e(8,6,1,1,1);p.b(5,4,1,3,2,7);
});

// 031–040: rooms — plan shape, off-axis discoveries, identifiable chambers.
add('余白のポケット', 'chamber', 'common', [5,5,3], '低い通路に一つだけ横向きの高い小室。', p=>{
  p.e(0,2,5,1,1);p.e(2,0,2,2,3);p.e(3,3,1,2,1);
});
add('壺の内側', 'chamber', 'common', [9,9,6], '狭い口から、肩だけが膨らむ壺形の部屋へ。', p=>{
  p.e(0,4,3,1,2);p.e(3,2,4,5,4);p.e(4,1,2,7,6);p.e(7,4,2,1,1);
});
add('四つ葉の空洞', 'chamber', 'common', [9,9,5], '中央から四つの膨らみへ。奥の葉だけに細い折り返し。', p=>{
  p.e(0,4,9,1,2);p.e(4,0,1,9,2);p.e(1,3,3,3,4);p.e(5,3,3,3,4);p.e(3,1,3,3,5);p.e(3,5,3,3,3);
});
add('砂時計の間', 'chamber', 'common', [11,9,6], '二つの広間の間で視界が一点へ絞られる。', p=>{
  for(let x=0;x<11;x++){const r=Math.min(4,Math.abs(x-5));p.e(x,4-r,1,r*2+1,2+Math.floor(r));}
});
add('切り取られた角', 'chamber', 'common', [8,8,5], '正方形のはずの部屋の一角が深い負の階段になる。', p=>{
  p.e(0,0,8,8,2);p.e(4,4,4,4,3);p.e(5,5,3,3,4);p.e(6,6,2,2,5);p.b(0,0,2,2,2);
});
add('細胞分裂', 'chamber', 'common', [11,7,6], '二つの袋状の部屋を細い首がつなぐ。背中に第三の小室。', p=>{
  p.e(0,1,4,5,5);p.e(4,3,3,1,1);p.e(7,0,4,7,6);p.e(5,4,1,3,2);
});
add('壁の厚さの部屋', 'chamber', 'uncommon', [9,9,5], '外壁と内壁の間を歩いたあと、中心の空白へ出る。', p=>{
  p.e(0,0,9,9,5);p.b(2,2,5,5,5);p.e(3,3,3,3,3);p.e(2,3,1,1,1);p.e(6,5,1,1,2);
});
add('望遠鏡の節', 'chamber', 'uncommon', [13,9,7], '中央軸を外れた三つの開口が、移動するほど揃っていく。', p=>{
  p.e(0,0,13,9,7);for(const [x,z] of [[3,2],[6,4],[9,6]]){p.b(x,0,1,9,7);p.e(x,z,1,1,3);}p.e(3,0,7,1,1);
});
add('空洞の中庭群', 'chamber', 'rare', [13,13,8], '四つの天井高さの違う庭を、中央の低い十字路でつなぐ。', p=>{
  p.e(0,6,13,1,1);p.e(6,0,1,13,1);p.e(1,1,5,5,8);p.e(7,1,5,5,3);p.e(1,7,5,5,5);p.e(7,7,5,5,7);
  p.e(3,5,1,3,1);p.e(9,5,1,3,1);p.e(5,3,3,1,1);p.e(5,9,3,1,1);
});
add('耳のない劇場', 'chamber', 'rare', [13,11,9], '段状に広がる扇形の空洞。舞台の裏に横長の控え室。', p=>{
  for(let x=0;x<11;x++){const r=Math.min(5,1+Math.floor(x/2));p.e(x,5-r,1,r*2+1,2+Math.floor(x/2));}
  p.e(11,5,2,1,2);p.e(12,1,1,9,3);p.e(8,3,2,5,9);
});

// 041–050: routes — walking changes the shape the player thought they saw.
add('犬走りの迷路', 'route', 'common', [9,7,3], '太い壁の背後を折れながら進み、最初の道を横から覗く。', p=>{
  p.e(0,0,9,7,3);p.b(2,0,1,5,3);p.b(5,2,1,5,3);p.e(2,1,1,1,1);p.e(5,5,1,1,1);
});
add('行き止まらないT字', 'route', 'common', [9,7,4], 'T字の突き当たりには、背後へ返る細い輪。', p=>{
  p.e(0,3,9,1,4);p.e(4,0,1,7,2);p.e(6,1,1,5,1);p.e(4,1,3,1,1);p.e(4,5,3,1,1);
});
add('ジッパーの道', 'route', 'common', [11,7,4], '左右交互の歯を抜けると、脇に一直線の帰り道。', p=>{
  p.e(0,0,11,7,4);for(let x=2;x<10;x+=2)p.b(x,x%4?1:3,1,3,4);p.b(1,0,9,1,2);
});
add('二つの長方形', 'route', 'common', [11,9,4], '大きさの違う二つの環が一点で接続する。', p=>{
  p.e(0,1,6,7,4);p.b(1,2,4,5,4);p.e(5,3,6,3,2);p.b(6,4,4,1,2);p.e(0,4,2,1,1);
});
add('白い稲妻', 'route', 'common', [11,9,6], '鋭く二度折れる空洞。折れ目から縦の光溜まりを見上げる。', p=>{
  p.e(0,1,7,2,2);p.e(5,2,2,5,4);p.e(5,6,6,2,2);p.e(5,2,2,2,6);
});
add('三叉の再会', 'route', 'common', [11,9,5], '三本に別れた道が、違う高さの天井を経て同じ場所へ。', p=>{
  p.e(0,0,2,9,5);p.e(9,0,2,9,5);p.e(2,0,7,1,1);p.e(2,4,7,1,4);p.e(2,8,7,1,2);p.e(0,3,11,3,1);
});
add('螺旋の芯', 'route', 'uncommon', [11,11,6], '角ばった渦を辿ると、中央だけ天井が抜ける。', p=>{
  p.e(0,0,11,11,2);p.b(2,2,7,1,6);p.b(8,2,1,7,6);p.b(4,8,5,1,6);p.b(4,4,1,5,6);p.e(5,4,3,4,6);p.e(0,0,11,1,6);
});
add('盲点の十字路', 'route', 'uncommon', [9,9,7], '中心の四角い岩が交差点を隠す。回ると四方向の縦穴。', p=>{
  p.e(0,3,9,3,2);p.e(3,0,3,9,2);p.b(4,4,1,1,7);for(const [x,z]of [[2,4],[6,4],[4,2],[4,6]])p.e(x,z,1,1,7);
});
add('長い寄り道', 'route', 'rare', [17,9,5], '薄い隔壁越しに近い出口が見えるが、端まで歩いて回る。', p=>{
  p.e(0,1,17,7,5);p.b(1,4,15,1,5);p.e(8,4,1,1,1,3);p.e(0,0,1,9,1);p.e(16,0,1,9,1);
});
add('網目の終点', 'route', 'rare', [13,13,6], '格子状の細い道が、突然中央の大きな一室へまとまる。', p=>{
  for(let a=0;a<13;a+=3){p.e(a,0,1,13,2);p.e(0,a,13,1,2);}p.e(4,4,5,5,6);p.e(6,3,1,7,6);
});

// 051–060: vertical negatives — monumental silhouettes contained in the bedrock.
add('細い喚声', 'vertical', 'common', [5,7,9], '小さな廊下の一端だけが、何階分も上へ伸びる。', p=>{
  p.e(0,2,5,3,1);p.e(1,2,1,3,9);p.e(1,0,1,7,2);p.e(3,4,2,2,3);
});
add('逆さの煙突', 'vertical', 'common', [7,7,10], '頭上の四角い管が途中から曲がり、底から終端が見えない。', p=>{
  p.e(0,0,7,7,2);p.e(2,2,2,2,6);p.e(2,2,4,2,2,5);p.e(4,2,2,2,5,5);
});
add('天窓の梯子', 'vertical', 'common', [7,9,8], '一列の深い窪みが徐々に高くなり、一本の空へ合流する。', p=>{
  p.e(0,0,7,9,1);for(let z=1;z<8;z+=2)p.e(2,z,3,1,z+1);p.e(3,1,1,7,1,7);
});
add('白い音叉', 'vertical', 'common', [9,7,10], '二股の縦穴。足元ではひとつ、見上げると空が分かれる。', p=>{
  p.e(0,2,9,3,2);p.e(2,2,5,3,5);p.e(2,2,1,3,10);p.e(6,2,1,3,10);
});
add('縦の瓶底', 'vertical', 'uncommon', [7,7,12], '細い首の上だけ広がる天井。真下からしか輪郭が読めない。', p=>{
  p.e(0,0,7,7,1);p.e(3,3,1,1,9);p.e(1,1,5,5,3,9);p.e(2,2,3,3,3,7);
});
add('天井の峡谷', 'vertical', 'uncommon', [13,7,11], '低い空間を横切る、刃物で切ったように長い縦の裂け目。', p=>{
  p.e(0,0,13,7,1);p.e(1,3,11,1,11);p.e(9,2,2,3,5);p.e(0,3,1,1,3);
});
add('段付きの肺', 'vertical', 'uncommon', [11,9,11], '高さのずれた二つの大空洞を、細い気管が結ぶ。', p=>{
  p.e(0,4,11,1,2);p.e(1,1,3,7,7);p.e(7,1,3,7,11);p.e(4,4,3,1,4);p.e(3,3,5,3,2,5);
});
add('上方の交差点', 'vertical', 'uncommon', [11,11,12], '床には小さな十字、遥か頭上には巨大な十字。', p=>{
  p.e(0,5,11,1,2);p.e(5,0,1,11,2);p.e(4,4,3,3,12);p.e(0,4,11,3,3,8);p.e(4,0,3,11,3,8);
});
add('切断された塔', 'vertical', 'rare', [9,9,14], '塔状の空洞が途中で横へずれ、細い接合部だけでつながる。', p=>{
  p.e(0,3,9,3,2);p.e(2,2,3,3,8);p.e(4,4,3,3,7,7);p.e(3,3,3,3,2,7);
});
add('天空の逆ピラミッド', 'vertical', 'rare', [13,13,12], '見上げるほど拡がる負のピラミッド。床の入口は極小。', p=>{
  p.e(0,6,13,1,1);p.e(6,0,1,13,1);for(let y=0;y<12;y++){const r=Math.min(6,1+Math.floor(y/2));p.e(6-r,6-r,2*r+1,2*r+1,1,y);}
});

// 061–070: inhabitable upper rooms. Stairs use the game's existing ramp collider.
add('低い展望台', 'gallery', 'uncommon', [7,7,4], '一階分だけ上がり、入ってきた横長の空間を見返す。', p=>{
  p.e(0,0,7,7,4);p.deck(2,2,3,3);p.stair(1,3,0);
});
add('橋の下の部屋', 'gallery', 'uncommon', [11,7,5], '橋を渡る道と、その下で曲がる道が同じ出口へ。', p=>{
  p.e(0,0,11,7,5);p.deck(2,3,7,1);p.stair(1,3,0);p.stair(9,3,1);p.b(5,5,2,1,3);
});
add('片持ちの客席', 'gallery', 'uncommon', [9,9,6], '側壁沿いの上段から、張り出しの先端へ出る。', p=>{
  p.e(0,0,9,9,6);p.deck(2,1,5,2);p.deck(5,3,2,3);p.stair(1,1,0);p.b(3,6,1,2,4);
});
add('上階だけの十字', 'gallery', 'uncommon', [9,9,5], '頭上の十字型の床へ登ると、四方向に違う景色。', p=>{
  p.e(0,0,9,9,5);p.deck(2,4,5,1);p.deck(4,2,1,5);p.stair(1,4,0);p.b(1,1,2,2,5);p.b(6,6,2,2,3);
});
add('棚の裏通り', 'gallery', 'uncommon', [11,7,4], '長い棚の上で曲がり、壁の裏に隠れた回廊へ。', p=>{
  p.e(0,0,11,7,4);p.deck(2,2,7,1);p.deck(8,3,1,3);p.deck(3,5,5,1);p.stair(1,2,0);p.b(5,3,1,2,4);
});
add('空中の中庭', 'gallery', 'uncommon', [11,11,6], '階上の四角い環から、空っぽの中庭を見下ろす。', p=>{
  p.e(0,0,11,11,6);p.deck(2,2,7,1);p.deck(2,8,7,1);p.deck(2,3,1,5);p.deck(8,3,1,5);p.stair(1,2,0);p.b(5,5,1,1,4);
});
add('渡らない交差橋', 'gallery', 'uncommon', [11,11,7], '歩ける橋のさらに上を、別の帯が直交して通る。', p=>{
  p.e(0,0,11,11,7);p.deck(2,5,7,1);p.stair(1,5,0);p.b(5,0,1,11,1,4);p.b(5,0,1,1,4);p.b(5,10,1,1,4);
});
add('二つの舞台', 'gallery', 'uncommon', [11,9,5], '二つの離れた上段へ別々に登り、同じ隙間を挟んで向き合う。', p=>{
  p.e(0,0,11,9,5);p.deck(2,1,3,3);p.deck(6,5,3,3);p.stair(1,2,0);p.stair(9,6,1);p.b(5,4,1,1,4);
});
add('帰り道のバルコニー', 'gallery', 'rare', [15,7,6], '奥から上がる長い上段。下から見えなかった壁の切れ目へ。', p=>{
  p.e(0,0,15,7,6);p.deck(2,2,11,1);p.stair(13,2,1);p.b(6,0,1,2,6);p.b(6,3,1,4,6);p.e(6,5,1,1,1);
});
add('階上の砂州', 'gallery', 'rare', [13,11,7], '幅が段階的に広がる上の床。細い側から登り扇の先で立つ。', p=>{
  p.e(0,0,13,11,7);p.deck(2,5,3,1);p.deck(5,4,3,3);p.deck(8,2,3,7);p.stair(1,5,0);p.b(10,5,1,1,5);
});

// 071–080: small disturbances. Subcell masses reserve clear paths around them.
add('白い句点', 'ground', 'common', [4,4,2], '小室の中心に低い一塊。回ると背後の細い天井溝。', p=>{
  p.e(0,0,4,4,1);p.e(3,0,1,4,2);p.stone(2,2,[2,3.6,2,3.6,0,0.45]);
});
add('二本の敷居', 'ground', 'common', [5,4,2], '床に短い線が二本。間隔が人ひとり分だけ空いている。', p=>{
  p.e(0,0,5,4,2);p.stone(2,1,[0.8,4.8,1,1.6,0,0.3]);p.stone(2,2,[0.8,4.8,4,4.6,0,0.3]);p.b(4,0,1,1,2);
});
add('使われない腰掛け', 'ground', 'common', [5,5,2], '座面の下が空いた巨大な腰掛け。その背後へ回れる。', p=>{
  p.e(0,0,5,5,2);p.stone(2,2,[0.6,1.3,1,4.6,0,1.1]);p.stone(2,2,[4.3,5,1,4.6,0,1.1]);p.stone(2,2,[0.6,5,1,4.6,1.1,1.5]);p.e(4,1,1,3,1);
});
add('床の引用符', 'ground', 'common', [5,4,3], '向かい合う小さなL字。その間から縦の細い凹みを発見する。', p=>{
  p.e(0,0,5,4,1);p.e(2,3,1,1,3);p.stone(1,2,[1,1.6,1,4,0,0.8]);p.stone(1,2,[1.6,3.5,1,1.6,0,0.8]);p.stone(3,2,[4,4.6,1,4,0,0.8]);p.stone(3,2,[2,4,3.4,4,0,0.8]);
});
add('低い波止場', 'ground', 'uncommon', [7,5,3], '低い棚が小さな入り江を囲う。端の切れ目から内側へ。', p=>{
  p.e(0,0,7,5,3);for(let x=2;x<5;x++)p.stone(x,2,[0,5.6,1,2,0,0.45]);p.stone(2,1,[0,1,0,5.6,0,0.45]);p.stone(4,1,[4.6,5.6,0,5.6,0,0.45]);
});
add('白い栞', 'ground', 'uncommon', [5,7,3], '薄い板が壁から少し離れて立つ。裏だけ人が通れる幅。', p=>{
  p.e(0,0,5,7,3);p.b(3,1,1,5,2);p.e(3,5,1,1,1);p.stone(1,3,[2.5,3,1,4.6,0,1.5]);
});
add('床の小さな祭壇', 'ground', 'uncommon', [5,5,4], '低い三段の中心が空洞。上方の細い穴と位置が合う。', p=>{
  p.e(0,0,5,5,1);p.e(2,2,1,1,4);p.stone(2,2,[0.5,1.3,0.5,5.1,0,0.3]);p.stone(2,2,[4.3,5.1,0.5,5.1,0,0.3]);p.stone(2,2,[1.3,4.3,4.3,5.1,0,0.6]);
});
add('印刷されない行', 'ground', 'uncommon', [9,4,2], '細長い部屋の脇に、一度だけ途切れる低い罫線。', p=>{
  p.e(0,0,9,4,2);for(const x of [1,2,3,5,6,7])p.stone(x,1,[0,5.6,1,1.5,0,0.25]);p.e(4,0,1,1,1);
});
add('白い留め金', 'ground', 'rare', [7,5,5], '小さな床の輪郭に対し、天井側だけ巨大な相似でない裂け目。', p=>{
  p.e(0,0,7,5,1);p.e(3,0,1,5,5);p.stone(3,2,[1,1.6,1,4.6,0,0.8]);p.stone(3,2,[4,4.6,1,4.6,0,0.8]);p.stone(3,2,[1.6,4,4,4.6,0,0.8]);
});
add('隅に残る階段', 'ground', 'rare', [7,7,4], '小さな段が壁を向いて止まる。裏に大きな空洞が隠れる。', p=>{
  p.e(0,0,7,7,1);p.e(4,4,3,3,4);for(let n=0;n<4;n++)p.stone(3,3,[1+n*.8,1.8+n*.8,1,3,0,(n+1)*.25]);p.b(4,3,1,1,1);
});

// 081–090: perceptual puzzles, kept architectural and entirely monochrome.
add('重ならない十字', 'paradox', 'uncommon', [11,9,8], '入口から十字に見える二枚が、歩くと大きく離れている。', p=>{
  p.e(0,0,11,9,8);p.b(3,4,1,1,7);p.b(7,1,1,7,1,4);p.b(7,1,1,1,4);p.b(7,7,1,1,4);
});
add('終わったはずの壁', 'paradox', 'uncommon', [11,7,6], '壁の向こうに同じ向きの薄い影。回ると間に細長い空間。', p=>{
  p.e(0,0,11,7,6);p.b(3,1,1,5,5);p.b(6,2,1,3,6);p.b(9,3,1,1,3);p.e(3,2,1,1,1);p.e(6,4,1,1,1);
});
add('白いパララックス', 'paradox', 'uncommon', [13,9,8], 'ずれたスリットの並びが、一箇所だけ直線の景色をつくる。', p=>{
  p.e(0,0,13,9,8);for(const [x,z]of [[3,2],[6,3],[9,4]]){p.b(x,1,1,7,8);p.e(x,z,1,2,5);}p.e(0,0,13,1,1);
});
add('遠近の拒否', 'paradox', 'uncommon', [15,9,7], '奥ほど大きくなる開口が、歩いても遠ざかるように見える。', p=>{
  p.e(0,0,15,9,7);for(const [x,r]of [[3,0],[7,1],[11,2]]){p.b(x,0,1,9,7);p.e(x,4-r,1,r*2+1,2+r*2);}
});
add('ずれた影の部屋', 'paradox', 'uncommon', [9,9,7], '床側のL字と天井側のL字が直角に食い違う。', p=>{
  p.e(0,0,9,9,7);p.b(2,2,1,5,3);p.b(2,6,4,1,3);p.b(3,2,4,1,2,5);p.b(6,2,1,5,2,5);p.e(2,4,1,1,1);
});
add('石の波形', 'paradox', 'uncommon', [13,7,8], '壁から出た段状の帯が、横から見ると一枚の薄い板。', p=>{
  p.e(0,0,13,7,8);for(let x=1;x<12;x++){const y=2+Math.abs(6-x);p.b(x,3,1,1,Math.min(2,8-y),y);}p.b(1,3,1,1,7);p.b(11,3,1,1,7);
});
add('天秤の空白', 'paradox', 'uncommon', [13,9,9], '一本の支持体を中心に、左右で異なる重さの白い張り出し。', p=>{
  p.e(0,0,13,9,9);p.b(6,4,1,1,7);p.b(1,2,5,5,1,6);p.b(7,3,4,3,3,4);p.e(8,4,2,1,1,4);
});
add('白い連続括線', 'paradox', 'uncommon', [15,9,7], '閉じて見える帯は、奥行きが変わる二箇所で途切れている。', p=>{
  p.e(0,0,15,9,7);p.b(2,2,5,1,6);p.b(2,2,1,5,6);p.b(2,6,4,1,6);p.b(8,6,5,1,6);p.b(12,2,1,5,6);p.b(9,2,4,1,6);
});
add('中心のない王冠', 'paradox', 'rare', [13,13,10], '互いに繋がらない上端だけの冠。中央に立つと何もない。', p=>{
  p.e(0,0,13,13,10);for(const [x,z,w,d]of [[3,2,7,1],[10,3,1,7],[3,10,7,1],[2,3,1,7]])p.b(x,z,w,d,2,6);
  for(const [x,z]of [[3,2],[10,3],[9,10],[2,9]])p.b(x,z,1,1,6);
});
add('裏口のモノリス', 'paradox', 'rare', [13,11,12], '正面は継ぎ目のない巨塊。背面にのみ入れる細い内部。', p=>{
  p.e(0,0,13,11,12);p.b(4,2,5,7,10);p.e(6,4,1,3,8);p.e(7,6,2,1,1);p.e(6,3,1,1,2,6);
});

// 091–100: exceptional places. Ten individually rare symbols, never a rainbow.
add('地底の大樹', 'icon', 'very_rare', [17,17,16], '岩の幹が枝へ分かれる。根の間を通ると頭上の樹冠が開く。', p=>{
  p.e(0,0,17,17,16);p.b(7,7,3,3,13);p.e(7,8,3,1,2);p.b(3,7,11,3,2,9);p.b(7,3,3,11,2,12);p.b(3,3,11,11,2,14);
});
add('無人の大聖門', 'icon', 'very_rare', [19,11,18], '三段の巨大な開口が一つの刃のような頂へ収束する。', p=>{
  p.e(0,0,19,11,18);p.b(8,0,3,11,18);p.e(8,2,3,7,5);p.e(8,3,3,5,5,5);p.e(8,4,3,3,5,10);p.e(8,5,3,1,2,15);p.deck(12,2,4,2);p.stair(11,2,0);
});
add('白い大陸の裏側', 'icon', 'very_rare', [19,17,12], '巨大な天井大陸の海岸を歩き、半島の下に隠れた一室へ。', p=>{
  p.e(0,0,19,17,12);p.b(3,3,10,10,7,5);p.b(13,6,4,4,7,5);p.b(5,1,3,2,7,5);p.b(7,13,3,3,7,5);p.b(5,5,2,2,5);p.e(5,5,2,1,2);
});
add('都市の断面', 'icon', 'very_rare', [19,13,14], '異なる断面の塔が壁から立ち上がる。足元には裏通り。', p=>{
  p.e(0,0,19,13,14);p.b(2,5,2,6,7);p.b(6,4,3,7,11);p.b(11,6,2,5,5);p.b(15,3,2,8,13);p.e(0,9,19,1,2);p.e(7,4,1,7,1,7);p.deck(3,1,12,1);p.stair(2,1,0);
});
add('白い砂丘の負像', 'icon', 'very_rare', [19,15,13], '二つの段状の空洞の山。谷底の低い道から両方を見上げる。', p=>{
  p.e(0,0,19,15,1);for(let x=0;x<19;x++)for(let z=0;z<15;z++){const h=Math.max(1,12-Math.abs(x-5)-Math.abs(z-5),13-Math.abs(x-14)-Math.abs(z-9));p.e(x,z,1,1,h);}
});
add('巨大な白紙の本', 'icon', 'very_rare', [17,13,12], '開いた本のような二つの岩壁。背表紙の根元に抜け道。', p=>{
  p.e(0,0,17,13,12);for(let x=2;x<15;x++)p.b(x,3+Math.floor(Math.abs(x-8)/2),1,1,10);p.e(8,3,1,1,2);p.b(8,4,1,5,1,9);p.deck(3,9,11,1);p.stair(2,9,0);
});
add('不在の球体', 'icon', 'very_rare', [17,17,16], '岩盤から球を抜いたような段状の大空洞。赤道の下を横断する。', p=>{
  for(let y=0;y<16;y++)for(let z=0;z<17;z++)for(let x=0;x<17;x++)if((x-8)**2+(z-8)**2+(y-7.5)**2<72)p.e(x,z,1,1,1,y);
  p.e(0,8,17,1,2);p.e(7,7,3,3,8);
});
add('空間の背骨', 'icon', 'very_rare', [19,9,17], '長い大空洞の頭上を、巨大な椎骨が貫く。下に小さな上段。', p=>{
  p.e(0,0,19,9,17);p.b(0,4,19,1,2,12);for(const x of [3,7,11,15]){p.b(x,1,1,7,2,10);p.b(x,1,1,1,10);p.b(x,7,1,1,10);}p.deck(3,3,4,1);p.stair(2,3,0);
});
add('世界の縫い目', 'icon', 'very_rare', [19,7,18], '二つの白い面の間を上下に蛇行する、途方もなく高い裂け目。', p=>{
  p.e(0,0,19,7,1);for(let y=0;y<18;y++){const z=2+Math.floor(y/3)%3;p.e(0,z,19,2,1,y);if(y%3===0&&y>0)p.e(0,2,19,4,1,y);}p.e(9,1,1,5,18);
});
add('最後ではない部屋', 'icon', 'very_rare', [19,19,18], '巨大な空白の中央に小さな部屋。入ると、その天井に別の巨大空間。', p=>{
  p.e(0,0,19,19,18);p.b(7,7,5,5,4);p.e(8,8,3,3,2);p.e(7,9,1,1,1);p.e(11,9,1,1,1);p.e(9,9,1,1,4);p.b(3,3,13,1,2,12);p.b(3,15,13,1,2,12);p.b(3,4,1,11,2,12);p.b(15,4,1,11,2,12);
  for(const x of [3,15])for(const z of [3,15])p.b(x,z,1,1,4,14);
});

export const LANDMARK_CATALOG = Object.freeze(entries);
export const CATALOG_BY_ID = new Map(entries.map(e=>[e.id,e]));
const totalWeight = entries.reduce((s,e)=>s+RARITY_WEIGHT[e.rarity],0);
export function selectLandmark(unit) {
  let t = unit * totalWeight;
  for (const e of entries) { t -= RARITY_WEIGHT[e.rarity]; if (t < 0) return e; }
  return entries[entries.length-1];
}

/** Compile exactly one recipe into bounded, chunk-independent cell data. */
export function compileLandmark(entry) {
  const [W,D,H] = entry.size;
  const air = new Uint8Array(W*D*H), steps = new Map(), detail = new Map();
  const index = (x,y,z)=>(y*D+z)*W+x;
  const inside = (x,y,z)=>x>=0&&x<W&&z>=0&&z<D&&y>=0&&y<H;
  const has = (x,y,z)=>inside(x,y,z)&&air[index(x,y,z)]===1;
  const box = (value,x,z,w,d,h,y=0)=>{
    if (![x,z,w,d,h,y].every(Number.isInteger)||x<0||z<0||y<0||x+w>W||z+d>D||y+h>H||Math.min(w,d,h)<1)
      throw new Error(`${entry.id}: out-of-bounds box ${[x,z,w,d,h,y]}`);
    for(let a=x;a<x+w;a++)for(let b=z;b<z+d;b++)for(let c=y;c<y+h;c++)air[index(a,c,b)]=value;
  };
  const p = {
    e:(...args)=>box(1,...args), b:(...args)=>box(0,...args),
    // A deck is the slab between two separately excavated rooms, never a solid box collider.
    deck(x,z,w,d){
      for(let a=x;a<x+w;a++)for(let b=z;b<z+d;b++)steps.set(`deck:${a}:${b}`,true);
      // The slab has actual slender supports, with 2.45m clear space on either side.
      // Corner posts terminate against its underside; they never obstruct the upper landing.
      for(const a of new Set([x,x+w-1]))for(const b of new Set([z,z+d-1])){
        const k=index(a,0,b);if(!detail.has(k))detail.set(k,[]);
        if(!detail.get(k).some(s=>s.deckPost))detail.get(k).push({x0:2.45,x1:3.15,z0:2.45,z1:3.15,y0:0,y1:CEIL_STD,bot:false,top:false,deckPost:true});
      }
    },
    stair(x,z,dir){ steps.set(index(x,0,z),dir);box(1,x,z,1,1,2); },
    stone(x,z,s){ const k=index(x,0,z);if(!detail.has(k))detail.set(k,[]);detail.get(k).push({x0:s[0],x1:s[1],z0:s[2],z1:s[3],y0:s[4],y1:s[5],bot:s[4]>0,top:true}); },
  };
  entry.build(p);
  // Reject sealed air pockets rather than silently replacing an authored design.
  const candidates=[];
  for(let z=0;z<D;z++)for(let x=0;x<W;x++)if(has(x,0,z))candidates.push([x,0,z]);
  if(!candidates.length)throw new Error(`${entry.id}: no ground entrance`);
  const seen=new Set(), q=[candidates[0]];
  seen.add(index(...q[0]));
  for(let n=0;n<q.length;n++){
    const [x,y,z]=q[n];
    for(const [dx,dy,dz]of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
      const a=x+dx,b=y+dy,c=z+dz,k=index(a,b,c);
      if(has(a,b,c)&&!seen.has(k)){seen.add(k);q.push([a,b,c]);}
    }
  }
  for(let k=0;k<air.length;k++)if(air[k]&&!seen.has(k))throw new Error(`${entry.id}: sealed air pocket at ${k}`);
  const ground=[];
  for(let z=0;z<D;z++)for(let x=0;x<W;x++)if(has(x,0,z))ground.push([x,z]);
  // Choose two distinct boundary gates from opposite ends of the walkable ground plan.
  const edge=[];
  for(const [x,z]of ground){let dir=x===0?1:x===W-1?0:z===0?5:z===D-1?4:-1;if(dir>=0)edge.push({ix:x,iy:0,iz:z,dir});}
  if(edge.length<2)throw new Error(`${entry.id}: needs two boundary gates`);
  // Prefer mid-edge views, not a corner looking along the outer wall.
  edge.sort((a,b)=>Math.abs(a.iz-(D-1)/2)-Math.abs(b.iz-(D-1)/2)||a.ix-b.ix);
  const first=edge[0];
  edge.sort((a,b)=>(Math.abs(b.ix-first.ix)+Math.abs(b.iz-first.iz))-(Math.abs(a.ix-first.ix)+Math.abs(a.iz-first.iz)));
  const gates=[first,edge[0]];
  const cells=new Array(air.length);
  for(let y=0;y<H;y++)for(let z=0;z<D;z++)for(let x=0;x<W;x++){
    const k=index(x,y,z);
    if(!has(x,y,z)){cells[k]={rock:true};continue;}
    const st=steps.get(k), below=y===1?steps.get(index(x,0,z)):undefined;
    let hlink=0;
    for(const d of [0,1,4,5]){
      const nx=x+DX[d],nz=z+DZ[d];if(!has(nx,y,nz))continue;
      const ns=steps.get(index(nx,y,nz)), nb=y===1?steps.get(index(nx,0,nz)):undefined;
      if((typeof st==='number'&&d===st)||(typeof below==='number'&&d===OPP[below])||
         (typeof ns==='number'&&OPP[d]===ns)||(typeof nb==='number'&&OPP[d]===OPP[nb]))continue;
      hlink|=1<<d;
    }
    const deck=y===0&&steps.has(`deck:${x}:${z}`);
    cells[k]={rock:false,full:true,ceil:CEIL_STD,hlink,parapet:0,solids:detail.get(k)||[],
      up:typeof st==='number'?{kind:'stair',dir:st}:has(x,y+1,z)&&!deck?{kind:'open'}:null};
  }
  return {cells,gates,W,D,H,index};
}
