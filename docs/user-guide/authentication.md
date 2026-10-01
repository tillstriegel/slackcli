# Authentication in the privacy fork

Standard app tokens and browser session credentials are supported. Standard
credentials use the Slack SDK; browser credentials use a validated Slack
workspace origin. See [PRIVACY.md](../../PRIVACY.md) for the full policy.

## 1. Standard Slack app tokens

Create a Slack app with the scopes required by your commands. Save its token
in an owner-only local file, then read it through stdin:

```bash
slackcli auth login --token-stdin --workspace-name="My Team" < token.txt
# macOS, when the token is already on your local clipboard:
pbpaste | slackcli auth login --token-stdin --workspace-name="My Team"
```

The token is checked with Slack `auth.test` before storage. Do not write token
values into shell commands or history. Legacy `--token` remains with a warning
because it exposes the value in argv and shell history.
Standard login accepts `xoxb-` and `xoxp-` access tokens, including rotated
`xoxe.xoxb-` and `xoxe.xoxp-` forms. It refuses refresh tokens (`xoxe-`) and
browser tokens. Rotation does not change the stored bot/user type.

Useful scopes, by what you want to do:

| Task | Scopes |
|---|---|
| List channels | `channels:read`, `groups:read`, `im:read`, `mpim:read` |
| Read history | `channels:history`, `groups:history`, `im:history`, `mpim:history` |
| Send / edit messages | `chat:write` |
| React | `reactions:write` |
| Upload files | `files:write` |
| Search messages | `search:read` (user tokens only) |
| Read canvases | `files:read` |

## 2. Browser credentials from a local cURL request

Copy a Slack API request from your own browser DevTools with **Copy as cURL**.
Supply the saved request through stdin or explicitly read the clipboard:

```bash
slackcli auth parse-curl --login < curl-command.txt
pbpaste | slackcli auth parse-curl --login
slackcli auth parse-curl --from-clipboard --login
```

The command extracts credentials locally. Without `--login`, it reports only
safe workspace metadata and whether credentials were found. Credential values
and prefixes are never displayed. Protect the request file like a token file.
Interactive secret paste is disabled before the terminal starts reading it.
Legacy positional cURL input warns about argv/history exposure.

## 3. Manual browser token entry

An owner-only local JSON file can contain `xoxd` and `xoxc` string fields:

```bash
slackcli auth login-browser --tokens-stdin \
  --workspace-url=https://yourteam.slack.com < browser-tokens.json
```

The workspace URL must be an HTTPS Slack workspace origin. Enterprise
subdomains are supported. Paths, queries, fragments, userinfo, nondefault
ports and `app.slack.com` are refused. A trailing root slash normalizes safely.
Legacy `--xoxd`/`--xoxc` flags remain with a warning; prefer stdin.

Browser-only features include drafts and arbitrary thread-reply lookup.
Standard tokens keep their normal read, search and message behavior, subject
to Slack scopes and token-type restrictions.

## Disabled automatic login

`auth login-auto` gives a clear error before any browser launch, capture,
profile creation or network. Its old options cannot enable it. A regular
browser can contact third parties during startup or SSO, so this fork does
not automate that path.

## Where credentials are stored

```bash
slackcli auth list
slackcli auth set-default T1234567
slackcli auth remove T1234567
slackcli auth logout
```

Profiles and default selection are preserved. `--profile <name>` works with
both stdin login paths. Logout can clean an inherited SlackCLI browser
profile; `--keep-browser-session` leaves it alone.

Credentials are stored locally as plaintext in `workspaces.json`, with POSIX
file mode 0600 in a 0700 credential directory. Existing modes are repaired.
Symlinked config paths and linked credential files are refused. These modes
are not encryption and Windows also requires suitable ACLs.

Keychain writes and migration **to** Keychain are disabled because the inherited
write command exposes secrets in argv. Existing Keychain profiles retain their
backend; refresh fails closed, with no silent plaintext fallback. Reading or
removing existing profiles and explicit migration back to file remain available:

```bash
slackcli auth migrate-secrets --to file --profile T1234567 --yes
```

Logging is off by default; `-v` or an explicit `SLACKCLI_LOG_LEVEL` opts in.
No real account authentication was used for the fork's tests.

Next: [workspaces and profiles](workspaces.md).
