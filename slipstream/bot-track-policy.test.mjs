import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Bot} from './battle.mjs';
import {Game} from './game.mjs';
import {ID} from './protocol.mjs';
import {Pieces, Track, Localizer, traversal} from './track.mjs';
import {buildTrack, LAYOUTS} from './sim.mjs';
const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
const pieces=new Pieces(data('pieces'));
const input=()=>({throttle:1,lane:22.5});
function rig({id=36,progress=.1,lateral=-22.5,direction=1,active=false}={}){
  const e={located:true,index:0,progress,lateral,direction};
  const track={pieces:[{...traversal(pieces,id,false),length:500},traversal(pieces,39,false)]};
  const localizer={seenCode:true,lastId:id,speed:300,laps:0,sectionVisit:0,estimate:()=>e};
  const car={pieces,localizer,speed:300,lastAccel:1000,telemetry:{lastPositionAt:1000,
    speedCommand:{at:900,speed:300,accel:1000},speedReport:{at:950,desired:300,accel:1000}},motionSince:900};
  const battle={active,track};return {bot:new Bot(car,battle),car,localizer,e,battle};
}

test('free CPU respects the selected ceiling and avoids an automatic sub-300 geometry slowdown',()=>{
  for(const [topSpeed,restrictedSpeed] of [[150,150],[300,300],[400,300],[450,300],[600,400]]){
    for(const id of [36,17,57,999]){
      const expected=id===36?topSpeed:restrictedSpeed;
      const {bot}=rig({id});const i=input();const ceiling=bot.applyTrackPolicy(1000,i,{topSpeed});
      assert.equal(i.throttle*topSpeed,expected);assert.equal(ceiling*topSpeed,expected);
      if(id!==36)assert.equal(i.lane,null);
    }
  }
  for(const mutate of [r=>r.battle.track.pieces[0].inferred=true,r=>r.battle.track.pieces[0].unverified=true,r=>r.e.located=false]){
    const r=rig();mutate(r);const i=input();assert.equal(r.bot.applyTrackPolicy(1000,i,{topSpeed:450})*450,300);assert.equal(i.lane,null);
  }
});

test('stale, future, pre-motion and transition-only evidence cannot authorize CPU steering',()=>{
  const changes=[r=>r.car.telemetry.lastPositionAt=-1001,r=>r.car.telemetry.lastPositionAt=1001,
    r=>r.car.motionSince=1001,r=>r.localizer.seenCode=false,r=>r.localizer.lastId=39,
    r=>r.car.telemetry.lastPositionAt=undefined];
  for(const mutate of changes){const r=rig();mutate(r);const i=input();assert.equal(r.bot.applyTrackPolicy(1000,i,{topSpeed:450})*450,300);assert.equal(i.lane,null);}
  const r=rig();r.localizer.speed=0;const i=input();r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,null,'stationary localization cannot authorize lane movement');
});

test('reverse-travel remaining distance uses Localizer progress in travel direction',()=>{
  const track=buildTrack(pieces,LAYOUTS.Capsule), localizer=new Localizer(track,pieces);
  const car={pieces,localizer,telemetry:{lastPositionAt:1000},motionSince:900};
  const bot=new Bot(car,{active:false,track});
  localizer.feed({type:'position',pieceId:36,locationId:17,reverse:true,speed:300},1000);
  assert.equal(localizer.estimate(1000).direction,-1);assert.ok(Math.abs(localizer.estimate(1000).progress-.214)<1e-9);
  let i=input();assert.equal(bot.applyTrackPolicy(1000,i,{topSpeed:450}),1);assert.equal(i.lane,22.5);
  localizer.feed({type:'position',pieceId:36,locationId:15,reverse:true,speed:300},1000);
  i=input();assert.equal(bot.applyTrackPolicy(1000,i,{topSpeed:450})*450,300);assert.equal(i.lane,null,'near exit in reverse must not steer');
});

test('free CPU lane targets alternate once per section visit and direction, independently of laps',()=>{
  const r=rig();let i=input();r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,22.5);
  assert.equal(r.bot.confirmTrackLane(1000,i,300),true);
  i=input();r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,null,'same piece cannot retry every tick');
  r.e.index=1;r.localizer.lastId=39;i=input();r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,-22.5);
  assert.equal(r.bot.confirmTrackLane(1000,i,300),true);
  r.localizer.laps=1;i=input();r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,null,'lap counter changes alone do not create a section visit');
  r.localizer.sectionVisit++;i=input();r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,22.5);
  assert.equal(r.bot.confirmTrackLane(1000,i,300),true);
  r.e.direction=-1;i=input();r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,-22.5);
  assert.equal(r.bot.confirmTrackLane(1000,i,300),true);
});

test('one-straight circuits admit each new optical section visit independently of completed laps',()=>{
  for(const omitCurveCode of [false,true]){
    const track=new Track([34,33,18,20,36,17,23].map(id=>traversal(pieces,id,false)));
    assert.equal(track.closed,true);
    const localizer=new Localizer(track,pieces);
    const car={pieces,localizer,speed:300,lastAccel:1000,motionSince:0,telemetry:{
      speedCommand:{at:0,speed:300,accel:1000},speedReport:{at:1,desired:300,accel:1000}}};
    const bot=new Bot(car,{active:false,track});let now=0;
    const feed=id=>{
      const locationId=id===36?30:Number(Object.keys(pieces.get(id).locs)[0]);
      localizer.feed({type:'position',pieceId:id,locationId,reverse:false,speed:300},now+=100);
      car.telemetry.lastPositionAt=now;
    };
    const attempt=()=>{const i=input();bot.applyTrackPolicy(now,i,{topSpeed:300});
      return {confirmed:bot.confirmTrackLane(now,i,300,1000),lane:i.lane};};
    const revisit=()=>{
      for(const id of [17,23,34,33])feed(id);
      if(omitCurveCode){localizer.feed({type:'transition'},now+=100);localizer.feed({type:'transition'},now+=100);}
      else feed(18);
      feed(20);feed(36);
    };
    for(const id of [34,33,18,20,36])feed(id);
    const first=attempt();assert.equal(first.confirmed,true);
    const firstVisit=localizer.sectionVisit;
    feed(36);assert.deepEqual(attempt(),{confirmed:false,lane:null},'another optical reading on the same section cannot repeat steering');
    assert.equal(localizer.sectionVisit,firstVisit);
    revisit();
    assert.equal(localizer.laps,0,'the first map-boundary crossing only starts lap evidence');
    assert.ok(localizer.sectionVisit>firstVisit);
    const second=attempt();assert.deepEqual(second,{confirmed:true,lane:-first.lane});
    const secondVisit=localizer.sectionVisit;
    feed(36);assert.deepEqual(attempt(),{confirmed:false,lane:null});
    assert.equal(localizer.sectionVisit,secondVisit);
    revisit();
    assert.equal(localizer.laps,omitCurveCode?0:1,'missing optical section coverage cannot earn a completed lap');
    assert.deepEqual(attempt(),{confirmed:true,lane:first.lane},'new section visits remain eligible even without a completed lap');
  }
});

test('active Battle policy only reduces throttle and admits existing safe lane intent once',()=>{
  const r=rig({active:true});let i={throttle:.1,lane:-22.5};r.bot.applyTrackPolicy(1000,i);
  assert.equal(i.throttle,.1);assert.equal(i.lane,-22.5);
  r.car.speed=30;r.car.telemetry.speedCommand.speed=30;r.car.telemetry.speedReport.desired=30;
  assert.equal(r.bot.confirmTrackLane(1000,i,30),true);
  i={throttle:1,lane:22.5};r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,null);
  r.battle.track.pieces[0]=traversal(pieces,17,false);r.localizer.lastId=17;
  i={throttle:.2,lane:22.5};assert.equal(r.bot.applyTrackPolicy(1000,i,{topSpeed:450})*450,300);assert.equal(i.throttle,.2);assert.equal(i.lane,null);
});

test('inactive Battle objective preserves its own throttle and lane while applying track constraints',()=>{
  const r=rig();let i={throttle:.1,lane:-22.5};
  assert.equal(r.battle.active,false);
  assert.equal(r.bot.applyTrackPolicy(1000,i,{objective:true}),1);
  assert.equal(i.throttle,.1,'objective speed must not become free-cruise throttle');
  assert.equal(i.lane,-22.5,'objective lane must not be replaced with free-cruise alternation');
  i={throttle:0,lane:null};r.bot.applyTrackPolicy(1000,i,{objective:true});
  assert.equal(i.throttle,0);assert.equal(i.lane,null);
  for(const topSpeed of [300,450]){
    for(const id of [17,57,10]){
      const restricted=rig({id});i={throttle:.2,lane:22.5};
      assert.equal(restricted.bot.applyTrackPolicy(1000,i,{objective:true,topSpeed})*topSpeed,300);
      assert.equal(i.throttle,.2,'geometry floor must not increase the objective throttle');
      assert.equal(i.lane,null,'curve, special and intersection objective lanes remain blocked');
    }
  }
});

test('speed and steering margins independently enforce 150 mm and 250 mm remaining',()=>{
  for(const [progress,speed,lane] of [[.5,450,true],[.5001,450,false],[.7,450,false],[.7001,300,false]]){
    const r=rig({progress});const i=input();assert.equal(r.bot.applyTrackPolicy(1000,i,{topSpeed:450})*450,speed);
    assert.equal(i.lane!==null,lane);
  }
});

test('waiting for matching speed and a later printed position neither consumes the encounter nor flips the free lane',()=>{
  const r=rig();r.car.telemetry.speedReport=null;
  let i=input();r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,22.5);
  assert.equal(r.bot.confirmTrackLane(1000,i,300),false);assert.equal(i.lane,null);
  assert.equal(r.bot.trackLaneEncounter,undefined);assert.equal(r.bot.freeLaneTarget,undefined);
  r.car.telemetry.speedReport={at:1000,desired:300,accel:1000};
  i=input();r.bot.applyTrackPolicy(1000,i);
  assert.equal(r.bot.confirmTrackLane(1000,i,300),false,'the same-time position does not demonstrate driving after the report');
  assert.equal(r.bot.trackLaneEncounter,undefined);assert.equal(r.bot.freeLaneTarget,undefined);
  r.car.telemetry.lastPositionAt=1001;i=input();r.bot.applyTrackPolicy(1001,i);
  assert.equal(i.lane,22.5,'waiting retains the original intended direction');
  assert.equal(r.bot.confirmTrackLane(1001,i,300),true);assert.equal(r.bot.freeLaneTarget,22.5);
  i=input();r.bot.applyTrackPolicy(1001,i);assert.equal(i.lane,null,'only successful confirmation consumes this encounter');
  r.localizer.sectionVisit++;i=input();r.bot.applyTrackPolicy(1001,i);assert.equal(i.lane,-22.5);
});

test('CPU steering rejects unconfirmed speed changes, stale or mismatched reports, and unfinished acceleration',()=>{
  const changes=[
    ['speed changes this tick',r=>r.car.speed=200],
    ['missing command',r=>r.car.telemetry.speedCommand=null],
    ['different command speed',r=>r.car.telemetry.speedCommand.speed=200],
    ['missing speed report',r=>r.car.telemetry.speedReport=null],
    ['different desired speed',r=>r.car.telemetry.speedReport.desired=200],
    ['different acknowledged acceleration',r=>r.car.telemetry.speedReport.accel=2000],
    ['different command acceleration',r=>r.car.telemetry.speedCommand.accel=2000],
    ['acceleration changed since command',r=>r.car.lastAccel=2000],
    ['reply predates command',r=>r.car.telemetry.speedReport.at=899],
    ['reply predates this motion',r=>r.car.motionSince=960],
    ['future reply',r=>r.car.telemetry.speedReport.at=1001],
    ['position predates reply',r=>r.car.telemetry.lastPositionAt=940],
    ['optical speed below requested speed',r=>r.localizer.speed=299],
  ];
  for(const [label,mutate] of changes){
    const r=rig();mutate(r);const i=input();r.bot.applyTrackPolicy(1000,i);
    assert.equal(r.bot.confirmTrackLane(1000,i,300),false,label);assert.equal(i.lane,null,label);
    assert.equal(r.bot.trackLaneEncounter,undefined,label);assert.equal(r.bot.freeLaneTarget,undefined,label);
  }
  const steady=rig();steady.car.telemetry.lastPositionAt=3100;
  let i=input();steady.bot.applyTrackPolicy(3100,i);
  assert.equal(steady.bot.confirmTrackLane(3100,i,300),true,'unchanged acknowledged speed remains valid with a fresh later position');
  const stale=rig();i=input();stale.bot.applyTrackPolicy(3100,i);
  assert.equal(stale.bot.confirmTrackLane(3100,i,300),false,'old optical evidence cannot authorize a later lane');
});

test('CPU lane confirmation rechecks the candidate and final post-effect speed',()=>{
  for(const [label,mutate,now,finalSpeed] of [
    ['changed final speed',()=>{},1000,200],
    ['stopped by effect',()=>{},1000,0],
    ['changed piece',r=>{r.e.index=1;r.localizer.lastId=39;},1000,300],
    ['changed optical observation',r=>r.car.telemetry.lastPositionAt=1001,1001,300],
    ['candidate from previous tick',()=>{},1001,300],
    ['curve reached before dispatch',r=>{r.battle.track.pieces[0]=traversal(pieces,17,false);r.localizer.lastId=17;},1000,300],
  ]){
    const r=rig(),i=input();r.bot.applyTrackPolicy(1000,i);mutate(r);
    assert.equal(r.bot.confirmTrackLane(now,i,finalSpeed),false,label);assert.equal(i.lane,null,label);
    assert.equal(r.bot.trackLaneEncounter,undefined,label);
  }
});

test('Game applies CPU curve cap after Battle boost and preserves lower slowdowns; selection alone stays stopped',async()=>{
  for(const [topSpeed,curveSpeed,slowedSpeed] of [[300,300,140],[400,300,140],[600,400,160]]){
  let now=1000;const sent=[];
  const radio={onNotify(){return()=>{};},async write(p){sent.push([...p]);},close(){}};
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now});
  const driver=game.addCar(radio);await driver.car.initialization;await driver.car.pumpPromise;
  game.useTrack(buildTrack(game.pieces,LAYOUTS.Capsule));game.topSpeed=topSpeed;game.setControl(driver,'bot');
  game.resume();game.tick(.04,now);await driver.car.pumpPromise;assert.equal(driver.car.speed,0);
  game.startBattle();driver.objectiveInput={throttle:1,lane:22.5};
  // Actual localizer derives curve identity; separate printed-code freshness is supplied.
  driver.car.localizer.feed({type:'position',pieceId:17,locationId:10,reverse:false,speed:300},now);
  driver.car.telemetry.lastPositionAt=now;driver.car.lastTrackAt=now;
  const fighter=game.battle.get(driver.car);fighter.boostUntil=10000;fighter.boost=400;
  game.tick(.04,now);await driver.car.pumpPromise;assert.equal(driver.car.speed,curveSpeed,'boost cannot defeat final geometry cap');
  fighter.slow.set('test',{until:10000,factor:.2});game.tick(.04,now);await driver.car.pumpPromise;
  assert.equal(driver.car.speed,slowedSpeed,'boost and damage can still reduce speed below the geometry ceiling');
  fighter.slow.set('cap',{until:10000,cap:70});game.tick(.04,now);await driver.car.pumpPromise;assert.equal(driver.car.speed,70);
  game.stopAll();await driver.car.pumpPromise;assert.equal(driver.car.speed,0);
  }
});

test('Game waits for a same-speed acceleration change to be acknowledged and optically observed before steering',async()=>{
  let now=1000,notify;const sent=[];
  const radio={onNotify(fn){notify=fn;return()=>{};},async write(p){sent.push([...p]);},close(){}};
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now});
  const driver=game.addCar(radio);await driver.car.initialization;await driver.car.pumpPromise;
  const car=driver.car;
  const position=()=>{
    car.localizer.feed({type:'position',pieceId:36,locationId:30,reverse:false,speed:300},now);
    car.telemetry.lastPositionAt=now;car.lastTrackAt=now;
  };
  const report=accel=>{
    const bytes=new Uint8Array(8),view=new DataView(bytes.buffer);bytes[0]=7;bytes[1]=ID.SPEED_UPDATE;
    view.setInt16(2,300,true);view.setInt16(4,accel,true);view.setInt16(6,300,true);notify(bytes);
  };
  const laneCount=()=>sent.filter(p=>p[1]===ID.CHANGE_LANE).length;
  game.useTrack(buildTrack(game.pieces,LAYOUTS.Capsule));game.topSpeed=300;game.setControl(driver,'bot');
  game.startBattle();driver.objectiveInput={throttle:1,lane:22.5};position();
  game.tick(.04,now);await car.pumpPromise;assert.equal(car.speed,300);assert.equal(laneCount(),0);
  now=1100;report(1000);now=1120;position();
  const fighter=game.battle.get(car);fighter.boostUntil=10000;fighter.boost=400;
  game.tick(.04,now);await car.pumpPromise;
  assert.equal(car.speed,300);assert.equal(car.lastAccel,2000);
  assert.equal(laneCount(),0,'same-speed acceleration command cannot share a tick with the lane request');
  assert.equal(driver.bot.trackLaneEncounter,undefined,'waiting for the new command does not consume the encounter');
  now=1140;report(2000);game.tick(.04,now);await car.pumpPromise;
  assert.equal(laneCount(),0,'a speed report alone is not a later optical observation');
  now=1160;position();game.tick(.04,now);await car.pumpPromise;
  assert.equal(laneCount(),1,'matched new acceleration plus a later position admits the waiting lane once');
  now=1180;game.tick(.04,now);await car.pumpPromise;assert.equal(laneCount(),1);
  game.stopAll();await car.pumpPromise;assert.equal(car.speed,0);
});
