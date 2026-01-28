/**
 * CredentialsStep - Onboarding step wrapper for API key or OAuth flow
 *
 * Thin wrapper that composes ApiKeyInput or OAuthConnect controls
 * with StepFormLayout for the onboarding wizard context.
 */

import { ExternalLink } from "lucide-react"
import type { ApiSetupMethod } from "./APISetupStep"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"
import {
  ApiKeyInput,
  type ApiKeyStatus,
  type ApiKeySubmitData,
  OAuthConnect,
  type OAuthStatus,
} from "../apisetup"

export type CredentialStatus = ApiKeyStatus | OAuthStatus

interface CredentialsStepProps {
  apiSetupMethod: ApiSetupMethod
  status: CredentialStatus
  errorMessage?: string
  onSubmit: (data: ApiKeySubmitData) => void
  onStartOAuth?: () => void
  oauthVariant?: 'claude' | 'openai'
  openAIDeviceCodeInfo?: { verificationUrl: string; userCode: string } | null
  onBack: () => void
  // Two-step OAuth flow
  isWaitingForCode?: boolean
  onSubmitAuthCode?: (code: string) => void
  onCancelOAuth?: () => void
}

export function CredentialsStep({
  apiSetupMethod,
  status,
  errorMessage,
  onSubmit,
  onStartOAuth,
  oauthVariant = 'claude',
  openAIDeviceCodeInfo,
  onBack,
  isWaitingForCode,
  onSubmitAuthCode,
  onCancelOAuth,
}: CredentialsStepProps) {
  const isClaudeOAuth = apiSetupMethod === 'claude_oauth'
  const isOpenAIOAuth = apiSetupMethod === 'chatgpt_subscription'
  const isOAuth = isClaudeOAuth || isOpenAIOAuth

  // --- OAuth flow ---
  if (isOAuth) {
    const providerLabel = oauthVariant === 'openai' ? 'ChatGPT' : 'Claude'
    const waitingTitle = oauthVariant === 'openai' ? 'Finish ChatGPT Login' : 'Enter Authorization Code'
    const waitingDescription = oauthVariant === 'openai'
      ? 'Complete login in your browser, then click Continue.'
      : 'Copy the code from the browser page and paste it below.'

    // Waiting for authorization code entry
    if (isWaitingForCode) {
      return (
        <StepFormLayout
          title={waitingTitle}
          description={waitingDescription}
          actions={
            <>
              <BackButton onClick={onCancelOAuth} disabled={status === 'validating'}>Cancel</BackButton>
              <ContinueButton
                type="submit"
                form={oauthVariant === 'openai' ? undefined : 'auth-code-form'}
                onClick={oauthVariant === 'openai' ? () => onSubmitAuthCode?.('') : undefined}
                disabled={false}
                loading={status === 'validating'}
                loadingText="Connecting..."
              />
            </>
          }
        >
          <OAuthConnect
            status={status as OAuthStatus}
            errorMessage={errorMessage}
            isWaitingForCode={true}
            deviceCodeInfo={oauthVariant === 'openai' ? openAIDeviceCodeInfo ?? null : null}
            onStartOAuth={onStartOAuth!}
            onSubmitAuthCode={onSubmitAuthCode}
            onCancelOAuth={onCancelOAuth}
          />
        </StepFormLayout>
      )
    }

    return (
      <StepFormLayout
        title={`Connect ${providerLabel} Account`}
        description={
          oauthVariant === 'openai'
            ? 'Use your ChatGPT subscription to power multi-agent workflows.'
            : 'Use your Claude subscription to power multi-agent workflows.'
        }
        actions={
          <>
            <BackButton onClick={onBack} disabled={status === 'validating'} />
            <ContinueButton
              onClick={onStartOAuth}
              className="gap-2"
              loading={status === 'validating'}
              loadingText="Connecting..."
            >
              <ExternalLink className="size-4" />
              {oauthVariant === 'openai' ? 'Sign in with ChatGPT' : 'Sign in with Claude'}
            </ContinueButton>
          </>
        }
      >
        <OAuthConnect
          status={status as OAuthStatus}
          errorMessage={errorMessage}
          isWaitingForCode={false}
          deviceCodeInfo={oauthVariant === 'openai' ? openAIDeviceCodeInfo ?? null : null}
          onStartOAuth={onStartOAuth!}
          onSubmitAuthCode={onSubmitAuthCode}
          onCancelOAuth={onCancelOAuth}
        />
      </StepFormLayout>
    )
  }

  // --- API Key flow ---
  return (
    <StepFormLayout
      title="API Configuration"
      description={
        "Enter your API key. Optionally configure a custom endpoint for OpenRouter, Ollama, or compatible APIs."
      }
      actions={
        <>
          <BackButton onClick={onBack} disabled={status === 'validating'} />
          <ContinueButton
            type="submit"
            form="api-key-form"
            disabled={false}
            loading={status === 'validating'}
            loadingText="Validating..."
          />
        </>
      }
    >
      <ApiKeyInput
        status={status as ApiKeyStatus}
        errorMessage={errorMessage}
        onSubmit={onSubmit}
      />
    </StepFormLayout>
  )
}
