import type { ReactNode } from "react";

// Tiny, dependency-free markdown → React renderer. Emits React elements (never
// dangerouslySetInnerHTML), so all text is auto-escaped — safe for model output.
// Covers what chat actually uses: headings, bold, italic, inline code, code fences,
// links, and bullet/numbered lists. Not a full CommonMark implementation.

const safeHref = (url: string) => (/^(https?:|mailto:)/i.test(url) ? url : undefined);

// ---- inline: **bold** *italic* `code` [text](url) ----
const INLINE = [
  { re: /`([^`]+)`/, node: (m: RegExpExecArray, k: number) => <code key={k}>{m[1]}</code> },
  { re: /\*\*([^*]+)\*\*/, node: (m: RegExpExecArray, k: number) => <strong key={k}>{inline(m[1])}</strong> },
  { re: /__([^_]+)__/, node: (m: RegExpExecArray, k: number) => <strong key={k}>{inline(m[1])}</strong> },
  { re: /\*([^*\n]+)\*/, node: (m: RegExpExecArray, k: number) => <em key={k}>{inline(m[1])}</em> },
  { re: /(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/, node: (m: RegExpExecArray, k: number) => <em key={k}>{inline(m[1])}</em> },
  { re: /\[([^\]]+)\]\(([^)\s]+)\)/, node: (m: RegExpExecArray, k: number) => {
    const href = safeHref(m[2]);
    return href ? <a key={k} href={href} target="_blank" rel="noopener noreferrer">{m[1]}</a> : <span key={k}>{m[0]}</span>;
  } },
];

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text, key = 0;
  while (rest) {
    let best: { i: number; len: number; el: ReactNode } | null = null;
    for (const { re, node } of INLINE) {
      const m = re.exec(rest);
      if (m && (best === null || m.index < best.i)) best = { i: m.index, len: m[0].length, el: node(m, key) };
    }
    if (!best) { out.push(rest); break; }
    if (best.i > 0) out.push(rest.slice(0, best.i));
    out.push(best.el);
    rest = rest.slice(best.i + best.len);
    key++;
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0, k = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    if (/^\s*```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      blocks.push(<pre key={k++}><code>{buf.join("\n")}</code></pre>);
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = h[1].length;
      blocks.push(<div key={k++} className="md-h" style={{ fontWeight: 700, fontSize: lvl <= 2 ? 14 : 13, margin: "6px 0 2px" }}>{inline(h[2])}</div>);
      i++; continue;
    }

    // bullet / numbered list (consecutive lines)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>);
        i++;
      }
      blocks.push(ordered
        ? <ol key={k++} style={{ margin: "3px 0", paddingLeft: 18 }}>{items}</ol>
        : <ul key={k++} style={{ margin: "3px 0", paddingLeft: 18 }}>{items}</ul>);
      continue;
    }

    // blank line → spacing between paragraphs
    if (line.trim() === "") { i++; continue; }

    // paragraph: gather consecutive non-blank, non-special lines
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^\s*```/.test(lines[i]) &&
           !/^(#{1,6})\s+/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={k++} style={{ margin: "3px 0", whiteSpace: "pre-wrap" }}>{inline(para.join("\n"))}</p>);
  }

  return <div className="md">{blocks}</div>;
}
