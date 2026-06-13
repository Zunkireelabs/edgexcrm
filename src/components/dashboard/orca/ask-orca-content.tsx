"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Wrench, AudioLines, Mic, ArrowUp } from "lucide-react";

const SUGGESTIONS = [
  "Create a new lead",
  "Show my pipeline",
  "Assign leads to sales reps",
  "Send follow-up email",
];

export function AskOrcaContent() {
  const [input, setInput] = useState("");

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="w-full max-w-2xl">
        <h1 className="text-3xl font-semibold text-foreground text-center mb-8 tracking-[-0.025em]">
          What can I do for you?
        </h1>

        <div className="relative bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything or start a task..."
            className="min-h-[100px] resize-none border-0 focus-visible:ring-0 text-base p-4 bg-transparent"
            rows={3}
          />
          <div className="flex items-center justify-between p-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" disabled>
                <Plus className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" disabled>
                <Wrench className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground" disabled>
                <AudioLines className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground" disabled>
                <Mic className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                className="h-8 w-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                disabled
              >
                <ArrowUp className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs text-muted-foreground text-center mb-3">Try asking Orca:</p>
          <div className="flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setInput(suggestion)}
                className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-full text-[12px] font-medium text-muted-foreground hover:border-muted-foreground hover:text-foreground transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
