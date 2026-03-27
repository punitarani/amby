# Vision
**Ambient intelligence that lives with you — across every app, every device, everywhere.**

Amby is a personal assistant computer that runs continuously in the cloud. It keeps a living understanding of what you care about, carries context across every device and channel, runs work while you're offline, and surfaces results at the right moment. You don't open an AI app and paste context. You have a persistent computing layer that knows you, acts on your behalf, and gets smarter over time.

Long-term, Amby extends beyond screens into the physical world: small, efficient, privacy-preserving hardware devices throughout your home and life — ambient nodes that listen on command, relay to your cloud brain, and bring intelligence to every surface you interact with.

---

# Mission
**Give every person a single, trustworthy control plane for their digital life — one that any AI service can plug into, and that works across every app, device, and environment they use.**

Today, intelligence is fragmented. You use ChatGPT for one thing, Claude for another, Cursor for code, Google for search, and none of them share context. Each interaction starts from zero. Each tool is a silo. The person — the one who actually owns the context — has no center of gravity.

Amby is that center of gravity. A cloud-native compute stack that acts as your **single source of truth**: your memory, your preferences, your files, your permissions, your active projects. Other AI services — OpenAI, Anthropic, Cursor, or any future agent — connect *to Amby* rather than each owning a fragment of your life. This inverts the current model where platforms own your data and context. In Amby's model, *you* own the stack, and services are interchangeable tools that plug in.

This is not an "AI wrapper." It is personal infrastructure — a virtual computer that houses everything relevant to *you*, and exposes it in a way that agents can act on efficiently, with your permission, on your behalf.

---

# Why Now
Three things are converging that make this the right moment:

**AI adoption is mainstream, but trust is not.** Over half of U.S. adults use generative AI, yet half say they're more concerned than excited about its role in daily life. The opening is to build the version of "always-on AI" that people can actually trust — with clear permissions, memory boundaries, and audit trails.

**Agent platforms are standardizing.** OpenAI, Anthropic, and others are shipping background execution, tool use, and sandboxed environments. The infrastructure to build a durable personal compute layer now exists. Amby doesn't need to invent the model layer — it needs to own the orchestration and trust layer.

**No one owns the cross-platform problem.** Apple, Google, and Amazon each build for lock-in within their ecosystems. Open-source tools solve self-hosting but not consumer trust or simplicity. Messaging-first assistants solve single workflows but not the whole life. Amby's whitespace is a managed, portable, trustworthy personal compute layer that works *across* all of them.

---

# How It Works
Amby has three layers, each building on the one below:

## Layer 1 → Personal Cloud Computer
A persistent cloud workspace that is always on. This is Amby's core: a long-running compute environment with durable memory, file storage, and execution capabilities. It runs background tasks, maintains conversation threads, and keeps a living profile of the user — all in a single, user-owned environment.

The key mental model: **"Like having a great assistant who has their own computer."** You tell them what you need; they do the work in the background; they come back with a ready-to-approve result.

## Layer 2 → Universal Agent Interface
Amby becomes the interoperability layer between the user and every AI service they use. Rather than each service holding a fragment of your context, Amby provides a standardized way for external agents — Claude Code, Cursor, ChatGPT, or any MCP-compatible service — to access the user's context, memory, and tools with explicit permission. Amby is the control plane; AI services are the executors.

This means: when you use Cursor, it can pull your project context from Amby. When ChatGPT drafts an email, it knows your communication preferences because Amby provides them. When a new AI tool launches next year, it plugs into Amby on day one instead of starting from scratch.

## Layer 3 → Ambient Hardware
Small, efficient, privacy-preserving devices — think reimagined Echo/Google Home form factors — distributed throughout your home and life. These are ambient nodes: they listen on command (not always), relay to your Amby cloud brain, and bring the full power of your personal compute stack into the physical world. Voice becomes one more channel, alongside messaging, web, and API.

The critical difference from existing smart speakers: these devices don't send your data to a platform that monetizes it. They connect to *your* Amby stack, run through *your* permission model, and the intelligence lives in *your* cloud — not theirs.

---

# Principles
**User-owned, not platform-owned.** Amby is personal infrastructure. The user's memory, context, and preferences belong to them. AI services plug in; they don't extract.

**Trust is the product.** Clear permissions, reviewable memory, audit trails, and explicit approval before actions. If people don't trust it, nothing else matters.

**Runs once, reached everywhere.** One brain in the cloud. Phones, desktops, messaging apps, hardware devices, and API surfaces are all thin clients reaching the same persistent assistant.

**Model-agnostic by design.** Amby orchestrates; it doesn't marry a single model provider. Users and agents can bring whatever LLM or service fits the job.

**B2C first.** Built for individuals, not enterprises. General intelligence accessible to the masses, priced at a level everyday people can afford (~$20/month). Enterprises can come later, but the core product is for the person.

**Ambient, not intrusive.** Value arrives without initiating a session — summaries, follow-ups, drafts, reminders surface *before* you remember to ask. "Always helpful" doesn't require "always listening."

---

# Who It's For (at Launch)
**Time-starved people whose work lives in email, calendar, and messaging** — recruiters, consultants, small business owners, project leads, founders, freelancers. People who juggle many conversations and commitments, and who experience real cost when follow-ups slip or context gets lost.

This is not "AI for techies." Techies are an acquisition channel, not the market ceiling. The first paid segment is anyone who has a chaotic inbox, juggles many commitments, and would pay $20/month to stop dropping balls.

The launch claim is narrow and specific: **"Your personal follow-up and prep layer — always on, permission-based, and reviewable."**

---

# Phased Roadmap
**Phase 1 — Personal Action Layer** *(now)*

Cloud-native assistant computer with persistent memory, background execution, and channel access via Telegram (expanding to more surfaces). Core value: capture, remember, act. Reduce dropped balls for busy people.

**Phase 2 — Universal Context Hub**

Open Amby as the interoperability layer for external AI services. Expose MCP-compatible endpoints so tools like Claude Code, Cursor, and ChatGPT can read user context and execute actions through Amby's permission model. Amby becomes the personal API for your life.

**Phase 3 — Ambient Hardware**

Ship small, efficient, privacy-preserving devices that extend Amby into physical space. Voice as a first-class channel, home presence, and seamless handoff between screen and ambient interaction — all connected to the same cloud brain.

---

# Architecture at a Glance
Amby is a cloud-native platform built as a Turborepo monorepo with Bun, TypeScript, Effect.js for dependency injection, and Cloudflare Workers at the edge. The system separates conversation, execution, and infrastructure so one user-facing assistant can orchestrate browser automation, sandbox compute, third-party integrations, and memory — all durably.

The agent is a conversation-first coordinator: the user talks to one assistant, while internally the system resolves threads, builds context from memory, runs a tool loop, and optionally delegates to specialist execution (research, code, browser, integrations). Plugins extend runtime behavior; skills extend prompt-level behavior. Memory is per-user with vector search and semantic retrieval.

---

# Docs
[AGENT](notion://32d02f55-b8c4-812c-ac84-fa2d3d4859dd)

[ARCHITECTURE](notion://32d02f55-b8c4-81b5-b436-d9ee275bf947)

[MARKET](notion://32d02f55-b8c4-81f2-bcb1-e4131f33e545)

[MISSION](notion://32d02f55-b8c4-8141-8be4-e771f56497c2)

[MEMORY](notion://32d02f55-b8c4-81ca-b68f-d49663a89914)

[CHANNELS](notion://32d02f55-b8c4-81a2-937e-c49dca8f6465)

[BROWSER_AND_COMPUTER](notion://32f02f55-b8c4-8102-87b9-e656a690edc1)

[DATA_MODEL](notion://32f02f55-b8c4-815a-bff4-fd0cd383a8b3)

[DEVELOPMENT](notion://32f02f55-b8c4-8198-bc6a-d5789b413eed)

[PLUGINS_AND_SKILLS](notion://32f02f55-b8c4-8126-9418-e8a8fcdeaf1f)

[README](notion://32f02f55-b8c4-8131-b4de-fd604e65b828)

[RUNTIME](notion://32f02f55-b8c4-8127-8428-cc0145220b69)

