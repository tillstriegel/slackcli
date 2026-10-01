import { expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('uses the real SDK HTTP adapter without redirect or proxy requests', async () => {
  // Isolate native transport patches so other tests cannot use them. No socket
  // is created: writable requests and readable responses end at this boundary.
  const home = await mkdtemp(join(tmpdir(), 'slackcli-sdk-http-'));
  const script = join(home, 'transport.ts');
  try {
    await writeFile(script, `
      import assert from 'node:assert/strict';
      import http from 'node:http';
      import https from 'node:https';
      import { PassThrough, Writable } from 'node:stream';
      import axios from ${JSON.stringify(import.meta.resolve('axios'))};
      import { SlackClient } from ${JSON.stringify(join(import.meta.dir, 'slack-client.ts'))};
      import { RateLimiter } from ${JSON.stringify(join(import.meta.dir, 'rate-limiter.ts'))};

      const token = 'xoxe.xoxb-FAKE-HTTP-TRANSPORT';
      let status = 200;
      const requests = [];
      const forbidden = () => { throw new Error('Unexpected transport'); };
      http.request = http.get = https.get = forbidden;
      globalThis.fetch = forbidden;
      https.request = (options, callback) => {
        const chunks = [];
        requests.push({ options, chunks });
        const req = new Writable({
          autoDestroy: false,
          write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
        });
        req.path = options.path;
        req.setTimeout = () => req;
        req.once('finish', () => {
          const res = new PassThrough();
          res.statusCode = status;
          res.statusMessage = status === 200 ? 'OK' : 'Redirect';
          res.headers = { 'content-type': 'application/json', location: 'https://evil.test/credential-target' };
          res.req = req;
          callback(res);
          res.end(status === 200 ? JSON.stringify({ ok: true, team_id: 'TFAKE' }) : '');
        });
        return req;
      };

      const client = new SlackClient({ workspace_id: 'TFAKE', workspace_name: 'Fake',
        auth_type: 'standard', token, token_type: 'bot' }, {
        rateLimiter: new RateLimiter({ minIntervalMs: 0, maxConcurrent: 1 }),
      });
      const sdk = client.webClient;
      sdk.retryConfig = { retries: 0 };
      // Inspect selection; do not replace Axios' adapter with a test adapter.
      assert.equal(axios.getAdapter(sdk.axios.defaults.adapter).adapterName, 'http');
      for (status of [200, 301, 302, 303, 307, 308]) {
        const before = requests.length;
        const call = () => client.request('auth.test', { test_payload: 'FAKE BODY' });
        if (status === 200) assert.equal((await call()).team_id, 'TFAKE');
        else await assert.rejects(call(), /Slack API error/);
        assert.equal(requests.length, before + 1);
        const { options, chunks } = requests.at(-1);
        assert.equal(options.protocol, 'https:');
        assert.equal(options.hostname, 'slack.com');
        assert.equal(options.path, '/api/auth.test');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Authorization, 'Bearer ' + token);
        assert.equal(Buffer.concat(chunks).toString(), 'test_payload=FAKE%20BODY');
      }
      // The CLI refuses proxy env at its boundary. Also test the underlying
      // SDK's proxy:false defense through its real HTTP adapter independently.
      process.env.HTTPS_PROXY = process.env.HTTP_PROXY = process.env.ALL_PROXY = 'http://proxy.invalid:9999';
      await assert.rejects(client.testAuth(), /proxy/);
      assert.equal(requests.length, 6);
      status = 200;
      assert.equal((await sdk.apiCall('auth.test')).team_id, 'TFAKE');
      assert.equal(requests.length, 7);
      assert.equal(requests.at(-1).options.hostname, 'slack.com');
      assert.equal(requests.at(-1).options.path, '/api/auth.test');
      console.log(JSON.stringify({ adapter: 'http', requests: requests.length, redirects: 5, proxySuppressed: true }));
    `);
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0' };
    for (const name of ['BUN_OPTIONS', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[name];
    const result = Bun.spawnSync([process.execPath, script], { env, timeout: 10000 });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ adapter: 'http', requests: 7, redirects: 5, proxySuppressed: true });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
