import { getAuthorization } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUpdateUserHandler } from "@/lib/users/api";
import { createLazyUserRepository, createUserRepository } from "@/lib/users/repository";

export const runtime = "nodejs";

const repository = createLazyUserRepository(
  () => createUserRepository(createAdminClient()),
);

export const PATCH = createUpdateUserHandler({
  getAuthorization,
  repository,
});
