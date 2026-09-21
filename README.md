# Uplink CSS Studio for Bricks

Uplink CSS Studio is a contextual CSS workspace inside the Bricks builder. It edits Bricks' native custom CSS, uses Bricks' bi-directional CSS Sync service, and adds completion, recipes, responsive query tools, outline navigation, formatting, and a resizable editor.

## Requirements

- WordPress 7.0 or newer
- PHP 8.3 or newer
- Bricks 2.4 or newer
- "Bi-directional sync between Custom CSS and style controls" enabled in Bricks settings

ACSS is optional. If Advanced Themer is active, disable its SuperPower CSS feature before using CSS Studio.

## Installation

Install the release ZIP in WordPress, activate the plugin, enable Bricks CSS Sync, and open a page in the Bricks builder. Select an element to open CSS Studio.

## Development and licensing

The plugin is licensed under GPL-2.0-or-later. The bundled CSS property catalog includes data from `@vscode/web-custom-data` under the MIT license and draft entries from the W3C CSS Gaps Module Level 1. See `THIRD-PARTY-NOTICES.txt`.

CSS Studio was inspired by the in-builder workflows of Etch, Advanced Themer, and Code2Bricks. It is an independent implementation and does not include or derive from their source code.
