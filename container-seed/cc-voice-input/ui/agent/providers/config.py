"""Provider configuration (credentials + endpoints).

Lightweight dataclass mirror of agent-world's ProvidersConfig so the
provider layer (base/openai/anthropic/factory) can stay drop-in
compatible without pulling in pydantic-settings.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


_KNOWN = ("anthropic", "openai", "openrouter", "ollama", "custom")


@dataclass
class ProviderConfig:
    """Credentials and endpoint for one LLM provider."""
    api_key: str | None = None
    api_base: str | None = None
    extra_headers: dict[str, str] = field(default_factory=dict)


@dataclass
class ProvidersConfig:
    """All provider credentials.

    Pre-declared providers are attributes. Anything else (e.g. "deepseek")
    lives in ``_extra`` and is reached via ``get(name)``.
    """
    anthropic: ProviderConfig = field(default_factory=ProviderConfig)
    openai: ProviderConfig = field(default_factory=ProviderConfig)
    openrouter: ProviderConfig = field(default_factory=ProviderConfig)
    ollama: ProviderConfig = field(default_factory=ProviderConfig)
    custom: ProviderConfig = field(default_factory=ProviderConfig)
    _extra: dict[str, ProviderConfig] = field(default_factory=dict)

    def get(self, name: str) -> ProviderConfig | None:
        val = getattr(self, name, None)
        if isinstance(val, ProviderConfig):
            return val
        return self._extra.get(name)

    @classmethod
    def from_dict(cls, raw: dict[str, Any] | None) -> "ProvidersConfig":
        raw = raw or {}
        kwargs: dict[str, ProviderConfig] = {}
        extra: dict[str, ProviderConfig] = {}
        for name, cfg in raw.items():
            if not isinstance(cfg, dict):
                continue
            pc = ProviderConfig(
                api_key=cfg.get("api_key") or cfg.get("apiKey"),
                api_base=cfg.get("api_base") or cfg.get("apiBase"),
                extra_headers=cfg.get("extra_headers") or cfg.get("extraHeaders") or {},
            )
            if name in _KNOWN:
                kwargs[name] = pc
            else:
                extra[name] = pc
        return cls(**kwargs, _extra=extra)
