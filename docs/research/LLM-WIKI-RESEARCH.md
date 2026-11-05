# LLM wiki and second-brain research (2026-11-05)

Method: a Haiku research agent read public pages. Star counts and activity were not reliably visible. Items marked UNKNOWN still need verification in the projects' own docs or code.

| Project | Core mechanic | License | URL | Idea to reuse | Risk |
|---|---|---|---|---|---|
| Karpathy LLM Wiki | immutable raw sources, an LLM-owned Markdown wiki, a schema file; ingest, query and lint; index plus append-only log | not stated | https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f | three layers, index-first retrieval, log as audit trail | no permission model |
| lucasastorian/llmwiki | MCP tools write the wiki; SQLite or Postgres+S3; nightly routine | Apache-2.0 | https://github.com/lucasastorian/llmwiki | storage abstraction, scheduled consolidation | single user; agents can delete pages |
| Astro-Han/karpathy-llm-wiki | Agent Skill; triage before writing; lint auto-fix | MIT | https://github.com/Astro-Han/karpathy-llm-wiki | triage step | no freshness, confidence or retraction |
| Graphiti (Zep) | episodes as provenance; facts with validity windows; contradictions invalidate rather than delete | Apache-2.0 | https://github.com/getzep/graphiti | bi-temporal facts | `group_id` is not a security boundary |
| Mem0 | add-only memory, entity linking, fused search | Apache-2.0 | https://github.com/mem0ai/mem0 | fused lexical, semantic and entity retrieval | stale facts accumulate |
| Letta | agent-managed memory, background consolidation (UNKNOWN details) | Apache-2.0 | https://github.com/letta-ai/letta | "dreaming" background agent | API churn |
| Cognee | remember, improve, recall and forget; dataset scope | Apache-2.0 | https://github.com/topoteretes/cognee | per-item forget | access control off by default |
| Onyx | 50+ connectors with permission sync; agents inherit the user's ACL | MIT core, EE separate | https://github.com/onyx-dot-app/onyx | ACL checked at every access point | EE features (SCIM, groups) |
| Microsoft GraphRAG | entity extraction, community summaries | MIT | https://github.com/microsoft/graphrag | community summaries for topic pages | costly; no ACL |
| LightRAG | graph plus vector, incremental delete | MIT | https://github.com/HKUDS/LightRAG | delete rebuilds only affected entities | insecure defaults |
| Khoj | personal agents, automations | AGPL-3.0 | https://github.com/khoj-ai/khoj | per-agent knowledge scope | AGPL |

Decision: adopt the patterns, not the code. Secondary builds the wiki on its existing Workspace Durable Objects and policy engine (see `docs/DESIGN-LIVING-WIKI.md`). None of these projects provides tenant or account isolation we could rely on.
