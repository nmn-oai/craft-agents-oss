/**
 * Native OpenAI OAuth with PKCE (ChatGPT subscription)
 *
 * Mirrors the Claude OAuth flow but is fully configurable via env vars so
 * it can be aligned with OpenAI's current OAuth endpoints and client IDs.
 */
import { randomBytes, createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
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
const OAUTH_AUDIENCE = OPENAI_OAUTH_CONFIG.AUDIENCE
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
  redirectUri: string
}

let currentOAuthState: OpenAIOAuthState | null = null

function generateState(): string {
  return randomBytes(32).toString('hex')
}

function generateSessionId(): string {
  return typeof randomUUID === 'function' ? randomUUID() : randomBytes(16).toString('hex')
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  return { codeVerifier, codeChallenge }
}

export interface OpenAIOAuthStartResult {
  authUrl: string
  tokens?: OpenAITokens
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

async function listenForOpenAICallback(
  redirectUri: string,
  expectedState: string,
  onStatus?: (message: string) => void
): Promise<{ redirectUri: string; codePromise: Promise<string> }> {
  const redirectUrl = new URL(redirectUri)
  if (redirectUrl.protocol !== 'http:' || !isLoopbackHost(redirectUrl.hostname)) {
    throw new Error(
      'OpenAI OAuth requires a loopback redirect URI (e.g. http://127.0.0.1:14565/callback).'
    )
  }

  const desiredPort = redirectUrl.port ? Number(redirectUrl.port) : 0
  let resolvedRedirectUri = redirectUrl.toString()
  let timeout: NodeJS.Timeout | null = null
  let resolveCode!: (code: string) => void
  let rejectCode!: (error: Error) => void

  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', redirectUrl)
    if (requestUrl.pathname !== redirectUrl.pathname) {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    const error = requestUrl.searchParams.get('error')
    const errorDescription = requestUrl.searchParams.get('error_description')
    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end(errorDescription ? `${error}: ${errorDescription}` : error)
      rejectCode(new Error(errorDescription || error))
      server.close()
      return
    }

    const code = requestUrl.searchParams.get('code')
    const returnedState = requestUrl.searchParams.get('state')

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Missing authorization code.')
      rejectCode(new Error('OpenAI OAuth callback missing authorization code.'))
      server.close()
      return
    }

    if (returnedState !== expectedState) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('State mismatch.')
      rejectCode(new Error('OpenAI OAuth state mismatch.'))
      server.close()
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"/><title>Authentication Complete</title></head>' +
        '<body><h1>Authentication complete</h1><p>You can return to Craft.</p></body></html>'
    )
    resolveCode(code)
    server.close()
  })

  const listenPromise = new Promise<void>((resolve, reject) => {
    server.on('error', (error) => {
      reject(error)
    })

    server.listen(desiredPort, redirectUrl.hostname, () => {
      const address = server.address() as AddressInfo | null
      if (!address) {
        reject(new Error('Failed to start OAuth callback server.'))
        server.close()
        return
      }

      const actualRedirect = new URL(redirectUrl.toString())
      actualRedirect.port = String(address.port)
      redirectUrl.port = String(address.port)
      resolvedRedirectUri = actualRedirect.toString()
      onStatus?.(`Listening for OpenAI OAuth callback on ${resolvedRedirectUri}...`)
      resolve()
    })
  })

  await listenPromise

  timeout = setTimeout(() => {
    rejectCode(new Error('OpenAI OAuth timed out waiting for callback.'))
    server.close()
  }, STATE_EXPIRY_MS)

  codePromise.finally(() => {
    if (timeout) clearTimeout(timeout)
  })

  return { redirectUri: resolvedRedirectUri, codePromise }
}

export async function startOpenAIOAuth(
  onStatus?: (message: string) => void
): Promise<OpenAIOAuthStartResult> {
  assertOpenAIOAuthConfigured()
  onStatus?.('Generating OpenAI authentication URL...')

  const state = generateState()
  const sessionId = generateSessionId()
  const { codeVerifier, codeChallenge } = generatePKCE()

  const loopbackListener = await listenForOpenAICallback(REDIRECT_URI, state, onStatus)

  const now = Date.now()
  currentOAuthState = {
    state,
    codeVerifier,
    timestamp: now,
    expiresAt: now + STATE_EXPIRY_MS,
    redirectUri: loopbackListener.redirectUri,
  }

  const params = new URLSearchParams({
    client_id: OPENAI_CLIENT_ID,
    response_type: 'code',
    redirect_uri: loopbackListener.redirectUri,
    session_id: sessionId,
    audience: OAUTH_AUDIENCE,
    scope: OAUTH_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  })

  const authUrl = `${OPENAI_AUTH_URL}?${params.toString()}`

  onStatus?.('Opening browser for OpenAI authentication...')
  await openUrl(authUrl)

  onStatus?.('Waiting for OpenAI authentication to complete...')

  const authorizationCode = await loopbackListener.codePromise
  const tokens = await exchangeOpenAICode(authorizationCode, onStatus)

  return { authUrl, tokens }
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
    redirect_uri: currentOAuthState.redirectUri,
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
