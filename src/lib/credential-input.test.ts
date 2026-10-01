import { expect, it } from 'bun:test';
import { parseBrowserTokens, parseStandardToken } from './credential-input.ts';
import { readInteractiveInput } from './interactive-input.ts';
it.each(['xoxb-FAKE', 'xoxp-FAKE', 'xoxe.xoxb-FAKE', 'xoxe.xoxp-FAKE'])
('accepts access token %s without changing its bytes', token => {
  expect(parseStandardToken(token)).toBe(token);
  expect(parseStandardToken(` \n${token}\n`)).toBe(token);
});
it.each(['xoxe-FAKE', 'xoxc-FAKE', 'xoxd-FAKE', 'xoxe.xoxc-FAKE', 'xoxe.xoxd-FAKE',
  'xoxe.xoxb-', 'xoxe.xoxp-', 'xoxe.xoxp-FAKE xoxp-OTHER', 'xoxe.xoxb-FAKE\nxoxb-OTHER'])
('rejects refresh, browser, empty or multiple tokens: %s', input => {
  expect(() => parseStandardToken(input)).toThrow('Expected one standard Slack token');
});
it('reads one standard token and rejects ambiguous input without echoing it', () => {
  expect(parseStandardToken(' xoxb-FAKE\n')).toBe('xoxb-FAKE');
  for (const input of ['', 'xoxc-FAKE', 'xoxb-FAKE\nxoxb-OTHER']) expect(() => parseStandardToken(input)).toThrow('Expected');
});
it('reads a browser pair and uses generic errors for invalid JSON', () => {
  expect(parseBrowserTokens('{"xoxd":"xoxd-FAKE","xoxc":"xoxc-FAKE"}')).toEqual({ xoxd: 'xoxd-FAKE', xoxc: 'xoxc-FAKE' });
  for (const input of ['xoxd-SENTINEL', 'null', '{}', '{"xoxd":"wrong","xoxc":"xoxc-FAKE"}']) {
    try { parseBrowserTokens(input); throw new Error('must reject'); } catch (error) {
      expect(String(error)).not.toContain('SENTINEL'); expect(String(error)).toContain('Expected');
    }
  }
});
it('fails before installing terminal listeners or changing modes for secret entry', async () => {
  const tty = process.stdin.isTTY;
  const before = ['data', 'end', 'error', 'SIGINT'].map(name => [name, process.stdin.listenerCount(name)]);
  process.stdin.isTTY = true;
  try {
    await expect(readInteractiveInput({ secret: true })).rejects.toThrow('Interactive secret entry is disabled');
    expect(['data', 'end', 'error', 'SIGINT'].map(name => [name, process.stdin.listenerCount(name)])).toEqual(before);
  } finally { process.stdin.isTTY = tty; }
});
