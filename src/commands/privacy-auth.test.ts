import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(import.meta.dir, '../..');
let home: string;
let guard: string;
const xoxd = 'xoxd-SENTINEL-BROWSER-123456789';
const xoxc = 'xoxc-SENTINEL-API-987654321';
const standard = 'xoxb-SENTINEL-STANDARD-123456789';
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'slackcli-auth-private-'));
  guard = join(home, 'guard.ts');
  await writeFile(join(home, 'fake-browser'), '#!/bin/sh\ntouch "$HOME/browser-launched"\nexit 1\n', { mode: 0o700 });
  await writeFile(guard, `
    import { WebClient } from ${JSON.stringify(import.meta.resolve('@slack/web-api'))};
    import { writeFileSync } from 'node:fs';
    const response = { ok: true, team_id: 'TFAKE', team: 'Fake', user_id: 'UFAKE' };
    WebClient.prototype.apiCall = async function(method) {
      writeFileSync(process.env.HOME + '/auth-call.json', JSON.stringify({ method, token: this.token }));
      return response;
    };
    globalThis.fetch = async (url) => {
      if (String(url) !== 'https://team.slack.com/api/auth.test') throw new Error('Unexpected network');
      return Response.json(response);
    };
  `);
});
afterEach(async () => { await rm(home, { recursive: true, force: true }); });
function run(args: string[], stdin: string = '') {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, TMPDIR: tmpdir(), BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0', SLACKCLI_BROWSER: join(home, 'fake-browser'), SLACKCLI_BROWSER_PROFILE: join(home, 'profile') } ;
  for (const name of ['CI', 'SLACKCLI_NO_UPDATE_NOTIFIER', 'SLACKCLI_LOG_LEVEL', 'SLACKCLI_LOG_DIR', 'BUN_OPTIONS', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[name];
  return Bun.spawnSync([process.execPath, '--preload', guard, join(root, 'src/index.ts'), ...args], { cwd: root, env, stdin: Buffer.from(stdin) });
}
function privateOutput(result: ReturnType<typeof run>) {
  const output = result.stdout.toString() + result.stderr.toString();
  for (const token of [xoxd, xoxc, standard, 'xoxp-SENTINEL-STANDARD-123456789',
    'xoxe.xoxb-SENTINEL-ROTATED-123456789', 'xoxe.xoxp-SENTINEL-ROTATED-123456789']) {
    expect(output).not.toContain(token);
    expect(output).not.toContain(token.slice(0, 20));
  }
  return output;
}
it('parses cURL without displaying any credential values or prefixes', () => {
  const curl = `curl 'https://team.slack.com/api/auth.test' -b 'd=${xoxd}' --data-raw '{"token":"${xoxc}"}'`;
  const parsed = run(['auth', 'parse-curl'], curl);
  expect(parsed.exitCode).toBe(0);
  expect(privateOutput(parsed)).toContain('credentials found');
  const error = run(['auth', 'parse-curl'], `curl 'http://evil.test' -b 'd=${xoxd}'`);
  expect(error.exitCode).toBe(1); privateOutput(error);
});
it('authenticates both token types from stdin with no automatic logs', async () => {
  const token = run(['auth', 'login', '--token-stdin', '--workspace-name', 'Fake'], standard + '\n');
  expect(token.exitCode).toBe(0); privateOutput(token);
  const browser = run(['auth', 'login-browser', '--tokens-stdin', '--workspace-url', 'https://team.slack.com/'], JSON.stringify({ xoxd, xoxc }));
  expect(browser.exitCode).toBe(0); privateOutput(browser);
  const data = await Bun.file(join(home, '.config/slackcli/workspaces.json')).json();
  expect(Object.values(data.workspaces).map((c: any) => c.auth_type).sort()).toEqual(['browser', 'standard']);
  expect((await readdir(home)).sort()).toEqual(['.config', 'auth-call.json', 'fake-browser', 'guard.ts']);
});
for (const prefix of ['xoxb', 'xoxp', 'xoxe.xoxb', 'xoxe.xoxp']) {
  for (const flag of ['--token-stdin', '--token']) {
    it(`passes ${prefix} access tokens byte-exactly through CLI ${flag}`, async () => {
      const token = `${prefix}-SENTINEL-${prefix.startsWith('xoxe.') ? 'ROTATED' : 'STANDARD'}-123456789`;
      const args = ['auth', 'login', flag, ...(flag === '--token' ? [token] : []), '--workspace-name', 'Fake'];
      const result = run(args, flag === '--token-stdin' ? token + '\n' : '');
      expect(result.exitCode).toBe(0);
      privateOutput(result);
      expect(await Bun.file(join(home, 'auth-call.json')).json()).toEqual({ method: 'auth.test', token });
      const data = await Bun.file(join(home, '.config/slackcli/workspaces.json')).json();
      expect(data.workspaces.TFAKE.token).toBe(token);
      expect(data.workspaces.TFAKE.token_type).toBe(prefix.endsWith('xoxb') ? 'bot' : 'user');
    });
  }
}
it('does not echo secrets on auth, stdin or usage failures', () => {
  for (const args of [['auth', 'login', '--token', standard, '--workspace-name', 'Fake', '--secret-backend', 'keychain'],
    ['auth', 'login-browser', '--tokens-stdin', '--workspace-url', 'https://evil.test'],
    ['auth', 'parse-curl', '--' + xoxd], ['auth', 'login', '--token-stdin', '--workspace-name', 'Fake']]) {
    const result = run(args, xoxc);
    expect(result.exitCode).toBe(1); privateOutput(result);
  }
});
it('keeps automatic login and upstream update commands offline and side-effect free', async () => {
  for (const args of [['auth', 'login-auto'], ['update'], ['update', 'check'], ['--help'], ['--version'], ['auth', '--help']]) {
    const result = run(args);
    expect(result.exitCode).toBe(args[1] === 'login-auto' ? 1 : 0);
    privateOutput(result);
  }
  expect((await readdir(home)).sort()).toEqual(['fake-browser', 'guard.ts']);
});
