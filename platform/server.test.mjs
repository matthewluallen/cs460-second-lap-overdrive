import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {once} from 'node:events';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createApp,parsePort,MAX_BODY_BYTES} from './server.mjs';
import {MAX_RECORDS} from '../bench/records.mjs';
import {ServerRecords} from '../bench/server-records.mjs';

async function start(t){
  const app=createApp();
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise((resolve,reject)=>{
    server.close(error=>error?reject(error):resolve());
    server.closeAllConnections();
  }));
  const call=(path,{method='GET',body,raw,headers={}}={})=>new Promise((resolve,reject)=>{
    const data=raw===undefined?(body===undefined?undefined:JSON.stringify(body)):raw;
    const req=request({hostname:'127.0.0.1',port:server.address().port,path,method,
      headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...headers}
    },res=>{
      let text='';
      res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,
        json:()=>JSON.parse(text)}));
    });
    req.on('error',reject);
    req.setTimeout(2000,()=>req.destroy(new Error('Local test request timed out')));
    req.end(data);
  });
  return {app,server,call};
}

test('platform health identifies synthetic state and the actual pinned runtime versions',async t=>{
  const {call,server}=await start(t);
  assert.equal(server.address().address,'127.0.0.1');
  const response=await call('/api/health');
  assert.equal(response.status,200);
  assert.match(response.headers['content-type'],/application\/json/);
  assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(response.json(),{kind:'cs460-support-server',source:'MOCK',
    versions:{express:'4.17.1',lodash:'4.17.15'}});
});

test('platform serves the ordinary bench and worksheet modules with usable MIME types',async t=>{
  const {call}=await start(t);
  for(const path of ['/','/index.html','/worksheet.html','/evidence.html']){
    const response=await call(path);
    assert.equal(response.status,200,path);
    assert.match(response.headers['content-type'],/text\/html/,path);
    assert.match(response.text,/<!doctype html>/i,path);
  }
  for(const path of ['/ui.mjs','/link.mjs','/protocol.mjs','/records.mjs','/worksheet.mjs','/server-records.mjs']){
    const response=await call(path);
    assert.equal(response.status,200,path);
    assert.match(response.headers['content-type'],/(?:application|text)\/javascript/,path);
  }
});

test('platform exposes neither repository files nor a proxy or motor API',async t=>{
  const {call}=await start(t);
  for(const path of ['/.git/config','/%2e%2e/.git/config','/..%2f.git/config',
    '/package.json','/package-lock.json','/lapreturn/core.py','/platform/server.mjs',
    '/api/drive','/api/proxy?url=https%3A%2F%2Fexample.com']){
    const response=await call(path);
    assert.equal(response.status,404,path);
    assert.deepEqual(response.json(),{error:'Not found'},path);
  }
});

test('platform ordinary list/create/read works and returns sorted MOCK records',async t=>{
  const {call}=await start(t);
  const before=await call('/api/support/records?operator=pilot-red');
  assert.deepEqual(before.json().records.map(row=>row.id),[101]);
  const created=await call('/api/support/records',{method:'POST',body:{
    operator:'pilot-red',workgroup:'red',note:'  Synthetic ordinary record  '
  }});
  assert.equal(created.status,201);
  assert.deepEqual(created.json(),{source:'MOCK',record:{
    id:103,team:'red',note:'Synthetic ordinary record'
  }});
  const read=await call('/api/support/records/103?operator=pilot-red');
  assert.deepEqual(read.json(),created.json());
  const listed=await call('/api/support/records?operator=pilot-red');
  assert.equal(listed.json().source,'MOCK');
  assert.deepEqual(listed.json().records.map(row=>row.id),[101,103]);
});

// These tests preserve deliberate reproductions. Passing does not mean secure access.
test('platform deliberate CWE-639 baseline: red reads blue by changing the record key',async t=>{
  const {call}=await start(t);
  const list=await call('/api/support/records?operator=pilot-red');
  assert.ok(!list.json().records.some(row=>row.id===102));
  const read=await call('/api/support/records/102?operator=pilot-red');
  assert.equal(read.status,200);
  assert.equal(read.json().source,'MOCK');
  assert.equal(read.json().record.team,'blue');
});

test('platform deliberate CWE-862 baseline: red creates a record in blue workgroup',async t=>{
  const {call}=await start(t);
  const created=await call('/api/support/records',{method:'POST',body:{
    operator:'pilot-red',workgroup:'blue',note:'Synthetic cross-team record'
  }});
  assert.equal(created.status,201);
  assert.equal(created.json().record.team,'blue');
  const blue=await call('/api/support/records?operator=pilot-blue');
  assert.deepEqual(blue.json().records.map(row=>row.id),[102,103]);
  const red=await call('/api/support/records?operator=pilot-red');
  assert.deepEqual(red.json().records.map(row=>row.id),[101]);
});

test('platform Lodash summary counts the selected operator visible shared records',async t=>{
  const {call}=await start(t);
  await call('/api/support/records',{method:'POST',body:{
    operator:'pilot-red',workgroup:'blue',note:'Synthetic shared row'
  }});
  const blue=await call('/api/support/summary?operator=pilot-blue');
  assert.deepEqual(blue.json(),{source:'MOCK',groups:[{team:'blue',count:2}]});
  const red=await call('/api/support/summary?operator=pilot-red');
  assert.deepEqual(red.json(),{source:'MOCK',groups:[{team:'red',count:1}]});
  const green=await call('/api/support/summary?operator=pilot-green');
  assert.deepEqual(green.json(),{source:'MOCK',groups:[]});
});

test('platform malformed and oversized requests return bounded errors without mutating records',async t=>{
  const {call}=await start(t);
  const invalid=[
    {raw:'{'},{raw:'null'},{raw:'[]'},{raw:'"string"'},
    {body:{operator:['pilot-red'],workgroup:'red',note:'Synthetic'}},
    {body:{operator:'pilot-red',workgroup:{team:'red'},note:'Synthetic'}},
    {body:{operator:'pilot-red',workgroup:'red',note:{text:'Synthetic'}}},
    {body:{operator:'pilot-red',workgroup:'red',note:'x'.repeat(161)}},
    {body:{operator:'unknown',workgroup:'red',note:'Synthetic'}},
    {body:{operator:'pilot-red',workgroup:'unknown',note:'Synthetic'}},
    {raw:'operator=pilot-red&workgroup=red&note=Synthetic',headers:{'Content-Type':'text/plain'}}
  ];
  for(const payload of invalid){
    const response=await call('/api/support/records',{method:'POST',...payload});
    assert.equal(response.status,400);
    assert.deepEqual(Object.keys(response.json()),['error']);
    assert.ok(response.json().error.length<=180);
    assert.ok(!response.text.includes('SyntaxError'));
  }
  const oversized=await call('/api/support/records',{method:'POST',body:{
    operator:'pilot-red',workgroup:'red',note:'x'.repeat(MAX_BODY_BYTES)
  }});
  assert.equal(oversized.status,413);
  assert.deepEqual(oversized.json(),{error:'Request body exceeds 4096 bytes'});
  const good=await call('/api/support/records',{method:'POST',body:{
    operator:'pilot-red',workgroup:'red',note:'Synthetic surviving request'
  }});
  assert.equal(good.status,201);
  assert.equal(good.json().record.id,103);
  const list=await call('/api/support/records?operator=pilot-red');
  assert.deepEqual(list.json().records.map(row=>row.id),[101,103]);
});

test('platform simple query parsing avoids nested input and rejects invalid operator shapes',async t=>{
  const {app,call}=await start(t);
  assert.equal(app.get('query parser'),'simple');
  for(const suffix of ['', '?operator=unknown', '?operator=pilot-red&operator=pilot-blue',
    '?operator%5Bteam%5D=pilot-red']){
    const response=await call('/api/support/records'+suffix);
    assert.equal(response.status,400);
    assert.ok(response.json().error.length<=180);
  }
  // Ordinary bracket keys stay literal under the simple parser. This is not
  // proof that the pinned qs dependency is patched.
  const result=await call('/api/support/records?operator=pilot-red&unused%5Bnested%5D=value');
  assert.equal(result.status,200);
  assert.deepEqual(result.json().records.map(row=>row.id),[101]);
  const missing=await call('/api/support/records/999?operator=pilot-red');
  assert.equal(missing.status,400);
});

test('platform app instances have independent disposable stores',async t=>{
  const first=await start(t),second=await start(t);
  await first.call('/api/support/records',{method:'POST',body:{
    operator:'pilot-red',workgroup:'red',note:'Only in first app'
  }});
  const firstRows=await first.call('/api/support/records?operator=pilot-red');
  const secondRows=await second.call('/api/support/records?operator=pilot-red');
  assert.equal(firstRows.json().records.length,2);
  assert.deepEqual(secondRows.json().records.map(row=>row.id),[101]);
});

test('platform and actual browser adapter agree on ordinary and deliberately flawed MOCK operations',async t=>{
  const {server}=await start(t);
  const origin='http://127.0.0.1:'+server.address().port;
  const book=new ServerRecords((path,options)=>fetch(origin+path,options));
  assert.deepEqual((await book.list('pilot-red')).map(row=>row.id),[101]);
  assert.equal((await book.read('pilot-red',102)).team,'blue');
  const created=await book.add('pilot-red','blue','Synthetic adapter integration');
  assert.equal(created.id,103);
  assert.equal(created.team,'blue');
  assert.deepEqual(await book.summary('pilot-blue'),[{team:'blue',count:2}]);
  await assert.rejects(book.list('unknown'),/Unknown operator/);
});

test('platform full shared store preserves records and gives a server-specific reset instruction',async t=>{
  const {call}=await start(t);
  for(let index=2;index<MAX_RECORDS;index++){
    const response=await call('/api/support/records',{method:'POST',body:{
      operator:'pilot-red',workgroup:'red',note:'Synthetic capacity row '+index
    }});
    assert.equal(response.status,201);
  }
  const before=await call('/api/support/records?operator=pilot-red');
  assert.equal(before.json().records.length,MAX_RECORDS-1);
  const overflow=await call('/api/support/records',{method:'POST',body:{
    operator:'pilot-red',workgroup:'blue',note:'Cannot exceed session budget'
  }});
  assert.equal(overflow.status,400);
  assert.match(overflow.json().error,/restart the local server to reset/);
  const after=await call('/api/support/records?operator=pilot-red');
  assert.deepEqual(after.json(),before.json());
  const blue=await call('/api/support/records/102?operator=pilot-red');
  assert.equal(blue.json().record.team,'blue','deliberate cross-team read remains available');
});

test('platform CLI port uses a strict loopback-server port range',()=>{
  assert.equal(parsePort(),8000);
  assert.equal(parsePort('8001'),8001);
  assert.equal(parsePort('65535'),65535);
  for(const value of ['', '0','-1','65536','8000.5','8e3','8000junk',' 8000',
    'Infinity','0x1f40',null,8000])assert.throws(()=>parsePort(value),/PORT must be an integer/);
});

test('platform CLI rejects invalid PORT before opening a server',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{
    encoding:'utf8',env:{...process.env,PORT:'invalid',HOST:'0.0.0.0'},timeout:3000
  });
  assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  assert.match(result.stderr,/PORT must be an integer from 1 to 65535/);
});
