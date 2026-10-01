"use client";

// The "Source" code box with developer niceties: line numbers, find (Cmd/Ctrl+F), go-to-line and
// drag-and-drop / pick of a .html file. Opt-in from HtmlSourceEditor (`codeTools`) so every other
// caller keeps its plain textarea.

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { ChevronDown, ChevronUp, FileUp, Search, X } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { findMatches, indexOfLine, lineCount, lineOfIndex, validateHtmlFile } from "../lib/code-tools";

// Fixed so the gutter, the match highlight and the textarea text stay perfectly aligned.
const LINE_HEIGHT = 20;
const PAD_Y = 8;

interface CodeEditorPaneProps {
  value: string;
  onChange: (value: string) => void;
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  minHeight: number;
  placeholder?: string;
  disabled?: boolean;
}

export function CodeEditorPane({ value, onChange, textareaRef, minHeight, placeholder, disabled }: CodeEditorPaneProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pendingFile, setPendingFile] = useState<string | null>(null);

  const matches = useMemo(() => findMatches(value, query), [value, query]);
  const total = lineCount(value);

  const scrollToLine = (line: number) => {
    const el = textareaRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, (line - 1) * LINE_HEIGHT - el.clientHeight / 2);
  };

  const jumpToMatch = (idx: number) => {
    if (matches.length === 0) return;
    const wrapped = ((idx % matches.length) + matches.length) % matches.length;
    setActiveIdx(wrapped);
    const line = lineOfIndex(value, matches[wrapped]);
    setHighlightLine(line);
    scrollToLine(line);
  };

  // Typing a new query jumps to its first match.
  useEffect(() => {
    if (!findOpen) return;
    if (matches.length === 0) {
      setHighlightLine(null);
      return;
    }
    setActiveIdx(0);
    const line = lineOfIndex(value, matches[0]);
    setHighlightLine(line);
    scrollToLine(line);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-jump when the query changes
  }, [query]);

  const openFind = () => {
    setFindOpen(true);
    requestAnimationFrame(() => findInputRef.current?.focus());
  };

  const closeFind = () => {
    setFindOpen(false);
    setHighlightLine(null);
    textareaRef.current?.focus();
  };

  const goToLine = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return;
    const line = Math.min(Math.floor(n), total);
    setHighlightLine(line);
    scrollToLine(line);
    const el = textareaRef.current;
    if (el) {
      const at = indexOfLine(value, line);
      el.focus();
      el.setSelectionRange(at, at);
    }
  };

  const applyFile = (text: string) => {
    onChange(text);
    setHighlightLine(null);
    if (textareaRef.current) textareaRef.current.scrollTop = 0;
    toast.success("HTML file loaded");
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || disabled) return;
    const problem = validateHtmlFile(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    const text = await file.text();
    if (value.trim()) setPendingFile(text);
    else applyFile(text);
  };

  const highlightTop = highlightLine ? PAD_Y + (highlightLine - 1) * LINE_HEIGHT - scrollTop : null;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={openFind} disabled={disabled}>
          <Search className="h-3 w-3 mr-1" /> Find
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
        >
          <FileUp className="h-3 w-3 mr-1" /> Upload .html
        </Button>
        <span className="text-muted-foreground">or drag a .html file onto the code</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".html,.htm,text/html"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = ""; // allow re-picking the same file
          }}
        />
      </div>

      {findOpen && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/30 p-1.5">
          <Input
            ref={findInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                jumpToMatch(activeIdx + (e.shiftKey ? -1 : 1));
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeFind();
              }
            }}
            placeholder="Find in code…"
            className="h-7 w-48 text-xs"
            aria-label="Find in code"
          />
          <span className="min-w-16 text-xs tabular-nums text-muted-foreground">
            {query ? (matches.length ? `${activeIdx + 1} of ${matches.length}` : "No matches") : ""}
          </span>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={!matches.length} onClick={() => jumpToMatch(activeIdx - 1)} aria-label="Previous match">
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={!matches.length} onClick={() => jumpToMatch(activeIdx + 1)} aria-label="Next match">
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Input
            type="number"
            min={1}
            max={total}
            placeholder="Go to line"
            className="h-7 w-24 text-xs"
            aria-label="Go to line"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                goToLine((e.target as HTMLInputElement).value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeFind();
              }
            }}
          />
          <span className="text-xs text-muted-foreground">{total} lines</span>
          <Button type="button" variant="ghost" size="icon" className="ml-auto h-7 w-7" onClick={closeFind} aria-label="Close find">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <div
        className={`relative flex resize-y overflow-hidden rounded-md border bg-background ${
          dragging ? "border-primary ring-2 ring-primary/40" : "border-input"
        }`}
        // Fixed (user-resizable) height: the line-number gutter is 146+ lines tall, so a min-height
        // would let the box grow to fit every line and the textarea would never scroll internally.
        style={{ height: minHeight, minHeight: 160 }}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
      >
        <div
          aria-hidden
          className="h-full shrink-0 select-none overflow-hidden border-r bg-muted/40 px-2 text-right font-mono text-xs text-muted-foreground"
          style={{ paddingTop: PAD_Y, lineHeight: `${LINE_HEIGHT}px` }}
        >
          <div style={{ transform: `translateY(${-scrollTop}px)` }}>
            {Array.from({ length: total }, (_, i) => (
              <div key={i} style={{ height: LINE_HEIGHT }} className={highlightLine === i + 1 ? "font-semibold text-foreground" : ""}>
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        <div className="relative h-full min-w-0 flex-1">
          {highlightTop !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bg-yellow-300/40 dark:bg-yellow-400/20"
              style={{ top: highlightTop, height: LINE_HEIGHT }}
            />
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
                e.preventDefault();
                openFind();
              }
            }}
            wrap="off"
            spellCheck={false}
            placeholder={placeholder}
            disabled={disabled}
            style={{ lineHeight: `${LINE_HEIGHT}px`, paddingTop: PAD_Y, paddingBottom: PAD_Y }}
            className="relative block h-full w-full resize-none overflow-auto whitespace-pre bg-transparent px-3 font-mono text-xs outline-none disabled:opacity-50"
          />
        </div>
      </div>

      <AlertDialog open={pendingFile !== null} onOpenChange={(o) => !o && setPendingFile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the current HTML?</AlertDialogTitle>
            <AlertDialogDescription>
              This step already has content. Loading the file replaces it. This can&apos;t be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingFile !== null) applyFile(pendingFile);
                setPendingFile(null);
              }}
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
