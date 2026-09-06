"""LLM provider abstraction."""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


@dataclass
class ToolCallRequest:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class LLMUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    # Prompt tokens served from cache. Normalized across providers:
    # Anthropic cache_read_input_tokens, OpenAI prompt_tokens_details.cached_tokens,
    # DeepSeek prompt_cache_hit_tokens, Moonshot/StepFun top-level cached_tokens.
    cached_tokens: int = 0
    # Anthropic-only: tokens spent writing to prompt cache.
    cache_creation_tokens: int = 0
    # OpenAI reasoning models (o-series / gpt-5): internal reasoning tokens
    # billed as completion. Exposed via completion_tokens_details.reasoning_tokens.
    reasoning_tokens: int = 0


@dataclass
class LLMResponse:
    content: str
    tool_calls: list[ToolCallRequest] = field(default_factory=list)
    # "stop" | "tool_calls" | "length" | "error"
    finish_reason: str = "stop"
    usage: LLMUsage = field(default_factory=LLMUsage)
    # Internal reasoning/thinking text exposed by reasoning models
    # (DeepSeek-R1, Kimi K1.5, Qwen3-thinking, OpenAI o-series via reasoning summaries,
    # OpenRouter normalized `reasoning` field). None when the model didn't return any.
    reasoning_content: str | None = None


OnDelta = Callable[[str], Awaitable[None]]
OnReasoningDelta = Callable[[str], Awaitable[None]]


class LLMProvider(ABC):
    """Abstract LLM provider. One implementation per backend."""

    @abstractmethod
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
            on_reasoning_delta: OnReasoningDelta | None = None,
    ) -> LLMResponse:
        """Send messages to the LLM and return the response.

        on_content_delta: optional async callback invoked with each text chunk
        during streaming. If the provider supports streaming it will be called
        incrementally; otherwise it receives the full content at once.
        """

    @classmethod
    def sanitize_messages(cls, messages: list[dict]) -> list[dict]:

        clean: list[dict[str, Any]] = []

        for msg in messages:
            role = msg.get("role")
            if not role:
                continue

            content = msg.get("content", "")

            if isinstance(content, list):
                content = cls._clean_content_blocks(content)
                if not content:
                    content = ""
            elif isinstance(content, dict):
                content = cls._clean_content_blocks([content])
                if not content:
                    content = ""

            entry: dict[str, Any] = {"role": role, "content": content}
            if "tool_calls" in msg:
                entry["tool_calls"] = msg["tool_calls"]
            if "tool_call_id" in msg:
                entry["tool_call_id"] = msg["tool_call_id"]
            if "name" in msg:
                entry["name"] = msg["name"]

            # 严格网关(Zhipu / vLLM)拒绝 assistant 同时带 content+tool_calls
            if entry["role"] == "assistant" and entry.get("tool_calls"):
                entry["content"] = None

            # 是否允许合并:仅 user/assistant,且两边都没 tool_calls
            prev = clean[-1] if clean else None
            can_merge = bool(
                prev
                and prev["role"] == role
                and role in {"user", "assistant"}
                and not prev.get("tool_calls")
                and not entry.get("tool_calls")
            )

            if not can_merge:
                clean.append(entry)
                continue

            # merge content
            pc, cc = prev["content"], entry["content"]
            if isinstance(pc, list) and isinstance(cc, list):
                prev["content"] = pc + cc
            elif isinstance(pc, list):
                if cc:
                    prev["content"] = pc + [{"type": "text", "text": str(cc)}]
            elif isinstance(cc, list):
                blocks = []
                if pc:
                    blocks.append({"type": "text", "text": str(pc)})
                prev["content"] = blocks + cc
            else:
                if pc and cc:
                    prev["content"] = f"{pc}\n{cc}"
                else:
                    prev["content"] = pc or cc or ""

        first_user_idx = next((i for i, m in enumerate(clean) if m["role"] == "user"), None, )

        if first_user_idx is not None:
            clean = clean[first_user_idx:]
        else:
            clean = []

        if not clean:
            clean.append({"role": "user", "content": "(继续)"})

        return clean

    @staticmethod
    def _clean_content_blocks(content: list) -> list:
        """Strip ``_meta`` and drop empty text blocks. Pass through unchanged
        when no rewrite is needed so existing references stay shared."""
        changed = False
        out: list = []
        for b in content:
            if isinstance(b, dict):
                if b.get("type") in ("text", "input_text", "output_text") and not b.get("text"):
                    changed = True
                    continue
                if "_meta" in b:
                    b = {k: v for k, v in b.items() if k != "_meta"}
                    changed = True
            out.append(b)
        return out if changed else content
