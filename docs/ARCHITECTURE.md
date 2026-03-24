# Amby Architecture

Amby is a cloud-native assistant runtime, not a thin chat wrapper.

The system has five stable layers:
1. **Channels** receive user input and deliver output.
2. **Agent runtime** resolves context, plans work, and synthesizes responses.
3. **Execution runtime** runs specialist work across browser, sandbox, and integration surfaces.
4. **Persistence** stores transcript, execution traces, durable tasks, compute state, jobs, and memory.
5. **Provisioning and workflow infrastructure** manages long-running execution and per-user compute.

The architecture is built around one core principle:

> The user interacts with one assistant, while the system internally separates conversation, execution, and infrastructure state.

That separation is now real in code. It is not just a design intention.

## System model

Amby currently operates as a Telegram-first cloud runtime, with a reusable channel abstraction at the package layer.

The deployed flow is:
- Telegram webhook enters a Cloudflare Worker.
- A queue decouples inbound delivery from processing.
- A Durable Object buffers and debounces per-chat input.
- A Workflow runs the agent durably.
- The agent may answer directly or execute a specialist plan.
- Specialist execution may be inline, parallel, or background.
- Persistent state is written to Postgres throughout the flow.

## Architectural boundaries

### 1. Channels are transport, not intelligence
Channels do not own reasoning, planning, or memory. They only move messages in and out.

### 2. The agent owns user-facing coherence
The agent decides how to respond, what context matters, when to plan specialist work, and how results are presented back to the user.

### 3. Execution is separate from transcript
Visible conversation history is stored separately from tool and task execution.

### 4. Compute is volume-first
A user's persistent computer state lives on a Daytona volume. Sandboxes are disposable runtimes mounted onto that volume.

### 5. Long-running work is durable
Background work is represented as durable tasks with event logs and trace links. It is not hidden inside one transient LLM call.

## Canonical component diagram

```mermaid
flowchart TD
    User[User] --> TG[Telegram / Future channels]

    subgraph Edge[Cloudflare Edge Runtime]
        Webhook[Webhook Handler]
        Queue[Queue]
        DO[ConversationSession Durable Object]
        WF[AgentExecutionWorkflow]
        SWF[SandboxProvisionWorkflow]
        VWF[VolumeProvisionWorkflow]
    end

    TG --> Webhook
    Webhook --> Queue
    Queue --> DO
    DO --> WF
    WF --> Agent
    WF --> TG

    subgraph Core[Application Core]
        Agent[AgentService]
        Context[Thread + memory context builder]
        Planner[Execution planner]
        Coordinator[Execution coordinator]
        Browser[BrowserService]
        Sandbox[SandboxService]
        Supervisor[TaskSupervisor]
        Connectors[ConnectorsService]
        ChannelsPkg[@amby/channels]
    end

    Agent --> Context
    Agent --> Planner
    Planner --> Coordinator
    Coordinator --> Browser
    Coordinator --> Sandbox
    Coordinator --> Supervisor
    Coordinator --> Connectors
    Agent --> ChannelsPkg

    subgraph Data[Postgres / durable state]
        Conversations[(conversations)]
        Threads[(conversation_threads)]
        Messages[(messages)]
        Traces[(traces)]
        TraceEvents[(trace_events)]
        Tasks[(tasks)]
        TaskEvents[(task_events)]
        Jobs[(jobs)]
        Memories[(memories)]
        Volumes[(user_volumes)]
        Sandboxes[(sandboxes)]
    end

    Agent --> Conversations
    Agent --> Threads
    Agent --> Messages
    Agent --> Traces
    Agent --> TraceEvents
    Coordinator --> Tasks
    Coordinator --> TaskEvents
    Agent --> Jobs
    Agent --> Memories
    Sandbox --> Volumes
    Sandbox --> Sandboxes
    SWF --> Volumes
    SWF --> Sandboxes
    VWF --> Volumes

    subgraph Compute[Daytona]
        Volume[Per-user volume]
        MainSandbox[Main sandbox]
    end

    Volumes --> Volume
    Sandboxes --> MainSandbox
    MainSandbox --> Volume
```

## Current package map

```mermaid
graph BT
    env[@amby/env]
    db[@amby/db] --> env
    channels[@amby/channels]
    models[@amby/models] --> env
    memory[@amby/memory] --> db
    computer[@amby/computer] --> db
    computer --> env
    agent[@amby/agent] --> db
    agent --> memory
    agent --> models
    agent --> computer
    agent --> channels
    api[apps/api] --> agent
    api --> channels
    api --> computer
```

## Runtime shape

There are now three execution modes in practice:

### Direct response
The conversation agent responds without specialist execution.

### Planned specialist execution
The conversation agent uses `execute_plan`, which builds a task plan and executes specialist work inline when appropriate.

### Durable background execution
The execution runtime hands work off to background task infrastructure, persists task state, and allows later inspection via `query_execution` and task tooling.

## What is actually true in the current code

These statements should appear in the page because they match the implementation:

- The top-level conversation loop exposes **`search_memories`**, **`send_message`**, **`execute_plan`**, and **`query_execution`** as direct tools.
- The system no longer primarily revolves around user-visible `delegate_*` tools as the core abstraction.
- Specialist execution is now mediated by a planner/coordinator/registry model.
- Execution state is persisted across **`traces`**, **`trace_events`**, **`tasks`**, and **`task_events`**.
- Sandboxes are not the persistence boundary; **volumes** are.
- Telegram processing is durable and message-batched via Queue + Durable Object + Workflow.

## Near-future architectural direction

These are the right abstractions to document because they match both current code and near-future intent:

- **More channels, same agent core.** Telegram is first; the transport abstraction should remain stable as more channels are added.
- **More specialist depth.** The current policy caps depth at 1, but the trace/task model already leaves room for nested specialist execution later.
- **Multiple sandboxes per user.** The schema already distinguishes sandbox role and keeps volume ownership separate.
- **Stronger execution introspection.** Task and trace data are already separated cleanly enough to support better audit views, retry surfaces, and operator tooling.
- **Richer native threading.** The thread resolver already accepts platform-native thread context even though current Telegram and CLI flows use derived routing.

## Open questions

1. Should the canonical architecture doc explicitly describe **browser** as first-class alongside **sandbox** and **computer**, or keep browser under "execution runtime" to avoid overfitting to one provider?
2. Should the long-term channel abstraction include platform-native thread identifiers in the formal channel contract now, instead of leaving that only in the thread resolver API?
3. Should jobs remain a separate scheduling primitive, or should all long-running or scheduled work unify under the durable task model?
