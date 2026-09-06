"""Model capability heuristics.

Used as a fallback when ``Config.models`` has no explicit entry for a
model. Returning a confident True for well-known vision-capable model
families means users don't need to register every Claude / GPT model.
Unknown models default to False — safer to strip images than to crash
the request on a backend that doesn't accept image_url blocks.
"""

from __future__ import annotations

_VISION_TOKENS = (
    # Anthropic — every Claude 3.5+ supports vision
    "claude-3-5", "claude-3.5", "claude-opus", "claude-sonnet", "claude-haiku",
    # OpenAI — modern multimodal models
    "gpt-4o", "gpt-4.1", "gpt-5", "o3", "o4-mini",
    # Google
    "gemini-1.5", "gemini-2", "gemini-pro-vision",
    # Generic vision-language model naming conventions used by Qwen-VL,
    # GLM-4V, Yi-VL, MiniCPM-V, llava, MiniMax abab-vl, etc.
    "-vl", "-vision", "-v-", "vl-", "vision-", "llava",
    # Zhipu GLM-4V / 4.1V / 4.5V family — uses "<digit>v" not "-v-"
    "glm-4v", "glm-4.1v", "glm-4.5v",
)


def guess_vision(model: str) -> bool:
    """Heuristic: does this model accept image inputs?

    Strips the provider prefix (``anthropic/``, ``openai/`` …) and matches
    against a small token list. Conservative by default — returns False
    for anything we don't recognize.
    """
    name = model.split("/", 1)[-1].lower() if model else ""
    return any(tok in name for tok in _VISION_TOKENS)
