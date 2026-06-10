# Chat Memory

The chat page uses short-term conversation memory so follow-up questions can refer to earlier turns in the same chat. Memory is separate from document-processing history sessions.

## User Behavior

- Opening Chat creates or reuses a browser-tab chat session ID.
- The `New Chat` button creates a new chat session ID, clears the visible conversation, clears attached documents, and starts with empty memory.
- Uploaded documents are sent as request-time context for the current chat request. They are not stored as permanent chat memory.
- Regenerate is disabled for memory-backed chats until the backend supports replacing a previous turn without duplicating it in the persisted conversation.

## Backend API

`POST /api/chat/query` requires a `chat_session_id` in addition to the user query and model configuration.

```json
{
  "chat_session_id": "c5a0f3f6-2b6c-4c7d-92b7-8e6b7e53d7f1",
  "query": "What did I ask about earlier?",
  "document_markdown": "<document name=\"example.pdf\">...</document>",
  "model_type": "azure",
  "model_id": "gpt-5-mini",
  "deployment": "gpt-5-mini",
  "api_version": "2024-12-01-preview"
}
```

The backend scopes memory by both authenticated user and chat session:

```text
user:{user_id}:chat:{chat_session_id}
```

This prevents two users with the same client-generated `chat_session_id` from sharing memory.

## Persistence

Chat memory is persisted with LangGraph checkpoints in PostgreSQL using the existing backend `DATABASE_URL`. The first chat request initializes the LangGraph Postgres checkpointer and runs its setup routine, which creates or updates the checkpointer-owned tables.

For unit tests or isolated service use, `ChatMemoryService(use_memory_checkpointer=True)` uses LangGraph's in-memory checkpointer instead of PostgreSQL.

## Prompt, Summary, And Context Limits

The service persists the full message history for the chat session, but only the most recent raw turns are included in each model prompt. The current recent-message limit is controlled by `MAX_HISTORY_MESSAGES_IN_PROMPT` in `backend/services/chat_memory/chat_memory_service.py`.

Older messages that fall outside the recent-message window are folded into a rolling `conversation_summary`. Future prompts include that summary before the recent turns:

```text
Summary of earlier conversation:
...

Conversation so far:
...

Current document context for this request:
...

User question:
...
```

The summary is stored in the same LangGraph checkpoint state as the raw messages. `summarized_message_count` tracks how many leading messages are represented by the summary so each message is summarized once. If summary generation fails, the service leaves `summarized_message_count` unchanged so messages are not silently hidden without being represented in the summary.

Document markdown is included only in the request where it is supplied. It contributes to the context-window estimate but is not persisted as a chat message.

The API response may include `context_usage`:

```json
{
  "estimated_tokens": 2400,
  "max_context_tokens": 128000,
  "percentage": 1.9,
  "history_message_count": 6,
  "included_history_message_count": 6,
  "omitted_history_message_count": 0,
  "summary_tokens": 200,
  "document_context_tokens": 1200,
  "reserved_response_tokens": 4096,
  "hard_limit_percentage": 95.0,
  "method": "estimated_chars_div_4"
}
```

When the estimated prompt plus reserved response budget is too large, the backend returns:

```json
{
  "success": false,
  "response": "",
  "error_code": "context_window_exceeded",
  "error": "Context window is too large. Remove a document, start a new chat, or use a model with a larger context window."
}
```

The frontend uses this response to show the context-window warning near the chat composer.

## Operational Notes

- Install `langgraph` and `langgraph-checkpoint-postgres` from `backend/requirements.txt`.
- Confirm the backend can connect to PostgreSQL through `DATABASE_URL` before testing chat memory.
- If checkpoint initialization fails, the chat request fails instead of silently dropping memory.
- The frontend stores the active chat session ID in `sessionStorage` under `science-gpt.chat_session_id`, with an in-memory fallback when browser storage is unavailable.
