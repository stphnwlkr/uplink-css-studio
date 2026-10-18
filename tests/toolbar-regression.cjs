const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/studio.js', 'utf8');
const names = ['openBlocksAt', 'matchingBrace', 'selectorBlockForLayout', 'responsiveLayoutBlock', 'cleanRulePrelude',
  'maskNestedCss', 'directDeclarationEntries', 'directDeclarations', 'declarationsAtLayoutContext', 'layoutToolContext', 'refreshResponsiveTools'];
const functions = names.map(name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.slice(start + 1).search(/\n  (?:function |const |if \(document.readyState)/);
  return source.slice(start, end < 0 ? undefined : start + 1 + end);
}).join('\n');
let refreshes = 0;
const view = { innerWidth: 900, innerHeight: 600 };
const node = { ownerDocument: { defaultView: view }, parentElement: null };
let computed = {};
const context = vm.createContext({ state: {}, canvasElementNode: () => node,
  computedLayoutContext: () => computed, refreshLayoutTools: () => refreshes++ });
vm.runInContext(functions, context);
function layout(css, marker, active = {}) {
  const cursor = marker ? css.indexOf(marker) : css.indexOf('{') + 1;
  context.state.editor = { getDoc: () => ({ getValue: () => css, getCursor: () => ({ch:cursor}), indexFromPos: pos => pos.ch }) };
  return context.layoutToolContext(context.declarationsAtLayoutContext(), active);
}
let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS ${name}`); }
check('Bricks and class layouts enable the appropriate tools without an authored display', () => {
  assert.equal(layout('%root% { color: red; }', 'color', { display:'flex' }).type, 'flex');
  assert.equal(layout('%root% { color: red; }', 'color', { display:'grid' }).type, 'grid');
});
check('non-layout elements and unresolved variables do not enable alignment', () => {
  for (const display of ['block','inline','none','contents','table','flow-root']) {
    assert.equal(layout('%root% { color: red; }', 'color', {display}).type, '');
  }
  assert.equal(layout('%root% { display: var(--grid-layout); }', 'display').type, '');
  assert.equal(layout('%root% { display: var(--grid-layout); }', 'display', {display:'flex'}).type, 'flex');
});
check('inline and two-keyword display forms and important declarations are supported', () => {
  for (const display of ['inline-flex','inline flex','block flex','flex !important','flex /* layout */']) {
    assert.equal(layout(`%root% { display: ${display}; }`, 'display').type, 'flex');
  }
  for (const display of ['inline-grid','inline grid','block grid','grid !important']) {
    assert.equal(layout(`%root% { display: ${display}; }`, 'display').type, 'grid');
  }
});
check('display edits override the previous canvas layout immediately', () => {
  assert.equal(layout('%root% { display: block; }', 'display', {display:'flex'}).type, '');
  assert.equal(layout('%root% { display: grid; }', 'display', {display:'flex'}).type, 'grid');
});
check('queries keep the enclosing selector layout and flex direction', () => {
  const css = '%root% { display:flex; flex-direction:column; @media (width >= 767px) { gap:2rem; } }';
  const result = layout(css, 'gap');
  assert.equal(result.type, 'flex'); assert.equal(result.direction, 'column');
  assert.equal(layout(css.replace('gap:2rem;', 'display:block; gap:2rem;'), 'gap').type, '');
});
check('child selectors never inherit the parent display', () => {
  const css = '%root% { display:flex; .child { color:red; @container (width > 400px) { gap:2rem; } } }';
  assert.equal(layout(css, 'color').type, ''); assert.equal(layout(css, 'gap').type, '');
  assert.equal(layout(css.replace('color:red;', 'display:grid; color:red;'), 'gap').type, 'grid');
});
check('nested queries use the nearest selector and conditional display', () => {
  const css = '%root% { display:flex; .child { display:grid; @media (width > 700px) { display:block; @supports (display:grid) { gap:2rem; } } } }';
  assert.equal(layout(css, 'gap').type, '');
});
check('class display and direction changes refresh tools without a viewport size change', () => {
  computed = {display:'block', 'flex-direction':'row'};
  context.refreshResponsiveTools(); assert.equal(refreshes,1);
  context.refreshResponsiveTools(); assert.equal(refreshes,1);
  computed.display = 'flex'; context.refreshResponsiveTools(); assert.equal(refreshes,2);
  computed['flex-direction'] = 'column'; context.refreshResponsiveTools(); assert.equal(refreshes,3);
  computed.display = 'grid'; context.refreshResponsiveTools(); assert.equal(refreshes,4);
});
console.log(`${checks} contextual toolbar checks passed.`);
