import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STUDENT_LAB, mountStudentLab} from './student-lab.mjs';

// Catch a stale teaching inventory when dependencies are upgraded or added.
test('student software inventory exactly matches declared runtime dependencies', () => {
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
  assert.deepEqual(Object.fromEntries(STUDENT_LAB.software.dependencies.map(({name,version})=>[name,version])), manifest.dependencies);
  assert.match(STUDENT_LAB.software.limitation,/not a complete SBOM/);
});

test('student hardware and radio notes distinguish capabilities from unverified identity', () => {
  assert.ok(STUDENT_LAB.inside.inventory.every(row=>/unverified/.test(row.limit)));
  assert.match(STUDENT_LAB.inside.limitation,/not a complete hardware bill/);
  assert.match(STUDENT_LAB.radio.introduction,/transcribe its FCC ID and model number from the label/);
  assert.match(STUDENT_LAB.radio.limitation,/No model-to-FCC-ID mapping/);
  assert.match(STUDENT_LAB.radio.limitation,/firmware number does not establish/);
  for (const section of Object.values(STUDENT_LAB)) for (const link of section.links) {
    assert.equal(new URL(link.url).protocol,'https:');
  }
});

// A minimal DOM verifies the optional mount without a browser, Bluetooth,
// storage, or control callbacks. Content must remain text, not parsed markup.
function documentStub() {
  const document={createElement(tagName){return {
    tagName, ownerDocument:document,children:[],textContent:'',
    set innerHTML(_value){throw new Error('Student content must be rendered as text');},
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;}
  };}};
  return document;
}
const flatten=node=>[node,...node.children.flatMap(flatten)];

test('student panel stays optional and collapsed, with accessible inventory and safe source links', () => {
  assert.equal(mountStudentLab(null),false);
  const doc=documentStub(),container=doc.createElement('section');
  assert.equal(mountStudentLab(container),true);
  assert.equal(container.children.length,6);
  const details=container.children.filter(node=>node.tagName==='details');
  assert.equal(details.length,4);
  assert.ok(details.every(node=>!node.open));
  assert.deepEqual(details.map(node=>node.children[0].textContent),['Inside your car · HBOM','Software supply chain · SBOM','Radio identity · FCC ID','Security challenge']);
  const nodes=flatten(container);
  assert.equal(nodes.filter(node=>node.tagName==='caption').length,1);
  assert.ok(nodes.filter(node=>node.tagName==='th').every(node=>node.scope==='col'));
  assert.ok(nodes.filter(node=>node.tagName==='a').every(node=>node.target==='_blank' && node.rel==='noopener noreferrer'));
  assert.equal(nodes.filter(node=>['button','input','form'].includes(node.tagName)).length,0,'lesson must not add car controls or collect identifiers');
  mountStudentLab(container);
  assert.equal(container.children.length,6,'remounting replaces, rather than duplicates, the lesson');
});
