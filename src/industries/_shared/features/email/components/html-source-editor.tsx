"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface HtmlSourceEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export interface HtmlSourceEditorHandle {
  /** Inserts text at the current cursor position (falls back to appending at the end). */
  insertText: (text: string) => void;
}

export const HtmlSourceEditor = forwardRef<HtmlSourceEditorHandle, HtmlSourceEditorProps>(
  function HtmlSourceEditor({ value, onChange, placeholder, minHeight = 220 }, ref) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        insertText: (text: string) => {
          const el = textareaRef.current;
          if (!el) {
            onChange(value + text);
            return;
          }
          const start = el.selectionStart ?? value.length;
          const end = el.selectionEnd ?? value.length;
          const next = value.slice(0, start) + text + value.slice(end);
          onChange(next);
          requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(start + text.length, start + text.length);
          });
        },
      }),
      [value, onChange]
    );

    return (
      <Tabs defaultValue="source" className="gap-2">
        <TabsList className="h-8">
          <TabsTrigger value="source" className="text-xs">
            Source
          </TabsTrigger>
          <TabsTrigger value="preview" className="text-xs">
            Preview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="source" className="mt-0">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            style={{ minHeight }}
            className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-y font-mono"
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-0">
          <div className="border border-input rounded-md overflow-hidden bg-white" style={{ minHeight }}>
            {value ? (
              <iframe
                sandbox=""
                srcDoc={value}
                title="Email preview"
                className="w-full border-0"
                style={{ minHeight, height: minHeight }}
              />
            ) : (
              <div
                className="flex items-center justify-center text-sm text-muted-foreground"
                style={{ minHeight }}
              >
                Nothing to preview yet
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Structural preview only — scripts are disabled and real inboxes (Gmail/Outlook/Apple Mail) may
            render some CSS differently. Use &quot;Send Test Email&quot; to verify the real thing.
          </p>
        </TabsContent>
      </Tabs>
    );
  }
);
