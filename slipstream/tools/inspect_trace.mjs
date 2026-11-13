// Offline diagnostics. Never connects to a car or interprets supercodes as attacks.
import {readFile, stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {validate} from '../trace.mjs';
import {decode} from '../protocol.mjs';

export function summarizeTrace(input) {
  const trace = validate(input);
  const cars = trace.cars.map((car, index) => ({index, name: car?.name ?? 'Unknown', model: car?.model ?? null,
    simulated: typeof car?.simulated === 'boolean' ? car.simulated : null,
    firmware: car?.firmware ?? null, rx: 0, tx: 0, malformedNotifications: 0,
    messages: {}, pieces: new Set(), supercodes: new Map()}));
  for (const [time, index, direction, hex] of trace.events) {
    const car = cars[index]; car[direction]++;
    if (direction !== 'rx') continue;
    let messages;
    try { messages = decode(Uint8Array.from(hex.split(' ').map(b => parseInt(b, 16)))); }
    catch { car.malformedNotifications++; continue; }
    for (const m of messages) {
      car.messages[m.type] = (car.messages[m.type] ?? 0) + 1;
      if (m.type === 'version') car.firmware = m.version;
      if (m.type === 'position') car.pieces.add(m.pieceId);
      if (m.type === 'supercode' || m.type === 'zoneSupercode') {
        const key = `${m.id}:${m.code}:${m.rawTag}`;
        const found = car.supercodes.get(key);
        if (found) { found.count++; found.lastMs = time; }
        else car.supercodes.set(key, {messageId: m.id, code: m.code, rawTag: m.rawTag, count: 1, firstMs: time, lastMs: time});
      }
    }
  }
  return {declaredSource: trace.source ?? 'unknown', physicalValidation: false,
    limitation: 'Recording metadata is self-reported. Supercodes are observations, not confirmed Power Zone locations or effects.',
    durationMs: trace.events.at(-1)?.[0] ?? 0, dropped: trace.dropped ?? 0,
    cars: cars.map(c => ({...c, pieces: [...c.pieces].sort((a,b) => a-b), supercodes: [...c.supercodes.values()]}))};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node slipstream/tools/inspect_trace.mjs recording.json');
    const file = process.argv[2];
    if ((await stat(file)).size > 32 * 1024 * 1024) throw new Error('Trace exceeds the 32 MiB inspection limit');
    console.log(JSON.stringify(summarizeTrace(JSON.parse(await readFile(file, 'utf8'))), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
