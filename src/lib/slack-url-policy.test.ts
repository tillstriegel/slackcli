import { expect, it } from 'bun:test';
import { assertNoSlackProxy, assertSlackMethod, canonicalWorkspaceOrigin, isSlackHost, slackFileUrl } from './slack-url-policy.ts';
it.each(['https://team.slack.com', 'https://team.enterprise.slack.com', 'https://Team.Slack.COM/', 'https://team.slack.com:443'])('canonicalizes valid workspace origin %s', value => {
  expect(canonicalWorkspaceOrigin(value)).toBe(new URL(value).origin);
});
it.each(['https://slack.com', 'https://app.slack.com', 'https://evilslack.com', 'https://t.slack.com.evil',
  'http://t.slack.com', 'https://t.slack.com.', 'https://t.slack.com:444', 'https://user@t.slack.com',
  'https://@t.slack.com', 'https://t%2eslack.com', 'https://t.slack.com\\@evil.test', 'https://t.slack.com/api',
  'https://t.slack.com/../', 'https://t.slack.com?', 'https://t.slack.com#', ' https://t.slack.com',
  'https://-t.slack.com', 'https://t_.slack.com', 'https://t.slack.com/%2f'])('rejects ambiguous workspace origin %s', value => {
  expect(() => canonicalWorkspaceOrigin(value)).toThrow();
});
it('uses only Slack and optionally Slack CDN domains for files', () => {
  expect(isSlackHost(slackFileUrl('https://slack.com/file'))).toBe(true);
  expect(isSlackHost(slackFileUrl('https://files.slack.com/file'))).toBe(true);
  for (const host of ['slack-edge.com', 'downloads.slack-edge.com']) {
    expect(() => slackFileUrl(`https://${host}/file`)).toThrow();
    expect(isSlackHost(slackFileUrl(`https://${host}/file`, true))).toBe(false);
  }
  for (const url of ['https://evil.test/file','https://slack-edge.com.evil/file','http://files.slack.com/file',
    'https://u:p@files.slack.com/file','https://files.slack.com:444/file','https://files.slack.com./file']) {
    expect(() => slackFileUrl(url, true)).toThrow();
  }
});
it('rejects every proxy environment setting even if NO_PROXY bypasses it', () => {
  assertNoSlackProxy({});
  for (const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']) {
    expect(() => assertNoSlackProxy({ [name]: 'http://127.0.0.1:9999', NO_PROXY: '*' })).toThrow('proxy');
  }
});
it('allows Slack methods and rejects paths or absolute URLs', () => {
  for (const method of ['auth.test', 'files.getUploadURLExternal', 'usergroups.users.update']) assertSlackMethod(method);
  for (const method of ['../auth.test','//evil.test','https://evil.test','auth.test?foo=1','auth.test\n','auth%2etest']) {
    expect(() => assertSlackMethod(method)).toThrow();
  }
});
it.each(['https://files%2eslack.com/file', '//files%2eslack.com/file', 'https://files.slack.com\\evil', 'https:evil.test'])('rejects raw redirect ambiguity %s before canonicalization', value => {
  expect(() => slackFileUrl(value, true, new URL('https://files.slack.com/old'))).toThrow();
});
