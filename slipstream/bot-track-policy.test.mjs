import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Bot} from './battle.mjs';
import {Game} from './game.mjs';
import {Pieces, Localizer, Track, traversal} from './track.mjs';
import {buildTrack, LAYOUTS} from './sim.mjs';
const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
const pieces=new Pieces(data('pieces'));
const input=()=>({throttle:1,lane:22.5});
function rig({id=36,progress=.1,lateral=-22.5,direction=1,active=false}={}){
  const e={located:true,index:0,progress,lateral,direction};
  const track={pieces:[{...traversal(pieces,id,false),length:500},traversal(pieces,39,false)]};
  const localizer={seenCode:true,lastId:id,speed:300,laps:0,estimate:()=>e};
  const car={pieces,localizer,telemetry:{lastPositionAt:1000},motionSince:900};
  const battle={active,track};return {bot:new Bot(car,battle),car,localizer,e,battle};
}

test('free CPU policy allows 300 on fresh ordinary straights and caps uncertain geometry at 200',()=>{
  for(const [id,expected] of [[36,300],[17,200],[57,200],[999,200]]){
    const {bot}=rig({id});const i=input();const ceiling=bot.applyTrackPolicy(1000,i);
    assert.equal(i.throttle*300,expected);assert.equal(ceiling*300,expected);
    if(expected===200)assert.equal(i.lane,null);
  }
  for(const mutate of [r=>r.battle.track.pieces[0].inferred=true,r=>r.battle.track.pieces[0].unverified=true,r=>r.e.located=false]){
    const r=rig();mutate(r);const i=input();assert.equal(r.bot.applyTrackPolicy(1000,i)*300,200);assert.equal(i.lane,null);
  }
});

test('stale, future, pre-motion and transition-only evidence cannot authorize CPU steering',()=>{
  const changes=[r=>r.car.telemetry.lastPositionAt=-1001,r=>r.car.telemetry.lastPositionAt=1001,
    r=>r.car.motionSince=1001,r=>r.localizer.seenCode=false,r=>r.localizer.lastId=39,
    r=>r.car.telemetry.lastPositionAt=undefined];
  for(const mutate of changes){const r=rig();mutate(r);const i=input();assert.equal(r.bot.applyTrackPolicy(1000,i)*300,200);assert.equal(i.lane,null);}
  const r=rig();r.localizer.speed=0;const i=input();r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,null,'stationary localization cannot authorize lane movement');
});

test('reverse-travel remaining distance uses Localizer progress in travel direction',()=>{
  const track=buildTrack(pieces,LAYOUTS.Capsule), localizer=new Localizer(track,pieces);
  const car={pieces,localizer,telemetry:{lastPositionAt:1000},motionSince:900};
  const bot=new Bot(car,{active:false,track});
  localizer.feed({type:'position',pieceId:36,locationId:17,reverse:true,speed:300},1000);
  assert.equal(localizer.estimate(1000).direction,-1);assert.ok(Math.abs(localizer.estimate(1000).progress-.214)<1e-9);
  let i=input();assert.equal(bot.applyTrackPolicy(1000,i),1);assert.equal(i.lane,22.5);
  localizer.feed({type:'position',pieceId:36,locationId:15,reverse:true,speed:300},1000);
  i=input();assert.equal(bot.applyTrackPolicy(1000,i)*300,200);assert.equal(i.lane,null,'near exit in reverse must not steer');
});

test('free CPU lane targets alternate once per piece encounter, direction and lap',()=>{
  const r=rig();let i=input();r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,22.5);
  i=input();r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,null,'same piece cannot retry every tick');
  r.e.index=1;r.localizer.lastId=39;i=input();r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,-22.5);
  r.localizer.laps=1;i=input();r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,22.5);
  r.e.direction=-1;i=input();r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,-22.5);
});

test('active Battle policy only reduces throttle and admits existing safe lane intent once',()=>{
  const r=rig({active:true});let i={throttle:.1,lane:-22.5};r.bot.applyTrackPolicy(1000,i);
  assert.equal(i.throttle,.1);assert.equal(i.lane,-22.5);
  i={throttle:1,lane:22.5};r.bot.applyTrackPolicy(1000,i);assert.equal(i.lane,null);
  r.battle.track.pieces[0]=traversal(pieces,17,false);r.localizer.lastId=17;
  i={throttle:.2,lane:22.5};assert.equal(r.bot.applyTrackPolicy(1000,i)*300,200);assert.equal(i.throttle,.2);assert.equal(i.lane,null);
});

test('inactive Battle objective preserves its own throttle and lane while applying track constraints',()=>{
  const r=rig();let i={throttle:.1,lane:-22.5};
  assert.equal(r.battle.active,false);
  assert.equal(r.bot.applyTrackPolicy(1000,i,{objective:true}),1);
  assert.equal(i.throttle,.1,'objective speed must not become free-cruise throttle');
  assert.equal(i.lane,-22.5,'objective lane must not be replaced with free-cruise alternation');
  i={throttle:0,lane:null};r.bot.applyTrackPolicy(1000,i,{objective:true});
  assert.equal(i.throttle,0);assert.equal(i.lane,null);
  for(const id of [57,10]){
    const restricted=rig({id});i={throttle:.2,lane:22.5};
    assert.equal(restricted.bot.applyTrackPolicy(1000,i,{objective:true})*300,200);
    assert.equal(i.throttle,.2);assert.equal(i.lane,null,'special and intersection objective lanes remain blocked');
  }
});

test('speed and steering margins independently enforce 150 mm and 250 mm remaining',()=>{
  for(const [progress,speed,lane] of [[.5,300,true],[.5001,300,false],[.7,300,false],[.7001,200,false]]){
    const r=rig({progress});const i=input();assert.equal(r.bot.applyTrackPolicy(1000,i)*300,speed);
    assert.equal(i.lane!==null,lane);
  }
});

test('Game applies CPU curve cap after Battle boost and preserves lower slowdowns; selection alone stays stopped',async()=>{
  let now=1000;const sent=[];
  const radio={onNotify(){return()=>{};},async write(p){sent.push([...p]);},close(){}};
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now});
  const driver=game.addCar(radio);await driver.car.initialization;await driver.car.pumpPromise;
  game.useTrack(buildTrack(game.pieces,LAYOUTS.Capsule));game.topSpeed=300;game.setControl(driver,'bot');
  game.resume();game.tick(.04,now);await driver.car.pumpPromise;assert.equal(driver.car.speed,0);
  game.startBattle();driver.objectiveInput={throttle:1,lane:22.5};
  // Actual localizer derives curve identity; separate printed-code freshness is supplied.
  driver.car.localizer.feed({type:'position',pieceId:17,locationId:10,reverse:false,speed:300},now);
  driver.car.telemetry.lastPositionAt=now;driver.car.lastTrackAt=now;
  const fighter=game.battle.get(driver.car);fighter.boostUntil=10000;fighter.boost=400;
  game.tick(.04,now);await driver.car.pumpPromise;assert.equal(driver.car.speed,200,'boost cannot defeat final geometry cap');
  fighter.slow.set('test',{until:10000,factor:.2});game.tick(.04,now);await driver.car.pumpPromise;
  assert.equal(driver.car.speed,120,'boosted 600 times slowdown .2 remains below curve cap');
  fighter.slow.set('cap',{until:10000,cap:70});game.tick(.04,now);await driver.car.pumpPromise;assert.equal(driver.car.speed,70);
  game.stopAll();await driver.car.pumpPromise;assert.equal(driver.car.speed,0);
});
