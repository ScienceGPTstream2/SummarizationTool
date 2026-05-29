# Session History

> *Every time a reviewer completes extraction, their work is automatically saved as a session. The Session History page is where they can find past sessions, restore them exactly as they were left, share them with colleagues, and clean up old work. It also shows sessions that have been shared with the reviewer by others.*

**File:** `components/SessionHistoryPage.tsx` (~800 lines)

---

## 1. UI sections

| Section | Purpose |
|---|---|
| Tab: My Sessions | Sessions the reviewer created |
| Tab: Shared With Me | Sessions shared by other users via a group |
| Session list | Searchable table: name, date, study type, file count, entity count |
| Session metrics | Cost, total tokens, duration per session |
| Session actions | Restore, Rename, Share, Delete |
| Share dialog | Search for a group to share with; shows current share status |
| Confirmation dialogs | Required for Delete and unshare |

---

## 2. Restoring a session

Restoring loads the full session state from the backend and navigates to the appropriate workflow step.

```
Reviewer clicks "Restore"
  │
  ▼
GET /api/sessions/{sessionId}/restore-view
  │
  Returns: {
    primaryFileId: string,
    uploadedFiles: [{ fileId, filename, processingResult, entities, ... }],
    currentStep: "extraction" | "evaluation" | ...,
  }
  │
  ▼
App.tsx re-hydrates documentData from restore view
  │
  ▼
Navigate to the step the session was last on
```

The restore-view endpoint reconstructs the full `documentData` shape — it re-checks which artifacts are available in blob storage and rebuilds the uploaded files array. This means a session can be restored even if the reviewer has cleared their browser cache.

---

## 3. Sharing a session

Sharing makes a session visible in the "Shared With Me" tab for all members of the selected group.

```
Reviewer clicks "Share" on a session
  │
  ▼
Share dialog opens — reviewer searches for a group by name
  │
  ▼
POST /api/sessions/{sessionId}/share
  Body: { group_id: "..." }
  │
  ▼
Session is now visible to all group members under "Shared With Me"
```

A session can only be shared with one group at a time. Sharing with a different group replaces the previous share. The sharing reviewer retains ownership — only they can delete or unshare.

To remove sharing:

```
DELETE /api/sessions/{sessionId}/share
```

---

## 4. Shared session behaviour

When a reviewer opens a session from "Shared With Me":

- They see the full extraction and evaluation results.
- They **cannot** re-run extraction or evaluation (read-only).
- They **can** restore the session view (load it into the main app for inspection).
- They **cannot** delete or rename the session (only the owner can).

---

## 5. State

| State field | Type | Purpose |
|---|---|---|
| `sessions` | `SessionSummary[]` | All sessions for the current tab |
| `activeTab` | `"mine" \| "shared"` | Which tab is displayed |
| `selectedSession` | `string \| null` | Session ID for the detail/action panel |
| `searchQuery` | `string` | Filter sessions by name or study type |
| `shareDialogOpen` | `boolean` | Whether the share dialog is visible |
| `pendingDelete` | `string \| null` | Session ID awaiting delete confirmation |

---

## 6. API calls

| Method | Path | When | Purpose |
|---|---|---|---|
| `GET` | `/api/sessions` | On mount | Load reviewer's own sessions |
| `GET` | `/api/sessions/shared/list` | On "Shared With Me" tab | Load sessions shared with reviewer |
| `GET` | `/api/sessions/{id}/restore-view` | On "Restore" | Rebuild documentData from session |
| `PATCH` | `/api/sessions/{id}` | On rename | Update session name |
| `POST` | `/api/sessions/{id}/share` | On share confirm | Share session with group |
| `DELETE` | `/api/sessions/{id}/share` | On unshare | Remove group sharing |
| `DELETE` | `/api/sessions/{id}` | On delete confirm | Permanently delete session |

---

## 7. Error handling

- **Restore failure:** If the session's files are no longer in blob storage (e.g. deleted from Azure), the restore view returns a partial result. The page shows a warning listing which files could not be restored and proceeds with the available files.
- **Delete failure:** Shows a toast error; session remains in the list.
- **Share failure (group not found):** The share dialog shows an inline error.
