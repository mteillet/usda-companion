import * as vscode from 'vscode';
import { buildRelations, primAtLine } from './relations';
import { primPathIndex } from './context';
import { pathAt } from './assets';

export class UsdaReferenceProvider implements vscode.ReferenceProvider {
  provideReferences(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    context: vscode.ReferenceContext
  ): vscode.Location[] {
    const text = doc.getText();
    const range = doc.getWordRangeAtPosition(pos, /[A-Za-z_][\w:]*/);
    const word = range ? doc.getText(range) : '';

    // Resolve the prim path in question: a prim declaration name, or a </path>.
    let path: string | null = null;
    const at = primAtLine(text, pos.line);
    if (at && word === at.node.name) {
      path = at.path;
    } else {
      const p = pathAt(doc.lineAt(pos.line).text, pos.character);
      if (p && p.startsWith('/')) path = p.split('.')[0];
    }
    if (!path) return [];

    const rel = buildRelations(text);
    const locs = (rel.byTarget.get(path) || []).map(
      e => new vscode.Location(doc.uri, new vscode.Position(e.line, 0))
    );
    if (context.includeDeclaration) {
      const decl = primPathIndex(text).get(path);
      if (decl !== undefined) locs.push(new vscode.Location(doc.uri, new vscode.Position(decl, 0)));
    }
    return locs;
  }
}
