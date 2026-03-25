/**
 * Execution budget configuration passed top-down from the composition root.
 */
export interface ExecutionBudgets {
	readonly maxConversationSteps: number
	readonly maxSubagentStepsByKind: Record<string, number>
	readonly maxParallelAgents: number
	readonly maxToolCallsPerRun: number
	readonly maxLatencyMs?: number
}

export const defaultBudgets: ExecutionBudgets = {
	maxConversationSteps: 8,
	maxSubagentStepsByKind: {
		conversation: 8,
		planner: 3,
		research: 8,
		builder: 10,
		integration: 10,
		computer: 16,
		browser: 24,
		memory: 5,
		settings: 6,
		validator: 4,
	},
	maxParallelAgents: 3,
	maxToolCallsPerRun: 50,
}
