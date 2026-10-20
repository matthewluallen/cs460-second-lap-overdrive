import test from 'node:test';
import assert from 'node:assert/strict';
import {Records} from './records.mjs';

// These are characterization tests for an intentionally flawed teaching fixture.
// Passing CWE tests preserves a reproduction; it does not mean access is secure.
test('MOCK worksheet lists only the selected team and permits ordinary same-team use',()=>{
  const book=new Records();
  assert.deepEqual(book.list('pilot-red').map(row=>row.id),[101]);
  assert.deepEqual(book.list('pilot-blue').map(row=>row.id),[102]);
  assert.deepEqual(book.list('pilot-green'),[]);
  const added=book.add('pilot-red','red','  Synthetic baseline  ');
  assert.equal(added.note,'Synthetic baseline');
  assert.deepEqual(book.read('pilot-red',added.id),added);
});

test('MOCK CWE-639 intentionally reproduced: changing a record key bypasses team filtering',()=>{
  const book=new Records();
  assert.ok(!book.list('pilot-red').some(row=>row.id===102));
  const exposed=book.read('pilot-red','102');
  assert.equal(exposed.team,'blue');
  assert.equal(exposed.note,'Replay: bench B, repeat observation requested.');
});

test('MOCK CWE-862 intentionally reproduced: a valid red operator can add a blue record',()=>{
  const book=new Records();
  const added=book.add('pilot-red','blue','Synthetic cross-team entry');
  assert.equal(added.team,'blue');
  assert.ok(book.list('pilot-blue').some(row=>row.id===added.id));
  assert.ok(!book.list('pilot-red').some(row=>row.id===added.id));
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
  book.add('pilot-red','blue','Synthetic test note');
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
    book.list('pilot-red');book.read('pilot-red',102);
    book.add('pilot-red','blue','Synthetic boundary check');
    assert.equal(book.list('pilot-blue').length,2);
  }finally{
    for(const [key,descriptor] of originals){
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  }
});
