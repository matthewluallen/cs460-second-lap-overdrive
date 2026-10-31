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
  const express=require('express'),lodash=require('lodash');
  const versions={express:require('express/package.json').version,lodash:require('lodash/package.json').version};

  // GHSA-p6mc-m468-83gw: a path to constructor.prototype reaches the shared
  // prototype in this pinned release. The only value is a harmless fixed marker.
  // https://github.com/advisories/GHSA-p6mc-m468-83gw
  const prototypeBefore=Object.hasOwn(Object.prototype,marker);
  if(prototypeBefore)throw Error('Expected a clean child-process prototype');
  let prototypeDuring,inheritedValue,freshObjectOwnMarker;
  try{
    lodash.zipObjectDeep(['constructor.prototype.'+marker],[markerValue]);
    prototypeDuring=Object.hasOwn(Object.prototype,marker);
    const fresh={};inheritedValue=fresh[marker]??null;
    freshObjectOwnMarker=Object.hasOwn(fresh,marker);
  }finally{delete Object.prototype[marker];}
  const prototypeAfter=Object.hasOwn(Object.prototype,marker);

  // Adapted from Express's actual fixed-release regression case, changing only
  // the domain names to reserved .example names. Call the installed location()
  // method with an inert header receiver; do not serve or follow a redirect.
  // https://github.com/expressjs/express/blob/04bc62787be974874bc1467b23606c36bc9779ba/test/res.location.js
  // https://github.com/expressjs/express/security/advisories/GHSA-rv95-896h-c2vc
  const input='http://trusted.example\\@other.example';
  let location;
  express.response.location.call({set(name,value){
    if(name!=='Location')throw Error('Unexpected header in fixed experiment');
    location=value;return this;
  }},input);
  const inputHost=parseLegacyUrl(input,false,true).host;
  const locationHost=parseLegacyUrl(location,false,true).host;

  return {
    source:'LOCAL DEPENDENCY EXPERIMENT',hardwareEvidence:false,
    scope:'Fixed library calls in a fresh process; no server, browser, Bluetooth, or navigation.',
    versions,networkAttempts:networkAttempts(),
    lodash:{case:'zipObjectDeep prototype marker',advisory:'GHSA-p6mc-m468-83gw',
      prototypeBefore,prototypeDuring,prototypeAfter,inheritedValue,freshObjectOwnMarker,
      reproduced:prototypeDuring&&inheritedValue===markerValue&&!freshObjectOwnMarker&&!prototypeAfter},
    express:{case:'location header changes parsed host',advisory:'GHSA-rv95-896h-c2vc',
      input,location,inputHost,locationHost,reproduced:inputHost==='trusted.example'&&locationHost==='other.example'},
    limitation:'These library cases do not prove that ordinary platform endpoints expose either advisory. Other installed advisories are not exercised.'
  };
}

export function runDependencyLab(){
  // Do not inherit preload hooks or alternative package lookup paths into this
  // fixed child. Importing this module never loads the vulnerable dependencies.
  const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
  const child=spawnSync(process.execPath,[filename,'--fixed-child'],{
    encoding:'utf8',env,timeout:timeoutMs,maxBuffer:maxOutputBytes,killSignal:'SIGKILL'
  });
  if(child.error)throw Error('Dependency experiment could not finish within its process/output limits: '+child.error.code);
  if(child.status!==0)throw Error('Dependency experiment failed: '+child.stderr.trim().slice(0,1000));
  const result=JSON.parse(child.stdout);
  return {...result,processLimits:{timeoutMs,maxOutputBytes}};
}

if(process.argv[1]&&resolve(process.argv[1])===filename){
  try{
    if(process.argv.length>3||(process.argv[2]&&process.argv[2]!=='--fixed-child'))throw Error('This experiment accepts no input or options');
    console.log(JSON.stringify(process.argv[2]==='--fixed-child'?fixedExperiment():runDependencyLab(),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
