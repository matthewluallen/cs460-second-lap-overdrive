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

test('precision rewards lane and speed control while the full-throttle baseline earns nothing', () => {
  const s = new RoundSession(); s.start('precision', [car(), car(2)], 0, {speedLimit: 700});
  for (let i = 1; i <= 10; i++) {
    const guidance = s.guidance(1), p = (i * 0.1) % 1;
    s.update([car(1, {circuitProgress: p, lateral: guidance.lane, speed: guidance.throttle * 700}),
      car(2, {circuitProgress: p, lateral: guidance.lane, speed: 700})], i * 500);
  }
  const careful = s.view().rows.find(row => row.id === 1), fast = s.view().rows.find(row => row.id === 2);
  assert.equal(careful.gates, 4); assert.equal(careful.score, 400);
  assert.equal(fast.score, 0); assert.equal(fast.misses, 4);
});
test('precision refuses absent lane telemetry and large localization jumps', () => {
  const s = new RoundSession(); s.start('precision', [car()], 0);
  s.update([car(1, {circuitProgress: 0.2, speed: 175})], 200);
  assert.equal(s.view().rows[0].gates, 0);
  s.update([car(1, {circuitProgress: 0.6, speed: 300, lateral: 0})], 400);
  assert.equal(s.view().rows[0].score, 0);
});

// Deliberate task sequence: dwell through scan zone, carry forward in its lane,
// then cross the delivery dock at low speed. No old lap counter is used.
function deliver(s, ids, clock = 0, parked = []) {
  let now = clock;
  for (const [progress, lane, speed] of [[0.06,0,175],[0.09,0,175],[0.12,0,175],
    [0.22,null,280],[0.32,null,280],[0.42,null,280],[0.52,null,280],[0.72,0,175],[0.82,0,175]]) {
    const moving = ids.map(id => car(id, {circuitProgress: progress,
      lateral: lane ?? s.guidance(id).lane, speed}));
    s.update([...moving, ...parked], now += 200);
  }
  return now;
}
test('a bot cannot complete the story mission on behalf of an idle human', () => {
  const s = new RoundSession();
  s.start('team', [car(), car(2, {control:'bot'})], 0, {mission:'signal-run'});
  let now = deliver(s, [2], 0, [car(1, {speed:0,lateral:0})]);
  let v = s.view();
  assert.equal(v.status, 'running'); assert.equal(v.teamTasks, 3);
  assert.equal(v.rows.find(r => r.id === 1).tasksCompleted, 0);
  assert.equal(v.rows.find(r => r.id === 2).task.phase, 'complete');
  assert.deepEqual(s.guidance(2), {lane:0,throttle:0});
  now = deliver(s, [1], now, [car(2, {circuitProgress:0.82,speed:0,lateral:0})]);
  v = s.view(); assert.equal(v.status, 'finished'); assert.equal(v.reason, 'goal');
  assert.equal(v.teamTasks, 6); assert.equal(v.progress, 1); assert.deepEqual(v.winnerIds, [1,2]);
});
test('story missions scale one to four independent contributors and retain different delivery goals', () => {
  for (const cars of [1,2,3,4]) for (const mission of STORY_MISSIONS) {
    const s = new RoundSession(), ids = Array.from({length:cars}, (_,i) => i+1);
    s.start('team', ids.map(id => car(id,{control:id%2?'keys1':'bot'})), 0, {mission:mission.id});
    let now = 0;
    for (let packet = 0; packet < mission.goalPerCar; packet++) now = deliver(s, ids, now);
    const v = s.view(); assert.equal(v.status,'finished',`${cars} cars / ${mission.id}`);
    assert.equal(v.rows.every(row=>row.task.deliveries===mission.goalPerCar),true);
    assert.equal(v.teamTasks, cars*mission.goalPerCar*3);
  }
});
test('story requires scan and steady carry, and stale or paused telemetry cannot finish a task', () => {
  const s = new RoundSession(); s.start('team',[car()],0,{mission:'signal-run'});
  // Full-throttle movement in the scan zone never acquires a packet.
  for(let i=1;i<=4;i++) s.update([car(1,{circuitProgress:0.05+i*0.02,lateral:0,speed:700})],i*200);
  assert.equal(s.view().teamTasks,0);
  // Telemetry gap resets dwell instead of awarding a long scan interval.
  s.update([car(1,{circuitProgress:0.15,lateral:0,speed:175})],3000);
  assert.equal(s.view().teamTasks,0);
  s.pause(3100);s.update([car(1,{circuitProgress:0.18,lateral:0,speed:175})],4000);
  assert.equal(s.view().teamTasks,0);
  assert.throws(()=>new RoundSession().start('team',[car()],0,{mission:'unknown'}),/valid crew/);
});

import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {SimWorld} from './sim.mjs';
const fixtureData = name => JSON.parse(readFileSync(new URL('./data/' + name + '.json', import.meta.url)));
test('CPU story algorithms: simulator-only 10s timing; Figure-eight excludes physical steering policy', async () => {
  const data = {pieces:fixtureData('pieces'),vehicles:fixtureData('vehicles'),weapons:fixtureData('weapons')};
  for (const layout of ['Capsule','Figure eight']) for (const count of [1,4]) for (const mission of STORY_MISSIONS) {
    let now = 0;
    const game = new Game({...data,clock:()=>now,safety:{trackGapMs:10000}}), world = new SimWorld(game.pieces,layout);
    game.useTrack(world.track);game.topSpeed=400;
    for(let i=0;i<count;i++) {
      const d=game.addCar(world.addCar(),{simulated:true,control:'bot'});game.setControl(d,'bot');
      // Figure-eight Story is blocked in the product pending validation. This
      // explicit test double isolates mission progression, not physical driving.
      // Capsule retains the production track policy; its objectives must pass it.
      if(layout==='Figure eight') { d.bot.applyTrackPolicy=()=>1; d.bot.confirmTrackLane=()=>true; }
    }
    const snapshot=()=>game.snapshot(now).map(row=>{
      const d=game.drivers.find(driver=>driver.id===row.id), p=d.car.localizer.estimate(now);
      return {...row,lateral:p?.lateral,speedCeiling:400,circuitProgress:p?.located?world.track.distance(p.index,p.progress,p.direction)/world.track.length:undefined,circuitDirection:p?.direction};
    });
    game.armComputers();
    const s=new RoundSession();s.start('team',snapshot(),now,{mission:mission.id});
    while(s.status==='running') {
      for(const d of game.drivers) d.objectiveInput=s.guidance(d.id);
      world.step(.02);now+=20;game.tick(.02,now);await 0;s.update(snapshot(),now);
    }
    const result=s.view();
    assert.equal(result.reason,'goal',layout+' / '+count+' cars / '+mission.id+' / '+result.teamTasks+' tasks / '+game.pitReason);
    assert.ok(now<mission.durationMs);
    assert.ok(result.rows.every(row=>row.task.phase==='complete'));
    await Promise.all(game.drivers.map(d=>d.car.close()));
  }
});
test('precision guidance beats full throttle through the actual simulator and localizer', async () => {
  let now=0;
  const game=new Game({pieces:fixtureData('pieces'),vehicles:fixtureData('vehicles'),weapons:fixtureData('weapons'),clock:()=>now});
  const world=new SimWorld(game.pieces,'Capsule');game.useTrack(world.track);game.topSpeed=400;
  for(let i=0;i<2;i++){const d=game.addCar(world.addCar(),{simulated:true,control:'bot'});game.setControl(d,'bot');}
  const snapshot=()=>game.snapshot(now).map(row=>{const p=game.drivers.find(d=>d.id===row.id).car.localizer.estimate(now);return {...row,lateral:p?.lateral,speedCeiling:400,circuitProgress:p?.located?world.track.distance(p.index,p.progress,p.direction)/world.track.length:undefined,circuitDirection:p?.direction};});
  game.armComputers();
  const s=new RoundSession();s.start('precision',snapshot(),0);
  while(s.status==='running'){
    for(const [i,d] of game.drivers.entries()){d.objectiveInput=s.guidance(d.id);if(i===1)d.objectiveInput.throttle=1;}
    world.step(.02);now+=20;game.tick(.02,now);await 0;s.update(snapshot(),now);
  }
  const careful=s.view().rows.find(r=>r.id===1), fast=s.view().rows.find(r=>r.id===2);
  assert.ok(careful.score>=400,'the deliberate driver completes at least four gates');
  assert.equal(fast.score,0,'the full-throttle baseline fails the speed bands');
  await Promise.all(game.drivers.map(d=>d.car.close()));
});

test('battle awards a crew assist once and excludes pre-round assists', () => {
  const s = new RoundSession(); s.start('battle', [car(1, {assists: 2}), car(2)], 0);
  s.update([car(1, {assists: 3}), car(2)], 1000);
  assert.equal(s.view().rows[0].assists, 1); assert.equal(s.view().rows[0].score, 25);
  s.update([car(1, {assists: 3}), car(2)], 2000); assert.equal(s.view().rows[0].score, 25);
});
