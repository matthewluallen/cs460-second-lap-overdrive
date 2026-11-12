import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encode, decode, rgb, hex, ID, MAX_SPEED} from './protocol.mjs';
import {Pieces, Track, TrackMapper, Localizer, traversal, pointOn} from './track.mjs';
import {SimWorld, LAYOUTS, buildTrack} from './sim.mjs';
import {Car} from './car.mjs';
import {Battle, ALL_TYPES, WEAPON_LABEL, loadout} from './battle.mjs';
import {Game} from './game.mjs';

const data = name => JSON.parse(readFileSync(new URL('./data/' + name, import.meta.url), 'utf8'));
const pieces = data('pieces.json'), weapons = data('weapons.json'), vehicles = data('vehicles.json');
const P = new Pieces(pieces);

function rig(layout = 'Capsule') {
  let now = 0;
  const game = new Game({pieces, weapons, vehicles, clock: () => now});
  const world = new SimWorld(P, layout);
  const run = async (seconds, each) => {
    for (let t = 0; t < seconds; t += 0.02) { world.step(0.02); now += 20; game.tick(0.02, now); await 0; if (each?.() === true) return true; }
    return false;
  };
  const add = (options = {}, sim = {}) => game.addCar(world.addCar(sim), {simulated: true, ...options});
  return {game, world, run, add, now: () => now};
}

test('wire encoders match the published SDK layouts and clamp unsafe values', () => {
  assert.equal(hex(encode.sdkMode(true, 1)), '03 90 01 01');
  assert.equal(hex(encode.speed(500, 1000)), '06 24 f4 01 e8 03 00');
  assert.equal(hex(encode.speed(99999)), hex(encode.speed(MAX_SPEED)));
  assert.equal(hex(encode.speed(-50)), '06 24 00 00 e8 03 00');
  assert.equal(hex(encode.changeLane(-22.5, 300, 300)), '0b 25 2c 01 2c 01 00 00 b4 c1 00 00');
  assert.equal(hex(encode.setOffset(0)), '05 2c 00 00 00 00');
  assert.equal(hex(encode.turn(3, 0)), '03 32 03 00');
  assert.equal(hex(encode.lights(0x11)), '02 1d 11');
  assert.equal(hex(rgb(0, 1, 0)), '11 33 03 00 00 00 00 00 03 00 0e 0e 00 02 00 00 00 00');
  assert.throws(() => encode.speed(NaN), /number/);
  assert.throws(() => encode.lightsPattern([]), /1 to 3/);
  for (const bytes of [encode.speed(1), encode.changeLane(0), rgb(1, 1, 1), encode.sdkMode()]) {
    assert.equal(bytes[0], bytes.length - 1); assert.ok(bytes.length <= 20);
  }
});

test('decoder handles batched, app-only and malformed notifications', () => {
  const position = new Uint8Array(17), v = new DataView(position.buffer);
  position[0] = 16; position[1] = ID.POSITION; position[2] = 12; position[3] = 36; v.setFloat32(4, -22.5, true); v.setUint16(8, 480, true); position[10] = 0x47;
  const [m] = decode(position);
  assert.deepEqual([m.type, m.locationId, m.pieceId, m.offset, m.speed, m.reverse], ['position', 12, 36, -22.5, 480, true]);
  const many = decode(Uint8Array.of(1, 0x17, 3, 0x1b, 0x74, 0x0e, 5, 0x19, 0x27, 0x25, 0, 0, 3, 0x4d, 1, 0, 1, 0x2b));
  assert.deepEqual(many.map(x => x.type), ['ping', 'battery', 'version', 'collision', 'delocalized']);
  assert.equal(many[1].millivolts, 3700); assert.equal(many[2].version, 9511);
  assert.equal(decode(Uint8Array.of(2, 0x77, 1))[0].type, 'other');
  assert.throws(() => decode(Uint8Array.of(5, 0x27, 1)), /Malformed/);
  assert.throws(() => decode(Uint8Array.of(0, 0x27)), /Malformed/);
  assert.equal(decode(Uint8Array.of(2, 0x27, 1))[0].type, 'other', 'short known message is not trusted');
});

test('piece table covers every modular piece type from the app', () => {
  const kinds = new Set(Object.values(pieces).map(p => p.kind));
  assert.deepEqual([...kinds].sort(), ['curve', 'finish', 'intersection', 'jump', 'landing', 'start', 'straight']);
  assert.equal(Object.keys(pieces).length, 21);
  for (const [id, p] of Object.entries(pieces)) {
    assert.ok(Object.keys(p.locs).length >= 16, id);
    for (const [progress, lateral] of Object.values(p.locs)) { assert.ok(progress >= 0 && progress <= 1, id); assert.ok(Math.abs(lateral) <= 90, id); }
  }
  assert.equal(pieces['34'].length + pieces['33'].length, 560);
  assert.deepEqual(P.locate(36, 0, false), {progress: pieces['36'].locs['0'][0], lateral: 67.5});
  assert.equal(P.locate(36, 0, true).lateral, -67.5);
  assert.equal(P.locate(36, 250, false), null);
});

test('layout geometry: curves, closure and lane positions', () => {
  const t = buildTrack(P, LAYOUTS['Starter oval']);
  assert.ok(t.closed); assert.equal(t.count, 7);
  const curve = t.pieces[2], end = pointOn(curve, 1, 0);
  assert.ok(Math.abs(end.x - (560 + 280)) < 1e-6 && Math.abs(end.y - 280) < 1e-6);
  const inside = pointOn(curve, 0.5, 60), outside = pointOn(curve, 0.5, -60);
  assert.ok(Math.hypot(inside.x - curve.centre.x, inside.y - curve.centre.y) < Math.hypot(outside.x - curve.centre.x, outside.y - curve.centre.y));
  assert.ok(t.laneLength(2, 60) < t.laneLength(2, -60));
  const open = new Track([traversal(P, 36, false), traversal(P, 17, false), traversal(P, 36, false), traversal(P, 18, false)]);
  assert.equal(open.closed, false);
  const back = t.pose(0, 0.25, 10, -1), forward = t.pose(0, 0.75, -10, 1);
  assert.ok(Math.abs(back.x - forward.x) < 1e-6 && Math.abs(back.y - forward.y) < 1e-6);
});

test('automatic mapping reconstructs every built-in layout from car messages alone', async () => {
  for (const name of Object.keys(LAYOUTS)) {
    const {game, world, run, add} = rig(name);
    const driver = add({}, {index: 3, progress: 0.4, lateral: 22.5});
    game.startScan(driver);
    const done = await run(90, () => game.phase === 'ready');
    assert.ok(done, name + ' mapped');
    assert.deepEqual(game.track.pieces.map(p => [p.id, p.turn]), world.track.pieces.map(p => [p.id, p.turn]), name);
    assert.ok(game.track.closed, name);
    assert.equal(driver.car.speed, 0, 'scanner stops when the map is complete');
  }
});

test('mapping also works driving the loop the other way and when a piece code is missed', async () => {
  const {game, world, run, add} = rig('Capsule');
  const driver = add({}, {index: 5, progress: 0.2, lateral: -22.5, direction: -1});
  game.startScan(driver);
  assert.ok(await run(90, () => game.phase === 'ready'));
  assert.equal(game.track.count, world.track.count);
  assert.ok(game.track.pieces.filter(p => p.turn).every(p => p.turn === -1), 'reverse lap sees right turns');

  const mapper = new TrackMapper(P), source = buildTrack(P, LAYOUTS['Starter oval']);
  const lap = () => source.pieces.forEach((p, i) => {
    if (i !== 4) mapper.feed({type: 'position', pieceId: p.id, reverse: p.reverse});
    mapper.feed({type: 'transition', leftCm: p.turn ? 34 : 56, rightCm: p.turn ? 51 : 56});
  });
  lap(); lap(); lap();
  assert.ok(mapper.done, mapper.problem);
  assert.equal(mapper.track.count, 7); assert.ok(mapper.track.pieces[4].inferred);
});

test('localizer places cars, resolves duplicates and counts laps', async () => {
  const {game, world, run, add} = rig('Capsule');
  game.useTrack(buildTrack(P, LAYOUTS['Capsule']));
  const a = add({}, {index: 2, progress: 0.1, lateral: 22.5}), b = add({}, {index: 6, progress: 0.1, lateral: -22.5, direction: -1});
  a.input.throttle = 0.8; b.input.throttle = 0.6;
  await run(4);
  for (const [driver, sim] of [[a, world.cars[0]], [b, world.cars[1]]]) {
    const e = driver.car.localizer.estimate(game.clock());
    assert.ok(e.located); assert.equal(e.index, sim.index); assert.equal(e.direction, sim.direction);
    assert.ok(Math.abs(e.lateral - sim.lateral) < 6, 'lane from the printed code');
    const shown = driver.car.pose(), truth = world.track.pose(sim.index, sim.progress, sim.lateral, sim.direction);
    assert.ok(Math.hypot(shown.x - truth.x, shown.y - truth.y) < 120, 'drawn close to the true position');
  }
  await run(20);
  assert.ok(a.car.localizer.laps >= 2);
});

test('lane control calibrates the car and learns either left/right sign convention', async () => {
  for (const offsetSign of [-1, 1]) {
    const {game, world, run, add} = rig('Capsule');
    game.useTrack(buildTrack(P, LAYOUTS['Capsule']));
    const d = add({}, {lateral: 22.5, offsetSign}), sim = world.cars[0];
    d.input.throttle = 0.7;
    for (const lane of [-45, 45, -22.5, 67.5, 0]) { d.input.lane = lane; await run(6); }
    assert.equal(d.car.offsetSign, offsetSign, 'learned sign');
    d.input.lane = 45; await run(5);
    assert.ok(Math.abs(sim.lateral - 45) < 3, 'car ends in the commanded lane, sign ' + offsetSign + ', got ' + sim.lateral);
    game.nudge(d, -1); await run(5);
    assert.ok(Math.abs(sim.lateral - 22.5) < 3);
  }
});

test('every weapon type in the app data is implemented and labelled', () => {
  const types = new Set(Object.values(weapons).map(w => w.type));
  for (const type of types) assert.ok(ALL_TYPES.includes(type), type);
  assert.equal(ALL_TYPES.length, 14);
  for (const type of ALL_TYPES) assert.ok(WEAPON_LABEL[type]);
  for (const [model, v] of Object.entries(vehicles.models)) {
    const bays = loadout(vehicles, +model);
    assert.ok(bays.attack.length >= 1, v.name);
    for (const id of [...bays.attack, ...bays.support, ...bays.special]) assert.ok(weapons[id], v.name + ' ' + id);
  }
  assert.equal(Object.keys(vehicles.models).length, 21);
});

// Two cars on a straight: attacker behind, target ahead in the same lane.
async function duel(attackerModel, targetModel, {gap = 0.25, bay = 'attack', select = 0, hold = 3, sameLane = true} = {}) {
  const r = rig('Grand circuit');
  // Combat geometry fixture uses ordinary tiles; special-piece scoring is tested separately.
  const combatTrack = buildTrack(P, LAYOUTS['Grand circuit'].map(([id, reverse]) => [id === 53 ? 36 : id === 57 ? 39 : id, reverse]));
  r.world.track = combatTrack; r.game.useTrack(combatTrack);
  const a = r.add({model: attackerModel, control: 'browser'}, {index: 6, progress: 0.2, lateral: 22.5});
  const t = r.add({model: targetModel, control: 'browser'}, {index: 6, progress: 0.2 + gap * 1000 / 560, lateral: sameLane ? 22.5 : -58.5});
  r.game.startBattle();
  a.input.throttle = t.input.throttle = 0.6;
  await r.run(1.2);
  const fa = r.game.battle.get(a.car), ft = r.game.battle.get(t.car);
  fa.selected[bay] = select;
  return {...r, a, t, fa, ft, hold};
}

test('machine gun drains a target in range, misses one in another lane, and disables at zero', async () => {
  const d = await duel(8, 8);
  assert.ok(d.fa.item('attack'));
  d.a.input.attack = true; await d.run(1);
  assert.ok(d.ft.energy < 9.5, 'target took damage: ' + d.ft.energy);
  assert.ok(d.fa.energy < 10, 'firing costs energy');
  const miss = await duel(1, 1, {gap: 1.3});
  miss.a.input.attack = true; await miss.run(0.5);
  assert.equal(Math.round(miss.ft.energy), 10, 'beyond the 0.7 m cone');
  d.ft.energy = 0.2; d.fa.energy = 10; await d.run(1);
  assert.ok(d.ft.disabledUntil > d.now()); assert.equal(d.fa.kills, 1); assert.equal(d.ft.deaths, 1);
  assert.equal(d.game.battle.limit(d.t.car, 500).speed, 0, 'disabled car is held at zero');
  d.a.input.attack = false; await d.run(4);
  assert.equal(d.ft.disabledUntil, 0); assert.ok(d.ft.energy > 9, 'recovers with full energy');
});

test('shield blocks, tractor beam slows, boost speeds up, e-brake stops', async () => {
  const s = await duel(8, 3);                       // Rho carries a shield
  s.t.input.support = true; s.a.input.attack = true; await s.run(1);
  assert.ok(s.ft.shield > 0); assert.ok(s.ft.energy > 7.5, 'only the shield drain, no weapon damage');
  const tb = await duel(1, 1, {gap: 0.6});          // Kourai: tractor beam
  tb.a.input.support = true; await tb.run(0.5);
  const slowed = tb.game.battle.limit(tb.t.car, 500).speed;
  assert.ok(Math.abs(slowed - 500 * 0.42) < 1, 'ratio from the app data');
  const b = await duel(6, 1);                       // Hadion: boost
  b.a.input.support = true; await b.run(0.3);
  assert.ok(b.game.battle.limit(b.a.car, 400).speed > 400);
  assert.ok(b.a.car.speed <= MAX_SPEED);
  const fake = {...weapons.Gen1BoostL01, type: 'e-brake', energy_use_per_s: 2};
  b.game.battle.weapons = {...weapons, Brake: fake}; b.fa.bays.support = ['Brake']; b.fa.selected.support = 0;
  await b.run(0.3);
  assert.equal(b.game.battle.limit(b.a.car, 400).speed, 0);
});

test('mines, pulse ram, horn, scrambler, cannons, gravity trap, reverse drive and rage all take effect', async () => {
  const give = (d, who, bay, id, extra = {}) => { d.game.battle.weapons = {...d.game.battle.weapons, ['T' + id]: {...weapons[id], ...extra}}; who.bays[bay] = ['T' + id]; who.selected[bay] = 0; };
  // Mine: dropped by the car in front, hit by the car behind.
  let d = await duel(1, 16, {gap: 0.5});
  give(d, d.ft, 'attack', 'BoomerMineL01');
  d.t.input.attack = true; await d.run(0.1); d.t.input.attack = false;
  assert.equal(d.game.battle.mines.length, 1);
  d.a.input.throttle = 1; d.t.input.throttle = 0.3;
  assert.ok(await d.run(6, () => d.game.battle.mines.length === 0), 'mine went off');
  assert.ok(d.fa.energy < 9 || d.fa.deaths > 0, 'follower hit the mine');
  // Pulse ram: instant disable at close range.
  d = await duel(16, 1, {gap: 0.2});
  d.a.input.attack = true; await d.run(0.1);
  assert.ok(d.ft.disabledUntil > d.now()); assert.equal(d.fa.kills, 1);
  // Horn: forced lane change and speed cap.
  d = await duel(1, 1, {gap: 0.2});
  give(d, d.fa, 'support', 'Gen1TractorBeamL01', {...horn()});
  const before = d.t.car.targetLateral; d.a.input.support = true; await d.run(0.1);
  assert.notEqual(d.t.car.targetLateral, before); assert.ok(d.game.battle.limit(d.t.car, 1200).speed <= 800);
  // Scrambler: proximity damage plus wiggle.
  d = await duel(7, 1, {gap: 0.2});
  d.a.input.support = true; await d.run(1);
  assert.ok(d.ft.energy < 9); assert.ok(d.ft.wiggleUntil > 0);
  // Single-shot cannon and charged cannon.
  d = await duel(9, 1, {gap: 0.2});
  d.a.input.attack = true; await d.run(0.1); d.a.input.attack = false;
  assert.ok(d.ft.energy <= 10 - 2.5, 'shotgun damage_per_target');
  d = await duel(18, 1, {gap: 0.8});
  d.a.input.attack = true; await d.run(0.1);
  assert.ok(d.ft.energy <= 7.2, 'long-range cannon damage_per_target');
  d = await duel(15, 1, {gap: 0.8, select: 2});
  assert.equal(weapons[d.fa.item('attack')].interaction_style, 'charge');
  d.a.input.attack = true; await d.run(1.5); assert.equal(Math.round(d.ft.energy), 10, 'no damage while charging');
  d.a.input.attack = false; await d.run(0.1);
  assert.ok(d.ft.energy < 7, 'charged shot lands on release');
  // Gravity trap holds a car behind the truck.
  d = await duel(1, 15, {gap: 0.3});
  d.t.input.support = true; await d.run(0.1);
  assert.ok(d.game.battle.limit(d.a.car, 400).speed <= 100);
  // Reverse drive turns the car round.
  d = await duel(1, 1);
  give(d, d.fa, 'support', 'Gen1BoostL01', {type: 'reverse_drive', base_energy_cost: 2});
  const direction = d.world.cars[0].direction; d.a.input.support = true; await d.run(0.2);
  assert.equal(d.world.cars[0].direction, -direction);
  // Rage needs a full bar, then disables on contact.
  d = await duel(16, 1, {gap: 0.1});
  d.fa.energy = 5; d.a.input.special = true; await d.run(0.1); assert.equal(d.fa.rageUntil, 0);
  d.a.input.special = false; d.fa.energy = 10; await d.run(0.05); d.a.input.special = true; await d.run(0.2);
  assert.ok(d.fa.rageUntil > 0); assert.ok(d.ft.disabledUntil > 0);
  function horn() { return {type: 'horn', interaction_style: 'singleshot', base_energy_cost: 4, recharge_time_s: 3, targeter: {type: 'rectangle', half_width: 0.075, length: 0.4, single_target: true}, scripts: [{disabled_duration_s: 1.5, disabled_speed_max: 0.8, min_lanes_to_change: 4}]}; }
});

test('a full bot battle runs on every layout without losing cars, and stop halts everything', async () => {
  for (const name of ['Capsule', 'Figure eight']) {
    const {game, world, run, add} = rig(name);
    const scout = add({model: 8}, {index: 2});
    game.startScan(scout); assert.ok(await run(90, () => game.phase === 'ready'));
    for (const model of [9, 14, 15]) add({model});
    for (const d of game.drivers) game.setControl(d, 'bot');
    game.startBattle(); await run(60);
    const snap = game.snapshot();
    assert.ok(game.drivers.every(d => d.car.localizer.located), name + ': all cars have a unique piece hypothesis');
    // A disabled car may have no fresh codes; it must not be advertised as targetable.
    assert.ok(snap.every(s => s.located === !!game.drivers.find(d => d.id === s.id).car.localizer.estimate(game.clock()).located));
    assert.ok(snap.reduce((n, s) => n + s.kills, 0) >= 1, name + ': somebody scored');
    assert.ok(world.cars.every(c => c.speed <= MAX_SPEED + 1));
    game.stopAll(); await run(2);
    assert.ok(world.cars.every(c => c.speed === 0), 'every car stopped');
    assert.equal(game.phase, 'ready');
  }
});

test('a lost link is reported and never throws into the control loop', async () => {
  const {game, world, run, add} = rig();
  const d = add();
  let closed = 0; d.car.on(m => { if (m.type === 'closed') closed++; });
  d.input.throttle = 0.5; await run(0.2);
  world.cars[0].connected = false; d.input.throttle = 0.9; await run(0.5);
  assert.equal(closed, 1); assert.equal(d.car.connected, false);
  assert.equal(game.snapshot()[0].connected, false);
});

// ---- traces: record, replay, and any real-car recordings dropped into fixtures/ ----
import {readdirSync} from 'node:fs';
import {Recorder, ReplayCar, validate, TRACE_FORMAT} from './trace.mjs';

// Replay one car of a trace through the real decoder, mapper and localiser.
function replayCar(trace, index) {
  let now = 0;
  const transport = new ReplayCar(trace, index), car = new Car(transport, {pieces: P, clock: () => now});
  const mapper = new TrackMapper(P), seen = {position: 0, transition: 0, other: 0, pieces: new Set()};
  car.on(m => {
    if (m.type === 'position') { seen.position++; seen.pieces.add(m.pieceId); } else if (m.type === 'transition') seen.transition++; else seen.other++;
    if (!mapper.done) mapper.feed(m);
    else if (!car.localizer) car.useTrack(mapper.track);
  });
  const end = trace.events.length ? trace.events.at(-1)[0] : 0;
  for (; now <= end + 20; now += 20) transport.advance(now);
  return {car, mapper, seen, transport};
}

test('a recorded session replays to the same map, lane sign and commands', async () => {
  const {game, world, run, add} = rig('Capsule');
  const recorder = new Recorder(() => game.clock());
  const d = add({}, {index: 4, progress: 0.3, lateral: 22.5, offsetSign: 1});
  recorder.start(game.drivers, 'unit test');
  game.startScan(d); assert.ok(await run(90, () => game.phase === 'ready'));
  game.resume(); d.input.throttle = 0.7; for (const lane of [-45, 45, 0]) { d.input.lane = lane; await run(5); }
  const trace = JSON.parse(JSON.stringify(recorder.stop()));
  assert.equal(trace.format, TRACE_FORMAT); assert.equal(trace.source, 'simulator'); assert.equal(trace.dropped, 0);
  assert.ok(trace.events.some(e => e[2] === 'tx') && trace.events.some(e => e[2] === 'rx'));
  const again = replayCar(trace, 0);
  assert.ok(again.mapper.done);
  assert.deepEqual(again.mapper.track.pieces.map(p => [p.id, p.turn]), world.track.pieces.map(p => [p.id, p.turn]));
  assert.equal(again.car.offsetSign, d.car.offsetSign, 'the replay learns the same left/right sign as the live run');
  assert.ok(again.car.localizer?.located);
  for (const bad of [null, {}, {format: TRACE_FORMAT, cars: [{}], events: [[0, 1, 'rx', '01 17']]}, {format: TRACE_FORMAT, cars: [{}], events: [[5, 0, 'rx', '01 17'], [1, 0, 'rx', '01 17']]},
    {format: TRACE_FORMAT, cars: [{}], events: [[0, 0, 'rx', 'zz']]}, {format: TRACE_FORMAT, cars: [{}], events: [[0, 0, 'up', '01 17']]}]) assert.throws(() => validate(bad));
});

// Every trace in fixtures/ must decode cleanly and map to a closed loop. Traces
// recorded from real cars are the only test here that does not rest on the
// simulator's assumptions; the suite says plainly when there are none.
test('fixture traces replay through the real pipeline', t => {
  const dir = new URL('./fixtures/', import.meta.url);
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 1);
  let hardware = 0;
  for (const file of files) {
    const trace = validate(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
    if (trace.source === 'hardware') hardware++;
    trace.cars.forEach((info, index) => {
      const {mapper, seen, car} = replayCar(trace, index);
      if (seen.position + seen.transition === 0) return;       // a parked car
      assert.ok(seen.position > 0, file + ': position updates decoded');
      for (const id of seen.pieces) assert.ok(P.get(id), file + ': piece ' + id + ' is in the table');
      if (trace.expect?.pieces) {
        assert.ok(mapper.done, file + ': ' + (mapper.problem || 'loop not closed'));
        assert.equal(mapper.track.count, trace.expect.pieces, file);
      }
      if (trace.expect?.offsetSign) assert.equal(car.offsetSign, trace.expect.offsetSign, file + ': left/right sign');
    });
  }
  t.diagnostic(hardware ? hardware + ' hardware trace(s) replayed' : 'NO HARDWARE TRACES YET: only simulator recordings were replayed');
});
