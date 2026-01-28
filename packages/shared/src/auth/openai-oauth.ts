/**
 * Native OpenAI OAuth with PKCE (ChatGPT subscription)
 *
 * Mirrors the Claude OAuth flow but is fully configurable via env vars so
 * it can be aligned with OpenAI's current OAuth endpoints and client IDs.
 */
import { randomBytes, createHash } from 'node:crypto'
import { OPENAI_OAUTH_CONFIG, assertOpenAIOAuthConfigured } from './openai-oauth-config.ts'

async function openUrl(url: string): Promise<void> {
  const open = await import('open')
  const openFn = open.default || open
  await openFn(url)
}

const OPENAI_CLIENT_ID = OPENAI_OAUTH_CONFIG.CLIENT_ID
const OPENAI_AUTH_URL = OPENAI_OAUTH_CONFIG.AUTH_URL
const OPENAI_TOKEN_URL = OPENAI_OAUTH_CONFIG.TOKEN_URL
const REDIRECT_URI = OPENAI_OAUTH_CONFIG.REDIRECT_URI
const OAUTH_SCOPES = OPENAI_OAUTH_CONFIG.SCOPES
const STATE_EXPIRY_MS = 10 * 60 * 1000

export interface OpenAITokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scopes?: string[]
}

export interface OpenAIOAuthState {
  state: string
  codeVerifier: string
  timestamp: number
  expiresAt: number
}

let currentOAuthState: OpenAIOAuthState | null = null

function generateState(): string {
  return randomBytes(32).toString('hex')
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  return { codeVerifier, codeChallenge }
}

export async function startOpenAIOAuth(
  onStatus?: (message: string) => void
): Promise<string> {
  assertOpenAIOAuthConfigured()
  onStatus?.('Generating OpenAI authentication URL...')

  const state = generateState()
  const { codeVerifier, codeChallenge } = generatePKCE()

  const now = Date.now()
  currentOAuthState = {
    state,
    codeVerifier,
    timestamp: now,
    expiresAt: now + STATE_EXPIRY_MS,
  }

  const params = new URLSearchParams({
    client_id: OPENAI_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: OAUTH_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  })

  const authUrl = `${OPENAI_AUTH_URL}?${params.toString()}`

  onStatus?.('Opening browser for OpenAI authentication...')
  await openUrl(authUrl)
  onStatus?.('Waiting for you to copy the authorization code...')

  return authUrl
}

export function hasValidOpenAIOAuthState(): boolean {
  if (!currentOAuthState) return false
  return Date.now() < currentOAuthState.expiresAt
}

export function clearOpenAIOAuthState(): void {
  currentOAuthState = null
}

export async function exchangeOpenAICode(
  authorizationCode: string,
  onStatus?: (message: string) => void
): Promise<OpenAITokens> {
  assertOpenAIOAuthConfigured()

  if (!currentOAuthState) {
    throw new Error('No OpenAI OAuth state found. Please start the authentication flow again.')
  }

  if (Date.now() > currentOAuthState.expiresAt) {
    clearOpenAIOAuthState()
    throw new Error('OpenAI OAuth state expired (older than 10 minutes). Please try again.')
  }

  const cleanedCode = authorizationCode.split('#')[0]?.split('&')[0] ?? authorizationCode

  onStatus?.('Exchanging OpenAI authorization code for tokens...')

  const params = {
    grant_type: 'authorization_code',
    client_id: OPENAI_CLIENT_ID,
    code: cleanedCode,
    redirect_uri: REDIRECT_URI,
    code_verifier: currentOAuthState.codeVerifier,
  }

  const response = await fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://auth.openai.com',
      Referer: 'https://auth.openai.com/',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    const errorText = await response.text()
    let errorMessage: string
    try {
      const errorJson = JSON.parse(errorText) as { error?: string; error_description?: string }
      errorMessage = errorJson.error_description || errorJson.error || errorText
    } catch {
      errorMessage = errorText
    }
    throw new Error(`Token exchange failed: ${response.status} - ${errorMessage}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  }

  clearOpenAIOAuthState()
  onStatus?.('OpenAI authentication successful!')

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scopes: data.scope ? data.scope.split(' ') : ['openid', 'profile', 'email'],
  }
}
