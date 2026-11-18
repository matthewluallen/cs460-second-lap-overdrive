// Real browser network module against real relay sockets/HTTP. No Bluetooth or
// device sensors: proves routing/approval/privacy, not physical car behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createApp} from './server.mjs';
const source=readFileSync(new URL('../slipstream/net.mjs',import.meta.url),'utf8').replaceAll('export ','');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate){
  for(let i=0;i<150;i++){const result=predicate();if(result)return result;await sleep(20);}
  throw new Error('Timed out waiting for relay evidence');
}
for(const transport of ['socket','http']) for(const count of [1,2,3,4]) test(`${count} real client channels: ${transport} approval, input, private state and revocation`,async t=>{
  const code='integration-private-code', app=createApp({slipstream:true,slipstreamOnly:true,hostCode:code});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  app.locals.slipstreamRelay.attach(server);
  const origin=`http://127.0.0.1:${server.address().port}`, channels=[];
  t.after(async()=>{
    for(const c of channels)c.link.stop();
    app.locals.slipstreamRelay.stop();server.closeAllConnections();
    await new Promise(r=>server.close(r));
  });
  const context=vm.createContext({console,AbortController,TextDecoder,setTimeout,clearTimeout,
    location:new URL(origin),fetch:(path,options)=>fetch(new URL(path,origin),options),
    WebSocket:transport==='socket'?WebSocket:class {constructor(){throw new Error('Socket unavailable: test HTTP fallback');}}
  });
  vm.runInContext(source,context);
  const api=context.api;
  const room=await api('/rooms',{method:'POST',key:code});
  const base='/rooms/'+room.room;
  function connect(key,role){
    const events=[],statuses=[];
    const link=context.channel({room:room.room,key,role,onMessage:m=>events.push(m),onStatus:s=>statuses.push(s)});
    const c={link,events,statuses};channels.push(c);return c;
  }
  const host=connect(room.hostKey,'host');await until(()=>host.statuses.includes('online'));
  const players=[];
  for(let i=0;i<count;i++){
    const player=await api(base+'/join',{method:'POST',body:{joinKey:room.joinKey,name:'Driver '+i}});
    const client=connect(player.playerKey,'player');players.push({player,client});
    await until(()=>client.events.some(e=>e.type==='pending'));
    await api(base+'/approve',{method:'POST',key:room.hostKey,body:{player:player.player}});
    await until(()=>client.events.some(e=>e.type==='approved'));
    await client.link.send({throttle:.25,steer:0});
    await until(()=>host.events.some(e=>e.type==='input'&&e.player===player.player&&e.throttle===.25));
    assert.equal(client.link.transport,transport);
  }
  const views=Object.fromEntries(players.map(({player},i)=>[player.player,{id:i+1,name:'Car '+i,marker:'private-'+i}]));
  await host.link.send({players:views,lobby:{phase:'ready'}});
  for(let i=0;i<count;i++){
    const {client}=players[i];
    const state=await until(()=>client.events.find(e=>e.type==='state'&&e.me?.marker==='private-'+i));
    assert.equal(state.me.id,i+1);
    assert.equal(state.players,undefined);
    assert.equal(client.events.some(e=>e.type==='state'&&e.me?.marker&&e.me.marker!=='private-'+i),false);
  }
  const removed=players[0];
  await api(base+'/kick',{method:'POST',key:room.hostKey,body:{player:removed.player.player}});
  await until(()=>removed.client.events.some(e=>e.type==='kicked'));
  await assert.rejects(api(base+'/input',{method:'POST',key:removed.player.playerKey,body:{throttle:1}}),e=>e.status===403);
});
