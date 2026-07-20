import { ChatView } from "@/components/ChatView";
import { readAssistantConfig } from "@/lib/config";

export default function ChatPage() {
  const config = readAssistantConfig();

  return <ChatView assistantName={config.name} />;
}
