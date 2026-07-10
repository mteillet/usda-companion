import { parseUsda, PrimNode } from './parse';
import { primPathIndex } from './context';

export type Severity = 'error' | 'warning' | 'info';

export interface Lint {
  line: number;        // 0-based
  severity: Severity;
  message: string;
  code: string;
}

const ORDER_RE = /\bxformOpOrder\b\s*=\s*\[([^\]]*)\]/;
const TOKEN_RE = /"([^"]+)"/g;
// A typed attribute declaration whose name is xformOp:<...> (not xformOpOrder).
const ATTR_RE = /(?:^|\s)(?:custom\s+)?(?:uniform\s+|varying\s+)?[A-Za-z][\w]*(?:\[\])?\s+(xformOp:[\w:]+?)(?:\.[\w:]+)?\s*=/;

function baseOp(token: string): string | null {
  let t = token.trim();
  if (t === '!resetXformStack!') return null;
  if (t.startsWith('!invert!')) t = t.slice('!invert!'.length);
  return t || null;
}

function lintXformOps(lines: string[], prim: PrimNode, out: Lint[]): void {
  const childRanges = prim.children.map(c => [c.startLine, c.endLine] as [number, number]);
  const inChild = (i: number) => childRanges.some(([s, e]) => i >= s && i <= e);

  let orderLine = -1;
  let orderTokens: string[] | null = null;
  const attrs = new Map<string, number>(); // xformOp name -> declaration line

  for (let i = prim.startLine; i <= prim.endLine && i < lines.length; i++) {
    if (inChild(i)) continue;
    const line = lines[i];
    if (orderTokens === null) {
      const mo = ORDER_RE.exec(line);
      if (mo) {
        orderLine = i;
        orderTokens = [];
        TOKEN_RE.lastIndex = 0;
        let mt: RegExpExecArray | null;
        while ((mt = TOKEN_RE.exec(mo[1])) !== null) orderTokens.push(mt[1]);
      }
    }
    const ma = ATTR_RE.exec(line);
    if (ma && ma[1] !== 'xformOpOrder') attrs.set(ma[1], i);
  }

  if (orderTokens === null && attrs.size === 0) return;

  // Order entries with no matching attribute in THIS layer (only meaningful when
  // some xformOp attrs are present here — otherwise they likely live in a
  // referenced/sublayered spec and we'd false-positive).
  if (orderTokens !== null && attrs.size > 0) {
    for (const tok of orderTokens) {
      const base = baseOp(tok);
      if (base && !attrs.has(base)) {
        out.push({
          line: orderLine,
          severity: 'warning',
          code: 'xformOpOrder/missing-attr',
          message: `xformOpOrder lists "${tok}" but no attribute "${base}" is defined on this prim (in this layer).`,
        });
      }
    }
  }

  // Defined xformOp attrs missing from the order (won't be applied).
  if (orderTokens !== null) {
    const ordered = new Set(orderTokens.map(baseOp).filter((b): b is string => !!b));
    for (const [name, ln] of attrs) {
      if (!ordered.has(name)) {
        out.push({
          line: ln,
          severity: 'warning',
          code: 'xformOpOrder/not-ordered',
          message: `"${name}" is not listed in xformOpOrder, so it won't be applied.`,
        });
      }
    }
  }
}

function lintDuplicateDefs(children: PrimNode[], out: Lint[]): void {
  const byName = new Map<string, PrimNode[]>();
  for (const c of children) {
    if (c.kind !== 'prim') continue;
    const arr = byName.get(c.name);
    if (arr) arr.push(c);
    else byName.set(c.name, [c]);
  }
  for (const [name, nodes] of byName) {
    const defs = nodes.filter(n => n.specifier === 'def');
    if (defs.length >= 2) {
      for (const n of defs) {
        out.push({
          line: n.startLine,
          severity: 'warning',
          code: 'duplicate-def',
          message: `Duplicate "def" of "${name}" under the same scope (${defs.length} definitions in this layer).`,
        });
      }
    }
  }
}

export function lintUsda(text: string): Lint[] {
  const lines = text.split(/\r?\n/);
  const roots = parseUsda(text);
  const out: Lint[] = [];
  lintDuplicateDefs(roots, out);
  const walk = (n: PrimNode) => {
    if (n.kind === 'prim') lintXformOps(lines, n, out);
    lintDuplicateDefs(n.children, out);
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  out.sort((a, b) => a.line - b.line);
  return out;
}

export interface Finding {
  line: number; // 0-based; best-effort, falls back to 0 for stage-level messages
  message: string;
}

// Map usdchecker stdout/stderr lines to document positions. File-level messages
// land on line 0; messages naming an @asset@ or a </prim> are placed on the
// matching line when found.
export function parseUsdchecker(out: string, text: string): Finding[] {
  const docLines = text.split(/\r?\n/);
  const idx = primPathIndex(text);
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const isFinding =
      /\(fails '[^']+'\)/.test(line) ||
      /^error\b/i.test(line) ||
      /^warning\b/i.test(line) ||
      /^could not\b/i.test(line);
    if (!isFinding) continue;

    let ln = 0;
    const candidates: string[] = [];
    let mm: RegExpExecArray | null;
    const atRe = /@([^@]+)@/g;
    while ((mm = atRe.exec(line)) !== null) candidates.push(mm[1]);
    const qRe = /'([^']+)'/g;
    while ((mm = qRe.exec(line)) !== null) candidates.push(mm[1]);
    for (const c of candidates) {
      const f = docLines.findIndex(l => l.includes(c));
      if (f >= 0) { ln = f; break; }
    }
    if (ln === 0) {
      const pm = /<([^<>]+)>/.exec(line);
      if (pm) {
        const f = idx.get(pm[1].split('.')[0]);
        if (f !== undefined) ln = f;
      }
    }
    const key = ln + '|' + line;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ line: ln, message: line });
  }
  return findings;
}
