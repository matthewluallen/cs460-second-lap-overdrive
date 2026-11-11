import test from 'node:test';
import assert from 'node:assert/strict';
import {packet,replies,MAX_SPEED,DEFAULT_SPEED,PULSE_MS,LEGACY_FIRMWARE} from './protocol.mjs';

test('wire commands match the official SDK and classic community golden bytes',()=>{
  assert.deepEqual([...packet('sdkOn')],[3,0x90,1,1]);
  assert.deepEqual([...packet('version')],[1,0x18]);
  assert.deepEqual([...packet('battery')],[1,0x1a]);
  assert.deepEqual([...packet('ping')],[1,0x16]);
  assert.deepEqual([...packet('speed',0)],[6,0x24,0,0,0xe8,3,1]);
  assert.deepEqual([...packet('speed',100)],[6,0x24,100,0,0xe8,3,1]);
  assert.deepEqual([...packet('speed',200)],[6,0x24,200,0,0xe8,3,1]);
  assert.equal(MAX_SPEED,200);assert.equal(DEFAULT_SPEED,100);assert.equal(PULSE_MS,750);
});

test('negative, excessive, fractional and coerced speeds fail before encoding',()=>{
  for(const value of [-1,201,1000,65536,NaN,Infinity,-Infinity,0.1,'100',null,true,{},[]]){
    assert.throws(()=>packet('speed',value),RangeError,String(value));
  }
});

test('no generic command, lane, firmware update, or v4 fallback surface exists',()=>{
  for(const action of ['lane','turn','flash','firmware','v4','sdkOff','raw','__proto__','constructor',0x24]){
    assert.throws(()=>packet(action),/Operation not allowed/);
  }
  assert.deepEqual(LEGACY_FIRMWARE,[9511,11866]);
  assert.ok(Object.isFrozen(LEGACY_FIRMWARE));
  for(const version of [12385,12386,12411,12412,3387])assert.ok(!LEGACY_FIRMWARE.includes(version));
});

test('caller mutation does not change subsequent fixed command bytes',()=>{
  const one=packet('sdkOn');one.fill(255);
  assert.deepEqual([...packet('sdkOn')],[3,0x90,1,1]);
});

test('decode ping, little-endian version and battery and concatenated notifications',()=>{
  assert.deepEqual(replies(Uint8Array.of(1,0x17)),[{id:0x17,value:true}]);
  assert.deepEqual(replies(Uint8Array.of(3,0x19,0x5a,0x2e)),[{id:0x19,value:11866}]);
  assert.deepEqual(replies(Uint8Array.of(5,0x19,0x5a,0x2e,0,0)),[{id:0x19,value:11866}]);
  assert.deepEqual(replies(Uint8Array.of(3,0x1b,0xa0,0x0f)),[{id:0x1b,value:4000}]);
  assert.deepEqual(replies(Uint8Array.of(1,0x17,3,0x19,0x5a,0x2e,3,0x1b,0xa0,0x0f)),[
    {id:0x17,value:true},{id:0x19,value:11866},{id:0x1b,value:4000},
  ]);
});

test('unsigned 32-bit version cannot wrap into an allowed legacy version',()=>{
  assert.deepEqual(replies(Uint8Array.of(5,0x19,0x5a,0x2e,0,0x80)),[{id:0x19,value:2147495514}]);
});

test('truncated or zero-length frames reject; unknown and wrong-size replies do not satisfy requests',()=>{
  for(const bytes of [[0],[1],[3,0x1b,0xa0],[1,0x17,2,0x19],[255,0x17]]){
    assert.throws(()=>replies(Uint8Array.from(bytes)),/Malformed notification/);
  }
  assert.deepEqual(replies(Uint8Array.of(2,0x17,1,2,0x19,1,2,0x1b,1,1,0xff)),[]);
  assert.deepEqual(replies(new Uint8Array()),[]);
});
