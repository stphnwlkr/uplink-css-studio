=== Uplink CSS Studio for Bricks ===
Contributors: stphnwlkr
Tags: bricks, css, code editor, builder
Requires at least: 7.0
Tested up to: 7.1
Requires PHP: 8.3
Stable tag: 1.1.2
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A code-first CSS workspace inside Bricks with live sync, completion, visual value tools, recipes, and query helpers.

== Description ==

Uplink CSS Studio for Bricks adds an integrated CSS workspace to the Bricks builder. It keeps the native Bricks Custom CSS field as the source of truth while adding a larger editor, completion, recipes, design variables, visual value tools, and live canvas updates.

Bricks 2.4 or newer is required, and Bricks' **Bi-directional sync between Custom CSS and style controls** setting must be enabled.

**Compatibility note:** If Advanced Themer is active, disable its **SuperPower CSS** feature before using CSS Studio. Running both CSS editing layers at the same time can compete with Bricks' native CSS sync.

ACSS is optional. When it is active, CSS Studio can expose compatible ACSS variables and recipes. CSS Studio also includes a per-user recipe manager for sites without ACSS.

== Responsive CSS approach ==

CSS Studio is a code-first editor for the active Bricks Custom CSS field. It does not read or write Bricks' breakpoint-specific style-control values, and changing the active Bricks breakpoint does not open a separate CSS document.

For responsive styling, write `@media` and `@container` rules in the CSS itself. The query tools use the site's registered Bricks breakpoint widths to help create those rules. The breakpoint and state labels in the Studio header report the current builder context; they do not imply separate breakpoint storage.

This is intentionally different from tools built around Bricks' responsive style controls. CSS Studio is aimed at people who want to author and keep responsive behavior in CSS.

== Credits and inspiration ==

The in-editor value tools were inspired in particular by Elliot Bear's Drypoint and Strange Tech's Etch Enhancements. Advanced Themer and Code2Bricks also influenced the broader in-builder workflow.

Uplink CSS Studio is an independent implementation. It does not include or derive from those projects' source code. It is not affiliated with or endorsed by Bricks, Drypoint, Etch, Strange Tech, Advanced Themer, Code2Bricks, or ACSS.

== Features ==

* Edits the native Bricks custom CSS for the active element, global class, selector, state, or component variant.
* A selected-element HTML view can update supported tags, simple text content, IDs, reusable global classes, attributes (including inline styles), links, and image source or alt text without replacing the Bricks structure tree.
* The HTML view includes syntax highlighting, line numbers, matching tags, context-aware tag and attribute completion, and focused Emmet-style Tab expansion for one root element.
* Clicking an opening tag name selects it for linked renaming, so the closing tag updates as you type.
* Adding text or inline formatting to an empty Bricks Block converts it in place to Basic Text while preserving its tag, ID, classes, attributes, position, and styling.
* Classes entered in the HTML view create or attach Bricks global classes; the raw CSS class input is left untouched.
* Dark CodeMirror workspace with soft line wrapping, formatting, search, comments, status, full-screen editing, and a searchable comment-based outline.
* Context-aware icon controls for flex, grid, alignment, states, colors, shadows, gradients, filters, and transforms.
* CSS-authored media and container query helpers based on registered Bricks breakpoint widths, including `<=`, `>=`, and between ranges.
* Clickable comparison operators in media and container queries flip between `<` and `>`, or between `<=` and `>=`.
* Per-declaration gutter checkboxes temporarily disable and restore individual CSS declarations.
* Optional horizontal numeric scrubbing, with a preference and Command/Control + Alt + X shortcut.
* Interactive angle, cubic-bezier easing with motion preview, multi-layer box-shadow/text-shadow, type-aware gradient, and color-alpha editors.
* Draggable value and tool panels with viewport constraints.
* Clickable `:hover`, `:focus`, `:focus-visible`, `:focus-within`, and `:active` selectors preview those states on the canvas.
* Native CSS nesting when states or queries are inserted inside an existing selector.
* Property and value completion from a bundled standards catalog, including modern and draft CSS properties.
* Bricks and ACSS variable discovery, relevant value suggestions, abbreviations such as `fs` and `tt`, and Tab completion.
* CSS math completion that expands custom properties and wraps arithmetic expressions in `calc(...)`.
* `%root%` targeting plus Bricks global-class and element-ID assignment from the editor.
* Native editing of site-wide HTML selectors in the applicable Theme Style > Stylesheet, clickable HTML badges for matching active Theme Styles, plus a native Style Manager shortcut.
* ACSS recipe discovery and a per-user recipe manager with names, shortcuts, categories, search, editing, and `@shortcut;` expansion.
* Live Bricks structure breadcrumbs that navigate to ancestors, mark elements containing custom CSS, and switch between element CSS and every assigned global class.
* Automatic native element labels for changed HTML tags, while preserving labels entered by the user.
* Immediate two-way updates through Bricks' native CSS Sync service, with revert and remembered panel state.
* Optional open-on-selection and left/right canvas width handles, both enabled by default.
* Bricks' CSS group promoted to the top of the Style panel without replacing Bricks' native editor theme.

== Keyboard shortcuts ==

* Command/Control + Shift + C: Toggle CSS Studio.
* Command/Control + Shift + O: Toggle the stylesheet outline.
* Command/Control + Alt + X: Toggle numeric scrubbing.
* Command/Control + /: Toggle comment.
* Command + ] on macOS or Control + ] elsewhere: Apply HTML changes to the current builder session. Save the Bricks page to persist them.
* Control + Space in the HTML editor: Show tag or attribute completion for the current cursor position.
* Tab after a supported single-root HTML abbreviation such as `p.lead`, `a.button[href=/contact]`, or `span.label{New}`: Expand the abbreviation and place the caret in the element.
* Tab after a property abbreviation or partial property name: Complete the property and insert `: ;`, leaving the caret between the colon and semicolon.
* Tab after an arithmetic declaration value: Expand bare custom properties, wrap the expression in `calc(...)`, and keep the declaration's existing semicolon. A semicolon is added only when one is not already present.
* Type `@recipe-shortcut;`: Insert the matching ACSS or user recipe at the cursor.
* Tab after an exact ACSS or user-recipe shortcut: Insert the recipe at the cursor.
* `r` + Tab in an otherwise empty editor: Insert `%root%`.
* `R` + Tab in an otherwise empty editor: Insert a `%root%` rule and place the caret inside it.
* Escape: Close the active Studio panel; when no panel is open, close CSS Studio.

== Typical workflow ==

1. Select an element in the Bricks canvas or Structure panel. CSS Studio opens automatically unless that preference is disabled.
2. Assign a global class or ID from Studio when needed. New classes receive a `%root%` rule with the caret inside it.
3. For a site-wide HTML tag such as `address` or `dl`, open the target panel and enter the tag. CSS Studio switches to the applicable site-wide Theme Style stylesheet and creates the rule when needed.
4. Write CSS, use the toolbar, or type `@recipe-shortcut;`. Changes update Bricks and the canvas while you type.
5. Press Tab after an expression such as `--space-s * 2` to produce `calc(var(--space-s) * 2)`.
6. Add media or container queries from registered breakpoints, then save the Bricks page normally.

The HTML tab is intentionally a constrained view of the selected Bricks element. Existing child elements remain in the Structure panel and cannot be created, deleted, or reordered from the HTML tab. Bricks-only settings that are not represented in the markup are preserved.

== Requirements ==

* WordPress 7.0 or newer.
* PHP 8.3 or newer.
* Bricks 2.4 or newer.
* In **Bricks > Settings > Builder**, enable **Bi-directional sync between Custom CSS and style controls**.

CSS Studio does not load its builder interface until the Bricks version and CSS Sync requirements are met. Administrators receive a setup notice when either requirement is missing.

== Data and privacy ==

CSS Studio does not call an external service or send editor data off site. Element CSS stays in Bricks. Custom recipes are stored in the current WordPress user's metadata, and interface preferences are stored in that browser's local storage. Optional ACSS integration reads data from the locally installed ACSS plugin.

== Installation ==

1. Upload the `uplink-css-studio-for-bricks` folder to `/wp-content/plugins/`, or install the release ZIP from **Plugins > Add New > Upload Plugin**.
2. Activate **Uplink CSS Studio for Bricks**.
3. Confirm that Bricks 2.4 or newer is active.
4. Go to **Bricks > Settings > Builder**, enable **Bi-directional sync between Custom CSS and style controls**, and save the settings.
5. If Advanced Themer is active, disable **SuperPower CSS** in Advanced Themer. Other Advanced Themer features can remain enabled.
6. Open a page in Bricks and select an element to start using CSS Studio.

== Frequently Asked Questions ==

= Does CSS Studio replace Bricks' CSS storage? =

No. CSS Studio edits the native Bricks Custom CSS value and relies on Bricks' own bi-directional CSS sync.

= Does CSS Studio edit Bricks' breakpoint-specific style values? =

No. CSS Studio edits one Custom CSS stylesheet for the active target. Use its media and container query tools to write responsive rules in that stylesheet. The breakpoint label in the header is context only.

= Can I keep Advanced Themer active? =

Yes. Disable Advanced Themer's SuperPower CSS feature so that only one enhanced CSS editing layer controls the Bricks CSS sync workflow. Other Advanced Themer features may remain active.

= Is ACSS required? =

No. ACSS integration is optional. CSS Studio includes its own per-user recipe editor and works with native Bricks variables and palettes.

= Where is my data stored? =

Element CSS remains in Bricks. Custom recipes are stored in the current WordPress user's metadata, and interface preferences are stored locally in the browser. CSS Studio does not send site or editor data to an external service.

== Changelog ==

= 1.1.2 =

* Kept CSS Studio and its viewport resize handles below Bricks full-screen managers while retaining their position above ordinary builder controls.

= 1.1.1 =

* Restored space-aware placement for anchored tool panels so they open above or below based on available room.
* Kept constrained panels within the viewport with internal scrolling when neither side can show the full panel.
* Corrected popup stacking so Bricks controls and CSS Studio viewport resize handles no longer appear over tool panels.

= 1.1.0 =

* Added a bidirectional selected-element HTML view for supported tag, text, ID, global-class, attribute (including inline-style), link, and image changes.
* Added linked opening and closing tag renaming in the HTML editor.
* Added HTML syntax highlighting, line numbers, matching tags, contextual completion, and focused Emmet-style Tab expansion.
* Added in-place conversion from an empty Block to Basic Text when editable inner content is added.
* Added Command/Control + ] as the HTML apply shortcut.
* Added state-aware Reset draft and Apply to builder actions. Both enable only when the HTML draft differs from the current builder element, and applied changes still require a Bricks page save.
* Added direct switching between element CSS and assigned global classes in the CSS breadcrumbs.
* Classes typed in the HTML view create or attach Bricks global styling classes instead of writing to the raw class input.
* Protected Bricks child structure and builder-only settings, with validation for unsafe or unsupported markup.

= 1.0.0 =

* Initial public release.
* Native two-way editing of Bricks Custom CSS for elements, global classes, selectors, pseudo-states, and component variants.
* Docked and full-screen CodeMirror workspace with formatting, search, comments, outline navigation, declaration toggles, and optional numeric scrubbing.
* Context-aware flex, grid, alignment, state, color, shadow, gradient, easing, media-query, and container-query tools.
* Interactive color variables, color picker, angle dial, cubic-bezier editor, multi-layer shadows, and type-aware gradient controls.
* Property-aware completion, CSS math expansion, query-block completion, Bricks and ACSS variables, ACSS recipes, and per-user custom recipes.
* Global class and element ID assignment, native Theme Style stylesheet editing and clickable active-style indicators for global HTML selectors, a Bricks Style Manager shortcut, and Bricks structure breadcrumbs.
* Automatic native element labels for changed HTML tags without overwriting user-defined element names.
* Draggable tool panels, horizontally scrollable compact-screen controls, optional first-applied-class selection, optional canvas resize handles, remembered preferences, and live canvas updates.
* Protection against the empty `align-items: initial` declaration produced by Bricks CSS Sync.
