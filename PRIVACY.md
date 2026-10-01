# SlackCLI privacy fork

Version `0.13.0-till.1` identifies this fork. It keeps regular Slack reads,
searches, messages and files. Requested Slack operations send credentials and
request data to Slack; results can contain private data on stdout. This is not
a promise of zero data egress. No real Slack account was used to test this fork.

## Network policy

- Standard API calls use the pinned SDK base `https://slack.com/api/`, with
  absolute method URLs disabled, proxies disabled and no automatic redirects.
- Browser credentials require an HTTPS workspace origin under `*.slack.com`,
  including enterprise subdomains. `app.slack.com` is an app entry point, not a
  workspace origin. The apex, userinfo, encoded authority, trailing dot,
  nondefault ports, paths, queries and fragments are refused. A root slash and
  explicit port 443 normalize to the origin.
- API methods must be dotted Slack method names. Browser API and upload POSTs
  refuse all 3xx responses. Upload URLs must use HTTPS on `slack.com` or its
  subdomains and are checked before file bytes are read.
- The shared request boundary refuses `files.uploadV2` and legacy `files.upload`
  before invoking the SDK or reading file parameters. The compound SDK helper
  can post bytes to server-provided URLs outside this policy; disabling absolute
  API method URLs does not protect that path. Uploads use `uploadFileExternal`
  with destination checks; the actual `files.getUploadURLExternal` and
  `files.completeUploadExternal` API methods remain available.
- Downloads, including every redirect hop, allow only HTTPS on `slack.com`,
  `*.slack.com`, `slack-edge.com` or `*.slack-edge.com`. Credentials are attached
  only on Slack hosts, never on the CDN. Downloads allow at most five redirects.
  Userinfo, nondefault ports and ambiguous authorities are refused for files too.
- Slack requests fail before transport if any `HTTP_PROXY`, `HTTPS_PROXY` or
  `ALL_PROXY` variable (upper or lower case) is set, even with `NO_PROXY`.
  Unset these for the CLI. System VPNs, DNS, TLS trust and local host security
  remain outside this policy.

There are no telemetry sinks. Background GitHub checks, upstream self-update
and explicit update checks are disabled without an environment override.
`update` and `update check` give an offline explanation. `auth login-auto`
refuses before browser launch, capture or profile creation: a regular browser
and its SSO flow cannot guarantee no third-party traffic. Browser helper code
remains tested but is not reachable through automatic CLI login.

## Local credentials

Use `auth login --token-stdin` for one standard token, or
`auth login-browser --tokens-stdin --workspace-url https://team.slack.com` for
JSON with `xoxd` and `xoxc` fields. Pipe from an owner-only local file or a local
clipboard tool. Do not type secrets into shell commands. `auth parse-curl`
accepts local stdin or an explicitly requested `--from-clipboard`; it never
prints credential values or prefixes. Interactive secret entry fails closed
before changing terminal state. Legacy token flags and positional cURL input
remain available with warnings because argv and shell history expose secrets.
Standard access tokens include `xoxb-`, `xoxp-`, `xoxe.xoxb-` and `xoxe.xoxp-`.
Refresh tokens (`xoxe-`) and browser tokens are refused by standard login.

Credentials remain plaintext in `~/.config/slackcli/workspaces.json`. The
credential directory and file use owner-only POSIX modes (0700/0600), repaired
on existing paths. Symlinked config paths and symlinked or hard-linked files
are refused. This protects against casual access by other users, not malware
running as your user or a hostile process racing path changes. File writes are
not crash-atomic; maintain private backups. Windows needs private filesystem
ACLs; POSIX modes do not provide the same guarantee there.

Keychain writes and migration to Keychain are disabled: the inherited
`security -w` write puts secrets in argv. Existing Keychain profiles can still
be read/deleted or explicitly migrated to file; failed writes never fall back
silently to plaintext. No custom encryption has been added.

Diagnostic logs are off by default. Opt in with `-v` or an explicit
`SLACKCLI_LOG_LEVEL` (`info`, `debug`, etc.). Logs stay on local disk/stderr,
redact credentials, and exclude request values. Review logs and CLI output
before sharing: IDs and system details can still be sensitive. Usage errors
use generic output so unknown arguments cannot expose pasted credentials.

Public dependency downloads are part of development, not runtime telemetry.
The exact Axios override is 1.20.0; the OSV version query returned no advisories
on 2026-10-01. This is a dated advisory check, not a guarantee about all future
vulnerabilities. Fork workflows cannot publish releases, Homebrew updates,
Pages or Sonar scans to inherited destinations.
