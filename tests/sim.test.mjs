import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim.js';
import { T, FEEL, EVO_OFFERS } from '../src/config.js';
import { level, play } from './player.mjs';

const fresh = () => { const s = new Sim(level); s.state = 'playing'; return s; };
const run = (s, secs) => { for (let i = 0; i < secs * 20; i++) s.update(0.05); };
const reachWater = s => { s.startGrow(0); for (let i = 0; i < 400 && !s.hydrant.connected; i++) { s.growToward(s.hydrant.x - 18, s.hydrant.y + 22, 0.05); s.update(0.05); } s.endGrow(); };

test('the vine starts as one node with sun and no water', () => {
  const s = fresh(); assert.equal(s.nx.length, 1); assert.equal(s.sun, FEEL.start_sun); assert.equal(s.water, 0);
});
test('starting sun is enough to reach the hydrant in one drag', () => {
  const s = fresh(); reachWater(s); assert.ok(s.hydrant.connected); assert.ok(s.water > 0);
});
test('growing costs sun and stops when it runs out', () => {
  const s = fresh(); s.sun = 1; s.startGrow(0); let why = null; for (let i = 0; i < 60 && !why; i++) why = s.growToward(s.W, s.ny[0], 0.05);
  assert.equal(why, 'sun');
});
test('walls block the vine until it can climb', () => {
  const s = fresh(), b = s.buildings[0], x = (b.x + 0.5) * s.TS, y = (b.y + 0.5) * s.TS;
  assert.equal(s.passable(x, y), 'wall'); s.evo.climbing = true; assert.equal(s.passable(x, y), null);
});
test('pavement cannot be cracked without water or out of reach', () => {
  const s = fresh(); assert.equal(s.holdInfo(5, 6).why, 'water'); assert.equal(s.holdInfo(15, 15).why, 'reach');
});
test('a held slab breaks into soil, and soil beside a watered vine grows on its own', () => {
  const s = fresh(); reachWater(s); run(s, 4);
  const info = s.holdInfo(6, 4); assert.ok(info && info.ok);
  let p = 0; for (let i = 0; i < 200 && p >= 0; i++) { p = s.hold(s.holdInfo(6, 4), 0.05); s.update(0.05); }
  const i = 4 * s.N + 6; assert.equal(s.type[i], T.SOIL); assert.equal(s.stats.broken, 1);
  run(s, 60); assert.ok(s.veg[i] >= 2, `expected grass after a minute, got ${s.veg[i]}`); assert.ok(s.species.moss && s.species.grass);
});
test('breaking pavement alone does not make the place alive', () => {
  const s = fresh(); for (let i = 0; i < s.N * s.N; i++) if (s.type[i] !== T.BUILDING && s.type[i] !== T.SOIL) s.breakTile(i, 'test');
  s.measure(); assert.ok(s.alive < 5, `bare ground scored ${s.alive}`);
});
test('breaking the road over the water main lets the stream out', () => {
  const s = fresh(); s.breakTile(s.mainRow * s.N + 3, 'player'); assert.ok(s.mainBurst); assert.equal(s.type[s.mainRow * s.N + 3], T.WATER);
});
test('a felled building leaves rubble and gives the light back', () => {
  const s = fresh(), b = s.buildings[1], shaded = (b.y + 2) * s.N + b.x + b.w;
  assert.ok(s.light[shaded] < 0.5); s.collapse(b); assert.equal(s.light[shaded], 1); assert.equal(s.rubble[b.y * s.N + b.x], 1);
});
test('save and load round-trip the organism and the ground', () => {
  const a = fresh(); reachWater(a); run(a, 5); const b = new Sim(level, JSON.parse(JSON.stringify(a.save())));
  assert.equal(b.nx.length, a.nx.length); assert.ok(b.hydrant.connected); assert.deepEqual(Array.from(b.type), Array.from(a.type));
});
for (const a of EVO_OFFERS[0]) for (const b of EVO_OFFERS[1]) {
  test(`a run can be finished with ${a} + ${b}, in a sane time`, () => {
    const r = play([a, b]);
    assert.ok(r.won, `not reclaimed after ${r.seconds}s (alive ${Math.round(r.sim.alive)}%)`);
    assert.ok(r.seconds >= 150 && r.seconds <= 480, `tireless scripted player took ${r.seconds}s; stages at ${r.stages}`);
    assert.ok(r.sim.stats.byRoots > 10, 'the ecosystem should break ground on its own');
  });
}
