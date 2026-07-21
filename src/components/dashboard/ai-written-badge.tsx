import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Phase 4C provenance marker — the humans reviewing this need to know an item wasn't human-authored more than the model does. */
export function AiWrittenBadge() {
  return (
    <Badge variant="outline" className="gap-1 border-purple-200 bg-purple-50 text-purple-700" title="Written by the AI assistant — unverified">
      <Bot className="w-3 h-3" />
      AI-written
    </Badge>
  );
}
