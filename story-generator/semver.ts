/** Minimal semver comparison for version gates; prerelease suffixes ignored. */
export function semverLt(a: string, b: string): boolean {
  const pa = a.split('-')[0].split('.').map(Number); const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x < y; }
  return false;
}
