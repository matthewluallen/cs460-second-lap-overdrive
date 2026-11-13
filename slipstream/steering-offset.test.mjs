// Tests preserve the experimental SDK steering sequence and queue invariants.
// The November 13 hardware scan still cancelled despite 0x2c preceding 0x25.
// These tests do not establish a firmware precondition or physical steering.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Car} from './car.mjs';
import {ID} from './protocol.mjs';

// Minimal radio stub. `profile` selects the initialization profile the Car sees.
function radio(profile) {
  let receive = () => {};
  return {
    initializationProfile: profile, sent: [],
    onNotify(fn) { receive = fn; return () => {}; },
    async write(b) { this.sent.push(Uint8Array.from(b)); },
    emit(b) { receive(b); }, close() {}
  };
}
const ids = r => r.sent.map(b => b[1]);
const f32 = b => new DataView(b.buffer, b.byteOffset, b.byteLength).getFloat32(2, true);
const laneOffset = b => new DataView(b.buffer, b.byteOffset, b.byteLength).getFloat32(6, true);

test('SDK steering writes SET_OFFSET then CHANGE_LANE, in that order, every move', async () => {
  const r = radio('sdk'), c = new Car(r); c.initializing = false;
  c.steerTo(-22.5); await c.pumpPromise;
  assert.deepEqual(ids(r), [ID.SET_OFFSET, ID.CHANGE_LANE], 'exactly one 0x2c then one 0x25');
  assert.equal(f32(r.sent[0]), 0, 'reference declared is the car current offset (0 before any code)');
  assert.equal(laneOffset(r.sent[1]), c.offsetSign * -22.5, 'change-lane keeps the absolute target');
  assert.equal(r.sent[1][11], 1, 'lane id advances to 1');
});

test('non-SDK transports keep the single bare CHANGE_LANE (no behaviour change)', async () => {
  for (const profile of [undefined, 'fast-furious', 'simulator']) {
    const r = radio(profile), c = new Car(r); c.initializing = false;
    c.steerTo(-22.5); await c.pumpPromise;
    assert.deepEqual(ids(r), [ID.CHANGE_LANE], 'profile ' + profile + ': no 0x2c prepended');
  }
});

test('SDK reference tracks the code-derived lateral estimate', async () => {
  const r = radio('sdk'), c = new Car(r); c.initializing = false;
  c.lateral = 22.5;                     // as if a verified position fixed the lane
  c.steerTo(-45); await c.pumpPromise;
  assert.equal(f32(r.sent[0]), c.offsetSign * 22.5, 'declares current lateral');
  assert.equal(laneOffset(r.sent[1]), c.offsetSign * -45, 'absolute destination unchanged');
});

test('SDK dedup sends neither 0x2c nor 0x25 and consumes no id for an unchanged target', async () => {
  const r = radio('sdk'), c = new Car(r); c.initializing = false;
  c.steerTo(-22.5); await c.pumpPromise;
  const after = r.sent.length, id = c.laneCommandId;
  c.steerTo(-22.5); await c.pumpPromise;      // same target, not forced
  assert.equal(r.sent.length, after, 'no extra writes');
  assert.equal(c.laneCommandId, id, 'id not advanced by a deduplicated request');
});

test('STOP clears a queued SDK offset+lane pair; the car does not steer after STOP', async () => {
  const r = radio('sdk'), c = new Car(r); c.initializing = false;
  c.setSpeed(240); await c.pumpPromise;
  const before = r.sent.length;
  c.steerTo(-22.5); c.stop(); await c.pumpPromise;
  // After STOP, no further 0x2c/0x25 may reach the car beyond anything already in flight.
  const afterStop = r.sent.slice(before);
  assert.ok(!afterStop.some(b => b[1] === ID.CHANGE_LANE), 'no change-lane survives STOP');
  assert.equal(r.sent.at(-1)[1], ID.SPEED, 'last write is the stop speed');
  assert.equal(c.speed, 0);
});

test('SDK cancellation drops the queued offset reference as well as the lane command', async () => {
  const r = radio('sdk'), c = new Car(r); c.initializing = false;
  c.steerTo(45);
  // Car reports cancellation (0x41, current=target=-13.5, hspeed 0, id 0x80) before the queue drains.
  r.emit(Uint8Array.of(0x0e, 0x41, 0,0,0x58,0xc1, 0,0,0x58,0xc1, 0,0, 240, 0, 0x80));
  await c.pumpPromise;
  assert.equal(c.pending.has('lane'), false);
  assert.equal(c.pending.has('lane-offset'), false);
  assert.equal(c.telemetry.laneChange.cancelled, true);
});

test('SDK scan-start operator reference survives the first steering preamble', async () => {
  const r=radio('sdk'),c=new Car(r);c.initializing=false;
  c.calibrateScanStart(22.5);c.steerTo(22.5);await c.pumpPromise;
  assert.deepEqual(r.sent.filter(b=>b[1]===ID.SET_OFFSET).map(f32),[-22.5,-22.5]);
  assert.equal(c.lastTrackAt,undefined,'operator placement must not invent optical telemetry');
});
