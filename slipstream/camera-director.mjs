// Presentation only. Camera and commentary cannot send commands to a car.
import {trustedCarPose} from './render.mjs';
import {pointOn} from './track.mjs';

export const CAMERA_VIEWS = Object.freeze([
  ['orbit','Circuit overview'], ['chase','Chase cam'], ['driver','Driver view'],
  ['trackside','Trackside'], ['director','Auto director']
]);
const names=Object.fromEntries(CAMERA_VIEWS);
const finitePose=p=>p&&[p.x,p.y,p.heading].every(Number.isFinite);
export function cameraCar(cars, wantedId=0) {
  if(wantedId) return cars.find(c=>c.id===wantedId)??null;
  return cars.find(c=>trustedCarPose(c)&&c.speed>0)??cars.find(c=>trustedCarPose(c))??cars[0]??null;
}
export function followFrame(view, pose, piece) {
  if(!finitePose(pose)||!['chase','driver','trackside'].includes(view))return null;
  const x=pose.x/1000,z=-pose.y/1000,h=pose.heading,fx=Math.cos(h),fz=-Math.sin(h);
  if(view==='driver')return {position:[x+fx*.022,.074,z+fz*.022],target:[x+fx*.32,.025,z+fz*.32],fov:72};
  if(view==='chase')return {position:[x-fx*.32,.25,z-fz*.32],target:[x+fx*.14,.035,z+fz*.14],fov:57};
  // A stationary camera beside the current section; only its gaze tracks the car.
  const anchor=piece?.start&&Number.isFinite(piece.length)?pointOn(piece,.5,piece.turn>0?-360:360):null;
  const a=anchor&&[anchor.x,anchor.y].every(Number.isFinite)?[anchor.x/1000,-anchor.y/1000]:[x+Math.sin(h)*.38,z+Math.cos(h)*.38];
  return {position:[a[0],.18,a[1]],target:[x,.035,z],fov:64};
}
export class CameraDirector {
  constructor(){this.shot='chase';this.since=-Infinity;this.carId=null;this.mode=null;this.section=null;}
  update({mode='orbit',car=null,track=null,now=0,reducedMotion=false}={}) {
    if(!names[mode])mode='orbit';
    const pose=trustedCarPose(car??{}),piece=pose&&track?.pieces?.[pose.index];
    if(reducedMotion||mode==='orbit'||!pose) {
      this.since=-Infinity;this.carId=car?.id??null;this.mode=mode;this.section=null;
      return {view:'orbit',label:reducedMotion&&mode!=='orbit'?'Overview · reduced motion':names.orbit,carId:car?.id??null,frame:null,reason:!pose&&mode!=='orbit'?'Waiting for a fresh car position':null};
    }
    const desired=piece?.kind==='curve'?'trackside':piece?.kind==='finish'||piece?.kind==='start'?'driver':'chase';
    if(mode==='director'){
      const changed=this.mode!==mode||this.carId!==car.id;
      if(changed||now<this.since||!Number.isFinite(this.since)||(now-this.since>=5000&&pose.index!==this.section)){
        this.shot=desired;this.since=now;this.section=pose.index;
      }
    }else this.shot=mode;
    this.carId=car.id;this.mode=mode;
    return {view:this.shot,label:(mode==='director'?'Director · ':'')+names[this.shot],carId:car.id,frame:followFrame(this.shot,pose,piece),reason:null};
  }
}

export class DriveNarrator {
  constructor(){this.key='';this.lastAt=-Infinity;this.previous=new Map();}
  update({car=null,track=null,now=0,halted=false}={}) {
    const name=String(car?.name??'Your car').slice(0,48);
    const previous=car&&this.previous.get(car.id),pose=trustedCarPose(car??{}),piece=pose&&track?.pieces?.[pose.index];
    let key,text,urgent=false;
    if(!car){key='empty';text='Connect a car, scan the circuit, then choose your view.';}
    else if(halted||car.safetyReason){key=`stop:${car.id}:${car.safetyReason??''}`;text=`${name}: STOP requested. Check the physical car before resuming.`;urgent=true;}
    else if(!pose){key=`unknown:${car.id}`;text=`${name}: waiting for a fresh track reading. The camera returns to the circuit overview.`;urgent=true;}
    else if(previous&&car.laps>previous.laps){key=`lap:${car.id}:${car.laps}`;text=`${name} has reported ${car.laps} complete ${car.laps===1?'lap':'laps'}.`;urgent=true;}
    else {
      const place=piece?.id===57?'entered the Power Zone':piece?.kind==='curve'?'entered the curve':piece?.kind==='start'||piece?.kind==='finish'?'passed start / finish':'entered a straight';
      key=`section:${car.id}:${pose.index}:${place}`;
      text=`${name} ${place}.`+(Number.isFinite(car.speed)&&car.speed>0?` Displayed pace: ${Math.round(car.speed)} mm/s.`:'');
    }
    if(car)this.previous.set(car.id,{laps:car.laps??0});
    if(key===this.key||(!urgent&&now-this.lastAt<4500))return null;
    this.key=key;this.lastAt=now;
    return {key,text,urgent};
  }
}
