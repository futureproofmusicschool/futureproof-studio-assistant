import { DocsView } from "@/components/DocsView";
import { readAssistantConfig } from "@/lib/config";
import { listDocuments } from "@/lib/documents";
import type { DocumentSummary } from "@/lib/documents";
import { usesAgentGoogleConnectors } from "@/lib/connectors/google-runtime";

export const dynamic = "force-dynamic";

export default async function DocsPage() {
  let initialDocuments: DocumentSummary[] = [];
  let initialError: string | undefined;
  try {
    initialDocuments = await listDocuments();
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Unable to load Google Docs";
  }
  return (
    <DocsView
      assistantName={readAssistantConfig().name}
      initialDocuments={initialDocuments}
      initialError={initialError}
      canTrash={!usesAgentGoogleConnectors()}
    />
  );
}
