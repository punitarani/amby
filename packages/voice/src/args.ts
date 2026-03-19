export const getFlag = (flag: string) => {
	const index = process.argv.indexOf(flag)
	if (index === -1) return undefined

	return process.argv[index + 1]
}

export const requireFlag = (flag: string) => {
	const value = getFlag(flag)
	if (!value) throw new Error(`Missing required ${flag} flag.`)
	return value
}
