"""Mock LLM provider for testing without real API keys."""

from __future__ import annotations

from ui.agent.providers.base import LLMProvider, LLMResponse, OnDelta


class MockProvider(LLMProvider):
    """Returns canned responses. Useful for testing the full pipeline."""

    async def chat(
        self,
        messages: list[dict],
        *,
        model: str,
        system: str = "",
        tools: list[dict] | None = None,
        max_tokens: int = 8192,
        temperature: float = 0.1,
        reasoning_effort: str | None = None,
        on_content_delta: OnDelta | None = None,
        on_reasoning_delta=None,
    ) -> LLMResponse:
        last_user = next(
            (m["content"] for m in reversed(messages) if m["role"] == "user"), ""
        )
        history_len = sum(1 for m in messages if m["role"] == "assistant")
        content = (
            f"[{model}] 这是第 {history_len + 1} 轮对话。"
            f"你说的是：「{last_user[:60]}」"
        )
        if on_content_delta:
            await on_content_delta(content)
        return LLMResponse(content=content)
