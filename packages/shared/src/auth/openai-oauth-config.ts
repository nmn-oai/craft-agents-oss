/**
 * OpenAI OAuth configuration (ChatGPT subscription)
 *
 * These defaults are intentionally overridable via environment variables so
 * downstream apps can supply the correct OpenAI OAuth client configuration
 * without patching the code.
 */

function getEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

/**
 * Default OpenAI OAuth client ID shared by Codex/opencode/Clawdbot.
 * This is a public OAuth client identifier (no secret).
 */
const DEFAULT_OPENAI_OAUTH_CLIENT_ID = 'codex';
const DEFAULT_OPENAI_OAUTH_REDIRECT_URI = 'http://127.0.0.1:0/callback';

/** Anthropic-compatible OpenAI endpoint used by the Claude Agent SDK. */
export const OPENAI_ANTHROPIC_BASE_URL = getEnv(
  'OPENAI_ANTHROPIC_BASE_URL',
  'https://api.openai.com/v1/anthropic'
);

export const OPENAI_OAUTH_CONFIG = {
  CLIENT_ID: getEnv('OPENAI_OAUTH_CLIENT_ID', DEFAULT_OPENAI_OAUTH_CLIENT_ID),
  AUTH_URL: getEnv('OPENAI_OAUTH_AUTH_URL', 'https://auth.openai.com/oauth/authorize'),
  TOKEN_URL: getEnv('OPENAI_OAUTH_TOKEN_URL', 'https://auth.openai.com/oauth/token'),
  REDIRECT_URI: getEnv('OPENAI_OAUTH_REDIRECT_URI', DEFAULT_OPENAI_OAUTH_REDIRECT_URI),
  SCOPES: getEnv('OPENAI_OAUTH_SCOPES', 'openid profile email offline_access'),
} as const;

export function assertOpenAIOAuthConfigured(): void {
  if (!OPENAI_OAUTH_CONFIG.CLIENT_ID) {
    throw new Error(
      'OpenAI OAuth is not configured. Set OPENAI_OAUTH_CLIENT_ID to enable ChatGPT subscription login.'
    );
  }
}
