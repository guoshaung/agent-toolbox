"""Minimal JSON-lines sidecar for optional local Argos Translate."""

import json
import sys

MAX_TEXT_LENGTH = 20000

try:
    import argostranslate.package as argos_package
    import argostranslate.translate as argos_translate
    IMPORT_ERROR = None
except Exception as exc:  # Argos is an optional local dependency.
    argos_package = None
    argos_translate = None
    IMPORT_ERROR = str(exc)


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def installed_pairs():
    if argos_translate is None:
        return set()
    languages = {language.code: language for language in argos_translate.get_installed_languages()}
    pairs = set()
    for source_code, source in languages.items():
        for target_code in languages:
            if source_code == target_code:
                continue
            try:
                source.get_translation(languages[target_code])
                pairs.add((source_code, target_code))
            except Exception:
                pass
    return pairs


def status():
    if IMPORT_ERROR:
        return {
            "ok": False,
            "code": "package-missing",
            "error": "Python 已找到，但未安装 argostranslate。请在该 Python 环境中运行 pip install argostranslate。",
            "detail": IMPORT_ERROR,
        }
    pairs = installed_pairs()
    required = {("en", "zh"), ("zh", "en")}
    missing = sorted([list(pair) for pair in required - pairs])
    if missing:
        return {
            "ok": False,
            "code": "models-missing",
            "error": "Argos 中英翻译模型尚未安装。",
            "missingPairs": missing,
            "canInstall": True,
        }
    return {"ok": True, "provider": "argos", "installedPairs": sorted([list(pair) for pair in pairs])}


def translate(request):
    current = status()
    if not current.get("ok"):
        return current
    text = str(request.get("text", "")).strip()
    source_code = request.get("sourceLanguage")
    target_code = request.get("targetLanguage")
    if not text:
        return {"ok": False, "code": "invalid-input", "error": "没有要翻译的内容。"}
    if len(text) > MAX_TEXT_LENGTH:
        return {"ok": False, "code": "input-too-large", "error": "翻译内容过长。"}
    if source_code not in ("en", "zh") or target_code not in ("en", "zh") or source_code == target_code:
        return {"ok": False, "code": "unsupported-language", "error": "仅支持 English 和 Chinese 互译。"}
    languages = {language.code: language for language in argos_translate.get_installed_languages()}
    try:
        translator = languages[source_code].get_translation(languages[target_code])
        return {"ok": True, "translation": translator.translate(text), "provider": "argos"}
    except Exception as exc:
        return {"ok": False, "code": "translation-failed", "error": str(exc)}


def install_models(request):
    if IMPORT_ERROR:
        return status()
    requested = request.get("pairs") or [["en", "zh"], ["zh", "en"]]
    try:
        argos_package.update_package_index()
        available = argos_package.get_available_packages()
        installed = installed_pairs()
        for source_code, target_code in requested:
            if (source_code, target_code) in installed:
                continue
            candidate = next(
                (item for item in available if item.from_code == source_code and item.to_code == target_code),
                None,
            )
            if candidate is None:
                return {
                    "ok": False,
                    "code": "model-unavailable",
                    "error": f"Argos 模型索引中没有 {source_code} -> {target_code}。",
                }
            argos_package.install_from_path(candidate.download())
        return status()
    except Exception as exc:
        return {"ok": False, "code": "install-failed", "error": f"Argos 模型安装失败：{exc}"}


emit({"event": "ready", "packageAvailable": IMPORT_ERROR is None})

for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        action = request.get("action")
        if action == "status":
            result = status()
        elif action == "translate":
            result = translate(request)
        elif action == "install":
            result = install_models(request)
        else:
            result = {"ok": False, "code": "unsupported-action", "error": "不支持的 sidecar 操作。"}
    except Exception as exc:
        result = {"ok": False, "code": "sidecar-error", "error": str(exc)}
    result["id"] = request.get("id") if isinstance(request, dict) else None
    emit(result)
