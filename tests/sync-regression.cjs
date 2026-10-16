const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(process.env.STUDIO_SOURCE || path.join(__dirname, '../assets/js/studio.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1);
  const end = source.slice(start + 1).search(/\n  (?:function |const )/);
  return source.slice(start, start + 1 + end);
}
function context(modules, exports) {
  let required = [];
  const require = (id) => { required.push(String(id)); return exports[id]; };
  require.m = modules;
  const chunks = [];
  chunks.push = (chunk) => chunk[2](require);
  const sandbox = vm.createContext({ window: { webpackChunkbricks: chunks }, state: {},
    contextSignature: () => 'element:desktop', contextRootSelector: () => '#brxe-test',
    replaceContextRoot: (ctx, from, to, css) => css,
    nativeCssControl: () => null, requestCanvasRender() {}, clearTimeout() {}, setTimeout() {},
  });
  vm.runInContext('let bricksCssSyncFactoryCache;\n' + ['bricksCssSyncFactory', 'destroyCssSyncManager',
    'ensureCssSyncManager', 'syncBricksCssControls'].map(extract).join('\n'), sandbox);
  return { sandbox, required };
}
// The method names remain present even when webpack changes module IDs.
function engineModule() { return { handleCssInput() {}, flushCssInput() {}, refreshControls() {} }; }
(async () => {
  let passed = 0;
  for (const id of ['15000', '11433', '90210']) {
    const factory = () => {};
    const { sandbox, required } = context({ [id]: engineModule, 1: function unrelated() {} }, { [id]: { vK: factory } });
    assert.equal(sandbox.bricksCssSyncFactory(), factory);
    assert.deepEqual(required, [id]);
    assert.equal(sandbox.bricksCssSyncFactory(), factory);
    assert.deepEqual(required, [id], 'reuse discovery without reloading modules');
    passed++;
  }
  console.log('PASS sync discovery survives shuffled webpack IDs');
  const actualFactory = () => {};
  const decoy = context({ 3561: engineModule, 14255: engineModule }, {
    3561: { default: {} }, 14255: { vK: actualFactory }
  });
  assert.equal(decoy.sandbox.bricksCssSyncFactory(), actualFactory);
  assert.deepEqual(decoy.required, ['3561', '14255']);
  passed++;
  console.log('PASS editor component before engine does not block discovery');
  const missing = context({ 1: function unrelated() {} }, {});
  assert.equal(missing.sandbox.bricksCssSyncFactory(), null);
  assert.deepEqual(missing.required, []);
  passed++;
  console.log('PASS missing sync module does not execute unrelated modules');

  let finishInit;
  let refresh;
  const tracked = new Set();
  const flushed = [];
  let active = false;
  let ctx;
  const manager = {
    init: () => new Promise((resolve) => { finishInit = () => { active = true; resolve(); }; }),
    isActive: () => active,
    flushCssInput(css) {
      flushed.push(css);
      const hasColumns = css.includes('grid-template-columns');
      if (hasColumns) { tracked.add('_gridTemplateColumns'); ctx.target.settings._gridTemplateColumns = '1fr 1fr'; }
      else if (tracked.has('_gridTemplateColumns')) { delete ctx.target.settings._gridTemplateColumns; tracked.delete('_gridTemplateColumns'); }
      refresh();
    }
  };
  const factory = (options) => { refresh = options.refreshControls; return manager; };
  const { sandbox } = context({ 11433: engineModule }, { 11433: { vK: factory } });
  ctx = { kind: 'Element', key: '_cssCustom', s: {}, element: { id: 'test' },
    target: { settings: { _cssCustom: '%root% {display:grid;grid-template-columns:1fr 1fr;}', _gridTemplateColumns: '1fr 1fr' } } };
  sandbox.state.context = ctx;
  sandbox.ensureCssSyncManager(ctx);
  delete ctx.target.settings._cssCustom;
  sandbox.syncBricksCssControls('', true);
  finishInit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.target.settings._gridTemplateColumns, undefined);
  assert.equal(flushed.length, 2);
  assert.match(flushed[0], /grid-template-columns/);
  assert.equal(flushed[1], '');
  passed++;
  console.log('PASS deletion during engine initialization clears native settings');
  const before = ctx.s.cssSyncControlRefresh;
  refresh(); refresh();
  assert.equal(ctx.s.cssSyncControlRefresh, before + 2);
  passed++;
  console.log('PASS rapid updates each trigger native input refresh');
  const authored = '%root% { display: grid; gap: var(--grid-gap); @media (width >= 841px) { grid-template-columns: 1fr 1fr; } }';
  for (const pendingWrite of [false, true]) {
    let writes = 0;
    const settings = {_cssCustom: authored, _alignItems: 'initial', '_alignItems:tablet': 'initial', _display:'grid', _gridGap:'var(--grid-gap)'};
    const before = JSON.stringify(settings);
    const passive = vm.createContext({ state: {editor: {getValue: () => authored}, pendingWrite, ignoreExternalUntil: 0},
      renderBreadcrumbs() {}, setStatus() {}, syncHtmlEditorFromBricks() {}, toDisplayCss: (ctx, css) => css,
      writeToBricks() {writes++;} });
    const cleanup = source.includes('  function removeGeneratedAlignmentSettings(') ? extract('removeGeneratedAlignmentSettings') : '';
    vm.runInContext(cleanup + '\n' + ['cssWithoutCommentsAndStrings', 'stripGeneratedAlignmentDefaults', 'syncEditorFromBricks'].map(extract).join('\n'), passive);
    passive.syncEditorFromBricks({kind:'Element', target:{settings}, key:'_cssCustom'});
    assert.equal(JSON.stringify(settings), before, 'passive refresh must not trigger native setting watchers');
    assert.equal(writes, 0);
    passed++;
  }
  console.log('PASS passive refresh preserves native defaults and authored responsive CSS, including during pending writes');
  let engineOptions;
  const baseManager = {init:()=>Promise.resolve(),isActive:()=>true,flushCssInput(css){
    const suffix = engineOptions.state.breakpointActive === 'desktop' ? '' : ':'+engineOptions.state.breakpointActive;
    const settings = engineOptions.getSettings();
    for (const key of ['_display','_gridGap']) {
      delete settings[key];
      settings[key+suffix] = key === '_display' ? 'grid' : 'var(--grid-gap)';
    }
  }};
  const pinned = context({11433:engineModule},{11433:{vK:options=>{engineOptions=options;return baseManager;}}}).sandbox;
  const pinnedContext = {kind:'Element',key:'_cssCustom',s:{breakpointActive:'tablet_portrait',pseudoClassActive:''},element:{id:'test'},target:{settings:{_cssCustom:authored}}};
  pinned.state.context = pinnedContext;
  pinned.nativeCssControl = () => ({cssSyncManager:{isActive:()=>true,flushCssInput(){throw new Error('must not use viewport-scoped native manager');}}});
  pinned.ensureCssSyncManager(pinnedContext);
  for (const breakpoint of ['tablet_portrait','mobile_portrait','desktop','mobile_landscape']) {
    pinnedContext.s.breakpointActive = breakpoint;
    pinned.syncBricksCssControls(authored,true);
    assert.equal(pinnedContext.target.settings._display,'grid');
    assert.equal(pinnedContext.target.settings._gridGap,'var(--grid-gap)');
    assert.equal(engineOptions.state.breakpointActive,'desktop');
    assert.equal(pinnedContext.s.breakpointActive,breakpoint,'preview breakpoint must remain unchanged');
    assert.deepEqual(Object.keys(pinnedContext.target.settings).sort(),['_cssCustom','_display','_gridGap']);
  }
  pinnedContext.s.pseudoClassActive = ':hover';
  assert.equal(engineOptions.state.pseudoClassActive,':hover','other context remains live');
  passed++;
  console.log('PASS CSS sync keeps base control keys at every preview breakpoint and bypasses viewport-scoped native manager');
  console.log(`${passed} sync regression checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
