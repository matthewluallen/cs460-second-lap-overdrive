// Canvas renderer for the track, cars and battle effects.
import {pointOn, layout} from './track.mjs';

const ROAD_HALF = 105;
const css = ([r, g, b], a = 1) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;

export class Renderer {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.effects = []; this.view = null; this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; }
  resize() {
    const ratio = Math.min(2, window.devicePixelRatio || 1), box = this.canvas.getBoundingClientRect();
    const w = Math.max(200, Math.round(box.width * ratio)), h = Math.max(200, Math.round(box.height * ratio));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.ratio = ratio;
  }
  #fit(bounds) {
    const {width, height} = this.canvas, pad = 60 * this.ratio;
    const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
    const scale = Math.min((width - pad * 2) / w, (height - pad * 2) / h);
    this.view = {scale, ox: width / 2 - (bounds.minX + w / 2) * scale, oy: height / 2 + (bounds.minY + h / 2) * scale};
  }
  xy(p) { return [this.view.ox + p.x * this.view.scale, this.view.oy - p.y * this.view.scale]; }
  #ribbon(piece, from, to, lateralA, lateralB) {
    const c = this.ctx, steps = piece.turn ? 14 : 1;
    c.beginPath();
    for (let i = 0; i <= steps; i++) { const [x, y] = this.xy(pointOn(piece, from + (to - from) * i / steps, lateralA)); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    for (let i = steps; i >= 0; i--) { const [x, y] = this.xy(pointOn(piece, from + (to - from) * i / steps, lateralB)); c.lineTo(x, y); }
    c.closePath();
  }
  #line(piece, lateral, from = 0, to = 1) {
    const c = this.ctx, steps = piece.turn ? 14 : 1;
    c.beginPath();
    for (let i = 0; i <= steps; i++) { const [x, y] = this.xy(pointOn(piece, from + (to - from) * i / steps, lateral)); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
  }
  drawTrack(pieces, {ghost = false} = {}) {
    const c = this.ctx, s = this.view.scale;
    for (const piece of pieces) {
      this.#ribbon(piece, 0, 1, ROAD_HALF, -ROAD_HALF);
      c.fillStyle = ghost ? 'rgba(60,72,88,.55)' : piece.inferred ? '#2a2f3a' : '#1b2029'; c.fill();
      c.lineWidth = Math.max(1, 3 * s); c.strokeStyle = ghost ? 'rgba(120,200,255,.7)' : '#0d1117'; c.stroke();
    }
    for (const piece of pieces) {
      c.lineWidth = Math.max(1, 5 * s); c.strokeStyle = ghost ? 'rgba(120,200,255,.5)' : '#e9edf2';
      this.#line(piece, ROAD_HALF - 6); this.#line(piece, -ROAD_HALF + 6);
      c.lineWidth = Math.max(0.5, 1.2 * s); c.strokeStyle = 'rgba(255,255,255,.10)';
      for (const lane of [-45, 0, 45]) this.#line(piece, lane);
      if (piece.kind === 'finish' || piece.kind === 'start') {
        if (piece.kind === 'finish') for (let i = 0; i < 12; i++) for (let j = 0; j < 2; j++) {
          this.#ribbon(piece, 0.42 + j * 0.09, 0.51 + j * 0.09, -ROAD_HALF + 12 + i * 15.5, -ROAD_HALF + 12 + (i + 1) * 15.5);
          c.fillStyle = (i + j) % 2 ? '#f4f6f8' : '#111'; c.fill();
        }
      } else if (piece.kind === 'intersection') {
        this.#ribbon(piece, 0.3, 0.7, ROAD_HALF + 60, -ROAD_HALF - 60); c.fillStyle = '#1b2029'; c.fill();
        c.strokeStyle = '#ffd34d'; c.lineWidth = Math.max(1, 3 * s); this.#line(piece, 0, 0.42, 0.58);
      } else if (piece.kind === 'jump' || piece.kind === 'landing') {
        c.strokeStyle = piece.kind === 'jump' ? '#ff7a3d' : '#7dffb2'; c.lineWidth = Math.max(1, 4 * s);
        for (const t of [0.35, 0.5, 0.65]) { const a = this.xy(pointOn(piece, t, 50)), m = this.xy(pointOn(piece, t + 0.07, 0)), b = this.xy(pointOn(piece, t, -50)); c.beginPath(); c.moveTo(...a); c.lineTo(...m); c.lineTo(...b); c.stroke(); }
      }
    }
  }
  addEffect(effect) { if (this.reducedMotion) return; this.effects.push({...effect, born: performance.now()}); if (this.effects.length > 160) this.effects.shift(); }
  draw({track, partial, cars, mines, now, banner}) {
    this.resize();
    const c = this.ctx, {width, height} = this.canvas;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, width, height);
    const shape = track ?? (partial?.length ? layout(partial) : null);
    if (!shape || !shape.bounds) { this.#banner(banner || 'Connect a car, then scan the track'); return; }
    this.#fit(shape.bounds);
    this.drawTrack(shape.pieces, {ghost: !track});
    const s = this.view.scale, at = {};
    if (track) for (const mine of mines) {
      const spot = this.#spot(track, mine.distance, mine.lateral), [x, y] = this.xy(spot), armed = now >= mine.armedAt;
      c.beginPath(); c.arc(x, y, 14 * s, 0, 7); c.fillStyle = armed ? '#ff4d6d' : '#7a2433'; c.fill();
      c.beginPath(); c.arc(x, y, (22 + 8 * Math.sin(now / 120)) * s, 0, 7); c.strokeStyle = 'rgba(255,77,109,.5)'; c.lineWidth = 2 * s; c.stroke();
    }
    for (const car of cars) {
      if (!car.pose) continue;
      const [x, y] = this.xy(car.pose); at[car.id] = {x, y, heading: car.pose.heading};
      c.save(); c.translate(x, y); c.rotate(-car.pose.heading);
      const L = (car.truck ? 120 : 88) * s, W = 46 * s;
      c.shadowColor = css(car.color, 0.9); c.shadowBlur = (car.disabled ? 4 : 18) * this.ratio;
      c.fillStyle = car.disabled ? '#444b57' : css(car.color); this.#round(-L / 2, -W / 2, L, W, 9 * s); c.fill();
      c.shadowBlur = 0; c.fillStyle = 'rgba(0,0,0,.55)'; this.#round(-L * 0.12, -W * 0.36, L * 0.38, W * 0.72, 5 * s); c.fill();
      c.fillStyle = '#fff'; c.fillRect(L / 2 - 5 * s, -W / 2 + 4 * s, 4 * s, 8 * s); c.fillRect(L / 2 - 5 * s, W / 2 - 12 * s, 4 * s, 8 * s);
      c.restore();
      if (car.shield) { c.beginPath(); c.arc(x, y, 70 * s, 0, 7); c.strokeStyle = 'rgba(89,200,255,.9)'; c.lineWidth = 4 * s; c.stroke(); c.fillStyle = 'rgba(89,200,255,.12)'; c.fill(); }
      if (!car.located) { c.beginPath(); c.arc(x, y, 60 * s, 0, 7); c.setLineDash([6 * s, 6 * s]); c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 2 * s; c.stroke(); c.setLineDash([]); }
      const bw = 90 * s, bx = x - bw / 2, by = y - 78 * s;
      c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(bx, by, bw, 7 * s);
      c.fillStyle = car.energy < 0.33 ? '#ff4d6d' : car.energy < 0.66 ? '#ffb84d' : '#5dff9b'; c.fillRect(bx, by, bw * Math.max(0, car.energy), 7 * s);
      c.font = `600 ${Math.max(10, 26 * s)}px system-ui, sans-serif`; c.textAlign = 'center'; c.fillStyle = '#e9edf2';
      c.fillText(car.id + ' · ' + car.name + (car.control === 'bot' ? ' · CPU' : ''), x, by - 8 * s - (car.id % 2) * 14 * this.ratio);
    }
    this.#effects(at, track, now);
    if (banner) this.#banner(banner, true);
  }
  #spot(track, distance, lateral) {
    let index = track.pieces.findIndex(p => distance < p.start.distance + p.length);
    if (index < 0) index = track.count - 1;
    const p = track.pieces[index];
    return pointOn(p, Math.max(0, Math.min(1, (distance - p.start.distance) / p.length)), lateral);
  }
  #effects(at, track, now) {
    const c = this.ctx, s = this.view.scale, t = performance.now();
    this.effects = this.effects.filter(e => t - e.born < (e.life ?? 400));
    for (const e of this.effects) {
      const age = (t - e.born) / (e.life ?? 400), fade = 1 - age, from = e.from && at[e.from], to = e.to && at[e.to];
      c.globalAlpha = Math.max(0, fade);
      if (e.type === 'beam' && from && to) {
        c.strokeStyle = e.color; c.lineWidth = 6 * s; c.shadowColor = e.color; c.shadowBlur = 16 * this.ratio;
        c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(to.x, to.y); c.stroke(); c.shadowBlur = 0;
      } else if ((e.type === 'tracer' || e.type === 'shot') && from) {
        const reach = (e.length ?? 0.7) * 1000 * s * (e.type === 'shot' ? 1 : 0.6);
        c.strokeStyle = e.color; c.lineWidth = (e.type === 'shot' ? 8 : 3) * s; c.setLineDash(e.type === 'shot' ? [] : [10 * s, 12 * s]);
        c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(from.x + Math.cos(from.heading) * reach, from.y - Math.sin(from.heading) * reach); c.stroke(); c.setLineDash([]);
      } else if ((e.type === 'burst' || e.type === 'pulse' || e.type === 'horn' || e.type === 'rage') && from) {
        c.strokeStyle = e.color ?? '#ff4d6d'; c.lineWidth = 6 * s;
        c.beginPath(); c.arc(from.x, from.y, ((e.radius ?? 0.3) * 1000 * age + 30) * s, 0, 7); c.stroke();
      } else if (e.type === 'explosion' || e.type === 'disabled') {
        const p = e.type === 'explosion' && track ? this.xy(this.#spot(track, e.distance, e.lateral)) : at[e.car] && [at[e.car].x, at[e.car].y];
        if (p) for (let i = 0; i < 12; i++) {
          const a = i * 0.524 + (e.born % 7), r = (40 + 220 * age) * s;
          c.fillStyle = i % 2 ? '#ffd34d' : '#ff7a3d'; c.beginPath(); c.arc(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r, (14 * fade + 2) * s, 0, 7); c.fill();
        }
      } else if ((e.type === 'hit' || e.type === 'crash' || e.type === 'ram') && at[e.car]) {
        c.strokeStyle = '#ff4d6d'; c.lineWidth = 5 * s; c.beginPath(); c.arc(at[e.car].x, at[e.car].y, (50 + 40 * age) * s, 0, 7); c.stroke();
      } else if (e.type === 'blocked' && at[e.car]) {
        c.strokeStyle = '#59c8ff'; c.lineWidth = 6 * s; c.beginPath(); c.arc(at[e.car].x, at[e.car].y, (70 + 20 * age) * s, 0, 7); c.stroke();
      }
      c.globalAlpha = 1;
    }
  }
  #round(x, y, w, h, r) { const c = this.ctx; c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); }
  #banner(text, small = false) {
    const c = this.ctx, {width, height} = this.canvas;
    c.font = `600 ${(small ? 15 : 20) * this.ratio}px system-ui, sans-serif`; c.textAlign = 'center';
    c.fillStyle = small ? '#59c8ff' : 'rgba(233,237,242,.55)';
    c.fillText(text, width / 2, small ? 30 * this.ratio : height / 2);
  }
}
