// RECLAIM: input, camera, interface and the loop. The simulation is in sim.js, the drawing in render.js.
import { PAL, FEEL, T, PAVED, ALIVE, STAGES, EVOLUTIONS, SPECIES, INSPECT, PROMPTS } from './config.js';
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { GameAudio } from './audio.js';

const $ = id => document.getElementById(id);
const errorBox = $('error');
addEventListener('error', e => { errorBox.textContent = `Something went wrong: ${e.message}`; errorBox.hidden = false; });
addEventListener('unhandledrejection', e => { errorBox.textContent = `Something went wrong: ${e.reason && e.reason.message || e.reason}`; errorBox.hidden = false; });

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: play on without saving */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* nothing to remove */ } },
};
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const buzz = ms => { if (navigator.vibrate) navigator.vibrate(ms); };

const level = await (await fetch('data/intersection.json')).json();
const cv = $('game');
const audio = new GameAudio(); audio.muted = store.get('reclaim_muted', false);
let sim = new Sim(level);
const R = new Renderer(cv, sim, { reduced, layerScale: (window.devicePixelRatio || 1) >= 2 ? 2 : 1.5 });
{ // the adaptation burst: frames from the atlas, timing from the flipbook sheet
  const img = new Image(); img.src = 'assets/fx/energy_flipbook.png';
  Promise.all([fetch('assets/fx/energy_atlas.json').then(r => r.json()), fetch('assets/fx/energy_flipbook.json').then(r => r.json()), img.decode()])
    .then(([atlas, book]) => { R.fx = img; R.fxFrames = Object.keys(atlas.frames).sort().map(k => atlas.frames[k].frame); R.fxFps = book.fps; }).catch(() => {});
  // identity palette → interface tokens
  fetch('assets/brand/palette.json').then(r => r.json()).then(p => { for (const k of Object.keys(p)) document.documentElement.style.setProperty(`--${k}`, p[k]); }).catch(() => {});
}

const G = { state: 'title', paused: false, mode: null, time: 0, ui: {}, rainLevel: 0, saveAt: 0, inspectAt: 0, lastWhy: 0, watching: false };
const cam = { x: sim.W / 2, y: sim.W / 2, z: 0.5, to: null };

// ---------------------------------------------------------------- camera
const fitZoom = () => Math.min(innerWidth, innerHeight) / sim.W * 0.96;
const coverZoom = () => Math.max(innerWidth, innerHeight) / sim.W * 1.12;
const playZoom = () => Math.max(fitZoom() * 1.25, Math.min(1.25, Math.min(innerWidth / (8.6 * sim.TS), innerHeight / (9 * sim.TS))));
const zoomMin = () => fitZoom() * 0.85;
function clampCam() {
  cam.z = Math.max(zoomMin(), Math.min(FEEL.zoom_max, cam.z));
  const hw = innerWidth / 2 / cam.z, hh = innerHeight / 2 / cam.z, W = sim.W, slack = 90;
  cam.x = hw * 2 >= W + slack * 2 ? W / 2 : Math.max(hw - slack, Math.min(W + slack - hw, cam.x));
  cam.y = hh * 2 >= W + slack * 2 ? W / 2 : Math.max(hh - slack, Math.min(W + slack - hh, cam.y));
}
const toWorld = (sx, sy) => ({ x: (sx - innerWidth / 2) / cam.z + cam.x, y: (sy - innerHeight / 2) / cam.z + cam.y });
function flyTo(x, y, z, secs = 1.4) { cam.to = { x0: cam.x, y0: cam.y, z0: cam.z, x, y, z, t: 0, secs }; }
function resize() { R.resize(); if (G.state === 'title') { cam.z = coverZoom(); cam.x = cam.y = sim.W / 2; } clampCam(); }
addEventListener('resize', resize); addEventListener('orientationchange', resize); resize();

// ---------------------------------------------------------------- interface
const hud = $('hud'), promptEl = $('prompt');
let toastQ = [], toastBusy = false;
function toast(tag, name, line, secs = 3.2) { toastQ.push({ tag, name, line, secs }); if (!toastBusy) nextToast(); }
function nextToast() {
  const t = toastQ.shift(), el = $('toast'); if (!t) { toastBusy = false; el.hidden = true; return; }
  toastBusy = true; $('toastTag').textContent = t.tag; $('toastName').textContent = t.name; $('toastLine').textContent = t.line;
  el.hidden = true; void el.offsetWidth; el.hidden = false; setTimeout(nextToast, t.secs * 1000);
}
let stampTimer = 0;
function stamp(n, name, line) {
  const el = $('stamp'); $('stampN').textContent = n; $('stampName').textContent = name; $('stampLine').textContent = line;
  el.hidden = true; void el.offsetWidth; el.hidden = false; clearTimeout(stampTimer); stampTimer = setTimeout(() => { el.hidden = true; }, 2750);
}
function inspect(name, line, state = '') { $('inspectName').textContent = name; $('inspectLine').textContent = line; $('inspectState').textContent = state; const el = $('inspect'); el.hidden = true; void el.offsetWidth; el.hidden = false; G.inspectAt = performance.now(); }
function setPrompt(text) { if (promptEl.textContent !== text) promptEl.textContent = text; }
const shown = {};
function setText(id, v) { if (shown[id] !== v) { shown[id] = v; $(id).textContent = v; } }
function refreshHud() {
  const st = STAGES[Math.min(sim.stage, 4)]; setText('stageN', st.n); setText('stageName', st.name);
  const a = Math.floor(sim.alive); setText('aliveNum', a);
  if (shown.bar !== a) { shown.bar = a; $('aliveBar').style.transform = `scaleX(${sim.alive / 100})`; document.documentElement.style.setProperty('--life', a >= 55 ? PAL.primary : a >= 28 ? '#c4cf48' : PAL.accent); }
  setText('sunNum', Math.floor(sim.sun)); setText('waterNum', Math.floor(sim.water));
  const lowSun = sim.sun < FEEL.grow_cost_sun_per_tile, lowWater = sim.waterGroups > 0 && sim.water < FEEL.crack_cost_water_sidewalk;
  if (shown.ls !== lowSun) { shown.ls = lowSun; $('sunMeter').classList.toggle('low', lowSun); }
  if (shown.lw !== lowWater) { shown.lw = lowWater; $('waterMeter').classList.toggle('low', lowWater); }
  const gk = Math.round(sim.alive / 2) + (G.rainLevel > 0.5 ? 100 : 0);
  if (shown.grade !== gk) { shown.grade = gk; const t = sim.alive / 100; document.documentElement.style.setProperty('--grade', `rgba(${Math.round(70 + 185 * t)},${Math.round(98 + 100 * t)},${Math.round(132 - 40 * t)},${(0.17 - 0.09 * t + (G.rainLevel > 0.5 ? 0.05 : 0)).toFixed(3)})`); }
  const so = Math.round(113.1 * (1 - sim.sun / sim.sunCap)), wo = Math.round(113.1 * (1 - sim.water / sim.waterCap));
  if (shown.so !== so) { shown.so = so; $('sunRing').style.strokeDashoffset = so; }
  if (shown.wo !== wo) { shown.wo = wo; $('waterRing').style.strokeDashoffset = wo; }
  // one line of direction, always about the next thing
  let p = '';
  if (!sim.flags.grew) p = PROMPTS.drag;
  else if (!sim.hydrant.connected) p = PROMPTS.water;
  else if (!sim.flags.cracked) p = PROMPTS.crack;
  else if (sim.stage < 1) p = PROMPTS.spread;
  else if (sim.metrics.link < 1) p = `${PROMPTS.corners} ${Math.round(sim.metrics.link * 4)}/4`;
  else if (sim.stage < 3) p = PROMPTS.build;
  else if (!sim.won) p = PROMPTS.watch;
  setPrompt(G.state === 'playing' && !G.watching ? p : '');
}
function flash(id) { const el = $(id); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
function refreshEvos() {
  const el = $('evos'); el.textContent = '';
  for (const id of Object.keys(sim.evo)) { const d = document.createElement('div'); d.className = 'evo'; d.textContent = EVOLUTIONS[id].name; el.appendChild(d); }
}
function openEvolve(options) {
  const wrap = $('evolveCards'); wrap.textContent = '';
  for (const id of options) {
    const e = EVOLUTIONS[id], b = document.createElement('button'); b.type = 'button'; b.className = 'card'; b.dataset.evo = id;
    for (const [tag, cls, txt] of [['span', 'tag', e.tag], ['b', '', e.name], ['span', '', e.line], ['i', '', e.flavor]]) { const n = document.createElement(tag); if (cls) n.className = cls; n.textContent = txt; b.appendChild(n); }
    b.onclick = () => { $('evolve').hidden = true; sim.choose(id); audio.play('click'); };
    wrap.appendChild(b);
  }
  $('evolve').hidden = false; endGesture();
}
function openHealth() {
  const m = sim.metrics, bars = $('healthBars'); bars.textContent = '';
  const row = (name, val, v, note) => {
    const d = document.createElement('div'); d.className = 'bar'; const n = document.createElement('span'); n.textContent = name; const e = document.createElement('em'); e.textContent = val;
    const u = document.createElement('u'); u.style.setProperty('--v', Math.max(0, Math.min(1, v)).toFixed(3)); const p = document.createElement('p'); p.textContent = note; d.append(n, e, u, p); bars.appendChild(d);
  };
  row('Living ground', `${Math.round(m.cover * 100)}% of ${Math.round(ALIVE.cover_target * 100)}%`, m.cover / ALIVE.cover_target, 'Planted soil, open water and garden walls. Bare rubble counts for nothing.');
  row('Species', `${sim.speciesCount} found · ${ALIVE.species_target} needed`, m.species, 'Different ground grows different things: sun, shade, water, rubble.');
  row('Corners linked', `${Math.round(m.link * 4)} of 4`, m.link, 'A corner is linked when your vine reaches it and life has taken hold there.');
  row('Soil', `${Math.round(m.soil * 100)}%`, m.soil, 'Plants make soil. Soil makes bigger plants.');
  const chips = $('speciesChips'); chips.textContent = '';
  for (const id of Object.keys(SPECIES)) { const c = document.createElement('span'); c.className = 'chip' + (sim.species[id] ? ' on' : ''); c.textContent = sim.species[id] ? SPECIES[id].name : '?'; chips.appendChild(c); }
  $('health').hidden = false; setPaused(true, true); $('healthClose').focus({ preventScroll: true });
}
function setPaused(p, quiet) {
  G.paused = p; if (p) endGesture();
  if (!quiet) { $('pauseSheet').hidden = !p; if (p) { $('restart').textContent = 'Start over'; $('resume').focus({ preventScroll: true }); } }
}
function setMuted(m) {
  audio.setMuted(m); store.set('reclaim_muted', m); const b = $('mute'); b.setAttribute('aria-pressed', String(m)); b.setAttribute('aria-label', m ? 'Sound off' : 'Sound on');
}
setMuted(audio.muted);

function mixAudio() {
  const a = sim.alive / 100, st = sim.stage, sp = sim.species;
  audio.level('wind', 0.5 - 0.36 * a);
  audio.level('night', sp.pollinator ? 0.14 + 0.2 * a : st >= 1 ? 0.05 : 0);
  audio.level('forest', sp.bird ? 0.22 + 0.3 * a : st >= 2 ? 0.07 : 0);
  audio.level('pad', st >= 1 ? 0.2 : 0, 6); audio.level('bass', st >= 2 ? 0.2 : 0, 6); audio.level('arp', st >= 3 ? 0.14 : 0, 6);
}

// ---------------------------------------------------------------- run control
function begin(fromSave) {
  audio.start().then(mixAudio);
  if (!fromSave && (sim.time > 0 || sim.nx.length > 1)) newSim();
  if (fromSave) { const s = store.get('reclaim_save', null); if (s) newSim(s); }
  sim.state = 'playing'; G.state = 'playing'; G.watching = false; G.paused = false;
  $('title').classList.add('leaving'); setTimeout(() => { $('title').hidden = true; }, 700);
  hud.hidden = false; refreshEvos(); refreshHud();
  const last = sim.nx.length - 1; flyTo(sim.nx[fromSave ? 0 : last], sim.ny[fromSave ? 0 : last] - sim.TS * 1.2, playZoom(), reduced ? 0.01 : 1.5);
  if (sim.pendingOffer) openEvolve(sim.pendingOffer);
  audio.play('click');
}
function newSim(save) {
  sim = new Sim(level, save); R.sim = sim; R.parts.length = 0; R.labels.length = 0; R.pulses.length = 0; R.books.length = 0; R.collapsing.length = 0;
  R.fauna = { flies: [], birds: [], dragons: [], motes: [] }; R.treeAge.fill(0); R.makeSprites(); R.rebuildAll(); G.rainLevel = 0; G.ui = {};
  for (const k of Object.keys(shown)) delete shown[k];
}
function saveNow() { if (G.state === 'playing' && !sim.won) store.set('reclaim_save', sim.save()); }
function win() {
  store.del('reclaim_save'); const best = store.get('reclaim_best', 0), t = sim.time, isBest = !best || t < best; if (isBest) store.set('reclaim_best', t);
  store.set('reclaim_runs', store.get('reclaim_runs', 0) + 1);
  G.state = 'over'; endGesture(); setPrompt(''); toastQ.length = 0; flyTo(sim.W / 2, sim.W / 2, fitZoom(), reduced ? 0.01 : 3);
  audio.play('fanfare', { gain: 0.4 }); audio.level('forest', 0.6, 2); audio.level('pad', 0.1, 2); audio.level('bass', 0.05, 2); audio.level('arp', 0.05, 2);
  setTimeout(() => {
    const dl = $('endStats'); dl.textContent = '';
    const row = (k, v) => { const d = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; d.append(dt, dd); dl.appendChild(d); };
    row('Time', fmtTime(t) + (isBest ? '  ·  best' : '')); row('Species', `${sim.speciesCount} of ${Object.keys(SPECIES).length}`);
    row('Slabs you broke', sim.stats.broken); row('Slabs the roots broke', sim.stats.byRoots);
    row('Buildings kept', sim.buildings.filter(b => b.state !== 'rubble').length); row('Buildings felled', sim.stats.felled);
    $('end').hidden = false; $('watch').focus({ preventScroll: true });
  }, reduced ? 300 : 3200);
}
function showTitle() {
  const save = store.get('reclaim_save', null), best = store.get('reclaim_best', 0);
  $('continue').hidden = !save; if (save) { $('continue').className = 'btn primary'; $('begin').className = 'btn'; $('begin').textContent = 'New vine'; }
  if (best) { $('best').hidden = false; $('best').textContent = `Fastest reclamation  ${fmtTime(best)}`; }
}
showTitle();

$('begin').onclick = () => begin(false);
$('title').addEventListener('click', e => { if (!e.target.closest('button, a') && G.state === 'title') begin(!$('continue').hidden); });
$('continue').onclick = () => begin(true);
$('pause').onclick = () => setPaused(true);
$('resume').onclick = () => setPaused(false);
$('restart').onclick = e => {
  if (e.currentTarget.textContent === 'Start over') { e.currentTarget.textContent = 'Really? Tap again'; return; }
  store.del('reclaim_save'); newSim(); $('pauseSheet').hidden = true; sim.state = 'playing'; G.paused = false; G.watching = false; refreshEvos();
  cam.x = sim.nx[0]; cam.y = sim.ny[0] - sim.TS * 1.2; cam.z = playZoom(); clampCam(); mixAudio();
};
$('mute').onclick = () => setMuted(!audio.muted);
$('stagePlate').onclick = openHealth;
$('healthClose').onclick = () => { $('health').hidden = true; setPaused(false, true); };
$('watch').onclick = () => { $('end').hidden = true; G.state = 'playing'; sim.state = 'playing'; G.watching = true; mixAudio(); flyTo(sim.W / 2, sim.W / 2, fitZoom(), 0.5); };
$('again').onclick = () => { $('end').hidden = true; newSim(); sim.state = 'playing'; G.state = 'playing'; G.watching = false; refreshEvos(); mixAudio(); flyTo(sim.nx[0], sim.ny[0] - sim.TS * 1.2, playZoom(), reduced ? 0.01 : 1.2); };
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveNow(); if (G.state === 'playing' && !G.paused && $('evolve').hidden) setPaused(true); audio.suspend(true); } else audio.suspend(false); });
addEventListener('pagehide', saveNow);

// ---------------------------------------------------------------- pointer input
const ptrs = new Map(); let pinch = null, gesture = null;
function pickNode(sx, sy) {
  let best = -1, bd = Infinity; const tipR = FEEL.tip_grab_radius_px, nodeR = FEEL.node_grab_radius_px;
  for (let i = 0; i < sim.nx.length; i++) {
    const d = Math.hypot((sim.nx[i] - cam.x) * cam.z + innerWidth / 2 - sx, (sim.ny[i] - cam.y) * cam.z + innerHeight / 2 - sy), tip = sim.nk[i] === 0;
    if (d > (tip ? tipR : nodeR)) continue; const score = d - (tip ? 30 : 0); if (score < bd) { bd = score; best = i; }
  }
  return best;
}
function endGesture() {
  if (gesture && gesture.mode === 'grow') { const n = sim.endGrow(); if (n) { R.rebuildVine(); audio.play('click', { gain: 0.5, rate: 1.25 }); R.ring(sim.nx[sim.nx.length - 1], sim.ny[sim.nx.length - 1], PAL.primary, 18, 0.4); } }
  gesture = null; G.ui.hold = null;
}
cv.addEventListener('pointerdown', e => {
  if (G.state !== 'playing' || G.paused || sim.pendingOffer) return;
  cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  audio.start();
  if (ptrs.size === 2) { endGesture(); const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; return; }
  if (ptrs.size > 2) return;
  const node = G.watching ? -1 : pickNode(e.clientX, e.clientY);
  gesture = { mode: 'pending', id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), node };
  if (node >= 0 && sim.nk[node] === 0) startGrowGesture();   // a tip grows at once; a joint waits to see if this is a branch, a hold or a tap
});
function startGrowGesture() { sim.startGrow(gesture.node); gesture.mode = 'grow'; audio.play('click', { gain: 0.35, rate: 1.7 }); buzz(FEEL.haptic_grab_ms); $('inspect').hidden = true; cam.to = null; }
cv.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (pinch && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, before = toWorld(mx, my);
    cam.z = pinch.z * d / pinch.d; clampCam(); const after = toWorld(mx, my); cam.x += before.x - after.x - (mx - pinch.mx) / cam.z; cam.y += before.y - after.y - (my - pinch.my) / cam.z; pinch.mx = mx; pinch.my = my; clampCam(); cam.to = null; return;
  }
  if (!gesture || gesture.id !== e.pointerId) return; gesture.x = e.clientX; gesture.y = e.clientY;
  if (gesture.mode === 'pending' && Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > FEEL.pan_threshold_px) { if (gesture.node >= 0) startGrowGesture(); else { gesture.mode = 'pan'; cam.to = null; } }
  if (gesture.mode === 'pan') { cam.x -= dx / cam.z; cam.y -= dy / cam.z; clampCam(); }
});
function pointerUp(e) {
  if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
  if (!gesture || gesture.id !== e.pointerId) return;
  const still = Math.hypot(gesture.x - gesture.sx, gesture.y - gesture.sy) < FEEL.pan_threshold_px;
  if (gesture.mode === 'pending' || (gesture.mode === 'grow' && still && sim.g && sim.g.added === 0)) tap(gesture.x, gesture.y);
  endGesture();
}
cv.addEventListener('pointerup', pointerUp); cv.addEventListener('pointercancel', pointerUp);
cv.addEventListener('wheel', e => { e.preventDefault(); if (G.state !== 'playing') return; const before = toWorld(e.clientX, e.clientY); cam.z *= Math.exp(-e.deltaY * 0.0015); clampCam(); const after = toWorld(e.clientX, e.clientY); cam.x += before.x - after.x; cam.y += before.y - after.y; clampCam(); cam.to = null; }, { passive: false });
cv.addEventListener('contextmenu', e => e.preventDefault());
const keys = new Set();
addEventListener('keydown', e => {
  if (e.key === ' ' || e.key === 'Enter') { if (G.state === 'title' && !$('title').hidden && document.activeElement.tagName !== 'BUTTON') { e.preventDefault(); begin(!$('continue').hidden); } return; }
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { if (!$('health').hidden) $('healthClose').click(); else if (G.state === 'playing' && $('evolve').hidden) setPaused(!G.paused); return; }
  if (e.key === 'm' || e.key === 'M') { setMuted(!audio.muted); return; }
  keys.add(e.key.toLowerCase());
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

function tap(sx, sy) {
  const w = toWorld(sx, sy), TS = sim.TS, tx = Math.floor(w.x / TS), ty = Math.floor(w.y / TS), i = sim.ti(w.x, w.y);
  if (i < 0) { $('inspect').hidden = true; return; }
  let near = null, nd = 30; for (const p of sim.props) { const d = Math.hypot((p.x + 0.5) * TS - w.x, (p.y + 0.5) * TS - w.y); if (d < nd) { nd = d; near = p; } }
  if (near) { const key = near.kind === 'hydrant' && sim.hydrant.burst ? 'hydrant_burst' : near.kind; const st = near.kind === 'hydrant' && !sim.hydrant.burst ? 'Hold beside your vine to break it open' : ''; inspect(...INSPECT[key], st); return; }
  const t = sim.type[i];
  if (t === T.BUILDING) { const b = sim.buildings[sim.bld[i]]; inspect(...INSPECT[b.state === 'garden' ? 'garden' : b.id], b.state === 'garden' ? '' : sim.evo.climbing ? 'Grow onto it' : sim.evo.constrict ? 'Hold beside your vine to bring it down' : 'Too tall to cross. For now.'); return; }
  if (sim.ncount[i] > 0 && t !== T.SOIL) { inspect(...INSPECT.vine, `${sim.nx.length} joints · drag any joint to branch`); return; }
  if (t === T.SOIL) {
    const v = sim.veg[i], shade = sim.light[i] < 0.5, m = sim.moist[i];
    const what = v >= 5 ? 'TREE' : v >= 4 ? 'SHRUBS' : v >= 3 ? (shade ? 'FERNS' : 'WILDFLOWERS') : v >= 2 ? (shade ? 'SHADE GRASS' : 'GRASS') : v >= 1 ? 'MOSS' : sim.rubble[i] ? 'RUBBLE' : 'BARE SOIL';
    const line = sim.rubble[i] && v < 1 ? INSPECT.rubble[1] : m < 0.22 ? 'Too dry. Bring the vine closer, or wait for rain.' : v < 1 ? 'Damp enough. Something will take.' : shade && v >= 2.9 ? 'As far as it goes without direct sun.' : 'Growing on its own.';
    inspect(what, line, `SOIL ${Math.round(sim.health[i] * 100)}%  ·  ${m < 0.22 ? 'DRY' : m < 0.55 ? 'DAMP' : 'WET'}  ·  ${shade ? 'SHADE' : 'SUN'}`); return;
  }
  if (t === T.WATER) { inspect(...INSPECT.water); return; }
  if (sim.evo.seeking && ty === sim.mainRow && !sim.mainBurst) { inspect(...INSPECT.main); return; }
  const key = t === T.WALK ? 'walk' : t === T.BASIN ? 'basin' : t === T.PLAZA ? 'plaza' : 'asphalt';
  inspect(...INSPECT[key], sim.reach[i] ? (sim.waterGroups ? 'In reach' : 'In reach · needs water') : 'Out of reach of your vine');
}

// ---------------------------------------------------------------- simulation events → sight and sound
function tileXY(i) { return { x: (i % sim.N + 0.5) * sim.TS, y: ((i / sim.N | 0) + 0.5) * sim.TS }; }
function onScreen(x, y) { const sx = (x - cam.x) * cam.z + innerWidth / 2, sy = (y - cam.y) * cam.z + innerHeight / 2; return sx > -60 && sy > -60 && sx < innerWidth + 60 && sy < innerHeight + 60; }
function handle(e) {
  switch (e.t) {
    case 'node': if (Math.random() < 0.3) R.burst(sim.nx[e.i], sim.ny[e.i], 'leaf', 1, PAL.leaf); break;
    case 'water': R.pulseAlong(e.node, PAL.waterLight); R.ring(e.x, e.y, PAL.waterLight, 60, 0.9); R.burst(e.x, e.y, 'drop', 14, PAL.waterLight); audio.play('splash', { gain: 0.8 }); buzz(18);
      toast('REACHED WATER', 'You can break things now', 'Your vine carries water to the ground beside it. Water is what cracks concrete.', 4.5); mixAudio(); break;
    case 'fracture': R.markDirty(e.i); if (!e.quiet) { const p = tileXY(e.i); audio.play('hit', { gain: 0.45, rate: 0.75 + Math.random() * 0.3 }); audio.creak(); R.burst(p.x, p.y, 'dust', 3, '#b9b8b0'); buzz(5); } break;
    case 'break': {
      R.markDirty(e.i, true); const p = tileXY(e.i), tough = sim.orig[e.i] === T.ASPHALT || sim.orig[e.i] === T.LOT, see = onScreen(p.x, p.y);
      R.burst(p.x, p.y, 'dust', 9, tough ? '#77797c' : '#c2c1b9'); R.burst(p.x, p.y, 'chip', 8, tough ? '#4a4d51' : '#9a9b95');
      if (e.cause === 'player') { audio.play('thud', { gain: 0.95, rate: tough ? 0.8 : 1 }); R.kick(FEEL.break_shake_px, FEEL.break_shake_ms); buzz(FEEL.haptic_break_ms); }
      else if (see) audio.play('thud', { gain: 0.22, rate: 1.35 });
      if (e.wet) { R.burst(p.x, p.y, 'drop', 12, PAL.waterLight); if (see) audio.play('splash', { gain: 0.5, rate: 1.1 }); }
      break;
    }
    case 'main': { const p = tileXY(e.i); R.ring(p.x, p.y, PAL.waterLight, 90, 1.1); toast('WATER MAIN', 'A river in a pipe', sim.evo.seeking ? 'You heard it. Now it runs in the open. Break more road along it and the stream follows.' : 'Technically, it found you. Break more road along it and the stream follows.', 4.5); G.ui.mainHint = false; break; }
    case 'burst': for (const i of e.tiles) R.markDirty(i, true); R.ring(e.x, e.y, PAL.waterLight, 90, 1); R.burst(e.x, e.y, 'drop', 26, PAL.waterLight); audio.play('splash', { gain: 1, rate: 0.8 }); R.kick(4, 220); buzz(25); toast('HYDRANT', 'Now it is a spring', 'Open water soaks everything within a few paces.'); break;
    case 'veg': R.markDirty(e.i); break;
    case 'bloom': { const p = tileXY(e.i); if (onScreen(p.x, p.y)) R.ring(p.x, p.y, sim.light[e.i] < 0.5 ? PAL.fern : PAL.flowers[(e.i * 7) % 5], 26, 0.8); break; }
    case 'species': { const s = SPECIES[e.id]; toast('NEW LIFE', s.name, s.line); audio.play('powerup', { gain: 0.4, rate: 0.9 + sim.speciesCount * 0.05 }); if (e.i >= 0) { const p = tileXY(e.i); R.ring(p.x, p.y, PAL.primary, 44, 1); } mixAudio(); break; }
    case 'stage': if (e.stage < 4) { const st = STAGES[e.stage]; stamp(`STAGE ${st.n}`, st.name, st.line); audio.play('powerup', { gain: 0.55, rate: 0.7 }); } R.ring(sim.nx[0], sim.ny[0], PAL.primary, 150, 1.6); mixAudio(); break;
    case 'offer': { const forSim = sim; setTimeout(() => { if (sim === forSim && sim.pendingOffer === e.options && G.state === 'playing') openEvolve(e.options); }, reduced ? 50 : 1900); break; }
    case 'evolved': {
      refreshEvos(); audio.play('powerup', { gain: 0.6, rate: 1.15 }); R.flipbook(sim.nx[0], sim.ny[0], 0.8);
      for (let i = 0, n = 0; i < sim.nx.length && n < 12; i++) if (sim.nk[i] === 0) { R.pulseAlong(i, PAL.primary); n++; }
      if (e.id === 'seeking') G.ui.mainHint = !sim.mainBurst;
      if (e.id === 'pressure') R.kick(3, 200);
      break;
    }
    case 'climb': { const b = e.b; R.label((b.x + b.w / 2) * sim.TS, b.y * sim.TS, 'CLIMBING', PAL.primary); audio.play('click', { gain: 0.6, rate: 0.8 }); break; }
    case 'garden': toast('KEPT', INSPECT.garden[0], INSPECT.garden[1]); audio.play('powerup', { gain: 0.5, rate: 1 }); break;
    case 'collapse': {
      const b = e.b; R.startCollapse(b); R.kick(7, 650); buzz(60); audio.play('thud', { gain: 1, rate: 0.5 }); audio.play('thud', { gain: 0.8, rate: 0.62, delay: 0.18 }); audio.play('hit', { gain: 0.7, rate: 0.5, delay: 0.3 });
      for (const i of e.tiles) { const p = tileXY(i); R.burst(p.x, p.y, 'dust', 5, '#b9b8b0'); R.burst(p.x, p.y, 'chip', 3, '#8a8b86'); }
      R.rebuildAll(); toast('FELLED', b.name, 'The shade is gone. The rubble will take a while to become anything.'); break;
    }
    case 'rain': audio.level('rain', 0.45, 3); G.rainTarget = 1; toast('WEATHER', 'Rain', 'Every patch of soil drinks, whether you reached it or not.'); break;
    case 'rainEnd': audio.level('rain', 0, 5); G.rainTarget = 0; break;
    case 'pond': for (const i of e.tiles) R.markDirty(i, true); { const p = tileXY(e.tiles[0]); R.ring(p.x + sim.TS / 2, p.y + sim.TS / 2, PAL.waterLight, 80, 1.2); } toast('POND', 'The fountain works again', 'Under new management.'); break;
    case 'win': win(); break;
  }
}

// ---------------------------------------------------------------- loop
let last = performance.now(), hudAcc = 0, soilAcc = 0, rustleNodes = 0, slowAvg = 17, slowN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = now - last, dt = Math.min(0.05, raw / 1000); last = now; G.time += dt;
  if (raw < 250) { slowAvg += (raw - slowAvg) * 0.05; if (++slowN > 90 && slowAvg > 38 && (R.quality || 1) > 0.5) { R.quality = (R.quality || 1) > 0.8 ? 0.75 : 0.5; R.resize(); slowN = 0; slowAvg = 17; } }
  const live = G.state === 'playing' && !G.paused;
  if (cam.to) { const c = cam.to; c.t += dt / c.secs; const k = c.t >= 1 ? 1 : 1 - Math.pow(1 - c.t, 3); cam.x = c.x0 + (c.x - c.x0) * k; cam.y = c.y0 + (c.y - c.y0) * k; cam.z = c.z0 + (c.z - c.z0) * k; if (c.t >= 1) cam.to = null; clampCam(); }
  else if (G.state === 'title' && !reduced) { cam.x = sim.W / 2 + Math.sin(G.time * 0.07) * 60; cam.y = sim.W / 2 + Math.cos(G.time * 0.05) * 60; }
  if (live) {
    const sp = 520 * dt / cam.z; let moved = false;
    if (keys.has('arrowleft') || keys.has('a')) { cam.x -= sp; moved = true; } if (keys.has('arrowright') || keys.has('d')) { cam.x += sp; moved = true; }
    if (keys.has('arrowup') || keys.has('w')) { cam.y -= sp; moved = true; } if (keys.has('arrowdown') || keys.has('s')) { cam.y += sp; moved = true; }
    if (moved) { cam.to = null; clampCam(); }
    G.ui.hold = null;
    if (gesture && gesture.mode === 'grow') {
      // near the screen edge the world slides under the finger, so one drag can cross the whole intersection
      const m = 54, ex = gesture.x < m ? -1 : gesture.x > innerWidth - m ? 1 : 0, ey = gesture.y < m + 40 ? -1 : gesture.y > innerHeight - m - 60 ? 1 : 0;
      if (ex || ey) { cam.x += ex * 300 * dt / cam.z; cam.y += ey * 300 * dt / cam.z; clampCam(); }
      const w = toWorld(gesture.x, gesture.y), before = sim.nx.length, why = sim.growToward(w.x, w.y, dt);
      if (sim.nx.length > before) { rustleNodes += sim.nx.length - before; audio.rustle(Math.min(1, (sim.nx.length - before) / 2)); }
      if (why && now - G.lastWhy > 700) { G.lastWhy = now; R.label(sim.g.hx, sim.g.hy, why === 'sun' ? 'NO SUN' : why === 'wall' ? 'WALL' : 'EDGE OF THE MAP'); audio.play('blip', { gain: 0.35, rate: 0.7 }); if (why === 'sun') flash('sunMeter'); }
    } else if (gesture && gesture.mode === 'pending' && now - gesture.t >= FEEL.hold_to_crack_delay_ms && !G.watching) {
      const w = toWorld(gesture.x, gesture.y), info = sim.holdInfo(Math.floor(w.x / sim.TS), Math.floor(w.y / sim.TS));
      if (info) { gesture.mode = 'hold'; $('inspect').hidden = true; buzz(4); }
    }
    if (gesture && gesture.mode === 'hold') {
      const w = toWorld(gesture.x, gesture.y), tx = Math.floor(w.x / sim.TS), ty = Math.floor(w.y / sim.TS), info = sim.holdInfo(tx, ty);
      if (info) {
        let p = info.kind === 'crack' ? sim.crack[info.i] : info.kind === 'hydrant' ? sim.hydrant.hold : info.b.crush;
        if (info.ok) { p = sim.hold(info, dt); if (info.kind === 'constrict' && Math.random() < dt * 5) { audio.creak(); R.kick(1.5, 120); } }
        else if (now - G.lastWhy > 900) { G.lastWhy = now; R.label((tx + 0.5) * sim.TS, (ty + 0.5) * sim.TS, info.why === 'water' ? (sim.waterGroups ? 'NO WATER' : 'FIND WATER FIRST') : 'OUT OF REACH'); audio.play('blip', { gain: 0.35, rate: 0.7 }); if (info.why === 'water') flash('waterMeter'); }
        if (p >= 0) G.ui.hold = { tx, ty, p, ok: info.ok };
      }
    }
    sim.update(dt);
    for (const e of sim.ev) handle(e); sim.ev.length = 0;
    G.saveAt += dt; if (G.saveAt > 10) { G.saveAt = 0; saveNow(); }
    soilAcc += dt; if (soilAcc > 2.5) { soilAcc = 0; R.refreshSoil(); }
  }
  hudAcc += dt; if (hudAcc > 0.1) { hudAcc = 0; refreshHud(); if (!$('inspect').hidden && now - G.inspectAt > 4200) $('inspect').hidden = true; }
  G.rainLevel += ((G.rainTarget || 0) - G.rainLevel) * Math.min(1, dt * 1.2);
  const ui = G.ui; ui.rain = G.rainLevel;
  const teaching = G.state === 'playing' && !G.watching;
  ui.teachTip = teaching && !sim.flags.grew; ui.teachTo = ui.teachTip ? sim.hydrant : null;
  ui.target = teaching && sim.flags.grew && !sim.hydrant.connected ? { x: sim.hydrant.x, y: sim.hydrant.y, col: PAL.waterLight } : null;
  ui.reachHint = teaching && sim.hydrant.connected && !sim.flags.cracked ? 'walk' : gesture && gesture.mode === 'hold' ? 'all' : null;
  R.frame(cam, G.time, live ? dt : G.state === 'title' || G.state === 'over' ? dt : 0, ui);
}
requestAnimationFrame(frame);

// measured by PLAYCRAFT and the feature tests; not part of the game
const probe = {
  get state() { return G.state === 'title' ? 'title' : G.state === 'over' ? 'over' : 'playing'; },
  get paused() { return G.paused; }, get score() { return Math.round(sim.alive * 10) / 10; }, get time() { return Math.round(sim.time * 10) / 10; },
  get sun() { return Math.round(sim.sun * 10) / 10; }, get water() { return Math.round(sim.water * 10) / 10; }, get stage() { return sim.stage + 1; },
  get species() { return sim.speciesCount; }, get nodes() { return sim.nx.length; }, get slabsBroken() { return sim.stats.broken + sim.stats.byRoots; },
  get cover() { return Math.round(sim.metrics.cover * 1000) / 10; }, get cornersLinked() { return Math.round(sim.metrics.link * 4); }, get waterSources() { return sim.waterGroups; },
  get muted() { return audio.muted; }, get best() { return store.get('reclaim_best', 0); },
};
window.__game = probe; window.game = probe;
Object.defineProperty(window, '__reclaim', { value: { get sim() { return sim; }, cam, R, G, toWorld, begin }, enumerable: false });
