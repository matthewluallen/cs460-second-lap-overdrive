// Browser scheduling observations, not sensor/radio timestamps. Monitoring
// cannot run while the host is suspended; motion deadlines live in Game/Car.
export class HostTiming {
  constructor(expectedIntervalMs=40) {
    this.previous=null;
    this.value={expectedIntervalMs,samples:0,lastGapMs:null,maxGapMs:0,over100Ms:0,over500Ms:0,over1000Ms:0,clockResets:0};
  }
  observe(now) {
    if(!Number.isFinite(now))return;
    if(this.previous!==null) {
      const gap=now-this.previous;
      if(gap<0)this.value.clockResets++;
      else {
        this.value.samples++;this.value.lastGapMs=gap;this.value.maxGapMs=Math.max(this.value.maxGapMs,gap);
        for(const threshold of [100,500,1000])if(gap>threshold)this.value['over'+threshold+'Ms']++;
      }
    }
    this.previous=now;
  }
  snapshot(){return {...this.value};}
}
