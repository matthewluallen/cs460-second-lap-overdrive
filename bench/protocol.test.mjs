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
