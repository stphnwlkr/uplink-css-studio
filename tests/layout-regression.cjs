const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(process.env.STUDIO_SOURCE || path.join(__dirname, '../assets/js/studio.js'), 'utf8');
const names = ['openBlocksAt', 'matchingBrace', 'selectorBlockForLayout', 'maskNestedCss',
  'directDeclarationEntries', 'directDeclarations', 'upsertLayoutDeclarations', 'commitLayoutEdit',
  'applyLayoutPreset', 'syncBricksCssControls'];
const functions = names.map((name) => {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const rest = source.slice(start + 1);
  const end = rest.search(/\n  (?:function |const |if \(document.readyState)/);
  return source.slice(start, end < 0 ? undefined : start + 1 + end);
}).join('\n');
const timers = new Map();
let timerId = 0;
const writes = [];
const context = vm.createContext({
  state: {},
  layoutPresets: { block: { display: 'block' }, grid: { display: 'grid' },
    'flex-row': { display: 'flex', 'flex-direction': 'row' },
    'flex-column': { display: 'flex', 'flex-direction': 'column' } },
  refreshLayoutTools() {},
  writeToBricks(explicit) {
    assert.equal(explicit, true);
    const value = context.state.editor.getValue();
    writes.push(value);
    context.syncBricksCssControls(value, explicit);
  },
  clearTimeout(id) { timers.delete(id); },
  setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
  nativeCssControl() { return null; },
  ensureCssSyncManager() { return context.state.cssSyncManager; },
  requestCanvasRender() {},
});
vm.runInContext(functions, context);
let stored = '';
const manager = { isActive: () => true, handleCssInput() {}, flushCssInput(value) { stored = value; } };
function editor(css, cursor) {
  let value = css;
  let position = cursor ?? css.indexOf('{') + 1;
  const doc = {
    getValue: () => value,
    setValue: (next) => { value = next; },
    getCursor: () => doc.posFromIndex(position),
    setCursor: (next) => { position = doc.indexFromPos(next); },
    indexFromPos: ({ line, ch }) => value.split('\n').slice(0, line).reduce((n, part) => n + part.length + 1, 0) + ch,
    posFromIndex: (index) => { const parts = value.slice(0, index).split('\n'); return { line: parts.length - 1, ch: parts.at(-1).length }; },
    lineCount: () => value.split('\n').length,
    replaceRange: (text, from, to) => {
      const start = doc.indexFromPos(from), end = doc.indexFromPos(to);
      value = value.slice(0, start) + text + value.slice(end);
      position = start + text.length;
    }
  };
  context.state = { editor: { getDoc: () => doc, getValue: doc.getValue, focus() {} }, cssSyncManager: manager };
  return doc;
}
let checks = 0;
function test(name, run) { run(); checks++; console.log(`PASS ${name}`); }
function values(doc) { return context.directDeclarations(doc.getValue().slice(doc.getValue().indexOf('{') + 1, -1)); }
test('compact declarations are all recognized', () => {
  assert.deepEqual(Array.from(context.directDeclarations('display:grid;grid-template-columns:1fr 1fr;gap:1rem;').keys()), ['display', 'grid-template-columns', 'gap']);
});
test('grid columns preserve display through repeated edits and sync', () => {
  const doc = editor('%root% {display:grid;grid-template-columns:1fr;gap:1rem;}');
  for (const columns of ['repeat(3, minmax(0, 1fr))', '', '2fr 1fr']) {
    context.upsertLayoutDeclarations({ 'grid-template-columns': columns });
    assert.equal(values(doc).get('display').value, 'grid');
    assert.equal(stored, doc.getValue());
  }
});
test('switching flex to grid removes every flex container declaration', () => {
  const doc = editor('%root% {display:flex;flex-direction:row;flex-direction:column;flex-wrap:wrap;flex-flow:column wrap;flex:1;gap:2rem;}');
  context.applyLayoutPreset('grid');
  assert.equal(values(doc).get('display').value, 'grid');
  assert.doesNotMatch(doc.getValue(), /flex-(direction|wrap|flow)/);
  assert.equal(values(doc).get('flex').value, '1');
  assert.equal(values(doc).get('gap').value, '2rem');
});
test('grid to flex clears grid container styles and keeps item placement', () => {
  const doc = editor('%root% {display:grid;grid-template:"a b";grid-template-columns:1fr 1fr;grid-auto-flow:dense;grid-column:2;}');
  context.applyLayoutPreset('flex-column');
  assert.equal(values(doc).get('display').value, 'flex');
  assert.equal(values(doc).get('flex-direction').value, 'column');
  assert.doesNotMatch(doc.getValue(), /grid-template|grid-auto-flow/);
  assert.equal(values(doc).get('grid-column').value, '2');
});
test('block and display removal clean container styles', () => {
  for (const remove of [false, true]) {
    const doc = editor('%root% {display:grid;grid-template-columns:1fr;flex-direction:column;color:red;}');
    context.applyLayoutPreset(remove ? 'grid' : 'block', remove);
    assert.doesNotMatch(doc.getValue(), /grid-template|flex-direction/);
    assert.equal(values(doc).get('display')?.value, remove ? undefined : 'block');
    assert.equal(values(doc).get('color').value, 'red');
  }
});
test('nested selectors and conditions stay scoped', () => {
  const css = '%root% {\n  display:flex;\n  flex-direction:row;\n  @media (width > 40rem) {\n    display:flex;\n    flex-direction:column;\n  }\n  &:hover {display:flex;flex-direction:row;}\n}';
  const doc = editor(css, css.indexOf('    display'));
  context.applyLayoutPreset('grid');
  assert.match(doc.getValue(), /display:flex;\n  flex-direction:row/);
  assert.match(doc.getValue(), /@media[^}]+display: grid;/);
  assert.doesNotMatch(doc.getValue(), /flex-direction:column/);
  assert.match(doc.getValue(), /&:hover \{display:flex;flex-direction:row;\}/);
});
test('declarations following nested rules are editable', () => {
  const doc = editor('%root% {&:hover {display:flex;} display:flex;flex-direction:column;}');
  context.applyLayoutPreset('grid');
  assert.match(doc.getValue(), /&:hover \{display:flex;\}/);
  assert.match(doc.getValue(), /display: grid;/);
  assert.doesNotMatch(doc.getValue(), /flex-direction/);
});
test('comments and quoted grid areas survive unrelated edits', () => {
  const doc = editor('%root% {\n/* display:flex; */\ngrid-template-areas:"a a" "b c";\ndisplay:grid;\n}');
  context.upsertLayoutDeclarations({ 'grid-template-columns': '1fr 1fr' });
  assert.match(doc.getValue(), /\/\* display:flex; \*\//);
  assert.equal(values(doc).get('grid-template-areas').value, '"a a" "b c"');
});
test('empty editor layout is saved immediately', () => {
  const doc = editor('');
  context.applyLayoutPreset('grid');
  assert.equal(values(doc).get('display').value, 'grid');
  assert.equal(stored, doc.getValue());
});
test('layout flush cancels an older delayed native sync', () => {
  const doc = editor('%root% {display:grid;}');
  context.syncBricksCssControls('stale CSS', false);
  assert.equal(timers.size, 1);
  context.upsertLayoutDeclarations({ 'grid-template-columns': '1fr 1fr' });
  assert.equal(timers.size, 0);
  assert.equal(stored, doc.getValue());
});
test('adding columns after a semicolonless display keeps valid CSS', () => {
  const doc = editor('%root% {display:grid}');
  context.upsertLayoutDeclarations({ 'grid-template-columns': '1fr 1fr' });
  assert.equal(values(doc).get('display').value, 'grid');
  assert.equal(values(doc).get('grid-template-columns').value, '1fr 1fr');
});
console.log(`${checks} layout regression checks passed.`);
