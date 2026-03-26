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
				"visual-placeholder relative overflow-hidden rounded-[2.2rem] border border-white/10 bg-background-elevated",
				className,
			)}
		>
			<Image
				alt={alt}
				className={cn("object-cover brightness-[0.74] saturate-0", imageClassName)}
				fill
				priority={priority}
				sizes={sizes}
				src={src}
			/>
			<div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03)_30%,rgba(5,5,6,0.52)_100%)]" />
		</div>
	)
}
