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
