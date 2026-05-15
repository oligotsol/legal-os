/**
 * Inngest serve endpoint — registers all background functions with Inngest.
 *
 * Add new functions to the `functions` array as they are created.
 */

import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { gmailPoller } from "@/lib/inngest/functions/gmail-poller";
import { dripWorker } from "@/lib/inngest/functions/drip-worker";
import { classifyLeadWorker } from "@/lib/inngest/functions/classify-lead";
import { postConnectedFollowupWorker } from "@/lib/inngest/functions/post-connected-followup-worker";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    gmailPoller,
    dripWorker,
    classifyLeadWorker,
    postConnectedFollowupWorker,
  ],
});
