/** STT provider interface — implementations added when voice is enabled */
export interface STTProvider {
	transcribe(audio: Buffer, options?: STTOptions): Promise<string>
}

export interface STTOptions {
	language?: string
	model?: string
}
