import { afterEach, describe, expect, it } from 'bun:test';
import { SlackClient } from './slack-client.ts';
import { RateLimiter } from './rate-limiter.ts';
import { resolveLogLevel } from './logger.ts';
import { notifyIfUpdateAvailable, fetchLatestRelease, performUpdate } from './updater.ts';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const config = () => ({ workspace_id: 'TFAKE', workspace_name: 'Fake', auth_type: 'browser' as const,
  workspace_url: 'https://team.slack.com', xoxc_token: 'xoxc-SENTINEL-123456789', xoxd_token: 'xoxd-SENTINEL-987654321' });
const options = { rateLimiter: new RateLimiter({ minIntervalMs: 0, maxConcurrent: 1 }), retry: { maxRetries: 0 } };

describe('privacy transport boundary', () => {
  for (const authType of ['browser', 'standard']) {
    it.each(['files.uploadV2', 'files.upload'])(`rejects ${authType} SDK upload helper %s before transport or file access`, async method => {
      let transportCalls = 0;
      let fileReads = 0;
      globalThis.fetch = (async () => { transportCalls++; return Response.json({ ok: true }); }) as unknown as typeof fetch;
      const cfg = authType === 'browser' ? config() : { workspace_id: 'TFAKE', workspace_name: 'Fake', auth_type: 'standard' as const, token: 'xoxb-FAKE', token_type: 'bot' as const };
      const client = new SlackClient(cfg, options);
      const sdk = (client as any).webClient;
      if (sdk) sdk.axios.defaults.adapter = async (request: any) => {
        transportCalls++;
        return { status: 200, headers: {}, data: { ok: true, upload_url: 'https://evil.test/upload', file_id: 'FFAKE', files: [] }, config: request, request: { path: '/api/files.getUploadURLExternal' } };
      };
      const params = { filename: 'fake.txt', get content() { fileReads++; return 'FAKE FILE BYTES'; } };
      let failure: unknown;
      try { await client.request(method, params); } catch (error) { failure = error; }
      expect(transportCalls).toBe(0);
      expect(fileReads).toBe(0);
      expect(String(failure)).toContain('Use uploadFileExternal');
    });
  }

  it.each(['files.getUploadURLExternal', 'files.completeUploadExternal'])('keeps actual upload API method %s available', async method => {
    const client = new SlackClient({ workspace_id: 'TFAKE', workspace_name: 'Fake', auth_type: 'standard', token: 'xoxb-FAKE', token_type: 'bot' }, options);
    const requests: string[] = [];
    (client as any).webClient.axios.defaults.adapter = async (request: any) => {
      requests.push(request.url);
      return { status: 200, headers: {}, data: { ok: true }, config: request, request: { path: `/api/${method}` } };
    };
    expect(await client.request(method)).toMatchObject({ ok: true });
    expect(requests).toEqual([`https://slack.com/api/${method}`]);
  });
  it.each(['http://team.slack.com', 'https://example.com', 'https://team.slack.com.evil.test',
    'https://user:pass@team.slack.com', 'https://team.slack.com:444', 'https://team.slack.com/api',
    'https://team.slack.com?token=secret', 'https://team.slack.com#fragment', 'https://team.slack.com.',
    'https://team%2eslack.com', 'https://app.slack.com', 'https://team.slack.com/../'])
  ('rejects loaded or mutated workspace origin %s before fetch', async (url) => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return Response.json({ ok: true }); }) as unknown as typeof fetch;
    const mutable = config();
    const client = new SlackClient(mutable, options);
    mutable.workspace_url = url;
    await expect(client.testAuth()).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it.each(['https://evil.test/api', '//evil.test/api', '../auth.test', 'auth.test?foo=bar', 'auth%2etest', 'auth.test#fragment'])
  ('rejects unsafe API method %s for both transports', async (method) => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return Response.json({ ok: true }); }) as unknown as typeof fetch;
    for (const cfg of [config(), { workspace_id: 'TFAKE', workspace_name: 'Fake', auth_type: 'standard' as const, token: 'xoxb-FAKE', token_type: 'bot' as const }]) {
      const client = new SlackClient(cfg, options);
      const sdk = (client as any).webClient;
      if (sdk) sdk.axios.defaults.adapter = async (request: any) => {
        calls++; return { status: 200, headers: {}, data: { ok: true }, config: request, request: { path: '/api/auth.test' } };
      };
      await expect(client.request(method)).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });

  it('normalizes a legitimate enterprise origin and refuses credentialed redirects', async () => {
    const requests: any[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(null, { status: 307, headers: { location: 'https://evil.test' } });
    }) as unknown as typeof fetch;
    const cfg = config(); cfg.workspace_url = 'https://Team.enterprise.Slack.com/';
    await expect(new SlackClient(cfg, options).testAuth()).rejects.toThrow();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://team.enterprise.slack.com/api/auth.test');
    expect(requests[0].init.redirect).toBe('manual');
  });

  it('rejects foreign download hops without fetching them', async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://evil.test/file' } }); }) as unknown as typeof fetch;
    await expect(new SlackClient(config(), options).fetchFile('https://files.slack.com/file')).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('keeps real SDK requests on its pinned Slack base without redirects or proxies', async () => {
    const client = new SlackClient({ workspace_id: 'TFAKE', workspace_name: 'Fake', auth_type: 'standard', token: 'xoxb-FAKE', token_type: 'bot' }, options);
    const sdk = (client as any).webClient;
    const requests: any[] = [];
    sdk.axios.defaults.adapter = async (request: any) => {
      requests.push(request); return { status: 200, headers: {}, data: { ok: true, team_id: 'TFAKE' }, config: request, request: { path: '/api/auth.test' } };
    };
    expect((await client.testAuth()).team_id).toBe('TFAKE');
    expect(requests).toHaveLength(1);
    expect(requests[0].baseURL).toBe('https://slack.com/api/');
    expect(requests[0].url).toBe('https://slack.com/api/auth.test');
    expect(requests[0].proxy).toBe(false);
    expect(requests[0].maxRedirects).toBe(0);
  });
});

it('defaults diagnostic logging to off', () => { expect(resolveLogLevel({ verbose: false }).level).toBe('off'); });

it('never fetches or mutates update cache, even without opt-out flags', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slackcli-private-update-'));
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ tag_name: 'v99.0.0', assets: [] }); }) as unknown as typeof fetch;
  try {
    const { setUpdateCacheDirForTesting } = await import('./updater.ts');
    setUpdateCacheDirForTesting(dir);
    await notifyIfUpdateAvailable(['slackcli', 'slackcli', '--help'], {});
    await fetchLatestRelease();
    await performUpdate();
    expect(calls).toBe(0);
    expect(await readdir(dir)).toEqual([]);
    setUpdateCacheDirForTesting(null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('rejects unsafe upload destinations before reading bytes, for both auth types', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slackcli-upload-policy-'));
  try {
    for (const cfg of [config(), { workspace_id: 'TFAKE', workspace_name: 'Fake', auth_type: 'standard' as const, token: 'xoxb-FAKE', token_type: 'bot' as const }]) {
      for (const url of ['https://evil.test/file', 'http://files.slack.com/file', 'https://cdn.slack-edge.com/file']) {
        const path = join(dir, 'file.txt');
        await writeFile(path, 'FAKE DATA');
        const client = new SlackClient(cfg, options);
        client.request = async () => {
          // If the upload reads bytes before URL validation it will now get ENOENT.
          await rm(path);
          return { upload_url: url, file_id: 'FFAKE' };
        };
        globalThis.fetch = (async () => { throw new Error('must not fetch'); }) as unknown as typeof fetch;
        await expect(client.uploadFileExternal('CFAKE', path)).rejects.toThrow('URL');
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('refuses upload POST redirects instead of sending bytes to the destination', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slackcli-upload-redirect-'));
  try {
    const path = join(dir, 'file.txt'); await writeFile(path, 'FAKE DATA');
    const client = new SlackClient(config(), options);
    client.request = async () => ({ upload_url: 'https://files.slack.com/upload', file_id: 'FFAKE' });
    const calls: RequestInit[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init!); return new Response(null, { status: 307, headers: { location: 'https://evil.test' } });
    }) as unknown as typeof fetch;
    await expect(client.uploadFileExternal('CFAKE', path)).rejects.toThrow('307');
    expect(calls).toHaveLength(1); expect(calls[0]!.redirect).toBe('manual');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('refuses ambient proxy settings at the real request and download boundaries', async () => {
  const saved = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = 'http://127.0.0.1:9999';
  globalThis.fetch = (async () => { throw new Error('must not fetch'); }) as unknown as typeof fetch;
  try {
    await expect(new SlackClient(config(), options).testAuth()).rejects.toThrow('proxy');
    await expect(new SlackClient(config(), options).fetchFile('https://files.slack.com/file')).rejects.toThrow('proxy');
    const standard = new SlackClient({ workspace_id: 'TFAKE', workspace_name: 'Fake', auth_type: 'standard', token: 'xoxb-FAKE', token_type: 'bot' }, options);
    await expect(standard.testAuth()).rejects.toThrow('proxy');
  } finally { if (saved === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = saved; }
});

it.each([301, 302, 303, 307, 308])('keeps SDK HTTP %i responses from forwarding credentials', async status => {
  const client = new SlackClient({ workspace_id: 'TFAKE', workspace_name: 'Fake', auth_type: 'standard', token: 'xoxb-FAKE', token_type: 'bot' }, options);
  const sdk = (client as any).webClient;
  sdk.retryConfig = { retries: 0 };
  const requests: any[] = [];
  sdk.axios.defaults.adapter = async (request: any) => {
    requests.push(request);
    return { status, headers: { location: 'https://evil.test/api' }, data: '', config: request, request: { path: '/api/auth.test' } };
  };
  await expect(client.testAuth()).rejects.toThrow();
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe('https://slack.com/api/auth.test');
  expect(requests[0].maxRedirects).toBe(0); expect(requests[0].proxy).toBe(false);
});

it('validates manual browser authentication before contacting Slack', async () => {
  const { authenticateBrowser } = await import('./auth.ts');
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ ok: true }); }) as unknown as typeof fetch;
  await expect(authenticateBrowser('xoxd-FAKE', 'xoxc-FAKE', 'https://evil.test')).rejects.toThrow('origin');
  expect(calls).toBe(0);
});

it('validates a mutated browser origin before attaching file cookies', async () => {
  const cfg = config(); const client = new SlackClient(cfg, options);
  cfg.workspace_url = 'https://evil.test';
  globalThis.fetch = (async () => { throw new Error('must not fetch'); }) as unknown as typeof fetch;
  await expect(client.fetchFile('https://files.slack.com/file')).rejects.toThrow('origin');
});
