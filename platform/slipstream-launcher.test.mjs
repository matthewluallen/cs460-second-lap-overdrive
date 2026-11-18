import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {launch} from './slipstream-launcher.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(t){
  const stateDir=await mkdtemp(join(tmpdir(),'slipstream-launch-test-'));
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port;await new Promise(r=>server.close(r));
  t.after(async()=>{
    try{const {pid}=JSON.parse(await readFile(join(stateDir,'server.json'),'utf8'));await stop(pid);}catch(error){if(error.code!=='ENOENT')throw error;}
    await rm(stateDir,{recursive:true,force:true});
  });
  return {stateDir,port};
}
async function stop(pid){
  try{process.kill(pid,'SIGTERM');}catch(error){if(error.code==='ESRCH')return;throw error;}
  for(let i=0;i<100;i++){try{process.kill(pid,0);}catch{return;}await sleep(20);}
  throw new Error('Test server did not stop');
}
test('managed startup is concurrent-safe, private, live-only and idempotent',async t=>{
  const options=await setup(t);
  const results=await Promise.all([launch(options),launch(options)]);
  assert.equal(results[0].pid,results[1].pid);
  assert.deepEqual(results.map(r=>r.alreadyRunning).sort(),[false,true]);
  const {pid,bootId}=results[0];
  const secret=await readFile(join(options.stateDir,'host-code'),'utf8');
  assert.ok(secret.trim().length>=8);
  for(const [name,mode] of [['',0o700],['host-code',0o600],['server.log',0o600],['server.json',0o600]]){
    assert.equal((await stat(join(options.stateDir,name))).mode&0o777,mode);
  }
  const origin=`http://127.0.0.1:${options.port}`;
  const response=await fetch(origin+'/slipstream/ready');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{service:'slipstream',mode:'live',bootId});
  for(const path of ['/api/health','/bench/','/instructor-drive/'])assert.equal((await fetch(origin+path)).status,404);
  assert.equal((await fetch(origin+'/slipstream/')).status,200);
  await assert.rejects(launch({...options,hostCode:'different-host-code'}),/different host code/);
  assert.equal((await launch(options)).pid,pid);
  assert.equal(await readFile(join(options.stateDir,'host-code'),'utf8'),secret);
});
test('managed restart preserves the host code but creates a new server identity',async t=>{
  const options=await setup(t);
  const first=await launch(options);
  const secret=await readFile(join(options.stateDir,'host-code'),'utf8');
  await stop(first.pid);
  const second=await launch(options);
  assert.notEqual(second.bootId,first.bootId);
  assert.equal(second.alreadyRunning,false);
  assert.equal(await readFile(join(options.stateDir,'host-code'),'utf8'),secret);
});
test('startup refuses an occupied port without stopping the foreign server',async t=>{
  const options=await setup(t);
  const foreign=createServer((req,res)=>res.end('another service'));
  foreign.listen(options.port,'127.0.0.1');await once(foreign,'listening');
  t.after(()=>{foreign.closeAllConnections();return new Promise(r=>foreign.close(r));});
  await assert.rejects(launch(options),/occupied/);
  assert.equal(await (await fetch(`http://127.0.0.1:${options.port}/`)).text(),'another service');
  await assert.rejects(readFile(join(options.stateDir,'server.json')),e=>e.code==='ENOENT');
});
test('invalid settings fail before starting a server',async()=>{
  await assert.rejects(launch({port:0}),/PORT/);
  await assert.rejects(launch({hostCode:'short'}),/Host code/);
});
