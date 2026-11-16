# Phase 1 demo script

**Length:** about 8 minutes

**Mode:** local, mock-first, single owner

This script presents behavior available in the repository today. Agent runs use the mock provider, and GitHub, Discord, and Trello show mock connector health. No live LLM or external-service action is part of this demo.

## Before the demo

Start a fresh local stack by following the [quickstart](../specs/001-flux-88-platform/quickstart.md). Use a disposable database. The seed creates agent profiles, budgets, three mock connector accounts, and sample tasks. Open `http://localhost:3000` and create the demo owner with an email you control and a password of at least 12 characters.

Keep the terminal visible if useful: `pnpm dev` runs the web app, API, and worker. The service defaults are web `3000`, API `3001`, Postgres `5488`, and Redis `6388`.

## Walkthrough

### 1. Show the office and agent roster — 1 minute

Sign in, point out the **MOCK MODE — simulated activity only** banner, then open **Clock Tower → Agents**. Show the 18 configured profiles and open DATA's profile to show its permissions and prohibited operations.

Say: “These are configured agent profiles. Work runs through the mock provider in this demo; these are not 18 independent live model sessions.”

### 2. Show task delegation — 3 minutes

Open **Clock Tower → Tasks**. In **Delegate a goal to DOC**, enter this tested goal:

> Research 80s competitor dashboards, implement the comparison view, and test it

Select **Delegate**. Wait for the parent task to complete, then open its card. Show the three generated subtasks, dependency graph, and delegation timeline.

Say: “DOC routes this request through the local mock provider. It demonstrates task tracking and handoffs; it does not browse, implement code, or test a real product.”

### 3. Show owner knowledge — 2 minutes

Open **The Memory Vault**, select **+ Add knowledge**, and enter a short title such as `Demo: reduced motion`. Add a note such as `Keep reduced motion available across office pages.` Select **Save as verified**. Search for `Demo: reduced motion`, point out the owner attribution and verified status, and switch between keyword and semantic search.

This is owner-authored local memory. Avoid entering private or real customer data during a shared screen demo.

### 4. Show integration and approval boundaries — 2 minutes

Open **Clock Tower → Integrations** and show that the GitHub, Discord, and Trello accounts report mock health. Then open **Clock Tower → Approvals**. On a fresh demo database the inbox may be empty; do not invent a request or claim that a real external action ran.

Say: “The approval inbox and approval lifecycle are present. The current browser approval test uses a stubbed API fixture; API integration tests cover persisted decisions and single-use grants. This demo does not claim a complete live agent-to-external-action journey.”

## Close

Summarize the current boundary: a single-owner dashboard, mock agent orchestration, local memory, approval controls, and mock connector status. Live model adapters and live GitHub/Discord/Trello operations are outside this Phase 1 demo.

Stop `pnpm dev` with `Ctrl+C`. Run `pnpm db:down` to stop Postgres and Redis. Compose retains the named volumes, so the owner account and demo data remain for the next local run.
