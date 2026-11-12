import express from 'express';
import {createRequire} from 'node:module';
import {resolve, dirname, basename} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Records} from '../bench/records.mjs';
import {createRelay, newHostCode} from './slipstream-relay.mjs';

const require=createRequire(import.meta.url);
const versions=Object.freeze({express:require('express/package.json').version});
const benchDirectory=fileURLToPath(new URL('../bench/',import.meta.url));
const driveDirectory=fileURLToPath(new URL('../instructor-drive/',import.meta.url));
const slipstreamDirectory=fileURLToPath(new URL('../slipstream/',import.meta.url));
const threeDirectory=dirname(require.resolve('three'));
const qrModule=require.resolve('qrcode-generator').replace(/qrcode\.js$/,'qrcode.mjs');
// Browser assets of the Slipstream controller. Tests and tools are never served.
const SLIPSTREAM_FILE=/^\/(?:|index\.html|pad\.html|style\.css|(?:app|pad|render|render3d|net|game|car|ble|sim|battle|track|protocol|trace|session)\.mjs|data\/(?:pieces|vehicles|weapons)\.json)$/;
export const MAX_BODY_BYTES=4096;

// Sent on every response. Pages use one inline <style> block and same-origin
// module scripts only; nothing may frame the bench or load third-party code.
export const SECURITY_HEADERS=Object.freeze({
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "+
    "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'no-referrer',
  'Cross-Origin-Opener-Policy':'same-origin',
  'Cross-Origin-Resource-Policy':'same-origin',
  'Permissions-Policy':'bluetooth=(self), camera=(), microphone=(), geolocation=(), usb=(), serial=()'
});
// The instructor page needs only these. Tests, validation logs and anything
// added to that folder later stay private unless listed here.
const DRIVE_FILES=new Set(['/','/index.html','/ui.mjs','/controller.mjs','/scan-controller.mjs',
  '/track.mjs','/transport.mjs','/protocol.mjs','/README.md','/IDENTIFICATION.md','/SOURCES.md','/VALIDATION.md']);

// Deployment opt-in only: this is not authentication. Keep enabled servers on
// an instructor-controlled localhost origin, never a student/public preview.
export function instructorDriveEnabled(value){
  return value==='I_ACCEPT_UNTESTED_HARDWARE';
}

class InputError extends Error {}

function textField(value,name){
  if(typeof value!=='string')throw new InputError(`${name} must be a string`);
  return value;
}

function route(action){
  return (req,res,next)=>{
    try{action(req,res);}
    catch(error){
      let message=String(error.message);
      // The same fixture also runs in a browser tab, where reload resets it.
      if(message.startsWith('Worksheet session full;')){
        message='Worksheet session full; save your investigation notes and restart the local server to reset';
      }
      next(new InputError(message.slice(0,180)));
    }
  };
}

export function createApp({instructorLiveDrive=false,slipstream=false,slipstreamOnly=false,hostCode=newHostCode()}={}){
  const app=express();
  const book=new Records(); // Shared by this app's clients; disposable on restart.
  // Flat key=value queries only; nested/bracket parsing is never needed here.
  app.set('query parser','simple');
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.set(SECURITY_HEADERS);
    // Older browsers do not treat 'self' as covering WebSockets, so name this
    // exact host for the relay socket. The Host value is checked before use.
    const host=req.headers.host;
    if(slipstream===true&&typeof host==='string'&&/^[A-Za-z0-9.-]{1,253}(?::[0-9]{1,5})?$/.test(host)){
      res.set('Content-Security-Policy',SECURITY_HEADERS['Content-Security-Policy'].replace("connect-src 'self'","connect-src 'self' ws://"+host+" wss://"+host));
    }
    next();
  });
  // Public live sessions exclude every teaching/bench route before parsing requests.
  if(slipstreamOnly){
    if(!slipstream)throw new Error('Slipstream-only mode requires Slipstream');
    app.use((req,res,next)=>{
      if(req.path==='/')return res.redirect('/slipstream/');
      if(req.path==='/favicon.ico'||req.path==='/slipstream'||req.path.startsWith('/slipstream/')||req.path.startsWith('/api/slipstream/'))return next();
      return res.status(404).json({error:'Not found'});
    });
  }
  app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
  app.use('/api',express.json({limit:MAX_BODY_BYTES,strict:true}));
  // The live-car controller and its multiplayer relay exist only with --slipstream.
  // The relay forwards phone inputs to the host browser; it never addresses a car.
  if(slipstream===true){
    const relay=createRelay({hostCode});
    app.locals.slipstreamRelay=relay;app.locals.slipstreamHostCode=hostCode;
    app.use('/api/slipstream',relay);
  }

  app.get('/api/health',(req,res)=>res.json({
    kind:'cs460-support-server',source:'MOCK',versions
  }));

  const visibleRecords=req=>book.list(textField(req.query.operator,'operator'))
    .sort((a,b)=>a.id-b.id);
  app.get('/api/support/records',route((req,res)=>{
    res.json({source:'MOCK',records:visibleRecords(req)});
  }));
  app.get('/api/support/summary',route((req,res)=>{
    const counts=new Map();
    for(const row of visibleRecords(req))counts.set(row.team,(counts.get(row.team)??0)+1);
    const groups=[...counts].map(([team,count])=>({team,count}))
      .sort((a,b)=>a.team<b.team?-1:a.team>b.team?1:0);
    res.json({source:'MOCK',groups});
  }));
  app.get('/api/support/records/:id',route((req,res)=>{
    // Records.read enforces the team boundary and hides other teams' records.
    const record=book.read(textField(req.query.operator,'operator'),req.params.id);
    res.json({source:'MOCK',record});
  }));
  app.post('/api/support/records',route((req,res)=>{
    const body=req.body;
    if(!body || typeof body!=='object' || Array.isArray(body)){
      throw new InputError('Request body must be a JSON object');
    }
    // Records.add refuses a workgroup other than the operator's own team.
    const record=book.add(textField(body.operator,'operator'),
      textField(body.workgroup,'workgroup'),textField(body.note,'note'));
    res.status(201).json({source:'MOCK',record});
  }));

  // A query, cookie, browser storage value, or HTTP request cannot enable this
  // route. Assets live outside bench so its static fallback remains stationary.
  app.use('/instructor-drive',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(instructorLiveDrive!==true)return res.status(404).json({error:'Not found'});
    next();
  });
  if(instructorLiveDrive===true){
    app.get('/instructor-drive/config.json',(req,res)=>res.json({instructorLiveDrive:true}));
    app.use('/instructor-drive',(req,res,next)=>{
      if(!DRIVE_FILES.has(req.path))return res.status(404).json({error:'Not found'});
      next();
    },express.static(driveDirectory,{dotfiles:'deny',index:'index.html',redirect:false}));
  }

  // Only designated browser assets are public. No repository-root mount, proxy,
  // or motor API: the instructor page owns its selected browser GATT connection.
  app.use('/slipstream',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(slipstream!==true)return res.status(404).json({error:'Not found'});
    if(req.path==='/vendor/qrcode.mjs')return res.type('text/javascript').sendFile(basename(qrModule), {root: dirname(qrModule), dotfiles: 'deny'});
    if(['/vendor/three.module.js','/vendor/three.core.js'].includes(req.path))return res.type('text/javascript').sendFile(basename(req.path), {root:threeDirectory,dotfiles:'deny'});
    if(!SLIPSTREAM_FILE.test(req.path))return res.status(404).json({error:'Not found'});
    next();
  },express.static(slipstreamDirectory,{dotfiles:'deny',index:'index.html',redirect:false}));
  app.get('/favicon.ico',(req,res)=>res.status(204).end());
  // Test files are development artifacts, not browser assets.
  app.use((req,res,next)=>{
    if(/\.test\.mjs$/i.test(req.path))return res.status(404).json({error:'Not found'});
    next();
  });
  app.use(express.static(benchDirectory,{dotfiles:'deny',index:'index.html',redirect:false}));
  app.use((req,res)=>res.status(404).json({error:'Not found'}));
  app.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    if(error.type==='entity.too.large'){
      return res.status(413).json({error:`Request body exceeds ${MAX_BODY_BYTES} bytes`});
    }
    const message=error instanceof InputError ? error.message : 'Invalid request';
    res.status(400).json({error:message});
  });
  return app;
}

export function parsePort(value='8000'){
  if(typeof value!=='string' || !/^[0-9]+$/.test(value)){
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  const port=Number(value);
  if(!Number.isSafeInteger(port) || port<1 || port>65535){
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  return port;
}

export function serverBindAddress({slipstream=false,container=false}={}) {
  if(container && !slipstream)throw new Error('--container requires --slipstream');
  return container?'0.0.0.0':'127.0.0.1';
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const port=parsePort(process.env.PORT);
    // Loopback remains the default. Container binding is an explicit Slipstream-only opt-in.
    const instructorLiveDrive=instructorDriveEnabled(process.env.CS460_INSTRUCTOR_LIVE_DRIVE);
    const slipstreamOnly=process.argv.includes('--slipstream-only');
    const slipstream=slipstreamOnly||process.argv.includes('--slipstream');
    // The host code gates room creation. Set SLIPSTREAM_HOST_CODE to choose it.
    const hostCode=process.env.SLIPSTREAM_HOST_CODE||newHostCode();
    if(slipstream&&hostCode.length<8)throw new Error('SLIPSTREAM_HOST_CODE must be at least 8 characters');
    const app=createApp({instructorLiveDrive,slipstream,slipstreamOnly,hostCode});
    const bindAddress=serverBindAddress({slipstream,container:process.argv.includes('--container')});
    const server=app.listen(port,bindAddress,()=>{
      // Bound slow or stalled clients on this single-process teaching server.
      server.headersTimeout=10000;server.requestTimeout=15000;server.keepAliveTimeout=5000;
      console.log(`CS 460 mock support server: http://127.0.0.1:${port}`);
      if(slipstream){
        app.locals.slipstreamRelay.attach(server);
        console.log(`Slipstream controller: http://127.0.0.1:${port}/slipstream/ (real cars move; supervise the track)`);
        console.log(`Host code (needed to invite players): ${hostCode}`);
        // Status output does not guarantee that a Codespace stays awake.
        setInterval(()=>console.log(`[slipstream] ${new Date().toISOString()} rooms ${app.locals.slipstreamRelay.rooms.size}`),5*60*1000).unref();
      }
      if(instructorLiveDrive)console.log('Instructor drive prototype enabled at /instructor-drive/; physical movement remains unverified.');
    });
    server.on('error',()=>{
      console.error('Could not start the local server; check whether PORT is already in use.');
      process.exitCode=1;
    });
  }catch(error){
    console.error(error.message);
    process.exitCode=1;
  }
}
