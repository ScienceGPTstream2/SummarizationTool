import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.chat_memory.chat_memory_service import (  # noqa: E402
    MAX_HISTORY_MESSAGES_IN_PROMPT,
    AIMessage,
    ChatMemoryRequest,
    ChatMemoryService,
    HumanMessage,
)


class FakeLLMService:
    def __init__(self):
        self.prompts = []
        self.summary_prompts = []

    async def generate_paragraph(self, **kwargs):
        user_prompt = kwargs["user_prompt"]
        if user_prompt.startswith("Update the rolling summary"):
            self.summary_prompts.append(kwargs)
            return {
                "success": True,
                "content": "The user previously established that the project codename is Maple.",
            }

        self.prompts.append(kwargs)
        return {"success": True, "content": "Assistant response."}


class FakeGraph:
    def __init__(self):
        self.ainvoke_calls = []

    async def ainvoke(self, graph_input, config):
        self.ainvoke_calls.append((graph_input, config))
        query = config["configurable"]["query"]
        return {
            "messages": [
                HumanMessage(content=query),
                AIMessage(content="Assistant response."),
            ],
            "context_usage": {"estimated_tokens": 12},
        }


@pytest.mark.asyncio
async def test_invoke_runs_chat_turn_through_langgraph():
    service = ChatMemoryService(
        llm_service=FakeLLMService(),
        use_memory_checkpointer=True,
    )
    fake_graph = FakeGraph()
    service.graph = fake_graph

    result = await service.invoke(
        ChatMemoryRequest(
            user_id="user-1",
            chat_session_id="chat-1",
            query="What is my name?",
            model_type="azure",
        )
    )

    assert result["success"] is True
    assert result["response"] == "Assistant response."
    assert len(fake_graph.ainvoke_calls) == 1

    graph_input, config = fake_graph.ainvoke_calls[0]
    assert graph_input == {}
    assert config["configurable"]["thread_id"] == "user:user-1:chat:chat-1"
    assert config["configurable"]["model_type"] == "azure"
    assert config["configurable"]["query"] == "What is my name?"


@pytest.mark.asyncio
async def test_old_messages_are_summarized_and_included_in_prompt():
    fake_llm = FakeLLMService()
    service = ChatMemoryService(
        llm_service=fake_llm,
        use_memory_checkpointer=True,
    )

    total_turns = (MAX_HISTORY_MESSAGES_IN_PROMPT // 2) + 3
    for index in range(total_turns):
        await service.invoke(
            ChatMemoryRequest(
                user_id="user-1",
                chat_session_id="chat-1",
                query=f"Question {index}",
                model_type="azure",
            )
        )

    assert fake_llm.summary_prompts
    latest_prompt = fake_llm.prompts[-1]["user_prompt"]
    assert "Summary of earlier conversation:" in latest_prompt
    assert "project codename is Maple" in latest_prompt
    assert "Question 0" not in latest_prompt


@pytest.mark.asyncio
async def test_chat_history_detail_includes_context_usage_and_question_metadata():
    fake_llm = FakeLLMService()
    service = ChatMemoryService(
        llm_service=fake_llm,
        use_memory_checkpointer=True,
    )

    await service.invoke(
        ChatMemoryRequest(
            user_id="user-1",
            chat_session_id="chat-1",
            query="What is PMRA?",
            model_type="azure",
        )
    )

    detail = await service.get_chat_session(
        user_id="user-1",
        chat_session_id="chat-1",
    )
    assert detail is not None
    assert detail["context_usage"]["estimated_tokens"] > 0

    assert service._build_chat_title(detail["messages"]) == "What is PMRA?"
    assert service._build_chat_history_metadata(detail["messages"]) == "1 question"
    assert "Assistant response" not in service._build_chat_history_metadata(
        detail["messages"]
    )


@pytest.mark.asyncio
async def test_summary_failure_does_not_mark_messages_as_summarized():
    class FailingSummaryLLM(FakeLLMService):
        async def generate_paragraph(self, **kwargs):
            user_prompt = kwargs["user_prompt"]
            if user_prompt.startswith("Update the rolling summary"):
                self.summary_prompts.append(kwargs)
                return {"success": False, "error": "summary unavailable"}
            return await super().generate_paragraph(**kwargs)

    fake_llm = FailingSummaryLLM()
    service = ChatMemoryService(
        llm_service=fake_llm,
        use_memory_checkpointer=True,
    )

    for index in range((MAX_HISTORY_MESSAGES_IN_PROMPT // 2) + 2):
        await service.invoke(
            ChatMemoryRequest(
                user_id="user-1",
                chat_session_id="chat-1",
                query=f"Question {index}",
                model_type="azure",
            )
        )

    graph = await service._ensure_graph()
    state = await graph.aget_state(
        {"configurable": {"thread_id": service._build_thread_id("user-1", "chat-1")}}
    )

    assert fake_llm.summary_prompts
    assert state.values.get("conversation_summary") in (None, "")
    assert state.values.get("summarized_message_count") in (None, 0)


def test_context_usage_reports_small_nonzero_percentages():
    service = ChatMemoryService(use_memory_checkpointer=True)

    context_usage = service._build_context_usage(
        user_prompt="What is PMRA?",
        system_message="You are a helpful assistant.",
        messages=[],
        conversation_summary="",
        document_context=None,
        model_type="gemini",
        model_id=None,
        deployment=None,
    )

    assert context_usage["estimated_tokens"] > 0
    assert 0 < context_usage["percentage"] < 0.1


def test_context_window_cohere():
    service = ChatMemoryService(use_memory_checkpointer=True)

    context_usage = service._build_context_usage(
        user_prompt="test",
        system_message="",
        messages=[],
        conversation_summary="",
        document_context=None,
        model_type="cohere",
        model_id=None,
        deployment=None,
    )

    assert context_usage["max_tokens"] == 256_000
