import { InterviewsView } from "@/components/InterviewsView";
import { readAssistantConfig } from "@/lib/config";
import { checkVoiceServer, listInterviewTemplates } from "@/lib/interviews";

export const dynamic = "force-dynamic";

export default async function InterviewsPage() {
  const config = readAssistantConfig();
  const voiceServerRunning = await checkVoiceServer();

  return (
    <InterviewsView
      assistantName={config.name}
      initialVoiceServerRunning={voiceServerRunning}
      templates={listInterviewTemplates()}
    />
  );
}
