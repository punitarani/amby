/** TTS provider interface — implementations added when voice is enabled */
export interface TTSProvider {
	synthesize(text: string, options?: TTSOptions): Promise<Buffer>
}

export interface TTSOptions {
	voiceId?: string
	speed?: number
	language?: string
}
