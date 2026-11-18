import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decode, hex, ID, offsetIsKnown} from './protocol.mjs';
import {Game} from './game.mjs';
import {Pieces, TrackMapper} from './track.mjs';
import {ReplayCar, validate} from './trace.mjs';

// Frozen 18 November hardware bytes. Replays validate host behavior only: they
// do not reproduce traction, identify a physical piece, or prove physical STOP.
const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const trace=validate(json('./fixtures/groundshock-sdk-cold-curve-scan-no-position.json'));
const raw=text=>Uint8Array.from(text.split(' ').map(b=>parseInt(b,16)));
const events=trace.events.map(([at,car,direction,text],index)=>({at,car,direction,text,index,packet:raw(text)}));
const tx=events.filter(e=>e.direction==='tx');
const rx=events.filter(e=>e.direction==='rx').flatMap(e=>decode(e.packet).map(message=>({...e,message})));
const speed=e=>new DataView(e.packet.buffer,e.packet.byteOffset,e.packet.byteLength).getInt16(2,true);
const scanStart=trace.markers.find(m=>m.kind==='scan-start').timeMs;
const forbidden=[ID.SET_OFFSET,ID.OFFSET_ADJUST,ID.CHANGE_LANE,ID.TURN];
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('cold curve-scan capture includes SDK initialization, firmware 11866 and 4106 mV, with no raw position frame',()=>{
  assert.equal(trace.source,'hardware');assert.equal(trace.events.length,42);
  assert.equal(trace.dropped,0);assert.equal(trace.markersDropped,0);
  assert.deepEqual([trace.cars[0].profile,trace.cars[0].firmware],['sdk',11866]);
  // The chooser did not identify the model. Groundshock comes from the retained
  // operator observation, not an invented model decoded from these packets.
  assert.equal(trace.cars[0].model,0);
  assert.deepEqual(tx.filter(e=>[ID.SDK_MODE,ID.PING,ID.VERSION,ID.BATTERY].includes(e.packet[1])).map(e=>[e.at,e.text]),[
    [43,'03 90 01 01'],[46,'01 16'],[119,'01 18'],[180,'01 1a']
  ]);
  assert.deepEqual(rx.filter(e=>e.message.type==='ping').map(e=>e.at),[119]);
  assert.deepEqual(rx.filter(e=>e.message.type==='version').map(e=>[e.at,e.message.version]),[[179,11866]]);
  assert.deepEqual(rx.filter(e=>e.message.type==='battery').map(e=>[e.at,e.message.millivolts]),[[300,4106]]);
  assert.ok(events.every(e=>e.packet[0]===e.packet.length-1),'each retained event is a complete single frame');
  assert.equal(events.some(e=>e.direction==='rx' && e.packet[1]===ID.POSITION),false,'absence is present in raw bytes, not decoder filtering');
  assert.equal(rx.some(e=>e.message.type==='position'),false);
  const transitions=rx.filter(e=>e.message.type==='transition');
  assert.deepEqual(transitions.map(e=>[e.at,e.packet.length,e.message.offset]),[
    [26431,18,654321],[27391,18,654195],[27481,18,654195],[121177,18,654231]
  ]);
  assert.ok(transitions.every(e=>!offsetIsKnown(e.message.offset)));
  assert.ok(transitions.every(e=>e.message.lastReceivedLaneChangeId===255 && e.message.lastExecutedLaneChangeId===255));
  assert.deepEqual([trace.diagnostics.cars[0].positions,trace.diagnostics.cars[0].transitions],[0,4]);
  assert.equal(trace.diagnostics.cars[0].malformed,0);
});

test('cold scan requests one 300 mm/s forward command without offset, lane, turn or three-lap baseline commands',()=>{
  assert.equal(scanStart,25102);
  assert.deepEqual(tx.filter(e=>e.packet[1]===ID.SPEED && speed(e)>0).map(e=>[e.at,e.text]),[[25104,'06 24 2c 01 e8 03 00']]);
  assert.equal(tx.some(e=>forbidden.includes(e.packet[1])),false);
  assert.equal(tx.some(e=>[0x35,ID.MAX_DELOCALIZED_SPEED].includes(e.packet[1])),false);
  assert.deepEqual(rx.filter(e=>e.message.type==='speed').map(e=>[e.at,e.message.desired,e.message.actual]),[
    [25142,300,0],[29551,0,0]
  ]);
  assert.equal(trace.markers.some(m=>m.kind.startsWith('forward-baseline')),false);
  assert.equal(trace.diagnostics.cars[0].forwardBaseline,undefined);
  assert.equal(trace.diagnostics.cars[0].forwardBaselineUntil,null);
  assert.equal(trace.diagnostics.track,null);
  assert.equal(trace.diagnostics.cars[0].physicalStopVerified,false);
});

test('recorded scan STOP follows the normal two-second transition gap and late telemetry receives only STOP retries',()=>{
  const timeout=trace.markers.find(m=>m.kind==='log' && m.details.text==='Groundshock: Telemetry timeout');
  assert.equal(timeout.timeMs,29503);
  assert.equal(trace.diagnostics.safety.firstTrackMs,5000);assert.equal(trace.diagnostics.safety.trackGapMs,2000);
  const prior=rx.filter(e=>e.at<timeout.timeMs && ['position','transition'].includes(e.message.type)).at(-1);
  assert.equal(prior.at,27481);assert.equal(timeout.timeMs-prior.at,2022);
  const stops=tx.filter(e=>e.at>=timeout.timeMs && e.packet[1]===ID.SPEED);
  assert.deepEqual(stops.map(e=>[e.at,speed(e)]),[[29504,0],[29504,0],[44112,0],[121183,0],[121183,0]]);
  assert.equal(stops[0].at-timeout.timeMs,1,'recorded host write completion, not physical braking latency');
  assert.equal(tx.some(e=>e.at>timeout.timeMs && e.packet[1]===ID.SPEED && speed(e)>0),false);
  const late=rx.find(e=>e.at===121177);
  assert.equal(late.message.type,'transition');assert.equal(late.message.laneChangeActivity,0);
  const alarm=trace.markers.find(m=>m.kind==='log' && m.details.text.includes('STOP not confirmed'));
  assert.equal(alarm.timeMs,121182);assert.equal(stops.at(-1).at-alarm.timeMs,1);
  // The last measured speed was zero. A later transition is still an alarm,
  // not independent evidence that the car was moving or why it was handled.
  assert.deepEqual(rx.filter(e=>e.at<late.at && e.message.type==='speed').map(e=>e.message.actual),[0,0]);
  assert.equal(rx.some(e=>['delocalized','delocRecoveryEntered','laneChange'].includes(e.message.type)),false);
});

test('current SDK initialization and scan replay produce no invented positions or map, and late traffic cannot restart motion',async()=>{
  let now=0;const radio=new ReplayCar(trace,0);radio.initializationProfile='sdk';
  const game=new Game({pieces:json('./data/pieces.json'),weapons:json('./data/weapons.json'),vehicles:json('./data/vehicles.json'),clock:()=>now});
  const driver=game.addCar(radio,{name:'Groundshock',model:0});
  const writes=[];driver.car.tap=(direction,packet)=>{if(direction==='tx')writes.push({at:now,packet:Uint8Array.from(packet),text:hex(packet)});};
  await settle();
  for(const at of [...new Set(events.filter(e=>e.at<=300).map(e=>e.at))]){now=at;radio.advance(now);await settle();}
  await driver.car.initialization;await driver.car.pumpPromise;
  assert.equal(driver.car.initializing,false);assert.equal(driver.car.faulted,false);
  assert.equal(driver.car.version,11866);assert.equal(driver.car.millivolts,4106);
  assert.equal(driver.car.initializationStatus,'Connected; track telemetry not yet verified');
  const mapper=new TrackMapper(new Pieces(json('./data/pieces.json')));
  for(const e of rx)mapper.feed(e.message);
  assert.equal(mapper.track,null,'transitions alone cannot identify track geometry');
  now=scanStart;radio.advance(now);game.topSpeed=300;game.startScan(driver);await driver.car.pumpPromise;
  assert.equal(driver.car.speed,300);assert.equal(game.forwardBaseline,null);
  const times=[...new Set([...events.filter(e=>e.at>=scanStart && e.at<=44112).map(e=>e.at),29503,44109])].sort((a,b)=>a-b);
  for(const at of times){
    now=at;radio.advance(now);if(at===44109)game.stopAll();game.tick(.04,now);await driver.car.pumpPromise;
    if(at===29503){assert.equal(driver.car.speed,0);assert.match(game.pitReason,/Telemetry timeout/);}
  }
  assert.equal(game.track,null);assert.equal(game.scanner,null);assert.equal(game.halted,true);
  assert.equal(driver.car.telemetry.positions,0);assert.equal(driver.car.telemetry.transitions,3);
  assert.equal(driver.car.diagnostics().localization.trusted,false);
  assert.equal(driver.car.diagnostics().lateralEstimate,null);
  assert.equal(writes.some(e=>forbidden.includes(e.packet[1])),false);
  assert.deepEqual(writes.filter(e=>e.packet[1]===ID.SPEED && speed(e)>0).map(e=>e.text),['06 24 2c 01 e8 03 00']);
  const before=writes.length;now=121177;radio.advance(now);await driver.car.pumpPromise;
  assert.equal(writes.length,before,'late transition alone does not issue movement');
  assert.equal(driver.car.reportedSpeed,0);assert.equal(driver.car.speed,0);assert.equal(driver.car.telemetry.transitions,4);
  now=121182;game.tick(.04,now);await driver.car.pumpPromise;
  assert.match(game.pitReason,/STOP not confirmed/);assert.ok(writes.length>before);
  assert.ok(writes.slice(before).every(e=>e.packet[1]===ID.SPEED && speed(e)===0));
  assert.equal(game.forwardBaseline,null);assert.equal(game.track,null);assert.equal(driver.car.diagnostics().physicalStopVerified,false);
});

test('successful and failed scan captures share forward bytes but only the successful scan supplies an optical calibration basis',()=>{
  const accepted=validate(json('./fixtures/groundshock-sdk-repaired-scan.json'));
  const start=accepted.markers.find(m=>m.kind==='scan-start').timeMs;
  const recorded=accepted.events.map(([at,car,direction,text],index)=>({at,car,direction,text,index,packet:raw(text)})).filter(e=>e.car===0 && e.at>=start);
  const commands=recorded.filter(e=>e.direction==='tx');
  const positions=recorded.filter(e=>e.direction==='rx').flatMap(e=>decode(e.packet).filter(m=>m.type==='position').map(message=>({...e,message})));
  assert.deepEqual(commands.filter(e=>e.packet[1]===ID.SPEED && speed(e)>0).map(e=>e.text),['06 24 2c 01 e8 03 00']);
  assert.equal(positions.length,24);
  assert.deepEqual([positions[0].at,positions[0].message.pieceId,positions[0].message.locationId,positions[0].message.offset],[23146,33,5,654321]);
  const offsets=commands.filter(e=>e.packet[1]===ID.SET_OFFSET);
  assert.deepEqual(offsets.map(e=>[e.at,e.text]),[[23146,'05 2c 00 00 b4 c1']]);
  assert.ok(offsets[0].index>positions[0].index,'the shared rounded timestamp does not imply calibration preceded the optical code');
  assert.equal(rx.filter(e=>e.message.type==='position').length,0);assert.equal(tx.filter(e=>e.packet[1]===ID.SET_OFFSET).length,0);
  // Different physical runs and notification histories; these observed facts
  // do not identify the cause of spinning or justify guessing an initial offset.
});
