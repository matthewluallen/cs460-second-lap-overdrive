import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;
public class ExportVehicleLifecycle extends GhidraScript {
 public void run() throws Exception {
  DecompInterface d=new DecompInterface();d.openProgram(currentProgram);
  String[] addresses={"007a9b94","007a9c04","007a9ce8","007a9d28","00799ca4","0082deae","007b24b0","006e970e","006e973c","007b50cc","007b4c3a"};
  try(PrintWriter out=new PrintWriter(getScriptArgs()[0])){
   out.println("// Read-only lifecycle export: "+currentProgram.getName());
   for(String address:addresses){Function f=getFunctionAt(toAddr(address));if(f==null){out.println("// MISSING "+address);continue;}
    out.println("\n// FUNCTION "+f.getEntryPoint()+" "+f.getName(true));
    DecompileResults r=d.decompileFunction(f,45,monitor);
    out.println(r.decompileCompleted()?r.getDecompiledFunction().getC():"// FAILED "+r.getErrorMessage());out.flush();
   }
   FunctionIterator it=currentProgram.getFunctionManager().getFunctions(true);
   while(it.hasNext()){
    Function f=it.next();String n=f.getName(true);
    if(!n.matches("BaseStation::(Vehicle::(ChangeSpeed|ExecuteLastDrivingIntention)|ActionArbiter::(Update|AddFilter|RemoveFilter|.*Action.*)|VehicleDrivingInterface::(RequestSpeed|RequestLaneChange)|Filter::(SetSpeed|SetVehicleBayStatus))"))continue;
    out.println("\n// FUNCTION "+f.getEntryPoint()+" "+n);
    DecompileResults r=d.decompileFunction(f,45,monitor);
    out.println(r.decompileCompleted()?r.getDecompiledFunction().getC():"// FAILED "+r.getErrorMessage());out.flush();
   }
  }finally{d.dispose();}
 }
}
