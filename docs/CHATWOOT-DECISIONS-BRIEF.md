# Website chat for Admizz: decisions we need from the leads

**For:** Sadin and Anish. **From:** the developer. **Status:** draft, nothing is live.
**Time to read:** about 5 minutes. **What we need back:** a yes, a no or a pick for each row, or "decide later".

## What we built, in 5 lines

A chat bubble on the Admizz website. Visitors fill a short form (name, WhatsApp number, optional email) and chat.
Their chat appears in EdgeX's existing Inbox, linked to a lead when the phone or email matches. A counselor replies
from EdgeX, and the visitor sees the counselor's name in the bubble. A counselor turns a chat into a lead with one
click (never automatic). The chat engine behind it is Chatwoot, an open-source tool we run ourselves, shown to
visitors as "Powered by Zunkiree". All of this works on the developer's laptop. Nothing is on stage or production.

## The decisions

| # | Question | Options | Recommendation | Why it matters |
|---|---|---|---|---|
| 1 | **Where does Chatwoot run?** | A. The Zunkiree VPS next to EdgeX. B. A separate small server. | **A, if the VPS has the memory.** Not checked yet; the developer needs your OK to look (a read-only check). | Chatwoot needs 4 parts (web, background worker, database, Redis). On a small VPS it could slow EdgeX or the websites. A separate server costs more but isolates it. |
| 2 | **Which Chatwoot version, and is our own branding allowed?** | A. The free community edition only. B. Buy Chatwoot's paid license. | **A.** Also have someone read Chatwoot's terms once for our "Powered by Zunkiree" branding. | The code outside its `enterprise/` folder is MIT (free, modifiable, sellable). The `enterprise/` folder (their AI, SLA, audit logs) needs a paid license in production. Replacing the brand name uses Chatwoot's own settings, which look allowed, but the developer is not a lawyer. |
| 3 | **Who watches new chats from people who are not yet leads?** | A. A named admin or front-desk person. B. Let all counselors see them. | **A.** | Today only owners and admins can see these chats. If nobody owns them, a visitor can wait with no reply. Admins already get a bell notification for each new chat (read in the code, not yet watched live). |
| 4 | **Counselors' names are shown to the public. Is that OK?** | Show full name / first name only / team name only ("Admizz Team"). Photos: yes / no / later. | **Names yes; first name or full name and photos: decide later** (as already agreed). | Each visitor sees who replied. Counselors should agree. A counselor with no name on their EdgeX profile automatically shows as "Admizz Team". An email address is never shown. |
| 5 | **How fast must someone reply, and what is the first message?** | Pick a target (for example 10 minutes in office hours) and the opening wording. | **Always ask for a WhatsApp number in the first reply**, plus a stated target. | If the visitor leaves, the reply only shows when they come back in the same browser. A number lets us follow up on WhatsApp. |
| 6 | **The form and the privacy line.** | Today: name and WhatsApp number required, email optional, plus a message box (Chatwoot always shows it). | **Keep the form as is, and add one short privacy sentence** (wording from you). | We collect a phone number and email. Visitors should be told what for. The message box cannot be removed without changing Chatwoot's own code. |
| 7 | **Keep EdgeX's own WhatsApp inbox next to website chat?** | A. Keep both in the same Inbox. B. Move WhatsApp into Chatwoot too. | **A.** | One WhatsApp number cannot easily be handled in two places. Moving it is a bigger project. |
| 8 | **Who holds the Chatwoot "platform key"?** | Name one person or place. | **A server secret only, with named owners.** | It can create accounts and users in Chatwoot, so it is powerful. Production needs it for counselor names. It must never be in code or chat messages. |
| 9 | **Is the chat for every EdgeX customer or only education?** | All customers / education only. | **Education only first** (EdgeX's default), widen later. | The Inbox itself is shared by all customers today. Website chat setup is manual for now, so one customer is simpler. |
| 10 | **AI replies, later: drafts or automatic?** | A. AI drafts, a counselor approves. B. AI answers common questions alone. | **A first.** | Wrong answers about fees or visas are costly. Not part of the first launch. |
| 11 | **How long do we keep chats, and who can delete one on request?** | For example 12 months, deletion on request by an admin. | **Pick a period; the developer will write the steps.** | Chats sit in Chatwoot's database and are copied into EdgeX. Both need a policy. |
| 12 | **Branding details.** | Link behind "Powered by Zunkiree" (now `https://zunkireelabs.com`, a guess), and a Zunkiree logo (square, about 512 px) for the small icon. | **Confirm the link; send the logo.** | The icon next to the text is still Chatwoot's logo. |

## What happens after you answer

1. The developer finalises the go-live checklist (`CHATWOOT-GO-LIVE-BRIEF.md`) with your answers.
2. Anything that writes to stage or production waits for an explicit OK from you.
3. The Admizz website change goes to `stage` first. Per that repo's rules, Sadin approves merges.

## Things the leads should know, honestly

- **Tested locally only.** The whole flow works on a laptop. Production, a public address and the Admizz server's
  security settings are not tested.
- **Not tested on a real phone.** The mobile bubble was measured in a desktop browser in phone, tablet and desktop sizes.
- **EdgeX's own production build fails on the developer's laptop** because of an older file the developer did not
  change (`ai/chat/route.ts`). It is unknown whether your CI hits the same error. Worth checking before anything is pushed.
- **No automatic lead creation, by your decision.** Counselors click "Convert to lead".
