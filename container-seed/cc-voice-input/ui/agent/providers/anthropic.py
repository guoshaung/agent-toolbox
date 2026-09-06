"""Anthropic provider using the native Anthropic SDK."""

from __future__ import annotations

import json
from typing import Any

import anthropic
from loguru import logger

from ui.agent.providers.base import LLMProvider, LLMResponse, LLMUsage, OnDelta, ToolCallRequest

_DEFAULT_MODEL = "claude-sonnet-4-5"
_IDLE_TIMEOUT = 90.0


class AnthropicProvider(LLMProvider):

    def __init__(
        self,
        api_key: str | None = None,
        api_base: str | None = None,
    ) -> None:
        kwargs: dict[str, Any] = {"max_retries": 0, "timeout": 120.0}
        if api_key:
            kwargs["api_key"] = api_key
        if api_base:
            kwargs["base_url"] = api_base
        self._client = anthropic.AsyncAnthropic(**kwargs)

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
        on_reasoning_delta: "Any" = None,
    ) -> LLMResponse:
        # reasoning_effort / on_reasoning_delta accepted for interface
        # parity; Anthropic extended thinking wiring lands in a later patch.
        _ = reasoning_effort
        _ = on_reasoning_delta
        clean = self.sanitize_messages(messages)
        anthropic_messages = self._convert_messages(clean)
        kwargs: dict[str, Any] = {
            "model": model.removeprefix("anthropic/"),
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": anthropic_messages,
        }
        if system:
            kwargs["system"] = system
        if tools:
            kwargs["tools"] = self._convert_tools(tools)
        # print('========', json.dumps(kwargs, ensure_ascii=False))
        try:
            if on_content_delta:
                return await self._stream(kwargs, on_content_delta)
            return await self._complete(kwargs)
        except anthropic.APIStatusError as e:
            logger.error("Anthropic API error {}: {}", e.status_code, e.message)
            raise
        except Exception as e:
            logger.error("Anthropic call failed: {}", e)
            raise

    # ------------------------------------------------------------------
    # Non-streaming
    # ------------------------------------------------------------------

    async def _complete(self, kwargs: dict) -> LLMResponse:
        resp = await self._client.messages.create(**kwargs)
        return self._parse_response(resp)

    # ------------------------------------------------------------------
    # Streaming
    # ------------------------------------------------------------------

    async def _stream(self, kwargs: dict, on_content_delta: OnDelta) -> LLMResponse:
        import asyncio
        accumulated_text = ""
        async with self._client.messages.stream(**kwargs) as stream:
            async for event in stream:
                if (
                    hasattr(event, "type")
                    and event.type == "content_block_delta"
                    and hasattr(event, "delta")
                    and hasattr(event.delta, "text")
                ):
                    chunk = event.delta.text
                    accumulated_text += chunk
                    await on_content_delta(chunk)
            final = await stream.get_final_message()
        return self._parse_response(final, override_content=accumulated_text)

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    def _parse_response(
        self, resp: Any, override_content: str | None = None
    ) -> LLMResponse:
        content = override_content or ""
        tool_calls: list[ToolCallRequest] = []

        for block in resp.content:
            if block.type == "text" and not override_content:
                content += block.text
            elif block.type == "tool_use":
                args = block.input if isinstance(block.input, dict) else {}
                tool_calls.append(ToolCallRequest(
                    id=block.id,
                    name=block.name,
                    arguments=args,
                ))

        stop_reason = resp.stop_reason or "stop"
        finish_reason = "tool_calls" if stop_reason == "tool_use" else (
            "length" if stop_reason == "max_tokens" else "stop"
        )

        usage = self._extract_usage(resp.usage)

        return LLMResponse(
            content=content,
            tool_calls=tool_calls,
            finish_reason=finish_reason,
            usage=usage,
        )

    @staticmethod
    def _extract_usage(raw: Any) -> LLMUsage:
        if raw is None:
            return LLMUsage()
        input_tokens = getattr(raw, "input_tokens", 0) or 0
        output_tokens = getattr(raw, "output_tokens", 0) or 0
        cache_creation = getattr(raw, "cache_creation_input_tokens", 0) or 0
        cache_read = getattr(raw, "cache_read_input_tokens", 0) or 0
        # The three input buckets are mutually exclusive; sum them so
        # prompt_tokens matches OpenAI semantics ("total prompt size sent").
        prompt_tokens = input_tokens + cache_creation + cache_read
        return LLMUsage(
            prompt_tokens=prompt_tokens,
            completion_tokens=output_tokens,
            total_tokens=prompt_tokens + output_tokens,
            cached_tokens=cache_read,
            cache_creation_tokens=cache_creation,
        )

    # ------------------------------------------------------------------
    # Message conversion  (OpenAI format → Anthropic format)
    # ------------------------------------------------------------------

    def _convert_messages(self, messages: list[dict]) -> list[dict]:
        result = []
        for msg in messages:
            role = msg["role"]
            content = msg.get("content") or ""

            if role == "tool":
                # Tool result → user message with tool_result block
                result.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": msg.get("tool_call_id", ""),
                        "content": content,
                    }],
                })
            elif role == "assistant" and msg.get("tool_calls"):
                # Assistant with tool calls → mixed content block
                blocks: list[dict] = []
                if content:
                    blocks.append({"type": "text", "text": content})
                for tc in msg["tool_calls"]:
                    fn = tc.get("function", {})
                    args = fn.get("arguments", "{}")
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except json.JSONDecodeError:
                            args = {}
                    blocks.append({
                        "type": "tool_use",
                        "id": tc.get("id", ""),
                        "name": fn.get("name", ""),
                        "input": args,
                    })
                result.append({"role": "assistant", "content": blocks})
            elif isinstance(content, list):
                # Multimodal content (e.g. text + images)
                converted: list[dict] = []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "image_url":
                        converted.append(self._convert_image_block(block))
                    else:
                        converted.append(block)
                result.append({"role": role, "content": converted})
            else:
                result.append({"role": role, "content": content})

        # Merge consecutive same-role messages (Anthropic requirement)
        merged: list[dict] = []
        for msg in result:
            if merged and merged[-1]["role"] == msg["role"]:
                prev = merged[-1]
                if isinstance(prev["content"], str) and isinstance(msg["content"], str):
                    prev["content"] += "\n" + msg["content"]
                elif isinstance(prev["content"], list) and isinstance(msg["content"], list):
                    prev["content"].extend(msg["content"])
            else:
                merged.append(msg)

        return merged

    def _convert_image_block(self, block: dict) -> dict:
        """Convert OpenAI image_url block → Anthropic image block."""
        url = block.get("image_url", {}).get("url", "")
        if url.startswith("data:"):
            parts = url.split(";base64,", 1)
            media_type = parts[0][5:]  # strip "data:"
            data = parts[1] if len(parts) > 1 else ""
            return {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}}
        return {"type": "image", "source": {"type": "url", "url": url}}

    def _convert_tools(self, tools: list[dict]) -> list[dict]:
        result = []
        for t in tools:
            fn = t.get("function", t)
            result.append({
                "name": fn.get("name", ""),
                "description": fn.get("description", ""),
                "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
            })
        return result
