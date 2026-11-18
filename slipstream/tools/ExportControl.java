import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;
public class ExportControl extends GhidraScript {
 public void run() throws Exception {
  DecompInterface decomp = new DecompInterface(); decomp.openProgram(currentProgram);
  PrintWriter out = new PrintWriter(getScriptArgs()[0]);
  FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
  while(it.hasNext() && !monitor.isCancelled()) {
   Function f=it.next(); String name=f.getName(true);
   if ((name.contains("CarMsg") && (name.contains("GetBytes") || name.contains("Parse") || name.contains("FromBuffer") || f.getName().startsWith("CarMsg") || name.matches(".*CarMsg.*C[12]E.*") || name.contains("ToString"))) || name.contains("CarComms") || name.matches(".*(KeepAlive|Heartbeat|SkipAutoDriveInDeloc|SetMaxDelocSpeed).*")) {
    disassemble(f.getEntryPoint());
    out.println("\n// FUNCTION " + f.getEntryPoint()+" "+name);
    DecompileResults r=decomp.decompileFunction(f,30,monitor);
    out.println(r.decompileCompleted()?r.getDecompiledFunction().getC():"// FAILED "+r.getErrorMessage()); out.flush();
   }
  }
  out.close(); decomp.dispose();
 }
}
