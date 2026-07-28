export type TabDefinition = {
  id: string;
  label: string;
  href: string;
};

export const TABS: TabDefinition[] = [
  { id: "talk", label: "Talk", href: "/talk" },
  { id: "board", label: "Board", href: "/board" },
  { id: "contacts", label: "Contacts", href: "/contacts" },
];

/** Always last, never optional: it is where you turn the other tabs on. */
export const SETTINGS_TAB: TabDefinition = { id: "settings", label: "Settings", href: "/settings" };

export function enabledTabs(tabIds: string[]) {
  const enabled = new Set(tabIds);
  return [...TABS.filter((tab) => enabled.has(tab.id)), SETTINGS_TAB];
}
