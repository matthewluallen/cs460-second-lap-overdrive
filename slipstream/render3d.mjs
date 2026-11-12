// Original procedural scenery. The scene consumes telemetry; it never drives a car.
import * as THREE from './vendor/three.module.js';
import {pointOn, layout} from './track.mjs';

const color = rgb => new THREE.Color(...rgb);
export class Renderer3D {
  constructor(canvas, {onLost = () => {}} = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: 'low-power'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0x101a26); this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.4;
    this.scene = new THREE.Scene(); this.scene.fog = new THREE.Fog(0x101a26, 8, 22);
    this.scene.add(new THREE.HemisphereLight(0xc7e8ff, 0x17202b, 2.5));
    const key = new THREE.DirectionalLight(0xffefdc, 3.5); key.position.set(2, 6, 3); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, {left:-8,right:8,top:8,bottom:-8,near:.1,far:30});
    key.shadow.bias = -.0005; this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x69cfff, 1.8); rim.position.set(-4, 3, -4); this.scene.add(rim);
    this.camera = new THREE.OrthographicCamera(-3,3,3,-3,.01,60);
    this.trackRoot = new THREE.Group(); this.scene.add(this.trackRoot);
    this.carRoot = new THREE.Group(); this.scene.add(this.carRoot); this.carMeshes = new Map();
    this.objectiveRoot = new THREE.Group(); this.scene.add(this.objectiveRoot); this.objectiveKey = null;
    this.effectRoot = new THREE.Group(); this.scene.add(this.effectRoot); this.effects = [];
    this.azimuth = .25; this.pitch = .95; this.zoom = 1; this.center = new THREE.Vector3(); this.span = 3;
    this.lastFrame = -Infinity; this.shapeKey = ''; this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); onLost(); });
    let pointer = null;
    canvas.addEventListener('pointerdown', e => { if (e.button !== 0) return; pointer = {id:e.pointerId,x:e.clientX,y:e.clientY}; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => { if (!pointer || pointer.id !== e.pointerId) return; this.azimuth -= (e.clientX-pointer.x)*.006; this.pitch = THREE.MathUtils.clamp(this.pitch+(e.clientY-pointer.y)*.004,.3,1.5); pointer.x=e.clientX; pointer.y=e.clientY; });
    for (const event of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(event, () => { pointer=null; });
    canvas.addEventListener('keydown', e => { const moves={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,.1],ArrowDown:[0,-.1]}; if (moves[e.key]) { e.preventDefault(); e.stopPropagation(); this.azimuth+=moves[e.key][0]; this.pitch=THREE.MathUtils.clamp(this.pitch+moves[e.key][1],.3,1.5); } });
  }
  get available() { return !this.renderer.getContext().isContextLost(); }
  resetView() { this.azimuth=.25; this.pitch=.95; this.zoom=1; }
  setZoom(delta) { this.zoom=THREE.MathUtils.clamp(this.zoom+delta,.6,2.2); }
  #clear(group) { for (const child of [...group.children]) { child.traverse(o => { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach(m=>m.dispose()); else { o.material?.map?.dispose(); o.material?.dispose(); } }); group.remove(child); } }
  #mesh(geometry, material, parent=this.trackRoot) { const m=new THREE.Mesh(geometry,material); m.receiveShadow=true; parent.add(m); return m; }
  #ribbon(piece, a, b, from=0, to=1, tint=0x26303d, height=.025) {
    const vertices=[], steps=piece.turn?32:1;
    for(let i=0;i<steps;i++) {
      const lo=from+(to-from)*i/steps, hi=from+(to-from)*(i+1)/steps;
      const points=[pointOn(piece,lo,a),pointOn(piece,hi,a),pointOn(piece,lo,b),pointOn(piece,hi,a),pointOn(piece,hi,b),pointOn(piece,lo,b)];
      for(const p of points) vertices.push(p.x/1000,height,-p.y/1000);
    }
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)); g.computeVertexNormals();
    return this.#mesh(g,new THREE.MeshStandardMaterial({color:tint,roughness:.77,metalness:.12,side:THREE.DoubleSide}));
  }
  #build(shape) {
    this.#clear(this.trackRoot);
    if(!shape?.bounds) return;
    const b=shape.bounds; this.center.set((b.minX+b.maxX)/2000,0,-(b.minY+b.maxY)/2000);
    this.span=Math.max(.8,Math.hypot(b.maxX-b.minX,b.maxY-b.minY)/1000);
    const floor=this.#mesh(new THREE.PlaneGeometry(this.span*3,this.span*3),new THREE.MeshStandardMaterial({color:0x0b1420,roughness:.95}));
    floor.rotation.x=-Math.PI/2; floor.position.copy(this.center); floor.position.y=-.012;
    const grid=new THREE.GridHelper(this.span*3,40,0x355063,0x203442); grid.position.copy(this.center); grid.position.y=-.01; this.trackRoot.add(grid);
    for(const p of shape.pieces) {
      this.#ribbon(p,-109,109,0,1,0x0b1119,.015);
      this.#ribbon(p,-103,103,0,1,p.inferred?0x584631:0x293441,.025);
      for(const side of [-1,1]) this.#ribbon(p,side*96-1.7,side*96+1.7,0,1,0xb9d1d9,.026);
      for(const lane of [-45,0,45]) this.#ribbon(p,lane-.4,lane+.4,0,1,0x465868,.027);
      if(p.kind==='finish') for(let i=0;i<10;i++) for(let j=0;j<2;j++) this.#ribbon(p,-95+i*19,-76+i*19,.44+j*.07,.51+j*.07,(i+j)%2?0xdde6e5:0x101923,.029);
      if(p.kind==='intersection') this.#ribbon(p,-94,94,.44,.56,0xc89839,.029);
      if(p.kind==='jump'||p.kind==='landing') for(const t of [.35,.5,.65]) this.#ribbon(p,-75,75,t,t+.016,p.kind==='jump'?0xf7994a:0x66d9bf,.029);
    }
  }
  #car(row) {
    const group=new THREE.Group(), shell=new THREE.MeshStandardMaterial({color:color(row.color),metalness:.5,roughness:.3});
    const box=(w,h,d,mat,x,y,z)=>{const m=this.#mesh(new THREE.BoxGeometry(w,h,d),mat,group);m.position.set(x,y,z);m.castShadow=true;return m;};
    const length=row.truck ? .12 : .088;
    box(length,.018,.046,shell,0,.018,0);
    box(length*.43,.014,.034,new THREE.MeshStandardMaterial({color:0x162536,metalness:.65,roughness:.16}),-.007,.034,0);
    box(.008,.006,.038,new THREE.MeshStandardMaterial({color:0x101724}),-length*.45,.034,0);
    for(const x of [-length*.3,length*.3]) for(const z of [-.024,.024]) {
      const wheel=this.#mesh(new THREE.CylinderGeometry(.012,.012,.008,12),new THREE.MeshStandardMaterial({color:0x090e15,roughness:.8}),group);
      wheel.rotation.x=Math.PI/2;wheel.position.set(x,.013,z);wheel.castShadow=true;
    }
    for(const z of [-.014,.014]) {
      box(.003,.005,.009,new THREE.MeshStandardMaterial({color:0xe7fbff,emissive:0xb4e6ff,emissiveIntensity:1.3}),length/2,.022,z);
      box(.003,.004,.008,new THREE.MeshStandardMaterial({color:0xf54e61,emissive:0xf54e61,emissiveIntensity:.7}),-length/2,.022,z);
    }
    const ring=this.#mesh(new THREE.RingGeometry(.055,.059,36),new THREE.MeshBasicMaterial({color:color(row.color),side:THREE.DoubleSide,transparent:true,opacity:.7}),group);ring.rotation.x=-Math.PI/2;ring.position.y=.004;
    const sprite=this.#label(row.id);sprite.position.set(0,.15,0);group.add(sprite);
    const shield=this.#mesh(new THREE.SphereGeometry(.072,20,12),new THREE.MeshBasicMaterial({color:0x59c8ff,transparent:true,opacity:.18,depthWrite:false}),group);
    shield.scale.y=.65;shield.position.y=.023;shield.visible=false;
    const energyBack=new THREE.Sprite(new THREE.SpriteMaterial({color:0x101a26,depthTest:false}));energyBack.scale.set(.105,.015,1);energyBack.position.y=.112;energyBack.renderOrder=2;group.add(energyBack);
    const energy=new THREE.Sprite(new THREE.SpriteMaterial({color:0x5dff9b,depthTest:false}));energy.position.set(0,.112,.001);energy.renderOrder=3;group.add(energy);
    this.carRoot.add(group); return {group, shell, ring, shield, energy, model:row.model};
  }
  #label(text, tint='#eff8ff') {
    const label=document.createElement('canvas');label.width=Math.max(96,String(text).length*26+24);label.height=64;
    const context=label.getContext('2d');context.fillStyle='#101a26';context.fillRect(12,8,label.width-24,48);context.font='bold 38px system-ui';context.textAlign='center';context.fillStyle=tint;context.fillText(String(text),label.width/2,47);
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(label),transparent:true,depthTest:false}));sprite.scale.set(.09*label.width/96,.06,1);return sprite;
  }
  #spot(track, distance, lateral=0) {
    if(!track?.length||!Number.isFinite(distance))return null;
    const d=((distance%track.length)+track.length)%track.length;
    const p=track.pieces.find(p=>d>=p.start.distance&&d<p.start.distance+p.length);
    if(!p)return null;
    const q=pointOn(p,(d-p.start.distance)/p.length,lateral);
    return new THREE.Vector3(q.x/1000,.055,-q.y/1000);
  }
  #pulse(position, radius, tint, opacity) {
    const ring=this.#mesh(new THREE.TorusGeometry(radius,.004,4,36),new THREE.MeshBasicMaterial({color:tint,transparent:true,opacity,depthWrite:false}),this.effectRoot);
    ring.rotation.x=-Math.PI/2;ring.position.copy(position);
  }
  addEffect(e) { if (!this.reducedMotion) { this.effects.push({...e,born:performance.now()}); if(this.effects.length>80)this.effects.shift(); } }
  draw({track, partial, cars=[], now, objectives=[], mines=[]}) {
    if(now-this.lastFrame<1000/30)return;this.lastFrame=now;
    const shape=track??(partial?.length?layout(partial):null), key=JSON.stringify(shape?.pieces.map(p=>[p.id,p.reverse,p.turn,p.length,p.inferred]));
    if(key!==this.shapeKey){this.shapeKey=key;this.#build(shape);}
    const bounds=this.canvas.getBoundingClientRect();if(bounds.width<1||bounds.height<1)return;
    if(this.width!==bounds.width||this.height!==bounds.height){this.width=bounds.width;this.height=bounds.height;this.renderer.setSize(bounds.width,bounds.height,false);}
    const aspect=bounds.width/bounds.height, distance=this.span*1.7;
    this.camera.position.copy(this.center).add(new THREE.Vector3(Math.sin(this.azimuth)*Math.cos(this.pitch)*distance,Math.sin(this.pitch)*distance,Math.cos(this.azimuth)*Math.cos(this.pitch)*distance));this.camera.lookAt(this.center);this.camera.updateMatrixWorld();
    let halfWidth=this.span*.4, halfHeight=this.span*.3;
    if(shape?.bounds){const b=shape.bounds;halfWidth=0;halfHeight=0;for(const x of [b.minX,b.maxX])for(const y of [b.minY,b.maxY]){const p=new THREE.Vector3(x/1000,.03,-y/1000).applyMatrix4(this.camera.matrixWorldInverse);halfWidth=Math.max(halfWidth,Math.abs(p.x));halfHeight=Math.max(halfHeight,Math.abs(p.y));}}
    const half=Math.max(halfHeight+.09,(halfWidth+.09)/aspect)*1.12/this.zoom;
    this.camera.left=-half*aspect;this.camera.right=half*aspect;this.camera.top=half;this.camera.bottom=-half;this.camera.far=distance*3+20;this.camera.updateProjectionMatrix();
    this.scene.fog.near=distance+this.span*2;this.scene.fog.far=distance+this.span*5;
    const ids=new Set(cars.map(c=>c.id)), positions=new Map(), headings=new Map();
    for(const [id,entry] of this.carMeshes) if(!ids.has(id)){this.#clear(entry.group);this.carRoot.remove(entry.group);this.carMeshes.delete(id);}
    for(const row of cars){
      let m=this.carMeshes.get(row.id);if(m&&m.model!==row.model){this.#clear(m.group);this.carRoot.remove(m.group);this.carMeshes.delete(row.id);m=null;}
      if(!m){m=this.#car(row);this.carMeshes.set(row.id,m);}m.group.visible=!!row.pose;
      if(!row.pose)continue;
      m.group.position.set(row.pose.x/1000,.03,-row.pose.y/1000);m.group.rotation.y=row.pose.heading;
      m.shell.color.copy(row.disabled?new THREE.Color(0x614052):color(row.color));m.ring.material.opacity=row.located ? .75 : .2;
      m.shield.visible=!!row.shield;
      const energy=Number.isFinite(row.energy)?Math.max(0,Math.min(1,row.energy)):0;
      m.energy.scale.set(.1*energy,.009,1);m.energy.visible=energy>0;
      m.energy.material.color.set(energy<.33?0xff4d6d:energy<.66?0xffb84d:0x5dff9b);
      positions.set(row.id,m.group.position.clone());headings.set(row.id,row.pose.heading);
    }
    this.#clear(this.effectRoot);
    this.effects=this.effects.filter(e=>now-e.born<(e.life??350));
    for(const e of this.effects){
      const a=positions.get(e.from),b=positions.get(e.to),car=positions.get(e.car);
      const age=Math.max(0,(now-e.born)/(e.life??350)),fade=1-age;
      if(e.type==='beam'&&a&&b){
        const g=new THREE.BufferGeometry().setFromPoints([a.clone().add(new THREE.Vector3(0,.04,0)),b.clone().add(new THREE.Vector3(0,.04,0))]);
        this.effectRoot.add(new THREE.Line(g,new THREE.LineBasicMaterial({color:e.color??0xeaffaa,transparent:true,opacity:fade})));
      }else if((e.type==='shot'||e.type==='tracer')&&a){
        const heading=headings.get(e.from),reach=Math.min(2,Math.max(0,e.length??.7))*(e.type==='tracer'?.6:1);
        const start=a.clone().add(new THREE.Vector3(0,.04,0)),end=start.clone().add(new THREE.Vector3(Math.cos(heading)*reach,0,-Math.sin(heading)*reach));
        this.effectRoot.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([start,end]),new THREE.LineBasicMaterial({color:e.color??0xffd34d,transparent:true,opacity:fade})));
      }else if(['burst','pulse','horn','rage'].includes(e.type)&&a){
        this.#pulse(a.clone().add(new THREE.Vector3(0,.025,0)),.04+Math.min(1,e.radius??.3)*age,e.color??0xffb84d,fade);
      }else{
        const position=e.type==='explosion'?(this.#spot(track,e.distance,e.lateral)??car):car;
        const tint={explosion:0xffb84d,disabled:0xff6577,blocked:0x59c8ff,hit:0xff6577,crash:0xff6577,recovered:0x5dff9b,assist:0xc1f594}[e.type];
        if(position&&tint)this.#pulse(position.clone().add(new THREE.Vector3(0,.025,0)),.065+age*(e.type==='explosion'?.22:.08),tint,fade);
      }
    }
    // Cache mission labels rather than allocating canvas textures every frame.
    const objectiveKey=JSON.stringify([this.shapeKey,!!track,objectives]);
    if(objectiveKey!==this.objectiveKey){
      this.objectiveKey=objectiveKey;this.#clear(this.objectiveRoot);
      const gates=new Map();
      if(track)for(const o of objectives){
        if(!Number.isFinite(o.progress))continue;
        const progress=((o.progress%1)+1)%1,key=progress.toFixed(6);
        if(!gates.has(key))gates.set(key,{progress,labels:[]});
        gates.get(key).labels.push(String(o.label));
      }
      for(const o of gates.values()){const q=this.#spot(track,o.progress*track.length);if(!q)continue;
        const marker=this.#mesh(new THREE.TorusGeometry(.075,.004,4,28),new THREE.MeshBasicMaterial({color:0xc1f594}),this.objectiveRoot);marker.rotation.x=-Math.PI/2;marker.position.copy(q);
        const label=this.#label(o.labels.join('·'),'#c1f594');label.position.copy(q).add(new THREE.Vector3(0,.11,0));this.objectiveRoot.add(label);
      }
    }
    if(track)for(const mine of mines){const p=track.pieces.find(p=>mine.distance>=p.start.distance&&mine.distance<p.start.distance+p.length);if(!p)continue;const q=pointOn(p,(mine.distance-p.start.distance)/p.length,mine.lateral);
      const m=this.#mesh(new THREE.CylinderGeometry(.025,.035,.012,12),new THREE.MeshStandardMaterial({color:now>=mine.armedAt?0xff6577:0x88636d,emissive:0x5f1328}),this.effectRoot);m.position.set(q.x/1000,.04,-q.y/1000);}
    this.renderer.render(this.scene,this.camera);
  }
  dispose(){this.#clear(this.trackRoot);this.#clear(this.carRoot);this.#clear(this.effectRoot);this.#clear(this.objectiveRoot);this.renderer.dispose();}
}
