# Agent memory in task runs

The worker checks each assigned agent's `memory.search` and `memory.write` tools and
category policy. Search uses the task title and description, then adds up to five
permitted semantic matches to the provider prompt. Each result carries its attribution,
timestamp, confidence, verification status, category, and scope inside an untrusted data
block. Memory text cannot act as instructions or authorization.

Structured memory write proposals from a provider are validated before the worker calls
the Memory Vault service with the assigned agent identity and policy. The service enforces
category grants, secret rejection, deduplication, attribution, and audit. Agent writes
cannot set a verified status; they remain proposed unless explicitly downgraded to
untrusted.

Task records do not have a project identifier yet. Agent runs therefore do not read or
write project-scoped entries. Project entries are refused at runtime until a trusted
project identity is carried by the task; shared and author-private entries remain scoped.
The current MockProvider does not emit memory write proposals by default.
