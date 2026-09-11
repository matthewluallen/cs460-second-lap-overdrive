// Bounded evidence capture. UI rendering is a tail; export retains every accepted
// line. Overflow is explicit and stops capture rather than silently evicting data.
const escapeControls=value=>String(value).replace(
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
  c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')
);
export class TraceLog {
  constructor({maxLines=10000,maxChars=2000000,visibleLines=200}={}) {
    for(const value of [maxLines,maxChars,visibleLines]){
      if(!Number.isSafeInteger(value)||value<1)throw new RangeError('Trace limits must be positive integers');
    }
    this.maxLines=maxLines;this.maxChars=maxChars;this.visibleLines=visibleLines;
    this.clear();
  }
  clear(){this.lines=[];this.chars=0;this.stopped=false;this.limitLine='';}
  append(source,message,date=new Date()){
    if(this.stopped)return false;
    const time=date.toISOString();
    const line=time+' | '+escapeControls(source)+' | '+escapeControls(message);
    if(this.lines.length>=this.maxLines || this.chars+line.length+1>this.maxChars){
      this.stopped=true;
      this.limitLine=time+' | EVIDENCE LIMIT | TRACE INCOMPLETE: capture stopped at the session limit; subsequent events are not recorded. Disconnect, save, and clear before continuing.';
      return false;
    }
    this.lines.push(line);this.chars+=line.length+1;return true;
  }
  get text(){return [...this.lines,...(this.limitLine?[this.limitLine]:[])].join('\n');}
  get view(){return [...this.lines.slice(-this.visibleLines),...(this.limitLine?[this.limitLine]:[])].join('\n');}
}
