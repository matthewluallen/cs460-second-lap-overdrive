import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import java.io.*;
public class InspectStartupAssembly extends GhidraScript {
 public void run() throws Exception {
  try(PrintWriter out=new PrintWriter(getScriptArgs()[0])) {
   for(long address:new long[]{0x7aff3c,0x7b8d30,0x6ac3d4}) {
   Function f=getFunctionAt(toAddr(address));
   InstructionIterator it=currentProgram.getListing().getInstructions(f.getBody(),true);
   while(it.hasNext()){Instruction i=it.next();out.println(i.getAddress()+" "+i);}
   }
  }
 }
}
