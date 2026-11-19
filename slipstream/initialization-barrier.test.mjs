import test from 'node:test';
import assert from 'node:assert/strict';
import {Car} from './car.mjs';

const settle = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
function heldPeer(profile, heldOpcode, replyBeforeHold=false) {
  let notify, release, entered;
  const pending=new Promise(resolve=>{release=resolve;});
  const held=new Promise(resolve=>{entered=resolve;});
  const writes=[];
  let heldOnce=false;
  const reply=bytes=>{
    if(bytes[1]===0x16) notify(Uint8Array.of(1,0x17));
    if(bytes[1]===0x18) notify(Uint8Array.of(3,0x19,0x27,0x25));
    if(bytes[1]===0x49) notify(Uint8Array.of(3,0x23,255,255));
  };
  const transport={initializationProfile:profile,initializationTimeoutMs:200,writes,
    onNotify(fn){notify=fn;return()=>{};},close(){},
    async write(bytes){
      writes.push([...bytes]);
      if(bytes[1]===heldOpcode && !heldOnce){
        heldOnce=true;
        if(replyBeforeHold)reply(bytes);
        entered();await pending;
        if(!replyBeforeHold)reply(bytes);
      } else reply(bytes);
    }
  };
  return {transport,held,release,notify:bytes=>notify(bytes)};
}

test('each app ping barrier ignores an earlier pong until its own request enters transport',async()=>{
  const cases=[
    ['fast-furious',0x90,'Stop and leave SDK override'],
    ['fast-furious',0x22,'App driving mode'],
    ['fast-furious',0x45,'Modular track settings'],
    ['fast-furious',0x21,'Default road network'],
    ['fast-furious',0x37,'Stop when delocalized'],
    ['sdk',0x90,'SDK mode']
  ];
  for(const [profile,opcode,phase] of cases){
    const peer=heldPeer(profile,opcode),car=new Car(peer.transport),ready=car.start();
    try {
      await peer.held;
      peer.notify(Uint8Array.of(1,0x17));await settle();
      assert.equal(car.initializationStatus,phase,`${profile} 0x${opcode.toString(16)} must wait for its ping`);
      assert.equal(car.initializing,true);
    } finally {peer.release();await ready;await car.pumpPromise;}
    assert.equal(car.faulted,false);
    assert.equal(car.speed,0);
  }
});

test('version barrier ignores an earlier version while the version request is still queued',async()=>{
  for(const profile of ['sdk','fast-furious']){
    // The previous ping can reply before its GATT write promise settles. The
    // version request is then queued, but has not reached the transport yet.
    const peer=heldPeer(profile,0x16,true),car=new Car(peer.transport),ready=car.start();
    try {
      await peer.held;await settle();
      assert.equal(car.initializationStatus,'Firmware version');
      assert.equal(peer.transport.writes.some(bytes=>bytes[1]===0x18),false);
      peer.notify(Uint8Array.of(3,0x19,0x34,0x12));await settle();
      assert.equal(car.initializationStatus,'Firmware version',`${profile} must await the actual version request`);
      assert.equal(car.initializing,true);
    } finally {peer.release();await ready;await car.pumpPromise;}
    assert.equal(car.faulted,false);
    assert.equal(car.version,9511);
  }
});

test('late pong cannot collapse the default-road-network barrier or reorder the following settings',async()=>{
  const peer=heldPeer('fast-furious',0x21),car=new Car(peer.transport),ready=car.start();
  await peer.held;peer.notify(Uint8Array.of(1,0x17));await settle();
  peer.release();await ready;await car.pumpPromise;
  const ids=peer.transport.writes.map(bytes=>bytes[1]);
  const network=ids.slice(ids.indexOf(0x21),ids.indexOf(0x37)+2);
  assert.deepEqual(network,[0x21,0x46,0x48,0x49,0x16,0x24,0x37,0x16]);
  assert.equal(car.faulted,false);
  assert.ok(peer.transport.writes.filter(bytes=>bytes[1]===0x24).every(bytes=>bytes[2]===0&&bytes[3]===0));
});
