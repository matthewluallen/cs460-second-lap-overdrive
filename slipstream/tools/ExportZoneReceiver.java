import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;
public class ExportZoneReceiver extends GhidraScript {
 public void run() throws Exception {
  DecompInterface d=new DecompInterface();d.openProgram(currentProgram);
  try(PrintWriter out=new PrintWriter(getScriptArgs()[0])){
   out.println("// Program: "+currentProgram.getName()+" image base "+currentProgram.getImageBase());
   FunctionIterator it=currentProgram.getFunctionManager().getFunctions(true);
   while(it.hasNext()){
    Function f=it.next();String n=f.getName(true);
    if(!n.matches(".*(Vehicle::.*(Receive|Message)|VehicleConnection::.*(Receive|Message)|EnableSpecificV2B|ResetZoneTrigger).*"))continue;
    out.println("\n// FUNCTION "+f.getEntryPoint()+" "+n);
    DecompileResults r=d.decompileFunction(f,30,monitor);
    out.println(r.decompileCompleted()?r.getDecompiledFunction().getC():"// FAILED "+r.getErrorMessage());out.flush();
   }
  }finally{d.dispose();}
 }
}
