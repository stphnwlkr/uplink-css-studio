# Uplink CSS Studio for Bricks

Uplink CSS Studio is a code-first CSS workspace inside the Bricks builder. It edits Bricks' native Custom CSS field through the bi-directional CSS Sync service. It adds completion, recipes, query helpers, outline navigation, formatting, visual value tools, and a resizable editor.

Version 1.1 adds a constrained HTML view for the selected element. Its lightweight HTML code editor includes syntax highlighting, line numbers, matching tags, context-aware tag and attribute completion, and single-root Emmet-style Tab expansion. It can update supported tags, simple text, IDs, attributes including inline styles, links, image fields, and Bricks global classes while leaving nested structure and builder-only settings under Bricks' control. Opening and closing tags are linked for one-step renaming. Adding text to an empty Block converts it in place to Basic Text and preserves the existing element data. The CSS breadcrumbs can also switch directly between element CSS and every assigned global class.

[Product page and full introduction](https://uplinkplugins.com/articles/meet-uplink-css-studio-for-bricks/)

CSS Studio does not edit Bricks' breakpoint-specific style-control values. It keeps responsive behavior in the Custom CSS stylesheet through `@media` and `@container` rules. Its query tools use registered Bricks breakpoint widths to help author those rules. The breakpoint label in the header reports builder context only.

## Requirements

- WordPress 7.0 or newer
- PHP 8.3 or newer
- Bricks 2.4 or newer
- "Bi-directional sync between Custom CSS and style controls" enabled in Bricks settings

ACSS is optional. If Advanced Themer is active, update it to version 3.5 or newer, which supports Bricks' bidirectional CSS sync, or disable its SuperPower CSS feature. Earlier versions must not run SuperPower CSS alongside CSS Studio.

## Data and privacy

CSS Studio does not send editor data off site. Element CSS stays in Bricks. Custom recipes are stored in the current WordPress user's metadata, and interface preferences are stored in that browser's local storage. Optional ACSS integration reads data from the locally installed ACSS plugin. WordPress periodically requests public release metadata from GitHub to check for plugin updates.

## Installation

Install the release ZIP in WordPress, activate the plugin, enable Bricks CSS Sync, and open a page in the Bricks builder. Select an element to open CSS Studio.

Starting with version 1.2.0, new releases appear in the normal WordPress Plugins screen. Updates are downloaded from the plugin's public GitHub Releases page. You can install them manually or use WordPress' per-plugin automatic-update setting.

The current release always has the same direct download URL: [Download the latest Uplink CSS Studio ZIP](https://github.com/stphnwlkr/uplink-css-studio/releases/latest/download/uplink-css-studio.zip).

## Development and licensing

The plugin is licensed under GPL-2.0-or-later. The bundled CSS property catalog includes data from `@vscode/web-custom-data` under the MIT license and draft entries from the W3C CSS Gaps Module Level 1. Plugin Update Checker is bundled under the MIT license. See `THIRD-PARTY-NOTICES.txt`.

The in-editor value tools were inspired in particular by Elliot Bear's Drypoint and Strange Tech's Etch Enhancements. Advanced Themer and Code2Bricks also influenced the broader in-builder workflow.

CSS Studio takes a different, code-first approach. It keeps Bricks Custom CSS as the source of truth instead of acting as an editor for Bricks' breakpoint-specific style values. It is an independent implementation and does not include or derive from the source code of the projects named above.
