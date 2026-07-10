import * as vscode from 'vscode';
import { UsdaSymbolProvider } from './symbols';
import { UsdaFoldingProvider } from './folding';
import { UsdaCompletionProvider } from './completion';
import { UsdaHoverProvider } from './hover';
import { UsdaDefinitionProvider } from './definition';
import { UsdaReferenceProvider } from './references';
import { UsdaLinkProvider } from './links';
import { registerCommands } from './commands';
import { initSchema, ensureSchemas, clearSchemaCache } from './schema';
import { resolveAsset, clearResolveCache } from './resolve';
import { assetAt } from './assets';
import { initDiagnostics } from './diagnostics';
import { jumpToUsd } from './jump';
import { listDeactivations } from './deactivations';

// Pattern-based selectors match by file path, so providers work whether or not
// the Animal Logic extension (which owns the `usd` languageId + highlighting)
// is installed. This extension is a companion: it adds structure and tooling,
// not syntax highlighting.
const SELECTOR: vscode.DocumentSelector = [
  { scheme: 'file', pattern: '**/*.usda' },
  { scheme: 'file', pattern: '**/*.usd' },
  { language: 'usd' },
];

export function activate(ctx: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('USDA Companion');
  ctx.subscriptions.push(output);

  initSchema(ctx.extensionPath, output);
  initDiagnostics(ctx);

  ctx.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, new UsdaSymbolProvider())
  );
  ctx.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(SELECTOR, new UsdaFoldingProvider())
  );
  ctx.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(SELECTOR, new UsdaCompletionProvider(), ':')
  );
  ctx.subscriptions.push(
    vscode.languages.registerHoverProvider(SELECTOR, new UsdaHoverProvider())
  );
  ctx.subscriptions.push(
    vscode.languages.registerDefinitionProvider(SELECTOR, new UsdaDefinitionProvider())
  );
  ctx.subscriptions.push(
    vscode.languages.registerReferenceProvider(SELECTOR, new UsdaReferenceProvider())
  );
  ctx.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(SELECTOR, new UsdaLinkProvider())
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('usda.revealLocation', async (arg: { uri: string; line: number }) => {
      if (!arg || typeof arg.uri !== 'string') return;
      const uri = vscode.Uri.parse(arg.uri);
      const doc = await vscode.workspace.openTextDocument(uri);
      const ed = await vscode.window.showTextDocument(doc, { preview: false });
      const p = new vscode.Position(Math.max(0, arg.line | 0), 0);
      ed.selection = new vscode.Selection(p, p);
      ed.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenter);
    })
  );

  registerCommands(ctx, output);

  ctx.subscriptions.push(
    vscode.commands.registerCommand('usda.reloadSchemas', async () => {
      clearSchemaCache();
      const data = await ensureSchemas();
      if (data) {
        vscode.window.showInformationMessage(
          `USDA: loaded USD ${data.version.join('.')} — ${Object.keys(data.concrete).length} types.`
        );
      } else {
        vscode.window.showWarningMessage('USDA: schema load failed — see the "USDA Companion" output channel.');
        output.show(true);
      }
    })
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('usda.clearResolveCache', () => {
      clearResolveCache();
      vscode.window.showInformationMessage('USDA: asset-resolution cache cleared.');
    })
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('usda.openAsset', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const line = editor.document.lineAt(editor.selection.active.line).text;
      const hit = assetAt(line, editor.selection.active.character);
      if (!hit || !hit.asset) {
        vscode.window.showWarningMessage('USDA: place the cursor on an @asset@ reference.');
        return;
      }
      const resolved = await resolveAsset(hit.asset);
      if (!resolved) {
        vscode.window.showErrorMessage(
          `USDA: could not resolve "${hit.asset}". Check "usda.assetResolver.command" (e.g. ["usdresolve"]) runs in this environment.`
        );
        return;
      }
      const td = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
      await vscode.window.showTextDocument(td, { preview: false });
    })
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('usda.jumpToUsd', (uri?: vscode.Uri) => jumpToUsd(uri))
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('usda.listDeactivations', () => listDeactivations())
  );

  // Warm the schema cache in the background so completion/hover are ready.
  void ensureSchemas();
}

export function deactivate(): void { /* no-op */ }
