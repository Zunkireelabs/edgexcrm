interface ContactsListPageProps {
  tenantId: string;
  role: "owner" | "admin" | "viewer" | "counselor";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ContactsListPage(_props: ContactsListPageProps) {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-foreground">Contacts</h2>
        <p className="mt-2 text-sm text-muted-foreground">Coming soon — Phase B</p>
      </div>
    </div>
  );
}
