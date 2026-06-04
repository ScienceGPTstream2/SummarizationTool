# Chat Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent LangGraph-backed memory for each chatbot conversation, with optional attachment to an existing document/history session.

**Architecture:** The frontend creates a durable `chat_session_id` for each chat. The backend uses that ID as LangGraph's `thread_id`, stores short-term message state through a checkpointer, and loads attached document context from existing session/document services at request time. Chat memory and document-processing sessions remain separate; `attached_session_id` is only a reference.

**Tech Stack:** FastAPI, Pydantic, Python LangGraph, LangGraph Postgres checkpointer, existing `LLMService`, React/TypeScript, existing authenticated fetch/session APIs.

---

## File Structure

Backend files:

- Modify: `backend/requirements.txt`
  - Add `langgraph` and `langgraph-checkpoint-postgres`.
- Create: `backend/services/chat_memory/__init__.py`
  - Export `ChatMemoryService`, `ChatMessage`, and `ChatMemoryRequest`.
- Create: `backend/services/chat_memory/chat_memory_service.py`
  - Build the LangGraph chat graph, use `chat_session_id` as `thread_id`, and call `LLMService.generate_paragraph`.
- Create: `backend/services/chat_memory/document_context.py`
  - Load markdown for an optional `attached_session_id` using existing `SessionService` and `OrganizedFileService` methods.
- Modify: `backend/api/chat/router.py`
  - Accept `chat_session_id` and optional `attached_session_id`; delegate to `ChatMemoryService`.
- Create: `backend/tests/test_chat_memory_service.py`
  - Unit tests for independent memory and prompt construction using an in-memory LangGraph checkpointer.
- Create: `backend/tests/test_chat_router.py`
  - Unit tests for request validation and route delegation.

Frontend files:

- Create: `frontend/utils/chatSession.ts`
  - Generate, store, reset, and retrieve independent chat session IDs.
- Modify: `frontend/components/ChatPage.tsx`
  - Send `chat_session_id`, optionally send `attached_session_id`, support starting a new chat, and add a simple history-session attachment selector.
- Reuse: `frontend/types/session.ts`
  - Use existing `SessionSummary` type for the selector.

No database model table is needed for chat messages in this first implementation. LangGraph checkpoint tables are owned by the LangGraph checkpointer package.

---

### Task 1: Add LangGraph dependencies

**Files:**
- Modify: `backend/requirements.txt:19-29`

- [ ] **Step 1: Add dependency lines**

Edit `backend/requirements.txt` so the LangChain/LangGraph block includes these lines:

```txt
langchain-openai>=1.0.1
langchain-google-vertexai>=3.0.1
langgraph>=1.0.0
langgraph-checkpoint-postgres>=3.0.0
```

- [ ] **Step 2: Install backend dependencies locally**

Run:

```bash
cd backend && python -m pip install -r requirements.txt
```

Expected: installation completes with `langgraph` and `langgraph-checkpoint-postgres` installed.

- [ ] **Step 3: Commit**

```bash
git add backend/requirements.txt
git commit -m "Add LangGraph chat memory dependencies"
```

---

### Task 2: Write failing ChatMemoryService tests

**Files:**
- Create: `backend/tests/test_chat_memory_service.py`

- [ ] **Step 1: Create the failing tests**

Create `backend/tests/test_chat_memory_service.py` with:

```python
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.chat_memory.chat_memory_service import ChatMemoryRequest, ChatMemoryService


class FakeLLMService:
    def __init__(self):
        self.prompts = []

    async def generate_paragraph(self, **kwargs):
        self.prompts.append(kwargs)
        user_prompt = kwargs["user_prompt"]
        if "What did I ask before?" in user_prompt:
            return {"success": True, "content": "You asked about licensing."}
        return {"success": True, "content": "First answer."}


@pytest.mark.asyncio
async def test_chat_session_remembers_prior_turns():
    fake_llm = FakeLLMService()
    service = ChatMemoryService(llm_service=fake_llm, use_memory_checkpointer=True)

    first = await service.invoke(
        ChatMemoryRequest(
            chat_session_id="chat-a",
            query="Tell me about licensing.",
            model_type="azure",
        )
    )
    second = await service.invoke(
        ChatMemoryRequest(
            chat_session_id="chat-a",
            query="What did I ask before?",
            model_type="azure",
        )
    )

    assert first["success"] is True
    assert second["success"] is True
    assert second["response"] == "You asked about licensing."
    assert "Tell me about licensing." in fake_llm.prompts[1]["user_prompt"]


@pytest.mark.asyncio
async def test_chat_sessions_do_not_share_history():
    fake_llm = FakeLLMService()
    service = ChatMemoryService(llm_service=fake_llm, use_memory_checkpointer=True)

    await service.invoke(
        ChatMemoryRequest(
            chat_session_id="chat-a",
            query="Tell me about licensing.",
            model_type="azure",
        )
    )
    await service.invoke(
        ChatMemoryRequest(
            chat_session_id="chat-b",
            query="What did I ask before?",
            model_type="azure",
        )
    )

    chat_b_prompt = fake_llm.prompts[-1]["user_prompt"]
    assert "Tell me about licensing." not in chat_b_prompt


@pytest.mark.asyncio
async def test_document_context_is_injected_but_not_saved_as_message():
    fake_llm = FakeLLMService()
    service = ChatMemoryService(llm_service=fake_llm, use_memory_checkpointer=True)

    await service.invoke(
        ChatMemoryRequest(
            chat_session_id="chat-doc",
            query="Summarize this.",
            model_type="azure",
            document_context="<document name=\"Protocol\">Large protocol markdown</document>",
            attached_session_id="session-1",
        )
    )
    await service.invoke(
        ChatMemoryRequest(
            chat_session_id="chat-doc",
            query="What did I ask?",
            model_type="azure",
        )
    )

    first_prompt = fake_llm.prompts[0]["user_prompt"]
    second_prompt = fake_llm.prompts[1]["user_prompt"]
    assert "Large protocol markdown" in first_prompt
    assert "Large protocol markdown" not in second_prompt
    assert "Summarize this." in second_prompt
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend && python -m pytest tests/test_chat_memory_service.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'services.chat_memory'`.

---

### Task 3: Implement ChatMemoryService

**Files:**
- Create: `backend/services/chat_memory/__init__.py`
- Create: `backend/services/chat_memory/chat_memory_service.py`
- Test: `backend/tests/test_chat_memory_service.py`

- [ ] **Step 1: Create package export**

Create `backend/services/chat_memory/__init__.py`:

```python
from .chat_memory_service import ChatMemoryRequest, ChatMemoryService

__all__ = ["ChatMemoryRequest", "ChatMemoryService"]
```

- [ ] **Step 2: Create the service implementation**

Create `backend/services/chat_memory/chat_memory_service.py`:

```python
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

from services.llm.llm_service import LLMService


@dataclass
class ChatMemoryRequest:
    chat_session_id: str
    query: str
    model_type: str
    model_id: Optional[str] = None
    deployment: Optional[str] = None
    api_version: Optional[str] = None
    document_context: Optional[str] = None
    attached_session_id: Optional[str] = None


class ChatState(TypedDict):
    messages: List[BaseMessage]
    query: str
    model_type: str
    model_id: Optional[str]
    deployment: Optional[str]
    api_version: Optional[str]
    document_context: Optional[str]
    attached_session_id: Optional[str]


class ChatMemoryService:
    def __init__(
        self,
        llm_service: Optional[LLMService] = None,
        checkpointer: Optional[Any] = None,
        use_memory_checkpointer: bool = False,
    ):
        self.llm_service = llm_service or LLMService()
        self.checkpointer = checkpointer or self._build_checkpointer(use_memory_checkpointer)
        self.graph = self._build_graph()

    def _build_checkpointer(self, use_memory_checkpointer: bool):
        if use_memory_checkpointer:
            return InMemorySaver()

        try:
            from langgraph.checkpoint.postgres import PostgresSaver
            from models.base import DATABASE_URL

            saver = PostgresSaver.from_conn_string(DATABASE_URL)
            saver.setup()
            return saver
        except Exception as exc:
            print(f"[CHAT_MEMORY] Falling back to in-memory checkpointer: {exc}")
            return InMemorySaver()

    def _build_graph(self):
        graph = StateGraph(ChatState)
        graph.add_node("generate", self._generate_response)
        graph.add_edge(START, "generate")
        graph.add_edge("generate", END)
        return graph.compile(checkpointer=self.checkpointer)

    async def invoke(self, request: ChatMemoryRequest) -> Dict[str, Any]:
        state: ChatState = {
            "messages": [HumanMessage(content=request.query)],
            "query": request.query,
            "model_type": request.model_type,
            "model_id": request.model_id,
            "deployment": request.deployment,
            "api_version": request.api_version,
            "document_context": request.document_context,
            "attached_session_id": request.attached_session_id,
        }
        config = {"configurable": {"thread_id": request.chat_session_id}}
        result = await self.graph.ainvoke(state, config=config)
        messages = result.get("messages", [])
        response = ""
        for message in reversed(messages):
            if isinstance(message, AIMessage):
                response = str(message.content)
                break
        return {
            "success": True,
            "response": response,
            "chat_session_id": request.chat_session_id,
            "attached_session_id": request.attached_session_id,
        }

    async def _generate_response(self, state: ChatState) -> Dict[str, Any]:
        prompt = self._build_user_prompt(
            messages=state.get("messages", []),
            current_query=state["query"],
            document_context=state.get("document_context"),
        )
        system_message = self._build_system_message(bool(state.get("document_context")))
        result = await self.llm_service.generate_paragraph(
            user_prompt=prompt,
            model_type=state["model_type"],
            model_id=state.get("model_id"),
            deployment=state.get("deployment"),
            api_version=state.get("api_version"),
            max_tokens=4096,
            temperature=0.3,
            system_message=system_message,
        )
        if not result.get("success"):
            raise RuntimeError(result.get("error", "The model call failed. Please try again."))
        return {"messages": [AIMessage(content=result.get("content", ""))]}

    def _build_user_prompt(
        self,
        messages: List[BaseMessage],
        current_query: str,
        document_context: Optional[str],
    ) -> str:
        history_lines = []
        for message in messages[:-1]:
            if isinstance(message, HumanMessage):
                history_lines.append(f"User: {message.content}")
            elif isinstance(message, AIMessage):
                history_lines.append(f"Assistant: {message.content}")

        sections = []
        if history_lines:
            sections.append("Conversation so far:\n" + "\n".join(history_lines))
        if document_context:
            sections.append(
                "Current document context for this request:\n"
                f"{document_context}\n\n"
                "Use this context when it is relevant. Do not assume it remains attached in future turns unless it is provided again."
            )
        sections.append(f"User question: {current_query}")
        return "\n\n".join(sections)

    def _build_system_message(self, has_document_context: bool) -> str:
        if has_document_context:
            return (
                "You are a helpful document assistant for Health Canada support staff. "
                "Answer the user's question using the current document context and the remembered conversation. "
                "If the answer is not found in the document context, say so clearly and offer general guidance if possible."
            )
        return (
            "You are a helpful assistant for Health Canada support staff. "
            "Answer questions clearly and concisely using the remembered conversation when relevant."
        )
```

- [ ] **Step 3: Run service tests**

Run:

```bash
cd backend && python -m pytest tests/test_chat_memory_service.py -v
```

Expected: PASS for all three tests.

- [ ] **Step 4: Commit**

```bash
git add backend/services/chat_memory/__init__.py backend/services/chat_memory/chat_memory_service.py backend/tests/test_chat_memory_service.py
git commit -m "Add LangGraph chat memory service"
```

---

### Task 4: Add document-session context loader tests

**Files:**
- Create: `backend/services/chat_memory/document_context.py`
- Modify: `backend/tests/test_chat_memory_service.py`

- [ ] **Step 1: Add tests for attached session context**

Append to `backend/tests/test_chat_memory_service.py`:

```python
from services.chat_memory.document_context import build_attached_session_context


class FakeDocument:
    def __init__(self, file_hash, filename, processor_used="azure_doc_intelligence"):
        self.file_hash = file_hash
        self.filename = filename
        self.processor_used = processor_used


class FakeSession:
    def __init__(self):
        self.documents = [
            FakeDocument("hash-1", "protocol.pdf"),
            FakeDocument("hash-2", "consent.pdf"),
        ]


class FakeSessionService:
    def get_session(self, user_id, session_id):
        if session_id == "missing-session":
            return None
        return FakeSession()


class FakeFileService:
    async def get_processed_content(self, file_hash, processor):
        return f"markdown for {file_hash} via {processor}"


@pytest.mark.asyncio
async def test_build_attached_session_context_loads_session_documents():
    context = await build_attached_session_context(
        user_id="user-1",
        attached_session_id="session-1",
        session_service=FakeSessionService(),
        file_service=FakeFileService(),
    )

    assert '<document name="protocol.pdf" file_hash="hash-1">' in context
    assert "markdown for hash-1 via azure_doc_intelligence" in context
    assert '<document name="consent.pdf" file_hash="hash-2">' in context


@pytest.mark.asyncio
async def test_build_attached_session_context_returns_none_for_missing_session():
    context = await build_attached_session_context(
        user_id="user-1",
        attached_session_id="missing-session",
        session_service=FakeSessionService(),
        file_service=FakeFileService(),
    )

    assert context is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend && python -m pytest tests/test_chat_memory_service.py -v
```

Expected: FAIL with `ModuleNotFoundError` or missing `build_attached_session_context`.

---

### Task 5: Implement attached session context loading

**Files:**
- Create: `backend/services/chat_memory/document_context.py`
- Test: `backend/tests/test_chat_memory_service.py`

- [ ] **Step 1: Create context loader**

Create `backend/services/chat_memory/document_context.py`:

```python
from typing import Optional

from services.document.organized_file_service import get_organized_file_service
from services.session.session_service import get_session_service


async def build_attached_session_context(
    user_id: str,
    attached_session_id: Optional[str],
    session_service=None,
    file_service=None,
) -> Optional[str]:
    if not attached_session_id:
        return None

    session_service = session_service or get_session_service()
    file_service = file_service or get_organized_file_service()
    session = session_service.get_session(user_id, attached_session_id)
    if session is None:
        return None

    document_blocks = []
    for doc in session.documents:
        processor_used = doc.processor_used or "azure_doc_intelligence"
        markdown = await file_service.get_processed_content(doc.file_hash, processor_used)
        if not markdown:
            continue
        document_blocks.append(
            f'<document name="{doc.filename}" file_hash="{doc.file_hash}">\n'
            f"{markdown}\n"
            "</document>"
        )

    return "\n\n".join(document_blocks) if document_blocks else None
```

- [ ] **Step 2: Run tests**

Run:

```bash
cd backend && python -m pytest tests/test_chat_memory_service.py -v
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/services/chat_memory/document_context.py backend/tests/test_chat_memory_service.py
git commit -m "Load attached session context for chat"
```

---

### Task 6: Write failing chat router tests

**Files:**
- Create: `backend/tests/test_chat_router.py`

- [ ] **Step 1: Create route tests**

Create `backend/tests/test_chat_router.py`:

```python
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.chat import router as chat_router
from api.chat.router import ChatQueryRequest, chat_query


class FakeChatMemoryService:
    def __init__(self):
        self.requests = []

    async def invoke(self, request):
        self.requests.append(request)
        return {
            "success": True,
            "response": "remembered response",
            "chat_session_id": request.chat_session_id,
            "attached_session_id": request.attached_session_id,
        }


@pytest.mark.asyncio
async def test_chat_query_delegates_to_memory_service(monkeypatch):
    fake_service = FakeChatMemoryService()
    monkeypatch.setattr(chat_router, "chat_memory_service", fake_service)
    monkeypatch.setattr(chat_router, "build_attached_session_context", lambda **kwargs: None)

    response = await chat_query(
        ChatQueryRequest(
            chat_session_id="chat-1",
            query="hello",
            model_type="azure",
        ),
        current_user={"id": "user-1"},
    )

    assert response["success"] is True
    assert response["response"] == "remembered response"
    assert fake_service.requests[0].chat_session_id == "chat-1"
    assert fake_service.requests[0].query == "hello"


@pytest.mark.asyncio
async def test_chat_query_uses_attached_session_context(monkeypatch):
    fake_service = FakeChatMemoryService()

    async def fake_context(**kwargs):
        return '<document name="protocol.pdf">protocol markdown</document>'

    monkeypatch.setattr(chat_router, "chat_memory_service", fake_service)
    monkeypatch.setattr(chat_router, "build_attached_session_context", fake_context)

    await chat_query(
        ChatQueryRequest(
            chat_session_id="chat-1",
            attached_session_id="session-1",
            query="summarize",
            model_type="azure",
        ),
        current_user={"id": "user-1"},
    )

    assert fake_service.requests[0].attached_session_id == "session-1"
    assert "protocol markdown" in fake_service.requests[0].document_context
```

- [ ] **Step 2: Run route tests to verify they fail**

Run:

```bash
cd backend && python -m pytest tests/test_chat_router.py -v
```

Expected: FAIL because `ChatQueryRequest` does not accept `chat_session_id` and `chat_query` does not accept `current_user` directly.

---

### Task 7: Update chat route to use ChatMemoryService

**Files:**
- Modify: `backend/api/chat/router.py:3-73`
- Test: `backend/tests/test_chat_router.py`

- [ ] **Step 1: Replace route implementation**

Update `backend/api/chat/router.py` to:

```python
"""Chat API endpoint for support staff chatbot"""

from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from core.auth import get_current_user
from services.chat_memory import ChatMemoryRequest, ChatMemoryService
from services.chat_memory.document_context import build_attached_session_context

router = APIRouter(prefix="/api/chat", tags=["chat"])
chat_memory_service = ChatMemoryService()


class ChatQueryRequest(BaseModel):
    chat_session_id: str = Field(min_length=1)
    query: str = Field(min_length=1)
    document_markdown: Optional[str] = None
    attached_session_id: Optional[str] = None
    model_type: str
    model_id: Optional[str] = None
    deployment: Optional[str] = None
    api_version: Optional[str] = None


@router.post("/query", dependencies=[Depends(get_current_user)])
async def chat_query(
    request: ChatQueryRequest,
    current_user: dict = Depends(get_current_user),
):
    document_context = request.document_markdown
    if request.attached_session_id:
        attached_context = await build_attached_session_context(
            user_id=current_user["id"],
            attached_session_id=request.attached_session_id,
        )
        if attached_context is None:
            return JSONResponse(
                status_code=404,
                content={
                    "success": False,
                    "error": "Attached session not found or has no processed document content.",
                },
            )
        document_context = attached_context

    try:
        return await chat_memory_service.invoke(
            ChatMemoryRequest(
                chat_session_id=request.chat_session_id,
                attached_session_id=request.attached_session_id,
                query=request.query,
                document_context=document_context,
                model_type=request.model_type,
                model_id=request.model_id,
                deployment=request.deployment,
                api_version=request.api_version,
            )
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(exc) or "The model call failed. Please try again.",
            },
        )
```

- [ ] **Step 2: Run route tests**

Run:

```bash
cd backend && python -m pytest tests/test_chat_router.py -v
```

Expected: PASS.

- [ ] **Step 3: Run all chat memory backend tests**

Run:

```bash
cd backend && python -m pytest tests/test_chat_memory_service.py tests/test_chat_router.py -v
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/api/chat/router.py backend/tests/test_chat_router.py
git commit -m "Route chat requests through memory service"
```

---

### Task 8: Add frontend chat session utility

**Files:**
- Create: `frontend/utils/chatSession.ts`

- [ ] **Step 1: Create utility**

Create `frontend/utils/chatSession.ts`:

```ts
const CHAT_SESSION_STORAGE_KEY = "science-gpt.chat_session_id";

export function createChatSessionId(): string {
  return crypto.randomUUID();
}

export function getOrCreateChatSessionId(): string {
  const existing = sessionStorage.getItem(CHAT_SESSION_STORAGE_KEY);
  if (existing) return existing;
  const next = createChatSessionId();
  sessionStorage.setItem(CHAT_SESSION_STORAGE_KEY, next);
  return next;
}

export function resetChatSessionId(): string {
  const next = createChatSessionId();
  sessionStorage.setItem(CHAT_SESSION_STORAGE_KEY, next);
  return next;
}
```

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: TypeScript compilation succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/utils/chatSession.ts
git commit -m "Add frontend chat session id utility"
```

---

### Task 9: Send chat_session_id from ChatPage

**Files:**
- Modify: `frontend/components/ChatPage.tsx:1-619`

- [ ] **Step 1: Add imports**

In `frontend/components/ChatPage.tsx`, add this import near the existing utility imports:

```ts
import {
  getOrCreateChatSessionId,
  resetChatSessionId,
} from "../utils/chatSession";
```

- [ ] **Step 2: Add chat session state**

Inside `ChatPage`, after the existing `ratings` state, add:

```ts
const [chatSessionId, setChatSessionId] = useState(() =>
  getOrCreateChatSessionId()
);
```

- [ ] **Step 3: Include chat_session_id in request body**

In the `/api/chat/query` request body, add `chat_session_id` before `query`:

```ts
body: JSON.stringify({
  chat_session_id: chatSessionId,
  query,
  document_markdown: documentMarkdown,
  model_type: modelConfig.modelType,
  model_id: modelConfig.modelId,
  deployment: modelConfig.deployment ?? null,
  api_version: modelConfig.apiVersion ?? null,
}),
```

- [ ] **Step 4: Update sendQuery dependencies**

Change the `sendQuery` dependency array to include `chatSessionId`:

```ts
[chatSessionId, docs, getModelConfig]
```

- [ ] **Step 5: Add a New Chat handler**

Below `handleRegenerate`, add:

```ts
const handleNewChat = useCallback(() => {
  const nextSessionId = resetChatSessionId();
  setChatSessionId(nextSessionId);
  setMessages([]);
  setRatings({});
  setContextError(false);
}, []);
```

- [ ] **Step 6: Add a New Chat button**

In the header right actions before `Simplified Mode`, add:

```tsx
<Button
  variant="ghost"
  size="sm"
  className="h-8 text-xs text-muted-foreground"
  onClick={handleNewChat}
>
  New Chat
</Button>
```

- [ ] **Step 7: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: TypeScript compilation succeeds.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/ChatPage.tsx
git commit -m "Send independent chat session id"
```

---

### Task 10: Add optional history-session attachment UI

**Files:**
- Modify: `frontend/components/ChatPage.tsx:1-740`
- Reuse: `frontend/types/session.ts`

- [ ] **Step 1: Add imports**

Add these imports to `frontend/components/ChatPage.tsx`:

```ts
import { authenticatedFetch } from "../utils/authUtils";
import { SessionSummary } from "../types/session";
```

Keep the existing `getValidToken` import because upload/document calls still use it.

- [ ] **Step 2: Add attachment state**

Inside `ChatPage`, near document state, add:

```ts
const [historySessions, setHistorySessions] = useState<SessionSummary[]>([]);
const [sessionsLoading, setSessionsLoading] = useState(false);
const [attachedSessionId, setAttachedSessionId] = useState<string | null>(null);
```

- [ ] **Step 3: Fetch sessions for the selector**

Add this effect below the model-loading effect:

```ts
useEffect(() => {
  let cancelled = false;

  async function fetchSessions() {
    try {
      setSessionsLoading(true);
      const response = await authenticatedFetch("/api/sessions");
      if (!response.ok) throw new Error("Failed to fetch sessions");
      const data = await response.json();
      if (!cancelled) setHistorySessions(data.sessions ?? []);
    } catch {
      if (!cancelled) setHistorySessions([]);
    } finally {
      if (!cancelled) setSessionsLoading(false);
    }
  }

  fetchSessions();
  return () => {
    cancelled = true;
  };
}, []);
```

- [ ] **Step 4: Send attached_session_id in request body**

Add `attached_session_id` to the chat request body:

```ts
body: JSON.stringify({
  chat_session_id: chatSessionId,
  attached_session_id: attachedSessionId,
  query,
  document_markdown: documentMarkdown,
  model_type: modelConfig.modelType,
  model_id: modelConfig.modelId,
  deployment: modelConfig.deployment ?? null,
  api_version: modelConfig.apiVersion ?? null,
}),
```

- [ ] **Step 5: Update sendQuery dependencies**

Change the `sendQuery` dependency array to:

```ts
[attachedSessionId, chatSessionId, docs, getModelConfig]
```

- [ ] **Step 6: Add a session selector in the header**

In the header left area, after the model selector `</Select>`, add:

```tsx
<Select
  value={attachedSessionId ?? "none"}
  onValueChange={(value) => setAttachedSessionId(value === "none" ? null : value)}
  disabled={sessionsLoading}
>
  <SelectTrigger className="h-8 text-xs w-[190px] gap-1.5 pl-3 pr-3 focus-visible:ring-0 focus-visible:border-border">
    <SelectValue placeholder={sessionsLoading ? "Loading sessions" : "Attach history"} />
  </SelectTrigger>
  <SelectContent align="start" className="max-h-64">
    <SelectItem value="none" className="text-xs">
      No history attached
    </SelectItem>
    {historySessions.map((session) => (
      <SelectItem
        key={session.session_id}
        value={session.session_id}
        className="text-xs"
      >
        {session.name || session.document_names[0] || "Untitled Session"}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

- [ ] **Step 7: Clear attachment when starting a new chat**

Update `handleNewChat`:

```ts
const handleNewChat = useCallback(() => {
  const nextSessionId = resetChatSessionId();
  setChatSessionId(nextSessionId);
  setMessages([]);
  setRatings({});
  setContextError(false);
  setAttachedSessionId(null);
}, []);
```

- [ ] **Step 8: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: TypeScript compilation succeeds.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/ChatPage.tsx
git commit -m "Attach history sessions to chat requests"
```

---

### Task 11: Verify backend and frontend together

**Files:**
- Verify only; no expected file changes unless a prior task fails.

- [ ] **Step 1: Run backend chat tests**

Run:

```bash
cd backend && python -m pytest tests/test_chat_memory_service.py tests/test_chat_router.py -v
```

Expected: PASS.

- [ ] **Step 2: Run existing backend smoke test that does not require DB**

Run:

```bash
cd backend && python -m pytest tests/test_auth_migration.py::test_models_load -v
```

Expected: PASS and includes existing app tables.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 4: Run frontend lint if the repo already passes lint on this branch**

Run:

```bash
cd frontend && npm run lint
```

Expected: PASS. If lint fails on pre-existing unrelated files, capture the failure and do not fix unrelated lint issues.

- [ ] **Step 5: Manual browser validation**

Run the app locally with the usual backend and frontend dev commands, then verify:

1. Open Chat.
2. Send “Remember that my topic is licensing.”
3. Send “What is my topic?” and confirm the assistant remembers licensing.
4. Click New Chat.
5. Send “What is my topic?” and confirm the prior chat memory does not leak.
6. Attach a history session from the selector.
7. Ask a document-specific question and confirm the assistant uses attached document content.
8. Start another New Chat, attach the same history session, and confirm the document is available but prior conversation is not.

- [ ] **Step 6: Final commit if verification required fixes**

If verification required fixes, commit only those files:

```bash
git add <fixed-files>
git commit -m "Fix chat memory verification issues"
```

---

## Self-Review

Spec coverage:

- Independent `chat_session_id` memory: Tasks 2, 3, 8, 9, and 11.
- LangGraph checkpointing: Tasks 1 and 3.
- Optional `attached_session_id`: Tasks 4, 5, 7, 10, and 11.
- No full document markdown in persistent memory: Tasks 2, 3, and 5.
- Existing history/session source of truth: Tasks 4, 5, 7, and 10.
- Testing and manual validation: Tasks 2, 4, 6, 11.

Placeholder scan: no `TBD`, `TODO`, “implement later”, or unspecified code steps remain.

Type consistency:

- Backend request field is `chat_session_id` everywhere.
- Optional attachment field is `attached_session_id` everywhere.
- Frontend utility names are `getOrCreateChatSessionId` and `resetChatSessionId` everywhere.
- LangGraph thread config uses `thread_id = chat_session_id`.
