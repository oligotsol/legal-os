/**
 * Ethics scanner — pure-function rule engine for message screening.
 *
 * Scans inbound messages for ethics red flags, regulatory triggers,
 * and situations requiring attorney review. No DB calls; no side effects.
 *
 * Priority-ordered rules (1 = highest). First blocking match wins for
 * priorities 1-11. Priority 12 (PARTNER_REVIEW) accumulates all signals.
 * Priority 13 is the default CLEAR disposition.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EthicsDisposition =
  | "AUTO_DNC"
  | "STOP_AI"
  | "HARD_BLOCK"
  | "PARTNER_REVIEW"
  | "CLEAR";

export type RecommendedAction =
  | "dnc"
  | "stop_and_escalate"
  | "refer_amicus"
  | "refer_thaler"
  | "upl_block"
  | "rpc_1_8c_block"
  | "rpc_1_14_block"
  | "rpc_1_7_block"
  | "criminal_block"
  | "escalate"
  | "proceed";

export interface EthicsScanInput {
  messageContent: string;
  contactState: string | null;
  estimatedValue: number | null;
  existingFlags: string[];
}

export interface EthicsScanConfig {
  activeJurisdictions: string[]; // e.g. ["TX", "IA", "ND", "PA", "NJ"]
  beebeGrandfatherActive: boolean; // Beebe trademark grandfather exception
  highValueThreshold: number; // default 250000
}

export interface EthicsScanResult {
  disposition: EthicsDisposition;
  recommendedAction: RecommendedAction;
  matchedRule: string; // human-readable rule description
  matchedPatterns: string[]; // the actual matched patterns
  priority: number; // 1-13
  signals: string[]; // accumulated signals for PARTNER_REVIEW
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Word-boundary, case-insensitive match. */
function matchesPattern(text: string, pattern: string): boolean {
  const re = new RegExp(`\\b${escapeRegex(pattern)}\\b`, "i");
  return re.test(text);
}

/** Escape special regex characters in a literal string. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * DNC detection with false-positive avoidance.
 *
 * A DNC command matches when:
 *   (a) the entire trimmed message is just the command, OR
 *   (b) the command appears at the start of the message, after a period,
 *       after a newline, or on its own line.
 */
function matchesDncCommand(text: string, command: string): boolean {
  const trimmed = text.trim().toLowerCase();
  const cmd = command.toLowerCase();

  // (a) Entire message is just the command
  if (trimmed === cmd) return true;

  // (b) Command as standalone phrase — start of message, after punctuation/newline
  const escapedCmd = escapeRegex(cmd);
  const standalone = new RegExp(
    `(?:^|[.!?]\\s*|\\n\\s*)${escapedCmd}\\b`,
    "i",
  );
  return standalone.test(text);
}

function findMatchedPatterns(text: string, patterns: string[]): string[] {
  return patterns.filter((p) => matchesPattern(text, p));
}

// ---------------------------------------------------------------------------
// Pattern lists
// ---------------------------------------------------------------------------

const DNC_COMMANDS = [
  "stop",
  "unsubscribe",
  "remove me",
  "do not call",
  "do not contact",
  "opt out",
  "take me off",
];

const THREAT_PATTERNS = [
  "sue you",
  "file a complaint",
  "report you",
  "contact the bar",
  "malpractice",
  "attorney general",
];

const CRISIS_PATTERNS = [
  "suicide",
  "kill myself",
  "want to die",
  "end my life",
  "self harm",
  "hurt myself",
];

const LITIGATION_PATTERNS = [
  "lawsuit",
  "being sued",
  "suing",
  "litigation",
  "dispute",
  "contested",
  "court order",
  "restraining order",
  "custody battle",
  "divorce",
  "personal injury",
  "car accident",
  "slip and fall",
  "wrongful death",
  "criminal charge",
  "DUI",
  "DWI",
  "felony",
  "misdemeanor",
];

const TRADEMARK_PATTERNS = ["trademark", "service mark", "trade name"];

const FIDUCIARY_KEYWORDS = [
  "name me as executor",
  "be my trustee",
  "personal representative",
  "fiduciary",
];

const FIDUCIARY_TARGETS = ["you", "attorney"];

const CAPACITY_KEYWORDS = [
  "alzheimer",
  "dementia",
  "not competent",
  "incapacitated",
  "can't think straight",
  "confused all the time",
  "memory is gone",
  "guardian",
];

const CAPACITY_RELATIONAL = [
  "for my parent",
  "for my mother",
  "for my father",
  "for my spouse",
];

const CONFLICT_PATTERNS = [
  "other side",
  "opposing party",
  "spouse's attorney",
  "ex's lawyer",
  "already represent",
];

const CRIMINAL_PATTERNS = [
  "hide from IRS",
  "hide assets",
  "avoid taxes illegally",
  "don't tell the court",
  "off the books",
  "money laundering",
  "hide money",
];

const PARTNER_REVIEW_PATTERNS = [
  "blended family",
  "stepchild",
  "step-child",
  "previous marriage",
  "existing counsel",
  "current attorney",
  "other lawyer",
  "high net worth",
  "multiple states",
  "two states",
  "different state",
  "out of state property",
];

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

export function scanMessage(
  input: EthicsScanInput,
  config: EthicsScanConfig,
): EthicsScanResult {
  const text = input.messageContent;

  // --- Priority 1: DNC commands ---
  const matchedDnc = DNC_COMMANDS.filter((cmd) =>
    matchesDncCommand(text, cmd),
  );
  if (matchedDnc.length > 0) {
    return {
      disposition: "AUTO_DNC",
      recommendedAction: "dnc",
      matchedRule: "Do-not-contact request detected",
      matchedPatterns: matchedDnc,
      priority: 1,
      signals: [],
    };
  }

  // --- Priority 2: Threat language ---
  const matchedThreats = findMatchedPatterns(text, THREAT_PATTERNS);
  if (matchedThreats.length > 0) {
    return {
      disposition: "STOP_AI",
      recommendedAction: "stop_and_escalate",
      matchedRule: "Threat or complaint language detected",
      matchedPatterns: matchedThreats,
      priority: 2,
      signals: [],
    };
  }

  // --- Priority 3: Active distress/crisis ---
  const matchedCrisis = findMatchedPatterns(text, CRISIS_PATTERNS);
  if (matchedCrisis.length > 0) {
    return {
      disposition: "STOP_AI",
      recommendedAction: "stop_and_escalate",
      matchedRule: "Active distress or crisis language detected",
      matchedPatterns: matchedCrisis,
      priority: 3,
      signals: [],
    };
  }

  // --- Priority 4: High-value or already in litigation ---
  const highValue =
    input.estimatedValue !== null &&
    input.estimatedValue > config.highValueThreshold;
  const alreadyInLitigation = matchesPattern(text, "already in litigation");
  if (highValue || alreadyInLitigation) {
    const patterns: string[] = [];
    if (highValue) patterns.push(`estimatedValue>${config.highValueThreshold}`);
    if (alreadyInLitigation) patterns.push("already in litigation");
    return {
      disposition: "STOP_AI",
      recommendedAction: "stop_and_escalate",
      matchedRule: "High-value matter or active litigation — requires attorney handling",
      matchedPatterns: patterns,
      priority: 4,
      signals: [],
    };
  }

  // --- Priority 5: Litigation/dispute keywords ---
  const matchedLitigation = findMatchedPatterns(text, LITIGATION_PATTERNS);
  if (matchedLitigation.length > 0) {
    return {
      disposition: "HARD_BLOCK",
      recommendedAction: "refer_amicus",
      matchedRule: "Litigation or dispute matter — refer to Amicus",
      matchedPatterns: matchedLitigation,
      priority: 5,
      signals: [],
    };
  }

  // --- Priority 6: Trademark (with Beebe grandfather exception) ---
  const matchedTrademark = findMatchedPatterns(text, TRADEMARK_PATTERNS);
  if (matchedTrademark.length > 0) {
    const beebeException =
      config.beebeGrandfatherActive && matchesPattern(text, "beebe");
    if (!beebeException) {
      return {
        disposition: "HARD_BLOCK",
        recommendedAction: "refer_thaler",
        matchedRule: "Trademark matter — refer to Thaler",
        matchedPatterns: matchedTrademark,
        priority: 6,
        signals: [],
      };
    }
  }

  // --- Priority 7: Out-of-state (UPL check) ---
  if (
    input.contactState !== null &&
    !config.activeJurisdictions.includes(input.contactState.toUpperCase())
  ) {
    return {
      disposition: "HARD_BLOCK",
      recommendedAction: "upl_block",
      matchedRule: "Contact is in a jurisdiction where the firm is not licensed to practice",
      matchedPatterns: [`contactState=${input.contactState}`],
      priority: 7,
      signals: [],
    };
  }

  // --- Priority 8: Attorney-as-fiduciary (RPC 1.8(c)) ---
  const matchedFiduciary = findMatchedPatterns(text, FIDUCIARY_KEYWORDS);
  const matchedFiduciaryTarget = findMatchedPatterns(text, FIDUCIARY_TARGETS);
  if (matchedFiduciary.length > 0 && matchedFiduciaryTarget.length > 0) {
    return {
      disposition: "HARD_BLOCK",
      recommendedAction: "rpc_1_8c_block",
      matchedRule: "Client requesting attorney serve as fiduciary — RPC 1.8(c)",
      matchedPatterns: [...matchedFiduciary, ...matchedFiduciaryTarget],
      priority: 8,
      signals: [],
    };
  }

  // --- Priority 9: Diminished capacity (RPC 1.14) ---
  const matchedCapacity = findMatchedPatterns(text, CAPACITY_KEYWORDS);
  const matchedRelational = findMatchedPatterns(text, CAPACITY_RELATIONAL);
  if (matchedCapacity.length > 0 && matchedRelational.length > 0) {
    return {
      disposition: "HARD_BLOCK",
      recommendedAction: "rpc_1_14_block",
      matchedRule: "Diminished capacity signals for a family member — RPC 1.14",
      matchedPatterns: [...matchedCapacity, ...matchedRelational],
      priority: 9,
      signals: [],
    };
  }

  // --- Priority 10: Conflict of interest (RPC 1.7) ---
  const matchedConflict = findMatchedPatterns(text, CONFLICT_PATTERNS);
  if (matchedConflict.length > 0) {
    return {
      disposition: "HARD_BLOCK",
      recommendedAction: "rpc_1_7_block",
      matchedRule: "Potential conflict of interest — RPC 1.7",
      matchedPatterns: matchedConflict,
      priority: 10,
      signals: [],
    };
  }

  // --- Priority 11: Criminal intent ---
  const matchedCriminal = findMatchedPatterns(text, CRIMINAL_PATTERNS);
  if (matchedCriminal.length > 0) {
    return {
      disposition: "HARD_BLOCK",
      recommendedAction: "criminal_block",
      matchedRule: "Criminal intent or illegal purpose detected",
      matchedPatterns: matchedCriminal,
      priority: 11,
      signals: [],
    };
  }

  // --- Priority 12: Partner review signals (accumulate all) ---
  const matchedPartnerReview = findMatchedPatterns(
    text,
    PARTNER_REVIEW_PATTERNS,
  );
  if (matchedPartnerReview.length > 0) {
    return {
      disposition: "PARTNER_REVIEW",
      recommendedAction: "escalate",
      matchedRule: "One or more signals requiring partner review",
      matchedPatterns: matchedPartnerReview,
      priority: 12,
      signals: matchedPartnerReview,
    };
  }

  // --- Priority 13: Clear ---
  return {
    disposition: "CLEAR",
    recommendedAction: "proceed",
    matchedRule: "No ethics flags detected",
    matchedPatterns: [],
    priority: 13,
    signals: [],
  };
}
