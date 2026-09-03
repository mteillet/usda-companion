# USDA Companion

A small VS Code extension that **complements** the excellent
[Animal Logic USD highlighter](https://marketplace.visualstudio.com/items?itemName=AnimalLogic.vscode-usda-syntax)
instead of replacing it. AL gives you syntax highlighting; this adds the
structural and tooling features it doesn't: an **outline**, **folding**, and
commands that shell out to your USD CLI tools.

> Keep the Animal Logic extension installed for highlighting. This one attaches
> to `.usda` files by path, so it works alongside it (and even without it).

## Requirements

- **VS Code ≥ 1.75.**
- *(Recommended)* the **Animal Logic USD** extension for syntax highlighting.
  USDA Companion contributes the `usd` language id (no grammar), so its features
  work with or without AL — AL just adds the colors.
- *(Optional, for the runtime features)* your USD CLI tools, on `PATH` or wrapped
  via the command settings below: `usdcat`, `usdchecker`, `usdview`, a
  `pxr`-capable `python3`, and your asset resolver. Without them the text-only
  features (outline, folding, lints, **Jump to USD File**) still work.

## What's here today

**Text-only (no USD runtime needed):**
- **Prim outline** — `def` / `over` / `class` hierarchy plus `variantSet`s and
  their variants, in the Outline view, the breadcrumb bar, and `Ctrl/Cmd+Shift+O`.
- **Folding** — collapse prim, variantSet and variant blocks, plus **whole runs
  of same-namespace properties** in one click (long `collection:*` and
  `material:binding*` blocks fold to a single line). Configure which namespaces
  group via `usda.fold.propertyGroups`.
- **Commands** (palette, category `USDA`): `Flatten (usdcat --flatten)`,
  `Run usdchecker`, `Open in usdview`, and **`Jump to USD File`**.
- **List deactivated Vars** (`Ctrl/Cmd+Alt+P`) — finds every prim deactivated via
  `active = false` (the classic `over "Vars" { over "someLight" ( active = false ) {} }`
  scaffolding), shows them in a checkable quick pick with their full prim path, previews
  each in the editor as you arrow through, and **deletes the ones you tick** in a single
  undoable edit. Empty `over` parents left behind are cleaned up
  (`usda.deactivations.pruneEmptyParents`, on by default).
- **Jump to USD File** (`Ctrl/Cmd+Alt+J`) — jumps to the `.usd`/`.usda` among your
  **open tabs** (one match opens directly; several show a quick picker). With no
  USD tab open it falls back to the workspace; right-click a folder in the Explorer
  to search just that folder. Configure with `usda.jumpToUsd.*`.
- **Lints** (text-only, live as you type) — `xformOpOrder` ↔ defined `xformOp:*`
  consistency (dangling order entries, and attrs missing from the order), and
  duplicate `def` siblings. Toggle with `usda.lint.enabled`.

**With a USD-capable python (`usda.python.command`):**
- **Schema-aware completion** — prim types after `def`/`over`/`class`; property
  names valid for the enclosing prim's type (+ its applied `apiSchemas`); and
  `allowedTokens` values (e.g. `visibility = `, `purpose = `).
- **Hover** — schema doc, attribute type, and allowed tokens for types/properties.

**With a resolver (`usda.assetResolver.command`, default `usdresolve`):**
- **Go-to-definition** — on an `@asset@` reference / payload / sublayer, resolves
  the path (incl. custom schemes like `asset:`) and opens it (jumping to the
  `</Prim>` target when present); on an internal `</prim/path>`, jumps within the
  current file.
- **Clickable asset links**, and `USDA: Open asset under cursor`.
- **Relationship hover** — hover a prim's name to see what it's **referenced by**
  (collections that include it, bindings/relationships that target it) and what it
  **points to**, each with a jump link. It also follows **collection chains**: a
  light shows the collections it's a **member of** and what it's **effectively
  bound to via a collection** (e.g. a collection-based `material:binding` /
  `…:binding:collection:…` → the bound material/target). **Find All References**
  (`Shift+F12`) peeks the full list. Hovering a **collection** (a `collection:NAME:…`
  property or a `</prim.collection:NAME>` reference) shows the reverse view: the
  prims it **includes/excludes** and the **bindings** authored on it, each with a
  jump. Works for any prim, not just lights. (File-scoped; cross-stage is on the roadmap.)
- **`usdchecker` on save** — its findings appear inline in the Problems panel
  (best-effort line mapping; stage-level messages land at the top). Toggle with
  `usda.diagnostics.usdcheckerOnSave`.

The outline/folding/lints use a heuristic text parser (zero dependencies);
schema, resolution and usdchecker use your USD via the configured commands.

## Settings

Everything studio-specific lives in settings, so this repo stays generic. Each
command is an array so you can wrap it in your launcher / set env:

```jsonc
{
  "usda.usdcat.command": ["usdcat"],
  "usda.usdchecker.command": ["rez-env", "usd", "--", "usdchecker"],
  "usda.usdview.command": ["usdview"],

  // a python3 that can `from pxr import Usd` (matching build + ABI):
  "usda.python.command": ["env", "PYTHONPATH=/path/usd/lib/python",
                          "LD_LIBRARY_PATH=/path/usd/lib64", "/path/bin/python3.x"],

  // resolves asset paths (must load your resolver plugin, like usdchecker does):
  "usda.assetResolver.command": ["usdresolve"],

  // optional fallback for custom schemas not registered in the python above:
  "usda.schema.generatedSchemaPaths": [],

  // Jump to USD File — extensions/globs (also matches open tabs by extension);
  // add "**/*.usdc" / "**/*.usdz" to include binary crates:
  "usda.jumpToUsd.include": ["**/*.usda", "**/*.usd"],
  "usda.jumpToUsd.exclude": ["**/node_modules/**", "**/.git/**"],
  // open the best match directly instead of showing a picker when several match:
  "usda.jumpToUsd.openBestWhenMultiple": false
}
```

> Tip: schema/resolution features inherit **VS Code's** environment. Launch VS
> Code from a shell where your studio env is sourced (so `PXR_PLUGINPATH_NAME`,
> custom schemas, and your custom asset resolver are visible), or bake the env into the
> command arrays / a wrapper.

## Roadmap

- More lints (naming conventions, dangling relationship targets, unknown prim
  types when all schemas are registered).
- Schema-aware completion for **multiple-apply** schemas (instance-named
  `collection:*`), and a `generatedSchema.usda` fallback for custom types
  not registered in the configured python.

## Build & develop

```bash
npm install
npm run compile     # tsc -> out/   (npm run watch for incremental)
npm test            # compiles, then runs the pure-logic suite (test/run.js)
npm run package     # vsce package -> usda-companion-<version>.vsix
```

Press <kbd>F5</kbd> to launch an Extension Development Host with the extension
loaded; open `sample.usda` / `sample-lint.usda` to try the features. Install a
built `.vsix` via *Extensions ▸ … ▸ Install from VSIX…*.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: pure logic (parser, grouping,
lints, relationship indexing, jump scoring) is unit-tested without VS Code under
`test/` — add a case when you touch it; the provider/command wiring is validated
by running the dev host. CI compiles, tests and packages on every push/PR.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE).
