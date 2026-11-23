import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { SparkleIcon } from "@/components/icons";
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
        success: "bg-[var(--success)]/15 text-[var(--success)] border-transparent [a&]:hover:bg-[var(--success)]/25",
        warning: "bg-[var(--warning)]/15 text-[var(--warning)] border-transparent [a&]:hover:bg-[var(--warning)]/25",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/** Design System v2 (EDGEX-85). Exactly 4 kinds; good/bad/warn are plain coloured text in v2. */
const badgeV2Variants = cva("", {
  variants: {
    variant: {
      neutral:
        "rounded-ds-sm border border-ds-border bg-ds-sunken text-ds-text text-xs px-[9px] py-0.5",
      count:
        "inline-grid place-items-center min-w-5 h-5 px-1.5 rounded-ds-full bg-ds-bad-soft text-ds-bad text-[11.5px] font-semibold",
      ai: "inline-flex items-center gap-1 h-5 px-[7px] rounded-ds-xs bg-[image:var(--ds-ai-tint)] text-ds-ai text-[11px] font-medium [&>svg]:size-[11px]",
      preview:
        "inline-flex items-center h-5 px-[7px] rounded-ds-xs bg-ds-surface border border-ds-ai-line text-ds-ai text-[11px] font-medium",
    },
  },
  defaultVariants: { variant: "neutral" },
})

const PREVIEW_TITLE =
  "Written from your data by rules. Full AI explanations switch on with Orca"

type BadgeBaseProps = React.ComponentProps<"span"> & { asChild?: boolean }

type BadgeProps =
  | (BadgeBaseProps & VariantProps<typeof badgeVariants> & { look?: "legacy" })
  | (Omit<BadgeBaseProps, "variant"> & VariantProps<typeof badgeV2Variants> & { look: "v2" })

function Badge(props: BadgeProps) {
  if (props.look === "v2") {
    const { className, variant, asChild = false, look: _look, children, title, ...rest } = props
    void _look
    const Comp = asChild ? Slot.Root : "span"
    const kind = variant ?? "neutral"
    return (
      <Comp
        data-slot="badge"
        data-look="v2"
        data-variant={kind}
        title={kind === "preview" ? (title ?? PREVIEW_TITLE) : title}
        className={cn(badgeV2Variants({ variant: kind }), className)}
        {...rest}
      >
        {kind === "ai" && !asChild ? <SparkleIcon aria-hidden="true" /> : null}
        {children}
      </Comp>
    )
  }

  const { className, variant = "default", asChild = false, look: _look, ...rest } = props
  void _look
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...rest}
    />
  )
}

export { Badge, badgeVariants, badgeV2Variants }
