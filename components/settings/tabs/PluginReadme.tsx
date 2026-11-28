import React, { useMemo } from 'react';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import type { RootContent, Root } from 'mdast';

const SAFE_HTML_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'div', 'span', 'strong', 'b', 'em', 'i', 'code', 'pre',
  'br', 'hr', 'ul', 'ol', 'li', 'blockquote',
  'details', 'summary', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'a', 'picture', 'source', 'img', 'sup', 'sub',
]);
const VOID_HTML_TAGS = new Set(['br', 'hr', 'img', 'source']);
const DATA_PNG_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

function isSafeHttpsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]+);/g, (match, entity: string) => {
    switch (entity) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      case 'nbsp': return '\u00a0';
      case 'middot': return '\u00b7';
      case 'mdash': return '\u2014';
      case 'ndash': return '\u2013';
      default: {
        if (entity.startsWith('#x') || entity.startsWith('#X')) {
          const code = Number.parseInt(entity.slice(2), 16);
          return Number.isFinite(code) && code >= 0x20 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        if (entity.startsWith('#')) {
          const code = Number.parseInt(entity.slice(1), 10);
          return Number.isFinite(code) && code >= 0x20 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return match;
      }
    }
  });
}

type HtmlAstNode =
  | { kind: 'text'; value: string }
  | { kind: 'element'; tag: string; attrs: Record<string, string>; children: HtmlAstNode[] };

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z][a-zA-Z0-9:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = decodeHtmlEntities(val);
  }
  return attrs;
}

function parseSafeHtml(raw: string): HtmlAstNode[] | null {
  const cleaned = raw.replace(/<!--[\s\S]*?-->/g, '');
  const tokenRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
  const root: HtmlAstNode[] = [];
  const stack: Array<{ tag: string; children: HtmlAstNode[] }> = [{ tag: '#root', children: root }];
  let lastIndex = 0;
  let sawTag = false;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      const text = decodeHtmlEntities(cleaned.slice(lastIndex, match.index));
      if (text) stack[stack.length - 1].children.push({ kind: 'text', value: text });
    }
    lastIndex = tokenRe.lastIndex;
    const isClose = match[1] === '/';
    const tag = match[2].toLowerCase();
    const attrText = match[3] ?? '';
    const selfClosing = match[4] === '/' || VOID_HTML_TAGS.has(tag);
    sawTag = true;

    if (!SAFE_HTML_TAGS.has(tag)) {
      return null;
    }

    if (isClose) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    if (stack.length > 16) return null;
    const node: HtmlAstNode = { kind: 'element', tag, attrs: parseAttributes(attrText), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) {
      stack.push({ tag, children: node.children });
    }
  }

  if (!sawTag) {
    return cleaned.trim() ? [{ kind: 'text', value: decodeHtmlEntities(cleaned) }] : [];
  }

  if (lastIndex < cleaned.length) {
    const tail = decodeHtmlEntities(cleaned.slice(lastIndex));
    if (tail) stack[stack.length - 1].children.push({ kind: 'text', value: tail });
  }
  return root;
}

function hasVisibleContent(nodes: React.ReactNode[]): boolean {
  return nodes.some((child) => {
    if (child === null || child === undefined || typeof child === 'boolean') return false;
    if (typeof child === 'string') return child.trim().length > 0;
    return true;
  });
}

function renderHtmlAst(nodes: HtmlAstNode[], images: Record<string, string>, depth = 0): React.ReactNode[] {
  if (depth > 16) return [];
  const out: React.ReactNode[] = [];
  nodes.forEach((node, idx) => {
    if (node.kind === 'text') {
      out.push(node.value);
      return;
    }
    const { tag, attrs } = node;
    if (tag === 'source') return;
    if (tag === 'br') { out.push(<br key={idx} />); return; }
    if (tag === 'hr') { out.push(<hr key={idx} className="my-4 border-border/60" />); return; }
    if (tag === 'img') {
      const rawSrc = attrs.src ?? '';
      const src = Object.hasOwn(images, rawSrc) ? images[rawSrc] : undefined;
      if (src && DATA_PNG_RE.test(src)) {
        out.push(<img key={idx} src={src} alt={attrs.alt ?? ''} className="my-2 inline-block max-w-full rounded" />);
      }
      return;
    }

    const children = renderHtmlAst(node.children, images, depth + 1);
    const center = attrs.align?.toLowerCase() === 'center' ? ' text-center' : '';

    if (tag === 'picture') {
      if (hasVisibleContent(children)) out.push(<React.Fragment key={idx}>{children}</React.Fragment>);
      return;
    }
    if (tag === 'a') {
      if (!hasVisibleContent(children)) return;
      const href = attrs.href ?? '';
      out.push(isSafeHttpsUrl(href)
        ? <a key={idx} href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{children}</a>
        : <span key={idx}>{children}</span>);
      return;
    }
    if (!hasVisibleContent(children)) return;

    switch (tag) {
      case 'h1': out.push(<h3 key={idx} className={`mt-4 text-lg font-semibold${center}`}>{children}</h3>); break;
      case 'h2': out.push(<h4 key={idx} className={`mt-5 border-b border-border/50 pb-1 text-base font-semibold${center}`}>{children}</h4>); break;
      case 'h3': out.push(<h5 key={idx} className={`mt-4 text-sm font-semibold${center}`}>{children}</h5>); break;
      case 'h4':
      case 'h5':
      case 'h6': out.push(<h6 key={idx} className={`mt-3 text-sm font-medium${center}`}>{children}</h6>); break;
      case 'p': out.push(<p key={idx} className={`my-2 leading-relaxed${center}`}>{children}</p>); break;
      case 'div': out.push(<div key={idx} className={`my-2${center}`}>{children}</div>); break;
      case 'span': out.push(<span key={idx}>{children}</span>); break;
      case 'strong':
      case 'b': out.push(<strong key={idx}>{children}</strong>); break;
      case 'em':
      case 'i': out.push(<em key={idx}>{children}</em>); break;
      case 'code': out.push(<code key={idx} className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>); break;
      case 'pre': out.push(<pre key={idx} className="my-3 overflow-auto rounded-lg bg-muted p-3 text-xs">{children}</pre>); break;
      case 'ul': out.push(<ul key={idx} className="my-2 list-disc space-y-1 pl-5">{children}</ul>); break;
      case 'ol': out.push(<ol key={idx} className="my-2 list-decimal space-y-1 pl-5">{children}</ol>); break;
      case 'li': out.push(<li key={idx}>{children}</li>); break;
      case 'blockquote': out.push(<blockquote key={idx} className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>); break;
      case 'details': out.push(<details key={idx} className="my-2 rounded-md border border-border/60 px-3 py-2">{children}</details>); break;
      case 'summary': out.push(<summary key={idx} className="cursor-pointer font-medium">{children}</summary>); break;
      case 'table': out.push(<div key={idx} className="my-3 overflow-x-auto"><table className="w-full border-collapse text-xs">{children}</table></div>); break;
      case 'thead': out.push(<thead key={idx}>{children}</thead>); break;
      case 'tbody': out.push(<tbody key={idx}>{children}</tbody>); break;
      case 'tr': out.push(<tr key={idx} className="border-b border-border/50">{children}</tr>); break;
      case 'th': out.push(<th key={idx} className="px-2.5 py-1.5 text-left font-semibold">{children}</th>); break;
      case 'td': out.push(<td key={idx} className="px-2.5 py-1.5 align-top">{children}</td>); break;
      case 'sup': out.push(<sup key={idx}>{children}</sup>); break;
      case 'sub': out.push(<sub key={idx}>{children}</sub>); break;
      default: out.push(<span key={idx}>{children}</span>); break;
    }
  });
  return out;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === '\\' && trimmed[i + 1] === '|') {
      current += '|';
      i += 1;
    } else if (trimmed[i] === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += trimmed[i];
    }
  }
  cells.push(current.trim());
  return cells;
}

const TABLE_DIVIDER_RE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;

function extractRawParagraphText(node: RootContent): string | null {
  if (node.type !== 'paragraph') return null;
  let out = '';
  for (const child of node.children) {
    if (child.type === 'text') out += child.value;
    else if (child.type === 'inlineCode') out += `\`${child.value}\``;
    else if (child.type === 'strong') out += `**${child.children.map((c) => ('value' in c ? c.value : '')).join('')}**`;
    else if (child.type === 'emphasis') out += `*${child.children.map((c) => ('value' in c ? c.value : '')).join('')}*`;
    else if (child.type === 'link') out += `[${child.children.map((c) => ('value' in c ? c.value : '')).join('')}](${child.url})`;
    else return null;
  }
  return out;
}

function tryRenderPipeTable(node: RootContent, key: number, images: Record<string, string>, depth: number): React.ReactNode | null {
  const raw = extractRawParagraphText(node);
  if (!raw || !raw.includes('|') || !raw.includes('\n')) return null;
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2 || !TABLE_DIVIDER_RE.test(lines[1])) return null;
  const headers = splitTableRow(lines[0]);
  if (headers.length < 2) return null;
  const rows = lines.slice(2).map(splitTableRow);
  const renderCell = (cellText: string) => {
    const cellTree = parseMarkdown(cellText);
    const first = cellTree.children[0];
    if (first && first.type === 'paragraph') {
      return first.children.map((child, idx) => renderNode(child as RootContent, idx, images, depth + 1));
    }
    return cellText;
  };
  return (
    <div key={key} className="my-3 overflow-x-auto rounded-md border border-border/60">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-muted/40">
          <tr className="border-b border-border/60">
            {headers.map((cell, idx) => <th key={idx} className="px-2.5 py-1.5 text-left font-semibold">{renderCell(cell)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="border-b border-border/40 last:border-b-0">
              {headers.map((_, colIdx) => <td key={colIdx} className="px-2.5 py-1.5 align-top">{renderCell(row[colIdx] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseMarkdown(markdown: string): Root {
  return fromMarkdown(markdown, {
    extensions: [gfmStrikethrough()],
    mdastExtensions: [gfmStrikethroughFromMarkdown()],
  });
}

function renderNode(node: Root | RootContent, key: number, images: Record<string, string>, depth = 0): React.ReactNode {
  if (depth > 24) return null;
  if (node.type === 'paragraph') {
    const table = tryRenderPipeTable(node, key, images, depth);
    if (table) return table;
  }
  const children = 'children' in node ? node.children.map((child, index) => renderNode(child as RootContent, index, images, depth + 1)) : null;
  switch (node.type) {
    case 'root': return <React.Fragment key={key}>{children}</React.Fragment>;
    case 'heading': {
      if (node.depth === 1) return <h3 key={key} className="mt-5 text-lg font-semibold">{children}</h3>;
      if (node.depth === 2) return <h4 key={key} className="mt-5 border-b border-border/50 pb-1 text-base font-semibold">{children}</h4>;
      return <h5 key={key} className="mt-4 text-sm font-semibold">{children}</h5>;
    }
    case 'paragraph': return <p key={key} className="my-2 leading-relaxed">{children}</p>;
    case 'text': return node.value;
    case 'strong': return <strong key={key}>{children}</strong>;
    case 'emphasis': return <em key={key}>{children}</em>;
    case 'delete': return <del key={key}>{children}</del>;
    case 'inlineCode': return <code key={key} className="rounded bg-muted px-1 py-0.5 text-xs">{node.value}</code>;
    case 'code': return <pre key={key} className="my-3 overflow-auto rounded-lg bg-muted p-3 text-xs"><code>{node.value}</code></pre>;
    case 'list': return node.ordered
      ? <ol key={key} className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
      : <ul key={key} className="my-2 list-disc space-y-1 pl-5">{children}</ul>;
    case 'listItem': return <li key={key}>{children}</li>;
    case 'blockquote': return <blockquote key={key} className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>;
    case 'break': return <br key={key} />;
    case 'thematicBreak': return <hr key={key} className="my-4 border-border/60" />;
    case 'link': {
      return isSafeHttpsUrl(node.url)
        ? <a key={key} href={node.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{children}</a>
        : <span key={key}>{children}</span>;
    }
    case 'image': {
      const src = Object.hasOwn(images, node.url) ? images[node.url] : undefined;
      return src && DATA_PNG_RE.test(src)
        ? <img key={key} src={src} alt={node.alt ?? ''} className="my-2 max-w-full rounded" />
        : <span key={key} className="text-muted-foreground">[{node.alt ?? 'image'}]</span>;
    }
    case 'imageReference': return <span key={key} className="text-muted-foreground">[{node.alt ?? 'image'}]</span>;
    case 'html': {
      const parsed = parseSafeHtml(node.value);
      if (parsed === null) return <span key={key}>{node.value}</span>;
      const rendered = renderHtmlAst(parsed, images, 0);
      return hasVisibleContent(rendered) ? <React.Fragment key={key}>{rendered}</React.Fragment> : null;
    }
    default: return <React.Fragment key={key}>{children}</React.Fragment>;
  }
}

export function PluginReadme({ markdown, images = {} }: { markdown: string; images?: Record<string, string> }) {
  const tree = useMemo(() => parseMarkdown(markdown.slice(0, 256 * 1024)), [markdown]);
  return <div className="break-words text-sm">{renderNode(tree, 0, images)}</div>;
}
