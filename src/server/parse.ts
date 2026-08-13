export async function parseFormBody(request: Request): Promise<Record<string, string> | null> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    const formData: Record<string, string> = {};
    new URLSearchParams(text).forEach((value, key) => {
      formData[key] = value;
    });
    return formData;
  }

  if (contentType.includes("application/json")) {
    const raw = (await request.json()) as Record<string, unknown>;
    const formData: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value == null) continue;
      formData[key] = String(value);
    }
    return formData;
  }

  return null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown"
  );
}
