import test from 'node:test';
import assert from 'node:assert/strict';
import {ServerRecords} from './server-records.mjs';

test('MOCK default adapter retains the browser fetch receiver',async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async function(){
      assert.equal(this,globalThis,'browser fetch must not be invoked with a ServerRecords receiver');
      return {ok:true,json:async()=>({source:'MOCK',records:[{id:101}]})};
    };
    assert.deepEqual(await new ServerRecords().list('pilot-red'),[{id:101}]);
  }finally{globalThis.fetch=original;}
});

test('MOCK platform adapter calls the shared records contract and encodes identifiers',async()=>{
  const calls=[];
  const book=new ServerRecords(async(path,options)=>{
    calls.push({path,options});
    return {ok:true,json:async()=>({source:'MOCK',records:[{id:101}],record:{id:103},groups:[{team:'red',count:1}]})};
  });
  assert.deepEqual(await book.list('pilot-red'),[{id:101}]);
  assert.deepEqual(await book.read('pilot-red&extra=1','102/?x'),{id:103});
  await book.add('pilot-red','blue','Synthetic note');
  assert.deepEqual(await book.summary('pilot-red'),[{team:'red',count:1}]);
  assert.deepEqual(calls.map(x=>x.path),[
    '/api/support/records?operator=pilot-red',
    '/api/support/records/102%2F%3Fx?operator=pilot-red%26extra%3D1',
    '/api/support/records','/api/support/summary?operator=pilot-red'
  ]);
  assert.deepEqual(JSON.parse(calls[2].options.body),{operator:'pilot-red',workgroup:'blue',note:'Synthetic note'});
  for(const {options} of calls){assert.equal(options.cache,'no-store');assert.ok(options.signal instanceof AbortSignal);}
});

test('MOCK platform adapter reports unavailable service instead of silently switching stores',async()=>{
  const absent=new ServerRecords(async()=>({ok:false,json:async()=>{throw Error('HTML 404');}}));
  await assert.rejects(absent.list('pilot-red'),/Start the Node platform server or choose tab records/);
  const rejected=new ServerRecords(async()=>({ok:false,json:async()=>({error:'Unknown operator'})}));
  await assert.rejects(rejected.list('unknown'),/Unknown operator/);
  const wrongSource=new ServerRecords(async()=>({ok:true,json:async()=>({source:'LIVE',records:[]})}));
  await assert.rejects(wrongSource.list('pilot-red'),/Unexpected records source/);
});

test('MOCK platform adapter never retries an addition with an unknown network outcome',async()=>{
  let calls=0;
  const book=new ServerRecords(async()=>{calls++;throw new DOMException('Aborted','AbortError');});
  await assert.rejects(book.add('pilot-red','red','Synthetic note'),{name:'AbortError'});
  assert.equal(calls,1);
});

test('MOCK platform adapter preserves unknown addition outcomes during response reads and network loss',async()=>{
  const abortedBody=new ServerRecords(async()=>({ok:true,json:async()=>{throw new DOMException('Body interrupted','AbortError');}}));
  await assert.rejects(abortedBody.add('pilot-red','red','Synthetic note'),{name:'AbortError'});
  let calls=0;
  const disconnected=new ServerRecords(async()=>{calls++;throw TypeError('Connection lost');});
  await assert.rejects(disconnected.add('pilot-red','red','Synthetic note'),/addition outcome unknown.*before retrying/);
  assert.equal(calls,1);
  const rejected=new ServerRecords(async()=>({ok:false,json:async()=>({error:'Unknown operator'})}));
  await assert.rejects(rejected.add('unknown','red','Synthetic note'),/^Error: Unknown operator$/);
});
