import { describe, it, expect, vi } from "vitest";
import {
  renderTemplate,
  renderSmsTemplate,
  type TemplateContext,
} from "@/lib/ai/conversation/template-engine";

const baseContext: TemplateContext = {
  contact_name: "John Doe",
  first_name: "John",
  attorney_name: "Garrison English",
  attorney_email: "garrison@legacyfirstlaw.com",
  firm_name: "Legacy First Law PLLC",
  phone_number: "555-123-4567",
  scheduling_link: "https://cal.com/lfl/consult",
  matter_type: "estate_planning",
  state: "TX",
  payment_language: "Funds will be deposited into our IOLTA trust account.",
};

describe("renderTemplate", () => {
  it("renders all variables correctly", () => {
    const template =
      "Hi {{first_name}}, this is {{attorney_name}} from {{firm_name}}. " +
      "Please schedule at {{scheduling_link}}.";

    const result = renderTemplate(template, baseContext);

    expect(result).toBe(
      "Hi John, this is Garrison English from Legacy First Law PLLC. " +
        "Please schedule at https://cal.com/lfl/consult.",
    );
  });

  it("replaces missing variable with empty string and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const template = "Hi {{first_name}}, your case ref is {{case_ref_number}}.";
    const result = renderTemplate(template, baseContext);

    expect(result).toBe("Hi John, your case ref is .");
    expect(warnSpy).toHaveBeenCalledWith(
      "[template-engine] Missing variable: {{case_ref_number}}",
    );

    warnSpy.mockRestore();
  });

  it("returns empty string for empty template", () => {
    expect(renderTemplate("", baseContext)).toBe("");
  });

  it("passes through template with no variables", () => {
    const template = "Hello! Please call us back at your convenience.";
    expect(renderTemplate(template, baseContext)).toBe(template);
  });

  it("handles multiple occurrences of the same variable", () => {
    const template = "{{first_name}}, {{first_name}}, {{first_name}}!";
    expect(renderTemplate(template, baseContext)).toBe("John, John, John!");
  });

  it("handles payment_language variable", () => {
    const template = "Payment info: {{payment_language}}";
    expect(renderTemplate(template, baseContext)).toBe(
      "Payment info: Funds will be deposited into our IOLTA trust account.",
    );
  });
});

describe("renderSmsTemplate", () => {
  it("returns full message when under 300 chars", () => {
    const template = "Hi {{first_name}}, this is {{attorney_name}}.";
    const result = renderSmsTemplate(template, baseContext);
    expect(result).toBe("Hi John, this is Garrison English.");
    expect(result.length).toBeLessThanOrEqual(300);
  });

  it("truncates at sentence boundary when message has multiple sentences", () => {
    // Build a message with multiple sentences that exceeds the limit
    const template =
      "Hi {{first_name}}, welcome to our firm. We are here to help you. " +
      "Please let us know if you have any questions. " +
      "We look forward to working with you on your matter and ensuring everything goes smoothly for your family.";
    const result = renderSmsTemplate(template, baseContext, 120);

    // Should end with a period (sentence boundary)
    expect(result.endsWith(".")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(120);
    // Should contain at least the first complete sentence
    expect(result).toContain("welcome to our firm.");
  });

  it("falls back to word boundary when no sentence boundary found", () => {
    // A single long sentence with no sentence-ending punctuation in range
    const template = "Hi {{first_name}} this is a really long single sentence without any periods or exclamation marks that keeps going and going until it exceeds the limit";
    const result = renderSmsTemplate(template, baseContext, 80);

    expect(result.endsWith("...")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(80);
    // Should end at a word boundary (space + "...")
    expect(result).toMatch(/\s\w+\.\.\.$/);
  });

  it("handles very short maxLength", () => {
    const template = "Hi {{first_name}}, this is a message that is way too long for our tiny limit.";
    const result = renderSmsTemplate(template, baseContext, 20);

    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.endsWith("...")).toBe(true);
  });

  it("respects custom maxLength", () => {
    const template = "Hi {{first_name}}, this is a longer message that should be truncated.";
    const result = renderSmsTemplate(template, baseContext, 30);

    expect(result.length).toBeLessThanOrEqual(30);
  });

  it("does not truncate at exact limit", () => {
    const template = "Hi";
    const result = renderSmsTemplate(template, baseContext, 2);
    expect(result).toBe("Hi");
  });
});
