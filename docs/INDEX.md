# Science-GPT Documentation Index

Start here. Every document in this repository is listed below with its audience and a short description of what it covers.

**New to the project?** Read the [Product Overview](README.md) first, then the [Glossary](glossary.md), then the entry point for the area you're working in (backend or frontend).

---

## Start here

| Document | Audience | What it covers |
|---|---|---|
| [Product Overview](README.md) | Everyone | What the tool does, who uses it (PMRA reviewers), how it was tested, SME evaluation results |
| [Glossary](glossary.md) | Everyone | Plain-language definitions for all Azure services, tools, and project-specific terms |

---

## Backend

| Document | Audience | What it covers |
|---|---|---|
| [Backend TDD — Entry Point](backend/README.md) | Engineers | Master index for the full backend technical design; start here for anything backend |
| [01 — Architecture](backend/01-architecture.md) | Engineers | Service boundaries, package responsibilities, five major data flows, dependency direction |
| [02 — API Surface](backend/02-api-surface.md) | Engineers | All 14 routers documented with every endpoint, request/response shapes, auth, and exceptions |
| [03 — Data Models](backend/03-data-models.md) | Engineers | All 13 ORM models with field-level types, constraints, indexes, and migration notes |
| [04 — Schemas](backend/04-schemas.md) | Engineers | All Pydantic request/response schemas with design notes |
| [05 — Document Processing](backend/05-document-processing.md) | Engineers | Upload, SHA-256 deduplication, parser selection, Azure DI and Docling pipelines, blob storage, bounding boxes |
| [06 — LLM Layer](backend/06-llm-layer.md) | Engineers | All 7 provider clients, dispatch table, timeout budgets, structured output handling, cost tracking |
| [07 — Extraction Flow](backend/07-extraction-flow.md) | Engineers | Entity extraction end-to-end: concurrency model, provider dispatch, reference/bbox matching, session persistence |
| [08 — Evaluation Flow](backend/08-evaluation-flow.md) | Engineers | G-Eval scoring, combined JSON parsing, background job lifecycle, cancellation, cost tracking |
| [09 — Sessions, Sharing & Groups](backend/09-session-sharing-groups.md) | Engineers | Session lifecycle, restore-view construction, group membership rules, shared session read path |
| [10 — Template System](backend/10-template-system.md) | Engineers | Template CRUD, version snapshots, fork, scope change, access-control algorithms, folder operations |
| [11 — Auth, Security & Observability](backend/11-auth-security-observability.md) | Engineers | Better Auth session validation, auth proxy, CORS, secrets loading, structlog, Prometheus, OpenTelemetry, CostTracker |

### Backend appendices

| Document | What it covers |
|---|---|
| [API Endpoint Index](backend/appendices/api-endpoint-index.md) | Compact table of every route — method, path, purpose |
| [Class Index](backend/appendices/class-index.md) | All backend classes organised by package |
| [Class Reference](backend/appendices/class-reference.md) | Field-level reference for ORM models, Pydantic schemas, and service classes |
| [Data Flow Diagrams](backend/appendices/data-flow-diagrams.md) | 15 text-format diagrams covering every major request flow |
| [Risks, Assumptions & Testing](backend/appendices/risks-assumptions-testing.md) | Runtime/data/provider assumptions, risk table with mitigations, 13-category test strategy, 12-step smoke test |

---

## Frontend

| Document | Audience | What it covers |
|---|---|---|
| [Frontend TDD — Entry Point](frontend/README.md) | Engineers | Tech stack, page map, workflow diagram, architecture overview |
| [01 — App Shell](frontend/01-app-shell.md) | Engineers | `App.tsx` — `DocumentData` interface, step routing, `onComplete()` pattern, session persistence, navigation guards |
| [02 — Auth](frontend/02-auth.md) | Engineers | `LoginPage`, `AuthCallback`, `authUtils.ts` — OAuth flow, token lifecycle, `authenticatedFetch()`, visibility refresh |
| [03 — Upload](frontend/03-upload.md) | Engineers | Workflow step 1 — file upload, SHA-256 deduplication, auto-processing, parser selection |
| [04 — Processing](frontend/04-processing.md) | Engineers | Workflow step 2 — parsed content inspection, re-processing, PDF bounding box viewer |
| [05 — Study Config](frontend/05-study-config.md) | Engineers | Workflow step 3 — study type, entity editor, template loading, model selection |
| [06 — Extraction](frontend/06-extraction.md) | Engineers | Workflow step 4 — concurrent entity extraction, PDF reference highlighting, multi-model comparison, in-place editing |
| [07 — Evaluation](frontend/07-evaluation.md) | Engineers | Workflow step 5 — G-Eval metrics, background jobs, human score overrides, Excel export |
| [08 — Simplified Flow](frontend/08-simplified-flow.md) | Engineers | One-click pipeline, `useSimplifiedPipeline` hook, batched extraction, stage progression |
| [09 — Chat](frontend/09-chat.md) | Engineers | Freeform document Q&A, multi-document context, message ratings |
| [10 — Session History](frontend/10-session-history.md) | Engineers | Browse, restore, share, and delete sessions; shared sessions (read-only) |
| [11 — Templates](frontend/11-templates.md) | Engineers | Template CRUD, version history, fork, scope change, folder organisation |
| [12 — Groups](frontend/12-groups.md) | Engineers | Group lifecycle, member roles, add/remove members, user search |
| [13 — Executive Mode](frontend/13-executive-mode.md) | Engineers | Standalone summary generation without structured entity review |
| [14 — Batch Results](frontend/14-batch-results.md) | Engineers | Cross-file results table, fuzzy search, column visibility, Excel export |

### Frontend appendices

| Document | What it covers |
|---|---|
| [Component Index](frontend/appendices/component-index.md) | All shared components with props and usage |
| [Hooks & Contexts](frontend/appendices/hooks-contexts.md) | All custom hooks and `ThemeContext` with exported APIs |
| [Types & Interfaces](frontend/appendices/types-interfaces.md) | Key TypeScript interfaces: `DocumentData`, `Entity`, `Template`, `Group`, and more |

---

## Deployment & operations

| Document | Audience | What it covers |
|---|---|---|
| [GitHub Auth Setup](superpowers/setup-github-auth.md) | DevOps | 10-step guide to configuring GitHub Enterprise Cloud OAuth |
| [Migration Guide](superpowers/migration-guide.md) | Engineers | Supabase → Azure Postgres + Better Auth migration history |
| [Deployment Plan](superpowers/plans/dockerize-and-deploy.md) | DevOps | Azure Container Apps architecture, CI/CD pipeline, provisioning record |
| [Logging Stack](../logging/README.md) | DevOps | LGTM stack setup: Grafana, Loki, Tempo, Prometheus; NSG firewall rules |
