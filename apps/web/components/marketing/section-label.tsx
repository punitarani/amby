import type { ComponentPropsWithoutRef, ReactNode } from "react"

import { cn } from "@/lib/cn"

type SectionLabelProps = ComponentPropsWithoutRef<"p"> & {
	children: ReactNode
}

export const SectionLabel = ({ children, className, ...props }: SectionLabelProps) => {
	return (
		<p className={cn("floating-label", className)} {...props}>
			{children}
		</p>
	)
}
