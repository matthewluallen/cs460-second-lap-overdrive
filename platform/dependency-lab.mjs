import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,parse as parseLegacyUrl} from 'node:url';
import {resolve} from 'node:path';

const filename=fileURLToPath(import.meta.url);
const marker='cs460DependencyLabMarker';
const markerValue='fixture-only';
const timeoutMs=5000,maxOutputBytes=16384;

// A guard against accidental network use by this fixed experiment. This is not
// a general sandbox for arbitrary code. No experiment accepts user input.
function blockNetwork(require){
  let attempts=0;
  const blocked=()=>{attempts++;throw Error('Network use is disabled in this dependency experiment');};
  require('node:net').Socket.prototype.connect=blocked;
  require('node:net').Server.prototype.listen=blocked;
  require('node:dgram').Socket.prototype.send=blocked;
  globalThis.fetch=blocked;
  return ()=>attempts;
}

function fixedExperiment(){
  const require=createRequire(import.meta.url);
  const networkAttempts=blockNetwork(require);
  const express=require('express');
  const versions={express:require('express/package.json').version};

  // Lodash was removed: the server only needed a sort and a count. Confirm it
  // is not resolvable, so GHSA-p6mc-m468-83gw and its siblings cannot apply.
  let lodashInstalled=true;
  try{require.resolve('lodash');}catch{lodashInstalled=false;}

  // GHSA-qw6h-vgh9-j6wx family: nested query keys must not reach a prototype
  // through Express's own configured parser. Fixed input, harmless marker.
  const app=express();app.set('query parser','simple');
  const parsed=app.get('query parser fn')('__proto__['+marker+']='+markerValue+'&constructor[prototype]['+marker+']='+markerValue);
  const queryPolluted=Object.hasOwn(Object.prototype,marker)||({})[marker]!==undefined;
  delete Object.prototype[marker];
  const queryKeysLiteral=Object.keys(parsed).every(key=>typeof parsed[key]==='string');

  // Express's own regression case for GHSA-rv95-896h-c2vc, with reserved
  // .example names. Call location() with an inert receiver; nothing is served.
  // https://github.com/expressjs/express/security/advisories/GHSA-rv95-896h-c2vc
  const input='http://trusted.example\\@other.example';
  let location;
  express.response.location.call({set(name,value){
    if(name!=='Location')throw Error('Unexpected header in fixed experiment');
    location=value;return this;
  }},input);
  const inputHost=parseLegacyUrl(input,false,true).host;
  const locationHost=parseLegacyUrl(location,false,true).host;
  const redirectReproduced=inputHost!==locationHost;

  const reproduced=lodashInstalled||queryPolluted||!queryKeysLiteral||redirectReproduced;
  return {
    source:'LOCAL DEPENDENCY CHECK',hardwareEvidence:false,
    scope:'Fixed library calls in a fresh process; no server, browser, Bluetooth, or navigation.',
    versions,networkAttempts:networkAttempts(),
    lodash:{case:'vulnerable utility library removed',advisory:'GHSA-p6mc-m468-83gw',installed:lodashInstalled,reproduced:lodashInstalled},
    query:{case:'nested query keys stay literal strings',prototypePolluted:queryPolluted,keysLiteral:queryKeysLiteral,
      reproduced:queryPolluted||!queryKeysLiteral},
    express:{case:'location header keeps the parsed host',advisory:'GHSA-rv95-896h-c2vc',
      input,location,inputHost,locationHost,reproduced:redirectReproduced},
    reproduced,regressionCheckPassed:!reproduced,
    limitation:'Fixed checks for the advisories this project previously demonstrated. Use npm audit for the full dependency tree.'
  };
}

export function runDependencyLab(){
  // Do not inherit preload hooks or alternative package lookup paths into this
  // fixed child.
  const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
  const child=spawnSync(process.execPath,[filename,'--fixed-child'],{
    encoding:'utf8',env,timeout:timeoutMs,maxBuffer:maxOutputBytes,killSignal:'SIGKILL'
  });
  if(child.error)throw Error('Dependency experiment could not finish within its process/output limits: '+child.error.code);
  if(child.status!==0&&child.status!==2)throw Error('Dependency experiment failed: '+child.stderr.trim().slice(0,1000));
  const result=JSON.parse(child.stdout);
  return {...result,processLimits:{timeoutMs,maxOutputBytes}};
}

if(process.argv[1]&&resolve(process.argv[1])===filename){
  try{
    if(process.argv.length>3||(process.argv[2]&&process.argv[2]!=='--fixed-child'))throw Error('This experiment accepts no input or options');
    const report=process.argv[2]==='--fixed-child'?fixedExperiment():runDependencyLab();
    console.log(JSON.stringify(report,null,2));
    if(report.reproduced)process.exitCode=2;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
