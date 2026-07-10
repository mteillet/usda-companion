// Locates the asset reference (@...@ / @@@...@@@) or internal prim path (<...>)
// under a cursor column. Pure string logic so it can be unit-tested.

export interface AssetHit {
  asset: string;     // the path inside the @...@
  prim?: string;     // optional default-prim target authored as @asset@</Prim>
  start: number;     // column of the opening @
  end: number;       // column just past the closing @
}

export function assetAt(line: string, col: number): AssetHit | null {
  const re = /@@@(.*?)@@@|@([^@]*)@/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (col >= start && col <= end) {
      const asset = m[1] !== undefined ? m[1] : (m[2] ?? '');
      const t = /^\s*<([^>]*)>/.exec(line.slice(end));
      return { asset, prim: t ? t[1] : undefined, start, end };
    }
  }
  return null;
}

// The <...> path token under the cursor (e.g. </shot/lights/key> or
// </shot/geo.material:binding>). Returns the inner string.
export function pathAt(line: string, col: number): string | null {
  const re = /<([^<>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (col >= start && col <= end) return m[1];
  }
  return null;
}
