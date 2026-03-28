import { spawnSync } from "node:child_process"
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

const require = createRequire(import.meta.url)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..")
const drizzleDir = resolve(packageRoot, "drizzle")
const configPath = resolve(packageRoot, "drizzle.config.ts")

const collectFiles = async (
	root: string,
	current = root,
	files = new Map<string, Buffer>(),
): Promise<Map<string, Buffer>> => {
	const entries = await readdir(current, { withFileTypes: true })

	for (const entry of entries) {
		const entryPath = join(current, entry.name)

		if (entry.isDirectory()) {
			await collectFiles(root, entryPath, files)
			continue
		}

		if (entry.isFile()) {
			files.set(relative(root, entryPath), await readFile(entryPath))
		}
	}

	return files
}

const diffDirectories = async (baselineDir: string, generatedDir: string): Promise<string[]> => {
	const baselineFiles = await collectFiles(baselineDir)
	const generatedFiles = await collectFiles(generatedDir)
	const differences: string[] = []
	const allPaths = new Set([...baselineFiles.keys(), ...generatedFiles.keys()])

	for (const filePath of [...allPaths].sort()) {
		const baseline = baselineFiles.get(filePath)
		const generated = generatedFiles.get(filePath)

		if (!baseline) {
			differences.push(`added ${filePath}`)
			continue
		}

		if (!generated) {
			differences.push(`removed ${filePath}`)
			continue
		}

		if (Buffer.compare(baseline, generated) !== 0) {
			differences.push(`changed ${filePath}`)
		}
	}

	return differences
}

const resolveDrizzleKitBin = (): string => {
	const packageJsonPath = require.resolve("drizzle-kit/package.json", { paths: [packageRoot] })
	return resolve(dirname(packageJsonPath), "bin.cjs")
}

const main = async () => {
	const tempRoot = await mkdtemp(join(tmpdir(), "amby-drizzle-check-"))
	const generatedDir = join(tempRoot, "drizzle")
	const tempConfigPath = join(tempRoot, "drizzle.generate.config.ts")

	try {
		await cp(drizzleDir, generatedDir, { recursive: true })
		await writeFile(
			tempConfigPath,
			[
				`import baseConfig from ${JSON.stringify(pathToFileURL(configPath).href)}`,
				"",
				"export default {",
				"\t...baseConfig,",
				`\tout: ${JSON.stringify(generatedDir)},`,
				"}",
				"",
			].join("\n"),
		)

		const result = spawnSync(
			process.execPath,
			[resolveDrizzleKitBin(), "generate", `--config=${tempConfigPath}`],
			{
				cwd: packageRoot,
				encoding: "utf8",
				env: process.env,
			},
		)

		if (result.status !== 0) {
			process.stderr.write(result.stdout)
			process.stderr.write(result.stderr)
			throw new Error(`drizzle-kit generate failed with exit code ${result.status ?? 1}`)
		}

		const differences = await diffDirectories(drizzleDir, generatedDir)

		if (differences.length > 0) {
			console.error("Drizzle schema changes are not fully captured in committed migrations.")
			console.error("Run `bun run db:generate` from `packages/db` and commit the generated files.")
			console.error("")
			console.error("Differences:")

			for (const difference of differences.slice(0, 20)) {
				console.error(`- ${difference}`)
			}

			if (differences.length > 20) {
				console.error(`- ...and ${differences.length - 20} more`)
			}

			process.exitCode = 1
			return
		}

		console.log("Drizzle migrations are in sync with the schema.")
	} finally {
		await rm(tempRoot, { recursive: true, force: true })
	}
}

await main()
