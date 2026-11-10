"use client"

import * as React from "react"
import { XIcon } from "@/components/icons";
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DIALOG_CARD, DIALOG_FOOTER, DIALOG_FOOTER_FORM, DIALOG_KEY_HINT, DIALOG_SHELL, DIALOG_SIZES, type DialogSize } from "@/components/ui/dialog-shell"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-transparent",
        className
      )}
      {...props}
    />
  )
}

/** Direct children that are not the header/footer bars: 16px side margin, 16px above the first / below the last. */
const BODY_CHILD =
  "[&>:not([data-slot=dialog-header]):not([data-slot=dialog-footer])]:mx-4 [&>:not([data-slot=dialog-header]):not([data-slot=dialog-footer])]:first:mt-4 [&>:not([data-slot=dialog-header]):not([data-slot=dialog-footer])]:last:mb-4";

const DialogSizeContext = React.createContext<DialogSize>("md")

function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  size = "md",
  flush,
  bodyClassName,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  overlayClassName?: string
  /** 440 / 560 / 720. Default md. A consumer `sm:max-w-*` class still overrides. */
  size?: DialogSize
  /**
   * The content owns its own padding and spacing (no body margins, no gap). Implied when the consumer's
   * className already says `p-0` (those dialogs were built flush against the old rounded box).
   */
  flush?: boolean
  /** Extra classes for the inner scroll area (e.g. `flex-row` for a sidebar + panel layout). */
  bodyClassName?: string
}) {
  const isFlush = flush ?? /(^|\s)p-0(\s|$)/.test(className ?? "")
  const isForm = size === "form"
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-size={size}
        className={cn(
          DIALOG_SHELL,
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed left-[50%] z-50 w-full translate-x-[-50%] duration-200",
          // form: anchored at 14vh (never re-centres as content changes); under sm, 16px from the top
          isForm ? "top-[14vh] max-sm:top-4" : "top-[50%] translate-y-[-50%]",
          DIALOG_SIZES[size],
          className
        )}
        {...props}
      >
        <div
          data-slot="dialog-card"
          className={cn(DIALOG_CARD, "relative min-h-0 flex-1", isForm ? "h-[70vh] max-sm:h-[calc(100dvh-32px)]" : "max-h-[calc(100vh-48px)]")}
        >
          <div
            data-slot="dialog-scroll"
            className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", isFlush ? "gap-0" : cn("gap-5 [&>*]:shrink-0", BODY_CHILD), bodyClassName)}
          >
            <DialogSizeContext.Provider value={size}>{children}</DialogSizeContext.Provider>
          </div>
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              className={cn(
                "absolute right-3 z-20 grid size-7 place-items-center rounded-lg text-ds-faint transition-colors outline-none hover:bg-ds-hover hover:text-ds-ink focus-visible:ring-2 focus-visible:ring-ds-accent/30 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                isForm ? "top-2" : "top-[10px]"
              )}
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </div>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  const isForm = React.useContext(DialogSizeContext) === "form"
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "sticky top-0 z-10 flex flex-col justify-center gap-0.5 border-b border-ds-divider bg-ds-surface pr-14 pl-4 text-left", isForm ? "min-h-11 py-0" : "min-h-12 py-2.5", " [&_[data-slot=dialog-description]]:text-[13px] [&_[data-slot=dialog-description]]:leading-[18px] [&_[data-slot=dialog-description]]:text-ds-faint",
        className
      )}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  const isForm = React.useContext(DialogSizeContext) === "form"
  return (
    <div data-slot="dialog-footer" className={cn(isForm ? DIALOG_FOOTER_FORM : DIALOG_FOOTER, className)} {...props}>
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

/** The small translucent key hint inside a primary button: `<Button>Archive <DialogKeyHint>↵</DialogKeyHint></Button>`. */
function DialogKeyHint({ className, ...props }: React.ComponentProps<"kbd">) {
  return <kbd data-slot="dialog-key-hint" className={cn(DIALOG_KEY_HINT, "font-sans", className)} {...props} />
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-sm leading-5 font-medium text-ds-ink", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogKeyHint,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
