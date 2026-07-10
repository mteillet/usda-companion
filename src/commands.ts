import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { commandFor, run } from './config';

function activeUsdaPath(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  const doc = editor?.document;
  if (!doc || doc.uri.scheme !== 'file') return undefined;
  return doc.uri.fsPath;
}

function tmpOut(srcPath: string, suffix: string): string {
  const base = path.basename(srcPath, path.extname(srcPath));
  return path.join(os.tmpdir(), `${base}.${suffix}.usda`);
}

export function registerCommands(ctx: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  const reportFailure = (label: string, r: { code: number | null; stderr: string; stdout: string }) => {
    output.appendLine(`[${label}] exit ${r.code}`);
    if (r.stdout.trim()) output.appendLine(r.stdout.trimEnd());
    if (r.stderr.trim()) output.appendLine(r.stderr.trimEnd());
    output.show(true);
  };

  const onMissing = (tool: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(
      `USDA: could not run "${tool}" (${msg}). Set "usda.${tool}.command" — e.g. a rez/wrapper launcher — in Settings.`
    );
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand('usda.flatten', async () => {
      const src = activeUsdaPath();
      if (!src) { vscode.window.showWarningMessage('USDA: open a saved .usda file first.'); return; }
      const out = tmpOut(src, 'flat');
      const cmd = commandFor('usdcat', 'usdcat');
      try {
        const r = await run(cmd, [src, '--flatten', '-o', out]);
        if (r.code === 0) {
          const d = await vscode.workspace.openTextDocument(out);
          await vscode.window.showTextDocument(d, { preview: false });
        } else {
          reportFailure('flatten', r);
        }
      } catch (e) { onMissing('usdcat', e); }
    })
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('usda.check', async () => {
      const src = activeUsdaPath();
      if (!src) { vscode.window.showWarningMessage('USDA: open a saved .usda file first.'); return; }
      const cmd = commandFor('usdchecker', 'usdchecker');
      output.clear();
      output.appendLine(`usdchecker ${src}`);
      try {
        const r = await run(cmd, [src]);
        if (r.stdout.trim()) output.appendLine(r.stdout.trimEnd());
        if (r.stderr.trim()) output.appendLine(r.stderr.trimEnd());
        output.appendLine(r.code === 0 ? '✓ no errors' : `exit ${r.code}`);
        output.show(true);
      } catch (e) { onMissing('usdchecker', e); }
    })
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('usda.openInUsdview', async () => {
      const src = activeUsdaPath();
      if (!src) { vscode.window.showWarningMessage('USDA: open a saved .usda file first.'); return; }
      const [program, ...base] = commandFor('usdview', 'usdview');
      try {
        const child = spawn(program, [...base, src], { detached: true, stdio: 'ignore' });
        child.on('error', e => onMissing('usdview', e));
        child.unref();
      } catch (e) { onMissing('usdview', e); }
    })
  );
}
