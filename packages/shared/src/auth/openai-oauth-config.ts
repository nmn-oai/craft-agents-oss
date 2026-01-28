/**
 * OpenAI OAuth Configuration (ChatGPT subscription login)
 *
 * We use the OAuth Device Authorization Grant flow so users can
 * authenticate in their browser and paste back a short code.
 */

const OPENAI_CLIENT_ID = process.env.OPENAI_OAUTH_CLIENT_ID || ''

export const OPENAI_OAUTH_CONFIG = {
  /** OAuth client ID for device flow */
  CLIENT_ID: OPENAI_CLIENT_ID,
  /** Device code endpoint */
  DEVICE_CODE_URL: process.env.OPENAI_OAUTH_DEVICE_CODE_URL || 'https://api.openai.com/v1/oauth/device/code',
  /** Token endpoint */
  TOKEN_URL: process.env.OPENAI_OAUTH_TOKEN_URL || 'https://api.openai.com/v1/oauth/token',
  /** Requested scopes */
  SCOPES: process.env.OPENAI_OAUTH_SCOPES || 'openid profile email offline_access',
} as const

/**
 * Ensure we have a client id for device OAuth.
 */
export function assertOpenAIOAuthConfigured(): void {
  if (!OPENAI_OAUTH_CONFIG.CLIENT_ID) {
    throw new Error('OPENAI_OAUTH_CLIENT_ID is not configured')
  }
}

