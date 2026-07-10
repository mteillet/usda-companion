import * as vscode from 'vscode';
import * as path from 'path';
import { commandFor, run } from './config';

export interface PropInfo {
  name: string;
  kind: 'attr' | 'rel';
  type?: string | null;
  allowed?: string[] | null;
  doc: string;
}
export interface TypeInfo {
  doc: string;
  props: PropInfo[];
  multipleApply?: boolean;
}
export interface SchemaData {
  version: number[];
  concrete: Record<string, TypeInfo>;
  applied: Record<string, TypeInfo>;
}

const BEGIN = '===USDA_SCHEMA_BEGIN===';
const END = '===USDA_SCHEMA_END===';

// Pure: extract the JSON payload from the helper's (possibly noisy) stdout.
export function parseSchemaOutput(stdout: string): SchemaData | null {
  const b = stdout.indexOf(BEGIN);
  const e = stdout.indexOf(END, b + BEGIN.length);
  if (b < 0 || e < 0) return null;
  const json = stdout.slice(b + BEGIN.length, e).trim();
  try {
    const data = JSON.parse(json);
    if (data && data.error) return null;
    if (!data || typeof data.concrete !== 'object') return null;
    return data as SchemaData;
  } catch {
    return null;
  }
}

let extensionPath = '';
let output: vscode.OutputChannel | undefined;
let cache: SchemaData | null = null;
let attempted = false; // avoid re-spawning hython on every keystroke after a failure
let loading: Promise<SchemaData | null> | null = null;

export function initSchema(extPath: string, out: vscode.OutputChannel): void {
  extensionPath = extPath;
  output = out;
}

export function clearSchemaCache(): void {
  cache = null;
  attempted = false;
  loading = null;
}

export function cachedSchemas(): SchemaData | null {
  return cache;
}

export async function ensureSchemas(): Promise<SchemaData | null> {
  if (cache) return cache;
  if (attempted) return null;
  if (loading) return loading;
  loading = (async () => {
    const cmd = commandFor('python', 'python');
    const helper = path.join(extensionPath, 'helper', 'schema_dump.py');
    try {
      const r = await run(cmd, [helper], { timeoutMs: 90000 });
      const data = parseSchemaOutput(r.stdout);
      attempted = true;
      if (!data) {
        output?.appendLine(`[schema] no usable output from: ${cmd.join(' ')} (exit ${r.code})`);
        const out = r.stdout.trim();
        const err = r.stderr.trim();
        if (out) output?.appendLine('stdout: ' + out.slice(0, 1500));
        if (err) output?.appendLine('stderr: ' + err.slice(0, 1500));
        output?.appendLine('Hint: "usda.python.command" must launch a python3 that can `from pxr import Usd` (matching build + ABI). Then run "USDA: Reload schemas".');
        return null;
      }
      cache = data;
      const nc = Object.keys(data.concrete).length;
      const na = Object.keys(data.applied).length;
      output?.appendLine(`[schema] loaded USD ${data.version.join('.')}: ${nc} concrete types, ${na} API schemas.`);
      return data;
    } catch (err) {
      attempted = true;
      const msg = err instanceof Error ? err.message : String(err);
      output?.appendLine(`[schema] could not run "${cmd.join(' ')}": ${msg}. Check "usda.python.command".`);
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function lookupType(data: SchemaData, typeName: string): TypeInfo | undefined {
  return data.concrete[typeName];
}

// Union of a concrete type's props + props from its applied API schema bases.
export function propsForPrim(data: SchemaData, typeName: string | null, apiBases: string[]): PropInfo[] {
  const byName = new Map<string, PropInfo>();
  const add = (props?: PropInfo[]) => {
    if (!props) return;
    for (const p of props) if (!byName.has(p.name)) byName.set(p.name, p);
  };
  if (typeName) add(data.concrete[typeName]?.props);
  for (const base of apiBases) add(data.applied[base]?.props);
  return Array.from(byName.values());
}

export function findProp(data: SchemaData, typeName: string | null, apiBases: string[], name: string): PropInfo | undefined {
  return propsForPrim(data, typeName, apiBases).find(p => p.name === name);
}
