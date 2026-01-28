/**
 * OpenAI OAuth (Device Authorization Grant)
 *
 * This mirrors the subscription login experience used by OpenAI's
 * coding tools: we request a device code, open the browser, then
 * poll the token endpoint until the user completes authentication.
 */

import { OPENAI_OAUTH_CONFIG, assertOpenAIOAuthConfigured } from './openai-oauth-config.ts'

// Dynamic import for 'open' to handle ESM/CJS interop in bundled code
async function openUrl(url: string): Promise<void> {
  const open = await import('open')
  const openFn = open.default || open
  await openFn(url)
}

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval?: number
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

export interface OpenAITokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
  tokenType?: string
}

interface OpenAIOAuthState {
  deviceCode: string
  userCode: string
  verificationUrl: string
  intervalMs: number
  expiresAt: number
}

let currentOAuthState: OpenAIOAuthState | null = null

function assertState(): OpenAIOAuthState {
  if (!currentOAuthState) {
    throw new Error('No OpenAI OAuth flow in progress')
  }
  if (Date.now() >= currentOAuthState.expiresAt) {
    currentOAuthState = null
    throw new Error('OpenAI OAuth session expired. Please start again.')
  }
  return currentOAuthState
}

async function requestDeviceCode(onStatus?: (message: string) => void): Promise<DeviceCodeResponse> {
  assertOpenAIOAuthConfigured()

  onStatus?.('Requesting OpenAI device code...')

  const body = new URLSearchParams({
    client_id: OPENAI_OAUTH_CONFIG.CLIENT_ID,
    scope: OPENAI_OAUTH_CONFIG.SCOPES,
  })

  const response = await fetch(OPENAI_OAUTH_CONFIG.DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to start OpenAI OAuth (${response.status}): ${text.slice(0, 500)}`)
  }

  return response.json() as Promise<DeviceCodeResponse>
}

/**
 * Start OpenAI device OAuth.
 *
 * Returns the verification URL and user code for display.
 */
export async function startOpenAIOAuth(onStatus?: (message: string) => void): Promise<{
  verificationUrl: string
  userCode: string
}> {
  const device = await requestDeviceCode(onStatus)

  const verificationUrl = device.verification_uri_complete || device.verification_uri
  const intervalMs = Math.max(1000, (device.interval ?? 5) * 1000)
  const expiresAt = Date.now() + device.expires_in * 1000

  currentOAuthState = {
    deviceCode: device.device_code,
    userCode: device.user_code,
    verificationUrl,
    intervalMs,
    expiresAt,
  }

  onStatus?.('Opening browser for OpenAI authentication...')
  await openUrl(verificationUrl)

  onStatus?.('Complete authentication in the browser, then return here.')

  return { verificationUrl, userCode: device.user_code }
}

export function hasValidOpenAIOAuthState(): boolean {
  if (!currentOAuthState) return false
  return Date.now() < currentOAuthState.expiresAt
}

export function clearOpenAIOAuthState(): void {
  currentOAuthState = null
}

async function pollForToken(onStatus?: (message: string) => void): Promise<TokenResponse> {
  const state = assertState()

  onStatus?.('Waiting for OpenAI authentication to complete...')

  while (Date.now() < state.expiresAt) {
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: OPENAI_OAUTH_CONFIG.CLIENT_ID,
      device_code: state.deviceCode,
    })

    const response = await fetch(OPENAI_OAUTH_CONFIG.TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })

    const json = await response.json().catch(() => ({})) as Record<string, unknown>

    if (response.ok && typeof json.access_token === 'string') {
      return json as unknown as TokenResponse
    }

    const error = typeof json.error === 'string' ? json.error : undefined

    if (error === 'authorization_pending') {
      await new Promise(resolve => setTimeout(resolve, state.intervalMs))
      continue
    }

    if (error === 'slow_down') {
      state.intervalMs += 2000
      await new Promise(resolve => setTimeout(resolve, state.intervalMs))
      continue
    }

    if (error === 'expired_token' || error === 'access_denied') {
      clearOpenAIOAuthState()
      throw new Error(`OpenAI OAuth failed: ${error}`)
    }

    const message = typeof json.error_description === 'string'
      ? json.error_description
      : (error || `HTTP ${response.status}`)
    throw new Error(`OpenAI OAuth token exchange failed: ${message}`)
  }

  clearOpenAIOAuthState()
  throw new Error('OpenAI OAuth timed out. Please try again.')
}

/**
 * Complete the device flow by polling until the user authorizes.
 */
export async function completeOpenAIOAuth(onStatus?: (message: string) => void): Promise<OpenAITokens> {
  const state = assertState()

  const token = await pollForToken(onStatus)

  const expiresAt = token.expires_in
    ? Date.now() + token.expires_in * 1000
    : state.expiresAt

  clearOpenAIOAuthState()

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt,
    scope: token.scope,
    tokenType: token.token_type,
  }
}

