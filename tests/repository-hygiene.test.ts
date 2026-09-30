import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify(execFileCallback);

async function trackedFiles(): Promise<string[]> {
  const { stdout } = await execFile("git", ["ls-files", "-z"], { encoding: "buffer", maxBuffer: 1024 * 1024 });
  return stdout.toString("utf8").split("\0").filter(Boolean);
}

test("tracked repository content excludes local configuration, generated output, and private-key files", async () => {
  const files = await trackedFiles();
  const forbiddenPath = /(^|\/)(?:\.env(?:\.(?!example$)[^/]*)?|\.next|node_modules|out|build|dist|coverage)(?:\/|$)|\.(?:pem|key)$/i;
  const excluded = files.filter((file) => forbiddenPath.test(file));
  assert.deepEqual(excluded, []);
  assert.ok(files.includes(".env.example"));
});

test("tracked text files contain no recognizable private credential literals", async () => {
  const files = await trackedFiles();
  const secretPatterns = [
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
    /\bAIza[0-9A-Za-z_-]{35}\b/,
    /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    /\bpostgres(?:ql)?:\/\/[^\s/:@]+:[^\s@/]+@/i,
  ];

  for (const file of files.filter((entry) => entry !== "package-lock.json")) {
    let source: string;
    try {
      source = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const pattern of secretPatterns) {
      assert.doesNotMatch(source, pattern, file);
    }
  }
});

test("pull-request verification has no destructive database opt-in or application secrets", async () => {
  const workflow = await readFile(".github/workflows/verify.yml", "utf8");
  assert.match(workflow, /- run: npm ci/);
  assert.match(workflow, /- run: npm run verify/);
  assert.match(workflow, /- run: npm run audit:production/);
  assert.doesNotMatch(workflow, /(?:KWD_ALLOW_DESTRUCTIVE_LOCAL_DB|PHASE4_ALLOW_DESTRUCTIVE_LOCAL_DB|KWD_[A-Z0-9_]*DATABASE_URL|PHASE4_TEST_DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|GOOGLE_DRIVE_(?:CLIENT_SECRET|REFRESH_TOKEN)|secrets\.)/);
});
