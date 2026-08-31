/**
 * Text chat should not make every turn pay for every Studio Assistant tool.
 * This router exposes the likely tool families immediately and keeps one tiny
 * capability broker available as a fallback when the wording is ambiguous.
 */

export type ChatToolCategory =
  | "studio_files"
  | "artifacts"
  | "documents"
  | "contacts"
  | "reference"
  | "ableton"
  | "web"
  | "deep_research";

export const CAPABILITY_TOOL_NAME = "request_capability";

export const CAPABILITY_DECLARATION = {
  name: CAPABILITY_TOOL_NAME,
  description:
    "Request a Studio Assistant tool family that is not available in this model round. Use this only when the artist's request genuinely needs that capability. Before calling it, give the artist one short sentence explaining what you need to check. The requested tools become available in the next round.",
  parameters: {
    type: "OBJECT",
    properties: {
      category: {
        type: "STRING",
        description:
          "One of: studio_files, artifacts, documents, contacts, reference, ableton, web, deep_research.",
      },
    },
    required: ["category"],
  },
};

const TOOL_NAMES: Record<Exclude<ChatToolCategory, "web">, readonly string[]> = {
  studio_files: ["search_studio_files", "read_studio_file", "save_memory"],
  artifacts: ["write_studio_file", "read_studio_file"],
  documents: ["write_document", "list_documents", "read_document"],
  contacts: ["search_contacts", "read_contact", "draft_email"],
  reference: ["search_reference", "read_reference"],
  ableton: [
    "get_live_overview",
    "get_live_track",
    "get_live_clip",
    "get_live_clip_notes",
    "get_live_arrangement",
    "get_live_device_parameters",
    "get_live_selection",
    "live_transport",
    "set_live_track",
    "live_clip_slot",
    "edit_live_clip_notes",
    "compose_midi_part",
    "create_live_track",
    "set_live_device_parameter",
    "arrange_live_clip",
  ],
  deep_research: ["start_deep_research", "check_deep_research"],
};

function includes(text: string, pattern: RegExp) {
  return pattern.test(text.toLowerCase());
}

export function planChatTools(text: string) {
  const categories = new Set<ChatToolCategory>();

  if (
    includes(
      text,
      /\b(local (?:html )?(?:file|page|web ?page)|html (?:file|page)|web ?page|downloadable (?:file|page)|save (?:this|that|it) (?:locally|as (?:an? )?local file|with (?:my|the) (?:other )?user data)|make (?:this|that|it) into (?:an? )?(?:local )?(?:html )?(?:file|page|web ?page))\b/,
    )
  ) {
    categories.add("artifacts");
  }

  if (
    includes(
      text,
      /\b(remember|memory|past session|earlier conversation|working[- ]self|what did we decide|search (?:my|the) (?:studio )?files?)\b/,
    )
  ) {
    categories.add("studio_files");
  }

  if (
    includes(
      text,
      /\b(google docs?|docs? tab|document|write (?:this|that|it) down|save (?:this|that|it) (?:as|to|in)|add (?:this|that|it) to (?:the |a )?(?:doc|document)|what(?:'s| is) on file)\b/,
    )
  ) {
    categories.add("documents");
  }

  if (
    includes(
      text,
      /\b(contact|contacts|outreach|correspondence|gmail|draft (?:an? )?email|email draft|recipient|follow[- ]?up email)\b/,
    )
  ) {
    categories.add("contacts");
  }

  if (
    includes(
      text,
      /\b(reference shelf|manual|documentation|official docs?|keyswitch|parameter mapping|plugin manual|hardware manual|specifications?)\b/,
    )
  ) {
    categories.add("reference");
  }

  const mentionsAbleton = includes(text, /\bableton\b|\blive (?:set|session)\b/);
  const readsLiveState = includes(
    text,
    /\b(check|inspect|show|see|read|get|open)\b|\bwhat(?:'s| is) (?:in|on|the current)\b/,
  );
  const controlsLive = includes(
    text,
    /\b(play|stop|record|undo)\b|\b(create|compose|make|add|put|change|edit|move|delete|arrange)\b.{0,48}\b(in|into|on|onto) (?:my )?(?:ableton|live|session|set|track|clip|arrangement)\b|\b(midi clip|live clip|session view|arrangement view)\b/,
  );
  if (mentionsAbleton && (readsLiveState || controlsLive)) categories.add("ableton");

  if (includes(text, /\b(deep research|thorough research|research report|comprehensive research)\b/)) {
    categories.add("deep_research");
  }

  if (
    includes(
      text,
      /\b(search the web|web search|look (?:it|this|that) up|latest|current news|today's|price|release date|recent announcement)\b/,
    )
  ) {
    categories.add("web");
  }

  return categories;
}

export function toolNamesForCategories(categories: ReadonlySet<ChatToolCategory>) {
  const names = new Set<string>();
  categories.forEach((category) => {
    if (category === "web") return;
    TOOL_NAMES[category].forEach((name) => names.add(name));
  });
  return names;
}

export function parseCapabilityCategory(value: unknown): ChatToolCategory | null {
  if (typeof value !== "string") return null;
  const category = value.trim().toLowerCase() as ChatToolCategory;
  return category === "web" || Object.hasOwn(TOOL_NAMES, category) ? category : null;
}

export function chatProgressMessage(categories: ReadonlySet<ChatToolCategory>) {
  if (categories.has("artifacts")) return "Got it — I’ll create that in your private local artifacts folder.";
  if (categories.has("documents")) return "Got it — I’ll answer here first, then handle the document.";
  if (categories.has("contacts")) return "Got it — I’m checking the relevant outreach details now.";
  if (categories.has("ableton")) return "Got it — I’m checking the live Ableton context now.";
  if (categories.has("reference")) return "Got it — I’m checking the reference shelf before I answer.";
  if (categories.has("deep_research")) return "Got it — I’m preparing the research request now.";
  if (categories.has("web")) return "Got it — I’m checking the current information now.";
  if (categories.has("studio_files")) return "Got it — I’m checking the relevant studio context now.";
  return "Got it — I’m thinking through that now.";
}
