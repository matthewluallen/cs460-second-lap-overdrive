import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decode, ID} from './protocol.mjs';
import {Localizer, Pieces, trackFromPlan, trackValidation} from './track.mjs';
import {validate} from './trace.mjs';

// Frozen hardware capture from a connection that never requested motion.
// Packet evidence does not itself establish the physical car's state or explain
// why its firmware repeatedly entered recovery while requested speed was zero.
const trace = validate(JSON.parse(readFileSync(new URL(
  './fixtures/groundshock-sdk-stationary-recovery-loop.json', import.meta.url))));
const bytes = hex => Uint8Array.from(hex.split(' ').map(b => parseInt(b, 16)));
const events = trace.events.map(([at, car, direction, hex], index) =>
  ({at, car, direction, hex, index, packet:bytes(hex)}));
const tx = events.filter(e => e.direction === 'tx');
const rx = events.filter(e => e.direction === 'rx').flatMap(e =>
  decode(e.packet).map(message => ({...e, message})));
const stop = '06 24 00 00 c4 09 00';

test('stationary recovery capture initializes SDK 11866 without any motion, lane or offset command', () => {
  assert.equal(trace.events.length, 680);
  assert.equal(trace.dropped, 0);
  assert.equal(trace.markersDropped, 0);
  assert.equal(trace.source, 'hardware');
  assert.deepEqual([trace.cars[0].profile, trace.cars[0].firmware], ['sdk', 11866]);
  assert.deepEqual(tx.filter(e => e.at <= 3693).map(e => [e.at, e.hex]), [
    [3315, stop], [3321, '03 90 01 01'], [3323, '01 16'],
    [3575, '01 18'], [3633, stop], [3693, stop], [3693, '01 1a'],
    [3693, '11 33 03 00 00 00 00 00 03 00 0e 0e 00 02 00 00 00 00']
  ]);
  const speedWrites = tx.filter(e => e.packet[1] === ID.SPEED);
  assert.equal(speedWrites.length, 224);
  assert.ok(speedWrites.every(e => e.hex === stop));
  assert.equal(tx.some(e => [ID.CHANGE_LANE, ID.SET_OFFSET].includes(e.packet[1])), false);
  assert.deepEqual(tx.filter(e => e.hex !== stop).map(e => [e.at, e.hex]), [
    [3321, '03 90 01 01'], [3323, '01 16'], [3575, '01 18'],
    [3693, '01 1a'], [3693, '11 33 03 00 00 00 00 00 03 00 0e 0e 00 02 00 00 00 00'],
    [78052, '01 1a']
  ]);
  const version = rx.find(e => e.message.type === 'version');
  assert.deepEqual([version.at, version.message.version], [3692, 11866]);
  assert.deepEqual(rx.filter(e => e.message.type === 'battery').map(e => [e.at, e.message.millivolts]),
    [[3813, 4158], [78125, 4145]]);
  assert.equal(rx.some(e => ['position', 'transition', 'laneChange', 'speed'].includes(e.message.type)), false);
});

test('stationary firmware recovery starts during initialization and each recorded delocalization receives another STOP', () => {
  const status = rx.filter(e => e.message.type === 'status');
  assert.equal(status.length, 1);
  assert.deepEqual([status[0].at, status[0].message.onTrack, status[0].message.onCharger,
    status[0].message.lowBattery, status[0].message.charged], [3307, false, false, false, true]);
  const recoveries = rx.filter(e => e.message.type === 'delocRecoveryEntered');
  const losses = rx.filter(e => e.message.type === 'delocalized');
  assert.equal(recoveries.length, 222);
  assert.equal(losses.length, 222);
  assert.deepEqual([recoveries[0].at, recoveries.at(-1).at], [3574, 78067]);
  assert.deepEqual([losses[0].at, losses.at(-1).at], [3632, 78336]);
  assert.ok(recoveries[0].index < rx.find(e => e.message.type === 'version').index,
    'recovery began before SDK initialization completed, with no positive speed command');
  const delays = losses.map(loss => {
    const nextWrite = tx.find(e => e.index > loss.index);
    assert.equal(nextWrite.hex, stop);
    return nextWrite.at - loss.at;
  });
  assert.equal(delays[0], 1);
  assert.equal(Math.min(...delays), 0);
  assert.equal(Math.max(...delays), 43, 'wire-write completion timing, not physical braking latency');
  assert.equal(rx.some(e => e.message.type === 'delocRecoverySucceeded'), false);
  const diagnostic = trace.diagnostics.cars[0];
  assert.equal(trace.diagnostics.halted, true);
  assert.deepEqual([diagnostic.requestedSpeed, diagnostic.positions, diagnostic.transitions], [0, 0, 0]);
  assert.equal(diagnostic.localization.trusted, false);
  assert.equal(diagnostic.localization.reference, null);
  assert.equal(diagnostic.physicalStopVerified, false);
  // Diagnostics were sampled later than the frozen wire recording. Their
  // lifetime counters are not interchangeable with this fixture's event counts.
  assert.deepEqual([diagnostic.recoveryEntered, diagnostic.counts['0x2b/2']], [250, 249]);
  assert.equal(trace.diagnostics.track.length, 11);
});

const cold = validate(JSON.parse(readFileSync(new URL(
  './fixtures/groundshock-sdk-start-reference-mismatch.json', import.meta.url))));
const coldEvents = cold.events.map(([at, car, direction, hex], index) =>
  ({at, car, direction, hex, index, packet:bytes(hex)}));
const coldTx = coldEvents.filter(e => e.direction === 'tx');
const coldRx = coldEvents.filter(e => e.direction === 'rx').flatMap(e =>
  decode(e.packet).map(message => ({...e, message})));

test('post-power-cycle capture has no recovery loop and stops its first mismatched optical reference without steering', () => {
  assert.equal(cold.events.length, 32);
  assert.equal(cold.dropped, 0);
  assert.deepEqual([cold.cars[0].profile, cold.cars[0].firmware], ['sdk', 11866]);
  assert.equal(coldRx.some(e => ['delocRecoveryEntered', 'delocalized'].includes(e.message.type)), false);
  assert.equal(rx.filter(e => e.message.type === 'delocRecoveryEntered').length, 222,
    'the previous capture contains the loop; its absence here does not prove why it ended');
  const speeds = coldTx.filter(e => e.packet[1] === ID.SPEED);
  assert.equal(speeds.length, 8);
  assert.deepEqual(speeds.filter(e => e.hex !== stop).map(e => [e.at, e.hex]),
    [[107009, '06 24 2c 01 e8 03 00']]);
  assert.equal(coldTx.some(e => [ID.CHANGE_LANE, ID.SET_OFFSET].includes(e.packet[1])), false);
  const optical = coldRx.filter(e => ['position', 'transition'].includes(e.message.type));
  assert.deepEqual(optical.map(e => [e.at, e.message.type]), [[107994, 'transition'], [108635, 'position']]);
  const position = optical[1];
  assert.deepEqual([position.message.pieceId, position.message.locationId, position.message.reverse,
    position.message.speed, position.message.offset, position.message.lastReceivedLaneChangeId,
    position.message.lastExecutedLaneChangeId], [18, 8, false, 301, 654321, 255, 255]);
  const stopped = coldTx.find(e => e.index > position.index);
  assert.deepEqual([stopped.at, stopped.hex], [108636, stop]);
  assert.equal(stopped.at - position.at, 1);
  assert.equal(stopped.at - 107009, 1627);
  assert.equal(coldTx.some(e => e.index > stopped.index), false);
  const reply = coldRx.find(e => e.index > stopped.index && e.message.type === 'speed');
  assert.deepEqual([reply.at, reply.message.desired, reply.message.actual], [108684, 0, 306]);
  assert.equal(cold.diagnostics.halted, true);
  assert.match(cold.diagnostics.pitReason, /Reference mismatch.*piece 18, code 8/);
  assert.equal(cold.diagnostics.cars[0].laneCancellationComparison.stage, 'failed');
  assert.equal(cold.diagnostics.cars[0].physicalStopVerified, false);
});

test('the full exported map makes the first road-18 code ambiguous and cannot establish a start/finish reference', () => {
  const pieces = new Pieces(JSON.parse(readFileSync(new URL('./data/pieces.json', import.meta.url))));
  const track = trackFromPlan(pieces, cold.diagnostics.track);
  assert.deepEqual(track.pieces.map(p => [p.id, p.reverse]), [
    [33, false], [18, false], [57, true], [39, false], [20, false],
    [17, false], [17, true], [23, false], [36, false], [18, false], [34, false]
  ]);
  assert.deepEqual(trackValidation(track), cold.diagnostics.trackChecks);
  const localizer = new Localizer(track, pieces);
  for (const e of coldRx) localizer.feed(e.message, e.at);
  assert.deepEqual(localizer.candidates, [{index:1, direction:1}, {index:9, direction:1}]);
  const location = localizer.diagnostics(108635);
  assert.equal(location.state, 'ambiguous');
  assert.equal(location.trusted, false);
  assert.deepEqual([location.reference.pieceId, location.reference.locationId,
    location.reference.index, location.reference.direction], [18, 8, null, null]);
  assert.equal(pieces.get(18).kind, 'curve');
  assert.equal(coldRx.some(e => e.message.type === 'position' && [33, 34].includes(e.message.pieceId)), false);
  assert.equal(localizer.laps, 0);
});
