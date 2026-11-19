import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {SimWorld} from './sim.mjs';
import {loadout} from './battle.mjs';
import {ID, rgb} from './protocol.mjs';

const data = name => JSON.parse(readFileSync(new URL(`./data/${name}.json`, import.meta.url)));
const catalogue = {pieces: data('pieces'), vehicles: data('vehicles'), weapons: data('weapons')};
const expected = new Map([
  [18, {name: 'Mammoth', attack: 'MammothLongRangeL01', support: 'MammothShieldL01'}],
  [19, {name: 'Dynamo', attack: 'DynamoAOEL01', support: 'DynamoBoostL01'}],
]);

// These are host/model regressions, not firmware emulation. SimCar implements
// SDK commands and idealized track following. In particular it does not model
// app-mode 0x23 initialization or establish either physical F&F car's behavior.
async function rig(models, profile = 'sdk', placements = []) {
  let now = 1000;
  const game = new Game({...catalogue, clock: () => now});
  game.setDrivingOptions({maximumSpeed: 300});
  const world = new SimWorld(game.pieces, 'Starter oval');
  const cars = models.map((model, i) => {
    const sim = world.addCar({model, index: 4, progress: .05 + i * .07,
      lateral: i % 2 ? -22.5 : 22.5, ...placements[i]});
    if (profile) sim.initializationProfile = profile;
    const writes = [], write = sim.write.bind(sim);
    sim.write = bytes => { writes.push({at: now, bytes: Uint8Array.from(bytes)}); return write(bytes); };
    // Exercise physical SDK freshness/steering guards over a simulated radio.
    // The legacy simulator case keeps its ordinary simulated-car path.
    const driver = game.addCar(sim, {model, simulated: !profile, control: 'none'});
    return {model, sim, driver, writes};
  });
  const settle = () => Promise.all(cars.map(({driver}) => driver.car.pumpPromise));
  await Promise.all(cars.map(({driver}) => driver.car.initialization));
  await settle();
  const step = async (before = () => {}) => {
    now += 20;
    world.step(.02);
    before();
    game.tick(.02, now);
    await settle();
  };
  const run = async (milliseconds, until, before) => {
    const end = now + milliseconds;
    while (now < end) { await step(before); if (until?.()) return true; }
    return false;
  };
  return {game, world, cars, settle, step, run, now: () => now};
}
const speeds = car => car.writes.filter(w => w.bytes[1] === ID.SPEED)
  .map(w => new DataView(w.bytes.buffer).getInt16(2, true));
const lanes = car => car.writes.filter(w => w.bytes[1] === ID.CHANGE_LANE);

test('F&F model IDs retain ordinary-car geometry and their distinct extracted loadouts', () => {
  // Independently read from retained build-403 OBB vehicleTypes.json:
  // 18 Mammoth/name_localized International MXT; 19 Dynamo/name_localized Ice Charger.
  // Both extend ordinary base 99, not Supertruck base 102/103.
  for (const [id, spec] of expected) {
    const model = catalogue.vehicles.models[id];
    assert.equal(model.name, spec.name);
    assert.equal(model.truck, false, `${id} must not inherit the Supertruck speed penalty`);
    assert.equal(model.length, 86.2);
    assert.deepEqual(loadout(catalogue.vehicles, id), {attack: [spec.attack], support: [spec.support], special: []});
  }
  assert.equal(catalogue.vehicles.models[17].truck, true, 'X52 Ice is a distinct Supertruck, not Ice Charger');
  assert.equal(catalogue.weapons.MammothShieldL01.shield_blocked_damage_percent, 1);
  assert.equal(catalogue.weapons.DynamoBoostL01.boost_speed_addition, .6);
  assert.equal(catalogue.weapons.DynamoAOEL01.interaction_style, 'charge');
});

for (const profile of [null, 'sdk']) for (const models of [[18], [19], [18, 19], [18, 19, 19, 18]]) {
  test(`${profile ?? 'simulator'} F&F models ${models.join('/')} scan, drive with human/CPU lanes and obey STOP`, async () => {
    const r = await rig(models, profile), {game, world, cars} = r;
    assert.equal(game.safety.firstTrackMs, 5000);
    assert.equal(game.safety.trackGapMs, 2000);
    assert.equal(game.safety.scanMs, 45000);
    assert.equal(game.safety.scanLaps, 3);
    assert.equal(new Set(cars.map(({driver}) => [...rgb(...driver.car.color)].join(','))).size, cars.length);
    for (const c of cars) {
      assert.equal(c.sim.sdk, true);
      assert.equal(c.driver.car.initializing, false);
      assert.equal(c.sim.targetSpeed, 0);
    }

    game.startScan(cars[0].driver);
    await r.settle();
    assert.equal(cars[0].sim.targetSpeed, 300);
    assert.ok(await r.run(45000, () => game.phase === 'ready', () => {
      for (const c of cars.slice(1)) assert.equal(c.sim.targetSpeed, 0, 'only the selected scout moves');
    }), game.pitReason ?? 'ordinary simulator scan did not finish within its existing budget');
    assert.equal(game.halted, true);
    assert.equal(game.pitReason, null);
    assert.equal(game.track.closed, true);
    assert.deepEqual(game.track.toJSON(), world.track.toJSON());
    assert.ok(cars.every(c => c.sim.targetSpeed === 0));

    const human = [], computers = [];
    for (const [i, c] of cars.entries()) {
      game.setControl(c.driver, i % 2 ? 'bot' : 'browser');
      c.motionWriteStart = c.writes.length;
      c.shifts = [];
      (i % 2 ? computers : human).push(c);
      const fighter = game.battle.get(c.driver.car), spec = expected.get(c.model);
      assert.equal(fighter.energy, catalogue.vehicles.energy.max_energy);
      assert.equal(fighter.item('attack'), spec.attack);
      assert.equal(fighter.item('support'), spec.support);
    }
    await r.settle();
    game.resume();
    for (const c of human) c.driver.input.throttle = 1;
    await r.step();
    for (const c of computers) assert.equal(c.sim.targetSpeed, 0, 'selecting Computer does not arm it');
    game.armComputers();

    const finished = await r.run(45000, () => cars.every(c => c.driver.car.localizer.laps >= 2)
      && human.every(c => c.shifts.length === 2 && c.shifts.every(s => s.completed)), () => {
      assert.equal(game.pitReason, null, 'unchanged telemetry watchdog remains active');
      for (const c of human) {
        const previous = c.shifts.at(-1);
        if (previous && !previous.completed && r.now() - previous.at >= 300) {
          assert.ok(previous.direction * (c.sim.lateral - previous.before) > 1, 'a fresh-code lane request must move the simulator in the requested direction');
          previous.completed = true;
        }
        // Opposite nudges wait for a new optical code after the previous
        // maneuver. This does not establish rapid successive-command parity.
        const estimate = c.driver.car.localizer.estimate(r.now());
        const section = estimate?.located ? game.track.pieces[estimate.index] : null;
        if (c.shifts.length >= 2 || (previous && (!previous.completed || r.now() - previous.at < 500))
          || section?.kind !== 'straight' || estimate.progress > .45
          || r.now() - c.driver.car.telemetry.lastPositionAt > 40
          || (previous && c.driver.car.telemetry.lastPositionAt <= previous.at + 300)) continue;
        const direction = c.shifts.length ? -1 : 1, before = c.sim.lateral;
        if (profile) assert.equal(game.nudge(c.driver, direction), true);
        else c.driver.input.lane = c.driver.car.physicalLaneReference.lateral + direction * 22.5;
        const target = c.driver.input.lane;
        assert.ok(direction * (target - before) > 0, `left/right intent ${direction}: target ${target}, truth ${before}, cached ${c.driver.car.targetLateral}, reference ${JSON.stringify(c.driver.car.physicalLaneReference)}`);
        c.shifts.push({at: r.now(), direction, before, target, completed: false});
      }
    });
    assert.equal(finished, true, 'two complete simulator laps and both manual shifts must finish');
    for (const c of cars) {
      assert.ok(c.driver.car.telemetry.positions > 0);
      assert.ok(c.driver.car.telemetry.transitions > 0);
      assert.ok(speeds(c).includes(300), 'ordinary F&F models must reach the full selected ceiling');
      assert.ok(speeds(c).every(speed => speed >= 0 && speed <= 300));
      const motionLanes = lanes({...c, writes: c.writes.slice(c.motionWriteStart)});
      assert.ok(motionLanes.length >= 2, 'each human/CPU issues actual queued lane commands');
    }

    game.stopAll(); await r.settle();
    const stoppedAt = cars.map(c => c.writes.length);
    for (const c of cars) {
      assert.equal(c.sim.targetSpeed, 0);
      assert.equal(c.driver.cpuArmed, false);
      assert.equal(c.driver.armed, false);
      c.driver.input.throttle = 1;
      c.driver.input.lane = -22.5;
    }
    await r.run(1200);
    assert.equal(game.halted, true);
    for (const [i, c] of cars.entries()) {
      assert.equal(c.sim.speed, 0, 'simulated physics settles after STOP, not physical-stop evidence');
      assert.ok(c.writes.slice(stoppedAt[i]).every(w => w.bytes[1] !== ID.CHANGE_LANE));
      assert.ok(speeds({...c, writes: c.writes.slice(stoppedAt[i])}).every(speed => speed === 0));
    }
  });
}

test('MXT shield and Ice Charger boost use their own game effects without exceeding the selected speed ceiling', async () => {
  const r = await rig([18, 19]), {game, cars, world} = r;
  game.useTrack(world.track);
  for (const c of cars) game.setControl(c.driver, 'browser');
  game.startBattle();
  for (const c of cars) { c.driver.input.throttle = 1; c.driver.input.support = true; }
  await r.run(400);
  const mxt = game.battle.get(cars[0].driver.car), charger = game.battle.get(cars[1].driver.car);
  assert.equal(mxt.shield, 1);
  assert.equal(charger.boost, 600);
  assert.ok(charger.boostUntil > r.now());
  assert.ok(mxt.energy < catalogue.vehicles.energy.max_energy);
  assert.ok(charger.energy < mxt.energy, 'boost drains more energy than the shield');
  assert.ok(cars.every(c => c.sim.targetSpeed === 300));
  for (const c of cars) assert.ok(speeds(c).every(speed => speed <= 300));
  cars[1].driver.input.throttle = 0;
  await r.step();
  assert.equal(cars[1].sim.targetSpeed, 0, 'active boost cannot start a zero-throttle car');
  game.stopAll(); await r.settle();
  assert.ok(cars.every(c => c.sim.targetSpeed === 0));
});
