const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/studio.js', 'utf8');
const names = ['openBlocksAt', 'matchingBrace', 'selectorBlockForLayout', 'cleanRulePrelude', 'responsiveLayoutBlock', 'maskNestedCss', 'directDeclarationEntries',
  'directDeclarations', 'upsertLayoutDeclarations', 'insertDeclarations', 'activateQueryTool', 'insertQueryRule'];
const functions = names.map(name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.slice(start + 1).search(/\n  (?:function |const |if \(document.readyState)/);
  return source.slice(start, end < 0 ? undefined : start + 1 + end);
}).join('\n');
const view = {innerWidth:500};
const node = {ownerDocument:{defaultView:view}};
const context = vm.createContext({ state: { context: { element: {} }, prefs: {} },
  canvasElementNode: () => node, contextRootSelector: () => '#brxe-test',
  commitLayoutEdit() {}, refreshLayoutTools() {} });
vm.runInContext(functions, context);
let count = 0;
function check(name, run) { run(); count++; console.log(`PASS ${name}`); }
const css = '%root% { display: grid; @media (width >= 767px) { gap: 2rem; } @media (width >= 1100px) { gap: 3rem; } }';
const target = (text, cursor = text.indexOf('{') + 1) => context.responsiveLayoutBlock(text, cursor);
check('mobile width uses base and never inserts a one-column grid template', () => {
  assert.equal(target(css).prelude, '%root%');
  assert.doesNotMatch(css, /grid-template-columns/);
});
check('canvas width never redirects a cursor outside media or container queries', () => {
  for (const kind of ['media', 'container']) {
    const text = `%root% { display:grid; @${kind} (width >= 767px) { gap:2rem; } color:red; }`;
    for (const width of [500,900,1400]) {
      view.innerWidth = width;
      for (const cursor of [0,text.indexOf('display'),text.indexOf('color'),text.length]) {
        assert.equal(target(text,cursor).prelude,'%root%');
      }
      assert.equal(target(text,text.indexOf('2rem')).prelude,`@${kind} (width >= 767px)`);
    }
  }
});
check('outside a query-only stylesheet requests a base rule instead of entering the query', () => {
  const text = '@media (width >= 767px) { %root% { gap:2rem; } }';
  assert.equal(target(text,0).createBase,true);
  assert.equal(target(text,text.length).createBase,true);
  assert.equal(target(text,text.indexOf('2rem')).prelude,'%root%');
});
check('nested child and pseudo selectors stay at the cursor', () => {
  const text = '%root% { @media (width >= 767px) { &:hover {color:red;} } }';
  assert.equal(target(text,text.indexOf('color')).prelude,'&:hover');
});
check('preference changes query insertion widths without changing editing scope', () => {
  for (const enabled of [false,true]) {
    context.state.prefs.responsiveTools = enabled;
    assert.equal(target(css).prelude,'%root%');
    assert.equal(target(css,css.indexOf('2rem')).prelude,'@media (width >= 767px)');
  }
});
check('visual tools and shortcuts edit only the cursor rule at every viewport', () => {
  for (const width of [500,900,1400]) {
    view.innerWidth = width;
    for (const inside of [false,true]) {
      let value = css;
      let cursor = inside ? css.indexOf('2rem') : css.indexOf('display');
      const doc = {getValue:()=>value,getCursor:()=>({ch:cursor}),indexFromPos:pos=>pos.ch,
        posFromIndex:index=>({ch:index}),replaceRange:(text,from,to)=>{value=value.slice(0,from.ch)+text+value.slice(to?.ch??from.ch);}};
      context.state.editor = {getDoc:()=>doc,getSelection:()=>'',focus(){}};
      context.upsertLayoutDeclarations({gap:'4rem'});
      cursor = inside ? value.indexOf('4rem') : value.indexOf('display');
      context.insertDeclarations('color:red;');
      const blocks=[];context.openBlocksAt(value,value.length,blocks);
      const query=blocks.find(block=>block.prelude.includes('767px'));
      const queryBody=value.slice(query.open+1,query.close);
      if (inside) {assert.match(queryBody,/gap: 4rem;/);assert.match(queryBody,/color:red;/);}
      else {assert.match(queryBody,/gap: 2rem;/);assert.doesNotMatch(queryBody,/color:red;/);assert.match(value.slice(query.close+1),/gap: 4rem;/);}
      assert.match(value,/width >= 1100px\) \{ gap: 3rem;/);
    }
  }
});
check('media and container insertion always nests in the base root regardless of cursor', () => {
  for (const kind of ['media', 'container']) {
    for (const position of ['before', 'after', 'child', 'query', 'empty', 'no-root']) {
      let value = position === 'empty' ? '' : position === 'no-root' ? '.other { color:red; }'
        : '%root% {\n  display:grid;\n  &:hover { color:red; }\n  @media (width >= 767px) { gap:2rem; }\n}';
      const original = value;
      const cursor = position === 'before' ? 0 : position === 'child' ? value.indexOf('red')
        : position === 'query' ? value.indexOf('2rem') : value.length;
      let caret = 0;
      const doc = {getValue: () => value, getCursor: () => ({ch:cursor}), indexFromPos: pos => pos.ch,
        posFromIndex: index => ({ch:index}), setCursor: pos => {caret = pos.ch;},
        replaceRange: (text, from) => {value = value.slice(0,from.ch)+text+value.slice(from.ch);} };
      context.state.editor = {getDoc: () => doc, focus() {}};
      context.insertQueryRule(kind, 'gte', 823, NaN);
      const blocks = []; context.openBlocksAt(value, value.length, blocks);
      const added = blocks.find(block => block.prelude.includes('823px'));
      assert.equal(added.ancestors.length, 1, position);
      assert.equal(context.cleanRulePrelude(added.ancestors[0]), '%root%', position);
      assert.ok(caret > added.open && caret < added.close);
      if (position === 'no-root') assert.ok(value.startsWith(original));
      assert.doesNotMatch(value, /grid-template-columns/);
    }
  }
});
check('query icons insert the current canvas width and disabled mode restores Bricks choices', () => {
  let menu = null, inserted = null;
  context.toggleQueryPanel = kind => { menu = kind; };
  context.closePopovers = () => {};
  context.hideTooltip = () => {};
  context.insertQueryRule = (...args) => { inserted = args; };
  view.innerWidth = 823;
  context.state.prefs.responsiveTools = true;
  context.activateQueryTool('media', {});
  assert.deepEqual(Array.from(inserted).slice(0, 3), ['media', 'gte', 823]);
  view.innerWidth = 501;
  context.activateQueryTool('container', {});
  assert.deepEqual(Array.from(inserted).slice(0, 3), ['container', 'gte', 501]);
  inserted = null;
  context.state.prefs.responsiveTools = false;
  context.activateQueryTool('media', {});
  assert.equal(menu, 'media'); assert.equal(inserted, null);
  context.activateQueryTool('container', {});
  assert.equal(menu, 'container'); assert.equal(inserted, null);
  context.state.prefs.responsiveTools = true;
  context.activateQueryTool('media', {shiftKey:true});
  assert.equal(menu, 'media'); assert.equal(inserted, null);
});
console.log(`${count} responsive routing checks passed.`);
