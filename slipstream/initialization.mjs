// Interoperability packets independently transcribed from F&F build 403.
// Addresses, hashes and deliberate conservative differences: review/FF-INITIALIZATION.md.
import {encode} from './protocol.mjs';
const bytes = text => Uint8Array.from(text.split(' ').map(b => parseInt(b, 16)));
export function initializationPhases(profile) {
  if (profile === 'sdk') return [
    {name:'SDK mode', packets:[encode.speed(0,2500),encode.sdkMode(true,1)], reply:'ping'},
    {name:'Firmware version', packets:[encode.version()], reply:'version'}
  ];
  if (profile !== 'fast-furious') throw new Error('Unknown connection profile');
  return [
    {name:'Stop and leave SDK override',packets:[encode.speed(0,2500),encode.sdkMode(false,0)],reply:'ping'},
    {name:'Firmware version',packets:[encode.version()],reply:'version'},
    {name:'App driving mode',packets:[bytes('02 22 01')],reply:'ping'},
    // No autonomous jump boost; modular track, not vinyl.
    {name:'Modular track settings',packets:[bytes('03 45 00 00')],reply:'ping'},
    {name:'Default road network',packets:[bytes('01 21'),
      bytes('13 46 01 02 01 3e 01 44 00 00 00 00 00 00 00 00 00 00 00 00'),
      bytes('13 48 01 0d 8a 0a 0a 0a 0a 0a 0b 0a 0a 4a 4b 4b 80 00 00 00'),
      bytes('08 49 01 10 00 01 02 00 0d')],reply:'ping'},
    {name:'Stop when delocalized',packets:[bytes('03 37 00 00'),encode.speed(0,2500)],reply:'ping'}
  ];
}
