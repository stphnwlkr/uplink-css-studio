const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/studio.js','utf8');
const names = ['expandRecipeTrigger','recipeTriggerHints','insertExternalRecipe','completeCssProperty','cssHints','maybeAutocomplete'];
const functions = names.map(name=>{
 const start=source.indexOf(`  function ${name}(`);assert.ok(start>=0,name);
 const end=source.slice(start+1).search(/\n  (?:function |const |if \(document.readyState)/);
 return source.slice(start,end<0?undefined:start+1+end);
}).join('\n');
const recipes = {'grid-2':{css:'display: grid;',label:'Grid 2'},'primary-clr':{css:'oklch(from var(--primary) l c h / 1)',label:'Primary'},'my-card':{css:'border-radius: 1rem;',label:'My card'}};
let completionCalls=0;
const CodeMirror={Pos:(line,ch)=>({line,ch}),Pass:'PASS'};
const context=vm.createContext({window:{wp:{CodeMirror}},state:{},recipeCatalog:()=>recipes,setStatus(){},
 availableVariableEntries:()=>[],queryPreludeHints:()=>null,expandToRemShortcut:()=>false,completeCssCalculation:()=>false,
 rootShortcutMode:()=>null,updateCalculationPreview:()=>false,clearTimeout(){},setTimeout:fn=>{fn();return 1;},autocomplete:()=>completionCalls++});
vm.runInContext(functions,context);
function editor(value,type='',selected=false){
 let text=value,cursor={line:0,ch:value.length};
 const doc={getCursor:()=>cursor,indexFromPos:pos=>pos.ch,posFromIndex:ch=>({line:0,ch}),setCursor:pos=>{cursor=pos;},replaceRange:(value,from,to)=>{text=text.slice(0,from.ch)+value+text.slice(to.ch);}};
 return {getCursor:doc.getCursor,getLine:()=>text,getTokenAt:()=>({type}),somethingSelected:()=>selected,getDoc:()=>doc,focus(){},value:()=>text};
}
let checks=0;
function check(name,run){run();checks++;console.log(`PASS ${name}`);}
check('question mark lists ACSS and custom recipes with the new labels',()=>{
 const cm=editor('?');const hints=context.recipeTriggerHints(cm,cm.getCursor(),CodeMirror);
 assert.equal(hints.list.length,3);assert.ok(hints.list.every(item=>item.text.startsWith('?')));
});
check('prefix completion replaces the question-mark trigger and preserves preceding CSS',()=>{
 const cm=editor('color: ?pri');const hints=context.recipeTriggerHints(cm,cm.getCursor(),CodeMirror);
 assert.equal(hints.list.length,1);hints.list[0].hint(cm,hints);
 assert.equal(cm.value(),'color: oklch(from var(--primary) l c h / 1)');
});
check('semicolon expands the new trigger for provider and user recipes',()=>{
 for(const name of ['grid-2','my-card']){const cm=editor(`  ?${name};`);assert.equal(context.expandRecipeTrigger(cm),true);assert.equal(cm.value(),'  '+recipes[name].css);}
});
check('the old at-sign trigger no longer expands recipes',()=>{
 const cm=editor('@grid-2;');assert.equal(context.expandRecipeTrigger(cm),false);assert.equal(cm.value(),'@grid-2;');
 const tab=editor('@grid-2');assert.equal(context.completeCssProperty(tab),CodeMirror.Pass);assert.equal(tab.value(),'@grid-2');
});
check('media and container at-rule completion stays separate',()=>{
 for(const kind of ['media','container']){const cm=editor('@'+kind);const hints=context.cssHints(cm,{});assert.equal(hints.list.length,1);assert.equal(hints.list[0].className,'uplink-css-studio-hint-catalog');assert.ok(hints.list[0].text.startsWith('@'+kind));}
});
check('comments strings and selections do not expand recipes',()=>{
 for(const [type,selected] of [['comment',false],['string',false],['',true]]){const cm=editor('?grid-2;',type,selected);assert.equal(context.expandRecipeTrigger(cm),false);assert.equal(context.recipeTriggerHints(cm,cm.getCursor(),CodeMirror),null);}
});
check('Tab replaces the entire new trigger',()=>{
 const cm=editor('?grid-2');context.completeCssProperty(cm);assert.equal(cm.value(),'display: grid;');
});
check('typing a question mark opens recipe autocomplete',()=>{
 const cm=editor('?');completionCalls=0;context.maybeAutocomplete(cm,{origin:'+input',text:['?']});assert.equal(completionCalls,1);
});
console.log(`${checks} recipe trigger checks passed.`);
