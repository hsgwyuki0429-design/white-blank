// One owner per control; a second finger never steals the steering pointer.
export function createTouchControls({ look, mark, pause }) {
  const root = document.createElement('div');
  root.id = 'touch-controls'; root.hidden = true;
  root.innerHTML = `<div id="touch-stick" aria-label="移動・旋回"><div id="stick-ring"><div id="stick-knob"></div></div><span>移動・旋回</span></div>
    <div id="touch-dash" aria-label="前進ダッシュ"><span>押してダッシュ<br>ドラッグで視線</span></div>
    <div id="touch-actions"><button type="button" id="touch-jump">跳ぶ</button><button type="button" id="touch-mark">印</button><button type="button" id="touch-pause">中断</button></div>`;
  document.body.append(root);
  const el = id => root.querySelector('#' + id);
  const state = { forward: 0, turn: 0, dash: false, jump: false };
  const owners = new Map();
  let active = false;
  const enabled = matchMedia('(pointer: coarse)').matches;
  document.documentElement.classList.toggle('touch', enabled);
  if (enabled) {
    const help = document.createElement('p'); help.id = 'touch-help';
    help.textContent = '左スティック：上下で前後移動、左右で旋回。右側：押して前進ダッシュ、ドラッグで視線。';
    document.querySelector('#keys').after(help);
  }
  function reset() {
    state.forward = state.turn = 0; state.dash = state.jump = false;
    const held = [...owners]; owners.clear();
    for (const [node, id] of held) if (node.hasPointerCapture(id)) node.releasePointerCapture(id);
    el('stick-knob').style.transform = ''; el('touch-dash').classList.remove('active');
  }
  function bind(node, down, move, up) {
    node.addEventListener('pointerdown', e => {
      if (!active || owners.has(node) || e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); owners.set(node, e.pointerId); node.setPointerCapture(e.pointerId); down(e);
    });
    node.addEventListener('pointermove', e => { if (owners.get(node) === e.pointerId) { e.preventDefault(); move(e); } });
    const end = e => {
      if (owners.get(node) !== e.pointerId) return;
      owners.delete(node); up();
      if (node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) node.addEventListener(event, end);
  }
  let originX = 0, originY = 0;
  bind(el('touch-stick'), e => { originX = e.clientX; originY = e.clientY; }, e => {
    let x = (e.clientX - originX) / 48, y = (e.clientY - originY) / 48;
    const length = Math.hypot(x, y), scale = Math.max(1, length); x /= scale; y /= scale;
    const dead = v => Math.abs(v) < .12 ? 0 : Math.sign(v) * (Math.abs(v) - .12) / .88;
    state.turn = dead(x); state.forward = -dead(y);
    el('stick-knob').style.transform = `translate(${x * 48}px,${y * 48}px)`;
  }, () => { state.forward = state.turn = 0; el('stick-knob').style.transform = ''; });
  let previousX = 0, previousY = 0;
  bind(el('touch-dash'), e => {
    previousX = e.clientX; previousY = e.clientY; state.dash = true; el('touch-dash').classList.add('active');
  }, e => {
    look((e.clientX - previousX) * .004, (e.clientY - previousY) * .004);
    previousX = e.clientX; previousY = e.clientY;
  }, () => { state.dash = false; el('touch-dash').classList.remove('active'); });
  bind(el('touch-jump'), () => { state.jump = true; }, () => {}, () => { state.jump = false; });
  el('touch-mark').onclick = () => { if (active) mark(); };
  el('touch-pause').onclick = () => { if (active) pause(); };
  root.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('blur', reset);
  addEventListener('resize', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  return { state, enabled, reset, show(value) { active = enabled && value; root.hidden = !active; reset(); } };
}
