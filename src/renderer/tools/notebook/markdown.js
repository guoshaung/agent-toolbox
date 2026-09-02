const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function inlineMarkdown(value) {
  const safeText = String(value || '').replace(/\[([^\]]+)\]\((?!https?:\/\/)[^)]+\)/gi, '$1');
  return escapeHtml(safeText)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" data-url="$2">$1</a>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?])/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/g, '$1<em>$2</em>');
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function tableCells(line) {
  const text = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  return text.split('|').map((cell) => cell.trim());
}

/** 足够轻量但可读的 Markdown 预览，所有用户内容先转义再渲染。 */
export function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let list = null;
  let inCode = false;
  let codeLines = [];

  const closeList = () => {
    if (list) { output.push(`</${list}>`); list = null; }
  };
  const closeCode = () => {
    if (inCode) {
      output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      inCode = false;
      codeLines = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      closeList();
      if (inCode) closeCode();
      else inCode = true;
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (!line.trim()) { closeList(); continue; }

    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      closeList();
      const headers = tableCells(line);
      index += 1;
      const rows = [];
      while (index + 1 < lines.length && lines[index + 1].includes('|') && lines[index + 1].trim()) {
        index += 1;
        rows.push(tableCells(lines[index]));
      }
      output.push('<table><thead><tr>', ...headers.map((cell) => `<th>${inlineMarkdown(cell)}</th>`), '</tr></thead><tbody>');
      for (const row of rows) {
        output.push('<tr>', ...headers.map((_, cellIndex) => `<td>${inlineMarkdown(row[cellIndex] || '')}</td>`), '</tr>');
      }
      output.push('</tbody></table>');
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) { closeList(); output.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`); continue; }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { closeList(); output.push('<hr>'); continue; }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) { closeList(); output.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`); continue; }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const nextList = unordered ? 'ul' : 'ol';
      if (list !== nextList) { closeList(); output.push(`<${nextList}>`); list = nextList; }
      output.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
      continue;
    }
    closeList();
    output.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  closeCode();
  return output.join('');
}

export function formatMarkdownSelection(value, start, end, before, after = '', placeholder = '文字') {
  const text = String(value || '');
  const selected = text.slice(start, end) || placeholder;
  return {
    value: text.slice(0, start) + before + selected + after + text.slice(end),
    start: start + before.length,
    end: start + before.length + selected.length,
  };
}

export function formatMarkdownHeading(value, start, end, level) {
  const text = String(value || '');
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const lineEndIndex = text.indexOf('\n', end);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const line = text.slice(lineStart, lineEnd).replace(/^\s*#{1,6}\s*/, '');
  const replacement = `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${line}`;
  return {
    value: text.slice(0, lineStart) + replacement + text.slice(lineEnd),
    start: lineStart,
    end: lineStart + replacement.length,
  };
}

export function markdownTable() {
  return '| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n';
}

function inlineFromHtml(node) {
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  const content = [...node.childNodes].map((child) => inlineFromHtml(child)).join('');
  if (tag === 'br') return '\n';
  if (tag === 'strong' || tag === 'b') return `**${content}**`;
  if (tag === 'em' || tag === 'i') return `*${content}*`;
  if (tag === 'del' || tag === 's') return `~~${content}~~`;
  if (tag === 'code') return `\`${content}\``;
  if (tag === 'a') return `[${content}](${node.getAttribute('href') || 'https://'})`;
  return content;
}

function blockFromHtml(node) {
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) {
    return `${'#'.repeat(Number(tag.slice(1)))} ${inlineFromHtml(node).trim()}\n\n`;
  }
  if (tag === 'pre') return `\`\`\`\n${node.textContent || ''}\n\`\`\`\n\n`;
  if (tag === 'blockquote') {
    return `${inlineFromHtml(node).split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
  }
  if (tag === 'ul' || tag === 'ol') {
    const rows = [...node.children].filter((child) => child.tagName.toLowerCase() === 'li');
    return `${rows.map((row, index) => `${tag === 'ol' ? `${index + 1}.` : '-'} ${inlineFromHtml(row).trim()}`).join('\n')}\n\n`;
  }
  if (tag === 'table') {
    const rows = [...node.querySelectorAll('tr')].map((row) => [...row.children].map((cell) => inlineFromHtml(cell).trim()));
    if (!rows.length) return '';
    const width = Math.max(...rows.map((row) => row.length));
    const line = (row) => `| ${Array.from({ length: width }, (_, index) => row[index] || '').join(' | ')} |`;
    return `${line(rows[0])}\n| ${Array(width).fill('---').join(' | ')} |\n${rows.slice(1).map(line).join('\n')}\n\n`;
  }
  if (tag === 'hr') return '---\n\n';
  const content = [...node.childNodes].map((child) => blockFromHtml(child)).join('');
  if (tag === 'p') return `${content.trim()}\n\n`;
  if (tag === 'div') return `${content}\n`;
  return content;
}

/** 把单文档 contenteditable 的 HTML 写回 Markdown，保证切换模式和持久化不丢内容。 */
export function htmlToMarkdown(element) {
  if (!element) return '';
  const raw = [...element.childNodes].map((node) => blockFromHtml(node)).join('');
  return raw.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
