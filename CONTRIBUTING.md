# Contributing

Thanks for taking a look! This is a small, focused companion to the
[Animal Logic USD highlighter](https://marketplace.visualstudio.com/items?itemName=AnimalLogic.vscode-usda-syntax).

## Dev setup

```bash
npm install
npm run compile     # tsc -> out/   (or: npm run watch)
npm test            # compiles, then runs test/run.js
```

Press <kbd>F5</kbd> in VS Code to launch an **Extension Development Host** with
the extension loaded (the `.vscode/launch.json` + `tasks.json` are included).

Open one of the `sample.usda` / `sample-lint.usda` fixtures to exercise the
outline, folding, lints, hover and jump features.

## Packaging

```bash
npm run package     # vsce package -> usda-companion-<version>.vsix
```

## Design notes

- **Companion, not replacement.** Highlighting stays with Animal Logic. We
  contribute the `usd` *language id* (no grammar) plus structure/navigation/
  diagnostics. Providers attach by file pattern **and** language, so they work
  with or without AL installed.
- **Nothing studio-specific is hardcoded.** Every external tool is a configurable
  command array (`usda.usdcat.command`, `usda.python.command`,
  `usda.assetResolver.command`, …) so the repo stays generic and open-sourceable.
- **Pure logic is unit-tested** without VS Code. The parser, property grouping,
  lints, relationship indexing and the jump scoring live in plain modules that
  `test/run.js` exercises against a tiny `vscode` stub. Please add a case there
  when you touch that logic — the VS Code *wiring* (providers, commands) is
  validated by running the dev host.

## Pull requests

- Keep changes scoped and described.
- Run `npm test` (CI runs it too) and bump `version` + `CHANGELOG.md`.
