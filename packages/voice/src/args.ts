export const getFlag = (flag: string) => {
	const index = process.argv.indexOf(flag)
	if (index === -1) return undefined
	const value = process.argv[index + 1]
	if (!value || value.startsWith("--")) return undefined
	return value
}

export const requireFlag = (flag: string) => {
	const value = getFlag(flag)
	if (!value) throw new Error(`Missing required ${flag} flag.`)
	return value
}
