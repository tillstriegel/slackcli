# Build and verify the privacy fork

Use this fork's reviewed source. Upstream Homebrew packages and release
binaries do not contain these privacy changes.

Requires Bun 1.4.1 or newer. Use the pinned Bun supplied for your build:

```bash
git clone --branch privacy-hardened https://github.com/tillstriegel/slackcli.git
cd slackcli
bun install --frozen-lockfile --ignore-scripts
bun run type-check
bun test
bun run build
./dist/slackcli --version
./dist/slackcli --help
```

The local build produces `dist/slackcli`; version `0.13.0-till.1` identifies this
fork. Review the artifact before placing it on your PATH. Building does not
install globally. See [development setup](../development/setup.md) for hooks.

## Updating

`slackcli update` and `slackcli update check` only print an offline explanation.
There is no background GitHub check, cache refresh or upstream binary download,
regardless of environment flags. To update this fork, review a new fork revision
and build it locally. Do not replace it with an upstream binary.

## Credentials and removal

Use [local stdin authentication](authentication.md). Credentials are plaintext
and owner-only on POSIX systems; see [PRIVACY.md](../../PRIVACY.md).
`slackcli auth logout` removes configured credentials and can clean an inherited
SlackCLI browser profile. Remove a manually installed binary from its chosen
location separately. No real account login was part of fork verification.
