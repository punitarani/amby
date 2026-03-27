import type { Metadata } from "next"
import { redirect } from "next/navigation"

export const metadata: Metadata = {
	alternates: {
		canonical: "/",
	},
	description: "Amby's product thesis now lives directly on the homepage.",
	title: "Vision | AMBY",
}

export default function VisionPage() {
	redirect("/#model")
}
