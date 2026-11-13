// Anonymous, read-only deployment checks. Never connects to Bluetooth or a room.
import {pathToFileURL} from 'node:url';

export function checkOrigin(value='http://127.0.0.1:3000'){
  let url;
  try{url=new URL(value);}catch{throw new Error('Set SLIPSTREAM_CHECK_ORIGIN to the server origin, without a path or credentials');}
  const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(local&&url.protocol==='http:'))throw new Error('Remote checks require HTTPS; HTTP is allowed only on loopback');
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Use only the server origin, without a path, credentials, query or fragment');
  return url;
}

export async function preflight(value){
  const origin=checkOrigin(value);
  async function get(path){
    let response;
    try{response=await fetch(new URL(path,origin),{redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(10000)});}
    catch{throw new Error('Cannot reach the server. Wait for startup and check the Codespace and forwarded port.');}
    if(response.status>=300&&response.status<400){
      await response.body?.cancel();
      throw new Error('Public access redirects to another page. Check port 3000 visibility before sharing QR codes; this check does not change access settings.');
    }
    return response;
  }
  const ready=await get('/slipstream/ready');
  let identity;
  try{identity=ready.ok?await ready.json():null;}catch{identity=null;}
  if(identity?.service!=='slipstream'||identity.mode!=='live'||typeof identity.bootId!=='string'||!identity.bootId){
    throw new Error('Live server readiness was not confirmed. Start the managed live server and retry after startup.');
  }
  const page=await get('/slipstream/');
  const pageOK=page.status===200&&page.headers.get('content-type')?.includes('text/html');
  await page.body?.cancel();
  if(!pageOK)throw new Error('The controller page is unavailable even though readiness responded.');
  for(const path of ['/api/health','/bench/','/instructor-drive/']){
    const response=await get(path);
    await response.body?.cancel();
    if(response.status!==404)throw new Error('Teaching-route isolation was not confirmed. Use the live-only server for public sessions.');
  }
  return {origin:origin.origin,bootId:identity.bootId};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    await preflight(process.env.SLIPSTREAM_CHECK_ORIGIN);
    console.log('PASS: anonymous live readiness, controller page and teaching-route isolation.');
    console.log('No rooms or cars touched. Phone-network and physical-car acceptance are still required.');
  }catch(error){console.error('Preflight failed: '+error.message);process.exitCode=1;}
}
