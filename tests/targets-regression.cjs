const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/studio.js', 'utf8');
const names = ['htmlGlobalClassNames','renderTargetValues','saveElementTargetField','saveElementClasses','assignIdTarget'];
const functions = names.map(name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0,name);
  const end = source.slice(start + 1).search(/\n  (?:function |const |if \(document.readyState)/);
  return source.slice(start, end < 0 ? undefined : start + 1 + end);
}).join('\n');
const nodes = new Map();
for (const name of ['id-input','element-classes-input','class-input','assigned-classes']) nodes.set(`.uplink-css-studio-${name}`,{dataset:{},value:'',innerHTML:''});
const buttons = [{}, {}, {}];
let writes=0,changes=0;
const context = vm.createContext({state:{}, document:{querySelector:selector=>nodes.get(selector),querySelectorAll:()=>buttons},
  writeToBricks:()=>writes++,markElementDirty:()=>changes++,leaveSiteWideContext(){},escapeAttr:s=>String(s).replace(/"/g,'&quot;'),escapeHtml:s=>String(s).replace(/</g,'&lt;')});
vm.runInContext(functions,context);
function reset() {
  context.state={context:{kind:'Element',element:{id:'test01',settings:{_cssId:'hero',_cssClasses:'plain utility:large',_cssGlobalClasses:['g1'],_cssCustom:'%root% { color:red; }'}},
    s:{globalClasses:[{id:'g1',name:'SharedCard',settings:{_cssCustom:'%root% { display:grid; }'}}]},target:{id:'test01'}},pendingWrite:false};
  nodes.forEach(node=>{node.dataset={};node.value='';node.innerHTML='';});writes=0;changes=0;
}
let checks=0;
function check(name,run){reset();run();checks++;console.log(`PASS ${name}`);}
check('plain classes, CSS ID and global class assignments appear separately',()=>{
  context.renderTargetValues();
  assert.equal(nodes.get('.uplink-css-studio-element-classes-input').value,'plain utility:large');
  assert.equal(nodes.get('.uplink-css-studio-id-input').value,'hero');
  assert.equal(nodes.get('.uplink-css-studio-class-input').value,'');
  assert.match(nodes.get('.uplink-css-studio-assigned-classes').innerHTML,/SharedCard/);
});
check('plain class edits preserve case, dynamic syntax and global records',()=>{
  const ctx=context.state.context;const before=JSON.stringify(ctx.s.globalClasses);
  nodes.get('.uplink-css-studio-element-classes-input').value="  MyClass hover:card {echo:example('x y')}  ";
  context.saveElementClasses();
  assert.equal(ctx.element.settings._cssClasses,"MyClass hover:card {echo:example('x y')}");
  assert.equal(JSON.stringify(ctx.s.globalClasses),before);assert.deepEqual(ctx.element.settings._cssGlobalClasses,['g1']);
  assert.equal(ctx.element.settings._cssCustom,'%root% { color:red; }');
});
check('clearing plain classes removes only the element class field',()=>{
  context.saveElementTargetField('_cssClasses','');
  assert.equal(context.state.context.element.settings._cssClasses,undefined);
  assert.deepEqual(context.state.context.element.settings._cssGlobalClasses,['g1']);
});
check('CSS ID updates and removal preserve CSS and dynamic data syntax',()=>{
  nodes.get('.uplink-css-studio-id-input').value='#{post_id}';context.assignIdTarget();
  assert.equal(context.state.context.element.settings._cssId,'{post_id}');
  nodes.get('.uplink-css-studio-id-input').value='';context.assignIdTarget();
  assert.equal(context.state.context.element.settings._cssId,undefined);
  assert.equal(context.state.context.element.settings._cssCustom,'%root% { color:red; }');
});
check('editing fields while a global class is selected still updates the element',()=>{
  const ctx=context.state.context;ctx.kind='Class';ctx.target=ctx.s.globalClasses[0];
  context.saveElementTargetField('_cssClasses','local-only');
  assert.equal(ctx.element.settings._cssClasses,'local-only');assert.equal(ctx.target.settings._cssClasses,undefined);
});
check('pending CSS is flushed before attribute changes',()=>{
  context.state.pendingWrite=true;context.saveElementTargetField('_cssClasses','new');assert.equal(writes,1);assert.equal(changes,1);
});
check('refresh preserves drafts until saved and element switches clear them',()=>{
  context.renderTargetValues();const input=nodes.get('.uplink-css-studio-element-classes-input');
  input.value='draft';input.dataset.dirty='true';context.renderTargetValues();assert.equal(input.value,'draft');
  context.state.context.element={id:'test02',settings:{_cssClasses:'other'}};context.renderTargetValues();assert.equal(input.value,'other');
});
check('saved edits clear draft status and native field changes refresh',()=>{
  context.renderTargetValues();const input=nodes.get('.uplink-css-studio-element-classes-input');input.dataset.dirty='true';
  context.saveElementTargetField('_cssClasses','saved');assert.equal(input.dataset.dirty,'false');assert.equal(input.value,'saved');
  context.state.context.element.settings._cssClasses='native';context.renderTargetValues();assert.equal(input.value,'native');
});
check('no element disables field actions and ignores saves',()=>{
  context.state.context=null;context.renderTargetValues();context.saveElementTargetField('_cssClasses','ignored');
  assert.equal(changes,0);assert.ok(buttons.every(button=>button.disabled));
});
console.log(`${checks} target panel checks passed.`);
