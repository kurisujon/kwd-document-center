import { getAuthorization } from "@/lib/auth/server";
import { protectedJson } from "@/lib/http/response";
import { searchDocuments } from "@/lib/search/search-service";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const authorization = await getAuthorization();
  if (authorization.kind === "unauthenticated") {
    return protectedJson({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, 401);
  }
  if (authorization.kind !== "authorized" || authorization.user.status !== "ACTIVE") {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Active user required." } }, 403);
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const pageSize = parseInt(searchParams.get("pageSize") ?? "25", 10);

  const supabase = await createClient();
  const result = await searchDocuments(
    supabase,
    {
      query: q,
      page: isNaN(page) ? 1 : page,
      pageSize: isNaN(pageSize) ? 25 : pageSize,
    },
    authorization.user,
  );

  return protectedJson(result);
}
