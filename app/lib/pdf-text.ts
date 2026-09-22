/** Both uploads and the reference shelf use the installed parser contract. */
export async function extractPdf(bytes: Uint8Array) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText();
    return { text: result.text ?? "", pages: result.total };
  } finally { await parser.destroy(); }
}
