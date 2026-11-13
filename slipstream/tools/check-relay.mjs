// Isolated deployment smoke test: no Bluetooth, car assignments or motion commands.
// Test inputs reach only this process's temporary host connection.
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {WebSocket} from 'ws';
const origin=new URL(process.env.SLIPSTREAM_CHECK_ORIGIN||'http://127.0.0.1:3000');
if(origin.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(origin.hostname))throw new Error('Remote checks require HTTPS');
const code=process.env.SLIPSTREAM_HOST_CODE;
if(!code)throw new Error('Set SLIPSTREAM_HOST_CODE privately before running this check');
const source=(await readFile(new URL('../net.mjs',import.meta.url),'utf8')).replaceAll('export ','');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<500;i++){if(check())return;await sleep(20);}throw new Error('Relay message deadline exceeded');}
for(const transport of ['socket','http']){
  const context=vm.createContext({console,AbortController,TextDecoder,setTimeout,clearTimeout,location:origin,
    fetch:(path,options)=>fetch(new URL(path,origin),{...options,signal:options?.signal??AbortSignal.timeout(10000)}),
    WebSocket:transport==='socket'?WebSocket:class{constructor(){throw new Error('Test HTTP fallback');}}
  });
  vm.runInContext(source,context);
  const api=context.api,connections=[];
  const room=await api('/rooms',{method:'POST',key:code});
  const base='/rooms/'+room.room;
  function connect(key,role){
    const events=[],statuses=[];
    const link=context.channel({room:room.room,key,role,onMessage:m=>events.push(m),onStatus:s=>statuses.push(s)});
    const c={events,statuses,link};connections.push(c);return c;
  }
  try{
    const host=connect(room.hostKey,'host');await until(()=>host.statuses.includes('online'));
    const players=[];
    for(let i=0;i<4;i++){
      const p=await api(base+'/join',{method:'POST',body:{joinKey:room.joinKey,name:'Deployment check '+(i+1)}});
      const client=connect(p.playerKey,'player');players.push({p,client});
      await until(()=>client.events.some(e=>e.type==='pending'));
      await api(base+'/approve',{method:'POST',key:room.hostKey,body:{player:p.player}});
      await until(()=>client.events.some(e=>e.type==='approved'));
      await client.link.send({throttle:0,steer:0});
      await until(()=>host.events.some(e=>e.type==='input'&&e.player===p.player&&e.throttle===0));
      if(client.link.transport!==transport)throw new Error('Requested transport not established');
    }
    await host.link.send({players:Object.fromEntries(players.map(({p},i)=>[p.player,{check:i}])),lobby:{phase:'stopped'}});
    for(let i=0;i<players.length;i++)await until(()=>players[i].client.events.some(e=>e.type==='state'&&e.me?.check===i));
    const removed=players[0];
    await api(base+'/kick',{method:'POST',key:room.hostKey,body:{player:removed.p.player}});
    await until(()=>removed.client.events.some(e=>e.type==='kicked'));
    let refused=false;
    try{await api(base+'/input',{method:'POST',key:removed.p.playerKey,body:{throttle:0}});}catch(error){if(error.status===403)refused=true;else throw error;}
    if(!refused)throw new Error('Revoked credentials were accepted');
    console.log(`${transport}: four approved clients, neutral input, individual state and revocation PASS`);
  }finally{
    for(const c of connections)c.link.stop();
    await api(base,{method:'DELETE',key:room.hostKey});
  }
}
console.log('Temporary rooms removed. No physical-car or sensor validation performed.');
