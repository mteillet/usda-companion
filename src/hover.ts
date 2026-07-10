import * as vscode from 'vscode';
import { cachedSchemas, ensureSchemas, findProp } from './schema';
import { enclosingPrim, enclosingPrimType, primApiSchemas, primPathIndex } from './context';
import { buildRelations, primAtLine, collectionsContaining, effectiveBindings, enclosingPrimPath } from './relations';
import { pathAt } from './assets';

const COLL_SUFFIX_RE = /^collection:(.+):(includes|excludes|expansionRule|includeRoot|membershipExpression)$/;

// Resolve the collection path under the cursor: a </prim.collection:NAME>
// reference, or a `collection:NAME:...` property on its declaring prim.
function detectCollection(text: string, doc: vscode.TextDocument, pos: vscode.Position, word: string): string | null {
  const p = pathAt(doc.lineAt(pos.line).text, pos.character);
  if (p && p.includes('.collection:')) return p;
  if (word.startsWith('collection:')) {
    const m = COLL_SUFFIX_RE.exec(word);
    const instance = m ? m[1] : word.slice('collection:'.length);
    if (!instance) return null;
    const prim = enclosingPrimPath(text, pos.line);
    if (prim) return `${prim}.collection:${instance}`;
  }
  return null;
}

function revealLink(label: string, uri: vscode.Uri, line: number): string {
  const arg = encodeURIComponent(JSON.stringify([{ uri: uri.toString(), line }]));
  return `[${label}](command:usda.revealLocation?${arg})`;
}
const MAX = 12;

export class UsdaHoverProvider implements vscode.HoverProvider {
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    const text = doc.getText();
    const range = doc.getWordRangeAtPosition(pos, /[A-Za-z_][\w:]*/);
    if (!range) return undefined;
    const word = doc.getText(range);

    const data = cachedSchemas();
    if (!data) void ensureSchemas();

    // 1) Hovering a prim's declaration name -> type doc (if known) + relations.
    const at = primAtLine(text, pos.line);
    if (at && word === at.node.name) {
      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      const t = at.node.typeName;
      md.appendCodeblock(`${at.node.specifier}${t ? ` ${t}` : ''} "${at.node.name}"`, 'usda');
      if (data && t && data.concrete[t]?.doc) md.appendMarkdown(`\n\n${data.concrete[t].doc}`);

      const idx = buildRelations(text);
      const paths = primPathIndex(text);
      const memberOf = collectionsContaining(idx, at.path);
      const eff = effectiveBindings(idx, at.path);
      const inc = (idx.byTarget.get(at.path) || []).filter(e => !/^collection:.+:includes$/.test(e.relName));
      const out = idx.byFrom.get(at.path) || [];

      if (memberOf.length) {
        md.appendMarkdown(`\n\n**Member of collections** (${memberOf.length})`);
        for (const c of memberOf.slice(0, MAX)) {
          md.appendMarkdown(`\n- \`${c.instance}\` on \`${c.onPrim}\` · ${revealLink('jump', doc.uri, c.line)}`);
        }
      }
      if (eff.length) {
        md.appendMarkdown(`\n\n**Bound via collection** (${eff.length})`);
        for (const e of eff.slice(0, MAX)) {
          const tline = paths.get(e.boundPath);
          const link = tline !== undefined ? ` · ${revealLink('jump → target', doc.uri, tline)}` : ` · ${revealLink('jump → binding', doc.uri, e.line)}`;
          md.appendMarkdown(`\n- \`${e.bindingName}\` via \`${e.instance}\` → \`${e.boundPath}\`${link}`);
        }
      }
      if (inc.length) {
        md.appendMarkdown(`\n\n**Referenced by** (${inc.length})`);
        for (const e of inc.slice(0, MAX)) {
          md.appendMarkdown(`\n- \`${e.relName}\` on \`${e.fromPath}\` · ${revealLink('jump', doc.uri, e.line)}`);
        }
        if (inc.length > MAX) md.appendMarkdown(`\n- … +${inc.length - MAX} more — Shift+F12`);
      }
      if (out.length) {
        md.appendMarkdown(`\n\n**Points to** (${out.length})`);
        for (const e of out.slice(0, MAX)) {
          const tline = paths.get(e.targetPath);
          const link = tline !== undefined ? ` · ${revealLink('jump', doc.uri, tline)}` : ' · _(not in this file)_';
          md.appendMarkdown(`\n- \`${e.relName}\` → \`${e.targetPath}\`${link}`);
        }
        if (out.length > MAX) md.appendMarkdown(`\n- … +${out.length - MAX} more`);
      }
      if (!memberOf.length && !eff.length && !inc.length && !out.length) {
        md.appendMarkdown('\n\n_No relationships found in this file._');
      }
      return new vscode.Hover(md, range);
    }

    // 2) Hovering a collection -> its members + bindings on it.
    const collPath = detectCollection(text, doc, pos, word);
    if (collPath) {
      const idx = buildRelations(text);
      const paths = primPathIndex(text);
      const info = idx.collections.get(collPath);
      const bindings = idx.collBindings.filter(b => b.collectionPath === collPath);
      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      const instance = info ? info.instance : collPath.split('.collection:')[1] ?? collPath;
      md.appendCodeblock(`collection:${instance}`, 'usda');
      if (info?.onPrim) md.appendMarkdown(`\n\non \`${info.onPrim}\``);

      if (info && info.includes.length) {
        md.appendMarkdown(`\n\n**Includes** (${info.includes.length})`);
        for (const t of info.includes.slice(0, MAX)) {
          const tl = paths.get(t);
          md.appendMarkdown(`\n- \`${t}\`${tl !== undefined ? ` · ${revealLink('jump', doc.uri, tl)}` : ''}`);
        }
      }
      if (info && info.excludes.length) {
        md.appendMarkdown(`\n\n**Excludes** (${info.excludes.length})`);
        for (const t of info.excludes.slice(0, MAX)) {
          const tl = paths.get(t);
          md.appendMarkdown(`\n- \`${t}\`${tl !== undefined ? ` · ${revealLink('jump', doc.uri, tl)}` : ''}`);
        }
      }
      if (bindings.length) {
        md.appendMarkdown(`\n\n**Bindings on this collection** (${bindings.length})`);
        for (const b of bindings.slice(0, MAX)) {
          const tl = paths.get(b.boundPath);
          const link = tl !== undefined ? ` · ${revealLink('jump → target', doc.uri, tl)}` : ` · ${revealLink('jump → binding', doc.uri, b.line)}`;
          md.appendMarkdown(`\n- \`${b.bindingName}\` → \`${b.boundPath}\`${link}`);
        }
      }
      if (!info && !bindings.length) {
        md.appendMarkdown('\n\n_Collection definition not found in this file._');
      }
      return new vscode.Hover(md, range);
    }

    if (!data) return undefined;
    const type = data.concrete[word];
    if (type) {
      const md = new vscode.MarkdownString();
      md.appendCodeblock(word, 'usda');
      if (type.doc) md.appendMarkdown(`\n\n${type.doc}`);
      return new vscode.Hover(md, range);
    }

    const typeName = enclosingPrimType(text, pos.line);
    const prim = enclosingPrim(text, pos.line);
    const apiBases = prim ? primApiSchemas(text, prim) : [];
    const prop = findProp(data, typeName, apiBases, word);
    if (prop) {
      const md = new vscode.MarkdownString();
      const head = prop.kind === 'rel' ? `rel ${prop.name}` : `${prop.type ?? 'attribute'} ${prop.name}`;
      md.appendCodeblock(head, 'usda');
      if (prop.allowed?.length) md.appendMarkdown(`\n\nAllowed: ${prop.allowed.map(a => '`' + a + '`').join(', ')}`);
      if (prop.doc) md.appendMarkdown(`\n\n${prop.doc}`);
      return new vscode.Hover(md, range);
    }

    return undefined;
  }
}
