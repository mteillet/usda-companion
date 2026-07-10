import * as vscode from 'vscode';
import { parseUsda, PrimNode } from './parse';
import { propertyGroupRanges } from './groups';

function collect(node: PrimNode, out: vscode.FoldingRange[]): void {
  if (node.endLine > node.startLine) {
    out.push(new vscode.FoldingRange(node.startLine, node.endLine, vscode.FoldingRangeKind.Region));
  }
  for (const child of node.children) collect(child, out);
}

export class UsdaFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(doc: vscode.TextDocument): vscode.FoldingRange[] {
    const text = doc.getText();
    const out: vscode.FoldingRange[] = [];
    for (const node of parseUsda(text)) collect(node, out);

    const prefixes = vscode.workspace
      .getConfiguration('usda')
      .get<string[]>('fold.propertyGroups') ?? [];
    for (const g of propertyGroupRanges(text, prefixes)) {
      out.push(new vscode.FoldingRange(g.start, g.end, vscode.FoldingRangeKind.Region));
    }
    return out;
  }
}
