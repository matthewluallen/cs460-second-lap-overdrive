import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Records} from './records.mjs';

test('MOCK standalone worksheet runs all forms without car controls and renders notes as text',async()=>{
  const html=await readFile(new URL('./worksheet.html',import.meta.url),'utf8');
  const script=(await readFile(new URL('./worksheet.mjs',import.meta.url),'utf8'))
    .replace(/^import .* from '\.\/(?:records|server-records)\.mjs';\n/gm,'');
  assert.doesNotMatch(html,/data-op=|src="ui.mjs"|id="live"/);
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,{
    value:'',textContent:'',children:[],
    append(option){this.children.push(option);if(this.children.length===1)this.value=option.value;},
    set innerHTML(_){throw Error('Notes must remain literal text');}
  }]));
  const context={Records,ServerRecords:class {constructor(){throw Error('Local worksheet accessed server store');}},
    URLSearchParams,window:{location:{search:''}},document:{getElementById:id=>elements.get(id)??null},
    Option:class {constructor(text,value){this.text=text;this.value=value;}}};
  for(const name of ['navigator','fetch','CarLink'])Object.defineProperty(context,name,{
    get(){throw Error('Worksheet accessed forbidden '+name);}
  });
  vm.runInNewContext(script,context,{filename:'bench/worksheet.mjs'});
  const el=id=>elements.get(id);
  await el('list').onclick();assert.deepEqual(JSON.parse(el('out').textContent).map(x=>x.id),[101]);
  el('rid').value='102';await el('read').onclick();assert.equal(el('out').textContent,'No such record');
  el('rid').value='101';await el('read').onclick();assert.equal(JSON.parse(el('out').textContent).team,'red');
  const hostile='<img src=x onerror=alert(1)>';
  el('group').value='blue';el('entry').value=hostile;await el('add').onclick();
  assert.match(el('out').textContent,/only for their own workgroup/);
  el('group').value='red';await el('add').onclick();
  assert.equal(JSON.parse(el('out').textContent).note,hostile);
  assert.equal(JSON.parse(el('out').textContent).team,'red');
  el('entry').value='';await el('add').onclick();assert.match(el('out').textContent,/1–160 characters/);
});

test('MOCK shared worksheet selects the explicit server store and keeps failed requests visible',async()=>{
  const html=await readFile(new URL('./worksheet.html',import.meta.url),'utf8');
  const script=(await readFile(new URL('./worksheet.mjs',import.meta.url),'utf8'))
    .replace(/^import .* from '\.\/(?:records|server-records)\.mjs';\n/gm,'');
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,{
    value:'',textContent:'',children:[],
    append(option){this.children.push(option);if(this.children.length===1)this.value=option.value;}
  }]));
  const calls=[];
  const context={Records:class {constructor(){throw Error('Unexpected local fallback');}},
    ServerRecords:class {
      async list(operator){calls.push(['list',operator]);return [{id:101,team:'red'}];}
      async summary(operator){calls.push(['summary',operator]);return [{team:'red',count:1}];}
      async read(operator,id){calls.push(['read',operator,id]);return {id:102,team:'blue'};}
      async add(...args){calls.push(['add',...args]);throw Object.assign(Error('timeout'),{name:'AbortError'});}
    },URLSearchParams,window:{location:{search:'?store=server'}},
    document:{getElementById:id=>elements.get(id)??null},Option:class {constructor(text,value){this.text=text;this.value=value;}}};
  vm.runInNewContext(script,context,{filename:'bench/worksheet.mjs'});
  const el=id=>elements.get(id);
  assert.match(el('storageMode').textContent,/Shared MOCK.*Restart the server/);
  assert.equal(el('summary').hidden,false);assert.equal(calls.length,0);
  await el('list').onclick();assert.equal(JSON.parse(el('out').textContent)[0].id,101);
  await el('summary').onclick();assert.equal(JSON.parse(el('out').textContent)[0].count,1);
  el('rid').value='102';await el('read').onclick();assert.equal(JSON.parse(el('out').textContent).team,'blue');
  el('entry').value='Synthetic note';await el('add').onclick();
  assert.deepEqual(calls,[['list','pilot-red'],['summary','pilot-red'],['read','pilot-red','102'],['add','pilot-red','red','Synthetic note']]);
  assert.match(el('out').textContent,/outcome unknown.*before retrying/);
  for(const id of ['list','read','add','summary'])assert.equal(el(id).disabled,false);
});
