import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;
public class ExportOffsetDiscovery extends GhidraScript {
 public void run() throws Exception {
  DecompInterface decomp = new DecompInterface(); decomp.openProgram(currentProgram);
  int selected=0, completed=0, failed=0;
  try (PrintWriter out = new PrintWriter(getScriptArgs()[0])) {
   out.println("// Image base: " + currentProgram.getImageBase());
   FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
   while(it.hasNext() && !monitor.isCancelled()) {
    Function f=it.next(); String name=f.getName(true);
    if (!name.matches(".*(TrackDiscoveryBehaviorScript::.*|CarMsgSetOffsetFromRoadCenter::.*|CarMsgOffsetFromRoadCenterUpdate::.*|VehicleMessenger::SendSetOffsetFromRoadCenterCommand|Localization::ProcessLocationUpdateMessage).*")) continue;
    if (name.contains("std::") && !name.startsWith("BaseStation::")) continue;
    selected++;
    out.println("\n// FUNCTION " + f.getEntryPoint()+" "+name);
    for (Function caller: f.getCallingFunctions(monitor)) out.println("// CALLER " + caller.getEntryPoint()+" "+caller.getName(true));
    for (Function callee: f.getCalledFunctions(monitor)) out.println("// CALLS " + callee.getEntryPoint()+" "+callee.getName(true));
    DecompileResults r=decomp.decompileFunction(f,20,monitor);
    if (r.decompileCompleted()) { completed++; out.println(r.getDecompiledFunction().getC()); }
    else { failed++; out.println("// FAILED "+r.getErrorMessage()); }
    if (f.getEntryPoint().getOffset()==0x82fd30 || f.getEntryPoint().getOffset()==0x6ac9e4) {
     out.println("// ASSEMBLY CHECK " + f.getEntryPoint());
     InstructionIterator instructions=currentProgram.getListing().getInstructions(f.getBody(),true);
     while(instructions.hasNext()){Instruction instruction=instructions.next();out.println("// "+instruction.getAddress()+" "+instruction);}
    }
    out.flush();
   }
   out.println("// COVERAGE selected="+selected+" completed="+completed+" failed="+failed+" cancelled="+monitor.isCancelled());
  } finally { decomp.dispose(); }
 }
}
