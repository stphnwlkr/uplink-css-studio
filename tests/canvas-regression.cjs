const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/studio.js', 'utf8');
const start = source.indexOf('  function syncDockCanvasHeight() {');
const end = source.indexOf('  function mountCanvasResizers()', start);
const properties = new Map();
let top = 48, panelTop = 600, previewBottom = 900, scale = 1, previewMode = false;
const state = { open: true, fullscreen: false };
const preview = {
  style: {
    getPropertyValue: key => properties.get(key),
    setProperty: (key, value) => properties.set(key, value),
    removeProperty: key => properties.delete(key),
  },
  matches: () => previewMode,
  getBoundingClientRect: () => ({ bottom: previewBottom }),
};
const shell = { hidden: false, getBoundingClientRect: () => ({ top: panelTop }) };
const wrapper = { getBoundingClientRect: () => ({ top }) };
const sandbox = {
  state,
  document: { querySelector: selector => ({ '#bricks-preview': preview, '#bricks-builder-iframe-wrapper': wrapper, '.uplink-css-studio-shell': shell })[selector] },
  getComputedStyle: () => ({ transform: scale === 1 ? 'none' : `matrix(${scale},0,0,${scale},0,0)` }),
  DOMMatrixReadOnly: class { constructor() { this.d = scale; } },
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end), sandbox);
const height = () => { sandbox.syncDockCanvasHeight(); return parseFloat(properties.get('--uplink-css-studio-canvas-height')); };
assert.equal(height(), 552);
scale = .5;
assert.equal(height() * scale + top, panelTop, 'scaled canvas ends at panel edge');
panelTop = 854;
assert.equal(height() * scale + top, panelTop, 'minimized dock exposes more canvas');
panelTop = 400;
assert.equal(height() * scale + top, panelTop, 'resizing dock reduces the scroll viewport');
scale = 1;
assert.equal(height(), 352, 'disabling scale uses screen height directly');
for (const mode of ['closed', 'hidden', 'fullscreen', 'preview']) {
  state.open = mode !== 'closed'; shell.hidden = mode === 'hidden';
  state.fullscreen = mode === 'fullscreen'; previewMode = mode === 'preview';
  height();
  assert.equal(properties.size, 0, `${mode} restores native canvas sizing`);
}
console.log('9 canvas sizing regression checks passed.');
