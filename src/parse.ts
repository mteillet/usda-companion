// Heuristic structural parser for USD ASCII (.usda).
//
// This is intentionally a *text* parser: it carries zero dependency on a USD
// runtime so the extension works in any studio out of the box. It is good
// enough for an outline / folding view of typical, well-formatted files.
// Accurate composition-aware parsing arrives with the optional pxr backend
// (roadmap P1+). Known limitations: one spec header per line is assumed, and
// pathological cases (e.g. the literal word `def "x" {` inside a string value)
// can produce a false positive.

export type PrimKind = 'prim' | 'variantSet' | 'variant';

export interface PrimNode {
  specifier: string;        // 'def' | 'over' | 'class' | 'variantSet' | 'variant'
  typeName?: string;        // e.g. 'Xform', 'Mesh', 'SphereLight' — undefined for typeless / variantSet / variant
  name: string;
  kind: PrimKind;
  startLine: number;        // 0-based, the header line
  endLine: number;          // 0-based, the closing brace line
  children: PrimNode[];
}

type Spec =
  | { kind: 'prim'; specifier: string; typeName?: string; name: string; headerLine: number }
  | { kind: 'variantSet'; name: string; headerLine: number }
  | { kind: 'bare'; name: string; headerLine: number }; // a quoted name that opens a block (variant candidate)

const PRIM_RE = /\b(def|over|class)\b[ \t]*(?:([A-Za-z_][\w:]*)[ \t]+)?"([^"]*)"/;
const VARIANTSET_RE = /\bvariantSet[ \t]+"([^"]*)"[ \t]*=/;
const BARE_RE = /^[ \t]*"([^"]*)"[ \t]*[\(\{]/;

function detectSpec(line: string, lineNo: number): Spec | null {
  const candidates: { idx: number; spec: Spec }[] = [];
  const vs = VARIANTSET_RE.exec(line);
  if (vs) candidates.push({ idx: vs.index, spec: { kind: 'variantSet', name: vs[1], headerLine: lineNo } });
  const p = PRIM_RE.exec(line);
  if (p) candidates.push({ idx: p.index, spec: { kind: 'prim', specifier: p[1], typeName: p[2], name: p[3], headerLine: lineNo } });
  const b = BARE_RE.exec(line);
  if (b) candidates.push({ idx: b.index, spec: { kind: 'bare', name: b[1], headerLine: lineNo } });
  if (candidates.length === 0) return null;
  // The leftmost token is the one that owns this line's block (e.g. a variant
  // name `"high" {` that precedes an inline `def` on the same line).
  candidates.sort((a, b) => a.idx - b.idx);
  return candidates[0].spec;
}

interface Frame {
  node: PrimNode | null; // null = anonymous/dictionary block we only track for balancing
  braceDepthAfterOpen: number;
}

export function parseUsda(text: string): PrimNode[] {
  const lines = text.split(/\r?\n/);
  const roots: PrimNode[] = [];
  const stack: Frame[] = [];

  let braceDepth = 0;
  let parenDepth = 0;
  let pending: Spec | null = null;

  // multi-line lexer state
  let inTriple = false;     // inside """ ... """
  let tripleQuote = '"';
  let inAsset = false;      // inside @ ... @ or @@@ ... @@@
  let assetTriple = false;

  const currentParent = (): PrimNode | null => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].node) return stack[i].node;
    }
    return null;
  };

  const attach = (node: PrimNode) => {
    const parent = currentParent();
    if (parent) parent.children.push(node);
    else roots.push(node);
  };

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo];

    // Detect a spec header on this (raw) line before scanning braces, so the
    // line's first depth-0 '{' can adopt it. Skip detection while a multi-line
    // string/asset is still open.
    if (!inTriple && !inAsset) {
      const spec = detectSpec(line, lineNo);
      if (spec) pending = spec;
    }

    let i = 0;
    const n = line.length;
    while (i < n) {
      const c = line[i];

      if (inTriple) {
        if (c === tripleQuote && line.startsWith(tripleQuote.repeat(3), i)) {
          inTriple = false;
          i += 3;
          continue;
        }
        i++;
        continue;
      }
      if (inAsset) {
        const close = assetTriple ? '@@@' : '@';
        if (line.startsWith(close, i)) {
          inAsset = false;
          i += close.length;
          continue;
        }
        i++;
        continue;
      }

      // comment to end of line
      if (c === '#') break;

      // string starts
      if (c === '"' || c === "'") {
        if (line.startsWith(c.repeat(3), i)) {
          inTriple = true;
          tripleQuote = c;
          i += 3;
          continue;
        }
        // single-line string: skip to matching unescaped quote
        i++;
        while (i < n) {
          if (line[i] === '\\') { i += 2; continue; }
          if (line[i] === c) { i++; break; }
          i++;
        }
        continue;
      }

      // asset ref starts
      if (c === '@') {
        if (line.startsWith('@@@', i)) { inAsset = true; assetTriple = true; i += 3; continue; }
        inAsset = true; assetTriple = false; i += 1; continue;
      }

      if (c === '(') { parenDepth++; i++; continue; }
      if (c === ')') { if (parenDepth > 0) parenDepth--; i++; continue; }

      // Only treat braces as block delimiters outside metadata parentheses.
      // Braces inside ( ) are dictionaries; braces inside a prim body that are
      // not block openers (timeSamples, dicts) balance via anonymous frames.
      if (parenDepth === 0 && c === '{') {
        braceDepth++;
        if (pending) {
          let node: PrimNode | null = null;
          if (pending.kind === 'prim') {
            node = { specifier: pending.specifier, typeName: pending.typeName, name: pending.name,
                     kind: 'prim', startLine: pending.headerLine, endLine: pending.headerLine, children: [] };
          } else if (pending.kind === 'variantSet') {
            node = { specifier: 'variantSet', name: pending.name, kind: 'variantSet',
                     startLine: pending.headerLine, endLine: pending.headerLine, children: [] };
          } else if (pending.kind === 'bare') {
            const parent = currentParent();
            if (parent && parent.kind === 'variantSet') {
              node = { specifier: 'variant', name: pending.name, kind: 'variant',
                       startLine: pending.headerLine, endLine: pending.headerLine, children: [] };
            }
          }
          if (node) attach(node);
          stack.push({ node, braceDepthAfterOpen: braceDepth });
          pending = null;
        } else {
          stack.push({ node: null, braceDepthAfterOpen: braceDepth });
        }
        i++;
        continue;
      }
      if (parenDepth === 0 && c === '}') {
        if (stack.length && stack[stack.length - 1].braceDepthAfterOpen === braceDepth) {
          const frame = stack.pop()!;
          if (frame.node) frame.node.endLine = lineNo;
        }
        if (braceDepth > 0) braceDepth--;
        i++;
        continue;
      }

      i++;
    }
  }

  return roots;
}
