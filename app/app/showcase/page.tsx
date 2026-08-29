import { ConversationView } from "@/components/ConversationView";
import { readAssistantConfig } from "@/lib/config";
import { listTalkModes } from "@/lib/talk";

export const dynamic = "force-dynamic";

/** A deliberately synthetic, screenshot-safe view of the working product. */
export default function ShowcasePage() {
  const config = readAssistantConfig();

  return (
    <ConversationView
      assistantName={config.name}
      modes={listTalkModes()}
      publicPreview
      userName="Artist"
    />
  );
}
