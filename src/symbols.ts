import * as vscode from 'vscode';
import { parseUsda, PrimNode } from './parse';

function kindFor(node: PrimNode): vscode.SymbolKind {
  switch (node.kind) {
    case 'variantSet': return vscode.SymbolKind.Enum;
    case 'variant': return vscode.SymbolKind.EnumMember;
    default: return vscode.SymbolKind.Class;
  }
}

function detailFor(node: PrimNode): string {
  if (node.kind === 'prim') {
    return node.typeName ? `${node.specifier} ${node.typeName}` : node.specifier;
  }
  if (node.kind === 'variantSet') return 'variantSet';
  return 'variant';
}

function toSymbol(doc: vscode.TextDocument, node: PrimNode): vscode.DocumentSymbol {
  const startLine = Math.min(node.startLine, doc.lineCount - 1);
  const endLine = Math.min(Math.max(node.endLine, node.startLine), doc.lineCount - 1);
  const full = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).range.end.character);
  const header = doc.lineAt(startLine).range;
  const sym = new vscode.DocumentSymbol(node.name || '<anon>', detailFor(node), kindFor(node), full, header);
  sym.children = node.children.map(child => toSymbol(doc, child));
  return sym;
}

export class UsdaSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(doc: vscode.TextDocument): vscode.DocumentSymbol[] {
    return parseUsda(doc.getText()).map(node => toSymbol(doc, node));
  }
}
