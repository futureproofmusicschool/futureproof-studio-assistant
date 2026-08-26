import { DocsView } from "@/components/DocsView";
import { readAssistantConfig } from "@/lib/config";
import { usesAgentGoogleConnectors } from "@/lib/connectors/google-runtime";

export const dynamic = "force-dynamic";

export default function DocsPage() {
  return (
    <DocsView
      assistantName={readAssistantConfig().name}
      initialDocuments={[]}
      loadOnMount
      canTrash={!usesAgentGoogleConnectors()}
    />
  );
}
