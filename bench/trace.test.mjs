import test from 'node:test';
import assert from 'node:assert/strict';
import {TraceLog} from './trace.mjs';
const at=new Date('2026-10-28T12:00:00.000Z');
test('evidence renders a bounded tail while exporting all accepted lines',()=>{
  const log=new TraceLog({visibleLines:2});
  for(let i=0;i<5;i++)assert.equal(log.append('MOCK','event '+i,at),true);
  assert.equal(log.text.split('\n').length,5);
  assert.equal(log.view.split('\n').length,2);
  assert.match(log.text,/event 0/);assert.doesNotMatch(log.view,/event 0/);
  assert.match(log.view,/event 4/);assert.equal(log.stopped,false);
});
test('line cap stops capture visibly, preserves earlier data, and needs explicit reset',()=>{
  const log=new TraceLog({maxLines:2});
  log.append('MOCK','first',at);log.append('MOCK','second',at);
  assert.equal(log.append('LIVE decoded','battery 4000 mV',at),false);
  assert.equal(log.stopped,true);assert.match(log.text,/TRACE INCOMPLETE/);
  assert.doesNotMatch(log.text,/4000/);assert.match(log.text,/first/);
  const saved=log.text;
  for(let i=0;i<1000;i++)assert.equal(log.append('MOCK','ignored',at),false);
  assert.equal(log.text,saved);assert.match(log.view,/TRACE INCOMPLETE/);
  log.clear();assert.equal(log.stopped,false);assert.equal(log.text,'');
  assert.equal(log.append('REPLAY','fresh session',at),true);
});
test('character cap cannot be bypassed by one large event or control expansion',()=>{
  const log=new TraceLog({maxChars:80});
  assert.equal(log.append('MOCK','small',at),true);
  assert.equal(log.append('MOCK','x'.repeat(10000),at),false);
  assert.ok(log.text.length<400);assert.match(log.text,/small/);
  const escaped=new TraceLog({maxChars:40});
  assert.equal(escaped.append('MOCK','\n\n',at),false);
  assert.match(escaped.text,/TRACE INCOMPLETE/);
});
test('newlines and display controls cannot forge evidence rows or reverse labels',()=>{
  const log=new TraceLog();
  log.append('MOCK\nLIVE','bad\r\nLIVE decoded | battery 9999 mV\u2028x\u202e\u001b\u061c\u200e\u200f',at);
  assert.equal(log.text.split('\n').length,1);
  assert.match(log.text,/MOCK\\u000aLIVE/);
  assert.match(log.text,/\\u000d\\u000aLIVE/);
  assert.match(log.text,/\\u2028x\\u202e\\u001b\\u061c\\u200e\\u200f/);
});
test('trace configuration rejects unlimited, negative and noninteger budgets',()=>{
  for(const key of ['maxLines','maxChars','visibleLines'])for(const bad of [0,-1,1.5,Infinity,NaN,'10']){
    assert.throws(()=>new TraceLog({[key]:bad}),RangeError);
  }
});
