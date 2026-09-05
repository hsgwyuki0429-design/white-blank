// 白い地下迷宮。
//
// やることはひとつ。歩いて、扉を見つけること。
// 世界は無限で、どこまで行っても続いている。引き返せば、来た道がそのままある。

import * as THREE from 'three';
import { World, CW, CY, CD, CELL, LEVEL, fdiv, isLowCeil, inVoid as isVoidAt,
         aperture as apertureAt, DX, DZ, V_STAIR } from './world.js';
import { buildChunk } from './mesher.js';
import { Colliders, step as physStep, EYE } from './physics.js';
import { Sound } from './audio.js';
import { hash32, hashUnit, seedFromString, seedName } from './rng.js';

const RENDER_R = 1;              // 読み込むチャンクの半径（水平）
const RENDER_RY = 2;             // 縦は広く。吹き抜けは見上げるためにある
const FOG_NEAR = 3.0, FOG_FAR = 26.0;
const WALK = 2.55, RUN = 4.15, ACCEL = 14, AIR_ACCEL = 2.2;
const JUMP = 5.0;
const REACH = 2.6;               // 印を刻める距離

const $ = (id) => document.getElementById(id);

// ── 壁に刻まれる字形 ─────────────────────────────────────
// 誰が刻んだのかは、わからない。
function glyphAtlas() {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S * 4;
  const g = cv.getContext('2d');
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let k = 0; k < 16; k++) {
    const ox = (k % 4) * S, oy = ((k >> 2) & 3) * S;
    g.save(); g.translate(ox + S / 2, oy + S / 2);
    g.strokeStyle = '#000'; g.fillStyle = '#000';
    g.lineWidth = 7 + (k % 3) * 2;
    const r = S * 0.3;
    g.beginPath();
    switch (k % 8) {
      case 0: g.moveTo(-r, -r); g.lineTo(r, r); g.moveTo(r, -r); g.lineTo(-r, r); break;
      case 1: g.moveTo(0, -r); g.lineTo(0, r); g.moveTo(-r * .6, -r * .2); g.lineTo(r * .6, -r * .2); break;
      case 2: g.arc(0, 0, r * .85, 0.4, Math.PI * 1.6); break;
      case 3: g.moveTo(-r, r); g.lineTo(0, -r); g.lineTo(r, r); break;
      case 4: g.moveTo(-r, -r * .5); g.lineTo(r, -r * .5); g.moveTo(-r * .7, r * .5); g.lineTo(r * .7, r * .5); break;
      case 5: g.moveTo(-r * .8, -r); g.lineTo(r * .3, 0); g.lineTo(-r * .8, r); break;
      case 6: g.arc(0, r * .3, r * .8, Math.PI, 0); g.moveTo(0, r * .3); g.lineTo(0, r); break;
      case 7: g.moveTo(-r, 0); g.lineTo(r, 0); g.moveTo(r * .4, -r * .5); g.lineTo(r, 0); g.lineTo(r * .4, r * .5); break;
    }
    g.stroke();
    if (k >= 8) { g.beginPath(); g.arc(0, -r * 1.15, 5, 0, 7); g.fill(); }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ── 壁の肌 ───────────────────────────────────────────────
// 白いだけの面は、大きさも距離もわからない。
// 板の継ぎ目と、ごくわずかなざらつきだけを与える。それ以上は要らない。
function panelTexture() {
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  // 縁取りはしない。境目は陰影と厚みだけで読ませる。
  // 残すのは、白が「面」ではなく「物」に見えるだけの、ごくわずかな地肌。
  const im = g.getImageData(0, 0, S, S), d = im.data;
  for (let i = 0; i < S * S; i++) {
    const n = (Math.random() - 0.5) * 9;
    d[i * 4] += n; d[i * 4 + 1] += n; d[i * 4 + 2] += n;
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ── 描画の下ごしらえ ─────────────────────────────────────
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xf2f2f0);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xf2f2f0, FOG_NEAR, FOG_FAR);

const camera = new THREE.PerspectiveCamera(74, 1, 0.06, 120);
const head = new THREE.Object3D();       // 位置と向き。カメラはこの中で揺れる
head.add(camera);
scene.add(head);

// 光源はどこにもない。それでも形が読めるように、方向のある淡い光を足してある。
// 物理的には嘘だが、この嘘がないと白い箱はただの白い面になってしまう。
scene.add(new THREE.AmbientLight(0xffffff, 0.33));
scene.add(new THREE.HemisphereLight(0xffffff, 0xb6bcc4, 0.58));   // 床は明るく、天井は沈む
const key = new THREE.DirectionalLight(0xffffff, 0.22);
key.position.set(0.62, 0.55, 0.56);
scene.add(key);
const fill = new THREE.DirectionalLight(0xeaf0f6, 0.12);
fill.position.set(-0.6, 0.25, -0.8);
scene.add(fill);
// 持ち歩く明かり。姿は見えないが、手元だけは白く浮かぶ
const lamp = new THREE.PointLight(0xfff7ee, 0.42, 11, 1.0);
lamp.position.set(0, 0.20, 0.35);
camera.add(lamp);

const panelTex = panelTexture();
panelTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const wallMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, map: panelTex });
const markTex = glyphAtlas();
const markMat = new THREE.MeshBasicMaterial({
  map: markTex, transparent: true, opacity: 0.42, color: 0x3a3a3a,
  depthWrite: false, side: THREE.DoubleSide,
});
const myMarkMat = new THREE.MeshBasicMaterial({
  map: markTex, transparent: true, opacity: 0.72, color: 0x1f4a63,
  depthWrite: false, side: THREE.DoubleSide,
});

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ── 世界の読み込みと解放 ─────────────────────────────────
let world = null;
const col = new Colliders();
const loaded = new Map();          // key → { mesh, marks }
const meshList = [];               // 視線判定用
let queue = [];
const queued = new Set();

function disposeChunk(key) {
  const e = loaded.get(key);
  if (!e) return;
  scene.remove(e.mesh); e.mesh.geometry.dispose();
  const i = meshList.indexOf(e.mesh); if (i >= 0) meshList.splice(i, 1);
  if (e.marks) { scene.remove(e.marks); e.marks.geometry.dispose(); }
  loaded.delete(key); col.delete(key);
}

function wantChunks(px, py, pz) {
  const kx = fdiv(Math.floor(px / CELL), CW);
  const ky = fdiv(Math.floor(py / LEVEL), CY);
  const kz = fdiv(Math.floor(pz / CELL), CD);
  const want = new Set();
  for (let dy = -RENDER_RY; dy <= RENDER_RY; dy++)
    for (let dz = -RENDER_R; dz <= RENDER_R; dz++)
      for (let dx = -RENDER_R; dx <= RENDER_R; dx++) {
        const k = (kx + dx) + ',' + (ky + dy) + ',' + (kz + dz);
        want.add(k);
        if (!loaded.has(k) && !queued.has(k)) {
          queued.add(k);
          queue.push({ k, x: kx + dx, y: ky + dy, z: kz + dz, d: dx * dx + dy * dy * 2 + dz * dz });
        }
      }
  for (const k of [...loaded.keys()]) if (!want.has(k)) disposeChunk(k);
  queue = queue.filter((q) => want.has(q.k));
  queue.sort((a, b) => a.d - b.d);
  return want;
}

function buildAt(kx, ky, kz) {
  const k = kx + ',' + ky + ',' + kz;
  if (loaded.has(k)) return;
  const built = buildChunk(world, kx, ky, kz);
  const mesh = new THREE.Mesh(built.geom, wallMat);
  mesh.matrixAutoUpdate = false;
  scene.add(mesh); meshList.push(mesh);
  let marks = null;
  if (built.marks) {
    marks = new THREE.Mesh(built.marks, markMat);
    marks.matrixAutoUpdate = false; marks.renderOrder = 1;
    scene.add(marks);
  }
  loaded.set(k, { mesh, marks });
  col.set(k, built);
  queued.delete(k);
}

/** 1フレームにいくつかだけ組み立てる。全部いっぺんに作ると画面が固まる。 */
function flushQueue(budget) {
  let n = 0;
  while (queue.length && n < budget) {
    const q = queue.shift(); queued.delete(q.k);
    if (loaded.has(q.k)) continue;
    buildAt(q.x, q.y, q.z);
    n++;
  }
  return queue.length;
}

/**
 * 足の下だけは、待たせずに用意する。
 * 落ちている最中に床が間に合わないと、そのまま世界の外まで抜けてしまう。
 */
function ensureAround(x, y, z) {
  const kx = fdiv(Math.floor(x / CELL), CW), kz = fdiv(Math.floor(z / CELL), CD);
  // 読み込む半径からはみ出す所は作らない。作った端から捨てることになる
  for (const dy of [0, -1, 1, -2]) {
    const ky = fdiv(Math.floor(y / LEVEL) + dy * CY, CY);
    for (const dx of [0, -1, 1]) for (const dz of [0, -1, 1]) {
      if (dy !== 0 && (dx || dz)) continue;
      buildAt(kx + dx, ky, kz + dz);
    }
  }
}

function clearWorld() {
  for (const k of [...loaded.keys()]) disposeChunk(k);
  queue = []; queued.clear(); col.clear();
  if (doorGroup) { scene.remove(doorGroup); doorGroup = null; }
  if (myMarkMesh) { scene.remove(myMarkMesh); myMarkMesh.geometry.dispose(); myMarkMesh = null; }
}

// ── 扉 ───────────────────────────────────────────────────
// 無限の世界に、たったひとつ。
let goal = null, doorGroup = null, doorPos = new THREE.Vector3();

function findGoal(w) {
  const s = w.seed;
  const ang = hashUnit(s, 0x4444) * Math.PI * 2;
  const dist = 44 + hashUnit(s, 0x4445) * 38;
  const cx0 = Math.round(Math.cos(ang) * dist);
  const cz0 = Math.round(Math.sin(ang) * dist);
  const cy0 = -Math.round(hashUnit(s, 0x4446) * 7);
  for (let r = 0; r < 18; r++) {
    for (let dy = 0; dy <= 3; dy++) for (const sy of dy ? [dy, -dy] : [0]) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx0 + dx, y = cy0 + sy, z = cz0 + dz;
        if (!w.open(x, y, z)) continue;
        const lb = w.linkBits(x, y, z);
        if ((lb & 4) && w.vfeat(x, y, z).kind === V_STAIR) continue;
        if (isLowCeil(s, x, y, z) || !w.hasFloor(x, y, z)) continue;
        for (const d of [0, 1, 4, 5]) if (!(lb & (1 << d))) return { x, y, z, dir: d };
      }
    }
  }
  return { x: cx0, y: cy0, z: cz0, dir: 0 };
}

const FACE_N = { 0: [-1, 0, 0], 1: [1, 0, 0], 4: [0, 0, -1], 5: [0, 0, 1] };

function buildDoor(g) {
  const n = FACE_N[g.dir];
  const cx = (g.x + 0.5) * CELL, cz = (g.z + 0.5) * CELL;
  const px = g.dir === 0 ? (g.x + 1) * CELL : g.dir === 1 ? g.x * CELL : cx;
  const pz = g.dir === 4 ? (g.z + 1) * CELL : g.dir === 5 ? g.z * CELL : cz;
  const py = g.y * LEVEL + 1.06;
  doorPos.set(px + n[0] * 0.4, py, pz + n[2] * 0.4);

  const grp = new THREE.Group();
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(1.62, 2.18),
    new THREE.MeshBasicMaterial({ color: 0xbdbdb9 }));
  const hole = new THREE.Mesh(
    new THREE.PlaneGeometry(1.34, 1.94),
    new THREE.MeshBasicMaterial({ color: 0x08080a, fog: false }));
  frame.position.set(px + n[0] * 0.014, py, pz + n[2] * 0.014);
  hole.position.set(px + n[0] * 0.026, py, pz + n[2] * 0.026);
  for (const m of [frame, hole]) {
    m.lookAt(m.position.x + n[0], m.position.y, m.position.z + n[2]);
    grp.add(m);
  }
  grp.renderOrder = 2;
  scene.add(grp);
  doorGroup = grp;
}

// ── 自分で刻む印 ─────────────────────────────────────────
let myMarks = new Map(), myMarkMesh = null;
const markKey = (p) => [Math.round(p.x * 4), Math.round(p.y * 4), Math.round(p.z * 4)].join(',');

function loadMyMarks(seed) {
  myMarks = new Map();
  try {
    const raw = localStorage.getItem('wb:marks:' + seed);
    if (raw) for (const m of JSON.parse(raw)) myMarks.set(m.k, m);
  } catch (e) { /* 記憶できない環境でも遊べる */ }
}
function saveMyMarks(seed) {
  try { localStorage.setItem('wb:marks:' + seed, JSON.stringify([...myMarks.values()])); }
  catch (e) { /* 容量切れなら諦める */ }
}

function rebuildMyMarks() {
  if (myMarkMesh) { scene.remove(myMarkMesh); myMarkMesh.geometry.dispose(); myMarkMesh = null; }
  if (!myMarks.size) return;
  const pos = [], uv = [], W = 0.24;
  for (const m of myMarks.values()) {
    const n = new THREE.Vector3(m.nx, m.ny, m.nz);
    const up = Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const rt = new THREE.Vector3().crossVectors(up, n).normalize().multiplyScalar(W);
    const u2 = new THREE.Vector3().crossVectors(n, rt).normalize().multiplyScalar(W);
    const p = new THREE.Vector3(m.x, m.y, m.z);
    const c = [
      p.clone().sub(rt).sub(u2), p.clone().add(rt).sub(u2),
      p.clone().add(rt).add(u2), p.clone().sub(rt).add(u2)];
    const g = m.g & 15, u0 = (g % 4) / 4, v0 = ((g >> 2) & 3) / 4, s = 0.25;
    const order = [0, 1, 2, 0, 2, 3];
    const uvs = [[u0, v0], [u0 + s, v0], [u0 + s, v0 + s], [u0, v0], [u0 + s, v0 + s], [u0, v0 + s]];
    order.forEach((i, k) => { pos.push(c[i].x, c[i].y, c[i].z); uv.push(uvs[k][0], uvs[k][1]); });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  myMarkMesh = new THREE.Mesh(geo, myMarkMat);
  myMarkMesh.renderOrder = 2;
  scene.add(myMarkMesh);
}

const ray = new THREE.Raycaster();
ray.far = REACH;

/** 見ている壁に印を刻む。すでに自分の印があれば消す。 */
function toggleMark() {
  ray.setFromCamera({ x: 0, y: 0 }, camera);
  const hits = ray.intersectObjects(meshList, false);
  if (!hits.length) return null;
  const h = hits[0];
  const p = h.point.clone();
  for (const [k, m] of myMarks) {
    if (Math.hypot(m.x - p.x, m.y - p.y, m.z - p.z) < 0.34) {
      myMarks.delete(k); rebuildMyMarks(); saveMyMarks(world.seed);
      return 'erase';
    }
  }
  if (myMarks.size >= 400) return null;
  const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
  p.addScaledVector(n, 0.014);
  const k = markKey(p);
  myMarks.set(k, { k, x: p.x, y: p.y, z: p.z, nx: n.x, ny: n.y, nz: n.z, g: 8 + (myMarks.size % 8) });
  rebuildMyMarks(); saveMyMarks(world.seed);
  return 'draw';
}

// ── 体と操作 ─────────────────────────────────────────────
const body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: false, gnx: 0, gny: 0, gnz: 0, impact: 0 };
const keys = new Set();
let yaw = 0, pitch = 0, bob = 0, dip = 0, sway = 0;
let running = false, playing = false, walkedTotal = 0, openSm = 0.3;
const sound = new Sound();

function findSpawn(w) {
  for (let r = 0; r < 26; r++)
    for (let dy = 0; dy <= 3; dy++) for (const sy of dy ? [dy, -dy] : [0])
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (!w.open(dx, sy, dz)) continue;
        const lb = w.linkBits(dx, sy, dz);
        if (lb & 8) continue;                                       // 床が抜けている所は避ける
        if (isLowCeil(w.seed, dx, sy, dz)) continue;
        if ((lb & 4) && w.vfeat(dx, sy, dz).kind === V_STAIR) continue;
        return { x: dx, y: sy, z: dz };
      }
  return { x: 0, y: 0, z: 0 };
}

addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (keys.has(e.code)) return;
  keys.add(e.code);
  if (!playing) return;
  if (e.code === 'KeyE') {
    const r = toggleMark();
    if (r) { sound.scratch(r === 'draw'); toast(r === 'draw' ? '刻んだ' : '消した'); }
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  const s = 0.0022;
  yaw -= e.movementX * s;
  pitch -= e.movementY * s;
  pitch = Math.max(-1.52, Math.min(1.52, pitch));
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && playing) pause();
});

let toastT = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show'); toastT = 1.6;
}

// ── 一巡 ─────────────────────────────────────────────────
let last = performance.now(), hudT = 0, forgetT = 12, cleared = false;
const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!world) return;

  if (playing) {
    update(dt);
  } else {
    flushQueue(1);
  }
  renderer.render(scene, camera);
}

function update(dt) {
  // 向き
  head.rotation.set(0, yaw, 0);
  camera.rotation.set(pitch, 0, 0);

  // 進みたい方向
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  running = keys.has('ShiftLeft') || keys.has('ShiftRight');
  let wx = 0, wz = 0;
  if (f || r) {
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    let dx = -sy * f + cy * r, dz = -cy * f - sy * r;
    const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    const sp = running ? RUN : WALK;
    wx = dx * sp; wz = dz * sp;
  }

  const g = body.grounded;
  const a = 1 - Math.exp(-(g ? ACCEL : AIR_ACCEL) * dt);
  body.vx += (wx - body.vx) * a;
  body.vz += (wz - body.vz) * a;

  if (g) {
    // 坂に沿って上下する。そうしないと登りで壁を押しているだけになる
    if (body.gny > 0.02) {
      body.vy = -(body.vx * body.gnx + body.vz * body.gnz) / body.gny - 0.5;
    }
    if (keys.has('Space')) { body.vy = JUMP; body.grounded = false; }
  }

  const px = body.x, py = body.y, pz = body.z;
  ensureAround(body.x, body.y, body.z);
  physStep(body, col, dt);
  const moved = Math.hypot(body.x - px, body.z - pz);
  walkedTotal += moved;

  if (body.impact > 6) { dip += Math.min(0.30, body.impact / 42); sound.land(body.impact); }
  dip *= Math.exp(-9 * dt);

  // 頭の揺れ。歩幅にあわせて
  if (body.grounded) {
    bob += (moved / (running ? 0.92 : 0.78)) * Math.PI;
    sway += (1 - sway) * Math.min(1, dt * 6);
  } else sway += (0 - sway) * Math.min(1, dt * 3);
  camera.position.set(Math.sin(bob) * 0.017 * sway, Math.sin(bob * 2) * 0.024 * sway - dip, 0);
  camera.rotation.z = Math.sin(bob) * 0.0075 * sway;

  head.position.set(body.x, body.y + EYE, body.z);

  // 世界の出し入れ
  wantChunks(body.x, body.y, body.z);
  flushQueue(2);

  // 音
  const cx = Math.floor(body.x / CELL), cz = Math.floor(body.z / CELL);
  const cy = Math.floor((body.y + 0.35) / LEVEL);   // 足元は床のわずか下にある
  let bits = 0;
  try { bits = world.linkBits(cx, cy, cz); } catch (e) { bits = 0; }
  let cnt = 0; for (let i = 0; i < 6; i++) if (bits & (1 << i)) cnt++;
  const openTarget = Math.min(1, cnt / 4.2 + ((bits & 4) ? 0.2 : 0) + ((bits & 8) ? 0.2 : 0));
  openSm += (openTarget - openSm) * Math.min(1, dt * 1.4);

  camera.getWorldQuaternion(tmpQ).invert();
  tmpV.copy(doorPos).sub(head.position).applyQuaternion(tmpQ);
  sound.update(dt, moved, running, openSm, tmpV);

  // 扉に触れたか
  const dgoal = head.position.distanceTo(doorPos);
  if (!cleared && dgoal < 1.05) doClear();

  // 表示
  hudT -= dt;
  if (hudT <= 0) {
    hudT = 0.2;
    $('r-depth').textContent = (cy > 0 ? '+' : cy < 0 ? '−' : '') + Math.abs(cy);
    $('r-steps').textContent = Math.floor(walkedTotal / 0.78);
    $('r-sense').textContent =
      dgoal > 95 ? '—' : dgoal > 46 ? '遠い' : dgoal > 21 ? 'かすか' : dgoal > 8 ? '近い' : 'すぐそこ';
  }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }

  // ときどき、遠い記憶を捨てる
  forgetT -= dt;
  if (forgetT <= 0) { forgetT = 12; world.forgetFar(cx, cy, cz, RENDER_R + 3); }
}

// ── 始まりと終わり ───────────────────────────────────────
function setupWorld(seed) {
  clearWorld();
  world = new World(seed);
  cleared = false; walkedTotal = 0; bob = 0; dip = 0;
  loadMyMarks(seed);
  rebuildMyMarks();

  goal = findGoal(world);
  buildDoor(goal);

  const sp = findSpawn(world);
  body.x = (sp.x + 0.5) * CELL; body.y = sp.y * LEVEL + 0.06; body.z = (sp.z + 0.5) * CELL;
  body.vx = body.vy = body.vz = 0;
  // 扉のほうを向いて始まる。どちらへ行くかは、そのあと自分で決める
  yaw = Math.atan2(-(doorPos.x - body.x), -(doorPos.z - body.z)) + (Math.random() - 0.5) * 2.4;
  pitch = 0;
  head.position.set(body.x, body.y + EYE, body.z);

  wantChunks(body.x, body.y, body.z);
  flushQueue(999);
  $('seedinput').value = seedName(seed);
  document.body.dataset.seed = seed;
}

function begin() {
  playing = true; cleared = false;
  $('overlay').classList.add('hide');
  $('hud').hidden = false;
  $('clear').hidden = true;
  sound.start(); sound.resume();
  canvas.requestPointerLock?.();
  last = performance.now();
}

function pause() {
  playing = false;
  $('overlay').classList.remove('hide');
  $('start').textContent = 'つづける';
  sound.suspend();
  keys.clear();
}

function doClear() {
  cleared = true; playing = false;
  document.exitPointerLock?.();
  sound.clear();
  $('hud').hidden = true;
  $('clear-stat').textContent =
    `${seedName(world.seed)} ／ ${Math.floor(walkedTotal / 0.78)}歩 ／ 深さ ${Math.abs(Math.floor(body.y / LEVEL))}`;
  $('clear').hidden = false;
}

// ── 画面の配線 ───────────────────────────────────────────
let pending = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
$('seedinput').value = seedName(pending);

$('reroll').onclick = () => {
  pending = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  $('seedinput').value = seedName(pending);
  if (world) { setupWorld(pending); }
};
$('seedinput').onchange = () => {
  const v = $('seedinput').value.trim();
  pending = seedFromString(v);
  $('seedinput').value = seedName(pending);
  if (world) setupWorld(pending);
};
$('start').onclick = () => {
  $('loading').hidden = false;
  requestAnimationFrame(() => {
    if (!world) setupWorld(pending);
    $('loading').hidden = true;
    begin();
  });
};
$('next').onclick = () => {
  pending = hash32(world.seed, 0x9999, Date.now() & 0xffff);
  $('clear').hidden = true;
  $('loading').hidden = false;
  requestAnimationFrame(() => {
    setupWorld(pending);
    $('loading').hidden = true;
    begin();
  });
};
canvas.addEventListener('click', () => {
  if (!playing && world && $('clear').hidden && $('overlay').classList.contains('hide')) begin();
});

// 画面のざらつき（毎フレーム作ると重いので一枚だけ焼く）
(function grain() {
  const s = 128, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d'), im = g.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    const v = 120 + Math.random() * 135;
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v;
    im.data[i * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  document.documentElement.style.setProperty('--grain-src', `url(${cv.toDataURL()})`);
})();

requestAnimationFrame(frame);

// 開発中の覗き窓。ブラウザの外から様子を見るのに使う。
window.__wb = {
  body, scene, renderer, camera,
  get playing() { return playing; },
  get world() { return world; },
  get chunks() { return loaded.size; },
  look(y, p) { yaw = y; if (p !== undefined) pitch = p; },
  put(x, y, z) { body.x = x; body.y = y; body.z = z; body.vx = body.vy = body.vz = 0; },
  goal: () => goal,
  isVoid: (x, y, z) => isVoidAt(world.seed, x, y, z),
  isLow: (x, y, z) => isLowCeil(world.seed, x, y, z),
  /** そのリンクを通り抜けるとき、狙うべき点（戸口の真ん中）。 */
  gate(x, y, z, d) {
    const ap = apertureAt(world.seed, x, y, z, d);
    const cx = (x + 0.5) * CELL, cz = (z + 0.5) * CELL;
    const off = ap ? ap.off : 0;
    return [cx + DX[d] * CELL * 0.5 + (DX[d] ? 0 : off), cz + DZ[d] * CELL * 0.5 + (DZ[d] ? 0 : off)];
  },
  setCenter(x, y, z) { wantChunks((x + .5) * CELL, y * LEVEL, (z + .5) * CELL); flushQueue(999); },
  // 描画を待たずに世界の時間だけ進める。試験のときだけ使う。
  sim(sec, held) {
    const prev = [...keys];
    keys.clear();
    if (held) for (const k of held) keys.add(k);
    const n = Math.round(sec * 60);
    for (let i = 0; i < n; i++) update(1 / 60);
    keys.clear();
    for (const k of prev) keys.add(k);
  },
  doorPos: () => doorPos.clone(),
  setup: setupWorld, begin,
};
