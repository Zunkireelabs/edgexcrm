import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Privacy Policy — EdgeX CRM",
  description: "How EdgeX CRM by Zunkiree Labs collects, uses, and protects data, including Google user data accessed via Connected Inboxes.",
};

const LAST_UPDATED = "July 17, 2026";
const CONTACT_EMAIL = "privacy@zunkireelabs.com";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-6 py-5">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="6" fill="#2272B4" />
            <path d="M7 8.5C7 7.67157 7.67157 7 8.5 7H10.5C11.3284 7 12 7.67157 12 8.5V10.5C12 11.3284 11.3284 12 10.5 12H8.5C7.67157 12 7 11.3284 7 10.5V8.5Z" fill="white" />
            <path d="M12 13.5C12 12.6716 12.6716 12 13.5 12H15.5C16.3284 12 17 12.6716 17 13.5V15.5C17 16.3284 16.3284 17 15.5 17H13.5C12.6716 17 12 16.3284 12 15.5V13.5Z" fill="white" />
            <path d="M7 13.5C7 12.6716 7.67157 12 8.5 12H10.5C11.3284 12 12 12.6716 12 13.5V15.5C12 16.3284 11.3284 17 10.5 17H8.5C7.67157 17 7 16.3284 7 15.5V13.5Z" fill="white" fillOpacity="0.5" />
            <path d="M12 8.5C12 7.67157 12.6716 7 13.5 7H15.5C16.3284 7 17 7.67157 17 8.5V10.5C17 11.3284 16.3284 12 15.5 12H13.5C12.6716 12 12 11.3284 12 10.5V8.5Z" fill="white" fillOpacity="0.5" />
          </svg>
          <span className="text-[15px] font-semibold tracking-tight">EdgeX</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">Last updated: {LAST_UPDATED}</p>

        <div className="prose-policy mt-8 space-y-8 text-[15px] leading-relaxed">
          <section>
            <p>
              EdgeX CRM (&ldquo;EdgeX,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is a lead management and operations
              platform built and operated by <strong>Zunkiree Labs</strong>. This policy explains what
              information we collect from the people who use EdgeX, how we use it, and — because EdgeX
              offers an optional feature that connects to a user&rsquo;s own Gmail account — it specifically
              and separately explains what Google user data we access, why, and how it&rsquo;s protected.
            </p>
            <p>
              EdgeX is a business-to-business, multi-tenant application. Each organization (&ldquo;tenant&rdquo;)
              that uses EdgeX controls its own account and the people it invites; this policy describes how
              Zunkiree Labs, as the operator of the platform, handles data on their behalf and on behalf of
              individual users within a tenant.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight">Information we collect</h2>
            <p>We collect the following categories of information as part of operating EdgeX:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li><strong>Account information</strong> — name, email address, and role, for each person a tenant invites to use EdgeX.</li>
              <li><strong>Tenant business data</strong> — leads, contacts, deals, notes, and related records that a tenant&rsquo;s team enters or imports into EdgeX to run their business.</li>
              <li><strong>Usage data</strong> — standard technical logs (timestamps, IP address, browser/device information) used for security, debugging, and abuse prevention.</li>
              <li><strong>Google user data</strong> — only if a user chooses to connect their own Gmail account via the Connected Inboxes feature, described in detail below.</li>
            </ul>
          </section>

          <section id="google-user-data" className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="text-xl font-semibold tracking-tight">Google user data — Connected Inboxes</h2>
            <p>
              EdgeX offers an optional feature, <strong>Connected Inboxes</strong>, that lets an individual
              team member connect their own Gmail account so they can send email to leads from their own
              address directly inside EdgeX, with replies appearing back in the same conversation thread.
              This section discloses exactly what that feature does with Google user data.
            </p>

            <h3 className="mt-5 text-[15px] font-semibold">What we access, and why</h3>
            <p>When a user chooses to connect their Gmail account, EdgeX requests the following OAuth scopes:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <code className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[13px]">gmail.readonly</code> —
                to read the messages and reply history of an email conversation the user is already having
                with a lead, so that a reply sent outside EdgeX shows up back inside the lead&rsquo;s thread.
              </li>
              <li>
                <code className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[13px]">gmail.send</code> —
                to send an email as the connected user, from inside EdgeX, to a lead they are working.
              </li>
              <li>
                <code className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[13px]">userinfo.email</code> —
                to identify which Google account was connected.
              </li>
            </ul>
            <p>
              This is <strong>per-user, opt-in, and one-directional in scope of access</strong> — connecting
              an inbox only ever exposes that individual&rsquo;s own Gmail account, only after they explicitly
              authorize it, and only for the purpose of this feature. An administrator cannot connect a
              Gmail account on someone else&rsquo;s behalf.
            </p>

            <h3 className="mt-5 text-[15px] font-semibold">What we do <em>not</em> do</h3>
            <p>
              EdgeX does not read, send, or otherwise access a connected Gmail account for any purpose other
              than the Connected Inboxes feature described above. We do not delete messages, modify labels,
              access Drafts, or take any action in the account beyond reading messages relevant to a lead
              conversation and sending messages the user explicitly composes in EdgeX.
            </p>

            <h3 className="mt-5 text-[15px] font-semibold">How this data is stored and protected</h3>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>OAuth tokens are encrypted at rest (AES-256-GCM) before being stored; they are never stored or transmitted in plaintext.</li>
              <li>Message content synced for a lead conversation is stored within that tenant&rsquo;s isolated data, visible only to authorized users of that tenant.</li>
              <li>Access is scoped per-user — one team member&rsquo;s connected inbox is never accessible to another user, including other members of the same tenant, except through the shared lead conversation thread that feature exists to support.</li>
            </ul>

            <h3 className="mt-5 text-[15px] font-semibold">Retention and revocation</h3>
            <p>
              Connected account credentials are retained only for as long as the user keeps the inbox
              connected. A user can disconnect at any time from Settings → Communications inside EdgeX,
              which deletes the stored credentials from our database <em>and</em> revokes the authorization
              grant on Google&rsquo;s side. A user can also revoke access directly at any time from their
              Google Account under Security → Third-party access.
            </p>

            <h3 className="mt-5 text-[15px] font-semibold">Limited Use disclosure</h3>
            <p>
              EdgeX&rsquo;s use and transfer of information received from Google APIs adheres to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. Google user data accessed through Connected Inboxes
              is used solely to provide and improve this feature within EdgeX for the connecting user&rsquo;s
              own tenant. It is never used for advertising, never sold, and never used to train generalized
              AI or machine learning models.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight">How we use information</h2>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>To provide, operate, and maintain the EdgeX platform for each tenant.</li>
              <li>To power features a tenant&rsquo;s users explicitly opt into, such as Connected Inboxes.</li>
              <li>To secure accounts, prevent abuse, and debug issues.</li>
              <li>To communicate with users about their account or material changes to our services or this policy.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight">Sharing of information</h2>
            <p>
              We do not sell personal information. We share information only with infrastructure providers
              necessary to operate EdgeX (for example, our database and hosting providers), each bound by
              their own data-processing obligations, or where required by law. Google user data specifically
              is never shared with any third party outside of what is necessary to operate the Connected
              Inboxes feature itself (i.e., calls to Google&rsquo;s own APIs).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight">Data security</h2>
            <p>
              EdgeX is a multi-tenant application with tenant-level data isolation enforced at the database
              layer, encrypted credential storage for connected third-party accounts, and role-based access
              control within each tenant. No method of transmission or storage is 100% secure, but we work
              to protect information using industry-standard practices.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight">Your choices</h2>
            <p>
              Users can disconnect a connected Gmail account at any time (see &ldquo;Retention and
              revocation&rdquo; above). Tenant administrators can contact us to request export or deletion
              of their tenant&rsquo;s data, subject to their own agreement with Zunkiree Labs.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight">Children&rsquo;s privacy</h2>
            <p>
              EdgeX is a business tool intended for use by working professionals and is not directed at, or
              knowingly used to collect information from, children under 16.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight">Changes to this policy</h2>
            <p>
              If we change how EdgeX accesses, uses, or shares Google user data, we will update this policy
              and, where required, notify affected users and request their consent before making use of
              their data in a new way.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight">Contact us</h2>
            <p>
              Questions about this policy or your data can be sent to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-2">{CONTACT_EMAIL}</a>.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6 text-xs text-[var(--muted-foreground)]">
          <div className="flex items-center gap-1.5">
            <span>from</span>
            <Image src="/zunkireelabs-icon.png" alt="Zunkireelabs" width={14} height={14} />
            <span className="font-medium text-[var(--foreground)]">zunkireelabs</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hover:text-[var(--foreground)]">Back to sign in</Link>
            <span>&copy;2026 Zunkireelabs</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
