export type TabDefinition = {
  id: string;
  label: string;
  href: string;
};

export const TABS: TabDefinition[] = [
  { id: "board", label: "Board", href: "/board" },
  { id: "chat", label: "Chat", href: "/chat" },
  { id: "interviews", label: "Interviews", href: "/interviews" },
];

export function enabledTabs(tabIds: string[]) {
  const enabled = new Set(tabIds);
  return TABS.filter((tab) => enabled.has(tab.id));
}
