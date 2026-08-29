"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { preserveLineBreaks } from "@/lib/email/render-template";

interface HtmlSourceEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  format: "text" | "html";
  onFormatChange: (format: "text" | "html") => void;
  /** Hide the Rich text / HTML source toggle for callers whose body is always one format. */
  showFormatToggle?: boolean;
  disabled?: boolean;
}

export interface HtmlSourceEditorHandle {
  /** Inserts text at the current cursor position (falls back to appending at the end). */
  insertText: (text: string) => void;
}

export const HtmlSourceEditor = forwardRef<HtmlSourceEditorHandle, HtmlSourceEditorProps>(
  function HtmlSourceEditor(
    { value, onChange, placeholder, minHeight = 220, format, onFormatChange, showFormatToggle = true, disabled = false },
    ref
  ) {
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
      <div className="space-y-2">
        {showFormatToggle && (
          <div className="inline-flex items-center rounded-md border border-input p-0.5 text-xs">
            <button
              type="button"
              aria-pressed={format === "text"}
              onClick={() => onFormatChange("text")}
              className={`px-2.5 py-1 rounded transition-colors ${
                format === "text"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Rich text
            </button>
            <button
              type="button"
              aria-pressed={format === "html"}
              onClick={() => onFormatChange("html")}
              className={`px-2.5 py-1 rounded transition-colors ${
                format === "html"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              HTML source
            </button>
          </div>
        )}

        {format === "text" ? (
          <div className="space-y-1.5">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              disabled={disabled}
              style={{ minHeight }}
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-y disabled:opacity-50"
            />
            <div
              className="border border-input rounded-md overflow-hidden bg-white"
              style={{ minHeight: Math.min(minHeight, 140) }}
            >
              {value ? (
                <iframe
                  sandbox=""
                  srcDoc={preserveLineBreaks(value)}
                  title="Email preview"
                  className="w-full border-0"
                  style={{ minHeight: Math.min(minHeight, 140), height: Math.min(minHeight, 140) }}
                />
              ) : (
                <div
                  className="flex items-center justify-center text-sm text-muted-foreground"
                  style={{ minHeight: Math.min(minHeight, 140) }}
                >
                  Nothing to preview yet
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Preview — line breaks become visible spacing when this email is sent.
            </p>
          </div>
        ) : (
          <Tabs defaultValue="source" className="gap-2">
            <TabsList className="h-8">
              <TabsTrigger value="source" className="text-xs">
                Source
              </TabsTrigger>
              <TabsTrigger value="preview" className="text-xs">
                Preview
              </TabsTrigger>
            </TabsList>

            {/*
              forceMount on both panels keeps the Source textarea (and its ref)
              mounted even while the Preview tab is showing — Radix Tabs
              unmounts inactive content by default, which would silently break
              insertText() (the merge-tag "insert at cursor" buttons) the moment
              an admin clicks a chip while looking at Preview: the ref would be
              null with no user-visible warning. Hide the inactive panel with
              CSS instead of unmounting it.
            */}
            <TabsContent value="source" className="mt-0 data-[state=inactive]:hidden" forceMount>
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                style={{ minHeight }}
                className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-y font-mono disabled:opacity-50"
              />
            </TabsContent>

            <TabsContent value="preview" className="mt-0 data-[state=inactive]:hidden" forceMount>
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
                render some CSS differently. Line breaks are sent verbatim in HTML mode (no auto-&lt;br&gt;).
                Use &quot;Send Test Email&quot; to verify the real thing.
              </p>
            </TabsContent>
          </Tabs>
        )}
      </div>
    );
  }
);
