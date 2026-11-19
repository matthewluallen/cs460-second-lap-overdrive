import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraDirector,DriveNarrator,cameraCar,followFrame} from './camera-director.mjs';
const car=(extra={})=>({id:1,name:'Guardian',connected:true,located:true,color:[0,1,0],speed:300,laps:0,pose:{x:100,y:200,heading:0,index:0,located:true},...extra});
const track={pieces:[{kind:'straight',id:39},{kind:'curve',id:18},{kind:'finish',id:33}]};
test('camera selection respects a specific missing car rather than jumping to another',()=>{
 assert.equal(cameraCar([car()],2),null);assert.equal(cameraCar([car()],1).id,1);
 assert.equal(cameraCar([car({id:2,speed:0}),car()],0).id,1);
});
test('chase camera stays behind the direction of travel and driver view looks ahead in both directions',()=>{
 for(const h of [0,Math.PI/2,Math.PI,Math.PI*1.5])for(const mode of ['chase','driver']){
  const p={x:100,y:200,heading:h},shot=followFrame(mode,p),f=[Math.cos(h),-Math.sin(h)];
  const dot=(shot.position[0]-.1)*f[0]+(shot.position[2]+.2)*f[1];
  assert.equal(dot>0,mode==='driver');assert.ok(shot.target.every(Number.isFinite));assert.ok(shot.position[1]>0);
 }
 assert.equal(followFrame('chase',{x:NaN,y:0,heading:0}),null);
});
test('auto director changes at section boundaries with a minimum hold time',()=>{
 const d=new CameraDirector(),c=car();
 assert.equal(d.update({mode:'director',car:c,track,now:0}).view,'chase');
 c.pose.index=1;assert.equal(d.update({mode:'director',car:c,track,now:200}).view,'chase');
 assert.equal(d.update({mode:'director',car:c,track,now:5100}).view,'trackside');
 c.pose.index=2;assert.equal(d.update({mode:'director',car:c,track,now:5300}).view,'trackside');
 assert.equal(d.update({mode:'director',car:c,track,now:10200}).view,'driver');
});
test('all following views immediately fall back for stale, off-track or disconnected data and reduced motion',()=>{
 const d=new CameraDirector();
 for(const mode of ['chase','driver','trackside','director']){
  for(const extra of [{located:false},{connected:false},{safetyReason:'Off track'},{pose:null}]){
   const state=d.update({mode,car:car(extra),track,now:5000});assert.equal(state.view,'orbit');assert.equal(state.frame,null);
  }
  assert.equal(d.update({mode,car:car(),track,reducedMotion:true}).view,'orbit');
 }
});
test('narration distinguishes controller STOP, unknown location and reported lap evidence without repeating each frame',()=>{
 const n=new DriveNarrator(),c=car();
 assert.match(n.update({car:c,track,now:0}).text,/Displayed pace: 300/);
 assert.equal(n.update({car:c,track,now:100}),null);
 assert.match(n.update({car:{...c,located:false},track,now:200}).text,/waiting for a fresh/);
 assert.match(n.update({car:c,track,now:300,halted:true}).text,/STOP requested/);
 c.laps=1;assert.match(n.update({car:c,track,now:350}).text,/reported 1 complete lap/);
});
