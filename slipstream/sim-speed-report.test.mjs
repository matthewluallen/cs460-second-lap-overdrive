import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Car} from './car.mjs';
import {Pieces} from './track.mjs';
import {SimWorld} from './sim.mjs';

test('simulator speed acceptance reports actual physics speed separately from desired speed',async()=>{
  let now=1000;
  const pieces=new Pieces(JSON.parse(readFileSync(new URL('./data/pieces.json',import.meta.url))));
  const world=new SimWorld(pieces), radio=world.addCar(), car=new Car(radio,{pieces,clock:()=>now});
  await car.start();await car.pumpPromise;
  car.setSpeed(300);await car.pumpPromise;
  assert.deepEqual(car.telemetry.speedCommand,{at:1000,speed:300,accel:1000});
  assert.deepEqual({...car.telemetry.speedReport},{id:0x36,type:'speed',desired:300,accel:1000,actual:0,at:1000});
  assert.equal(car.telemetry.lastPositionAt,undefined,'speed acknowledgment is not optical localization');
  radio.step(.1);now=1100;car.setSpeed(200);await car.pumpPromise;
  assert.equal(car.telemetry.speedReport.desired,200);assert.equal(car.telemetry.speedReport.actual,100);
  now=1200;car.setSpeed(200);await car.pumpPromise;
  assert.equal(car.telemetry.speedCommand.at,1100,'deduplicated command does not fabricate a new acknowledgment boundary');
  car.stop();await car.pumpPromise;
  assert.deepEqual(car.telemetry.speedCommand,{at:1200,speed:0,accel:2500});
  assert.equal(car.telemetry.speedReport.desired,0);assert.equal(car.telemetry.speedReport.actual,100,'STOP acceptance does not prove physical stop');
  await car.close();
});
