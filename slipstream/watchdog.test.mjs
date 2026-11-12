import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
const data=n=>JSON.parse(readFileSync(new URL('./data/'+n+'.json',import.meta.url)));
function rig(){let now=0;const sent=[];let notify;const radio={onNotify(fn){notify=fn;return()=>{};},async write(b){sent.push([...b]);},close(){}};
 const game=new Game({pieces:data('pieces'),vehicles:data('vehicles'),weapons:data('weapons'),clock:()=>now});const d=game.addCar(radio,{control:'browser'});
 const position=(piece=36)=>{const b=new Uint8Array(11);b[0]=10;b[1]=0x27;b[2]=0;b[3]=piece;new DataView(b.buffer).setUint16(8,200,true);notify(b);};
 return {game,d,sent,position,at(t){now=t;game.tick(.04,now);}};}
test('H2 moving car with silent telemetry latches a named shared pit',()=>{const r=rig();r.d.input.throttle=1;r.at(0);r.at(5001);assert.equal(r.game.halted,true);assert.match(r.game.pitReason,/telemetry/i);assert.equal(r.d.car.speed,0);r.d.input.throttle=1;r.at(5100);assert.equal(r.d.car.speed,0);});
test('H2 telemetry gap stops within the configured interval',()=>{const r=rig();r.d.input.throttle=1;r.at(0);r.at(500);r.position();r.at(2501);assert.equal(r.game.halted,true);});
test('H2 continued telemetry after STOP raises an alarm and resends STOP',async()=>{const r=rig();r.d.input.throttle=1;r.at(0);await r.d.car.pumpPromise;r.game.stopAll();await r.d.car.pumpPromise;const before=r.sent.length;r.at(1100);r.position();r.at(1140);await r.d.car.pumpPromise;assert.match(r.game.pitReason,/stop.*confirmed/i);assert.ok(r.sent.length>before);});
test('H2 scan cannot run past its wall-clock budget',()=>{const r=rig();r.game.startScan();for(let t=0;t<=46000;t+=500){r.at(t);r.position();}assert.equal(r.game.halted,true);assert.notEqual(r.game.phase,'scanning');assert.match(r.game.pitReason,/scan.*budget/i);});

test('H2 scan lap budget stops repeated anchor passes without closure',()=>{const r=rig();r.game.startScan();r.position(36);for(let i=0;i<3;i++){r.position(39);r.position(36);}assert.equal(r.game.halted,true);assert.match(r.game.pitReason,/lap budget/);});
