import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runDependencyLab} from './dependency-lab.mjs';

const filename=fileURLToPath(new URL('./dependency-lab.mjs',import.meta.url));
const marker='cs460DependencyLabMarker';

test('DEPENDENCY BASELINE actual pinned libraries reproduce bounded cases without touching the parent prototype',()=>{
  const before=Object.getOwnPropertyDescriptor(Object.prototype,marker);
  const report=runDependencyLab();
  assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype,marker),before);
  assert.deepEqual(report.versions,{express:'4.17.1',lodash:'4.17.15'});
  assert.equal(report.source,'LOCAL DEPENDENCY EXPERIMENT');
  assert.equal(report.hardwareEvidence,false);assert.equal(report.networkAttempts,0);
  assert.deepEqual(report.processLimits,{timeoutMs:5000,maxOutputBytes:16384});
  assert.equal(report.lodash.prototypeBefore,false);
  assert.equal(report.lodash.prototypeDuring,true);
  assert.equal(report.lodash.freshObjectOwnMarker,false);
  assert.equal(report.lodash.inheritedValue,'fixture-only');
  assert.equal(report.lodash.prototypeAfter,false);assert.equal(report.lodash.reproduced,true);
  assert.equal(report.express.input,'http://trusted.example\\@other.example');
  assert.equal(report.express.location,'http://trusted.example%5C@other.example');
  assert.equal(report.express.inputHost,'trusted.example');
  assert.equal(report.express.locationHost,'other.example');assert.equal(report.express.reproduced,true);
  assert.match(report.limitation,/do not prove that ordinary platform endpoints expose/);
});

test('DEPENDENCY BASELINE repeated runs start clean and emit a bounded parseable CLI report',()=>{
  for(let i=0;i<2;i++){
    const child=spawnSync(process.execPath,[filename],{encoding:'utf8',timeout:7000,maxBuffer:20000});
    assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);
    assert.equal(child.stderr,'');assert.ok(Buffer.byteLength(child.stdout)<16384);
    const report=JSON.parse(child.stdout);
    assert.equal(report.lodash.prototypeBefore,false);assert.equal(report.lodash.prototypeAfter,false);
    assert.equal(report.lodash.reproduced,true);assert.equal(report.express.reproduced,true);
    assert.equal(report.networkAttempts,0);assert.equal(Object.hasOwn(Object.prototype,marker),false);
  }
});

test('DEPENDENCY BASELINE CLI rejects arbitrary experiment input',()=>{
  const child=spawnSync(process.execPath,[filename,'--input','untrusted'],{encoding:'utf8',timeout:7000,maxBuffer:20000});
  assert.equal(child.error,undefined);assert.equal(child.status,1);
  assert.equal(child.stdout,'');assert.match(child.stderr,/accepts no input or options/);
  assert.equal(Object.hasOwn(Object.prototype,marker),false);
});
