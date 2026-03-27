/**
 * @deprecated This module has been renamed to ./run-metadata.
 * All exports are re-exported here for backward compatibility.
 */
export {
	type AgentRunMetadata as AgentTraceMetadata,
	buildAgentRunMetadata as buildAgentTraceMetadata,
	buildRequestRunMetadata as buildRequestTraceMetadata,
	buildRootRunMetadata as buildRootTraceMetadata,
	buildTaskRunMetadata as buildTaskTraceMetadata,
	normalizeRunEnvironment as normalizeTraceEnvironment,
	type RequestRunMetadata as RequestTraceMetadata,
	type RunEnvironment as TraceEnvironment,
} from "./run-metadata"
