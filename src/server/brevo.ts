export interface BrevoEmailRequest {
  sender: { name: string; email: string };
  to: Array<{ email: string; name?: string }>;
  subject: string;
  htmlContent: string;
}

export const DEFAULT_SENDER = {
  name: "LOGEIX Agency",
  email: "noreply@logeix.com",
} as const;

export async function sendBrevoEmail(
  apiKey: string,
  toEmails: string[],
  subject: string,
  htmlContent: string,
  sender: { name: string; email: string } = DEFAULT_SENDER,
): Promise<void> {
  const payload: BrevoEmailRequest = {
    sender,
    to: toEmails.map((email) => ({ email })),
    subject,
    htmlContent,
  };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Brevo API error: ${res.status} – ${await res.text()}`);
  }
}

export function notificationEmails(
  envEmail: string | undefined,
  fallback: string[] | undefined,
): string[] {
  const list = (envEmail || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length) return list;
  return fallback?.filter(Boolean) ?? [];
}
