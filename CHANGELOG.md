# Changelog

All notable changes to **USDA Companion** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and the
project uses [Semantic Versioning](https://semver.org/) (pre-1.0, so minor/patch
distinctions are loose).

## [0.0.22]

### Changed
- Tidied documentation and setting descriptions — generic examples and wording
  throughout.

## [0.0.21]

### Fixed
- **List deactivated Vars** now removes *only* the `active = false` opinion instead
  of the whole `over` block. A prim that also declares or overrides content keeps
  everything but its deactivation. `over` scaffolding that ends up completely empty
  (the selected prim and, with `usda.deactivations.pruneEmptyParents`, an emptied
  parent) is still cleaned up.

## [0.0.20]

### Fixed
- Syntax-highlighting cascade with the Animal Logic grammar: a single-quoted
  string containing `//` or `/*` — e.g. a `pathExpression` /
  `…:membershipExpression = '//*Foo{isa:"Bar"}'` — was mis-read as a C-style
  comment, turning the rest of the file the comment colour. USDA Companion now
  ships a TextMate **injection** that claims string literals (single, double and
  triple-quoted) before the comment rules run, so `//` inside a string stays part
  of the string. Injects into `source.usd` and `source.usda`; harmless if the base
  grammar isn't present.

## [0.0.19]

### Changed
- The bundled `sample.usda` uses standard USD schemas (UsdLux `SphereLight`,
  `UsdPreviewSurface`) and generic example paths. The extension is schema- and
  renderer-agnostic: every external tool is a configurable `usda.*.command`.

## [0.0.18]

### Changed
- Renamed the command to **USDA: List deactivated Vars** and moved its keybinding
  to `Ctrl/Cmd+Alt+P` (the previous `Ctrl+Shift+L` collides with VS Code's
  built-in *Select all occurrences*).

## [0.0.17]

### Added
- **USDA: List deactivated Vars** — new command. Lists every prim deactivated via
  `active = false` with its full path, previews the block in the editor as you move
  through the list, and deletes the checked ones in one undoable edit. When a
  deletion empties the `over` scaffolding that held them (e.g. `over "Vars" {}`),
  the empty parent is removed too — controlled by
  `usda.deactivations.pruneEmptyParents` (default `true`). Pruning is conservative:
  only `over` prims that were ancestors of a deleted block, carry no metadata of
  their own, and end up with an empty body.

## [0.0.16]

### Added
- Contribute the `usd` language for `.usda` / `.usd` (no grammar — Animal Logic
  still provides highlighting). This makes the extension **activate on opening a
  USD file even without a workspace folder**, and wires `language-configuration.json`
  (bracket matching, `#` comments, auto-closing).

### Fixed
- **`usdcat` / `usdchecker` / `usdview` (and *Open asset*) missing from the Command
  Palette** for `.usd` files, or for `.usda` files when no extension had set the
  `usd` language. The palette condition now matches any USD file by extension
  **or** language id (`editorLangId == usd || resourceExtname == .usda || .usd`).

### Repo
- Added GitHub scaffolding: `.gitignore`, `CHANGELOG.md`, `CONTRIBUTING.md`,
  `.editorconfig`, CI + release workflows, an issue template, a `test/` suite and
  `npm test`, and `repository` / `bugs` / `homepage` fields.

## [0.0.15]
- **Jump to USD File** now targets your **open editor tabs** first, so it works
  with just a set of open files (no workspace needed). Falls back to the folder
  (right-click) / workspace search when no USD tab is open. Removed the
  workspace-only guard from the keybinding and palette.

## [0.0.14]
- Default keybinding for **Jump to USD File** changed to `Ctrl/Cmd+Alt+J`.

## [0.0.13]
- New command **USDA: Jump to USD File** with a keybinding and an Explorer
  folder context-menu entry. One match opens directly; several show a picker
  sorted best-first (root, name-matches-folder, `.usda` preferred). Settings:
  `usda.jumpToUsd.include` / `.exclude` / `.openBestWhenMultiple`.

## [0.0.12]
- New app icon (abstract map + location pin + “.USDA” wordmark).

## [0.0.11]
- Wired the extension icon.

## [0.0.10]
- Hovering a **collection** shows the reverse view: prims it includes/excludes
  and the bindings authored on it, each with a jump link.

## [0.0.9]
- Collection-aware, transitive relationship chaining: a prim shows the
  collections it’s a member of and what it’s **effectively bound to via a
  collection** (e.g. collection-based `material:binding` → bound material/target).

## [0.0.8]
- Relationship-aware hover (**Referenced by** / **Points to**) and **Find All
  References** (`Shift+F12`), file-scoped.

## [0.0.7]
- Diagnostics: text-only lints (`xformOpOrder` ↔ defined `xformOp:*`, duplicate
  `def` siblings) live as you type, and `usdchecker`-on-save findings mapped into
  the Problems panel.

## [0.0.6]
- Go-to-definition and clickable links for `@asset@` references / payloads /
  sublayers (resolving custom URI schemes), plus internal `</path>`
  navigation and **USDA: Open asset under cursor**.

## [0.0.5]
- More detailed schema-load diagnostics in the output channel.

## [0.0.4]
- Schema-aware completion (prim types, type/`apiSchemas` properties,
  `allowedTokens` values) and hover docs, via a USD-capable python.

## [0.0.3]
- Group-folding: collapse whole runs of same-namespace properties
  (`collection:*`, `material:binding*`).

## [0.0.2]
- Parser fix (leftmost specifier per line).

## [0.0.1]
- Initial release: prim **outline**, **folding**, and shell-out commands
  (`Flatten`, `Run usdchecker`, `Open in usdview`).
