=== Uplink CSS Studio for Bricks ===
Contributors: stphnwlkr
Tags: bricks, css, code editor, builder
Requires at least: 7.0
Tested up to: 7.1
Requires PHP: 8.3
Stable tag: 1.0.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A contextual CSS workspace inside the Bricks canvas with live sync, smart completion, recipes, and responsive tools.

== Description ==

Uplink CSS Studio for Bricks adds an integrated CSS workspace to the Bricks builder. It keeps Bricks' native Custom CSS and style controls as the source of truth, while adding a larger editor, contextual tools, property-aware completion, recipes, design variables, and live canvas updates.

Bricks 2.4 or newer is required, and Bricks' **Bi-directional sync between Custom CSS and style controls** setting must be enabled.

**Compatibility note:** If Advanced Themer is active, disable its **SuperPower CSS** feature before using CSS Studio. Running both CSS editing layers at the same time can compete with Bricks' native CSS sync.

ACSS is optional. When it is active, CSS Studio can expose compatible ACSS variables and recipes. CSS Studio also includes a per-user recipe manager for sites without ACSS.

CSS Studio was inspired by the in-builder editing workflows pioneered by Etch, Advanced Themer, and Code2Bricks. Uplink CSS Studio is an independent implementation and does not include or derive from their source code. Uplink CSS Studio is not affiliated with or endorsed by Bricks, Etch, Advanced Themer, Code2Bricks, or ACSS.

== Features ==

* Edits the native Bricks custom CSS for the active element, global class, selector, state, or component variant.
* Dark CodeMirror workspace with formatting, search, comments, status, full-screen editing, and a searchable comment-based outline.
* Context-aware icon controls for flex, grid, alignment, states, colors, shadows, gradients, filters, and transforms.
* Media and container queries based on registered Bricks breakpoints, including `<=`, `>=`, and between ranges.
* Native CSS nesting when states or queries are inserted inside an existing selector.
* Property and value completion from a bundled standards catalog, including modern and draft CSS properties.
* Bricks and ACSS variable discovery, relevant value suggestions, abbreviations such as `fs` and `tt`, and Tab completion.
* CSS math completion that expands custom properties and wraps arithmetic expressions in `calc(...)`.
* `%root%` targeting plus Bricks global-class and element-ID assignment from the editor.
* ACSS recipe discovery and a per-user recipe manager with names, shortcuts, categories, search, editing, and `@shortcut;` expansion.
* Live Bricks structure breadcrumbs that navigate to ancestors and mark elements containing custom CSS.
* Immediate two-way updates through Bricks' native CSS Sync service, with revert and remembered panel state.
* Optional open-on-selection and left/right canvas width handles, both enabled by default.
* Bricks' CSS group promoted to the top of the Style panel without replacing Bricks' native editor theme.

== Keyboard shortcuts ==

* Command/Control + Shift + C: Toggle CSS Studio.
* Command/Control + Shift + O: Toggle the stylesheet outline.
* Command/Control + /: Toggle comment.
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
3. Write CSS, use the toolbar, or type `@recipe-shortcut;`. Changes update Bricks and the canvas while you type.
4. Press Tab after an expression such as `--space-s * 2` to produce `calc(var(--space-s) * 2)`.
5. Add media or container queries from registered breakpoints, then save the Bricks page normally.

== Requirements ==

* WordPress 7.0 or newer.
* PHP 8.3 or newer.
* Bricks 2.4 or newer.
* In **Bricks > Settings > Builder**, enable **Bi-directional sync between Custom CSS and style controls**.

CSS Studio does not load its builder interface until the Bricks version and CSS Sync requirements are met. Administrators receive a setup notice when either requirement is missing.

== Installation ==

1. Upload the `uplink-css-studio` folder to `/wp-content/plugins/`, or install the release ZIP from **Plugins > Add New > Upload Plugin**.
2. Activate **Uplink CSS Studio for Bricks**.
3. Confirm that Bricks 2.4 or newer is active.
4. Go to **Bricks > Settings > Builder**, enable **Bi-directional sync between Custom CSS and style controls**, and save the settings.
5. If Advanced Themer is active, disable **SuperPower CSS** in Advanced Themer. Other Advanced Themer features can remain enabled.
6. Open a page in Bricks and select an element to start using CSS Studio.

== Frequently Asked Questions ==

= Does CSS Studio replace Bricks' CSS storage? =

No. CSS Studio edits the native Bricks Custom CSS value and relies on Bricks' own bi-directional CSS sync.

= Can I keep Advanced Themer active? =

Yes. Disable Advanced Themer's SuperPower CSS feature so that only one enhanced CSS editing layer controls the Bricks CSS sync workflow. Other Advanced Themer features may remain active.

= Is ACSS required? =

No. ACSS integration is optional. CSS Studio includes its own per-user recipe editor and works with native Bricks variables and palettes.

= Where is my data stored? =

Element CSS remains in Bricks. Custom recipes are stored in the current WordPress user's metadata, and interface preferences are stored locally in the browser. CSS Studio does not send site or editor data to an external service.

== Changelog ==

= 1.0.0 =
* First public release of Uplink CSS Studio for Bricks.
* Add native Bricks CSS sync, contextual layout and state tools, media and container queries, property-aware completion, design variables, recipes, formatting, outline navigation, and viewport resizing.
* Add a namespaced PHP entry point, post-specific authorization for recipe storage, normalized recipe input, and WordPress.org release metadata.

For pre-release history, see changelog.txt in the plugin package.
