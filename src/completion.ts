import * as vscode from 'vscode';
import { cachedSchemas, ensureSchemas, propsForPrim, findProp } from './schema';
import { enclosingPrim, enclosingPrimType, primApiSchemas, attributeForValue, wordBefore } from './context';

// Namespaced relationships the registry under-exposes but are common in practice.
const CURATED: { name: string; detail: string }[] = [
  { name: 'material:binding', detail: 'rel · material binding' },
  { name: 'material:binding:preview', detail: 'rel · material binding (preview)' },
  { name: 'material:binding:full', detail: 'rel · material binding (full)' },
];

const TYPE_KEYWORDS = [
  'float', 'double', 'half', 'int', 'int64', 'uint', 'bool', 'string', 'token', 'asset',
  'float2', 'float3', 'float4', 'double2', 'double3', 'double4', 'int2', 'int3', 'int4',
  'color3f', 'color4f', 'normal3f', 'point3f', 'vector3f', 'texCoord2f', 'texCoord3f',
  'matrix4d', 'quatf', 'quatd', 'frame4d',
];

export class UsdaCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    doc: vscode.TextDocument,
    pos: vscode.Position
  ): Promise<vscode.CompletionItem[]> {
    const data = cachedSchemas() ?? (await ensureSchemas());
    if (!data) return [];

    const text = doc.getText();
    const line = doc.lineAt(pos.line).text;
    const prefix = line.slice(0, pos.character);
    const wb = wordBefore(prefix);
    const replace = new vscode.Range(pos.line, pos.character - wb.length, pos.line, pos.character);

    // 1) prim type after def / over / class
    if (/(?:^|\s)(?:def|over|class)\s+[A-Za-z_]*$/.test(prefix)) {
      return Object.keys(data.concrete).sort().map(name => {
        const it = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
        it.detail = 'USD type';
        it.range = replace;
        const d = data.concrete[name].doc;
        if (d) it.documentation = new vscode.MarkdownString(d);
        return it;
      });
    }

    const type = enclosingPrimType(text, pos.line);
    const prim = enclosingPrim(text, pos.line);
    const apiBases = prim ? primApiSchemas(text, prim) : [];

    // 2) allowedTokens value completion (e.g. visibility = "<here>")
    const attr = attributeForValue(line, pos.character);
    if (attr) {
      const prop = findProp(data, type, apiBases, attr);
      if (prop?.allowed?.length) {
        const valRegion = line.slice(line.indexOf('=') + 1, pos.character);
        const inQuotes = ((valRegion.match(/"/g) || []).length % 2) === 1;
        return prop.allowed.map(tok => {
          const it = new vscode.CompletionItem(tok, vscode.CompletionItemKind.EnumMember);
          it.detail = `${attr} value`;
          it.insertText = inQuotes ? tok : `"${tok}"`;
          return it;
        });
      }
      return []; // inside a value but no enum: don't suggest property names
    }

    // 3) property names inside a prim body
    if (prim) {
      const items: vscode.CompletionItem[] = [];
      for (const p of propsForPrim(data, type, apiBases)) {
        const it = new vscode.CompletionItem(
          p.name,
          p.kind === 'rel' ? vscode.CompletionItemKind.Reference : vscode.CompletionItemKind.Field
        );
        it.detail = p.kind === 'rel' ? 'rel' : (p.type ?? 'attr');
        it.range = replace;
        const md: string[] = [];
        if (p.doc) md.push(p.doc);
        if (p.allowed?.length) md.push(`\nAllowed: ${p.allowed.join(', ')}`);
        if (md.length) it.documentation = new vscode.MarkdownString(md.join('\n'));
        items.push(it);
      }
      const have = new Set(items.map(i => i.label as string));
      for (const c of CURATED) {
        if (!have.has(c.name)) {
          const it = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Reference);
          it.detail = c.detail;
          it.range = replace;
          items.push(it);
        }
      }
      for (const tk of TYPE_KEYWORDS) {
        const it = new vscode.CompletionItem(tk, vscode.CompletionItemKind.Keyword);
        it.detail = 'type';
        it.range = replace;
        it.sortText = `zz_${tk}`; // keep type keywords below schema properties
        items.push(it);
      }
      return items;
    }

    return [];
  }
}
