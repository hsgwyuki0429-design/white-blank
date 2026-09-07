import { mkdir, writeFile } from 'node:fs/promises';
import { LANDMARK_CATALOG, RARITY_WEIGHT } from '../src/landmark-catalog.js';
import { CELL,LEVEL } from '../src/dims.js';
const categories={threshold:'門と開口',roof:'天井',mass:'残された岩',chamber:'部屋の輪郭',route:'経路',vertical:'縦の空洞',gallery:'登れる回廊',ground:'足元の違和感',paradox:'視点の錯覚',icon:'象徴的巨大空間'};
const counts={};for(const e of LANDMARK_CATALOG)counts[e.rarity]=(counts[e.rarity]||0)+1;
const total=LANDMARK_CATALOG.reduce((n,e)=>n+RARITY_WEIGHT[e.rarity],0);
const header=`# White Blank — 100の新しい探索空間

## 調査と設計判断

基準コミット: 0f4fda4。既存は約5種類ではなく6種類:
cathedral / compression / stairs / stacked / nested / descent。
6種類のレシピ、種から決まる座標、寸法、出入口を保持した。

このゲームは岩盤を箱の合併で彫り、露出面を描画・衝突の双方に使う地下迷宮。
5.6mの水平セル、2.7mの階層、6×4×6セルのチャンクを使う。
素材モデル、色分け、単純なサイズ違いではなく、100個の個別の空洞構成を実装した。
形は固定し、出現場所をseedで変える。色は既存の白い共有マテリアルと陰影を継承。

入口からの輪郭 → 遮蔽を回る → 内部の抜け・別の天井・上段を発見する、という順序を重視。
地下なので遠方の発見は、地上のスカイラインではなく廊下や開口越しの見通しになる。
100種類すべてに歩いて入れる空間と異なる2つの出入口を設け、14種類に計16本の登れる階段を設けた。
極小の床の塊も、周囲の天井や小室との関係で意味を持たせた。

## カテゴリとrarity

10カテゴリ各10種類。rarityはカテゴリと独立。

| rarity | 種類数 | 1種類の重み | 新規出現内での割合 |
|---|---:|---:|---:|
${Object.entries(counts).map(([r,n])=>`| ${r} | ${n} | ${RARITY_WEIGHT[r]} | ${(100*n*RARITY_WEIGHT[r]/total).toFixed(2)}% |`).join('\n')}

commonの1種類はvery_rareの1種類の80倍の重み。巨大な象徴10種類を合わせても新規出現の約0.23%。
これは歩行時間の確率ではなく、生成候補が新規ランドマークに決まった場合の条件付き割合。

## 生成・境界・衝突

- 24×24セルの粗い格子で周辺8区画に勝った候補だけ採用。既存のscoreと採用域0–57を保持。
- 以前空だった58–85を新規用に使用し、86–99は引き続き空白。候補密度は旧比約1.48倍。
- 新規の選択には独立saltの座標hashを使用。Math.randomは追加していない。
- 最大19×19セル。粗い区画内の2セルの余白に必ず収まり、隣接区画の同時採用も禁止。
- 複数チャンクをまたぐ形は、全体レシピの同じセルデータを参照する。チャンクごとに別の抽選をしない。
- ランドマークの岩・空洞・出入口が通常迷路より優先。裂け目の橋判定もランドマーク領域では無効化。
- 巨大なBox colliderは使用しない。既存mesherが空洞の露出面だけを衝突三角形に変換。
- 上段は既存の厚みを持つ床スラブ。階段は描画上の段と、既存の滑らかな坂の衝突を使用。
- 全ground経路、出入口往復、階上からの帰還、浮いた岩塊の不在を検証。
- セルキャッシュのキーにseedを追加。複数の世界を交互に照会しても混線しない。

## 描画と負荷

- 100種類分のmeshを常駐させない。必要なレシピをコンパイルし、直近8種類のセルデータのみ保持。
- 通常時は既存の45チャンク。新規ランドマークの近くでは、その1空間の範囲だけ追加。
- 全体が読み込まれた後に霧の距離を35–100mへ拡張し、巨大な輪郭を消さない。
- 追加チャンクも既存キュー、frustum culling、共有material、geometry.dispose、衝突登録解除を使用。
- 通常更新の生成キューは最大2チャンクかつ6msの開始予算。単一チャンク生成の途中では中断しない。
- 遠ざかったキューのIDも解除する修正を加え、戻っても再要求できない不具合を解消。
- 遠方に追加したチャンクは陰影の面分割を2倍の間隔にするLODを使い、近づくと通常精度へ戻す。衝突三角形と面の境界は両LODで完全に同じ。
- 個別meshを100個ロードする方式ではないため、モデル用Instancingは追加していない。
- スマートフォン実機のFPS保証は行っていない。数値とブラウザ試験は検証環境での結果。

## 再現と検証

既存の静的サーバで動作。\`npm run build\` は構文・全100レシピを検査し、\`dist/\` に配布ファイルとSHA256一覧を出力する。
\`npm test\`、\`npm run test:landmarks\`、\`npm run test:geometry\`、\`npm run test:browser\`。
\`node tools/legacy-landmarks.mjs\` は基準コミットの実コードと6seedの既存形状を比較。
ブラウザ試験にはPlaywrightのChromium、または環境変数\`WB_CHROME\`で指定したChromeを使う。

開発用: \`?landmark=LM_001\` から \`?landmark=LM_100\`。
まれなIDは広い範囲を検索するので時間がかかる。見つからなければ別IDへ置き換えずnullを返す。
確実な検証seedは数値12345。コンソールで\`__wb.setup(12345); __wb.jump('LM_100')\`。
seed12345・粗い格子半径480の自然生成走査では全100種類を確認している。

## 個別設計一覧

寸法は占有領域の幅×奥行×高さ（m）。セル最上部の床厚により実際の天井は最大0.28m低い。

| ID | 名称 | カテゴリ | rarity | 占有寸法m | 近づいてからの発見 |
|---|---|---|---|---|---|
`;
const rows=LANDMARK_CATALOG.map(e=>`| ${e.id} | ${e.name} | ${categories[e.category]} | ${e.rarity} | ${[e.size[0]*CELL,e.size[1]*CELL,e.size[2]*LEVEL].map(n=>n.toFixed(1)).join(' × ')} | ${e.discovery} |`).join('\n');
await mkdir('docs',{recursive:true});await writeFile('docs/landmarks-100.md',header+rows+'\n');
console.log('Wrote docs/landmarks-100.md');
