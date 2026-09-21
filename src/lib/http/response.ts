export function protectedHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

export function protectedJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: protectedHeaders(),
  });
}

export function protectResponse(response: Response, options: { noReferrer?: boolean } = {}): Response {
  const headers = protectedHeaders(response.headers);
  if (options.noReferrer) headers.set("Referrer-Policy", "no-referrer");
  try {
    headers.forEach((value, key) => response.headers.set(key, value));
    return response;
  } catch {
    // Native redirect responses can expose immutable headers. Rebuild those
    // responses while preserving status, location, and any response body.
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
