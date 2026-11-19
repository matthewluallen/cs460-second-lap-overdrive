// Presentation of the existing host arming gates. This never sends commands.
const label=driver=>String(driver.car?.name||'Car '+driver.id).slice(0,64);
export function drivingReadiness(game,{countdown=null,now=0}={}) {
  const drivers=game.drivers??[],active=drivers.filter(d=>d.car.connected&&d.control!=='none');
  const blockers=[],notes=[];
  if(game.pitReason)blockers.push('Clear the pit first: '+String(game.pitReason).slice(0,200));
  if(countdown)blockers.push('Countdown in progress. Wait for GO.');
  if(game.phase==='scanning')blockers.push('Track scan in progress. Wait for the car to finish and check the map.');
  if(game.diagnostic||game.forwardBaseline||game.laneCancellationComparison)blockers.push('A vehicle check is in progress. Finish it before starting normal driving.');
  if(!active.length) {
    if(!drivers.length)blockers.push('Connect a car, then choose Drive here or Phone / QR.');
    else {
      for(const d of drivers)blockers.push(label(d)+': '+(!d.car.connected?'disconnected; reconnect the car.':'parked; choose Drive here or Phone / QR.'));
    }
  }
  if(!game.track)blockers.push('Scan the track, or load and check your saved map.');
  for(const d of active){
    const c=d.car,name=label(d);
    if(c.initializing)blockers.push(name+': connection is still initializing.');
    if(c.faulted)blockers.push(name+': connection fault; reconnect before driving.');
    if(c.safetyReason&&c.safetyReason!=='Host stopped')blockers.push(name+': '+String(c.safetyReason).slice(0,160)+'. Resolve this stop first.');
    if(d.control==='phone'&&!d.pad)blockers.push(name+': waiting for a phone. Scan its QR and choose Let in on this laptop.');
    if(!c.simulated) {
      if(!c.model)notes.push(name+': select the model and match its LED color to the physical car.');
      const age=Number.isFinite(c.telemetry?.batteryAt)?now-c.telemetry.batteryAt:Infinity;
      if(!Number.isFinite(c.millivolts)||age<0||age>30000)notes.push(name+': battery reading is missing or old; refresh it while stopped.');
      if(c.status?.onCharger)notes.push(name+': reports charging; place it on the printed track before starting.');
    }
  }
  const gatesClear=blockers.length===0;
  return {ready:!!game.halted&&gatesClear,state:!game.halted&&gatesClear?'enabled':gatesClear?'ready':'waiting',
    title:!game.halted&&gatesClear?'Driving enabled':gatesClear?'Ready to start':'Before you start',blockers,notes,
    instruction:!game.halted&&gatesClear?'Apply throttle or hold the phone’s drive button. Release or brake to request a stop.':gatesClear?'Check the physical track is clear, then choose Start driving.':'Complete the items below. Pairing alone never starts a car.'};
}
