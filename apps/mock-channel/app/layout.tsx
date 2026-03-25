import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
	title: "Mock Channel — Amby Dev",
	description: "Dev-only Telegram channel emulator for local testing",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body className="bg-neutral-950 text-neutral-100 antialiased">{children}</body>
		</html>
	)
}
