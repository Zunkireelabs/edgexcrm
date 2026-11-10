"use client"

import { CheckIcon, InfoIcon, CircleNotchIcon, WarningIcon, XIcon } from "@/components/icons";
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { applyToastDefaults, TOAST_DURATION_MS } from "@/components/ui/toast-defaults"

applyToastDefaults()

// EDGEX-143 Toasts v1 (approved mockup "All toast types"): top-right stack, white card, tinted status square,
// title + optional detail, close X always visible, Undo-style action under the text.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="top-right"
      offset={12}
      gap={8}
      visibleToasts={4}
      expand
      closeButton
      duration={TOAST_DURATION_MS}
      className="toaster group"
      icons={{
        success: <CheckIcon className="size-3.5" weight="bold" />,
        info: <InfoIcon className="size-3.5" weight="bold" />,
        warning: <WarningIcon className="size-3.5" weight="bold" />,
        error: <WarningIcon className="size-3.5" weight="bold" />,
        loading: <CircleNotchIcon className="size-3.5 animate-spin" />,
        close: <XIcon className="size-3.5" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "group/toast relative grid w-[360px] max-w-[calc(100vw-24px)] grid-cols-[22px_minmax(0,1fr)] items-start gap-x-2.5 rounded-[10px] bg-ds-surface py-3 pl-3 pr-9 text-sm shadow-[0_0_0_1px_rgba(16,17,18,.06),0_8px_24px_-4px_rgba(16,17,18,.14),0_2px_6px_rgba(16,17,18,.06)]",
          icon:
            "!m-0 -mt-px grid !size-[22px] place-items-center rounded-[6px] bg-ds-surface shadow-[inset_0_0_0_1px_var(--ds-border)] text-ds-muted " +
            "group-data-[type=success]/toast:bg-ds-good-soft group-data-[type=success]/toast:text-ds-good group-data-[type=success]/toast:shadow-[inset_0_0_0_1px_#c9ead8] " +
            "group-data-[type=error]/toast:bg-ds-bad-soft group-data-[type=error]/toast:text-ds-bad group-data-[type=error]/toast:shadow-[inset_0_0_0_1px_#f6cfc8] " +
            "group-data-[type=warning]/toast:bg-ds-warn-soft group-data-[type=warning]/toast:text-ds-warn group-data-[type=warning]/toast:shadow-[inset_0_0_0_1px_#f5dcb5] " +
            "group-data-[type=info]/toast:bg-ds-accent-soft group-data-[type=info]/toast:text-ds-accent group-data-[type=info]/toast:shadow-[inset_0_0_0_1px_#cfdffc]",
          content: "col-start-2 min-w-0",
          title: "text-sm font-medium leading-5 text-ds-ink",
          description: "text-sm font-normal leading-5 !text-ds-muted",
          actionButton:
            "col-start-2 mt-2 inline-flex h-7 w-fit items-center rounded-ds-sm bg-ds-surface px-2 text-sm font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)] hover:bg-ds-hover",
          cancelButton:
            "col-start-2 mt-2 inline-flex h-7 w-fit items-center rounded-ds-sm bg-ds-surface px-2 text-sm text-ds-muted shadow-[inset_0_0_0_1px_var(--ds-border)] hover:bg-ds-hover",
          closeButton:
            "!absolute !left-auto !right-3 !top-3 !size-5 !translate-x-0 !translate-y-0 !transform !rounded-none !border-0 !bg-transparent !p-0 !opacity-100 !text-ds-faint hover:!bg-transparent hover:!text-ds-ink [&>svg]:!size-3.5",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
