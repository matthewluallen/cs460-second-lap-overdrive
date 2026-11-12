import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Car, LANE_STEP} from './car.mjs';
import {Game, MAX_CARS} from './game.mjs';
import {ID} from './protocol.mjs';
import {Pieces} from './track.mjs';
import {SimWorld} from './sim.mjs';
const data = name => JSON.parse(readFileSync(new URL('./data/' + name + '.json', import.meta.url)));
const game = () => new Game({pieces: data('pieces'), weapons: data('weapons'), vehicles: data('vehicles')});
const settle = () => new Promise(resolve => setImmediate(resolve));
function radio(write) {
  const r = {sent: [], closed: false, notify: null,
    onNotify(fn) { this.notify = fn; return () => { this.notify = null; }; },
    async write(bytes) { await write?.(bytes); this.sent.push([...bytes]); },
    close() { this.closed = true; }};
  return r;
}
const speeds = r => r.sent.filter(b => b[1] === ID.SPEED).map(b => b[2] + 256 * b[3]);

test('settled transient write failure attempts STOP before closing the live transport', async () => {
  let fail = false;
  const r = radio(() => { if (fail) { fail = false; throw new Error('temporary write error'); } });
  const c = new Car(r); c.setSpeed(700); await settle();
  fail = true; c.refreshBattery(); await c.pumpPromise;
  assert.deepEqual(speeds(r), [700, 0]);
  assert.equal(r.closed, true); assert.equal(c.connected, false);
  assert.equal(c.safetyReason, 'Connection fault');
  c.setSpeed(700); await settle(); assert.deepEqual(speeds(r), [700, 0]);
});

test('stuck writes close within a deadline and never overlap another GATT write', async () => {
  let calls = 0;
  const r = radio(() => { calls++; return new Promise(() => {}); });
  const c = new Car(r, {writeTimeoutMs: 15});
  c.setSpeed(700); c.stop(); await c.close();
  assert.equal(calls, 1); assert.equal(r.closed, true); assert.equal(c.connected, false);
});

test('disconnect waits for pending write, discards queued motion, then stops serially', async () => {
  let release, active = 0, peak = 0, first = true;
  const r = radio(async () => { active++; peak = Math.max(peak, active); if (first) { first = false; await new Promise(resolve => { release = resolve; }); } active--; });
  const c = new Car(r); c.setSpeed(700); await settle();
  c.uturn(); c.setSpeed(900); const closing = c.close();
  release(); await closing;
  assert.equal(peak, 1); assert.deepEqual(speeds(r), [700, 0]);
  assert.deepEqual(r.sent.map(b => b[1]), [ID.SPEED, ID.SPEED, ID.DISCONNECT]);
  assert.equal(r.closed, true);
});

test('off-track notification stops and latches one car through resume and further controls', async () => {
  const g = game(), r = radio(), d = g.addCar(r);
  await settle(); d.input.throttle = 1; g.tick(.04); await settle();
  r.notify(Uint8Array.of(1, ID.DELOCALIZED)); await settle();
  assert.throws(() => g.resume(), /Pit stop/); d.input.throttle = 1; g.tick(.04); d.car.uturn(); d.car.steerTo(50); await settle();
  assert.equal(d.car.safetyReason, 'Off track'); assert.equal(d.car.speed, 0);
  assert.deepEqual(speeds(r).slice(-2), [700, 0]);
  assert.equal(r.sent.some(b => b[1] === ID.TURN || b[1] === ID.CHANGE_LANE), false);
  assert.equal(g.snapshot()[0].safetyReason, 'Off track');
  assert.equal(g.recoverCar(d), true); assert.equal(d.input.throttle, 0);
  assert.equal(g.resumeFromPit(), true);
  d.input.throttle = .5; g.tick(.04); await settle(); assert.equal(speeds(r).at(-1), 350);
});

test('off-track scanner cancels scan and cannot start another without recovery', async () => {
  const g = game(), r = radio(), d = g.addCar(r); await settle();
  g.topSpeed = 300; g.startScan(); await settle(); assert.equal(speeds(r).at(-1), 300);
  assert.equal(d.car.targetLateral, LANE_STEP);
  assert.ok(Object.values(data('pieces')['10'].locs).some(([, lateral]) => Math.abs(lateral - d.car.targetLateral) <= 5.5), 'scan lane must reach an intersection code strip; the centerline cannot');
  r.notify(Uint8Array.of(1, ID.DELOCALIZED)); await settle();
  assert.equal(g.phase, 'garage'); assert.equal(g.scanner, null);
  assert.throws(() => g.startScan(), /recover/); assert.equal(d.car.speed, 0);
});

test('STOP blocks direct turning until explicit resume without clearing off-track latch', async () => {
  const g = game(), r = radio(), d = g.addCar(r); await settle();
  g.stopAll(); await settle(); const n = r.sent.length;
  d.car.uturn(); d.car.steerTo(50); d.input.throttle = 1; g.tick(.04); await settle();
  assert.equal(r.sent.length, n); assert.equal(d.car.speed, 0);
  g.resume(); d.car.uturn(); await settle(); assert.equal(r.sent.at(-1)[1], ID.TURN);
});

test('four-car limit rejects a fifth before installing its listeners or starting it', async () => {
  const g = game(); for (let i = 0; i < MAX_CARS; i++) g.addCar(radio());
  const extra = radio(); assert.throws(() => g.addCar(extra), /four cars/);
  assert.equal(extra.notify, null); assert.equal(extra.sent.length, 0); assert.equal(g.drivers.length, 4);
  await settle();
});

test('battle effects cannot exceed the operator speed ceiling', async () => {
  const g = game(), r = radio(), d = g.addCar(r); await settle();
  g.topSpeed = 300; d.input.throttle = 1;
  g.battle = {limit: () => ({speed: 1400, accel: 2000}), press() {}, update() {}};
  g.tick(.04); await settle(); assert.equal(speeds(r).at(-1), 300);
});

test('one physical Bluetooth identity cannot receive conflicting driver commands', async () => {
  const g = game(), first = radio(), duplicate = radio();
  first.id = duplicate.id = 'same-physical-car';
  g.addCar(first); await settle();
  assert.throws(() => g.addCar(duplicate), /already in the garage/);
  assert.equal(g.drivers.length, 1); assert.equal(duplicate.notify, null);
  assert.deepEqual(duplicate.sent, []);
  await g.removeCar(g.drivers[0]);
  assert.doesNotThrow(() => g.addCar(duplicate), 'explicit disconnect permits a fresh connection');
  await settle(); await g.removeCar(g.drivers[0]);
});


test('one off-track event stops the shared circuit until recovery AND explicit track-clear', async () => {
  const g = game(), radios = [radio(), radio(), radio(), radio()];
  const drivers = radios.map(r => g.addCar(r)); await settle();
  for (const d of drivers) d.input.throttle = .8;
  g.tick(.04); await settle(); assert.ok(drivers.every(d => d.car.speed > 0));
  radios[1].notify(Uint8Array.of(1, ID.DELOCALIZED)); await settle();
  assert.equal(g.halted, true); assert.match(g.pitReason, /left the track/); assert.equal(g.pitReady, false);
  assert.ok(drivers.every(d => d.car.speed === 0)); assert.ok(radios.every(r => speeds(r).at(-1) === 0));
  assert.equal(drivers[1].car.safetyReason, 'Off track');
  assert.throws(() => g.resume(), /Pit stop/); assert.throws(() => g.resumeFromPit(), /recover/);
  assert.throws(() => g.startScan(drivers[0]), /Pit stop/);
  assert.equal(g.halted, true);
  for (const d of drivers) { d.input.throttle = 1; d.car.uturn(); }
  g.tick(.04); await settle(); assert.ok(drivers.every(d => d.car.speed === 0));
  assert.equal(g.recoverCar(drivers[1]), true); assert.equal(g.pitReady, true);
  assert.equal(g.halted, true); assert.throws(() => g.resume(), /Pit stop/);
  g.tick(.04); await settle(); assert.ok(drivers.every(d => d.car.speed === 0));
  assert.equal(g.resumeFromPit(), true); assert.equal(g.pitReason, null); assert.equal(g.halted, false);
  // Track-clear releases the latch, but must not resurrect a held human input.
  g.tick(.04); await settle(); assert.ok(drivers.every(d => d.car.speed === 0));
  drivers[0].input.throttle = .5; g.tick(.04); await settle(); assert.equal(drivers[0].car.speed, 350);
});

test('shared pit preserves battle state and waits for every affected car', async () => {
  const g = game(), a = radio(), b = radio(), da = g.addCar(a), db = g.addCar(b); await settle();
  const battle = {active: true, stops: 0, stop() { this.stops++; }};
  g.battle = battle; g.phase = 'battle';
  a.notify(Uint8Array.of(1, ID.DELOCALIZED)); b.notify(Uint8Array.of(1, ID.DELOCALIZED)); await settle();
  assert.equal(g.battle, battle); assert.equal(battle.active, true); assert.equal(battle.stops, 0); assert.equal(g.phase, 'battle');
  g.recoverCar(da); assert.equal(g.pitReady, false); assert.throws(() => g.resumeFromPit(), /recover/);
  g.recoverCar(db); assert.equal(g.pitReady, true); assert.equal(g.halted, true);
  g.resumeFromPit(); assert.equal(g.battle, battle); assert.equal(g.halted, false);
});

test('CPU objective guidance respects safety and the final speed ceiling', async () => {
  const g = game(), r = radio(), d = g.addCar(r); await settle();
  g.track = {}; d.bot = {drive(now, input) { input.throttle = .1; input.lane = -20; }};
  d.objectiveInput = {throttle: 10, lane: 1000}; g.topSpeed = 300;
  g.tick(.04); await settle(); assert.equal(d.car.speed, 300); assert.equal(d.car.targetLateral, 68);
  g.stopAll(); assert.equal(d.objectiveInput, null);
  d.objectiveInput = {throttle: 1, lane: -68}; g.tick(.04); await settle(); assert.equal(d.car.speed, 0);
});

test('shared pit freezes battle recovery, cooldowns, mines and timed effects across a long repair', async () => {
  let now = 1000;
  const g = new Game({pieces: data('pieces'), weapons: data('weapons'), vehicles: data('vehicles'), clock: () => now});
  const r = radio(), d = g.addCar(r); await settle();
  g.useTrack({length: 5000}); g.startBattle();
  const battle = g.battle, f = battle.get(d.car);
  const fields = ['disabledUntil', 'boostUntil', 'rageUntil', 'wiggleUntil', 'wiggleNext', 'hitUntil', 'firingUntil'];
  for (let i = 0; i < fields.length; i++) f[fields[i]] = now + 2000 + i * 100;
  f.energy = 4; f.ready.attack = now + 4000; f.slow.set('gravity', {until: now + 3000, factor: .25});
  battle.mines.push({owner: f, distance: 0, lateral: 0, armedAt: now + 600, expires: now + 30000, weapon: {}});
  d.bot = {nextLane: now + 1500, mineAt: now + 2500};
  r.notify(Uint8Array.of(1, ID.DELOCALIZED)); await settle();
  assert.equal(battle.pausedAt, 1000); assert.equal(g.snapshot()[0].disabled, true);
  now = 6000; r.notify(Uint8Array.of(1, ID.DELOCALIZED)); await settle();
  assert.equal(battle.pausedAt, 1000, 'another off-track message must not restart the pause clock');
  now = 101000;
  battle.update(100, now); battle.damage(f, 99, null, now);
  r.notify(Uint8Array.of(3, ID.COLLISION, 1, 0));
  assert.equal(f.energy, 4); assert.equal(f.deaths, 0); assert.equal(g.snapshot()[0].disabled, true);
  assert.equal(battle.limit(d.car, 700, now).speed, 0);
  g.recoverCar(d); g.resumeFromPit();
  assert.equal(battle.pausedAt, null);
  for (let i = 0; i < fields.length; i++) assert.equal(f[fields[i]] - now, 2000 + i * 100, fields[i]);
  assert.equal(f.ready.attack - now, 4000); assert.equal(f.slow.get('gravity').until - now, 3000);
  assert.equal(battle.mines[0].armedAt - now, 600); assert.equal(battle.mines[0].expires - now, 30000);
  assert.equal(d.bot.nextLane - now, 1500); assert.equal(d.bot.mineAt - now, 2500);
  assert.equal(battle.limit(d.car, 700, now).speed, 0, 'disabled recovery retains its pre-pit remaining duration');
});

test('pit clears charged and held weapons so neutral recovery cannot release a stored shot', async () => {
  let now = 1000;
  const weapons = data('weapons');
  const chargedId = Object.keys(weapons).find(id => weapons[id].type === 'shooting_vehicle_item' && weapons[id].interaction_style === 'charge');
  assert.ok(chargedId);
  const g = new Game({pieces: data('pieces'), weapons, vehicles: data('vehicles'), clock: () => now});
  const r = radio(), d = g.addCar(r); await settle(); g.useTrack({length: 5000}); g.startBattle();
  const battle = g.battle, f = battle.add(d.car, {attack: [chargedId], support: [], special: []});
  battle.press(d.car, 'attack', true); battle.update(.5, now);
  assert.ok(f.charge.attack > .15); assert.equal(f.was.attack, true);
  r.notify(Uint8Array.of(1, ID.DELOCALIZED)); await settle();
  assert.equal(Object.values(f.held).some(Boolean), false); assert.equal(Object.values(f.was).some(Boolean), false);
  assert.equal(Object.keys(f.charge).length, 0);
  battle.press(d.car, 'attack', true); assert.equal(f.held.attack, false, 'paused controls cannot re-arm a weapon');
  now += 30000; g.recoverCar(d); g.resumeFromPit(); battle.update(.04, now);
  assert.equal(battle.drain().some(e => ['shot', 'burst', 'beam'].includes(e.type)), false);
  assert.equal(f.ready.attack, undefined, 'no firing cooldown should have been created by pit recovery');
});


test('the first center-lane request reaches a car that physically starts off center', async () => {
  const pieces = new Pieces(data('pieces')), world = new SimWorld(pieces, 'Capsule');
  const sim = world.addCar({lateral: -22.5}), car = new Car(sim, {pieces});
  await car.start(); await settle();
  car.steerTo(0); await settle();
  assert.equal(sim.targetLateral, 0); assert.equal(sim.written.filter(bytes => bytes[1] === ID.CHANGE_LANE).length, 1);
  world.step(.05); world.step(.05); assert.equal(sim.lateral, 0);
  car.steerTo(0); await settle(); assert.equal(sim.written.filter(bytes => bytes[1] === ID.CHANGE_LANE).length, 1, 'unchanged target is still coalesced after delivery');
  car.safetyStop('Host stopped'); await settle(); car.recover();
  sim.lateral = -22.5; sim.targetLateral = -22.5;
  car.steerTo(0); await settle(); assert.equal(sim.targetLateral, 0, 'recovery resends a target even if its numeric value is unchanged');
});
