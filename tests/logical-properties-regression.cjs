const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/studio.js', 'utf8');
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.slice(start + 1).search(/\n  (?:function |const )/);
  return source.slice(start, start + 1 + end);
}
const logicalCode = source.slice(source.indexOf('  const logicalPropertyAlternatives ='), source.indexOf('  const cssWideValues ='));
const builtInCode = source.slice(source.indexOf('  const builtInRecipes ='), source.indexOf('  const recipeProvider ='));
const sandbox = vm.createContext({ state: { prefs: {} }, externalRecipes: {}, userRecipes: {}, recipeProvider: 'ACSS' });
const abbreviationCode = source.slice(source.indexOf('  const cssAbbreviations ='), source.indexOf('  // Directional replacements'));
vm.runInContext(abbreviationCode + logicalCode + builtInCode + '\n' + ['recipeLabel', 'recipeCatalog'].map(extract).join('\n'), sandbox);
let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS ${name}`); }
const names = (items) => Array.from(items, item => typeof item === 'string' ? item : item.text);
check('default and invalid preferences preserve physical CSS authoring', () => {
  for (const value of [undefined, 'all', 'invalid']) {
    sandbox.state.prefs.logicalProperties = value;
    assert.equal(sandbox.preferredCssProperty('width'), 'width');
    assert.equal(sandbox.logicalPresetCss('padding: 1rem;'), 'padding: 1rem;');
  }
});
check('prefer logical suggests inline size first when typing width while retaining width', () => {
  sandbox.state.prefs.logicalProperties = 'prefer';
  const result = names(sandbox.prioritizeLogicalProperties(['width', 'will-change'], 'w'));
  assert.equal(result[0], 'inline-size');
  assert.ok(result.includes('width'));
  assert.ok(result.includes('will-change'));
});
check('logical only hides physical alternatives but preserves unrelated properties and variables', () => {
  sandbox.state.prefs.logicalProperties = 'only';
  const result = names(sandbox.prioritizeLogicalProperties(['width', 'height', 'margin-left', 'color', '--width'], ''));
  for (const property of ['width', 'height', 'margin-left']) assert.ok(!result.includes(property));
  for (const property of ['inline-size', 'block-size', 'margin-inline-start', 'color', '--width']) assert.ok(result.includes(property));
});
check('Tab mappings cover sizing, directional spacing, offsets and corners', () => {
  for (const mode of ['prefer', 'only']) {
    sandbox.state.prefs.logicalProperties = mode;
    for (const [physical, logical] of [['width', 'inline-size'], ['min-height', 'min-block-size'],
      ['margin-right', 'margin-inline-end'], ['padding-top', 'padding-block-start'],
      ['left', 'inset-inline-start'], ['border-bottom-left-radius', 'border-end-start-radius']]) {
      assert.equal(sandbox.preferredCssProperty(physical), logical);
    }
  }
});
check('toolbar spacing retains both axes and sticky offsets become logical', () => {
  assert.equal(sandbox.logicalPresetCss('padding: var(--space-m, 1.5rem);'), 'padding-block: var(--space-m, 1.5rem);\npadding-inline: var(--space-m, 1.5rem);');
  assert.equal(sandbox.logicalPresetCss('position: sticky;\ntop: 0;'), 'position: sticky;\ninset-block-start: 0;');
  assert.equal(sandbox.logicalPresetCss('max-width: 72rem;'), 'max-inline-size: 72rem;');
});
check('grid stack is available without ACSS and documents direct children, sizing and layers', () => {
  const recipe = sandbox.recipeCatalog()['grid-stack'];
  assert.equal(recipe.provider, 'CSS Studio');
  assert.match(recipe.css, /grid-template-areas: "stack"/);
  assert.match(recipe.css, /& > \* \{\s+grid-area: stack/);
  assert.equal((recipe.css.match(/%root%/g) || []).length, 1, 'child rules must be nested inside one root rule');
  assert.match(recipe.css, /min-inline-size: 0/);
  assert.match(recipe.css, /isolation: isolate/);
  assert.match(recipe.css, /tallest layer sets the height/);
  assert.match(recipe.css, /foreground.*[\s\S]*z-index: 1/);
});
check('logical preferences leave provider and saved recipes unchanged', () => {
  sandbox.externalRecipes.card = 'width: 20rem;';
  sandbox.userRecipes.card = {css: 'width: 10rem;', label: 'My card', category: 'Mine'};
  sandbox.state.prefs.logicalProperties = 'only';
  assert.equal(sandbox.recipeCatalog().card.css, 'width: 10rem;');
  assert.equal(sandbox.externalRecipes.card, 'width: 20rem;');
});
const CodeMirror = {Pos: (line, ch) => ({line, ch}), Pass: 'PASS', hint: {css: (editor) => ({
  list: ['width'], from: {line: 0, ch: 0}, to: editor.getCursor()
})}};
Object.assign(sandbox, {window: {wp: {CodeMirror}}, cssCatalog: {properties: []},
  modernCssTerms: ['inline-size', 'block-size'], availableVariableEntries: () => [], queryPreludeHints: () => null,
  recipeTriggerHints: () => null, rootShortcutHint: () => null, rootShortcutMode: () => '',
  expandToRemShortcut: () => false, completeCssCalculation: () => false});
sandbox.catalogPropertyMap = new Map();
vm.runInContext(['isCssPropertyName', 'cssHints', 'propertyHint', 'insertPropertyCompletion', 'completeCssProperty'].map(extract).join('\n'), sandbox);
check('autocomplete and Tab preserve p while logical modes remap sizing shortcuts', () => {
  for (const mode of ['all', 'prefer', 'only']) {
    sandbox.state.prefs.logicalProperties = mode;
    for (const [value, expected] of [['w', 'inline-size'], ['width', 'inline-size'], ['p', 'padding'], ['padding', 'padding'], ['pb', 'padding-block'], ['pi', 'padding-inline'], ['m', 'margin'], ['b', 'border'], ['i', 'inset']]) {
      let line = value;
      const editor = {getCursor: () => ({line: 0, ch: line.length}), getLine: () => line,
        somethingSelected: () => false, getTokenAt: () => ({start: 0, end: line.length}),
        getValue: () => '%root% {\n' + line, indexFromPos: pos => 9 + pos.ch,
        getRange: (from, to) => line.slice(from.ch, to.ch), setCursor() {},
        replaceRange: (value, from, to) => {line = line.slice(0, from.ch) + value + line.slice(to.ch);}};
      const hints = names(sandbox.cssHints(editor, {}).list);
      const actualExpected = mode === 'all' && ['w', 'width'].includes(value) ? 'width' : expected;
      assert.ok(hints.includes(actualExpected));
      if (mode === 'only') assert.ok(!hints.includes('width'));
      if (['p', 'b', 'i'].includes(value)) assert.equal(hints[0], expected, 'an open popup must preserve exact shortcuts');
      sandbox.completeCssProperty(editor);
      assert.equal(line, actualExpected + ': ;');
    }
  }
});
check('shortcut prefixes show only compact aliases without physical conversion rows', () => {
  sandbox.state.prefs.logicalProperties = 'only';
  const editor = {getCursor: () => ({line: 0, ch: 2}), getLine: () => 'pi',
    getTokenAt: () => ({start: 0, end: 2}), getValue: () => '%root% {\n pi',
    indexFromPos: () => 12, getRange: () => 'pi'};
  const list = sandbox.cssHints(editor, {}).list;
  assert.deepEqual(names(list), ['padding-inline', 'padding-inline-start', 'padding-inline-end']);
  assert.deepEqual(Array.from(list, item => item.displayText), ['pi  →  padding-inline', 'pis  →  padding-inline-start', 'pie  →  padding-inline-end']);
});
check('logical family shortcuts expand on Tab and stay selected in every property mode', () => {
  for (const mode of ['all', 'prefer', 'only']) {
    sandbox.state.prefs.logicalProperties = mode;
    for (const [family, inlineStart, inlineEnd, blockStart, blockEnd] of [
      ['padding', 'pis', 'pie', 'pbs', 'pbe'], ['margin', 'mis', 'mie', 'mbs', 'mbe'],
      ['inset', 'iis', 'iie', 'ibs', 'ibe'], ['border', 'bis', 'bie', 'bbs', 'bbe'],
      ['scroll-margin', 'smis', 'smie', 'smbs', 'smbe'], ['scroll-padding', 'spis', 'spie', 'spbs', 'spbe']
    ]) {
      for (const [alias, side] of [[inlineStart, 'inline-start'], [inlineEnd, 'inline-end'], [blockStart, 'block-start'], [blockEnd, 'block-end']]) {
        let line = alias;
        const editor = {getCursor: () => ({line: 0, ch: line.length}), getLine: () => line,
          somethingSelected: () => false, getTokenAt: () => ({start: 0, end: line.length}),
          getValue: () => '%root% {\n' + line, indexFromPos: pos => 9 + pos.ch,
          getRange: (from, to) => line.slice(from.ch, to.ch), setCursor() {},
          replaceRange: (value, from, to) => {line = line.slice(0, from.ch) + value + line.slice(to.ch);}};
        assert.equal(names(sandbox.cssHints(editor, {}).list)[0], `${family}-${side}`, alias);
        sandbox.completeCssProperty(editor);
        assert.equal(line, `${family}-${side}: ;`, alias);
      }
    }
  }
  const aliases = vm.runInContext('cssAbbreviations', sandbox);
  assert.equal(aliases.bs, 'box-shadow', 'existing shortcuts must retain their meaning');
  assert.equal(aliases.bisc, 'border-inline-start-color');
  assert.equal(aliases.bist, 'border-inline-style');
  assert.equal(aliases.bisst, 'border-inline-start-style');
  assert.equal(aliases.bbew, 'border-block-end-width');
});
check('all-side shorthands remain selectable and exact names win in every preference mode', () => {
  const properties = ['padding', 'margin', 'border', 'inset', 'border-width', 'border-style',
    'border-color', 'border-radius', 'scroll-margin', 'scroll-padding'];
  sandbox.cssCatalog.properties = [...properties, 'padding-inline', 'margin-block', 'border-inline-start', 'inset-block'].map(name => ({name}));
  for (const mode of ['all', 'prefer', 'only']) {
    sandbox.state.prefs.logicalProperties = mode;
    for (const property of properties) {
      let line = property;
      const editor = {getCursor: () => ({line: 0, ch: line.length}), getLine: () => line,
        somethingSelected: () => false, getTokenAt: () => ({start: 0, end: line.length}),
        getValue: () => '%root% {\n' + line, indexFromPos: pos => 9 + pos.ch,
        getRange: (from, to) => line.slice(from.ch, to.ch), setCursor() {},
        replaceRange: (value, from, to) => {line = line.slice(0, from.ch) + value + line.slice(to.ch);}};
      const hints = sandbox.cssHints(editor, {});
      assert.equal(names(hints.list)[0], property, `${mode}: ${property} must stay first`);
      hints.list[0].hint(editor, hints);
      assert.equal(line, property + ': ;', 'choosing autocomplete must preserve the shorthand');
      line = property;
      sandbox.completeCssProperty(editor);
      assert.equal(line, property + ': ;', 'Tab must preserve the shorthand');
    }
  }
});
check('CSS property names beat colliding ACSS recipes in hints and Tab expansion', () => {
  sandbox.externalRecipes.border = '%root% { border: 1px solid red; }';
  sandbox.externalRecipes['border-check'] = '%root% { outline: 1px solid red; }';
  sandbox.externalRecipes.padding = 'padding: 2rem;';
  sandbox.externalRecipes.b = 'border: 5px solid red;';
  sandbox.externalRecipes.i = 'inset: 10px;';
  sandbox.insertExternalRecipe = () => { throw new Error('bare CSS properties must not expand recipes'); };
  for (const mode of ['all', 'prefer', 'only']) {
    sandbox.state.prefs.logicalProperties = mode;
    for (const property of ['border', 'padding', 'b', 'i']) {
      let line = property;
      const editor = {getCursor: () => ({line: 0, ch: line.length}), getLine: () => line,
        somethingSelected: () => false, getTokenAt: () => ({start: 0, end: line.length}),
        getValue: () => '%root% {\n' + line, indexFromPos: pos => 9 + pos.ch,
        getRange: (from, to) => line.slice(from.ch, to.ch), setCursor() {},
        replaceRange: (value, from, to) => {line = line.slice(0, from.ch) + value + line.slice(to.ch);}};
      const expected = ({b: 'border', i: 'inset'})[property] || property;
      const hints = sandbox.cssHints(editor, {});
      assert.equal(names(hints.list)[0], expected);
      assert.ok(!hints.list.some(item => item.className === 'uplink-css-studio-hint-recipe'));
      hints.list[0].hint(editor, hints);
      assert.equal(line, expected + ': ;');
      line = property;
      sandbox.completeCssProperty(editor);
      assert.equal(line, expected + ': ;');
      let recipeCalls = 0;
      line = '?' + property;
      sandbox.insertExternalRecipe = css => { recipeCalls++; assert.equal(css, sandbox.externalRecipes[property]); };
      sandbox.completeCssProperty(editor);
      assert.equal(recipeCalls, 1, 'explicit ? recipe shortcut must remain available');
      sandbox.insertExternalRecipe = () => { throw new Error('bare CSS properties must not expand recipes'); };
    }
  }
});
console.log(`${checks} logical properties and built-in recipe checks passed.`);
