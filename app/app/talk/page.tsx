import { TalkView } from "@/components/TalkView";
import { readAssistantConfig } from "@/lib/config";
import { listTalkModes } from "@/lib/talk";

export const dynamic = "force-dynamic";

export default function TalkPage() {
  const config = readAssistantConfig();

  return <TalkView assistantName={config.name} modes={listTalkModes()} userName={config.userName} />;
}
