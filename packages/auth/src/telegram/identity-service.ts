import { and, type Database, eq, schema } from "@amby/db"
import { Context } from "effect"
import { TELEGRAM_PROVIDER_ID } from "./constants"
import {
	canSafelyUnlinkTelegram,
	getTelegramLinkConflict,
	resolveTelegramSignInDisposition,
} from "./identity-policy"
import type { TelegramIdentityProfile, TelegramProvisionInput } from "./types"

type UserInsert = typeof schema.users.$inferInsert
type AccountInsert = typeof schema.accounts.$inferInsert

type DbExecutor = Pick<Database, "delete" | "insert" | "select" | "update">

export type TelegramSignInState =
	| { status: "allowed" }
	| { status: "blocked"; telegramUserId: string; lastUserId: string | null }

type TelegramSignInResult =
	| { status: "blocked"; telegramUserId: string; lastUserId: string | null }
	| { status: "signed-in"; userId: string; created: boolean }

export interface TelegramIdentityServiceApi {
	provisionFromBot(
		input: TelegramProvisionInput,
	): Promise<
		| { status: "blocked"; telegramUserId: string }
		| { status: "provisioned"; userId: string; created: boolean }
	>
	getSignInState(telegramUserId: string): Promise<TelegramSignInState>
	signInOrCreate(
		input: TelegramProvisionInput & { rememberMe?: boolean },
	): Promise<TelegramSignInResult>
	linkToUser(
		userId: string,
		input: TelegramProvisionInput,
	): Promise<{ userId: string; linked: boolean }>
	unlinkFromUser(userId: string): Promise<{ telegramUserId: string }>
	getTelegramChatIdByUserId(userId: string): Promise<number | null>
}

export class TelegramIdentityService extends Context.Tag("TelegramIdentityService")<
	TelegramIdentityService,
	TelegramIdentityServiceApi
>() {}

const inferTimezoneFromLanguageCode = (code?: string | null): string | undefined => {
	if (!code) return undefined
	const map: Record<string, string> = {
		"en-US": "America/New_York",
		"en-GB": "Europe/London",
		"en-AU": "Australia/Sydney",
		de: "Europe/Berlin",
		fr: "Europe/Paris",
		es: "Europe/Madrid",
		it: "Europe/Rome",
		pt: "America/Sao_Paulo",
		"pt-BR": "America/Sao_Paulo",
		ru: "Europe/Moscow",
		ja: "Asia/Tokyo",
		ko: "Asia/Seoul",
		zh: "Asia/Shanghai",
		"zh-TW": "Asia/Taipei",
		ar: "Asia/Riyadh",
		hi: "Asia/Kolkata",
		tr: "Europe/Istanbul",
		pl: "Europe/Warsaw",
		nl: "Europe/Amsterdam",
		uk: "Europe/Kyiv",
		th: "Asia/Bangkok",
		vi: "Asia/Ho_Chi_Minh",
		id: "Asia/Jakarta",
		sv: "Europe/Stockholm",
		da: "Europe/Copenhagen",
		fi: "Europe/Helsinki",
		nb: "Europe/Oslo",
		he: "Asia/Jerusalem",
	}
	const base = code.split("-")[0]
	return map[code] ?? (base ? map[base] : undefined)
}

const toTelegramUserId = (profile: TelegramIdentityProfile) => profile.id.trim()

const toDisplayName = (profile: TelegramIdentityProfile) =>
	[profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() ||
	profile.username?.trim() ||
	"Telegram User"

const buildAccountMetadata = (input: TelegramProvisionInput): Record<string, unknown> => ({
	firstName: input.profile.firstName,
	lastName: input.profile.lastName ?? null,
	languageCode: input.profile.languageCode ?? null,
	isPremium: input.profile.isPremium ?? false,
	photoUrl: input.profile.photoUrl ?? null,
	username: input.profile.username ?? null,
	lastSource: input.source,
})

const parseTelegramChatId = (value: string | null | undefined) => {
	if (!value) return null
	const parsed = Number.parseInt(value, 10)
	return Number.isFinite(parsed) ? parsed : null
}

const findAccountByTelegramUserId = async (db: DbExecutor, telegramUserId: string) => {
	const rows = await db
		.select({
			id: schema.accounts.id,
			userId: schema.accounts.userId,
			telegramChatId: schema.accounts.telegramChatId,
		})
		.from(schema.accounts)
		.where(
			and(
				eq(schema.accounts.providerId, TELEGRAM_PROVIDER_ID),
				eq(schema.accounts.accountId, telegramUserId),
			),
		)
		.limit(1)
	return rows[0] ?? null
}

const findTelegramAccountByUserId = async (db: DbExecutor, userId: string) => {
	const rows = await db
		.select({
			id: schema.accounts.id,
			accountId: schema.accounts.accountId,
			userId: schema.accounts.userId,
		})
		.from(schema.accounts)
		.where(
			and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, TELEGRAM_PROVIDER_ID)),
		)
		.limit(1)
	return rows[0] ?? null
}

const findIdentityBlock = async (db: DbExecutor, telegramUserId: string) => {
	const rows = await db
		.select({
			telegramUserId: schema.telegramIdentityBlocks.telegramUserId,
			lastUserId: schema.telegramIdentityBlocks.lastUserId,
		})
		.from(schema.telegramIdentityBlocks)
		.where(eq(schema.telegramIdentityBlocks.telegramUserId, telegramUserId))
		.limit(1)
	return rows[0] ?? null
}

const getTelegramSignInState = async (
	db: DbExecutor,
	telegramUserId: string,
	options?: { hasExistingAccount?: boolean },
): Promise<TelegramSignInState> => {
	const block = await findIdentityBlock(db, telegramUserId)
	const disposition = resolveTelegramSignInDisposition({
		hasExistingAccount: options?.hasExistingAccount ?? false,
		hasIdentityBlock: Boolean(block),
	})

	if (disposition === "blocked") {
		return {
			status: "blocked",
			telegramUserId,
			lastUserId: block?.lastUserId ?? null,
		}
	}

	return { status: "allowed" }
}

const clearIdentityBlock = async (db: DbExecutor, telegramUserId: string) => {
	await db
		.delete(schema.telegramIdentityBlocks)
		.where(eq(schema.telegramIdentityBlocks.telegramUserId, telegramUserId))
}

const updateUserFromTelegram = async (
	db: DbExecutor,
	userId: string,
	input: TelegramProvisionInput,
	options?: { setEmailOnEmpty?: boolean },
) => {
	const currentRows = await db
		.select({
			name: schema.users.name,
			email: schema.users.email,
		})
		.from(schema.users)
		.where(eq(schema.users.id, userId))
		.limit(1)
	const currentUser = currentRows[0]

	const patch: Partial<UserInsert> = {
		telegramUsername: input.profile.username ?? null,
		updatedAt: new Date(),
	}

	if (input.profile.phoneNumber !== undefined) {
		patch.telegramPhoneNumber = input.profile.phoneNumber ?? null
	}
	if (!currentUser?.name?.trim()) {
		patch.name = toDisplayName(input.profile)
	}
	if (!currentUser?.email && options?.setEmailOnEmpty && input.profile.email) {
		patch.email = input.profile.email
		patch.emailVerified = input.profile.emailVerified ?? false
	}

	await db.update(schema.users).set(patch).where(eq(schema.users.id, userId))
}

const updateAccountFromTelegram = async (
	db: DbExecutor,
	accountId: string,
	input: TelegramProvisionInput,
) => {
	const patch: Partial<AccountInsert> = {
		metadata: buildAccountMetadata(input),
		updatedAt: new Date(),
	}
	if (input.chatId !== undefined) {
		patch.telegramChatId = input.chatId ?? null
	}
	await db.update(schema.accounts).set(patch).where(eq(schema.accounts.id, accountId))
}

const createUserFromTelegram = (
	profile: TelegramIdentityProfile,
	options?: { setEmail?: boolean },
): UserInsert => ({
	id: crypto.randomUUID(),
	name: toDisplayName(profile),
	timezone: inferTimezoneFromLanguageCode(profile.languageCode) ?? "UTC",
	telegramUsername: profile.username ?? null,
	telegramPhoneNumber: profile.phoneNumber ?? null,
	...(options?.setEmail && profile.email
		? {
				email: profile.email,
				emailVerified: profile.emailVerified ?? false,
			}
		: {}),
})

const createAccountFromTelegram = (
	userId: string,
	input: TelegramProvisionInput,
): AccountInsert => ({
	id: crypto.randomUUID(),
	userId,
	accountId: toTelegramUserId(input.profile),
	providerId: TELEGRAM_PROVIDER_ID,
	telegramChatId: input.chatId ?? null,
	metadata: buildAccountMetadata(input),
})

const createIdentityBlock = async (db: DbExecutor, telegramUserId: string, userId: string) => {
	await db
		.insert(schema.telegramIdentityBlocks)
		.values({
			telegramUserId,
			lastUserId: userId,
			reason: "unlink",
		})
		.onConflictDoUpdate({
			target: schema.telegramIdentityBlocks.telegramUserId,
			set: {
				lastUserId: userId,
				reason: "unlink",
				updatedAt: new Date(),
			},
		})
}

export const createTelegramIdentityService = (db: Database): TelegramIdentityServiceApi => ({
	async getSignInState(telegramUserId) {
		return getTelegramSignInState(db, telegramUserId)
	},

	async provisionFromBot(input) {
		const telegramUserId = toTelegramUserId(input.profile)
		const existingAccount = await findAccountByTelegramUserId(db, telegramUserId)
		if (existingAccount) {
			await Promise.all([
				updateUserFromTelegram(db, existingAccount.userId, input),
				updateAccountFromTelegram(db, existingAccount.id, input),
			])
			return {
				status: "provisioned",
				userId: existingAccount.userId,
				created: false,
			}
		}

		const block = await findIdentityBlock(db, telegramUserId)
		if (block) {
			return {
				status: "blocked",
				telegramUserId,
			}
		}

		try {
			return await db.transaction(async (tx) => {
				const executor: DbExecutor = tx
				const recheck = await findAccountByTelegramUserId(executor, telegramUserId)
				if (recheck) {
					await Promise.all([
						updateUserFromTelegram(executor, recheck.userId, input),
						updateAccountFromTelegram(executor, recheck.id, input),
					])
					return {
						status: "provisioned" as const,
						userId: recheck.userId,
						created: false,
					}
				}

				const user = createUserFromTelegram(input.profile)
				await tx.insert(schema.users).values(user)
				await tx.insert(schema.accounts).values(createAccountFromTelegram(user.id, input))

				return {
					status: "provisioned" as const,
					userId: user.id,
					created: true,
				}
			})
		} catch (error) {
			const retried = await findAccountByTelegramUserId(db, telegramUserId)
			if (retried) {
				await Promise.all([
					updateUserFromTelegram(db, retried.userId, input),
					updateAccountFromTelegram(db, retried.id, input),
				])
				return {
					status: "provisioned",
					userId: retried.userId,
					created: false,
				}
			}
			throw error
		}
	},

	async signInOrCreate(input) {
		const telegramUserId = toTelegramUserId(input.profile)
		const existingAccount = await findAccountByTelegramUserId(db, telegramUserId)
		if (existingAccount) {
			// An active linked account takes precedence over a stale identity block (tombstone).
			// Browser sign-in to an already-linked account clears the block as a side effect.
			await Promise.all([
				clearIdentityBlock(db, telegramUserId),
				updateUserFromTelegram(db, existingAccount.userId, input, {
					setEmailOnEmpty: true,
				}),
				updateAccountFromTelegram(db, existingAccount.id, input),
			])
			return { status: "signed-in", userId: existingAccount.userId, created: false }
		}

		const signInState = await getTelegramSignInState(db, telegramUserId)
		if (signInState.status === "blocked") {
			return signInState
		}

		try {
			return await db.transaction(async (tx) => {
				const executor: DbExecutor = tx
				const recheck = await findAccountByTelegramUserId(executor, telegramUserId)
				if (recheck) {
					await Promise.all([
						updateUserFromTelegram(executor, recheck.userId, input, {
							setEmailOnEmpty: true,
						}),
						updateAccountFromTelegram(executor, recheck.id, input),
					])
					return { status: "signed-in" as const, userId: recheck.userId, created: false }
				}

				const recheckSignInState = await getTelegramSignInState(executor, telegramUserId)
				if (recheckSignInState.status === "blocked") {
					return recheckSignInState
				}

				const user = createUserFromTelegram(input.profile, { setEmail: true })
				await tx.insert(schema.users).values(user)
				await tx.insert(schema.accounts).values(createAccountFromTelegram(user.id, input))
				return { status: "signed-in" as const, userId: user.id, created: true }
			})
		} catch (error) {
			const retried = await findAccountByTelegramUserId(db, telegramUserId)
			if (retried) {
				await Promise.all([
					updateUserFromTelegram(db, retried.userId, input, {
						setEmailOnEmpty: true,
					}),
					updateAccountFromTelegram(db, retried.id, input),
				])
				return { status: "signed-in", userId: retried.userId, created: false }
			}

			const retriedSignInState = await getTelegramSignInState(db, telegramUserId)
			if (retriedSignInState.status === "blocked") {
				return retriedSignInState
			}
			throw error
		}
	},

	async linkToUser(userId, input) {
		const telegramUserId = toTelegramUserId(input.profile)
		const existingAccount = await findAccountByTelegramUserId(db, telegramUserId)
		if (existingAccount) {
			if (existingAccount.userId !== userId) {
				throw new Error("Telegram account is already linked to another user")
			}
			await Promise.all([
				clearIdentityBlock(db, telegramUserId),
				updateUserFromTelegram(db, userId, input, {
					setEmailOnEmpty: true,
				}),
				updateAccountFromTelegram(db, existingAccount.id, input),
			])
			return { userId, linked: false }
		}

		const currentTelegramAccount = await findTelegramAccountByUserId(db, userId)
		const conflict = getTelegramLinkConflict({
			existingLinkedUserId: null,
			currentUserId: userId,
			currentUserTelegramId: currentTelegramAccount?.accountId ?? null,
			nextTelegramUserId: telegramUserId,
		})
		if (conflict === "telegram-linked-to-other-user") {
			throw new Error("Telegram account is already linked to another user")
		}
		if (conflict === "current-user-has-different-telegram") {
			throw new Error("Current user already has a different Telegram account linked")
		}

		await db.transaction(async (tx) => {
			const executor: DbExecutor = tx
			// Recheck for a concurrent insert of the same Telegram account inside the
			// transaction so a race produces a clean error instead of a raw constraint violation.
			const raceCheck = await findAccountByTelegramUserId(executor, telegramUserId)
			if (raceCheck) {
				throw new Error("Telegram account is already linked to another user")
			}
			await clearIdentityBlock(executor, telegramUserId)
			await updateUserFromTelegram(executor, userId, input, {
				setEmailOnEmpty: true,
			})
			await tx.insert(schema.accounts).values(createAccountFromTelegram(userId, input))
		})
		return { userId, linked: true }
	},

	async unlinkFromUser(userId) {
		const account = await findTelegramAccountByUserId(db, userId)
		if (!account) {
			throw new Error("Telegram is not linked to this user")
		}

		await db.transaction(async (tx) => {
			const executor: DbExecutor = tx
			// Account count check inside the transaction to prevent a TOCTOU race where
			// a concurrent unlink of another auth method could leave the user with zero methods.
			const accountCountRows = await executor
				.select({ id: schema.accounts.id })
				.from(schema.accounts)
				.where(eq(schema.accounts.userId, userId))
				.limit(2)
			if (!canSafelyUnlinkTelegram(accountCountRows.length)) {
				throw new Error("Telegram cannot be unlinked because it is the only auth method")
			}
			await executor.delete(schema.accounts).where(eq(schema.accounts.id, account.id))
			await executor
				.update(schema.users)
				.set({
					telegramUsername: null,
					telegramPhoneNumber: null,
					updatedAt: new Date(),
				})
				.where(eq(schema.users.id, userId))
			await createIdentityBlock(executor, account.accountId, userId)
		})

		return { telegramUserId: account.accountId }
	},

	async getTelegramChatIdByUserId(userId) {
		const rows = await db
			.select({ telegramChatId: schema.accounts.telegramChatId })
			.from(schema.accounts)
			.where(
				and(
					eq(schema.accounts.userId, userId),
					eq(schema.accounts.providerId, TELEGRAM_PROVIDER_ID),
				),
			)
			.limit(1)
		return parseTelegramChatId(rows[0]?.telegramChatId)
	},
})
