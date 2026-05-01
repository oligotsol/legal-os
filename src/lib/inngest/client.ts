/**
 * Inngest client — shared instance for all background functions.
 *
 * Import this from function definitions and the serve route.
 */

import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "legal-os" });
