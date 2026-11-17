# Agent memory in task runs

The worker checks each assigned agent's `memory.search` and `memory.write` tools and
category policy. Search uses the task title and description, then adds up to five
permitted semantic matches to the provider prompt. Each result carries its attribution,
timestamp, confidence, verification status, category, and scope inside an untrusted data
block. Memory text cannot act as instructions or authorization.

Structured memory write proposals from a provider are validated before the worker calls
the Memory Vault service with the assigned agent identity and policy. The service enforces
category grants, secret rejection, deduplication, attribution, and audit. Agent writes
cannot set a verified status. They remain proposed unless explicitly downgraded to
untrusted; writes from GitHub/Trello tasks, or runs that retrieved untrusted memory, are
forced to untrusted regardless of the provider's label.

## External content boundary

The current worker sends only the task title/description and retrieved memory to the
provider. It does not execute web research, repository crawling, or general-purpose tools,
so those external outputs cannot currently enter a local run through a tool adapter.
The worker does treat tasks labeled `github` or `trello` as external, but connector
ingress for those task origins is not implemented here. Retrieved entries already marked
untrusted are the other external-content path currently handled. A provider-authored
`sourceAttribution` is descriptive metadata, not provenance evidence; it cannot mark a
write untrusted or verified by itself. When external tools or connector ingress are
implemented, they must mark content untrusted at ingress and carry that provenance to any
memory proposal derived from it before the worker can safely persist it.

Task records do not have a project identifier yet. Agent runs therefore do not read or
write project-scoped entries. Project entries are refused at runtime until a trusted
project identity is carried by the task; shared and author-private entries remain scoped.
The current MockProvider does not emit memory write proposals by default.
