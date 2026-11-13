import ghidra.app.script.GhidraScript;
import java.io.*;
public class DumpMxtInitialization extends GhidraScript {
 public void run() throws Exception {
  long[][] refs={{0x88abf0,0x88abc0,20},{0x88ac38,0x88ac08,20},{0x88ac88,0x88ac50,9}};
  try(PrintWriter out=new PrintWriter(getScriptArgs()[0])) {
   long[][] strRefs={{0x7a7828,0x7a7634},{0x7a7830,0x7a766a},{0x7a7834,0x7a768a}};
   for(long[] r:strRefs){long got=(r[1]+currentProgram.getMemory().getInt(toAddr(r[0])))&0xffffffffL;long ptr=currentProgram.getMemory().getInt(toAddr(got))&0xffffffffL;long str=currentProgram.getMemory().getInt(toAddr(ptr))&0xffffffffL;out.printf("mode-ref=%08x got=%08x ptr=%08x str=%08x text=",r[0],got,ptr,str);for(int i=0;i<80;i++){int c=currentProgram.getMemory().getByte(toAddr(str+i))&255;if(c==0)break;out.print((char)c);}out.println();}
   for(long[] r:refs){int delta=currentProgram.getMemory().getInt(toAddr(r[0]));long target=(r[1]+delta)&0xffffffffL;out.printf("literal=%08x base=%08x target=%08x bytes=",r[0],r[1],target);for(int i=0;i<r[2];i++)out.printf("%02x ",currentProgram.getMemory().getByte(toAddr(target+i))&255);out.println();}
  }
 }
}
