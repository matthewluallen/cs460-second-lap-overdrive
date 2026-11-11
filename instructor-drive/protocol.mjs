// Independently authored from the official SDK wire specification; see SOURCES.md.
// This is deliberately separate from the stationary bench's allowlist.
export const MAX_SPEED=200, DEFAULT_SPEED=100, PULSE_MS=750;
export const LEGACY_FIRMWARE=Object.freeze([9511,11866]);
export function packet(action,value=0){
  if(action==='speed'){
    if(!Number.isInteger(value)||value<0||value>MAX_SPEED)throw new RangeError('Speed must be an integer from 0 to 200 mm/s');
    // uint16 LE speed, uint16 LE acceleration (1000 mm/s²), respect limit=1.
    return Uint8Array.of(6,0x24,value&255,value>>8,0xe8,3,1);
  }
  const fixed={sdkOn:[3,0x90,1,1],ping:[1,0x16],version:[1,0x18],battery:[1,0x1a]};
  if(!Object.hasOwn(fixed,action))throw new Error('Operation not allowed');
  return Uint8Array.from(fixed[action]);
}
export function replies(bytes){
  const result=[];
  for(let at=0;at<bytes.length;){
    const size=bytes[at],end=at+size+1,id=bytes[at+1];
    if(size<1||end>bytes.length)throw new Error('Malformed notification');
    if(id===0x17&&size===1)result.push({id,value:true});
    if((id===0x19&&(size===3||size===5))||(id===0x1b&&size===3)){
      let value=0;for(let i=at+2;i<end;i++)value+=bytes[i]*2**(8*(i-at-2));
      result.push({id,value});
    }
    at=end;
  }
  return result;
}
