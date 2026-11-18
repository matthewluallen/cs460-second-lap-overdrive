import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Pieces, Track, TrackMapper, Localizer, traversal, trackFromPlan, POSITION_MAX_AGE_MS} from './track.mjs';
import {Battle} from './battle.mjs';
import {LAYOUTS, buildTrack} from './sim.mjs';
const table = JSON.parse(readFileSync(new URL('./data/pieces.json', import.meta.url)));
const pieces = new Pieces(table);
const car = () => ({name: 'Identical', connected: true, model: 8, color: [0,1,0], setLights() {}, nudge() {}});
const energy = {max_energy: 100, recover_time_s: 2, min_energy_to_start_item: 1, energy_recharge_rate: 0};
function arena(weapons = {}) { return new Battle({weapons, vehicles: {energy}, track: buildTrack(pieces, LAYOUTS.Capsule), clock: () => 1000}); }

test('exhaustive 1–4 car identity/crew/participation/connection association matrix', () => {
  let states = 0;
  const weapon = {targeter: {type: 'proximity', radius: 2}};
  for (let n = 1; n <= 4; n++) {
    const b = arena(), fs = Array.from({length:n}, () => b.add(car(), {}));
    const spots = new Map(fs.map((f,i) => [f, {distance: i*100, lateral: 0, direction: 1}]));
    for (let state = 0; state < 12 ** n; state++) {
      let digits = state;
      for (const f of fs) { const v = digits % 12; digits = Math.floor(digits / 12); f.crew = ['', 'sun', 'moon'][v % 3]; f.participating = !!(Math.floor(v / 3) % 2); f.car.connected = v >= 6; }
      for (const f of fs) {
        const got = b.targets(f, weapon, spots).map(h => h.fighter);
        const expected = fs.filter(t => t !== f && f.participating && f.car.connected && t.participating && t.car.connected && !(f.crew && f.crew === t.crew));
        assert.equal(got.length, expected.length);
        for (const t of expected) assert.ok(got.includes(t));
      }
      states++;
    }
  }
  assert.equal(states, 22620);
});

test('all catalogue location codes obey forward/reverse geometry and reject unknown codes', () => {
  for (const [id,p] of Object.entries(table)) for (const key of Object.keys(p.locs)) {
    const a=pieces.locate(+id,+key,false), b=pieces.locate(+id,+key,true);
    assert.equal(a.progress+b.progress,1); assert.equal(a.lateral, -b.lateral);
    assert.ok(a.progress>=0 && a.progress<=1);
  }
  for (const name of Object.keys(LAYOUTS)) {
    const t = buildTrack(pieces, LAYOUTS[name]), copy=trackFromPlan(pieces,t.toJSON());
    assert.equal(copy.closed,true); assert.equal(copy.length,t.length); assert.deepEqual(copy.toJSON(),t.toJSON());
    for (let i=0;i<t.count;i++) for (const p of [0,.25,.5,.75,1]) for (const lane of [-68,0,68]) {
      const a=t.pose(i,p,lane,1), b=t.pose(i,1-p,-lane,-1);
      assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-8);
    }
  }
  assert.throws(()=>trackFromPlan(pieces,[{id:255,reverse:false}]));
  assert.throws(()=>trackFromPlan(pieces,[{id:-1,kind:'straight',length:NaN,reverse:false}]));
  assert.throws(()=>trackFromPlan(pieces,Array(65).fill({id:36,reverse:false})));
});

test('stale and invalid location evidence cannot authorize an attack position', () => {
  const t=buildTrack(pieces,LAYOUTS.Capsule), l=new Localizer(t,pieces);
  l.seed(0,1,1000); l.speed=400;
  assert.equal(l.estimate(1000+POSITION_MAX_AGE_MS).located,true);
  assert.equal(l.estimate(1001+POSITION_MAX_AGE_MS).located,false);
  l.feed({type:'position',pieceId:34,locationId:255,speed:400,reverse:false},1100);
  assert.equal(l.located,false);
  l.feed({type:'delocalized'},1200); assert.equal(l.estimate(1200)?.located,false);
});

test('startless scans retain two laps through the maximum supported 64 sections', () => {
  for (const n of [4,32,33,64]) {
    // Four left turns, straight runs balanced on opposite sides. For odd n,
    // split one 560 mm straight into two distinct synthetic 280 mm sections.
    const synthetic = new Pieces({...table, 100:{kind:'straight',length:280,locs:{}},101:{kind:'straight',length:280,locs:{}}});
    let ids = n===4 ? [17,18,20,23] : [17,...Array((n-4-(n%2))/2).fill(36),18,20,...Array((n-4-(n%2))/2).fill(39),23];
    if(n%2) ids.splice(ids.indexOf(36),1,100,101);
    const seq=ids.map(id=>traversal(synthetic,id,false));
    assert.equal(seq.length,n); assert.ok(new Track(seq).closed);
    const m=new TrackMapper(synthetic);
    for(let lap=0;lap<2;lap++) for(const p of seq) { m.feed({type:'position',pieceId:p.id,reverse:false}); m.feed({type:'transition',leftCm:56,rightCm:56}); }
    assert.ok(m.done, 'length '+n); assert.equal(m.track.count,n);
  }
});

test('shield protection is independent of car connection order', () => {
  const weapons={gun:{type:'continuous_shooting_vehicle_item',energy_use_per_s:0,damage_per_target_per_s:20,targeter:{type:'proximity',radius:1}}, shield:{type:'shield',energy_use_per_s:1,shield_blocked_damage_percent:1}};
  for(const reverse of [false,true]) {
    const b=arena(weapons), a=car(), d=car();
    a.localizer=d.localizer={estimate:()=>({located:true,index:0,progress:.5,direction:1,lateral:0})};
    for(const c of reverse?[d,a]:[a,d]) b.add(c,c===a?{attack:['gun']}:{support:['shield']});
    b.start(); b.press(a,'attack',true); b.press(d,'support',true); b.update(.1,1000);
    assert.equal(b.get(d).energy,99.9); // only the shield's energy cost
  }
});

test('crew assists preserve source identity, survive a pit pause and exclude friendly fire', () => {
  const b=arena(), [a,h,t]=[car(),car(),car()].map(c=>b.add(c,{})); a.crew=h.crew='sun'; t.crew='moon'; b.start();
  b.damage(h,200,a,1000); assert.equal(h.energy,100);
  b.damage(t,40,h,1000); b.pause(1100); b.resume(11100);
  b.damage(t,100,a,11200); assert.equal(a.kills,1); assert.equal(h.assists,1); assert.equal(t.deaths,1);
  b.remove(h.car); assert.equal(b.get(h.car),undefined);
});
