"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { DIALOG_CARD, DIALOG_FOOTER, DIALOG_SHELL, DIALOG_SIZES, type DialogSize } from "@/components/ui/dialog-shell"

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  children,
  size = "sm",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  /** 440 / 560 / 720. Default sm. */
  size?: DialogSize
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          DIALOG_SHELL,
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 w-full translate-x-[-50%] translate-y-[-50%] duration-200",
          DIALOG_SIZES[size],
          className
        )}
        {...props}
      >
        <div data-slot="alert-dialog-card" className={cn(DIALOG_CARD, "max-h-[calc(100vh-48px)] min-h-0 flex-1 overflow-y-auto")}>
          {children}
        </div>
      </AlertDialogPrimitive.Content>
    </AlertDialogPortal>
  )
}

const ICON_TONES = {
  danger: "bg-ds-bad-soft text-ds-bad",
  default: "bg-ds-hover text-ds-muted",
} as const

/** No header bar: a padded block (20 / 20 / 18). Optional round `icon` badge; `tone="danger"` makes it red. */
function AlertDialogHeader({
  className,
  icon,
  tone = "default",
  children,
  ...props
}: React.ComponentProps<"div"> & {
  icon?: React.ReactNode
  tone?: keyof typeof ICON_TONES
}) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex gap-3.5 px-5 pt-5 pb-[18px] text-left", className)}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden
          data-tone={tone}
          className={cn("grid size-9 shrink-0 place-items-center rounded-full [&_svg]:size-[18px]", ICON_TONES[tone])}
        >
          {icon}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
    </div>
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(DIALOG_FOOTER, "static", className)}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-[15px] leading-5 font-semibold text-ds-ink", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm leading-[21px] font-normal text-ds-text", className)}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> & {
  variant?: "default" | "destructive"
}) {
  // Consumers that already paint the button red via className are treated as destructive so the
  // footer restyle keeps them red.
  const v = variant ?? (/\bbg-(destructive|red-\d+)\b/.test(className ?? "") ? "destructive" : "default")
  return (
    <AlertDialogPrimitive.Action
      data-slot="button"
      data-variant={v}
      className={cn(buttonVariants({ variant: v }), className)}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      data-slot="button"
      data-variant="outline"
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
