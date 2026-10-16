const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.STUDIO_SOURCE || 'assets/js/studio.js','utf8');
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0,name);
  const end = source.slice(start+1).search(/\n  (?:function |const )/);
  return source.slice(start,start+1+end);
}
const CodeMirror = {Pos:(line,ch)=>({line,ch}),Pass:'pass'};
const context = vm.createContext({window:{wp:{CodeMirror}},setStatus(){},
  resolvedRootFontSizePx:()=>10,resolvedMediaFontSizePx:()=>16});
vm.runInContext(['cssWithoutCommentsAndStrings','formatRemNumber','expandToRemShortcut','completeCssProperty', 'unitConversionOptions', 'numericConversionMetrics', 'handleNumericContextMenu', 'replaceValueTarget'].map(extract).join('\n'),context);
function editor(marked,tokenType=null,selected=false) {
  let index=marked.indexOf('|');
  let value=marked.replace('|','');
  const doc={getValue:()=>value,indexFromPos:pos=>value.split('\n').slice(0,pos.line).reduce((sum,line)=>sum+line.length+1,0)+pos.ch};
  const api={getDoc:()=>doc,getLine:line=>value.split('\n')[line],getCursor:()=>{const lines=value.slice(0,index).split('\n');return {line:lines.length-1,ch:lines.at(-1).length};},
    somethingSelected:()=>selected,getTokenAt:()=>({type:tokenType}),
    replaceRange:(text,from,to)=>{const start=doc.indexFromPos(from),end=doc.indexFromPos(to);value=value.slice(0,start)+text+value.slice(end);index=start+text.length;},
    setCursor:pos=>{index=doc.indexFromPos(pos);},value:()=>value};
  return api;
}
let checks=0;
function test(name,run){run();checks++;console.log(`PASS ${name}`);}
function expand(marked,expected) {
  const ed=editor(marked),cursor=ed.getCursor();
  assert.equal(context.expandToRemShortcut(ed,cursor,ed.getLine(cursor.line).slice(0,cursor.ch),CodeMirror),true);
  assert.equal(ed.value(),expected);
}
test('nested media query threshold uses initial font size rather than the styled HTML root',()=>{
  expand('%root% {\n  @media (width >= tr767|) {\n  }\n}','%root% {\n  @media (width >= 47.9375rem) {\n  }\n}');
});
test('legacy media widths, reverse ranges, multiline conditions and decimal thresholds expand',()=>{
  for(const [input,expected] of [
    ['@media (min-width: tr800|) {}','@media (min-width: 50rem) {}'],
    ['@media (tr800| <= width < 1200px) {}','@media (50rem <= width < 1200px) {}'],
    ['@media (400px < width <= tr800|) {}','@media (400px < width <= 50rem) {}'],
    ['@media screen and (\n width >=\n tr800|\n) {}','@media screen and (\n width >=\n 50rem\n) {}'],
    ['@media (height >= tr800.5|) {}','@media (height >= 50.0313rem) {}']
  ])expand(input,expected);
});
test('declarations inside media and container bodies retain HTML-root conversion',()=>{
  for(const kind of ['media','container'])expand(`%root% { @${kind} (width >= 800px) {\n padding: tr80|;\n} }`,`%root% { @${kind} (width >= 800px) {\n padding: 8rem;\n} }`);
  expand('%root% { margin: tr-20|; }','%root% { margin: -2rem; }');
});
test('container threshold keeps root-relative conversion',()=>{
  expand('%root% { @container cards (inline-size >= tr800|) {} }','%root% { @container cards (inline-size >= 80rem) {} }');
});
test('selectors and non-length query features are not expanded',()=>{
  for(const text of ['.tr80| {}','@media (color >= tr8|) {}','@media (aspect-ratio: tr2|) {}']){
    const ed=editor(text),cursor=ed.getCursor();assert.equal(context.expandToRemShortcut(ed,cursor,ed.getLine(cursor.line).slice(0,cursor.ch),CodeMirror),false);
  }
});
test('Tab expands media thresholds but ignores strings, comments and selections',()=>{
  const ed=editor('%root% { @media (width >= tr800|) {} }');
  context.completeCssProperty(ed);assert.equal(ed.value(),'%root% { @media (width >= 50rem) {} }');
  for(const [type,selected] of [['comment',false],['string',false],[null,true]]){
    const ed=editor('padding: tr80|',type,selected);assert.equal(context.completeCssProperty(ed),'pass');assert.equal(ed.value(),'padding: tr80');
  }
});
test('unit conversions preserve length while unsupported bases are labelled unit swaps',()=>{
  const options=context.unitConversionOptions('958px',{root:16,font:16,width:958,height:804});
  assert.equal(options.find(x=>x.value==='59.875rem').label,'converted');
  assert.equal(options.find(x=>x.value==='59.875em').label,'converted');
  assert.equal(options.find(x=>x.value==='100vw').label,'converted');
  assert.equal(options.find(x=>x.value==='958%').label,'unit swap');
  assert.equal(options.find(x=>x.value==='958ch').label,'unit swap');
  assert.equal(context.unitConversionOptions('59.875rem',{root:16,font:20,width:958,height:804}).find(x=>x.value==='958px').label,'converted');
  assert.equal(context.unitConversionOptions('50%',{root:16,font:16,width:958,height:804}).find(x=>x.value==='50rem').label,'unit swap');
  assert.equal(context.unitConversionOptions('1fr',{}).length,0);
  assert.equal(context.unitConversionOptions('10',{}).length,0);
});
test('conversion context distinguishes media initial font, element font and named container font',()=>{
  const container={parentElement:null};
  const node={parentElement:container,ownerDocument:{defaultView:{innerWidth:958,innerHeight:804,getComputedStyle:el=>el===container?{containerType:'inline-size',containerName:'cards',fontSize:'24px'}:{fontSize:'20px'}}}};
  context.canvasElementNode=()=>node;
  for(const [text,root,font] of [
    ['%root% { @media (max-width: 958px|) {} }',16,16],
    ['%root% { font-size: 958px|; }',10,20],
    ['%root% { @media (width >= 50rem) { padding:958px|; } }',10,20],
    ['%root% { @container cards (inline-size >= 958px|) {} }',10,24]
  ]){
    const ed=editor(text);context.state={editor:ed,context:{element:{}}};
    const end=ed.getCursor(),target={line:end.line,start:end.ch-5,end:end.ch,value:'958px'};
    const metrics=context.numericConversionMetrics(target);assert.equal(metrics.root,root);assert.equal(metrics.font,font);
  }
  const variable=editor('%root% { gap:var(--space-32px|); }');context.state={editor:variable};
  const end=variable.getCursor();
  assert.equal(context.numericConversionMetrics({line:0,start:end.ch-4,end:end.ch}),null);
  const ed=editor('@media (aspect-ratio: 16|/9) {}');context.state={editor:ed};
  assert.equal(context.numericConversionMetrics({line:0,start:21,end:23}),null);
});
test('context menu changes only the chosen token and rejects stale values',()=>{
  for(const stale of [false,true]){
    const ed=editor('%root% { @media (max-width: 958px|) { gap:958px; } }');
    const end=ed.getCursor(),target={kind:'number',value:'958px',line:0,start:end.ch-5,end:end.ch};
    ed.getRange=(from,to)=>ed.value().slice(ed.getDoc().indexFromPos(from),ed.getDoc().indexFromPos(to));
    context.state={editor:ed,context:{element:{}}};
    context.valueTargetFromEvent=()=>target;
    const listeners={};let markup='',closed=false,prevented=false;
    context.escapeHtml=x=>x;
    context.showValuePanel=(t,title,html)=>{markup=html;return {addEventListener:(event,fn)=>{listeners[event]=fn;},querySelectorAll:()=>[]};};
    context.closeValuePanel=()=>{closed=true;};context.scheduleValueDecorations=()=>{};
    context.handleNumericContextMenu({target:{closest:()=>({})},preventDefault(){prevented=true;},stopPropagation(){}});
    assert.ok(prevented);assert.match(markup,/59.875rem/);
    if(stale)ed.replaceRange('100px',{line:0,ch:target.start},{line:0,ch:target.end});
    listeners.click({target:{closest:()=>({dataset:{unitOption:'0'}})}});
    assert.equal(ed.value(),`%root% { @media (max-width: ${stale?'100px':'59.875rem'}) { gap:958px; } }`);
    assert.equal(closed,true);
  }
});
console.log(`${checks} rem regression checks passed.`);
