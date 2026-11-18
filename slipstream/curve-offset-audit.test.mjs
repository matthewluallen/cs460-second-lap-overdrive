import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Pieces} from './track.mjs';

const table = JSON.parse(readFileSync(new URL('./data/pieces.json', import.meta.url)));
const pieces = new Pieces(table);

test('curve extraction preserves lane radius instead of measuring the centroid chord', () => {
  // Entirely synthetic circular code points: no proprietary configuration file
  // is needed. The expected offset comes from the specified radius, independent
  // of the extractor's averaging algorithm.
  const radius = .28, rows = [];
  for (const [code, lateral] of [[0, .0315], [1, -.0315]]) {
    for (let bit = 0; bit < 7; bit++) {
      const angle = .2 + bit * .1, laneRadius = radius - lateral;
      rows.push([laneRadius * Math.sin(angle), radius - laneRadius * Math.cos(angle),
        angle, code, bit, code + 2, 0].join(' '));
    }
  }
  const definition = ['1','1','0','7','250','20','2','0','0','0','0','0','1',
    '2','0 0 -3.141592653589793','.28 .28 1.5707963267948966',...rows].join('\n');
  const script = `import json, pathlib, runpy, sys, tempfile
extract = runpy.run_path(sys.argv[1])["piece"]
with tempfile.TemporaryDirectory() as directory:
    path = pathlib.Path(directory) / "synthetic-curve.txt"
    path.write_text(sys.stdin.read())
    print(json.dumps(extract(path)[1]))
`;
  const result = spawnSync('python3', ['-I', '-c', script,
    fileURLToPath(new URL('./tools/extract_config.py', import.meta.url))],
    {input:definition, encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const extracted = JSON.parse(result.stdout);
  assert.equal(extracted.locs['0'][1], 31.5);
  assert.equal(extracted.locs['1'][1], -31.5);
  assert.equal(extracted.locs['0'][0], .318, 'longitudinal progress convention is unchanged');
  assert.equal(extracted.locs['1'][0], .318);
});

test('all 228 ordinary curve codes agree with independently read lane geometry in both directions', () => {
  // The source lane records use 9 mm spacing: lane2 is +67.5 mm and lane17
  // is -67.5 mm. Codes0..19 are paired on lanes2..11; codes20..37 occur
  // three per lane on lanes12..17. This is a separate numeric oracle from
  // averaging code-point coordinates; it does not claim physical validation.
  const ids = [17,18,20,23,24,27];
  let count = 0;
  for (const id of ids) {
    assert.equal(pieces.kind(id), 'curve');
    assert.equal(Object.keys(table[id].locs).length, 38);
    for (let code = 0; code < 38; code++) {
      const lane = code < 20 ? 2 + Math.floor(code / 2) : 12 + Math.floor((code - 20) / 3);
      const expected = 85.5 - 9 * lane;
      const forward = pieces.locate(id, code, false), reverse = pieces.locate(id, code, true);
      assert.equal(forward.lateral, expected, `piece${id}/code${code}/lane${lane}`);
      assert.equal(reverse.lateral, -expected, `reverse piece${id}/code${code}/lane${lane}`);
      assert.equal(forward.progress + reverse.progress, 1);
      count++;
    }
  }
  assert.equal(count, 228);
});
