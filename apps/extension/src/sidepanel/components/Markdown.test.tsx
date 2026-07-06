import { describe, test, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown.js";

const html = (md: string) => renderToStaticMarkup(<Markdown text={md} />);

describe("Markdown renderer", () => {
  test("headings and bold/italic/inline-code", () => {
    const h = html("# Title\n\nsome **bold** and *italic* and `code` here");
    expect(h).toContain(">Title<");
    expect(h).toContain("<strong>bold</strong>");
    expect(h).toContain("<em>italic</em>");
    expect(h).toContain("<code>code</code>");
  });

  test("fenced code block is preserved verbatim (not markdown-parsed inside)", () => {
    const h = html("```\nconst x = **not bold**\n```");
    expect(h).toContain("<pre><code>const x = **not bold**</code></pre>");
    expect(h).not.toContain("<strong>");
  });

  test("bullet and numbered lists", () => {
    expect(html("- one\n- two")).toContain("<ul");
    expect(html("- one\n- two")).toContain("<li>one</li>");
    expect(html("1. a\n2. b")).toContain("<ol");
  });

  test("safe links only (javascript: is neutered, https kept)", () => {
    expect(html("[ok](https://example.com)")).toContain('href="https://example.com"');
    const bad = html("[x](javascript:alert(1))");
    expect(bad).not.toContain("href=");     // no link created
    expect(bad).not.toContain("<a ");       // no anchor element at all
    expect(bad).toContain("javascript:alert"); // shown as literal text instead
  });

  test("no raw HTML injection — angle brackets are escaped", () => {
    const h = html("hello <img src=x onerror=alert(1)> world");
    expect(h).not.toContain("<img");
    expect(h).toContain("&lt;img");
  });

  test("plain prose passes through unharmed", () => {
    expect(html("Just a normal sentence.")).toContain("Just a normal sentence.");
  });
});
