import test from 'node:test';
import assert from 'node:assert/strict';
import {trackValidation} from './track.mjs';
test('closed geometry cannot imply physical validation, and repeated IDs retain instance counts',()=>{
 const r=trackValidation({closed:true,gap:0,pieces:[{id:34,kind:'start'},{id:18,kind:'curve'},{id:18,kind:'curve'}]});
 assert.equal(r.physicalValidation,false);assert.deepEqual(r.issues,[]);assert.deepEqual(r.repeatedPieceIds,[{id:18,count:2}]);
});
test('track report distinguishes missing anchor, inferred and special geometry and traversal gaps',()=>{
 const r=trackValidation({closed:false,gap:100,pieces:[{id:57,kind:'straight'},{id:99,kind:'straight',inferred:true},{id:10,kind:'intersection'},{id:43,kind:'jump',reverse:true}]});
 assert.deepEqual(r.issues,['geometry-not-closed','missing-start','inferred-sections','unverified-special-sections','intersection-traversal-unverified','jump-direction-unverified']);
 assert.equal(r.special[0].index,0);assert.equal(r.inferred[0].index,1);assert.equal(r.jumps[0].reverse,true);
});
test('multiple starts and no map are distinct outcomes; report does not mutate geometry',()=>{
 const track={closed:true,gap:0,pieces:[{id:34,kind:'start'},{id:34,kind:'start'}]},before=JSON.stringify(track);
 assert.deepEqual(trackValidation(track).issues,['multiple-starts']);assert.equal(JSON.stringify(track),before);
 assert.deepEqual(trackValidation(null).issues,['no-map']);
});
