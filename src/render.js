// RECLAIM renderer. Human things: ruled, axis-aligned, still. Living things: curved, irregular, moving.
import { PAL, T, PAVED, FEEL } from './config.js';
import { hash } from './sim.js';

const TAU = Math.PI * 2;
const mix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), l = (u, v) => Math.max(0, Math.min(255, Math.round(u + (v - u) * t)));
  return '#' + ((1 << 24) | (l(pa >> 16, pb >> 16) << 16) | (l((pa >> 8) & 255, (pb >> 8) & 255) << 8) | l(pa & 255, pb & 255)).toString(16).slice(1);
};
const shadeHex = (hex, k) => mix(hex, k < 0 ? '#000000' : '#ffffff', Math.abs(k));
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); return c; };

export class Renderer {
  constructor(canvas, sim, opts = {}) {
    this.cv = canvas; this.cx = canvas.getContext('2d', { alpha: false }); this.sim = sim;
    this.reduced = !!opts.reduced;
    const TS = sim.TS, W = sim.W;
    this.LS = opts.layerScale || 2;
    this.ground = mk(W * this.LS, W * this.LS); this.gx = this.ground.getContext('2d', { alpha: false });
    this.cover = mk(W * this.LS, W * this.LS); this.cvx = this.cover.getContext('2d');
    this.vine = mk(W * this.LS, W * this.LS); this.vx = this.vine.getContext('2d');
    for (const c of [this.gx, this.cvx, this.vx]) c.scale(this.LS, this.LS);
    this.dirty = new Set(); this.drawnH = new Float32Array(sim.N * sim.N); this.drawnM = new Float32Array(sim.N * sim.N);
    this.desc = []; this.vineDrawn = 0;
    this.parts = []; this.labels = []; this.books = []; this.pulses = [];
    this.shake = 0; this.shakeT = 0; this.fauna = { flies: [], birds: [], dragons: [], motes: [] };
    this.treeAge = new Float32Array(sim.N * sim.N);
    this.collapsing = [];
    this.vw = 1; this.vh = 1; this.dpr = 1;
    this.makeSprites();
    this.rebuildAll();
  }

  resize() {
    const dpr = this.dpr = Math.min(window.devicePixelRatio || 1, 2) * (this.quality || 1);
    this.vw = window.innerWidth; this.vh = window.innerHeight;
    this.cv.width = Math.round(this.vw * dpr); this.cv.height = Math.round(this.vh * dpr);
  }

  rebuildAll() {
    const s = this.sim; this.gx.fillStyle = PAL.asphalt; this.gx.fillRect(0, 0, s.W, s.W);
    for (let y = 0; y < s.N; y++) for (let x = 0; x < s.N; x++) this.drawGroundTile(x, y);
    this.cvx.clearRect(0, 0, s.W, s.W); this.coverUsed = false;
    for (let y = 0; y < s.N; y++) for (let x = 0; x < s.N; x++) this.drawCoverTile(this.cvx, x, y);
    this.rebuildVine(); this.dirty.clear();
    for (let i = 0; i < s.N * s.N; i++) { this.drawnH[i] = s.health[i]; this.drawnM[i] = s.moist[i]; if (s.veg[i] >= 4) this.treeAge[i] = 1; }
  }
  markDirty(i, withNeighbours) {
    this.dirty.add(i);
    if (withNeighbours) { const N = this.sim.N, x = i % N, y = i / N | 0; if (x > 0) this.dirty.add(i - 1); if (x < N - 1) this.dirty.add(i + 1); if (y > 0) this.dirty.add(i - N); if (y < N - 1) this.dirty.add(i + N); }
  }
  flushDirty() {
    if (!this.dirty.size) return;
    const s = this.sim, N = s.N, TS = s.TS; let budget = 14;
    for (const i of this.dirty) {
      const x = i % N, y = i / N | 0; this.drawGroundTile(x, y); this.drawnH[i] = s.health[i]; this.drawnM[i] = s.moist[i];
      const c = this.cvx, pad = 22, rx = x * TS - pad, ry = y * TS - pad, rw = TS + pad * 2;
      c.save(); c.beginPath(); c.rect(rx, ry, rw, rw); c.clip(); c.clearRect(rx, ry, rw, rw);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(N - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(N - 1, x + 1); xx++) this.drawCoverTile(c, xx, yy);
      c.restore(); this.dirty.delete(i); if (--budget <= 0) break;
    }
  }
  // soil darkens as it gets wetter and richer; repaint tiles that drifted
  refreshSoil() {
    const s = this.sim;
    for (let i = 0; i < s.N * s.N; i++) if (s.type[i] === T.SOIL && (Math.abs(s.health[i] - this.drawnH[i]) > 0.07 || Math.abs(s.moist[i] - this.drawnM[i]) > 0.2)) this.dirty.add(i);
  }

  // ------------------------------------------------------------------ ground (the human layer)
  drawGroundTile(x, y) {
    const s = this.sim, c = this.gx, TS = s.TS, N = s.N, i = y * N + x, t = s.type[i], o = s.orig[i], px = x * TS, py = y * TS;
    const R = k => hash(x, y, k);
    c.save(); c.beginPath(); c.rect(px, py, TS, TS); c.clip();
    const base = o === T.ASPHALT ? PAL.asphalt : o === T.LOT ? PAL.asphaltLot : o === T.WALK ? PAL.concrete : PAL.plaza;
    if (o === T.SOIL) { c.fillStyle = PAL.plaza; c.fillRect(px, py, TS, TS); }
    else {
      c.fillStyle = shadeHex(base, (R(1) - 0.5) * 0.07); c.fillRect(px, py, TS, TS);
      if (o === T.ASPHALT || o === T.LOT) {
        for (let k = 0; k < 16; k++) { c.fillStyle = k % 3 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.16)'; c.fillRect(px + R(20 + k) * TS, py + R(40 + k) * TS, 1.6, 1.6); }
        if (R(9) < 0.22) { c.fillStyle = 'rgba(0,0,0,0.055)'; c.beginPath(); c.ellipse(px + R(10) * TS, py + R(11) * TS, 7 + R(12) * 8, 4 + R(13) * 5, R(14) * 3, 0, TAU); c.fill(); }
        this.paint(c, x, y, px, py, o);
      } else {
        c.strokeStyle = PAL.seam; c.lineWidth = 1.2; c.globalAlpha = 0.7; c.beginPath();
        c.moveTo(px + 0.6, py); c.lineTo(px + 0.6, py + TS); c.moveTo(px, py + 0.6); c.lineTo(px + TS, py + 0.6);
        if (o === T.PLAZA || o === T.BASIN || o === T.BUILDING) { c.moveTo(px + TS / 2, py); c.lineTo(px + TS / 2, py + TS); c.moveTo(px, py + TS / 2); c.lineTo(px + TS, py + TS / 2); }
        c.stroke(); c.globalAlpha = 1;
        if (R(15) < 0.25) { c.fillStyle = 'rgba(40,38,34,0.05)'; c.beginPath(); c.ellipse(px + R(16) * TS, py + R(17) * TS, 5 + R(18) * 8, 3 + R(19) * 5, R(14) * 3, 0, TAU); c.fill(); }
        if (o === T.WALK) {   // kerb where the sidewalk meets the road
          const tt = (xx, yy) => xx < 0 || yy < 0 || xx >= N || yy >= N ? -1 : s.orig[yy * N + xx];
          c.fillStyle = '#a9aaa4'; const k = 5;
          if (tt(x + 1, y) === T.ASPHALT) { c.fillRect(px + TS - k, py, k, TS); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(px + TS - 1, py, 1, TS); c.fillStyle = '#a9aaa4'; }
          if (tt(x - 1, y) === T.ASPHALT) { c.fillRect(px, py, k, TS); c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(px + k, py, 1, TS); c.fillStyle = '#a9aaa4'; }
          if (tt(x, y + 1) === T.ASPHALT) { c.fillRect(px, py + TS - k, TS, k); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(px, py + TS - 1, TS, 1); c.fillStyle = '#a9aaa4'; }
          if (tt(x, y - 1) === T.ASPHALT) { c.fillRect(px, py, TS, k); c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(px, py + k, TS, 1); }
        }
        if (o === T.BASIN) this.basin(c, false);
      }
    }
    if (t === T.SOIL || t === T.WATER) this.hole(c, x, y, px, py, t, o);
    else if (s.crack[i] > 0.02 && PAVED(t)) this.cracks(c, x, y, px, py, s.crack[i]);
    c.restore();
  }
  basin(c, wet) {
    const TS = this.sim.TS, cx0 = 14 * TS, cy0 = 14 * TS;
    c.fillStyle = wet ? PAL.water : '#8d8c85'; c.beginPath(); c.arc(cx0, cy0, TS * 0.86, 0, TAU); c.fill();
    c.strokeStyle = '#bdbcb4'; c.lineWidth = 6; c.stroke(); c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 1.2; c.beginPath(); c.arc(cx0, cy0, TS * 0.86 - 3.4, 0, TAU); c.stroke();
    if (!wet) { c.fillStyle = '#77766f'; c.beginPath(); c.arc(cx0, cy0, 7, 0, TAU); c.fill(); }
  }
  paint(c, x, y, px, py, o) {
    const TS = this.sim.TS, R = k => hash(x, y, k);
    c.save(); c.globalAlpha = 0.62;
    if (o === T.LOT) {
      c.fillStyle = PAL.paintWhite;
      if (y === 1 || y === 2 || y === 4 || y === 5) { c.fillRect(px, py, 2.4, TS); if (y === 1 || y === 4) c.fillRect(px, py, TS, 2.4); }
      c.restore(); return;
    }
    const road = v => v === 8 || v === 9, inBox = road(x) && road(y);
    if (!inBox) {
      c.fillStyle = PAL.paintYellow;
      if (road(x) && !(y === 7 || y === 10)) { const lx = x === 8 ? px + TS - 2 : px; for (let k = 0; k < 2; k++) if (R(60 + k) > 0.12) c.fillRect(lx, py + 6 + k * 28, 2, 17); }
      if (road(y) && !(x === 7 || x === 10)) { const ly = y === 8 ? py + TS - 2 : py; for (let k = 0; k < 2; k++) if (R(62 + k) > 0.12) c.fillRect(px + 6 + k * 28, ly, 17, 2); }
      c.fillStyle = PAL.paintWhite;
      if (road(x) && (y === 7 || y === 10)) for (let k = 0; k < 4; k++) if (R(70 + k) > 0.1) c.fillRect(px + 5 + k * 14, py + 7, 7, TS - 14);
      if (road(y) && (x === 7 || x === 10)) for (let k = 0; k < 4; k++) if (R(74 + k) > 0.1) c.fillRect(px + 7, py + 5 + k * 14, TS - 14, 7);
    }
    c.restore();
  }
  crackLines(x, y, px, py, level) {
    const TS = this.sim.TS, R = k => hash(x, y, k), ox = px + TS * (0.35 + R(30) * 0.3), oy = py + TS * (0.35 + R(31) * 0.3);
    const rays = level < 0.34 ? 2 : level < 0.67 ? 3 : 5, a0 = R(32) * TAU, lines = [];
    for (let r = 0; r < rays; r++) {
      let a = a0 + r * (TAU / rays) + (R(33 + r) - 0.5) * 0.5, cx0 = ox, cy0 = oy; const pts = [[ox, oy]];
      const reach = TS * (level < 0.34 ? 0.34 : level < 0.5 ? 0.62 : 0.8);
      for (let k = 0; k < 4; k++) { a += (R(40 + r * 5 + k) - 0.5) * 0.8; cx0 += Math.cos(a) * reach / 4; cy0 += Math.sin(a) * reach / 4; pts.push([cx0, cy0]); }
      lines.push(pts);
    }
    return lines;
  }
  cracks(c, x, y, px, py, level) {
    const lines = this.crackLines(x, y, px, py, level);
    c.lineJoin = 'miter'; c.lineCap = 'butt';
    for (let pass = 0; pass < 2; pass++) {
      c.strokeStyle = pass ? PAL.crack : 'rgba(255,255,255,0.10)'; c.lineWidth = pass ? 0.9 + level * 1.4 : 0.8;
      c.beginPath(); for (const pts of lines) { c.moveTo(pts[0][0] + (pass ? 0 : 1), pts[0][1] + (pass ? 0 : 1)); for (let k = 1; k < pts.length; k++) c.lineTo(pts[k][0] + (pass ? 0 : 1), pts[k][1] + (pass ? 0 : 1)); } c.stroke();
    }
  }
  hole(c, x, y, px, py, t, o) {
    const s = this.sim, TS = s.TS, N = s.N, i = y * N + x, R = k => hash(x, y, k);
    const open = (xx, yy) => xx >= 0 && yy >= 0 && xx < N && yy < N && (s.type[yy * N + xx] === T.SOIL || s.type[yy * N + xx] === T.WATER);
    const straight = o === T.SOIL, basin = o === T.BASIN;
    if (basin) { this.basin(c, true); return; }
    const ins = (isOpen, k) => isOpen ? -3 : straight ? 2.5 : 3.5 + R(k) * 6.5;
    const top = open(x, y - 1), right = open(x + 1, y), bot = open(x, y + 1), left = open(x - 1, y);
    const pts = [], f = [0.06, 0.34, 0.66, 0.94];
    for (let k = 0; k < 4; k++) pts.push([px + f[k] * TS, py + ins(top, 80 + k)]);
    for (let k = 0; k < 4; k++) pts.push([px + TS - ins(right, 84 + k), py + f[k] * TS]);
    for (let k = 3; k >= 0; k--) pts.push([px + f[k] * TS, py + TS - ins(bot, 88 + k)]);
    for (let k = 3; k >= 0; k--) pts.push([px + ins(left, 92 + k), py + f[k] * TS]);
    c.beginPath(); pts.forEach((p, k) => k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath();
    if (t === T.WATER) { c.fillStyle = PAL.water; c.fill(); c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 3; c.stroke(); return; }
    const h = s.health[i], m = s.moist[i];
    c.fillStyle = mix(mix(PAL.soilDry, PAL.soilRich, Math.min(1, h * 1.1)), '#1c140e', m * 0.28); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.42)'; c.lineWidth = 3; c.stroke();
    c.save(); c.clip();
    for (let k = 0; k < 12; k++) { c.fillStyle = k % 2 ? 'rgba(0,0,0,.16)' : 'rgba(255,240,210,.09)'; c.beginPath(); c.arc(px + R(100 + k) * TS, py + R(120 + k) * TS, 1 + R(140 + k) * 1.6, 0, TAU); c.fill(); }
    // what is left of the slab
    const chunks = s.rubble[i] ? 11 : straight ? 0 : 4, col = s.rubble[i] ? '#8a8b86' : o === T.ASPHALT || o === T.LOT ? '#4a4d51' : '#9a9b95';
    for (let k = 0; k < chunks; k++) {
      const edge = !s.rubble[i], a = R(150 + k) * TAU, d = edge ? TS * (0.3 + R(160 + k) * 0.16) : TS * R(160 + k) * 0.46;
      const cx0 = px + TS / 2 + Math.cos(a) * d, cy0 = py + TS / 2 + Math.sin(a) * d, r = (s.rubble[i] ? 3 : 2.2) + R(170 + k) * (s.rubble[i] ? 5.5 : 3.2), rot = R(180 + k) * TAU;
      c.fillStyle = shadeHex(col, (R(190 + k) - 0.5) * 0.2); c.beginPath();
      for (let v = 0; v < 5; v++) { const va = rot + v * TAU / 5, vr = r * (0.7 + hash(x * 7 + v, y * 5 + k, 3) * 0.5); v ? c.lineTo(cx0 + Math.cos(va) * vr, cy0 + Math.sin(va) * vr) : c.moveTo(cx0 + Math.cos(va) * vr, cy0 + Math.sin(va) * vr); }
      c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 0.8; c.stroke();
    }
    c.restore();
  }

  // ------------------------------------------------------------------ ground cover (moss, grass, flowers, ferns, fungi)
  drawCoverTile(c, x, y) {
    const s = this.sim, TS = s.TS, i = y * s.N + x; if (s.type[i] !== T.SOIL) return;
    const v = s.veg[i]; if (v <= 0.02) return;
    this.coverUsed = true;
    const px = x * TS, py = y * TS, R = k => hash(x, y, k), shade = s.light[i] < 0.5;
    const v1 = Math.min(1, v), v2 = Math.max(0, Math.min(1, v - 1)), v3 = Math.max(0, Math.min(1, v - 2));
    const blob = (bx, by, r, col) => { c.fillStyle = col; c.beginPath(); c.arc(bx, by, r, 0, TAU); c.fill(); };
    // a clump is never a disc: three lobes, slightly apart
    const clump = (bx, by, r, col, k) => { c.fillStyle = col; c.beginPath(); for (let q = 0; q < 3; q++) { const a = R(k) * TAU + q * 2.1, d = r * 0.5; c.moveTo(bx + Math.cos(a) * d + r * 0.72, by + Math.sin(a) * d); c.arc(bx + Math.cos(a) * d, by + Math.sin(a) * d, r * (0.62 + R(k + q) * 0.2), 0, TAU); } c.fill(); };
    const mossCols = shade ? [PAL.mossShade, '#55733f', '#415a37'] : [PAL.moss, '#74883f', '#566c33'];
    const n1 = Math.round(v1 * 14);
    for (let k = 0; k < n1; k++) { const bx = px + 6 + R(200 + k) * (TS - 12), by = py + 6 + R(210 + k) * (TS - 12), rr = 3.2 + R(220 + k) * 5.2; if (v2 < 0.5) clump(bx + 0.8, by + 1.5, rr + 0.4, 'rgba(14,28,12,.3)', 400 + k); clump(bx, by, rr, mossCols[k % 3], 400 + k); }
    if (v2 > 0) {
      const g = shade ? [PAL.grassShade, '#3c6f42', '#4f8a4c', PAL.grassShade] : [PAL.grass, '#538c3b', '#6da847', PAL.grassLight];
      if (v2 >= 0.95) { c.fillStyle = g[0]; c.fillRect(px + 2, py + 2, TS - 4, TS - 4); }
      const n2 = Math.round(v2 * 13);
      for (let k = 0; k < n2; k++) {
        const e = k < 8 && v2 > 0.7;   // push some blobs to the rim so the patch has no straight edge
        const bx = e ? px + (k % 2 ? R(230 + k) * TS : (k % 4 < 2 ? 2 : TS - 2)) : px + 6 + R(230 + k) * (TS - 12);
        const by = e ? py + (k % 2 ? (k % 4 < 2 ? 2 : TS - 2) : R(240 + k) * TS) : py + 6 + R(240 + k) * (TS - 12);
        const rr = 8 + R(250 + k) * 9; if (e) clump(bx + 1.2, by + 2.4, rr + 0.6, 'rgba(14,32,14,.35)', 420 + k); clump(bx, by, rr, g[k % 4], 420 + k);
      }
      if (v2 > 0.4) { c.strokeStyle = shade ? 'rgba(20,50,30,.35)' : 'rgba(40,80,25,.38)'; c.lineWidth = 1.1; c.lineCap = 'round'; c.beginPath(); for (let k = 0; k < 12; k++) { const bx = px + R(260 + k) * TS, by = py + R(270 + k) * TS; c.moveTo(bx, by); c.lineTo(bx + (R(280 + k) - 0.5) * 4, by - 3.5 - R(290 + k) * 3.5); } c.stroke(); }
    }
    if (v3 > 0) {
      if (shade) {   // fern rosettes
        const nf = 1 + (R(300) > 0.5 ? 1 : 0);
        for (let f = 0; f < nf; f++) {
          const fx = px + TS * (0.28 + R(301 + f) * 0.44), fy = py + TS * (0.28 + R(303 + f) * 0.44), rr = (8 + R(305 + f) * 6) * (0.4 + 0.6 * v3), a0 = R(307 + f) * TAU;
          for (let k = 0; k < 7; k++) { const a = a0 + k * TAU / 7; c.strokeStyle = k % 2 ? PAL.fern : '#56a86a'; c.lineWidth = 3.2; c.lineCap = 'round'; c.beginPath(); c.moveTo(fx, fy); c.quadraticCurveTo(fx + Math.cos(a + 0.4) * rr * 0.6, fy + Math.sin(a + 0.4) * rr * 0.6, fx + Math.cos(a) * rr, fy + Math.sin(a) * rr); c.stroke(); }
          blob(fx, fy, 1.8, '#2c6a40');
        }
      } else {
        const nf = Math.round(v3 * (5 + R(310) * 5)), c1 = PAL.flowers[(R(311) * 5) | 0], c2 = PAL.flowers[(R(312) * 5) | 0];
        for (let k = 0; k < nf; k++) {
          const fx = px + 5 + R(320 + k) * (TS - 10), fy = py + 5 + R(340 + k) * (TS - 10), r = 2.2 + R(360 + k) * 1.5, col = k % 3 ? c1 : c2;
          c.fillStyle = 'rgba(20,50,20,.35)'; c.beginPath(); c.arc(fx + 0.8, fy + 1.2, r + 0.4, 0, TAU); c.fill();
          for (let p = 0; p < 5; p++) { const a = p * TAU / 5 + k; blob(fx + Math.cos(a) * r * 0.62, fy + Math.sin(a) * r * 0.62, r * 0.58, col); }
          blob(fx, fy, r * 0.42, col === PAL.flowers[1] ? '#8a5a1c' : '#f6d860');
        }
      }
    }
    if (s.mush[i]) for (let k = 0; k < 3; k++) {
      const mx = px + 9 + R(380 + k) * (TS - 18), my = py + 9 + R(384 + k) * (TS - 18), r = 2.6 + R(388 + k) * 2;
      blob(mx + 0.8, my + 1.3, r, 'rgba(0,0,0,.3)'); blob(mx, my, r, k % 2 ? '#d9c7a4' : '#b9684a'); blob(mx - r * 0.25, my - r * 0.25, r * 0.4, 'rgba(255,255,255,.4)');
    }
  }

  // ------------------------------------------------------------------ the vine
  rebuildVine() {
    const s = this.sim, n = s.nx.length, d = this.desc = new Array(n).fill(0);
    for (let i = n - 1; i > 0; i--) d[s.np[i]] += d[i] + 1;
    this.vx.clearRect(0, 0, s.W, s.W);
    for (let pass = 0; pass < 3; pass++) for (let i = 1; i < n; i++) this.vineSeg(i, pass);
    this.vineDrawn = n;
  }
  width(i) { return 2.3 + Math.min(6.2, Math.sqrt(this.desc[i] || 0) * 0.34); }
  vineSeg(i, pass) {
    const s = this.sim, c = this.vx, p = s.np[i]; if (p < 0) return;
    const x0 = s.nx[p], y0 = s.ny[p], x1 = s.nx[i], y1 = s.ny[i], w = this.width(i);
    const t = s.ti(x1, y1), dim = t >= 0 && s.light[t] < 0.5;
    c.lineCap = 'round';
    if (pass === 0) { c.strokeStyle = w > 6 ? '#3d3524' : '#2f5422'; c.lineWidth = w + 2.2; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
    else if (pass === 1) {
      c.strokeStyle = w > 6 ? PAL.wood : dim ? '#447038' : PAL.stem; c.lineWidth = w; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      c.strokeStyle = w > 6 ? '#8a7150' : dim ? '#5f9a4c' : PAL.stemLight; c.lineWidth = Math.max(0.9, w * 0.34); c.beginPath(); c.moveTo(x0 - 0.5, y0 - 0.7); c.lineTo(x1 - 0.5, y1 - 0.7); c.stroke();
    } else if (hash(i, 3, 1) < 0.78) {
      const a = Math.atan2(y1 - y0, x1 - x0), side = i % 2 ? 1 : -1, la = a + side * (0.75 + hash(i, 4, 1) * 0.6), len = 8.5 + hash(i, 5, 1) * 5.5, wd = len * 0.42;
      const bx = x1 + Math.cos(a + side * 1.57) * w * 0.4, by = y1 + Math.sin(a + side * 1.57) * w * 0.4, ex = bx + Math.cos(la) * len, ey = by + Math.sin(la) * len;
      const nxp = -Math.sin(la) * wd, nyp = Math.cos(la) * wd, mx = bx + Math.cos(la) * len * 0.45, my = by + Math.sin(la) * len * 0.45;
      const col = dim ? (i % 3 ? '#5b9448' : '#4c8040') : (i % 3 ? PAL.leaf : PAL.leafDark);
      c.fillStyle = 'rgba(18,40,14,.4)'; c.beginPath(); c.moveTo(bx + 1, by + 1.6); c.quadraticCurveTo(mx + nxp + 1, my + nyp + 1.6, ex + 1, ey + 1.6); c.quadraticCurveTo(mx - nxp + 1, my - nyp + 1.6, bx + 1, by + 1.6); c.fill();
      c.fillStyle = col; c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(mx + nxp, my + nyp, ex, ey); c.quadraticCurveTo(mx - nxp, my - nyp, bx, by); c.fill();
      c.strokeStyle = 'rgba(30,70,20,.5)'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + Math.cos(la) * len * 0.8, by + Math.sin(la) * len * 0.8); c.stroke();
    }
  }
  addVineNodes() {   // draw nodes added since the last pass
    const n = this.sim.nx.length;
    for (let i = this.vineDrawn; i < n; i++) { this.desc[i] = 0; for (let pass = 0; pass < 3; pass++) this.vineSeg(i, pass); }
    this.vineDrawn = n;
  }

  // ------------------------------------------------------------------ sprites
  makeSprites() {
    const S = 2; this.SS = S;
    this.trees = [0, 1, 2].map(v => {
      const cv = mk(110 * S, 120 * S), c = cv.getContext('2d'); c.scale(S, S); const R = k => hash(v, k, 91);
      c.fillStyle = PAL.wood; c.fillRect(52, 86, 6, 22); c.fillStyle = '#4e3b27'; c.fillRect(56, 86, 2, 22);
      const blobs = []; for (let k = 0; k < 11; k++) { const a = k * 2.4 + R(k), d = k === 0 ? 0 : 12 + R(20 + k) * 20; blobs.push([55 + Math.cos(a) * d, 52 + Math.sin(a) * d * 0.82, 15 + R(40 + k) * 9]); }
      c.fillStyle = '#2b5a2d'; for (const b of blobs) { c.beginPath(); c.arc(b[0] + 2, b[1] + 3, b[2] + 1.5, 0, TAU); c.fill(); }
      c.fillStyle = PAL.tree; for (const b of blobs) { c.beginPath(); c.arc(b[0], b[1], b[2], 0, TAU); c.fill(); }
      c.fillStyle = PAL.treeMid; for (const b of blobs) { c.beginPath(); c.arc(b[0] - 3.5, b[1] - 4.5, b[2] * 0.66, 0, TAU); c.fill(); }
      c.fillStyle = PAL.treeLight; blobs.forEach((b, k) => { if (k % 2 === 0) { c.beginPath(); c.arc(b[0] - 6.5, b[1] - 8, b[2] * 0.3, 0, TAU); c.fill(); } });
      return cv;
    });
    this.shrubs = [0, 1, 2].map(v => {
      const cv = mk(56 * S, 52 * S), c = cv.getContext('2d'); c.scale(S, S); const R = k => hash(v, k, 77);
      const blobs = []; for (let k = 0; k < 6; k++) blobs.push([28 + (R(k) - 0.5) * 22, 28 + (R(10 + k) - 0.5) * 14, 8 + R(20 + k) * 5]);
      c.fillStyle = '#31613a'; for (const b of blobs) { c.beginPath(); c.arc(b[0] + 1.2, b[1] + 2, b[2] + 1, 0, TAU); c.fill(); }
      c.fillStyle = '#4c8a44'; for (const b of blobs) { c.beginPath(); c.arc(b[0], b[1], b[2], 0, TAU); c.fill(); }
      c.fillStyle = '#6fae4f'; for (const b of blobs) { c.beginPath(); c.arc(b[0] - 2, b[1] - 2.6, b[2] * 0.55, 0, TAU); c.fill(); }
      if (v === 1) { c.fillStyle = '#e8528c'; for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(14 + R(30 + k) * 28, 18 + R(40 + k) * 20, 1.7, 0, TAU); c.fill(); } }
      if (v === 2) { c.fillStyle = '#f4efe2'; for (let k = 0; k < 7; k++) { c.beginPath(); c.arc(14 + R(30 + k) * 28, 18 + R(40 + k) * 20, 1.5, 0, TAU); c.fill(); } }
      return cv;
    });
    this.bsprites = this.sim.buildings.map(b => this.buildingSprite(b, false));
    this.isprites = this.sim.buildings.map(b => this.buildingSprite(b, true));
  }
  wallH(b) { return b.height * 11 + 7; }
  buildingSprite(b, ivy) {
    const S = this.SS, TS = this.sim.TS, w = b.w * TS, h = b.h * TS, wh = this.wallH(b), in_ = 3;
    const cv = mk(w * S, (h + wh) * S), c = cv.getContext('2d'); c.scale(S, S); const R = k => hash(b.x * 13 + k, b.y * 7, 55);
    const rx = in_, ry = 0, rw = w - in_ * 2, rh = h - in_, wy = rh;   // roof rect, then the south wall under it
    if (!ivy) {
      c.fillStyle = b.id === 'shop' ? '#6b6258' : PAL.wall; c.fillRect(rx, wy, rw, wh);
      const g = c.createLinearGradient(0, wy, 0, wy + wh); g.addColorStop(0, 'rgba(0,0,0,.28)'); g.addColorStop(0.25, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.2)'); c.fillStyle = g; c.fillRect(rx, wy, rw, wh);
      if (b.id === 'shop') {
        for (let k = 0; k < 12; k++) { c.fillStyle = k % 2 ? '#b9b0a0' : '#8f4f45'; c.fillRect(rx + 8 + k * ((rw - 16) / 12), wy + 2, (rw - 16) / 12, 6); }
        c.fillStyle = PAL.window; c.fillRect(rx + 12, wy + 10, rw * 0.42, wh - 12); c.fillRect(rx + rw * 0.62, wy + 10, rw * 0.14, wh - 10); c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(rx + 12, wy + 10, rw * 0.2, wh - 12);
      } else {
        const cols = 9, rows = 3, gw = (rw - 14) / cols;
        for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) { c.fillStyle = R(r * 20 + k) < 0.18 ? '#15181c' : R(r * 20 + k) < 0.3 ? '#4c5661' : PAL.window; c.fillRect(rx + 8 + k * gw, wy + 6 + r * 11, gw - 5, 7); }
      }
      c.fillStyle = b.id === 'shop' ? '#7d7971' : PAL.roof; c.fillRect(rx, ry, rw, rh);
      c.strokeStyle = 'rgba(255,255,255,.2)'; c.lineWidth = 2.4; c.strokeRect(rx + 1.2, ry + 1.2, rw - 2.4, rh - 2.4);
      c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 1; c.strokeRect(rx + 5, ry + 5, rw - 10, rh - 10);
      for (let k = 0; k < 3; k++) { c.fillStyle = 'rgba(0,0,0,.045)'; c.beginPath(); c.ellipse(rx + R(k) * rw, ry + R(10 + k) * rh, 12 + R(20 + k) * 16, 6 + R(30 + k) * 8, R(40 + k) * 3, 0, TAU); c.fill(); }
      const box = (x0, y0, bw, bh) => { c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(x0 + 3, y0 + 3, bw, bh); c.fillStyle = PAL.roofDark; c.fillRect(x0, y0, bw, bh); c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(x0, y0, bw, 2); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 0.8; c.strokeRect(x0, y0, bw, bh); };
      if (b.id === 'shop') { box(rx + 20, ry + 22, 30, 20); box(rx + rw - 54, ry + rh - 50, 22, 22); c.fillStyle = '#3a4046'; c.beginPath(); c.arc(rx + rw - 43, ry + rh - 39, 7, 0, TAU); c.fill(); }
      else {
        box(rx + 22, ry + 26, 40, 26); box(rx + 76, ry + 26, 40, 26); box(rx + rw - 70, ry + rh - 72, 34, 44);
        c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.arc(rx + 54, ry + rh - 56, 21, 0, TAU); c.fill(); c.fillStyle = '#676c70'; c.beginPath(); c.arc(rx + 50, ry + rh - 60, 20, 0, TAU); c.fill(); c.strokeStyle = 'rgba(0,0,0,.3)'; c.stroke(); c.fillStyle = '#7c8185'; c.beginPath(); c.arc(rx + 50, ry + rh - 60, 12, 0, TAU); c.fill();
        c.fillStyle = '#51606a'; c.fillRect(rx + rw - 96, ry + 30, 56, 34); c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1; c.strokeRect(rx + rw - 96, ry + 30, 56, 34); c.beginPath(); c.moveTo(rx + rw - 68, ry + 30); c.lineTo(rx + rw - 68, ry + 64); c.stroke();
      }
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(rx, wy, rw, 1.5);
    } else {
      const n = Math.round((w * (h + wh)) / 95), cols = ['#274f2b', '#356b35', '#4c8a40', '#74b04e'], keep = [];
      for (let k = 0; k < n; k++) {
        const bx = rx + R(100 + k) * rw, by = R(300 + k) * (rh + wh), edge = Math.min(bx - rx, rx + rw - bx, by, Math.max(0, rh - by) + (by > rh ? 0 : 0));
        const onWall = by > rh - 6; if (onWall || edge < 26 + R(900 + k) * 30 || R(950 + k) < 0.3) keep.push([bx, by, 6 + R(500 + k) * 8]);
      }
      for (let pass = 0; pass < 4; pass++) keep.forEach((b, k) => {
        if (pass === 3 && k % 4) return;
        const r = b[2] * (pass === 0 ? 1.15 : pass === 1 ? 1 : pass === 2 ? 0.58 : 0.26);
        c.fillStyle = cols[pass]; c.beginPath(); c.arc(b[0] - pass * 1.5 + (pass === 0 ? 1.5 : 0), b[1] - pass * 1.9 + (pass === 0 ? 2.5 : 0), r, 0, TAU); c.fill();
      });
      keep.forEach((b, k) => { if (k % 9 === 0 && b[1] < rh) { c.fillStyle = PAL.flowers[k % 5]; c.beginPath(); c.arc(b[0], b[1], 2, 0, TAU); c.fill(); } });
      c.globalCompositeOperation = 'destination-in'; c.fillStyle = '#000'; c.beginPath(); c.roundRect(rx - 1, ry - 1, rw + 2, rh + wh + 1, 6); c.fill();
    }
    return cv;
  }

  // ------------------------------------------------------------------ effects
  burst(x, y, kind, n, col) {
    if (this.parts.length > 420) return;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU, sp = kind === 'dust' ? 12 + Math.random() * 30 : kind === 'drop' ? 30 + Math.random() * 70 : 40 + Math.random() * 90;
      this.parts.push({ x: x + (Math.random() - 0.5) * 16, y: y + (Math.random() - 0.5) * 16, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === 'dust' ? 10 : 0), life: 0, max: kind === 'dust' ? 0.7 + Math.random() * 0.5 : 0.45 + Math.random() * 0.4, size: kind === 'dust' ? 5 + Math.random() * 7 : 1.6 + Math.random() * 2.4, col, kind, rot: Math.random() * TAU });
    }
  }
  ring(x, y, col, r1 = 46, dur = 0.7) { this.parts.push({ x, y, vx: 0, vy: 0, life: 0, max: dur, size: r1, col, kind: 'ring' }); }
  label(x, y, text, col = PAL.accent) { this.labels.push({ x, y, text, col, life: 0 }); if (this.labels.length > 4) this.labels.shift(); }
  flipbook(x, y, scale = 1) { if (this.fx) this.books.push({ x, y, t: 0, scale }); }
  pulseAlong(node, col) { const s = this.sim, path = []; let i = node; while (i >= 0) { path.push(i); i = s.np[i]; } this.pulses.push({ path, t: 0, col }); }
  kick(px, ms) { if (!this.reduced) { this.shake = px; this.shakeT = ms / 1000; this.shakeDur = ms / 1000; } }
  startCollapse(b) { this.collapsing.push({ b, t: 0, sprite: this.bsprites[this.sim.buildings.indexOf(b)] }); }

  // ------------------------------------------------------------------ frame
  frame(cam, time, dt, ui) {
    const s = this.sim, c = this.cx, TS = s.TS, N = s.N, z = cam.z, dpr = this.dpr, sway = this.reduced ? 0 : 1;
    this.flushDirty(); this.addVineNodes();
    let sx = 0, sy = 0;
    if (this.shakeT > 0) { this.shakeT -= dt; const k = this.shake * Math.max(0, this.shakeT / this.shakeDur); sx = (Math.random() - 0.5) * 2 * k; sy = (Math.random() - 0.5) * 2 * k; }
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = PAL.background; c.fillRect(0, 0, this.cv.width, this.cv.height);
    const ox = (this.vw / 2 - cam.x * z + sx) * dpr, oy = (this.vh / 2 - cam.y * z + sy) * dpr, k = z * dpr;
    c.setTransform(k, 0, 0, k, ox, oy);
    // visible world rect
    const wx0 = Math.max(0, cam.x - this.vw / 2 / z - 4), wy0 = Math.max(0, cam.y - this.vh / 2 / z - 4), wx1 = Math.min(s.W, cam.x + this.vw / 2 / z + 4), wy1 = Math.min(s.W, cam.y + this.vh / 2 / z + 4);
    if (wx1 <= wx0 || wy1 <= wy0) return;
    const L = this.LS, blit = cv => c.drawImage(cv, wx0 * L, wy0 * L, (wx1 - wx0) * L, (wy1 - wy0) * L, wx0, wy0, wx1 - wx0, wy1 - wy0);
    c.imageSmoothingQuality = 'low';
    if (wx0 <= 0 || wy0 <= 0 || wx1 >= s.W || wy1 >= s.W) {   // the rest of the city, implied
      const M = 700, W = s.W, r0 = 8 * TS, r1 = 10 * TS;
      c.fillStyle = '#3d403f'; c.fillRect(-M, -M, W + M * 2, W + M * 2);
      c.fillStyle = '#4b4e4d'; c.fillRect(-M, r0 - TS, W + M * 2, TS * 4); c.fillRect(r0 - TS, -M, TS * 4, W + M * 2);
      c.fillStyle = '#25272a'; c.fillRect(-M, r0, W + M * 2, TS * 2); c.fillRect(r0, -M, TS * 2, W + M * 2);
      c.fillStyle = '#2c2f31'; for (const [bx, by, bw, bh] of [[-380, -330, 300, 250], [-300, 190, 220, 180], [-420, 640, 340, 300], [W + 60, -300, 320, 240], [W + 90, 120, 260, 200], [W + 50, 650, 300, 260], [80, -360, 240, 290], [640, -330, 330, 260], [60, W + 60, 300, 260], [660, W + 80, 300, 300]]) c.fillRect(bx, by, bw, bh);
    }
    blit(this.ground);
    this.waterAnim(c, time, wx0, wy0, wx1, wy1);
    if (this.coverUsed) blit(this.cover);
    if (ui.mainHint) this.mainHint(c, time);
    // shadows fall down-right, over ground and cover
    c.fillStyle = 'rgba(8,12,18,.30)';
    for (const b of s.buildings) if (b.state !== 'rubble') {
      const Ls = (b.height >= 2 ? 2 : 1) * TS, x0 = b.x * TS, y0 = b.y * TS, x1 = x0 + b.w * TS, y1 = y0 + b.h * TS;
      c.beginPath(); c.moveTo(x1, y0); c.lineTo(x1 + Ls, y0 + Ls); c.lineTo(x1 + Ls, y1 + Ls); c.lineTo(x0 + Ls, y1 + Ls); c.lineTo(x0, y1); c.lineTo(x1, y1); c.closePath(); c.fill();
    }
    if (s.nx.length > 1) blit(this.vine);
    if (s.g) this.liveSegment(c);
    for (let q = this.pulses.length - 1; q >= 0; q--) {
      const p = this.pulses[q]; p.t += dt * 1.6; const head = p.t * p.path.length;
      c.strokeStyle = p.col; c.lineWidth = 4; c.lineCap = 'round'; c.globalAlpha = Math.max(0, 1 - p.t * 0.7); c.beginPath(); let started = false;
      for (let j = Math.max(0, (head - 14) | 0); j < Math.min(p.path.length, head | 0); j++) { const i = p.path[j]; started ? c.lineTo(s.nx[i], s.ny[i]) : c.moveTo(s.nx[i], s.ny[i]); started = true; }
      c.stroke(); c.globalAlpha = 1; if (p.t > 1.3) this.pulses.splice(q, 1);
    }
    if (ui.reachHint) this.reachHint(c, time, ui.reachHint);
    if (ui.hold) this.holdRing(c, ui.hold);
    this.standing(c, time, sway, wx0, wy0, wx1, wy1);
    this.tips(c, time, ui);
    if (ui.target) { const t = ui.target, r = 20 + Math.sin(time * 3) * 4; c.strokeStyle = t.col; c.lineWidth = 2.5 / Math.max(0.6, z); c.globalAlpha = 0.85; c.setLineDash([7, 6]); c.lineDashOffset = -time * 14; c.beginPath(); c.arc(t.x, t.y, r, 0, TAU); c.stroke(); c.setLineDash([]); c.globalAlpha = 1; }
    this.faunaDraw(c, time, dt, sway);
    this.particles(c, dt);
    // screen space: rain and labels (the colour grade and vignette are a composited layer in CSS)
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rain = ui.rain || 0;
    if (rain > 0.01 && !this.reduced) {
      c.strokeStyle = `rgba(190,215,235,${0.34 * rain})`; c.lineWidth = 1.2; c.beginPath();
      for (let q = 0; q < 70; q++) { const rx = (hash(q, 1, 9) * (this.vw + 200) + time * 140) % (this.vw + 200) - 100, ry = (hash(q, 2, 9) * this.vh + time * (700 + hash(q, 3, 9) * 300)) % this.vh; c.moveTo(rx, ry); c.lineTo(rx - 5, ry + 17); }
      c.stroke();
    }
    c.font = '600 13px "Barlow Condensed", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let q = this.labels.length - 1; q >= 0; q--) {
      const l = this.labels[q]; l.life += dt; if (l.life > 1.1) { this.labels.splice(q, 1); continue; }
      const px = (l.x - cam.x) * z + this.vw / 2, py = (l.y - cam.y) * z + this.vh / 2 - 34 - l.life * 16, al = Math.min(1, (1.1 - l.life) * 3), w = c.measureText(l.text).width + 16;
      c.globalAlpha = al; c.fillStyle = PAL.background; c.fillRect(px - w / 2, py - 11, w, 22); c.fillStyle = l.col; c.fillRect(px - w / 2, py + 9, w, 2); c.fillText(l.text, px, py + 0.5); c.globalAlpha = 1;
    }
  }

  waterAnim(c, time, wx0, wy0, wx1, wy1) {
    const s = this.sim, TS = s.TS, N = s.N, h = s.hydrant;
    // the leak: a slow puddle on the road side of the hydrant
    if (!h.burst) {
      c.fillStyle = 'rgba(70,130,150,.5)'; c.beginPath(); c.ellipse(h.x + 30, h.y + 6, 24, 15, 0.3, 0, TAU); c.fill(); c.beginPath(); c.ellipse(h.x + 44, h.y + 20, 13, 9, -0.4, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(190,230,240,.5)'; c.lineWidth = 1.1; const ph = (time * 0.7) % 1; c.globalAlpha = 1 - ph; c.beginPath(); c.ellipse(h.x + 26, h.y + 6, 3 + ph * 13, 2 + ph * 8, 0.3, 0, TAU); c.stroke(); c.globalAlpha = 1;
    }
    c.strokeStyle = 'rgba(200,236,244,.42)'; c.lineWidth = 1.3; c.lineCap = 'round';
    for (let y = Math.max(0, wy0 / TS | 0); y <= Math.min(N - 1, wy1 / TS | 0); y++) for (let x = Math.max(0, wx0 / TS | 0); x <= Math.min(N - 1, wx1 / TS | 0); x++) {
      if (s.type[y * N + x] !== T.WATER) continue;
      const px = x * TS, py = y * TS, flow = y === s.mainRow ? 1 : 0;
      c.beginPath();
      for (let q = 0; q < 3; q++) {
        const ph = (time * (flow ? 0.5 : 0.16) + hash(x, y, q)) % 1, rx = px + (flow ? ph * TS : 8 + hash(x, y, 10 + q) * (TS - 16)), ry = py + 9 + hash(x, y, 20 + q) * (TS - 18) + Math.sin(time * 1.3 + q + x) * 1.5, len = 6 + hash(x, y, 30 + q) * 9;
        if (rx + len < px + TS - 3) { c.moveTo(rx, ry); c.quadraticCurveTo(rx + len / 2, ry - 2, rx + len, ry); }
      }
      c.stroke();
    }
  }
  mainHint(c, time) {
    const s = this.sim, TS = s.TS, y = (s.mainRow + 0.5) * TS;
    c.strokeStyle = 'rgba(99,180,196,.75)'; c.lineWidth = 5; c.setLineDash([3, 13]); c.lineCap = 'round'; c.lineDashOffset = -time * 22; c.beginPath(); c.moveTo(0, y); c.lineTo(s.W, y); c.stroke(); c.setLineDash([]);
  }
  liveSegment(c) {
    const s = this.sim, g = s.g, x0 = s.nx[g.last], y0 = s.ny[g.last];
    c.lineCap = 'round'; c.strokeStyle = '#2f5422'; c.lineWidth = 4.4; c.beginPath(); c.moveTo(x0, y0); c.lineTo(g.hx, g.hy); c.stroke();
    c.strokeStyle = PAL.stemLight; c.lineWidth = 2.3; c.beginPath(); c.moveTo(x0, y0); c.lineTo(g.hx, g.hy); c.stroke();
  }
  reachHint(c, time, mode) {
    const s = this.sim, TS = s.TS, N = s.N, a = 0.35 + Math.sin(time * 4) * 0.2;
    c.strokeStyle = PAL.accent; c.lineWidth = 2; c.globalAlpha = a; c.beginPath();
    for (let i = 0; i < N * N; i++) if (s.reach[i] && PAVED(s.type[i]) && (mode !== 'walk' || s.type[i] === T.WALK || s.type[i] === T.PLAZA)) {
      const x = (i % N) * TS, y = (i / N | 0) * TS, q = 9, m = 5;
      c.moveTo(x + m, y + m + q); c.lineTo(x + m, y + m); c.lineTo(x + m + q, y + m);
      c.moveTo(x + TS - m - q, y + m); c.lineTo(x + TS - m, y + m); c.lineTo(x + TS - m, y + m + q);
      c.moveTo(x + TS - m, y + TS - m - q); c.lineTo(x + TS - m, y + TS - m); c.lineTo(x + TS - m - q, y + TS - m);
      c.moveTo(x + m + q, y + TS - m); c.lineTo(x + m, y + TS - m); c.lineTo(x + m, y + TS - m - q);
    }
    c.stroke(); c.globalAlpha = 1;
  }
  holdRing(c, hd) {
    const TS = this.sim.TS, x = (hd.tx + 0.5) * TS, y = (hd.ty + 0.5) * TS;
    c.strokeStyle = 'rgba(23,25,27,.75)'; c.lineWidth = 8; c.beginPath(); c.arc(x, y, 21, 0, TAU); c.stroke();
    c.strokeStyle = hd.ok ? PAL.accent : '#9a9b95'; c.lineWidth = 5; c.lineCap = 'butt'; c.beginPath(); c.arc(x, y, 21, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.02, hd.p)); c.stroke();
    if (hd.ok) { c.strokeStyle = PAL.accent; c.lineWidth = 2; c.strokeRect(hd.tx * TS + 2, hd.ty * TS + 2, TS - 4, TS - 4); }
  }

  tips(c, time, ui) {
    const s = this.sim, n = s.nx.length, grabbed = s.g ? s.g.last : -1, big = ui.teachTip;
    for (let i = 0; i < n; i++) if (s.nk[i] === 0 && i !== grabbed) {
      const ph = (time + i * 0.37) % 1, x = s.nx[i], y = s.ny[i];
      c.strokeStyle = PAL.primary; c.globalAlpha = (1 - ph) * 0.8; c.lineWidth = 2; c.beginPath(); c.arc(x, y, (big ? 9 : 6) + ph * (big ? 22 : 11), 0, TAU); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = '#17191b'; c.beginPath(); c.arc(x, y, 6.6, 0, TAU); c.fill();
      c.fillStyle = PAL.primary; c.beginPath(); c.arc(x, y, 5, 0, TAU); c.fill();
      c.fillStyle = '#e4f7c8'; c.beginPath(); c.arc(x - 1.3, y - 1.5, 1.9, 0, TAU); c.fill();
    }
    if (s.g) {
      const g = s.g; c.fillStyle = 'rgba(143,208,90,.25)'; c.beginPath(); c.arc(g.hx, g.hy, 15, 0, TAU); c.fill();
      c.fillStyle = '#17191b'; c.beginPath(); c.arc(g.hx, g.hy, 8.4, 0, TAU); c.fill(); c.fillStyle = PAL.primary; c.beginPath(); c.arc(g.hx, g.hy, 7, 0, TAU); c.fill(); c.fillStyle = '#e4f7c8'; c.beginPath(); c.arc(g.hx - 1.8, g.hy - 2, 2.6, 0, TAU); c.fill();
    }
    if (big && n > 0 && ui.teachTo) {   // one gesture, shown once: a dotted hint from the tip toward water
      const x = s.nx[n - 1], y = s.ny[n - 1], dx = ui.teachTo.x - x, dy = ui.teachTo.y - y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      for (let q = 0; q < 5; q++) { const ph = (time * 0.8 + q / 5) % 1, r = 16 + ph * 74; c.fillStyle = PAL.primary; c.globalAlpha = Math.sin(ph * Math.PI) * 0.9; c.beginPath(); c.arc(x + ux * r, y + uy * r, 3.2 - ph * 1.2, 0, TAU); c.fill(); }
      c.globalAlpha = 1;
    }
  }

  // props, shrubs, trees and buildings, back to front
  standing(c, time, sway, wx0, wy0, wx1, wy1) {
    const s = this.sim, TS = s.TS, N = s.N, S = this.SS, items = [];
    for (const p of s.props) items.push({ y: (p.y + 0.9) * TS, p });
    s.buildings.forEach((b, k) => { if (b.state !== 'rubble') items.push({ y: (b.y + b.h) * TS, b, k }); });
    for (const col of this.collapsing) items.push({ y: (col.b.y + col.b.h) * TS, col });
    for (let y = Math.max(0, (wy0 / TS | 0) - 1); y <= Math.min(N - 1, (wy1 / TS | 0) + 2); y++) for (let x = Math.max(0, (wx0 / TS | 0) - 1); x <= Math.min(N - 1, (wx1 / TS | 0) + 1); x++) {
      const i = y * N + x; if (s.type[i] !== T.SOIL || s.veg[i] < 3.5 || s.dest[i] < 4 || s.light[i] < 0.5) continue;
      items.push({ y: (y + 0.75) * TS + hash(x, y, 2) * 6, tile: i, x, ty: y });
    }
    items.sort((a, b) => a.y - b.y);
    // soft shadows first
    c.fillStyle = 'rgba(8,12,18,.24)';
    for (const it of items) if (it.tile !== undefined) {
      const v = s.veg[it.tile], tree = s.dest[it.tile] === 5 && v >= 4.02, g = this.growth(it.tile, v), cx0 = (it.x + 0.5) * TS + (hash(it.x, it.ty, 4) - 0.5) * 10, cy0 = (it.ty + 0.6) * TS;
      c.beginPath(); c.ellipse(cx0 + (tree ? 16 : 5) * g, cy0 + (tree ? 12 : 5) * g, (tree ? 34 : 15) * g, (tree ? 24 : 9) * g, 0.5, 0, TAU); c.fill();
    }
    for (const it of items) {
      if (it.p) this.prop(c, it.p, time);
      else if (it.b) this.building(c, it.b, it.k);
      else if (it.col) { const col = it.col, b = col.b, t = Math.min(1, col.t / 0.9), w = b.w * TS, wh = this.wallH(b), h = b.h * TS + wh, sq = 1 - t * t * 0.88; c.globalAlpha = 1 - t * t; c.drawImage(col.sprite, b.x * TS, b.y * TS - wh + h * (1 - sq), w, h * sq); c.globalAlpha = 1; }
      else {
        const i = it.tile, v = s.veg[i], x = it.x, y = it.ty, g = this.growth(i, v), ph = hash(x, y, 6) * TAU;
        const cx0 = (x + 0.5) * TS + (hash(x, y, 4) - 0.5) * 10, cy0 = (y + 0.6) * TS, variant = (hash(x, y, 8) * 3) | 0;
        if (s.dest[i] === 5 && v >= 4.02) {
          const sp = this.trees[variant], w = 110, h = 120, rot = Math.sin(time * 0.9 + ph) * 0.028 * sway;
          c.save(); c.translate(cx0, cy0 + 6); c.rotate(rot); c.scale(g, g); c.drawImage(sp, -55, -108, w, h); c.restore();
        } else {
          const sp = this.shrubs[variant], off = Math.sin(time * 1.3 + ph) * 0.9 * sway;
          c.drawImage(sp, cx0 - 28 * g + off, cy0 - 34 * g, 56 * g, 52 * g);
        }
      }
    }
    for (let q = this.collapsing.length - 1; q >= 0; q--) if (this.collapsing[q].t > 0.95) this.collapsing.splice(q, 1);
  }
  growth(i, v) {   // shrubs and trees ease in instead of popping
    const tree = this.sim.dest[i] === 5, target = tree ? (v >= 4.02 ? 0.45 + 0.55 * Math.min(1, v - 4) : Math.min(1, (v - 3.5) * 2) * 0.9) : Math.min(1, (v - 3.5) * 2);
    const a = this.treeAge[i]; this.treeAge[i] = a + (target - a) * 0.04; return Math.max(0.05, this.treeAge[i]);
  }
  building(c, b, k) {
    const TS = this.sim.TS, w = b.w * TS, wh = this.wallH(b), h = b.h * TS + wh, x = b.x * TS, y = b.y * TS - wh;
    c.drawImage(this.bsprites[k], x, y, w, h);
    if (b.touched) {   // tendrils that climbed it stay visible on the wall and roof
      const L = this.LS, fx = b.x * TS, fy = b.y * TS, fw = b.w * TS, fh = b.h * TS;
      c.drawImage(this.vine, fx * L, fy * L, fw * L, fh * L, fx, fy, fw, fh);
    }
    if (b.ivy > 0) {   // ivy climbs from the pavement up
      const S = this.SS, sp = this.isprites[k], vis = h * Math.min(1, b.ivy * 1.02);
      c.drawImage(sp, 0, (h - vis) * S, w * S, vis * S, x, y + h - vis, w, vis);
    }
    if (b.crush > 0 && b.state === 'intact') {
      c.strokeStyle = PAL.stem; c.lineWidth = 4; c.lineCap = 'round'; const n = Math.ceil(b.crush * 5);
      for (let q = 0; q < n; q++) { const yy = y + h - 8 - q * (h / 6); c.beginPath(); c.moveTo(x + 2, yy); c.bezierCurveTo(x + w * 0.3, yy - 9, x + w * 0.7, yy + 9, x + w - 2, yy - 4); c.stroke(); }
    }
  }
  prop(c, p, time) {
    const s = this.sim, TS = s.TS, x = (p.x + 0.5) * TS, y = (p.y + 0.5) * TS, i = p.y * s.N + p.x, grown = s.type[i] === T.SOIL ? s.veg[i] : 0;
    const sh = (dx, dy, rx, ry) => { c.fillStyle = 'rgba(8,12,18,.28)'; c.beginPath(); c.ellipse(x + dx, y + dy, rx, ry, 0.6, 0, TAU); c.fill(); };
    if (p.kind === 'hydrant') {
      const b = s.hydrant.burst; sh(5, 5, 9, 6);
      c.fillStyle = '#6e332c'; c.fillRect(x - 11, y - 3, 22, 6); c.beginPath(); c.arc(x, y, 8.6, 0, TAU); c.fill();
      c.fillStyle = b ? '#7d6a62' : '#a8534a'; c.beginPath(); c.arc(x, y, 7.2, 0, TAU); c.fill(); c.fillStyle = '#c47a6f'; c.beginPath(); c.arc(x - 1.6, y - 1.8, 3.2, 0, TAU); c.fill(); c.fillStyle = '#5a2a25'; c.beginPath(); c.arc(x, y, 1.6, 0, TAU); c.fill();
      if (s.hydrant.hold > 0 && !b) { c.strokeStyle = PAL.accent; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 12, 0, TAU * s.hydrant.hold); c.stroke(); }
    } else if (p.kind === 'car') {
      const cols = ['#64727d', '#876b58', '#757c6c', '#8a8264'], w = p.rot ? 25 : 48, h = p.rot ? 48 : 25;
      sh(5, 6, w * 0.55, h * 0.55); c.fillStyle = '#1c1d1f'; if (p.rot) { c.fillRect(x - w / 2 - 1.5, y - 15, w + 3, 8); c.fillRect(x - w / 2 - 1.5, y + 8, w + 3, 8); } else { c.fillRect(x - 15, y - h / 2 - 1.5, 8, h + 3); c.fillRect(x + 8, y - h / 2 - 1.5, 8, h + 3); }
      c.fillStyle = cols[p.color]; c.beginPath(); c.roundRect(x - w / 2, y - h / 2, w, h, 6); c.fill(); c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1; c.stroke();
      c.fillStyle = '#23282e'; if (p.rot) { c.fillRect(x - w / 2 + 3, y - 12, w - 6, 7); c.fillRect(x - w / 2 + 3, y + 9, w - 6, 5); } else { c.fillRect(x - 12, y - h / 2 + 3, 7, h - 6); c.fillRect(x + 9, y - h / 2 + 3, 5, h - 6); }
      c.fillStyle = shadeHex(cols[p.color], 0.14); if (p.rot) c.fillRect(x - w / 2 + 3, y - 4, w - 6, 12); else c.fillRect(x - 4, y - h / 2 + 3, 12, h - 6);
      c.fillStyle = 'rgba(120,60,30,.5)'; c.beginPath(); c.arc(x + (p.rot ? 5 : -17), y + (p.rot ? -19 : 6), 3.5, 0, TAU); c.fill(); c.beginPath(); c.arc(x + (p.rot ? -6 : 16), y + (p.rot ? 18 : -7), 2.5, 0, TAU); c.fill();
      if (grown > 1.5) { const g = Math.min(1, (grown - 1.5) / 2); c.fillStyle = PAL.grassShade; for (let q = 0; q < 7; q++) { c.globalAlpha = g; c.beginPath(); c.arc(x + (hash(p.x, q, 31) - 0.5) * w, y + (hash(p.y, q, 32) - 0.5) * h, 4 + hash(q, p.x, 33) * 5, 0, TAU); c.fill(); } c.fillStyle = PAL.grass; for (let q = 0; q < 5; q++) { c.beginPath(); c.arc(x + (hash(p.x, q, 34) - 0.5) * w, y + (hash(p.y, q, 35) - 0.5) * h, 3 + hash(q, p.x, 36) * 3, 0, TAU); c.fill(); } c.globalAlpha = 1; }
    } else if (p.kind === 'lamp') {
      c.strokeStyle = 'rgba(8,12,18,.3)'; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(x - 16, y + 14); c.lineTo(x + 22, y + 52); c.stroke();
      c.fillStyle = '#2c2f33'; c.beginPath(); c.arc(x - 16, y + 14, 4, 0, TAU); c.fill(); c.strokeStyle = '#4a4e53'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(x - 16, y + 14); c.lineTo(x - 16, y - 20); c.lineTo(x + 2, y - 26); c.stroke();
      c.fillStyle = '#6d7176'; c.beginPath(); c.ellipse(x + 5, y - 26, 7, 3.6, -0.2, 0, TAU); c.fill();
    } else if (p.kind === 'meter') {
      sh(-14, 12, 5, 3); c.strokeStyle = '#4a4e53'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(x - 18, y + 10); c.lineTo(x - 18, y - 6); c.stroke(); c.fillStyle = '#7d8286'; c.beginPath(); c.roundRect(x - 22, y - 15, 8, 11, 3); c.fill(); c.fillStyle = '#23282e'; c.fillRect(x - 20.5, y - 13, 5, 3.5);
    } else if (p.kind === 'bench') {
      sh(3, 5, 17, 7); c.fillStyle = '#3b3e42'; c.fillRect(x - 15, y - 6, 3, 13); c.fillRect(x + 12, y - 6, 3, 13); for (let q = 0; q < 3; q++) { c.fillStyle = q ? '#7b6a55' : '#8b7961'; c.fillRect(x - 17, y - 6 + q * 4.4, 34, 3.4); }
    } else if (p.kind === 'sign') {
      sh(-12, 12, 5, 3); c.strokeStyle = '#4a4e53'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(x - 16, y + 10); c.lineTo(x - 16, y - 20); c.stroke(); c.fillStyle = '#5d7386'; c.beginPath(); c.roundRect(x - 26, y - 32, 20, 14, 2); c.fill(); c.fillStyle = PAL.paintWhite; c.fillRect(x - 22, y - 28, 12, 2); c.fillRect(x - 22, y - 24, 8, 2);
    } else if (p.kind === 'stump') {
      if (grown < 4) { sh(3, 3, 7, 5); c.fillStyle = '#5a4733'; c.beginPath(); c.arc(x, y, 6.5, 0, TAU); c.fill(); c.strokeStyle = '#8a7150'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, 3.6, 0, TAU); c.stroke(); c.beginPath(); c.arc(x, y, 1.4, 0, TAU); c.stroke(); }
    } else if (p.kind === 'cart') {
      sh(4, 5, 12, 7); c.save(); c.translate(x, y); c.rotate(0.5); c.strokeStyle = '#8f9499'; c.lineWidth = 1.3; c.strokeRect(-11, -7, 22, 14); c.beginPath(); for (let q = 1; q < 5; q++) { c.moveTo(-11 + q * 4.4, -7); c.lineTo(-11 + q * 4.4, 7); } c.moveTo(-11, 0); c.lineTo(11, 0); c.stroke(); c.fillStyle = '#b3554a'; c.fillRect(11, -7, 3, 14); c.restore();
    } else if (p.kind === 'drain') {
      c.fillStyle = '#1c1d1f'; c.fillRect(x + 6, y - 9, 20, 18); c.fillStyle = '#5c6064'; for (let q = 0; q < 4; q++) c.fillRect(x + 8, y - 7 + q * 4.2, 16, 2);
    }
  }

  // ------------------------------------------------------------------ fauna and particles
  faunaDraw(c, time, dt, sway) {
    const s = this.sim, TS = s.TS, N = s.N, f = this.fauna, m = s.metrics;
    const wantFlies = s.species.pollinator ? Math.min(12, 2 + (m.flowers / 4 | 0)) : 0;
    if (f.flies.length < wantFlies && Math.random() < 0.05) {
      const spots = []; for (let i = 0; i < N * N; i++) if (s.type[i] === T.SOIL && s.veg[i] >= 3 && s.light[i] > 0.5) spots.push(i);
      if (spots.length) { const i = spots[(Math.random() * spots.length) | 0]; f.flies.push({ x: (i % N + 0.5) * TS, y: ((i / N | 0) + 0.5) * TS, tx: 0, ty: 0, home: spots, t: 0, col: PAL.flowers[(Math.random() * 5) | 0], ph: Math.random() * 9 }); }
    }
    for (const b of f.flies) {
      b.t -= dt; if (b.t <= 0) { const i = b.home[(Math.random() * b.home.length) | 0]; b.tx = (i % N + 0.2 + Math.random() * 0.6) * TS; b.ty = ((i / N | 0) + 0.2 + Math.random() * 0.6) * TS; b.t = 1.5 + Math.random() * 3; }
      b.x += (b.tx - b.x) * dt * 0.9 + Math.sin(time * 5 + b.ph) * 14 * dt; b.y += (b.ty - b.y) * dt * 0.9 + Math.cos(time * 4.3 + b.ph) * 14 * dt;
      const flap = Math.abs(Math.sin(time * 13 + b.ph)) * 0.8 + 0.2;
      c.fillStyle = 'rgba(8,12,18,.22)'; c.beginPath(); c.ellipse(b.x + 5, b.y + 8, 3.4 * flap, 2, 0, 0, TAU); c.fill();
      c.fillStyle = b.col; c.beginPath(); c.ellipse(b.x - 2.8 * flap, b.y, 3.2 * flap, 3.6, 0, 0, TAU); c.ellipse(b.x + 2.8 * flap, b.y, 3.2 * flap, 3.6, 0, 0, TAU); c.fill();
      c.fillStyle = '#17191b'; c.fillRect(b.x - 0.6, b.y - 3, 1.2, 6);
    }
    if (s.species.dragonfly) {
      if (f.dragons.length < 3) { const w = []; for (let i = 0; i < N * N; i++) if (s.type[i] === T.WATER) w.push(i); if (w.length) f.dragons.push({ x: (w[0] % N) * TS, y: (w[0] / N | 0) * TS, tx: 0, ty: 0, t: 0, w, a: 0 }); }
      for (const d of f.dragons) {
        d.t -= dt; if (d.t <= 0) { const i = d.w[(Math.random() * d.w.length) | 0]; d.tx = (i % N + Math.random()) * TS; d.ty = ((i / N | 0) + Math.random()) * TS; d.t = 0.5 + Math.random() * 1.6; }
        const dx = d.tx - d.x, dy = d.ty - d.y; d.x += dx * dt * 3.5; d.y += dy * dt * 3.5; if (Math.hypot(dx, dy) > 3) d.a = Math.atan2(dy, dx);
        c.save(); c.translate(d.x, d.y); c.rotate(d.a); c.strokeStyle = '#3ad0c0'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(-6, 0); c.lineTo(5, 0); c.stroke(); c.strokeStyle = 'rgba(230,250,255,.7)'; c.lineWidth = 1; const fl = Math.sin(time * 40) * 1.5; c.beginPath(); c.moveTo(1, 0); c.lineTo(-1, -6 + fl); c.moveTo(1, 0); c.lineTo(-1, 6 - fl); c.moveTo(3, 0); c.lineTo(4, -5 - fl); c.moveTo(3, 0); c.lineTo(4, 5 + fl); c.stroke(); c.restore();
      }
    }
    if (s.species.bird) {
      if (f.birds.length < 4 && Math.random() < 0.006 + (s.stage >= 3 ? 0.006 : 0)) { const fromL = Math.random() < 0.5, y0 = Math.random() * s.W; const n = 1 + (Math.random() * 3 | 0); for (let q = 0; q < n; q++) f.birds.push({ x: fromL ? -40 - q * 26 : s.W + 40 + q * 26, y: y0 + q * 14, vx: (fromL ? 1 : -1) * (120 + Math.random() * 40), vy: (Math.random() - 0.5) * 50, ph: Math.random() * 9 }); }
      for (let q = f.birds.length - 1; q >= 0; q--) {
        const b = f.birds[q]; b.x += b.vx * dt; b.y += b.vy * dt + Math.sin(time * 2 + b.ph) * 10 * dt; if (b.x < -80 || b.x > s.W + 80) { f.birds.splice(q, 1); continue; }
        const fl = Math.sin(time * 11 + b.ph) * 4.5, d = b.vx > 0 ? 1 : -1;
        c.strokeStyle = 'rgba(8,12,18,.25)'; c.lineWidth = 2; c.lineCap = 'round'; c.beginPath(); c.moveTo(b.x + 22 - 6, b.y + 30 + fl * 0.4); c.lineTo(b.x + 22, b.y + 30); c.lineTo(b.x + 22 + 6, b.y + 30 + fl * 0.4); c.stroke();
        c.strokeStyle = '#22262b'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(b.x - 7 * d, b.y - fl); c.quadraticCurveTo(b.x - 3 * d, b.y - 1, b.x, b.y); c.quadraticCurveTo(b.x - 2 * d, b.y + 3, b.x - 6 * d, b.y + 6 + fl * 0.6); c.stroke();
        c.fillStyle = '#22262b'; c.beginPath(); c.arc(b.x + 1.5 * d, b.y, 1.8, 0, TAU); c.fill();
      }
    }
  }
  particles(c, dt) {
    for (let q = this.parts.length - 1; q >= 0; q--) {
      const p = this.parts[q]; p.life += dt; const t = p.life / p.max; if (t >= 1) { this.parts.splice(q, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 3.2; p.vy *= 1 - dt * 3.2;
      if (p.kind === 'dust') { c.globalAlpha = (1 - t) * 0.5; c.fillStyle = p.col; c.beginPath(); c.arc(p.x, p.y, p.size * (0.6 + t * 1.6), 0, TAU); c.fill(); }
      else if (p.kind === 'ring') { c.globalAlpha = (1 - t) * 0.9; c.strokeStyle = p.col; c.lineWidth = 3 * (1 - t) + 0.6; c.beginPath(); c.arc(p.x, p.y, 6 + p.size * (1 - (1 - t) * (1 - t)), 0, TAU); c.stroke(); }
      else if (p.kind === 'leaf') { c.globalAlpha = 1 - t * t; c.fillStyle = p.col; c.save(); c.translate(p.x, p.y); c.rotate(p.rot + t * 4); c.beginPath(); c.ellipse(0, 0, p.size * 1.6, p.size * 0.8, 0, 0, TAU); c.fill(); c.restore(); }
      else { c.globalAlpha = 1 - t; c.fillStyle = p.col; c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    }
    c.globalAlpha = 1;
    if (this.fx && this.books.length) {
      c.globalCompositeOperation = 'lighter';
      for (let q = this.books.length - 1; q >= 0; q--) {
        const b = this.books[q]; b.t += dt; const fr = (b.t * this.fxFps) | 0; if (fr >= this.fxFrames.length) { this.books.splice(q, 1); continue; }
        const f = this.fxFrames[fr], sz = f.w * b.scale; c.drawImage(this.fx, f.x, f.y, f.w, f.h, b.x - sz / 2, b.y - sz / 2, sz, sz);
      }
      c.globalCompositeOperation = 'source-over';
    }
    for (const col of this.collapsing) col.t += dt;
  }
}
