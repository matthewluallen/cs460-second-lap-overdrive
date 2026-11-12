// Multiplayer relay for the Slipstream controller.
//
// The server never talks to a car. One "host" browser owns the Bluetooth links;
// phones and laptops join a room and send throttle, steering and button state,
// which the server forwards to the host. The host sends back each player's dashboard.
//
// Trust model
//   host code   Printed on the server console. Needed to open a room at all.
//   host key    Returned when a room opens. Controls that room.
//   join key    In the shared QR code. Lets someone ask to join.
//   seat key    One per car, in that car's QR code. Asks to join for that car.
//               Replaced as soon as a driver is approved, so an old photo is useless.
//   player key  Given to each joiner. Does nothing until the host approves the player.
// Keys travel in Authorization headers, JSON bodies or the first WebSocket message,
// never in a URL the server sees. (QR links carry keys in the URL fragment, which
// browsers do not send.)
import express from 'express';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {WebSocketServer} from 'ws';

export const LIMITS = Object.freeze({rooms: 16, players: 8, drivers: 4, pending: 8, seats: 4, name: 16, stateBytes: 3500,
  inputPerSecond: 40, statePerSecond: 12, badCodesPerMinute: 10, idleMs: 30 * 60 * 1000, hostGraceMs: 90 * 1000,
  socketAuthMs: 3000, socketBytes: 4096});
export const SOCKET_PATH = '/api/slipstream/ws';

const token = bytes => randomBytes(bytes).toString('hex');
// Easy to read off a terminal and type: no 0/O or 1/I/L.
export const newHostCode = () => Array.from(randomBytes(10), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('').replace(/(.{5})/, '$1-');
const same = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const bearer = req => { const h = req.get('authorization') || ''; return h.startsWith('Bearer ') ? h.slice(7) : ''; };
const unit = v => typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

class Bucket {
  constructor(perSecond, now, size = perSecond) { this.rate = perSecond; this.size = size; this.tokens = size; this.at = now; }
  take(now) {
    this.tokens = Math.min(this.size, this.tokens + (now - this.at) / 1000 * this.rate); this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1; return true;
  }
}

// A long-lived response stream and a WebSocket both look like {send, close}.
function httpStream(res) {
  res.status(200).set({'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive'});
  res.flushHeaders?.(); res.write(': ready\n\n');
  return {send: data => { if (!res.writableEnded) res.write('data: ' + JSON.stringify(data) + '\n\n'); },
    ping: () => { if (!res.writableEnded) res.write(': ping\n\n'); },
    close: () => { if (!res.writableEnded) res.end(); }};
}
function socketStream(ws) {
  return {send: data => { if (ws.readyState === 1) ws.send(JSON.stringify(data)); },
    ping: () => { if (ws.readyState === 1) ws.ping(); },
    close: () => { try { ws.close(1000); } catch {} }};
}

export function createRelay({hostCode, now = () => Date.now(), heartbeatMs = 15000} = {}) {
  if (typeof hostCode !== 'string' || hostCode.length < 8) throw new Error('The relay needs a host code of at least 8 characters');
  const rooms = new Map();
  const router = express.Router();
  const fail = (res, status, error) => res.status(status).json({error});
  const badCodes = new Bucket(LIMITS.badCodesPerMinute / 60, now(), LIMITS.badCodesPerMinute);

  function closeRoom(id) {
    const room = rooms.get(id);
    if (!room) return;
    room.host?.close(); for (const p of room.players.values()) p.stream?.close();
    rooms.delete(id);
  }
  function sweep() {
    const t = now();
    for (const [id, room] of rooms) if ((!room.host && t - room.hostSeen > LIMITS.hostGraceMs) || t - room.touched > LIMITS.idleMs) closeRoom(id);
  }
  const timer = setInterval(() => {
    sweep();
    for (const room of rooms.values()) { room.host?.ping(); for (const p of room.players.values()) p.stream?.ping(); }
  }, heartbeatMs);
  timer.unref?.();

  // ---- operations shared by the HTTP routes and the WebSocket ------------------
  const publicPlayer = p => ({id: p.id, name: p.name, approved: p.approved, ...(p.car === null ? {} : {car: p.car})});
  function setHost(room, stream) {
    room.host?.close(); room.host = stream; room.hostSeen = now();
    stream.send({type: 'players', players: [...room.players.values()].map(publicPlayer)});
  }
  function dropHost(room, stream) { if (room.host === stream) { room.host = null; room.hostSeen = now(); } }
  function setPlayerStream(room, player, stream) {
    player.stream?.close(); player.stream = stream;
    stream.send({type: player.approved ? 'approved' : 'pending'});
    room.host?.send({type: 'online', player: player.id});
  }
  function dropPlayerStream(room, player, stream) {
    if (player.stream !== stream) return;
    player.stream = null; room.host?.send({type: 'offline', player: player.id});
  }
  // Every field is range-checked and the message is rebuilt; nothing is passed through.
  function input(room, player, b) {
    if (!player.approved) return {status: 403, error: 'Waiting for the host to let you in'};
    if (!player.bucket.take(now())) return {status: 429, error: 'Slow down'};
    if (!plain(b)) return {status: 400, error: 'Expected an object'};
    const message = {type: 'input', player: player.id, throttle: Math.max(0, unit(b.throttle)), steer: unit(b.steer),
      attack: b.attack === true, support: b.support === true, special: b.special === true};
    if (Number.isSafeInteger(b.car) && b.car > 0 && b.car < 1e6) message.car = b.car;
    if (b.release === true) { message.release = true; player.car = null; }
    if (b.cycle === 'attack' || b.cycle === 'support' || b.cycle === 'special') message.cycle = b.cycle;
    if (b.uturn === true) message.uturn = true;
    room.host?.send(message);
    return {status: room.host ? 204 : 202};
  }
  function state(room, body) {
    if (!room.stateBucket.take(now())) return {status: 429, error: 'Slow down'};
    if (!plain(body)) return {status: 400, error: 'Expected an object'};
    const lobby = plain(body.lobby) ? body.lobby : null, each = plain(body.players) ? body.players : {};
    for (const player of room.players.values()) {
      if (!player.approved) continue;
      const mine = Object.hasOwn(each, String(player.id)) ? each[String(player.id)] : null;
      player.stream?.send({type: 'state', me: mine, lobby});
    }
    return {status: 204};
  }
  const findPlayer = (room, key) => { for (const p of room.players.values()) if (same(key, p.key)) return p; return null; };

  // ---- HTTP ----------------------------------------------------------------------
  const roomOf = (req, res) => {
    const room = rooms.get(req.params.room);
    if (!room) { fail(res, 404, 'No such room'); return null; }
    room.touched = now(); return room;
  };
  const hostOf = (req, res) => {
    const room = roomOf(req, res);
    if (room && !same(bearer(req), room.hostKey)) { fail(res, 403, 'Not the host'); return null; }
    return room;
  };
  const playerOf = (req, res) => {
    const room = roomOf(req, res);
    if (!room) return {};
    const player = findPlayer(room, bearer(req));
    if (!player) { fail(res, 403, 'Not a player in this room'); return {}; }
    return {room, player};
  };
  const reply = (res, result) => result.error ? fail(res, result.status, result.error) : res.status(result.status).end();

  router.post('/rooms', (req, res) => {
    sweep();
    if (!same(bearer(req), hostCode)) {
      // Guessing is rate-limited for everyone, so a wrong code is slow to brute-force.
      if (!badCodes.take(now())) return fail(res, 429, 'Too many wrong host codes; wait a minute');
      return fail(res, 403, 'Wrong host code');
    }
    if (rooms.size >= LIMITS.rooms) return fail(res, 429, 'Too many rooms; try again later');
    const id = token(4), t = now();
    const room = {id, hostKey: token(24), joinKey: token(12), seats: new Map(), players: new Map(), host: null,
      hostSeen: t, touched: t, stateBucket: new Bucket(LIMITS.statePerSecond, t), nextPlayer: 1};
    rooms.set(id, room);
    res.status(201).json({room: id, hostKey: room.hostKey, joinKey: room.joinKey});
  });

  router.get('/rooms/:room/host', (req, res) => {
    const room = hostOf(req, res);
    if (!room) return;
    const s = httpStream(res); setHost(room, s);
    req.on('close', () => dropHost(room, s));
  });
  router.post('/rooms/:room/state', (req, res) => { const room = hostOf(req, res); if (room) reply(res, state(room, req.body)); });

  router.post('/rooms/:room/seats', (req, res) => {
    const room = hostOf(req, res);
    if (!room) return;
    const car = req.body?.car;
    if (!Number.isSafeInteger(car) || car < 1 || car > 999999) return fail(res, 400, 'Expected a car id');
    if (req.body.remove === true) { room.seats.delete(car); return res.status(204).end(); }
    if (!room.seats.has(car)) {
      if (room.seats.size >= LIMITS.seats) return fail(res, 429, 'Too many seats');
      room.seats.set(car, token(12));
    }
    res.status(201).json({car, seatKey: room.seats.get(car)});
  });

  // The host lets a waiting player in. A per-car code is replaced at that moment.
  router.post('/rooms/:room/approve', (req, res) => {
    const room = hostOf(req, res);
    if (!room) return;
    const player = room.players.get(Number(req.body?.player));
    if (!player) return fail(res, 404, 'No such player');
    const replaced = [...room.players.values()].filter(p => p !== player && p.approved && player.car !== null && p.car === player.car);
    const remaining = [...room.players.values()].filter(p => p.approved && !replaced.includes(p));
    if (!player.approved && remaining.length >= LIMITS.drivers)
      return fail(res, 409, 'Four drivers are already approved; remove a driver before admitting another');
    // Replace an occupied named seat atomically: an old socket loses authority now,
    // before its asynchronous close handshake finishes.
    for (const old of replaced) { room.players.delete(old.id); old.stream?.send({type: 'kicked'}); old.stream?.close(); }
    player.approved = true;
    if (player.car !== null && room.seats.has(player.car)) room.seats.set(player.car, token(12));
    player.stream?.send({type: 'approved'});
    res.status(204).end();
  });
  router.post('/rooms/:room/kick', (req, res) => {
    const room = hostOf(req, res);
    if (!room) return;
    const player = room.players.get(Number(req.body?.player));
    if (player) { player.stream?.send({type: 'kicked'}); player.stream?.close(); room.players.delete(player.id); }
    res.status(204).end();
  });
  router.delete('/rooms/:room', (req, res) => {
    const room = hostOf(req, res);
    if (!room) return;
    closeRoom(req.params.room); res.status(204).end();
  });

  router.post('/rooms/:room/join', (req, res) => {
    const room = roomOf(req, res);
    if (!room) return;
    const body = req.body ?? {};
    let car = null;
    if (!same(body.joinKey, room.joinKey)) {
      for (const [id, key] of room.seats) if (same(body.joinKey, key)) car = id;
      if (car === null) return fail(res, 403, 'This code is not valid');
      for (const other of room.players.values())
        if (other.car === car && other.approved && other.stream) return fail(res, 409, 'This car already has a driver');
    }
    if (room.players.size >= LIMITS.players) return fail(res, 429, 'Room is full');
    if ([...room.players.values()].filter(p => !p.approved).length >= LIMITS.pending) return fail(res, 429, 'Too many people are waiting to be let in');
    const name = typeof body.name === 'string' ? body.name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, LIMITS.name) : '';
    const player = {id: room.nextPlayer++, key: token(24), name: name || 'Player', car, approved: false, stream: null,
      bucket: new Bucket(LIMITS.inputPerSecond, now())};
    room.players.set(player.id, player);
    room.host?.send({type: 'joined', ...publicPlayer(player)});
    res.status(201).json({player: player.id, playerKey: player.key, name: player.name, ...(car === null ? {} : {car})});
  });

  router.get('/rooms/:room/player', (req, res) => {
    const {room, player} = playerOf(req, res);
    if (!player) return;
    const s = httpStream(res); setPlayerStream(room, player, s);
    req.on('close', () => dropPlayerStream(room, player, s));
  });
  router.post('/rooms/:room/input', (req, res) => { const {room, player} = playerOf(req, res); if (player) reply(res, input(room, player, req.body)); });
  router.post('/rooms/:room/leave', (req, res) => {
    const {room, player} = playerOf(req, res);
    if (!player) return;
    player.stream?.close(); room.players.delete(player.id);
    room.host?.send({type: 'left', player: player.id});
    res.status(204).end();
  });

  // ---- WebSocket: same operations, one connection, no per-message HTTP overhead ----
  // A browser cannot add headers to a WebSocket, so the first message must be
  // {room, key}. Nothing else is accepted until that checks out.
  const sockets = new WebSocketServer({noServer: true, maxPayload: LIMITS.socketBytes, perMessageDeflate: false});
  function accept(ws) {
    let room = null, player = null, stream = null, isHost = false;
    const refuse = code => { try { ws.close(code); } catch {} };
    const deadline = setTimeout(() => { if (!room) refuse(4401); }, LIMITS.socketAuthMs);
    ws.on('message', (data, binary) => {
      if (binary) return refuse(4400);
      let m; try { m = JSON.parse(data.toString()); } catch { return refuse(4400); }
      if (!plain(m)) return refuse(4400);
      if (!room) {
        const found = typeof m.room === 'string' ? rooms.get(m.room) : null;
        if (!found || typeof m.key !== 'string') return refuse(4403);
        if (same(m.key, found.hostKey)) isHost = true;
        else if (!(player = findPlayer(found, m.key))) return refuse(4403);
        room = found; room.touched = now(); clearTimeout(deadline); stream = socketStream(ws);
        if (isHost) setHost(room, stream); else setPlayerStream(room, player, stream);
        return;
      }
      if (rooms.get(room.id) !== room || (!isHost && room.players.get(player.id) !== player)) return refuse(4403);
      room.touched = now();
      const result = isHost ? (m.t === 'state' ? state(room, m) : {status: 400}) : (m.t === 'input' ? input(room, player, m) : {status: 400});
      // Over-limit or malformed messages are dropped, not answered: a flood gets nothing back.
      if (result.status === 403 && !isHost) stream.send({type: 'pending'});
    });
    ws.on('close', () => { clearTimeout(deadline); if (!room) return; if (isHost) dropHost(room, stream); else dropPlayerStream(room, player, stream); });
    ws.on('error', () => {});
  }
  // Call once with the HTTP server. Only same-origin pages may open a socket.
  router.attach = server => {
    server.on('upgrade', (req, socket, head) => {
      const path = (req.url || '').split('?')[0];
      if (path !== SOCKET_PATH) return socket.destroy();
      const origin = req.headers.origin;
      if (origin) { let host = ''; try { host = new URL(origin).host; } catch {} if (host !== req.headers.host) return socket.destroy(); }
      sockets.handleUpgrade(req, socket, head, accept);
    });
  };

  router.stop = () => { clearInterval(timer); for (const id of [...rooms.keys()]) closeRoom(id); for (const ws of sockets.clients) ws.terminate(); sockets.close(); };
  router.rooms = rooms;
  return router;
}
