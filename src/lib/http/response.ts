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
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  if (options.noReferrer) response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
