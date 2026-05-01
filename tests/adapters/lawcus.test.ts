/**
 * Lawcus adapter stub tests.
 *
 * Verifies that dry runs succeed and real calls throw until the token is configured.
 */

import { describe, it, expect } from "vitest";
import {
  createContact,
  createContactDryRun,
  syncMatter,
  syncMatterDryRun,
  LawcusError,
} from "@/lib/integrations/lawcus/client";
import { LawcusCredentialsSchema } from "@/lib/integrations/lawcus/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validContactInput = {
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  phone: "+15551234567",
};

const validMatterInput = {
  contactId: "contact_123",
  name: "Estate Plan — Doe Family",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Lawcus adapter stub", () => {
  it("createContactDryRun succeeds and returns dry run result", () => {
    const result = createContactDryRun(validContactInput);

    expect(result.dryRun).toBe(true);
    expect(result.provider).toBe("lawcus");
    expect(result.id).toMatch(/^dry_run_contact_/);
  });

  it("createContact throws LawcusError (token not configured)", async () => {
    try {
      await createContact({ apiToken: "dead-token" }, validContactInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LawcusError);
      expect((err as LawcusError).message).toContain("token not configured");
    }
  });

  it("syncMatterDryRun succeeds and returns dry run result", () => {
    const result = syncMatterDryRun(validMatterInput);

    expect(result.dryRun).toBe(true);
    expect(result.provider).toBe("lawcus");
    expect(result.id).toMatch(/^dry_run_matter_/);
  });

  it("syncMatter throws LawcusError (token not configured)", async () => {
    try {
      await syncMatter({ apiToken: "dead-token" }, validMatterInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LawcusError);
      expect((err as LawcusError).message).toContain("token not configured");
    }
  });

  it("validates credentials schema", () => {
    expect(() => LawcusCredentialsSchema.parse({ apiToken: "" })).toThrow();
    expect(() => LawcusCredentialsSchema.parse({})).toThrow();
    expect(() => LawcusCredentialsSchema.parse({ apiToken: "valid-token" })).not.toThrow();
  });

  it("validates contact input — rejects missing required fields", () => {
    expect(() => createContactDryRun({ firstName: "", lastName: "Doe" })).toThrow();
    expect(() => createContactDryRun({ firstName: "Jane", lastName: "" })).toThrow();
  });
});
