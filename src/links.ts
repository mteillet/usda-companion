import * as vscode from 'vscode';
import { resolveAsset } from './resolve';

interface AssetLink extends vscode.DocumentLink {
  _asset?: string;
}

export class UsdaLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(doc: vscode.TextDocument): vscode.DocumentLink[] {
    const links: AssetLink[] = [];
    for (let i = 0; i < doc.lineCount; i++) {
      const text = doc.lineAt(i).text;
      const re = /@@@(.*?)@@@|@([^@]*)@/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const asset = m[1] !== undefined ? m[1] : m[2];
        if (!asset) continue;
        const range = new vscode.Range(i, m.index, i, m.index + m[0].length);
        const link: AssetLink = new vscode.DocumentLink(range);
        link._asset = asset;
        link.tooltip = `Resolve ${asset}`;
        links.push(link);
      }
    }
    return links;
  }

  async resolveDocumentLink(link: AssetLink): Promise<vscode.DocumentLink> {
    if (link._asset) {
      const resolved = await resolveAsset(link._asset);
      if (resolved) link.target = vscode.Uri.file(resolved);
    }
    return link;
  }
}
