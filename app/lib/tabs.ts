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

export function enabledTabs(tabIds: string[]) {
  const enabled = new Set(tabIds);
  return TABS.filter((tab) => enabled.has(tab.id));
}
