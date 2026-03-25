import { NextResponse } from "next/server"
import { getMessages, getRequestLog } from "../../../lib/message-store"

export async function GET() {
	return NextResponse.json({
		messages: getMessages(),
		requestLog: getRequestLog(),
	})
}
