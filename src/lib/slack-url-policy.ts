// Positive domain policy for every Slack transport. Never include an input URL
// in an error: a URL can contain credentials or private query parameters.
function parseSlackUrl(value: string): URL {
  if (!/^https:\/\//i.test(value) || /[\s\\]/.test(value)) {
    throw new Error('URL is not a secure Slack URL');
  }
  const authority = value.slice(value.indexOf('//') + 2).split(/[/?#]/, 1)[0];
  // Reject encoded authority and userinfo before URL canonicalization hides them.
  if (!authority || /[%@]/.test(authority)) throw new Error('Invalid Slack URL authority');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid Slack URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname.endsWith('.')) {
    throw new Error('Invalid Slack URL authority');
  }
  return url;
}

export function isSlackHost(url: URL): boolean {
  return url.hostname === 'slack.com' || url.hostname.endsWith('.slack.com');
}

export function canonicalWorkspaceOrigin(value: string): string {
  const url = parseSlackUrl(value);
  // Check raw tail as well: /../ would otherwise normalize into a root slash.
  const tail = value.slice(value.indexOf('//') + 2).replace(/^[^/?#]+/, '');
  if (!isSlackHost(url) || url.hostname === 'slack.com' || url.hostname === 'app.slack.com' ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+slack\.com$/.test(url.hostname) ||
      (tail !== '' && tail !== '/')) {
    throw new Error('Workspace URL must be an HTTPS Slack workspace origin');
  }
  return url.origin;
}

export function assertSlackMethod(method: string): void {
  if (!/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/.test(method)) {
    throw new Error('Invalid Slack API method');
  }
}

export function slackFileUrl(value: string, allowCdn: boolean = false, base?: URL): URL {
  if (base) {
    if (/[\s\\]/.test(value)) throw new Error('Invalid Slack redirect URL');
    // Keep raw absolute authorities until policy checks have run. URL() would
    // otherwise erase percent-encoded host characters before validation.
    if (value.startsWith('//')) value = `https:${value}`;
    else if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = new URL(value, base).href;
  }
  const url = parseSlackUrl(value);
  const cdn = url.hostname === 'slack-edge.com' || url.hostname.endsWith('.slack-edge.com');
  if (!isSlackHost(url) && !(allowCdn && cdn)) throw new Error('URL is not hosted by Slack');
  return url;
}

// Bun can read these variables on each fetch. Fail closed rather than rely on
// proxy options that differ between runtime versions. Never print their values.
export function assertNoSlackProxy(env: NodeJS.ProcessEnv = process.env): void {
  if (['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'].some(k => env[k]?.trim())) {
    throw new Error('Slack requests require proxy environment variables to be unset in this privacy fork');
  }
}
