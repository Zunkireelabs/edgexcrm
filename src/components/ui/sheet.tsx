"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Sheet({
  modal = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Root> & { modal?: boolean }) {
  return <SheetPrimitive.Root data-slot="sheet" modal={modal} {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

type SheetSide = "top" | "right" | "bottom" | "left"

/** Class list for SheetContent. Legacy output is byte-identical to the pre-EDGEX-85 inline cn(...). */
function sheetContentClasses(
  side: SheetSide,
  look: "legacy" | "v2" = "legacy",
  size: "md" | "lg" = "md",
  className?: string
) {
  const v2 = look === "v2"
  return cn(
    v2
      ? "bg-ds-surface data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-0 p-0 shadow-[var(--ds-shadow-float)] transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500"
      : "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
    side === "right" &&
      cn(
        "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l",
        v2 ? (size === "lg" ? "w-full sm:max-w-[620px]" : "w-full sm:max-w-[560px]") : "sm:max-w-sm"
      ),
    side === "left" &&
      cn(
        "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r",
        v2 ? (size === "lg" ? "w-full sm:max-w-[620px]" : "w-full sm:max-w-[560px]") : "sm:max-w-sm"
      ),
    side === "top" &&
      "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b",
    side === "bottom" &&
      "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t",
    className
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  showOverlay = true,
  look = "legacy",
  size = "md",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  /** Design System v2 opt-in. Omitted = today's output, unchanged. */
  look?: "legacy" | "v2"
  /** v2 only: panel width (md 560px, lg 620px). */
  size?: "md" | "lg"
  showCloseButton?: boolean
  showOverlay?: boolean
}) {
  return (
    <SheetPortal>
      {showOverlay && <SheetOverlay />}
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={sheetContentClasses(side, look, size, className)}
        {...props}
      >
        {children}
        {showCloseButton && look === "v2" && (
          <SheetPrimitive.Close asChild>
            <Button
              look="v2"
              variant="secondary"
              size="icon"
              aria-label="Close"
              className="absolute top-6 right-6"
            >
              <XIcon />
            </Button>
          </SheetPrimitive.Close>
        )}
        {showCloseButton && look !== "v2" && (
          <SheetPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  sheetContentClasses,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
