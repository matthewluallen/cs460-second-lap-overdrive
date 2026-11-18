import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;
public class ExportPowerZoneFlow extends GhidraScript {
 public void run() throws Exception {
  DecompInterface d=new DecompInterface();d.openProgram(currentProgram);
  try(PrintWriter out=new PrintWriter(getScriptArgs()[0])){
   out.println("// Program: "+currentProgram.getName()+" image base "+currentProgram.getImageBase());
   FunctionIterator it=currentProgram.getFunctionManager().getFunctions(true);
   while(it.hasNext()){
    Function f=it.next();String n=f.getName(true);
    boolean chosen=n.matches(".*(ProcessZoneFxUpdate|handleZoneFx|IfAllowedApplyJustGotHacked|IsPieceAnyType).* ".trim()) || f.getEntryPoint().toString().equals("007b9a48");
    if(!chosen){for(ghidra.program.model.symbol.Reference ref:currentProgram.getReferenceManager().getReferencesFrom(f.getEntryPoint())){} }
    if(!chosen){for(Function called:f.getCalledFunctions(monitor)){String cn=called.getName(true);if(cn.matches(".*(HandleZoneFxSupercode|ResetZoneTrigger|ProcessZoneFxUpdate|ZoneFxZoneAction::Trigger).*")){chosen=true;break;}}}
    if(!chosen)continue;
    out.println("\n// FUNCTION "+f.getEntryPoint()+" "+n);
    DecompileResults r=d.decompileFunction(f,30,monitor);
    out.println(r.decompileCompleted()?r.getDecompiledFunction().getC():"// FAILED "+r.getErrorMessage());out.flush();
   }
  }finally{d.dispose();}
 }
}
