import { parseUsda, PrimNode } from './parse';

export type RelKind = 'rel' | 'connection';

export interface RelEdge {
  fromPath: string;
  fromName: string;
  relName: string;
  kind: RelKind;
  targetPath: string; // normalized (any .property suffix dropped)
  line: number;
}

export interface CollectionInfo {
  path: string;       // e.g. /MODEL/ALL.collection:Lighting:light:Foo
  instance: string;   // e.g. Lighting:light:Foo
  onPrim: string;     // e.g. /MODEL/ALL
  includes: string[]; // raw target prim paths
  excludes: string[];
  line: number;
}

export interface CollBinding {
  bindingName: string;   // display, e.g. material:binding (or a custom "<ns>:binding")
  collectionPath: string; // raw collection path (with .collection:NAME)
  boundPath: string;      // normalized bound-target prim path (e.g. a material)
  line: number;
}

export interface RelIndex {
  byFrom: Map<string, RelEdge[]>;
  byTarget: Map<string, RelEdge[]>;
  collections: Map<string, CollectionInfo>;
  collBindings: CollBinding[];
}

const REL_START = /(?:^|\s)(?:(?:custom|prepend|append|add|delete|reorder)\s+)*rel\s+([\w:]+)\s*=/;
const CONN_START = /(?:^|\s)(?:custom\s+)?(?:uniform\s+|varying\s+)?[A-Za-z][\w]*(?:\[\])?\s+([\w:]+)\.connect\s*=/;
const TARGET_RE = /<([^<>]+)>/g;
const COLL_MEMBER_RE = /^collection:(.+):(includes|excludes)$/;

function bdepth(s: string): number {
  let d = 0;
  for (const c of s) { if (c === '[') d++; else if (c === ']') d--; }
  return d;
}
function normalize(p: string): string { return p.split('.')[0]; }
function push<T>(map: Map<string, T[]>, key: string, v: T): void {
  const a = map.get(key); if (a) a.push(v); else map.set(key, [v]);
}

export function buildRelations(text: string): RelIndex {
  const lines = text.split(/\r?\n/);
  const byFrom = new Map<string, RelEdge[]>();
  const byTarget = new Map<string, RelEdge[]>();
  const collections = new Map<string, CollectionInfo>();
  const collBindings: CollBinding[] = [];

  const scanPrim = (prim: PrimNode, fullPath: string) => {
    const childRanges = prim.children.map(c => [c.startLine, c.endLine] as [number, number]);
    const inChild = (i: number) => childRanges.some(([s, e]) => i >= s && i <= e);
    for (let i = prim.startLine; i <= prim.endLine && i < lines.length; i++) {
      if (inChild(i)) continue;
      const line = lines[i];
      let relName: string | null = null;
      let kind: RelKind = 'rel';
      const rm = REL_START.exec(line);
      const cm = CONN_START.exec(line);
      if (rm) { relName = rm[1]; kind = 'rel'; }
      else if (cm) { relName = cm[1]; kind = 'connection'; }
      if (!relName) continue;

      let acc = line, depth = bdepth(line), j = i;
      while (depth > 0 && j + 1 < lines.length) { j++; acc += '\n' + lines[j]; depth += bdepth(lines[j]); }

      const rawTargets: string[] = [];
      TARGET_RE.lastIndex = 0;
      let tm: RegExpExecArray | null;
      while ((tm = TARGET_RE.exec(acc)) !== null) rawTargets.push(tm[1]);

      // generic edges (normalized to prim paths)
      const seen = new Set<string>();
      for (const raw of rawTargets) {
        const target = normalize(raw);
        if (!target.startsWith('/') || seen.has(target)) continue;
        seen.add(target);
        const edge: RelEdge = { fromPath: fullPath, fromName: prim.name, relName, kind, targetPath: target, line: i };
        push(byFrom, fullPath, edge);
        push(byTarget, target, edge);
      }

      // collection membership definitions
      const cmm = COLL_MEMBER_RE.exec(relName);
      if (cmm) {
        const instance = cmm[1];
        const suffix = cmm[2];
        const path = `${fullPath}.collection:${instance}`;
        let info = collections.get(path);
        if (!info) { info = { path, instance, onPrim: fullPath, includes: [], excludes: [], line: i }; collections.set(path, info); }
        const prims = rawTargets.map(normalize).filter(p => p.startsWith('/'));
        if (suffix === 'includes') info.includes.push(...prims);
        else info.excludes.push(...prims);
      }

      // collection-based bindings: [ <collection>, <bound target> ]
      if (relName.includes(':binding:collection:') && rawTargets.length >= 2) {
        collBindings.push({
          bindingName: relName.split(':collection:')[0],
          collectionPath: rawTargets[0],         // keep raw (.collection:NAME intact)
          boundPath: normalize(rawTargets[1]),
          line: i,
        });
      }
    }
  };

  const walk = (n: PrimNode, parent: string) => {
    let here = parent;
    if (n.kind === 'prim') { here = parent + '/' + n.name; scanPrim(n, here); }
    for (const c of n.children) walk(c, here);
  };
  for (const r of parseUsda(text)) walk(r, '');
  return { byFrom, byTarget, collections, collBindings };
}

function isMember(coll: CollectionInfo, primPath: string): boolean {
  const under = (p: string) => primPath === p || primPath.startsWith(p + '/');
  return coll.includes.some(under) && !coll.excludes.some(under);
}

export function collectionsContaining(index: RelIndex, primPath: string): CollectionInfo[] {
  return Array.from(index.collections.values()).filter(c => isMember(c, primPath));
}

export interface EffectiveBinding {
  instance: string;       // collection instance name
  collectionLine: number; // where the collection is defined
  bindingName: string;
  boundPath: string;
  line: number;           // where the binding is authored
}

// prim ∈ collection  ←  collection-based binding  →  bound target (e.g. material)
export function effectiveBindings(index: RelIndex, primPath: string): EffectiveBinding[] {
  const out: EffectiveBinding[] = [];
  for (const coll of collectionsContaining(index, primPath)) {
    for (const b of index.collBindings) {
      if (b.collectionPath === coll.path) {
        out.push({ instance: coll.instance, collectionLine: coll.line, bindingName: b.bindingName, boundPath: b.boundPath, line: b.line });
      }
    }
  }
  return out;
}

export function primAtLine(text: string, line: number): { node: PrimNode; path: string } | null {
  let res: { node: PrimNode; path: string } | null = null;
  const walk = (n: PrimNode, parent: string) => {
    let here = parent;
    if (n.kind === 'prim') { here = parent + '/' + n.name; if (n.startLine === line) res = { node: n, path: here }; }
    for (const c of n.children) walk(c, here);
  };
  for (const r of parseUsda(text)) walk(r, '');
  return res;
}

// Deepest prim whose block contains `line`, as a full path (the prim that owns
// a property authored on that line).
export function enclosingPrimPath(text: string, line: number): string | null {
  let res: string | null = null;
  const walk = (n: PrimNode, parent: string) => {
    let here = parent;
    if (n.kind === 'prim') {
      here = parent + '/' + n.name;
      if (line >= n.startLine && line <= n.endLine) res = here;
    }
    for (const c of n.children) walk(c, here);
  };
  for (const r of parseUsda(text)) walk(r, '');
  return res;
}
