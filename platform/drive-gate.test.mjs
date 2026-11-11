import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {once} from 'node:events';
import {createApp,instructorDriveEnabled} from './server.mjs';

async function start(t,options){
  const server=createApp(options).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise((resolve,reject)=>{
    server.close(error=>error?reject(error):resolve());
    server.closeAllConnections();
  }));
  return (path,{method='GET',headers={},body=''}={})=>new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:server.address().port,path,method,headers},res=>{
      let text='';
      res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));
    });
    req.on('error',reject);
    req.setTimeout(2000,()=>req.destroy(new Error('Local gate request timed out')));
    req.end(body);
  });
}

test('instructor prototype is absent by default; browser-supplied flags cannot enable it',async t=>{
  const call=await start(t);
  for(const path of ['/instructor-drive','/instructor-drive/','/instructor-drive/index.html',
    '/instructor-drive/protocol.mjs','/instructor-drive/config.json',
    '/instructor-drive/config.json?instructorLiveDrive=true&CS460_INSTRUCTOR_LIVE_DRIVE=I_ACCEPT_UNTESTED_HARDWARE',
    '/INSTRUCTOR-DRIVE/config.json','/instructor-drive/%2e%2e/instructor-drive/index.html']){
    const response=await call(path,{headers:{
      Cookie:'instructorLiveDrive=true; CS460_INSTRUCTOR_LIVE_DRIVE=I_ACCEPT_UNTESTED_HARDWARE',
      'X-Instructor-Live-Drive':'true'
    }});
    assert.equal(response.status,404,path);
    assert.equal(response.headers['cache-control'],'no-store',path);
  }
  const post=await call('/instructor-drive/config.json',{method:'POST',
    headers:{'Content-Type':'application/json'},body:'{"instructorLiveDrive":true}'});
  assert.equal(post.status,404);
});

test('instructor environment acknowledgement must match exactly',()=>{
  assert.equal(instructorDriveEnabled('I_ACCEPT_UNTESTED_HARDWARE'),true);
  for(const value of [undefined,null,true,false,1,'1','true','TRUE','yes','',
    'i_accept_untested_hardware',' I_ACCEPT_UNTESTED_HARDWARE','I_ACCEPT_UNTESTED_HARDWARE ']){
    assert.equal(instructorDriveEnabled(value),false,String(value));
  }
});

test('programmatic server configuration rejects truthy strings and numbers',async t=>{
  for(const value of ['true','I_ACCEPT_UNTESTED_HARDWARE',1]){
    const call=await start(t,{instructorLiveDrive:value});
    assert.equal((await call('/instructor-drive/config.json')).status,404);
  }
});

test('only explicit opt-in exposes the page and local configuration without caching',async t=>{
  const call=await start(t,{instructorLiveDrive:true});
  const config=await call('/instructor-drive/config.json');
  assert.equal(config.status,200);
  assert.equal(config.headers['cache-control'],'no-store');
  assert.deepEqual(JSON.parse(config.text),{instructorLiveDrive:true});
  const page=await call('/instructor-drive/');
  assert.equal(page.status,200);
  assert.equal(page.headers['cache-control'],'no-store');
  assert.match(page.headers['content-type'],/text\/html/);
  assert.match(page.text,/<!doctype html>/i);
  for(const file of ['protocol.mjs','controller.mjs','transport.mjs','ui.mjs']){
    const module=await call('/instructor-drive/'+file);
    assert.equal(module.status,200,file);
    assert.equal(module.headers['cache-control'],'no-store',file);
    assert.match(module.headers['content-type'],/(?:application|text)\/javascript/,file);
  }
  for(const path of ['/api/drive','/api/stop','/instructor-drive/api/drive',
    '/instructor-drive/../platform/server.mjs','/instructor-drive/.git/config']){
    assert.equal((await call(path)).status,404,path);
  }
});

test('instructor gate preserves the stationary bench and synthetic worksheet in both modes',async t=>{
  for(const options of [undefined,{instructorLiveDrive:true}]){
    const call=await start(t,options);
    for(const path of ['/','/evidence.html','/worksheet.html','/protocol.mjs']){
      assert.equal((await call(path)).status,200,path);
    }
    const health=JSON.parse((await call('/api/health')).text);
    assert.equal(health.source,'MOCK');
    // Deliberate course CWE-639 remains isolated in disposable worksheet data.
    const record=JSON.parse((await call('/api/support/records/102?operator=pilot-red')).text);
    assert.equal(record.source,'MOCK');
    assert.equal(record.record.team,'blue');
  }
});
