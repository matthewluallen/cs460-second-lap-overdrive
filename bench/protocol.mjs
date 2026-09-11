// Second Lap bench wire codec. See BENCH.md for the source specifications.
const uuid = n => 'be15' + n + '-6186-407e-8381-0bd89c4d8df4';
export const uuids = Object.freeze({service:uuid('beef'), notify:uuid('bee0'), write:uuid('bee1')});
const allowed = new Map(Object.entries({
  ping:[1,0x16], version:[1,0x18], battery:[1,0x1a],
  lampOn:[2,0x1d,0x11], lampOff:[2,0x1d,0x01],
  // OVERDRIVE engine RGB: red (0), green (3), blue (2), steady, 0..14.
  engineGreen:[17,0x33,3,0,0,0,0,0,3,0,14,14,0,2,0,0,0,0],
  engineOff:[17,0x33,3,0,0,0,0,0,3,0,0,0,0,2,0,0,0,0],
  sdkOn:[3,0x90,1,0], sdkOff:[3,0x90,0,0]
}));
export function frame(action) {
  if (!allowed.has(action)) throw new Error('Unknown bench operation');
  return Uint8Array.from(allowed.get(action));
}
export const hex = buf => [...buf].map(n=>n.toString(16).padStart(2,'0')).join(' ');
export function decode(bytes) {
  // One characteristic value can contain several length-prefixed messages.
  const rows=[];
  for(let i=0;i<bytes.length;) {
    const n=bytes[i], end=i+1+n;
    if(n<1 || end>bytes.length) throw new Error('Incomplete notification: '+hex(bytes));
    const id=bytes[i+1], raw=hex(bytes.slice(i,end));
    let text='other notification';
    if(id===0x17 && n===1) text='ping reply';
    if((id===0x19 || id===0x1b) && n===3) {
      const value=bytes[i+2]+256*bytes[i+3];
      text=id===0x19?'firmware version '+value:'battery '+value+' mV';
    }
    // OVERDRIVE also reports a 32-bit little-endian version (Partydrive).
    // This is a firmware-reported number, never an inferred model/serial.
    if(id===0x19 && n===5) {
      const value=bytes[i+2]+256*bytes[i+3]+65536*bytes[i+4]+16777216*bytes[i+5];
      text='firmware version '+value+' (32-bit reply; 0x'+value.toString(16)+')';
    }
    rows.push({id,raw,text});i=end;
  }
  return rows;
}
