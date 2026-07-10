import * as vscode from 'vscode';
import * as path from 'path';

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('usda');
}

function braceGlob(arr: string[]): string {
  return arr.length === 1 ? arr[0] : `{${arr.join(',')}}`;
}

function includeGlob(): string {
  const arr = cfg().get<string[]>('jumpToUsd.include', ['**/*.usda', '**/*.usd']);
  return braceGlob(arr.length ? arr : ['**/*.usda', '**/*.usd']);
}

function excludeGlob(): string | undefined {
  const arr = cfg().get<string[]>('jumpToUsd.exclude', ['**/node_modules/**', '**/.git/**']);
  return arr.length ? braceGlob(arr) : undefined;
}

/** USD file extensions to recognise, derived from the include globs so settings stay consistent. */
function usdExtsFromInclude(): string[] {
  const arr = cfg().get<string[]>('jumpToUsd.include', ['**/*.usda', '**/*.usd']);
  const exts = new Set<string>();
  for (const g of arr) {
    const m = g.match(/\.([A-Za-z0-9]+)$/);
    if (m) exts.add('.' + m[1].toLowerCase());
  }
  if (exts.size === 0) { exts.add('.usda'); exts.add('.usd'); }
  return [...exts];
}

/** Pure: does this path end with one of the given USD extensions? Unit-testable. */
export function isUsdPath(p: string, exts: string[]): boolean {
  const lower = p.toLowerCase();
  return exts.some(e => lower.endsWith(e));
}

/** Entry-point-ish stems that are a likely "the" file when several USD files exist. */
const ENTRY_NAMES = /^(asset|shot|scene|sequence|seq|main|payload|layer|build|root|usd)$/i;

/**
 * Score a USD-file candidate so the most likely "the file in this folder" sorts first.
 * Pure (no vscode/fs) so it can be unit-tested.
 */
export function scoreUsdCandidate(rel: string, file: string, refName: string): number {
  const stem = file.replace(/\.(usda|usd|usdc|usdz)$/i, '');
  const depth = rel.split(/[\\/]/).filter(Boolean).length - 1; // 0 == at the scope root
  let score = 0;
  if (depth <= 0) score += 50;
  score -= Math.max(0, depth) * 6;
  if (refName && stem.toLowerCase() === refName.toLowerCase()) score += 40;
  if (ENTRY_NAMES.test(stem)) score += 10;
  if (/\.usda$/i.test(file)) score += 8;
  else if (/\.usd$/i.test(file)) score += 4;
  return score;
}

async function statType(uri: vscode.Uri): Promise<vscode.FileType | undefined> {
  try { return (await vscode.workspace.fs.stat(uri)).type; } catch { return undefined; }
}

async function openUri(uri: vscode.Uri): Promise<void> {
  // Reveals/activates the tab if the file is already open; otherwise opens it.
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}

/** A short, readable directory tail for picker descriptions when there's no workspace. */
function shortDir(uri: vscode.Uri): string {
  const dir = path.dirname(uri.fsPath);
  const parts = dir.split(/[\\/]/).filter(Boolean);
  return parts.length <= 2 ? dir : '\u2026/' + parts.slice(-2).join('/');
}

/** All USD files currently open as editor tabs (across every tab group), de-duplicated. */
function openUsdTabs(exts: string[]): vscode.Uri[] {
  const out: vscode.Uri[] = [];
  const seen = new Set<string>();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as { uri?: vscode.Uri; modified?: vscode.Uri } | undefined;
      const uri = input?.uri ?? input?.modified; // plain text tab, or the modified side of a diff
      if (uri && uri.scheme === 'file' && isUsdPath(uri.fsPath, exts)) {
        const key = uri.toString();
        if (!seen.has(key)) { seen.add(key); out.push(uri); }
      }
    }
  }
  return out;
}

async function pickUris(uris: vscode.Uri[], placeHolder: string): Promise<void> {
  const items = uris.map(u => ({
    label: `$(file) ${path.basename(u.fsPath)}`,
    description: shortDir(u),
    uri: u,
  }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true });
  if (pick) await openUri(pick.uri);
}

/** Search the filesystem (a folder if `scopeDir` is set, else the whole workspace) and open/pick. */
async function findAndOpen(scopeDir: vscode.Uri | undefined, exts: string[]): Promise<void> {
  const include: vscode.GlobPattern = scopeDir
    ? new vscode.RelativePattern(scopeDir, includeGlob())
    : includeGlob();
  const uris = await vscode.workspace.findFiles(include, excludeGlob(), 5000);

  if (uris.length === 0) {
    const where = scopeDir ? `"${path.basename(scopeDir.fsPath)}"` : 'this workspace';
    vscode.window.showInformationMessage(`USDA: no USD file found in ${where}.`);
    return;
  }
  if (uris.length === 1) { await openUri(uris[0]); return; }

  const doStat = uris.length <= 200;
  const scopeName = scopeDir ? path.basename(scopeDir.fsPath) : '';
  type Cand = { uri: vscode.Uri; dir: string; score: number; mtime: number; rel: string };
  const cands: Cand[] = [];
  for (const uri of uris) {
    const wf = vscode.workspace.getWorkspaceFolder(uri);
    const baseDir = scopeDir ? scopeDir.fsPath : (wf ? wf.uri.fsPath : path.dirname(uri.fsPath));
    const rel = path.relative(baseDir, uri.fsPath) || path.basename(uri.fsPath);
    const refName = scopeName || (wf ? path.basename(wf.uri.fsPath) : '');
    const score = scoreUsdCandidate(rel, path.basename(uri.fsPath), refName);
    let mtime = 0;
    if (doStat) { try { mtime = (await vscode.workspace.fs.stat(uri)).mtime; } catch { /* ignore */ } }
    cands.push({ uri, dir: path.dirname(rel), score, mtime, rel });
  }
  cands.sort((a, b) => b.score - a.score || b.mtime - a.mtime || a.rel.localeCompare(b.rel));

  if (cfg().get<boolean>('jumpToUsd.openBestWhenMultiple', false)) { await openUri(cands[0].uri); return; }

  const items = cands.map(c => ({
    label: `$(file) ${path.basename(c.uri.fsPath)}`,
    description: c.dir === '.' ? '' : c.dir,
    uri: c.uri,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `Jump to USD file — ${cands.length} found (best match first)`,
    matchOnDescription: true,
  });
  if (pick) await openUri(pick.uri);
}

/**
 * Jump to the USD file.
 * - From the explorer context menu, `target` is the right-clicked folder -> search inside it.
 * - From the keybinding / command palette (no folder needed): jump to a USD file among the
 *   currently OPEN TABS first; if none are open, fall back to searching the workspace folder(s).
 * One match opens directly; several show a picker; none shows an info message.
 */
export async function jumpToUsd(target?: vscode.Uri): Promise<void> {
  const exts = usdExtsFromInclude();

  // Mode A: explicit folder (or file) from the explorer context menu.
  if (target) {
    const t = await statType(target);
    const dir = t === vscode.FileType.File ? vscode.Uri.file(path.dirname(target.fsPath)) : target;
    await findAndOpen(dir, exts);
    return;
  }

  // Mode B: open USD tabs — works with just a set of open files, no workspace required.
  const tabs = openUsdTabs(exts);
  if (tabs.length === 1) { await openUri(tabs[0]); return; }
  if (tabs.length > 1) {
    if (cfg().get<boolean>('jumpToUsd.openBestWhenMultiple', false)) { await openUri(tabs[0]); return; }
    await pickUris(tabs, `Jump to USD file — ${tabs.length} open`);
    return;
  }

  // Mode C: no USD tab open — fall back to the workspace folders if any are open.
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length) { await findAndOpen(undefined, exts); return; }

  vscode.window.showInformationMessage('USDA: no USD file open. Open a .usd/.usda file (or a folder) and try again.');
}
