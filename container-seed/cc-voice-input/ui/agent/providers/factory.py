"""ProviderFactory: resolves the correct LLMProvider for an agent."""

from __future__ import annotations

from ui.agent.providers.config import ProvidersConfig
from ui.agent.providers.base import LLMProvider


class ProviderFactory:
    """Creates and caches LLMProvider instances keyed by provider name.

    Provider name comes from AgentConfig.provider. Supported values:
      "mock"        MockProvider — no API key needed, for testing
      "anthropic"   Native Anthropic SDK
      "openai"      OpenAI API (OpenAI-compat)
      "openrouter"  OpenRouter gateway (OpenAI-compat)
      "ollama"      Local Ollama (OpenAI-compat)
      "custom"      Any OpenAI-compat endpoint
      "auto"        Infer from model prefix (e.g. "anthropic/claude-...")
    """

    def __init__(self, providers_config: ProvidersConfig) -> None:
        self._config = providers_config
        self._cache: dict[str, LLMProvider] = {}

    def get(self, provider_name: str, model: str = "") -> LLMProvider:
        resolved = self._resolve(provider_name, model)
        if resolved not in self._cache:
            self._cache[resolved] = self._create(resolved)
        return self._cache[resolved]

    def _resolve(self, provider_name: str, model: str) -> str:
        if provider_name != "auto":
            return provider_name
        if "/" in model:
            return model.split("/")[0]
        return "mock"

    def _create(self, name: str) -> LLMProvider:
        if name == "mock":
            from ui.agent.providers.mock import MockProvider
            return MockProvider()

        if name == "anthropic":
            from ui.agent.providers.anthropic import AnthropicProvider
            cfg = self._config.anthropic
            return AnthropicProvider(api_key=cfg.api_key, api_base=cfg.api_base)

        # All other providers are OpenAI-compatible; look up config dynamically
        cfg = self._config.get(name)
        if cfg is None:
            raise ValueError(
                f"Unknown provider: '{name}'. "
                f"Add it to providers in config.json or use 'custom'."
            )
        from ui.agent.providers.openai import OpenAIProvider
        return OpenAIProvider(
            api_key=cfg.api_key,
            api_base=cfg.api_base,
            extra_headers=cfg.extra_headers,
        )
