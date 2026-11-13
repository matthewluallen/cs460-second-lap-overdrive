import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {Renderer, trustedCarPose} from './render.mjs';
import {Pieces, Track, Localizer, pointOn, layout, traversal} from './track.mjs';
import {buildTrack, LAYOUTS} from './sim.mjs';

const pieces=new Pieces(JSON.parse(readFileSync(new URL('./data/pieces.json',import.meta.url))));
const track=buildTrack(pieces,LAYOUTS.Capsule);
const car=()=>({id:1,name:'Groundshock',model:8,control:'bot',color:[0,1,0],energy:1,connected:true,
  located:true,pose:{x:200,y:100,heading:.3,located:true}});
const invalid=[
  row=>row.pose=null,
  row=>row.pose.located=false,
  row=>delete row.pose.located,
  row=>row.located=false,
  row=>row.connected=false,
  row=>row.safetyReason='Off track',
  row=>row.pose.x=NaN,
  row=>row.pose.y=Infinity,
  row=>row.pose.heading=undefined,
];
function canvas(){
  const calls=[],context=new Proxy({}, {get(target,key){
    if(key in target)return target[key];
    return target[key]=(...args)=>{calls.push([key,...args]);};
  }});
  return {calls,width:800,height:500,getContext:()=>context,getBoundingClientRect:()=>({width:800,height:500}),
    addEventListener(){},setPointerCapture(){}};
}

test('both map views require a finite trusted pose, not a retained point with uncertainty styling',()=>{
  const good=car();assert.equal(trustedCarPose(good),good.pose);
  for(const mutate of invalid){const row=car();mutate(row);assert.equal(trustedCarPose(row),null);}
});

test('2D removes the car body, name and car-targeted effects immediately when localization loses trust',t=>{
  const prior=globalThis.window;globalThis.window={devicePixelRatio:1,matchMedia:()=>({matches:false})};
  t.after(()=>{if(prior===undefined)delete globalThis.window;else globalThis.window=prior;});
  const surface=canvas(),renderer=new Renderer(surface);
  renderer.addEffect({type:'pulse',from:1,life:1000});
  renderer.draw({track,cars:[car()],mines:[],now:100});
  assert.equal(surface.calls.filter(c=>c[0]==='translate').length,1);
  assert.ok(surface.calls.some(c=>c[0]==='fillText'&&String(c[1]).includes('Groundshock')));
  assert.ok(surface.calls.some(c=>c[0]==='arc'),'trusted car anchors its pulse effect');
  for(const mutate of invalid){
    const row=car();mutate(row);surface.calls.length=0;
    renderer.draw({track,cars:[row],mines:[],now:140});
    assert.equal(surface.calls.some(c=>c[0]==='translate'),false,'no body at an untrusted point');
    assert.equal(surface.calls.some(c=>c[0]==='fillText'&&String(c[1]).includes('Groundshock')),false,'no location-anchored name');
    assert.equal(surface.calls.some(c=>c[0]==='arc'),false,'no effect can imply the hidden car location');
  }
});

test('3D hides an existing car mesh and its effects after stale, ambiguous or invalid pose data',()=>{
  // Run the actual renderer with real Three.js scene objects. Only the WebGL
  // drawing surface is replaced; this tests visibility, not GPU appearance.
  class WebGLSurface {
    constructor(){this.shadowMap={};}
    setPixelRatio(){}setClearColor(){}setSize(){}render(){}dispose(){}
    getContext(){return {isContextLost:()=>false};}
  }
  const context=vm.createContext({THREE:{...THREE,WebGLRenderer:WebGLSurface},pointOn,layout,trustedCarPose,
    devicePixelRatio:1,matchMedia:()=>({matches:false}),document:{createElement:()=>canvas()},performance:{now:()=>0}});
  const source=readFileSync(new URL('./render3d.mjs',import.meta.url),'utf8')
    .replace(/^import .*;$/gm,'').replace('export class Renderer3D','class Renderer3D');
  vm.runInContext(source+'\nglobalThis.Renderer3D=Renderer3D;',context);
  const renderer=new context.Renderer3D(canvas());
  renderer.addEffect({type:'pulse',from:1,life:1000});
  renderer.draw({track,cars:[car()],now:100});
  assert.equal(renderer.carMeshes.get(1).group.visible,true);assert.equal(renderer.effectRoot.children.length,1);
  let now=100;
  for(const mutate of invalid){
    const row=car();mutate(row);now+=40;renderer.draw({track,cars:[row],now});
    assert.equal(renderer.carMeshes.get(1).group.visible,false);
    assert.equal(renderer.effectRoot.children.length,0,'untrusted car does not anchor effects');
  }
  now+=40;renderer.draw({track,cars:[car()],now});
  assert.equal(renderer.carMeshes.get(1).group.visible,true,'a later trusted pose can display again');
  renderer.dispose();
});

test('real localizer output is undisplayable after off-road, stale evidence, or duplicate-road ambiguity',()=>{
  const position={type:'position',pieceId:36,locationId:30,reverse:false,speed:300};
  for(const event of ['off-road','stale']){
    const localizer=new Localizer(track,pieces);localizer.feed(position,100);
    assert.ok(trustedCarPose({...car(),pose:localizer.pose(100)}));
    if(event==='off-road')localizer.feed({type:'delocalized'},200);
    assert.equal(trustedCarPose({...car(),pose:localizer.pose(event==='stale'?2101:200)}),null,event);
  }
  const ambiguousTrack=new Track([traversal(pieces,36,false),traversal(pieces,39,false),traversal(pieces,36,false)]);
  const ambiguous=new Localizer(ambiguousTrack,pieces);ambiguous.feed(position,100);
  assert.equal(trustedCarPose({...car(),pose:ambiguous.pose(100)}),null,'first duplicate candidate is not a confirmed location');
  ambiguous.feed({type:'transition'},200);
  assert.equal(trustedCarPose({...car(),pose:ambiguous.pose(200)}),null,'transition alone cannot make a displayed location trustworthy');
});
