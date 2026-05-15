/**
 * Send-window guard. Outbound SMS may only fire during the firm's allowed
 * local hours. Per user policy (stricter than TCPA's 8am-9pm) we enforce
 * 10am-7pm America/Chicago.
 *
 * Used by:
 *   - Bulk blast send action
 *   - Dialer no-answer auto-cadence SMS
 *   - Post-Connected follow-up worker (when channel = SMS)
 *
 * Returns { allowed, reason, localHour }. Callers throw on !allowed for
 * user-initiated paths; workers should write a 'skipped_window' row to
 * sms_sends and defer.
 */

const SEND_WINDOW_TIMEZONE = "America/Chicago";
const ALLOWED_START_HOUR = 10; // inclusive
const ALLOWED_END_HOUR = 19; // exclusive — last allowed hour is 6pm (18)

export interface SendWindowCheck {
  allowed: boolean;
  reason: string | null;
  localHour: number;
  timezone: string;
}

/**
 * Read the local hour-of-day in the firm's send-window timezone. Uses
 * Intl.DateTimeFormat so DST is handled correctly without bringing in
 * a tz library.
 */
function getLocalHour(timezone: string, now: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const hourPart = parts.find((p) => p.type === "hour");
  if (!hourPart) return NaN;
  // "24" is sometimes emitted at midnight in some locales; normalize to 0.
  const h = Number.parseInt(hourPart.value, 10);
  return h === 24 ? 0 : h;
}

export function checkSendWindow(now: Date = new Date()): SendWindowCheck {
  const localHour = getLocalHour(SEND_WINDOW_TIMEZONE, now);
  const allowed =
    localHour >= ALLOWED_START_HOUR && localHour < ALLOWED_END_HOUR;
  return {
    allowed,
    reason: allowed
      ? null
      : `Outside SMS send window (10am-7pm ${SEND_WINDOW_TIMEZONE}). Local hour is ${localHour}:00.`,
    localHour,
    timezone: SEND_WINDOW_TIMEZONE,
  };
}

/**
 * Throw if the window is closed. Use in user-initiated send paths
 * (bulk blast, manual SMS) where blocking is the right UX.
 */
export function assertSendWindow(now: Date = new Date()): void {
  const check = checkSendWindow(now);
  if (!check.allowed) {
    throw new Error(check.reason ?? "Outside SMS send window.");
  }
}
