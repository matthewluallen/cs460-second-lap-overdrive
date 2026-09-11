// Browser-local assignment hints only. A remembered ID is not physical-car proof.
// Callers must render these strings as text and still confirm the assigned kit.
export const CAR_LABELS_KEY='second-lap-car-labels-v1';
const MAX_ENTRIES=32,MAX_ID=256,MAX_NAME=128,MAX_LABEL=80,MAX_BYTES=32*1024;
const controls=/[\u0000-\u001f\u007f-\u009f]/;

function record(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.getPrototypeOf(value)!==Object.prototype)return false;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length===keys.length&&keys.every(key=>
    Object.hasOwn(descriptors,key)&&Object.hasOwn(descriptors[key],'value'));
}
function browserId(value){
  if(typeof value!=='string'||!value.trim()||value.length>MAX_ID||controls.test(value))
    throw Error('Use a nonempty browser device ID of at most 256 characters without control characters');
  return value; // Opaque: do not trim, case-fold or substitute the model name.
}
function name(value){
  if(typeof value!=='string'||value.length>MAX_NAME||controls.test(value))
    throw Error('Use a browser device name of at most 128 characters without control characters');
  return value;
}
function label(value){
  if(typeof value!=='string')throw Error('Use a text car label of 1–80 characters');
  const clean=value.trim();
  if(!clean||clean.length>MAX_LABEL||controls.test(clean))
    throw Error('Use a car label of 1–80 characters without control characters');
  return clean;
}
function withinSize(text){
  return typeof text==='string'&&text.length<=MAX_BYTES&&
    new TextEncoder().encode(text).byteLength<=MAX_BYTES;
}
function decode(text){
  if(!withinSize(text))throw Error('saved JSON exceeds the 32 KiB limit');
  const saved=JSON.parse(text);
  if(!record(saved,['version','entries'])||saved.version!==1||!Array.isArray(saved.entries))
    throw Error('saved JSON has an invalid schema');
  if(saved.entries.length>MAX_ENTRIES)throw Error('saved registry exceeds 32 cars');
  const rows=new Map(),labels=new Set();
  for(const item of saved.entries){
    if(!record(item,['browserId','name','label']))throw Error('saved car entry has an invalid schema');
    const row={browserId:browserId(item.browserId),name:name(item.name),label:label(item.label)};
    if(row.label!==item.label)throw Error('saved car labels must be trimmed');
    const key=row.label.toLowerCase();
    if(rows.has(row.browserId)||labels.has(key))throw Error('saved car IDs or labels are duplicated');
    rows.set(row.browserId,row);labels.add(key);
  }
  return rows;
}

export class CarLabels {
  #storage;
  #rows=new Map();
  #warning='';
  #backingText;
  #snapshotReady=false;
  constructor(storage){
    this.#storage=storage;
    let saved;
    try{
      if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')
        throw Error('Storage unavailable');
      saved=storage.getItem(CAR_LABELS_KEY);
    }catch{
      this.#warning='Saved car labels are unavailable: browser storage could not be read.';
      return;
    }
    this.#backingText=saved;this.#snapshotReady=true;
    if(saved===null)return;
    try{this.#rows=decode(saved);}
    catch{
      this.#warning='Saved car labels were not loaded: the stored data is invalid or exceeds its limits. Saving a label will replace that invalid registry.';
    }
  }
  get warning(){return this.#warning;}
  entries(){return [...this.#rows.values()].map(row=>({...row}));}
  find(id){const row=this.#rows.get(id);return row?{...row}:null;}
  remember(selection,assignedLabel){
    if(!record(selection,['browserId','name']))throw Error('Use the selected browser device ID and name');
    const row={browserId:browserId(selection.browserId),name:name(selection.name),label:label(assignedLabel)};
    for(const existing of this.#rows.values()){
      if(existing.browserId!==row.browserId&&existing.label.toLowerCase()===row.label.toLowerCase())
        throw Error('That car label already belongs to another browser device ID; choose a different label or forget the old mapping');
    }
    if(!this.#rows.has(row.browserId)&&this.#rows.size>=MAX_ENTRIES)
      throw Error('The saved car registry is full (32 cars); forget an old mapping before adding another');
    const next=new Map(this.#rows);next.set(row.browserId,row);
    this.#save(next);
    return {...row};
  }
  forget(id){
    browserId(id);
    if(!this.#rows.has(id))return false;
    const next=new Map(this.#rows);next.delete(id);
    this.#save(next);
    return true;
  }
  #save(next){
    const serialized=JSON.stringify({version:1,entries:[...next.values()]});
    if(!withinSize(serialized))throw Error('Saved car labels would exceed the 32 KiB storage limit; shorten labels or forget an old mapping');
    let current;
    try{
      if(!this.#snapshotReady)throw Error('No initial storage snapshot');
      current=this.#storage.getItem(CAR_LABELS_KEY);
    }catch{
      this.#warning='Car labels could not be saved: browser storage could not be checked. Disconnect and reload before saving; no labels were changed.';
      throw Error(this.#warning);
    }
    if(current!==this.#backingText){
      this.#warning='Car labels changed in another tab; disconnect and reload before saving. No labels were changed.';
      throw Error(this.#warning);
    }
    // Detect already-stale tabs without merging conflicting assignments. This
    // read/check/write is not an atomic transaction across simultaneous tabs.
    try{
      if(!this.#storage||typeof this.#storage.setItem!=='function')throw Error('Storage unavailable');
      this.#storage.setItem(CAR_LABELS_KEY,serialized);
    }catch{
      this.#warning='Car labels could not be saved: browser storage may be blocked or full. No labels were changed.';
      throw Error(this.#warning);
    }
    this.#rows=next;this.#backingText=serialized;this.#warning='';
  }
}
