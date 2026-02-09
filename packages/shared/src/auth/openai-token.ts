import { getCredentialManager } from '../credentials/index.ts'

export interface OpenAITokenResult {
  accessToken: string | null
  refreshToken?: string
  expiresAt?: number
}

/**
 * Get stored OpenAI OAuth token (if any).
 *
 * Unlike Claude OAuth, we do not currently attempt token refresh here because
 * refresh endpoints and client requirements may vary by deployment.
 */
export async function getValidOpenAIOAuthToken(): Promise<OpenAITokenResult> {
  const manager = getCredentialManager()
  const creds = await manager.getOpenAIOAuthCredentials()
  if (!creds?.accessToken) {
    return { accessToken: null }
  }
  return {
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
    expiresAt: creds.expiresAt,
  }
}
