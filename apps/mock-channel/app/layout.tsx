import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
	title: "Mock Telegram Channel",
	description: "Dev-only mock Telegram channel for local testing",
}

export default function RootLayout({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<html lang="en" className="dark">
			<body className="bg-neutral-950 text-neutral-100 antialiased">
				{children}
			</body>
		</html>
	)
}
