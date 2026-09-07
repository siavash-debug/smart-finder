/**
 * Centralized Persian user-facing copy (MASTER_PROMPT-adjacent Phase 4 §9). Every Telegram
 * message string lives here, not scattered across command/webhook handlers — no business
 * logic is hard-coded into a message string, only presentation of facts the caller computed.
 */

export const CALLBACK_CONFIRM = "pref:ack";
export const CALLBACK_EDIT = "pref:edit";

export function welcomeMessage(): string {
  return [
    "سلام 👋",
    "حساب شما با تلگرام متصل شد.",
    "",
    "برای شروع جستجوی خانه، مشخصات موردنظرتان را برایم بنویسید.",
  ].join("\n");
}

export function helpMessage(): string {
  return [
    "دستورهای موجود:",
    "",
    "/start — شروع و اتصال حساب",
    "/help — راهنما",
    "/status — وضعیت حساب",
    "",
    "همچنین می‌توانید مشخصات آپارتمان موردنظرتان را به فارسی بنویسید، مثلاً:",
    "«۸۰ تا ۱۰۰ متر، دو خواب، آسانسور داشته باشه»",
  ].join("\n");
}

export interface StatusSummary {
  hasActiveSearchProfile: boolean;
}

export function statusMessage(summary: StatusSummary): string {
  const profileLine = summary.hasActiveSearchProfile
    ? "شما یک جست‌وجوی فعال دارید."
    : "هنوز جست‌وجویی ثبت نکرده‌اید.";
  return ["وضعیت حساب:", "", profileLine].join("\n");
}

export function unknownCommandMessage(): string {
  return "این دستور را نمی‌شناسم. برای دیدن دستورهای موجود /help را بفرستید.";
}

export function rateLimitedMessage(): string {
  return "تعداد درخواست‌های شما زیاد بوده. کمی صبر کنید و دوباره امتحان کنید.";
}

/** One structured line per known field, "نامشخص" for anything the extractor couldn't
 *  determine — never fabricated, matching the normalizer's own honesty rule. */
export interface PreferenceSummaryLines {
  areaLine: string | null;
  bedroomsLine: string | null;
  districtLine: string | null;
  priceLine: string | null;
  parkingLine: string | null;
  elevatorLine: string | null;
}

export function preferenceSummaryMessage(lines: PreferenceSummaryLines): string {
  const bullets = [
    lines.areaLine,
    lines.bedroomsLine,
    lines.districtLine,
    lines.priceLine,
    lines.parkingLine,
    lines.elevatorLine,
  ].filter((line): line is string => line !== null);

  if (bullets.length === 0) {
    return [
      "متأسفانه نتوانستم مشخصات مشخصی از پیام شما استخراج کنم.",
      "می‌توانید دوباره با جزئیات بیشتر بنویسید، مثلاً متراژ یا تعداد خواب.",
    ].join("\n");
  }

  return [
    "این مشخصات را از پیام شما برداشت کردم:",
    "",
    ...bullets.map((line) => `• ${line}`),
    "",
    "تأیید می‌کنید؟",
  ].join("\n");
}

export function preferenceConfirmedMessage(): string {
  return "ثبت شد ✅ به‌محض پیدا شدن مورد مناسب به شما اطلاع می‌دهم.";
}

export function preferenceEditPromptMessage(): string {
  return "بسیار خب، مشخصات جدید را بفرستید تا جایگزین شود.";
}

export function invalidCallbackMessage(): string {
  return "این دکمه دیگر معتبر نیست.";
}
