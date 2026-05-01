/**
 * Outbound message dispatch service.
 *
 * Determines the correct channel (sms/email), fetches integration credentials,
 * calls the appropriate adapter, and returns the result.
 *
 * Pure service function — does NOT write to the database. Caller handles
 * updating the message record, audit log, etc.
 */

import {
  getIntegrationAccount,
  type IntegrationAccountResult,
} from "@/lib/integrations/credentials";
import {
  sendSms as dialpadSendSms,
  sendSmsDryRun as dialpadSendSmsDryRun,
} from "@/lib/integrations/dialpad/sms";
import {
  sendEmail as gmailSendEmail,
  sendEmailDryRun as gmailSendEmailDryRun,
} from "@/lib/integrations/gmail/email";
import type { SendSmsResult } from "@/lib/adapters/sms";
import type { SendEmailResult } from "@/lib/adapters/email";
import type { IntegrationProvider } from "@/types/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchInput {
  /** The channel to send on — must be "sms" or "email" */
  channel: string;
  /** For SMS: E.164 phone number. For email: email address. */
  to: string;
  /** For SMS: E.164 phone number. For email: email address. */
  from: string;
  /** Message body (plain text for SMS, used as textBody for email) */
  body: string;
  /** Email-only fields */
  subject?: string;
  htmlBody?: string;
  /** Opaque reference to correlate with messages table */
  externalRef?: string;
}

export type DispatchResult =
  | { channel: "sms"; provider: string; result: SendSmsResult }
  | { channel: "email"; provider: string; result: SendEmailResult };

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class DispatchError extends Error {
  constructor(
    message: string,
    public readonly channel?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DispatchError";
  }
}

// ---------------------------------------------------------------------------
// Channel → provider mapping
// ---------------------------------------------------------------------------

const CHANNEL_PROVIDER_MAP: Record<string, IntegrationProvider> = {
  sms: "dialpad",
  email: "gmail",
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function dispatchMessage(
  firmId: string,
  input: DispatchInput,
): Promise<DispatchResult> {
  const provider = CHANNEL_PROVIDER_MAP[input.channel];
  if (!provider) {
    throw new DispatchError(
      `Unsupported channel: "${input.channel}". Supported channels: sms, email`,
      input.channel,
    );
  }

  // Fetch integration account
  let integration: IntegrationAccountResult;
  try {
    integration = await getIntegrationAccount(firmId, provider);
  } catch (err) {
    throw new DispatchError(
      `No integration account for provider "${provider}" on firm ${firmId}`,
      input.channel,
      err,
    );
  }

  if (input.channel === "sms") {
    return dispatchSms(integration, input);
  }

  return dispatchEmail(integration, input);
}

// ---------------------------------------------------------------------------
// SMS dispatch
// ---------------------------------------------------------------------------

async function dispatchSms(
  integration: IntegrationAccountResult,
  input: DispatchInput,
): Promise<DispatchResult> {
  const smsInput = {
    to: input.to,
    from: input.from,
    body: input.body,
    externalRef: input.externalRef,
  };

  if (!integration.isActive) {
    const result = dialpadSendSmsDryRun(smsInput);
    return { channel: "sms", provider: "dialpad", result };
  }

  const result = await dialpadSendSms(
    integration.account.credentials as import("@/lib/adapters/sms").SmsCredentials,
    smsInput,
  );
  return { channel: "sms", provider: "dialpad", result };
}

// ---------------------------------------------------------------------------
// Email dispatch
// ---------------------------------------------------------------------------

async function dispatchEmail(
  integration: IntegrationAccountResult,
  input: DispatchInput,
): Promise<DispatchResult> {
  if (!input.subject) {
    throw new DispatchError(
      "Email dispatch requires a subject",
      "email",
    );
  }

  const emailInput = {
    to: input.to,
    from: input.from,
    subject: input.subject,
    textBody: input.body,
    htmlBody: input.htmlBody,
    externalRef: input.externalRef,
  };

  if (!integration.isActive) {
    const result = gmailSendEmailDryRun(emailInput);
    return { channel: "email", provider: "gmail", result };
  }

  const result = await gmailSendEmail(
    integration.account.credentials,
    emailInput,
  );
  return { channel: "email", provider: "gmail", result };
}
