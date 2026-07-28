import { AbletonPanel } from "@/components/AbletonPanel";
import { ComposerPanel } from "@/components/ComposerPanel";
import { GeminiKeyPanel } from "@/components/GeminiKeyPanel";
import { IdentityPanel } from "@/components/IdentityPanel";
import { ReferencePanel } from "@/components/ReferencePanel";
import { DATA_ROOT } from "@/lib/paths";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <section className="settings-page">
      <header className="settings-heading">
        <div>
          <p className="eyebrow">Everything that is not a conversation</p>
          <h1>Settings</h1>
        </div>
        <p>Identity, API access, Ableton Live, the MIDI composer, and the local reference shelf.</p>
      </header>

      <div className="settings-body">
        <IdentityPanel />

        <div className="settings-block">
          <h2>Personal data</h2>
          <p className="settings-block-hint">
            Your identity, memory, projects, keys, contacts, transcripts, manuals, and instrument documents live
            outside the app checkout so updates cannot replace them.
          </p>
          <div className="data-location">
            <span>Stored on this machine</span>
            <code>{DATA_ROOT}</code>
          </div>
        </div>

        <div className="settings-block">
          <h2>Gemini API key</h2>
          <p className="settings-block-hint">
            Required for voice conversations, the default MIDI composer, and automatic session memory.
          </p>
          <GeminiKeyPanel />
        </div>

        <div className="settings-block">
          <h2>Ableton Live</h2>
          <p className="settings-block-hint">
            The machine whose Live session the assistant sees and controls. It must be running Live with the
            AbletonOSC control surface enabled.
          </p>
          <AbletonPanel />
        </div>

        <div className="settings-block">
          <h2>Composer</h2>
          <p className="settings-block-hint">
            Which model writes MIDI when you ask for a part. The conversation itself always runs on Gemini Live.
          </p>
          <ComposerPanel />
        </div>

        <div className="settings-block">
          <h2>Reference shelf</h2>
          <p className="settings-block-hint">
            Manuals the assistant can search when you ask a technical question.
          </p>
          <ReferencePanel />
        </div>
      </div>
    </section>
  );
}
