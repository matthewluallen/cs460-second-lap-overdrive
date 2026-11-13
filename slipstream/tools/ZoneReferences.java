import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.io.*;
import java.util.*;
public class ZoneReferences extends GhidraScript {
 public void run() throws Exception {
  DecompInterface d=new DecompInterface();d.openProgram(currentProgram);
  Set<Function> chosen=new LinkedHashSet<>();
  try(PrintWriter out=new PrintWriter(getScriptArgs()[0])){
   FunctionIterator it=currentProgram.getFunctionManager().getFunctions(true);
   while(it.hasNext()){
    Function f=it.next();String n=f.getName(true);
    if(!n.matches(".*(HandleZoneFxSupercode|ResetZoneTrigger|ProcessZoneFxUpdate|SendEnableSpecificV2BMessages).*"))continue;
    for(Reference r:currentProgram.getReferenceManager().getReferencesTo(f.getEntryPoint())){
     out.println("// REF "+n+" "+r.getFromAddress()+" "+r.getReferenceType());
     Function caller=currentProgram.getFunctionManager().getFunctionContaining(r.getFromAddress());if(caller!=null)chosen.add(caller);
    }
   }
   for(Function f:chosen){out.println("\n// FUNCTION "+f.getEntryPoint()+" "+f.getName(true));DecompileResults r=d.decompileFunction(f,40,monitor);out.println(r.decompileCompleted()?r.getDecompiledFunction().getC():"FAILED");out.flush();}
  }finally{d.dispose();}
 }
}
