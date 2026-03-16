# Amby as a cloud-native ambient assistant computer

This document builds on your prior validation and the updated "Amby runs as a long-running assistant computer in the
cloud" requirement.

## Mission

Amby is not "an assistant app." Amby is **your personal assistant computer** that lives online and stays on—like a
private, always-available helper with its own workspace. You interact with it from anywhere (phone, desktop, chat
surfaces), but the "brain" and the work happen in Amby's cloud environment.

That architecture changes the product definition in a useful way:

Instead of "Amby runs everywhere," it becomes **"Amby runs once—and you reach it everywhere."** The phone/desktop apps
become **remote controls and notification surfaces**, not the compute engine.

This is also aligned with where the market is already going: mainstream vendors are actively shipping "delegate it to
the cloud" behaviors (background, multi-step, sandboxed work you review later) rather than pure real-time chat.

## Long-term vision

A world where a person's computing is continuous instead of fragmented:

You don't "open an AI app," paste context, and babysit prompts. You have a persistent assistant computer that:

- keeps a living understanding of what you care about,
- carries context across devices and channels,
- runs long-running work when you're offline,
- and surfaces results at the right moment with clear permissions and auditability.

Practically, this is "ambient" because value arrives without you initiating a chat session: summaries, follow-ups,
drafts, reminders, escalations, and pre-work for meetings land *before* you remember to ask.

What makes this hard (and therefore differentiating) is not the model. It's **trustable memory + safe actioning +
cross-surface continuity**—the exact set of things that trigger user concern when done sloppily.

## Short-term mission

Deliver a **personal action layer** for busy people who live in email, calendar, and messaging—helping them *remember,
resume, and act* across their day—without switching apps and without re-explaining context.

The mission has teeth if it is judged by a simple outcome:

**Amby reduces dropped balls.** Follow-ups don't slip. Meetings are prepped. Inbox triage happens. You spend less time
context-switching and more time doing actual work.

This short-term focus matches what consumer adoption data says people already use genAI for: email writing, to-do list
management, note organization, and other routine tasks.

## What the product is and why it's necessary

Amby is a **private personal workspace + assistant**, with three behaviors users immediately understand:

It **captures** what matters, **remembers** it safely, and **helps you act** with approval.

A simple mental model:

**"Like having a great assistant who has their own computer."**
You tell them what you want; they do the legwork in the background; they come back with a ready-to-approve result.

This is necessary *now* for two reasons:

Consumer AI usage is already mainstream, but trust is not. Over half of surveyed U.S. consumers say they use or
experiment with genAI, and a Federal Reserve survey estimated genAI adoption at 54.6% among U.S. adults 18–64 by August
2025. Yet half of U.S. adults say AI's increased use makes them more concerned than excited—which is a huge headwind for
anything that claims "lifelong memory" and "always on."

Meanwhile, the mainstream trend is unmistakable: assistants are becoming **account-connected** and **action-capable** (
not just chat). ChatGPT's integrations now let users connect services (e.g., Spotify, DoorDash, Uber) and trigger
actions, with explicit warnings that connecting accounts means sharing personal app data.

Your opening is to design a version of this that people can actually trust—and to do it in a way that isn't locked to
one ecosystem.

## Who this is for at launch

You must pick buyers who already pay for time savings. At **$20+/month**, Amby needs users who have both (a) real
workflow load and (b) willingness to pay for relief.

A tight initial ICP:

**Time-starved "solo operators" and small-team professionals** (often outside major tech hubs too): recruiters,
consultants, operators, real estate agents, small business owners, project leads—people whose work lives in email +
calendar + messaging, and who miss things because context is scattered and time is limited.

This is not a "techies only" pitch. Techies are an acquisition channel, not the market ceiling. The first paid segment
should be anyone who:

- has a chaotic inbox and calendar,
- juggles many conversations and commitments,
- and experiences real cost from dropped follow-ups or last-minute scrambling.

Competitor evidence supports this targeting: Poke (a messaging-native assistant) has positioned itself around managing
chaotic daily flows in the messaging threads people already use, and early commentary explicitly points to remote
workers, founders, and multi-tool jugglers as strong fits.

What you should *not* claim at launch:

- "AI for everyone"
- "always listening"
- "controls your devices"
- "replaces apps"

Those claims invite maximum fear and maximum competitive pressure. The winning early claim is narrower:

**"Your personal follow-up and prep layer—always on, permission-based, and reviewable."**

## ChatGPT-first via OAuth: what's realistic today

Your instinct—"let the user bring their own ChatGPT"—is strategically smart because consumers rarely pay for multiple
assistant subscriptions.

But there's a hard platform reality you can't ignore:

OpenAI explicitly states that **OpenAI APIs are billed separately from ChatGPT subscriptions**.

So "OAuth into ChatGPT to use their plan as your model backend" is *not* a generally available third‑party pattern today
in the way you likely mean it. The closest official equivalents are:

- **Apps inside ChatGPT (Apps SDK + MCP):** you can build an app that runs *inside* ChatGPT; OpenAI positions the Apps
  SDK as built on MCP (an open standard) and says it's open source so apps can run anywhere that adopts the standard.
- **"Sign in with ChatGPT" exists in Codex contexts:** OpenAI describes subscription-based "sign in with ChatGPT" for
  Codex clients and cloud delegation, but that is anchored to OpenAI's Codex product surfaces.
- OpenAI has said it was exploring "Sign in with ChatGPT" for third-party apps (identity provider). That's promising for
  login, but it does not equal "use your ChatGPT subscription as the metered compute wallet."

Bottom line: if Amby is "ChatGPT-first," the most reliable interpretation is **distribution + interface first (as a
ChatGPT app)**, not "free model compute for your standalone product."

That doesn't kill the plan, but it does force a clean decision:

- if you start **inside ChatGPT**, you ride a massive platform shift (apps + integrations), but you also accept platform
  dependency;
- if you start **outside ChatGPT**, you need your own inference economics and must win on trust and habit, not novelty.