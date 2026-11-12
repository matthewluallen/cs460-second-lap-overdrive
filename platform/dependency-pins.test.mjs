import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('dependencies are exact registry releases with lockfile integrity and no removed packages',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(manifest.dependencies).sort(),['express','qrcode-generator','ws']);
  assert.match(manifest.dependencies.ws,/^\d+\.\d+\.\d+$/);
  assert.match(manifest.dependencies['qrcode-generator'],/^\d+\.\d+\.\d+$/);
  assert.equal(manifest.devDependencies,undefined);
  // Exact version: no ranges, tags, git URLs or tarball URLs.
  assert.match(manifest.dependencies.express,/^5\.\d+\.\d+$/);
  assert.equal(lock.packages[''].dependencies.express,manifest.dependencies.express);
  assert.equal(lock.packages['node_modules/express'].version,manifest.dependencies.express);
  const installed=Object.entries(lock.packages).filter(([path])=>path);
  assert.ok(installed.length>10);
  for(const [path,entry] of installed){
    assert.match(entry.resolved,/^https:\/\/registry\.npmjs\.org\//,path);
    assert.match(entry.integrity,/^sha512-[A-Za-z0-9+/]+=*$/,path);
    assert.notEqual(entry.hasInstallScript,true,path);
  }
  for(const removed of ['lodash'])assert.equal(lock.packages['node_modules/'+removed],undefined,removed);
});
