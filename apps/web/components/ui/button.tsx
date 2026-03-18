import type * as React from "react"

import { cn } from "@/lib/cn"

type ButtonLinkProps = {
	children: React.ReactNode
	className?: string
	variant?: "primary" | "secondary"
} & { href: string } & React.ComponentPropsWithoutRef<"a">

type ButtonElementProps = {
	children: React.ReactNode
	className?: string
	variant?: "primary" | "secondary"
} & { href?: never } & React.ComponentPropsWithoutRef<"button">

type ButtonProps = ButtonLinkProps | ButtonElementProps

const sharedClassName =
	"inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-[0.68rem] font-sans font-semibold tracking-[0.28em] uppercase transition duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50"

export const Button = ({ className, variant = "primary", ...props }: ButtonProps) => {
	const buttonClassName = cn(
		sharedClassName,
		variant === "primary"
			? "border border-primary bg-primary text-background shadow-[0_18px_45px_-18px_rgba(141,160,142,0.85)] hover:bg-primary/90"
			: "border border-foreground/10 bg-background-elevated text-foreground hover:bg-panel-soft",
		className,
	)

	if ("href" in props && props.href) {
		const { href, ...anchorProps } = props

		return <a className={buttonClassName} href={href} {...anchorProps} />
	}

	const { type = "button", ...buttonProps } = props as ButtonElementProps

	return <button className={buttonClassName} type={type} {...buttonProps} />
}
