import * as vscode from 'vscode';
import { lintUsda, parseUsdchecker, Severity } from './lint';
import { commandFor, run } from './config';

let lintCol: vscode.DiagnosticCollection;
let checkCol: vscode.DiagnosticCollection;
const debounce = new Map<string, NodeJS.Timeout>();
const checking = new Set<string>();

function isUsda(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'usd' || /\.usda?$/.test(doc.uri.fsPath);
}

function cfg<T>(key: string, def: T): T {
  return vscode.workspace.getConfiguration('usda').get<T>(key, def);
}

const SEV: Record<Severity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

function lineRange(doc: vscode.TextDocument, line: number): vscode.Range {
  const ln = Math.min(Math.max(line, 0), doc.lineCount - 1);
  const text = doc.lineAt(ln);
  const start = text.firstNonWhitespaceCharacterIndex;
  return new vscode.Range(ln, start, ln, text.range.end.character);
}

function runLints(doc: vscode.TextDocument): void {
  if (!isUsda(doc)) return;
  if (!cfg('lint.enabled', true)) { lintCol.delete(doc.uri); return; }
  const diags = lintUsda(doc.getText()).map(l => {
    const d = new vscode.Diagnostic(lineRange(doc, l.line), l.message, SEV[l.severity]);
    d.source = 'usda';
    d.code = l.code;
    return d;
  });
  lintCol.set(doc.uri, diags);
}

export async function runUsdchecker(doc: vscode.TextDocument): Promise<void> {
  if (!isUsda(doc) || doc.uri.scheme !== 'file') return;
  if (!cfg('diagnostics.usdcheckerOnSave', true)) { checkCol.delete(doc.uri); return; }
  const key = doc.uri.toString();
  if (checking.has(key)) return;
  checking.add(key);
  try {
    const cmd = commandFor('usdchecker', 'usdchecker');
    const r = await run(cmd, [doc.uri.fsPath], { timeoutMs: 120000 });
    const findings = parseUsdchecker(`${r.stdout}\n${r.stderr}`, doc.getText());
    const diags = findings.map(f => {
      const d = new vscode.Diagnostic(lineRange(doc, f.line), f.message, vscode.DiagnosticSeverity.Warning);
      d.source = 'usdchecker';
      return d;
    });
    checkCol.set(doc.uri, diags);
  } catch {
    // tool/env not available: clear and stay quiet (the USDA: Run usdchecker
    // command surfaces the spawn error explicitly).
    checkCol.delete(doc.uri);
  } finally {
    checking.delete(key);
  }
}

export function initDiagnostics(ctx: vscode.ExtensionContext): void {
  lintCol = vscode.languages.createDiagnosticCollection('usda');
  checkCol = vscode.languages.createDiagnosticCollection('usdchecker');
  ctx.subscriptions.push(lintCol, checkCol);

  const scheduleLint = (doc: vscode.TextDocument) => {
    const key = doc.uri.toString();
    const prev = debounce.get(key);
    if (prev) clearTimeout(prev);
    debounce.set(key, setTimeout(() => { debounce.delete(key); runLints(doc); }, 300));
  };

  ctx.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(d => runLints(d)),
    vscode.workspace.onDidChangeTextDocument(e => scheduleLint(e.document)),
    vscode.workspace.onDidSaveTextDocument(d => { runLints(d); void runUsdchecker(d); }),
    vscode.workspace.onDidCloseTextDocument(d => { lintCol.delete(d.uri); checkCol.delete(d.uri); })
  );

  for (const d of vscode.workspace.textDocuments) runLints(d);
}
