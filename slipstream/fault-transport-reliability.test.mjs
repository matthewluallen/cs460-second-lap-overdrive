import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FaultTransport} from './faults.mjs';
import {decode,encode} from './protocol.mjs';
import {Pieces} from './track.mjs';
import {SimWorld} from './sim.mjs';

const packed=(...frames)=>Uint8Array.from(frames.flatMap(frame=>[...frame]));
const position=Uint8Array.of(10,0x27,1,33,0,0,0,0,0x2c,1,0);
const transition=Uint8Array.of(17,0x29,0,0,0,0,0,0,255,255,0,0,0,0,0,0,20,20);
const critical=[Uint8Array.of(1,0x2b),Uint8Array.of(1,0x43),Uint8Array.of(5,0x3f,0,0,1,0),Uint8Array.of(3,0x4d,1,0)];
const unknown=Uint8Array.of(3,0x7e,12,34);
function peer(options={}){
  let notify,closed;const inner={initializationProfile:'fast-furious',initializationTimeoutMs:40,initializationOptions:{plasticTrack:false},
    onNotify(fn){notify=fn;return()=>{notify=()=>{};};},onClose(fn){closed=fn;return()=>{closed=()=>{};};},
    drainNotifications(){this.drained=true;},diagnostics(){return{state:'open',notificationsReceived:7};},async write(){},close(){this.closed=true;}};
  const radio=new FaultTransport(inner,options),seen=[];radio.onNotify(bytes=>seen.push([...bytes]));
  return{inner,radio,seen,emit:bytes=>notify(bytes),disconnect:()=>closed()};
}

test('silent telemetry removes optical frames without swallowing coalesced safety or unknown messages',()=>{
  const r=peer();r.radio.silentTelemetry=true;
  r.emit(packed(position,critical[0],transition,...critical.slice(1),unknown));
  assert.deepEqual(r.seen,[[...packed(...critical,unknown)]]);
});

test('malformed tails and unsupported compact formats pass unchanged without speculative reassembly',()=>{
  const compact=Uint8Array.of(7,0x29,0,16,191,31,201,1);
  for(const tail of [Uint8Array.of(5,0x27,1),Uint8Array.of(0,1,0x2b),Uint8Array.of(9)]){
    const r=peer();r.radio.silentTelemetry=true;
    assert.doesNotThrow(()=>r.emit(packed(position,critical[0],compact,tail)));
    assert.deepEqual(r.seen,[[...packed(critical[0],compact,tail)]]);
  }
});

test('deterministic delay preserves safety immediately and releases copied telemetry only when advanced',()=>{
  let now=100;const r=peer({telemetryDelayMs:250,clock:()=>now});
  const input=packed(position,critical[0],transition,unknown);r.emit(input);input.fill(0);
  assert.deepEqual(r.seen,[[...packed(critical[0],unknown)]]);
  r.radio.advance(349);assert.equal(r.seen.length,1);
  now=350;r.radio.advance(now);assert.deepEqual(r.seen.slice(1),[[...position],[...transition]]);
  r.radio.advance(999);assert.equal(r.seen.length,3);
});

test('drop bursts count supported optical frames, not notifications or safety messages',()=>{
  const r=peer();r.radio.dropNextTelemetry(2);
  r.emit(packed(position,...critical));r.emit(unknown);r.emit(packed(transition,position,...critical));
  assert.deepEqual(r.seen,[[...packed(...critical)],[...unknown],[...packed(position,...critical)]]);
  assert.equal(r.radio.droppedTelemetry,2);
});

test('bounded delayed queues drop telemetry overflow while preserving immediate safety',()=>{
  const r=peer({telemetryDelayMs:100,maxPending:2});
  r.emit(packed(position,transition,position,...critical));
  assert.equal(r.radio.pending.length,2);assert.equal(r.radio.droppedTelemetry,1);
  assert.deepEqual(r.seen,[[...packed(...critical)]]);r.radio.advance(100);
  assert.deepEqual(r.seen.slice(1),[[...position],[...transition]]);
});

test('close and inner disconnect clear pending faults and prevent delayed callback revival',async()=>{
  for(const disconnect of [false,true]){
    const r=peer({telemetryDelayMs:100});r.emit(position);r.radio.lateDelocalized(150);
    if(disconnect)r.disconnect();else r.radio.close();
    assert.equal(r.radio.pending.length,0);r.radio.onNotify(bytes=>r.seen.push([...bytes]));
    r.radio.advance(200);r.emit(position);r.radio.emit(critical[0]);assert.deepEqual(r.seen,[]);
    await assert.rejects(r.radio.write(encode.speed(300)),/closed|disconnect/i);
  }
});

test('wrapper preserves initialization, startup drain and transport diagnostics',()=>{
  const r=peer();assert.equal(r.radio.initializationProfile,'fast-furious');
  assert.equal(r.radio.initializationTimeoutMs,40);assert.deepEqual(r.radio.initializationOptions,{plasticTrack:false});
  r.radio.drainNotifications();assert.equal(r.inner.drained,true);assert.deepEqual(r.radio.diagnostics(),r.inner.diagnostics());
});

test('invalid delay, burst, queue and scheduling inputs are rejected without changing the valid plan',()=>{
  for(const options of [{telemetryDelayMs:-1},{telemetryDelayMs:10001},{telemetryDelayMs:NaN},{maxPending:0},{maxPending:1025},{maxPending:1.5}])assert.throws(()=>peer(options),/delay|pending/i);
  const r=peer();for(const count of [-1,1.5,10001,NaN])assert.throws(()=>r.radio.dropNextTelemetry(count),/count|burst/i);
  for(const at of [-1,NaN,Infinity]){assert.throws(()=>r.radio.lateDelocalized(at),/time/i);assert.throws(()=>r.radio.advance(at),/time/i);}
  assert.throws(()=>r.radio.setTelemetryDelay(-1),/delay/i);assert.equal(r.radio.pending.length,0);
});

const pieces=new Pieces(JSON.parse(readFileSync(new URL('./data/pieces.json',import.meta.url))));
for(const count of [1,2,3,4])for(const firstModel of [18,19])test(`${count}-car simulator F&F model matrix starting ${firstModel}: silent, delayed and burst faults retain every critical frame`,async()=>{
  for(const mode of ['silent','delay','burst']){
    let now=0;const world=new SimWorld(pieces,'Starter oval'),cars=[];
    for(let i=0;i<count;i++){
      const model=i%2?(firstModel===18?19:18):firstModel,sim=world.addCar({model,index:4,progress:.05+i*.03,lateral:22.5});
      const generated=[],received=[];
      const inner={model,onNotify(fn){return sim.onNotify(bytes=>{
        const optical=decode(bytes).some(message=>['position','transition'].includes(message.type));
        if(optical){generated.push({at:now,bytes:[...bytes]});fn(packed(bytes,...critical));}else fn(bytes);
      });},write:bytes=>sim.write(bytes),close:()=>sim.close()};
      const radio=new FaultTransport(inner,{telemetryDelayMs:mode==='delay'?500:0,clock:()=>now});
      if(mode==='silent')radio.silentTelemetry=true;if(mode==='burst')radio.dropNextTelemetry(2);
      radio.onNotify(bytes=>{for(const message of decode(bytes))received.push({at:now,type:message.type});});
      await radio.write(encode.sdkMode(true,1));await radio.write(encode.speed(300));
      cars.push({radio,generated,received});
    }
    for(now=40;now<=6000;now+=40){for(const car of cars)car.radio.advance(now);world.step(.04);if(cars.every(car=>car.generated.length>=3))break;}
    for(const car of cars){
      assert.ok(car.generated.length>=3,mode+' generated actual simulator optical frames');
      for(const type of ['delocalized','delocRecoveryEntered','status','collision'])assert.deepEqual(car.received.filter(row=>row.type===type).map(row=>row.at),car.generated.map(row=>row.at),mode+' '+type+' is immediate');
    }
    now+=500;for(const car of cars){
      car.radio.advance(now);const optical=car.received.filter(row=>['position','transition'].includes(row.type));
      assert.equal(optical.length,mode==='silent'?0:car.generated.length-(mode==='burst'?2:0));
      if(mode==='delay')optical.forEach((row,i)=>assert.ok(row.at>=car.generated[i].at+500));
      car.radio.close();
    }
  }
});
