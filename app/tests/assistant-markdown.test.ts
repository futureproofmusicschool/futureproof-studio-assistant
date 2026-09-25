import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkArrowNotation } from "../lib/assistant-markdown";

function render(text: string) {
  return renderToStaticMarkup(createElement(Markdown, {
    remarkPlugins: [remarkGfm, remarkArrowNotation],
    children: text,
  }));
}

test("renders the assistant's LaTeX arrow notation as a right arrow", () => {
  const html = render("1. **RISE** $\\rightarrow$ **SLOW** (or **MED**)\n2. **SMEAR** $\\to$ **ON**");
  assert.match(html, /<strong>RISE<\/strong> → <strong>SLOW<\/strong>/);
  assert.match(html, /<strong>SMEAR<\/strong> → <strong>ON<\/strong>/);
  assert.doesNotMatch(html, /rightarrow|\\to/);
});

test("leaves code examples untouched", () => {
  const html = render("Use `$\\rightarrow$` in source.\n\n```tex\n$\\rightarrow$\n```");
  assert.match(html, /<code>\$\\rightarrow\$<\/code>/);
  assert.match(html, /<pre><code class="language-tex">\$\\rightarrow\$/);
});
