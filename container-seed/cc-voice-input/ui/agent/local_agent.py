"""Local conversational agent: LLM + rolling message history."""

from __future__ import annotations

from typing import Any

from ui.agent.providers.base import LLMProvider
from ui.agent.providers.config import ProvidersConfig
from ui.agent.providers.factory import ProviderFactory


class AgentConfigError(ValueError):
    """Raised when the agent config is incomplete or malformed."""


class LocalAgent:
    """Multi-turn chat agent. One instance = one conversation."""

    def __init__(
            self,
            agent_cfg: dict[str, Any],
            *,
            provider: LLMProvider | None = None,
    ) -> None:
        provider_name = agent_cfg.get("provider")
        model = agent_cfg.get("model")
        if not provider_name:
            raise AgentConfigError("agent.provider is required")
        if not model:
            raise AgentConfigError("agent.model is required")

        self.model: str = model
        self.system: str = agent_cfg.get("system", "") or ""
        self.max_tokens: int = int(agent_cfg.get("max_tokens", 8192))
        self.temperature: float = float(agent_cfg.get("temperature", 0.7))

        if provider is None:
            providers_cfg = ProvidersConfig.from_dict(agent_cfg.get("providers"))
            provider = ProviderFactory(providers_cfg).get(provider_name, model)
        self.provider = provider

        self.messages: list[dict[str, Any]] = []

    async def chat(self, text: str) -> str:
        text = (text or "").strip()
        if not text:
            return ""
        self.messages.append({"role": "user", "content": text})
        resp = await self.provider.chat(
            messages=self.messages,
            model=self.model,
            system=self.system,
            max_tokens=self.max_tokens,
            temperature=self.temperature,
        )
        print('=======', resp)
        reply = resp.content or ""
        self.messages.append({"role": "assistant", "content": reply})
        return reply

    def reset(self) -> None:
        self.messages.clear()
