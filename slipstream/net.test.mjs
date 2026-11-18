import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./net.mjs',import.meta.url),'utf8').replaceAll('export ','');
function harness(fetchImpl=async()=>({status:204})){
  const sockets=[],timers=[],requests=[];
  class Socket{
    constructor(){this.sent=[];sockets.push(this);}
    send(value){if(this.fail)throw new Error('socket closed');this.sent.push(value);}
    close(){this.closed=true;}
  }
  const ctx=vm.createContext({console,AbortController,TextDecoder,location:{protocol:'https:',host:'example.test'},
    WebSocket:Socket,fetch:(...args)=>{requests.push(args);return fetchImpl(...args);},
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){}
  });
  vm.runInContext(source,ctx);
  const events=[],statuses=[];
  const connect=()=>ctx.channel({room:'room',key:'private',role:'player',onMessage:m=>events.push(m),onStatus:s=>statuses.push(s)});
  return {ctx,sockets,timers,requests,events,statuses,connect};
}
const event={data:JSON.stringify({type:'state',me:{id:1}})};
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('stopped socket ignores queued open and message events and rejects further sends',async()=>{
  const h=harness(),link=h.connect(),socket=h.sockets[0];link.stop();
  socket.onopen();socket.onmessage(event);
  assert.equal(socket.sent.length,0);assert.equal(h.events.length,0);assert.equal(h.statuses.length,0);
  await assert.rejects(link.send({throttle:1}),/stopped/i);assert.equal(h.requests.length,0);
});
test('a replaced socket cannot deliver stale messages or change current channel status',()=>{
  const h=harness(),link=h.connect(),old=h.sockets[0];
  old.onmessage(event);old.onclose({code:1006});h.timers.find(t=>t.ms===500).fn();
  const fresh=h.sockets[1];fresh.onmessage(event);
  const events=h.events.length,statuses=h.statuses.length;
  old.onmessage(event);old.onclose({code:1006});
  assert.equal(h.events.length,events);assert.equal(h.statuses.length,statuses);assert.equal(link.transport,'socket');link.stop();
});
test('socket send failure is a rejected promise compatible with caller catch handlers',async()=>{
  const h=harness(),link=h.connect(),socket=h.sockets[0];socket.onmessage(event);socket.fail=true;
  let pending;assert.doesNotThrow(()=>{pending=link.send({throttle:0});});
  await assert.rejects(pending,/socket closed/);link.stop();
});
test('stopped HTTP stream ignores a late fetch response',async()=>{
  let resolve;const h=harness(()=>new Promise(r=>{resolve=r;}));
  const stop=h.ctx.listen('/path','key',m=>h.events.push(m),s=>h.statuses.push(s));stop();
  resolve({status:403});await settle();assert.equal(h.statuses.length,0);
});
test('stopped HTTP stream ignores bytes already queued by its reader',async()=>{
  let resolveRead;
  const h=harness(async()=>({ok:true,status:200,body:{getReader:()=>({read:()=>new Promise(r=>{resolveRead=r;})})}}));
  const stop=h.ctx.listen('/path','key',m=>h.events.push(m),s=>h.statuses.push(s));await settle();stop();
  resolveRead({done:false,value:new TextEncoder().encode('data: {"type":"state"}\n\n')});await settle();
  assert.equal(h.events.length,0);assert.deepEqual(h.statuses,['online']);
});
