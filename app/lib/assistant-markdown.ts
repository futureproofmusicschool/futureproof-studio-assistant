type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

/** Render the arrow notation Gemini sometimes uses without changing saved turns or code. */
export function remarkArrowNotation() {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (node.type === "text" && node.value) {
        node.value = node.value.replace(/\$\\(?:rightarrow|to)\$/g, "→");
      }
      node.children?.forEach(visit);
    }

    visit(tree);
  };
}
