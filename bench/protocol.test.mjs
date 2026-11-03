import test from 'node:test';
import assert from 'node:assert/strict';
import {frame,decode} from './protocol.mjs';
test('two captured-format fixture replies share one value; reject a truncated value',()=>{
  assert.deepEqual(decode(Uint8Array.of(1,0x17,3,0x1b,0x74,0x0e)).map(x=>x.text),['ping reply','battery 3700 mV']);
  assert.throws(()=>decode(Uint8Array.of(3,0x1b,0x74)));
});
test('only the named bench packets are accepted and callers cannot mutate the templates',()=>{
  frame('lampOn')[2]=0;assert.deepEqual([...frame('lampOn')],[2,0x1d,0x11]);
  for(const a of ['drive','speed','raw','toString'])assert.throws(()=>frame(a));
});

test('bench wire contract uses masked headlights and SDK without localization override',()=>{
  const expected={ping:[1,0x16],version:[1,0x18],battery:[1,0x1a],
    lampOn:[2,0x1d,0x11],lampOff:[2,0x1d,0x01],
    sdkOn:[3,0x90,1,0],sdkOff:[3,0x90,0,0]};
  for(const [action,bytes] of Object.entries(expected)){
    assert.deepEqual([...frame(action)],bytes);
    assert.equal(bytes[0],bytes.length-1);
  }
  for(const action of ['setSpeed','changeLane','setOffset','firmware','reset','disconnect',null,{},0])assert.throws(()=>frame(action));
});
test('malformed or wrong-size battery frames cannot become battery evidence',()=>{
  for(const bytes of [[0,0x1b,0x74,0x0e],[3,0x1b,0x74],[1,0x17,0]])assert.throws(()=>decode(Uint8Array.from(bytes)));
  for(const bytes of [[1,0x1b],[2,0x1b,0x74],[4,0x1b,0x74,0x0e,0]])assert.ok(decode(Uint8Array.from(bytes)).every(row=>!row.text.startsWith('battery ')));
  assert.deepEqual(decode(Uint8Array.of(3,0x1b,0,0)).map(row=>row.text),['battery 0 mV']);
});
test('observed OVERDRIVE 32-bit version is decoded without weakening battery framing',()=>{
  const rows=decode(Uint8Array.of(5,0x19,0x27,0x25,0,0,3,0x1b,0x62,0x0e));
  assert.equal(rows[0].text,'firmware version 9511 (32-bit reply; 0x2527)');
  assert.equal(rows[0].raw,'05 19 27 25 00 00');
  assert.equal(rows[1].text,'battery 3682 mV');
  assert.equal(decode(Uint8Array.of(3,0x19,0x34,0x12))[0].text,'firmware version 4660');
  assert.equal(decode(Uint8Array.of(5,0x19,255,255,255,255))[0].text,'firmware version 4294967295 (32-bit reply; 0xffffffff)');
  assert.throws(()=>decode(Uint8Array.of(5,0x19,0x27,0x25,0)));
  assert.equal(decode(Uint8Array.of(5,0x1b,0x27,0x25,0,0))[0].text,'other notification');
});
test('OVERDRIVE engine patterns use three steady RGB channels with no motion command',()=>{
  assert.deepEqual([...frame('engineGreen')],[17,0x33,3,0,0,0,0,0,3,0,14,14,0,2,0,0,0,0]);
  assert.deepEqual([...frame('engineOff')],[17,0x33,3,0,0,0,0,0,3,0,0,0,0,2,0,0,0,0]);
  for(const action of ['engineGreen','engineOff'])assert.equal(frame(action)[0],frame(action).length-1);
});
