import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PreviewPill } from "./preview-pill";

// SAMPLE PREVIEW COPY — replaced by real AI output when the assistant lands.
const SAMPLE_PULSE = {
  synthesis:
    "This project is progressing steadily — the team closed out discovery and is now mid-build on the core backend API. Budget and timeline are tracking close to plan.",
  watch:
    "The one thing to watch: the client hasn't confirmed final content yet, which could push frontend polish out a few days.",
  nextAction: "Recommended next action: confirm the outstanding content list with the client this week.",
};

/** AI-synth vision preview (lib/ai-preview.ts) — Zunkiree dogfood + admin
 * only. Pure sample copy today; no project data is read yet, so this takes
 * no props — wiring a real synthesis later is a prop addition, not a
 * layout change. */
export function AiSummaryCard() {
  return (
    <Card className="border-violet-200 bg-violet-50/30">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" />
          Project pulse
        </CardTitle>
        <PreviewPill />
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Sample preview — AI drafting is not yet live
        </p>
        <p className="text-sm text-foreground">{SAMPLE_PULSE.synthesis}</p>
        <p className="text-sm text-foreground">{SAMPLE_PULSE.watch}</p>
        <p className="text-sm text-foreground">{SAMPLE_PULSE.nextAction}</p>
        <Input disabled placeholder="Ask about this project… (coming soon)" className="text-sm mt-1" />
        <p className="text-xs text-muted-foreground italic pt-1">
          Soon: this updates automatically from your project&apos;s activity.
        </p>
      </CardContent>
    </Card>
  );
}
