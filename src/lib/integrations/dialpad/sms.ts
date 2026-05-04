/**
 * Dialpad SMS adapter — sends SMS via POST /v2/sms.
 *
 * Pure function: takes credentials + input, returns result.
 * Does NOT write to the database — caller handles messages table + audit_log.
 */

import { SendSmsInputSchema, type SendSmsInput, type SendSmsResult, type SmsCredentials } from "@/lib/adapters/sms";
import { DialpadCredentialsSchema, DialpadSmsResponseSchema } from "./types";

const DIALPAD_BASE_URL = "https://dialpad.com/api";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class DialpadSmsError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DialpadSmsError";
  }
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

export function sendSmsDryRun(input: SendSmsInput): SendSmsResult {
  const parsed = SendSmsInputSchema.parse(input);
  return {
    messageId: `dry_run_${Date.now()}`,
    provider: "dialpad",
    dryRun: true,
    acceptedAt: new Date().toISOString(),
    latencyMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export async function sendSms(
  credentials: SmsCredentials,
  input: SendSmsInput,
): Promise<SendSmsResult> {
  // Validate inputs
  const parsedCreds = DialpadCredentialsSchema.parse(credentials);
  const parsedInput = SendSmsInputSchema.parse(input);

  const start = performance.now();

  let response: Response;
  try {
    response = await fetch(`${DIALPAD_BASE_URL}/v2/sms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${parsedCreds.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        to_numbers: [parsedInput.to],
        from_number: parsedInput.from,
        text: parsedInput.body,
      }),
    });
  } catch (err) {
    throw new DialpadSmsError(
      `Network error calling Dialpad SMS API: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      err,
    );
  }

  const latencyMs = Math.round(performance.now() - start);

  if (!response.ok) {
    let errorBody: string;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = "(unable to read response body)";
    }
    throw new DialpadSmsError(
      `Dialpad SMS API returned ${response.status}: ${errorBody}`,
      response.status,
    );
  }

  const json = await response.json();
  const parsed = DialpadSmsResponseSchema.parse(json);

  return {
    messageId: parsed.id,
    provider: "dialpad",
    dryRun: false,
    acceptedAt: new Date().toISOString(),
    latencyMs,
  };
}
