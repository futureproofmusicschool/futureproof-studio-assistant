import { ContactsView } from "@/components/ContactsView";
import { readContacts } from "@/lib/contacts";
import { usesAgentGoogleConnectors } from "@/lib/connectors/google-runtime";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  try {
    return <ContactsView initialContacts={await readContacts()} identityInSheet={usesAgentGoogleConnectors()} />;
  } catch (error) {
    return (
      <ContactsView
        initialContacts={{
          version: 1,
          categories: [
            { id: "collaborators", name: "Collaborators" },
            { id: "leads", name: "Leads" },
            { id: "label", name: "Labels" },
          ],
          contacts: [],
        }}
        initialError={error instanceof Error ? error.message : "Google outreach data is unavailable."}
        identityInSheet={usesAgentGoogleConnectors()}
      />
    );
  }
}
