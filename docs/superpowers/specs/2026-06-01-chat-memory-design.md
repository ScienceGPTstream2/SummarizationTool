# Chat Short-Term Memory Design

## Goal

Add short-term memory to the chatbot using LangGraph so each chat conversation can remember prior turns. Chat memory should be independent from the existing document-processing history sessions, while still allowing a chat to attach a history session when the user wants to ask about processed files.

## Current Context

The current chat endpoint is stateless. The frontend chat page sends a user query and optional document markdown to `/api/chat/query`, and the backend forwards the prompt to the existing LLM service. The app already has a separate history/session system for processed files and results, but `ChatPage` does not currently receive or persist a session id.

## Core Model

Use two separate concepts:

- `chat_session_id`: identifies one chatbot conversation and maps directly to LangGraph `thread_id`.
- `attached_session_id`: optionally points to an existing document/history session whose processed files should be available as request-time context.

A chat session owns conversation memory. A document/history session owns processed files and extraction results. The chat session may reference one attached document session, but document state is not part of the chat identity.

## User Experience

From the chat page, the user can:

1. Start a blank independent chat.
2. Select an existing history session in advanced mode and attach it to the current chat.
3. Upload/process new files from chat, creating or updating a document/history session, then attach that session to the chat.

This supports multiple independent conversations about the same processed files without mixing chat histories. It also lets users reset chat memory without losing their document-processing history.

## Backend Architecture

Add a `ChatMemoryService` that owns LangGraph execution for chat. The FastAPI route remains responsible for request validation, model/provider parameters, session attachment lookup, and response formatting.

`ChatMemoryService` responsibilities:

- Build and invoke the LangGraph chat graph.
- Use `chat_session_id` as `configurable.thread_id`.
- Persist graph state with a Postgres checkpointer.
- Keep graph state small.
- Compose prompts from system instructions, remembered messages, and request-time document context.

Graph state should include:

- `messages`: prior user and assistant turns.
- `attachment`: lightweight metadata such as `attached_session_id`, selected document ids, hashes, timestamps, or titles.

Graph state should not include full document markdown or large extraction payloads. Existing document services remain the source of truth for processed file content.

## Data Flow

1. The frontend creates or loads a `chat_session_id` for the active chat.
2. The frontend sends `/api/chat/query` with:
   - `chat_session_id`
   - user query
   - optional `attached_session_id`
   - existing model/provider fields
3. The backend validates the request.
4. If `attached_session_id` is present, the backend loads current document context from the existing history/session services.
5. The backend invokes `ChatMemoryService` with LangGraph config `thread_id = chat_session_id`.
6. LangGraph loads prior state from the Postgres checkpointer, appends the new user turn, calls the model, and checkpoints the updated state.
7. The backend returns the assistant response plus chat metadata.

Document context can influence the current response, but it is not stored as full content in chat memory.

## Attachment Behavior

A chat can point at one attached document/history session at a time. Changing the attachment updates the chat's lightweight attachment metadata and affects future responses, but does not erase prior messages.

If the user wants a clean conversation about different files, the frontend should make starting a new chat easy. The system should not silently merge unrelated document contexts into one conversation.

## Error Handling

- Missing `chat_session_id`: the frontend should create it; the backend should validate and return a clear error if absent.
- Invalid `attached_session_id`: return a user-friendly error and allow the chat to continue unattached.
- Oversized document context: do not checkpoint large content; summarize, truncate, or surface the existing context-window warning.
- Checkpointer failure: fail the chat request visibly instead of silently losing memory.
- Model failure: avoid creating ambiguous half-saved turns; retry behavior should be explicit in service tests.

## Testing Strategy

Backend tests:

- Request validation for `chat_session_id` and optional `attached_session_id`.
- One `chat_session_id` remembers prior turns.
- Two different `chat_session_id`s do not share history.
- Attached document context influences a response without being stored as full markdown in graph state.
- Invalid or unavailable `attached_session_id` returns a clear error.

Frontend tests:

- Starting a blank chat creates an independent `chat_session_id`.
- Selecting an existing history session attaches it to the current chat.
- Starting a new chat does not reuse the prior chat's memory unless explicitly selected.

Manual validation:

- Process files in the workflow.
- Open Chat and attach the processed history session.
- Ask a document-specific question and a follow-up that depends on chat history.
- Start a blank chat and confirm prior chat memory does not leak.
- Reattach the same history session in a second chat and confirm document context is available without sharing conversation history.

## Recommended Implementation Order

1. Add backend request fields and `ChatMemoryService` with LangGraph checkpointing.
2. Add frontend `chat_session_id` lifecycle for blank independent chats.
3. Add history-session attachment UI and backend document-context lookup.
4. Add tests for memory isolation and attachment behavior.
