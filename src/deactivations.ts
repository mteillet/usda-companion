import * as vscode from 'vscode';
import { parseUsda, PrimNode } from './parse';

/** A prim whose metadata deactivates it (`active = false`). */
export interface Deactivation {
  path: string;        // display path, e.g. /shot/Vars/key_light
  parentPath: string;  // '/shot/Vars'
  name: string;        // 'key_light'
  specifier: string;   // 'over' | 'def' | 'class'
  startLine: number;   // 0-based, the header line
  endLine: number;     // 0-based, the closing brace line
}

export interface LineRange { startLine: number; endLine: number; }

/** Drop `#` comments from a line, ignoring `#` inside quoted strings. */
function stripComment(line: string): string {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '#') return line.slice(0, i);
  }
  return line;
}

/**
 * Locate the `{` that opens the block whose header starts on `startLine`.
 * Returns its line/column, skipping strings, comments and metadata parens.
 */
function findOpenBrace(lines: string[], startLine: number): { line: number; col: number } | undefined {
  let paren = 0;
  for (let ln = startLine; ln < lines.length; ln++) {
    const raw = stripComment(lines[ln]);
    let q: string | null = null;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (q) {
        if (c === '\\') { i++; continue; }
        if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '(') { paren++; continue; }
      if (c === ')') { if (paren > 0) paren--; continue; }
      if (paren === 0 && c === '{') return { line: ln, col: i };
    }
  }
  return undefined;
}

/** The header text of a prim: everything from its header line up to its `{`. */
function headerText(lines: string[], node: PrimNode): string {
  const open = findOpenBrace(lines, node.startLine);
  const lastLine = open ? open.line : node.startLine;
  const parts: string[] = [];
  for (let ln = node.startLine; ln <= lastLine && ln < lines.length; ln++) {
    let s = stripComment(lines[ln]);
    if (ln === lastLine && open) s = s.slice(0, open.col);
    parts.push(s);
  }
  return parts.join('\n');
}

const ACTIVE_FALSE_RE = /\bactive\s*=\s*false\b/;
const HAS_METADATA_RE = /\(/;

/** True when the prim's metadata sets `active = false`. Pure. */
export function isDeactivated(lines: string[], node: PrimNode): boolean {
  return ACTIVE_FALSE_RE.test(headerText(lines, node));
}

/** True when nothing but whitespace sits between the prim's `{` and its `}`. Pure. */
export function hasEmptyBody(lines: string[], node: PrimNode): boolean {
  const open = findOpenBrace(lines, node.startLine);
  if (!open || open.line > node.endLine) return false;

  const closeIdx = lines[node.endLine].lastIndexOf('}');
  if (closeIdx < 0) return false;

  if (open.line === node.endLine) {
    return lines[node.endLine].slice(open.col + 1, closeIdx).trim() === '';
  }
  if (lines[open.line].slice(open.col + 1).trim() !== '') return false;
  if (lines[node.endLine].slice(0, closeIdx).trim() !== '') return false;
  for (let ln = open.line + 1; ln < node.endLine; ln++) {
    if (lines[ln].trim() !== '') return false;
  }
  return true;
}

function walk(nodes: PrimNode[], parentPath: string, visit: (n: PrimNode, path: string, parentPath: string) => void): void {
  for (const n of nodes) {
    let path: string;
    if (n.kind === 'variant') path = `${parentPath}{${n.name}}`;
    else if (n.kind === 'variantSet') path = parentPath; // transparent in paths
    else path = `${parentPath === '/' ? '' : parentPath}/${n.name}`;

    if (n.kind === 'prim') visit(n, path, parentPath === '' ? '/' : parentPath);
    walk(n.children, path, visit);
  }
}

/** All prims in the document deactivated via `active = false`, in document order. Pure. */
export function findDeactivations(text: string): Deactivation[] {
  const lines = text.split(/\r?\n/);
  const roots = parseUsda(text);
  const out: Deactivation[] = [];
  walk(roots, '', (n, path, parentPath) => {
    if (isDeactivated(lines, n)) {
      out.push({ path, parentPath, name: n.name, specifier: n.specifier, startLine: n.startLine, endLine: n.endLine });
    }
  });
  out.sort((a, b) => a.startLine - b.startLine);
  return out;
}

/** Remove whole line ranges (inclusive). Ranges must not overlap. Pure. */
function deleteLines(lines: string[], ranges: LineRange[]): { lines: string[]; junctions: number[] } {
  const drop = new Set<number>();
  for (const r of ranges) for (let ln = r.startLine; ln <= r.endLine; ln++) drop.add(ln);
  const kept: string[] = [];
  const junctions: number[] = [];
  let wasDropped = false;
  for (let i = 0; i < lines.length; i++) {
    if (drop.has(i)) { wasDropped = true; continue; }
    if (wasDropped) { junctions.push(kept.length); wasDropped = false; }
    kept.push(lines[i]);
  }
  return { lines: kept, junctions };
}

/**
 * At each cut point, collapse a blank-line pair left touching by the deletion
 * down to a single blank line. Only edits at the junctions, never elsewhere. Pure.
 */
function collapseBlanksAt(lines: string[], junctions: number[]): string[] {
  const out = [...lines];
  for (const j of [...junctions].sort((a, b) => b - a)) {
    while (j > 0 && j < out.length && out[j - 1].trim() === '' && out[j].trim() === '') {
      out.splice(j, 1);
    }
  }
  return out;
}

/** Discard ranges fully contained in another selected range, so parents win. Pure. */
function dropNested(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
  const kept: LineRange[] = [];
  for (const r of sorted) {
    const covered = kept.some(k => k.startLine <= r.startLine && r.endLine <= k.endLine);
    if (!covered) kept.push(r);
  }
  return kept;
}

/**
 * Delete the given deactivation blocks and, optionally, any now-empty `over`
 * scaffolding that used to hold them (e.g. an `over "Vars" {}` left behind).
 * Pruning is deliberately conservative: only `over` prims that are ancestors of
 * a deleted block, carry no metadata of their own, and end up with an empty body.
 * Pure — returns the new document text.
 */
export function removeDeactivations(text: string, targets: Deactivation[], pruneEmptyParents = true): string {
  if (targets.length === 0) return text;

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let lines = text.split(/\r?\n/);

  // Ancestor paths of everything we delete: prune candidates, longest first.
  const ancestors = new Set<string>();
  for (const t of targets) {
    let p = t.parentPath;
    while (p && p !== '/') { ancestors.add(p); p = p.slice(0, p.lastIndexOf('/')) || '/'; }
  }

  const first = deleteLines(lines, dropNested(targets.map(t => ({ startLine: t.startLine, endLine: t.endLine }))));
  lines = collapseBlanksAt(first.lines, first.junctions);

  if (pruneEmptyParents && ancestors.size) {
    // Re-parse after each pass: deleting a parent can empty its own parent.
    for (let pass = 0; pass < 16; pass++) {
      const cur = lines.join(eol);
      const roots = parseUsda(cur);
      const curLines = cur.split(/\r?\n/);
      const doomed: LineRange[] = [];
      walk(roots, '', (n, path) => {
        if (n.specifier !== 'over' || !ancestors.has(path)) return;
        if (HAS_METADATA_RE.test(headerText(curLines, n))) return; // keeps its own metadata: leave it
        if (hasEmptyBody(curLines, n)) doomed.push({ startLine: n.startLine, endLine: n.endLine });
      });
      if (!doomed.length) break;
      const pass2 = deleteLines(curLines, dropNested(doomed));
      lines = collapseBlanksAt(pass2.lines, pass2.junctions);
    }
  }

  return lines.join(eol);
}

// ---------------------------------------------------------------------------
// VS Code wiring
// ---------------------------------------------------------------------------

function isUsdDoc(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'usd' || /\.usda?$/i.test(doc.fileName);
}

interface Item extends vscode.QuickPickItem {
  deac: Deactivation;
}

export async function listDeactivations(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isUsdDoc(editor.document)) {
    vscode.window.showInformationMessage('USDA: open a .usda/.usd file first.');
    return;
  }
  const doc = editor.document;
  const found = findDeactivations(doc.getText());
  if (found.length === 0) {
    vscode.window.showInformationMessage('USDA: no deactivated prims (active = false) in this file.');
    return;
  }

  const items: Item[] = found.map(d => ({
    label: `$(circle-slash) ${d.name}`,
    description: d.parentPath === '/' ? '' : d.parentPath,
    detail: `${d.specifier} — line ${d.startLine + 1}${d.endLine > d.startLine ? `–${d.endLine + 1}` : ''}`,
    deac: d,
  }));

  const qp = vscode.window.createQuickPick<Item>();
  qp.title = `Deactivated prims (active = false) — ${found.length} found`;
  qp.placeholder = 'Check the ones to delete, then press Enter (Esc to cancel)';
  qp.items = items;
  qp.canSelectMany = true;
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;

  // Follow the highlighted entry in the editor.
  qp.onDidChangeActive(active => {
    const d = active[0]?.deac;
    if (!d) return;
    const range = new vscode.Range(d.startLine, 0, d.endLine, 0);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    editor.selection = new vscode.Selection(d.startLine, 0, d.startLine, 0);
  });

  const chosen = await new Promise<readonly Item[] | undefined>(resolve => {
    qp.onDidAccept(() => { resolve(qp.selectedItems); qp.hide(); });
    qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
    qp.show();
  });

  if (!chosen || chosen.length === 0) return;

  const prune = vscode.workspace.getConfiguration('usda').get<boolean>('deactivations.pruneEmptyParents', true);
  const label = chosen.length === 1 ? `"${chosen[0].deac.name}"` : `${chosen.length} blocks`;
  const confirm = await vscode.window.showWarningMessage(
    `Delete ${label}?`,
    { modal: true, detail: prune ? 'Empty `over` parents left behind are removed too.' : undefined },
    'Delete'
  );
  if (confirm !== 'Delete') return;

  // Re-read the text at apply time in case the document changed while picking.
  const current = doc.getText();
  const fresh = findDeactivations(current);
  const wanted = new Set(chosen.map(c => c.deac.path));
  const targets = fresh.filter(d => wanted.has(d.path));
  if (targets.length === 0) {
    vscode.window.showWarningMessage('USDA: the selected blocks no longer exist (file changed).');
    return;
  }

  const next = removeDeactivations(current, targets, prune);
  const whole = new vscode.Range(doc.positionAt(0), doc.positionAt(current.length));
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, whole, next);
  const applied = await vscode.workspace.applyEdit(edit);
  if (applied) {
    vscode.window.setStatusBarMessage(`USDA: deleted ${targets.length} deactivation block(s)`, 4000);
  } else {
    vscode.window.showErrorMessage('USDA: could not apply the edit.');
  }
}
