# Sessions, Sharing, and Groups Technical Design

This document describes workflow sessions, DB-to-API conversion, restore-view generation, shared sessions, group membership, and authorization rules.

## 1. Scope

In scope:

- `SessionService` session lifecycle;
- `SQLAlchemyDBService` session/document/extraction/evaluation persistence operations;
- session schema conversion;
- restore-view construction;
- group CRUD and membership;
- session sharing with groups.

Out of scope:

- frontend session-history UI;
- template-specific group sharing, covered in [10-template-system.md](10-template-system.md).

## Visual workflow

![Session sharing and template workflow](images/session-sharing-template-workflow.png)

Read the top half of the diagram for sessions and groups. Session APIs call `SessionService`, which converts DB rows into the Pydantic session aggregate and builds restore payloads by asking `OrganizedFileService` for each document view. Sharing does not copy session data. It sets share metadata on the owned `app_sessions` row and allows reads only when the requesting user has a `user_groups` membership for the target group. Group role checks protect group administration, while shared-session viewing only requires membership.

## 2. Main classes and files

| Component | File | Responsibility |
| --- | --- | --- |
| `SessionService` | `backend/services/session/session_service.py` | High-level workflow/session orchestration. |
| `SQLAlchemyDBService` | `backend/services/database/sqlalchemy_db_service.py` | Persistence boundary for sessions, docs, extractions, evaluations, metrics, sharing. |
| `GroupService` | `backend/services/groups/group_service.py` | Group and membership business logic. |
| session schemas | `backend/schemas/sessions.py` | API-facing session aggregate models. |
| session router | `backend/api/sessions/router.py` | HTTP session endpoints. |
| group router | `backend/api/groups/router.py` | HTTP group endpoints. |
| `AppSession` ORM | `backend/models/app_session.py` | Workflow session table. |
| `Group`, `UserGroup` ORM | `backend/models/group.py` | Collaboration tables. |

## 3. Session lifecycle

### 3.1 Create session

Endpoint:

```text
POST /api/sessions
```

`SessionService.create_session()` flow:

1. Convert optional `SessionConfiguration` into a dict.
2. Create `AppSession` through `SQLAlchemyDBService.create_session()`.
3. For each optional `SessionDocument`, create a `Document` DB row.
4. If all requested document inserts fail, delete the orphaned session and raise an error.
5. Return a Pydantic `Session` aggregate.

Partial document insert success is allowed. Failed document rows are logged and skipped.

### 3.2 Get session

Endpoint:

```text
GET /api/sessions/{session_id}
```

`SQLAlchemyDBService.get_session()` loads:

- the `AppSession` row for the requesting user;
- associated `Document` rows;
- associated `ExtractionResult` rows;
- associated `EvaluationResult` rows.

Then `SessionService._db_to_session()` converts raw DB dictionaries into Pydantic models.

If the session is not owned by the user, the service returns `None`. The router can also attempt shared-session fallback depending on endpoint path.

### 3.3 List sessions

Endpoint:

```text
GET /api/sessions
```

`SQLAlchemyDBService.list_sessions()` returns session summary rows sorted by `updated_at` descending and enriches each with:

- `document_count`
- `document_names`
- `extraction_count`
- `study_type` from JSON configuration

`SessionService.list_sessions()` converts these into `SessionSummary` objects.

### 3.4 Update session

Endpoint:

```text
PATCH /api/sessions/{session_id}
```

`SessionService.update_session()` supports three categories:

1. Basic fields: `name`, `status`, `last_step`, `configuration`.
2. Config merges: `evaluation_config`, `files_config`.
3. Heavy updates: documents, extraction results, evaluation results.

Important merge behavior:

- `evaluation_config` is merged into the existing config dict.
- `files_config` is deep-merged per file id so existing per-file config is preserved.

Heavy update behavior:

- New documents are inserted only if their `file_hash` is not already present.
- Extraction results are matched to documents by `file_hash` or document id.
- Evaluation results are matched to extraction results by entity/model/document identity.

If the update is config-only, the service returns a lightweight session object without reloading all child rows. If heavy updates occurred, it returns the full session.

### 3.5 Delete session

Endpoint:

```text
DELETE /api/sessions/{session_id}
```

Deletes only when both session id and user id match.

## 4. DB-to-session conversion

`SessionService._db_to_session()` is the central conversion function.

### 4.1 Document conversion

For each DB document:

- if parse cost is missing/zero, estimate it from processor/page count/duration;
- backfill the DB when a cost can be computed;
- build `SessionDocument` with id, file hash, filename, processor, cost, page/figure/table counts.

### 4.2 Extraction conversion

For each DB extraction:

- if extraction cost is missing/zero, estimate it from token counts and model id;
- infer provider from model id;
- backfill cost where possible;
- map `bbox_references` to API field `references`;
- build `schemas.sessions.ExtractionResult`.

### 4.3 Evaluation conversion

DB evaluation rows are grouped by:

```text
(document_id, entity_name, model_id)
```

Each group becomes one `schemas.sessions.EvaluationResult` with a list of `EvaluationScore` entries.

This preserves per-document evaluation granularity in multi-document sessions.

## 5. Extraction persistence rules

`SessionService.add_extraction_result_fast()` resolves the target document before writing.

Resolution order:

1. Existing cached session documents.
2. DB document lookup.
3. Match by `file_hash` when provided.
4. If only one document exists, use it.
5. If multiple documents exist and no file identity is provided, return `False` instead of guessing.

This guard prevents cross-document contamination.

Persistence uses `SQLAlchemyDBService.upsert_extraction_result()` and the database unique constraint:

```text
(document_id, entity_name, model_id)
```

## 6. Evaluation persistence rules

`SessionService.add_evaluation_result_fast()`:

1. loads extraction results for the session;
2. resolves target document from `document_id` or `file_hash`;
3. matches extraction by entity name, model id, and optional document id;
4. supports a special `__paragraph_summary__` fallback;
5. upserts each metric score through DB service.

Special human-score behavior:

- A human-score update can apply to all existing metrics for a judge model.
- If no score list exists but a human score is provided, the service updates existing evaluations or creates a `human_evaluation` placeholder.

## 7. Restore-view construction

Endpoint:

```text
GET /api/sessions/{session_id}/restore-view
GET /api/sessions/shared/{session_id}/restore-view
```

`SessionService.build_restore_view()`:

1. merges `session.configuration.files_config` with top-level `session.files_config`;
2. resolves each document's processor;
3. calls `OrganizedFileService.build_document_view()` for each document;
4. returns a canonical frontend payload.

Returned top-level shape:

```json
{
  "fileId": "primary-file-hash",
  "conversionId": "primary-file-hash",
  "processorUsed": "azure_doc_intelligence",
  "uploadedFiles": []
}
```

The first uploaded file is treated as the primary file.

## 8. Session sharing

### 8.1 Share session

Endpoint:

```text
POST /api/sessions/{session_id}/share
```

`SessionService.share_session()` first verifies the requester belongs to the target group using `SQLAlchemyDBService.get_user_group_ids()`.

Then `SQLAlchemyDBService.share_session()` updates the session fields:

- `shared_with_group_id`
- `shared_by`
- `shared_at`

Only the owning user can share the session.

### 8.2 Unshare session

Endpoint:

```text
DELETE /api/sessions/{session_id}/share
```

Clears share fields on an owned session.

### 8.3 List shared sessions

Endpoint:

```text
GET /api/sessions/shared/list
```

Flow:

1. Find groups the user belongs to.
2. Query sessions shared with those group ids.
3. Exclude sessions owned by the same user.
4. Enrich with group display name and sharer display name.
5. Return `SessionSummary` list.

### 8.4 Shared session read

A user can read a shared session when:

- `AppSession.shared_with_group_id` is set;
- the requesting user has a `UserGroup` row for that group.

Role does not matter for session shared-view access; membership is enough.

## 9. Group lifecycle

### 9.1 Create group

Endpoint:

```text
POST /api/groups
```

`GroupService.create_group()`:

1. inserts a `Group` row with `created_by=user_id`;
2. inserts a `UserGroup` row for the creator with `role='owner'`;
3. returns the group dict.

The owner membership is created in the same transaction.

### 9.2 Get group

Endpoint:

```text
GET /api/groups/{group_id}
```

Rules:

- System admin can read any group.
- Non-admin users must be group members.

Returned group detail includes:

- group fields;
- `user_role`;
- enriched `members` list.

### 9.3 List user groups

Endpoint:

```text
GET /api/groups
```

Returns groups where the user has a membership row. Each row includes:

- `user_role`
- `member_count`

### 9.4 Update/delete group

Update requires:

- system admin; or
- group admin/owner role.

Delete requires:

- system admin; or
- owner role.

## 10. Membership rules

### 10.1 Add member

Endpoint:

```text
POST /api/groups/{group_id}/members
```

Rules:

- Requester must be admin/owner or system admin.
- New member role `owner` is normalized to `admin`.
- Adding an existing member delegates to role update.

### 10.2 Update role

Endpoint:

```text
PUT /api/groups/{group_id}/members/{user_id}
```

Rules:

- Cannot change to or from owner through this endpoint.
- Requester must be admin/owner unless system admin.
- Only owner can promote someone to admin.

### 10.3 Remove member

Endpoint:

```text
DELETE /api/groups/{group_id}/members/{user_id}
```

Rules:

- Self-removal is allowed unless the user is the only owner.
- System admin can remove members but not owners.
- Non-admin users cannot remove others.
- Owners cannot be removed by this method.

## 11. Member enrichment

`GroupService._enrich_members_with_profiles()` bulk-loads `User` rows and adds:

- `display_name = user.name or user.email`
- `email`
- `avatar_url = user.image`

Missing users receive `None` profile fields.

## 12. Session metrics

`SQLAlchemyDBService.increment_session_metrics()` atomically increments:

- `total_cost`
- `total_latency`
- `total_calls`

`CostTracker` calls this from its record path. `SessionService._db_to_session()` can also use stored totals when building session responses.

## 13. Related docs

- [03-data-models.md](03-data-models.md)
- [04-schemas.md](04-schemas.md)
- [05-document-processing.md](05-document-processing.md)
- [07-extraction-flow.md](07-extraction-flow.md)
- [08-evaluation-flow.md](08-evaluation-flow.md)
