import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isNavigationItemActive } from "../src/components/app-shell/navigation.tsx";

test("authenticated navigation identifies document detail and upload routes independently", () => {
  assert.equal(isNavigationItemActive("/documents", "/documents"), true);
  assert.equal(isNavigationItemActive("/documents/11111111-1111-4111-8111-111111111111", "/documents"), true);
  assert.equal(isNavigationItemActive("/documents/upload", "/documents"), false);
  assert.equal(isNavigationItemActive("/documents/upload", "/documents/upload"), true);
  assert.equal(isNavigationItemActive("/admin/users", "/admin/users"), true);
});

test("modern shell keeps approved brand tokens, the neutral background fallback, and required responsive widths", async () => {
  const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /--color-primary:\s*#007fff/i);
  assert.match(css, /--color-brand:\s*#0047ab/i);
  assert.match(css, /--color-text-secondary:\s*#557c99/i);
  assert.match(css, /--color-background:\s*var\(--color-surface-muted\)/);
  assert.match(css, /Milky White is still pending approval/);
  assert.match(css, /@media \(max-width: 800px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.doesNotMatch(css, /glassmorphism|backdrop-filter/i);
});
