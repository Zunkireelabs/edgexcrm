// The question sent to the Admizz AI: everything the visitor wrote since the last reply (from anyone), so a burst such as
// "Study in the UK" / "Ok" / "Fast" is answered once, in context.

import { MAX_QUESTION_CHARS } from "./config";

export interface ChatLine {
  author_type: string;
  content_text: string | null;
}

/** `messages` oldest first. System notes (e.g. "X accepted this chat") are ignored. Empty when the visitor said nothing new. */
export function buildQuestion(messages: ChatLine[], max: number = MAX_QUESTION_CHARS): string {
  const lines: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.author_type === "system") continue;
    if (m.author_type !== "customer") break;       // an earlier reply: only what came after it is new
    const text = (m.content_text ?? "").trim();
    if (text) lines.unshift(text);
  }
  let joined = lines.join("\n");
  // Too long: keep the newest words (the oldest lines go first, then the start of what is left).
  if (joined.length > max) joined = joined.slice(joined.length - max).trimStart();
  return joined;
}
