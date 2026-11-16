// A plausible player, in simulation time: reaches water, cracks what it can reach, extends toward unreached ground.
// Used by the tests to measure that a run can be finished, and how long each adaptation path takes.
import { readFileSync } from 'node:fs';
import { Sim } from '../src/sim.js';
import { T, PAVED, TOUGH } from '../src/config.js';

export const level = JSON.parse(readFileSync(new URL('../data/intersection.json', import.meta.url)));

export function play(evo, { maxSeconds = 900, pause = 1.2 } = {}) {
  const sim = new Sim(level); sim.state = 'playing';
  const N = sim.N, TS = sim.TS, stages = []; let actions = 0, lastStage = 0;
  const step = dt => {
    sim.update(dt); sim.ev.length = 0;
    if (sim.pendingOffer) sim.choose(evo[sim.offers - 1]);
    if (sim.stage > lastStage) { lastStage = sim.stage; stages.push(Math.round(sim.time)); }
  };
  const wait = s => { for (let i = 0; i < s * 20; i++) step(0.05); };
  const nearest = (x, y) => { let b = 0, bd = Infinity; for (let i = 0; i < sim.nx.length; i++) { const d = (sim.nx[i] - x) ** 2 + (sim.ny[i] - y) ** 2; if (d < bd) { bd = d; b = i; } } return b; };
  const growTo = (node, x, y) => {
    sim.startGrow(node);
    for (let g = 0; g < 1500 && sim.state === 'playing'; g++) { const why = sim.growToward(x, y, 0.05); step(0.05); if (Math.hypot(sim.g.hx - x, sim.g.hy - y) < 9 || why === 'wall' || why === 'edge') break; }
    sim.endGrow(); wait(pause);
  };
  growTo(0, sim.hydrant.x - 18, sim.hydrant.y + 22);
  let idle = 0;
  while (sim.state === 'playing' && sim.time < maxSeconds) {
    let best = -1, bs = -Infinity;
    for (let i = 0; i < N * N; i++) {
      if (!sim.reach[i]) continue; const info = sim.holdInfo(i % N, i / N | 0); if (!info) continue;
      if (info.kind === 'hydrant') { if (sim.time > 60) { best = i; bs = Infinity; break; } continue; }
      const sc = info.kind === 'constrict' ? 5 : (TOUGH(sim.type[i]) ? 0 : 1.2) + sim.crack[i] * 1.5 + ((i * 7919) % 13) / 40;
      if (sc > bs) { bs = sc; best = i; }
    }
    if (best >= 0 && (actions % 5 !== 4 || sim.sun < 3)) {
      const x = best % N, y = best / N | 0;
      for (let g = 0; g < 400 && sim.state === 'playing'; g++) { const info = sim.holdInfo(x, y); if (!info) break; if (!info.ok) { step(0.05); continue; } const p = sim.hold(info, 0.05); step(0.05); if (p < 0) break; }
      actions++; wait(pause); idle = 0;
    } else {
      let t = -1, td = Infinity;
      for (let i = 0; i < N * N; i++) {
        if (sim.reach[i]) continue; const ty = sim.type[i];
        if (!(PAVED(ty) || (ty === T.BUILDING && sim.evo.climbing) || (ty === T.SOIL && sim.veg[i] < 1))) continue;
        const x = (i % N + 0.5) * TS, y = ((i / N | 0) + 0.5) * TS, n = nearest(x, y), q = ((i % N) >= N / 2 ? 1 : 0) + ((i / N | 0) >= N / 2 ? 2 : 0);
        const d = Math.hypot(sim.nx[n] - x, sim.ny[n] - y) - (sim.metrics.linked[q] ? 0 : TS * 1.5) + ((i * 31) % 7) * 6;
        if (d < td) { td = d; t = i; }
      }
      actions++;
      if (t < 0) { wait(1); if (idle++ > 60) break; continue; }
      const x = (t % N + 0.5) * TS, y = ((t / N | 0) + 0.5) * TS; growTo(nearest(x, y), x, y);
    }
  }
  return { sim, stages, won: sim.won, seconds: Math.round(sim.time) };
}
