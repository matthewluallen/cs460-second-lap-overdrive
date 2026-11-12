import test from 'node:test';
import assert from 'node:assert/strict';
import {RoundSession, STORY_MISSIONS} from './session.mjs';
const car = (id = 1, extra = {}) => ({id, name: 'Car ' + id, control: 'keys1', connected: true, located: true, circuitProgress: 0, circuitDirection: 1, kills: 0, deaths: 0, ...extra});
const circuit = (session, rows, start = 0) => {
  for (let i = 1; i <= 5; i++) session.update(rows.map(row => ({...row, circuitProgress: (i * 0.2) % 1})), start + i * 1000);
};
test('solo scores complete loops, records personal lap time, and freezes results at the deadline', () => {
  const s = new RoundSession(); s.start('solo', [car()], 0, {durationMs: 10000});
  circuit(s, [car()]); assert.equal(s.view().rows[0].laps, 1); assert.equal(s.view().rows[0].bestLapMs, 5000);
  const result = s.update([car(1, {kills: 100})], 10001);
  assert.equal(result.status, 'finished'); assert.equal(result.rows[0].hits, 0);
  s.update([car(1, {kills: 999})], 11000); assert.deepEqual(s.view(), result);
});
test('U-turns and localization gaps cannot manufacture completed laps', () => {
  const s = new RoundSession(); s.start('solo', [car()], 0);
  for (let i = 1; i <= 12; i++) s.update([car(1, {circuitProgress: i % 2 ? 0.1 : 0.9, circuitDirection: i % 2 ? 1 : -1})], i * 1000);
  assert.equal(s.view().rows[0].laps, 0);
  s.update([car(1, {located: false})], 13000);
  s.update([car(1, {circuitProgress: 0.8})], 14000);
  s.update([car(1, {circuitProgress: 0.1})], 15000);
  assert.equal(s.view().rows[0].laps, 0);
});
test('pausing excludes elapsed pause time and discards incomplete laps', () => {
  const s = new RoundSession(); s.start('solo', [car()], 0);
  s.update([car(1, {circuitProgress: 0.2})], 1000); s.pause(2000);
  s.update([car(1, {circuitProgress: 0.8})], 9000); assert.equal(s.view().elapsedMs, 2000);
  s.resume(12000); s.update([car()], 13000); assert.equal(s.view().elapsedMs, 3000);
  circuit(s, [car()], 13000); assert.equal(s.view().rows[0].laps, 1); assert.equal(s.view().rows[0].bestLapMs, 5000);
});
test('crew mission shares a goal between humans and bots and freezes its roster', () => {
  const s = new RoundSession(), rows = [car(), car(2, {control: 'bot'})];
  s.start('team', rows, 0, {goal: 2}); circuit(s, rows);
  const v = s.view(); assert.equal(v.status, 'finished'); assert.equal(v.reason, 'goal');
  assert.deepEqual(v.winnerIds, [1, 2]); assert.equal(v.rows[1].computer, true);
});
test('battle counts only new knockouts; resets do not subtract earned points', () => {
  const s = new RoundSession(); s.start('battle', [car(1, {kills: 5}), car(2)], 0);
  s.update([car(1, {kills: 6}), car(2)], 1000); assert.equal(s.view().rows[0].score, 100);
  s.update([car(), car(2)], 2000); assert.equal(s.view().rows[0].score, 100);
  s.update([car(1, {kills: 1}), car(2)], 3000); assert.equal(s.view().rows[0].score, 200);
});
test('rounds refuse invalid rosters and end when all participants disconnect', () => {
  const s = new RoundSession();
  assert.throws(() => s.start('race', [car()], 0), /2 active/);
  assert.throws(() => s.start('solo', Array.from({length: 5}, (_, i) => car(i)), 0), /four/);
  assert.throws(() => s.start('solo', [car(1, {control: 'none'})], 0), /active/);
  s.start('solo', [car()], 0); s.update([], 1000);
  assert.equal(s.view().reason, 'disconnected'); assert.deepEqual(s.view().winnerIds, []);
});
test('reverse-direction full circuits count, and unmapped lap counters never earn points', () => {
  const s = new RoundSession(); s.start('solo', [car(1, {circuitDirection: -1})], 0);
  for (let i = 1; i <= 5; i++) s.update([car(1, {circuitDirection: -1, circuitProgress: (1 - i * 0.2 + 1) % 1})], i * 1000);
  assert.equal(s.view().rows[0].laps, 1);
  s.update([car(1, {laps: 100, circuitProgress: undefined})], 6000);
  assert.equal(s.view().rows[0].laps, 1);
});

test('solo ranks best complete lap before total laps and awards only measured badges', () => {
  const s = new RoundSession(), rows = [car(), car(2)];
  s.start('solo', rows, 0);
  for (let i = 1; i <= 20; i++) s.update([car(1, {circuitProgress: (i * 0.1) % 1}), car(2, {circuitProgress: i <= 5 ? (i * 0.2) % 1 : 0})], i * 500);
  const v = s.finish(10000);
  assert.equal(v.rows[0].id, 2); assert.equal(v.rows[0].bestLapMs, 2500);
  assert.deepEqual(v.winnerIds, [2]); assert.equal(v.badges.length, 2);
  assert.equal(v.badges.every(b => b.id === 'full-lap'), true);
});
test('original story missions supply bounded shared objectives without motor settings', () => {
  assert.equal(STORY_MISSIONS.length, 3);
  assert.equal(new Set(STORY_MISSIONS.map(m => m.id)).size, 3);
  for (const mission of STORY_MISSIONS) {
    assert.ok(mission.goalPerCar >= 1 && mission.goalPerCar <= 3);
    assert.ok(mission.durationMs >= 90000 && mission.durationMs <= 150000);
    assert.equal('speed' in mission, false);
  }
});
