import { ContactsView } from "@/components/ContactsView";
import { usesAgentGoogleConnectors } from "@/lib/connectors/google-runtime";

export const dynamic = "force-dynamic";

export default function ContactsPage() {
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
      loadOnMount
      identityInSheet={usesAgentGoogleConnectors()}
    />
  );
}
