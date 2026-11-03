import test from 'node:test';
import assert from 'node:assert/strict';
import {CarLabels,CAR_LABELS_KEY} from './car-labels.mjs';

function storage(initial=null){
  let value=initial;
  return {
    writes:0,fail:false,readFail:false,
    getItem(key){assert.equal(key,CAR_LABELS_KEY);if(this.readFail)throw Error('SecurityError');return value;},
    setItem(key,next){assert.equal(key,CAR_LABELS_KEY);if(this.fail)throw Error('QuotaExceededError');value=next;this.writes++;},
    raw(){return value;}
  };
}
const selection=(id,name='Ice Charger')=>({browserId:id,name});
const saved=entries=>JSON.stringify({version:1,entries});
const entry=(id='browser-id',label='Kit 01')=>({...selection(id),label});

test('two identical advertised names retain distinct browser-ID assignments after reload',()=>{
  const disk=storage(),book=new CarLabels(disk);
  book.remember(selection('first'),'Student 01 — Ice Charger');
  book.remember(selection('second'),'Student 02 — Ice Charger');
  book.remember(selection('third','International MXT'),'Student 01 — MXT');
  assert.equal(book.find('Ice Charger'),null);
  const fresh=new CarLabels(disk);
  assert.equal(fresh.warning,'');
  assert.equal(fresh.find('first').label,'Student 01 — Ice Charger');
  assert.equal(fresh.find('second').label,'Student 02 — Ice Charger');
  assert.equal(fresh.find('third').name,'International MXT');
  assert.equal(fresh.entries().length,3);
});

test('same-ID replacement is explicit and other-ID label collisions are rejected ignoring case',()=>{
  const disk=storage(),book=new CarLabels(disk);
  book.remember(selection('one'),'  Kit A  ');
  assert.equal(book.find('one').label,'Kit A');
  const before=disk.raw();
  assert.throws(()=>book.remember(selection('two'),'kit a'),/already belongs/);
  assert.equal(disk.raw(),before);
  book.remember(selection('one','International MXT'),'KIT A');
  assert.equal(book.entries().length,1);
  assert.deepEqual(book.find('one'),{browserId:'one',name:'International MXT',label:'KIT A'});
  book.remember(selection('one'),'Kit B');
  book.remember(selection('two'),'Kit A');
  assert.equal(book.entries().length,2);
});

test('returned rows and caller-owned selections cannot mutate the registry',()=>{
  const book=new CarLabels(storage()),selected=selection('one');
  const returned=book.remember(selected,'Kit A');
  selected.browserId='changed';returned.label='Changed';
  const found=book.find('one');found.label='Changed';
  const rows=book.entries();rows[0].name='Changed';rows.push(entry('fake','Fake'));
  assert.deepEqual(book.find('one'),{browserId:'one',name:'Ice Charger',label:'Kit A'});
  assert.equal(book.find('changed'),null);
  assert.equal(book.find('fake'),null);
});

test('failed saves leave both replacement and forget atomic; successful retry clears warning',()=>{
  const disk=storage(),book=new CarLabels(disk);
  book.remember(selection('one'),'Kit A');
  const before=disk.raw(),rows=book.entries();disk.fail=true;
  assert.throws(()=>book.remember(selection('one'),'Kit B'),/could not be saved/);
  assert.deepEqual(book.entries(),rows);assert.equal(disk.raw(),before);
  assert.throws(()=>book.remember(selection('two'),'Kit B'),/could not be saved/);
  assert.deepEqual(book.entries(),rows);
  assert.throws(()=>book.forget('one'),/could not be saved/);
  assert.deepEqual(book.entries(),rows);assert.equal(disk.raw(),before);
  assert.match(book.warning,/No labels were changed/);
  disk.fail=false;
  assert.equal(book.forget('one'),true);assert.equal(book.warning,'');
  assert.deepEqual(new CarLabels(disk).entries(),[]);
  const writes=disk.writes;
  assert.equal(book.forget('one'),false);assert.equal(disk.writes,writes);
});

test('a stale tab cannot overwrite a car label saved by another tab',()=>{
  const disk=storage(),first=new CarLabels(disk),stale=new CarLabels(disk);
  first.remember(selection('ice-01'),'S01A');
  const current=disk.raw(),writes=disk.writes;
  assert.throws(()=>stale.remember(selection('mxt-01','International MXT'),'S01B'),
    /labels changed in another tab; disconnect and reload/);
  assert.match(stale.warning,/labels changed in another tab/);
  assert.deepEqual(stale.entries(),[]);
  assert.equal(disk.raw(),current);assert.equal(disk.writes,writes);
  const reloaded=new CarLabels(disk);
  reloaded.remember(selection('mxt-01','International MXT'),'S01B');
  reloaded.remember(selection('ice-02'),'S02A');
  reloaded.forget('ice-02');
  assert.deepEqual(new CarLabels(disk).entries().map(row=>row.label),['S01A','S01B']);
});

test('a stale forget preserves newer shared mappings and its own previous in-memory state',()=>{
  const disk=storage(),first=new CarLabels(disk);
  first.remember(selection('ice-01'),'S01A');
  const stale=new CarLabels(disk),oldRows=stale.entries();
  first.remember(selection('mxt-01','International MXT'),'S01B');
  const current=disk.raw(),writes=disk.writes;
  assert.throws(()=>stale.forget('ice-01'),/labels changed in another tab; disconnect and reload/);
  assert.deepEqual(stale.entries(),oldRows);
  assert.equal(disk.raw(),current);assert.equal(disk.writes,writes);
  const reloaded=new CarLabels(disk);
  assert.equal(reloaded.forget('ice-01'),true);
  assert.deepEqual(new CarLabels(disk).entries().map(row=>row.label),['S01B']);
});

test('invalid-data snapshots also detect a registry recovered by another tab',()=>{
  const disk=storage('{invalid'),first=new CarLabels(disk),stale=new CarLabels(disk);
  first.remember(selection('ice-01'),'S01A');
  const current=disk.raw();
  assert.throws(()=>stale.remember(selection('mxt-01'),'S01B'),/labels changed in another tab/);
  assert.deepEqual(stale.entries(),[]);assert.equal(disk.raw(),current);
});

test('denied backing reads never permit a blind write or forget',()=>{
  const disk=storage(),book=new CarLabels(disk);
  book.remember(selection('ice-01'),'S01A');
  const current=disk.raw(),rows=book.entries(),writes=disk.writes;
  disk.readFail=true;
  assert.throws(()=>book.remember(selection('mxt-01'),'S01B'),/storage could not be checked/);
  assert.throws(()=>book.forget('ice-01'),/storage could not be checked/);
  assert.deepEqual(book.entries(),rows);assert.equal(disk.raw(),current);assert.equal(disk.writes,writes);
  const unreadable=new CarLabels(disk);
  assert.match(unreadable.warning,/could not be read/);
  disk.readFail=false;
  assert.throws(()=>unreadable.remember(selection('mxt-01'),'S01B'),/Disconnect and reload/);
  assert.equal(disk.raw(),current);assert.deepEqual(unreadable.entries(),[]);
  book.remember(selection('mxt-01'),'S01B');
  assert.equal(book.warning,'');assert.equal(new CarLabels(disk).entries().length,2);
});

test('missing or blocked browser storage is a readable constructor warning, never a crash',()=>{
  const blocked={getItem(){throw Error('SecurityError');},setItem(){throw Error('SecurityError');}};
  const badGetter=Object.defineProperty({},'getItem',{get(){throw Error('Blocked property');}});
  for(const unavailable of [undefined,null,{},blocked,badGetter]){
    const book=new CarLabels(unavailable);
    assert.deepEqual(book.entries(),[]);assert.match(book.warning,/unavailable/);
    assert.throws(()=>book.remember(selection('one'),'Kit A'),/could not be saved/);
    assert.deepEqual(book.entries(),[]);
  }
});

test('invalid stored schemas, prototype-shaped properties and duplicate IDs/labels load no partial state',()=>{
  const invalid=[
    '{broken',null,[],{}, {version:2,entries:[]},{version:1,entries:{}},
    {version:1,entries:[],extra:true},
    {version:1,entries:[entry(),['browser-id','Ice Charger','Kit B']]},
    {version:1,entries:[entry(),{browserId:'other',name:'Ice Charger',label:'Kit B',extra:true}]},
    {version:1,entries:[entry(),entry('browser-id','Kit B')]},
    {version:1,entries:[entry(),entry('other','kIT 01')]},
    {version:1,entries:[{...entry(),label:' Kit 01 '}]},
    {version:1,entries:[{...entry(),name:[]}]},
    {version:1,entries:[{...entry(),browserId:'x'.repeat(257)}]},
    {version:1,entries:[{...entry(),label:'x'.repeat(81)}]},
    JSON.parse('{"version":1,"entries":[],"__proto__":{"polluted":true}}'),
    JSON.parse('{"version":1,"entries":[{"browserId":"one","name":"Ice Charger","label":"Kit A","__proto__":{"polluted":true}}]}')
  ];
  for(const value of invalid){
    const raw=value==='{broken'?value:JSON.stringify(value),disk=storage(raw);
    const book=new CarLabels(disk);
    assert.deepEqual(book.entries(),[]);assert.match(book.warning,/invalid|limits/);
    assert.equal(disk.raw(),raw);assert.equal(disk.writes,0);
  }
  assert.equal(Object.prototype.polluted,undefined);
});

test('invalid registry recovery requires an explicit successful save',()=>{
  const disk=storage('{invalid'),book=new CarLabels(disk);
  assert.match(book.warning,/Saving a label will replace/);
  disk.fail=true;
  assert.throws(()=>book.remember(selection('one'),'Kit A'),/could not be saved/);
  assert.equal(disk.raw(),'{invalid');assert.deepEqual(book.entries(),[]);
  disk.fail=false;book.remember(selection('one'),'Kit A');
  assert.equal(book.warning,'');assert.equal(new CarLabels(disk).find('one').label,'Kit A');
});

test('registry supports 30 classroom cars, caps at 32, and permits replacements at capacity',()=>{
  const disk=storage(),book=new CarLabels(disk);
  for(let i=0;i<32;i++)book.remember(selection('id-'+i,i%2?'Ice Charger':'International MXT'),'Kit '+i);
  const before=disk.raw();
  assert.throws(()=>book.remember(selection('id-32'),'Kit 32'),/full \(32 cars\)/);
  assert.equal(disk.raw(),before);assert.equal(book.entries().length,32);
  book.remember(selection('id-0'),'Renamed Kit');
  book.forget('id-1');book.remember(selection('id-32'),'Kit 32');
  assert.equal(book.entries().length,32);
  const oversized=storage(saved(Array.from({length:33},(_,i)=>entry('id-'+i,'Kit '+i))));
  assert.match(new CarLabels(oversized).warning,/limits/);
});

test('field bounds and control characters reject bad input without writing',()=>{
  const disk=storage(),book=new CarLabels(disk);
  for(const bad of ['',null,3,[],{},'x'.repeat(81),'Kit\nA','Kit\u0000A'])
    assert.throws(()=>book.remember(selection('one'),bad),/label/);
  for(const bad of ['',null,3,[],{},' '.repeat(3),'x'.repeat(257),'id\n1'])
    assert.throws(()=>book.remember(selection(bad),'Kit A'),/device ID/);
  for(const bad of [null,3,[],{},'x'.repeat(129),'name\u0000'])
    assert.throws(()=>book.remember(selection('one',bad),'Kit A'),/device name/);
  for(const bad of [null,[],{},Object.create(selection('inherited')),
    {...selection('one'),extra:true},Object.defineProperty({name:'Ice Charger'},'browserId',{enumerable:true,get(){throw Error('Getter executed');}})])
    assert.throws(()=>book.remember(bad,'Kit A'),/selected browser/);
  assert.equal(disk.writes,0);assert.deepEqual(book.entries(),[]);
  const row=book.remember(selection('i'.repeat(256),'n'.repeat(128)),' '+'l'.repeat(80)+' ');
  assert.equal(row.label.length,80);assert.equal(row.browserId.length,256);
  book.remember(selection('unnamed',''),'Unnamed kit');
  assert.equal(book.find('unnamed').name,'');
});

test('UTF-8 JSON is bounded on loading and saving, including multibyte names and IDs',()=>{
  for(const raw of [' '.repeat(32769),saved([{...entry(),name:'界'.repeat(12000)}])]){
    const book=new CarLabels(storage(raw));
    assert.match(book.warning,/limits/);assert.deepEqual(book.entries(),[]);
  }
  const disk=storage(),book=new CarLabels(disk);
  let rejected=false;
  for(let i=0;i<32;i++){
    const before=disk.raw(),rows=book.entries();
    try{book.remember(selection('界'.repeat(250)+i,'界'.repeat(128)),'界'.repeat(75)+i);}
    catch(error){
      assert.match(error.message,/32 KiB/);assert.deepEqual(book.entries(),rows);
      assert.equal(disk.raw(),before);rejected=true;break;
    }
  }
  assert.equal(rejected,true,'valid field sizes must still respect total UTF-8 budget');
});

test('opaque prototype-like IDs and markup-like labels remain literal data',()=>{
  const disk=storage(),book=new CarLabels(disk);
  const text='<img src=x onerror=example()> & "Kit"';
  book.remember(selection('__proto__'),text);
  book.remember(selection('constructor'),'Constructor kit');
  const fresh=new CarLabels(disk);
  assert.equal(fresh.find('__proto__').label,text);
  assert.equal(fresh.find('constructor').browserId,'constructor');
  assert.equal(Object.prototype.label,undefined);
});

test('registry import and operations never access browser radio, network or implicit storage',async()=>{
  const keys=['navigator','fetch','localStorage','document'];
  const originals=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  try{
    for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,get(){throw Error('Forbidden global '+key);}});
    const {CarLabels:Standalone}=await import('./car-labels.mjs?standalone');
    const book=new Standalone(storage());
    book.remember(selection('one'),'Kit A');assert.equal(book.find('one').label,'Kit A');
    book.entries();book.forget('one');
  }finally{
    for(const [key,descriptor] of originals){
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
    }
  }
});
