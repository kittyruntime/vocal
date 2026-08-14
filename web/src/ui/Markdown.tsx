import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\)]+\))/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return part;
  });
}

export function Markdown({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { nodes.push(<ul key={`list-${nodes.length}`}>{list.map((x, i) => <li key={i}>{inline(x)}</li>)}</ul>); list = []; } };
  lines.forEach((line, i) => {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const item = line.match(/^[-*]\s+(.+)$/);
    if (item) { list.push(item[1]); return; }
    flush();
    if (heading) { const Tag = `h${heading[1].length}` as "h1" | "h2" | "h3"; nodes.push(<Tag key={i}>{inline(heading[2])}</Tag>); }
    else if (line.trim()) nodes.push(<p key={i}>{inline(line)}</p>);
  });
  flush();
  return <div className="markdown">{nodes}</div>;
}
