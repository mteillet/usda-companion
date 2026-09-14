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
 * Remove only the `active = false` opinion from a prim's header, keeping any other
 * metadata and the whole `{ ... }` body. Returns the replacement lines for the
 * header span [startLine .. openBraceLine] and that end line. Pure.
 */
function stripActiveFalse(lines: string[], startLine: number): { newLines: string[]; endLine: number } {
  const open = findOpenBrace(lines, startLine);
  const endLine = open ? open.line : startLine;
  const endCol = open ? open.col : lines[endLine].length;

  const parts: string[] = [];
  for (let ln = startLine; ln <= endLine; ln++) {
    parts.push(ln === endLine ? lines[ln].slice(0, endCol) : lines[ln]);
  }
  let prefix = parts.join('\n');
  const tail = open ? lines[endLine].slice(endCol) : '';

  const before = prefix;
  // (a) the parens hold nothing but `active = false` -> drop the whole `( ... )`
  prefix = prefix.replace(/\(\s*active\s*=\s*false\s*\)/, '');
  if (prefix === before) {
    // (b) drop just the `active = false` entry (with an optional trailing comment)
    prefix = prefix.replace(/\n?[ \t]*active[ \t]*=[ \t]*false\b[ \t]*(?:#[^\n]*)?(?=\n|$)/, '');
    prefix = prefix.replace(/\(\s*\)/, ''); // parens emptied by the removal
  }

  let combined = prefix + tail;
  combined = combined.replace(/(\S)[ \t]{2,}(\{)/g, '$1 $2'); // tidy `over "x"   {}` -> `over "x" {}`
  const newLines = combined.split('\n').map(s => s.replace(/[ \t]+$/, ''));
  return { newLines, endLine };
}

/**
 * Remove the `active = false` opinion from each selected prim — never the rest of
 * the block. Any other metadata and the body are kept intact, so a prim that also
 * declares/overrides things survives (only its deactivation is lifted). Afterwards,
 * `over` prims that are now completely empty scaffolding are cleaned up: the
 * selected prims themselves, and — when `pruneEmptyParents` is on — their empty
 * `over` ancestors (e.g. an `over "Vars" {}` left behind). Pure.
 */
export function removeDeactivations(text: string, targets: Deactivation[], pruneEmptyParents = true): string {
  if (targets.length === 0) return text;

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let lines = text.split(/\r?\n/);

  // Pass 1 — strip `active = false`. Bottom-up so earlier line indices stay valid.
  for (const t of [...targets].sort((a, b) => b.startLine - a.startLine)) {
    const { newLines, endLine } = stripActiveFalse(lines, t.startLine);
    lines.splice(t.startLine, endLine - t.startLine + 1, ...newLines);
  }

  // Paths that may be removed *if* they end up empty: the selected prims, plus
  // their `over` ancestors when pruning is enabled.
  const removable = new Set<string>(targets.map(t => t.path));
  if (pruneEmptyParents) {
    for (const t of targets) {
      let p = t.parentPath;
      while (p && p !== '/') { removable.add(p); p = p.slice(0, p.lastIndexOf('/')) || '/'; }
    }
  }

  // Pass 2 — drop now-empty `over` scaffolding. Re-parse each pass, since emptying
  // a child can empty its parent. Only pure `over` scaffolding is touched: no
  // metadata of its own and an empty body. Blocks with content are left alone.
  for (let pass = 0; pass < 32; pass++) {
    const cur = lines.join(eol);
    const roots = parseUsda(cur);
    const curLines = cur.split(/\r?\n/);
    const doomed: LineRange[] = [];
    walk(roots, '', (n, path) => {
      if (n.specifier !== 'over' || !removable.has(path)) return;
      if (HAS_METADATA_RE.test(headerText(curLines, n))) return; // keeps its own metadata
      if (hasEmptyBody(curLines, n)) doomed.push({ startLine: n.startLine, endLine: n.endLine });
    });
    if (!doomed.length) break;
    const res = deleteLines(curLines, dropNested(doomed));
    lines = collapseBlanksAt(res.lines, res.junctions);
  }

  return lines.join(eol);
}

/**
 * Split deactivations into those whose prim *name* starts with `prefix` and the
 * rest, keeping document order inside each group. An empty prefix disables the
 * split: everything comes back as `others`. Pure.
 */
export function partitionByPrefix(
  found: Deactivation[],
  prefix: string
): { matching: Deactivation[]; others: Deactivation[] } {
  if (!prefix) return { matching: [], others: found.slice() };
  const matching: Deactivation[] = [];
  const others: Deactivation[] = [];
  for (const d of found) (d.name.startsWith(prefix) ? matching : others).push(d);
  return { matching, others };
}

/**
 * Toggle a whole group inside a selection: tick every row of `group` while any is
 * still unticked, untick them all once the group is complete. Rows outside the
 * group keep their state, so the groups act as independent switches. Pure.
 */
export function toggleGroup<T>(selected: readonly T[], group: readonly T[]): T[] {
  if (group.length === 0) return selected.slice();
  const picked = new Set(selected);
  if (group.every(g => picked.has(g))) {
    const inGroup = new Set(group);
    return selected.filter(s => !inGroup.has(s));
  }
  const out = selected.slice();
  for (const g of group) if (!picked.has(g)) out.push(g);
  return out;
}

// ---------------------------------------------------------------------------
// VS Code wiring
// ---------------------------------------------------------------------------

function isUsdDoc(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'usd' || /\.usda?$/i.test(doc.fileName);
}

/** A picker row. Section separators carry no `deac`. */
interface Item extends vscode.QuickPickItem {
  deac?: Deactivation;
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

  const prefix = vscode.workspace.getConfiguration('usda').get<string>('deactivations.groupPrefix', 'LGT_');
  const { matching, others } = partitionByPrefix(found, prefix);

  const toItem = (d: Deactivation): Item => ({
    label: `$(circle-slash) ${d.name}`,
    description: d.parentPath === '/' ? '' : d.parentPath,
    detail: `${d.specifier} — line ${d.startLine + 1}${d.endLine > d.startLine ? `–${d.endLine + 1}` : ''}`,
    deac: d,
  });
  const separator = (label: string): Item => ({ label, kind: vscode.QuickPickItemKind.Separator });

  const matchItems = matching.map(toItem);
  const otherItems = others.map(toItem);
  // Label the two sections only when both are populated — a single group reads
  // better with no header at all.
  const items: Item[] = matchItems.length && otherItems.length
    ? [
        separator(`${prefix} — ${matchItems.length}`), ...matchItems,
        separator(`Other — ${otherItems.length}`), ...otherItems,
      ]
    : [...matchItems, ...otherItems];

  const qp = vscode.window.createQuickPick<Item>();
  qp.title = `Deactivated prims (active = false) — ${found.length} found`;
  qp.placeholder = 'Check the ones to re-activate (removes active = false), then Enter (Esc to cancel)';
  qp.items = items;
  qp.canSelectMany = true;
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;

  // One title button per section: ticks that whole group in a click, leaving the
  // other group's ticks alone, and unticks it when pressed again. (The check-all
  // box beside the filter is VS Code's own widget and still ticks every row.)
  const groups: { button: vscode.QuickInputButton; rows: Item[] }[] = [];
  const addGroup = (rows: Item[], icon: string, what: string) => {
    if (!rows.length) return;
    groups.push({
      button: { iconPath: new vscode.ThemeIcon(icon), tooltip: `Select all ${what} (${rows.length}) — again to clear` },
      rows,
    });
  };
  addGroup(matchItems, 'check-all', prefix);
  addGroup(otherItems, 'checklist', 'Other');

  if (groups.length) {
    qp.buttons = groups.map(g => g.button);
    qp.onDidTriggerButton(b => {
      const group = groups.find(g => g.button === b);
      if (group) qp.selectedItems = toggleGroup(qp.selectedItems, group.rows);
    });
  }

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
  const picked = chosen.filter((c): c is Item & { deac: Deactivation } => !!c.deac);
  if (picked.length === 0) return;

  const prune = vscode.workspace.getConfiguration('usda').get<boolean>('deactivations.pruneEmptyParents', true);
  const label = picked.length === 1 ? `"${picked[0].deac.name}"` : `${picked.length} prims`;
  const confirm = await vscode.window.showWarningMessage(
    `Remove \`active = false\` from ${label}?`,
    {
      modal: true,
      detail: 'Only the deactivation is removed; any other metadata or contents are kept. '
        + (prune ? 'Emptied `over` scaffolding (including a leftover parent) is cleaned up.' : ''),
    },
    'Remove'
  );
  if (confirm !== 'Remove') return;

  // Re-read the text at apply time in case the document changed while picking.
  const current = doc.getText();
  const fresh = findDeactivations(current);
  const wanted = new Set(picked.map(c => c.deac.path));
  const targets = fresh.filter(d => wanted.has(d.path));
  if (targets.length === 0) {
    vscode.window.showWarningMessage('USDA: the selected prims no longer exist (file changed).');
    return;
  }

  const next = removeDeactivations(current, targets, prune);
  const whole = new vscode.Range(doc.positionAt(0), doc.positionAt(current.length));
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, whole, next);
  const applied = await vscode.workspace.applyEdit(edit);
  if (applied) {
    vscode.window.setStatusBarMessage(`USDA: removed active = false from ${targets.length} prim(s)`, 4000);
  } else {
    vscode.window.showErrorMessage('USDA: could not apply the edit.');
  }
}
