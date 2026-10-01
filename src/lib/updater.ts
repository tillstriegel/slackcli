import { getAppVersion } from '../version.ts';
import { info } from './formatter.ts';

export const UPDATES_DISABLED = 'Upstream updates and update checks are disabled in this privacy fork. Build a reviewed fork revision locally.';

// Retain offline entry points for callers; no cache, download or replacement
// implementation remains, so environment flags cannot restore upstream updates.
export function getCurrentVersion(): string { return getAppVersion(); }
export function isInstalledViaHomebrew(): boolean {
  return ['homebrew', 'Cellar', 'linuxbrew'].some(part => process.execPath.includes(part));
}
export function setUpdateCacheDirForTesting(_dir: string | null): void {}
export function isUpdateNotifierDisabled(_env: NodeJS.ProcessEnv = process.env): boolean { return true; }
export async function fetchLatestRelease(_timeoutMs?: number): Promise<null> { return null; }
export async function checkForUpdates(_silent: boolean = true): Promise<{ updateAvailable: boolean; currentVersion: string }> {
  return { updateAvailable: false, currentVersion: getCurrentVersion() };
}
export async function performUpdate(): Promise<void> { info(UPDATES_DISABLED); }
export async function notifyIfUpdateAvailable(_argv: string[] = process.argv, _env: NodeJS.ProcessEnv = process.env): Promise<void> {}
