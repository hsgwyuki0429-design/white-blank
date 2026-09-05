// 音はすべてその場で合成する。素材ファイルは持たない。
//
// 白い地下で頼りになるのは、足音の返りかた。
// 狭い通路では short、縦穴のそばでは深く長く返るように残響の量を動かしている。

const REVERB_SEC = 3.2;

export class Sound {
  constructor() {
    this.ctx = null;
    this.walked = 0;      // 歩いた距離。これで足音の間隔を測る
    this.nextFar = 0;     // 次の「遠い音」までの時間
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    // 空間の返り。白い石の広間を思わせる、少し暗い残響
    this.conv = ctx.createConvolver();
    this.conv.buffer = this.impulse(REVERB_SEC);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.38;
    this.conv.connect(this.wet).connect(this.master);

    this.noiseBuf = this.noise(2.0);

    this.buildDrone();
    this.buildAir();
    this.buildBeacon();
    this.nextFar = 5 + Math.random() * 8;
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  noise(sec) {
    const n = Math.floor(this.ctx.sampleRate * sec);
    const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  impulse(sec) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // 立ち上がりを少し遅らせると、近い壁ではなく遠い壁から返ってきた感じになる
        const pre = Math.min(1, t * 26);
        const env = pre * Math.pow(1 - t, 2.6);
        lp += ((Math.random() * 2 - 1) - lp) * 0.34;   // 高い成分を落とす
        d[i] = lp * env;
      }
    }
    return b;
  }

  src(buf, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf || this.noiseBuf;
    s.playbackRate.value = rate;
    s.loop = false;
    return s;
  }

  // ── 常に鳴っているもの ───────────────────────────────

  buildDrone() {
    const ctx = this.ctx;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 0.6;
    this.droneGain.connect(lp).connect(this.master);
    for (const [f, g] of [[41.2, 0.5], [55.0, 0.30], [82.4, 0.14], [61.7, 0.10]]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = g;
      // ゆっくりした唸り。ずっと同じ音だと、耳がすぐ慣れて消えてしまう
      const lfo = ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 0.031 + Math.random() * 0.05;
      const lg = ctx.createGain(); lg.gain.value = g * 0.55;
      lfo.connect(lg).connect(og.gain); lfo.start();
      o.connect(og).connect(this.droneGain); o.start();
    }
    this.droneGain.gain.linearRampToValueAtTime(0.085, ctx.currentTime + 6);
  }

  buildAir() {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.55;
    this.airGain = ctx.createGain(); this.airGain.gain.value = 0.0;
    s.connect(bp).connect(this.airGain);
    this.airGain.connect(this.master);
    this.airGain.connect(this.conv);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 0.043;
    const lg = ctx.createGain(); lg.gain.value = 0.011;
    lfo.connect(lg).connect(this.airGain.gain); lfo.start();
    s.start();
    this.airGain.gain.linearRampToValueAtTime(0.016, ctx.currentTime + 8);
  }

  /** 扉の気配。方向がわかるように、頭の向きに合わせて左右に振る。 */
  buildBeacon() {
    const ctx = this.ctx;
    this.pan = ctx.createPanner();
    this.pan.panningModel = 'HRTF';
    this.pan.distanceModel = 'linear';
    this.pan.refDistance = 1; this.pan.maxDistance = 26; this.pan.rolloffFactor = 1;
    this.beaconGain = ctx.createGain(); this.beaconGain.gain.value = 0;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 138.6;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 277.2;
    const g2 = ctx.createGain(); g2.gain.value = 0.22;
    o2.connect(g2).connect(this.beaconGain);
    o.connect(this.beaconGain);
    // 呼吸するような明滅
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.19;
    const lg = ctx.createGain(); lg.gain.value = 0.55;
    lfo.connect(lg).connect(this.beaconGain.gain); lfo.start();
    this.beaconGain.connect(this.pan);
    this.pan.connect(this.master); this.pan.connect(this.conv);
    o.start(); o2.start();
    this.beaconLevel = 0;
  }

  // ── 出来事 ──────────────────────────────────────────

  /** 足音。硬い床を、布と革のあいだくらいの靴で。 */
  foot(vol = 1, wetness = 0.4, low = 1) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const r = 0.86 + Math.random() * 0.3;

    const s = this.src(null, 1.6 * r);
    s.loopStart = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = (1250 + Math.random() * 700) * r; bp.Q.value = 0.75;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.085 + Math.random() * 0.04);
    s.connect(bp).connect(hp).connect(g);
    g.connect(this.master);
    const w = ctx.createGain(); w.gain.value = wetness;
    g.connect(w).connect(this.conv);
    s.start(t, Math.random() * 1.5, 0.2);

    // かかとが落ちる低い衝撃
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(96 * r, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.075 * vol * low, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(og); og.connect(this.master);
    const ow = ctx.createGain(); ow.gain.value = wetness * 0.7;
    og.connect(ow).connect(this.conv);
    o.start(t); o.stop(t + 0.2);
  }

  land(force) {
    const ctx = this.ctx; if (!ctx) return;
    const v = Math.min(1.6, force / 14);
    this.foot(1.3 + v, 0.75, 2.2 + v * 2);
    const t = ctx.currentTime;
    const s = this.src(null, 0.5);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2 * v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(lp).connect(g); g.connect(this.master);
    const w = ctx.createGain(); w.gain.value = 0.9; g.connect(w).connect(this.conv);
    s.start(t, Math.random(), 0.6);
  }

  /** 壁に印を刻む音。乾いた擦り音。 */
  scratch(up = true) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const s = this.src(null, up ? 1.0 : 0.7);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.setValueAtTime(up ? 1800 : 900, t);
    bp.frequency.exponentialRampToValueAtTime(up ? 3400 : 620, t + 0.18);
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    s.connect(bp).connect(g); g.connect(this.master);
    const w = ctx.createGain(); w.gain.value = 0.5; g.connect(w).connect(this.conv);
    s.start(t, Math.random(), 0.3);
  }

  /** どこか遠くで何かが動く音。姿は決して見えない。 */
  far() {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const kind = Math.random();
    const p = ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    const g = ctx.createGain();
    g.connect(p); p.connect(this.conv);
    const dry = ctx.createGain(); dry.gain.value = 0.16;
    p.connect(dry).connect(this.master);

    if (kind < 0.5) {
      // 崩れる。石が落ちる
      const s = this.src(null, 0.35 + Math.random() * 0.3);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.10, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      s.connect(lp).connect(g); s.start(t, Math.random(), 1.3);
    } else {
      // 何かが軋む。ずいぶん低いところで
      const o = ctx.createOscillator(); o.type = 'triangle';
      const f = 60 + Math.random() * 110;
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * (0.72 + Math.random() * 0.2), t + 1.6);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
      o.connect(lp).connect(g); o.start(t); o.stop(t + 2.1);
    }
  }

  /** 扉をくぐった瞬間。 */
  clear() {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, d] of [[220, 0], [329.6, 0.06], [440, 0.13], [659.3, 0.2]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.09, t + d + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 2.6);
      o.connect(g); g.connect(this.master); g.connect(this.conv);
      o.start(t + d); o.stop(t + d + 2.8);
    }
    if (this.droneGain) this.droneGain.gain.linearRampToValueAtTime(0.0, t + 1.2);
  }

  // ── 毎フレーム ──────────────────────────────────────

  /**
   * @param dt      経過秒
   * @param moved   この間に歩いた距離(m)
   * @param running 急いでいるか
   * @param openness 周りの開けぐあい 0..1（残響の量に効く）
   * @param beacon  扉の方向と距離 {x,y,z} カメラ基準。null なら気配なし
   */
  update(dt, moved, running, openness, beacon) {
    const ctx = this.ctx; if (!ctx) return;

    // 足音は「歩いた距離」で刻む。速度が変わっても歩幅が変わらない
    this.walked += moved;
    const stride = running ? 0.92 : 0.78;
    if (this.walked > stride) {
      this.walked %= stride;
      const wet = 0.25 + openness * 0.75;
      this.foot(running ? 1.15 : 0.85, wet, running ? 1.25 : 1);
    }

    // 空間が開けているほど、返りを長く
    const target = 0.20 + openness * 0.42;
    this.wet.gain.setTargetAtTime(target, ctx.currentTime, 0.6);

    // 遠鳴り
    this.nextFar -= dt;
    if (this.nextFar <= 0) { this.far(); this.nextFar = 11 + Math.random() * 26; }

    // 扉の気配
    if (beacon) {
      const d = Math.hypot(beacon.x, beacon.y, beacon.z);
      const k = Math.min(1, Math.max(0, 1 - d / 60));
      this.beaconLevel += (k * k * 0.055 - this.beaconLevel) * Math.min(1, dt * 1.5);
      const s = Math.min(24, d) / (d || 1);
      this.pan.positionX && this.pan.positionX.setTargetAtTime(beacon.x * s, ctx.currentTime, 0.1);
      this.pan.positionY && this.pan.positionY.setTargetAtTime(beacon.y * s, ctx.currentTime, 0.1);
      this.pan.positionZ && this.pan.positionZ.setTargetAtTime(beacon.z * s, ctx.currentTime, 0.1);
      if (!this.pan.positionX) this.pan.setPosition(beacon.x * s, beacon.y * s, beacon.z * s);
    } else {
      this.beaconLevel += (0 - this.beaconLevel) * Math.min(1, dt * 1.5);
    }
    this.beaconGain.gain.setTargetAtTime(this.beaconLevel, ctx.currentTime, 0.2);

    // 聞き手はいつも原点。beaconをカメラ基準で渡しているので向きだけ揃える
    const L = ctx.listener;
    if (L && L.forwardX) {
      L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else if (L && L.setOrientation) L.setOrientation(0, 0, -1, 0, 1, 0);
  }
}
