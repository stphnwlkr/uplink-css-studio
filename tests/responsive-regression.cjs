const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/studio.js', 'utf8');
const names = ['openBlocksAt', 'matchingBrace', 'selectorBlockForLayout', 'containerWidthMatches',
  'responsiveConditionMatches', 'cleanRulePrelude', 'responsiveLayoutBlock', 'maskNestedCss', 'directDeclarationEntries',
  'directDeclarations', 'upsertLayoutDeclarations', 'insertDeclarations', 'activateQueryTool', 'insertQueryRule'];
const functions = names.map(name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.slice(start + 1).search(/\n  (?:function |const |if \(document.readyState)/);
  return source.slice(start, end < 0 ? undefined : start + 1 + end);
}).join('\n');
let viewport = 500;
const style = { containerType: 'inline-size', containerName: 'cards', fontSize: '20px', paddingLeft: '20px', paddingRight: '20px' };
const container = { clientWidth: 640, parentElement: null };
const document = { documentElement: {} };
const node = { parentElement: container, ownerDocument: document };
const view = { getComputedStyle: el => el === container ? style : { fontSize: '16px' },
  CSS: { supports: () => true }, matchMedia: query => ({ matches: context.containerWidthMatches(query, viewport, 16, 16) }) };
document.defaultView = view;
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
check('canvas width selects the matching media block despite a base cursor', () => {
  viewport = 900; assert.equal(target(css).prelude, '@media (width >= 767px)');
});
check('last matching rule wins in source order', () => {
  viewport = 1400; assert.equal(target(css).prelude, '@media (width >= 1100px)');
});
check('shrinking canvas leaves an inactive query even with the cursor inside it', () => {
  viewport = 500; assert.equal(target(css, css.indexOf('3rem')).prelude, '%root%');
});
check('top-level media query routes to its root selector', () => {
  viewport = 900;
  const text = '%root% { gap: 1rem; } @media (width >= 767px) { %root% {gap: 2rem;} }';
  assert.ok(target(text).open > text.indexOf('@media'));
});
check('all enclosing queries must match', () => {
  viewport = 900;
  assert.equal(target('%root% { @media (width >= 1100px) { @media (width <= 1000px) {gap:2rem;} } }').prelude, '%root%');
});
check('container queries use content width rather than viewport width', () => {
  viewport = 1400;
  assert.equal(target('%root% { @container (inline-size >= 620px) { gap:2rem; } }').prelude, '%root%');
  container.clientWidth = 700;
  assert.equal(target('%root% { @container (inline-size >= 620px) { gap:2rem; } }').prelude, '@container (inline-size >= 620px)');
});
check('named container must exist and rem/em units use their respective fonts', () => {
  assert.equal(context.responsiveConditionMatches('@container missing (width >= 1px)', node, view), false);
  assert.equal(context.responsiveConditionMatches('@container cards (inline-size >= 40rem)', node, view), true);
  assert.equal(context.responsiveConditionMatches('@container cards (inline-size >= 40em)', node, view), false);
});
check('fractional content-box widths exclude padding and borders', () => {
  Object.assign(style, { width: '640.5px', boxSizing: 'border-box', borderLeftWidth: '1px', borderRightWidth: '1px' });
  assert.equal(context.responsiveConditionMatches('@container cards (width >= 599px)', node, view), false);
  assert.equal(context.responsiveConditionMatches('@container cards (width >= 598.5px)', node, view), true);
  delete style.width; delete style.boxSizing; delete style.borderLeftWidth; delete style.borderRightWidth;
});
check('range syntax, legacy conditions and inclusive edges work', () => {
  assert.equal(context.containerWidthMatches('(500px <= inline-size < 700px)', 600, 16, 16), true);
  assert.equal(context.containerWidthMatches('(min-width: 600px) and (max-width: 700px)', 600, 16, 16), true);
  assert.equal(context.containerWidthMatches('(inline-size < 600px)', 600, 16, 16), false);
  assert.equal(context.containerWidthMatches('(aspect-ratio: 1/1)', 600, 16, 16), false);
});
check('explicit child/pseudo selectors remain cursor scoped', () => {
  const text = '%root% { @media (width >= 767px) { gap:2rem; } &:hover {color:red;} }';
  assert.equal(target(text, text.indexOf('color')).prelude, '&:hover');
});
check('preference restores manual cursor routing', () => {
  context.state.prefs.responsiveTools = false;
  assert.equal(target(css).prelude, '%root%'); context.state.prefs.responsiveTools = true;
});
check('inactive-only stylesheet requests a base rule instead of editing inactive CSS', () => {
  viewport = 500;
  assert.equal(target('@media (width >= 767px) { %root% { gap:2rem; } }', 40).createBase, true);
});
check('comments and quoted braces do not confuse responsive scope detection', () => {
  viewport = 900;
  assert.equal(context.cleanRulePrelude(target('/* heading */ %root% { content:"{x}"; /* responsive */ @media (width >= 767px) {gap:2rem;} }')), '@media (width >= 767px)');
});
check('visual edits update only the matching query and preserve base CSS', () => {
  viewport = 900;
  let value = css;
  const doc = { getValue: () => value, getCursor: () => ({line:0,ch:8}), indexFromPos: pos => pos.ch,
    posFromIndex: index => ({line:0,ch:index}), replaceRange: (text, from, to) => { value = value.slice(0,from.ch)+text+value.slice(to?.ch ?? from.ch); } };
  context.state.editor = { getDoc: () => doc, getSelection: () => '', focus() {} };
  context.upsertLayoutDeclarations({gap:'4rem'});
  assert.ok(value.startsWith('%root% { display: grid; @media (width >= 767px) { gap: 4rem;'));
  assert.match(value, /width >= 1100px\) \{ gap: 3rem;/);
  context.insertDeclarations('color: red;');
  const selected = target(value);
  assert.match(value.slice(selected.open + 1, selected.close), /color: red;/);
  assert.doesNotMatch(value.slice(0, selected.open), /color: red;/);
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
