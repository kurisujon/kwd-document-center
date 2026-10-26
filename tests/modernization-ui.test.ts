import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { isNavigationItemActive } from "../src/components/app-shell/navigation.tsx";

function parseStylesheet(css: string) {
  const dom = new JSDOM(`<style>${css.replace('@import "tailwindcss";', "")}</style>`);
  const sheet = dom.window.document.styleSheets[0];
  assert.ok(sheet);
  return sheet;
}

function findStyleRule(rules: CSSRuleList, selector: string) {
  for (const rule of Array.from(rules)) {
    if (rule.type === 1 && (rule as CSSStyleRule).selectorText === selector) return rule as CSSStyleRule;
  }
  assert.fail(`Missing CSS rule for ${selector}`);
}

function contrastRatio(first: string, second: string) {
  const luminance = (hex: string) => {
    const channels = hex.match(/[\da-f]{2}/gi);
    assert.ok(channels);
    const [red, green, blue] = channels.map((channel) => {
      const value = Number.parseInt(channel, 16) / 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    });
    return .2126 * red + .7152 * green + .0722 * blue;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test("authenticated navigation identifies document detail and upload routes independently", () => {
  assert.equal(isNavigationItemActive("/documents", "/documents"), true);
  assert.equal(isNavigationItemActive("/documents/11111111-1111-4111-8111-111111111111", "/documents"), true);
  assert.equal(isNavigationItemActive("/documents/upload", "/documents"), false);
  assert.equal(isNavigationItemActive("/documents/upload", "/documents/upload"), true);
  assert.equal(isNavigationItemActive("/admin/users", "/admin/users"), true);
  assert.equal(isNavigationItemActive("/admin/folders", "/admin/folders"), true);
});

test("modern shell keeps approved brand tokens, the neutral background fallback, and required responsive widths", async () => {
  const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /--color-primary:\s*#007fff/i);
  assert.match(css, /--color-brand:\s*#0047ab/i);
  assert.match(css, /--color-text-secondary:\s*#557c99/i);
  assert.match(css, /--color-background:\s*var\(--color-surface-muted\)/);
  assert.match(css, /Milky White is still pending approval/);
  assert.match(css, /--radius-tile:\s*18px/);
  assert.match(css, /--radius-inner:\s*12px/);
  assert.match(css, /--radius-control:\s*10px/);
  assert.match(css, /--shadow-tile:/);
  assert.match(css, /@media \(max-width: 1100px\)/);
  assert.match(css, /@media \(max-width: 800px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.doesNotMatch(css, /glassmorphism|backdrop-filter/i);
});

test("closed mobile navigation is hidden from focus and assistive interaction until opened", async () => {
  const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const sheet = parseStylesheet(css);
  const mobileRules = Array.from(sheet.cssRules).find((rule): rule is CSSMediaRule =>
    rule.type === 4 && (rule as CSSMediaRule).conditionText === "(max-width: 800px)"
  );
  assert.ok(mobileRules);

  const closedSidebar = findStyleRule(mobileRules.cssRules, ".sidebar");
  const openSidebar = findStyleRule(mobileRules.cssRules, ".sidebar-open");
  assert.equal(closedSidebar.style.visibility, "hidden");
  assert.equal(closedSidebar.style.transform, "translateX(-102%)");
  assert.equal(openSidebar.style.visibility, "visible");
  assert.equal(openSidebar.style.transform, "translateX(0)");
});

test("focus indicator resolves to solid approved Azure with non-text contrast", async () => {
  const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const sheet = parseStylesheet(css);
  const root = findStyleRule(sheet.cssRules, ":root");
  const focusRule = findStyleRule(sheet.cssRules, "button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible");
  const primary = root.style.getPropertyValue("--color-primary").trim();

  assert.equal(root.style.getPropertyValue("--color-focus").trim(), "var(--color-primary)");
  assert.equal(focusRule.style.outline, "3px solid var(--color-focus)");
  assert.equal(primary, "#007fff");
  assert.ok(contrastRatio(primary, "#ffffff") >= 3);
  assert.ok(contrastRatio(primary, "#f3f4f6") >= 3);
});
