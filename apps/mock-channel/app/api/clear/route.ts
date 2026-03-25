import { NextResponse } from "next/server"
import { clearStore } from "../../../lib/message-store"
import { getEmitter } from "../../../lib/sse-emitter"

export async function POST() {
	clearStore()
	getEmitter().broadcast("clear", {})
	return NextResponse.json({ ok: true })
}
