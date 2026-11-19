import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createApp} from './server.mjs';
import {LIMITS, SOCKET_PATH} from './slipstream-relay.mjs';

// Exercise the real phone transport. These tests do not contact Bluetooth or
// assert that a model's firmware accepts a particular driving command.
async function relay(t) {
  const app = createApp({slipstream: true, hostCode: 'FURIO-US123'});
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  app.locals.slipstreamRelay.attach(server);
  const origin = 'http://127.0.0.1:' + server.address().port, sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    app.locals.slipstreamRelay.stop();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  async function post(path, body, key) {
    const response = await fetch(origin + path, {method: 'POST',
      headers: {'Content-Type': 'application/json', Origin: origin,
        ...(key ? {Authorization: 'Bearer ' + key} : {})}, body: JSON.stringify(body)});
    const text = await response.text();
    return {status: response.status, body: text ? JSON.parse(text) : null};
  }
  async function socket(room, key) {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + SOCKET_PATH, {headers: {Origin: origin}});
    sockets.push(ws);
    const queue = [], waiting = [];
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      if (waiting.length) waiting.shift()(message); else queue.push(message);
    });
    await once(ws, 'open');
    ws.send(JSON.stringify({room, key}));
    async function next(type) {
      for (;;) {
        const message = queue.length ? queue.shift() : await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('No ' + type + ' relay message')), 2000);
          waiting.push(value => { clearTimeout(timer); resolve(value); });
        });
        if (message.type === type) return message;
      }
    }
    return {next, send: value => ws.send(JSON.stringify(value))};
  }
  return {post, socket};
}

for (const count of [2, 4]) test(`${count} F&F phone seats preserve car identity, private dashboards and recovery/brake inputs`, async t => {
  const {post, socket} = await relay(t);
  const created = await post('/api/slipstream/student/rooms', {});
  assert.equal(created.status, 201, 'Student sharing does not require a global host code');
  const room = created.body, base = '/api/slipstream/rooms/' + room.room;
  const host = await socket(room.room, room.hostKey);
  await host.next('players');
  const cars = [], seatKeys = new Set();
  for (let i = 0; i < count; i++) {
    // Session IDs deliberately differ from model IDs 18/19. Repeated physical
    // models must remain independent even when their displayed names match.
    const car = {id: (i + 1) * 101,
      name: i % 2 ? 'Ice Charger / Dynamo' : 'International MXT / Mammoth',
      color: ['#00aaff', '#ff6633', '#aa55ff', '#66dd33'][i], model: i % 2 ? 19 : 18};
    const seat = await post(base + '/seats', {car: car.id}, room.hostKey);
    assert.equal(seat.status, 201); seatKeys.add(seat.body.seatKey);
    const joined = await post(base + '/join', {joinKey: seat.body.seatKey, name: 'Driver ' + (i + 1)});
    assert.equal(joined.status, 201); assert.equal(joined.body.car, car.id);
    assert.equal((await post(base + '/approve', {player: joined.body.player}, room.hostKey)).status, 204);
    car.player = joined.body;
    car.phone = await socket(room.room, car.player.playerKey);
    await car.phone.next('approved');
    cars.push(car);
  }
  assert.equal(seatKeys.size, count, 'each car has a distinct invitation');
  if (count === 4) assert.equal((await post(base + '/seats', {car: 505}, room.hostKey)).status, 429);

  const dashboards = Object.fromEntries(cars.map((car, i) => [car.player.player, {
    id: car.id, name: car.name, color: car.color, speed: 180, connected: true, located: false,
    telemetryHealth: {state: 'degraded', recoveryId: i + 23, remainingMs: 700, maximumSpeed: 180},
    speedPlan: {requested: 600, commanded: 180, rampMs: 800},
    powerZone: {effect: 'shield', remainingMs: 1900}, needsNeutral: false,
  }]));
  const lobby = {phase: 'ready', cars: cars.map(({id, name, color}) => ({id, name, color, free: false}))};
  const message = {t: 'state', players: dashboards, lobby};
  assert.ok(Buffer.byteLength(JSON.stringify(message)) < LIMITS.stateBytes);
  host.send(message);
  for (const car of cars) {
    const received = await car.phone.next('state');
    assert.deepEqual(received.me, dashboards[car.player.player], 'the complete car name and health state survive transport');
    assert.equal(received.me.name, car.name);
    assert.equal(Object.hasOwn(received, 'players'), false, 'another car dashboard is not disclosed');
  }

  for (let i = 0; i < cars.length; i++) {
    const car = cars[i], other = cars[(i + 1) % cars.length];
    assert.equal((await post(base + '/input', {car: other.id, throttle: 1, steer: 1}, car.player.playerKey)).status, 403);
    assert.equal((await post(base + '/input', {car: car.model, throttle: 1}, car.player.playerKey)).status, 403,
      'a firmware model ID cannot be used as this seat’s session car ID');
    const neutral = {t: 'input', car: car.id, throttle: .4, steer: 0, steeringActive: false, recoveryId: i + 23,
      model: car.model, name: other.name};
    car.phone.send(neutral);
    assert.deepEqual(await host.next('input'), {type: 'input', player: car.player.player,
      car: car.id, throttle: .4, steer: 0, steeringActive: false, recoveryId: i + 23,
      attack: false, support: false, special: false}, 'recovery neutral keeps forward hold and cannot impersonate another car');

    car.phone.send({...neutral, throttle: 0});
    const brake = await host.next('input');
    assert.equal(brake.car, car.id); assert.equal(brake.throttle, 0);
    assert.equal(brake.steeringActive, false); assert.equal(brake.recoveryId, i + 23);
  }

  host.send({t: 'state', players: Object.fromEntries(cars.map(car => [car.player.player,
    {...dashboards[car.player.player], speed: 0, safetyReason: 'Manual stop', needsNeutral: true}])),
    lobby: {...lobby, phase: 'stopped'}});
  for (const car of cars) {
    const stopped = await car.phone.next('state');
    assert.equal(stopped.lobby.phase, 'stopped'); assert.equal(stopped.me.speed, 0);
    assert.equal(stopped.me.needsNeutral, true); assert.equal(stopped.me.safetyReason, 'Manual stop');
  }
});
