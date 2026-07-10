import { assetResolverCommand, run } from './config';

const cache = new Map<string, string | null>();

export function clearResolveCache(): void {
  cache.clear();
}

// Resolve an asset path (e.g. a custom `asset:` URI) to a filesystem path using
// `usda.assetResolver.command` (default: usdresolve). Returns null if the
// resolver is unset, errors, or leaves the path unresolved.
export async function resolveAsset(asset: string): Promise<string | null> {
  if (cache.has(asset)) return cache.get(asset) ?? null;
  const cmd = assetResolverCommand();
  if (cmd.length === 0) {
    cache.set(asset, null);
    return null;
  }
  try {
    const r = await run(cmd, [asset], { timeoutMs: 15000 });
    const out = (r.stdout.trim().split(/\r?\n/).filter(Boolean).pop() || '').trim();
    const resolved = r.code === 0 && out && out !== asset ? out : null;
    cache.set(asset, resolved);
    return resolved;
  } catch {
    cache.set(asset, null);
    return null;
  }
}
