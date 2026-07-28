"use client";

import { useEffect, useState } from "react";

/**
 * One line on the Talk setup screen telling the artist where manuals go. The
 * "upload UI" is a folder on their own machine; this exists so they know that.
 */
export function ReferencePanel() {
  const [docs, setDocs] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/settings", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { referenceDocs?: string[] }) => {
        if (active) setDocs(Array.isArray(body.referenceDocs) ? body.referenceDocs : []);
      })
      .catch(() => {
        if (active) setDocs(null);
      });
    return () => {
      active = false;
    };
  }, []);

  if (docs === null) return null;

  return (
    <div className="reference-panel">
      <span className="composer-chip" data-warn="false">
        <span aria-hidden="true" />
        {docs.length === 0
          ? "Reference shelf empty"
          : `Reference shelf: ${docs.length} ${docs.length === 1 ? "document" : "documents"}`}
      </span>
      <p className="reference-panel-hint">
        {docs.length === 0
          ? "Drop manuals (PDF, docx, text, or markdown) into the repo's reference/ folder and the assistant can search them when you ask technical questions."
          : `Searchable when you ask: ${docs.join(", ")}. Add more by dropping files into the repo's reference/ folder.`}
      </p>
    </div>
  );
}
