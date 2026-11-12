import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createApp, SECURITY_HEADERS, serverBindAddress} from './server.mjs';
import {LIMITS, SOCKET_PATH, newHostCode} from './slipstream-relay.mjs';

const CODE = 'TESTC-ODE42';
async function start(t, options = {slipstream: true, hostCode: CODE}) {
  const app = createApp(options), server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  app.locals.slipstreamRelay?.attach(server);
  const host = '127.0.0.1:' + server.address().port, origin = 'http://' + host;
  const aborts = [], socketsOpen = [];
  t.after(() => { for (const a of aborts) a.abort(); for (const s of socketsOpen) s.terminate(); app.locals.slipstreamRelay?.stop(); server.closeAllConnections(); return new Promise(r => server.close(r)); });
  const call = async (path, {method = 'GET', key, body, raw} = {}) => {
    const headers = {};
    if (key) headers.Authorization = 'Bearer ' + key;
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(origin + path, {method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body))});
    const text = await response.text();
    return {status: response.status, headers: response.headers, json: text ? JSON.parse(text) : null};
  };
  const collector = () => {
    const queue = [], waiting = [];
    return {queue, push: m => waiting.length ? waiting.shift()(m) : queue.push(m),
      next: () => queue.length ? Promise.resolve(queue.shift()) : Promise.race([new Promise(r => waiting.push(r)), new Promise((_, x) => setTimeout(() => x(new Error('no event')), 1500))])};
  };
  const open = async (path, key) => {
    const abort = new AbortController(); aborts.push(abort);
    const response = await fetch(origin + path, {headers: {Authorization: 'Bearer ' + key}, signal: abort.signal});
    const c = collector();
    if (response.status === 200) (async () => {
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      try { for (;;) { const {value, done} = await reader.read(); if (done) break; buffer += decoder.decode(value, {stream: true}); let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) { const block = buffer.slice(0, cut); buffer = buffer.slice(cut + 2); if (block.startsWith('data: ')) c.push(JSON.parse(block.slice(6))); } } } catch {}
    })();
    return {status: response.status, headers: response.headers, next: c.next, queue: c.queue, close: () => abort.abort()};
  };
  // WebSocket client; closed resolves with the close code.
  const socket = (first, {headers = {}, path = SOCKET_PATH} = {}) => {
    const ws = new WebSocket('ws://' + host + path, {headers}); socketsOpen.push(ws);
    const c = collector();
    ws.on('message', data => c.push(JSON.parse(data.toString())));
    const closed = new Promise(resolve => { ws.on('close', code => resolve(code)); ws.on('error', () => resolve('error')); });
    const ready = new Promise(resolve => { ws.on('open', () => { if (first !== undefined) ws.send(typeof first === 'string' ? first : JSON.stringify(first)); resolve(); }); ws.on('error', resolve); });
    return {ws, next: c.next, queue: c.queue, closed, ready, send: m => ws.send(JSON.stringify(m))};
  };
  const room = async () => { const made = (await call('/api/slipstream/rooms', {method: 'POST', key: CODE})).json; return {...made, base: '/api/slipstream/rooms/' + made.room}; };
  const join = async (r, name, joinKey = r.joinKey, approve = true) => {
    const p = (await call(r.base + '/join', {method: 'POST', body: {joinKey, name}})).json;
    if (approve) await call(r.base + '/approve', {method: 'POST', key: r.hostKey, body: {player: p.player}});
    return p;
  };
  return {app, call, open, socket, room, join, origin, host};
}

test('controller and relay do not exist unless the server is started with the slipstream option', async t => {
  const {call} = await start(t, {});
  for (const path of ['/slipstream/', '/slipstream/app.mjs', '/slipstream/pad.html', '/slipstream/data/pieces.json', '/slipstream/vendor/qrcode.mjs', '/slipstream/render3d.mjs', '/slipstream/vendor/three.module.js', '/slipstream/vendor/three.core.js'])
    assert.equal((await call(path)).status, 404, path);
  assert.equal((await call('/api/slipstream/rooms', {method: 'POST', key: CODE})).status, 404);
  for (const value of ['true', 1, 'yes']) {
    const other = await start(t, {slipstream: value, hostCode: CODE});
    assert.equal((await other.call('/slipstream/')).status, 404, String(value));
  }
});

test('enabled controller serves only its browser assets, with security headers', async t => {
  const {origin, host} = await start(t);
  for (const path of ['/slipstream/', '/slipstream/index.html', '/slipstream/pad.html', '/slipstream/style.css', '/slipstream/app.mjs', '/slipstream/pad.mjs',
    '/slipstream/protocol.mjs', '/slipstream/track.mjs', '/slipstream/battle.mjs', '/slipstream/trace.mjs', '/slipstream/data/pieces.json', '/slipstream/vendor/qrcode.mjs', '/slipstream/render3d.mjs', '/slipstream/vendor/three.module.js', '/slipstream/vendor/three.core.js']) {
    const response = await fetch(origin + path); await response.arrayBuffer();
    assert.equal(response.status, 200, path);
    const csp = response.headers.get('content-security-policy');
    assert.equal(csp, SECURITY_HEADERS['Content-Security-Policy'].replace("connect-src 'self'", `connect-src 'self' ws://${host} wss://${host}`), path);
    assert.ok(!/connect-src[^;]*\*/.test(csp)); assert.match(csp, /script-src 'self';/);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
  }
  for (const path of ['/slipstream/core.test.mjs', '/slipstream/tools/extract_config.py', '/slipstream/README.md', '/slipstream/ANALYSIS.md', '/slipstream/fixtures/sim-capsule.json',
    '/slipstream/../package.json', '/slipstream/data/../core.test.mjs', '/slipstream/vendor/qrcode.js', '/slipstream/vendor/three.cjs', '/slipstream/vendor/../package.json', '/slipstream/.git/config']) {
    const response = await fetch(origin + path); await response.arrayBuffer();
    assert.equal(response.status, 404, path);
  }
  // A hostile Host header cannot inject into the policy.
  const {request} = await import('node:http');
  const csp = await new Promise((resolve, reject) => { const r = request({host: '127.0.0.1', port: host.split(':')[1], path: '/slipstream/', headers: {Host: "evil.example; script-src *"}}, res => { res.resume(); resolve(res.headers['content-security-policy']); }); r.on('error', reject); r.end(); });
  assert.equal(csp, SECURITY_HEADERS['Content-Security-Policy']);
});

test('opening a room needs the host code, and guessing it is rate-limited', async t => {
  const {call} = await start(t);
  assert.match(newHostCode(), /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/); assert.notEqual(newHostCode(), newHostCode());
  assert.equal((await call('/api/slipstream/rooms', {method: 'POST'})).status, 403);
  assert.equal((await call('/api/slipstream/rooms?code=' + CODE, {method: 'POST'})).status, 403, 'never from the URL');
  assert.equal((await call('/api/slipstream/rooms', {method: 'POST', body: {hostCode: CODE}})).status, 403, 'never from the body');
  const good = await call('/api/slipstream/rooms', {method: 'POST', key: CODE});
  assert.equal(good.status, 201);
  const guesses = [];
  for (let i = 0; i < LIMITS.badCodesPerMinute + 5; i++) guesses.push((await call('/api/slipstream/rooms', {method: 'POST', key: 'GUESS-' + i})).status);
  assert.ok(guesses.includes(429), 'guessing gets throttled'); assert.ok(!guesses.includes(201));
  assert.equal((await call('/api/slipstream/rooms', {method: 'POST', key: CODE})).status, 201, 'the right code still works during a guessing run');
  assert.throws(() => createApp({slipstream: true, hostCode: 'short'}), /at least 8/);
});

test('room secrets are random, required, and never accepted from a URL', async t => {
  const {call, open, room} = await start(t);
  const a = await room(), b = await room();
  assert.match(a.room, /^[0-9a-f]{8}$/); assert.match(a.hostKey, /^[0-9a-f]{48}$/); assert.match(a.joinKey, /^[0-9a-f]{24}$/);
  assert.notEqual(a.hostKey, b.hostKey); assert.notEqual(a.joinKey, b.joinKey);
  assert.equal((await open(a.base + '/host', 'wrong')).status, 403);
  assert.equal((await open(a.base + '/host', b.hostKey)).status, 403);
  assert.equal((await open(a.base + '/host', CODE)).status, 403, 'the host code opens rooms; it is not a room key');
  assert.equal((await open(a.base + '/host?key=' + a.hostKey, '')).status, 403);
  assert.equal((await open('/api/slipstream/rooms/00000000/host', a.hostKey)).status, 404);
  for (const joinKey of [undefined, '', 'nope', a.hostKey, b.joinKey, CODE, 7, {}, [a.joinKey]])
    assert.equal((await call(a.base + '/join', {method: 'POST', body: {joinKey, name: 'x'}})).status, 403);
});

test('nobody drives until the host lets them in; inputs are range-checked; state is private', async t => {
  const {call, open, room} = await start(t);
  const r = await room(), host = await open(r.base + '/host', r.hostKey);
  assert.deepEqual(await host.next(), {type: 'players', players: []});
  const p1 = (await call(r.base + '/join', {method: 'POST', body: {joinKey: r.joinKey, name: '<img src=x onerror=1> Casey!!'}})).json;
  assert.equal(p1.name, 'img srcx onerror1'.slice(0, LIMITS.name));
  assert.deepEqual(await host.next(), {type: 'joined', id: 1, name: p1.name, approved: false});
  const s1 = await open(r.base + '/player', p1.playerKey);
  assert.deepEqual(await s1.next(), {type: 'pending'}); assert.equal((await host.next()).type, 'online');
  const early = await call(r.base + '/input', {method: 'POST', key: p1.playerKey, body: {throttle: 1}});
  assert.equal(early.status, 403); assert.match(early.json.error, /let you in/);
  await call(r.base + '/state', {method: 'POST', key: r.hostKey, body: {players: {1: {name: 'secret'}}, lobby: {phase: 'battle'}}});
  assert.equal(s1.queue.length, 0, 'a waiting player sees no game state');
  assert.equal(host.queue.length, 0, 'and nothing they send reaches the host');
  assert.equal((await call(r.base + '/approve', {method: 'POST', key: p1.playerKey, body: {player: 1}})).status, 403, 'a player cannot approve themselves');
  assert.equal((await call(r.base + '/approve', {method: 'POST', key: r.hostKey, body: {player: 99}})).status, 404);
  assert.equal((await call(r.base + '/approve', {method: 'POST', key: r.hostKey, body: {player: 1}})).status, 204);
  assert.deepEqual(await s1.next(), {type: 'approved'});

  const sent = await call(r.base + '/input', {method: 'POST', key: p1.playerKey, body: {throttle: 99, steer: -5, attack: true, support: 'yes', special: 1,
    car: 3, cycle: 'attack', uturn: true, player: 2, type: 'kick', approved: true, extra: 'x'.repeat(50)}});
  assert.equal(sent.status, 204);
  assert.deepEqual(await host.next(), {type: 'input', player: 1, throttle: 1, steer: -1, attack: true, support: false, special: false, car: 3, cycle: 'attack', uturn: true});
  for (const raw of ['[]', 'null', '"x"', '{']) assert.equal((await call(r.base + '/input', {method: 'POST', key: p1.playerKey, raw})).status, 400);
  assert.equal((await call(r.base + '/input', {method: 'POST', key: r.hostKey, body: {}})).status, 403);

  const p2 = (await call(r.base + '/join', {method: 'POST', body: {joinKey: r.joinKey, name: ''}})).json; await host.next();
  await call(r.base + '/approve', {method: 'POST', key: r.hostKey, body: {player: p2.player}});
  const s2 = await open(r.base + '/player', p2.playerKey); assert.deepEqual(await s2.next(), {type: 'approved'}); await host.next();
  await call(r.base + '/state', {method: 'POST', key: r.hostKey, body: {players: {1: {name: 'Skull'}, 2: {name: 'Nuke'}}, lobby: {phase: 'battle'}}});
  assert.deepEqual(await s1.next(), {type: 'state', me: {name: 'Skull'}, lobby: {phase: 'battle'}});
  assert.deepEqual(await s2.next(), {type: 'state', me: {name: 'Nuke'}, lobby: {phase: 'battle'}});
  assert.equal((await call(r.base + '/state', {method: 'POST', key: p1.playerKey, body: {players: {2: {name: 'spoof'}}}})).status, 403);
  assert.equal((await call(r.base + '/kick', {method: 'POST', key: r.hostKey, body: {player: 2}})).status, 204);
  assert.equal((await s2.next()).type, 'kicked');
  assert.equal((await call(r.base + '/input', {method: 'POST', key: p2.playerKey, body: {}})).status, 403);
  assert.equal((await call(r.base, {method: 'DELETE', key: r.hostKey})).status, 204);
  assert.equal((await call(r.base + '/join', {method: 'POST', body: {joinKey: r.joinKey}})).status, 404);
});

test('per-car codes name one car, need approval, and are replaced once used', async t => {
  const {call, open, room} = await start(t);
  const r = await room(), other = await room(), host = await open(r.base + '/host', r.hostKey); await host.next();
  const seat = (car, extra = {}) => call(r.base + '/seats', {method: 'POST', key: r.hostKey, body: {car, ...extra}});
  const red = (await seat(1)).json.seatKey, blue = (await seat(2)).json.seatKey;
  assert.match(red, /^[0-9a-f]{24}$/); assert.notEqual(red, blue); assert.equal((await seat(1)).json.seatKey, red);
  for (const car of [0, -1, 1.5, '1', null, 1e7]) assert.equal((await seat(car)).status, 400);
  assert.equal((await call(r.base + '/seats', {method: 'POST', key: red, body: {car: 3}})).status, 403);
  const join = (joinKey, name, base = r.base) => call(base + '/join', {method: 'POST', body: {joinKey, name}});
  assert.equal((await join(red, 'x', other.base)).status, 403, 'a seat key is no use in another room');

  const ana = (await join(red, 'Ana')).json; assert.equal(ana.car, 1);
  assert.deepEqual(await host.next(), {type: 'joined', id: ana.player, name: 'Ana', approved: false, car: 1});
  const eve = await join(red, 'Eve'); assert.equal(eve.status, 201, 'a second request can queue while nobody has been approved');
  await host.next();
  await call(r.base + '/approve', {method: 'POST', key: r.hostKey, body: {player: ana.player}});
  const fresh = (await seat(1)).json.seatKey;
  assert.notEqual(fresh, red, 'approval replaces the code');
  assert.equal((await join(red, 'Photo')).status, 403, 'a photographed code is dead after first use');
  const stream = await open(r.base + '/player', ana.playerKey); await stream.next(); await host.next();
  assert.equal((await join(fresh, 'Thief')).status, 409, 'occupied while its approved driver is connected');
  assert.equal((await call(r.base + '/input', {method: 'POST', key: eve.json.playerKey, body: {throttle: 1}})).status, 403, 'the unapproved requester cannot drive');
  stream.close(); assert.equal((await host.next()).type, 'offline');
  const sub = await join(fresh, 'Sub'); assert.equal(sub.status, 201, 'someone may ask for the car while its driver is offline');
  assert.equal((await call(r.base + '/input', {method: 'POST', key: sub.json.playerKey, body: {throttle: 1}})).status, 403, 'but only the host can hand it over');
  assert.equal((await call(r.base + '/input', {method: 'POST', key: ana.playerKey, body: {throttle: 0.5}})).status, 204, 'the original driver keeps the car meanwhile');
  assert.equal((await seat(1, {remove: true})).status, 204);
  assert.equal((await join(fresh, 'late')).status, 403);
  for (let car = 10; car < 10 + LIMITS.seats - 1; car++) assert.equal((await seat(car)).status, 201);
  assert.equal((await seat(99)).status, 429);
});

test('WebSocket channel: first message authenticates, then the same rules apply', async t => {
  const {call, socket, room, join, host: hostName} = await start(t);
  const r = await room(), hs = socket({room: r.room, key: r.hostKey});
  assert.deepEqual(await hs.next(), {type: 'players', players: []});
  const p = await join(r, 'Wes', r.joinKey, false);
  assert.equal((await hs.next()).type, 'joined');
  const ps = socket({room: r.room, key: p.playerKey});
  assert.deepEqual(await ps.next(), {type: 'pending'}); assert.equal((await hs.next()).type, 'online');
  ps.send({t: 'input', throttle: 1});
  assert.deepEqual(await ps.next(), {type: 'pending'}, 'told to wait; nothing forwarded');
  await call(r.base + '/approve', {method: 'POST', key: r.hostKey, body: {player: p.player}});
  assert.deepEqual(await ps.next(), {type: 'approved'});
  ps.send({t: 'input', throttle: 7, steer: 0.25, attack: true, player: 99, type: 'state'});
  assert.deepEqual(await hs.next(), {type: 'input', player: p.player, throttle: 1, steer: 0.25, attack: true, support: false, special: false});
  hs.send({t: 'state', players: {[p.player]: {name: 'Rho'}}, lobby: {phase: 'ready'}});
  assert.deepEqual(await ps.next(), {type: 'state', me: {name: 'Rho'}, lobby: {phase: 'ready'}});
  ps.send({t: 'state', players: {[p.player]: {name: 'spoof'}}});      // a player cannot publish state
  hs.send({t: 'input', throttle: 1});                                  // a host cannot inject input
  for (let i = 0; i < LIMITS.inputPerSecond * 4; i++) ps.send({t: 'input', throttle: 0.5});
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.ok(hs.queue.length <= LIMITS.inputPerSecond + 12, 'flood is dropped at the bucket: ' + hs.queue.length);
  assert.ok(hs.queue.every(m => m.type === 'input' && m.throttle === 0.5)); assert.equal(ps.queue.length, 0);
  ps.ws.close(); await ps.closed;
  let saw = null; for (let i = 0; i < 200 && !saw; i++) { const m = await hs.next(); if (m.type === 'offline') saw = m; }
  assert.deepEqual(saw, {type: 'offline', player: p.player});

  // Refusals.
  assert.equal(await socket({room: r.room, key: 'nope'}).closed, 4403);
  assert.equal(await socket({room: '00000000', key: r.hostKey}).closed, 4403);
  assert.equal(await socket({room: r.room, key: r.joinKey}).closed, 4403, 'a join key is not a session');
  assert.equal(await socket({room: r.room, key: CODE}).closed, 4403);
  assert.equal(await socket('not json').closed, 4400);
  assert.equal(await socket([1, 2]).closed, 4400);
  assert.equal(await socket({room: r.room, key: r.hostKey, pad: 'x'.repeat(LIMITS.socketBytes)}).closed, 1009, 'oversized message');
  assert.equal(await socket(undefined).closed, 4401, 'silent sockets are closed');
  assert.equal(await socket({room: r.room, key: r.hostKey}, {headers: {Origin: 'https://evil.example'}}).closed, 'error', 'cross-site pages cannot open a socket');
  const sameOrigin = socket({room: r.room, key: r.hostKey}, {headers: {Origin: 'http://' + hostName}});
  assert.equal((await sameOrigin.next()).type, 'players');
  assert.equal(await socket({room: r.room, key: r.hostKey}, {path: '/api/slipstream/other'}).closed, 'error');
  assert.equal(await socket(undefined, {path: SOCKET_PATH + '?room=' + r.room + '&key=' + r.hostKey}).closed, 4401, 'a key in the URL authenticates nothing');
});

test('rate limits, player cap, waiting cap, room cap and body size are enforced', async t => {
  const {app, call, room, join} = await start(t);
  const r = await room();
  const waiting = [];
  for (let i = 0; i < LIMITS.pending; i++) waiting.push((await call(r.base + '/join', {method: 'POST', body: {joinKey: r.joinKey, name: 'W' + i}})).json);
  assert.equal((await call(r.base + '/join', {method: 'POST', body: {joinKey: r.joinKey}})).status, 429, 'the waiting list is bounded');
  for (const w of waiting) await call(r.base + '/approve', {method: 'POST', key: r.hostKey, body: {player: w.player}});
  assert.equal((await call(r.base + '/join', {method: 'POST', body: {joinKey: r.joinKey}})).status, 429, 'room is full');
  const began = Date.now();
  const burst = await Promise.all(Array.from({length: LIMITS.inputPerSecond * 6}, () => call(r.base + '/input', {method: 'POST', key: waiting[0].playerKey, body: {throttle: 1}})));
  const allowed = LIMITS.inputPerSecond * (1 + (Date.now() - began) / 1000) + 2;
  assert.ok(burst.some(x => x.status === 429)); assert.ok(burst.filter(x => x.status !== 429).length <= allowed);
  assert.notEqual((await call(r.base + '/input', {method: 'POST', key: waiting[1].playerKey, body: {}})).status, 429, 'limits are per player');
  const states = await Promise.all(Array.from({length: 80}, () => call(r.base + '/state', {method: 'POST', key: r.hostKey, body: {}})));
  assert.ok(states.some(x => x.status === 429));
  assert.equal((await call(r.base + '/state', {method: 'POST', key: r.hostKey, body: {lobby: {pad: 'x'.repeat(5000)}}})).status, 413);
  for (let i = app.locals.slipstreamRelay.rooms.size; i < LIMITS.rooms; i++) assert.equal((await call('/api/slipstream/rooms', {method: 'POST', key: CODE})).status, 201);
  assert.equal((await call('/api/slipstream/rooms', {method: 'POST', key: CODE})).status, 429);
});


test('Unicode keys are refused without crashing the WebSocket server', async t => {
  const {call, room, socket} = await start(t);
  const r = await room();
  for (const key of ['é'.repeat(48), '😀'.repeat(24), '\u0000'.repeat(48)])
    assert.equal(await socket({room: r.room, key}).closed, 4403);
  assert.equal((await call(r.base + '/join', {method: 'POST', body: {joinKey: 'é'.repeat(24)}})).status, 403);
  assert.equal((await socket({room: r.room, key: r.hostKey}).next()).type, 'players');
});

test('rooms allow four approved drivers and four seats while retaining a waiting list', async t => {
  const {call, room, join} = await start(t);
  const r = await room();
  for (let car = 1; car <= 4; car++) {
    assert.equal((await call(r.base + '/seats', {method: 'POST', key: r.hostKey, body: {car}})).status, 201);
    await join(r, 'Driver ' + car);
  }
  assert.equal((await call(r.base + '/seats', {method: 'POST', key: r.hostKey, body: {car: 5}})).status, 429);
  const next = await join(r, 'Waiting', r.joinKey, false);
  assert.equal((await call(r.base + '/approve', {method: 'POST', key: r.hostKey, body: {player: next.player}})).status, 409);
  await call(r.base + '/kick', {method: 'POST', key: r.hostKey, body: {player: 1}});
  assert.equal((await call(r.base + '/approve', {method: 'POST', key: r.hostKey, body: {player: next.player}})).status, 204);
});


test('same-seat replacement is atomic at four approved drivers', async t => {
  const {call, room, join, socket} = await start(t);
  const r = await room();
  const seat = (await call(r.base + '/seats', {method: 'POST', key: r.hostKey, body: {car: 1}})).json;
  const old = await join(r, 'Old', seat.seatKey, false);
  const replacement = await join(r, 'New', seat.seatKey, false);
  await call(r.base + '/approve', {method: 'POST', key: r.hostKey, body: {player: old.player}});
  const oldSocket = socket({room: r.room, key: old.playerKey});
  assert.equal((await oldSocket.next()).type, 'approved');
  for (let i = 0; i < 3; i++) await join(r, 'Other ' + i);
  assert.equal((await call(r.base + '/approve', {method: 'POST', key: r.hostKey, body: {player: replacement.player}})).status, 204);
  assert.equal((await oldSocket.next()).type, 'kicked');
  assert.equal((await call(r.base + '/input', {method: 'POST', key: old.playerKey, body: {throttle: 1}})).status, 403);
});

// The teaching bench remains loopback-only; container exposure is an explicit game-only choice.
test('container binding requires explicit Slipstream opt-in', () => {
  assert.equal(serverBindAddress(), '127.0.0.1');
  assert.equal(serverBindAddress({slipstream:true}), '127.0.0.1');
  assert.throws(() => serverBindAddress({container:true}));
  assert.equal(serverBindAddress({slipstream:true,container:true}), '0.0.0.0');
});
