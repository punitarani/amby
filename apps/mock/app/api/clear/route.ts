import { NextResponse } from "next/server"
import { clearMessages, clearRequestLog } from "../../../lib/message-store"

export async function POST() {
	clearMessages()
	clearRequestLog()
	return NextResponse.json({ ok: true })
}
