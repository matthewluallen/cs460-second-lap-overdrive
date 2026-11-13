import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Battle} from './battle.mjs';
const data=n=>JSON.parse(readFileSync(new URL('./data/'+n+'.json',import.meta.url)));
const weapons=data('weapons'),vehicles=data('vehicles');
function hits(weapon,gap,side=0,direction=1,source=1000){
 const battle=new Battle({weapons,vehicles,track:{length:10000},clock:()=>0});
 const a=battle.add({connected:true,model:8}),b=battle.add({connected:true,model:8});
 const spots=new Map([[a,{distance:source,lateral:0,direction}],[b,{distance:(source+direction*gap*1000+10000)%10000,lateral:side*1000,direction}]]);
 return battle.targets(a,weapon,spots).length;
}
test('actual rear cone loadouts target behind and reject ahead in both travel directions',()=>{
 for(const id of ['ShredderShotgunL01','X52IceShredderShotgunL01'])for(const direction of [1,-1]){
  assert.equal(hits(weapons[id],-.2,0,direction),1,id);
  assert.equal(hits(weapons[id],.2,0,direction),0,id);
 }
});
test('signed cone range boundaries, lateral width and circuit wrap remain directional',()=>{
 for(const sign of [1,-1]){
  const weapon={targeter:{type:'cone',length:sign*.5,theta:.75}};
  assert.equal(hits(weapon,sign*.5),1);assert.equal(hits(weapon,sign*.501),0);
  assert.equal(hits(weapon,0),0);assert.equal(hits(weapon,-sign*.2),0);
  assert.equal(hits(weapon,sign*.2,.3),0);
  assert.equal(hits(weapon,sign*.2,0,1,sign<0?50:9950),1);
 }
});
