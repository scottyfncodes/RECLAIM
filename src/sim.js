// RECLAIM simulation: the grid, the vine, water, soil, succession. No drawing, no DOM.
import { FEEL, T, PAVED, TOUGH, ALIVE, EVO_OFFERS } from './config.js';

export const hash = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const MAP = { a: T.ASPHALT, p: T.LOT, s: T.WALK, c: T.PLAZA, d: T.SOIL, B: T.BUILDING, f: T.BASIN };
const GATE = [0, 0, 0.2, 0.4, 0.6, 0.8];   // soil health needed to enter each vegetation stage

export class Sim {
  constructor(level, save) {
    const N = this.N = level.size, TS = this.TS = level.tile, n = N * N;
    this.level = level; this.W = N * TS;
    this.type = new Uint8Array(n); this.crack = new Float32Array(n); this.moist = new Float32Array(n);
    this.health = new Float32Array(n); this.veg = new Float32Array(n); this.light = new Float32Array(n);
    this.dest = new Uint8Array(n); this.rubble = new Uint8Array(n); this.mush = new Uint8Array(n);
    this.reach = new Uint8Array(n); this.irr = new Uint8Array(n); this.ncount = new Uint16Array(n);
    this.bld = new Int8Array(n).fill(-1); this.orig = new Uint8Array(n);
    this.buildings = level.buildings.map(b => ({ ...b, state: 'intact', ivy: 0, crush: 0, touched: false }));
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, t = MAP[level.map[y][x]];
      this.type[i] = this.orig[i] = t;
      if (t === T.SOIL) this.health[i] = 0.1 + hash(x, y, 3) * 0.08;
      const r = hash(x, y, 7); this.dest[i] = r < 0.2 ? 5 : r < 0.48 ? 4 : 3;
    }
    this.buildings.forEach((b, k) => { for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) this.bld[y * N + x] = k; });
    for (const [x, y] of level.precracked) this.crack[y * N + x] = 0.36;
    this.props = level.props.map(p => ({ ...p }));
    const hy = this.props.find(p => p.kind === 'hydrant');
    this.hydrant = { x: (hy.x + 0.5) * TS, y: (hy.y + 0.5) * TS, tx: hy.x, ty: hy.y, connected: false, burst: false, hold: 0 };
    this.mainRow = level.main.row; this.mainBurst = false;
    this.nx = []; this.ny = []; this.np = []; this.nk = [];
    this.sunNodes = 0; this.quadNodes = [0, 0, 0, 0];
    this.sun = FEEL.start_sun; this.water = FEEL.start_water; this.sunCap = 12; this.waterCap = 8;
    this.sunRate = 0; this.waterRate = 0; this.waterGroups = 0;
    this.evo = {}; this.offers = 0; this.pendingOffer = null;
    this.species = {}; this.speciesCount = 0;
    this.stage = 0; this.alive = 0; this.raw = 0;
    this.metrics = { cover: 0, soil: 0, link: 0, species: 0, linked: [false, false, false, false], trees: 0, flowers: 0, waterTiles: 0, restored: 0 };
    this.stats = { broken: 0, byRoots: 0, felled: 0, gardens: 0 };
    this.time = 0; this.state = 'title'; this.won = false; this.tickAcc = 0;
    this.rain = 0; this.nextRain = -1; this.rained = false; this.basinFull = false;
    this.flags = { grew: false, cracked: false };
    this.ev = []; this.g = null;
    this.computeLight();
    if (save) this.load(save);
    else this.addNode((level.start.x + 0.5) * TS, (level.start.y + 0.62) * TS, -1);
    this.measure();
  }

  // ---------- helpers
  ti(wx, wy) { const N = this.N, x = Math.floor(wx / this.TS), y = Math.floor(wy / this.TS); return x < 0 || y < 0 || x >= N || y >= N ? -1 : y * N + x; }
  emit(t, d = {}) { this.ev.push({ t, ...d }); }
  irrR() { return (this.evo.seeking ? FEEL.irrigate_tiles_seeking : FEEL.irrigate_tiles) * this.TS; }

  computeLight() {
    const N = this.N; this.light.fill(1);
    for (const b of this.buildings) {
      if (b.state === 'rubble') continue;
      const L = b.height >= 2 ? 2 : 1;
      for (let y = b.y; y < b.y + b.h + L; y++) for (let x = b.x; x < b.x + b.w + L; x++) {
        if (x >= N || y >= N) continue;
        let sh = false;
        for (let d = 1; d <= L && !sh; d++) sh = x - d >= b.x && x - d < b.x + b.w && y - d >= b.y && y - d < b.y + b.h;
        if (sh && this.bld[y * N + x] < 0) this.light[y * N + x] = 0.3;
      }
    }
    this.sunNodes = 0;
    for (let i = 0; i < this.nx.length; i++) { const t = this.ti(this.nx[i], this.ny[i]); if (t >= 0 && this.light[t] > 0.5) this.sunNodes++; }
  }

  markAround(arr, wx, wy, R) {
    const N = this.N, TS = this.TS, x0 = Math.max(0, Math.floor((wx - R) / TS)), x1 = Math.min(N - 1, Math.floor((wx + R) / TS));
    const y0 = Math.max(0, Math.floor((wy - R) / TS)), y1 = Math.min(N - 1, Math.floor((wy + R) / TS));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5) * TS - wx, dy = (y + 0.5) * TS - wy;
      if (dx * dx + dy * dy <= R * R) arr[y * N + x] = 1;
    }
  }
  remarkIrrigation() { this.irr.fill(0); const R = this.irrR(); for (let i = 0; i < this.nx.length; i++) this.markAround(this.irr, this.nx[i], this.ny[i], R); }

  // ---------- the vine
  addNode(x, y, parent, quiet) {
    const i = this.nx.length; this.nx.push(x); this.ny.push(y); this.np.push(parent); this.nk.push(0);
    if (parent >= 0) this.nk[parent]++;
    const t = this.ti(x, y);
    if (t >= 0) {
      this.ncount[t]++;
      if (this.light[t] > 0.5) this.sunNodes++;
      const N = this.N, q = ((t % N) >= N / 2 ? 1 : 0) + ((t / N | 0) >= N / 2 ? 2 : 0); this.quadNodes[q]++;
      if (this.bld[t] >= 0) { const b = this.buildings[this.bld[t]]; if (b.state !== 'rubble' && !b.touched) { b.touched = true; if (!quiet) this.emit('climb', { b }); } }
    }
    this.markAround(this.reach, x, y, FEEL.root_reach_tiles * this.TS);
    this.markAround(this.irr, x, y, this.irrR());
    if (!this.hydrant.connected) {
      const dx = x - this.hydrant.x, dy = y - this.hydrant.y;
      if (dx * dx + dy * dy < (this.TS * 0.95) ** 2) { this.hydrant.connected = true; this.water = Math.max(this.water, 5); if (!quiet) this.emit('water', { node: i, x: this.hydrant.x, y: this.hydrant.y }); }
    }
    if (!quiet) this.emit('node', { i });
    return i;
  }
  isTip(i) { return this.nk[i] === 0; }
  passable(wx, wy) {
    const t = this.ti(wx, wy); if (t < 0) return 'edge';
    if (this.type[t] === T.BUILDING && !this.evo.climbing) return 'wall';
    return null;
  }
  startGrow(node) { this.g = { last: node, hx: this.nx[node], hy: this.ny[node], dx: 0, dy: 0, acc: 0, added: 0, wob: Math.random() * 6.28 }; }
  growToward(wx, wy, dt) {
    const g = this.g; if (!g) return null;
    let tx = wx - g.hx, ty = wy - g.hy; const d = Math.hypot(tx, ty); if (d < 5) return null;
    tx /= d; ty /= d;
    const turn = g.dx === 0 && g.dy === 0 ? 1 : 1 - Math.exp(-dt * 16);
    g.dx += (tx - g.dx) * turn; g.dy += (ty - g.dy) * turn;
    const l = Math.hypot(g.dx, g.dy) || 1; g.dx /= l; g.dy /= l;
    let left = Math.min(FEEL.grow_speed_tiles_per_s * this.TS * dt, d - 3), blocked = null;
    const costPx = FEEL.grow_cost_sun_per_tile / this.TS, SEG = FEEL.segment_length_px;
    while (left > 0.01) {
      const s = Math.min(left, 4); left -= s;
      if (this.sun < s * costPx) { blocked = 'sun'; break; }
      let nxp = g.hx + g.dx * s, nyp = g.hy + g.dy * s, why = this.passable(nxp, nyp);
      if (why) {   // slide along the obstacle
        if (!this.passable(nxp, g.hy)) nyp = g.hy; else if (!this.passable(g.hx, nyp)) nxp = g.hx; else { blocked = why; break; }
        if (Math.hypot(nxp - g.hx, nyp - g.hy) < 0.4) { blocked = why; break; }
      }
      const moved = Math.hypot(nxp - g.hx, nyp - g.hy);
      g.hx = nxp; g.hy = nyp; g.acc += moved; this.sun -= moved * costPx;
      if (g.acc >= SEG) {
        g.wob += 0.9; const w = Math.sin(g.wob) * 1.6;
        g.last = this.addNode(g.hx - g.dy * w, g.hy + g.dx * w, g.last); g.acc = 0; g.added++; this.flags.grew = true;
      }
    }
    return blocked;
  }
  endGrow() {
    const g = this.g; if (!g) return 0;
    if (g.acc > 5) { g.last = this.addNode(g.hx, g.hy, g.last); g.added++; }
    this.g = null; if (g.added) this.emit('anchor', { i: g.last });
    return g.added;
  }

  // ---------- breaking things (always for what grows after)
  holdInfo(tx, ty) {
    const N = this.N; if (tx < 0 || ty < 0 || tx >= N || ty >= N) return null;
    const i = ty * N + tx, t = this.type[i];
    if (tx === this.hydrant.tx && ty === this.hydrant.ty && !this.hydrant.burst) return { kind: 'hydrant', i, ok: !!this.reach[i], why: this.reach[i] ? null : 'reach' };
    if (t === T.BUILDING) {
      const b = this.buildings[this.bld[i]];
      if (!this.evo.constrict || b.state !== 'intact') return null;
      return { kind: 'constrict', i, b, ok: !!this.reach[i] && this.water > 0.2, why: !this.reach[i] ? 'reach' : this.water > 0.2 ? null : 'water' };
    }
    if (PAVED(t)) return { kind: 'crack', i, ok: !!this.reach[i] && this.water > 0.15, why: !this.reach[i] ? 'reach' : this.water > 0.15 ? null : 'water' };
    return null;
  }
  // returns progress 0..1 of the thing being held, or -1 when it just completed
  hold(info, dt) {
    if (info.kind === 'hydrant') {
      const h = this.hydrant; h.hold += dt * 1000 / FEEL.hydrant_burst_ms;
      if (h.hold >= 1) { this.burstHydrant(); return -1; }
      return h.hold;
    }
    if (info.kind === 'constrict') {
      const b = info.b, dur = FEEL.constrict_ms / 1000;
      this.water = Math.max(0, this.water - FEEL.constrict_cost_water * dt / dur); b.crush += dt / dur;
      if (b.crush >= 1) { this.collapse(b); return -1; }
      return b.crush;
    }
    const i = info.i, tough = TOUGH(this.type[i]), fast = this.evo.pressure ? 0.5 : 1;
    const dur = (tough ? FEEL.crack_asphalt_ms : FEEL.crack_sidewalk_ms) / 1000 * fast;
    const cost = tough ? FEEL.crack_cost_water_asphalt : FEEL.crack_cost_water_sidewalk;
    const before = this.crack[i]; this.crack[i] += dt / dur; this.water = Math.max(0, this.water - cost * dt / dur);
    if (this.crack[i] >= 1) { this.breakTile(i, 'player'); return -1; }
    if ((before < 0.34 && this.crack[i] >= 0.34) || (before < 0.67 && this.crack[i] >= 0.67)) this.emit('fracture', { i });
    return this.crack[i];
  }
  breakTile(i, cause) {
    const N = this.N, x = i % N, y = i / N | 0, was = this.type[i];
    if (!PAVED(was)) return;
    this.crack[i] = 1;
    if (y === this.mainRow && (was === T.ASPHALT)) {
      this.type[i] = T.WATER; this.moist[i] = 1;
      const first = !this.mainBurst; this.mainBurst = true;
      this.emit('break', { i, cause, wet: true }); if (first) this.emit('main', { i });
    } else {
      this.type[i] = T.SOIL; this.health[i] = TOUGH(was) ? 0.05 : 0.1; this.veg[i] = 0; this.rubble[i] = 0;
      this.emit('break', { i, cause });
    }
    if (cause === 'player') { this.stats.broken++; this.flags.cracked = true; } else if (cause === 'roots') this.stats.byRoots++;
    if (cause === 'player' && this.evo.pressure) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ax = x + dx, ay = y + dy; if (ax < 0 || ay < 0 || ax >= N || ay >= N) continue;
        const j = ay * N + ax; if (!PAVED(this.type[j])) continue;
        this.crack[j] = Math.min(0.97, this.crack[j] + (TOUGH(this.type[j]) ? 0.22 : 0.34)); this.emit('fracture', { i: j, quiet: true });
      }
    }
  }
  burstHydrant() {
    const h = this.hydrant, N = this.N; h.burst = true; const tiles = [];
    for (const dy of [-1, 0, 1]) { const i = (h.ty + dy) * N + h.tx + 1; if (PAVED(this.type[i]) || this.type[i] === T.SOIL) { this.type[i] = T.WATER; this.crack[i] = 1; this.moist[i] = 1; tiles.push(i); } }
    this.emit('burst', { tiles, x: h.x, y: h.y });
  }
  collapse(b) {
    const N = this.N; b.state = 'rubble'; this.stats.felled++; const tiles = [];
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      const i = y * N + x; this.type[i] = T.SOIL; this.bld[i] = -1; this.rubble[i] = 1; this.health[i] = 0.03; this.veg[i] = 0; this.crack[i] = 1; tiles.push(i);
    }
    this.computeLight(); this.emit('collapse', { b, tiles });
  }
  choose(id) {
    this.evo[id] = true; this.pendingOffer = null;
    if (id === 'seeking') this.remarkIrrigation();
    this.emit('evolved', { id });
  }

  // ---------- time
  update(dt) {
    if (this.state !== 'playing' || this.pendingOffer) return;
    this.time += dt;
    // sun: leaves in light, plus what the living ground gives back
    const m = this.metrics; let gardenSun = 0;
    for (const b of this.buildings) if (b.state !== 'rubble') gardenSun += b.ivy * b.w * b.h * 0.07;
    this.sunCap = 14 + this.nx.length * 0.03 + m.restored * 0.06;
    this.sunRate = (0.6 + this.sunNodes * 0.011 + m.restored * 0.014 + gardenSun) * (this.rain > 0 ? 0.6 : 1);
    this.sun = Math.min(this.sunCap, this.sun + this.sunRate * dt);
    this.waterCap = 8 + Math.max(0, this.waterGroups - 1) * 5 + (this.evo.seeking ? 4 : 0);
    this.waterRate = this.waterGroups ? (0.8 + (this.waterGroups - 1) * 0.45) * (this.evo.seeking ? 1.35 : 1) + (this.rain > 0 ? 0.6 : 0) : (this.rain > 0 ? 0.4 : 0);
    this.water = Math.min(this.waterCap, this.water + this.waterRate * dt);
    if (this.rain > 0) { this.rain -= dt; if (this.rain <= 0) { this.rain = 0; this.emit('rainEnd'); } }
    this.tickAcc += dt;
    while (this.tickAcc >= 0.2) { this.tickAcc -= 0.2; this.tick(0.2); }
  }

  tick(dt) {
    const N = this.N, n = N * N, type = this.type, moist = this.moist, veg = this.veg, health = this.health;
    const connected = this.waterGroups > 0, raining = this.rain > 0, late = this.stage >= 3;
    // water tiles and sources wet the ground around them
    const prox = this._prox || (this._prox = new Float32Array(n)); prox.fill(0);
    const wet = (cx, cy, R, s) => {
      for (let y = Math.max(0, cy - R); y <= Math.min(N - 1, cy + R); y++) for (let x = Math.max(0, cx - R); x <= Math.min(N - 1, cx + R); x++) {
        const d = Math.hypot(x - cx, y - cy), v = s * Math.max(0, 1 - Math.max(0, d - 1) / (R - 0.4)); const j = y * N + x; if (v > prox[j]) prox[j] = v;
      }
    };
    let groups = 0, gh = this.hydrant.connected, gm = false, gb = false;
    for (let i = 0; i < n; i++) if (type[i] === T.WATER) {
      const x = i % N, y = i / N | 0; wet(x, y, 3, 1);
      if (this.reach[i]) { if (this.orig[i] === T.BASIN) gb = true; else if (y === this.mainRow) gm = true; else gh = true; }
    }
    wet(this.hydrant.tx, this.hydrant.ty, 2, 0.7);
    groups = (gh ? 1 : 0) + (gm ? 1 : 0) + (gb ? 1 : 0);
    if (groups > this.waterGroups && this.waterGroups > 0) this.emit('source', { groups });
    this.waterGroups = groups;

    const stepRate = 1 / FEEL.succession_step_s, mossRate = 1 / FEEL.moss_appears_s;
    for (let i = 0; i < n; i++) {
      const t = type[i], x = i % N, y = i / N | 0;
      if (t === T.SOIL) {
        // moisture: from the vine (it carries water), from open water, from planted neighbours, from rain
        let target = Math.max(prox[i], this.irr[i] ? (connected ? 0.78 : 0.14) : 0);
        let nv = 0, nm = 0;
        if (x > 0) { const j = i - 1; if (type[j] === T.SOIL) { nv += veg[j]; if (veg[j] >= 1.5) nm = Math.max(nm, moist[j]); } }
        if (x < N - 1) { const j = i + 1; if (type[j] === T.SOIL) { nv += veg[j]; if (veg[j] >= 1.5) nm = Math.max(nm, moist[j]); } }
        if (y > 0) { const j = i - N; if (type[j] === T.SOIL) { nv += veg[j]; if (veg[j] >= 1.5) nm = Math.max(nm, moist[j]); } }
        if (y < N - 1) { const j = i + N; if (type[j] === T.SOIL) { nv += veg[j]; if (veg[j] >= 1.5) nm = Math.max(nm, moist[j]); } }
        target = Math.max(target, nm * 0.84, raining ? 0.85 : 0);
        moist[i] += (target - moist[i]) * dt * (target > moist[i] ? 0.55 : 0.03);
        const m = moist[i], L = this.light[i], shade = L < 0.5, rub = this.rubble[i];
        const cap = shade ? Math.min(3, this.dest[i]) : this.dest[i];
        const before = veg[i];
        if (m > 0.22 && veg[i] < cap) {
          const next = Math.min(5, Math.floor(veg[i] + 1e-4) + 1);
          if (health[i] >= GATE[next] || veg[i] < next - 1 + 0.999) {
            const lim = health[i] >= GATE[next] ? cap : next - 1 + 0.999;
            const rate = (veg[i] < 1 ? mossRate : stepRate) * Math.min(1, m / 0.6) * (shade ? 0.65 : 1) * (rub ? 0.5 : 1);
            veg[i] = Math.min(lim, veg[i] + rate * dt);
          }
        } else if (m < 0.1 && veg[i] > 0.6) veg[i] = Math.max(0.6, veg[i] - dt * 0.015);
        const fungi = this.mush[i] ? 1.6 : 1;
        health[i] = Math.min(1, health[i] + dt * (m > 0.2 ? 1 : 0.25) * (rub ? 0.55 : 1) * fungi * (0.0015 + 0.006 * Math.min(veg[i], 3) / 3 + 0.0025 * nv / 20));
        if (!this.mush[i] && veg[i] >= 1 && (rub || shade) && health[i] > 0.3 && hash(x, y, 11) < 0.5) { this.mush[i] = 1; this.found('mushroom', i); this.emit('veg', { i }); }
        const b4 = Math.floor(before * 4), a4 = Math.floor(veg[i] * 4);
        if (a4 !== b4) {
          this.emit('veg', { i });
          if (before < 1 && veg[i] >= 1) this.found('moss', i);
          if (before < 2 && veg[i] >= 2) this.found(shade ? 'fern' : 'grass', i);
          if (before < 3 && veg[i] >= 3) { this.found(shade ? 'fern' : 'wildflower', i); this.emit('bloom', { i }); }
          if (before < 4 && veg[i] >= 4) this.found('shrub', i);
          if (before < 5 && veg[i] >= 5) this.found('tree', i);
        }
      } else if (PAVED(t)) {
        // roots of established plants keep prying at the slab next door
        let push = 0;
        if (x > 0 && type[i - 1] === T.SOIL && veg[i - 1] >= 2) push += veg[i - 1];
        if (x < N - 1 && type[i + 1] === T.SOIL && veg[i + 1] >= 2) push += veg[i + 1];
        if (y > 0 && type[i - N] === T.SOIL && veg[i - N] >= 2) push += veg[i - N];
        if (y < N - 1 && type[i + N] === T.SOIL && veg[i + N] >= 2) push += veg[i + N];
        if (push > 0) {
          const before = this.crack[i];
          this.crack[i] += dt * push / 5 / (TOUGH(t) ? 150 : 75) * (late ? 1.8 : 1) * (0.6 + hash(x, y, 5) * 0.8);
          if (this.crack[i] >= 1) this.breakTile(i, 'roots');
          else if ((before < 0.34 && this.crack[i] >= 0.34) || (before < 0.67 && this.crack[i] >= 0.67)) this.emit('fracture', { i, quiet: true });
        }
      }
    }
    for (const b of this.buildings) if (b.state !== 'rubble' && b.touched && b.ivy < 1) {
      const before = b.ivy; b.ivy = Math.min(1, b.ivy + dt / (b.w * b.h * 1.9));
      if (before === 0) this.found('ivy', b.y * N + b.x);
      if (b.ivy >= 1) { b.state = 'garden'; this.stats.gardens++; this.emit('garden', { b }); }
    }
    // weather
    if (!this.rained && this.alive >= 14) { this.rained = true; this.startRain(); }
    else if (this.rained && this.rain <= 0 && this.time > this.nextRain) this.startRain();
    if (this.rained && !this.basinFull && this.rain > 0 && this.rain < 10) {
      this.basinFull = true; const tiles = [];
      for (let i = 0; i < n; i++) if (type[i] === T.BASIN) { type[i] = T.WATER; moist[i] = 1; tiles.push(i); }
      if (tiles.length) this.emit('pond', { tiles });
    }
    this.measure();
  }
  startRain() { this.rain = 20; this.nextRain = this.time + 20 + 120 + Math.random() * 60; this.emit('rain'); }
  found(id, i) { if (this.species[id]) return; this.species[id] = this.time || 0.01; this.speciesCount++; this.emit('species', { id, i }); }

  measure() {
    const N = this.N, n = N * N, m = this.metrics; let cover = 0, soil = 0, trees = 0, flowers = 0, wt = 0, restored = 0;
    const quad = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const t = this.type[i], q = ((i % N) >= N / 2 ? 1 : 0) + ((i / N | 0) >= N / 2 ? 2 : 0); let w = 0;
      if (t === T.SOIL) {
        const v = this.veg[i]; w = v < 1 ? v * 0.4 : Math.min(1, 0.4 + (v - 1) * 0.6); soil += this.health[i];
        if (v >= 5) trees++; if (v >= 3 && this.light[i] > 0.5) flowers++; if (v >= 2) restored++;
      } else if (t === T.WATER) { w = 1; wt++; restored++; }
      else if (t === T.BUILDING) { w = this.buildings[this.bld[i]].ivy; restored += w; }
      cover += w; quad[q] += w;
    }
    m.cover = cover / n; m.soil = Math.min(1, soil / (n * 0.45)); m.trees = trees; m.flowers = flowers; m.waterTiles = wt; m.restored = restored;
    let link = 0; for (let q = 0; q < 4; q++) { m.linked[q] = quad[q] >= 6 && this.quadNodes[q] > 0; if (m.linked[q]) link++; }
    m.link = link / 4;
    if (flowers >= 6) this.found('pollinator', -1);
    if (trees >= 3 || this.buildings.some(b => b.state === 'garden')) this.found('bird', -1);
    if (wt >= 3 && this.speciesCount >= 3) this.found('dragonfly', -1);
    m.species = Math.min(1, this.speciesCount / ALIVE.species_target);
    // living ground is the base; variety, connection and soil multiply it. Variety on a doormat of moss is worth little.
    this.raw = Math.min(1, m.cover / ALIVE.cover_target) * (ALIVE.w_cover + ALIVE.w_species * m.species + ALIVE.w_link * m.link + ALIVE.w_soil * m.soil);
    const alive = Math.min(100, this.raw / ALIVE.win_raw * 100);
    this.alive = Math.max(this.alive, alive);   // the headline never goes backwards
    if (this.state !== 'playing') return;
    let st = 0; for (let k = 0; k < ALIVE.stage_at.length; k++) if (this.alive >= ALIVE.stage_at[k]) st = k;
    if (st > this.stage) {
      this.stage = st; this.emit('stage', { stage: st });
      if (st >= 4 && !this.won) { this.won = true; this.state = 'over'; this.emit('win'); }
    }
    if (!this.pendingOffer && this.offers < EVO_OFFERS.length && this.stage >= this.offers + 1 && !this.won) {
      this.pendingOffer = EVO_OFFERS[this.offers++]; this.emit('offer', { options: this.pendingOffer });
    }
  }

  // ---------- persistence
  save() {
    const r = a => Array.from(a, v => Math.round(v * 1000) / 1000);
    return {
      v: 2, type: Array.from(this.type), crack: r(this.crack), moist: r(this.moist), health: r(this.health), veg: r(this.veg),
      rubble: Array.from(this.rubble), mush: Array.from(this.mush),
      nodes: this.nx.map((x, i) => [Math.round(x * 10) / 10, Math.round(this.ny[i] * 10) / 10, this.np[i]]),
      buildings: this.buildings.map(b => ({ state: b.state, ivy: b.ivy, crush: b.crush, touched: b.touched })),
      hydrant: { connected: this.hydrant.connected, burst: this.hydrant.burst }, mainBurst: this.mainBurst,
      sun: this.sun, water: this.water, evo: this.evo, offers: this.offers, pendingOffer: this.pendingOffer, species: this.species,
      stage: this.stage, alive: this.alive, stats: this.stats, time: this.time, won: this.won,
      rain: 0, nextRain: this.nextRain, rained: this.rained, basinFull: this.basinFull, flags: this.flags,
    };
  }
  load(s) {
    const N = this.N;
    this.type.set(s.type); this.crack.set(s.crack); this.moist.set(s.moist); this.health.set(s.health); this.veg.set(s.veg);
    this.rubble.set(s.rubble); this.mush.set(s.mush);
    s.buildings.forEach((b, k) => Object.assign(this.buildings[k], b));
    this.buildings.forEach((b, k) => { if (b.state === 'rubble') for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) this.bld[y * N + x] = -1; });
    Object.assign(this.hydrant, s.hydrant); this.mainBurst = s.mainBurst;
    this.evo = s.evo || {}; this.offers = s.offers; this.pendingOffer = s.pendingOffer || null; this.species = s.species || {};
    this.speciesCount = Object.keys(this.species).length;
    this.stage = s.stage; this.alive = s.alive; this.stats = s.stats; this.time = s.time; this.won = s.won;
    this.nextRain = s.nextRain; this.rained = s.rained; this.basinFull = s.basinFull; this.flags = s.flags || this.flags;
    this.computeLight();
    for (const [x, y, p] of s.nodes) this.addNode(x, y, p, true);
    this.sun = s.sun; this.water = s.water;
    if (this.hydrant.connected) this.waterGroups = 1;
  }
}
