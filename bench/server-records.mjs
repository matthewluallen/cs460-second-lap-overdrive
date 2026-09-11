// Explicit shared MOCK store. This adapter never addresses a car or sends traces.
export class ServerRecords {
  constructor(request=(...args)=>globalThis.fetch(...args)){this.request=request;}
  async call(path,options={}){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),5000);
    let rejectionKnown=false;
    try{
      const response=await this.request('/api/support/'+path,{...options,signal:controller.signal,cache:'no-store'});
      let data;
      try{data=await response.json();}catch(error){
        if(error.name==='AbortError')throw error;
        throw Error('Platform records unavailable. Start the Node platform server or choose tab records.');
      }
      if(!response.ok){rejectionKnown=true;throw Error(data.error||'Platform records request failed');}
      if(data.source!=='MOCK')throw Error('Unexpected records source; no result accepted');
      return data;
    }catch(error){
      if(options.method==='POST'&&!rejectionKnown&&error.name!=='AbortError'){
        throw Error(error.message+'; addition outcome unknown. Check records before retrying.');
      }
      throw error;
    }finally{clearTimeout(timeout);}
  }
  async list(operator){return (await this.call('records?operator='+encodeURIComponent(operator))).records;}
  async read(operator,id){return (await this.call('records/'+encodeURIComponent(id)+'?operator='+encodeURIComponent(operator))).record;}
  async add(operator,workgroup,note){return (await this.call('records',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operator,workgroup,note})
  })).record;}
  async summary(operator){return (await this.call('summary?operator='+encodeURIComponent(operator))).groups;}
}
