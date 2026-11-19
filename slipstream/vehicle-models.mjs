// Presentation aliases only. Keep protocol IDs, source config and loadouts intact.
// F&F build403 vehicleTypes.json: 18 Mammoth/name_localized International MXT;
// 19 Dynamo/name_localized Ice Charger. See review/FAST-FURIOUS-CAR-COMPATIBILITY.md.
const EDITION_NAMES=Object.freeze({
  18:Object.freeze({source:'Mammoth',physical:'International MXT'}),
  19:Object.freeze({source:'Dynamo',physical:'Ice Charger'})
});
export function vehicleModelName(models,model) {
  const entry=models[String(model)];
  if(!entry)return 'Unknown';
  const edition=EDITION_NAMES[model];
  return edition&&entry.name===edition.source?edition.physical+' / '+edition.source:entry.name;
}
