import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('intentional dependency baseline pins upstream commits and archive integrity in the lockfile',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
  const expected={
    express:{version:'4.17.1',repository:'expressjs/express',commit:'e1b45ebd050b6f06aa38cda5aaf0c21708b0c71e'},
    lodash:{version:'4.17.15',repository:'lodash/lodash',commit:'f9cd8f552b7c8dc4aaa6be48eb9adf026ce4cd30'}
  };
  assert.deepEqual(Object.keys(manifest.dependencies).sort(),Object.keys(expected).sort());
  for(const [name,pin] of Object.entries(expected)){
    const source='https://codeload.github.com/'+pin.repository+'/tar.gz/'+pin.commit;
    assert.equal(manifest.dependencies[name],source);
    assert.equal(lock.packages[''].dependencies[name],source);
    assert.equal(lock.packages['node_modules/'+name].version,pin.version);
    assert.equal(lock.packages['node_modules/'+name].resolved,source);
    assert.match(lock.packages['node_modules/'+name].integrity,/^sha512-[A-Za-z0-9+/]+=*$/);
  }
});
