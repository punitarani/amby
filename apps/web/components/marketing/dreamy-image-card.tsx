import Image from "next/image"

import { cn } from "@/lib/cn"

type DreamyImageCardProps = {
	alt: string
	className?: string
	imageClassName?: string
	priority?: boolean
	sizes: string
	src: string
}

export const DreamyImageCard = ({
	alt,
	className,
	imageClassName,
	priority = false,
	sizes,
	src,
}: DreamyImageCardProps) => {
	return (
		<div
			className={cn(
				"visual-placeholder relative overflow-hidden rounded-[2.2rem] border border-foreground/10 bg-background-elevated shadow-[0_30px_82px_-54px_rgba(70,82,72,0.52)]",
				className,
			)}
		>
			<Image
				alt={alt}
				className={cn("object-cover", imageClassName)}
				fill
				priority={priority}
				sizes={sizes}
				src={src}
			/>
			<div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03)_36%,rgba(36,42,35,0.03))]" />
		</div>
	)
}
