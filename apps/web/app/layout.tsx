import type { Metadata } from "next"
import { Crimson_Pro, Instrument_Serif, Inter } from "next/font/google"

import { APP_URL } from "@/lib/app-url"

import "./globals.css"

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-inter",
})

const crimson = Crimson_Pro({
	subsets: ["latin"],
	weight: ["300", "400", "500", "600"],
	style: ["normal", "italic"],
	variable: "--font-crimson",
})

const instrument = Instrument_Serif({
	subsets: ["latin"],
	style: ["normal", "italic"],
	weight: "400",
	variable: "--font-instrument",
})

export const metadata: Metadata = {
	metadataBase: new URL(APP_URL),
	title: "AMBY | Personal Assistant Computer",
	description:
		"Amby is your personal assistant computer in the cloud, helping you remember, resume, and act across Telegram, email, and calendar.",
	alternates: {
		canonical: "/",
	},
	openGraph: {
		title: "AMBY | Personal Assistant Computer",
		description:
			"Amby is your personal assistant computer in the cloud, helping you remember, resume, and act across Telegram, email, and calendar.",
		url: APP_URL,
		siteName: "AMBY",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "AMBY | Personal Assistant Computer",
		description:
			"Amby is your personal assistant computer in the cloud, helping you remember, resume, and act across Telegram, email, and calendar.",
	},
}

type RootLayoutProps = Readonly<{
	children: React.ReactNode
}>

export default function RootLayout({ children }: RootLayoutProps) {
	return (
		<html className={`${inter.variable} ${crimson.variable} ${instrument.variable}`} lang="en">
			<body>{children}</body>
		</html>
	)
}
