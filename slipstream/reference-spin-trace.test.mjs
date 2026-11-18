import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decode, ID} from './protocol.mjs';
import {Localizer, Pieces, trackFromPlan, trackValidation} from './track.mjs';
import {validate} from './trace.mjs';

// Recorded bytes from the same SDK connection as the preceding mismatch trial.
// Operator-observed spinning is not deduced from notification flags or offsets.
const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const trace = validate(json('./fixtures/groundshock-sdk-reference-spin.json'));
const raw = hex => Uint8Array.from(hex.split(' ').map(b => parseInt(b, 16)));
const events = trace.events.map(([at, car, direction, hex], index) =>
  ({at, car, direction, hex, index, packet:raw(hex)}));
const tx = events.filter(e => e.direction === 'tx');
const rx = events.filter(e => e.direction === 'rx').flatMap(e =>
  decode(e.packet).map(message => ({...e, message})));
const speed = e => new DataView(e.packet.buffer, e.packet.byteOffset, e.packet.byteLength).getInt16(2, true);

test('reference-spin capture contains forward speed only, with no fresh initialization, offset, lane or turn command', () => {
  assert.equal(trace.events.length, 29);
  assert.equal(trace.dropped, 0);
  assert.equal(trace.source, 'hardware');
  assert.deepEqual([trace.cars[0].profile, trace.cars[0].firmware], ['sdk', 11866]);
  assert.ok(tx.every(e => [ID.SPEED, ID.BATTERY].includes(e.packet[1])));
  assert.equal(tx.some(e => [0x25, 0x2c, 0x32, 0x34, 0x35, 0x37, 0x90].includes(e.packet[1])), false);
  assert.deepEqual(tx.filter(e => e.packet[1] === ID.SPEED && speed(e) > 0).map(e => [e.at, e.hex]),
    [[31729, '06 24 2c 01 e8 03 00']]);
  assert.deepEqual(rx.filter(e => e.message.type === 'battery').map(e => [e.at, e.message.millivolts]),
    [[434, 3904], [22591, 3947]]);
  const optical = rx.filter(e => ['position', 'transition'].includes(e.message.type));
  assert.deepEqual(optical.map(e => [e.at, e.message.type]),
    [[31952, 'transition'], [32551, 'position'], [33061, 'position'], [33121, 'transition']]);
  assert.ok(optical.every(e => e.message.offset === 654321));
  assert.ok(optical.every(e => e.message.lastReceivedLaneChangeId === 255 && e.message.lastExecutedLaneChangeId === 255));
  assert.equal(rx.some(e => ['laneChange', 'delocalized', 'delocRecoveryEntered', 'delocRecoverySucceeded'].includes(e.message.type)), false);
});

test('reference-spin capture confirms two start codes then times out after optical silence and records STOP', () => {
  const positions = rx.filter(e => e.message.type === 'position');
  assert.deepEqual(positions.map(e => [e.at, e.message.pieceId, e.message.locationId, e.message.reverse, e.message.speed]),
    [[32551, 34, 12, false, 308], [33061, 34, 13, false, 312]]);
  const confirmed = trace.markers.find(m => m.kind === 'log' && m.details.text.startsWith('Reference confirmed:'));
  assert.equal(confirmed.timeMs, 33061);
  const timeout = trace.markers.find(m => m.kind === 'log' && m.details.text === 'Groundshock: Telemetry timeout');
  assert.equal(timeout.timeMs, 35145);
  const lastOptical = rx.filter(e => ['position', 'transition'].includes(e.message.type)).at(-1);
  assert.equal(timeout.timeMs - lastOptical.at, 2024);
  const stop = tx.find(e => e.at >= timeout.timeMs);
  assert.deepEqual([stop.at, stop.hex], [35146, '06 24 00 00 c4 09 00']);
  assert.equal(stop.at - timeout.timeMs, 1, 'recorded command completion, not physical braking latency');
  assert.equal(stop.at - 31729, 3417);
  const report = rx.find(e => e.index > stop.index && e.message.type === 'speed');
  assert.deepEqual([report.at, report.message.desired, report.message.actual], [35223, 0, 0]);
  assert.equal(tx.some(e => e.index > stop.index), false);
  assert.equal(rx.filter(e => e.message.type === 'collision').length, 8);
  const late = rx.find(e => e.message.type === 'intersection');
  assert.deepEqual([late.at, late.message.offset, late.message.code], [44702, 654312, 4]);
  assert.ok(late.index > stop.index);
  assert.equal(trace.diagnostics.cars[0].laneCancellationComparison.stage, 'driving');
  assert.equal(trace.diagnostics.cars[0].laneCancellationComparison.active, false);
  assert.equal(trace.diagnostics.halted, true);
  assert.equal(trace.diagnostics.cars[0].physicalStopVerified, false);
});

test('successful scan and reference acquisition share forward bytes but preserve different calibration histories', () => {
  const successful = validate(json('./fixtures/groundshock-sdk-repaired-scan.json'));
  const scanned = successful.events.map(([at, car, direction, hex], index) =>
    ({at, car, direction, hex, index, packet:raw(hex)}));
  const scanStart = successful.markers.find(m => m.kind === 'scan-start').timeMs;
  const scanTx = scanned.filter(e => e.car === 0 && e.direction === 'tx' && e.at >= scanStart);
  const scanPositions = scanned.filter(e => e.car === 0 && e.direction === 'rx' && e.at >= scanStart)
    .flatMap(e => decode(e.packet).filter(m => m.type === 'position').map(message => ({...e, message})));
  const positiveWrites = writes => writes.filter(e => e.packet[1] === ID.SPEED && speed(e) > 0).map(e => e.hex);
  assert.deepEqual(positiveWrites(scanTx), ['06 24 2c 01 e8 03 00']);
  assert.deepEqual(positiveWrites(tx), positiveWrites(scanTx));
  assert.deepEqual([successful.cars[0].profile, successful.cars[0].firmware], ['sdk', 11866]);

  const first = scanPositions[0], offsets = scanTx.filter(e => e.packet[1] === ID.SET_OFFSET);
  assert.deepEqual([first.at, first.message.pieceId, first.message.locationId, first.message.offset],
    [23146, 33, 5, 654321]);
  assert.deepEqual(offsets.map(e => [e.at, e.hex]), [[23146, '05 2c 00 00 b4 c1']]);
  assert.ok(offsets[0].index > first.index, 'event order resolves the shared rounded timestamp');
  assert.ok(offsets[0].index < scanPositions[1].index);
  const offset = new DataView(offsets[0].packet.buffer).getFloat32(2, true);
  assert.equal(offset, -22.5);
  assert.equal(scanPositions[1].message.offset, offset);
  assert.equal(scanTx.some(e => [ID.CHANGE_LANE, ID.TURN].includes(e.packet[1])), false);

  const acquisition = trace.markers.find(m => m.kind === 'log' && m.details.text.startsWith('Reference acquisition:'));
  const confirmed = trace.markers.find(m => m.kind === 'log' && m.details.text.startsWith('Reference confirmed:'));
  const referencePositions = rx.filter(e => e.message.type === 'position');
  assert.ok(acquisition.details.text.includes('steering and calibration remain locked'));
  assert.ok(acquisition.timeMs < referencePositions[0].at);
  assert.equal(confirmed.timeMs, referencePositions[1].at);
  assert.deepEqual(referencePositions.map(e => [e.message.pieceId, e.message.locationId, e.message.offset]),
    [[34, 12, 654321], [34, 13, 654321]]);
  assert.equal(tx.some(e => [ID.SET_OFFSET, ID.OFFSET_ADJUST, ID.CHANGE_LANE, ID.TURN].includes(e.packet[1])), false);
  // These are different runs, first observed sections and connection histories.
  // The newer recording excludes initialization; the older one includes it.
  // Matching speed bytes do not establish equal firmware state, and this
  // calibration difference does not establish the cause of observed spinning.
  assert.ok(scanned.some(e => e.direction === 'tx' && e.hex === '03 90 01 01'));
  assert.equal(tx.some(e => e.packet[1] === ID.SDK_MODE), false);
});

test('reference-spin optical evidence identifies the start section but does not observe a full circuit', () => {
  const pieces = new Pieces(json('./data/pieces.json'));
  const track = trackFromPlan(pieces, trace.diagnostics.track);
  assert.deepEqual(trackValidation(track), trace.diagnostics.trackChecks);
  const localizer = new Localizer(track, pieces);
  const states = [];
  for (const e of rx) {
    localizer.feed(e.message, e.at);
    if (['position', 'transition'].includes(e.message.type)) {
      states.push([e.at, localizer.index, localizer.estimate(e.at)?.located ?? false]);
    }
  }
  assert.deepEqual(states, [[31952, -1, false], [32551, 10, true], [33061, 10, true], [33121, 0, true]]);
  const positions = rx.filter(e => e.message.type === 'position');
  assert.deepEqual([...new Set(positions.map(e => e.message.pieceId))], [34]);
  assert.deepEqual(positions.map(e => pieces.locate(e.message.pieceId, e.message.locationId, e.message.reverse)),
    [{progress:0.294, lateral:13.5}, {progress:0.765, lateral:13.5}]);
  assert.equal(track.pieces[10].id, 34);
  assert.equal(track.pieces[0].id, 33);
  // The one index-10→0 prediction is crossing the map's array boundary. No
  // position on any of its other ten sections confirms a completed circuit.
  assert.equal(localizer.laps, 0, 'first partial start-section crossing must not count as a full lap');
  assert.equal(localizer.estimate(35146)?.located, false);
});
