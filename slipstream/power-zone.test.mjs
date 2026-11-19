import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PowerZoneController,POWER_ZONE} from './power-zone.mjs';
import {Pieces,Localizer,trackFromPlan,trackValidation} from './track.mjs';
import {decode} from './protocol.mjs';
const load=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const pieces=new Pieces(load('./data/pieces.json'));
const plan=[[33,false],[18,false],[57,true],[39,false],[20,false],[17,false],[17,true],[23,false],[36,false],[18,false],[34,false]].map(([id,reverse])=>({id,reverse}));
function rig(mode='shield') {
  const track=trackFromPlan(pieces,plan),rules=new PowerZoneController({pieces,mode});
  const observation=(index,locationId,at,patch={})=>{
    const piece=track.pieces[index],message={type:'position',pieceId:piece.id,locationId,reverse:piece.reverse,speed:300};
    const localization={state:'confirmed',trusted:true,reference:{source:'printed-code',fresh:true,at,pieceId:piece.id,locationId,reverse:piece.reverse,index,direction:1}};
    return{carId:1,message,observedAt:at,now:at,localization,track,runId:1,lap:0,active:true,moving:true,...patch};
  };
  const pass=(patch={})=>[observation(2,23,100,patch),observation(2,21,1420,patch),observation(3,0,2100,patch)];
  return{track,rules,observation,pass};
}

test('Power Zone gets a truthful label without changing geometry or permitting special-piece calibration/scoring',()=>{
  const {track}=rig();const zone=pieces.get(57);
  assert.equal(zone.length,560);assert.equal(zone.powerZone,true);assert.equal(zone.label,'Power Zone');assert.equal(zone.unverified,true);assert.equal(zone.kind,'special');
  assert.equal(track.pieces[2].powerZone,true);assert.equal(trackValidation(track).special.length,1);
  for(const id of [53,54]){assert.equal(pieces.get(id).unverified,true);assert.equal(pieces.get(id).powerZone,undefined);}
});

test('custom Power Zone requires spanning observations and an ordinary exit, with explicit bounded effects',()=>{
  for(const mode of ['shield','boost','off']) {
    const {rules,pass}=rig(mode);const events=pass().map(x=>rules.observe(x));
    assert.equal(events[0],null);assert.equal(events[1],null);
    if(mode==='off'){assert.equal(events[2],null);continue;}
    assert.equal(events[2].type,mode);assert.equal(events[2].source,'slipstream-custom');assert.equal(events[2].scope,'any-lane');
    assert.equal(events[2].expiresAt-events[2].at,mode==='shield'?3000:1000);
    if(mode==='boost'){assert.equal(events[2].extraSpeed,75);assert.ok(events[2].remainingMm>=250);}
  }
});

test('actual accepted Groundshock optical sequence satisfies the chosen checkpoint when replayed as free-drive evidence',()=>{
  const trace=load('./fixtures/groundshock-sdk-repaired-scan.json');
  const track=trackFromPlan(pieces,plan),localizer=new Localizer(track,pieces),rules=new PowerZoneController({pieces,mode:'boost'}),effects=[];
  const scanAt=trace.markers.find(m=>m.kind==='scan-start').timeMs;
  for(const[at,car,dir,raw]of trace.events)if(at>=scanAt&&car===0&&dir==='rx') {
    for(const message of decode(Uint8Array.from(raw.split(' ').map(x=>parseInt(x,16))))) {
      localizer.feed(message,at);
      const context={carId:1,message,observedAt:at,now:at,localization:localizer.diagnostics(at),track,runId:1,lap:localizer.laps,active:true,moving:true};
      const effect=rules.observe(context);if(effect)effects.push(effect);
    }
  }
  assert.equal(effects.length,1);assert.equal(effects[0].pieceIndex,2);assert.equal(effects[0].exitIndex,3);assert.equal(effects[0].type,'boost');
  // Recorded run was a scan: this proves the rule is satisfiable by captured
  // optical observations, not that an effect ran or succeeded on hardware.
  const scanning=new PowerZoneController({pieces,mode:'boost'});
  assert.equal(scanning.observe({carId:1,active:false}),null);
});

test('stale, future, ambiguous, predicted, inferred and mismatched observations cannot earn an effect',()=>{
  for(const fault of ['stale','future','ambiguous','estimated','inferred','stamp','code','inactive','stopped','reverse','same-code']) {
    const{rules,pass}=rig();const observations=pass();
    const bad=observations[1];
    if(fault==='stale')bad.now+=2001;
    if(fault==='future')bad.now--;
    if(fault==='ambiguous')bad.localization.trusted=false;
    if(fault==='estimated')bad.localization.state='estimated';
    if(fault==='inferred')bad.track.pieces[2].inferred=true;
    if(fault==='stamp')bad.localization.reference.at--;
    if(fault==='code')bad.localization.reference.locationId=22;
    if(fault==='inactive')bad.active=false;
    if(fault==='stopped')bad.moving=false;
    if(fault==='reverse')bad.localization.reference.direction=-1;
    if(fault==='same-code'){bad.message.locationId=23;bad.localization.reference.locationId=23;}
    assert.equal(observations.map(x=>rules.observe(x)).filter(Boolean).length,0,fault);
  }
});

test('repeated optical codes and supercodes do not duplicate awards or manufacture a crossing',()=>{
  const{rules,pass,observation}=rig();const[first,last,exit]=pass();
  assert.equal(rules.observe(first),null);assert.equal(rules.observe(first),null);
  assert.equal(rules.observe({...last,message:{type:'zoneSupercode',code:0x75f9}}),null);
  assert.equal(rules.observe(exit),null);
  rules.reset();rules.observe(first);rules.observe(last);assert.ok(rules.observe(exit));assert.equal(rules.observe(exit),null);
  assert.equal(rules.observe(observation(2,23,4000)),null);assert.equal(rules.observe(observation(2,21,5320)),null);assert.equal(rules.observe(observation(3,0,6000)),null,'same optical lap cannot award twice');
  rules.observe(observation(2,23,7000,{lap:1}));rules.observe(observation(2,21,8320,{lap:1}));assert.ok(rules.observe(observation(3,0,9000,{lap:1})));
});

test('STOP, recovery, mode changes and a new drive discard a pending opportunity',()=>{
  for(const fault of ['hostStopped','delocalized','delocRecoveryEntered','status','mode','epoch']) {
    const{rules,pass}=rig();const[first,last,exit]=pass();rules.observe(first);rules.observe(last);
    if(fault==='mode'){rules.setMode('off');rules.setMode('shield');}
    else if(fault==='epoch')exit.runId++;
    else rules.observe({...last,message:{type:fault,onTrack:false}});
    assert.equal(rules.observe(exit),null,fault);
  }
  assert.throws(()=>new PowerZoneController({pieces,mode:'guess'}),/Unknown/);
});

test('boost never transfers through a curve, late exit or skipped section to a later straight',()=>{
  for(const fault of ['curve','late','skip','late-straight-code']) {
    const{rules,pass,observation}=rig('boost');const[first,last,exit]=pass();rules.observe(first);rules.observe(last);
    if(fault==='curve'){exit.track.pieces[3].id=18;exit.message.pieceId=18;exit.localization.reference.pieceId=18;}
    if(fault==='late'){exit.now=exit.observedAt=exit.localization.reference.at=last.now+2001;}
    if(fault==='skip'){exit.localization.reference.index=4;exit.track.pieces[4].id=39;}
    if(fault==='late-straight-code'){exit.message.locationId=2;exit.localization.reference.locationId=2;}
    assert.equal(rules.observe(exit),null,fault);
    assert.equal(rules.observe(observation(3,0,6000,{lap:1})),null,'no delayed boost');
  }
});

test('custom crossing supports the opposite direction without assuming native marked-lane semantics',()=>{
  const{rules,observation}=rig();const first=observation(2,21,100),last=observation(2,23,1420),exit=observation(1,0,2100);
  for(const item of [first,last,exit]){item.message.reverse=!item.message.reverse;item.localization.reference.reverse=item.message.reverse;item.localization.reference.direction=-1;}
  assert.equal(rules.observe(first),null);assert.equal(rules.observe(last),null);assert.equal(rules.observe(exit)?.type,'shield');
});

test('independent cars do not share checkpoint entry state or cooldown',()=>{
  const{rules,pass}=rig();const[first,last,exit]=pass();rules.observe(first);
  assert.equal(rules.observe({...last,carId:2}),null);assert.equal(rules.observe({...exit,carId:2}),null);
  rules.observe(last);assert.ok(rules.observe(exit));
  // A separate controller identity can complete the same observation sequence.
  rules.reset(2);const outputs=pass().map(x=>rules.observe({...x,carId:2}));assert.equal(outputs.filter(Boolean).length,1);
  assert.equal(POWER_ZONE.provenance.includes('original F&F attack is not implemented'),true);
});
