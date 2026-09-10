const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const workflow=JSON.parse(fs.readFileSync(path.join(__dirname,'../../workflows/Flowrise Dental - AI Client V17.4.json'),'utf8'));
const code=name=>workflow.nodes.find(n=>n.name===name).parameters.jsCode||'';

test('technician prompt exposes only approved material and calendar operations',()=>{
  const prompt=code('AI - Build Final Prompt');
  assert.match(prompt,/material add\|subtract/);
  assert.match(prompt,/material set/);
  assert.match(prompt,/calendar_event create:/);
  assert.match(prompt,/update\|delete: target/);
  assert.match(prompt,/never their personal event/);
});

test('technician retrieval planner can fetch material and calendar IDs',()=>{
  const planner=code('AI - Build Retrieval Plan');
  assert.match(planner,/- materials_inventory/);
  assert.match(planner,/- calendar_events/);
  assert.doesNotMatch(planner,/other technicians' costs, materials, calendar/);
});

test('technician parser permits typed material and calendar execution',()=>{
  const parser=code('AI - Parse Final');
  assert.match(parser,/\["material","calendar_event"\]/);
  const gate=workflow.nodes.find(n=>n.name==='AI - Role Safe Mutation?').parameters.conditions.conditions[0].leftValue;
  assert.match(gate,/calendar_event/);
});
