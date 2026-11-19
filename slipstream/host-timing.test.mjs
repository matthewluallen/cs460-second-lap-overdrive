import test from 'node:test';
import assert from 'node:assert/strict';
import {HostTiming} from './host-timing.mjs';
test('host timing retains real scheduling gaps rather than clamped simulation dt',()=>{
  const timing=new HostTiming();[0,40,80,1580,1620].forEach(t=>timing.observe(t));
  assert.deepEqual(timing.snapshot(),{expectedIntervalMs:40,samples:4,lastGapMs:40,maxGapMs:1500,over100Ms:1,over500Ms:1,over1000Ms:1,clockResets:0});
});
test('clock resets and invalid samples cannot become radio loss or negative duration',()=>{
  const timing=new HostTiming();[100,140,NaN,Infinity,10,50].forEach(t=>timing.observe(t));
  const snapshot=timing.snapshot();assert.equal(snapshot.clockResets,1);assert.equal(snapshot.samples,2);assert.equal(snapshot.maxGapMs,40);
  snapshot.samples=99;assert.equal(timing.snapshot().samples,2);
});
