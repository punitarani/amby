import type { ComponentPropsWithoutRef, ReactNode } from "react"

import { cn } from "@/lib/cn"

type ActionLinkProps = ComponentPropsWithoutRef<"a"> & {
	children: ReactNode
	size?: "compact" | "default" | "large"
	variant?: "primary" | "secondary"
}

const sizeClassNames = {
	compact: "gap-1.5 whitespace-nowrap px-4 py-2 text-[0.58rem] tracking-[0.18em] sm:px-5",
	default: "gap-1.5 whitespace-nowrap px-5 py-2.5 text-[0.61rem] tracking-[0.19em] sm:px-6 sm:py-3",
	large: "gap-1.5 whitespace-nowrap px-6 py-3 text-[0.63rem] tracking-[0.19em] sm:px-7 sm:py-3.5",
} as const

export const MarketingActionLink = ({
	children,
	className,
	size = "default",
	variant = "primary",
	...props
}: ActionLinkProps) => {
	return (
		<a
			className={cn(
				"inline-flex items-center justify-center rounded-full border font-sans font-semibold uppercase transition duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
				sizeClassNames[size],
				variant === "primary"
					? "border-primary bg-primary text-background shadow-[0_12px_30px_-18px_rgba(141,160,142,0.84)] hover:bg-primary/92"
					: "border-foreground/12 bg-background-elevated text-foreground hover:bg-panel-soft",
				className,
			)}
			{...props}
		>
			{children}
		</a>
	)
}
