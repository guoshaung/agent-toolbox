"""OpenAI-compatible provider (covers OpenAI, OpenRouter, custom endpoints)."""

from __future__ import annotations

import json
from typing import Any

import openai as openai_sdk
from loguru import logger

from ui.agent.providers.base import LLMProvider, LLMResponse, LLMUsage, OnDelta, OnReasoningDelta, ToolCallRequest


class OpenAIProvider(LLMProvider):

    def __init__(
            self,
            api_key: str | None = None,
            api_base: str | None = None,
            extra_headers: dict[str, str] | None = None,
    ) -> None:
        kwargs: dict[str, Any] = {"max_retries": 0}
        if api_key:
            kwargs["api_key"] = api_key
        if api_base:
            kwargs["base_url"] = api_base
        if extra_headers:
            kwargs["default_headers"] = extra_headers
        self._client = openai_sdk.AsyncOpenAI(**kwargs)

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
        clean = self.sanitize_messages(messages)

        all_messages: list[dict] = []
        if system:
            all_messages.append({"role": "system", "content": system})
        all_messages.extend(clean)

        print('====', all_messages, max_tokens)

        kwargs: dict[str, Any] = {
            "model": model,
            "messages": all_messages,
            "max_tokens": max_tokens,
        }
        if reasoning_effort:
            # Thinking-mode requests (DeepSeek V4, OpenAI o-series) reject
            # temperature / top_p / penalties. They want reasoning_effort
            # and, for OpenAI-compatible gateways like DeepSeek that
            # require an opt-in, an extra_body thinking flag.
            kwargs["reasoning_effort"] = reasoning_effort
            kwargs["extra_body"] = {"thinking": {"type": "enabled"}}
        else:
            kwargs["temperature"] = temperature
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        try:
            if on_content_delta or on_reasoning_delta:
                return await self._stream(kwargs, on_content_delta, on_reasoning_delta)
            return await self._complete(kwargs)
        except openai_sdk.APIStatusError as e:
            logger.error("OpenAI API error {}: {}", e.status_code, e.message)
            raise
        except Exception as e:
            logger.error("OpenAI call failed: {}", e)
            raise

    # ------------------------------------------------------------------
    # Non-streaming
    # ------------------------------------------------------------------

    async def _complete(self, kwargs: dict) -> LLMResponse:
        resp = await self._client.chat.completions.create(**kwargs)
        return self._parse_response(resp)

    # ------------------------------------------------------------------
    # Streaming
    # ------------------------------------------------------------------

    async def _stream(
            self,
            kwargs: dict,
            on_content_delta: OnDelta | None,
            on_reasoning_delta: OnReasoningDelta | None,
    ) -> LLMResponse:
        accumulated_text = ""
        accumulated_reasoning = ""
        chunks: list[Any] = []

        # Force usage emission on the terminal chunk; some backends (vLLM,
        # Ollama, older OpenAI-compat gateways) omit it otherwise.
        stream_kwargs = {**kwargs, "stream": True, "stream_options": {"include_usage": True}}
        async with await self._client.chat.completions.create(**stream_kwargs) as stream:
            async for chunk in stream:
                chunks.append(chunk)
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if not delta:
                    continue
                if delta.content:
                    accumulated_text += delta.content
                    if on_content_delta:
                        await on_content_delta(delta.content)
                # Reasoning models surface a separate stream of CoT tokens.
                # DeepSeek/Kimi/MiMo emit `reasoning_content`; OpenRouter
                # normalises it as `reasoning`. Read both, prefer the first.
                r_delta = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None)
                if isinstance(r_delta, str) and r_delta:
                    accumulated_reasoning += r_delta
                    if on_reasoning_delta:
                        await on_reasoning_delta(r_delta)

        return self._parse_chunks(
            chunks,
            override_content=accumulated_text,
            override_reasoning=accumulated_reasoning,
        )

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    def _parse_response(self, resp: Any) -> LLMResponse:
        choice = resp.choices[0]
        msg = choice.message
        content = msg.content or ""
        tool_calls = self._extract_tool_calls(msg.tool_calls or [])
        finish_reason = self._map_finish_reason(choice.finish_reason)
        usage = self._extract_usage(resp.usage)
        # `reasoning_content` is the field DeepSeek-R1/Kimi/MiMo/Qwen3-thinking emit;
        # `reasoning` is OpenRouter's normalized name. Read both, prefer the first.
        reasoning = getattr(msg, "reasoning_content", None) or getattr(msg, "reasoning", None)
        return LLMResponse(
            content=content,
            tool_calls=tool_calls,
            finish_reason=finish_reason,
            usage=usage,
            reasoning_content=reasoning if isinstance(reasoning, str) and reasoning else None,
        )

    def _parse_chunks(
            self,
            chunks: list[Any],
            override_content: str,
            override_reasoning: str = "",
    ) -> LLMResponse:
        finish_reason = "stop"
        tc_bufs: dict[int, dict] = {}

        for chunk in chunks:
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            if choice.finish_reason:
                finish_reason = self._map_finish_reason(choice.finish_reason)
            delta = choice.delta
            for tc in (delta.tool_calls or []):
                buf = tc_bufs.setdefault(tc.index, {
                    "id": "", "name": "", "arguments": "",
                })
                if tc.id:
                    buf["id"] = tc.id
                if tc.function:
                    if tc.function.name:
                        buf["name"] = tc.function.name
                    if tc.function.arguments:
                        buf["arguments"] += tc.function.arguments

        tool_calls: list[ToolCallRequest] = []
        for buf in tc_bufs.values():
            try:
                args = json.loads(buf["arguments"]) if buf["arguments"] else {}
            except json.JSONDecodeError:
                args = {}
            tool_calls.append(ToolCallRequest(
                id=buf["id"],
                name=buf["name"],
                arguments=args,
            ))

        # Try extracting usage from last chunk
        usage = LLMUsage()
        for chunk in reversed(chunks):
            if hasattr(chunk, "usage") and chunk.usage:
                usage = self._extract_usage(chunk.usage)
                break

        return LLMResponse(
            content=override_content,
            tool_calls=tool_calls,
            finish_reason=finish_reason,
            usage=usage,
            reasoning_content=override_reasoning or None,
        )

    def _extract_tool_calls(self, raw: list[Any]) -> list[ToolCallRequest]:
        result = []
        for tc in raw:
            fn = tc.function
            try:
                args = json.loads(fn.arguments) if fn.arguments else {}
            except json.JSONDecodeError:
                args = {}
            result.append(ToolCallRequest(id=tc.id, name=fn.name, arguments=args))
        return result

    def _extract_usage(self, usage: Any) -> LLMUsage:
        if usage is None:
            return LLMUsage()
        prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
        completion_tokens = getattr(usage, "completion_tokens", 0) or 0
        total_tokens = getattr(usage, "total_tokens", 0) or 0
        return LLMUsage(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cached_tokens=self._read_cached_tokens(usage),
            reasoning_tokens=self._read_reasoning_tokens(usage),
        )

    @staticmethod
    def _read_cached_tokens(usage: Any) -> int:
        """Normalize prompt-cache hit tokens across OpenAI-compatible providers."""
        # Priority chain: OpenAI/Zhipu/MiniMax/Qwen/Mistral/xAI nest the field;
        # StepFun/Moonshot put it at the top level; DeepSeek/SiliconFlow rename it.
        details = getattr(usage, "prompt_tokens_details", None)
        if details is not None:
            value = getattr(details, "cached_tokens", 0) or 0
            if value:
                return int(value)
        for attr in ("cached_tokens", "prompt_cache_hit_tokens"):
            value = getattr(usage, attr, 0) or 0
            if value:
                return int(value)
        return 0

    @staticmethod
    def _read_reasoning_tokens(usage: Any) -> int:
        """OpenAI reasoning models (o-series, gpt-5) report reasoning_tokens here."""
        details = getattr(usage, "completion_tokens_details", None)
        if details is None:
            return 0
        value = getattr(details, "reasoning_tokens", 0) or 0
        return int(value)

    def _map_finish_reason(self, reason: str | None) -> str:
        if reason == "tool_calls":
            return "tool_calls"
        if reason == "length":
            return "length"
        return "stop"
