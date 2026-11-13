import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {checkOrigin,preflight} from './tools/preflight.mjs';

async function endpoint(t,handle){
  const server=createServer(handle);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  return `http://127.0.0.1:${server.address().port}`;
}
function live(req,res){
  if(req.url==='/slipstream/ready'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({service:'slipstream',mode:'live',bootId:'test-boot'}));
  }else if(req.url==='/slipstream/'){
    res.setHeader('Content-Type','text/html');res.end('<html>Slipstream</html>');
  }else{res.statusCode=404;res.end();}
}
test('preflight checks anonymous live access without creating rooms or sending credentials',async t=>{
  const requests=[];
  const origin=await endpoint(t,(req,res)=>{requests.push(req);live(req,res);});
  assert.deepEqual(await preflight(origin),{origin,bootId:'test-boot'});
  assert.deepEqual(requests.map(r=>r.url),['/slipstream/ready','/slipstream/','/api/health','/bench/','/instructor-drive/']);
  assert.ok(requests.every(r=>r.method==='GET'&&!r.headers.authorization&&!r.headers.cookie));
});
test('private-port redirect fails clearly and is never followed',async t=>{
  let followed=0;
  const destination=await endpoint(t,(req,res)=>{followed++;res.end('sign in');});
  const origin=await endpoint(t,(req,res)=>{res.writeHead(302,{Location:destination});res.end();});
  await assert.rejects(preflight(origin),/visibility before sharing QR/);
  assert.equal(followed,0);
});
for(const [name,body] of [
  ['teaching server',JSON.stringify({service:'slipstream',mode:'teaching',bootId:'x'})],
  ['login page','<html>Please sign in</html>'],
  ['incomplete readiness',JSON.stringify({service:'slipstream',mode:'live'})]
])test(`preflight refuses ${name}`,async t=>{
  const origin=await endpoint(t,(req,res)=>res.end(body));
  await assert.rejects(preflight(origin),/readiness was not confirmed/);
});
test('preflight refuses missing controller assets',async t=>{
  const origin=await endpoint(t,(req,res)=>{
    if(req.url==='/slipstream/'){res.statusCode=503;res.end();}else live(req,res);
  });
  await assert.rejects(preflight(origin),/controller page is unavailable/);
});
test('preflight refuses exposed teaching routes despite live readiness',async t=>{
  const origin=await endpoint(t,(req,res)=>{
    if(req.url==='/bench/'){res.end('teaching bench');}else live(req,res);
  });
  await assert.rejects(preflight(origin),/Teaching-route isolation/);
});
test('check origin rejects credentials, paths and insecure remote schemes',()=>{
  for(const value of ['http://example.com','ftp://localhost','https://user:secret@example.com','https://example.com/slipstream/','https://example.com?key=secret','https://example.com#secret','not a URL'])assert.throws(()=>checkOrigin(value));
  for(const value of ['https://example.com','http://127.0.0.1:3000','http://localhost:3000','http://[::1]:3000'])assert.ok(checkOrigin(value));
});
