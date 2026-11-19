import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';

const data = n => JSON.parse(readFileSync(new URL('./data/' + n + '.json', import.meta.url)));
const game = () => new Game({pieces: data('pieces'), vehicles: data('vehicles'), weapons: data('weapons'), clock: () => 0});
const radio = () => ({onNotify() { return () => {}; }, async write() {}, close() {}});

// The handoff invariant: "Missing model information must not silently become
// Groundshock." A Bluetooth advertisement that carries no usable model must not
// have a specific physical car's identity assumed for it. Groundshock (model 8)
// is also the excluded car, so a silent default to it is especially misleading.
test('a car added without model information is not silently identified as Groundshock', () => {
  const g = game();
  const d = g.addCar(radio());
  assert.notEqual(d.car.model, 8, 'missing model must not default to Groundshock (model 8)');
  assert.doesNotMatch(d.car.name, /Groundshock/, 'missing model must not be named Groundshock');
  assert.equal(d.car.model, 0, 'missing model is the unidentified model 0');
  assert.equal(g.modelName(d.car.model), 'Unknown', 'an unidentified model reads as Unknown, not a specific car');
});

test('an explicitly selected model is still honored, including Groundshock', () => {
  const g = game();
  const chosen = g.addCar(radio(), {model: 8});
  assert.equal(chosen.car.model, 8);
  assert.equal(chosen.car.name, 'Groundshock');
  const guardian = g.addCar(radio(), {model: 12, name: 'Guardian'});
  assert.equal(guardian.car.model, 12);
  assert.equal(guardian.car.name, 'Guardian');
});

test('Fast & Furious physical names retain their original model IDs and later aliases', () => {
  const g=game();
  for(const [model,name,alias] of [[18,'International MXT','Mammoth'],[19,'Ice Charger','Dynamo']]) {
    const driver=g.addCar(radio(),{model});
    assert.ok(driver.car.name.includes(name), 'the model name printed on the F&F car must be visible');
    assert.ok(driver.car.name.includes(alias), 'the later Overdrive alias stays recognizable');
    assert.equal(driver.car.model,model);
    assert.equal(g.vehicles.models[String(model)].name,alias,'source-derived tables remain unchanged');
    assert.equal(g.vehicles.models[String(model)].truck,false,'MXT and Ice Charger are not Supertrucks');
  }
});
