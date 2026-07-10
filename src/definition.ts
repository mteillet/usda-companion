import * as vscode from 'vscode';
import { assetAt, pathAt } from './assets';
import { resolveAsset } from './resolve';
import { primPathIndex } from './context';

export class UsdaDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    doc: vscode.TextDocument,
    pos: vscode.Position
  ): Promise<vscode.Definition | undefined> {
    const line = doc.lineAt(pos.line).text;

    // 1) asset reference @...@ (references / payloads / sublayers) -> resolve + open
    const a = assetAt(line, pos.character);
    if (a && a.asset) {
      const resolved = await resolveAsset(a.asset);
      if (!resolved) return undefined;
      const uri = vscode.Uri.file(resolved);
      let target = new vscode.Position(0, 0);
      if (a.prim) {
        try {
          const td = await vscode.workspace.openTextDocument(uri);
          const ln = primPathIndex(td.getText()).get(a.prim);
          if (ln !== undefined) target = new vscode.Position(ln, 0);
        } catch { /* fall back to top of file */ }
      }
      return new vscode.Location(uri, target);
    }

    // 2) internal prim path </...> -> jump within the current document
    const p = pathAt(line, pos.character);
    if (p && p.startsWith('/')) {
      const primPath = p.split('.')[0]; // drop any .property suffix
      const ln = primPathIndex(doc.getText()).get(primPath);
      if (ln !== undefined) {
        return new vscode.Location(doc.uri, new vscode.Position(ln, 0));
      }
    }

    return undefined;
  }
}
