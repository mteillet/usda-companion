import * as vscode from 'vscode';
import { spawn } from 'child_process';

const SECTION = 'usda';

/**
 * Read a command setting as [program, ...baseArgs]. Supports wrapping the real
 * tool in a studio launcher, e.g. ["rez-env", "usd", "--", "usdcat"].
 * Falls back to the bare tool name when unset.
 */
export function commandFor(key: string, fallback: string): string[] {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const value = cfg.get<string[]>(`${key}.command`);
  if (Array.isArray(value) && value.length > 0) return value;
  return [fallback];
}

export function assetResolverCommand(): string[] {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const value = cfg.get<string[]>('assetResolver.command');
  return Array.isArray(value) ? value : [];
}

export function generatedSchemaPaths(): string[] {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const value = cfg.get<string[]>('schema.generatedSchemaPaths');
  return Array.isArray(value) ? value : [];
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function run(argv: string[], extra: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const [program, ...base] = argv;
    if (!program) {
      reject(new Error('Empty command'));
      return;
    }
    const child = spawn(program, [...base, ...extra], { cwd: opts?.cwd, shell: false });
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    if (opts?.timeoutMs) {
      timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, opts.timeoutMs);
    }
    child.stdout.on('data', d => (stdout += d.toString()));
    child.stderr.on('data', d => (stderr += d.toString()));
    child.on('error', err => { if (timer) clearTimeout(timer); reject(err); });
    child.on('close', code => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr: stderr + (timedOut ? '\n[timed out]' : '') });
    });
  });
}
