import test from 'node:test';
import assert from 'node:assert/strict';
import {Records,MAX_RECORDS} from './records.mjs';

// Regression tests for the repaired worksheet access rules; see SECURITY.md.
test('MOCK worksheet lists only the selected team and permits ordinary same-team use',()=>{
  const book=new Records();
  assert.deepEqual(book.list('pilot-red').map(row=>row.id),[101]);
  assert.deepEqual(book.list('pilot-blue').map(row=>row.id),[102]);
  assert.deepEqual(book.list('pilot-green'),[]);
  const added=book.add('pilot-red','red','  Synthetic baseline  ');
  assert.equal(added.note,'Synthetic baseline');
  assert.deepEqual(book.read('pilot-red',added.id),added);
});

test('MOCK CWE-639 regression: a record key never crosses the operator team boundary',()=>{
  const book=new Records();
  assert.ok(!book.list('pilot-red').some(row=>row.id===102));
  for(const id of [102,'102'])assert.throws(()=>book.read('pilot-red',id),/^Error: No such record$/);
  assert.equal(book.read('pilot-blue','102').team,'blue');
  // Another team's record and a missing record are indistinguishable.
  let other,missing;
  try{book.read('pilot-red',102);}catch(error){other=error.message;}
  try{book.read('pilot-red',999);}catch(error){missing=error.message;}
  assert.equal(other,missing);
});

test('MOCK CWE-862 regression: an operator cannot add a record for another workgroup',()=>{
  const book=new Records();
  const next=book.next;
  for(const group of ['blue','green','gold'])assert.throws(()=>book.add('pilot-red',group,'Synthetic cross-team entry'),/only for their own workgroup/);
  assert.equal(book.next,next);assert.equal(book.rows.size,2);
  assert.deepEqual(book.list('pilot-blue').map(row=>row.id),[102]);
});

test('MOCK record IDs are exact positive decimals without coercion',()=>{
  const book=new Records();
  for(const id of ['',' 101','101 ','1e2','0x65','101.0','0101',101.5,true,null,undefined,[101],{},'-101',0])
    assert.throws(()=>book.read('pilot-red',id),/No such record/);
  assert.equal(book.read('pilot-red','101').id,101);
  for(const note of [null,undefined,7,{},['x']])assert.throws(()=>book.add('pilot-red','red',note),/1–160 characters/);
});

test('MOCK worksheet rejects unknown operators, missing records and invalid form input',()=>{
  const book=new Records();
  for(const token of ['','unknown','pilot-purple',null]){
    assert.throws(()=>book.list(token),/Unknown operator/);
    assert.throws(()=>book.read(token,101),/Unknown operator/);
    assert.throws(()=>book.add(token,'red','Synthetic note'),/Unknown operator/);
  }
  for(const id of [999,'not-a-record',-1])assert.throws(()=>book.read('pilot-red',id),/No such record/);
  assert.throws(()=>book.add('pilot-red','purple','Synthetic note'),/Unknown workgroup/);
  for(const note of ['','   ','x'.repeat(161)])assert.throws(()=>book.add('pilot-red','red',note),/1–160 characters/);
  const valid=book.add('pilot-red','red','x'.repeat(160));
  assert.equal(valid.id,103,'rejected requests must not create rows or consume IDs');
  assert.equal(valid.note.length,160);
});

test('MOCK worksheet copies returned rows and resets disposable state with each instance',()=>{
  const book=new Records();
  const row=book.read('pilot-red',101);
  row.team='gold';row.note='External mutation';
  const listed=book.list('pilot-red');listed[0].note='External mutation';
  assert.equal(book.read('pilot-red',101).note,'Replay: bench A, baseline complete.');
  book.add('pilot-blue','blue','Synthetic test note');
  const fresh=new Records();
  assert.deepEqual(fresh.list('pilot-blue').map(row=>row.id),[102]);
});

test('MOCK worksheet import and exercised operations need no browser, Bluetooth or fetch API',async()=>{
  // Deliberately do not import CarLink or use a Bluetooth mock in this suite.
  // Traps make accidental browser/radio or fetch access fail this bounded test.
  const originals=new Map(['navigator','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  try{
    for(const key of originals.keys())Object.defineProperty(globalThis,key,{
      configurable:true,get(){throw new Error('Worksheet accessed forbidden '+key);}
    });
    const {Records:StandaloneRecords}=await import('./records.mjs?without-browser');
    const book=new StandaloneRecords();
    book.list('pilot-red');book.read('pilot-blue',102);
    book.add('pilot-blue','blue','Synthetic boundary check');
    assert.equal(book.list('pilot-blue').length,2);
  }finally{
    for(const [key,descriptor] of originals){
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  }
});


test('MOCK worksheet rejects additions at a bounded session size without losing existing evidence',()=>{
  const book=new Records();
  for(let i=2;i<MAX_RECORDS;i++)book.add('pilot-red','red','Synthetic row '+i);
  const next=book.next;
  const snapshot=book.list('pilot-red');
  assert.throws(()=>book.add('pilot-red','red','Cannot exceed budget'),/Worksheet session full/);
  assert.equal(book.next,next);assert.equal(book.rows.size,MAX_RECORDS);
  assert.deepEqual(book.list('pilot-red'),snapshot);
  assert.throws(()=>book.read('pilot-red',102),/No such record/);
  assert.equal(new Records().rows.size,2);
});
