(function ($) {
  'use strict';

  const config = window.UplinkCssStudioConfig || {};
  const cssCatalog = window.UplinkCssStudioCatalog || { properties: [] };
  const catalogPropertyMap = new Map((cssCatalog.properties || []).map((property) => [property.name, property]));
  const storeKey = 'uplink-css-studio:prefs';
  const rootRule = '%root% {\n  \n}';
  let bricksCssSyncFactoryCache;
  const state = {
    open: false,
    minimized: false,
    fullscreen: false,
    preFullscreenMinimized: false,
    editor: null,
    proxy: null,
    context: null,
    original: '',
    originals: new Map(),
    timer: null,
    nativeSyncTimer: null,
    cssSyncManager: null,
    cssSyncSignature: '',
    cssSyncReady: false,
    cssSyncPending: null,
    pendingWrite: false,
    ignoreExternalUntil: 0,
    lastSyncedValue: '',
    contextTimer: null,
    outlineTimer: null,
    autocompleteTimer: null,
    decorationTimer: null,
    launcherTimer: null,
    launcherObserver: null,
    launcherPointerHandled: false,
    selectionOpenTimer: null,
    selectionOpenersBound: false,
    canvasFrame: null,
    canvasDocument: null,
    lastObservedElementId: '',
    firstClassElementId: '',
    siteWideContext: null,
    dismissedElementId: '',
    highlightedLine: null,
    valueMarks: [],
    valueTargets: new Map(),
    valueTargetSequence: 0,
    valueToolTarget: null,
    colorApplyHandler: null,
    colorReturnPopover: null,
    colorPicker: { h: 220, s: .85, v: .92 },
    scrub: null,
    forcedStates: new Set(),
    queryType: 'media',
    activePopover: null,
    popoverDrag: null,
    shortcutGroup: '',
    renderSequence: 0,
    breadcrumbSignature: '',
    applying: false,
    syncingNativeLayoutInput: false,
    prefs: readPrefs()
  };

  const groups = [
    { name: 'Spacing', items: [
      ['Padding', 'padding: {{space}};'],
      ['Margin', 'margin: {{space}};'],
      ['Gap', 'gap: {{space}};']
    ]},
    { name: 'Type', context: 'text', items: [
      ['Font size', 'font-size: clamp(1rem, 2vw, 1.5rem);'],
      ['Line height', 'line-height: 1.5;'],
      ['Text color', 'color: {{text}};'],
      ['Text align', 'text-align: center;']
    ]},
    { name: 'Size', items: [
      ['Max width', 'max-width: 72rem;'],
      ['Min height', 'min-height: 100svh;'],
      ['Aspect ratio', 'aspect-ratio: 16 / 9;'],
      ['Object fit', 'object-fit: cover;', 'media']
    ]},
    { name: 'Position', items: [
      ['Relative', 'position: relative;'],
      ['Absolute', 'position: absolute;\ninset: 0;'],
      ['Sticky', 'position: sticky;\ntop: 0;'],
      ['Layer', 'z-index: 1;']
    ]},
    { name: 'Surface', items: [
      ['Background', 'background: {{background}};'],
      ['Linear gradient', 'background: linear-gradient(135deg, {{primary}}, color-mix(in srgb, {{primary}} 55%, white));'],
      ['Radial gradient', 'background: radial-gradient(circle at center, {{primary}}, transparent 70%);'],
      ['Conic gradient', 'background: conic-gradient(from 90deg, {{primary}}, color-mix(in srgb, {{primary}} 55%, white), {{primary}});'],
      ['Border', 'border: 1px solid {{border}};'],
      ['Radius', 'border-radius: {{radius}};'],
      ['Box shadow', 'box-shadow: 0 16px 40px rgb(0 0 0 / 12%);'],
      ['Inset shadow', 'box-shadow: inset 0 0 0 1px rgb(255 255 255 / 12%);'],
      ['Text shadow', 'text-shadow: 0 2px 8px rgb(0 0 0 / 22%);', 'text']
    ]},
    { name: 'Effects', items: [
      ['Backdrop blur', 'backdrop-filter: blur(12px);'],
      ['Blur', 'filter: blur(4px);'],
      ['Brightness', 'filter: brightness(1.1);'],
      ['Clip overflow', 'overflow: clip;']
    ]},
    { name: 'Motion', items: [
      ['Transition', 'transition: all 180ms ease;'],
      ['Translate', 'transform: translateY(-0.25rem);'],
      ['Scale', 'transform: scale(1.03);'],
      ['Opacity', 'opacity: .75;']
    ]}
  ];

  const layoutPresets = {
    block: { display: 'block' },
    'flex-row': { display: 'flex', 'flex-direction': 'row' },
    'flex-column': { display: 'flex', 'flex-direction': 'column' },
    grid: { display: 'grid' }
  };
  const gridTemplatePresets = {
    columns: { 'grid-template-columns': 'repeat(3, minmax(0, 1fr))' },
    rows: { 'grid-template-rows': 'repeat(3, minmax(0, 1fr))' }
  };
  const recipeProvider = String(config.recipeProvider || 'CSS');
  const externalRecipes = Object.fromEntries(Object.entries(config.recipes || {}).filter(([name, css]) => name && typeof css === 'string' && css.trim()));
  const userRecipes = Object.fromEntries(Object.entries(config.userRecipes || {})
    .map(([name, recipe]) => [name, normalizeUserRecipe(recipe, name)])
    .filter(([name, recipe]) => name && recipe));

  function normalizeVariableName(variable) {
    const rawName = typeof variable === 'string' ? variable : variable?.name;
    const name = String(rawName || '').trim().replace(/^-+/, '');
    return /^[A-Za-z_][\w-]*$/.test(name) ? `--${name}` : '';
  }

  function variableNamesFrom(source) {
    const values = Array.isArray(source) ? source : (Array.isArray(source?.value) ? source.value : []);
    return values.map(normalizeVariableName).filter(Boolean);
  }

  function availableVariableEntries(editor = state.editor) {
    const configured = config.designVariables || {};
    const context = state.context;
    let proxyVariables = [];
    try {
      proxyVariables = context?.proxy?.$_globalVariables?.value || context?.proxy?.$_globalVariables || [];
    } catch (error) {
      proxyVariables = [];
    }
    const editorVariables = editor ? (editor.getValue().match(/--[A-Za-z_][\w-]*/g) || []) : [];
    const automaticCss = new Set(variableNamesFrom(configured.automaticCss));
    const bricks = new Set([
      ...variableNamesFrom(configured.bricks),
      ...variableNamesFrom(context?.s?.globalVariables),
      ...variableNamesFrom(proxyVariables)
    ]);
    const stylesheet = new Set(editorVariables.map(normalizeVariableName).filter(Boolean));
    return [...new Set([...bricks, ...automaticCss, ...stylesheet])]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({
        name,
        source: automaticCss.has(name) ? 'ACSS' : (bricks.has(name) ? 'Bricks' : 'Current stylesheet')
      }));
  }

  function availableVariableNames(editor = state.editor) {
    return availableVariableEntries(editor).map((variable) => variable.name);
  }

  const colorProperties = [
    'color', 'background-color', 'background', 'border-color', 'outline-color',
    'text-decoration-color', 'fill', 'stroke', 'caret-color', 'accent-color'
  ];
  const defaultElementTags = {
    'animated-typing': 'div', audio: 'div', 'back-to-top': 'button', block: 'div', button: 'span',
    container: 'div', div: 'div', dropdown: 'li', heading: 'h3', image: 'figure', 'post-title': 'h3',
    'product-title': 'h1', section: 'section', 'text-basic': 'div'
  };
  const automaticLabelSetting = '_uplinkCssStudioAutoLabel';

  function colorVariableEntries(editor = state.editor) {
    const colorNames = /(?:^--(?:primary|secondary|tertiary|base|neutral|black|white)(?:-|$)|(?:^|[-_])(?:color|colour|background|surface|accent|brand)(?:-|$)|^--(?:text|link|bg|divider)-(?:dark|light|muted|hover|ultra)|^--body-bg-color$)/i;
    const source = editor?.getValue?.() || '';
    const usedAsColor = new Set();
    const declarationPattern = /(?:color|background|border|outline|fill|stroke|shadow)[^:;{}]*:\s*[^;{}]*var\(\s*(--[\w-]+)/gi;
    let match;
    while ((match = declarationPattern.exec(source))) usedAsColor.add(match[1]);
    return availableVariableEntries(editor).filter((entry) => colorNames.test(entry.name) || usedAsColor.has(entry.name));
  }

  function designTokenReference(candidates, fallback) {
    const available = new Set(availableVariableNames());
    const registered = candidates.find((name) => available.has(name));
    return `var(${registered || candidates[0]}, ${fallback})`;
  }

  function resolvePresetCss(template) {
    const primary = 'var(--primary, #2563eb)';
    const tokens = {
      primary,
      space: designTokenReference(['--space-m', '--spacing-m', '--space-md', '--spacing-md'], '1.5rem'),
      text: designTokenReference(['--text-body', '--text-color', '--body-color', '--text-dark'], '#1f2937'),
      background: designTokenReference(['--background', '--background-color', '--surface', '--surface-primary'], '#ffffff'),
      border: designTokenReference(['--border', '--border-color', '--border-light'], '#d1d5db'),
      radius: designTokenReference(['--radius', '--radius-m', '--radius-md'], '0.5rem')
    };
    return String(template || '').replace(/\{\{(\w+)\}\}/g, (match, token) => tokens[token] || match);
  }

  const modernCssTerms = [
    'accent-color', 'anchor-name', 'anchor-scope', 'animation-composition', 'animation-range',
    'animation-range-end', 'animation-range-start', 'animation-timeline', 'aspect-ratio',
    'backdrop-filter', 'block-size', 'border-block', 'border-inline', 'box-decoration-break',
    'color-scheme', 'column-gap', 'contain', 'contain-intrinsic-size', 'container',
    'container-name', 'container-type', 'content-visibility', 'field-sizing', 'font-palette',
    'font-synthesis', 'font-variation-settings', 'gap', 'grid-template-areas',
    'grid-template-columns', 'grid-template-rows', 'hyphenate-character', 'inline-size',
    'inset', 'inset-block', 'inset-inline', 'interpolate-size', 'isolation', 'line-clamp',
    'margin-block', 'margin-inline', 'mask', 'mask-composite', 'max-block-size',
    'max-inline-size', 'min-block-size', 'min-inline-size', 'mix-blend-mode', 'object-fit',
    'object-position', 'offset', 'offset-anchor', 'offset-distance', 'offset-path',
    'overscroll-behavior', 'place-content', 'place-items', 'place-self', 'position-anchor',
    'position-area', 'position-try', 'row-gap', 'scroll-behavior', 'scroll-margin',
    'scroll-padding', 'scroll-snap-align', 'scroll-snap-type', 'shape-outside',
    'text-box', 'text-wrap', 'text-wrap-mode', 'text-wrap-style', 'touch-action',
    'transition-behavior', 'view-transition-class', 'view-transition-name', 'white-space-collapse',
    'writing-mode', '@container', '@layer', '@media', '@property', '@scope', '@starting-style',
    ':has()', ':is()', ':not()', ':where()', 'anchor()', 'clamp()', 'color-mix()',
    'light-dark()', 'min()', 'max()', 'repeat()', 'subgrid', 'var()'
  ];

  const cssAbbreviations = {
    ai: 'align-items', ac: 'align-content', as: 'align-self', ar: 'aspect-ratio',
    bg: 'background', bgc: 'background-color', bgi: 'background-image', br: 'border-radius',
    bs: 'box-shadow', c: 'color', cg: 'column-gap', d: 'display', fd: 'flex-direction',
    fg: 'flex-grow', fs: 'font-size', fw: 'font-weight', ff: 'font-family', g: 'gap',
    ga: 'grid-area', gtc: 'grid-template-columns', h: 'height', inset: 'inset', jc: 'justify-content',
    lh: 'line-height', ls: 'letter-spacing', m: 'margin', mah: 'max-height', maw: 'max-width',
    mih: 'min-height', miw: 'min-width', o: 'opacity', of: 'object-fit', ov: 'overflow',
    p: 'padding', pos: 'position', rg: 'row-gap', ta: 'text-align', td: 'text-decoration',
    tr: 'transition', tf: 'transform', ts: 'text-shadow', tt: 'text-transform', w: 'width',
    ws: 'white-space', zi: 'z-index'
  };

  const cssWideValues = ['inherit', 'initial', 'revert', 'revert-layer', 'unset'];
  const queryFeatures = {
    media: [
      'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height', 'orientation',
      'aspect-ratio', 'resolution', 'hover', 'any-hover', 'pointer', 'any-pointer',
      'prefers-color-scheme', 'prefers-reduced-motion', 'prefers-contrast', 'color-gamut',
      'forced-colors', 'display-mode', 'scripting'
    ],
    container: [
      'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
      'inline-size', 'min-inline-size', 'max-inline-size', 'block-size', 'min-block-size',
      'max-block-size', 'aspect-ratio', 'orientation'
    ]
  };
  const queryFeatureValues = {
    orientation: ['portrait', 'landscape'],
    hover: ['hover', 'none'],
    'any-hover': ['hover', 'none'],
    pointer: ['fine', 'coarse', 'none'],
    'any-pointer': ['fine', 'coarse', 'none'],
    'prefers-color-scheme': ['light', 'dark'],
    'prefers-reduced-motion': ['no-preference', 'reduce'],
    'prefers-contrast': ['no-preference', 'more', 'less', 'custom'],
    'color-gamut': ['srgb', 'p3', 'rec2020'],
    'forced-colors': ['none', 'active'],
    'display-mode': ['fullscreen', 'standalone', 'minimal-ui', 'browser', 'picture-in-picture'],
    scripting: ['none', 'initial-only', 'enabled']
  };
  const propertyValues = {
    display: ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'flow-root', 'contents', 'none'],
    position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
    'flex-direction': ['row', 'row-reverse', 'column', 'column-reverse'],
    'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
    'justify-content': ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly', 'stretch'],
    'align-items': ['start', 'center', 'end', 'stretch', 'baseline'],
    'align-content': ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly', 'stretch'],
    'align-self': ['auto', 'start', 'center', 'end', 'stretch', 'baseline'],
    'place-items': ['start', 'center', 'end', 'stretch'],
    'text-align': ['start', 'center', 'end', 'left', 'right', 'justify'],
    'text-transform': ['none', 'capitalize', 'uppercase', 'lowercase', 'full-width'],
    'text-decoration': ['none', 'underline', 'overline', 'line-through'],
    'font-style': ['normal', 'italic', 'oblique'],
    'font-weight': ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold', 'bolder', 'lighter'],
    overflow: ['visible', 'hidden', 'clip', 'scroll', 'auto'],
    'overflow-x': ['visible', 'hidden', 'clip', 'scroll', 'auto'],
    'overflow-y': ['visible', 'hidden', 'clip', 'scroll', 'auto'],
    'object-fit': ['fill', 'contain', 'cover', 'none', 'scale-down'],
    'background-size': ['auto', 'cover', 'contain'],
    'background-repeat': ['repeat', 'repeat-x', 'repeat-y', 'space', 'round', 'no-repeat'],
    'background-attachment': ['scroll', 'fixed', 'local'],
    'box-sizing': ['content-box', 'border-box'],
    cursor: ['auto', 'default', 'pointer', 'grab', 'grabbing', 'text', 'move', 'not-allowed', 'zoom-in', 'zoom-out'],
    'pointer-events': ['auto', 'none'],
    'white-space': ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces'],
    'text-wrap': ['wrap', 'nowrap', 'balance', 'pretty', 'stable'],
    visibility: ['visible', 'hidden', 'collapse'],
    isolation: ['auto', 'isolate'],
    'mix-blend-mode': ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'difference', 'exclusion'],
    'container-type': ['normal', 'size', 'inline-size'],
    'scroll-behavior': ['auto', 'smooth'],
    'scroll-snap-type': ['none', 'x mandatory', 'y mandatory', 'both mandatory', 'x proximity', 'y proximity'],
    'scroll-snap-align': ['none', 'start', 'center', 'end'],
    'transition-timing-function': ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(.2, .8, .2, 1)']
  };

  const stateSelectors = [
    ['Hover', ':hover', 'all'], ['Focus', ':focus', 'all'], ['Focus visible', ':focus-visible', 'all'],
    ['Focus within', ':focus-within', 'all'], ['Active', ':active', 'all'], ['Target', ':target', 'all'],
    ['Checked', ':checked', 'form'], ['Disabled', ':disabled', 'form'], ['Enabled', ':enabled', 'form'],
    ['Open', ':open', 'form'], ['Visited', ':visited', 'text']
  ];

  const icons = {
    studio: '<path d="M8 4H5v16h3M16 4h3v16h-3M10.5 8.5 8 12l2.5 3.5M13.5 8.5 16 12l-2.5 3.5"/>',
    outline: '<path d="M5 6h14M5 12h10M5 18h7"/>',
    shortcuts: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h.01M11 9h.01M15 9h.01M7 13h.01M11 13h.01M15 13h2M7 16h10"/>',
    spacing: '<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M12 2v3M10 4l2-2 2 2M12 19v3M10 20l2 2 2-2M2 12h3M4 10l-2 2 2 2M19 12h3M20 10l2 2-2 2"/>',
    type: '<path d="M5 19 11 5h2l6 14M7.5 14h9"/>',
    size: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="m8 11 3-3M8 8h3v3M16 13l-3 3M13 13v3h3"/>',
    position: '<path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"/><circle cx="12" cy="12" r="2"/>',
    surface: '<path d="m4 8 8-4 8 4-8 4Z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/>',
    motion: '<path d="M3 8h9M3 12h6M3 16h9M13 6l7 6-7 6Z"/>',
    flexRow: '<path d="M4 12h16M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
    flexColumn: '<path d="M12 4v16M8 7l4-4 4 4M8 17l4 4 4-4"/>',
    grid: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/>',
    gridColumns: '<rect x="4" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><rect x="16" y="4" width="4" height="16" rx="1"/>',
    gridRows: '<rect x="4" y="4" width="16" height="5" rx="1"/><rect x="4" y="10" width="16" height="5" rx="1"/><rect x="4" y="16" width="16" height="4" rx="1"/>',
    displayBlock: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M7 9h10M7 12h10M7 15h7"/>',
    center: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M12 8v8M8 12h8"/>',
    alignHStart: '<path d="M4 3v18"/><rect x="8" y="6" width="8" height="4" rx="1"/><rect x="8" y="14" width="12" height="4" rx="1"/>',
    alignHCenter: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="7" y="14" width="10" height="4" rx="1"/>',
    alignHEnd: '<path d="M20 3v18"/><rect x="8" y="6" width="8" height="4" rx="1"/><rect x="4" y="14" width="12" height="4" rx="1"/>',
    alignVStart: '<path d="M3 4h18"/><rect x="6" y="8" width="4" height="8" rx="1"/><rect x="14" y="8" width="4" height="12" rx="1"/>',
    alignVCenter: '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="7" width="4" height="10" rx="1"/>',
    alignVEnd: '<path d="M3 20h18"/><rect x="6" y="8" width="4" height="8" rx="1"/><rect x="14" y="4" width="4" height="12" rx="1"/>',
    queryBelow: '<path d="M19.9432 19.0137L19.4843 20.4414L4.05652 15.4824L4.5155 14.0547L19.9432 19.0137ZM19.9432 4.98242L5.89441 9.49805L19.9432 14.0137L19.4843 15.4414L4.24988 10.5449L4.24988 8.45117L19.4843 3.55469L19.9432 4.98242Z" fill="currentColor" stroke="none"/>',
    queryAbove: '<path d="M19.9432 15.4824L4.5155 20.4414L4.05652 19.0137L19.4843 14.0547L19.9432 15.4824ZM19.7499 8.45117V10.5449L4.5155 15.4414L4.05652 14.0137L18.1044 9.49805L4.05652 4.98242L4.5155 3.55469L19.7499 8.45117Z" fill="currentColor" stroke="none"/>',
    queryBetween: '<path d="M4 5v14M20 5v14M8 12h8M9 9l-3 3 3 3M15 9l3 3-3 3"/>',
    parent: '<path d="M8 5H5v14h3M16 5h3v14h-3M9 12h6M12 9l3 3-3 3"/>',
    target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    container: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 3v4M16 3v4M8 17v4M16 17v4"/>',
    media: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8M12 18v3M7 9l-2 2 2 2M17 9l2 2-2 2"/>',
    hover: '<path d="m6 3 11 9-5 1 3 6-2 1-3-6-4 4Z"/>',
    effects: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="4"/>',
    color: '<path d="M12 3.5c3.9 4.3 6 7.2 6 10a6 6 0 0 1-12 0c0-2.8 2.1-5.7 6-10Z"/><path d="M8.5 15.5c.7 1.4 1.9 2 3.5 2"/>',
    eyedropper: '<path d="m14.5 5.5 4 4M13 7l4-4 4 4-4 4M14.5 8.5 6 17l-3 4 4-3 8.5-8.5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    styleManager: '<path d="M5 3h14l-1.2 15L12 21l-5.8-3L5 3Z"/><path d="M8.5 7h7l-.3 3h-4.6l.2 2h4.2l-.4 4-2.6 1.2L9.4 16l-.2-1.7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7L10.5 2h-3l-.7 2-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7-2 .7v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7Z" transform="scale(.72) translate(4.7 4.7)"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
    comment: '<path d="M5 5h14v11H9l-4 4Z"/><path d="M9 9h6M9 12h4"/>',
    format: '<path d="M4 7h10M4 12h16M4 17h12M18 4v6M15 7h6"/>',
    addRecipe: '<path d="M6 3h9l3 3v15H6Z"/><path d="M15 3v4h4M9 13h6M12 10v6"/>',
    edit: '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10Z"/><path d="m13.5 7 3.5 3.5"/>',
    undo: '<path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6"/>',
    fullscreen: '<path d="M9 4H4v5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    exitFullscreen: '<path d="M9 4v5H4M15 4v5h5M20 15h-5v5M9 20v-5H4"/>',
    minimize: '<path d="M5 12h14"/>',
    restore: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M8 9h8"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>'
  };

  function icon(name) {
    return `<svg class="uplink-css-studio-svg" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ''}</svg>`;
  }

  function readPrefs() {
    const defaults = { autoOpen: true, firstAppliedClass: true, viewportHandles: true, numericScrubbing: true, minimized: false, dockHeight: '', colorMode: 'hex' };
    try { return Object.assign(defaults, JSON.parse(localStorage.getItem(storeKey)) || {}); } catch (e) { return defaults; }
  }

  function savePrefs() {
    localStorage.setItem(storeKey, JSON.stringify(state.prefs));
  }

  function findProxy() {
    if (state.proxy && state.proxy.$_state) return state.proxy;
    const candidates = [
      document.querySelector('.brx-body.main'),
      document.querySelector('.brx-body'),
      document.querySelector('#bricks-builder-app'),
      document.querySelector('[data-v-app]')
    ].filter(Boolean);
    document.querySelectorAll('body > div, [data-v-app], .brx-body').forEach((node) => {
      if (node.__vue_app__ && !candidates.includes(node)) candidates.push(node);
    });
    for (const node of candidates) {
      const app = node.__vue_app__;
      const proxy = app && app._instance && app._instance.proxy;
      if (proxy && proxy.$_state) return proxy;
      const globals = app && app.config && app.config.globalProperties;
      if (globals && globals.$_state) return globals;
    }
    return null;
  }

  function activeContext() {
    const proxy = state.proxy = findProxy() || state.proxy;
    if (!proxy || !proxy.$_state) return null;
    const s = proxy.$_state;
    const element = s.activeElement;
    if (!element) {
      state.firstClassElementId = '';
      state.siteWideContext = null;
      return null;
    }
    if (state.siteWideContext?.elementId !== element.id) state.siteWideContext = null;
    if (state.siteWideContext) {
      const themeStyle = s.themeStyles?.[state.siteWideContext.styleId];
      if (themeStyle) {
        themeStyle.settings = themeStyle.settings && !Array.isArray(themeStyle.settings) ? themeStyle.settings : {};
        themeStyle.settings.css = themeStyle.settings.css && !Array.isArray(themeStyle.settings.css) ? themeStyle.settings.css : {};
        return {
          proxy,
          s,
          element,
          target: { id: `theme-style:${state.siteWideContext.styleId}`, settings: themeStyle.settings.css },
          kind: 'Theme style',
          label: themeStyle.label || state.siteWideContext.styleId,
          key: 'stylesheet',
          breakpoint: 'global',
          pseudo: 'base',
          variant: '',
          elementType: 'container',
          themeStyleId: state.siteWideContext.styleId,
          htmlSelector: state.siteWideContext.selector
        };
      }
      state.siteWideContext = null;
    }
    selectFirstAppliedClass(proxy, s, element);
    const activeClass = s.activeClass || (proxy.$_activeClass && proxy.$_activeClass.value);
    const selector = s.activeSelector;
    let target = element;
    let kind = 'Element';
    let label = element.label || element.name || element.id;

    if (selector && selector.settings) {
      target = selector;
      kind = 'Selector';
      label = selector.name || selector.selector || 'Nested selector';
    } else if (activeClass && activeClass.settings) {
      target = activeClass;
      kind = 'Class';
      label = activeClass.name || activeClass.id;
    }

    target.settings = target.settings || {};
    const desktop = (s.breakpoints || []).find((item) => item && item.base) || { key: 'desktop' };
    const breakpoint = s.breakpointActive || desktop.key || 'desktop';
    const pseudo = s.pseudoClassActive || '';
    const pseudoSuffix = pseudo ? String(pseudo) : '';
    const variant = s.componentVariantActive || '';
    const variantSuffix = variant && variant !== 'default' && s.activeComponent && !activeClass ? ':' + variant : '';
    const key = '_cssCustom' + pseudoSuffix + variantSuffix;
    const name = String(element.name || '').toLowerCase();
    const elementType = /form|input|select|textarea|checkbox|radio/.test(name) ? 'form' : /text|heading|icon|button|link/.test(name) ? 'text' : /image|video|svg|audio/.test(name) ? 'media' : 'container';

    return { proxy, s, element, target, kind, label, key, breakpoint, pseudo: pseudo || 'base', variant: variant || '', elementType };
  }

  function selectFirstAppliedClass(proxy, s, element) {
    if (!state.prefs.firstAppliedClass || state.firstClassElementId === element.id) return;
    state.firstClassElementId = element.id;
    const classIds = Array.isArray(element.settings?._cssGlobalClasses) ? element.settings._cssGlobalClasses : [];
    const lockedIds = Array.isArray(s.globalClassesLocked) ? s.globalClassesLocked : [];
    const globalClass = classIds
      .filter((id) => !lockedIds.includes(id))
      .map((id) => (s.globalClasses || []).find((item) => item?.id === id))
      .find(Boolean);
    if (!globalClass) return;
    s.globalClassesSelected = s.globalClassesSelected || {};
    s.globalClassesSelected[element.id] = globalClass.id;
    s.activeSelector = undefined;
    s.activeClassIsLocked = false;
    s.activeClass = proxy.$_clone ? proxy.$_clone(globalClass) : globalClass;
  }

  function contextSignature(ctx) {
    return ctx ? `${ctx.element.id}|${ctx.target.id || ctx.label}|${ctx.key}` : '';
  }

  function contextElements(ctx) {
    const collections = [
      ctx?.proxy?.$_dynamicElements?.value,
      ctx?.s?.dynamicElements,
      ctx?.s?.activeComponent?.elements,
      ctx?.proxy?.$_activeComponent?.value?.elements
    ];
    const elements = [];
    const seen = new Set();
    collections.forEach((collection) => {
      if (!Array.isArray(collection)) return;
      collection.forEach((element) => {
        if (!element?.id || seen.has(element.id)) return;
        seen.add(element.id);
        elements.push(element);
      });
    });
    if (ctx?.element?.id && !seen.has(ctx.element.id)) elements.push(ctx.element);
    return elements;
  }

  function elementLabel(ctx, element) {
    try {
      const label = ctx?.proxy?.$_getElementLabel?.(element);
      if (label) return String(label);
    } catch (error) {}
    return String(element?.label || element?.name || element?.id || 'Element');
  }

  function elementHtmlTag(element) {
    const settings = element?.settings || {};
    const configured = settings.tag === 'custom' ? settings.customTag : settings.tag;
    const tag = String(configured || defaultElementTags[element?.name] || '').trim().toLowerCase();
    return /^[a-z][a-z0-9-]*$/.test(tag) ? tag : '';
  }

  function tagLabel(tag) {
    return String(tag || '').split('-').filter(Boolean).map((part) => {
      if (/^(?:h[1-6]|dl|dt|dd|ol|ul|li|svg)$/.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(' ');
  }

  function markElementContentDirty(ctx) {
    if (!ctx?.s) return;
    const key = ctx.s.activeComponent ? 'components' : 'content';
    ctx.s.unsavedChanges = Array.isArray(ctx.s.unsavedChanges) ? ctx.s.unsavedChanges : [];
    if (!ctx.s.unsavedChanges.includes(key)) ctx.s.unsavedChanges.push(key);
  }

  function syncAutomaticElementLabel(ctx) {
    const element = ctx?.element;
    const defaultTag = defaultElementTags[element?.name];
    if (!element || !defaultTag) return false;
    element.settings = element.settings && !Array.isArray(element.settings) ? element.settings : {};
    const settings = element.settings;
    const current = String(element.label || '').trim();
    const previousAutomatic = String(settings[automaticLabelSetting] || '').trim();
    const tag = elementHtmlTag(element);
    const shouldUseTag = Boolean(tag && tag !== defaultTag);

    if (previousAutomatic && current && current !== previousAutomatic) {
      delete settings[automaticLabelSetting];
      markElementContentDirty(ctx);
      return true;
    }

    if (!shouldUseTag) {
      if (!previousAutomatic) return false;
      if (current === previousAutomatic) delete element.label;
      delete settings[automaticLabelSetting];
      markElementContentDirty(ctx);
      return true;
    }

    if (current && !previousAutomatic) return false;
    const next = tagLabel(tag);
    if (!next || (current === next && previousAutomatic === next)) return false;
    element.label = next;
    settings[automaticLabelSetting] = next;
    markElementContentDirty(ctx);
    return true;
  }

  function hasCustomCss(settings) {
    return Object.entries(settings || {}).some(([key, value]) => key.startsWith('_cssCustom') && typeof value === 'string' && value.trim());
  }

  function elementCssSources(ctx, element) {
    const settings = element?.settings || {};
    const classIds = Array.isArray(settings._cssGlobalClasses) ? settings._cssGlobalClasses : [];
    const classCss = classIds.some((id) => {
      const globalClass = (ctx?.s?.globalClasses || []).find((item) => item?.id === id);
      return hasCustomCss(globalClass?.settings);
    });
    const own = hasCustomCss(settings);
    return { own, classCss, any: own || classCss };
  }

  function canvasElementNode(element) {
    if (!element?.id) return null;
    let frameDocument = state.canvasDocument;
    if (!frameDocument) {
      const frame = document.querySelector('#bricks-builder-iframe, #bricks-preview iframe');
      try { frameDocument = frame?.contentDocument; } catch (error) { frameDocument = null; }
    }
    if (!frameDocument) return null;
    const id = String(element.id);
    return frameDocument.querySelector(`[data-id="${id}"]`)
      || frameDocument.querySelector(`#brxe-${id}`)
      || frameDocument.querySelector(`.brxe-${id}`);
  }

  function cssRuleSelectors(source, start = 0, end = String(source || '').length) {
    const css = String(source || '');
    const selectors = [];
    let boundary = start;
    let quote = '';
    let comment = false;
    let escaped = false;
    for (let index = start; index < end; index += 1) {
      const char = css[index];
      const next = css[index + 1] || '';
      if (comment) {
        if (char === '*' && next === '/') { comment = false; index += 1; }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '/' && next === '*') { comment = true; index += 1; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === ';') {
        boundary = index + 1;
        continue;
      }
      if (char !== '{') continue;
      const close = matchingBrace(css, index);
      if (close < 0 || close > end) break;
      const prelude = css.slice(boundary, index).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (prelude.startsWith('@')) {
        if (!/^@(?:-\w+-)?keyframes\b/i.test(prelude)) selectors.push(...cssRuleSelectors(css, index + 1, close));
      } else if (prelude) {
        selectors.push(...splitCssTopLevel(prelude).map((selector) => selector.trim()).filter(Boolean));
      }
      index = close;
      boundary = close + 1;
    }
    return selectors;
  }

  function activeThemeStyles(ctx) {
    const styles = ctx?.s?.themeStyles || {};
    const activeIds = Array.isArray(ctx?.s?.themeStyleActiveIds) ? ctx.s.themeStyleActiveIds.filter((id) => styles[id]) : [];
    const ids = activeIds.length
      ? activeIds
      : Object.keys(styles).filter((id) => themeStyleConditions(styles[id]).some((condition) => condition?.main === 'any'));
    return [...new Set(ids)].map((id) => ({ id, style: styles[id] })).filter((item) => item.style);
  }

  function elementThemeStyleSources(ctx, element) {
    const node = canvasElementNode(element);
    const configuredTag = element?.settings?.tag === 'custom' ? element.settings.customTag : element?.settings?.tag;
    const tag = String(node?.tagName || configuredTag || '').toLowerCase();
    if (!tag && !node) return { tag: '', matches: [], any: false };
    const matches = activeThemeStyles(ctx).map(({ id, style }) => {
      const stylesheet = style?.settings?.css?.stylesheet;
      if (typeof stylesheet !== 'string' || !stylesheet.trim()) return null;
      const selector = cssRuleSelectors(stylesheet).find((candidate) => candidate.toLowerCase() === tag);
      return selector ? { id, label: style.label || id, selector } : null;
    }).filter(Boolean);
    return { tag, matches, any: matches.length > 0 };
  }

  function elementPath(ctx) {
    if (!ctx?.element) return [];
    const elements = contextElements(ctx);
    const byId = new Map(elements.map((element) => [element.id, element]));
    const path = [];
    const visited = new Set();
    let element = byId.get(ctx.element.id) || ctx.element;
    while (element?.id && !visited.has(element.id)) {
      visited.add(element.id);
      path.unshift(element);
      element = element.parent ? byId.get(element.parent) : null;
    }
    return path;
  }

  function renderBreadcrumbs(ctx) {
    const nav = document.querySelector('.uplink-css-studio-breadcrumbs');
    const editingTarget = document.querySelector('.uplink-css-studio-editing-target');
    const editingDivider = document.querySelector('.uplink-css-studio-editing-divider');
    if (!nav || !editingTarget || !editingDivider) return;
    if (!ctx) {
      state.breadcrumbSignature = '';
      nav.innerHTML = '<span class="uplink-css-studio-breadcrumb-empty">—</span>';
      editingTarget.hidden = true;
      editingDivider.hidden = true;
      return;
    }

    const path = elementPath(ctx);
    const parts = path.map((element) => {
      const label = elementLabel(ctx, element);
      const css = elementCssSources(ctx, element);
      const theme = elementThemeStyleSources(ctx, element);
      return `${element.id}:${label}:${css.own ? 1 : 0}:${css.classCss ? 1 : 0}:${theme.tag}:${theme.matches.map((match) => match.id).join(',')}`;
    });
    const signature = `${parts.join('|')}|${ctx.kind}|${ctx.label}`;
    if (signature === state.breadcrumbSignature) return;
    state.breadcrumbSignature = signature;

    nav.innerHTML = path.map((element, index) => {
      const label = elementLabel(ctx, element);
      const css = elementCssSources(ctx, element);
      const theme = elementThemeStyleSources(ctx, element);
      const themeSource = theme.any ? `active Theme Style ${theme.matches.map((match) => `"${match.label}"`).join(', ')} for <${theme.tag}>` : '';
      const sources = [css.own ? 'direct custom CSS' : '', css.classCss ? 'global class custom CSS' : '', themeSource].filter(Boolean).join(' and ');
      const tooltip = sources ? `${label} · ${sources}` : `${label} · no custom CSS`;
      const current = element.id === ctx.element.id ? ' aria-current="page"' : '';
      const marker = css.any ? '<span class="uplink-css-studio-breadcrumb-css" aria-hidden="true">{}</span><span class="screen-reader-text">Has custom CSS</span>' : '';
      const match = theme.matches[0];
      const themeMarker = match ? `<button class="uplink-css-studio-breadcrumb-theme" type="button" data-theme-element-id="${escapeAttr(element.id)}" data-theme-style-id="${escapeAttr(match.id)}" data-theme-selector="${escapeAttr(match.selector)}" aria-label="Open Theme Style ${escapeAttr(match.label)} for ${escapeAttr(theme.tag)}" data-tooltip="Open Theme Style ${escapeAttr(match.label)} for &lt;${escapeAttr(theme.tag)}&gt;">HTML</button>` : '';
      const separator = index ? '<span class="uplink-css-studio-breadcrumb-separator" aria-hidden="true">›</span>' : '';
      return `${separator}<span class="uplink-css-studio-breadcrumb-item"><button class="uplink-css-studio-breadcrumb" type="button" data-element-id="${escapeAttr(element.id)}" data-tooltip="${escapeAttr(tooltip)}"${current}><span class="uplink-css-studio-breadcrumb-label">${escapeHtml(label)}</span>${marker}</button>${themeMarker}</span>`;
    }).join('') || '<span class="uplink-css-studio-breadcrumb-empty">—</span>';

    const showEditingTarget = ctx.kind !== 'Element';
    editingTarget.hidden = !showEditingTarget;
    editingDivider.hidden = !showEditingTarget;
    editingTarget.querySelector('strong').textContent = showEditingTarget ? `${ctx.kind} · ${ctx.label}` : '';
  }

  function selectBreadcrumbElement(elementId) {
    const ctx = state.context || activeContext();
    if (!ctx || !elementId) return;
    const element = contextElements(ctx).find((item) => item?.id === elementId);
    if (!element) return;
    if (state.pendingWrite) writeToBricks(true);
    state.siteWideContext = null;
    closePopovers();
    ctx.s.activeId = element.id;
    if (typeof ctx.proxy.$_setActiveElement === 'function') ctx.proxy.$_setActiveElement();
    else ctx.s.activeElement = element;
  }

  function openBreadcrumbThemeStyle(elementId, styleId, selector, attempt = 0) {
    const ctx = state.context || activeContext();
    if (!ctx || !elementId || !styleId || !selector) return;
    if (ctx.element.id !== elementId) {
      if (!attempt) selectBreadcrumbElement(elementId);
      if (attempt < 6) setTimeout(() => openBreadcrumbThemeStyle(elementId, styleId, selector, attempt + 1), 50);
      return;
    }
    const themeStyle = ctx.s.themeStyles?.[styleId];
    if (!themeStyle) {
      setStatus('The matching Theme Style is no longer available', 'dirty');
      return;
    }
    if (state.pendingWrite) writeToBricks(true);
    state.siteWideContext = { elementId, styleId, selector };
    closePopovers();
    const themeContext = activeContext();
    if (!themeContext || themeContext.kind !== 'Theme style') {
      setStatus('Could not open the Theme Style stylesheet', 'dirty');
      return;
    }
    setContext(themeContext);
    requestAnimationFrame(() => focusStylesheetSelector(selector));
    setStatus(`Editing ${themeStyle.label || styleId} Theme Style`, 'synced');
  }

  function nativeCssControl() {
    const nodes = document.querySelectorAll('#bricks-panel-element .code-editor-wrapper[data-control="code"], #bricks-panel-element [data-control="code"]');
    for (const node of nodes) {
      let instance = node.__vueParentComponent;
      while (instance) {
        const control = instance.proxy;
        if (control?.controlKey === '_cssCustom' && control?.isCssCustomControl) return control;
        instance = instance.parent;
      }
    }
    return null;
  }

  function contextRootSelector(ctx, control = nativeCssControl()) {
    if (ctx?.kind === 'Theme style') return '';
    if (control?.cssId) return control.cssId;
    if (ctx?.kind === 'Class' && ctx.target?.name) return `.${ctx.target.name}`;
    return ctx?.element?.id ? `#brxe-${ctx.element.id}` : '';
  }

  function replaceContextRoot(ctx, from, to, css) {
    if (!css || !from || !to) return css || '';
    const control = nativeCssControl();
    const replace = control?.$_replaceCustomCssRoot || ctx?.proxy?.$_replaceCustomCssRoot;
    if (typeof replace === 'function') return replace.call(control || ctx.proxy, from, to, css);
    return String(css).split(from).join(to);
  }

  function toStoredCss(ctx, displayCss) {
    const root = contextRootSelector(ctx);
    return root ? replaceContextRoot(ctx, '%root%', root, displayCss) : displayCss;
  }

  function toDisplayCss(ctx, storedCss) {
    const root = contextRootSelector(ctx);
    return root ? replaceContextRoot(ctx, root, '%root%', storedCss) : storedCss;
  }

  function buildUI() {
    document.body.insertAdjacentHTML('beforeend', `
      <button id="uplink-css-studio-launcher" type="button" aria-label="Open CSS Studio" data-tooltip="CSS Studio · ⌘⇧C" hidden>
        ${icon('studio')}
      </button>
      <div class="uplink-css-studio-tooltip" role="tooltip" hidden></div>
      <div class="uplink-css-studio-canvas-resizers" aria-label="Canvas resize handles" hidden>
        <button class="uplink-css-studio-canvas-resize-handle uplink-css-studio-canvas-resize-left" type="button" data-canvas-resize="left" aria-label="Resize canvas from left" data-tooltip="Resize canvas width"></button>
        <button class="uplink-css-studio-canvas-resize-handle uplink-css-studio-canvas-resize-right" type="button" data-canvas-resize="right" aria-label="Resize canvas from right" data-tooltip="Resize canvas width"></button>
      </div>
      <div class="uplink-css-studio-shell" hidden>
        <div class="uplink-css-studio-resizer" aria-hidden="true"></div>
        <section class="uplink-css-studio-window" aria-label="CSS Studio workspace">
          <header class="uplink-css-studio-header">
            <div class="uplink-css-studio-brand">${icon('studio')}<span>${escapeHtml(config.labels?.title || 'CSS Studio')}</span></div>
            <div class="uplink-css-studio-context-summary">
              <nav class="uplink-css-studio-breadcrumbs" aria-label="Element structure"><span class="uplink-css-studio-breadcrumb-empty">—</span></nav>
              <span class="uplink-css-studio-context-divider uplink-css-studio-editing-divider" hidden>·</span>
              <span class="uplink-css-studio-chip uplink-css-studio-editing-target" hidden><strong></strong></span>
              <span class="uplink-css-studio-context-divider">/</span>
              <span class="uplink-css-studio-chip uplink-css-studio-breakpoint"><strong>—</strong></span>
              <span class="uplink-css-studio-context-divider">/</span>
              <span class="uplink-css-studio-chip uplink-css-studio-state"><strong>—</strong></span>
            </div>
            <div class="uplink-css-studio-header-spacer"></div>
            <button class="uplink-css-studio-icon-button uplink-css-studio-style-manager" type="button" aria-label="Open Bricks Style Manager" data-tooltip="Bricks Style Manager · ⌘.">${icon('styleManager')}</button>
            <button class="uplink-css-studio-icon-button uplink-css-studio-preferences-toggle" type="button" aria-label="CSS Studio preferences" data-tooltip="Preferences">${icon('settings')}</button>
            <button class="uplink-css-studio-icon-button uplink-css-studio-revert" type="button" aria-label="Revert session changes" data-tooltip="Revert session changes">${icon('undo')}</button>
            <button class="uplink-css-studio-icon-button uplink-css-studio-fullscreen" type="button" aria-label="Open full-screen editor" data-tooltip="Full-screen editor">${icon('fullscreen')}</button>
            <button class="uplink-css-studio-icon-button uplink-css-studio-minimize" type="button" aria-label="Minimize CSS Studio" data-tooltip="Minimize">${icon('minimize')}</button>
            <button class="uplink-css-studio-icon-button uplink-css-studio-close" type="button" aria-label="Close CSS Studio" data-tooltip="Close">${icon('close')}</button>
          </header>
          <div class="uplink-css-studio-toolbar" role="toolbar" aria-label="CSS tools">
            <button class="uplink-css-studio-tool uplink-css-studio-outline-toggle" type="button" aria-label="Toggle stylesheet outline" data-tooltip="Outline · ⌘⇧O">${icon('outline')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-recipes-toggle" type="button" aria-label="Open recipe manager" data-tooltip="Recipe manager">${icon('shortcuts')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-targets-toggle" type="button" aria-label="CSS selector target" data-tooltip="%root%, class, ID & HTML">${icon('target')}</button>
            <span class="uplink-css-studio-toolbar-divider" aria-hidden="true"></span>
            <button class="uplink-css-studio-tool uplink-css-studio-layout-action uplink-css-studio-display-block" type="button" data-layout-preset="block" aria-label="Display block" aria-pressed="false" data-tooltip="Display: Block" hidden>${icon('displayBlock')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-layout-action" type="button" data-layout-preset="flex-row" aria-label="Display flex row" aria-pressed="false" data-tooltip="Display: Flex row">${icon('flexRow')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-layout-action" type="button" data-layout-preset="flex-column" aria-label="Display flex column" aria-pressed="false" data-tooltip="Display: Flex column">${icon('flexColumn')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-layout-action" type="button" data-layout-preset="grid" aria-label="Display grid" aria-pressed="false" data-tooltip="Display: Grid">${icon('grid')}</button>
            <span class="uplink-css-studio-grid-template-tools" hidden>
              <button class="uplink-css-studio-tool uplink-css-studio-grid-template-action" type="button" data-grid-template="columns" aria-label="Grid template columns" aria-pressed="false" data-tooltip="Grid template columns">${icon('gridColumns')}</button>
              <button class="uplink-css-studio-tool uplink-css-studio-grid-template-action" type="button" data-grid-template="rows" aria-label="Grid template rows" aria-pressed="false" data-tooltip="Grid template rows">${icon('gridRows')}</button>
            </span>
            <span class="uplink-css-studio-alignment-tools" hidden>
              <span class="uplink-css-studio-toolbar-divider" aria-hidden="true"></span>
              <button class="uplink-css-studio-tool uplink-css-studio-alignment-action" type="button" data-alignment-axis="main" data-alignment-value="start" aria-label="Main axis: start" aria-pressed="false" data-tooltip="Main axis: start"></button>
              <button class="uplink-css-studio-tool uplink-css-studio-alignment-action" type="button" data-alignment-axis="main" data-alignment-value="center" aria-label="Main axis: center" aria-pressed="false" data-tooltip="Main axis: center"></button>
              <button class="uplink-css-studio-tool uplink-css-studio-alignment-action" type="button" data-alignment-axis="main" data-alignment-value="end" aria-label="Main axis: end" aria-pressed="false" data-tooltip="Main axis: end"></button>
              <span class="uplink-css-studio-toolbar-divider" aria-hidden="true"></span>
              <button class="uplink-css-studio-tool uplink-css-studio-alignment-action" type="button" data-alignment-axis="cross" data-alignment-value="start" aria-label="Cross axis: start" aria-pressed="false" data-tooltip="Cross axis: start"></button>
              <button class="uplink-css-studio-tool uplink-css-studio-alignment-action" type="button" data-alignment-axis="cross" data-alignment-value="center" aria-label="Cross axis: center" aria-pressed="false" data-tooltip="Cross axis: center"></button>
              <button class="uplink-css-studio-tool uplink-css-studio-alignment-action" type="button" data-alignment-axis="cross" data-alignment-value="end" aria-label="Cross axis: end" aria-pressed="false" data-tooltip="Cross axis: end"></button>
              <button class="uplink-css-studio-tool uplink-css-studio-place-alignment" type="button" data-place-value="center" aria-label="Place center" aria-pressed="false" data-tooltip="Place center">${icon('center')}</button>
            </span>
            <span class="uplink-css-studio-toolbar-divider" aria-hidden="true"></span>
            <button class="uplink-css-studio-tool uplink-css-studio-shortcut-category" type="button" data-shortcut-group="Spacing" aria-label="Spacing shortcuts" data-tooltip="Spacing">${icon('spacing')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-shortcut-category" type="button" data-shortcut-group="Type" data-context="text" aria-label="Typography shortcuts" data-tooltip="Typography">${icon('type')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-shortcut-category" type="button" data-shortcut-group="Size" aria-label="Sizing shortcuts" data-tooltip="Sizing">${icon('size')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-shortcut-category" type="button" data-shortcut-group="Position" aria-label="Position shortcuts" data-tooltip="Position">${icon('position')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-shortcut-category" type="button" data-shortcut-group="Surface" aria-label="Surface shortcuts" data-tooltip="Surface">${icon('surface')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-colors-toggle" type="button" aria-label="Color tools" data-tooltip="Colors">${icon('color')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-shortcut-category" type="button" data-shortcut-group="Effects" aria-label="Effect shortcuts" data-tooltip="Effects">${icon('effects')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-shortcut-category" type="button" data-shortcut-group="Motion" aria-label="Motion shortcuts" data-tooltip="Motion">${icon('motion')}</button>
            <span class="uplink-css-studio-toolbar-divider" aria-hidden="true"></span>
            <button class="uplink-css-studio-tool" type="button" data-recipe="parent" aria-label="Has me selector" data-tooltip="Has me selector :has(> &)">${icon('parent')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-container-toggle" type="button" aria-label="Container queries" data-tooltip="Container queries">${icon('container')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-media-toggle" type="button" aria-label="Media queries" data-tooltip="Media queries">${icon('media')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-states-toggle" type="button" aria-label="State selector" data-tooltip="State selector">${icon('hover')}</button>
            <span class="uplink-css-studio-toolbar-spacer"></span>
            <button class="uplink-css-studio-tool uplink-css-studio-search" type="button" aria-label="Find in CSS" data-tooltip="Find · ⌘F">${icon('search')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-comment" type="button" aria-label="Toggle comment" data-tooltip="Toggle comment · ⌘/">${icon('comment')}</button>
            <button class="uplink-css-studio-tool uplink-css-studio-format" type="button" aria-label="Format CSS" data-tooltip="Format CSS">${icon('format')}</button>
          </div>
          <div class="uplink-css-studio-editor-wrap">
            <textarea id="uplink-css-source" aria-label="CSS source"></textarea>
            <aside class="uplink-css-studio-popover uplink-css-studio-outline-panel" hidden aria-label="Stylesheet outline">
              <div class="uplink-css-studio-popover-head"><strong>Outline</strong><span class="uplink-css-studio-outline-count">0</span></div>
              <input class="uplink-css-studio-outline-search" type="search" placeholder="Filter headings…" aria-label="Filter outline headings">
              <div class="uplink-css-studio-outline-list"></div>
            </aside>
            <aside class="uplink-css-studio-popover uplink-css-studio-recipes-panel uplink-css-studio-snippets-panel" hidden aria-label="Recipe manager">
              <div class="uplink-css-studio-popover-head"><strong>Recipe manager</strong><div class="uplink-css-studio-popover-actions"><span class="uplink-css-studio-recipe-summary">${escapeHtml(recipeSummary())}</span><button class="uplink-css-studio-popover-icon uplink-css-studio-recipe-editor-toggle" type="button" aria-label="Create or edit a recipe" data-tooltip="Create or edit recipe">${icon('edit')}</button></div></div>
              <input class="uplink-css-studio-snippet-search" type="search" placeholder="Filter recipes…" aria-label="Filter recipes">
              <div class="uplink-css-studio-snippet-panel-body"></div>
              <form class="uplink-css-studio-recipe-editor" hidden>
                <div class="uplink-css-studio-recipe-fields">
                  <label><span>Saved recipe</span><select class="uplink-css-studio-recipe-select" aria-label="Select a custom recipe"><option value="">New recipe…</option></select></label>
                  <label><span>Recipe name</span><input class="uplink-css-studio-recipe-label" type="text" placeholder="Card grid" autocomplete="off"></label>
                  <label><span>Keyboard shortcut</span><input class="uplink-css-studio-recipe-name" type="text" placeholder="card-grid" autocomplete="off"></label>
                  <label><span>Category</span><input class="uplink-css-studio-recipe-category" type="text" placeholder="Layout" list="uplink-css-studio-recipe-categories" autocomplete="off"><datalist id="uplink-css-studio-recipe-categories"></datalist></label>
                  <label><span>CSS expansion</span><textarea class="uplink-css-studio-recipe-css" placeholder="%root% {&#10;  display: grid;&#10;}"></textarea></label>
                  <p>Type <code>@shortcut;</code> in the CSS editor to insert the recipe. Categories group saved recipes in this panel.</p>
                </div>
                <div class="uplink-css-studio-recipe-actions"><button class="uplink-css-studio-action uplink-css-studio-recipe-editor-back" type="button">Back</button><button class="uplink-css-studio-action uplink-css-studio-recipe-delete" type="button" hidden>Delete</button><button class="uplink-css-studio-action is-primary uplink-css-studio-recipe-save" type="submit">Save recipe</button></div>
              </form>
            </aside>
            <aside class="uplink-css-studio-popover uplink-css-studio-shortcuts-panel" hidden aria-label="CSS shortcuts">
              <div class="uplink-css-studio-popover-head"><strong class="uplink-css-studio-shortcut-title">CSS shortcuts</strong><span>Insert into the active rule</span></div>
              <div class="uplink-css-studio-option-grid uplink-css-studio-shortcut-list"></div>
            </aside>
            <aside class="uplink-css-studio-popover uplink-css-studio-colors-panel" hidden aria-label="Color tools">
              <div class="uplink-css-studio-popover-head"><strong>Color</strong><div class="uplink-css-studio-popover-actions"><span class="uplink-css-studio-color-context">Insert a color</span><button class="uplink-css-studio-popover-icon uplink-css-studio-color-close" type="button" aria-label="Close color picker">${icon('close')}</button></div></div>
              <div class="uplink-css-studio-color-tabs" role="tablist" aria-label="Color source">
                <button type="button" role="tab" data-color-tab="palette" aria-selected="true">Palette</button>
                <button type="button" role="tab" data-color-tab="custom" aria-selected="false">Custom</button>
              </div>
              <div class="uplink-css-studio-color-palette-view">
                <div class="uplink-css-studio-color-controls">
                  <select class="uplink-css-studio-color-property" aria-label="Color property">${colorProperties.map((property) => `<option value="${property}">${property}</option>`).join('')}</select>
                  <input class="uplink-css-studio-color-search" type="search" placeholder="Filter colors and variables…" aria-label="Filter colors and variables">
                </div>
                <div class="uplink-css-studio-color-list"></div>
              </div>
              <div class="uplink-css-studio-color-custom-view" hidden>
                <select class="uplink-css-studio-color-mode" aria-label="Color output format"><option value="hex">HEX</option><option value="rgb">RGB</option><option value="hsl">HSL</option><option value="oklch">OKLCH</option></select>
                <div class="uplink-css-studio-color-sv" role="slider" aria-label="Color saturation and brightness" tabindex="0"><span></span></div>
                <input class="uplink-css-studio-color-hue" type="range" min="0" max="360" step="1" value="220" aria-label="Color hue">
                <label class="uplink-css-studio-color-alpha"><span>Alpha</span><input type="range" min="0" max="100" step="1" value="100" aria-label="Color alpha"><output>100%</output></label>
                <div class="uplink-css-studio-color-custom">
                  <input class="uplink-css-studio-color-native" type="color" value="#2563eb" aria-label="Choose a custom color" data-tooltip="Choose custom color">
                  <input class="uplink-css-studio-color-value" type="text" value="var(--primary, #2563eb)" placeholder="#2563eb, oklch(…), or var(--primary)" aria-label="CSS color value" autocomplete="off">
                  <button class="uplink-css-studio-popover-icon uplink-css-studio-color-eyedropper" type="button" aria-label="Pick a color from the canvas" data-tooltip="Pick color from canvas">${icon('eyedropper')}</button>
                  <button class="uplink-css-studio-popover-icon uplink-css-studio-color-apply" type="button" aria-label="Insert color" data-tooltip="Insert color">${icon('check')}</button>
                </div>
              </div>
            </aside>
            <aside class="uplink-css-studio-popover uplink-css-studio-targets-panel" hidden aria-label="CSS selector target">
              <div class="uplink-css-studio-popover-head"><strong>CSS target</strong><span>Element or site-wide HTML</span></div>
              <div class="uplink-css-studio-targets-body">
                <button class="uplink-css-studio-root-rule" type="button"><code>%root%</code><span>Insert the active element selector</span>${icon('target')}</button>
                <label class="uplink-css-studio-target-field"><span>Global class</span><div><input class="uplink-css-studio-class-input" type="text" placeholder="feature-card" autocomplete="off"><button class="uplink-css-studio-assign-class" type="button" aria-label="Create or attach global class" data-tooltip="Create or attach global class">${icon('target')}</button></div></label>
                <label class="uplink-css-studio-target-field"><span>ID</span><div><input class="uplink-css-studio-id-input" type="text" placeholder="features" autocomplete="off"><button class="uplink-css-studio-assign-id" type="button" aria-label="Assign ID and insert root selector" data-tooltip="Assign ID & insert %root%">${icon('target')}</button></div></label>
                <div class="uplink-css-studio-target-separator" role="separator"><span>Site-wide HTML</span></div>
                <label class="uplink-css-studio-target-field"><span>HTML selector</span><div><input class="uplink-css-studio-html-input" type="text" placeholder="address, dl, dt, dd" autocomplete="off"><button class="uplink-css-studio-open-html-target" type="button" aria-label="Edit HTML selector in the active Theme Style" data-tooltip="Edit in Theme Style stylesheet">${icon('styleManager')}</button></div></label>
                <p>HTML tags are edited in the applicable site-wide <strong>Theme Style → Stylesheet</strong>. CSS Studio opens that native stylesheet here and adds the selector when needed.</p>
              </div>
            </aside>
            <aside class="uplink-css-studio-popover uplink-css-studio-states-panel" hidden aria-label="State selectors">
              <div class="uplink-css-studio-popover-head"><strong>State selector</strong><span>Nested in a rule, rooted at stylesheet level</span></div>
              <div class="uplink-css-studio-option-grid uplink-css-studio-states-list"></div>
            </aside>
            <aside class="uplink-css-studio-popover uplink-css-studio-preferences-panel" hidden aria-label="CSS Studio preferences">
              <div class="uplink-css-studio-popover-head"><strong>Preferences</strong><span>Saved in this browser</span></div>
              <label class="uplink-css-studio-switch-row"><span><strong>Open on element selection</strong><small>Show the editor when an element is clicked in the canvas or Structure panel.</small></span><input class="uplink-css-studio-auto-open" type="checkbox"></label>
              <label class="uplink-css-studio-switch-row"><span><strong>Select first applied class</strong><small>Edit the first unlocked global class when moving to another element.</small></span><input class="uplink-css-studio-first-class" type="checkbox"></label>
              <label class="uplink-css-studio-switch-row"><span><strong>Viewport resize handles</strong><small>Show width controls on the left and right edges of the visible canvas.</small></span><input class="uplink-css-studio-viewport-handles" type="checkbox"></label>
              <label class="uplink-css-studio-switch-row"><span><strong>Numeric scrubbing</strong><small>Drag numeric CSS values horizontally. Toggle with Cmd/Ctrl+Alt+X.</small></span><input class="uplink-css-studio-numeric-scrubbing" type="checkbox"></label>
              <p class="uplink-css-studio-pref-note">The editor also remembers whether it was minimized or expanded.</p>
            </aside>
            <aside class="uplink-css-studio-popover uplink-css-studio-value-panel" hidden aria-label="CSS value editor">
              <div class="uplink-css-studio-popover-head"><strong class="uplink-css-studio-value-title">CSS value</strong><button class="uplink-css-studio-popover-icon uplink-css-studio-value-close" type="button" aria-label="Close value editor">${icon('close')}</button></div>
              <div class="uplink-css-studio-value-body"></div>
            </aside>
            <aside class="uplink-css-studio-popover uplink-css-studio-query-panel" hidden aria-label="Responsive query shortcuts">
              <div class="uplink-css-studio-popover-head"><strong class="uplink-css-studio-query-title">Media queries</strong><span class="uplink-css-studio-query-context">width</span></div>
              <div class="uplink-css-studio-query-list"></div>
            </aside>
            <div class="uplink-css-studio-empty" hidden>${escapeHtml(config.labels?.noSelection || 'Select an element in Bricks to edit its CSS.')}</div>
          </div>
          <footer class="uplink-css-studio-footer">
            <span class="uplink-css-studio-status">Ready</span>
            <span class="uplink-css-studio-position">Ln 1, Col 1</span>
            <span class="uplink-css-studio-shortcuts"><kbd>@recipe;</kbd> insert recipe &nbsp; <kbd>r Tab</kbd> %root% &nbsp; <kbd>⌘⌥X</kbd> scrub</span>
          </footer>
        </section>
      </div>`);

    renderSnippets();
    renderStateOptions();
    const settings = $.extend(true, {}, config.editorSettings || {}, {
      codemirror: {
        mode: 'text/css', lineNumbers: true, lineWrapping: true, indentUnit: 2,
        gutters: ['CodeMirror-linenumbers', 'uplink-css-studio-rule-gutter'],
        tabSize: 2, autoCloseBrackets: true, matchBrackets: true, styleActiveLine: true,
        extraKeys: {
          'Cmd-S': flushSync,
          'Ctrl-S': flushSync,
          'Ctrl-Space': autocomplete,
          'Tab': completeCssProperty,
          'Cmd-/': 'toggleComment',
          'Ctrl-/': 'toggleComment',
          'Cmd-Shift-O': toggleOutline,
          'Ctrl-Shift-O': toggleOutline,
          'Cmd-Alt-X': toggleNumericScrubbing,
          'Ctrl-Alt-X': toggleNumericScrubbing
        },
        hintOptions: { completeSingle: false, closeOnUnfocus: true }
      }
    });
    state.editor = wp.codeEditor.initialize($('#uplink-css-source'), settings).codemirror;
    state.editor.on('change', onEditorChange);
    state.editor.on('inputRead', maybeAutocomplete);
    state.editor.on('cursorActivity', () => {
      updateCursorPosition();
      refreshLayoutTools();
    });
    state.editor.on('gutterClick', toggleDeclarationAtLine);
    state.editor.getWrapperElement().addEventListener('pointerdown', handleValuePointerDown);
    state.editor.getWrapperElement().addEventListener('click', handleValueClick);
    bindEvents();
    mountLauncher();
    mountCanvasResizers();
    state.contextTimer = setInterval(refreshContext, 80);
  }

  function recipeLabel(name) {
    return String(name).replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function recipeSummary() {
    const summary = [];
    const customCount = Object.keys(userRecipes).length;
    const providerCount = Object.keys(externalRecipes).length;
    if (customCount) summary.push(`${customCount} custom`);
    if (providerCount) summary.push(`${providerCount} ${recipeProvider}`);
    return summary.join(' · ') || 'No saved recipes';
  }

  function recipeCatalog() {
    const catalog = {};
    Object.entries(externalRecipes).forEach(([name, css]) => { catalog[name] = { css, label: recipeLabel(name), provider: recipeProvider }; });
    Object.entries(userRecipes).forEach(([name, recipe]) => { catalog[name] = { css: recipe.css, label: recipe.label, provider: recipe.category }; });
    return catalog;
  }

  function renderRecipeGroup(title, names, source) {
    if (!names.length) return '';
    return `<section class="uplink-css-studio-group" data-context="all">
      <h3 class="uplink-css-studio-group-title">${escapeHtml(title)}</h3>
      ${names.map((name) => {
        const label = source === 'user' ? userRecipes[name].label : recipeLabel(name);
        const recipe = `<button class="uplink-css-studio-snippet uplink-css-studio-recipe" type="button" data-recipe-source="${source}" data-recipe-name="${escapeAttr(name)}"><span>${escapeHtml(label)}</span><code>${escapeHtml(name)}</code></button>`;
        return source === 'user'
          ? `<div class="uplink-css-studio-recipe-row">${recipe}<button class="uplink-css-studio-recipe-edit" type="button" data-edit-recipe="${escapeAttr(name)}" aria-label="Edit ${escapeAttr(label)}" data-tooltip="Edit recipe">${icon('edit')}</button></div>`
          : recipe;
      }).join('')}
    </section>`;
  }

  function renderSnippets(filter = '') {
    const panel = document.querySelector('.uplink-css-studio-snippet-panel-body');
    const query = String(filter).trim().toLowerCase();
    const providerItems = Object.keys(externalRecipes).filter((name) => !query || `${name} ${recipeLabel(name)}`.toLowerCase().includes(query));
    const customItems = Object.keys(userRecipes).filter((name) => !query || `${name} ${userRecipes[name].label} ${userRecipes[name].category}`.toLowerCase().includes(query));
    const customCategories = [...new Set(customItems.map((name) => userRecipes[name].category))].sort((a, b) => a.localeCompare(b));
    const customHtml = customCategories.map((category) => renderRecipeGroup(category, customItems.filter((name) => userRecipes[name].category === category), 'user')).join('');
    const providerHtml = renderRecipeGroup(`${recipeProvider} recipes`, providerItems, 'external');
    panel.innerHTML = customHtml + providerHtml || '<p class="uplink-css-studio-snippet-empty">No matching recipes.</p>';
    const summary = document.querySelector('.uplink-css-studio-recipe-summary');
    if (summary) summary.textContent = recipeSummary();
  }

  function renderShortcutGroup(groupName) {
    const group = groups.find((item) => item.name === groupName);
    const title = document.querySelector('.uplink-css-studio-shortcut-title');
    const list = document.querySelector('.uplink-css-studio-shortcut-list');
    if (!group || !title || !list) return;
    title.textContent = group.name;
    list.innerHTML = group.items.map((item) => {
      const css = resolvePresetCss(item[1]);
      return `
      <button type="button" data-css="${escapeAttr(css)}" data-context="${item[2] || 'all'}">
        <strong>${escapeHtml(item[0])}</strong><code>${escapeHtml(css.split(':')[0])}</code>
      </button>`;
    }).join('');
    const elementType = state.context?.elementType || '';
    list.querySelectorAll('[data-context]').forEach((node) => {
      const required = node.dataset.context;
      node.hidden = Boolean(required !== 'all' && elementType && !required.split(',').includes(elementType));
    });
  }

  function currentColorDeclaration() {
    const editor = state.editor;
    if (!editor) return null;
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line) || '';
    const match = line.match(/^(\s*)([-\w]+)(\s*:\s*)(.*?)(\s*!important\s*)?(;?\s*)$/);
    if (!match || !colorProperties.includes(match[2])) return null;
    const value = match[4].trim();
    const valueOffset = match[4].indexOf(value);
    const start = match[1].length + match[2].length + match[3].length + Math.max(0, valueOffset);
    return {
      line: cursor.line,
      property: match[2],
      value,
      from: { line: cursor.line, ch: start },
      to: { line: cursor.line, ch: start + value.length }
    };
  }

  function resolveColorPreview(value) {
    const raw = String(value || '').trim();
    const variable = raw.match(/^var\(\s*(--[\w-]+)(?:\s*,\s*([^\)]+))?\)/);
    if (!variable) return raw;
    const documents = [state.canvasDocument, document].filter(Boolean);
    for (const owner of documents) {
      try {
        const resolved = owner.defaultView.getComputedStyle(owner.documentElement).getPropertyValue(variable[1]).trim();
        if (resolved) return resolved;
      } catch (error) {}
    }
    return String(variable[2] || '').trim();
  }

  function colorGroups() {
    const groups = (Array.isArray(config.colorPalette) ? config.colorPalette : []).map((palette) => {
      const paletteName = String(palette.name || 'Palette');
      const sourceLabel = /^ACSS(?:\s+|\s*·\s*)/i.test(paletteName)
        ? paletteName.replace(/^ACSS(?:\s+|\s*·\s*)/i, 'ACSS · ')
        : `Bricks · ${paletteName}`;
      return {
        name: sourceLabel,
        colors: (Array.isArray(palette.colors) ? palette.colors : []).map((color) => {
          const preview = resolveColorPreview(color.preview || color.value);
          return {
            name: color.name || color.value,
            value: color.value,
            preview,
            source: /^ACSS\b/i.test(paletteName) ? 'ACSS' : 'Bricks'
          };
        }).filter((color) => color.value && color.preview && window.CSS?.supports?.('color', color.preview))
      };
    });
    const variablesBySource = colorVariableEntries().reduce((result, entry) => {
      const preview = resolveColorPreview(`var(${entry.name})`);
      if (preview && window.CSS?.supports?.('color', preview)) {
        (result[entry.source] ||= []).push({ name: entry.name, value: `var(${entry.name})`, preview, source: entry.source });
      }
      return result;
    }, {});
    Object.entries(variablesBySource).forEach(([source, colors]) => groups.push({ name: `${source} variables`, colors }));
    return groups.filter((group) => group.colors.length);
  }

  function renderColors(filter = '') {
    const list = document.querySelector('.uplink-css-studio-color-list');
    if (!list) return;
    const query = String(filter).trim().toLowerCase();
    const sections = colorGroups().map((group) => {
      const colors = group.colors.filter((color) => !query || `${color.name} ${color.value} ${group.name}`.toLowerCase().includes(query));
      if (!colors.length) return '';
      return `<section class="uplink-css-studio-color-group"><h3>${escapeHtml(group.name)}</h3><div class="uplink-css-studio-color-grid">${colors.map((color) => `
        <button class="uplink-css-studio-color-choice" type="button" data-color-value="${escapeAttr(color.value)}" data-color-preview="${escapeAttr(color.preview)}" data-tooltip="${escapeAttr(`${color.name} · ${color.value} · ${color.source}`)}" aria-label="Insert ${escapeAttr(color.name)}">
          <span class="uplink-css-studio-color-swatch" aria-hidden="true"></span>
        </button>`).join('')}</div></section>`;
    }).join('');
    list.innerHTML = sections || '<p class="uplink-css-studio-color-empty">No matching Bricks or ACSS colors were found.</p>';
    list.querySelectorAll('[data-color-preview]').forEach((button) => {
      const preview = button.dataset.colorPreview || resolveColorPreview(button.dataset.colorValue);
      const swatch = button.querySelector('.uplink-css-studio-color-swatch');
      if (swatch && preview && window.CSS?.supports?.('color', preview)) swatch.style.background = preview;
      else button.classList.add('is-unresolved');
    });
  }

  function parseRenderedColor(value) {
    const directOklch = parseOklchColor(resolveColorPreview(value));
    if (directOklch) return directOklch;
    const element = document.createElement('span');
    element.style.color = '';
    element.style.color = resolveColorPreview(value);
    if (!element.style.color) return null;
    document.body.appendChild(element);
    const rendered = getComputedStyle(element).color;
    element.remove();
    const renderedOklch = parseOklchColor(rendered);
    if (renderedOklch) return renderedOklch;
    const match = rendered.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+)%?)?/i);
    if (!match) return null;
    let alpha = match[4] === undefined ? 1 : Number(match[4]);
    if (match[4]?.includes?.('%')) alpha /= 100;
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Math.max(0, Math.min(1, alpha)) };
  }

  function rgbHex({ r, g, b }) {
    const hex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }

  function rgbHsl({ r, g, b }) {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;
    let hue = 0;
    let saturation = 0;
    if (max !== min) {
      const delta = max - min;
      saturation = lightness > .5 ? delta / (2 - max - min) : delta / (max + min);
      if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
      else if (max === green) hue = (blue - red) / delta + 2;
      else hue = (red - green) / delta + 4;
      hue /= 6;
    }
    return { h: Math.round(hue * 360), s: Math.round(saturation * 100), l: Math.round(lightness * 100) };
  }

  function rgbHsv({ r, g, b }) {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let hue = 0;
    if (delta) {
      if (max === red) hue = 60 * (((green - blue) / delta) % 6);
      else if (max === green) hue = 60 * ((blue - red) / delta + 2);
      else hue = 60 * ((red - green) / delta + 4);
    }
    if (hue < 0) hue += 360;
    return { h: hue, s: max ? delta / max : 0, v: max };
  }

  function hsvRgb({ h, s, v }) {
    const chroma = v * s;
    const sector = ((h % 360) + 360) % 360 / 60;
    const x = chroma * (1 - Math.abs((sector % 2) - 1));
    let values = [0, 0, 0];
    if (sector < 1) values = [chroma, x, 0];
    else if (sector < 2) values = [x, chroma, 0];
    else if (sector < 3) values = [0, chroma, x];
    else if (sector < 4) values = [0, x, chroma];
    else if (sector < 5) values = [x, 0, chroma];
    else values = [chroma, 0, x];
    const match = v - chroma;
    return { r: (values[0] + match) * 255, g: (values[1] + match) * 255, b: (values[2] + match) * 255 };
  }

  function rgbOklch({ r, g, b }) {
    const linear = (value) => {
      const normalized = value / 255;
      return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    };
    const red = linear(r);
    const green = linear(g);
    const blue = linear(b);
    const l = Math.cbrt(.4122214708 * red + .5363325363 * green + .0514459929 * blue);
    const m = Math.cbrt(.2119034982 * red + .6806995451 * green + .1073969566 * blue);
    const s = Math.cbrt(.0883024619 * red + .2817188376 * green + .6299787005 * blue);
    const lightness = .2104542553 * l + .793617785 * m - .0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s;
    const bAxis = .0259040371 * l + .7827717662 * m - .808675766 * s;
    const chroma = Math.sqrt(a * a + bAxis * bAxis);
    const hue = ((Math.atan2(bAxis, a) * 180 / Math.PI) + 360) % 360;
    return { l: lightness, c: chroma, h: hue };
  }

  function oklchRgb({ l, c, h }) {
    const radians = h * Math.PI / 180;
    const a = c * Math.cos(radians);
    const b = c * Math.sin(radians);
    const lRoot = l + .3963377774 * a + .2158037573 * b;
    const mRoot = l - .1055613458 * a - .0638541728 * b;
    const sRoot = l - .0894841775 * a - 1.291485548 * b;
    const lCube = lRoot ** 3;
    const mCube = mRoot ** 3;
    const sCube = sRoot ** 3;
    const encode = (value) => {
      const encoded = value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055;
      return Math.max(0, Math.min(255, encoded * 255));
    };
    return {
      r: encode(4.0767416621 * lCube - 3.3077115913 * mCube + .2309699292 * sCube),
      g: encode(-1.2684380046 * lCube + 2.6097574011 * mCube - .3413193965 * sCube),
      b: encode(-.0041960863 * lCube - .7034186147 * mCube + 1.707614701 * sCube)
    };
  }

  function parseOklchColor(value) {
    const match = String(value || '').trim().match(/^oklch\(\s*([\d.]+)(%)?\s+([\d.]+)\s+(-?[\d.]+)(deg|grad|rad|turn)?(?:\s*\/\s*([\d.]+)(%)?)?\s*\)$/i);
    if (!match) return null;
    const hueFactors = { deg: 1, grad: .9, rad: 180 / Math.PI, turn: 360 };
    const rgb = oklchRgb({
      l: Number(match[1]) / (match[2] ? 100 : 1),
      c: Number(match[3]),
      h: Number(match[4]) * hueFactors[(match[5] || 'deg').toLowerCase()]
    });
    const alpha = match[6] === undefined ? 1 : Number(match[6]) / (match[7] ? 100 : 1);
    return { ...rgb, a: Math.max(0, Math.min(1, alpha)) };
  }

  function formatColor(rgba, mode = state.prefs.colorMode) {
    const alpha = Math.max(0, Math.min(1, rgba.a));
    const alphaSuffix = alpha < 1 ? ` / ${Number(alpha.toFixed(2))}` : '';
    if (mode === 'rgb') return `rgb(${Math.round(rgba.r)} ${Math.round(rgba.g)} ${Math.round(rgba.b)}${alphaSuffix})`;
    if (mode === 'hsl') {
      const hsl = rgbHsl(rgba);
      return `hsl(${hsl.h} ${hsl.s}% ${hsl.l}%${alphaSuffix})`;
    }
    if (mode === 'oklch') {
      const oklch = rgbOklch(rgba);
      return `oklch(${Number(oklch.l.toFixed(3))} ${Number(oklch.c.toFixed(3))} ${Number(oklch.h.toFixed(1))}${alphaSuffix})`;
    }
    if (alpha < 1) return `rgb(${Math.round(rgba.r)} ${Math.round(rgba.g)} ${Math.round(rgba.b)} / ${Number(alpha.toFixed(2))})`;
    return rgbHex(rgba);
  }

  function syncColorControlsFromHex(hex) {
    const alphaInput = document.querySelector('.uplink-css-studio-color-alpha input');
    const rgba = parseRenderedColor(hex);
    if (!rgba) return;
    rgba.a = Number(alphaInput?.value || 100) / 100;
    const value = document.querySelector('.uplink-css-studio-color-value');
    if (value) value.value = formatColor(rgba);
    hydrateColorControls(value?.value || hex);
  }

  function syncColorCustomUi(updateValue = false) {
    const sv = document.querySelector('.uplink-css-studio-color-sv');
    const dot = sv?.querySelector('span');
    const hue = document.querySelector('.uplink-css-studio-color-hue');
    const native = document.querySelector('.uplink-css-studio-color-native');
    const alpha = Number(document.querySelector('.uplink-css-studio-color-alpha input')?.value || 100) / 100;
    const rgb = hsvRgb(state.colorPicker);
    if (sv) sv.style.setProperty('--uplink-color-hue', `hsl(${state.colorPicker.h} 100% 50%)`);
    if (dot) {
      dot.style.left = `${state.colorPicker.s * 100}%`;
      dot.style.top = `${(1 - state.colorPicker.v) * 100}%`;
    }
    if (hue) hue.value = String(Math.round(state.colorPicker.h));
    if (native) native.value = rgbHex(rgb);
    if (updateValue) {
      const input = document.querySelector('.uplink-css-studio-color-value');
      if (input) input.value = formatColor({ ...rgb, a: alpha });
    }
  }

  function hydrateColorControls(value) {
    const parsed = parseRenderedColor(value);
    const mode = document.querySelector('.uplink-css-studio-color-mode');
    const native = document.querySelector('.uplink-css-studio-color-native');
    const alpha = document.querySelector('.uplink-css-studio-color-alpha input');
    const output = document.querySelector('.uplink-css-studio-color-alpha output');
    if (mode) mode.value = ['hex', 'rgb', 'hsl', 'oklch'].includes(state.prefs.colorMode) ? state.prefs.colorMode : 'hex';
    if (!parsed) return;
    if (native) native.value = rgbHex(parsed);
    if (alpha) alpha.value = String(Math.round(parsed.a * 100));
    if (output) output.textContent = `${Math.round(parsed.a * 100)}%`;
    state.colorPicker = rgbHsv(parsed);
    syncColorCustomUi(false);
  }

  function setColorTab(name) {
    const panel = document.querySelector('.uplink-css-studio-colors-panel');
    if (!panel) return;
    const custom = name === 'custom';
    panel.querySelector('.uplink-css-studio-color-palette-view').hidden = custom;
    panel.querySelector('.uplink-css-studio-color-custom-view').hidden = !custom;
    panel.querySelectorAll('[data-color-tab]').forEach((button) => {
      const active = button.dataset.colorTab === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    requestAnimationFrame(positionActivePopover);
  }

  function prepareColorPanel() {
    const context = currentColorDeclaration();
    const property = document.querySelector('.uplink-css-studio-color-property');
    const value = document.querySelector('.uplink-css-studio-color-value');
    const label = document.querySelector('.uplink-css-studio-color-context');
    property.disabled = false;
    property.removeAttribute('title');
    if (context) {
      property.value = context.property;
      if (context.value) value.value = context.value;
      label.textContent = `Replace ${context.property}`;
    } else {
      label.textContent = `Insert ${property.value}`;
    }
    hydrateColorControls(value.value);
    renderColors(document.querySelector('.uplink-css-studio-color-search')?.value || '');
    setColorTab('palette');
  }

  function openColorToken(token, options = {}) {
    const panel = document.querySelector('.uplink-css-studio-colors-panel');
    const button = document.querySelector('.uplink-css-studio-colors-toggle');
    const property = document.querySelector('.uplink-css-studio-color-property');
    const value = document.querySelector('.uplink-css-studio-color-value');
    const label = document.querySelector('.uplink-css-studio-color-context');
    if (!panel || !button || !property || !value || !label) return;
    const target = state.valueToolTarget;
    const returnPopover = options.returnPopover || (state.activePopover?.panel?.classList.contains('uplink-css-studio-value-panel')
      ? { ...state.activePopover, target }
      : null);
    const nested = Boolean(returnPopover && options.preservePopover !== false);
    if (!nested) closePopovers();
    state.valueToolTarget = target;
    state.colorApplyHandler = typeof options.onApply === 'function' ? options.onApply : null;
    state.colorReturnPopover = returnPopover;
    property.disabled = true;
    property.title = 'The CSS property is fixed when editing an existing color value.';
    value.value = token;
    label.textContent = 'Replace color value';
    hydrateColorControls(token);
    renderColors(document.querySelector('.uplink-css-studio-color-search')?.value || '');
    panel.hidden = false;
    panel.classList.toggle('is-nested-color', nested);
    button.classList.add('is-active');
    state.activePopover = { panel, button: options.anchor || target?.anchor || button, parentPanel: nested ? returnPopover.panel : null };
    setColorTab(/^var\(/i.test(String(token).trim()) ? 'palette' : 'custom');
    requestAnimationFrame(positionActivePopover);
  }

  function returnFromNestedColorPicker() {
    const returnPopover = state.colorReturnPopover;
    if (!returnPopover?.panel?.isConnected) return false;
    const editorAnchor = state.editor?.getWrapperElement?.();
    const returnAnchor = editorAnchor?.isConnected ? editorAnchor : returnPopover.button;
    if (!returnAnchor?.isConnected) return false;
    const panel = document.querySelector('.uplink-css-studio-colors-panel');
    if (panel) {
      panel.hidden = true;
      panel.classList.remove('is-nested-color');
    }
    document.querySelector('.uplink-css-studio-colors-toggle')?.classList.remove('is-active');
    state.colorApplyHandler = null;
    state.colorReturnPopover = null;
    state.activePopover = { panel: returnPopover.panel, button: returnAnchor, manual: Boolean(returnPopover.manual) };
    state.valueToolTarget = returnPopover.target;
    return true;
  }

  function toggleColorsPanel() {
    const opening = document.querySelector('.uplink-css-studio-colors-panel')?.hidden;
    if (opening) prepareColorPanel();
    togglePopover('colors');
  }

  function validColorValue(property, value) {
    if (!value || /[;{}<>]/.test(value)) return false;
    return Boolean(window.CSS?.supports?.(property, value) || /^(?:var|color-mix|light-dark)\(/i.test(value));
  }

  function applyColorValue(rawValue) {
    const property = document.querySelector('.uplink-css-studio-color-property')?.value || 'color';
    const value = String(rawValue || document.querySelector('.uplink-css-studio-color-value')?.value || '').trim();
    if (!validColorValue(property, value)) {
      setStatus('Enter a valid CSS color value', 'dirty');
      document.querySelector('.uplink-css-studio-color-value')?.focus();
      return;
    }
    const tokenTarget = state.valueToolTarget;
    const customApply = state.colorApplyHandler;
    const returnPopover = state.colorReturnPopover;
    if (customApply) {
      customApply(value);
    } else if (tokenTarget?.kind === 'color') {
      replaceValueTarget(tokenTarget, value);
      state.valueToolTarget = null;
    } else {
      const context = currentColorDeclaration();
      if (context && context.property === property) {
        state.editor.getDoc().replaceRange(value, context.from, context.to);
        state.editor.setCursor({ line: context.line, ch: context.from.ch + value.length });
      } else {
        insertDeclarations(`${property}: ${value};`);
      }
    }
    setStatus(`${property} updated`, 'synced');
    if (!returnPopover || !returnFromNestedColorPicker()) {
      closePopovers();
      state.editor.focus();
    }
  }

  async function pickCanvasColor() {
    if (!window.EyeDropper) return;
    try {
      const result = await new window.EyeDropper().open();
      const input = document.querySelector('.uplink-css-studio-color-value');
      const nativeInput = document.querySelector('.uplink-css-studio-color-native');
      if (nativeInput) nativeInput.value = result.sRGBHex;
      syncColorControlsFromHex(result.sRGBHex);
      if (input) applyColorValue(input.value);
    } catch (error) {}
  }

  function splitCssTopLevel(value, separator = ',') {
    const parts = [];
    let current = '';
    let depth = 0;
    let quote = '';
    for (let index = 0; index < String(value).length; index += 1) {
      const character = value[index];
      if (quote) {
        current += character;
        if (character === '\\') current += value[++index] || '';
        else if (character === quote) quote = '';
        continue;
      }
      if (character === '"' || character === "'") { quote = character; current += character; continue; }
      if (character === '(') depth += 1;
      if (character === ')') depth = Math.max(0, depth - 1);
      if (character === separator && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else current += character;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  function splitCssWords(value) {
    const words = [];
    let current = '';
    let depth = 0;
    for (const character of String(value)) {
      if (character === '(') depth += 1;
      if (character === ')') depth = Math.max(0, depth - 1);
      if (/\s/.test(character) && depth === 0) {
        if (current) words.push(current);
        current = '';
      } else current += character;
    }
    if (current) words.push(current);
    return words;
  }

  function showValuePanel(target, title, html) {
    const panel = document.querySelector('.uplink-css-studio-value-panel');
    const heading = document.querySelector('.uplink-css-studio-value-title');
    const body = document.querySelector('.uplink-css-studio-value-body');
    if (!panel || !heading || !body) return null;
    closePopovers();
    state.valueToolTarget = target;
    panel.dataset.tool = target.kind;
    heading.textContent = title;
    body.innerHTML = html;
    panel.hidden = false;
    state.activePopover = { panel, button: target.anchor || state.editor.getWrapperElement() };
    requestAnimationFrame(positionActivePopover);
    return body;
  }

  function closeValuePanel() {
    const panel = document.querySelector('.uplink-css-studio-value-panel');
    if (panel) panel.hidden = true;
    if (state.activePopover?.panel === panel) state.activePopover = null;
    state.valueToolTarget = null;
    state.editor?.focus();
  }

  function angleDegrees(value) {
    const match = String(value).match(/^(-?[\d.]+)(deg|rad|grad|turn)$/i);
    const directions = {
      'to top': 0, 'to top right': 45, 'to right top': 45, 'to right': 90,
      'to bottom right': 135, 'to right bottom': 135, 'to bottom': 180,
      'to bottom left': 225, 'to left bottom': 225, 'to left': 270,
      'to top left': 315, 'to left top': 315
    };
    if (!match) return { degrees: directions[String(value).trim().toLowerCase()] ?? 0, unit: 'deg' };
    const factors = { deg: 1, rad: 180 / Math.PI, grad: .9, turn: 360 };
    return { degrees: Number(match[1]) * factors[match[2]], unit: match[2] };
  }

  function angleFromDegrees(degrees, unit) {
    const factors = { deg: 1, rad: 180 / Math.PI, grad: .9, turn: 360 };
    const precision = unit === 'deg' || unit === 'grad' ? 1 : 4;
    return `${Number((degrees / factors[unit]).toFixed(precision))}${unit}`;
  }

  function angleEditorMarkup(showDirections) {
    return `
      <div class="uplink-css-studio-angle-dial" role="slider" tabindex="0" aria-label="Gradient angle"><span class="uplink-css-studio-angle-needle"></span><span class="uplink-css-studio-angle-dot"></span></div>
      ${showDirections ? '<div class="uplink-css-studio-angle-directions"><span>to</span><button type="button" data-angle-side="top">top</button><button type="button" data-angle-side="bottom">bottom</button><button type="button" data-angle-side="left">left</button><button type="button" data-angle-side="right">right</button></div>' : ''}
      <div class="uplink-css-studio-angle-input"><input class="uplink-css-studio-angle-number" type="number" step="1"><select class="uplink-css-studio-angle-unit" aria-label="Angle unit"><option>deg</option><option>rad</option><option>grad</option><option>turn</option></select></div>`;
  }

  function bindAngleEditor(container, initialValue, onChange) {
    const angle = angleDegrees(initialValue);
    const number = container.querySelector('.uplink-css-studio-angle-number');
    const unit = container.querySelector('.uplink-css-studio-angle-unit');
    const dial = container.querySelector('.uplink-css-studio-angle-dial');
    const needle = container.querySelector('.uplink-css-studio-angle-needle');
    if (!number || !unit || !dial || !needle) return;
    let currentValue = String(initialValue || '0deg');
    unit.value = angle.unit;
    let degrees = ((angle.degrees % 360) + 360) % 360;
    const numericForUnit = () => angleFromDegrees(degrees, unit.value).replace(/[a-z]+$/i, '');
    const update = (commit = false) => {
      needle.style.transform = `translateX(-50%) rotate(${degrees + 180}deg)`;
      dial.setAttribute('aria-valuenow', String(Math.round(degrees)));
      if (document.activeElement !== number) number.value = numericForUnit();
      if (commit) {
        currentValue = angleFromDegrees(degrees, unit.value);
        onChange(currentValue);
        container.querySelectorAll('[data-angle-side]').forEach((button) => button.classList.remove('is-active'));
      }
    };
    const updateFromPointer = (event) => {
      const rect = dial.getBoundingClientRect();
      const x = event.clientX - (rect.left + rect.width / 2);
      const y = event.clientY - (rect.top + rect.height / 2);
      const raw = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
      degrees = event.shiftKey ? Math.round(raw / 15) * 15 % 360 : Math.round(raw);
      update(true);
    };
    dial.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      dial.setPointerCapture?.(event.pointerId);
      updateFromPointer(event);
    });
    dial.addEventListener('pointermove', (event) => {
      if (dial.hasPointerCapture?.(event.pointerId)) updateFromPointer(event);
    });
    number.addEventListener('input', () => {
      const value = Number(number.value);
      if (!Number.isFinite(value)) return;
      degrees = angleDegrees(`${value}${unit.value}`).degrees;
      update(true);
    });
    unit.addEventListener('change', () => update(true));
    const directionState = () => ({
      vertical: /\btop\b/.test(currentValue) ? 'top' : /\bbottom\b/.test(currentValue) ? 'bottom' : '',
      horizontal: /\bleft\b/.test(currentValue) ? 'left' : /\bright\b/.test(currentValue) ? 'right' : ''
    });
    const refreshDirectionButtons = () => {
      const sides = directionState();
      container.querySelectorAll('[data-angle-side]').forEach((button) => button.classList.toggle('is-active', Object.values(sides).includes(button.dataset.angleSide)));
    };
    container.querySelectorAll('[data-angle-side]').forEach((button) => button.addEventListener('click', () => {
      const sides = directionState();
      const axis = /^(top|bottom)$/.test(button.dataset.angleSide) ? 'vertical' : 'horizontal';
      sides[axis] = sides[axis] === button.dataset.angleSide ? '' : button.dataset.angleSide;
      if (!sides.vertical && !sides.horizontal) return;
      const value = `to ${[sides.vertical, sides.horizontal].filter(Boolean).join(' ')}`;
      currentValue = value;
      onChange(value);
      degrees = angleDegrees(value).degrees;
      update(false);
      refreshDirectionButtons();
    }));
    update(false);
    refreshDirectionButtons();
  }

  function openAngleEditor(target) {
    const normalized = String(target.value).trim().toLowerCase();
    const showDirections = target.gradientDirection || /^to\s+/.test(normalized);
    const body = showValuePanel(target, 'Angle', angleEditorMarkup(showDirections));
    if (body) bindAngleEditor(body, target.value, (value) => replaceValueTarget(target, value));
  }

  const easingPresets = {
    linear: [0, 0, 1, 1], ease: [.25, .1, .25, 1], 'ease-in': [.42, 0, 1, 1],
    'ease-out': [0, 0, .58, 1], 'ease-in-out': [.42, 0, .58, 1], smooth: [.2, .8, .2, 1], snappy: [.2, 1, .3, 1]
  };

  function easingPoints(value) {
    const match = String(value).match(/cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/i);
    return match ? match.slice(1).map(Number) : (easingPresets[value] || easingPresets.ease).slice();
  }

  function openEasingEditor(target) {
    let points = easingPoints(target.value);
    let activePreset = Object.keys(easingPresets).find((name) => name === target.value) || 'custom';
    const presetLabels = { linear: 'linear', ease: 'ease', 'ease-in': 'in', 'ease-out': 'out', 'ease-in-out': 'in-out', smooth: 'smooth', snappy: 'snappy' };
    const body = showValuePanel(target, 'Easing', `
      <div class="uplink-css-studio-ease-graph" aria-label="Cubic bezier curve editor">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect x="10" y="33.333" width="80" height="33.334"></rect><line data-ease-line="1"></line><line data-ease-line="2"></line><path data-ease-curve></path></svg>
        <button type="button" data-ease-handle="0" aria-label="Drag first cubic bezier control point"></button>
        <button type="button" data-ease-handle="1" aria-label="Drag second cubic bezier control point"></button>
      </div>
      <div class="uplink-css-studio-ease-demo"><div><span></span></div><button type="button">Replay</button></div>
      <div class="uplink-css-studio-ease-presets">${Object.entries(presetLabels).map(([name, label]) => `<button type="button" data-ease-preset="${name}">${label}</button>`).join('')}</div>
      <div class="uplink-css-studio-ease-points">${points.map((point, index) => `<label><span>${index < 2 ? `P1${index ? ' y' : ' x'}` : `P2${index === 2 ? ' x' : ' y'}`}</span><input type="number" step="0.01"${index % 2 === 0 ? ' min="0" max="1"' : ' min="-1" max="2"'} value="${escapeAttr(point)}"></label>`).join('')}</div>
      <code class="uplink-css-studio-ease-value"></code>`);
    if (!body) return;
    const inputs = [...body.querySelectorAll('.uplink-css-studio-ease-points input')];
    const graph = body.querySelector('.uplink-css-studio-ease-graph');
    const curve = graph.querySelector('[data-ease-curve]');
    const lines = [...graph.querySelectorAll('[data-ease-line]')];
    const handles = [...graph.querySelectorAll('[data-ease-handle]')];
    const demo = body.querySelector('.uplink-css-studio-ease-demo span');
    const valueLabel = body.querySelector('.uplink-css-studio-ease-value');
    const cssValue = () => {
      if (['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'].includes(activePreset)) return activePreset;
      return `cubic-bezier(${points.map((value) => Number(value.toFixed(3))).join(', ')})`;
    };
    const graphPoint = (xValue, yValue) => ({ x: 10 + xValue * 80, y: (2 - yValue) / 3 * 100 });
    const replay = () => {
      demo.style.animationTimingFunction = `cubic-bezier(${points.join(', ')})`;
      demo.classList.remove('is-running');
      requestAnimationFrame(() => demo.classList.add('is-running'));
    };
    const render = (commit = false) => {
      const p1 = graphPoint(points[0], points[1]);
      const p2 = graphPoint(points[2], points[3]);
      const start = graphPoint(0, 0);
      const end = graphPoint(1, 1);
      curve.setAttribute('d', `M ${start.x} ${start.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${end.x} ${end.y}`);
      [[start, p1], [end, p2]].forEach(([from, to], index) => {
        lines[index].setAttribute('x1', from.x); lines[index].setAttribute('y1', from.y);
        lines[index].setAttribute('x2', to.x); lines[index].setAttribute('y2', to.y);
      });
      [p1, p2].forEach((point, index) => {
        handles[index].style.left = `${point.x}%`;
        handles[index].style.top = `${point.y}%`;
      });
      inputs.forEach((input, index) => { if (document.activeElement !== input) input.value = String(Number(points[index].toFixed(3))); });
      body.querySelectorAll('[data-ease-preset]').forEach((button) => button.classList.toggle('is-active', button.dataset.easePreset === activePreset));
      valueLabel.textContent = cssValue();
      replay();
      if (commit) replaceValueTarget(target, cssValue());
    };
    const updateHandle = (event, index) => {
      const rect = graph.getBoundingClientRect();
      points[index * 2] = Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width - .1) / .8));
      points[index * 2 + 1] = Math.max(-1, Math.min(2, 2 - 3 * ((event.clientY - rect.top) / rect.height)));
      activePreset = 'custom';
      render(true);
    };
    handles.forEach((handle, index) => {
      handle.addEventListener('pointerdown', (event) => { event.preventDefault(); handle.setPointerCapture?.(event.pointerId); updateHandle(event, index); });
      handle.addEventListener('pointermove', (event) => { if (handle.hasPointerCapture?.(event.pointerId)) updateHandle(event, index); });
      handle.addEventListener('keydown', (event) => {
        const step = event.shiftKey ? .1 : .01;
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'ArrowLeft') points[index * 2] = Math.max(0, points[index * 2] - step);
        if (event.key === 'ArrowRight') points[index * 2] = Math.min(1, points[index * 2] + step);
        if (event.key === 'ArrowUp') points[index * 2 + 1] = Math.min(2, points[index * 2 + 1] + step);
        if (event.key === 'ArrowDown') points[index * 2 + 1] = Math.max(-1, points[index * 2 + 1] - step);
        activePreset = 'custom';
        render(true);
      });
    });
    body.querySelector('.uplink-css-studio-ease-presets').addEventListener('click', (event) => {
      const button = event.target.closest('[data-ease-preset]');
      if (!button) return;
      activePreset = button.dataset.easePreset;
      points = easingPresets[activePreset].slice();
      render(true);
    });
    inputs.forEach((input, index) => input.addEventListener('input', () => {
      let value = Number(input.value);
      if (!Number.isFinite(value)) return;
      value = index % 2 === 0 ? Math.max(0, Math.min(1, value)) : Math.max(-1, Math.min(2, value));
      points[index] = value;
      activePreset = 'custom';
      render(true);
    }));
    body.querySelector('.uplink-css-studio-ease-demo button').addEventListener('click', replay);
    render(false);
  }

  function parseShadowLayer(value, textShadow = false) {
    const words = splitCssWords(value || '0 8px 24px rgb(0 0 0 / 20%)');
    const shadow = { inset: false, color: 'rgb(0 0 0 / 20%)', lengths: [] };
    words.forEach((word) => {
      if (word.toLowerCase() === 'inset') shadow.inset = true;
      else if (window.CSS?.supports?.('color', resolveColorPreview(word))) shadow.color = word;
      else shadow.lengths.push(word);
    });
    const count = textShadow ? 3 : 4;
    while (shadow.lengths.length < count) shadow.lengths.push('0px');
    shadow.lengths = shadow.lengths.slice(0, count);
    return shadow;
  }

  function shadowLayerString(shadow, textShadow = false) {
    return `${!textShadow && shadow.inset ? 'inset ' : ''}${shadow.lengths.join(' ')} ${shadow.color || 'currentColor'}`;
  }

  function sitePreviewBackground() {
    const owner = state.canvasDocument;
    if (!owner?.defaultView) return '#ffffff';
    const candidates = [owner.body, owner.documentElement].filter(Boolean);
    for (const element of candidates) {
      try {
        const value = owner.defaultView.getComputedStyle(element).backgroundColor;
        if (value && value !== 'transparent' && !/^rgba?\(0(?:[,\s]+0){2}(?:[,/\s]+0)?\)$/i.test(value.replace(/\s+/g, ' '))) return value;
      } catch (error) {}
    }
    return '#ffffff';
  }

  function openShadowEditor(target) {
    const textShadow = target.property === 'text-shadow';
    const layers = splitCssTopLevel(target.value).map((value) => parseShadowLayer(value, textShadow));
    if (!layers.length) layers.push(parseShadowLayer('', textShadow));
    let activeLayer = 0;
    let previewBackground = sitePreviewBackground();
    const body = showValuePanel(target, textShadow ? 'Text shadow' : 'Box shadow', `
      <div class="uplink-css-studio-shadow-preview-toolbar"><span>Preview background</span><button class="uplink-css-studio-shadow-preview-background" type="button" aria-label="Choose preview background" data-tooltip="Choose preview background"></button></div>
      <div class="uplink-css-studio-shadow-preview"><span>Shadow</span></div>
      <div class="uplink-css-studio-shadow-layer-bar"><div class="uplink-css-studio-shadow-tabs" role="tablist" aria-label="Shadow layers"></div><button class="uplink-css-studio-shadow-add" type="button" aria-label="Add shadow layer" data-tooltip="Add shadow layer">${icon('plus')}</button><button class="uplink-css-studio-shadow-remove" type="button" aria-label="Remove shadow layer" data-tooltip="Remove shadow layer">${icon('minus')}</button></div>
      <div class="uplink-css-studio-shadow-workspace">
        <div class="uplink-css-studio-shadow-position" role="slider" tabindex="0" aria-label="Shadow X and Y offset"><span></span></div>
        <div class="uplink-css-studio-shadow-controls">
          <label><span>Blur <output class="uplink-css-studio-shadow-blur-output"></output></span><input class="uplink-css-studio-shadow-blur" type="range" min="0" max="100" step="1"></label>
          ${textShadow ? '' : `<label><span>Spread <output class="uplink-css-studio-shadow-spread-output"></output></span><input class="uplink-css-studio-shadow-spread" type="range" min="-50" max="50" step="1"></label>
          <label class="uplink-css-studio-shadow-inset-row"><span>Inset</span><input class="uplink-css-studio-shadow-inset" type="checkbox"></label>`}
        </div>
      </div>
      <div class="uplink-css-studio-shadow-offsets"><label><span>X</span><input class="uplink-css-studio-shadow-x" type="number" step="1"></label><label><span>Y</span><input class="uplink-css-studio-shadow-y" type="number" step="1"></label></div>
      <div class="uplink-css-studio-shadow-color-row"><button class="uplink-css-studio-shadow-swatch" type="button" aria-label="Choose shadow color" data-tooltip="Choose color"></button><input class="uplink-css-studio-shadow-color" type="text" aria-label="Shadow color" title="Double-click to open the color picker"></div>`);
    if (!body) return;
    const tabs = body.querySelector('.uplink-css-studio-shadow-tabs');
    const pad = body.querySelector('.uplink-css-studio-shadow-position');
    const dot = pad.querySelector('span');
    const x = body.querySelector('.uplink-css-studio-shadow-x');
    const y = body.querySelector('.uplink-css-studio-shadow-y');
    const blur = body.querySelector('.uplink-css-studio-shadow-blur');
    const spread = body.querySelector('.uplink-css-studio-shadow-spread');
    const color = body.querySelector('.uplink-css-studio-shadow-color');
    const swatch = body.querySelector('.uplink-css-studio-shadow-swatch');
    const backgroundSwatch = body.querySelector('.uplink-css-studio-shadow-preview-background');
    const inset = body.querySelector('.uplink-css-studio-shadow-inset');
    const preview = body.querySelector('.uplink-css-studio-shadow-preview span');
    const previewSurface = body.querySelector('.uplink-css-studio-shadow-preview');
    const numeric = (value) => Number.parseFloat(value) || 0;
    const renderPreviewBackground = () => {
      const resolved = resolveColorPreview(previewBackground);
      if (!resolved || !window.CSS?.supports?.('color', resolved)) return;
      previewSurface.style.background = resolved;
      backgroundSwatch.style.background = resolved;
      backgroundSwatch.title = `Preview background: ${previewBackground}`;
    };
    const commit = () => {
      const value = layers.map((layer) => shadowLayerString(layer, textShadow)).join(', ');
      if (textShadow) preview.style.textShadow = value;
      else preview.style.boxShadow = value;
      replaceValueTarget(target, value);
    };
    const renderTabs = () => {
      tabs.innerHTML = layers.map((_, index) => `<button type="button" role="tab" data-shadow-layer="${index}" aria-selected="${index === activeLayer}">${index + 1}</button>`).join('');
      body.querySelector('.uplink-css-studio-shadow-remove').disabled = layers.length === 1;
    };
    const renderLayer = () => {
      const layer = layers[activeLayer];
      x.value = String(numeric(layer.lengths[0]));
      y.value = String(numeric(layer.lengths[1]));
      blur.value = String(Math.max(0, numeric(layer.lengths[2])));
      if (spread) spread.value = String(numeric(layer.lengths[3]));
      if (inset) inset.checked = layer.inset;
      color.value = layer.color;
      const previewColor = resolveColorPreview(layer.color);
      if (previewColor && window.CSS?.supports?.('color', previewColor)) swatch.style.background = previewColor;
      const offsetX = Math.max(-50, Math.min(50, numeric(layer.lengths[0])));
      const offsetY = Math.max(-50, Math.min(50, numeric(layer.lengths[1])));
      dot.style.left = `${offsetX + 50}%`;
      dot.style.top = `${offsetY + 50}%`;
      body.querySelector('.uplink-css-studio-shadow-blur-output').textContent = `${numeric(layer.lengths[2])}px`;
      if (spread) body.querySelector('.uplink-css-studio-shadow-spread-output').textContent = `${numeric(layer.lengths[3])}px`;
      renderTabs();
    };
    const updateLayer = () => {
      const layer = layers[activeLayer];
      layer.lengths[0] = `${Number(x.value) || 0}px`;
      layer.lengths[1] = `${Number(y.value) || 0}px`;
      layer.lengths[2] = `${Number(blur.value) || 0}px`;
      if (spread) layer.lengths[3] = `${Number(spread.value) || 0}px`;
      if (inset) layer.inset = inset.checked;
      layer.color = color.value.trim() || 'currentColor';
      renderLayer();
      commit();
    };
    const updatePad = (event) => {
      const rect = pad.getBoundingClientRect();
      x.value = String(Math.round(Math.max(-50, Math.min(50, ((event.clientX - rect.left) / rect.width * 100) - 50))));
      y.value = String(Math.round(Math.max(-50, Math.min(50, ((event.clientY - rect.top) / rect.height * 100) - 50))));
      updateLayer();
    };
    pad.addEventListener('pointerdown', (event) => { event.preventDefault(); pad.setPointerCapture?.(event.pointerId); updatePad(event); });
    pad.addEventListener('pointermove', (event) => { if (pad.hasPointerCapture?.(event.pointerId)) updatePad(event); });
    tabs.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-shadow-layer]');
      if (!tab) return;
      activeLayer = Number(tab.dataset.shadowLayer);
      renderLayer();
    });
    body.querySelector('.uplink-css-studio-shadow-add').addEventListener('click', () => {
      layers.push(parseShadowLayer(textShadow ? '0 4px 12px rgb(0 0 0 / 20%)' : '0 8px 24px 0 rgb(0 0 0 / 20%)', textShadow));
      activeLayer = layers.length - 1;
      renderLayer();
      commit();
    });
    body.querySelector('.uplink-css-studio-shadow-remove').addEventListener('click', () => {
      if (layers.length === 1) return;
      layers.splice(activeLayer, 1);
      activeLayer = Math.min(activeLayer, layers.length - 1);
      renderLayer();
      commit();
    });
    [x, y, blur, spread, color, inset].filter(Boolean).forEach((input) => input.addEventListener('input', updateLayer));
    const openShadowColor = () => openColorToken(color.value, {
      anchor: swatch,
      onApply: (value) => { color.value = value; layers[activeLayer].color = value; renderLayer(); commit(); }
    });
    const openPreviewBackground = () => openColorToken(previewBackground, {
      anchor: backgroundSwatch,
      onApply: (value) => { previewBackground = value; renderPreviewBackground(); }
    });
    swatch.addEventListener('click', openShadowColor);
    color.addEventListener('dblclick', openShadowColor);
    backgroundSwatch.addEventListener('click', openPreviewBackground);
    renderPreviewBackground();
    renderLayer();
    commit();
  }

  function parseGradient(value) {
    const match = String(value).match(/^((?:repeating-)?(linear|radial|conic))-gradient\(([\s\S]*)\)$/i);
    if (!match) return null;
    const parts = splitCssTopLevel(match[3]);
    let lead = '';
    const isLead = match[2] === 'linear'
      ? /^(?:-?[\d.]+(?:deg|rad|grad|turn)|to\s+)/i.test(parts[0] || '')
      : match[2] === 'conic' ? /^(?:from|at)\s+/i.test(parts[0] || '') : /^(?:circle|ellipse|closest|farthest|at\s+)/i.test(parts[0] || '');
    if (isLead) lead = parts.shift();
    const stops = parts.map((part) => {
      const position = part.match(/\s+(-?[\d.]+(?:%|px|rem|em|vw|vh))\s*$/i);
      return { color: position ? part.slice(0, position.index).trim() : part.trim(), position: position ? position[1] : '' };
    });
    return { name: match[1], type: match[2], repeating: /^repeating-/.test(match[1]), lead, stops: stops.length ? stops : [{ color: '#000000', position: '0%' }, { color: '#ffffff', position: '100%' }] };
  }

  function gradientString(gradient) {
    const name = `${gradient.repeating ? 'repeating-' : ''}${gradient.type}-gradient`;
    const stops = gradient.stops.map((stop) => `${stop.color}${stop.position ? ` ${stop.position}` : ''}`);
    return `${name}(${[gradient.lead, ...stops].filter(Boolean).join(', ')})`;
  }

  function radialGradientOptions(lead) {
    const value = String(lead || '').trim();
    const at = value.match(/(?:^|\s)at\s+(.+)$/i);
    const beforeAt = value.replace(/(?:^|\s)at\s+.+$/i, '').trim();
    const shape = beforeAt.match(/\b(circle|ellipse)\b/i)?.[1]?.toLowerCase() || 'ellipse';
    const size = beforeAt.match(/\b(closest-side|closest-corner|farthest-side|farthest-corner)\b/i)?.[1]?.toLowerCase() || 'farthest-corner';
    return { shape, size, position: at?.[1]?.trim() || 'center' };
  }

  function conicGradientOptions(lead) {
    const value = String(lead || '').trim();
    return {
      angle: value.match(/\bfrom\s+(-?[\d.]+(?:deg|rad|grad|turn))/i)?.[1] || '0deg',
      position: value.match(/(?:^|\s)at\s+(.+)$/i)?.[1]?.trim() || 'center'
    };
  }

  function openGradientEditor(target) {
    const gradient = parseGradient(target.value);
    if (!gradient) return;
    const body = showValuePanel(target, 'Gradient', `
      <div class="uplink-css-studio-gradient-preview"></div>
      <label class="uplink-css-studio-gradient-type-field"><span>Type</span><select class="uplink-css-studio-gradient-type"><option value="linear">linear</option><option value="radial">radial</option><option value="conic">conic</option></select></label>
      <div class="uplink-css-studio-gradient-options" data-gradient-options="linear">
        <label><span>Direction</span><input class="uplink-css-studio-gradient-linear-direction" type="text" placeholder="135deg or to bottom right" aria-expanded="false"></label>
        <div class="uplink-css-studio-gradient-angle-controls" hidden>${angleEditorMarkup(true)}</div>
      </div>
      <div class="uplink-css-studio-gradient-options uplink-css-studio-gradient-radial-options" data-gradient-options="radial" hidden>
        <label><span>Shape</span><select class="uplink-css-studio-gradient-radial-shape"><option value="ellipse">ellipse</option><option value="circle">circle</option></select></label>
        <label><span>Extent</span><select class="uplink-css-studio-gradient-radial-size"><option value="farthest-corner">farthest corner</option><option value="farthest-side">farthest side</option><option value="closest-corner">closest corner</option><option value="closest-side">closest side</option></select></label>
        <label class="is-wide"><span>Center</span><input class="uplink-css-studio-gradient-radial-position" type="text" placeholder="center or 50% 50%"></label>
      </div>
      <div class="uplink-css-studio-gradient-options" data-gradient-options="conic" hidden>
        <div class="uplink-css-studio-value-fields"><label><span>Start angle</span><input class="uplink-css-studio-gradient-conic-angle" type="text" placeholder="0deg" aria-expanded="false"></label><label><span>Center</span><input class="uplink-css-studio-gradient-conic-position" type="text" placeholder="center or 50% 50%"></label></div>
        <div class="uplink-css-studio-gradient-conic-angle-controls" hidden>${angleEditorMarkup(false)}</div>
      </div>
      <label class="uplink-css-studio-check-row"><span>Repeating</span><input class="uplink-css-studio-gradient-repeat" type="checkbox"${gradient.repeating ? ' checked' : ''}></label>
      <div class="uplink-css-studio-gradient-stops"></div>
      <button class="uplink-css-studio-action uplink-css-studio-gradient-add" type="button">${icon('plus')}<span>Add stop</span></button>`);
    if (!body) return;
    const type = body.querySelector('.uplink-css-studio-gradient-type');
    const linearDirection = body.querySelector('.uplink-css-studio-gradient-linear-direction');
    const radialShape = body.querySelector('.uplink-css-studio-gradient-radial-shape');
    const radialSize = body.querySelector('.uplink-css-studio-gradient-radial-size');
    const radialPosition = body.querySelector('.uplink-css-studio-gradient-radial-position');
    const conicAngle = body.querySelector('.uplink-css-studio-gradient-conic-angle');
    const conicPosition = body.querySelector('.uplink-css-studio-gradient-conic-position');
    const repeating = body.querySelector('.uplink-css-studio-gradient-repeat');
    const linearAngleControls = body.querySelector('.uplink-css-studio-gradient-angle-controls');
    const conicAngleControls = body.querySelector('.uplink-css-studio-gradient-conic-angle-controls');
    const stops = body.querySelector('.uplink-css-studio-gradient-stops');
    const preview = body.querySelector('.uplink-css-studio-gradient-preview');
    const radial = radialGradientOptions(gradient.type === 'radial' ? gradient.lead : '');
    const conic = conicGradientOptions(gradient.type === 'conic' ? gradient.lead : '');
    let linearAngleBound = false;
    let conicAngleBound = false;
    type.value = gradient.type;
    linearDirection.value = gradient.type === 'linear' ? (gradient.lead || '180deg') : '180deg';
    radialShape.value = radial.shape;
    radialSize.value = radial.size;
    radialPosition.value = radial.position;
    conicAngle.value = conic.angle;
    conicPosition.value = conic.position;
    const currentLead = () => {
      if (type.value === 'linear') return linearDirection.value.trim() || '180deg';
      if (type.value === 'radial') return `${radialShape.value} ${radialSize.value} at ${radialPosition.value.trim() || 'center'}`;
      return `from ${conicAngle.value.trim() || '0deg'} at ${conicPosition.value.trim() || 'center'}`;
    };
    const commit = () => {
      gradient.type = type.value;
      gradient.lead = currentLead();
      gradient.repeating = repeating.checked;
      const value = gradientString(gradient);
      preview.style.background = value;
      replaceValueTarget(target, value);
    };
    const showTypeOptions = () => {
      body.querySelectorAll('[data-gradient-options]').forEach((group) => { group.hidden = group.dataset.gradientOptions !== type.value; });
      requestAnimationFrame(positionActivePopover);
    };
    const openLinearAngle = () => {
      linearAngleControls.hidden = false;
      linearDirection.setAttribute('aria-expanded', 'true');
      if (!linearAngleBound) {
        linearAngleBound = true;
        bindAngleEditor(linearAngleControls, linearDirection.value.trim() || '180deg', (value) => {
          linearDirection.value = value;
          commit();
        });
      }
      requestAnimationFrame(positionActivePopover);
    };
    const openConicAngle = () => {
      conicAngleControls.hidden = false;
      conicAngle.setAttribute('aria-expanded', 'true');
      if (!conicAngleBound) {
        conicAngleBound = true;
        bindAngleEditor(conicAngleControls, conicAngle.value.trim() || '0deg', (value) => {
          conicAngle.value = value;
          commit();
        });
      }
      requestAnimationFrame(positionActivePopover);
    };
    linearDirection.addEventListener('click', openLinearAngle);
    linearDirection.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); openLinearAngle(); }
    });
    conicAngle.addEventListener('click', openConicAngle);
    conicAngle.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); openConicAngle(); }
    });
    const renderStops = () => {
      stops.innerHTML = gradient.stops.map((stop, index) => `<div class="uplink-css-studio-gradient-stop" data-stop="${index}"><button class="uplink-css-studio-gradient-swatch" type="button" aria-label="Choose stop ${index + 1} color" data-tooltip="Choose color"></button><input data-stop-color type="text" value="${escapeAttr(stop.color)}" aria-label="Stop ${index + 1} color" title="Double-click to open the color picker"><input data-stop-position type="text" value="${escapeAttr(stop.position)}" placeholder="${index ? '100%' : '0%'}" aria-label="Stop ${index + 1} position"><button class="uplink-css-studio-gradient-remove" type="button" aria-label="Remove stop" data-tooltip="Remove stop"${gradient.stops.length <= 2 ? ' disabled' : ''}>${icon('close')}</button></div>`).join('');
      stops.querySelectorAll('.uplink-css-studio-gradient-stop').forEach((row) => {
        const index = Number(row.dataset.stop);
        const color = row.querySelector('[data-stop-color]');
        const position = row.querySelector('[data-stop-position]');
        const swatch = row.querySelector('.uplink-css-studio-gradient-swatch');
        if (window.CSS?.supports?.('color', color.value)) swatch.style.background = color.value;
        color.addEventListener('input', () => { gradient.stops[index].color = color.value; if (window.CSS?.supports?.('color', color.value)) swatch.style.background = color.value; commit(); });
        const openStopColor = () => openColorToken(color.value, {
          anchor: swatch,
          onApply: (value) => {
            gradient.stops[index].color = value;
            color.value = value;
            const previewColor = resolveColorPreview(value);
            if (previewColor && window.CSS?.supports?.('color', previewColor)) swatch.style.background = previewColor;
            commit();
          }
        });
        swatch.addEventListener('click', openStopColor);
        color.addEventListener('dblclick', openStopColor);
        color.addEventListener('keydown', (event) => {
          if ((event.altKey && event.key === 'ArrowDown') || event.key === 'F4') {
            event.preventDefault();
            openStopColor();
          }
        });
        position.addEventListener('input', () => { gradient.stops[index].position = position.value; commit(); });
        row.querySelector('.uplink-css-studio-gradient-remove').addEventListener('click', (event) => {
          event.stopPropagation();
          if (gradient.stops.length > 2) {
            gradient.stops.splice(index, 1);
            renderStops();
            commit();
            requestAnimationFrame(positionActivePopover);
          }
        });
      });
    };
    body.querySelector('.uplink-css-studio-gradient-add').addEventListener('click', () => {
      gradient.stops.push({ color: '#ffffff', position: '100%' });
      renderStops();
      commit();
      requestAnimationFrame(positionActivePopover);
    });
    type.addEventListener('change', () => { showTypeOptions(); commit(); });
    repeating.addEventListener('input', commit);
    [linearDirection, radialPosition, conicAngle, conicPosition].forEach((input) => input.addEventListener('input', commit));
    [radialShape, radialSize].forEach((input) => input.addEventListener('change', commit));
    showTypeOptions();
    renderStops();
    preview.style.background = gradientString(gradient);
  }

  function openValuePanel(target) {
    if (target.kind === 'angle') openAngleEditor(target);
    else if (target.kind === 'ease') openEasingEditor(target);
    else if (target.kind === 'shadow') openShadowEditor(target);
    else if (target.kind === 'gradient') openGradientEditor(target);
  }

  function pseudoCanvasDocuments() {
    const documents = [];
    if (state.canvasDocument) documents.push(state.canvasDocument);
    document.querySelectorAll('#bricks-builder-iframe, #bricks-preview iframe').forEach((frame) => {
      try { if (frame.contentDocument && !documents.includes(frame.contentDocument)) documents.push(frame.contentDocument); } catch (error) {}
    });
    return documents;
  }

  function clearPseudoPreview() {
    state.forcedStates.clear();
    pseudoCanvasDocuments().forEach((owner) => {
      owner.getElementById('uplink-css-studio-forced-states')?.remove();
      owner.querySelectorAll('[data-uplink-hover],[data-uplink-focus],[data-uplink-focus-visible],[data-uplink-focus-within],[data-uplink-active]').forEach((element) => {
        ['hover', 'focus', 'focus-visible', 'focus-within', 'active'].forEach((name) => element.removeAttribute(`data-uplink-${name}`));
      });
    });
  }

  function togglePseudoPreview(name) {
    const ctx = state.context;
    if (!ctx || !['hover', 'focus', 'focus-visible', 'focus-within', 'active'].includes(name)) return;
    const enabling = !state.forcedStates.has(name);
    if (enabling) state.forcedStates.add(name);
    else state.forcedStates.delete(name);
    const root = contextRootSelector(ctx);
    const storedCss = toStoredCss(ctx, state.editor.getValue());
    const forcedCss = storedCss.replace(/:(hover|focus-visible|focus-within|focus|active)\b/g, '[data-uplink-$1]');
    pseudoCanvasDocuments().forEach((owner) => {
      let style = owner.getElementById('uplink-css-studio-forced-states');
      if (!style) {
        style = owner.createElement('style');
        style.id = 'uplink-css-studio-forced-states';
        owner.head.appendChild(style);
      }
      style.textContent = forcedCss;
      let elements = [];
      try { elements = [...owner.querySelectorAll(root)]; } catch (error) {}
      elements.forEach((element) => {
        if (enabling) element.setAttribute(`data-uplink-${name}`, '');
        else element.removeAttribute(`data-uplink-${name}`);
      });
    });
    scheduleValueDecorations(true);
    setStatus(`:${name} preview ${enabling ? 'enabled' : 'disabled'}`, 'synced');
  }

  function toggleShortcutGroup(groupName, button) {
    const panel = document.querySelector('.uplink-css-studio-shortcuts-panel');
    if (!panel || !button) return;
    const isSameOpenGroup = !panel.hidden && state.shortcutGroup === groupName;
    hideTooltip();
    closePopovers();
    if (isSameOpenGroup) return;
    state.shortcutGroup = groupName;
    renderShortcutGroup(groupName);
    panel.hidden = false;
    button.classList.add('is-active');
    state.activePopover = { panel, button };
    requestAnimationFrame(positionActivePopover);
  }

  function renderRecipeEditorOptions(selected = '') {
    const select = document.querySelector('.uplink-css-studio-recipe-select');
    if (!select) return;
    select.innerHTML = '<option value="">New recipe…</option>' + Object.keys(userRecipes)
      .sort()
      .map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(userRecipes[name].label)} · ${escapeHtml(userRecipes[name].category)}</option>`)
      .join('');
    select.value = selected && userRecipes[selected] ? selected : '';
    const categories = document.querySelector('#uplink-css-studio-recipe-categories');
    if (categories) categories.innerHTML = [...new Set(Object.values(userRecipes).map((recipe) => recipe.category))]
      .sort((a, b) => a.localeCompare(b))
      .map((category) => `<option value="${escapeAttr(category)}"></option>`)
      .join('');
  }

  function loadRecipeEditor(name = '') {
    const selected = name && userRecipes[name] ? name : '';
    renderRecipeEditorOptions(selected);
    document.querySelector('.uplink-css-studio-recipe-label').value = selected ? userRecipes[selected].label : '';
    document.querySelector('.uplink-css-studio-recipe-name').value = selected;
    document.querySelector('.uplink-css-studio-recipe-category').value = selected ? userRecipes[selected].category : '';
    document.querySelector('.uplink-css-studio-recipe-css').value = selected ? userRecipes[selected].css : '';
    document.querySelector('.uplink-css-studio-recipe-delete').hidden = !selected;
  }

  function toggleRecipeEditor(forceOpen) {
    const editor = document.querySelector('.uplink-css-studio-recipe-editor');
    const search = document.querySelector('.uplink-css-studio-snippet-search');
    const list = document.querySelector('.uplink-css-studio-snippet-panel-body');
    const button = document.querySelector('.uplink-css-studio-recipe-editor-toggle');
    if (!editor || !search || !list || !button) return;
    const open = typeof forceOpen === 'boolean' ? forceOpen : editor.hidden;
    editor.hidden = !open;
    search.hidden = open;
    list.hidden = open;
    button.classList.toggle('is-active', open);
    hideTooltip();
    if (open) {
      loadRecipeEditor();
      requestAnimationFrame(() => document.querySelector('.uplink-css-studio-recipe-name')?.focus());
    } else {
      renderSnippets(search.value);
      requestAnimationFrame(() => search.focus());
    }
    requestAnimationFrame(positionActivePopover);
  }

  function renderStateOptions() {
    const panel = document.querySelector('.uplink-css-studio-states-list');
    if (!panel) return;
    panel.innerHTML = stateSelectors.map((item) => `<button type="button" data-state-selector="${item[1]}" data-context="${item[2]}"><strong>${item[0]}</strong><code>%root%${item[1]}</code></button>`).join('');
  }

  function mountLauncher(attempt = 0) {
    let launcher = document.querySelector('#uplink-css-studio-launcher');
    if (!launcher) {
      launcher = document.createElement('button');
      launcher.id = 'uplink-css-studio-launcher';
      launcher.type = 'button';
      launcher.setAttribute('aria-label', 'Open CSS Studio');
      launcher.dataset.tooltip = 'CSS Studio · ⌘⇧C';
      launcher.innerHTML = icon('studio');
    }
    bindLauncher(launcher);

    const toolbar = document.querySelector('.bricks-toolbar.toolbar-left, .bricks-toolbar.toolbar-right') || document.querySelector('.bricks-toolbar');
    const toolbarGroup = toolbar?.querySelector('.group-wrapper.start') || toolbar?.querySelector('.group-wrapper');
    const panel = document.querySelector('#bricks-panel');
    const panelHeader = document.querySelector('#bricks-panel-header');
    const target = toolbarGroup || toolbar || panelHeader || panel;
    if (target) {
      if (toolbar && target !== panel) {
        let slot = document.querySelector('#uplink-css-studio-launcher-slot');
        if (!slot) {
          slot = document.createElement('li');
          slot.id = 'uplink-css-studio-launcher-slot';
          target.appendChild(slot);
        } else if (slot.parentElement !== target) {
          target.appendChild(slot);
        }
        slot.appendChild(launcher);
        launcher.classList.add('is-toolbar-mounted');
        launcher.classList.remove('is-header-mounted', 'is-panel-mounted');
      } else {
        target.appendChild(launcher);
        launcher.classList.add(panel ? 'is-panel-mounted' : 'is-header-mounted');
        launcher.classList.remove('is-toolbar-mounted');
        if (panel) launcher.classList.remove('is-header-mounted');
        else launcher.classList.remove('is-panel-mounted');
      }
      launcher.hidden = false;
      launcher.classList.toggle('is-active', state.open);
      return;
    }
    if (attempt < 40) setTimeout(() => mountLauncher(attempt + 1), 250);
  }

  function bindLauncher(launcher) {
    if (!launcher || launcher.dataset.ucsBound) return;
    launcher.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      state.launcherPointerHandled = true;
    }, true);
    launcher.addEventListener('pointerup', (event) => {
      if (event.button !== 0 || !state.launcherPointerHandled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      state.open ? close() : open();
    }, true);
    launcher.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (state.launcherPointerHandled) {
        state.launcherPointerHandled = false;
        return;
      }
      state.open ? close() : open();
    }, true);
    launcher.dataset.ucsBound = 'true';
  }

  function watchLauncher() {
    if (state.launcherObserver) return;
    state.launcherObserver = new MutationObserver(() => {
      clearTimeout(state.launcherTimer);
      state.launcherTimer = setTimeout(() => {
        mountLauncher();
        bindCanvasSelectionOpener();
      }, 80);
    });
    state.launcherObserver.observe(document.querySelector('#bricks-workspace') || document.body, { childList: true, subtree: true });
  }

  function openFromElementClick() {
    if (!state.prefs.autoOpen || state.open) return;
    clearTimeout(state.selectionOpenTimer);
    state.selectionOpenTimer = setTimeout(() => {
      if (!state.prefs.autoOpen || state.open || !activeContext()?.element) return;
      state.dismissedElementId = '';
      open();
    }, 40);
  }

  function bindCanvasSelectionOpener() {
    const frame = document.querySelector('#bricks-builder-iframe, #bricks-preview iframe');
    if (!frame) return;
    if (state.canvasFrame !== frame) {
      state.canvasFrame = frame;
      frame.addEventListener('load', () => setTimeout(bindCanvasSelectionOpener, 0));
    }
    let frameDocument;
    try { frameDocument = frame.contentDocument; } catch (error) { return; }
    if (!frameDocument || state.canvasDocument === frameDocument) return;
    state.canvasDocument = frameDocument;
    frameDocument.addEventListener('pointerup', (event) => {
      if (!state.prefs.autoOpen || state.open || event.button !== 0) return;
      const element = event.target?.closest?.('[data-id], [id^="brxe-"], [class*="brxe-"]');
      if (element) openFromElementClick();
    }, true);
  }

  function bindSelectionOpeners() {
    if (!state.selectionOpenersBound) {
      document.addEventListener('pointerup', (event) => {
        if (!state.prefs.autoOpen || state.open || event.button !== 0) return;
        const element = event.target?.closest?.('#bricks-structure [data-id], #bricks-structure .structure-item, #bricks-structure .element');
        if (element) openFromElementClick();
      }, true);
      state.selectionOpenersBound = true;
    }
    bindCanvasSelectionOpener();
  }

  function bindEvents() {
    const launcher = document.querySelector('#uplink-css-studio-launcher');
    bindLauncher(launcher);
    watchLauncher();
    bindSelectionOpeners();
    document.querySelector('.uplink-css-studio-close').addEventListener('click', close);
    document.querySelector('.uplink-css-studio-fullscreen').addEventListener('click', toggleFullscreen);
    document.querySelector('.uplink-css-studio-minimize').addEventListener('click', toggleMinimize);
    document.querySelector('.uplink-css-studio-revert').addEventListener('click', revert);
    document.querySelector('.uplink-css-studio-format').addEventListener('click', formatCss);
    document.querySelector('.uplink-css-studio-style-manager').addEventListener('click', openNativeStyleManager);
    document.querySelector('.uplink-css-studio-preferences-toggle').addEventListener('click', (event) => { event.stopPropagation(); togglePreferences(); });
    document.querySelector('.uplink-css-studio-shell').addEventListener('mousedown', (event) => { if (event.target.classList.contains('uplink-css-studio-shell')) close(); });
    document.querySelector('.uplink-css-studio-shell').addEventListener('pointerdown', beginPopoverDrag);
    document.querySelector('.uplink-css-studio-breadcrumbs').addEventListener('click', (event) => {
      const theme = event.target.closest('[data-theme-style-id]');
      if (theme) {
        event.stopPropagation();
        openBreadcrumbThemeStyle(theme.dataset.themeElementId, theme.dataset.themeStyleId, theme.dataset.themeSelector);
        return;
      }
      const crumb = event.target.closest('[data-element-id]');
      if (crumb) selectBreadcrumbElement(crumb.dataset.elementId);
    });
    bindResizer();
    bindCanvasResizers();
    document.querySelector('.uplink-css-studio-recipes-panel').addEventListener('click', (event) => {
      const editButton = event.target.closest('[data-edit-recipe]');
      if (editButton) {
        event.stopPropagation();
        toggleRecipeEditor(true);
        loadRecipeEditor(editButton.dataset.editRecipe);
        return;
      }
      const button = event.target.closest('.uplink-css-studio-snippet');
      if (!button) return;
      if (button.dataset.recipeName) {
        const recipes = button.dataset.recipeSource === 'user' ? userRecipes : externalRecipes;
        const recipe = recipes[button.dataset.recipeName];
        insertExternalRecipe(typeof recipe === 'string' ? recipe : recipe?.css || '');
      }
      else insertDeclarations(button.dataset.css || '');
      closePopovers();
    });
    document.querySelector('.uplink-css-studio-snippet-search').addEventListener('input', (event) => renderSnippets(event.target.value));
    document.querySelector('.uplink-css-studio-recipe-editor-toggle').addEventListener('click', (event) => { event.stopPropagation(); toggleRecipeEditor(); });
    document.querySelector('.uplink-css-studio-recipe-editor-back').addEventListener('click', () => toggleRecipeEditor(false));
    document.querySelector('.uplink-css-studio-recipe-select').addEventListener('change', (event) => loadRecipeEditor(event.target.value));
    document.querySelector('.uplink-css-studio-recipe-editor').addEventListener('submit', saveCustomRecipe);
    document.querySelector('.uplink-css-studio-recipe-delete').addEventListener('click', deleteCustomRecipe);
    document.querySelector('.uplink-css-studio-toolbar').addEventListener('click', (event) => {
      const cssButton = event.target.closest('[data-css]');
      if (cssButton) { insertDeclarations(cssButton.dataset.css || ''); return; }
      const button = event.target.closest('[data-recipe]');
      if (button) insertRecipe(button.dataset.recipe);
    });
    document.querySelector('.uplink-css-studio-toolbar').addEventListener('click', (event) => {
      const button = event.target.closest('[data-layout-preset]');
      if (!button) return;
      event.stopPropagation();
      applyLayoutPreset(button.dataset.layoutPreset, button.classList.contains('is-active'));
    });
    document.querySelector('.uplink-css-studio-toolbar').addEventListener('click', (event) => {
      const button = event.target.closest('[data-grid-template]');
      if (!button) return;
      event.stopPropagation();
      const declarations = gridTemplatePresets[button.dataset.gridTemplate];
      if (declarations) {
        const values = button.classList.contains('is-active')
          ? Object.fromEntries(Object.keys(declarations).map((property) => [property, '']))
          : declarations;
        upsertLayoutDeclarations(values);
        syncNativeGridTemplateInputs(values);
      }
    });
    document.addEventListener('input', (event) => {
      const input = event.target?.closest?.('input#_gridTemplateColumns, input#_gridTemplateRows');
      if (!input || event.isComposing || state.syncingNativeLayoutInput || !state.open || !state.context) return;
      const property = input.id === '_gridTemplateRows' ? 'grid-template-rows' : 'grid-template-columns';
      upsertLayoutDeclarations({ [property]: input.value }, { focus: false });
      clearTimeout(state.timer);
      writeToBricks(false, { syncNativeControl: false, renderCanvas: false });
    }, true);
    document.querySelector('.uplink-css-studio-toolbar').addEventListener('click', (event) => {
      const alignment = event.target.closest('[data-alignment-axis]');
      if (alignment) {
        const declarations = declarationsAtLayoutContext();
        if (alignment.classList.contains('is-active') && declarations.has('place-items')) {
          const parts = declarations.get('place-items').value.trim().split(/\s+/);
          const alignValue = parts[0] || '';
          const justifyValue = parts[1] || alignValue;
          upsertLayoutDeclarations(alignment.dataset.alignmentAxis === 'main'
            ? { 'place-items': '', 'align-items': alignValue }
            : { 'place-items': '', 'justify-items': justifyValue });
        } else upsertLayoutDeclarations({ [alignment.dataset.alignmentProperty]: alignment.classList.contains('is-active') ? '' : alignment.dataset.alignmentValue });
        refreshLayoutTools();
        return;
      }
      const place = event.target.closest('[data-place-value]');
      if (place && !place.disabled) applyPlaceAlignment(place.dataset.placeValue, place.classList.contains('is-active'));
    });
    document.querySelector('.uplink-css-studio-outline-toggle').addEventListener('click', (event) => { event.stopPropagation(); togglePopover('outline'); });
    document.querySelector('.uplink-css-studio-recipes-toggle').addEventListener('click', (event) => { event.stopPropagation(); togglePopover('recipes'); });
    document.querySelector('.uplink-css-studio-toolbar').addEventListener('click', (event) => {
      const button = event.target.closest('[data-shortcut-group]');
      if (!button) return;
      event.stopPropagation();
      toggleShortcutGroup(button.dataset.shortcutGroup, button);
    });
    document.querySelector('.uplink-css-studio-shortcuts-panel').addEventListener('click', (event) => {
      const item = event.target.closest('[data-css]');
      if (!item) return;
      insertDeclarations(item.dataset.css || '');
      closePopovers();
    });
    document.querySelector('.uplink-css-studio-colors-toggle').addEventListener('click', (event) => { event.stopPropagation(); toggleColorsPanel(); });
    document.querySelector('.uplink-css-studio-color-close').addEventListener('click', () => {
      if (!returnFromNestedColorPicker()) closePopovers();
    });
    document.querySelector('.uplink-css-studio-color-tabs').addEventListener('click', (event) => {
      const tab = event.target.closest('[data-color-tab]');
      if (tab) setColorTab(tab.dataset.colorTab);
    });
    document.querySelector('.uplink-css-studio-color-list').addEventListener('click', (event) => {
      const color = event.target.closest('[data-color-value]');
      if (color) applyColorValue(color.dataset.colorValue);
    });
    document.querySelector('.uplink-css-studio-color-search').addEventListener('input', (event) => renderColors(event.target.value));
    document.querySelector('.uplink-css-studio-color-property').addEventListener('change', (event) => {
      const label = document.querySelector('.uplink-css-studio-color-context');
      if (label) label.textContent = `Insert ${event.target.value}`;
    });
    document.querySelector('.uplink-css-studio-color-native').addEventListener('input', (event) => {
      syncColorControlsFromHex(event.target.value);
    });
    const colorSv = document.querySelector('.uplink-css-studio-color-sv');
    const updateColorSv = (event) => {
      const rect = colorSv.getBoundingClientRect();
      state.colorPicker.s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      state.colorPicker.v = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      syncColorCustomUi(true);
    };
    colorSv.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      colorSv.setPointerCapture?.(event.pointerId);
      updateColorSv(event);
    });
    colorSv.addEventListener('pointermove', (event) => {
      if (colorSv.hasPointerCapture?.(event.pointerId)) updateColorSv(event);
    });
    document.querySelector('.uplink-css-studio-color-hue').addEventListener('input', (event) => {
      state.colorPicker.h = Number(event.target.value);
      syncColorCustomUi(true);
    });
    document.querySelector('.uplink-css-studio-color-mode').addEventListener('change', (event) => {
      state.prefs.colorMode = event.target.value;
      savePrefs();
      syncColorControlsFromHex(document.querySelector('.uplink-css-studio-color-native').value);
    });
    document.querySelector('.uplink-css-studio-color-alpha input').addEventListener('input', (event) => {
      document.querySelector('.uplink-css-studio-color-alpha output').textContent = `${event.target.value}%`;
      syncColorCustomUi(true);
    });
    document.querySelector('.uplink-css-studio-color-value').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); applyColorValue(event.currentTarget.value); }
    });
    document.querySelector('.uplink-css-studio-color-apply').addEventListener('click', () => applyColorValue());
    const eyedropper = document.querySelector('.uplink-css-studio-color-eyedropper');
    if (!window.EyeDropper) eyedropper.hidden = true;
    else eyedropper.addEventListener('click', pickCanvasColor);
    document.querySelector('.uplink-css-studio-targets-toggle').addEventListener('click', (event) => { event.stopPropagation(); toggleTargetsPanel(); });
    document.querySelector('.uplink-css-studio-root-rule').addEventListener('click', () => { leaveSiteWideContext(); insertRule('%root% {\n  \n}'); closePopovers(); });
    document.querySelector('.uplink-css-studio-assign-class').addEventListener('click', assignClassTarget);
    document.querySelector('.uplink-css-studio-assign-id').addEventListener('click', assignIdTarget);
    document.querySelector('.uplink-css-studio-open-html-target').addEventListener('click', openHtmlTarget);
    document.querySelector('.uplink-css-studio-class-input').addEventListener('keydown', (event) => applyTargetOnEnter(event, assignClassTarget));
    document.querySelector('.uplink-css-studio-id-input').addEventListener('keydown', (event) => applyTargetOnEnter(event, assignIdTarget));
    document.querySelector('.uplink-css-studio-html-input').addEventListener('keydown', (event) => applyTargetOnEnter(event, openHtmlTarget));
    document.querySelector('.uplink-css-studio-media-toggle').addEventListener('click', (event) => { event.stopPropagation(); toggleQueryPanel('media'); });
    document.querySelector('.uplink-css-studio-container-toggle').addEventListener('click', (event) => { event.stopPropagation(); toggleQueryPanel('container'); });
    document.querySelector('.uplink-css-studio-states-toggle').addEventListener('click', (event) => { event.stopPropagation(); togglePopover('states'); });
    document.querySelector('.uplink-css-studio-states-list').addEventListener('click', (event) => {
      const item = event.target.closest('[data-state-selector]');
      if (!item) return;
      insertStateSelector(item.dataset.stateSelector);
      closePopovers();
    });
    document.querySelector('.uplink-css-studio-auto-open').addEventListener('change', (event) => {
      state.prefs.autoOpen = Boolean(event.target.checked);
      state.dismissedElementId = '';
      savePrefs();
      if (state.prefs.autoOpen) bindCanvasSelectionOpener();
      setStatus(state.prefs.autoOpen ? 'Open on element selection enabled' : 'Open on element selection disabled', 'synced');
    });
    document.querySelector('.uplink-css-studio-first-class').addEventListener('change', (event) => {
      state.prefs.firstAppliedClass = Boolean(event.target.checked);
      state.firstClassElementId = '';
      savePrefs();
      if (state.prefs.firstAppliedClass) {
        const next = activeContext();
        if (state.open && next) setContext(next);
      }
      setStatus(state.prefs.firstAppliedClass ? 'First applied class selection enabled' : 'First applied class selection disabled', 'synced');
    });
    document.querySelector('.uplink-css-studio-viewport-handles').addEventListener('change', (event) => {
      state.prefs.viewportHandles = Boolean(event.target.checked);
      savePrefs();
      mountCanvasResizers();
      setStatus(state.prefs.viewportHandles ? 'Viewport resize handles enabled' : 'Viewport resize handles disabled', 'synced');
    });
    document.querySelector('.uplink-css-studio-numeric-scrubbing').addEventListener('change', (event) => {
      setNumericScrubbing(Boolean(event.target.checked));
    });
    document.querySelector('.uplink-css-studio-value-close').addEventListener('click', closeValuePanel);
    document.querySelector('.uplink-css-studio-outline-search').addEventListener('input', (event) => renderOutline(event.target.value));
    document.querySelector('.uplink-css-studio-outline-list').addEventListener('click', (event) => {
      const item = event.target.closest('[data-line]');
      if (item) jumpToLine(Number(item.dataset.line));
    });
    document.querySelector('.uplink-css-studio-query-list').addEventListener('click', (event) => {
      const item = event.target.closest('[data-query-mode]');
      if (!item) return;
      insertQueryRule(
        item.dataset.queryKind,
        item.dataset.queryMode,
        Number(item.dataset.queryLow),
        Number(item.dataset.queryHigh)
      );
      closePopovers();
    });
    document.querySelector('.uplink-css-studio-search').addEventListener('click', () => state.editor.execCommand('find'));
    document.querySelector('.uplink-css-studio-comment').addEventListener('click', () => state.editor.execCommand('toggleComment'));
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.uplink-css-studio-popover') && !event.target.closest('.uplink-css-studio-outline-toggle') && !event.target.closest('.uplink-css-studio-recipes-toggle') && !event.target.closest('.uplink-css-studio-shortcut-category') && !event.target.closest('.uplink-css-studio-colors-toggle') && !event.target.closest('.uplink-css-studio-targets-toggle') && !event.target.closest('.uplink-css-studio-media-toggle') && !event.target.closest('.uplink-css-studio-container-toggle') && !event.target.closest('.uplink-css-studio-states-toggle') && !event.target.closest('.uplink-css-studio-preferences-toggle')) closePopovers();
    });
    bindTooltips();
    document.addEventListener('keydown', shortcuts, true);
    window.addEventListener('resize', positionActivePopover);
  }

  function bindTooltips() {
    const tooltip = document.querySelector('.uplink-css-studio-tooltip');
    const show = (target) => {
      const text = target?.dataset?.tooltip;
      if (!tooltip || !text) return;
      tooltip.textContent = text;
      tooltip.hidden = false;
      const rect = target.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const left = Math.max(8, Math.min(window.innerWidth - tooltipRect.width - 8, rect.left + rect.width / 2 - tooltipRect.width / 2));
      const above = rect.top - tooltipRect.height - 8;
      const below = rect.bottom + 8;
      const top = above >= 8 ? above : Math.min(window.innerHeight - tooltipRect.height - 8, below);
      tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    };
    const hide = () => { if (tooltip) tooltip.hidden = true; };
    document.addEventListener('pointerover', (event) => {
      const target = event.target.closest('[data-tooltip]');
      if (target) show(target);
    });
    document.addEventListener('pointerout', (event) => {
      if (event.target.closest('[data-tooltip]')) hide();
    });
    document.addEventListener('focusin', (event) => {
      const target = event.target.closest('[data-tooltip]');
      if (target) show(target);
    });
    document.addEventListener('focusout', hide);
  }

  function hideTooltip() {
    const tooltip = document.querySelector('.uplink-css-studio-tooltip');
    if (tooltip) tooltip.hidden = true;
  }

  function autocomplete(editor = state.editor) {
    if (!editor || !window.wp?.CodeMirror) return;
    editor.showHint({
      hint: cssHints,
      completeSingle: false,
      closeOnUnfocus: true,
      container: document.querySelector('.uplink-css-studio-shell') || document.body
    });
  }

  function maybeAutocomplete(editor, change) {
    if (!change || change.origin !== '+input' || change.text.length !== 1 || change.text[0].length !== 1) return;
    const character = change.text[0];
    if (character === ';' && expandRecipeTrigger(editor)) return;
    if (!/[a-zA-Z@():>-]/.test(character)) return;
    const cursor = editor.getCursor();
    const token = editor.getTokenAt(cursor);
    if (/comment|string/.test(token.type || '')) return;
    clearTimeout(state.autocompleteTimer);
    state.autocompleteTimer = setTimeout(() => autocomplete(editor), 70);
  }

  function expandRecipeTrigger(editor) {
    const cursor = editor.getCursor();
    const beforeCursor = editor.getLine(cursor.line).slice(0, cursor.ch);
    const match = beforeCursor.match(/@([a-z0-9_-]+);$/i);
    if (!match) return false;
    const catalog = recipeCatalog();
    const recipeName = Object.keys(catalog).find((name) => name.toLowerCase() === match[1].toLowerCase());
    if (!recipeName) return false;
    const from = { line: cursor.line, ch: cursor.ch - match[0].length };
    insertExternalRecipe(catalog[recipeName].css, editor, from, cursor);
    setStatus(`Inserted ${catalog[recipeName].label}`, 'dirty');
    return true;
  }

  function completeCssProperty(editor) {
    const CodeMirror = window.wp?.CodeMirror;
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const beforeCursor = line.slice(0, cursor.ch);
    if (!CodeMirror || editor.somethingSelected()) return CodeMirror?.Pass;
    const cmToken = editor.getTokenAt(cursor);
    if (/comment|string/.test(cmToken.type || '')) return CodeMirror.Pass;

    if (completeCssCalculation(editor, cursor, beforeCursor, CodeMirror)) return;

    const tokenMatch = beforeCursor.match(/([\w-]+)$/);
    if (!tokenMatch) return CodeMirror.Pass;

    const rawToken = tokenMatch[1];
    const token = rawToken.toLowerCase();
    const from = CodeMirror.Pos(cursor.line, cursor.ch - tokenMatch[1].length);
    const beforeToken = line.slice(0, from.ch);

    const rootMode = rootShortcutMode(editor, from, cursor, rawToken);
    if (rootMode) {
      insertRootShortcut(editor, from, cursor, rootMode);
      return;
    }

    const catalog = recipeCatalog();
    const recipeName = Object.keys(catalog).find((name) => name.toLowerCase() === token);
    if (recipeName) {
      insertExternalRecipe(catalog[recipeName].css, editor, from, cursor);
      return;
    }

    if (!/(?:^|[;{])\s*$/.test(beforeToken)) return CodeMirror.Pass;

    const hints = cssHints(editor, {})?.list || [];
    const candidates = hints.map((item) => typeof item === 'string' ? item : item.text || '')
      .filter((item) => /^[a-z-][\w-]*$/i.test(item));
    const property = cssAbbreviations[token]
      || candidates.find((item) => item.toLowerCase() === token)
      || candidates.find((item) => item.toLowerCase().startsWith(token));
    if (!property) return CodeMirror.Pass;

    insertPropertyCompletion(editor, from, cursor, property);
  }

  const cssMathFunctions = /^(?:var|env|calc|min|max|clamp|round|mod|rem|sin|cos|tan|asin|acos|atan|atan2|pow|sqrt|hypot|log|exp|abs|sign)\s*\(/i;

  function cssMathOperandStart(text) {
    const value = text.trimStart();
    return /^[-+]?(?:\d|\.\d)/.test(value) || cssMathFunctions.test(value);
  }

  function cssMathOperandEnd(text) {
    const value = text.trimEnd();
    return /\)$/.test(value) || /(?:\d|\.\d)(?:[a-z%]+)?$/i.test(value);
  }

  function expandBareCustomProperties(value) {
    let output = '';
    let quote = '';
    let escaped = false;
    let comment = false;

    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      const next = value[index + 1] || '';
      if (comment) {
        output += character;
        if (character === '*' && next === '/') {
          output += next;
          comment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        output += character;
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = '';
        continue;
      }
      if (character === '/' && next === '*') {
        output += character;
        comment = true;
        continue;
      }
      if (character === '"' || character === "'") {
        output += character;
        quote = character;
        continue;
      }
      if (character === '-' && next === '-') {
        const variable = value.slice(index).match(/^--[a-z_][\w-]*/i)?.[0] || '';
        if (variable) {
          output += /var\(\s*$/i.test(output) ? variable : `var(${variable})`;
          index += variable.length - 1;
          continue;
        }
      }
      output += character;
    }
    return output;
  }

  function normalizeCssCalculationExpression(value) {
    const operatorIndexes = [];
    let depth = 0;
    let quote = '';
    let escaped = false;
    let comment = false;

    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      const next = value[index + 1] || '';
      if (comment) {
        if (character === '*' && next === '/') {
          comment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = '';
        continue;
      }
      if (character === '/' && next === '*') {
        comment = true;
        index += 1;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === '(' || character === '[') {
        depth += 1;
        continue;
      }
      if (character === ')' || character === ']') {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth || !'+-*/'.includes(character)) continue;
      const left = value.slice(0, index);
      const right = value.slice(index + 1);
      if (cssMathOperandEnd(left) && cssMathOperandStart(right)) operatorIndexes.push(index);
    }

    if (!operatorIndexes.length) return '';
    const operators = new Set(operatorIndexes);
    let normalized = '';
    for (let index = 0; index < value.length; index += 1) {
      if (!operators.has(index)) {
        normalized += value[index];
        continue;
      }
      normalized = `${normalized.trimEnd()} ${value[index]} `;
      while (/\s/.test(value[index + 1] || '')) index += 1;
    }
    return normalized.trim();
  }

  function completeCssCalculation(editor, cursor, beforeCursor, CodeMirror) {
    const declaration = beforeCursor.match(/(?:^|[;{])(\s*[\w-]+\s*:\s*)([^;{}]+)$/);
    if (!declaration) return false;
    const rawValue = declaration[2];
    const leading = rawValue.match(/^\s*/)?.[0] || '';
    let expression = rawValue.trim();
    let important = '';
    if (/\s*!important\s*$/i.test(expression)) {
      expression = expression.replace(/\s*!important\s*$/i, '').trimEnd();
      important = ' !important';
    }
    const normalized = normalizeCssCalculationExpression(expandBareCustomProperties(expression));
    if (!normalized) return false;
    const from = CodeMirror.Pos(cursor.line, cursor.ch - rawValue.length + leading.length);
    const afterCursor = editor.getLine(cursor.line).slice(cursor.ch);
    const hasSemicolon = /^\s*;/.test(afterCursor);
    const replacement = `calc(${normalized})${important}${hasSemicolon ? '' : ';'}`;
    editor.replaceRange(replacement, from, cursor, 'complete');
    editor.setCursor({ line: from.line, ch: from.ch + replacement.length });
    return true;
  }

  function insertPropertyCompletion(editor, from, to, property) {
    const replacement = `${property}: ;`;
    editor.replaceRange(replacement, from, to, 'complete');
    editor.setCursor({ line: from.line, ch: from.ch + property.length + 2 });
  }

  function rootShortcutMode(editor, from, to, token) {
    if (token !== 'r' && token !== 'R') return '';
    const doc = editor.getDoc();
    const start = { line: 0, ch: 0 };
    const lastLine = Math.max(0, doc.lineCount() - 1);
    const end = { line: lastLine, ch: doc.getLine(lastLine).length };
    const outsideToken = doc.getRange(start, from) + doc.getRange(to, end);
    if (outsideToken.trim()) return '';
    return token === 'R' ? 'rule' : 'selector';
  }

  function insertRootShortcut(editor, from, to, mode) {
    const replacement = mode === 'rule' ? rootRule : '%root%';
    editor.replaceRange(replacement, from, to, 'complete');
    if (mode === 'rule') editor.setCursor({ line: from.line + 1, ch: 2 });
    else editor.setCursor({ line: from.line, ch: from.ch + replacement.length });
  }

  function rootShortcutHint(editor, from, to) {
    const token = editor.getRange(from, to);
    const mode = rootShortcutMode(editor, from, to, token);
    if (!mode) return null;
    return {
      text: mode === 'rule' ? rootRule : '%root%',
      displayText: mode === 'rule' ? 'R  →  %root% rule' : 'r  →  %root%',
      className: 'uplink-css-studio-hint-abbreviation',
      hint: (cm, data) => insertRootShortcut(cm, data.from, data.to, mode)
    };
  }

  function propertyHint(item) {
    const source = typeof item === 'string' ? { text: item } : Object.assign({}, item);
    if (typeof source.hint === 'function') return source;
    const property = source.text || source.displayText || '';
    if (!/^[a-z-][\w-]*$/i.test(property)) return item;
    source.hint = (editor, data) => insertPropertyCompletion(editor, data.from, data.to, property);
    return source;
  }

  function insertAtRuleCompletion(editor, from, to, name) {
    const line = editor.getLine(from.line) || '';
    const indent = line.match(/^\s*/)?.[0] || '';
    const replacement = `@${name} () {\n${indent}  \n${indent}}`;
    editor.replaceRange(replacement, from, to, 'complete');
    editor.setCursor({ line: from.line, ch: from.ch + name.length + 3 });
  }

  function queryPreludeAt(source, cursorIndex) {
    const beforeCursor = String(source || '').slice(0, cursorIndex);
    const matches = [...beforeCursor.matchAll(/@(media|container)\b/gi)];
    const match = matches.pop();
    if (!match) return null;
    const segmentStart = match.index;
    const segment = beforeCursor.slice(segmentStart);
    if (/[{};]/.test(segment)) return null;
    const open = segment.lastIndexOf('(');
    const close = segment.lastIndexOf(')');
    if (open === -1 || close > open) return null;
    const condition = segment.slice(open + 1);
    const valueMatch = condition.match(/^\s*([a-z-]+)\s*:\s*([a-z0-9_.%/-]*)$/i);
    if (valueMatch) {
      return {
        kind: match[1].toLowerCase(),
        mode: 'value',
        feature: valueMatch[1].toLowerCase(),
        prefix: valueMatch[2].toLowerCase(),
        fromIndex: cursorIndex - valueMatch[2].length
      };
    }
    const rangeMatch = condition.match(/^\s*([a-z-]+)\s*(?:<=|>=|<|>)\s*([a-z0-9_.%/-]*)$/i);
    if (rangeMatch) {
      return {
        kind: match[1].toLowerCase(),
        mode: 'value',
        feature: rangeMatch[1].toLowerCase(),
        prefix: rangeMatch[2].toLowerCase(),
        fromIndex: cursorIndex - rangeMatch[2].length
      };
    }
    const featureMatch = condition.match(/^\s*([a-z-]*)$/i);
    if (!featureMatch) return null;
    return {
      kind: match[1].toLowerCase(),
      mode: 'feature',
      feature: '',
      prefix: featureMatch[1].toLowerCase(),
      fromIndex: cursorIndex - featureMatch[1].length
    };
  }

  function queryPreludeHints(editor, cursor, CodeMirror) {
    const doc = editor.getDoc();
    const cursorIndex = doc.indexFromPos(cursor);
    const context = queryPreludeAt(doc.getValue(), cursorIndex);
    if (!context) return null;
    const from = doc.posFromIndex(context.fromIndex);
    let values;
    if (context.mode === 'feature') {
      values = queryFeatures[context.kind] || [];
    } else {
      const registeredWidths = registeredBreakpoints().map((breakpoint) => `${breakpoint.width}px`);
      const lengthFeature = /(?:^|-)width$|(?:^|-)height$|size$|aspect-ratio$|resolution$/.test(context.feature);
      values = queryFeatureValues[context.feature]
        || (lengthFeature ? [...registeredWidths, '0', '1px', '1rem', '100%', 'var()', 'calc()'] : []);
    }
    const seen = new Set();
    const list = values.filter((value) => {
      const label = String(value);
      if ((context.prefix && !label.toLowerCase().startsWith(context.prefix)) || seen.has(label)) return false;
      seen.add(label);
      return true;
    }).map((value) => ({
      text: value,
      displayText: context.mode === 'feature' ? `${value}  ·  ${context.kind} feature` : value,
      className: 'uplink-css-studio-hint-catalog'
    }));
    return { list, from: CodeMirror.Pos(from.line, from.ch), to: cursor };
  }

  function cssHints(editor, options) {
    const CodeMirror = window.wp?.CodeMirror;
    const cursor = editor.getCursor();
    const beforeCursor = editor.getLine(cursor.line).slice(0, cursor.ch);
    const declaration = beforeCursor.match(/(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]*)$/);
    const variables = availableVariableEntries(editor);

    const queryHints = queryPreludeHints(editor, cursor, CodeMirror);
    if (queryHints) return queryHints;

    const recipeTrigger = beforeCursor.match(/@([a-z0-9_-]*)$/i);
    if (recipeTrigger) {
      const recipePrefix = recipeTrigger[1].toLowerCase();
      const recipeFrom = CodeMirror.Pos(cursor.line, cursor.ch - recipeTrigger[0].length);
      const atRuleItems = ['media', 'container']
        .filter((name) => name.startsWith(recipePrefix))
        .map((name) => ({
          text: `@${name} () {\n  \n}`,
          displayText: `@${name} (…) { … }`,
          className: 'uplink-css-studio-hint-catalog',
          hint: (cm, data) => insertAtRuleCompletion(cm, data.from, data.to, name)
        }));
      const recipeItems = Object.entries(recipeCatalog())
        .filter(([name]) => name.toLowerCase().startsWith(recipePrefix))
        .map(([name, recipe]) => ({
          text: `@${name};`,
          displayText: `@${name};  →  ${recipe.label}`,
          className: 'uplink-css-studio-hint-recipe',
          hint: (cm, data) => insertExternalRecipe(recipe.css, cm, data.from, data.to)
        }));
      const atRuleAndRecipeItems = [...atRuleItems, ...recipeItems];
      if (atRuleAndRecipeItems.length) return { list: atRuleAndRecipeItems, from: recipeFrom, to: cursor };
    }

    if (declaration) {
      const property = declaration[1].toLowerCase();
      const valueText = declaration[2];
      const valueToken = (valueText.match(/[^\s,(]*$/) || [''])[0];
      const prefix = valueToken.toLowerCase();
      const from = CodeMirror.Pos(cursor.line, cursor.ch - valueToken.length);
      const colorValues = /(?:^|-)color$|^(?:background|border|outline|fill|stroke|caret-color|accent-color)$/.test(property)
        ? ['transparent', 'currentColor', 'light-dark()', 'color-mix()', 'rgb()', 'hsl()', 'oklch()', 'var()'] : [];
      const imageValues = /(?:background|mask)-image$|^background$/.test(property)
        ? ['none', 'linear-gradient()', 'radial-gradient()', 'conic-gradient()', 'url()'] : [];
      const lengthValues = /(?:width|height|size|gap|margin|padding|inset|top|right|bottom|left|radius|spacing|basis)$/.test(property)
        ? ['auto', '0', '1px', '1rem', '100%', '100svh', 'min()', 'max()', 'clamp()', 'calc()', 'var()'] : [];
      const beforeValueToken = valueText.slice(0, Math.max(0, valueText.length - valueToken.length));
      const insideVarFunction = /var\(\s*$/.test(beforeValueToken);
      const variableSearch = prefix.replace(/^var\(/, '').replace(/^--/, '');
      const customValues = variables
        .filter((variable) => !variableSearch || variable.name.slice(2).toLowerCase().startsWith(variableSearch))
        .map((variable) => ({
          text: insideVarFunction ? variable.name : `var(${variable.name})`,
          displayText: `${variable.name}  →  ${variable.source}`,
          className: 'uplink-css-studio-hint-variable',
          matchText: variable.name.slice(2)
        }));
      const recipeValues = Object.entries(recipeCatalog())
        .filter(([name, recipe]) => (!prefix || name.toLowerCase().startsWith(prefix)) && !/[;{}]/.test(recipe.css))
        .map(([name, recipe]) => recipeHint(name, recipe.css, recipe.provider));
      const catalogValues = catalogPropertyMap.get(property)?.values || [];
      const values = [...recipeValues, ...(propertyValues[property] || []), ...catalogValues, ...colorValues, ...imageValues, ...lengthValues, ...customValues, ...cssWideValues];
      const seen = new Set();
      const list = values.filter((value) => {
        const label = typeof value === 'string' ? value : value.text || value.displayText || '';
        const alternate = typeof value === 'string' ? '' : String(value.matchText || '').toLowerCase();
        if (!label || (prefix && !label.toLowerCase().startsWith(prefix) && !(alternate && alternate.startsWith(variableSearch))) || seen.has(label)) return false;
        seen.add(label);
        return true;
      });
      return { list, from, to: cursor };
    }

    const base = CodeMirror?.hint?.css ? CodeMirror.hint.css(editor, options) : null;
    const token = editor.getTokenAt(cursor);
    const from = base?.from || CodeMirror.Pos(cursor.line, token.start);
    const to = base?.to || CodeMirror.Pos(cursor.line, token.end);
    const prefix = editor.getRange(from, to).toLowerCase();
    const rootHint = rootShortcutHint(editor, from, to);
    if (rootHint) return { list: [rootHint], from, to };
    const baseList = Array.isArray(base?.list) ? base.list : [];
    const inBlock = editor.getValue().slice(0, editor.indexFromPos(cursor)).lastIndexOf('{') > editor.getValue().slice(0, editor.indexFromPos(cursor)).lastIndexOf('}');
    const additions = modernCssTerms.filter((term) => {
      if (inBlock && !/^[a-z-][\w-]*$/i.test(term)) return false;
      return term.toLowerCase().startsWith(prefix);
    });
    const catalogItems = inBlock ? (cssCatalog.properties || [])
      .filter((property) => property.name.toLowerCase().startsWith(prefix))
      .map((property) => {
        const supported = Boolean(window.CSS?.supports?.(property.name, 'initial'));
        const qualifier = supported ? '' : (property.status === 'experimental' ? '  ·  draft' : '  ·  unsupported here');
        return {
          text: property.name,
          displayText: `${property.name}${qualifier}`,
          className: supported ? 'uplink-css-studio-hint-catalog' : 'uplink-css-studio-hint-unsupported'
        };
      }) : [];
    const shorthandItems = Object.entries(cssAbbreviations)
      .filter(([alias, property]) => alias.startsWith(prefix) || property.startsWith(prefix))
      .map(([alias, property]) => ({ text: property, displayText: `${alias}  →  ${property}`, className: 'uplink-css-studio-hint-abbreviation' }));
    const variableItems = variables
      .filter((variable) => variable.name.toLowerCase().startsWith(prefix.replace(/^var\(/, '')))
      .map((variable) => ({
        text: variable.name,
        displayText: `${variable.name}  →  ${variable.source}`,
        className: 'uplink-css-studio-hint-variable'
      }));
    const recipeItems = prefix.length >= 2 ? Object.entries(recipeCatalog())
      .filter(([name]) => name.toLowerCase().startsWith(prefix))
      .map(([name, recipe]) => recipeHint(name, recipe.css, recipe.provider)) : [];
    const seen = new Set();
    const list = [...recipeItems, ...shorthandItems, ...baseList, ...catalogItems, ...additions, ...variableItems].filter((item) => {
      const label = typeof item === 'string' ? item : item.text || item.displayText || '';
      if (!label || seen.has(label)) return false;
      seen.add(label);
      return true;
    });
    return { list: inBlock ? list.map(propertyHint) : list, from, to };
  }

  function recipeHint(name, css, provider = recipeProvider) {
    return {
      text: name,
      displayText: `${name}  →  ${provider}`,
      className: 'uplink-css-studio-hint-recipe',
      hint: (editor, data) => insertExternalRecipe(css, editor, data.from, data.to)
    };
  }

  function insertExternalRecipe(css, editor = state.editor, from = null, to = null) {
    if (!editor || !css) return;
    const doc = editor.getDoc();
    const start = from || doc.getCursor();
    const end = to || start;
    doc.replaceRange(css, start, end, 'complete');
    const startIndex = doc.indexFromPos(start);
    doc.setCursor(doc.posFromIndex(startIndex + css.length));
    editor.focus();
  }

  function normalizeRecipeName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
  }

  function normalizeRecipeCategory(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80) || 'My recipes';
  }

  function normalizeUserRecipe(recipe, name = '') {
    const value = typeof recipe === 'string' ? { css: recipe, category: 'My recipes' } : recipe;
    const css = String(value?.css || '').trim();
    if (!css) return null;
    const label = String(value?.label || '').trim().slice(0, 120) || recipeLabel(name);
    return { label, css, category: normalizeRecipeCategory(value?.category) };
  }

  function cloneUserRecipes() {
    return Object.fromEntries(Object.entries(userRecipes).map(([name, recipe]) => [name, Object.assign({}, recipe)]));
  }

  function replaceUserRecipes(recipes) {
    Object.keys(userRecipes).forEach((name) => delete userRecipes[name]);
    Object.entries(recipes || {}).forEach(([name, value]) => {
      const recipe = normalizeUserRecipe(value, name);
      if (name && recipe) userRecipes[name] = recipe;
    });
  }

  async function persistUserRecipes() {
    if (!config.ajaxUrl || !config.recipeNonce) throw new Error('Recipe storage is unavailable.');
    const body = new FormData();
    body.append('action', 'uplink_css_studio_save_recipes');
    body.append('nonce', config.recipeNonce);
    body.append('postId', String(config.postId || ''));
    body.append('recipes', JSON.stringify(userRecipes));
    const response = await fetch(config.ajaxUrl, { method: 'POST', credentials: 'same-origin', body });
    const result = await response.json();
    if (!response.ok || !result?.success) throw new Error(result?.data?.message || 'Could not save recipes.');
    replaceUserRecipes(result.data?.recipes || {});
  }

  async function saveCustomRecipe(event) {
    event.preventDefault();
    const select = document.querySelector('.uplink-css-studio-recipe-select');
    const oldName = select?.value || '';
    const labelInput = document.querySelector('.uplink-css-studio-recipe-label');
    const nameInput = document.querySelector('.uplink-css-studio-recipe-name');
    const categoryInput = document.querySelector('.uplink-css-studio-recipe-category');
    const cssInput = document.querySelector('.uplink-css-studio-recipe-css');
    const label = String(labelInput?.value || '').trim().slice(0, 120);
    const name = normalizeRecipeName(nameInput?.value || label);
    const category = normalizeRecipeCategory(categoryInput?.value);
    const css = String(cssInput?.value || '').trim();
    if (!label || !name || !css) {
      setStatus('Recipe name, shortcut, and CSS are required', 'dirty');
      (!label ? labelInput : (!name ? nameInput : cssInput))?.focus();
      return;
    }

    const previous = cloneUserRecipes();
    if (oldName && oldName !== name) delete userRecipes[oldName];
    userRecipes[name] = { label, css, category };
    const saveButton = document.querySelector('.uplink-css-studio-recipe-save');
    if (saveButton) saveButton.disabled = true;
    try {
      await persistUserRecipes();
      renderSnippets(document.querySelector('.uplink-css-studio-snippet-search')?.value || '');
      setStatus(`Saved recipe ${name}`, 'synced');
      toggleRecipeEditor(false);
    } catch (error) {
      replaceUserRecipes(previous);
      setStatus(error.message || 'Could not save recipe', 'dirty');
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  }

  async function deleteCustomRecipe() {
    const name = document.querySelector('.uplink-css-studio-recipe-select')?.value || '';
    if (!name || !userRecipes[name] || !window.confirm(`Delete the “${recipeLabel(name)}” recipe?`)) return;
    const previous = cloneUserRecipes();
    delete userRecipes[name];
    try {
      await persistUserRecipes();
      renderSnippets(document.querySelector('.uplink-css-studio-snippet-search')?.value || '');
      loadRecipeEditor();
      setStatus(`Deleted recipe ${name}`, 'synced');
    } catch (error) {
      replaceUserRecipes(previous);
      loadRecipeEditor(name);
      setStatus(error.message || 'Could not delete recipe', 'dirty');
    }
  }

  function shortcuts(event) {
    const command = navigator.platform.toLowerCase().includes('mac') ? event.metaKey : event.ctrlKey;
    if (command && event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault(); event.stopPropagation(); state.open ? close() : open(); return;
    }
    if (!state.open) return;
    if (command && event.shiftKey && event.key.toLowerCase() === 'o') {
      event.preventDefault(); event.stopPropagation(); toggleOutline(); return;
    }
    if (command && event.altKey && (event.code === 'KeyX' || event.key.toLowerCase() === 'x')) {
      event.preventDefault(); event.stopPropagation(); toggleNumericScrubbing(); return;
    }
    if (event.key === 'Escape') {
      if (state.colorReturnPopover && !document.querySelector('.uplink-css-studio-colors-panel')?.hidden) returnFromNestedColorPicker();
      else if (document.querySelector('.uplink-css-studio-popover:not([hidden])')) closePopovers();
      else close();
      event.preventDefault();
    }
  }

  function open() {
    const preview = document.querySelector('#bricks-preview');
    const shell = document.querySelector('.uplink-css-studio-shell');
    if (preview && shell.parentNode !== preview) preview.appendChild(shell);
    if (preview) preview.classList.add('uplink-css-studio-dock-open');
    const ctx = activeContext();
    state.open = true;
    state.fullscreen = false;
    state.minimized = Boolean(state.prefs.minimized);
    state.originals = new Map();
    shell.classList.toggle('is-minimized', state.minimized);
    shell.classList.remove('is-fullscreen');
    shell.hidden = false;
    if (state.prefs.dockHeight) {
      shell.style.setProperty('--uplink-css-studio-dock-height', state.prefs.dockHeight);
      preview?.style.setProperty('--uplink-css-studio-dock-height', state.prefs.dockHeight);
    }
    if (preview) preview.classList.toggle('uplink-css-studio-dock-minimized', state.minimized);
    if (preview) preview.classList.remove('uplink-css-studio-studio-fullscreen');
    updateFullscreenButton();
    const minimizeButton = document.querySelector('.uplink-css-studio-minimize');
    if (minimizeButton) {
      minimizeButton.innerHTML = icon(state.minimized ? 'restore' : 'minimize');
      minimizeButton.setAttribute('aria-label', state.minimized ? 'Restore CSS Studio' : 'Minimize CSS Studio');
      minimizeButton.dataset.tooltip = state.minimized ? 'Restore editor' : 'Minimize';
    }
    document.querySelector('#uplink-css-studio-launcher')?.classList.add('is-active');
    setContext(ctx);
    state.dismissedElementId = '';
    if (!state.minimized) requestAnimationFrame(() => { state.editor.refresh(); state.editor.focus(); });
  }

  function close() {
    state.dismissedElementId = activeContext()?.element?.id || '';
    state.open = false;
    state.fullscreen = false;
    document.querySelector('.uplink-css-studio-shell').hidden = true;
    document.querySelector('#uplink-css-studio-launcher')?.classList.remove('is-active');
    document.querySelector('#bricks-preview')?.classList.remove('uplink-css-studio-dock-open');
    document.querySelector('#bricks-preview')?.classList.remove('uplink-css-studio-dock-minimized');
    document.querySelector('#bricks-preview')?.classList.remove('uplink-css-studio-studio-fullscreen');
    if (state.pendingWrite) flushSync();
    else clearTimeout(state.timer);
    clearValueDecorations();
    clearPseudoPreview();
    closePopovers();
  }

  function toggleMinimize() {
    const shell = document.querySelector('.uplink-css-studio-shell');
    const preview = document.querySelector('#bricks-preview');
    const button = document.querySelector('.uplink-css-studio-minimize');
    if (!shell || !preview || !button) return;
    if (state.fullscreen) {
      state.preFullscreenMinimized = false;
      exitFullscreen();
    }
    state.minimized = !state.minimized;
    state.prefs.minimized = state.minimized;
    savePrefs();
    shell.classList.toggle('is-minimized', state.minimized);
    preview.classList.toggle('uplink-css-studio-dock-minimized', state.minimized);
    button.innerHTML = icon(state.minimized ? 'restore' : 'minimize');
    button.setAttribute('aria-label', state.minimized ? 'Restore CSS Studio' : 'Minimize CSS Studio');
    button.dataset.tooltip = state.minimized ? 'Restore editor' : 'Minimize';
    closePopovers();
    if (!state.minimized) requestAnimationFrame(() => { state.editor.refresh(); state.editor.focus(); });
  }

  function updateFullscreenButton() {
    const button = document.querySelector('.uplink-css-studio-fullscreen');
    if (!button) return;
    button.innerHTML = icon(state.fullscreen ? 'exitFullscreen' : 'fullscreen');
    button.setAttribute('aria-label', state.fullscreen ? 'Exit full-screen editor' : 'Open full-screen editor');
    button.setAttribute('aria-pressed', state.fullscreen ? 'true' : 'false');
    button.dataset.tooltip = state.fullscreen ? 'Exit full screen' : 'Full-screen editor';
  }

  function exitFullscreen() {
    const shell = document.querySelector('.uplink-css-studio-shell');
    const preview = document.querySelector('#bricks-preview');
    if (!shell || !preview || !state.fullscreen) return;
    state.fullscreen = false;
    state.minimized = state.preFullscreenMinimized;
    shell.classList.remove('is-fullscreen');
    shell.classList.toggle('is-minimized', state.minimized);
    preview.classList.remove('uplink-css-studio-studio-fullscreen');
    preview.classList.toggle('uplink-css-studio-dock-minimized', state.minimized);
    updateFullscreenButton();
    closePopovers();
    requestAnimationFrame(() => { state.editor.refresh(); if (!state.minimized) state.editor.focus(); });
  }

  function toggleFullscreen() {
    const shell = document.querySelector('.uplink-css-studio-shell');
    const preview = document.querySelector('#bricks-preview');
    if (!shell || !preview) return;
    if (state.fullscreen) { exitFullscreen(); return; }
    state.preFullscreenMinimized = state.minimized;
    state.fullscreen = true;
    state.minimized = false;
    shell.classList.remove('is-minimized');
    shell.classList.add('is-fullscreen');
    preview.classList.remove('uplink-css-studio-dock-minimized');
    preview.classList.add('uplink-css-studio-studio-fullscreen');
    updateFullscreenButton();
    closePopovers();
    requestAnimationFrame(() => { state.editor.refresh(); state.editor.focus(); });
  }

  function refreshContext() {
    promoteNativeCssGroup();
    mountCanvasResizers();
    let next = activeContext();
    if (syncAutomaticElementLabel(next)) next = activeContext();
    const nextElementId = next?.element?.id || '';
    if (!state.open) {
      const changed = Boolean(nextElementId && nextElementId !== state.lastObservedElementId);
      if (state.prefs.autoOpen && changed && nextElementId !== state.dismissedElementId) open();
      if (!nextElementId) state.dismissedElementId = '';
      state.lastObservedElementId = nextElementId;
      return;
    }
    state.lastObservedElementId = nextElementId;
    const current = state.context;
    const signature = contextSignature(next);
    const currentSignature = contextSignature(current);
    if (signature !== currentSignature) {
      setContext(next);
      return;
    }
    syncEditorFromBricks(next);
  }

  function promoteNativeCssGroup() {
    const group = document.querySelector('#bricks-panel-element .control-groups > [data-control-group="_css"]');
    const list = group?.parentElement;
    if (!group || !list) return;
    const firstGroup = list.querySelector(':scope > [data-control-group]');
    if (firstGroup && firstGroup !== group) list.insertBefore(group, firstGroup);
  }

  function mountCanvasResizers() {
    const handles = document.querySelector('.uplink-css-studio-canvas-resizers');
    if (!handles) return;
    if (!state.prefs.viewportHandles) {
      handles.hidden = true;
      return;
    }
    const wrapper = document.querySelector('#bricks-builder-iframe-wrapper');
    if (!wrapper) {
      handles.hidden = true;
      return;
    }
    if (handles.parentNode !== document.body) document.body.appendChild(handles);
    handles.hidden = false;
    syncCanvasResizerGeometry();
  }

  function syncCanvasResizerGeometry() {
    const wrapper = document.querySelector('#bricks-builder-iframe-wrapper');
    const preview = document.querySelector('#bricks-preview');
    const shell = document.querySelector('.uplink-css-studio-shell');
    const handles = document.querySelector('.uplink-css-studio-canvas-resizers');
    if (!wrapper || !handles || handles.hidden) return;
    const rect = wrapper.getBoundingClientRect();
    const previewRect = preview?.getBoundingClientRect();
    let visibleTop = Math.max(rect.top, previewRect?.top ?? rect.top);
    let visibleBottom = Math.min(rect.bottom, previewRect?.bottom ?? rect.bottom);
    if (state.open && shell && !shell.hidden) {
      const shellRect = shell.getBoundingClientRect();
      if (shellRect.height && shellRect.top > visibleTop) visibleBottom = Math.min(visibleBottom, shellRect.top);
    }
    if (visibleBottom <= visibleTop) {
      visibleTop = rect.top;
      visibleBottom = rect.bottom;
    }
    const visibleCenterY = visibleTop + (visibleBottom - visibleTop) / 2;
    const positions = {
      left: [rect.left, visibleCenterY],
      right: [rect.right, visibleCenterY],
    };
    Object.entries(positions).forEach(([edge, point]) => {
      const handle = handles.querySelector(`[data-canvas-resize="${edge}"]`);
      if (!handle) return;
      handle.style.left = `${point[0]}px`;
      handle.style.top = `${point[1]}px`;
    });
  }

  function setNativePreviewDimension(input, value, commit = false) {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const nextValue = String(Math.round(value));
    if (valueSetter) valueSetter.call(input, nextValue);
    else input.value = nextValue;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: nextValue }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, composed: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, composed: true }));
    if (commit) input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function bindCanvasResizers() {
    const handles = document.querySelector('.uplink-css-studio-canvas-resizers');
    window.addEventListener('resize', syncCanvasResizerGeometry, { passive: true });
    handles.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest('[data-canvas-resize]');
      if (!handle || event.button !== 0) return;
      const edge = handle.dataset.canvasResize;
      if (edge !== 'left' && edge !== 'right') return;
      const input = document.querySelector('#preview-width');
      const scaleInput = document.querySelector('#preview-scale');
      const wrapper = document.querySelector('#bricks-builder-iframe-wrapper');
      if (!input || !wrapper) return;
      event.preventDefault();
      event.stopPropagation();

      const pointerId = event.pointerId;
      const startRect = wrapper.getBoundingClientRect();
      const startValue = Number.parseFloat(input.value) || startRect.width;
      const startScaleValue = Number.parseFloat(scaleInput?.value);
      const scale = startValue / Math.max(1, startRect.width);
      const centerX = startRect.left + startRect.width / 2;
      let pendingX = event.clientX;
      let frame = 0;

      document.body.classList.add('uplink-css-studio-canvas-resizing', 'uplink-css-studio-canvas-resizing-width');
      handle.classList.add('is-dragging');
      handle.setPointerCapture?.(pointerId);

      const applyDimension = (commit = false) => {
        frame = 0;
        const displaySize = Math.abs(pendingX - centerX) * 2;
        const value = Math.max(320, Math.min(2560, displaySize * scale));
        setNativePreviewDimension(input, value, commit);
        if (scaleInput && Number.isFinite(startScaleValue)) setNativePreviewDimension(scaleInput, startScaleValue, commit);
        requestAnimationFrame(syncCanvasResizerGeometry);
      };
      const onMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();
        pendingX = moveEvent.clientX;
        if (!frame) frame = requestAnimationFrame(() => applyDimension(false));
      };
      const onUp = (upEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        if (upEvent.type === 'pointerup') {
          pendingX = upEvent.clientX;
        }
        if (frame) cancelAnimationFrame(frame);
        applyDimension(true);
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        handle.classList.remove('is-dragging');
        document.body.classList.remove('uplink-css-studio-canvas-resizing', 'uplink-css-studio-canvas-resizing-width');
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  function bindResizer() {
    const handle = document.querySelector('.uplink-css-studio-resizer');
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const preview = document.querySelector('#bricks-preview');
      const shell = document.querySelector('.uplink-css-studio-shell');
      if (!preview || !shell) return;
      const pointerId = event.pointerId;
      const startRect = preview.getBoundingClientRect();
      const stableBottom = startRect.bottom;
      const minHeight = 280;
      const maxHeight = Math.max(minHeight, Math.floor(startRect.height * .72));
      let pendingY = event.clientY;
      let frame = 0;

      closePopovers();
      preview.classList.add('uplink-css-studio-is-resizing');
      document.body.classList.add('uplink-css-studio-is-resizing');
      handle.setPointerCapture?.(pointerId);

      const applyHeight = () => {
        frame = 0;
        const height = Math.max(minHeight, Math.min(maxHeight, stableBottom - pendingY));
        const value = `${Math.round(height)}px`;
        shell.style.setProperty('--uplink-css-studio-dock-height', value);
        preview.style.setProperty('--uplink-css-studio-dock-height', value);
      };
      const onMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();
        pendingY = moveEvent.clientY;
        if (!frame) frame = requestAnimationFrame(applyHeight);
      };
      const onUp = (upEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        if (upEvent.type === 'pointerup') pendingY = upEvent.clientY;
        if (frame) cancelAnimationFrame(frame);
        applyHeight();
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        preview.classList.remove('uplink-css-studio-is-resizing');
        document.body.classList.remove('uplink-css-studio-is-resizing');
        state.prefs.dockHeight = shell?.style.getPropertyValue('--uplink-css-studio-dock-height') || '';
        savePrefs();
        requestAnimationFrame(() => state.editor?.refresh());
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  function setContext(ctx) {
    if (state.forcedStates.size) clearPseudoPreview();
    state.context = ctx;
    state.pendingWrite = false;
    clearTimeout(state.timer);
    state.timer = null;
    const empty = document.querySelector('.uplink-css-studio-empty');
    if (!ctx) {
      destroyCssSyncManager();
      empty.hidden = false;
      state.applying = true; state.editor.setValue(''); state.applying = false;
      state.lastSyncedValue = '';
      renderBreadcrumbs(null);
      document.querySelector('.uplink-css-studio-breakpoint strong').textContent = '—';
      document.querySelector('.uplink-css-studio-state strong').textContent = '—';
      setStatus('Select an element to begin', '');
      renderOutline();
      refreshLayoutTools();
      return;
    }
    if (ctx.kind === 'Theme style') destroyCssSyncManager();
    else ensureCssSyncManager(ctx);
    empty.hidden = true;
    const signature = contextSignature(ctx);
    const storedValue = String(ctx.target.settings[ctx.key] || '');
    const cleanedStoredValue = ctx.kind === 'Theme style' ? storedValue : stripGeneratedAlignmentDefaults(storedValue);
    const value = String(toDisplayCss(ctx, cleanedStoredValue));
    if (!state.originals.has(signature)) state.originals.set(signature, value);
    state.original = state.originals.get(signature);
    state.applying = true; state.editor.setValue(value); state.applying = false;
    const removedAlignmentSetting = ctx.kind === 'Theme style' ? false : removeGeneratedAlignmentSettings(ctx);
    if (cleanedStoredValue !== storedValue || removedAlignmentSetting) {
      writeToBricks(false, { syncNativeControl: false });
    }
    state.lastSyncedValue = value;
    renderBreadcrumbs(ctx);
    document.querySelector('.uplink-css-studio-breakpoint strong').textContent = ctx.breakpoint;
    document.querySelector('.uplink-css-studio-state strong').textContent = ctx.variant ? `${ctx.pseudo} · ${ctx.variant}` : ctx.pseudo;
    document.querySelectorAll('.uplink-css-studio-window [data-context]').forEach((node) => {
      const required = node.dataset.context;
      node.hidden = required !== 'all' && !required.split(',').includes(ctx.elementType);
    });
    setStatus(`Editing ${ctx.key}`, 'synced');
    renderOutline();
    renderQueryOptions(state.queryType);
    renderTargetValues();
    updateCursorPosition();
    refreshLayoutTools();
    scheduleValueDecorations(true);
  }

  function onEditorChange() {
    if (state.applying || !state.context) return;
    state.pendingWrite = true;
    setStatus('Unsaved editor changes', 'dirty');
    clearTimeout(state.timer);
    state.timer = setTimeout(() => writeToBricks(false), 40);
    clearTimeout(state.outlineTimer);
    state.outlineTimer = setTimeout(() => renderOutline(document.querySelector('.uplink-css-studio-outline-search')?.value || ''), 120);
    scheduleValueDecorations();
    refreshLayoutTools();
  }

  const declarationLineActive = /^(\s*)([-a-zA-Z][\w-]*\s*:\s*[^;{}]+;?)(\s*)$/;
  const declarationLineDisabled = /^(\s*)\/\*\s*([-a-zA-Z][\w-]*\s*:\s*[^;{}]+;?)\s*\*\/(\s*)$/;
  const queryOperatorCycle = { '>': '<', '>=': '<=', '<': '>', '<=': '>=' };
  const anglePattern = /-?(?:\d+(?:\.\d*)?|\.\d+)(?:deg|rad|grad|turn)\b/gi;
  const numberPattern = /-?(?:\d+(?:\.\d*)?|\.\d+)(?:px|rem|em|%|vw|vh|svw|svh|dvw|dvh|vmin|vmax|ch|ex|lh|rlh|s|ms)?\b/gi;
  const easePattern = /cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)|\b(?:ease-in-out|ease-in|ease-out|ease|linear)\b/gi;
  const gradientPattern = /(?:repeating-)?(?:linear|radial|conic)-gradient\(/gi;
  const colorVariablePattern = /var\(/gi;
  const gradientDirectionPattern = /\bto\s+(?:(?:top|bottom)(?:\s+(?:left|right))?|(?:left|right)(?:\s+(?:top|bottom))?)\b/gi;
  const pseudoPattern = /:(?:hover|focus-visible|focus-within|focus|active)\b/gi;
  const colorTokenPattern = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\((?:[^()]|\([^()]*\))*\)|\b(?:transparent|currentcolor)\b/gi;

  function setNumericScrubbing(enabled) {
    state.prefs.numericScrubbing = Boolean(enabled);
    savePrefs();
    const input = document.querySelector('.uplink-css-studio-numeric-scrubbing');
    if (input) input.checked = state.prefs.numericScrubbing;
    scheduleValueDecorations(true);
    setStatus(`Numeric scrubbing ${state.prefs.numericScrubbing ? 'enabled' : 'disabled'}`, 'synced');
  }

  function toggleNumericScrubbing() {
    setNumericScrubbing(!state.prefs.numericScrubbing);
  }

  function toggleDeclarationAtLine(editor, line, gutter) {
    if (gutter !== 'uplink-css-studio-rule-gutter') return;
    const text = editor.getLine(line) || '';
    let replacement = '';
    if (declarationLineActive.test(text)) replacement = text.replace(declarationLineActive, '$1/* $2 */$3');
    else if (declarationLineDisabled.test(text)) replacement = text.replace(declarationLineDisabled, '$1$2$3');
    if (!replacement) return;
    editor.replaceRange(replacement, { line, ch: 0 }, { line, ch: text.length }, '+uplink-rule-toggle');
  }

  function declarationGutterMarker(active) {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = `uplink-css-studio-rule-toggle${active ? ' is-active' : ''}`;
    marker.setAttribute('aria-label', active ? 'Disable declaration' : 'Enable declaration');
    marker.title = active ? 'Disable declaration' : 'Enable declaration';
    marker.innerHTML = active ? '✓' : '';
    return marker;
  }

  function clearValueDecorations() {
    state.valueMarks.forEach((mark) => {
      try { mark.clear(); } catch (error) {}
    });
    state.valueMarks = [];
    state.valueTargets.clear();
    if (state.editor) state.editor.clearGutter('uplink-css-studio-rule-gutter');
  }

  function scheduleValueDecorations(immediate = false) {
    clearTimeout(state.decorationTimer);
    state.decorationTimer = setTimeout(refreshValueDecorations, immediate ? 0 : 90);
  }

  function balancedFunctionEnd(text, start) {
    const open = text.indexOf('(', start);
    if (open === -1) return -1;
    let depth = 0;
    let quote = '';
    for (let index = open; index < text.length; index += 1) {
      const character = text[index];
      if (quote) {
        if (character === '\\') index += 1;
        else if (character === quote) quote = '';
        continue;
      }
      if (character === '"' || character === "'") { quote = character; continue; }
      if (character === '(') depth += 1;
      else if (character === ')' && --depth === 0) return index + 1;
    }
    return -1;
  }

  function addValueTarget(kind, line, start, end, value, extra = {}) {
    if (!state.editor || end <= start) return;
    const token = state.editor.getTokenAt({ line, ch: Math.min(end, start + 1) });
    if (/comment|string/.test(token.type || '')) return;
    const id = String(++state.valueTargetSequence);
    const className = `uplink-css-studio-value-token uplink-css-studio-value-${kind}${extra.active ? ' is-active' : ''}`;
    const title = extra.title || ({
      number: 'Drag to change value', angle: 'Edit angle', ease: 'Edit easing', color: 'Edit color',
      shadow: 'Edit shadow', gradient: 'Edit gradient', pseudo: 'Preview pseudo-state', operator: 'Flip comparison operator'
    }[kind] || 'Edit value');
    const mark = state.editor.markText(
      { line, ch: start },
      { line, ch: end },
      { className, attributes: { 'data-uplink-value-id': id, role: 'button', tabindex: '0', title } }
    );
    state.valueMarks.push(mark);
    state.valueTargets.set(id, Object.assign({ id, kind, line, start, end, value, mark }, extra));
  }

  function overlapsRange(ranges, start, end) {
    return ranges.some((range) => start < range[1] && end > range[0]);
  }

  function gradientDirectionAt(text, start) {
    const source = String(text || '');
    const before = source.slice(0, start);
    const matches = [...before.matchAll(/(?:repeating-)?(linear|conic)-gradient\(/gi)];
    const match = matches.pop();
    if (!match) return false;
    const open = match.index + match[0].length;
    return !source.slice(open, start).includes(',');
  }

  function refreshValueDecorations() {
    if (!state.editor || !state.open || state.applying) return;
    clearValueDecorations();
    state.editor.operation(() => {
      for (let line = 0; line < state.editor.lineCount(); line += 1) {
        const text = state.editor.getLine(line) || '';
        if (declarationLineActive.test(text)) state.editor.setGutterMarker(line, 'uplink-css-studio-rule-gutter', declarationGutterMarker(true));
        else if (declarationLineDisabled.test(text)) state.editor.setGutterMarker(line, 'uplink-css-studio-rule-gutter', declarationGutterMarker(false));
        if (!text || text.length > 1200 || /^\s*\/\*/.test(text)) continue;
        const occupied = [];
        const reserve = (kind, start, end, value, extra) => {
          if (overlapsRange(occupied, start, end)) return;
          occupied.push([start, end]);
          addValueTarget(kind, line, start, end, value, extra);
        };

        gradientPattern.lastIndex = 0;
        let match;
        while ((match = gradientPattern.exec(text))) {
          const end = balancedFunctionEnd(text, match.index);
          if (end > match.index) {
            const nameEnd = match.index + match[0].length - 1;
            reserve('gradient', match.index, nameEnd, text.slice(match.index, end), { replaceStart: match.index, replaceEnd: end });
          }
        }

        const shadow = text.match(/^\s*(box-shadow|text-shadow)\s*:\s*(.+?);?\s*$/i);
        if (shadow) {
          const value = shadow[2].replace(/;\s*$/, '').trim();
          const start = text.indexOf(value, text.indexOf(':') + 1);
          reserve('shadow', start, start + value.length, value, { property: shadow[1].toLowerCase() });
        }

        easePattern.lastIndex = 0;
        while ((match = easePattern.exec(text))) reserve('ease', match.index, match.index + match[0].length, match[0]);

        pseudoPattern.lastIndex = 0;
        while ((match = pseudoPattern.exec(text))) {
          const stateName = match[0].slice(1);
          reserve('pseudo', match.index, match.index + match[0].length, match[0], { stateName, active: state.forcedStates.has(stateName) });
        }

        if (/@(media|container)\b/i.test(text)) {
          const operatorPattern = /<=|>=|<|>/g;
          while ((match = operatorPattern.exec(text))) reserve('operator', match.index, match.index + match[0].length, match[0]);
        }

        // Reserve the complete var() first so a fallback such as #2563eb does not
        // become a separate, competing color target inside the variable token.
        colorVariablePattern.lastIndex = 0;
        while ((match = colorVariablePattern.exec(text))) {
          const end = balancedFunctionEnd(text, match.index);
          if (end <= match.index) continue;
          const value = text.slice(match.index, end);
          const preview = resolveColorPreview(value);
          if (preview && window.CSS?.supports?.('color', preview)) reserve('color', match.index, end, value, { resolved: preview });
        }
        colorTokenPattern.lastIndex = 0;
        while ((match = colorTokenPattern.exec(text))) {
          if (window.CSS?.supports?.('color', match[0])) reserve('color', match.index, match.index + match[0].length, match[0]);
        }
        gradientDirectionPattern.lastIndex = 0;
        while ((match = gradientDirectionPattern.exec(text))) {
          if (gradientDirectionAt(text, match.index)) reserve('angle', match.index, match.index + match[0].length, match[0], { gradientDirection: true });
        }
        anglePattern.lastIndex = 0;
        while ((match = anglePattern.exec(text))) reserve('angle', match.index, match.index + match[0].length, match[0], { gradientDirection: gradientDirectionAt(text, match.index) });
        if (state.prefs.numericScrubbing) {
          numberPattern.lastIndex = 0;
          while ((match = numberPattern.exec(text))) reserve('number', match.index, match.index + match[0].length, match[0]);
        }
      }
    });
  }

  function valueTargetFromEvent(event) {
    const element = event.target?.closest?.('[data-uplink-value-id]');
    return element ? state.valueTargets.get(element.dataset.uplinkValueId) : null;
  }

  function replaceValueTarget(target, value, origin = '+uplink-value-tool') {
    if (!state.editor || !target) return;
    const found = target.mark?.find?.();
    const explicitRange = Number.isFinite(target.replaceStart) && Number.isFinite(target.replaceEnd);
    const from = explicitRange ? { line: target.line, ch: target.replaceStart } : (found?.from || { line: target.line, ch: target.start });
    const to = explicitRange ? { line: target.line, ch: target.replaceEnd } : (found?.to || { line: target.line, ch: target.end });
    state.editor.replaceRange(value, from, to, origin);
    if (explicitRange) target.replaceEnd = target.replaceStart + value.length;
    target.line = from.line;
    target.start = from.ch;
    target.end = from.ch + value.length;
    target.value = value;
    scheduleValueDecorations();
  }

  function handleValuePointerDown(event) {
    const target = valueTargetFromEvent(event);
    if (!target || target.kind !== 'number' || !state.prefs.numericScrubbing || event.button !== 0) return;
    const parsed = String(target.value).match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))([a-z%]*)$/i);
    if (!parsed) return;
    event.preventDefault();
    event.stopPropagation();
    state.scrub = {
      target,
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: Number(parsed[1]),
      unit: parsed[2] || '',
      decimals: (parsed[1].split('.')[1] || '').length,
      lastValue: target.value
    };
    event.target.setPointerCapture?.(event.pointerId);
    document.body.classList.add('uplink-css-studio-is-scrubbing');
    document.addEventListener('pointermove', scrubNumericValue, true);
    document.addEventListener('pointerup', finishNumericScrub, true);
  }

  function scrubNumericValue(event) {
    const scrub = state.scrub;
    if (!scrub || event.pointerId !== scrub.pointerId) return;
    event.preventDefault();
    const fine = event.altKey ? 0.1 : 1;
    const step = event.shiftKey ? fine * 10 : fine;
    const delta = Math.round((event.clientX - scrub.startX) / 3) * step;
    const decimals = event.altKey ? Math.max(1, scrub.decimals) : scrub.decimals;
    const number = Number((scrub.startValue + delta).toFixed(Math.min(4, decimals)));
    const value = `${number}${scrub.unit}`;
    if (value === scrub.lastValue) return;
    const target = scrub.target;
    const from = { line: target.line, ch: target.start };
    const to = { line: target.line, ch: target.end };
    state.editor.replaceRange(value, from, to, '+uplink-scrub');
    target.end = target.start + value.length;
    target.value = value;
    scrub.lastValue = value;
  }

  function finishNumericScrub(event) {
    if (!state.scrub || event.pointerId !== state.scrub.pointerId) return;
    state.scrub = null;
    document.body.classList.remove('uplink-css-studio-is-scrubbing');
    document.removeEventListener('pointermove', scrubNumericValue, true);
    document.removeEventListener('pointerup', finishNumericScrub, true);
    scheduleValueDecorations(true);
  }

  function handleValueClick(event) {
    const target = valueTargetFromEvent(event);
    if (!target || target.kind === 'number') return;
    event.preventDefault();
    event.stopPropagation();
    target.anchor = event.target.closest('[data-uplink-value-id]');
    if (target.kind === 'operator') {
      replaceValueTarget(target, queryOperatorCycle[target.value] || '>');
      return;
    }
    if (target.kind === 'pseudo') {
      togglePseudoPreview(target.stateName);
      return;
    }
    if (target.kind === 'color') {
      state.valueToolTarget = target;
      openColorToken(target.value);
      return;
    }
    openValuePanel(target);
  }

  function writeToBricks(explicit, options = {}) {
    const ctx = state.context;
    if (!ctx) return;
    const value = state.editor.getValue();
    const storedValue = setContextCssValue(ctx, value);

    const unsavedKey = ctx.kind === 'Theme style' ? 'themeStyles' : (ctx.kind === 'Class' ? 'activeClass' : (ctx.s.activeComponent ? 'components' : 'content'));
    ctx.s.unsavedChanges = Array.isArray(ctx.s.unsavedChanges) ? ctx.s.unsavedChanges : [];
    if (!ctx.s.unsavedChanges.includes(unsavedKey)) ctx.s.unsavedChanges.push(unsavedKey);
    if (ctx.kind === 'Class') {
      const id = ctx.target.id;
      ctx.s.globalChanges = ctx.s.globalChanges || {};
      ctx.s.globalChanges.modified = Array.isArray(ctx.s.globalChanges.modified) ? ctx.s.globalChanges.modified : [];
      if (id && !ctx.s.globalChanges.modified.includes(id)) ctx.s.globalChanges.modified.push(id);
      if (ctx.proxy.$_markActiveClassDirty) ctx.proxy.$_markActiveClassDirty(id);
    }
    if (ctx.kind === 'Theme style' && ctx.themeStyleId) {
      const themeStyle = ctx.s.themeStyles?.[ctx.themeStyleId];
      if (themeStyle) {
        themeStyle.settings = themeStyle.settings && !Array.isArray(themeStyle.settings) ? themeStyle.settings : {};
        themeStyle.settings.css = ctx.target.settings;
        if (ctx.s.themeStyleActiveId === ctx.themeStyleId) ctx.s.themeStyleSettings = themeStyle.settings;
      }
    }
    state.pendingWrite = false;
    state.timer = null;
    state.lastSyncedValue = value;
    state.ignoreExternalUntil = Date.now() + 160;
    if (options.syncNativeControl !== false && ctx.kind !== 'Theme style') syncBricksCssControls(storedValue, explicit);
    if (options.renderCanvas !== false) requestCanvasRender(ctx);
    renderBreadcrumbs(ctx);
    setStatus(explicit ? 'Synced now' : 'Live synced', 'synced');
  }

  function flushSync() {
    clearTimeout(state.timer);
    if (state.context) writeToBricks(true);
  }

  function syncEditorFromBricks(ctx) {
    if (!ctx || !state.editor) return;
    state.context = ctx;
    renderBreadcrumbs(ctx);
    const storedValue = String(ctx.target.settings[ctx.key] || '');
    const cleanedStoredValue = ctx.kind === 'Theme style' ? storedValue : stripGeneratedAlignmentDefaults(storedValue);
    const removedAlignmentSetting = ctx.kind === 'Theme style' ? false : removeGeneratedAlignmentSettings(ctx);
    const removedGeneratedDefault = cleanedStoredValue !== storedValue || removedAlignmentSetting;
    const value = String(toDisplayCss(ctx, cleanedStoredValue));
    if (state.pendingWrite || Date.now() < state.ignoreExternalUntil) return;
    if (value === state.editor.getValue()) {
      if (removedGeneratedDefault) {
        writeToBricks(false, { syncNativeControl: false });
        setStatus('Removed generated align-items default', 'synced');
      }
      return;
    }

    // Bricks can edit a working class clone until blur. Keep the canonical class
    // current while preserving Bricks' stored selector form.
    mirrorClassCssValue(ctx, cleanedStoredValue);
    requestCanvasRender(ctx);

    const doc = state.editor.getDoc();
    const cursor = doc.getCursor();
    const scroll = state.editor.getScrollInfo();
    state.applying = true;
    doc.setValue(value);
    state.applying = false;
    if (removedGeneratedDefault) writeToBricks(false, { syncNativeControl: false });
    const line = Math.min(cursor.line, Math.max(0, doc.lineCount() - 1));
    const ch = Math.min(cursor.ch, doc.getLine(line).length);
    doc.setCursor({ line, ch });
    state.editor.scrollTo(scroll.left, scroll.top);
    state.lastSyncedValue = value;
    setStatus(removedGeneratedDefault ? 'Removed generated align-items default' : 'Updated from Bricks', 'synced');
    renderOutline(document.querySelector('.uplink-css-studio-outline-search')?.value || '');
    updateCursorPosition();
    refreshLayoutTools();
    scheduleValueDecorations(true);
  }

  function setContextCssValue(ctx, value) {
    const contextValue = toStoredCss(ctx, value);
    const storedValue = ctx.kind === 'Theme style' ? contextValue : stripGeneratedAlignmentDefaults(contextValue);
    const apply = (target) => {
      if (!target) return;
      target.settings = target.settings && !Array.isArray(target.settings) ? target.settings : {};
      if (storedValue.trim()) target.settings[ctx.key] = storedValue;
      else delete target.settings[ctx.key];
    };

    apply(ctx.target);
    mirrorClassCssValue(ctx, storedValue);
    return storedValue;
  }

  function cssWithoutCommentsAndStrings(source) {
    const chars = String(source || '').split('');
    let quote = '';
    let comment = false;
    let escaped = false;
    for (let index = 0; index < chars.length; index += 1) {
      const char = source[index];
      const next = source[index + 1] || '';
      if (comment) {
        if (char !== '\n') chars[index] = ' ';
        if (char === '*' && next === '/') {
          chars[index + 1] = ' ';
          comment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (char !== '\n') chars[index] = ' ';
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '/' && next === '*') {
        chars[index] = ' ';
        chars[index + 1] = ' ';
        comment = true;
        index += 1;
        continue;
      }
      if (char === '"' || char === "'") {
        chars[index] = ' ';
        quote = char;
      }
    }
    return chars.join('');
  }

  function stripGeneratedAlignmentDefaults(css) {
    const source = String(css || '');
    const masked = cssWithoutCommentsAndStrings(source);
    const pattern = /(^|[;{])([ \t\r\n]*)align-items\s*:\s*initial[ \t]*;?(?:[ \t]*(?:\r\n|\r|\n))?/gi;
    const replacements = [];
    let match;
    while ((match = pattern.exec(masked))) {
      const whitespace = match[2] || '';
      const lastNewline = Math.max(whitespace.lastIndexOf('\n'), whitespace.lastIndexOf('\r'));
      replacements.push({
        start: match.index + match[1].length,
        end: match.index + match[0].length,
        text: lastNewline === -1 ? whitespace : whitespace.slice(0, lastNewline + 1)
      });
      if (!match[0].length) pattern.lastIndex += 1;
    }
    return replacements.sort((a, b) => b.start - a.start).reduce(
      (value, replacement) => value.slice(0, replacement.start) + replacement.text + value.slice(replacement.end),
      source
    );
  }

  function removeGeneratedAlignmentSettings(ctx) {
    const targets = [ctx?.target];
    if (ctx?.kind === 'Class' && ctx.target?.id) {
      targets.push((ctx.s.globalClasses || []).find((item) => item?.id === ctx.target.id));
      if (ctx.s.activeClass?.id === ctx.target.id) targets.push(ctx.s.activeClass);
    }
    let removed = false;
    [...new Set(targets.filter(Boolean))].forEach((target) => {
      if (!target.settings || Array.isArray(target.settings)) return;
      Object.keys(target.settings).forEach((key) => {
        if (!/^_alignItems(?::|$)/.test(key) || String(target.settings[key]).trim() !== 'initial') return;
        delete target.settings[key];
        removed = true;
      });
    });
    return removed;
  }

  function mirrorClassCssValue(ctx, storedValue) {
    if (ctx.kind === 'Class' && ctx.target.id) {
      const canonical = (ctx.s.globalClasses || []).find((item) => item && item.id === ctx.target.id);
      const applyStored = (target) => {
        if (!target || target === ctx.target) return;
        target.settings = target.settings && !Array.isArray(target.settings) ? target.settings : {};
        if (storedValue.trim()) target.settings[ctx.key] = storedValue;
        else delete target.settings[ctx.key];
      };
      applyStored(canonical);
      if (ctx.s.activeClass?.id === ctx.target.id) applyStored(ctx.s.activeClass);
    }
  }

  function bricksCssSyncFactory() {
    if (typeof bricksCssSyncFactoryCache === 'function') return bricksCssSyncFactoryCache;
    const chunks = window.webpackChunkbricks;
    if (!Array.isArray(chunks)) return null;
    let webpackRequire;
    try {
      chunks.push([[`uplink-css-studio-css-sync-${Date.now()}`], {}, (runtime) => { webpackRequire = runtime; }]);
      const cssSyncModule = webpackRequire?.(15000);
      if (typeof cssSyncModule?.vK === 'function') bricksCssSyncFactoryCache = cssSyncModule.vK;
    } catch (error) {
      bricksCssSyncFactoryCache = undefined;
    }
    return typeof bricksCssSyncFactoryCache === 'function' ? bricksCssSyncFactoryCache : null;
  }

  function destroyCssSyncManager() {
    state.cssSyncManager?.destroy?.();
    state.cssSyncManager = null;
    state.cssSyncSignature = '';
    state.cssSyncReady = false;
    state.cssSyncPending = null;
  }

  function ensureCssSyncManager(ctx = state.context) {
    if (!ctx || ctx.kind === 'Theme style') { destroyCssSyncManager(); return null; }
    const signature = contextSignature(ctx);
    if (state.cssSyncManager && state.cssSyncSignature === signature) return state.cssSyncManager;
    destroyCssSyncManager();
    const factory = bricksCssSyncFactory();
    if (!factory) return null;
    const target = ctx.target;
    const manager = factory({
      state: ctx.s,
      getSettings: () => target.settings,
      getElementName: () => String(ctx.element?.name || ''),
      getCssId: () => contextRootSelector(ctx, null),
      replaceRoot: (from, to, css) => replaceContextRoot(ctx, from, to, css),
      refreshControls: () => { ctx.s.cssSyncControlRefresh = Date.now(); }
    });
    state.cssSyncManager = manager;
    state.cssSyncSignature = signature;
    Promise.resolve(manager.init?.()).then(() => {
      if (state.cssSyncManager !== manager) return;
      state.cssSyncReady = Boolean(manager.isActive?.());
      const pending = state.cssSyncPending;
      state.cssSyncPending = null;
      if (state.cssSyncReady && pending) manager.flushCssInput?.(pending.value);
    }).catch(() => {
      if (state.cssSyncManager === manager) destroyCssSyncManager();
    });
    return manager;
  }

  function syncBricksCssControls(storedValue, explicit) {
    const control = nativeCssControl();
    let manager = control?.cssSyncManager;
    if (!manager?.isActive?.()) manager = ensureCssSyncManager();
    if (!manager) return;
    if (!manager.isActive?.()) {
      state.cssSyncPending = { value: storedValue, explicit: Boolean(explicit) };
      return;
    }
    clearTimeout(state.nativeSyncTimer);
    state.nativeSyncTimer = null;
    const usingNativeControl = Boolean(control && control.cssSyncManager === manager);
    if (usingNativeControl) control.cssSyncHasPendingChanges = false;
    if (explicit && manager.flushCssInput) {
      manager.flushCssInput(storedValue);
      return;
    }
    if (manager.handleCssInput) manager.handleCssInput(storedValue);
    if (manager.flushCssInput) {
      state.nativeSyncTimer = setTimeout(() => {
        state.nativeSyncTimer = null;
        if (usingNativeControl) {
          const currentControl = nativeCssControl();
          if (currentControl !== control || currentControl?.cssSyncManager !== manager) return;
          control.cssSyncHasPendingChanges = false;
        } else if (state.cssSyncManager !== manager) return;
        if (!manager.isActive?.()) return;
        manager.flushCssInput(storedValue);
        requestCanvasRender();
      }, 140);
    }
  }

  function requestCanvasRender(ctx = state.context) {
    if (!ctx?.s) return;
    state.renderSequence += 1;
    ctx.s.forceRender = `${Date.now()}:${state.renderSequence}`;
  }

  function revert() {
    if (!state.context) return;
    const original = state.originals.get(contextSignature(state.context)) ?? state.original;
    state.applying = true; state.editor.setValue(original); state.applying = false;
    writeToBricks(true);
    refreshLayoutTools();
    setTimeout(refreshLayoutTools, 150);
    setStatus('Reverted', 'synced');
  }

  function insertDeclarations(css, options = {}) {
    const editor = state.editor;
    const shouldFocus = options.focus !== false;
    const selection = editor.getSelection();
    if (selection) editor.replaceSelection(css);
    else {
      const doc = editor.getDoc();
      const source = doc.getValue();
      if (!source.trim()) {
        const indented = css.split('\n').map((line) => line ? `  ${line}` : '').join('\n');
        doc.setValue(`%root% {\n${indented}\n}`);
        doc.setCursor(Math.max(1, doc.lineCount() - 1), 0);
        if (shouldFocus) editor.focus();
        return;
      }
      const cursor = doc.getCursor();
      const cursorIndex = doc.indexFromPos(cursor);
      const activeOpen = source.lastIndexOf('{', cursorIndex);
      const activeClose = source.indexOf('}', cursorIndex);
      let insertIndex = activeOpen !== -1 && activeClose !== -1 && activeOpen < cursorIndex ? activeClose : firstBlockEnd(source);
      if (insertIndex !== -1) {
        const indented = css.split('\n').map((line) => line ? `  ${line}` : '').join('\n');
        const prefix = source.slice(0, insertIndex).endsWith('\n') ? '' : '\n';
        doc.replaceRange(`${prefix}${indented}\n`, doc.posFromIndex(insertIndex));
      } else {
        doc.replaceRange((cursor.ch ? '\n' : '') + css + '\n', cursor);
      }
    }
    if (shouldFocus) editor.focus();
  }

  function selectorBlockForLayout(source, cursorIndex) {
    const active = openBlocksAt(source, cursorIndex)
      .filter((block) => block.prelude && !block.prelude.startsWith('@'))
      .pop();
    if (active) {
      const close = matchingBrace(source, active.open);
      if (close !== -1) return { ...active, close };
    }

    let quote = '';
    let comment = false;
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1] || '';
      if (comment) {
        if (char === '*' && next === '/') { comment = false; index += 1; }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '/' && next === '*') { comment = true; index += 1; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char !== '{') continue;
      const boundary = Math.max(source.lastIndexOf('{', index - 1), source.lastIndexOf('}', index - 1), source.lastIndexOf(';', index - 1));
      const prelude = source.slice(boundary + 1, index).trim();
      if (!prelude || prelude.startsWith('@')) continue;
      const close = matchingBrace(source, index);
      if (close !== -1) return { open: index, close, prelude };
    }
    return null;
  }

  function maskNestedCss(body) {
    const chars = body.split('');
    let depth = 0;
    let quote = '';
    let comment = false;
    let escaped = false;
    for (let index = 0; index < chars.length; index += 1) {
      const char = body[index];
      const next = body[index + 1] || '';
      if (comment) {
        if (char !== '\n') chars[index] = ' ';
        if (char === '*' && next === '/') {
          chars[index] = ' ';
          chars[index + 1] = ' ';
          comment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (char !== '\n') chars[index] = ' ';
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '/' && next === '*') {
        chars[index] = ' ';
        chars[index + 1] = ' ';
        comment = true;
        index += 1;
        continue;
      }
      if (char === '"' || char === "'") {
        chars[index] = ' ';
        quote = char;
        continue;
      }
      if (char === '{') { depth += 1; chars[index] = ' '; continue; }
      if (char === '}') { depth = Math.max(0, depth - 1); chars[index] = ' '; continue; }
      if (depth && char !== '\n') chars[index] = ' ';
    }
    return chars.join('');
  }

  function directDeclarations(body) {
    const masked = maskNestedCss(body);
    const declarations = new Map();
    const pattern = /(^|[;\n])([ \t]*)([-_a-zA-Z][\w-]*)\s*:\s*([^;{}]*)(;?)/gm;
    let match;
    while ((match = pattern.exec(masked))) {
      const property = match[3].toLowerCase();
      const leadingLength = match[1].length + match[2].length;
      declarations.set(property, {
        property,
        value: match[4].trim(),
        start: match.index + leadingLength,
        end: match.index + match[0].length
      });
      if (!match[0].length) pattern.lastIndex += 1;
    }
    return declarations;
  }

  function declarationsAtLayoutContext() {
    if (!state.editor) return new Map();
    const doc = state.editor.getDoc();
    const source = doc.getValue();
    const block = selectorBlockForLayout(source, doc.indexFromPos(doc.getCursor()));
    return block ? directDeclarations(source.slice(block.open + 1, block.close)) : new Map();
  }

  function computedLayoutContext() {
    const ctx = state.context;
    if (!ctx?.element?.id) return {};
    let frameDocument = state.canvasDocument;
    if (!frameDocument) {
      const frame = document.querySelector('#bricks-builder-iframe, #bricks-preview iframe');
      try { frameDocument = frame?.contentDocument; } catch (error) { frameDocument = null; }
    }
    if (!frameDocument) return {};
    const id = String(ctx.element.id);
    const node = frameDocument.querySelector(`[data-id="${id}"]`)
      || frameDocument.querySelector(`#brxe-${id}`)
      || frameDocument.querySelector(`.brxe-${id}`);
    if (!node) return {};
    const view = frameDocument.defaultView;
    const style = view?.getComputedStyle?.(node);
    if (!style) return {};
    return {
      display: style.display,
      'flex-direction': style.flexDirection,
      'justify-content': style.justifyContent,
      'justify-items': style.justifyItems,
      'align-items': style.alignItems,
      'place-items': style.placeItems,
      'grid-template-columns': style.gridTemplateColumns,
      'grid-template-rows': style.gridTemplateRows
    };
  }

  function layoutContextValue(declarations, computed, property, fallback = '') {
    return declarations.get(property)?.value || computed[property] || fallback;
  }

  function upsertLayoutDeclarations(declarations, options = {}) {
    if (!state.editor || !declarations || !Object.keys(declarations).length) return;
    const shouldFocus = options.focus !== false;
    const doc = state.editor.getDoc();
    let source = doc.getValue();
    if (!source.trim()) {
      const lines = Object.entries(declarations)
        .filter(([, value]) => String(value || '').trim())
        .map(([property, value]) => `  ${property}: ${value};`)
        .join('\n');
      if (!lines) return;
      doc.setValue(`%root% {\n${lines}\n}`);
      doc.setCursor({ line: Math.max(1, doc.lineCount() - 1), ch: 0 });
      if (shouldFocus) state.editor.focus();
      return;
    }

    const block = selectorBlockForLayout(source, doc.indexFromPos(doc.getCursor()));
    if (!block) {
      const css = Object.entries(declarations)
        .filter(([, value]) => String(value || '').trim())
        .map(([property, value]) => `${property}: ${value};`)
        .join('\n');
      if (css) insertDeclarations(css, options);
      return;
    }

    let body = source.slice(block.open + 1, block.close);
    const current = directDeclarations(body);
    const replacements = [];
    const missing = [];
    Object.entries(declarations).forEach(([property, value]) => {
      const cleanValue = String(value || '').trim();
      const existing = current.get(property);
      if (existing) replacements.push({ start: existing.start, end: existing.end, text: cleanValue ? `${property}: ${cleanValue};` : '' });
      else if (cleanValue) missing.push([property, cleanValue]);
    });
    replacements.sort((a, b) => b.start - a.start).forEach((replacement) => {
      body = body.slice(0, replacement.start) + replacement.text + body.slice(replacement.end);
    });

    if (missing.length) {
      const openLine = source.slice(0, block.open).split('\n').pop() || '';
      const baseIndent = (openLine.match(/^\s*/) || [''])[0];
      const indent = `${baseIndent}  `;
      const lines = missing.map(([property, value]) => `${indent}${property}: ${value};`).join('\n');
      if (!body.trim()) body = `\n${lines}\n${baseIndent}`;
      else {
        const core = body.replace(/\s*$/, '');
        body = `${core}${core.endsWith('\n') ? '' : '\n'}${lines}\n${baseIndent}`;
      }
    }

    doc.replaceRange(body, doc.posFromIndex(block.open + 1), doc.posFromIndex(block.close), 'layout-preset');
    if (shouldFocus) state.editor.focus();
    refreshLayoutTools();
  }

  function applyLayoutPreset(preset, remove = false) {
    const declarations = layoutPresets[preset];
    if (!declarations) return;
    const values = remove
      ? Object.fromEntries(Object.keys(declarations).map((property) => [property, '']))
      : declarations;
    upsertLayoutDeclarations(values);
    if (!remove && declarations.display) syncNativeSelectControl('_display', declarations.display);
  }

  function syncNativeSelectControl(controlKey, value) {
    const marker = document.querySelector(`[control-key="${controlKey}"]`);
    const control = marker?.closest?.('[data-control="select"]');
    if (!control || control.querySelector('.input-value')?.textContent?.trim() === value) return;
    const option = [...control.querySelectorAll('.dropdown li')]
      .find((item) => item.textContent.trim() === value);
    option?.click();
  }

  function syncNativeGridTemplateInputs(declarations, attempt = 0) {
    const ids = {
      'grid-template-columns': '_gridTemplateColumns',
      'grid-template-rows': '_gridTemplateRows'
    };
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    let waitingForControl = false;
    state.syncingNativeLayoutInput = true;
    try {
      Object.entries(declarations).forEach(([property, value]) => {
        const input = document.getElementById(ids[property]);
        if (!input) {
          waitingForControl = true;
          return;
        }
        const nextValue = String(value || '');
        if (input.value === nextValue) return;
        if (valueSetter) valueSetter.call(input, nextValue);
        else input.value = nextValue;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: nextValue }));
      });
    } finally {
      state.syncingNativeLayoutInput = false;
    }
    if (waitingForControl && attempt < 6) {
      setTimeout(() => syncNativeGridTemplateInputs(declarations, attempt + 1), 50 * (attempt + 1));
    }
  }

  function normalizeAlignmentValue(value) {
    if (value === 'flex-start') return 'start';
    if (value === 'flex-end') return 'end';
    return value;
  }

  function alignmentIconName(orientation, value) {
    const suffix = value === 'center' ? 'Center' : value === 'end' ? 'End' : 'Start';
    return `align${orientation}${suffix}`;
  }

  function applyPlaceAlignment(value, remove = false) {
    const declarations = declarationsAtLayoutContext();
    const computed = computedLayoutContext();
    const display = layoutContextValue(declarations, computed, 'display');
    if (/grid/.test(display)) upsertLayoutDeclarations(remove
      ? { 'place-items': '', 'justify-items': '', 'align-items': '' }
      : { 'place-items': value });
    else if (/flex/.test(display)) upsertLayoutDeclarations({ 'justify-content': remove ? '' : value, 'align-items': remove ? '' : value });
    refreshLayoutTools();
  }

  function refreshLayoutTools() {
    if (!state.editor) return;
    const declarations = declarationsAtLayoutContext();
    const computed = computedLayoutContext();
    const display = layoutContextValue(declarations, computed, 'display');
    const direction = layoutContextValue(declarations, computed, 'flex-direction', 'row');
    const placeItems = layoutContextValue(declarations, computed, 'place-items');
    const justifyContent = layoutContextValue(declarations, computed, 'justify-content');
    const justifyItems = layoutContextValue(declarations, computed, 'justify-items');
    const alignItems = layoutContextValue(declarations, computed, 'align-items');
    const declaredDisplay = declarations.get('display')?.value || '';
    const declaredDirection = declarations.get('flex-direction')?.value || 'row';
    const active = {
      block: declaredDisplay === 'block',
      'flex-row': /flex/.test(declaredDisplay) && !/^column/.test(declaredDirection),
      'flex-column': /flex/.test(declaredDisplay) && /^column/.test(declaredDirection),
      grid: /grid/.test(declaredDisplay)
    };
    document.querySelectorAll('[data-layout-preset]').forEach((button) => {
      const pressed = Boolean(active[button.dataset.layoutPreset]);
      button.classList.toggle('is-active', pressed);
      button.setAttribute('aria-pressed', String(pressed));
    });
    const blockButton = document.querySelector('.uplink-css-studio-display-block');
    if (blockButton) {
      const elementName = String(state.context?.element?.name || '').toLowerCase();
      blockButton.hidden = !state.context || /^(section|container)$/.test(elementName);
    }

    const layoutType = /grid/.test(display) ? 'grid' : /flex/.test(display) ? 'flex' : '';
    const gridTemplateTools = document.querySelector('.uplink-css-studio-grid-template-tools');
    if (gridTemplateTools) gridTemplateTools.hidden = layoutType !== 'grid';
    document.querySelectorAll('[data-grid-template]').forEach((button) => {
      const property = button.dataset.gridTemplate === 'rows' ? 'grid-template-rows' : 'grid-template-columns';
      const value = declarations.get(property)?.value || '';
      const pressed = layoutType === 'grid' && Boolean(value) && value !== 'none';
      button.classList.toggle('is-active', pressed);
      button.setAttribute('aria-pressed', String(pressed));
    });
    const alignmentTools = document.querySelector('.uplink-css-studio-alignment-tools');
    if (alignmentTools) alignmentTools.hidden = !layoutType;
    const flexColumn = layoutType === 'flex' && /^column/.test(direction);
    document.querySelectorAll('[data-alignment-axis]').forEach((button) => {
      const axis = button.dataset.alignmentAxis;
      const property = axis === 'main'
        ? (layoutType === 'grid' ? 'justify-items' : 'justify-content')
        : 'align-items';
      const orientation = layoutType === 'grid'
        ? (axis === 'main' ? 'H' : 'V')
        : (axis === 'main') === !flexColumn ? 'H' : 'V';
      const axisLabel = layoutType === 'grid'
        ? (axis === 'main' ? 'Inline axis' : 'Block axis')
        : (axis === 'main' ? 'Main axis' : 'Cross axis');
      const value = button.dataset.alignmentValue;
      button.dataset.alignmentProperty = property;
      button.innerHTML = icon(alignmentIconName(orientation, value));
      button.setAttribute('aria-label', `${axisLabel}: ${value}`);
      button.dataset.tooltip = `${axisLabel}: ${value} · ${property}`;
      const shorthandValue = layoutType === 'grid' && declarations.has('place-items')
        ? normalizeAlignmentValue(placeItems.split(/\s+/)[axis === 'main' ? 1 : 0] || placeItems.split(/\s+/)[0])
        : '';
      const current = shorthandValue || normalizeAlignmentValue(declarations.get(property)?.value || '');
      const pressed = current === button.dataset.alignmentValue;
      button.classList.toggle('is-active', pressed);
      button.setAttribute('aria-pressed', String(pressed));
    });
    const placeButton = document.querySelector('[data-place-value]');
    if (placeButton) {
      const enabled = Boolean(layoutType);
      const centered = layoutType === 'grid'
        ? normalizeAlignmentValue(declarations.get('place-items')?.value || '') === 'center'
          || (normalizeAlignmentValue(declarations.get('justify-items')?.value || '') === 'center' && normalizeAlignmentValue(declarations.get('align-items')?.value || '') === 'center')
        : layoutType === 'flex'
          && normalizeAlignmentValue(declarations.get('justify-content')?.value || '') === 'center'
          && normalizeAlignmentValue(declarations.get('align-items')?.value || '') === 'center';
      placeButton.disabled = !enabled;
      placeButton.classList.toggle('is-active', centered);
      placeButton.setAttribute('aria-pressed', String(centered));
    }
  }

  function firstBlockEnd(source) {
    const open = source.indexOf('{');
    if (open === -1) return -1;
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}') depth -= 1;
      if (depth === 0) return index;
    }
    return -1;
  }

  function insertRule(css) {
    const doc = state.editor.getDoc();
    const source = doc.getValue().trimEnd();
    const startLine = source ? source.split('\n').length + 1 : 0;
    doc.setValue(source ? `${source}\n\n${css}\n` : `${css}\n`);
    const ruleLines = css.split('\n');
    const insideLine = ruleLines.findIndex((line) => /^\s+$/.test(line));
    if (insideLine >= 0) doc.setCursor({ line: startLine + insideLine, ch: ruleLines[insideLine].length });
    else doc.setCursor(doc.lineCount() - 1, 0);
    state.editor.focus();
  }

  function openBlocksAt(source, cursorIndex) {
    const stack = [];
    let quote = '';
    let comment = false;
    let escaped = false;
    let boundary = 0;
    for (let index = 0; index < Math.min(cursorIndex, source.length); index += 1) {
      const char = source[index];
      const next = source[index + 1] || '';
      if (comment) {
        if (char === '*' && next === '/') { comment = false; index += 1; }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '/' && next === '*') { comment = true; index += 1; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '{') {
        const prelude = source.slice(boundary, index).trim();
        stack.push({ open: index, prelude });
        boundary = index + 1;
      } else if (char === '}') {
        stack.pop();
        boundary = index + 1;
      } else if (char === ';') boundary = index + 1;
    }
    return stack;
  }

  function matchingBrace(source, openIndex) {
    let depth = 0;
    let quote = '';
    let comment = false;
    let escaped = false;
    for (let index = openIndex; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1] || '';
      if (comment) {
        if (char === '*' && next === '/') { comment = false; index += 1; }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '/' && next === '*') { comment = true; index += 1; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) return index;
    }
    return -1;
  }

  function insertStateSelector(selector) {
    const editor = state.editor;
    const doc = editor.getDoc();
    const source = doc.getValue();
    const cursorIndex = doc.indexFromPos(doc.getCursor());
    const blocks = openBlocksAt(source, cursorIndex);
    const insideSelector = blocks.some((block) => block.prelude && !block.prelude.startsWith('@'));
    if (!insideSelector) {
      insertRule(`%root%${selector} {\n  \n}`);
      return;
    }

    const container = blocks[blocks.length - 1];
    const closeIndex = matchingBrace(source, container.open);
    if (closeIndex === -1) {
      insertRule(`%root%${selector} {\n  \n}`);
      return;
    }

    const openLine = source.slice(0, container.open).split('\n').pop() || '';
    const baseIndent = (openLine.match(/^\s*/) || [''])[0];
    const indent = `${baseIndent}  `;
    const insertion = `${source.slice(0, closeIndex).endsWith('\n') ? '' : '\n'}${indent}&${selector} {\n${indent}  \n${indent}}\n`;
    doc.replaceRange(insertion, doc.posFromIndex(closeIndex));
    const caretIndex = closeIndex + insertion.indexOf('\n', insertion.indexOf('{')) + 1 + indent.length + 2;
    doc.setCursor(doc.posFromIndex(caretIndex));
    editor.focus();
  }

  function insertNestedRule(selector) {
    const editor = state.editor;
    const doc = editor.getDoc();
    const source = doc.getValue();
    const cursorIndex = doc.indexFromPos(doc.getCursor());
    const container = openBlocksAt(source, cursorIndex).reverse().find((block) => block.prelude && !block.prelude.startsWith('@'));
    if (!container) {
      insertRule(`%root% {\n  ${selector} {\n    \n  }\n}`);
      return;
    }

    const closeIndex = matchingBrace(source, container.open);
    if (closeIndex === -1) return;
    const openLine = source.slice(0, container.open).split('\n').pop() || '';
    const baseIndent = (openLine.match(/^\s*/) || [''])[0];
    const indent = `${baseIndent}  `;
    const innerIndent = `${indent}  `;
    const insertion = `${source.slice(0, closeIndex).endsWith('\n') ? '' : '\n'}${indent}${selector} {\n${innerIndent}\n${indent}}\n`;
    doc.replaceRange(insertion, doc.posFromIndex(closeIndex));
    const caretIndex = closeIndex + insertion.indexOf('\n', insertion.indexOf('{')) + 1 + innerIndent.length;
    doc.setCursor(doc.posFromIndex(caretIndex));
    editor.focus();
  }

  function insertRecipe(recipe) {
    const recipes = { selector: '%root%:hover {\n  \n}' };
    if (recipe === 'parent') { insertNestedRule(':has(> &)'); return; }
    if (recipe === 'selector') { insertStateSelector(':hover'); return; }
    insertRule(recipes[recipe] || '');
  }

  function togglePopover(name) {
    const panel = document.querySelector(`.uplink-css-studio-${name}-panel`);
    const button = document.querySelector(`.uplink-css-studio-${name}-toggle`);
    if (!panel || !button) return;
    hideTooltip();
    const willOpen = panel.hidden;
    closePopovers();
    if (willOpen) {
      panel.scrollTop = 0;
      panel.hidden = false;
      button.classList.add('is-active');
      button.setAttribute('aria-expanded', 'true');
      state.activePopover = { panel, button };
      requestAnimationFrame(positionActivePopover);
      if (name === 'outline') {
        renderOutline(document.querySelector('.uplink-css-studio-outline-search').value);
        requestAnimationFrame(() => document.querySelector('.uplink-css-studio-outline-search').focus());
      } else if (name === 'recipes') {
        toggleRecipeEditor(false);
      }
    }
  }

  function togglePreferences() {
    const autoOpen = document.querySelector('.uplink-css-studio-auto-open');
    const firstAppliedClass = document.querySelector('.uplink-css-studio-first-class');
    const viewportHandles = document.querySelector('.uplink-css-studio-viewport-handles');
    const numericScrubbing = document.querySelector('.uplink-css-studio-numeric-scrubbing');
    if (autoOpen) autoOpen.checked = Boolean(state.prefs.autoOpen);
    if (firstAppliedClass) firstAppliedClass.checked = Boolean(state.prefs.firstAppliedClass);
    if (viewportHandles) viewportHandles.checked = Boolean(state.prefs.viewportHandles);
    if (numericScrubbing) numericScrubbing.checked = Boolean(state.prefs.numericScrubbing);
    togglePopover('preferences');
  }

  function toggleOutline() { togglePopover('outline'); }

  function renderTargetValues() {
    const settings = state.context?.element?.settings || {};
    const classInput = document.querySelector('.uplink-css-studio-class-input');
    const idInput = document.querySelector('.uplink-css-studio-id-input');
    const classNames = (Array.isArray(settings._cssGlobalClasses) ? settings._cssGlobalClasses : [])
      .map((id) => state.context?.s?.globalClasses?.find((item) => item.id === id)?.name)
      .filter(Boolean);
    if (classInput) classInput.value = classNames.join(' ');
    if (idInput) idInput.value = String(settings._cssId || '');
  }

  function toggleTargetsPanel() {
    const panel = document.querySelector('.uplink-css-studio-targets-panel');
    const button = document.querySelector('.uplink-css-studio-targets-toggle');
    if (!panel || !button) return;
    hideTooltip();
    const willOpen = panel.hidden;
    closePopovers();
    if (willOpen) {
      renderTargetValues();
      panel.hidden = false;
      button.classList.add('is-active');
      state.activePopover = { panel, button };
      requestAnimationFrame(positionActivePopover);
    }
  }

  function markElementDirty(message) {
    const ctx = state.context;
    if (!ctx) return;
    ctx.s.unsavedChanges = Array.isArray(ctx.s.unsavedChanges) ? ctx.s.unsavedChanges : [];
    if (!ctx.s.unsavedChanges.includes('content')) ctx.s.unsavedChanges.push('content');
    requestCanvasRender(ctx);
    ctx.s.cssSyncControlRefresh = Date.now();
    setStatus(message, 'synced');
  }

  function applyTargetOnEnter(event, action) {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  function leaveSiteWideContext() {
    if (!state.siteWideContext) return;
    if (state.pendingWrite) writeToBricks(true);
    state.siteWideContext = null;
    const next = activeContext();
    if (next) setContext(next);
  }

  function assignClassTarget() {
    leaveSiteWideContext();
    const ctx = state.context;
    if (!ctx) return;
    const input = document.querySelector('.uplink-css-studio-class-input');
    const name = normalizeClassName(String(input?.value || '').split(/\s+/).filter(Boolean).pop() || '');
    if (!name) { setStatus('Enter a class name', 'dirty'); return; }
    ctx.s.globalClasses = Array.isArray(ctx.s.globalClasses) ? ctx.s.globalClasses : [];
    let globalClass = ctx.s.globalClasses.find((item) => item && item.name === name);
    const created = !globalClass;
    const requiredPermission = created ? 'create_global_classes' : 'assign_unassign_global_classes';
    if (ctx.proxy.$_userHasPermission && !ctx.proxy.$_userHasPermission(requiredPermission)) {
      setStatus(`Your Bricks role cannot ${created ? 'create' : 'assign'} global classes`, 'dirty');
      return;
    }
    if (!globalClass) {
      const id = generateClassId(ctx);
      globalClass = { id, name, settings: { _cssCustom: rootRule } };
      ctx.s.globalClasses.push(globalClass);
      ctx.s.globalChanges = ctx.s.globalChanges || {};
      ctx.s.globalChanges.added = Array.isArray(ctx.s.globalChanges.added) ? ctx.s.globalChanges.added : [];
      if (!ctx.s.globalChanges.added.includes(id)) ctx.s.globalChanges.added.push(id);
      if (ctx.proxy.$_postMessage) ctx.proxy.$_postMessage({ key: 'globalClassesNew', value: JSON.stringify([globalClass]) });
    } else {
      globalClass.settings = globalClass.settings && !Array.isArray(globalClass.settings) ? globalClass.settings : {};
      if (!String(globalClass.settings._cssCustom || '').trim()) globalClass.settings._cssCustom = rootRule;
    }

    const assignedIds = Array.isArray(ctx.element.settings._cssGlobalClasses) ? ctx.element.settings._cssGlobalClasses : [];
    if (!assignedIds.includes(globalClass.id)) assignedIds.push(globalClass.id);
    ctx.element.settings._cssGlobalClasses = assignedIds;
    ctx.s.globalClassesSelected = ctx.s.globalClassesSelected || {};
    ctx.s.globalClassesSelected[ctx.element.id] = globalClass.id;
    ctx.s.activeSelector = undefined;
    ctx.s.pseudoClassActive = '';
    ctx.s.activeClass = ctx.proxy.$_clone ? ctx.proxy.$_clone(globalClass) : globalClass;
    ctx.s.activeClass.settings = ctx.s.activeClass.settings && !Array.isArray(ctx.s.activeClass.settings) ? ctx.s.activeClass.settings : {};
    if (!String(ctx.s.activeClass.settings._cssCustom || '').trim()) ctx.s.activeClass.settings._cssCustom = rootRule;
    markElementDirty(`${created ? 'Created' : 'Attached'} .${name}`);
    setTimeout(() => {
      const next = activeContext();
      const classContext = next && next.kind === 'Class' ? next : Object.assign({}, ctx, {
        target: ctx.s.activeClass,
        kind: 'Class',
        label: name,
        key: '_cssCustom',
        pseudo: 'base'
      });
      classContext.target.settings = classContext.target.settings && !Array.isArray(classContext.target.settings) ? classContext.target.settings : {};
      const insertedRoot = !String(classContext.target.settings._cssCustom || '').trim();
      if (insertedRoot) classContext.target.settings._cssCustom = rootRule;
      setContext(classContext);
      if (!String(state.editor.getValue() || '').trim()) {
        state.applying = true;
        state.editor.setValue(rootRule);
        state.applying = false;
      }
      if (created || insertedRoot || state.editor.getValue().trim() === rootRule.trim()) {
        state.editor.setCursor({ line: 1, ch: 2 });
        writeToBricks(false);
      }
      state.editor.focus();
    }, 0);
    closePopovers();
  }

  function normalizeClassName(value) {
    return String(value || '')
      .trim()
      .replace(/^\./, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }

  function generateClassId(ctx) {
    const existing = new Set((ctx.s.globalClasses || []).map((item) => item.id));
    let id = '';
    do {
      id = ctx.proxy.$_generateId ? ctx.proxy.$_generateId() : Math.random().toString(36).slice(2, 8);
    } while (!id || existing.has(id));
    return id;
  }

  function assignIdTarget() {
    leaveSiteWideContext();
    const ctx = state.context;
    if (!ctx) return;
    const input = document.querySelector('.uplink-css-studio-id-input');
    const id = String(input?.value || '').replace(/^#/, '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id) { setStatus('Enter an ID', 'dirty'); return; }
    ctx.element.settings._cssId = id;
    if (input) input.value = id;
    markElementDirty(`Assigned #${id}`);
    insertRule('%root% {\n  \n}');
    closePopovers();
  }

  function nativeStyleManagerTrigger() {
    const selectors = [
      '[aria-label="Style Manager"]',
      '[aria-label="Open Style Manager"]',
      '[data-tooltip="Style Manager"]',
      '[data-balloon="Style Manager"]',
      '[title="Style Manager"]'
    ];
    for (const selector of selectors) {
      const trigger = [...document.querySelectorAll(selector)].find((item) => !item.closest('.uplink-css-studio-shell'));
      if (trigger) return trigger;
    }
    return [...document.querySelectorAll('button, [role="button"]')].find((item) => {
      if (item.closest('.uplink-css-studio-shell')) return false;
      const label = [item.getAttribute('aria-label'), item.getAttribute('title'), item.dataset?.tooltip, item.textContent]
        .filter(Boolean)
        .join(' ')
        .trim();
      return /(?:open\s+)?style manager/i.test(label);
    }) || null;
  }

  function openNativeStyleManager() {
    hideTooltip();
    closePopovers();
    if (state.pendingWrite) writeToBricks(true);
    if (state.fullscreen) exitFullscreen();
    requestAnimationFrame(() => {
      const trigger = nativeStyleManagerTrigger();
      if (trigger) {
        trigger.click();
        return;
      }
      const isMac = navigator.platform.toLowerCase().includes('mac');
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: '.',
        code: 'Period',
        metaKey: isMac,
        ctrlKey: !isMac,
        bubbles: true,
        cancelable: true
      }));
    });
  }

  function normalizeHtmlSelector(value) {
    const selectors = String(value || '')
      .split(',')
      .map((selector) => selector.trim().toLowerCase())
      .filter(Boolean);
    if (!selectors.length || selectors.some((selector) => !/^[a-z][a-z0-9-]*$/.test(selector))) return '';
    return [...new Set(selectors)].join(', ');
  }

  function themeStyleConditions(themeStyle) {
    const conditions = themeStyle?.settings?.conditions?.conditions;
    return Array.isArray(conditions) ? conditions : [];
  }

  function siteWideThemeStyle(ctx) {
    const styles = ctx?.s?.themeStyles || {};
    const siteWideIds = Object.keys(styles).filter((id) => themeStyleConditions(styles[id]).some((condition) => condition?.main === 'any'));
    if (!siteWideIds.length) return null;
    const activeIds = [ctx.s.themeStyleActiveId, ...(ctx.s.themeStyleActiveIds || [])].filter(Boolean);
    const id = activeIds.find((candidate) => siteWideIds.includes(candidate)) || siteWideIds[0];
    return { id, style: styles[id] };
  }

  function escapePattern(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function focusStylesheetSelector(selector) {
    if (!state.editor) return;
    const source = state.editor.getValue();
    const match = new RegExp(`(^|[}\\n]\\s*)${escapePattern(selector)}\\s*\\{`, 'm').exec(source);
    if (!match) return;
    const open = source.indexOf('{', match.index + match[1].length);
    const position = state.editor.posFromIndex(open + 1);
    state.editor.setCursor(position);
    state.editor.scrollIntoView(position, 100);
    state.editor.focus();
  }

  function openHtmlTarget() {
    const input = document.querySelector('.uplink-css-studio-html-input');
    const selector = normalizeHtmlSelector(input?.value);
    if (!selector) {
      setStatus('Enter an HTML tag such as address or dl', 'dirty');
      input?.focus();
      return;
    }
    if (input) input.value = selector;
    const ctx = state.context || activeContext();
    const themeStyleTarget = siteWideThemeStyle(ctx);
    if (!ctx || !themeStyleTarget) {
      setStatus('Create a site-wide Theme Style with an Any condition first', 'dirty');
      return;
    }
    if (state.pendingWrite) writeToBricks(true);
    state.siteWideContext = { elementId: ctx.element.id, styleId: themeStyleTarget.id, selector };
    closePopovers();
    const themeContext = activeContext();
    if (!themeContext || themeContext.kind !== 'Theme style') {
      setStatus('Could not open the Theme Style stylesheet', 'dirty');
      return;
    }
    setContext(themeContext);
    const source = state.editor.getValue();
    const selectorPattern = new RegExp(`(^|[}\\n]\\s*)${escapePattern(selector)}\\s*\\{`, 'm');
    if (!selectorPattern.test(source)) {
      const prefix = source.trim() ? `${source.trimEnd()}\n\n` : '';
      state.editor.setValue(`${prefix}${selector} {\n  \n}`);
    }
    requestAnimationFrame(() => focusStylesheetSelector(selector));
    setStatus(`Editing ${themeStyleTarget.style.label || themeStyleTarget.id} Theme Style`, 'synced');
  }

  function toggleQueryPanel(type) {
    const panel = document.querySelector('.uplink-css-studio-query-panel');
    const button = document.querySelector(`.uplink-css-studio-${type}-toggle`);
    if (!panel || !button) return;
    hideTooltip();
    const willOpen = panel.hidden || state.queryType !== type;
    closePopovers();
    state.queryType = type;
    if (willOpen) {
      panel.hidden = false;
      button.classList.add('is-active');
      state.activePopover = { panel, button };
      requestAnimationFrame(positionActivePopover);
      renderQueryOptions(type);
      const list = panel.querySelector('.uplink-css-studio-query-list');
      if (list) list.scrollTop = 0;
    }
  }

  function positionActivePopover() {
    const active = state.activePopover;
    if (!active || active.panel.hidden || !active.panel.isConnected || !active.button.isConnected) return;
    if (active.manual) {
      const rect = active.panel.getBoundingClientRect();
      const gutter = 8;
      const left = Math.max(gutter, Math.min(window.innerWidth - rect.width - gutter, rect.left));
      const top = Math.max(gutter, Math.min(window.innerHeight - rect.height - gutter, rect.top));
      active.panel.style.left = `${Math.round(left)}px`;
      active.panel.style.top = `${Math.round(top)}px`;
      active.panel.style.right = 'auto';
      active.panel.style.bottom = 'auto';
      return;
    }
    const buttonRect = active.button.getBoundingClientRect();
    active.panel.style.left = '0px';
    active.panel.style.right = 'auto';
    active.panel.style.top = '0px';
    active.panel.style.bottom = 'auto';
    active.panel.style.height = 'auto';
    active.panel.style.maxHeight = `${Math.max(140, window.innerHeight - 20)}px`;
    const panelRect = active.panel.getBoundingClientRect();
    const gutter = 10;
    const gap = 8;
    if (active.parentPanel?.isConnected && !active.parentPanel.hidden) {
      const parentRect = active.parentPanel.getBoundingClientRect();
      const inset = 8;
      const availableHeight = Math.max(180, parentRect.height - inset * 2);
      active.panel.style.maxWidth = `${Math.max(280, parentRect.width - inset * 2)}px`;
      active.panel.style.maxHeight = `${availableHeight}px`;
      const nestedRect = active.panel.getBoundingClientRect();
      const minLeft = parentRect.left + inset;
      const maxLeft = Math.max(minLeft, parentRect.right - nestedRect.width - inset);
      const left = Math.max(minLeft, Math.min(maxLeft, buttonRect.left + buttonRect.width / 2 - nestedRect.width / 2));
      const minTop = parentRect.top + inset;
      const maxTop = Math.max(minTop, parentRect.bottom - Math.min(nestedRect.height, availableHeight) - inset);
      const preferredTop = buttonRect.bottom + gap + nestedRect.height <= parentRect.bottom - inset
        ? buttonRect.bottom + gap
        : buttonRect.top - gap - nestedRect.height;
      active.panel.style.left = `${Math.round(left)}px`;
      active.panel.style.top = `${Math.round(Math.max(minTop, Math.min(maxTop, preferredTop)))}px`;
      active.panel.style.height = 'auto';
      active.panel.dataset.placement = 'nested';
      return;
    }
    active.panel.style.maxWidth = '';
    const spaceAbove = Math.max(0, buttonRect.top - gap - gutter);
    const spaceBelow = Math.max(0, window.innerHeight - buttonRect.bottom - gap - gutter);
    const desiredHeight = Math.min(active.panel.scrollHeight || panelRect.height, window.innerHeight - gutter * 2);
    const placeBelow = spaceBelow >= Math.min(desiredHeight, 240) || spaceBelow >= spaceAbove;
    const availableHeight = Math.max(140, placeBelow ? spaceBelow : spaceAbove);
    const renderedHeight = Math.min(desiredHeight, availableHeight);
    const desiredLeft = buttonRect.left + buttonRect.width / 2 - panelRect.width / 2;
    const maxLeft = Math.max(gutter, window.innerWidth - panelRect.width - gutter);
    const left = Math.max(gutter, Math.min(maxLeft, desiredLeft));
    const top = placeBelow
      ? buttonRect.bottom + gap
      : Math.max(gutter, buttonRect.top - gap - renderedHeight);
    active.panel.style.left = `${Math.round(left)}px`;
    active.panel.style.right = 'auto';
    active.panel.style.top = `${Math.round(top)}px`;
    active.panel.style.bottom = 'auto';
    active.panel.style.maxHeight = `${Math.round(availableHeight)}px`;
    const recipeEditorOpen = active.panel.classList.contains('uplink-css-studio-recipes-panel')
      && !active.panel.querySelector('.uplink-css-studio-recipe-editor')?.hidden;
    active.panel.style.height = recipeEditorOpen ? `${Math.round(Math.min(524, availableHeight))}px` : 'auto';
    active.panel.dataset.placement = placeBelow ? 'bottom' : 'top';
  }

  function beginPopoverDrag(event) {
    if (event.button !== 0 || state.popoverDrag) return;
    const head = event.target.closest('.uplink-css-studio-popover-head');
    const panel = head?.closest('.uplink-css-studio-popover');
    if (!head || !panel || panel.hidden || event.target.closest('button, input, select, textarea, a, [contenteditable="true"]')) return;
    const rect = panel.getBoundingClientRect();
    state.popoverDrag = {
      panel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height
    };
    panel.style.left = `${Math.round(rect.left)}px`;
    panel.style.top = `${Math.round(rect.top)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.classList.add('is-dragging', 'is-user-positioned');
    if (state.activePopover?.panel === panel) state.activePopover.manual = true;
    head.setPointerCapture?.(event.pointerId);
    document.addEventListener('pointermove', movePopoverDrag, true);
    document.addEventListener('pointerup', endPopoverDrag, true);
    document.addEventListener('pointercancel', endPopoverDrag, true);
    event.preventDefault();
  }

  function movePopoverDrag(event) {
    const drag = state.popoverDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const gutter = 8;
    const maxLeft = Math.max(gutter, window.innerWidth - drag.width - gutter);
    const maxTop = Math.max(gutter, window.innerHeight - drag.height - gutter);
    const left = Math.max(gutter, Math.min(maxLeft, drag.startLeft + event.clientX - drag.startX));
    const top = Math.max(gutter, Math.min(maxTop, drag.startTop + event.clientY - drag.startY));
    drag.panel.style.left = `${Math.round(left)}px`;
    drag.panel.style.top = `${Math.round(top)}px`;
  }

  function endPopoverDrag(event) {
    const drag = state.popoverDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.panel.classList.remove('is-dragging');
    state.popoverDrag = null;
    document.removeEventListener('pointermove', movePopoverDrag, true);
    document.removeEventListener('pointerup', endPopoverDrag, true);
    document.removeEventListener('pointercancel', endPopoverDrag, true);
  }

  function closePopovers() {
    if (state.popoverDrag) endPopoverDrag({ pointerId: state.popoverDrag.pointerId });
    document.querySelectorAll('.uplink-css-studio-popover').forEach((panel) => { panel.hidden = true; });
    document.querySelectorAll('.uplink-css-studio-popover').forEach((panel) => panel.classList.remove('is-dragging', 'is-user-positioned'));
    document.querySelectorAll('.uplink-css-studio-outline-toggle, .uplink-css-studio-recipes-toggle, .uplink-css-studio-shortcut-category, .uplink-css-studio-colors-toggle, .uplink-css-studio-targets-toggle, .uplink-css-studio-media-toggle, .uplink-css-studio-container-toggle, .uplink-css-studio-states-toggle, .uplink-css-studio-preferences-toggle').forEach((button) => {
      button.classList.remove('is-active');
      if (button.hasAttribute('aria-expanded')) button.setAttribute('aria-expanded', 'false');
    });
    state.activePopover = null;
    state.valueToolTarget = null;
    state.colorApplyHandler = null;
    state.colorReturnPopover = null;
    document.querySelector('.uplink-css-studio-colors-panel')?.classList.remove('is-nested-color');
  }

  function registeredBreakpoints() {
    const seen = new Set();
    return (state.context?.s?.breakpoints || [])
      .map((item) => ({
        label: item.label || item.name || item.key || 'Breakpoint',
        width: Number(item.width || item.value || item.maxWidth || item.minWidth || 0),
        base: Boolean(item.base)
      }))
      .filter((item) => item.width > 0 && !seen.has(item.width) && seen.add(item.width))
      .sort((a, b) => a.width - b.width);
  }

  function renderQueryOptions(type = 'media') {
    const list = document.querySelector('.uplink-css-studio-query-list');
    const title = document.querySelector('.uplink-css-studio-query-title');
    const context = document.querySelector('.uplink-css-studio-query-context');
    if (!list) return;
    const breakpoints = registeredBreakpoints();
    const feature = type === 'container' ? 'inline-size' : 'width';
    if (title) title.textContent = type === 'container' ? 'Container queries' : 'Media queries';
    if (context) context.textContent = feature;
    if (!breakpoints.length) {
      list.innerHTML = '<div class="uplink-css-studio-outline-empty">No breakpoints with numeric widths are registered in Bricks.</div>';
      return;
    }
    const singles = [...breakpoints].reverse().map((item) => `
      <div class="uplink-css-studio-query-row">
        <span><strong>${escapeHtml(item.label)}</strong><small>${item.width}px</small></span>
        <span class="uplink-css-studio-query-actions">
          <button type="button" data-query-kind="${type}" data-query-mode="lte" data-query-high="${item.width}" aria-label="At or below ${escapeAttr(item.label)}, ${item.width} pixels" data-tooltip="${feature} ≤ ${item.width}px">${icon('queryBelow')}</button>
          <button type="button" data-query-kind="${type}" data-query-mode="gte" data-query-low="${item.width}" aria-label="At or above ${escapeAttr(item.label)}, ${item.width} pixels" data-tooltip="${feature} ≥ ${item.width}px">${icon('queryAbove')}</button>
        </span>
      </div>`).join('');
    const ranges = breakpoints.slice(0, -1).map((item, index) => {
      const next = breakpoints[index + 1];
      return `<button class="uplink-css-studio-range-row" type="button" data-query-kind="${type}" data-query-mode="between" data-query-low="${item.width}" data-query-high="${next.width}" aria-label="Between ${escapeAttr(item.label)} and ${escapeAttr(next.label)}" data-tooltip="${item.width}px ≤ ${feature} ≤ ${next.width}px">
        <span><strong>${escapeHtml(item.label)} – ${escapeHtml(next.label)}</strong><small>${item.width}–${next.width}px</small></span>${icon('queryBetween')}
      </button>`;
    }).join('');
    list.innerHTML = `<div class="uplink-css-studio-query-section"><span>Breakpoint</span>${singles}</div>
      <div class="uplink-css-studio-query-section"><span>Between</span>${ranges || '<div class="uplink-css-studio-outline-empty">Add another breakpoint to create a range.</div>'}</div>`;
  }

  function insertQueryRule(kind, mode, low, high) {
    const atRule = kind === 'container' ? '@container' : '@media';
    const feature = kind === 'container' ? 'inline-size' : 'width';
    let condition = '';
    if (mode === 'between' && Number.isFinite(low) && Number.isFinite(high)) condition = `${low}px <= ${feature} <= ${high}px`;
    else if (mode === 'gte' && Number.isFinite(low)) condition = `${feature} >= ${low}px`;
    else if (mode === 'lte' && Number.isFinite(high)) condition = `${feature} <= ${high}px`;
    if (!condition) return;

    const editor = state.editor;
    const doc = editor.getDoc();
    const source = doc.getValue();
    const cursorIndex = doc.indexFromPos(doc.getCursor());
    const selectorBlock = openBlocksAt(source, cursorIndex)
      .reverse()
      .find((block) => block.prelude && !block.prelude.startsWith('@'));

    if (!selectorBlock) {
      insertRule(`${atRule} (${condition}) {\n  %root% {\n    \n  }\n}`);
      return;
    }

    const closeIndex = matchingBrace(source, selectorBlock.open);
    if (closeIndex === -1) return;
    const openLine = source.slice(0, selectorBlock.open).split('\n').pop() || '';
    const baseIndent = (openLine.match(/^\s*/) || [''])[0];
    const indent = `${baseIndent}  `;
    const innerIndent = `${indent}  `;
    const insertion = `${source.slice(0, closeIndex).endsWith('\n') ? '' : '\n'}${indent}${atRule} (${condition}) {\n${innerIndent}\n${indent}}\n`;
    doc.replaceRange(insertion, doc.posFromIndex(closeIndex));
    const caretIndex = closeIndex + insertion.indexOf('\n', insertion.indexOf('{')) + 1 + innerIndent.length;
    doc.setCursor(doc.posFromIndex(caretIndex));
    editor.focus();
  }

  function outlineItems() {
    if (!state.editor) return [];
    const items = [];
    state.editor.getValue().split('\n').forEach((line, index) => {
      const match = line.match(/\/\*\s*(#{1,6})\s+(.+?)\s*\*\//);
      if (match) items.push({ depth: match[1].length, label: match[2].trim(), line: index });
    });
    return items;
  }

  function renderOutline(query = '') {
    const list = document.querySelector('.uplink-css-studio-outline-list');
    const count = document.querySelector('.uplink-css-studio-outline-count');
    if (!list || !count) return;
    const all = outlineItems();
    const term = String(query).trim().toLowerCase();
    const visible = term ? all.filter((item) => item.label.toLowerCase().includes(term)) : all;
    count.textContent = String(all.length);
    if (!all.length) {
      list.innerHTML = '<div class="uplink-css-studio-outline-guide"><strong>Add outline headings in comments</strong><code>/* # Section */</code><code>/* ## Subsection */</code></div>';
      return;
    }
    if (!visible.length) {
      list.innerHTML = '<div class="uplink-css-studio-outline-empty">No matching headings</div>';
      return;
    }
    list.innerHTML = visible.map((item) => `
      <button class="uplink-css-studio-outline-item" type="button" data-line="${item.line}" style="--outline-depth:${item.depth}">
        <span>${escapeHtml(item.label)}</span><small>${item.line + 1}</small>
      </button>`).join('');
  }

  function jumpToLine(line) {
    if (!state.editor || !Number.isFinite(line)) return;
    if (state.highlightedLine !== null) state.editor.removeLineClass(state.highlightedLine, 'background', 'uplink-css-studio-outline-highlight');
    state.highlightedLine = Math.max(0, Math.min(line, state.editor.lineCount() - 1));
    state.editor.setCursor({ line: state.highlightedLine, ch: 0 });
    state.editor.scrollIntoView({ line: state.highlightedLine, ch: 0 }, 90);
    state.editor.addLineClass(state.highlightedLine, 'background', 'uplink-css-studio-outline-highlight');
    state.editor.focus();
    updateCursorPosition();
    setTimeout(() => {
      if (state.editor && state.highlightedLine !== null) state.editor.removeLineClass(state.highlightedLine, 'background', 'uplink-css-studio-outline-highlight');
      state.highlightedLine = null;
    }, 900);
  }

  function updateCursorPosition() {
    if (!state.editor) return;
    const cursor = state.editor.getCursor();
    const position = document.querySelector('.uplink-css-studio-position');
    if (position) position.textContent = `Ln ${cursor.line + 1}, Col ${cursor.ch + 1}`;
  }

  function formatCss() {
    const input = state.editor.getValue();
    const lines = [];
    let buffer = '';
    let indent = 0;
    let quote = '';
    let comment = false;
    let parens = 0;
    const push = (value, level = indent) => {
      const text = value.trim();
      if (text) lines.push(`${'  '.repeat(Math.max(0, level))}${text}`);
    };
    const flush = () => { push(buffer); buffer = ''; };

    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      const next = input[index + 1] || '';
      if (comment) {
        buffer += char;
        if (char === '*' && next === '/') {
          buffer += '/';
          index += 1;
          comment = false;
          flush();
        }
        continue;
      }
      if (quote) {
        buffer += char;
        if (char === '\\') {
          buffer += next;
          index += 1;
        } else if (char === quote) quote = '';
        continue;
      }
      if (char === '/' && next === '*') {
        if (buffer.trim()) flush();
        buffer = '/*';
        comment = true;
        index += 1;
        continue;
      }
      if (char === '"' || char === "'") { quote = char; buffer += char; continue; }
      if (char === '(' || char === '[') { parens += 1; buffer += char; continue; }
      if (char === ')' || char === ']') { parens = Math.max(0, parens - 1); buffer += char; continue; }
      if (!parens && char === '{') {
        push(`${buffer.trim()} {`);
        buffer = '';
        indent += 1;
        continue;
      }
      if (!parens && char === ';') {
        push(`${buffer.trim()};`);
        buffer = '';
        continue;
      }
      if (!parens && char === '}') {
        flush();
        indent = Math.max(0, indent - 1);
        push('}', indent);
        if (indent === 0 && lines[lines.length - 2] !== '') lines.push('');
        continue;
      }
      if (/\s/.test(char)) {
        if (buffer && !/\s$/.test(buffer)) buffer += ' ';
        continue;
      }
      buffer += char;
    }
    flush();
    const output = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const cursor = state.editor.getCursor();
    state.editor.operation(() => {
      state.editor.setValue(output ? `${output}\n` : '');
      state.editor.setCursor(Math.min(cursor.line, state.editor.lineCount() - 1), cursor.ch);
    });
    state.editor.focus();
    setStatus('CSS formatted', 'dirty');
  }

  function setStatus(text, mode) {
    const el = document.querySelector('.uplink-css-studio-status');
    el.textContent = text;
    el.className = 'uplink-css-studio-status' + (mode ? ` is-${mode}` : '');
  }
  function escapeHtml(value) { const d = document.createElement('div'); d.textContent = value == null ? '' : String(value); return d.innerHTML; }
  function escapeAttr(value) { return escapeHtml(value).replace(/"/g, '&quot;'); }

  function init() {
    if (!window.wp || !wp.codeEditor) return;
    buildUI();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(jQuery);
