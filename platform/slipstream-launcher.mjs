// Idempotent classroom startup. Never stops/replaces an existing server or moves cars.
import {mkdir,open,readFile,writeFile,rename,unlink,chmod} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}};
const readJSON=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
async function ready(port){
  try{const r=await fetch(`http://127.0.0.1:${port}/slipstream/ready`,{signal:AbortSignal.timeout(750)});return r.ok?await r.json():null;}catch{return null;}
}
async function occupied(port){
  // Any HTTP responder is occupied, including a teaching server or another service.
  try{await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(750)});return true;}catch{return false;}
}
export async function launch({stateDir=process.env.SLIPSTREAM_STATE_DIR||join(homedir(),'.local/state/slipstream-managed'),port=Number(process.env.PORT||3000),hostCode=process.env.SLIPSTREAM_HOST_CODE,startupMs=8000}={}){
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node 22 or newer is required. Rebuild the configured devcontainer.');
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be an integer from 1 to 65535');
  if(hostCode!==undefined&&(typeof hostCode!=='string'||hostCode.length<8||hostCode.length>128))throw new Error('Host code must contain 8–128 characters');
  await mkdir(stateDir,{recursive:true,mode:0o700});await chmod(stateDir,0o700);
  const recordPath=join(stateDir,'server.json'),lockPath=join(stateDir,'startup.lock');
  const verify=async()=>{
    const record=await readJSON(recordPath);
    if(!record||record.port!==port||!Number.isInteger(record.pid)||record.pid<=0||!alive(record.pid))return null;
    const health=await ready(port);
    return health?.service==='slipstream'&&health.mode==='live'&&health.bootId===record.bootId?record:null;
  };
  let lock;
  for(let attempt=0;attempt<100;attempt++){
    try{lock=await open(lockPath,'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid}));break;}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const owner=await readJSON(lockPath).catch(()=>null);
      if(owner&&Number.isInteger(owner.pid)&&owner.pid>0&&!alive(owner.pid))throw new Error('A previous startup was interrupted. Check that no startup is active, then remove '+lockPath+' and retry.');
      await sleep(100);
    }
  }
  if(!lock)throw new Error('Another startup is still in progress. Try again after it finishes.');
  try{
    const existing=await verify();
    const secretPath=join(stateDir,'host-code');
    let saved;try{saved=(await readFile(secretPath,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;}
    if(existing){
      if(!saved)throw new Error('Managed server is running but its saved host code is missing; do not restart during a session.');
      if(hostCode&&hostCode!==saved)throw new Error('A server with a different host code is already running; no changes made.');
      return {...existing,alreadyRunning:true,stateDir};
    }
    if(await occupied(port))throw new Error('Port is occupied by an unmanaged or different server. No server was stopped.');
    const code=hostCode||saved||randomBytes(12).toString('base64url');
    if(code.length<8||code.length>128)throw new Error('Saved host code is invalid; inspect the private state directory.');
    await writeFile(secretPath,code+'\n',{mode:0o600});await chmod(secretPath,0o600);
    const bootId=randomUUID(); // Public process identity, never an authentication credential.
    const logPath=join(stateDir,'server.log'),log=await open(logPath,'a',0o600);await chmod(logPath,0o600);
    let child;
    try{
      child=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url)),'--slipstream-only'],{
        env:{...process.env,PORT:String(port),SLIPSTREAM_HOST_CODE:code,SLIPSTREAM_BOOT_ID:bootId},
        detached:true,stdio:['ignore',log.fd,log.fd]});
    }finally{await log.close();}
    let spawnError;child.on('error',error=>{spawnError=error;});
    const record={pid:child.pid,port,bootId,started:new Date().toISOString(),node:process.version};
    try{
    const deadline=Date.now()+startupMs;
    while(Date.now()<deadline){
      if(spawnError)throw spawnError;
      if(child.exitCode!==null||child.signalCode!==null)throw new Error('Server exited during startup. Inspect the private server.log.');
      const health=await ready(port);
      if(health?.bootId===bootId&&health.service==='slipstream'&&health.mode==='live'){
        const temporary=recordPath+'.tmp';await writeFile(temporary,JSON.stringify(record)+'\n',{mode:0o600});await rename(temporary,recordPath);
        child.unref();return {...record,alreadyRunning:false,stateDir};
      }
      await sleep(100);
    }
    // Only the child started by THIS attempt may be terminated on readiness failure.
    throw new Error('Server readiness timed out. Inspect the private server.log.');
    }catch(error){
      if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
      child.unref();throw error;
    }
  }finally{await lock.close();await unlink(lockPath).catch(()=>{});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const result=await launch();
    console.log(`Slipstream ${result.alreadyRunning?'already running':'ready'} on port ${result.port}.`);
    console.log(`Host code: private file ${join(result.stateDir,'host-code')}`);
    console.log('Public forwarding is separate; verify the Codespaces Ports panel before sharing QR codes.');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
