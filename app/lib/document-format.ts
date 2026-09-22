import type { docs_v1 } from "googleapis";
const EXCERPT_CHARS = 140;
type TextMark = {
  start: number;
  end: number;
  style: docs_v1.Schema$TextStyle;
  fields: string;
};

type ParagraphMark = {
  start: number;
  end: number;
  namedStyleType: string;
};

type ListMark = {
  start: number;
  end: number;
  type: "bullet" | "number";
  line: number;
};

type RenderedMarkdown = {
  text: string;
  textMarks: TextMark[];
  paragraphMarks: ParagraphMark[];
  listMarks: ListMark[];
};

export function plainExcerpt(body: string) {
  const line =
    body
      .split("\n")
      .map((part) => part.trim())
      .find((part) => part && !part.startsWith("#") && !part.startsWith("---") && !part.startsWith("|")) ?? "";
  return line.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "").replace(/\s+/g, " ").slice(0, EXCERPT_CHARS);
}

function inlineMarkdown(source: string) {
  const output = { text: "", marks: [] as TextMark[] };
  let remaining = source;
  const candidates: Array<{
    expression: RegExp;
    contentGroup: number;
    style: (match: RegExpExecArray) => Pick<TextMark, "style" | "fields">;
  }> = [
    {
      expression: /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/,
      contentGroup: 1,
      style: (match) => ({ style: { link: { url: match[2] } }, fields: "link" }),
    },
    {
      expression: /\*\*([^*\n]+)\*\*/,
      contentGroup: 1,
      style: () => ({ style: { bold: true }, fields: "bold" }),
    },
    {
      expression: /__([^_\n]+)__/,
      contentGroup: 1,
      style: () => ({ style: { bold: true }, fields: "bold" }),
    },
    {
      expression: /`([^`\n]+)`/,
      contentGroup: 1,
      style: () => ({
        style: { weightedFontFamily: { fontFamily: "Roboto Mono" } },
        fields: "weightedFontFamily",
      }),
    },
    {
      expression: /\*([^*\n]+)\*/,
      contentGroup: 1,
      style: () => ({ style: { italic: true }, fields: "italic" }),
    },
    {
      expression: /_([^_\n]+)_/,
      contentGroup: 1,
      style: () => ({ style: { italic: true }, fields: "italic" }),
    },
  ];

  while (remaining) {
    const matches = candidates
      .map((candidate, priority) => ({ candidate, priority, match: candidate.expression.exec(remaining) }))
      .filter(
        (entry): entry is typeof entry & { match: RegExpExecArray } => Boolean(entry.match),
      )
      .sort((left, right) => left.match.index - right.match.index || left.priority - right.priority);
    const next = matches[0];
    if (!next) {
      output.text += remaining;
      break;
    }

    output.text += remaining.slice(0, next.match.index);
    const content = next.match[next.candidate.contentGroup];
    const start = output.text.length;
    output.text += content;
    const end = output.text.length;
    output.marks.push({ start, end, ...next.candidate.style(next.match) });
    remaining = remaining.slice(next.match.index + next.match[0].length);
  }

  return output;
}

/**
 * Native Docs remain the source of truth. This converter intentionally handles
 * the high-value Markdown subset produced by the assistant: headings, lists,
 * bold/italic/code, blockquotes, and ordinary links. Tables and rarer syntax
 * stay readable as text rather than being guessed into a destructive shape.
 */
export function renderMarkdownForGoogleDocs(markdown: string): RenderedMarkdown {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const rendered: RenderedMarkdown = { text: "", textMarks: [], paragraphMarks: [], listMarks: [] };
  let inCodeBlock = false;

  lines.forEach((original, line) => {
    if (/^\s*```/.test(original)) {
      inCodeBlock = !inCodeBlock;
      return;
    }

    if (rendered.text) rendered.text += "\n";
    const start = rendered.text.length;
    let content = original;
    let namedStyleType: string | null = null;
    let listType: ListMark["type"] | null = null;
    let wholeLineStyle: Pick<TextMark, "style" | "fields"> | null = null;

    const heading = content.match(/^(#{1,6})\s+(.+)$/);
    const unordered = content.match(/^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/);
    const ordered = content.match(/^\s*\d+[.)]\s+(.*)$/);
    const quote = content.match(/^\s*>\s?(.*)$/);

    if (inCodeBlock) {
      wholeLineStyle = {
        style: { weightedFontFamily: { fontFamily: "Roboto Mono" } },
        fields: "weightedFontFamily",
      };
    } else if (heading) {
      content = heading[2];
      const level = Math.min(3, heading[1].length);
      namedStyleType = `HEADING_${level}`;
    } else if (unordered) {
      const checkbox = unordered[1];
      content = checkbox ? `${checkbox.toLowerCase() === "x" ? "☑" : "☐"} ${unordered[2]}` : unordered[2];
      listType = "bullet";
    } else if (ordered) {
      content = ordered[1];
      listType = "number";
    } else if (quote) {
      content = quote[1];
      wholeLineStyle = { style: { italic: true }, fields: "italic" };
    }

    const inline = inCodeBlock ? { text: content, marks: [] as TextMark[] } : inlineMarkdown(content);
    rendered.text += inline.text;
    const end = rendered.text.length;

    for (const mark of inline.marks) {
      rendered.textMarks.push({ ...mark, start: start + mark.start, end: start + mark.end });
    }
    if (wholeLineStyle && end > start) {
      rendered.textMarks.push({ start, end, ...wholeLineStyle });
    }
    if (namedStyleType && end > start) {
      rendered.paragraphMarks.push({ start, end, namedStyleType });
    }
    if (listType && end > start) rendered.listMarks.push({ start, end, type: listType, line });
  });

  // Removing fenced-code marker lines can leave an artificial leading newline.
  const leading = rendered.text.length - rendered.text.replace(/^\n+/, "").length;
  if (leading) {
    rendered.text = rendered.text.slice(leading);
    rendered.textMarks = rendered.textMarks
      .map((mark) => ({ ...mark, start: Math.max(0, mark.start - leading), end: Math.max(0, mark.end - leading) }))
      .filter((mark) => mark.end > mark.start);
    rendered.paragraphMarks = rendered.paragraphMarks
      .map((mark) => ({ ...mark, start: Math.max(0, mark.start - leading), end: Math.max(0, mark.end - leading) }))
      .filter((mark) => mark.end > mark.start);
    rendered.listMarks = rendered.listMarks
      .map((mark) => ({ ...mark, start: Math.max(0, mark.start - leading), end: Math.max(0, mark.end - leading) }))
      .filter((mark) => mark.end > mark.start);
  }
  return rendered;
}

function location(index: number, tabId?: string | null): docs_v1.Schema$Location {
  return { index, ...(tabId ? { tabId } : {}) };
}

export function range(startIndex: number, endIndex: number, tabId?: string | null): docs_v1.Schema$Range {
  return { startIndex, endIndex, ...(tabId ? { tabId } : {}) };
}

export function markdownRequests(rendered: RenderedMarkdown, insertionIndex: number, tabId?: string | null) {
  const requests: docs_v1.Schema$Request[] = [];
  if (!rendered.text) return requests;

  requests.push({ insertText: { location: location(insertionIndex, tabId), text: rendered.text } });
  for (const mark of rendered.paragraphMarks) {
    requests.push({
      updateParagraphStyle: {
        range: range(insertionIndex + mark.start, insertionIndex + mark.end, tabId),
        paragraphStyle: { namedStyleType: mark.namedStyleType },
        fields: "namedStyleType",
      },
    });
  }

  const listGroups: Array<Omit<ListMark, "line">> = [];
  for (let index = 0; index < rendered.listMarks.length; index += 1) {
    const mark = rendered.listMarks[index];
    const previous = listGroups[listGroups.length - 1];
    const priorLine = rendered.listMarks[index - 1]?.line;
    if (previous && previous.type === mark.type && priorLine === mark.line - 1) previous.end = mark.end;
    else listGroups.push({ start: mark.start, end: mark.end, type: mark.type });
  }
  for (const mark of listGroups) {
    requests.push({
      createParagraphBullets: {
        range: range(insertionIndex + mark.start, insertionIndex + mark.end, tabId),
        bulletPreset:
          mark.type === "number" ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE",
      },
    });
  }

  for (const mark of rendered.textMarks) {
    requests.push({
      updateTextStyle: {
        range: range(insertionIndex + mark.start, insertionIndex + mark.end, tabId),
        textStyle: mark.style,
        fields: mark.fields,
      },
    });
  }
  return requests;
}

function paragraphText(paragraph: docs_v1.Schema$Paragraph) {
  return (paragraph.elements ?? [])
    .map((element) => {
      if (element.textRun?.content) return element.textRun.content;
      if (element.dateElement?.dateElementProperties?.displayText) {
        return element.dateElement.dateElementProperties.displayText;
      }
      if (element.person?.personProperties) {
        return element.person.personProperties.name || element.person.personProperties.email || "";
      }
      if (element.richLink?.richLinkProperties) {
        return element.richLink.richLinkProperties.title || element.richLink.richLinkProperties.uri || "";
      }
      if (element.pageBreak) return "\n";
      if (element.inlineObjectElement) return "[Embedded object]";
      return "";
    })
    .join("");
}

function paragraphMarkdown(paragraph: docs_v1.Schema$Paragraph) {
  const raw = paragraphText(paragraph);
  const content = raw.replace(/\n+$/, "");
  const suffix = raw.slice(content.length);
  if (!content) return suffix;

  if (paragraph.bullet) {
    const depth = Math.max(0, paragraph.bullet.nestingLevel ?? 0);
    return `${"  ".repeat(depth)}- ${content}${suffix}`;
  }

  const namedStyle = paragraph.paragraphStyle?.namedStyleType ?? "";
  const heading = namedStyle.match(/^HEADING_([1-6])$/);
  if (heading) return `${"#".repeat(Number(heading[1]))} ${content}${suffix}`;
  if (namedStyle === "TITLE") return `# ${content}${suffix}`;
  if (namedStyle === "SUBTITLE") return `## ${content}${suffix}`;
  return raw;
}

function structuralText(elements: docs_v1.Schema$StructuralElement[]): string {
  return elements
    .map((element) => {
      if (element.paragraph) return paragraphMarkdown(element.paragraph);
      if (element.table) {
        return (element.table.tableRows ?? [])
          .map((row) =>
            (row.tableCells ?? [])
              .map((cell) => structuralText(cell.content ?? []).trim().replace(/\n+/g, " "))
              .join(" | "),
          )
          .join("\n");
      }
      if (element.tableOfContents) return structuralText(element.tableOfContents.content ?? []);
      return "";
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n");
}

function flattenTabs(tabs: docs_v1.Schema$Tab[]): string[] {
  const flattened: string[] = [];
  for (const tab of tabs) {
    const text = structuralText(tab.documentTab?.body?.content ?? []).replace(/\n+$/, "");
    const title = tab.tabProperties?.title?.trim();
    flattened.push(title ? `## ${title}\n\n${text}`.trim() : text);
    flattened.push(...flattenTabs(tab.childTabs ?? []));
  }
  return flattened;
}

export function documentText(document: docs_v1.Schema$Document) {
  const tabs = document.tabs ?? [];
  if (tabs.length > 1 || tabs.some((tab) => (tab.childTabs?.length ?? 0) > 0)) {
    return flattenTabs(tabs).filter(Boolean).join("\n\n").trim();
  }
  const body = tabs[0]?.documentTab?.body ?? document.body;
  return structuralText(body?.content ?? []).replace(/\n+$/, "");
}

function structuralPlainText(elements: docs_v1.Schema$StructuralElement[]): string {
  return elements
    .map((element) => {
      if (element.paragraph) return paragraphText(element.paragraph);
      if (element.table) {
        return (element.table.tableRows ?? [])
          .map((row) =>
            (row.tableCells ?? [])
              .map((cell) => structuralPlainText(cell.content ?? []).trim().replace(/\n+/g, " "))
              .join(" | "),
          )
          .join("\n");
      }
      if (element.tableOfContents) return structuralPlainText(element.tableOfContents.content ?? []);
      return "";
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n");
}

export function documentPlainText(document: docs_v1.Schema$Document) {
  const body = primaryTab(document).body;
  return structuralPlainText(body?.content ?? []).replace(/\n+$/, "");
}

export function primaryTab(document: docs_v1.Schema$Document) {
  const first = document.tabs?.[0];
  return {
    tabId: first?.tabProperties?.tabId,
    body: first?.documentTab?.body ?? document.body,
  };
}

export function hasSecondaryTabs(document: docs_v1.Schema$Document) {
  const tabs = document.tabs ?? [];
  return tabs.length > 1 || tabs.some((tab) => (tab.childTabs?.length ?? 0) > 0);
}

export function bodyEndIndex(document: docs_v1.Schema$Document) {
  const content = primaryTab(document).body?.content ?? [];
  return Math.max(1, content[content.length - 1]?.endIndex ?? 1);
}

