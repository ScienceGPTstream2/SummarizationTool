from __future__ import annotations

import asyncio
import atexit
import inspect
import weakref
from dataclasses import dataclass
from typing import Annotated, Any, Dict, List, Optional, TypedDict

from services.llm.llm_service import LLMService

LANGGRAPH_INSTALL_MESSAGE = (
    "LangGraph chat memory dependencies are unavailable. "
    "Install backend requirements and retry."
)
GENERIC_MODEL_ERROR_MESSAGE = "The model call failed. Please try again."


class ModelProviderError(Exception):
    pass

try:
    from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
    from langchain_core.runnables import RunnableConfig

    LANGCHAIN_MESSAGES_IMPORT_ERROR: Optional[ImportError] = None
except ImportError as exc:
    AIMessage = BaseMessage = HumanMessage = RunnableConfig = Any  # type: ignore[assignment]
    LANGCHAIN_MESSAGES_IMPORT_ERROR = exc

try:
    from langgraph.graph import END, START, StateGraph
    from langgraph.graph.message import add_messages

    LANGGRAPH_GRAPH_IMPORT_ERROR: Optional[ImportError] = None
except ImportError as exc:
    END = "__end__"
    START = "__start__"
    StateGraph = None
    LANGGRAPH_GRAPH_IMPORT_ERROR = exc

    def add_messages(existing: List[Any], new: List[Any]) -> List[Any]:
        return [*(existing or []), *(new or [])]


try:
    from langgraph.checkpoint.memory import InMemorySaver as LangGraphInMemorySaver

    LANGGRAPH_MEMORY_IMPORT_ERROR: Optional[ImportError] = None
except ImportError:
    try:
        from langgraph.checkpoint.memory import MemorySaver as LangGraphInMemorySaver

        LANGGRAPH_MEMORY_IMPORT_ERROR = None
    except ImportError as exc:
        LangGraphInMemorySaver = None
        LANGGRAPH_MEMORY_IMPORT_ERROR = exc


@dataclass
class ChatMemoryRequest:
    user_id: str
    chat_session_id: str
    query: str
    model_type: str
    model_id: Optional[str] = None
    deployment: Optional[str] = None
    api_version: Optional[str] = None
    document_context: Optional[str] = None


class ChatState(TypedDict):
    messages: Annotated[List[BaseMessage], add_messages]


class ChatMemoryService:
    def __init__(
        self,
        llm_service: Optional[LLMService] = None,
        checkpointer: Optional[Any] = None,
        use_memory_checkpointer: bool = False,
    ):
        self.llm_service = llm_service or LLMService()
        self._use_memory_checkpointer = use_memory_checkpointer
        self._async_checkpointer_context = None
        self._did_register_atexit_close = False
        self._initialization_lock = asyncio.Lock()
        self._session_locks: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()
        self._ensure_langgraph_dependencies(require_in_memory=use_memory_checkpointer)
        self.checkpointer = checkpointer
        self.graph = self._build_graph(checkpointer) if checkpointer is not None else None

    def _ensure_langgraph_dependencies(self, require_in_memory: bool = False) -> None:
        import_errors: List[str] = []

        if LANGCHAIN_MESSAGES_IMPORT_ERROR is not None:
            import_errors.append(f"langchain_core.messages: {LANGCHAIN_MESSAGES_IMPORT_ERROR}")
        if LANGGRAPH_GRAPH_IMPORT_ERROR is not None:
            import_errors.append(f"langgraph.graph: {LANGGRAPH_GRAPH_IMPORT_ERROR}")
        if require_in_memory and LANGGRAPH_MEMORY_IMPORT_ERROR is not None:
            import_errors.append(
                f"langgraph.checkpoint.memory: {LANGGRAPH_MEMORY_IMPORT_ERROR}"
            )

        if import_errors:
            details = "; ".join(import_errors)
            raise RuntimeError(f"{LANGGRAPH_INSTALL_MESSAGE} Import errors: {details}")

    def _get_async_postgres_saver_class(self) -> Any:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

        return AsyncPostgresSaver

    async def _build_checkpointer(self) -> Any:
        if self._use_memory_checkpointer:
            return self._build_in_memory_checkpointer()

        try:
            AsyncPostgresSaver = self._get_async_postgres_saver_class()
        except Exception as exc:
            raise RuntimeError(
                f"Failed to import LangGraph Postgres checkpointer: {exc}"
            ) from exc

        try:
            from models.base import DATABASE_URL

            saver_context = AsyncPostgresSaver.from_conn_string(DATABASE_URL)
            self._async_checkpointer_context = saver_context
            saver = await saver_context.__aenter__()
            self._register_checkpointer_cleanup()
            if hasattr(saver, "setup"):
                setup_result = saver.setup()
                if inspect.isawaitable(setup_result):
                    await setup_result
            return saver
        except Exception as exc:
            await self._close_async_checkpointer_context()
            raise RuntimeError(
                f"Failed to initialize LangGraph Postgres checkpointer: {exc}"
            ) from exc

    def _register_checkpointer_cleanup(self) -> None:
        if self._did_register_atexit_close:
            return
        atexit.register(self._close_checkpointer_context_at_exit)
        self._did_register_atexit_close = True

    def _close_checkpointer_context_at_exit(self) -> None:
        if self._async_checkpointer_context is None:
            return
        try:
            asyncio.run(self._close_async_checkpointer_context())
        except Exception:
            pass

    async def _close_async_checkpointer_context(self) -> None:
        if self._async_checkpointer_context is None:
            return
        try:
            await self._async_checkpointer_context.__aexit__(None, None, None)
        except Exception:
            pass
        finally:
            self._async_checkpointer_context = None

    def _build_in_memory_checkpointer(self) -> Any:
        if LangGraphInMemorySaver is None:
            detail = (
                str(LANGGRAPH_MEMORY_IMPORT_ERROR)
                if LANGGRAPH_MEMORY_IMPORT_ERROR is not None
                else "LangGraph in-memory saver is unavailable."
            )
            raise RuntimeError(
                f"{LANGGRAPH_INSTALL_MESSAGE} Unable to import LangGraph in-memory saver: {detail}"
            ) from LANGGRAPH_MEMORY_IMPORT_ERROR
        return LangGraphInMemorySaver()

    def _build_graph(self, checkpointer: Any) -> Any:
        self._ensure_langgraph_dependencies()

        graph = StateGraph(ChatState)
        graph.add_node("generate", self._generate_response)
        graph.add_edge(START, "generate")
        graph.add_edge("generate", END)
        return graph.compile(checkpointer=checkpointer)

    async def _ensure_graph(self) -> Any:
        if self.graph is not None:
            return self.graph

        async with self._initialization_lock:
            if self.graph is not None:
                return self.graph

            checkpointer = self.checkpointer or await self._build_checkpointer()
            self.checkpointer = checkpointer
            self.graph = self._build_graph(checkpointer)
            return self.graph

    def _get_session_lock(self, chat_session_id: str) -> asyncio.Lock:
        lock = self._session_locks.get(chat_session_id)
        if lock is None:
            lock = asyncio.Lock()
            self._session_locks[chat_session_id] = lock
        return lock

    def _build_thread_id(self, user_id: str, chat_session_id: str) -> str:
        return f"user:{user_id}:chat:{chat_session_id}"

    async def invoke(self, request: ChatMemoryRequest) -> Dict[str, Any]:
        thread_id = self._build_thread_id(request.user_id, request.chat_session_id)
        config = {
            "configurable": {
                "thread_id": thread_id,
                "model_type": request.model_type,
                "model_id": request.model_id,
                "deployment": request.deployment,
                "api_version": request.api_version,
                "document_context": request.document_context,
            }
        }
        lock = self._get_session_lock(thread_id)
        graph = await self._ensure_graph()

        try:
            async with lock:
                starting_state = await graph.aget_state(config)
                state_config = getattr(starting_state, "config", None) or config
                prior_messages = list(starting_state.values.get("messages", []))
                next_messages = [*prior_messages, HumanMessage(content=request.query)]
                result = await self._generate_response(
                    {
                        "messages": next_messages,
                    },
                    config=config,
                )
                ai_messages = result.get("messages", [])
                persisted_config = await graph.aupdate_state(
                    state_config,
                    {
                        "messages": [*next_messages, *ai_messages],
                    },
                    as_node="generate",
                )
                persisted_state = await graph.aget_state(persisted_config)
                response = self._extract_ai_response(persisted_state.values.get("messages", []))
                return {
                    "success": True,
                    "response": response,
                    "chat_session_id": request.chat_session_id,
                }
        except ModelProviderError:
            return {
                "success": False,
                "response": "",
                "chat_session_id": request.chat_session_id,
                "error": GENERIC_MODEL_ERROR_MESSAGE,
            }

    async def _generate_response(
        self,
        state: ChatState,
        config: Optional[RunnableConfig] = None,
    ) -> Dict[str, Any]:
        configurable = (config or {}).get("configurable", {})
        prompt = self._build_user_prompt(
            messages=state.get("messages", []),
            document_context=configurable.get("document_context"),
        )
        system_message = self._build_system_message(
            has_document_context=bool(configurable.get("document_context"))
        )

        try:
            result = await self.llm_service.generate_paragraph(
                user_prompt=prompt,
                model_type=configurable["model_type"],
                model_id=configurable.get("model_id"),
                deployment=configurable.get("deployment"),
                api_version=configurable.get("api_version"),
                max_tokens=4096,
                temperature=0.3,
                system_message=system_message,
            )
        except Exception as exc:
            raise ModelProviderError(GENERIC_MODEL_ERROR_MESSAGE) from exc
        if not result.get("success"):
            raise ModelProviderError(str(result.get("error", GENERIC_MODEL_ERROR_MESSAGE)))

        return {"messages": [AIMessage(content=str(result.get("content", "")))]}

    def _build_user_prompt(
        self,
        messages: List[BaseMessage],
        document_context: Optional[str],
    ) -> str:
        history_lines: List[str] = []
        current_query = ""

        for index, message in enumerate(messages):
            is_last = index == len(messages) - 1
            if isinstance(message, HumanMessage):
                if is_last:
                    current_query = str(message.content)
                else:
                    history_lines.append(f"User: {message.content}")
            elif isinstance(message, AIMessage):
                history_lines.append(f"Assistant: {message.content}")

        sections: List[str] = []
        if history_lines:
            sections.append("Conversation so far:\n" + "\n".join(history_lines))
        if document_context:
            sections.append(
                "Current document context for this request:\n"
                f"{document_context}\n\n"
                "Use this context when it is relevant. Do not assume it remains available in future turns unless it is provided again."
            )
        sections.append(f"User question: {current_query}")
        return "\n\n".join(sections)

    def _build_system_message(self, has_document_context: bool) -> str:
        if has_document_context:
            return (
                "You are a helpful document assistant for Health Canada support staff. "
                "Answer the user's question using the current document context and remembered conversation. "
                "If the answer is not found in the document context, say so clearly and offer general guidance if possible."
            )
        return (
            "You are a helpful assistant for Health Canada support staff. "
            "Answer questions clearly and concisely using remembered conversation when relevant."
        )

    def _extract_ai_response(self, messages: List[BaseMessage]) -> str:
        for message in reversed(messages):
            if isinstance(message, AIMessage):
                return str(message.content)
        return ""
