import express from 'express';
import lodash from 'lodash';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Records} from '../bench/records.mjs';

const require=createRequire(import.meta.url);
const versions=Object.freeze({
  express:require('express/package.json').version,
  lodash:require('lodash/package.json').version
});
const benchDirectory=fileURLToPath(new URL('../bench/',import.meta.url));
const driveDirectory=fileURLToPath(new URL('../instructor-drive/',import.meta.url));
export const MAX_BODY_BYTES=4096;

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

export function createApp({instructorLiveDrive=false}={}){
  const app=express();
  const book=new Records(); // Shared by this app's clients; disposable on restart.
  // Express 4.17.1 defaults to qs's extended parser. Keep that deliberately old
  // dependency available to the isolated lesson, but do not route ordinary bench
  // requests through its vulnerable nested-query parsing. Set before any .use().
  app.set('query parser','simple');
  app.disable('x-powered-by');
  app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
  app.use('/api',express.json({limit:MAX_BODY_BYTES,strict:true}));

  app.get('/api/health',(req,res)=>res.json({
    kind:'cs460-support-server',source:'MOCK',versions
  }));

  const visibleRecords=req=>lodash.orderBy(
    book.list(textField(req.query.operator,'operator')),['id'],['asc']
  );
  app.get('/api/support/records',route((req,res)=>{
    res.json({source:'MOCK',records:visibleRecords(req)});
  }));
  app.get('/api/support/summary',route((req,res)=>{
    const grouped=lodash.groupBy(visibleRecords(req),'team');
    const groups=lodash.orderBy(Object.entries(grouped).map(([team,rows])=>({
      team,count:rows.length
    })),['team'],['asc']);
    res.json({source:'MOCK',groups});
  }));
  app.get('/api/support/records/:id',route((req,res)=>{
    // Intentional CWE-639 remains in Records.read; do not add team filtering here.
    const record=book.read(textField(req.query.operator,'operator'),req.params.id);
    res.json({source:'MOCK',record});
  }));
  app.post('/api/support/records',route((req,res)=>{
    const body=req.body;
    if(!body || typeof body!=='object' || Array.isArray(body)){
      throw new InputError('Request body must be a JSON object');
    }
    // Intentional CWE-862 remains: a recognized operator may choose another team.
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
    app.use('/instructor-drive',express.static(driveDirectory,{dotfiles:'deny',index:'index.html'}));
  }

  // Only designated browser assets are public. No repository-root mount, proxy,
  // or motor API: the instructor page owns its selected browser GATT connection.
  app.use(express.static(benchDirectory,{dotfiles:'deny',index:'index.html'}));
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

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const port=parsePort(process.env.PORT);
    // HOST is intentionally not configurable. This teaching server is loopback-only.
    const instructorLiveDrive=instructorDriveEnabled(process.env.CS460_INSTRUCTOR_LIVE_DRIVE);
    const server=createApp({instructorLiveDrive}).listen(port,'127.0.0.1',()=>{
      console.log(`CS 460 mock support server: http://127.0.0.1:${port}`);
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
