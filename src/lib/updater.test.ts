import { afterEach, expect, it } from 'bun:test';
import { checkForUpdates, fetchLatestRelease, getCurrentVersion, isInstalledViaHomebrew, isUpdateNotifierDisabled, notifyIfUpdateAvailable, performUpdate, setUpdateCacheDirForTesting } from './updater.ts';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAppVersion } from '../version.ts';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; setUpdateCacheDirForTesting(null); });
it('disables all upstream networking and file changes regardless of env or stale cache', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slackcli-update-off-'));
  globalThis.fetch = (async () => { throw new Error('Unexpected network request'); }) as unknown as typeof fetch;
  try {
    const cache = join(dir, 'update-check.json');
    await writeFile(cache, JSON.stringify({ checkedAt: 0, latestVersion: 'v99.0.0' }));
    setUpdateCacheDirForTesting(dir);
    for (const env of [{}, { CI: '', SLACKCLI_NO_UPDATE_NOTIFIER: 'false' }, { CI: '1' }]) {
      expect(isUpdateNotifierDisabled(env)).toBe(true);
      await notifyIfUpdateAvailable(['slackcli', 'slackcli', '--help'], env);
    }
    expect(await fetchLatestRelease()).toBeNull();
    expect(await checkForUpdates(false)).toEqual({ updateAvailable: false, currentVersion: getAppVersion() });
    await performUpdate();
    expect(await readdir(dir)).toEqual(['update-check.json']);
    expect(await Bun.file(cache).json()).toEqual({ checkedAt: 0, latestVersion: 'v99.0.0' });
    expect(getCurrentVersion()).toBe(getAppVersion());
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('detects the installation method without I/O', () => {
  expect(isInstalledViaHomebrew()).toBe(['homebrew', 'Cellar', 'linuxbrew'].some(part => process.execPath.includes(part)));
});
