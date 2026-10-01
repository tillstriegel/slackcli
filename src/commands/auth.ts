import { Command } from 'commander';
import ora, { type Ora } from 'ora';
import { authenticateStandard, authenticateBrowser } from '../lib/auth.ts';
import {
  getAllWorkspaceEntries,
  setDefaultWorkspace,
  removeWorkspace,
  clearAllWorkspaces,
  getDefaultWorkspaceId,
  migrateSecrets,
} from '../lib/workspaces.ts';
import { success, error, info, warning, formatWorkspace } from '../lib/formatter.ts';
import chalk from 'chalk';
import { parseCurlCommand, type ParsedCurlResult } from '../lib/curl-parser.ts';
import { resolveCurlInput, type CurlInputResult } from '../lib/curl-input.ts';
import { clearBrowserProfile } from '../lib/browser-launcher.ts';
import { parseStandardToken, parseBrowserTokens, readCredentialStdin } from '../lib/credential-input.ts';
import { confirmWrite } from './usergroups.ts';
import type { SecretBackend } from '../types/index.ts';

// Validate before authentication or storage. The platform parameter is retained
// for existing callers; this fork refuses Keychain writes on every platform.
export function resolveSecretBackend(
  value: string,
  _platform: string = process.platform,
): SecretBackend {
  if (value !== 'file' && value !== 'keychain') {
    error('--secret-backend must be "file"; Keychain writes are disabled in this privacy fork');
    process.exit(1);
  }
  if (value === 'keychain') {
    error('Keychain writes are disabled in this privacy fork; use --secret-backend file.');
    process.exit(1);
  }
  return value;
}

// Prints the message, usage and tips for a `parse-curl` input that could not
// be resolved. The caller exits; the strings are the ones the handler used to
// print inline.
function reportCurlInputFailure(
  result: Extract<CurlInputResult, { ok: false }>,
  clipboardSpinner: Ora,
): void {
  switch (result.reason) {
    case 'clipboard-failed':
      clipboardSpinner.fail('Failed to read clipboard');
      error('Clipboard read failed. Use local stdin.');
      console.log(chalk.yellow('\n💡 Tip: Try local stdin instead:'));
      console.log(chalk.cyan('   slackcli auth parse-curl --login < curl-command.txt\n'));
      return;
    case 'not-curl':
      clipboardSpinner.succeed('Read from clipboard');
      error('Clipboard content does not appear to be a cURL command');
      console.log(chalk.yellow('\n💡 Tip: Make sure you copied the cURL command from browser DevTools'));
      console.log(chalk.yellow('   Right-click on request → Copy → Copy as cURL\n'));
      return;
    case 'empty':
      error('No cURL command provided. Usage:');
      console.log('\n  Local stdin (recommended):');
      console.log(chalk.cyan('    pbpaste | slackcli auth parse-curl --login'));
      console.log('\n  From clipboard:');
      console.log(chalk.cyan('    slackcli auth parse-curl --from-clipboard --login'));
      console.log('\n  Piped input:');
      console.log(chalk.cyan('    pbpaste | slackcli auth parse-curl --login'));
      return;
  }
}

async function loginWithParsedTokens(parsed: ParsedCurlResult, secretBackend: SecretBackend): Promise<void> {
  const spinner = ora('Authenticating with extracted tokens...').start();
  try {
    const { config, profileKey } = await authenticateBrowser(
      parsed.xoxd,
      parsed.xoxc,
      parsed.workspaceUrl,
      parsed.workspaceName,
      undefined,
      secretBackend
    );
    spinner.succeed('Authentication successful!');
    success(`Authenticated as workspace: ${config.workspace_name}`);
    info(`Workspace ID: ${config.workspace_id}`);
    info(`Profile: ${profileKey}`);
  } catch (err: any) {
    spinner.fail('Authentication failed');
    error(err.message);
    process.exit(1);
  }
}

function printLoginHint(): void {
  info('To authenticate, pipe the same cURL input into slackcli auth parse-curl --login, or use --from-clipboard --login.');
}

export function createAuthCommand(): Command {
  const auth = new Command('auth')
    .description('Manage workspace authentication');

  // Login with standard token
  auth
    .command('login')
    .description('Login with standard Slack app token (xoxb-* or xoxp-*)')
    .option('--token <token>', 'Legacy input: exposes credentials in argv/history; prefer --token-stdin')
    .option('--token-stdin', 'Read one standard token from noninteractive stdin')
    .requiredOption('--workspace-name <name>', 'Workspace name for identification')
    .option('--profile <name>', 'Store under a named profile (keeps multiple identities for one workspace)')
    .option('--secret-backend <backend>', 'Where to store credentials for a NEW profile: file (default); Keychain writes disabled', 'file')
    .action(async (options) => {
      const secretBackend = resolveSecretBackend(options.secretBackend);
      const spinner = ora('Authenticating...').start();

      try {
        if (options.tokenStdin && options.token) throw new Error('Choose --token-stdin or --token');
        if (options.token) warning('Legacy token options expose credentials in argv and shell history. Prefer --token-stdin.');
        const { config, profileKey } = await authenticateStandard(
          options.tokenStdin
            ? parseStandardToken(await readCredentialStdin())
            : parseStandardToken(options.token ?? ''),
          options.workspaceName,
          options.profile,
          secretBackend
        );

        spinner.succeed('Authentication successful!');
        success(`Authenticated as workspace: ${config.workspace_name}`);
        info(`Workspace ID: ${config.workspace_id}`);
        info(`Profile: ${profileKey}`);
        if (config.auth_type === 'standard') {
          info(`Token Type: ${config.token_type}`);
        }
      } catch (err: any) {
        spinner.fail('Authentication failed');
        error(err.message);
        process.exit(1);
      }
    });

  // Login with browser tokens
  auth
    .command('login-browser')
    .description('Login with browser session tokens (xoxd-* and xoxc-*)')
    .option('--xoxd <token>', 'Legacy input: exposes credentials in argv/history')
    .option('--xoxc <token>', 'Legacy input: exposes credentials in argv/history')
    .option('--tokens-stdin', 'Read JSON with xoxd and xoxc fields from noninteractive stdin')
    .requiredOption('--workspace-url <url>', 'Workspace URL (e.g., https://myteam.slack.com)')
    .option('--workspace-name <name>', 'Optional workspace name for identification')
    .option('--profile <name>', 'Store under a named profile (keeps multiple identities for one workspace)')
    .option('--secret-backend <backend>', 'Where to store credentials for a NEW profile: file (default); Keychain writes disabled', 'file')
    .action(async (options) => {
      const secretBackend = resolveSecretBackend(options.secretBackend);
      const spinner = ora('Authenticating...').start();

      try {
        if (options.tokensStdin && (options.xoxd || options.xoxc)) throw new Error('Choose --tokens-stdin or legacy token options');
        if (options.xoxd || options.xoxc) warning('Legacy token options expose credentials in argv and shell history. Prefer --tokens-stdin.');
        const tokens = options.tokensStdin ? parseBrowserTokens(await readCredentialStdin()) : parseBrowserTokens(JSON.stringify({ xoxd: options.xoxd, xoxc: options.xoxc }));
        const { config, profileKey } = await authenticateBrowser(
          tokens.xoxd,
          tokens.xoxc,
          options.workspaceUrl,
          options.workspaceName,
          options.profile,
          secretBackend
        );

        spinner.succeed('Authentication successful!');
        success(`Authenticated as workspace: ${config.workspace_name}`);
        info(`Workspace ID: ${config.workspace_id}`);
        info(`Profile: ${profileKey}`);
        if (config.auth_type === 'browser') {
          info(`Workspace URL: ${config.workspace_url}`);
        }
      } catch (err: any) {
        spinner.fail('Authentication failed');
        error(err.message);
        process.exit(1);
      }
    });

  // Login by capturing tokens from a browser session
  auth
    .command('login-auto')
    .description('Disabled in the privacy fork: browser capture cannot guarantee private networking')
    .option('--workspace-url <url>', 'Disabled')
    .option('--headless', 'Disabled')
    .option('--timeout <seconds>', 'Disabled')
    .option('--secret-backend <backend>', 'Disabled', 'file')
    .action(() => {
      error('login-auto is disabled in this privacy fork. Use auth login --token-stdin or auth parse-curl with local stdin.');
      process.exitCode = 1;
    });

  // List all workspaces
  auth
    .command('list')
    .description('List all authenticated workspaces')
    .action(async () => {
      try {
        const entries = await getAllWorkspaceEntries();
        const defaultKey = await getDefaultWorkspaceId();

        if (entries.length === 0) {
          info('No authenticated workspaces found.');
          info('Run "slackcli auth login" or "slackcli auth login-browser" to authenticate.');
          return;
        }

        console.log(chalk.bold(`\n📋 Authenticated Workspaces (${entries.length}):\n`));

        entries.forEach(({ key, config }, idx) => {
          const isDefault = key === defaultKey;
          console.log(`${idx + 1}. ${formatWorkspace(config, isDefault, key)}\n`);
        });
      } catch (err: any) {
        error('Failed to list workspaces', err.message);
        process.exit(1);
      }
    });

  // Set default workspace
  auth
    .command('set-default')
    .description('Set default workspace')
    .argument('<workspace>', 'Profile name, workspace ID, or workspace name')
    .action(async (identifier) => {
      try {
        await setDefaultWorkspace(identifier);
        success(`Set ${identifier} as default workspace`);
      } catch (err: any) {
        error('Failed to set default workspace', err.message);
        process.exit(1);
      }
    });

  // Remove workspace
  auth
    .command('remove')
    .description('Remove a workspace')
    .argument('<workspace>', 'Profile name, workspace ID, or workspace name')
    .action(async (identifier) => {
      try {
        await removeWorkspace(identifier);
        success(`Removed workspace ${identifier}`);
      } catch (err: any) {
        error('Failed to remove workspace', err.message);
        process.exit(1);
      }
    });

  // Logout (clear all workspaces)
  auth
    .command('logout')
    .description('Logout from all workspaces')
    .option('--keep-browser-session', 'Leave the login-auto browser profile signed in')
    .action(async (options) => {
      try {
        await clearAllWorkspaces();

        // The browser profile is a credential store in its own right: while it
        // exists, `login-auto` re-mints valid tokens with no interaction. A
        // logout that left it behind would report a logout it did not perform.
        if (options.keepBrowserSession) {
          warning('Browser session kept — the inherited browser session remains stored.');
        } else {
          const cleared = await clearBrowserProfile();
          // Never silent about a profile left behind: it is a live credential,
          // and a logout the user believes is complete would not be.
          if (!cleared.cleared && cleared.reason === 'not_ours') {
            warning(
              `Left ${cleared.path} alone — slackcli did not create it, so it was not deleted.`
            );
            console.log(chalk.dim('   Remove it yourself if it holds a Slack session.'));
          }
        }

        success('Logged out from all workspaces');
      } catch (err: any) {
        error('Failed to logout', err.message);
        process.exit(1);
      }
    });

  // Extract tokens guide
  auth
    .command('extract-tokens')
    .description('Show guide for extracting browser tokens')
    .action(() => {
      info('Automatic browser capture is disabled in this privacy fork. Copy a cURL request from your own browser and supply it through local stdin or --from-clipboard.');
      console.log('1. Open your Slack workspace in a web browser');
      console.log('2. Open Developer Tools (F12 or Cmd+Option+I)');
      console.log('3. Go to the Network tab');
      console.log('4. Refresh the page or send a message');
      console.log('5. Look for any Slack API request (e.g., conversations.list)');
      console.log('\n📝 Extract the tokens:');
      console.log('   - xoxd token: In the "Cookie" header, look for d=xoxd-...');
      console.log('   - xoxc token: In the request payload, look for "token":"xoxc-..."');
      console.log('\n✨ Use the tokens:');
      console.log('   pbpaste | slackcli auth parse-curl --login');
      console.log('   Or: slackcli auth parse-curl --from-clipboard --login');
      console.log('   (Reads directly from your clipboard)\n');
    });

  // Parse cURL command to extract tokens
  auth
    .command('parse-curl')
    .description('Extract xoxd and xoxc tokens from a cURL command')
    .argument('[curl-command]', 'Legacy argv input; prefer local stdin or --from-clipboard')
    .option('--login', 'Automatically login with extracted tokens')
    .option('--from-clipboard', 'Read cURL command from system clipboard')
    .option('--secret-backend <backend>', 'With --login: where to store credentials for a NEW profile: file (default); Keychain writes disabled', 'file')
    .action(async (curlCommand, options) => {
      const secretBackend = options.login ? resolveSecretBackend(options.secretBackend) : 'file';
      try {
        const clipboardSpinner = ora('Reading from clipboard...');
        const resolved = await resolveCurlInput(curlCommand, {
          fromClipboard: options.fromClipboard,
          onProgress: () => clipboardSpinner.start(),
        });
        if (!resolved.ok) {
          reportCurlInputFailure(resolved, clipboardSpinner);
          process.exit(1);
        }
        if (resolved.source === 'clipboard') {
          clipboardSpinner.succeed('Read from clipboard');
        }
        if (resolved.source === 'argument') warning('Positional cURL input exposes credentials in argv/history. Prefer local stdin.');
        const curlInput = resolved.input;

        console.log(chalk.bold('\n🔍 Parsing cURL command...\n'));

        // Parse the cURL command
        const parsed = parseCurlCommand(curlInput);

        // Display extracted tokens
        success('✅ Successfully extracted tokens!\n');
        console.log(chalk.bold('Workspace:'));
        console.log(`  Name: ${chalk.cyan(parsed.workspaceName)}`);
        console.log(`  URL:  ${chalk.cyan(parsed.workspaceUrl)}\n`);

        info('Browser credentials found (values are never displayed).');

        // If --login flag is set, authenticate directly
        if (options.login) {
          await loginWithParsedTokens(parsed, secretBackend);
        } else {
          printLoginHint();
        }
      } catch (err: any) {
        error('Failed to parse cURL command', err.message);
        console.log(chalk.yellow('\n💡 Tip: Right-click on a Slack API request in browser DevTools'));
        console.log(chalk.yellow('   → Copy → Copy as cURL, then paste here\n'));
        process.exit(1);
      }
    });

  // Move stored credentials to a different SecretStore backend
  auth
    .command('migrate-secrets')
    .description('Move existing Keychain credentials to file; Keychain writes are disabled')
    .requiredOption('--to <backend>', 'Target backend: file or keychain (macOS only)')
    .option('--profile <name>', 'Migrate only this profile (default: every configured profile)')
    .option('--yes', 'Skip the confirmation prompt', false)
    .action(async (options) => {
      const target = resolveSecretBackend(options.to);

      const prompt = options.profile
        ? `Migrate profile "${options.profile}" to the ${target} backend?`
        : `Migrate every configured profile to the ${target} backend?`;
      if (!(await confirmWrite(prompt, options.yes))) {
        process.exit(1);
      }

      const spinner = ora('Migrating credentials...').start();
      try {
        const { results, failed } = await migrateSecrets(target, options.profile);
        const moved = results.filter((r) => r.migrated);
        const already = results.filter((r) => !r.migrated && !r.pendingCleanup);
        // The new backend already holds a verified copy for every one of
        // these — only the old copy's removal is outstanding, so this is
        // never counted as a failure, just flagged for a later retry.
        const pendingCleanup = results.filter((r) => r.pendingCleanup);

        if (moved.length === 0 && pendingCleanup.length === 0 && failed.length === 0) {
          spinner.succeed(
            already.length > 0
              ? `Already on the ${target} backend — nothing to migrate.`
              : 'No matching profile found.'
          );
        } else if (failed.length === 0) {
          spinner.succeed(`Migrated ${moved.length} profile${moved.length === 1 ? '' : 's'} to ${target}.`);
        } else {
          spinner.warn(`Migrated ${moved.length}, ${failed.length} failed.`);
        }

        moved.filter((r) => !r.pendingCleanup).forEach((r) => success(`${r.key}: ${r.from} -> ${r.to}`));
        already.forEach((r) => info(`${r.key}: already on ${r.to}`));
        pendingCleanup.forEach((r) => warning(
          `${r.key}: now on ${r.to}, but the old ${r.pendingCleanup} copy could not be removed yet — re-run this command to retry.`
        ));
        failed.forEach((f) => error(`${f.key}: ${f.error}`));

        if (failed.length > 0) process.exit(1);
      } catch (err: any) {
        spinner.fail('Migration failed');
        error(err.message);
        process.exit(1);
      }
    });

  return auth;
}
