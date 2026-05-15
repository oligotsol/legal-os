/**
 * Confido Legal Zod schemas for credential validation and API responses.
 *
 * Confido Legal exposes a GraphQL API; full schema discovery is deferred
 * until Garrison provides API credentials. See
 * https://confidolegal.com/developer-center for endpoint, mutations, and
 * webhook payload shapes — fetch fresh before writing the live impl.
 */

import { z } from "zod";

export const ConfidoCredentialsSchema = z.object({
  apiKey: z.string().min(1, "Confido API key is required"),
  endpoint: z
    .string()
    .url()
    .optional(),
  testMode: z.boolean().optional().default(false),
});

export type ConfidoCredentials = z.infer<typeof ConfidoCredentialsSchema>;
