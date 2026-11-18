import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {decode,hex} from './protocol.mjs';
import {ReplayCar,validate} from './trace.mjs';

// Frozen cumulative export. Its operator notes accept the preceding scan;
// physical acceptance of these forward laps came separately after this export.
const file=readFileSync(new URL('./fixtures/guardian-sdk-three-forward-laps-2026-11-18.json',import.meta.url));
const trace=validate(JSON.parse(file));
const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const raw=text=>Uint8Array.from(text.split(' ').map(b=>parseInt(b,16)));
const events=trace.events.map(([at,car,direction,text],index)=>({at,car,direction,text,index,packet:raw(text)})).filter(e=>e.car===2);
const tx=events.filter(e=>e.direction==='tx');
const rx=events.filter(e=>e.direction==='rx').flatMap(e=>decode(e.packet).map(message=>({...e,message})));
const positive=packet=>packet[1]===0x24&&(packet[2]||packet[3]);
const forwardStart=1766135;
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('Guardian forward export retains the accepted scan prefix and three-lap software result without inventing physical acceptance',()=>{
  assert.equal(createHash('sha256').update(file).digest('hex'),'733bba74f5a7dbc5a9869736c93e23af14841158fc703b55741328f518286ad0');
  assert.equal(trace.events.length,184);assert.equal(trace.dropped,0);assert.equal(trace.markersDropped,0);
  assert.deepEqual(trace.events.slice(0,88),json('./fixtures/guardian-sdk-scan-2026-11-18.json').events);
  assert.deepEqual([trace.cars[2].driverId,trace.cars[2].model,trace.cars[2].firmware,trace.cars[2].profile],[4,0,11866,'sdk']);
  const result=trace.diagnostics.cars[0].forwardBaseline;
  assert.deepEqual([result.active,result.stage,result.laps,result.targetLaps,result.speed,result.maximumMs],[false,'complete',3,3,300,120000]);
  assert.deepEqual([result.reference.pieceId,result.reference.locationId,result.reference.index],[20,9,2]);
  assert.equal(result.physicalStopVerified,false);assert.equal(trace.diagnostics.cars[0].physicalStopVerified,false);
  assert.match(trace.diagnostics.operatorNotes,/Repeated forward laps, lane changes and races remain unverified/);
  assert.equal(trace.diagnostics.pitReason,null);assert.equal(trace.diagnostics.halted,true);
  assert.deepEqual(rx.filter(e=>e.message.type==='battery').map(e=>[e.at,e.message.millivolts]),[[1408970,3762],[1754323,3712]]);
});

test('forward run has one calibrated speed command and no maneuver, recovery or extra host motion before completion STOP',()=>{
  const commands=tx.filter(e=>e.at>=forwardStart),messages=rx.filter(e=>e.at>=forwardStart);
  assert.deepEqual(commands.map(e=>[e.index,e.at,e.text]),[
    [94,1766136,'06 24 00 00 c4 09 00'],[95,1766136,'06 24 2c 01 e8 03 00'],
    [102,1767703,'05 2c 00 00 fc c1'],[181,1802446,'06 24 00 00 c4 09 00']
  ]);
  const optical=messages.filter(e=>e.message.type==='position');
  assert.equal(optical.length,52);assert.equal(messages.filter(e=>e.message.type==='transition').length,29);
  assert.deepEqual([optical[0].index,optical[0].message.pieceId,optical[0].message.locationId],[101,17,8]);
  assert.ok(commands.find(e=>e.packet[1]===0x2c).index>optical[0].index,'equal rounded timestamps still preserve optical-before-calibration ordering');
  const confirmed=trace.markers.find(m=>m.kind==='log'&&m.details.text.startsWith('Forward baseline: fresh map reference'));
  assert.equal(confirmed.timeMs-forwardStart,3397);
  assert.equal(messages.some(e=>['delocalized','delocRecoveryEntered','delocRecoverySucceeded','laneChange'].includes(e.message.type)),false);
  assert.equal(commands.some(e=>[0x25,0x32,0x34,0x35,0x37].includes(e.packet[1])),false);
  assert.equal(commands.at(-1).at-commands[1].at,36310);
  assert.deepEqual(messages.filter(e=>e.message.type==='speed').map(e=>[e.at,e.message.desired,e.message.actual]),[[1766172,300,0],[1802506,0,302]]);
  // The cumulative maximum includes the long STOPPED gap between scan and run.
  // It is not a telemetry gap during commanded motion or a relaxed watchdog.
  const scanLast=rx.filter(e=>e.at<forwardStart&&e.message.type==='position').at(-1);
  assert.equal(optical[0].at-scanLast.at,325100);
  const gaps=optical.slice(1).map((e,i)=>e.at-optical[i].at);assert.ok(Math.max(...gaps)<2000);
});

test('actual Game replays startup, scan, stopped gap and three full forward laps with no planner or attack restart',async()=>{
  let now=0;const radio=new ReplayCar(trace,2);radio.initializationProfile='sdk';
  const timers=[];
  const game=new Game({pieces:json('./data/pieces.json'),weapons:json('./data/weapons.json'),vehicles:json('./data/vehicles.json'),clock:()=>now,
    schedule:(fn,ms)=>{const timer={fn,at:now+ms,cancelled:false};timers.push(timer);return timer;},unschedule:timer=>{timer.cancelled=true;}});
  const driver=game.addCar(radio,{name:'Guardian',model:12,control:'none'});
  const writes=[];driver.car.tap=(direction,packet)=>{if(direction==='tx')writes.push({at:now,text:hex(packet),packet:Uint8Array.from(packet)});};
  const advance=async at=>{now=at;radio.advance(now);for(const timer of timers)if(!timer.cancelled&&timer.at<=now){timer.cancelled=true;timer.fn();}game.tick(.04);await driver.car.pumpPromise;};
  await settle();
  for(const at of [...new Set(events.filter(e=>e.at<=1409090).map(e=>e.at))]){now=at;radio.advance(now);await settle();}
  await driver.car.initialization;await driver.car.pumpPromise;
  assert.equal(driver.car.version,11866);assert.equal(driver.car.faulted,false);
  assert.deepEqual(game.safety,{firstTrackMs:5000,trackGapMs:2000,stopGraceMs:1000,scanMs:45000,scanLaps:3});
  now=1432495;game.topSpeed=300;radio.advance(now);game.startScan(driver);await driver.car.pumpPromise;
  for(const event of rx.filter(e=>e.at>=1432500&&e.at<=1443143))await advance(event.at);
  assert.equal(game.track.closed,true);assert.equal(game.track.count,7);assert.equal(game.track.inferredCount,0);
  assert.equal(game.halted,true);assert.equal(driver.car.speed,0);assert.equal(game.pitReason,null);
  // Advance the actual stopped interval: it must not be treated as driving loss.
  for(let at=1444143;at<1754289;at+=1000)await advance(at);
  await advance(1754289);driver.car.refreshBattery();await driver.car.pumpPromise;
  await advance(1754318);game.setControl(driver,'bot');await driver.car.pumpPromise;
  await advance(1754323);assert.equal(driver.car.millivolts,3712);
  await advance(1763098);game.stopAll();await driver.car.pumpPromise;
  assert.equal(game.pitReason,null);assert.equal(driver.car.speed,0);
  now=forwardStart;radio.advance(now);const beforeRun=writes.length;game.startForwardBaseline(driver);await driver.car.pumpPromise;
  driver.bot.drive=()=>assert.fail('ordinary CPU planner must stay disabled during the baseline');
  game.battle.press=()=>assert.fail('attacks must stay disabled during the baseline');
  driver.input={throttle:1,lane:45,attack:true,support:true,special:true};
  assert.equal(driver.car.maneuversLocked,true);assert.equal(game.forwardBaseline.stage,'acquiring-reference');
  const tickTimes=Array.from({length:Math.ceil((1802955-forwardStart)/40)},(_,i)=>forwardStart+(i+1)*40);
  const times=[...new Set([...tickTimes,...rx.filter(e=>e.at>forwardStart).map(e=>e.at)])].sort((a,b)=>a-b);
  const wraps=[];
  for(const at of times){
    await advance(at);
    if([1775322,1784294,1793324,1802445].includes(at))wraps.push([at,driver.car.localizer.laps]);
    if(at===1768243)assert.equal(game.forwardBaseline.stage,'acquiring-reference','duplicated curve17 does not prematurely establish a unique map reference');
    if(at===1769532){assert.equal(game.forwardBaseline.stage,'driving');assert.equal(game.forwardBaseline.reference.pieceId,20);}
  }
  assert.deepEqual(wraps,[[1775322,0],[1784294,1],[1793324,2],[1802445,3]],'initial partial traversal is not a completed lap');
  assert.equal(game.forwardBaseline,null);assert.equal(game.halted,true);assert.equal(game.pitReason,null);
  assert.equal(driver.car.speed,0);assert.equal(driver.car.telemetry.forwardBaseline.stage,'complete');
  assert.equal(driver.car.telemetry.forwardBaseline.laps,3);assert.equal(driver.car.telemetry.forwardBaseline.physicalStopVerified,false);
  assert.ok(timers.every(timer=>timer.cancelled));
  assert.deepEqual(writes.slice(beforeRun).map(e=>e.text),[
    '06 24 00 00 c4 09 00','06 24 2c 01 e8 03 00','05 2c 00 00 fc c1','06 24 00 00 c4 09 00'
  ]);
  const complete=writes.length;driver.input.throttle=1;
  for(let at=1803000;at<=1813000;at+=40)await advance(at);
  assert.equal(writes.length,complete);assert.equal(driver.car.speed,0);assert.equal(game.halted,true);
  assert.equal(writes.slice(beforeRun).filter(e=>positive(e.packet)).length,1);
});
