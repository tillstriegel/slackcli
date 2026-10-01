import { afterEach, beforeEach, expect, it } from 'bun:test';
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readWorkspacesFile } from './workspaces.ts';

let home: string;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'slackcli-storage-private-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });
const modulePath = join(import.meta.dir, 'workspaces.ts');
function run(body: string) {
  return Bun.spawnSync([process.execPath, '-e', `import { loadWorkspaces, saveWorkspaces } from ${JSON.stringify(modulePath)}; ${body}`], {
    env: { ...process.env, HOME: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0' },
  });
}
it('repairs existing directory and file modes without losing profile metadata', async () => {
  const dir = join(home, '.config/slackcli'); const file = join(dir, 'workspaces.json');
  await mkdir(dir, { recursive: true }); await chmod(dir, 0o755);
  await writeFile(file, '{"workspaces":{},"default_workspace":"TFake"}', { mode: 0o644 });
  const result = run('const data = await loadWorkspaces(); await saveWorkspaces(data);');
  expect(result.exitCode).toBe(0);
  expect((await stat(dir)).mode & 0o777).toBe(0o700);
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(file, 'utf8')).default_workspace).toBe('TFake');
});
it('refuses file symlinks and hard links without reading or changing the target', async () => {
  const target = join(home, 'target.json'); await writeFile(target, '{"workspaces":{}}', { mode: 0o644 });
  const alias = join(home, 'alias.json'); await symlink(target, alias);
  await expect(readWorkspacesFile(alias)).rejects.toThrow();
  expect((await stat(target)).mode & 0o777).toBe(0o644);
  await rm(alias); await link(target, alias);
  await expect(readWorkspacesFile(alias)).rejects.toThrow('hard links');
  expect((await stat(target)).mode & 0o777).toBe(0o644);
});
it('refuses config directory symlinks before writing credentials', async () => {
  const outside = join(home, 'outside'); await mkdir(outside);
  await mkdir(join(home, '.config')); await symlink(outside, join(home, '.config/slackcli'));
  expect(run('await saveWorkspaces({ workspaces: {} });').exitCode).not.toBe(0);
  expect(await Bun.file(join(outside, 'workspaces.json')).exists()).toBe(false);
});
it('refuses a symlinked .config parent before creating the credential directory', async () => {
  const outside = join(home, 'outside'); await mkdir(outside); await symlink(outside, join(home, '.config'));
  expect(run('await saveWorkspaces({ workspaces: {} });').exitCode).not.toBe(0);
  expect(await Bun.file(join(outside, 'slackcli/workspaces.json')).exists()).toBe(false);
});
