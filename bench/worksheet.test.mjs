import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Records} from './records.mjs';

test('MOCK standalone worksheet runs all forms without car controls and renders notes as text',async()=>{
  const html=await readFile(new URL('./worksheet.html',import.meta.url),'utf8');
  const script=(await readFile(new URL('./worksheet.mjs',import.meta.url),'utf8'))
    .replace("import {Records} from './records.mjs';\n",'');
  assert.doesNotMatch(html,/data-op=|src="ui.mjs"|id="live"/);
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,{
    value:'',textContent:'',children:[],
    append(option){this.children.push(option);if(this.children.length===1)this.value=option.value;},
    set innerHTML(_){throw Error('Notes must remain literal text');}
  }]));
  const context={Records,document:{getElementById:id=>elements.get(id)??null},
    Option:class {constructor(text,value){this.text=text;this.value=value;}}};
  for(const name of ['navigator','fetch','CarLink'])Object.defineProperty(context,name,{
    get(){throw Error('Worksheet accessed forbidden '+name);}
  });
  vm.runInNewContext(script,context,{filename:'bench/worksheet.mjs'});
  const el=id=>elements.get(id);
  el('list').onclick();assert.deepEqual(JSON.parse(el('out').textContent).map(x=>x.id),[101]);
  el('rid').value='102';el('read').onclick();assert.equal(JSON.parse(el('out').textContent).team,'blue');
  const hostile='<img src=x onerror=alert(1)>';
  el('group').value='blue';el('entry').value=hostile;el('add').onclick();
  assert.equal(JSON.parse(el('out').textContent).note,hostile);
  assert.equal(JSON.parse(el('out').textContent).team,'blue');
  el('entry').value='';el('add').onclick();assert.match(el('out').textContent,/1–160 characters/);
});
