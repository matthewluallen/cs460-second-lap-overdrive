import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;
/** Read-only targeted export; proprietary output remains outside the repository. */
public class ExportCollisionHandling extends GhidraScript {
 public void run() throws Exception {
  DecompInterface d=new DecompInterface();d.openProgram(currentProgram);
  try(PrintWriter out=new PrintWriter(getScriptArgs()[0])){
   FunctionIterator it=currentProgram.getFunctionManager().getFunctions(true);
   while(it.hasNext()){
    Function f=it.next();String n=f.getName(true);
    if(!n.startsWith("BaseStation::") || !n.toLowerCase().contains("collision") || f.isThunk())continue;
    out.println("\n// FUNCTION "+f.getEntryPoint()+" "+n);
    DecompileResults r=d.decompileFunction(f,45,monitor);
    out.println(r.decompileCompleted()?r.getDecompiledFunction().getC():"// FAILED "+r.getErrorMessage());out.flush();
   }
  }finally{d.dispose();}
 }
}
