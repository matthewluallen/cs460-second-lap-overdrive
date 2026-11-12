import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Car} from './car.mjs';
import {Game, MAX_CARS} from './game.mjs';
import {ID} from './protocol.mjs';
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
  g.resume(); d.input.throttle = 1; g.tick(.04); d.car.uturn(); d.car.steerTo(50); await settle();
  assert.equal(d.car.safetyReason, 'Off track'); assert.equal(d.car.speed, 0);
  assert.deepEqual(speeds(r).slice(-2), [700, 0]);
  assert.equal(r.sent.some(b => b[1] === ID.TURN || b[1] === ID.CHANGE_LANE), false);
  assert.equal(g.snapshot()[0].safetyReason, 'Off track');
  assert.equal(g.recoverCar(d), true); assert.equal(d.input.throttle, 0);
  d.input.throttle = .5; g.tick(.04); await settle(); assert.equal(speeds(r).at(-1), 350);
});

test('off-track scanner cancels scan and cannot start another without recovery', async () => {
  const g = game(), r = radio(), d = g.addCar(r); await settle();
  g.topSpeed = 300; g.startScan(); await settle(); assert.equal(speeds(r).at(-1), 300);
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
