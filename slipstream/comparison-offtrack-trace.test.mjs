import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decode, ID} from './protocol.mjs';
import {Localizer, Pieces, TrackMapper, trackValidation} from './track.mjs';
import {validate} from './trace.mjs';

// Verbatim hardware evidence. Packet replay cannot establish physical position,
// physical STOP, or the cause of the departure reported by the operator.
const load = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const trace = validate(load('./fixtures/groundshock-sdk-comparison-offtrack.json'));
const bytes = hex => Uint8Array.from(hex.split(' ').map(b => parseInt(b, 16)));
const events = trace.events.map(([at, car, direction, hex], index) =>
  ({at, car, direction, hex, index, packet:bytes(hex)}));
const tx = events.filter(e => e.direction === 'tx');
const rx = events.filter(e => e.direction === 'rx').flatMap(e =>
  decode(e.packet).map(message => ({...e, message})));
const view = e => new DataView(e.packet.buffer, e.packet.byteOffset, e.packet.byteLength);
const speed = e => view(e).getInt16(2, true);

test('comparison capture starts SDK forward motion and calibrates once after optical acquisition, without steering', () => {
  assert.equal(trace.events.length, 428);
  assert.equal(trace.dropped, 0);
  assert.equal(trace.source, 'hardware');
  assert.deepEqual([trace.cars[0].profile, trace.cars[0].firmware], ['sdk', 11866]);
  const motion = tx.filter(e => e.packet[1] === ID.SPEED && speed(e) > 0);
  assert.deepEqual(motion.map(e => [e.at, e.hex]), [[59291, '06 24 2c 01 e8 03 00']]);
  assert.deepEqual(tx.filter(e => e.at <= 150).map(e => [e.at, e.hex]), [
    [11, '06 24 00 00 c4 09 00'], [19, '03 90 01 01'],
    [21, '01 16'], [60, '01 18'], [150, '06 24 00 00 c4 09 00'],
    [150, '01 1a'], [150, '11 33 03 00 00 00 00 00 03 00 0e 0e 00 02 00 00 00 00']
  ]);
  assert.equal(tx.some(e => [ID.CHANGE_LANE, 0x35, 0x37].includes(e.packet[1])), false);
  const offsets = tx.filter(e => e.packet[1] === ID.SET_OFFSET);
  assert.deepEqual(offsets.map(e => [e.at, e.hex]), [[61623, '05 2c cd cc 0a c2']]);
  const firstPosition = rx.find(e => e.message.type === 'position');
  assert.deepEqual([firstPosition.at, firstPosition.message.pieceId, firstPosition.message.locationId,
    firstPosition.message.reverse, firstPosition.message.offset], [61622, 18, 9, false, 654321]);
  assert.ok(offsets[0].index > firstPosition.index);
  assert.ok(Math.abs(view(offsets[0]).getFloat32(2, true) + 34.7) < 1e-5);
});

test('comparison capture reports loss of track before delocalization-triggered STOP and never commands a restart', () => {
  const positions = rx.filter(e => e.message.type === 'position');
  assert.deepEqual(positions.map(e => [e.at, e.message.pieceId, e.message.locationId,
    e.message.reverse, e.message.speed]), [
    [61622, 18, 9, false, 297], [63328, 57, 25, true, 245],
    [64010, 57, 24, true, 251], [65584, 39, 13, false, 239]
  ]);
  const transitions = rx.filter(e => e.message.type === 'transition');
  assert.deepEqual(transitions.map(e => [e.at, e.message.pieceIndex, e.message.previousPieceIndex]),
    [60333, 61712, 64053, 66843, 68853, 70128].map(at => [at, 0, 0]));
  assert.ok(Math.abs(transitions.at(-1).message.offset + 169.7) < 1e-5);
  assert.ok([...positions, ...transitions].every(e =>
    e.message.lastReceivedLaneChangeId === 0xff && e.message.lastExecutedLaneChangeId === 0xff));
  const lostStatus = rx.find(e => e.at === 70865 && e.message.type === 'status');
  assert.equal(lostStatus.message.onTrack, false);
  assert.equal(rx.find(e => e.message.type === 'delocRecoveryEntered').at, 71313);
  const lost = rx.find(e => e.message.type === 'delocalized');
  assert.equal(lost.at, 71553);
  const stop = tx.find(e => e.index > lost.index);
  assert.deepEqual([stop.at, stop.hex], [71554, '06 24 00 00 c4 09 00']);
  assert.equal(stop.at - lostStatus.at, 689);
  assert.equal(stop.at - lost.at, 1, 'recorded write completion, not physical braking latency');
  assert.ok(tx.filter(e => e.index >= stop.index).every(e => e.hex === stop.hex));
  const report = rx.find(e => e.index > stop.index && e.message.type === 'speed');
  assert.deepEqual([report.at, report.message.desired, report.message.actual], [71613, 0, 0]);
  assert.equal(rx.some(e => e.index > lost.index && e.message.type === 'position'), false);
  assert.equal(trace.diagnostics.halted, true);
  assert.equal(trace.diagnostics.cars[0].physicalStopVerified, false);
});

test('comparison optical replay disambiguates duplicate road IDs on the prior map without claiming start-line placement', () => {
  // This capture contains track checks, not the complete loaded map. Reconstruct
  // the earlier successful scan and verify its checks match before comparing.
  const scan = validate(load('./fixtures/groundshock-sdk-repaired-scan.json'));
  const pieces = new Pieces(load('./data/pieces.json'));
  const mapper = new TrackMapper(pieces);
  const scanStart = scan.markers.find(m => m.kind === 'scan-start').timeMs;
  for (const [at, , direction, hex] of scan.events) {
    if (at < scanStart || direction !== 'rx') continue;
    for (const message of decode(bytes(hex))) mapper.feed(message);
  }
  assert.deepEqual(trackValidation(mapper.track), trace.diagnostics.trackChecks);
  const localizer = new Localizer(mapper.track, pieces);
  const observed = [];
  const inferredSteps = [];
  for (const e of rx) {
    localizer.feed(e.message, e.at);
    if (e.message.type === 'position') {
      const estimate = localizer.estimate(e.at);
      observed.push([e.at, estimate.index, estimate.direction, estimate.located,
        localizer.candidates.map(c => c.index)]);
    }
    if (e.message.type === 'transition' && e.at > 65584) {
      inferredSteps.push([e.at, localizer.index, localizer.estimate(e.at)?.located ?? false]);
    }
    if (e.message.type === 'delocalized') {
      assert.equal(localizer.located, false);
      assert.equal(localizer.estimate(e.at)?.located ?? false, false);
    }
  }
  assert.deepEqual(observed, [
    [61622, 1, 1, false, [1, 9]], [63328, 2, 1, true, [2]],
    [64010, 2, 1, true, [2]], [65584, 3, 1, true, [3]]
  ]);
  assert.deepEqual(inferredSteps, [[66843, 4, true], [68853, 4, false], [70128, 4, false]]);
  assert.equal(rx.some(e => e.message.type === 'position' && e.message.pieceId === 33), false);
  // The first transition predicts index 4. Later transition wire indices are
  // still zero and cannot advance an expired optical reference or count laps.
  assert.equal(rx.some(e => e.at > 65584 && e.message.type === 'position'), false);
  assert.equal(localizer.laps, 0);
});
