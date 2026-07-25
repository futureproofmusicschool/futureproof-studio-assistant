import { ContactsView } from "@/components/ContactsView";
import { readContacts } from "@/lib/contacts";

export const dynamic = "force-dynamic";

export default function ContactsPage() {
  return <ContactsView initialContacts={readContacts()} />;
}
