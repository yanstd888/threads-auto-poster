import { APP_VERSION } from './app-version';

export const UPDATE_REPOSITORY = 'yanstd888/threads-auto-poster';
export const UPDATE_RELEASES_URL = `https://github.com/${UPDATE_REPOSITORY}/releases`;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string;
  publishedAt: string | null;
}

export function parseVersion(value: string): [number, number, number] | null {
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export async function getLatestUpdate(): Promise<UpdateInfo> {
  const response = await fetch(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(5_000),
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`GitHub release lookup failed: ${response.status}`);
  const release = await response.json() as { tag_name?: unknown; html_url?: unknown; published_at?: unknown };
  const latestVersion = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/i, '') : null;
  const releaseUrl = typeof release.html_url === 'string' && release.html_url.startsWith('https://github.com/')
    ? release.html_url
    : UPDATE_RELEASES_URL;
  return {
    currentVersion: APP_VERSION,
    latestVersion,
    updateAvailable: latestVersion ? compareVersions(latestVersion, APP_VERSION) > 0 : false,
    releaseUrl,
    publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
  };
}
