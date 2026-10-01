import { canonicalWorkspaceOrigin } from './slack-url-policy.ts';
import { getLogger } from '@logtape/logtape';
import { SlackClient } from './slack-client.ts';
import { addWorkspace, getWorkspace } from './workspaces.ts';
import type {
  StandardAuthConfig,
  BrowserAuthConfig,
  WorkspaceConfig,
  SecretBackend,
} from '../types/index.ts';
import { extractSlackWorkspaceName } from './curl-parser.ts';

const logger = getLogger(['slackcli', 'auth']);

function logAuthenticated(authType: WorkspaceConfig['auth_type'], workspaceId: string, profileKey: string): void {
  logger.info('Authenticated {auth_type} workspace {workspace_id}', {
    auth_type: authType,
    workspace_id: workspaceId,
    profile_key: profileKey,
  });
}

function logAuthFailed(authType: WorkspaceConfig['auth_type'], error: unknown): void {
  logger.warn('{auth_type} authentication failed', {
    auth_type: authType,
    error_name: error instanceof Error ? error.name : 'UnknownError',
  });
}

// Result of a successful login: the stored config plus the profile key it was
// saved under (which may be user-chosen, the team_id, or auto-generated).
export interface AuthResult {
  config: WorkspaceConfig;
  profileKey: string;
}

// Authenticate with standard token
export async function authenticateStandard(
  token: string,
  workspaceName: string,
  profile?: string,
  secretBackend: SecretBackend = 'file'
): Promise<AuthResult> {
  // Create a temporary config to test the token
  const tempConfig: StandardAuthConfig = {
    workspace_id: 'temp',
    workspace_name: workspaceName,
    auth_type: 'standard',
    token,
    token_type: /^(?:xoxe\.)?xoxb-/.test(token) ? 'bot' : 'user',
  };

  const client = new SlackClient(tempConfig);

  try {
    const authTest = await client.testAuth();

    // Update with real workspace info
    const config: StandardAuthConfig = {
      ...tempConfig,
      workspace_id: authTest.team_id,
      workspace_name: workspaceName || authTest.team,
      user_id: authTest.user_id,
    };

    // Save the workspace
    const profileKey = await addWorkspace(config, profile, secretBackend);
    logAuthenticated(config.auth_type, config.workspace_id, profileKey);

    return { config, profileKey };
  } catch (error: any) {
    logAuthFailed(tempConfig.auth_type, error);
    throw new Error(`Authentication failed: ${error.message}`);
  }
}

// Authenticate with browser tokens
export async function authenticateBrowser(
  xoxdToken: string,
  xoxcToken: string,
  workspaceUrl: string,
  workspaceName?: string,
  profile?: string,
  secretBackend: SecretBackend = 'file'
): Promise<AuthResult> {
  workspaceUrl = canonicalWorkspaceOrigin(workspaceUrl);
  // Extract workspace name from URL if not provided
  const defaultName = extractSlackWorkspaceName(workspaceUrl);

  // Create a temporary config to test the tokens
  const tempConfig: BrowserAuthConfig = {
    workspace_id: 'temp',
    workspace_name: workspaceName || defaultName,
    workspace_url: workspaceUrl,
    auth_type: 'browser',
    xoxd_token: xoxdToken,
    xoxc_token: xoxcToken,
  };

  const client = new SlackClient(tempConfig);

  try {
    const authTest = await client.testAuth();

    // Update with real workspace info
    const config: BrowserAuthConfig = {
      ...tempConfig,
      workspace_id: authTest.team_id,
      workspace_name: workspaceName || authTest.team,
      user_id: authTest.user_id,
    };

    // Save the workspace
    const profileKey = await addWorkspace(config, profile, secretBackend);
    logAuthenticated(config.auth_type, config.workspace_id, profileKey);

    return { config, profileKey };
  } catch (error: any) {
    logAuthFailed(tempConfig.auth_type, error);
    throw new Error(`Authentication failed: ${error.message}`);
  }
}

export interface AutoLoginResult {
  saved: WorkspaceConfig[];
  failed: Array<{ workspaceUrl: string; error: string }>;
}

export interface AutoLoginOptions {
  headless?: boolean;
  workspaceUrl?: string;
  timeoutMs?: number;
  onProgress?: (line: string) => void;
  secretBackend?: SecretBackend;
}

// Retained compatibility entry point. Automatic capture is disabled before
// browser, filesystem or network activity, for every option combination.
export async function authenticateAuto(
  _options: AutoLoginOptions = {}
): Promise<AutoLoginResult> {
  throw new Error('login-auto is disabled in this privacy fork. Use local stdin authentication.');
}

// Get authenticated client for workspace
export async function getAuthenticatedClient(workspaceIdentifier?: string): Promise<SlackClient> {
  const workspace = await getWorkspace(workspaceIdentifier);

  if (!workspace) {
    logger.warn('No workspace resolved ({selector})', {
      selector: workspaceIdentifier ? 'explicit' : 'default',
    });
    if (workspaceIdentifier) {
      throw new Error(`Workspace not found: ${workspaceIdentifier}`);
    } else {
      throw new Error('No workspace configured. Run "slackcli auth login" first.');
    }
  }

  logger.debug('Using {auth_type} workspace {workspace_id}', {
    auth_type: workspace.auth_type,
    workspace_id: workspace.workspace_id,
  });
  return new SlackClient(workspace);
}
