import test from 'node:test';
import assert from 'node:assert/strict';
import {Recorder, TRACE_FORMAT, validate} from './trace.mjs';
import {decode} from './protocol.mjs';
import {summarizeTrace} from './tools/inspect_trace.mjs';

// Hand-written native-layout examples, not observations from physical hardware.
test('supercode diagnostics preserve unsigned code and raw tag without inventing position', () => {
  const packets = Uint8Array.of(6,0x4f,0x78,0x56,0x34,0xf2,0xff,6,0x53,4,3,2,1,0x80,1,0x2b);
  const [a,b,c] = decode(packets);
  assert.equal(a.type,'supercode'); assert.equal(a.code,0xf2345678); assert.equal(a.rawTag,255);
  assert.equal(b.type,'zoneSupercode'); assert.equal(b.code,0x01020304); assert.equal(b.rawTag,128);
  assert.equal(a.pieceId,undefined); assert.equal(b.pieceId,undefined); assert.equal(c.type,'delocalized');
});

test('short supercodes retain raw bytes and do not discard a following stop event', () => {
  for (const id of [0x4f,0x53]) for (let size=1;size<6;size++) {
    const p = new Uint8Array(size+3);p[0]=size;p[1]=id;p[size+1]=1;p[size+2]=0x2b;
    assert.deepEqual(decode(p).map(m=>m.type),['other','delocalized']);
  }
});

test('recordings distinguish empty, mixed and real sessions and retain firmware replies', () => {
  const r = new Recorder(()=>0), real={car:{name:'Car',model:1,simulated:false,version:null}}, sim={car:{simulated:true}};
  r.start([]);assert.equal(r.toJSON().source,'unknown');
  r.start([real,sim]);assert.equal(r.toJSON().source,'mixed');
  real.car.tap('rx',Uint8Array.of(3,0x19,0x34,0x12));assert.equal(r.toJSON().cars[0].firmware,0x1234);
  r.stop();real.car.tap('rx',Uint8Array.of(3,0x19,0,0));assert.equal(r.toJSON().cars[0].firmware,0x1234);
  r.start([real]);assert.equal(r.toJSON().source,'hardware');
});

test('trace report keeps separate car and message identities, counting malformed notifications', () => {
  const trace={format:TRACE_FORMAT,source:'hardware',cars:[{name:'Same'},{name:'Same'}],events:[
    [0,0,'rx','06 4f 04 03 02 01 80'],[1,0,'rx','06 53 04 03 02 01 80'],
    [2,1,'rx','06 53 04 03 02 01 80'],[3,0,'rx','06 53 04 03 02 01 80'],
    [4,0,'rx','06 53'],[5,0,'tx','01 16'],[6,1,'rx','03 19 34 12']]};
  const out=summarizeTrace(trace);assert.equal(out.physicalValidation,false);
  assert.equal(out.cars[0].supercodes.length,2);assert.equal(out.cars[0].supercodes[1].count,2);
  assert.equal(out.cars[1].supercodes[0].count,1);assert.equal(out.cars[1].firmware,0x1234);
  assert.equal(out.cars[0].malformedNotifications,1);assert.equal(out.cars[0].tx,1);
});

test('negative trace times cannot be replayed as valid capture events', () => {
  assert.throws(()=>validate({format:TRACE_FORMAT,cars:[{}],events:[[-.5,0,'rx','01 17']]}));
});

test('callbacks from an earlier recording cannot contaminate a new session', () => {
  const r=new Recorder(()=>0), a={car:{name:'A',simulated:false}}, b={car:{name:'B',simulated:true}};
  r.start([a]); const oldTap=a.car.tap; r.stop(); r.start([b]);r.add(b);
  oldTap('rx',Uint8Array.of(1,0x17));
  b.car.tap('rx',Uint8Array.of(1,0x17));
  assert.equal(r.toJSON().cars.length,1);assert.equal(r.toJSON().events.length,1);
  assert.equal(r.toJSON().cars[0].name,'B');assert.equal(r.toJSON().source,'simulator');
});
