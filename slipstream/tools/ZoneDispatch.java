import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.io.*;
import java.util.*;
public class ZoneDispatch extends GhidraScript {
 public void run() throws Exception {
  DecompInterface d=new DecompInterface();d.openProgram(currentProgram);
  Set<Function> chosen=new LinkedHashSet<>();
  try(PrintWriter out=new PrintWriter(getScriptArgs()[0])){
   Set<ghidra.program.model.address.Address> frontier=new LinkedHashSet<>();
   for(String address:new String[]{"00ecd568","00ecd5a8"})frontier.add(toAddr(address));
   for(int depth=0;depth<4;depth++){
    Set<ghidra.program.model.address.Address> next=new LinkedHashSet<>();
    for(ghidra.program.model.address.Address target:frontier){
     for(Reference r:currentProgram.getReferenceManager().getReferencesTo(target)){
      out.println("// REF depth="+depth+" target="+target+" from="+r.getFromAddress());
      Function caller=currentProgram.getFunctionManager().getFunctionContaining(r.getFromAddress());
      if(caller!=null && chosen.add(caller))next.add(caller.getEntryPoint());
     }
    }
    frontier=next;
   }
   for(Function f:chosen){out.println("\n// FUNCTION "+f.getEntryPoint()+" "+f.getName(true));DecompileResults r=d.decompileFunction(f,40,monitor);out.println(r.decompileCompleted()?r.getDecompiledFunction().getC():"FAILED");out.flush();}
  }finally{d.dispose();}
 }
}
