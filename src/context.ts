import { parseUsda, PrimNode } from './parse';

// Deepest prim spec (kind 'prim') whose block contains the given 0-based line.
export function enclosingPrim(text: string, line: number): PrimNode | null {
  let found: PrimNode | null = null;
  const visit = (n: PrimNode) => {
    if (line < n.startLine || line > n.endLine) return;
    if (n.kind === 'prim') found = n;
    for (const c of n.children) visit(c);
  };
  for (const r of parseUsda(text)) visit(r);
  return found;
}

export function enclosingPrimType(text: string, line: number): string | null {
  const p = enclosingPrim(text, line);
  return p && p.typeName ? p.typeName : null;
}

// Extract applied API schema base names from a prim's metadata block. Handles
// `prepend apiSchemas = ["A", "B:inst"]`; instance suffixes are stripped to the
// base name. Only the header region (before the body `{`) is scanned.
export function primApiSchemas(text: string, prim: PrimNode): string[] {
  const lines = text.split(/\r?\n/);
  let header = '';
  let paren = 0;
  for (let i = prim.startLine; i < lines.length; i++) {
    const line = lines[i];
    let bodyOpen = false;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (c === '(') paren++;
      else if (c === ')') { if (paren > 0) paren--; }
      else if (c === '{' && paren === 0) { bodyOpen = true; break; }
    }
    header += line + '\n';
    if (bodyOpen) break;
  }
  const m = /\bapiSchemas\s*=\s*\[([^\]]*)\]/.exec(header);
  if (!m) return [];
  const names: string[] = [];
  const re = /"([^"]+)"/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(m[1])) !== null) {
    names.push(t[1].split(':')[0]);
  }
  return Array.from(new Set(names));
}

// Map of absolute prim paths (e.g. "/shot/lights/key") to their 0-based header
// line, for internal go-to-definition. Variant/variantSet nodes don't add path
// components (reference paths don't carry variant selectors).
export function primPathIndex(text: string): Map<string, number> {
  const idx = new Map<string, number>();
  const walk = (n: PrimNode, parent: string) => {
    let here = parent;
    if (n.kind === 'prim') {
      here = parent + '/' + n.name;
      if (!idx.has(here)) idx.set(here, n.startLine);
    }
    for (const c of n.children) walk(c, here);
  };
  for (const r of parseUsda(text)) walk(r, '');
  return idx;
}

// The property-name-ish word being typed at a cursor column (allows ':').
export function wordBefore(linePrefix: string): string {
  const m = /([\w:]+)$/.exec(linePrefix);
  return m ? m[1] : '';
}

// If the line is an attribute assignment and the cursor is in the value region,
// return the attribute name (suffix like .connect stripped); else null.
export function attributeForValue(lineText: string, col: number): string | null {
  const eq = lineText.indexOf('=');
  if (eq < 0 || col <= eq) return null;
  const before = lineText.slice(0, eq);
  const m = /(?:^|\s)([A-Za-z_][\w:]*)(?:\.[\w:]+)?\s*$/.exec(before);
  return m ? m[1] : null;
}
