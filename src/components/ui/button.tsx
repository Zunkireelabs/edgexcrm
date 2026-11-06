import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:border-blue-400",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20",
        outline:
          "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
        secondary:
          "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
        ghost:
          "hover:bg-gray-100 hover:text-gray-900",
        link: "text-[#2272B4] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-lg px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 rounded-lg gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-lg px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/** Design System v2 (EDGEX-85). Opt-in via `look="v2"`; lifted from Pulse `.btn`. */
const buttonV2Variants = cva(
  "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-ds-ink border-ds-ink text-white hover:bg-ds-ink/90",
        secondary: "bg-ds-surface border-ds-border text-ds-ink hover:bg-ds-hover",
        ghost:
          "bg-transparent border-transparent text-ds-muted hover:bg-ds-hover hover:text-ds-ink",
        link: "h-auto border-0 px-0 bg-transparent text-ds-accent hover:underline underline-offset-4",
        destructive: "bg-ds-surface border-ds-border text-ds-bad hover:bg-ds-bad-soft",
      },
      size: {
        default: "h-[30px] px-3",
        sm: "h-6 px-2",
        icon: "size-9 p-0",
      },
    },
    // The link variant ignores the size height/padding.
    compoundVariants: [
      { variant: "link", size: "default", class: "h-auto px-0" },
      { variant: "link", size: "sm", class: "h-auto px-0" },
    ],
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
)

/**
 * v2: a run of plain text/number children is wrapped in one `truncate` span so a long label ends in
 * "…" on the right instead of being clipped on both sides. Elements (icons) are left alone.
 */
function truncateText(children: React.ReactNode): React.ReactNode {
  const out: React.ReactNode[] = []
  let run: Array<string | number> = []
  const flush = () => {
    if (run.length) out.push(<span key={`t${out.length}`} className="truncate">{run.join("")}</span>)
    run = []
  }
  React.Children.forEach(children, (c) => {
    if (typeof c === "string" || typeof c === "number") run.push(c)
    else {
      flush()
      out.push(c)
    }
  })
  flush()
  return out
}

type ButtonBaseProps = React.ComponentProps<"button"> & { asChild?: boolean }

type ButtonProps =
  | (ButtonBaseProps &
      VariantProps<typeof buttonVariants> & {
        look?: "legacy"
      })
  | (Omit<ButtonBaseProps, "variant" | "size"> &
      VariantProps<typeof buttonV2Variants> & {
        look: "v2"
      })

function Button(props: ButtonProps) {
  if (props.look === "v2") {
    const { className, variant, size, asChild = false, look: _look, ...rest } = props
    void _look
    const Comp = asChild ? Slot.Root : "button"
    return (
      <Comp
        data-slot="button"
        data-look="v2"
        data-variant={variant ?? "secondary"}
        data-size={size ?? "default"}
        className={cn(buttonV2Variants({ variant, size }), className)}
        {...rest}
      >
        {asChild ? rest.children : truncateText(rest.children)}
      </Comp>
    )
  }

  const {
    className,
    variant = "default",
    size = "default",
    asChild = false,
    look: _look,
    ...rest
  } = props
  void _look
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...rest}
    />
  )
}

export { Button, buttonVariants, buttonV2Variants }
