// Detects runs of consecutive property declarations sharing a namespace prefix
// (e.g. long blocks of `collection:*` or `material:binding*`) so the whole run
// can be folded as a single region. Independent of the prim-structure parser:
// it only tracks value-continuation via [] and () so it is never confused by
// prim-body braces.

export interface FoldGroup {
  start: number; // 0-based, inclusive
  end: number;   // 0-based, inclusive (> start)
}

interface LexState {
  inTriple: boolean;
  tripleQuote: string;
  inAsset: boolean;
  assetTriple: boolean;
}

// Replace string/asset/comment content with spaces (position-preserving) so it
// can't produce false prefix matches or unbalanced brackets.
function sanitize(line: string, st: LexState): string {
  let out = '';
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (st.inTriple) {
      if (c === st.tripleQuote && line.startsWith(st.tripleQuote.repeat(3), i)) {
        st.inTriple = false; out += '   '; i += 3; continue;
      }
      out += ' '; i++; continue;
    }
    if (st.inAsset) {
      const close = st.assetTriple ? '@@@' : '@';
      if (line.startsWith(close, i)) { st.inAsset = false; out += ' '.repeat(close.length); i += close.length; continue; }
      out += ' '; i++; continue;
    }
    if (c === '#') { out += ' '.repeat(n - i); break; }
    if (c === '"' || c === "'") {
      if (line.startsWith(c.repeat(3), i)) { st.inTriple = true; st.tripleQuote = c; out += '   '; i += 3; continue; }
      out += ' '; i++;
      while (i < n) {
        if (line[i] === '\\') { out += '  '; i += 2; continue; }
        if (line[i] === c) { out += ' '; i++; break; }
        out += ' '; i++;
      }
      continue;
    }
    if (c === '@') {
      if (line.startsWith('@@@', i)) { st.inAsset = true; st.assetTriple = true; out += '   '; i += 3; continue; }
      st.inAsset = true; st.assetTriple = false; out += ' '; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

function bracketDelta(sani: string): number {
  let d = 0;
  for (const c of sani) {
    if (c === '[' || c === '(') d++;
    else if (c === ']' || c === ')') d--;
  }
  return d;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns the prefix this line's property name starts with, or null. A property
// name is a token (preceded by start/whitespace, not '.' or path chars) made of
// word chars and ':', optionally followed by a '.suffix' (e.g. .connect,
// .timeSamples) then '=' or end-of-line.
function lineCategory(sani: string, matchers: { prefix: string; re: RegExp }[]): string | null {
  for (const m of matchers) {
    if (m.re.test(sani)) return m.prefix;
  }
  return null;
}

export function propertyGroupRanges(text: string, prefixes: string[]): FoldGroup[] {
  if (!prefixes || prefixes.length === 0) return [];
  const matchers = prefixes.map(p => ({
    prefix: p,
    re: new RegExp('(?:^|\\s)' + escapeRe(p) + '[\\w:]*(?:\\.[\\w:]+)?\\s*(?:=|$)'),
  }));

  const lines = text.split(/\r?\n/);
  const st: LexState = { inTriple: false, tripleQuote: '"', inAsset: false, assetTriple: false };
  const groups: FoldGroup[] = [];

  let depth = 0;
  let stmtStart = 0;
  let stmtCat: string | null = null;
  let stmtNeutral = false;
  let run: { cat: string; start: number; end: number } | null = null;

  const flush = () => {
    if (run && run.end > run.start) groups.push({ start: run.start, end: run.end });
    run = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const sani = sanitize(lines[i], st);
    if (depth === 0) {
      stmtStart = i;
      stmtCat = lineCategory(sani, matchers);
      stmtNeutral = sani.trim() === '';
    }
    depth += bracketDelta(sani);
    if (depth < 0) depth = 0;
    if (depth === 0) {
      const end = i;
      if (stmtCat) {
        if (run && run.cat === stmtCat) run.end = end;
        else { flush(); run = { cat: stmtCat, start: stmtStart, end }; }
      } else if (!stmtNeutral) {
        // a real, non-groupable statement (or a lone '}' / 'def') ends the run;
        // blank/comment-only lines are neutral and tolerated inside a run.
        flush();
      }
    }
  }
  flush();
  return groups;
}
