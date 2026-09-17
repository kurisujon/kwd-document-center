import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthorizationResult, AuthorizedUser, Role } from "../src/lib/auth/types.ts";
import {
  createCreateUserHandler,
  createListUsersHandler,
  createUpdateUserHandler,
} from "../src/lib/users/api.ts";
import {
  createLazyUserRepository,
  createUserRepository,
  UserRepositoryError,
  type UserRepository,
  type UserRepositoryErrorCode,
} from "../src/lib/users/repository.ts";
import { createUserSchema, updateUserSchema, userIdSchema } from "../src/lib/users/validation.ts";
import type { CreateUserInput, ManagedUser, UpdateUserInput } from "../src/lib/users/types.ts";

const actorId = "10000000-0000-4000-8000-000000000001";
const targetId = "20000000-0000-4000-8000-000000000002";

const admin: AuthorizedUser = {
  id: actorId,
  email: "admin@example.test",
  name: "Admin",
  role: "ADMIN",
  status: "ACTIVE",
};

const managedUser: ManagedUser = {
  id: targetId,
  email: "staff@example.test",
  name: "Staff User",
  role: "STAFF",
  status: "ACTIVE",
  created_at: "2026-09-17T00:00:00+00:00",
  updated_at: "2026-09-17T00:00:00+00:00",
};

const authorized = (role: Role = "ADMIN"): AuthorizationResult => ({
  kind: "authorized",
  user: { ...admin, role },
});

type Calls = {
  list: string[];
  create: Array<{ actorId: string; input: CreateUserInput }>;
  update: Array<{ actorId: string; targetId: string; input: UpdateUserInput }>;
};

function repositoryMock(overrides: Partial<UserRepository> = {}) {
  const calls: Calls = { list: [], create: [], update: [] };
  const repository: UserRepository = {
    async listUsers(receivedActorId) {
      calls.list.push(receivedActorId);
      return [managedUser];
    },
    async createUser(receivedActorId, input) {
      calls.create.push({ actorId: receivedActorId, input });
      return { ...managedUser, ...input, status: "ACTIVE" };
    },
    async updateUser(receivedActorId, receivedTargetId, input) {
      calls.update.push({ actorId: receivedActorId, targetId: receivedTargetId, input });
      return { ...managedUser, ...input };
    },
    ...overrides,
  };
  return { calls, repository };
}

function jsonRequest(path: string, method: "POST" | "PATCH", body: unknown, origin = "http://localhost") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json; charset=utf-8", origin },
    body: JSON.stringify(body),
  });
}

const routeContext = (id = targetId) => ({ params: Promise.resolve({ id }) });

test("GET user administration requires an ACTIVE ADMIN and returns a private response", async () => {
  for (const [authorization, expected] of [
    [{ kind: "unauthenticated" }, 401],
    [{ kind: "inactive" }, 403],
    [authorized("STAFF"), 403],
    [authorized("VIEWER"), 403],
  ] as const) {
    const { repository } = repositoryMock();
    const handler = createListUsersHandler({
      getAuthorization: async () => authorization as AuthorizationResult,
      repository,
    });
    assert.equal((await handler()).status, expected);
  }

  const { calls, repository } = repositoryMock();
  const response = await createListUsersHandler({
    getAuthorization: async () => authorized(),
    repository,
  })();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { users: [managedUser] });
  assert.deepEqual(calls.list, [actorId]);
});

test("POST user administration requires an ACTIVE ADMIN", async () => {
  for (const [authorization, expected] of [
    [{ kind: "unauthenticated" }, 401],
    [{ kind: "inactive" }, 403],
    [authorized("STAFF"), 403],
    [authorized("VIEWER"), 403],
  ] as const) {
    const { repository } = repositoryMock();
    const handler = createCreateUserHandler({
      getAuthorization: async () => authorization as AuthorizationResult,
      repository,
    });
    assert.equal((await handler(jsonRequest("/api/admin/users", "POST", {
      email: "person@example.test",
      name: "Person",
      role: "STAFF",
    }))).status, expected);
  }
});

test("PATCH user administration requires an ACTIVE ADMIN", async () => {
  for (const [authorization, expected] of [
    [{ kind: "unauthenticated" }, 401],
    [{ kind: "inactive" }, 403],
    [authorized("STAFF"), 403],
    [authorized("VIEWER"), 403],
  ] as const) {
    const { repository } = repositoryMock();
    const handler = createUpdateUserHandler({
      getAuthorization: async () => authorization as AuthorizationResult,
      repository,
    });
    assert.equal((await handler(
      jsonRequest(`/api/admin/users/${targetId}`, "PATCH", { role: "VIEWER" }),
      routeContext(),
    )).status, expected);
  }
});

test("POST derives actor ID from authorization and rejects client actor identity", async () => {
  const { calls, repository } = repositoryMock();
  const handler = createCreateUserHandler({ getAuthorization: async () => authorized(), repository });

  const rejected = await handler(jsonRequest("/api/admin/users", "POST", {
    email: "person@example.test",
    name: "Person",
    role: "STAFF",
    actor_id: "30000000-0000-4000-8000-000000000003",
  }));
  assert.equal(rejected.status, 400);
  assert.equal(calls.create.length, 0);

  const successRequest = jsonRequest(
    "/api/admin/users?actor_id=30000000-0000-4000-8000-000000000003",
    "POST",
    {
      email: "  PERSON@Example.Test ",
      name: "  Person Name  ",
      role: "STAFF",
    },
  );
  successRequest.headers.set("x-actor-id", "30000000-0000-4000-8000-000000000003");
  const response = await handler(successRequest);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls.create, [{
    actorId,
    input: { email: "person@example.test", name: "Person Name", role: "STAFF" },
  }]);
});

test("PATCH derives actor ID from authorization and supports role/status updates", async () => {
  const { calls, repository } = repositoryMock();
  const handler = createUpdateUserHandler({ getAuthorization: async () => authorized(), repository });

  for (const body of [{ role: "VIEWER" }, { status: "INACTIVE" }, { role: "ADMIN", status: "ACTIVE" }]) {
    const response = await handler(
      jsonRequest(`/api/admin/users/${targetId}`, "PATCH", body),
      routeContext(),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }

  assert.deepEqual(calls.update.map(({ actorId: receivedActor, targetId: receivedTarget }) => ({
    actorId: receivedActor,
    targetId: receivedTarget,
  })), [
    { actorId, targetId },
    { actorId, targetId },
    { actorId, targetId },
  ]);
});

test("POST and PATCH enforce same-origin requests", async () => {
  const { repository } = repositoryMock();
  const post = createCreateUserHandler({ getAuthorization: async () => authorized(), repository });
  const patch = createUpdateUserHandler({ getAuthorization: async () => authorized(), repository });

  assert.equal((await post(jsonRequest("/api/admin/users", "POST", {
    email: "person@example.test", name: "Person", role: "STAFF",
  }, "https://attacker.example"))).status, 403);
  assert.equal((await patch(
    jsonRequest(`/api/admin/users/${targetId}`, "PATCH", { status: "INACTIVE" }, "https://attacker.example"),
    routeContext(),
  )).status, 403);

  assert.equal((await post(jsonRequest("/api/admin/users", "POST", {
    email: "person@example.test", name: "Person", role: "STAFF",
  }))).status, 201);
  assert.equal((await patch(
    jsonRequest(`/api/admin/users/${targetId}`, "PATCH", { status: "INACTIVE" }),
    routeContext(),
  )).status, 200);
});

test("POST and PATCH require JSON and reject malformed JSON safely", async () => {
  const { repository } = repositoryMock();
  const post = createCreateUserHandler({ getAuthorization: async () => authorized(), repository });
  const patch = createUpdateUserHandler({ getAuthorization: async () => authorized(), repository });

  const unsupported = new Request("http://localhost/api/admin/users", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "text/plain" }, body: "value",
  });
  assert.equal((await post(unsupported)).status, 415);
  const unsupportedPatch = new Request(`http://localhost/api/admin/users/${targetId}`, {
    method: "PATCH", headers: { origin: "http://localhost", "content-type": "text/plain" }, body: "value",
  });
  assert.equal((await patch(unsupportedPatch, routeContext())).status, 415);

  const malformedPost = new Request("http://localhost/api/admin/users", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: "{",
  });
  const malformedPatch = new Request(`http://localhost/api/admin/users/${targetId}`, {
    method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: "{",
  });
  assert.equal((await post(malformedPost)).status, 400);
  assert.equal((await patch(malformedPatch, routeContext())).status, 400);
});

test("create-user validation canonicalizes valid input and rejects forbidden or invalid fields", () => {
  const valid = createUserSchema.safeParse({
    email: "  PERSON@Example.Test ", name: "  Person Name  ", role: "STAFF",
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.deepEqual(valid.data, { email: "person@example.test", name: "Person Name", role: "STAFF" });
  }
  const gmailAddress = createUserSchema.safeParse({
    email: "First.Last+Records@Gmail.com", name: "Person", role: "STAFF",
  });
  assert.equal(gmailAddress.success, true);
  if (gmailAddress.success) {
    assert.equal(gmailAddress.data.email, "first.last+records@gmail.com");
  }

  const invalidInputs = [
    { email: "invalid", name: "Person", role: "STAFF" },
    { email: `${"a".repeat(243)}@example.test`, name: "Person", role: "STAFF" },
    { email: "person@example.test", name: "   ", role: "STAFF" },
    { email: "person@example.test", name: "a".repeat(121), role: "STAFF" },
    { email: "person@example.test", name: "Person", role: "OWNER" },
    { email: "person@example.test", name: "Person", role: "STAFF", status: "INACTIVE" },
    { email: "person@example.test", name: "Person", role: "STAFF", id: targetId },
    { email: "person@example.test", name: "Person", role: "STAFF", created_at: "value" },
    { email: "person@example.test", name: "Person", role: "STAFF", unexpected: true },
  ];
  for (const input of invalidInputs) assert.equal(createUserSchema.safeParse(input).success, false);
});

test("patch validation accepts role/status combinations and rejects forbidden or invalid input", () => {
  for (const input of [{ role: "VIEWER" }, { status: "INACTIVE" }, { role: "ADMIN", status: "ACTIVE" }]) {
    assert.equal(updateUserSchema.safeParse(input).success, true);
  }

  for (const input of [
    {},
    { role: "OWNER" },
    { status: "DISABLED" },
    { email: "new@example.test" },
    { name: "New Name" },
    { actor_id: actorId },
    { id: targetId },
    { updated_at: "value" },
    { role: "VIEWER", unexpected: true },
  ]) {
    assert.equal(updateUserSchema.safeParse(input).success, false);
  }

  assert.equal(userIdSchema.safeParse(targetId).success, true);
  assert.equal(userIdSchema.safeParse("not-a-uuid").success, false);
});

test("PATCH rejects an invalid target UUID before calling the repository", async () => {
  const { calls, repository } = repositoryMock();
  const handler = createUpdateUserHandler({ getAuthorization: async () => authorized(), repository });
  const response = await handler(
    jsonRequest("/api/admin/users/not-a-uuid", "PATCH", { role: "VIEWER" }),
    routeContext("not-a-uuid"),
  );
  assert.equal(response.status, 400);
  assert.equal(calls.update.length, 0);
});

test("known database errors translate to stable safe HTTP errors", async () => {
  const mappings: Array<[UserRepositoryErrorCode, number]> = [
    ["USER_ALREADY_EXISTS", 409],
    ["USER_NOT_FOUND", 404],
    ["SELF_MODIFICATION_FORBIDDEN", 403],
    ["LAST_ACTIVE_ADMIN", 409],
    ["ADMIN_REQUIRED", 403],
    ["VALIDATION_ERROR", 400],
    ["EMAIL_IMMUTABLE", 409],
  ];

  for (const [code, status] of mappings) {
    const { repository } = repositoryMock({
      updateUser: async () => { throw new UserRepositoryError(code); },
    });
    const response = await createUpdateUserHandler({
      getAuthorization: async () => authorized(), repository,
    })(jsonRequest(`/api/admin/users/${targetId}`, "PATCH", { role: "VIEWER" }), routeContext());
    assert.equal(response.status, status, code);
    assert.equal((await response.json()).error.code, code);
  }
});

test("unknown repository failures return a safe error without raw database context", async () => {
  const raw = "SQLSTATE 42883 CONTEXT PL/pgSQL secret-service-role-value";
  const { repository } = repositoryMock({
    listUsers: async () => { throw new Error(raw); },
  });
  const response = await createListUsersHandler({
    getAuthorization: async () => authorized(), repository,
  })();
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.match(text, /INTERNAL_ERROR/);
  assert.doesNotMatch(text, /42883|PL\/pgSQL|secret-service-role-value/);
});

test("the repository calls only the three Phase 4 RPCs with server-derived actor arguments", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: [managedUser], error: null };
    },
  };
  const repository = createUserRepository(client as never);

  await repository.listUsers(actorId);
  await repository.createUser(actorId, { email: "person@example.test", name: "Person", role: "STAFF" });
  await repository.updateUser(actorId, targetId, { role: "VIEWER", status: "INACTIVE" });

  assert.deepEqual(calls, [
    { name: "admin_list_users", args: { actor_id: actorId } },
    {
      name: "admin_create_user",
      args: { actor_id: actorId, p_email: "person@example.test", p_name: "Person", p_role: "STAFF" },
    },
    {
      name: "admin_update_user",
      args: { actor_id: actorId, target_id: targetId, p_role: "VIEWER", p_status: "INACTIVE" },
    },
  ]);
});

test("the privileged Supabase repository is initialized lazily at request-time", async () => {
  let factoryCalls = 0;
  const { repository: implementation } = repositoryMock();
  const repository = createLazyUserRepository(() => {
    factoryCalls += 1;
    return implementation;
  });

  assert.equal(factoryCalls, 0, "constructing a route dependency must not resolve Supabase configuration");
  await repository.listUsers(actorId);
  assert.equal(factoryCalls, 1);
  await repository.createUser(actorId, { email: "person@example.test", name: "Person", role: "STAFF" });
  assert.equal(factoryCalls, 2);
  await repository.updateUser(actorId, targetId, { status: "INACTIVE" });
  assert.equal(factoryCalls, 3);
});

test("repository database diagnostics are reduced to known safe codes", async () => {
  for (const [message, expected] of [
    ["duplicate: USER_ALREADY_EXISTS CONTEXT private details", "USER_ALREADY_EXISTS"],
    ["unexpected SQLSTATE 99999 private details", "UNKNOWN"],
  ] as const) {
    const repository = createUserRepository({
      rpc: async () => ({ data: null, error: { message } }),
    } as never);
    await assert.rejects(
      () => repository.listUsers(actorId),
      (error: unknown) => error instanceof UserRepositoryError
        && error.code === expected
        && !error.message.includes("private details"),
    );
  }
});

test("user repository contains no direct users-table DML or client-side service key", async () => {
  const repository = await readFile(new URL("../src/lib/users/repository.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../src/lib/users/api.ts", import.meta.url), "utf8");
  const listRoute = await readFile(new URL("../src/app/api/admin/users/route.ts", import.meta.url), "utf8");
  const updateRoute = await readFile(new URL("../src/app/api/admin/users/[id]/route.ts", import.meta.url), "utf8");
  const userFiles = `${repository}\n${api}\n${listRoute}\n${updateRoute}`;

  assert.doesNotMatch(repository, /\.from\(["']users["']\)/);
  assert.doesNotMatch(repository, /\.(?:insert|update|delete)\s*\(/);
  assert.doesNotMatch(userFiles, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY|["']use client["']/);
  assert.match(repository, /\.rpc\("admin_list_users"/);
  assert.match(repository, /\.rpc\("admin_create_user"/);
  assert.match(repository, /\.rpc\("admin_update_user"/);
});
