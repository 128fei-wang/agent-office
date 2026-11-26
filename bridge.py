#!/usr/bin/env python3
"""
Agent Office local bridge.

Zero-dependency localhost service for external agent registration,
heartbeats and event ingestion. It intentionally binds to 127.0.0.1.

Run:
    python3 bridge.py
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import secrets
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
try:
    import updater
except Exception:  # keep the bridge usable if the updater module is missing
    updater = None
try:
    import missions
except Exception:  # keep the bridge usable if the mission module is missing
    missions = None

STATE_DIR = Path(os.environ.get("BRIDGE_STATE_DIR") or (Path.home() / ".agent-office")).expanduser()
STATE_FILE = Path(os.environ.get("BRIDGE_STATE") or (STATE_DIR / "bridge-state.json")).expanduser()
LOCK = threading.RLock()
DEMO_STOP = threading.Event()
DEMO_THREAD = None
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}
ALLOW_FILE_ORIGIN = os.environ.get("BRIDGE_ALLOW_FILE_ORIGIN") == "1"
PROVIDERS_FILE = Path(
    os.environ.get("BRIDGE_PROVIDERS") or (STATE_DIR / "providers.json")
).expanduser()
PROVIDER_TIMEOUT = float(os.environ.get("BRIDGE_PROVIDER_TIMEOUT") or 30)
MISSION_STORE = (
    missions.MissionStore(STATE_DIR / "missions.json", STATE_DIR / "uploads")
    if missions else None
)
MISSION_DISCUSS_LOCK = threading.Lock()
BOOT_ID = secrets.token_hex(8)
UPDATE_TOKENS = {}
UPDATE_TOKEN_LOCK = threading.Lock()
UPDATE_JOB_LOCK = threading.Lock()
UPDATE_JOB = {
    "status": "idle",
    "kind": "",
    "stage": "",
    "percent": 0,
    "message": "",
    "error": "",
    "code": "",
    "startedAt": "",
    "finishedAt": "",
    "fromVersion": "",
    "toVersion": "",
    "result": None,
}

# Provider presets. Keys are never stored in or returned to the browser.
# Every remote provider is called from the bridge process only.
PROVIDER_CATALOG = {
    "doubao": {
        "name": "豆包 Doubao",
        "vendor": "Volcengine Ark",
        "protocol": "openai",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
        "model": "doubao-seed-1-6-250615",
        "env": ["DOUBAO_API_KEY", "ARK_API_KEY"],
        "baseEnv": "AGENT_OFFICE_DOUBAO_BASE_URL",
        "modelEnv": "AGENT_OFFICE_DOUBAO_MODEL",
        "skills": ["chat", "reasoning", "writing"],
        "color": "#6ea8ff",
        "note": "火山方舟 OpenAI 兼容接口；模型可填 doubao-* 或你的 endpoint id。",
    },
    "deepseek": {
        "name": "DeepSeek",
        "vendor": "DeepSeek",
        "protocol": "openai",
        "baseUrl": "https://api.deepseek.com/v1",
        "model": "deepseek-chat",
        "env": ["DEEPSEEK_API_KEY"],
        "baseEnv": "AGENT_OFFICE_DEEPSEEK_BASE_URL",
        "modelEnv": "AGENT_OFFICE_DEEPSEEK_MODEL",
        "skills": ["chat", "coding", "reasoning"],
        "color": "#5b8cff",
        "note": "DeepSeek OpenAI 兼容接口；默认 deepseek-chat。",
    },
    "workbuddy": {
        "name": "WorkBuddy",
        "vendor": "Tencent WorkBuddy",
        "protocol": "openai",
        "baseUrl": "http://127.0.0.1:10108/v1",
        "model": "hy3",
        "env": ["WORKBUDDY_API_KEY"],
        "baseEnv": "AGENT_OFFICE_WORKBUDDY_BASE_URL",
        "modelEnv": "AGENT_OFFICE_WORKBUDDY_MODEL",
        "skills": ["chat", "office", "writing"],
        "color": "#ffb45e",
        "keyOptional": True,
        "local": True,
        "note": "需要本地 OpenAI 兼容网关（workbuddy-connect / workbuddy2api 等）；默认 10108 端口。",
    },
    "gemini": {
        "name": "Gemini",
        "vendor": "Google AI Studio",
        "protocol": "gemini",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "model": "gemini-2.5-flash",
        "env": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        "baseEnv": "AGENT_OFFICE_GEMINI_BASE_URL",
        "modelEnv": "AGENT_OFFICE_GEMINI_MODEL",
        "skills": ["chat", "vision", "reasoning"],
        "color": "#9b8cff",
        "note": "Google Generative Language API；默认 gemini-2.5-flash。",
    },
    "openai": {
        "name": "OpenAI",
        "vendor": "OpenAI",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-4.1-mini",
        "env": ["OPENAI_API_KEY"],
        "baseEnv": "AGENT_OFFICE_OPENAI_BASE_URL",
        "modelEnv": "AGENT_OFFICE_OPENAI_MODEL",
        "skills": ["chat", "coding", "tools"],
        "color": "#74d6a3",
        "note": "OpenAI Chat Completions；也兼容大多数 /v1 代理。",
    },
    "anthropic": {
        "name": "Claude",
        "vendor": "Anthropic",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1",
        "model": "claude-sonnet-5-5",
        "env": ["ANTHROPIC_API_KEY"],
        "baseEnv": "AGENT_OFFICE_ANTHROPIC_BASE_URL",
        "modelEnv": "AGENT_OFFICE_ANTHROPIC_MODEL",
        "skills": ["chat", "coding", "review"],
        "color": "#d0a27a",
        "note": "Anthropic Messages API；默认 claude-sonnet-5-5。",
    },
    "kimi": {
        "name": "Kimi",
        "vendor": "Moonshot",
        "protocol": "openai",
        "baseUrl": "https://api.moonshot.cn/v1",
        "model": "kimi-latest",
        "env": ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
        "baseEnv": "AGENT_OFFICE_KIMI_BASE_URL",
        "modelEnv": "AGENT_OFFICE_KIMI_MODEL",
        "skills": ["chat", "long-context", "writing"],
        "color": "#7cb7ff",
        "note": "Moonshot OpenAI 兼容接口；默认 kimi-latest。",
    },
    "qwen": {
        "name": "通义千问 Qwen",
        "vendor": "Alibaba DashScope",
        "protocol": "openai",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-plus",
        "env": ["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
        "baseEnv": "AGENT_OFFICE_QWEN_BASE_URL",
        "modelEnv": "AGENT_OFFICE_QWEN_MODEL",
        "skills": ["chat", "coding", "reasoning"],
        "color": "#c39bff",
        "note": "DashScope OpenAI 兼容模式；默认 qwen-plus。",
    },
    "ollama": {
        "name": "Ollama",
        "vendor": "Local",
        "protocol": "openai",
        "baseUrl": "http://127.0.0.1:11434/v1",
        "model": "llama3.2",
        "env": ["OLLAMA_API_KEY"],
        "baseEnv": "AGENT_OFFICE_OLLAMA_BASE_URL",
        "modelEnv": "AGENT_OFFICE_OLLAMA_MODEL",
        "skills": ["chat", "coding", "local"],
        "color": "#8ee0d0",
        "keyOptional": True,
        "local": True,
        "note": "本地 Ollama OpenAI 兼容接口；不需要 API key。",
    },
}


class ProviderNotConfigured(Exception):
    pass


class ProviderCallError(Exception):
    pass


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def host_allowed(host_header: str) -> bool:
    """Only accept local Host headers, to blunt DNS-rebinding attacks."""
    if not host_header:
        return True
    try:
        host = (urlparse("//" + host_header).hostname or "").lower()
    except ValueError:
        return False
    return host in ALLOWED_HOSTS


def origin_allowed(origin: str) -> bool:
    """Allow browser clients served from localhost. CLI clients send no Origin."""
    if not origin:
        return True
    if origin == "null":
        return ALLOW_FILE_ORIGIN
    try:
        parsed = urlparse(origin)
        host = (parsed.hostname or "").lower()
    except ValueError:
        return False
    return (
        parsed.scheme in ("http", "https")
        and host in ALLOWED_HOSTS
        and not parsed.username
        and not parsed.password
        and parsed.path in ("", "/")
    )


def load_provider_overrides():
    """Read ~/.agent-office/providers.json. Keys stay in this process; errors are non-fatal."""
    if not PROVIDERS_FILE.exists():
        return {}, ""
    try:
        data = json.loads(PROVIDERS_FILE.read_text("utf-8"))
        if not isinstance(data, dict):
            return {}, "providers file must contain an object"
        if isinstance(data.get("providers"), dict):
            data = data["providers"]
        return data, ""
    except Exception as exc:
        return {}, str(exc)[:200]


def provider_settings(provider_id: str, overrides=None):
    meta = PROVIDER_CATALOG.get(provider_id)
    if not meta:
        return None
    if overrides is None:
        overrides, _ = load_provider_overrides()
    cfg = overrides.get(provider_id)
    if not isinstance(cfg, dict):
        cfg = {}
    api_key = str(cfg.get("apiKey") or "").strip()
    if not api_key:
        for name in meta.get("env", []):
            api_key = str(os.environ.get(name) or "").strip()
            if api_key:
                break
    base_url = str(
        cfg.get("baseUrl")
        or os.environ.get(meta.get("baseEnv", ""))
        or meta.get("baseUrl")
        or ""
    ).strip().rstrip("/")
    model = str(
        cfg.get("model")
        or os.environ.get(meta.get("modelEnv", ""))
        or meta.get("model")
        or ""
    ).strip()
    if not base_url.startswith(("http://", "https://")):
        raise ProviderCallError("provider baseUrl must start with http:// or https://")
    configured = bool(api_key) or bool(meta.get("keyOptional"))
    return {
        "id": provider_id,
        "name": meta["name"],
        "vendor": meta["vendor"],
        "protocol": meta["protocol"],
        "baseUrl": base_url,
        "model": model,
        "apiKey": api_key,
        "configured": configured,
        "keyOptional": bool(meta.get("keyOptional")),
        "local": bool(meta.get("local")),
        "env": list(meta.get("env", [])),
        "baseEnv": meta.get("baseEnv", ""),
        "modelEnv": meta.get("modelEnv", ""),
        "skills": list(meta.get("skills", [])),
        "color": meta.get("color", "#b58cff"),
        "note": meta.get("note", ""),
    }


def provider_public(provider_id: str, overrides=None) -> dict:
    settings = provider_settings(provider_id, overrides)
    if not settings:
        return {}
    out = dict(settings)
    out.pop("apiKey", None)
    out["keyEnv"] = out["env"][0] if out.get("env") else ""
    return out


def providers_payload() -> dict:
    overrides, error = load_provider_overrides()
    providers = []
    for provider_id in PROVIDER_CATALOG:
        try:
            item = provider_public(provider_id, overrides)
        except ProviderCallError as exc:
            item = {
                "id": provider_id,
                "name": PROVIDER_CATALOG[provider_id]["name"],
                "configured": False,
                "error": str(exc),
            }
        if item:
            providers.append(item)
    return {
        "providers": providers,
        "configFile": PROVIDERS_FILE.name,
        "configError": error,
    }


def _provider_endpoint(base: str, path: str) -> str:
    if base.rstrip("/").endswith(path):
        return base.rstrip("/")
    return base.rstrip("/") + path


def _post_json(url: str, payload: dict, headers: dict, timeout=None):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "AgentOfficeBridge/1.0", **headers},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout or PROVIDER_TIMEOUT) as response:
            raw = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        raise ProviderCallError("HTTP %s: %s" % (exc.code, detail or exc.reason))
    except urllib.error.URLError as exc:
        raise ProviderCallError("connection failed: %s" % (exc.reason,))
    except ssl.SSLError as exc:
        raise ProviderCallError("TLS error: %s" % (exc,))
    try:
        return json.loads(raw)
    except ValueError:
        raise ProviderCallError("provider returned non-JSON: %s" % raw[:200])


def _text_from_content(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
        return "".join(parts)
    return ""


def provider_chat(provider_id: str, prompt: str, system: str = "", max_tokens: int = 512):
    settings = provider_settings(provider_id)
    if not settings:
        raise ProviderCallError("unknown provider")
    if not settings["configured"]:
        raise ProviderNotConfigured(
            "missing API key for %s; set %s in the bridge environment or ~/.agent-office/providers.json"
            % (settings["name"], settings["env"][0] if settings["env"] else "an API key")
        )
    prompt = str(prompt or "").strip()[:4000]
    system = str(system or "").strip()[:2000]
    if not prompt:
        raise ProviderCallError("prompt is empty")
    model = settings["model"]
    base = settings["baseUrl"].rstrip("/")
    protocol = settings["protocol"]
    key = settings["apiKey"]

    if protocol == "openai":
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        payload = {"model": model, "messages": messages, "max_tokens": int(max_tokens)}
        headers = {"Authorization": "Bearer " + key} if key else {}
        data = _post_json(_provider_endpoint(base, "/chat/completions"), payload, headers)
        choices = data.get("choices") or []
        message = (choices[0].get("message") or {}) if choices else {}
        text = _text_from_content(message.get("content"))
        if not text:
            text = str(message.get("reasoning_content") or "")
        usage = data.get("usage") or {}
        tokens_in = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
        tokens_out = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    elif protocol == "anthropic":
        payload = {
            "model": model,
            "max_tokens": int(max_tokens),
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            payload["system"] = system
        data = _post_json(
            _provider_endpoint(base, "/messages"),
            payload,
            {"x-api-key": key, "anthropic-version": "2023-06-01"},
        )
        text = _text_from_content(data.get("content"))
        usage = data.get("usage") or {}
        tokens_in = int(usage.get("input_tokens") or 0)
        tokens_out = int(usage.get("output_tokens") or 0)
    elif protocol == "gemini":
        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": int(max_tokens)},
        }
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}
        url = base + "/models/" + quote(model, safe="") + ":generateContent"
        data = _post_json(url, payload, {"x-goog-api-key": key})
        candidates = data.get("candidates") or []
        parts = ((candidates[0].get("content") or {}).get("parts") or []) if candidates else []
        text = "".join(str(part.get("text") or "") for part in parts if isinstance(part, dict))
        usage = data.get("usageMetadata") or {}
        tokens_in = int(usage.get("promptTokenCount") or 0)
        tokens_out = int(usage.get("candidatesTokenCount") or 0)
    else:
        raise ProviderCallError("unsupported provider protocol: " + protocol)

    text = str(text or "").strip()
    if not text:
        raise ProviderCallError("provider returned an empty response")
    return {
        "text": text,
        "model": model,
        "provider": provider_id,
        "protocol": protocol,
        "tokensIn": tokens_in,
        "tokensOut": tokens_out,
    }


def provider_agent_id(provider_id: str) -> str:
    return "ext-" + provider_id


def ensure_provider_agent(provider_id: str, create: bool = True):
    settings = provider_settings(provider_id)
    if not settings:
        raise ProviderCallError("unknown provider")
    if not settings["configured"]:
        raise ProviderNotConfigured(
            "missing API key for %s; set %s or add ~/.agent-office/providers.json"
            % (settings["name"], settings["env"][0] if settings["env"] else "an API key")
        )
    agent_id = provider_agent_id(provider_id)
    existing = find_agent(agent_id)
    if existing:
        existing["runtime"] = provider_id
        existing["provider"] = provider_id
        existing["model"] = settings["model"]
        existing["endpoint"] = settings["baseUrl"]
        existing["managed"] = True
        return existing, False
    if not create:
        return None, False
    agent = {
        "id": agent_id,
        "name": settings["name"] + " · API",
        "runtime": provider_id,
        "provider": provider_id,
        "protocol": settings["protocol"],
        "model": settings["model"],
        "endpoint": settings["baseUrl"],
        "skills": settings["skills"],
        "note": settings["note"],
        "color": settings["color"],
        "createdAt": now_iso(),
        "lastSeen": None,
        "lastSeenTs": 0,
        "managed": True,
    }
    STATE["agents"].append(agent)
    return agent, True


def connect_provider(provider_id: str):
    settings = provider_settings(provider_id)
    if not settings:
        raise ProviderCallError("unknown provider")
    if not settings["configured"]:
        raise ProviderNotConfigured(
            "missing API key for %s; set %s or add ~/.agent-office/providers.json"
            % (settings["name"], settings["env"][0] if settings["env"] else "an API key")
        )
    with LOCK:
        agent, created = ensure_provider_agent(provider_id)
        agent["lastSeen"] = now_iso()
        agent["lastSeenTs"] = time.time()
        if created:
            add_event({
                "agentId": agent["id"],
                "kind": "hello",
                "action": "已接入 Agent Office · 模型接口待命",
                "note": "%s · %s" % (settings["vendor"], settings["model"]),
            })
        save_state()
        return agent, created


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text("utf-8"))
            if isinstance(data, dict):
                data.setdefault("agents", [])
                data.setdefault("events", [])
                data.setdefault("nextEvent", 1)
                data.setdefault("demo", False)
                data.setdefault("pairs", [])
                data.setdefault("assignments", [])
                data.setdefault("company", None)
                data.setdefault("messages", [])
                data.setdefault("messageSeq", 0)
                return data
        except Exception:
            pass
    return {"agents": [], "events": [], "nextEvent": 1, "demo": False, "pairs": [],
            "assignments": [], "company": None, "messages": [], "messageSeq": 0}


STATE = load_state()


def save_state() -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(STATE, ensure_ascii=False, indent=2), "utf-8")
    tmp.replace(STATE_FILE)


def app_version() -> str:
    if updater:
        return updater.read_version(ROOT) or "0.0.0"
    try:
        return (ROOT / "VERSION").read_text("utf-8").strip() or "0.0.0"
    except OSError:
        return "0.0.0"


def _external_agent_role(agent):
    explicit = str(agent.get("role") or "").strip().lower()
    if missions:
        valid = {row["id"] for row in missions.role_catalog()}
        if explicit in valid:
            return explicit
    skills = [str(s).lower() for s in (agent.get("skills") or [])]
    joined = " ".join(skills)
    if any(word in joined for word in ("code", "edit", "repo", "frontend", "backend", "test")):
        return "engineer"
    if any(word in joined for word in ("office", "writing", "doc")):
        return "product"
    if any(word in joined for word in ("review", "audit")):
        return "qa"
    return "operator"


def clean_agent_updates(body):
    if not isinstance(body, dict):
        return {}
    out = {}
    for key in ("name", "runtime", "endpoint", "note", "color"):
        if key in body:
            out[key] = str(body.get(key) or "")[:300 if key == "endpoint" else 40]
    if "skills" in body:
        out["skills"] = [str(item)[:60] for item in (body.get("skills") or [])
                         if str(item).strip()][:20]
    if "role" in body:
        role = str(body.get("role") or "").strip().lower()
        valid_roles = ({row["id"] for row in missions.role_catalog()} if missions else set())
        if role and role not in valid_roles:
            raise ValueError("unknown agent role")
        out["role"] = role
    if "avatar" in body:
        avatar = str(body.get("avatar") or "auto").strip().lower()
        valid_avatars = ({row["id"] for row in missions.avatar_catalog()} if missions else {"auto"})
        if avatar not in valid_avatars:
            raise ValueError("unknown avatar")
        out["avatar"] = avatar
    if "avatarText" in body:
        out["avatarText"] = str(body.get("avatarText") or "").strip()[:2]
    if "avatarColor" in body:
        color = str(body.get("avatarColor") or "").strip()
        if color and not re.fullmatch(r"#[0-9a-fA-F]{3,8}", color):
            raise ValueError("avatarColor must be a hex color")
        out["avatarColor"] = color
    return out


def mission_agent_directory():
    rows = []
    company = STATE.get("company")
    if company:
        for role in company.get("roles", []):
            bound = find_agent(role.get("agentId") or "")
            rows.append({
                "id": role.get("id"),
                "name": (bound or {}).get("name") or role.get("titleEn") or role.get("titleZh"),
                "role": str(role.get("id") or "").replace("opc-", ""),
                "titleZh": role.get("titleZh"),
                "titleEn": role.get("titleEn"),
                "skills": list(role.get("skills") or []),
                "color": role.get("color"),
                "source": "company",
                "virtual": not bool(bound),
                "online": bool(bound and online(bound)),
            })
    elif missions:
        rows = missions.builtin_directory()
    with LOCK:
        external = [dict(a) for a in STATE.get("agents", [])]
    for agent in external:
        rows.append({
            "id": agent.get("id"),
            "name": agent.get("name") or agent.get("id"),
            "role": _external_agent_role(agent),
            "titleZh": agent.get("name") or agent.get("id"),
            "titleEn": agent.get("name") or agent.get("id"),
            "skills": list(agent.get("skills") or []),
            "color": agent.get("color") or "#7cb7ff",
            "source": "external",
            "virtual": False,
            "online": online(agent),
            "runtime": agent.get("runtime") or "",
            "avatar": agent.get("avatar") or "auto",
            "avatarText": agent.get("avatarText") or "",
            "avatarColor": agent.get("avatarColor") or "",
        })
    seen = set()
    unique = []
    for row in rows:
        if not row.get("id") or row["id"] in seen:
            continue
        seen.add(row["id"])
        source = row.get("source") or "role"
        unique.append(missions.normalize_agent(row, source))
    return unique


def _provider_local_ready(settings):
    parsed = urlparse(settings.get("baseUrl") or "")
    host = (parsed.hostname or "").lower()
    if host not in ("127.0.0.1", "localhost", "::1"):
        return True
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=0.35):
            return True
    except OSError:
        return False


def _configured_providers():
    ids = []
    for provider_id in PROVIDER_CATALOG:
        try:
            settings = provider_settings(provider_id)
        except Exception:
            continue
        if settings and settings.get("configured") and _provider_local_ready(settings):
            ids.append(provider_id)
    return ids


def mission_provider_candidates(preferred=""):
    available = _configured_providers()
    order = []
    if preferred in available:
        order.append(preferred)
    for provider_id in ("workbuddy", "ollama", "gemini", "openai", "anthropic",
                        "deepseek", "doubao", "qwen", "kimi"):
        if provider_id in available and provider_id not in order:
            order.append(provider_id)
    for provider_id in available:
        if provider_id not in order:
            order.append(provider_id)
    return order


def _parse_model_json(text):
    raw = str(text or "").strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
    raw = re.sub(r"\s*```$", "", raw)
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(raw[start:end + 1])
        return data if isinstance(data, dict) else None
    except ValueError:
        return None


def _mission_discussion_prompt(mission):
    members = mission.get("members", [])
    tasks = mission.get("tasks", [])
    language = "中文" if mission.get("language") != "en" else "English"
    member_lines = "\n".join(
        "- %s | %s | role=%s | skills=%s" % (
            m.get("id"), m.get("titleZh") or m.get("name"), m.get("role"),
            ",".join(m.get("skills") or []))
        for m in members
    )
    task_lines = "\n".join(
        "- %s | %s | owner=%s | status=%s | deps=%s | brief=%s" % (
            t.get("id"), t.get("title"), t.get("assigneeName") or t.get("assigneeId"),
            t.get("status"), ",".join(t.get("deps") or []), (t.get("brief") or "")[:160])
        for t in tasks
    )
    return (
        "任务标题：" + mission.get("title", "") + "\n"
        "任务描述：" + (mission.get("description") or "")[:1200] + "\n"
        "验收标准：" + (mission.get("acceptance") or "")[:800] + "\n"
        "规则：" + "；".join(mission.get("rules") or []) + "\n\n"
        "成员：\n" + member_lines + "\n\n任务：\n" + task_lines + "\n\n"
        "请生成一次简洁的任务启动讨论。只输出 JSON，不要 Markdown。\n"
        "语言：" + language + "。\n"
        "格式：{\"messages\":[{\"agentId\":\"成员 id\",\"text\":\"讨论内容\","
        "\"proposal\":{\"topic\":\"\",\"option\":\"\",\"rationale\":\"\"}}],"
        "\"decisions\":[{\"topic\":\"\",\"outcome\":\"\",\"rationale\":\"\"}],"
        "\"risks\":[\"...\"],"
        "\"approvals\":[{\"type\":\"spend|decision|login|authorization\",\"title\":\"\","
        "\"description\":\"\",\"amount\":0,\"options\":[],\"scopes\":[],\"service\":\"\"}]}。\n"
        "硬规则：技术方案、架构、工具、排期、测试、文案、设计取舍由团队自行决定，不得放进 approvals。"
        "只有花费、业务拍板、扫码登录、授权才允许出现在 approvals。"
        "messages 选 3-6 条，覆盖关键角色；每条必须具体到这个任务，不要空话。"
    )


def _apply_mission_discussion(mission_id, data, provider_id, usage=None):
    if not MISSION_STORE or not missions:
        return
    with MISSION_STORE.lock:
        _apply_mission_discussion_locked(mission_id, data, provider_id, usage)


def _apply_mission_discussion_locked(mission_id, data, provider_id, usage=None):
    mission = MISSION_STORE.find_mission(mission_id)
    if not mission:
        return
    members = mission.get("members", [])
    by_id = {m["id"]: m for m in members}
    by_role = {}
    for member in members:
        by_role.setdefault(member.get("role"), member)
    applied = 0
    for item in (data.get("messages") or [])[:8]:
        if not isinstance(item, dict):
            continue
        agent_id = str(item.get("agentId") or "")
        if agent_id not in by_id:
            role = str(item.get("role") or "")
            member = by_role.get(role)
            agent_id = member["id"] if member else (members[0]["id"] if members else "")
        if not agent_id:
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        proposal = item.get("proposal") if isinstance(item.get("proposal"), dict) else None
        try:
            MISSION_STORE.add_agent_message(
                mission, agent_id, text,
                "proposal" if proposal else "text",
                {"proposal": proposal} if proposal else {},
            )
            applied += 1
        except Exception:
            continue
    for item in (data.get("decisions") or [])[:4]:
        if not isinstance(item, dict):
            continue
        topic = str(item.get("topic") or "").strip()
        outcome = str(item.get("outcome") or "").strip()
        if topic and outcome:
            MISSION_STORE.add_decision(
                mission, topic, outcome, str(item.get("rationale") or ""),
                decided_by="ai-team",
            )
    risks = [str(r).strip() for r in (data.get("risks") or []) if str(r).strip()]
    for item in (data.get("approvals") or [])[:4]:
        if not isinstance(item, dict):
            continue
        try:
            MISSION_STORE.create_approval(mission, item)
        except Exception:
            continue
    if risks:
        MISSION_STORE._system_message(mission, "risk", "AI 讨论识别的风险：\n" +
                                      "\n".join("- " + r for r in risks))
    MISSION_STORE.set_discussion(
        mission_id, status="done", provider=provider_id, finishedAt=now_iso(),
        error="", messages=applied, usage=usage or {},
    )


def _run_mission_discussion(mission_id, preferred=""):
    if not MISSION_STORE or not missions:
        return
    mission = MISSION_STORE.find_mission(mission_id)
    if not mission:
        return
    candidates = mission_provider_candidates(preferred)
    if not candidates:
        MISSION_STORE.set_discussion(
            mission_id, status="unavailable", provider="",
            error="no reachable model service", finishedAt=now_iso(),
        )
        try:
            MISSION_STORE._system_message(
                mission, "system",
                "没有可用的模型服务，AI 讨论未启动；规则计划、任务分配和群聊仍然有效。"
                "启动本地模型网关或配置模型 API 后，可在任务面板点击「AI 讨论」。",
            )
        except Exception:
            pass
        return
    prompt = _mission_discussion_prompt(mission)
    system = (
        "你是 Agent Office 的任务协调器。团队成员是不同职能的 AI 员工。"
        "你只输出 JSON。不要编造外部事实；不要请求老板处理技术问题。"
        "讨论要有具体取舍、依赖、风险和下一步。"
    )
    errors = []
    for provider_id in candidates:
        MISSION_STORE.set_discussion(mission_id, status="running", provider=provider_id,
                                     startedAt=now_iso(), error="")
        started_at = time.time()
        try:
            result = provider_chat(provider_id, prompt, system, max_tokens=1800)
            usage = {
                "provider": provider_id,
                "model": result.get("model") or "",
                "tokensIn": int(result.get("tokensIn") or 0),
                "tokensOut": int(result.get("tokensOut") or 0),
                "durationMs": int(round((time.time() - started_at) * 1000)),
                "source": "ai-discussion",
            }
            parsed = _parse_model_json(result.get("text"))
            if not parsed:
                # Keep the model's discussion, but do not invent structured decisions.
                MISSION_STORE.add_agent_message(
                    mission, mission["members"][0]["id"],
                    str(result.get("text") or "")[:6000], "text",
                    {"aiDiscussion": True, "format": "text"},
                )
                MISSION_STORE.set_discussion(
                    mission_id, status="partial", provider=provider_id,
                    finishedAt=now_iso(), error="model returned non-JSON discussion",
                    usage=usage,
                )
                return
            _apply_mission_discussion(mission_id, parsed, provider_id, usage)
            return
        except Exception as exc:
            errors.append(provider_id + ": " + str(exc)[:180])
            continue
    MISSION_STORE.set_discussion(
        mission_id, status="error", finishedAt=now_iso(),
        error="; ".join(errors)[:800] or "all providers failed",
    )
    try:
        MISSION_STORE._system_message(
            mission, "system",
            "AI 讨论未能完成：" + (errors[0] if errors else "provider unavailable") +
            "。规则计划、任务分配和群聊不受影响，可稍后重试。",
        )
    except Exception:
        pass


def start_mission_discussion(mission_id, preferred=""):
    if not MISSION_STORE:
        raise ValueError("mission store is not available")
    mission = MISSION_STORE.find_mission(mission_id)
    if not mission:
        raise ValueError("mission not found")
    current = (mission.get("discussion") or {}).get("status")
    if current == "running":
        return mission.get("discussion")
    MISSION_STORE.set_discussion(
        mission_id, status="queued", provider=preferred, startedAt=now_iso(),
        finishedAt="", error="",
    )
    thread = threading.Thread(
        target=_run_mission_discussion, args=(mission_id, preferred), daemon=True
    )
    thread.start()
    return mission.get("discussion")


def _tesseract_vision(path):
    tool = shutil.which("tesseract")
    if not tool:
        return ""
    for lang in ("chi_sim+eng", "eng"):
        try:
            result = subprocess.run(
                [tool, str(path), "stdout", "-l", lang],
                capture_output=True, text=True, timeout=45,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()[:16000]
    return ""


def _macos_vision(path):
    tool = shutil.which("swift")
    script = ROOT / "ocr_vision.swift"
    if not tool or not script.exists():
        return ""
    try:
        result = subprocess.run(
            [tool, str(script), str(path)],
            capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()[:16000]
    return ""


_CHAT_WINDOW_CACHE = {"at": 0.0, "rows": []}


def list_chat_windows():
    cached = _CHAT_WINDOW_CACHE
    if cached["at"] and time.time() - cached["at"] < 8:
        return [dict(row) for row in cached["rows"]]
    tool = shutil.which("swift")
    script = ROOT / "window_list.swift"
    if not tool or not script.exists():
        return []
    try:
        result = subprocess.run(
            [tool, str(script)], capture_output=True, text=True, timeout=20,
        )
        rows = json.loads(result.stdout or "[]")
    except (OSError, subprocess.SubprocessError, ValueError):
        return []
    if not isinstance(rows, list):
        return []
    clean = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            window_id = int(row.get("id") or 0)
        except (TypeError, ValueError):
            continue
        if window_id <= 0:
            continue
        clean.append({
            "id": window_id,
            "app": str(row.get("app") or "")[:80],
            "title": str(row.get("title") or "")[:160],
        })
    _CHAT_WINDOW_CACHE["at"] = time.time()
    _CHAT_WINDOW_CACHE["rows"] = clean
    return [dict(row) for row in clean]


def capture_chat_window(window_id):
    windows = list_chat_windows()
    window = next((row for row in windows if row["id"] == int(window_id)), None)
    if not window:
        raise ValueError("window is not a visible QQ/WeChat chat window")
    tool = shutil.which("screencapture")
    if not tool:
        raise RuntimeError("screencapture is not available")
    handle, path = tempfile.mkstemp(prefix="agent-office-capture-", suffix=".png")
    os.close(handle)
    try:
        result = subprocess.run(
            [tool, "-x", "-l", str(window["id"]), path],
            capture_output=True, text=True, timeout=25,
        )
        if result.returncode != 0 or not Path(path).exists() or Path(path).stat().st_size == 0:
            raise RuntimeError("screen capture failed; grant Screen Recording permission")
        text = _macos_vision(path)
        ocr = "macos-vision" if text else ""
        if not text:
            text = _tesseract_vision(path)
            ocr = "tesseract" if text else "none"
        return {"window": window, "text": text, "ocr": ocr}
    finally:
        try:
            Path(path).unlink()
        except OSError:
            pass


def provider_vision(provider_id, image_path, mime, prompt=""):
    settings = provider_settings(provider_id)
    if not settings:
        raise ProviderCallError("unknown provider")
    if not settings.get("configured"):
        raise ProviderNotConfigured("provider is not configured")
    data = Path(image_path).read_bytes()
    if len(data) > 12 * 1024 * 1024:
        raise ProviderCallError("image is larger than 12MB")
    encoded = base64.b64encode(data).decode("ascii")
    mime = str(mime or "image/png")
    text_prompt = prompt or (
        "请识别图片中的全部文字，并按结构总结关键信息、数字、日期和待办。"
        "如果是截图，请保留界面层级和按钮文字。只输出识别结果。"
    )
    base = settings["baseUrl"].rstrip("/")
    protocol = settings["protocol"]
    key = settings["apiKey"]
    model = settings["model"]
    if protocol == "anthropic":
        payload = {
            "model": model, "max_tokens": 1200,
            "messages": [{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64",
                                             "media_type": mime, "data": encoded}},
                {"type": "text", "text": text_prompt},
            ]}],
        }
        result = _post_json(_provider_endpoint(base, "/messages"), payload, {
            "x-api-key": key, "anthropic-version": "2023-06-01",
        })
        text = _text_from_content(result.get("content"))
    elif protocol == "gemini":
        payload = {"contents": [{"role": "user", "parts": [
            {"inlineData": {"mimeType": mime, "data": encoded}},
            {"text": text_prompt},
        ]}], "generationConfig": {"maxOutputTokens": 1200}}
        url = base + "/models/" + quote(model, safe="") + ":generateContent"
        result = _post_json(url, payload, {"x-goog-api-key": key})
        parts = (((result.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [])
        text = "".join(str(p.get("text") or "") for p in parts if isinstance(p, dict))
    else:
        payload = {
            "model": model, "max_tokens": 1200,
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": text_prompt},
                {"type": "image_url", "image_url": {"url": "data:" + mime + ";base64," + encoded}},
            ]}],
        }
        headers = {"Authorization": "Bearer " + key} if key else {}
        result = _post_json(_provider_endpoint(base, "/chat/completions"), payload, headers)
        choices = result.get("choices") or []
        message = (choices[0].get("message") or {}) if choices else {}
        text = _text_from_content(message.get("content")) or str(message.get("reasoning_content") or "")
    text = str(text or "").strip()
    if not text:
        raise ProviderCallError("vision provider returned an empty response")
    return {"text": text, "provider": provider_id, "model": model}


def _mission_task_prompt(mission, task):
    report_format = (mission.get("charter") or {}).get("reportFormat") or (
        "已完成 / 下一步 / 风险 / 解决方案 / 证据")
    return (
        "你是 Agent Office 的「" + str(task.get("assigneeName") or task.get("role")) + "」。\n"
        "任务：" + str(task.get("title")) + "\n"
        "说明：" + str(task.get("brief") or "")[:1200] + "\n"
        "验收：" + str(task.get("acceptance") or "")[:800] + "\n"
        "任务目标：" + str(mission.get("description") or "")[:1200] + "\n"
        "任务规则：" + "；".join(mission.get("rules") or []) + "\n"
        "汇报格式：" + report_format + "\n\n"
        "只输出 JSON，不要 Markdown：{\"summary\":\"\",\"done\":[\"\"],"
        "\"next\":[\"\"],\"risks\":[\"\"],\"solution\":\"\",\"evidence\":[\"\"],"
        "\"deliverable\":\"可直接交付的文本内容\","
        "\"needsBoss\":[]}。\n"
        "needsBoss 只允许 spend/decision/login/authorization；技术阻塞必须给出解决方案，"
        "不得把技术问题交给老板。deliverable 要有实际内容，不要只写“已完成”。"
    )


def run_mission_task(mission_id, task_id, preferred=""):
    if not MISSION_STORE or not missions:
        raise missions.MissionError("mission store is not available", "no_missions", 503)
    mission = MISSION_STORE.find_mission(mission_id)
    _, task = MISSION_STORE.find_task(task_id)
    if not mission or not task or task.get("missionId") != mission_id:
        raise missions.MissionError("task not found", "not_found", 404)
    candidates = mission_provider_candidates(preferred)
    if not candidates:
        raise missions.MissionError(
            "no reachable model service; start a local gateway or configure a model API",
            "no_provider", 409)
    prompt = _mission_task_prompt(mission, task)
    system = (
        "你是 Agent Office 的任务执行 Agent。输出具体、可验收、可追溯。"
        "你的技术方案必须由自己解决；只有花费、业务拍板、扫码登录、授权可以请求老板。"
        "只输出 JSON。"
    )
    errors = []
    parsed = None
    provider_id = ""
    usage = {}
    started_at = time.time()
    for pid in candidates:
        try:
            result = provider_chat(pid, prompt, system, max_tokens=1600)
            data = _parse_model_json(result.get("text"))
            if not data:
                errors.append(pid + ": non-JSON response")
                continue
            report = MISSION_STORE.validate_report(data)
            parsed = (data, report)
            provider_id = pid
            usage = {
                "provider": pid,
                "model": result.get("model") or "",
                "tokensIn": int(result.get("tokensIn") or 0),
                "tokensOut": int(result.get("tokensOut") or 0),
                "durationMs": int(round((time.time() - started_at) * 1000)),
                "source": "ai-run",
            }
            break
        except Exception as exc:
            errors.append(pid + ": " + str(exc)[:160])
            continue
    if not parsed:
        raise missions.MissionError(
            "AI execution failed: " + ("; ".join(errors)[:500] or "no provider"),
            "ai_failed", 502)
    data, report = parsed
    deliverable = str(data.get("deliverable") or report.get("summary") or "").strip()[:20000]
    MISSION_STORE.upload_dir.mkdir(parents=True, exist_ok=True)
    artifact = None
    if deliverable:
        path = MISSION_STORE.upload_dir / (secrets.token_hex(10) + ".md")
        path.write_text(deliverable, "utf-8")
        artifact = MISSION_STORE.add_artifact({
            "name": task.get("title", "deliverable") + ".md",
            "mime": "text/markdown", "size": len(deliverable.encode("utf-8")),
            "kind": "document", "path": str(path),
            "missionId": mission_id, "conversationId": mission.get("conversationId"),
            "uploadedBy": task.get("assigneeId"), "extractedText": deliverable,
            "extraction": "text",
        })
    with MISSION_STORE.lock:
        message = MISSION_STORE.post_message(mission.get("conversationId"), {
            "senderId": task.get("assigneeId"),
            "senderType": "agent",
            "type": "report",
            "text": report.get("summary"),
            "report": report,
            "taskId": task_id,
            "attachmentIds": [artifact["id"]] if artifact else [],
            "usage": usage,
        })
    return {"task": MISSION_STORE.public_task(task, mission),
            "message": message, "artifact": artifact, "provider": provider_id,
            "usage": usage}


def issue_update_tokens(latest_version: str) -> dict:
    now = time.time()
    apply_token = secrets.token_urlsafe(24)
    rollback_token = secrets.token_urlsafe(24)
    with UPDATE_TOKEN_LOCK:
        UPDATE_TOKENS.clear()
        UPDATE_TOKENS[apply_token] = {
            "scope": "apply", "expiresAt": now + 600, "target": latest_version,
        }
        UPDATE_TOKENS[rollback_token] = {
            "scope": "rollback", "expiresAt": now + 600, "target": latest_version,
        }
    return {"token": apply_token, "rollbackToken": rollback_token}


def issue_manual_token() -> dict:
    now = time.time()
    token = secrets.token_urlsafe(24)
    with UPDATE_TOKEN_LOCK:
        for key in [k for k, v in UPDATE_TOKENS.items()
                    if float(v.get("expiresAt") or 0) < now]:
            UPDATE_TOKENS.pop(key, None)
        UPDATE_TOKENS[token] = {"scope": "manual", "expiresAt": now + 600}
    return {"token": token, "expiresAt": now + 600}


def consume_update_token(token: str, scope: str) -> dict:
    if not token or not isinstance(token, str):
        raise ValueError("missing update token; run check again")
    with UPDATE_TOKEN_LOCK:
        context = UPDATE_TOKENS.pop(token, None)
    if not context or context.get("scope") != scope:
        raise ValueError("invalid or expired update token; run check again")
    if time.time() > float(context.get("expiresAt") or 0):
        raise ValueError("update token expired; run check again")
    return context


def update_public_status() -> dict:
    with UPDATE_JOB_LOCK:
        job = dict(UPDATE_JOB)
    job["bootId"] = BOOT_ID
    if updater:
        job["currentVersion"] = app_version()
        job["backups"] = [
            {key: row.get(key) for key in ("id", "version", "createdAt", "targetVersion")}
            for row in updater.list_backups()[:5]
        ]
        if job.get("status") == "idle":
            job["last"] = updater.last_update()
    else:
        job["currentVersion"] = app_version()
        job["backups"] = []
        job["last"] = None
        job["error"] = job.get("error") or "updater module is not installed"
    return job


def _set_update_job(**fields) -> None:
    with UPDATE_JOB_LOCK:
        UPDATE_JOB.update(fields)


def _restart_bridge() -> None:
    try:
        with LOCK:
            save_state()
    except Exception:
        pass
    try:
        target = str(ROOT / "bridge.py")
        os.execv(sys.executable, [sys.executable, "-u", target] + sys.argv[1:])
    except Exception as exc:
        _set_update_job(
            status="error", stage="restart_failed", code="restart_failed",
            error="bridge restart failed: %s" % exc, finishedAt=now_iso(),
        )


def _run_update_job(kind: str, target: str, archive_path: str = "") -> None:
    def progress(stage, percent, message):
        _set_update_job(stage=stage, percent=int(percent), message=str(message or ""))

    try:
        if kind == "apply":
            result = updater.apply_update(target_version=target, progress=progress)
            to_version = result.get("toVersion") or target
        elif kind == "manual":
            result = updater.apply_archive(archive_path, progress=progress)
            to_version = result.get("toVersion") or target
        else:
            result = updater.rollback_last(progress=progress)
            to_version = result.get("toVersion") or ""
        _set_update_job(
            status="restarting", stage="restarting", percent=100,
            message="restarting bridge", result=result, toVersion=to_version,
        )
        if os.environ.get("BRIDGE_UPDATE_DRY_RUN") == "1":
            _set_update_job(status="done", stage="done", finishedAt=now_iso())
            return
        timer = threading.Timer(1.2, _restart_bridge)
        timer.daemon = True
        timer.start()
    except updater.UpdateError as exc:
        _set_update_job(
            status="error", stage="error", error=str(exc), code=exc.code,
            finishedAt=now_iso(),
        )
        try:
            updater.record_last_update({
                "status": "failed", "action": kind,
                "fromVersion": app_version(), "toVersion": target,
                "message": str(exc), "code": exc.code,
            })
        except Exception:
            pass
    except Exception as exc:
        _set_update_job(
            status="error", stage="error", code="update_failed",
            error="update failed: %s" % exc, finishedAt=now_iso(),
        )
    finally:
        if kind == "manual" and archive_path:
            try:
                os.unlink(archive_path)
            except OSError:
                pass


def start_update_job(kind: str, target: str, archive_path: str = "") -> dict:
    with UPDATE_JOB_LOCK:
        if UPDATE_JOB.get("status") in ("running", "restarting"):
            raise ValueError("an update is already running")
        UPDATE_JOB.update({
            "status": "running", "kind": kind, "stage": "preparing",
            "percent": 0, "message": "preparing", "error": "", "code": "",
            "startedAt": now_iso(), "finishedAt": "", "result": None,
            "fromVersion": app_version(), "toVersion": target,
        })
    thread = threading.Thread(
        target=_run_update_job, args=(kind, target, archive_path), daemon=True
    )
    thread.start()
    return update_public_status()


def online(agent: dict) -> bool:
    if agent.get("demo"):
        return bool(STATE.get("demo"))
    seen = agent.get("lastSeenTs") or 0
    return (time.time() - float(seen)) < 40


def public_agent(agent: dict) -> dict:
    out = dict(agent)
    out["status"] = "online" if online(agent) else "offline"
    out["eventCount"] = sum(1 for e in STATE["events"] if e.get("agentId") == agent.get("id"))
    out.pop("lastSeenTs", None)
    if missions:
        role = _external_agent_role(out)
        out["role"] = role
        out["roleOverride"] = str(agent.get("role") or "")
        out.update(missions.role_label(role))
        out["avatar"] = str(agent.get("avatar") or "auto")
        out["avatarText"] = str(agent.get("avatarText") or "")
        out["avatarColor"] = str(agent.get("avatarColor") or "")
        logo = missions.logo_info(out, "external")
        out.update(logo)
        out["logoSource"] = ("preset" if out["avatar"] not in ("auto", "custom")
                             else out["avatar"])
    return out


def new_pair_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(8))
        if not any(p.get("code") == code for p in STATE.get("pairs", [])):
            return code


def pair_status(pair: dict) -> str:
    status = pair.get("status", "pending")
    if status == "pending" and time.time() > float(pair.get("expiresAt") or 0):
        return "expired"
    return status


def public_pair(pair: dict) -> dict:
    out = dict(pair)
    out["status"] = pair_status(pair)
    return out


def find_pair(code: str):
    for p in STATE.get("pairs", []):
        if p.get("code") == code:
            return p
    return None


def pair_setup_url(base: str, code: str) -> str:
    return base + "/pair/" + code + "/setup.md"


def pair_message(base: str, code: str, expires_at: float, role_name: str = "") -> str:
    setup = pair_setup_url(base, code)
    exp = time.strftime("%H:%M:%S", time.localtime(expires_at))
    role_line = ("绑定角色：" + role_name + "。领取后会直接接管这个角色，不要重复领取。\n\n"
                 if role_name else "")
    return (
        "你正在接入 Agent Office。\n\n"
        + role_line +
        "1. 打开下面的接入说明并按其操作：\n" + setup + "\n\n"
        "2. 连接码：" + code + "（一次性，30 分钟内有效，过期时间 " + exp + "）\n"
        "3. 完成后请向 Agent Office 发送一条问候事件，并在界面里确认接入。\n\n"
        "如果连接码已过期或被使用，请在 Agent Office 里重新生成一段。"
    )


def pair_setup_markdown(base: str, pair: dict) -> str:
    code = pair["code"]
    exp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(pair["expiresAt"]))
    role_line = ("- Role: `" + str(pair.get("roleId")) + "` (claim binds the existing role slot)\n"
                 if pair.get("roleId") else "")
    return (
        "# Agent Office · External Agent Pairing\n\n"
        "You are connecting an external agent to Agent Office.\n\n"
        "- Bridge: `" + base + "`\n"
        "- Connect code: `" + code + "`\n"
        "- Expires: " + exp + " (one-time)\n"
        + role_line + "\n"
        "## 1. Claim this identity\n\n"
        "```bash\n"
        "curl -X POST " + base + "/pair/" + code + "/claim \\\n"
        "  -H 'Content-Type: application/json' \\\n"
        "  -d '{\"name\":\"Your Agent\",\"runtime\":\"claude-code\",\"skills\":[\"repo-map\",\"edit\",\"test\"]}'\n"
        "```\n\n"
        "The response contains `agent.id` and `bridge`. Store them.\n\n"
        "## 2. Heartbeat\n\n"
        "```bash\n"
        "curl -X POST " + base + "/agents/<agent-id>/heartbeat \\\n"
        "  -H 'Content-Type: application/json' -d '{\"note\":\"alive\"}'\n"
        "```\n\n"
        "## 3. Report work events\n\n"
        "```bash\n"
        "curl -X POST " + base + "/events \\\n"
        "  -H 'Content-Type: application/json' \\\n"
        "  -d '{\"agentId\":\"<agent-id>\",\"kind\":\"skill\",\"action\":\"inspect repo\",\"skill\":\"repo-map\",\"tool\":\"bash\"}'\n"
        "```\n\n"
        "## 4. Greeting\n\n"
        "Send `POST /events` with `kind: \"hello\"` and a short greeting. It will appear in Agent Office.\n\n"
        "## 5. Work on delegated tasks\n\n"
        "Poll assignments for this agent:\n\n"
        "```bash\n"
        "curl " + base + "/assignments?agentId=<agent-id>\n"
        "```\n\n"
        "Report progress or completion:\n\n"
        "```bash\n"
        "curl -X PATCH " + base + "/assignments/<assignment-id> \\\n"
        "  -H 'Content-Type: application/json' \\\n"
        "  -d '{\"status\":\"completed\",\"progress\":100,\"result\":\"done\",\"evidence\":[\"tests/12-passed\"]}'\n"
        "```\n"
    )


def create_agent_from_payload(body: dict, agent_id=None) -> dict:
    agent_id = agent_id or str(body.get("id") or ("ext-" + uuid.uuid4().hex[:8]))
    updates = clean_agent_updates(body)
    existing = find_agent(agent_id)
    if existing:
        existing.update(updates)
        return existing
    agent = {
        "id": agent_id,
        "name": str(body.get("name") or "External Agent")[:40],
        "runtime": str(body.get("runtime") or "http")[:40],
        "endpoint": str(body.get("endpoint") or "")[:300],
        "skills": body.get("skills") if isinstance(body.get("skills"), list) else [],
        "note": str(body.get("note") or "")[:300],
        "color": str(body.get("color") or "#b58cff"),
        "role": "",
        "avatar": "auto",
        "avatarText": "",
        "avatarColor": "",
        "createdAt": now_iso(),
        "lastSeen": None,
        "lastSeenTs": 0,
    }
    agent.update(updates)
    STATE["agents"].append(agent)
    return agent


def find_agent(agent_id: str):
    for a in STATE["agents"]:
        if a.get("id") == agent_id:
            return a
    return None


ASSIGNMENT_ACTIVE = ("assigned", "in_progress")
ASSIGNMENT_TERMINAL = ("completed", "failed", "cancelled")


def public_assignment(assignment: dict) -> dict:
    out = dict(assignment)
    agent = find_agent(out.get("agentId") or "")
    if agent:
        out["agentName"] = agent.get("name") or out.get("agentName")
        out["agentStatus"] = "online" if online(agent) else "offline"
        out["provider"] = agent.get("provider") or agent.get("runtime")
    else:
        out["agentStatus"] = "offline"
        out["provider"] = ""
    return out


def find_assignment(assignment_id: str):
    for assignment in STATE.get("assignments", []):
        if assignment.get("id") == assignment_id:
            return assignment
    return None


def add_assignment(body: dict) -> dict:
    agent = find_agent(str(body.get("agentId") or ""))
    if not agent:
        raise ValueError("unknown agentId")
    task_id = str(body.get("taskId") or "").strip()[:80]
    title = str(body.get("title") or "").strip()[:160]
    if not task_id or not title:
        raise ValueError("taskId and title are required")
    now = now_iso()
    assignment = {
        "id": "asg-" + uuid.uuid4().hex[:8],
        "agentId": agent["id"],
        "agentName": agent.get("name"),
        "taskId": task_id,
        "taskTitle": title,
        "scenarioId": str(body.get("scenarioId") or "")[:40],
        "runId": str(body.get("runId") or "")[:64],
        "companyId": str(body.get("companyId") or "")[:64],
        "companyTaskId": str(body.get("companyTaskId") or "")[:80],
        "roleId": str(body.get("roleId") or "")[:40],
        "roomId": str(body.get("roomId") or "")[:80],
        "executionId": str(body.get("executionId") or ("exec-" + uuid.uuid4().hex[:10]))[:64],
        "brief": str(body.get("brief") or "")[:800],
        "status": "assigned",
        "progress": 0,
        "result": "",
        "evidence": [],
        "createdAt": now,
        "updatedAt": now,
        "completedAt": None,
    }
    STATE.setdefault("assignments", []).append(assignment)
    # Keep active work; retain recent history.
    active = [a for a in STATE["assignments"] if a.get("status") in ASSIGNMENT_ACTIVE]
    done = [a for a in STATE["assignments"] if a.get("status") not in ASSIGNMENT_ACTIVE]
    STATE["assignments"] = done[-80:] + active
    event = add_event({
        "agentId": agent["id"],
        "taskId": task_id,
        "kind": "handoff",
        "action": "委托任务 · " + title,
        "skill": "delegation",
        "tool": "bridge",
        "status": "delegated",
        "note": assignment["brief"] or "通过 Agent Office 委托",
        "provider": agent.get("provider"),
    })
    assignment["lastEventId"] = event.get("id")
    save_state()
    return assignment


def update_assignment(assignment_id: str, body: dict) -> dict:
    assignment = find_assignment(assignment_id)
    if not assignment:
        raise ValueError("unknown assignment")
    current = assignment.get("status") or "assigned"
    if current in ASSIGNMENT_TERMINAL:
        if body.get("status") in (None, current):
            return assignment
        raise ValueError("assignment is already " + current)
    status = str(body.get("status") or current)
    allowed = {"assigned", "in_progress", "completed", "failed", "cancelled"}
    if status not in allowed:
        raise ValueError("invalid status")
    if current == "assigned" and status not in ("in_progress", "completed", "failed", "cancelled"):
        raise ValueError("invalid transition")
    try:
        progress = int(body.get("progress", assignment.get("progress") or 0))
    except (TypeError, ValueError):
        raise ValueError("progress must be an integer")
    progress = max(0, min(100, progress))
    if status in ("completed", "failed", "cancelled"):
        progress = 100 if status == "completed" else progress
    result = str(body.get("result") or "").strip()[:1200]
    if result:
        assignment["result"] = result
    evidence = body.get("evidence")
    if isinstance(evidence, list):
        assignment["evidence"] = [str(item)[:300] for item in evidence[:20]]
    assignment["status"] = status
    assignment["progress"] = progress
    assignment["updatedAt"] = now_iso()
    if status in ASSIGNMENT_TERMINAL:
        assignment["completedAt"] = assignment.get("completedAt") or now_iso()
    agent = find_agent(assignment["agentId"])
    if agent:
        agent["lastSeen"] = now_iso()
        agent["lastSeenTs"] = time.time()
    if status == "completed":
        event = add_event({
            "agentId": assignment["agentId"],
            "taskId": assignment["taskId"],
            "kind": "complete",
            "action": "外部任务完成 · " + assignment["taskTitle"],
            "skill": "external-complete",
            "tool": "bridge",
            "status": "done",
            "note": result or "外部 Agent 自报完成",
            "provider": agent.get("provider") if agent else None,
        })
    elif status == "failed":
        event = add_event({
            "agentId": assignment["agentId"],
            "taskId": assignment["taskId"],
            "kind": "risk",
            "action": "外部任务失败 · " + assignment["taskTitle"],
            "skill": "external-failure",
            "tool": "bridge",
            "status": "failed",
            "note": result or "外部 Agent 自报失败",
            "provider": agent.get("provider") if agent else None,
        })
    elif status == "cancelled":
        event = add_event({
            "agentId": assignment["agentId"],
            "taskId": assignment["taskId"],
            "kind": "risk",
            "action": "外部任务取消 · " + assignment["taskTitle"],
            "skill": "external-cancel",
            "tool": "bridge",
            "status": "cancelled",
            "note": result or "委托已取消",
            "provider": agent.get("provider") if agent else None,
        })
    else:
        if status == "in_progress" and current == "assigned":
            assignment["status"] = "in_progress"
        event = add_event({
            "agentId": assignment["agentId"],
            "taskId": assignment["taskId"],
            "kind": "skill",
            "action": "外部任务进度 · " + assignment["taskTitle"] + " · " + str(progress) + "%",
            "skill": "external-progress",
            "tool": "bridge",
            "status": "in_progress",
            "note": result or ("进度 " + str(progress) + "%"),
            "provider": agent.get("provider") if agent else None,
        })
    assignment["lastEventId"] = event.get("id")
    sync_company_from_assignment(assignment)
    if agent:
        save_state()
    return assignment


COMPANY_ROLE_DEFS = [
    {"id": "chief", "titleZh": "运营操盘手", "titleEn": "Chief of Staff",
     "missionZh": "拆目标、排优先级、主持复盘，保证公司只在关键路径上花时间。",
     "missionEn": "Turn goals into priorities, unblock work and run the weekly review.",
     "skills": ["planning", "coordination", "review"], "color": "#d0a27a", "room": "founder"},
    {"id": "product", "titleZh": "产品策略", "titleEn": "Product Strategist",
     "missionZh": "定义 Offer、ICP、MVP 范围和验收标准。",
     "missionEn": "Define the offer, ICP, MVP scope and acceptance criteria.",
     "skills": ["research", "prd", "positioning"], "color": "#55d6c2", "room": "product"},
    {"id": "copy", "titleZh": "文案", "titleEn": "Copywriter",
     "missionZh": "写落地页、邮件、内容和发布文案，统一品牌语气。",
     "missionEn": "Write landing pages, emails, content and launch copy in one brand voice.",
     "skills": ["copy", "seo", "email"], "color": "#ff9ec0", "room": "product"},
    {"id": "design", "titleZh": "设计", "titleEn": "Designer",
     "missionZh": "定品牌方向、页面结构和视觉资产，保证移动端体验。",
     "missionEn": "Set brand direction, page structure and visual assets for mobile-first delivery.",
     "skills": ["brand", "ui", "figma"], "color": "#b58cff", "room": "product"},
    {"id": "engineer", "titleZh": "工程师", "titleEn": "Engineer",
     "missionZh": "搭建可上线的产品页面和自动化，提交可验证的文件与测试。",
     "missionEn": "Build the shippable product and automation, with verifiable files and tests.",
     "skills": ["frontend", "backend", "deploy"], "color": "#7cb7ff", "room": "build"},
    {"id": "qa", "titleZh": "测试", "titleEn": "QA",
     "missionZh": "做主流程、边界、回归、无障碍和发布前检查。",
     "missionEn": "Cover main flows, edge cases, regression, accessibility and release checks.",
     "skills": ["test", "accessibility", "release"], "color": "#f2b544", "room": "build"},
    {"id": "growth", "titleZh": "增长", "titleEn": "Growth",
     "missionZh": "做发布计划、埋点、渠道实验和复盘指标。",
     "missionEn": "Own launch plan, analytics, channel experiments and review metrics.",
     "skills": ["launch", "analytics", "content"], "color": "#74d6a3", "room": "launch"},
    {"id": "video", "titleZh": "视频制作", "titleEn": "Video Producer",
     "missionZh": "把产品价值变成短视频脚本、分镜和发布素材。",
     "missionEn": "Turn the product value into scripts, storyboards and launch video assets.",
     "skills": ["script", "video", "editing"], "color": "#e3a06c", "room": "launch"},
]

COMPANY_TASK_DEFS = [
    {"id": "t1", "titleZh": "定义 Offer 与 ICP", "titleEn": "Define offer and ICP",
     "briefZh": "写清楚卖给谁、解决什么问题、为什么现在买、成功标准是什么。",
     "briefEn": "Define who buys, the problem, why now, and the success criteria.",
     "roleId": "product", "deps": []},
    {"id": "t2", "titleZh": "客户与竞品研究", "titleEn": "Customer and competitor research",
     "briefZh": "找 5 个竞品和 5 个潜在客户，提炼可执行差异点。",
     "briefEn": "Review five competitors and five prospects; extract actionable differences.",
     "roleId": "product", "deps": []},
    {"id": "t3", "titleZh": "落地页文案", "titleEn": "Landing page copy",
     "briefZh": "基于 Offer 写首屏、价值点、FAQ 和 CTA，全部可上线。",
     "briefEn": "Write hero, value props, FAQ and CTA based on the offer; ready to ship.",
     "roleId": "copy", "deps": ["t1"]},
    {"id": "t4", "titleZh": "品牌与页面视觉", "titleEn": "Brand and page direction",
     "briefZh": "定色彩、字体、组件和移动端首屏，输出设计说明。",
     "briefEn": "Set color, type, components and mobile hero; output design notes.",
     "roleId": "design", "deps": ["t1"]},
    {"id": "t5", "titleZh": "搭建产品落地页", "titleEn": "Build the landing page",
     "briefZh": "实现页面、表单、响应式和分析埋点，提交文件与测试。",
     "briefEn": "Implement the page, form, responsive states and analytics; submit files and tests.",
     "roleId": "engineer", "deps": ["t3", "t4"]},
    {"id": "t6", "titleZh": "埋点与分析", "titleEn": "Analytics and tracking",
     "briefZh": "定义转化事件、看板和归因方式，验证数据能回来。",
     "briefEn": "Define conversion events, dashboard and attribution; verify data arrives.",
     "roleId": "growth", "deps": ["t5"]},
    {"id": "t7", "titleZh": "发布前 QA", "titleEn": "Pre-release QA",
     "briefZh": "跑主流程、边界、移动端、无障碍和回滚检查。",
     "briefEn": "Run main flows, edge cases, mobile, accessibility and rollback checks.",
     "roleId": "qa", "deps": ["t5"]},
    {"id": "t8", "titleZh": "发布计划", "titleEn": "Launch plan",
     "briefZh": "写发布节奏、渠道、公告、客服话术和失败预案。",
     "briefEn": "Write launch cadence, channels, announcement, support copy and rollback plan.",
     "roleId": "growth", "deps": ["t6", "t7"]},
    {"id": "t9", "titleZh": "内容日历", "titleEn": "Content calendar",
     "briefZh": "排 30 天内容，围绕 Offer 做可复用选题和分发。",
     "briefEn": "Plan 30 days of content with reusable angles and distribution.",
     "roleId": "copy", "deps": ["t8"]},
    {"id": "t10", "titleZh": "发布视频", "titleEn": "Launch video",
     "briefZh": "写 30 秒脚本、分镜和素材清单，交付可剪辑版本。",
     "briefEn": "Write a 30-second script, storyboard and asset list for editing.",
     "roleId": "video", "deps": ["t8"]},
    {"id": "t11", "titleZh": "本周复盘", "titleEn": "Weekly review",
     "briefZh": "汇总交付、指标、风险和下周唯一优先级。",
     "briefEn": "Summarize delivery, metrics, risks and next week's single priority.",
     "roleId": "chief", "deps": ["t8", "t9", "t10"]},
]

COMPANY_DEPARTMENTS = [
    {"id": "founder", "nameZh": "创始人会议室", "nameEn": "Founder Room",
     "roleIds": ["chief", "product", "copy", "design", "engineer", "qa", "growth", "video"]},
    {"id": "product", "nameZh": "产品与内容", "nameEn": "Product & Content",
     "roleIds": ["product", "copy", "design", "chief"]},
    {"id": "build", "nameZh": "构建与质量", "nameEn": "Build & Quality",
     "roleIds": ["engineer", "qa", "design", "chief"]},
    {"id": "launch", "nameZh": "发布与增长", "nameEn": "Launch & Growth",
     "roleIds": ["growth", "copy", "video", "chief"]},
]


def company_text(obj, lang, base):
    return obj.get(base + ("En" if lang == "en" else "Zh"), obj.get(base + "Zh", ""))


def company_role_agent_id(role_id):
    return "opc-" + role_id


def find_company_room(room_id):
    company = STATE.get("company")
    if not company:
        return None
    for room in company.get("rooms", []):
        if room.get("id") == room_id:
            return room
    return None


def find_company_task(task_id):
    company = STATE.get("company")
    if not company:
        return None
    for task in company.get("tasks", []):
        if task.get("id") == task_id:
            return task
    return None


def add_chat_message(room_id, content, kind="system", agent_id=None,
                     assignment_id=None, execution_id=None, task_id=None,
                     company_id=None, extra=None):
    company = STATE.get("company")
    if not company:
        raise ValueError("no company")
    room = find_company_room(room_id)
    if not room:
        raise ValueError("unknown room")
    agent = find_agent(agent_id) if agent_id else None
    STATE["messageSeq"] = int(STATE.get("messageSeq") or 0) + 1
    message = {
        "id": STATE["messageSeq"],
        "companyId": company_id or company.get("id"),
        "roomId": room_id,
        "kind": kind,
        "agentId": agent_id,
        "agentName": agent.get("name") if agent else None,
        "roleId": agent.get("roleId") if agent else None,
        "content": str(content or "")[:4000],
        "taskId": task_id or room.get("taskId"),
        "assignmentId": assignment_id,
        "executionId": execution_id,
        "createdAt": now_iso(),
    }
    if extra and isinstance(extra, dict):
        message.update(extra)
    STATE.setdefault("messages", []).append(message)
    if len(STATE["messages"]) > 3000:
        STATE["messages"] = STATE["messages"][-3000:]
    company["lastMessageAt"] = message["createdAt"]
    return message


def public_company():
    company = STATE.get("company")
    if not company:
        return None
    out = dict(company)
    out["roles"] = []
    for role in company.get("roles", []):
        item = dict(role)
        agent = find_agent(role.get("agentId") or "")
        item["agentName"] = agent.get("name") if agent else role.get("titleZh")
        item["agentStatus"] = ("online" if online(agent) else "offline") if agent else "offline"
        item["agentRuntime"] = agent.get("runtime") if agent else "unbound"
        out["roles"].append(item)
    out["tasks"] = [dict(t) for t in company.get("tasks", [])]
    out["rooms"] = [dict(r) for r in company.get("rooms", [])]
    out["assignments"] = [public_assignment(a) for a in STATE.get("assignments", [])
                          if a.get("companyTaskId")]
    return out


def company_bootstrap(body):
    now = now_iso()
    lang = "en" if str(body.get("language") or "").lower().startswith("en") else "zh"
    existing = STATE.get("company")
    if existing and not body.get("replace"):
        raise ValueError("company already exists; pass replace=true to rebuild")
    with LOCK:
        if existing:
            old_id = existing.get("id")
            STATE["agents"] = [a for a in STATE["agents"]
                               if a.get("companyId") != old_id]
            STATE["assignments"] = [a for a in STATE.get("assignments", [])
                                    if a.get("companyId") != old_id]
            STATE["messages"] = []
            STATE["messageSeq"] = 0
        company_id = "opc-" + uuid.uuid4().hex[:8]
        name = str(body.get("name") or "Solo Company")[:80]
        product = str(body.get("product") or "")[:240]
        goal = str(body.get("goal") or "")[:400]
        roles = []
        for role in COMPANY_ROLE_DEFS:
            role_agent_id = company_role_agent_id(role["id"])
            agent = {
                "id": role_agent_id,
                "name": company_text(role, lang, "title"),
                "runtime": "role-slot",
                "endpoint": "",
                "skills": list(role["skills"]),
                "note": company_text(role, lang, "mission"),
                "color": role["color"],
                "createdAt": now,
                "lastSeen": None,
                "lastSeenTs": 0,
                "companyId": company_id,
                "roleId": role["id"],
            }
            STATE["agents"].append(agent)
            roles.append({
                "id": role["id"],
                "titleZh": role["titleZh"],
                "titleEn": role["titleEn"],
                "missionZh": role["missionZh"],
                "missionEn": role["missionEn"],
                "skills": list(role["skills"]),
                "color": role["color"],
                "agentId": role_agent_id,
            })
        rooms = []
        role_agents = {r["id"]: company_role_agent_id(r["id"]) for r in COMPANY_ROLE_DEFS}
        for dept in COMPANY_DEPARTMENTS:
            rooms.append({
                "id": "opc-room-" + dept["id"],
                "name": company_text(dept, lang, "name"),
                "nameZh": dept["nameZh"],
                "nameEn": dept["nameEn"],
                "kind": "department",
                "companyId": company_id,
                "memberIds": [role_agents[r] for r in dept["roleIds"]] + ["human"],
                "createdAt": now,
            })
        tasks = []
        for task_def in COMPANY_TASK_DEFS:
            task_id = "opc-" + task_def["id"]
            room_id = "opc-task-" + task_def["id"]
            rooms.append({
                "id": room_id,
                "name": task_id,
                "nameZh": "任务 · " + task_def["titleZh"],
                "nameEn": "Task · " + task_def["titleEn"],
                "kind": "task",
                "companyId": company_id,
                "taskId": task_id,
                "roleId": task_def["roleId"],
                "memberIds": [role_agents[task_def["roleId"]], "human"],
                "createdAt": now,
            })
            tasks.append({
                "id": task_id,
                "titleZh": task_def["titleZh"],
                "titleEn": task_def["titleEn"],
                "briefZh": task_def["briefZh"],
                "briefEn": task_def["briefEn"],
                "roleId": task_def["roleId"],
                "deps": ["opc-" + dep for dep in task_def["deps"]],
                "status": "waiting",
                "progress": 0,
                "assignmentId": None,
                "executionId": None,
                "roomId": room_id,
                "result": "",
                "evidence": [],
                "createdAt": now,
                "updatedAt": now,
                "completedAt": None,
            })
        company = {
            "id": company_id,
            "name": name,
            "product": product,
            "goal": goal,
            "language": lang,
            "template": "one-person-company",
            "createdAt": now,
            "roles": roles,
            "tasks": tasks,
            "rooms": rooms,
            "lastMessageAt": now,
        }
        STATE["company"] = company
        add_chat_message(
            "opc-room-founder",
            ("公司已创建：" + name + "。目标：" + goal) if lang == "zh"
            else ("Company created: " + name + ". Goal: " + goal),
            kind="system",
        )
        dispatch_ready_company_tasks(company)
        save_state()
        return company


def dispatch_ready_company_tasks(company=None):
    company = company or STATE.get("company")
    if not company:
        return 0
    language = company.get("language", "zh")
    dispatched = 0
    for task in company.get("tasks", []):
        if task.get("status") not in ("waiting", "backlog") or task.get("assignmentId"):
            continue
        deps = task.get("deps") or []
        completed = {t.get("id") for t in company.get("tasks", [])
                     if t.get("status") == "completed"}
        if any(dep not in completed for dep in deps):
            continue
        role = next((r for r in company.get("roles", []) if r.get("id") == task.get("roleId")), None)
        if not role:
            continue
        assignment = add_assignment({
            "agentId": role.get("agentId"),
            "taskId": task["id"],
            "title": company_text(task, language, "title"),
            "scenarioId": "company",
            "runId": company.get("id"),
            "companyTaskId": task["id"],
            "companyId": company.get("id"),
            "roleId": role.get("id"),
            "roomId": task.get("roomId"),
            "brief": company_text(task, language, "brief"),
        })
        task["status"] = "assigned"
        task["assignmentId"] = assignment["id"]
        task["executionId"] = assignment.get("executionId")
        task["updatedAt"] = now_iso()
        add_chat_message(
            task.get("roomId"),
            ("任务已派发：" + company_text(task, language, "title") +
             " → " + company_text(role, language, "title")) if language == "zh"
            else ("Task dispatched: " + company_text(task, language, "title") +
                  " -> " + company_text(role, language, "title")),
            kind="system", assignment_id=assignment["id"],
            execution_id=assignment.get("executionId"), task_id=task["id"],
        )
        dispatched += 1
    return dispatched


def sync_company_from_assignment(assignment):
    company = STATE.get("company")
    if not company or assignment.get("companyId") != company.get("id"):
        return
    task = find_company_task(assignment.get("companyTaskId") or "")
    if not task:
        return
    status = assignment.get("status", "assigned")
    task["progress"] = assignment.get("progress", 0)
    task["result"] = assignment.get("result", "")
    task["evidence"] = list(assignment.get("evidence") or [])
    task["assignmentId"] = assignment.get("id")
    task["executionId"] = assignment.get("executionId")
    task["updatedAt"] = now_iso()
    if status == "assigned":
        task["status"] = "assigned"
    elif status == "in_progress":
        task["status"] = "in_progress"
    elif status == "completed":
        task["status"] = "completed"
        task["completedAt"] = assignment.get("completedAt") or now_iso()
    elif status == "failed":
        task["status"] = "failed"
    elif status == "cancelled":
        task["status"] = "waiting"
        task["assignmentId"] = None
        task["executionId"] = None
    language = company.get("language", "zh")
    room_id = assignment.get("roomId") or task.get("roomId")
    content = ("任务 " + company_text(task, language, "title") + " · " +
               status + " · " + str(task.get("progress", 0)) + "%")
    if status == "completed" and task.get("result"):
        content += " · " + task["result"][:180]
    add_chat_message(
        room_id, content, kind="system", agent_id=assignment.get("agentId"),
        assignment_id=assignment.get("id"), execution_id=assignment.get("executionId"),
        task_id=task.get("id"),
    )
    if status == "completed":
        dispatch_ready_company_tasks(company)


def company_post_message(body):
    company = STATE.get("company")
    if not company:
        raise ValueError("no company")
    room_id = str(body.get("roomId") or "").strip()
    room = find_company_room(room_id)
    if not room:
        raise ValueError("unknown room")
    content = str(body.get("content") or "").strip()
    if not content:
        raise ValueError("message is empty")
    agent_id = str(body.get("agentId") or "").strip() or None
    assignment_id = str(body.get("assignmentId") or "").strip() or None
    execution_id = str(body.get("executionId") or "").strip() or None
    if agent_id:
        agent = find_agent(agent_id)
        if not agent or agent.get("companyId") != company.get("id"):
            raise ValueError("agent is not a member of this company")
        if room.get("kind") == "task":
            if not assignment_id or not execution_id:
                raise ValueError("task-room messages require assignmentId and executionId")
            assignment = find_assignment(assignment_id)
            if not assignment:
                raise ValueError("unknown assignment")
            if assignment.get("agentId") != agent_id:
                raise ValueError("assignment does not belong to agent")
            if assignment.get("roomId") != room_id:
                raise ValueError("assignment is bound to another room")
            if assignment.get("executionId") != execution_id:
                raise ValueError("execution context mismatch")
            if assignment.get("companyTaskId") != room.get("taskId"):
                raise ValueError("assignment is bound to another task")
            if assignment.get("status") not in ("assigned", "in_progress", "completed"):
                raise ValueError("assignment is not active")
        elif agent_id not in (room.get("memberIds") or []):
            raise ValueError("agent is not a member of this room")
        message = add_chat_message(
            room_id, content, kind="agent", agent_id=agent_id,
            assignment_id=assignment_id, execution_id=execution_id,
            task_id=room.get("taskId"), company_id=company.get("id"),
        )
    else:
        message = add_chat_message(
            room_id, content, kind="human", task_id=room.get("taskId"),
            company_id=company.get("id"),
        )
    save_state()
    return message


def ensure_demo_agent() -> dict:
    agent = find_agent("ext-demo-claude")
    if not agent:
        agent = {
            "id": "ext-demo-claude",
            "name": "Claude Code · Remote",
            "runtime": "claude-code",
            "endpoint": "local://bridge/demo",
            "skills": ["repo-map", "edit", "test", "review"],
            "note": "Bridge 内置演示外部 agent；真实 agent 可通过 /events 上报。",
            "color": "#55d6c2",
            "createdAt": now_iso(),
            "lastSeen": None,
            "lastSeenTs": 0,
            "demo": True,
        }
        STATE["agents"].append(agent)
    agent["lastSeen"] = now_iso()
    agent["lastSeenTs"] = time.time()
    save_state()
    return agent


def add_event(payload: dict) -> dict:
    with LOCK:
        agent = find_agent(payload.get("agentId") or "")
        if not agent:
            raise ValueError("unknown agentId")
        event = {
            "id": int(STATE["nextEvent"]),
            "ts": now_iso(),
            "agentId": agent["id"],
            "agentName": agent.get("name"),
            "runtime": agent.get("runtime"),
            "provider": payload.get("provider") or agent.get("provider"),
            "kind": str(payload.get("kind") or "external")[:32],
            "action": str(payload.get("action") or "external event")[:240],
            "taskId": payload.get("taskId"),
            "skill": payload.get("skill"),
            "tool": payload.get("tool"),
            "file": payload.get("file"),
            "line": payload.get("line"),
            "add": int(payload.get("add") or 0),
            "del": int(payload.get("del") or 0),
            "note": str(payload.get("note") or "")[:500],
            "tokensIn": int(payload.get("tokensIn") or 0),
            "tokensOut": int(payload.get("tokensOut") or 0),
            "cost": float(payload.get("cost") or 0),
            "durationMs": int(payload.get("durationMs") or 0),
            "model": payload.get("model") or agent.get("model") or "external-agent",
            "external": True,
        }
        STATE["nextEvent"] += 1
        STATE["events"].append(event)
        if len(STATE["events"]) > 3000:
            STATE["events"] = STATE["events"][-3000:]
        agent["lastSeen"] = now_iso()
        agent["lastSeenTs"] = time.time()
        save_state()
        return event


DEMO_SEQUENCE = [
    {
        "kind": "skill", "action": "读取仓库并生成变更计划",
        "taskId": "t4", "skill": "repo-map", "tool": "claude-code",
        "file": "src/pages/Home.tsx", "line": [24, 118], "add": 12, "del": 2,
        "tokensIn": 1460, "tokensOut": 420, "durationMs": 2800,
        "model": "claude-sonnet-5-5", "note": "外部 agent：先读上下文，不直接改代码",
    },
    {
        "kind": "skill", "action": "修改首屏 Hero 的空状态",
        "taskId": "t4", "skill": "react", "tool": "edit",
        "file": "src/components/Hero.tsx", "line": [1, 142], "add": 8, "del": 3,
        "tokensIn": 980, "tokensOut": 510, "durationMs": 2100,
        "model": "claude-sonnet-5-5", "note": "外部 agent demo 写入",
    },
    {
        "kind": "review", "action": "外部自检：typecheck + unit tests",
        "taskId": "t4", "skill": "testing", "tool": "bash",
        "file": "tests/e2e/launch.spec.ts", "line": [1, 140], "add": 0, "del": 0,
        "tokensIn": 620, "tokensOut": 160, "durationMs": 3400,
        "model": "claude-sonnet-5-5", "note": "12 passed · 0 failed",
    },
    {
        "kind": "external", "action": "回传执行摘要与风险",
        "taskId": "t4", "skill": "synthesis", "tool": "bridge",
        "tokensIn": 380, "tokensOut": 190, "durationMs": 600,
        "model": "claude-sonnet-5-5", "note": "需要人类确认 a11y 与安全缺口",
    },
]


def demo_loop():
    idx = 0
    print("demo loop running", flush=True)
    while not DEMO_STOP.wait(2.4):
        try:
            with LOCK:
                ensure_demo_agent()
                active = next(
                    (a for a in STATE.get("assignments", [])
                     if a.get("agentId") == "ext-demo-claude"
                     and a.get("status") in ("assigned", "in_progress")),
                    None,
                )
                if active:
                    progress = min(100, int(active.get("progress") or 0) + 25)
                    body = {
                        "status": "completed" if progress >= 100 else "in_progress",
                        "progress": progress,
                        "result": "演示 Agent 已处理任务并回写证据。",
                        "evidence": ["demo://workspace", "demo://tests/12-passed"],
                    }
                    active = update_assignment(active["id"], body)
                    print("demo assignment", active["id"], active["status"], progress, flush=True)
                else:
                    item = dict(DEMO_SEQUENCE[idx % len(DEMO_SEQUENCE)])
                    item["agentId"] = "ext-demo-claude"
                    idx += 1
                    ev = add_event(item)
                    print("demo event", ev["id"], flush=True)
        except Exception as exc:
            import traceback
            print("demo error:", exc, flush=True)
            traceback.print_exc()
            time.sleep(1)


def start_demo() -> None:
    global DEMO_THREAD
    with LOCK:
        STATE["demo"] = True
        ensure_demo_agent()
        # Emit the first event immediately so the UI sees the link working.
        first = dict(DEMO_SEQUENCE[0])
        first["agentId"] = "ext-demo-claude"
        add_event(first)
        save_state()
        if DEMO_THREAD and DEMO_THREAD.is_alive():
            return
        DEMO_STOP.clear()
        DEMO_THREAD = threading.Thread(target=demo_loop, name="agent-office-demo", daemon=True)
        DEMO_THREAD.start()
        print("demo thread started", flush=True)


def stop_demo() -> None:
    global DEMO_THREAD
    with LOCK:
        STATE["demo"] = False
        save_state()
    DEMO_STOP.set()
    DEMO_THREAD = None


class Handler(BaseHTTPRequestHandler):
    server_version = "AgentOfficeBridge/1.0"
    allowed_origin = ""

    def log_message(self, fmt, *args):  # quieter logs
        if os.environ.get("BRIDGE_VERBOSE"):
            super().log_message(fmt, *args)

    def request_gate(self):
        """Reject non-local Host/Origin pairs before touching bridge state."""
        host = self.headers.get("Host") or ""
        origin = self.headers.get("Origin") or ""
        if not host_allowed(host):
            self.send_json({"error": "host not allowed"}, 403)
            return False
        if not origin_allowed(origin):
            self.send_json({"error": "origin not allowed; serve the app from localhost"}, 403)
            return False
        self.allowed_origin = origin
        return True

    def cors(self):
        if self.allowed_origin:
            self.send_header("Access-Control-Allow-Origin", self.allowed_origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, X-Update-Token, X-Filename, X-Mime, X-Mission-Id, "
            "X-Conversation-Id, X-Uploaded-By",
        )
        self.send_header("Cache-Control", "no-store")

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text, status=200, content_type="text/markdown; charset=utf-8"):
        body = text.encode("utf-8")
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, body, content_type="application/octet-stream",
                   filename="", inline=False):
        self.send_response(200)
        self.cors()
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        disposition = "inline" if inline else "attachment"
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", filename or "file")[:120]
        self.send_header("Content-Disposition",
                         disposition + '; filename="' + safe_name + '"')
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def base_url(self):
        host = self.headers.get("Host") or ("127.0.0.1:" + str(self.server.server_address[1]))
        return "http://" + host

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 2 * 1024 * 1024:
            raise ValueError("body too large")
        raw = self.rfile.read(length) if length else b"{}"
        data = json.loads(raw.decode("utf-8") or "{}")
        if not isinstance(data, dict):
            raise ValueError("body must be an object")
        return data

    def handle_manual_update(self):
        if not updater:
            self.send_json({"error": "updater module is not installed",
                            "code": "no_updater"}, 503)
            return
        with UPDATE_JOB_LOCK:
            busy = UPDATE_JOB.get("status") in ("running", "restarting")
        if busy:
            self.send_json({"error": "an update is already running",
                            "code": "update_busy"}, 409)
            return
        try:
            consume_update_token(self.headers.get("X-Update-Token"), "manual")
        except ValueError as exc:
            self.send_json({"error": str(exc), "code": "bad_token"}, 403)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self.send_json({"error": "empty update archive", "code": "empty_archive"}, 400)
            return
        if length > updater.MAX_ARCHIVE:
            self.send_json({"error": "update archive is too large",
                            "code": "too_large"}, 413)
            return
        filename = unquote(self.headers.get("X-Filename") or "release.tar.gz")
        filename = os.path.basename(filename.replace("\\", "/"))[:120] or "release.tar.gz"
        lower = filename.lower()
        if not lower.endswith((".tar.gz", ".tgz", ".zip", ".tar")):
            self.send_json({"error": "archive must be .tar.gz, .tgz, .zip or .tar",
                            "code": "bad_archive"}, 400)
            return
        suffix = ".zip" if lower.endswith(".zip") else (
            ".tar.gz" if lower.endswith(".tar.gz") else (
                ".tgz" if lower.endswith(".tgz") else ".tar"))
        handle = tempfile.NamedTemporaryFile(
            prefix="agent-office-upload-", suffix=suffix, delete=False
        )
        path = handle.name
        remaining = length
        try:
            while remaining > 0:
                chunk = self.rfile.read(min(64 * 1024, remaining))
                if not chunk:
                    raise ValueError("upload ended early")
                handle.write(chunk)
                remaining -= len(chunk)
            handle.close()
            job = start_update_job("manual", "", path)
        except ValueError as exc:
            handle.close()
            try:
                os.unlink(path)
            except OSError:
                pass
            self.send_json({"error": str(exc), "code": "bad_archive"}, 400)
            return
        except Exception as exc:
            handle.close()
            try:
                os.unlink(path)
            except OSError:
                pass
            self.send_json({"error": "could not start manual update: %s" % exc,
                            "code": "update_failed"}, 500)
            return
        self.send_json({"ok": True, "job": job,
                        "fileName": filename}, 202)

    def handle_file_upload(self):
        if not MISSION_STORE:
            self.send_json({"error": "mission store is not available"}, 503)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        limit = 25 * 1024 * 1024
        if length <= 0:
            self.send_json({"error": "empty file", "code": "empty_file"}, 400)
            return
        if length > limit:
            self.send_json({"error": "file is larger than 25MB", "code": "too_large"}, 413)
            return
        filename = os.path.basename(
            unquote(self.headers.get("X-Filename") or "upload.bin").replace("\\", "/")
        )[:200] or "upload.bin"
        mime = unquote(self.headers.get("X-Mime") or "") or (
            mimetypes.guess_type(filename)[0] or "application/octet-stream"
        )
        mission_id = unquote(self.headers.get("X-Mission-Id") or "")
        conversation_id = unquote(self.headers.get("X-Conversation-Id") or "")
        uploaded_by = unquote(self.headers.get("X-Uploaded-By") or "boss")
        if mission_id and not MISSION_STORE.find_mission(mission_id):
            self.send_json({"error": "mission not found"}, 404)
            return
        if conversation_id and not MISSION_STORE.find_conversation(conversation_id):
            self.send_json({"error": "conversation not found"}, 404)
            return
        MISSION_STORE.upload_dir.mkdir(parents=True, exist_ok=True)
        extension = Path(filename).suffix.lower()[:12]
        if not re.match(r"^\.[A-Za-z0-9]+$", extension or ""):
            extension = ".bin"
        path = MISSION_STORE.upload_dir / (secrets.token_hex(10) + extension)
        remaining = length
        try:
            with open(path, "wb") as handle:
                while remaining > 0:
                    chunk = self.rfile.read(min(64 * 1024, remaining))
                    if not chunk:
                        raise ValueError("upload ended early")
                    handle.write(chunk)
                    remaining -= len(chunk)
        except Exception as exc:
            try:
                path.unlink()
            except OSError:
                pass
            self.send_json({"error": "upload failed: %s" % exc, "code": "upload_failed"}, 400)
            return
        image_mimes = ("image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp")
        kind = "image" if mime in image_mimes or extension in (
            ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"
        ) else "document"
        extracted, extraction = ("", "none")
        if kind != "image":
            extracted, extraction = missions.extract_text(path, mime, filename)
        try:
            with MISSION_STORE.lock:
                artifact = MISSION_STORE.add_artifact({
                    "name": filename, "mime": mime, "size": length, "kind": kind,
                    "path": str(path), "missionId": mission_id,
                    "conversationId": conversation_id, "uploadedBy": uploaded_by,
                    "extractedText": extracted, "extraction": extraction,
                })
        except Exception as exc:
            try:
                path.unlink()
            except OSError:
                pass
            self.send_json({"error": str(exc)}, 500)
            return
        self.send_json({"ok": True, "artifact": artifact})

    def handle_vision(self, artifact_id, body):
        if not MISSION_STORE:
            self.send_json({"error": "mission store is not available"}, 503)
            return
        artifact = MISSION_STORE.find_artifact(artifact_id)
        if not artifact:
            self.send_json({"error": "artifact not found"}, 404)
            return
        if artifact.get("kind") != "image":
            self.send_json({"error": "artifact is not an image"}, 400)
            return
        path = Path(artifact.get("path") or "")
        if not path.exists():
            self.send_json({"error": "image file is missing"}, 410)
            return
        errors = []
        text = ""
        provider = ""
        preferred = str(body.get("providerId") or "")
        for provider_id in mission_provider_candidates(preferred):
            try:
                result = provider_vision(provider_id, path, artifact.get("mime"))
                text = result["text"]
                provider = provider_id
                break
            except Exception as exc:
                errors.append(provider_id + ": " + str(exc)[:160])
        extraction = "vision" if text else "none"
        if not text:
            text = _tesseract_vision(path)
            if text:
                extraction = "tesseract"
                provider = "tesseract"
        if not text:
            text = _macos_vision(path)
            if text:
                extraction = "macos-vision"
                provider = "macos-vision"
        if not text:
            self.send_json({
                "error": "no vision provider is available; configure a model API or install tesseract",
                "code": "vision_unavailable",
                "detail": "; ".join(errors)[:500],
            }, 409)
            return
        with MISSION_STORE.lock:
            artifact = MISSION_STORE.update_artifact(
                artifact_id, extractedText=text, extraction=extraction,
                visionSummary=text, visionProvider=provider,
            )
        self.send_json({"ok": True, "artifact": artifact, "provider": provider})

    def handle_mission_action(self, path, body):
        if not MISSION_STORE:
            self.send_json({"error": "mission store is not available",
                            "code": "no_missions"}, 503)
            return
        try:
            if path == "/missions/recommend":
                directory = mission_agent_directory()
                with MISSION_STORE.lock:
                    result = MISSION_STORE.recommend(directory, body)
                self.send_json({"ok": True, **result})
                return
            if path == "/missions":
                directory = mission_agent_directory()
                with MISSION_STORE.lock:
                    mission = MISSION_STORE.create_mission(body, directory)
                    if mission.get("autoDiscuss"):
                        start_mission_discussion(mission["id"], str(body.get("providerId") or ""))
                    mission = MISSION_STORE.get_mission(mission["id"])
                self.send_json({"ok": True, "mission": mission,
                                "agents": directory}, 201)
                return
            if path.startswith("/missions/") and path.endswith("/discuss"):
                mission_id = path.split("/")[2]
                start_mission_discussion(mission_id, str(body.get("providerId") or ""))
                mission = MISSION_STORE.get_mission(mission_id)
                self.send_json({"ok": True, "mission": mission}, 202)
                return
            if path.startswith("/missions/") and path.endswith("/run"):
                parts = path.split("/")
                if len(parts) == 6 and parts[3] == "tasks":
                    result = run_mission_task(
                        parts[2], parts[4], str(body.get("providerId") or ""))
                    self.send_json({"ok": True, **result})
                    return
            if path == "/conversations":
                with MISSION_STORE.lock:
                    conversation = MISSION_STORE.create_conversation(
                        body, mission_agent_directory())
                self.send_json({"ok": True, "conversation": conversation}, 201)
                return
            if path.startswith("/conversations/") and path.endswith("/messages"):
                conversation_id = path.split("/")[2]
                with MISSION_STORE.lock:
                    message = MISSION_STORE.post_message(conversation_id, body)
                self.send_json({"ok": True, "message": message}, 201)
                return
            if path == "/approvals":
                mission_id = str(body.get("missionId") or "")
                mission = MISSION_STORE.find_mission(mission_id)
                if not mission:
                    self.send_json({"error": "mission not found"}, 404)
                    return
                with MISSION_STORE.lock:
                    approval = MISSION_STORE.create_approval(mission, body)
                self.send_json({"ok": True, "approval": approval}, 201)
                return
            if path.startswith("/approvals/") and path.endswith("/resolve"):
                approval_id = path.split("/")[2]
                with MISSION_STORE.lock:
                    approval = MISSION_STORE.resolve_approval(
                        approval_id,
                        str(body.get("decision") or ""),
                        str(body.get("note") or ""),
                        str(body.get("optionId") or ""),
                    )
                self.send_json({"ok": True, "approval": approval})
                return
            if path.startswith("/files/") and path.endswith("/vision"):
                self.handle_vision(path.split("/")[2], body)
                return
        except missions.MissionError as exc:
            self.send_json({"error": str(exc), "code": exc.code}, exc.status)
            return
        except Exception as exc:
            self.send_json({"error": "mission operation failed: %s" % exc,
                            "code": "mission_failed"}, 500)
            return
        self.send_json({"error": "not found"}, 404)

    def handle_update_action(self, path, body):
        if not updater:
            self.send_json({"error": "updater module is not installed",
                            "code": "no_updater"}, 503)
            return
        kind = "apply" if path == "/update/apply" else "rollback"
        with UPDATE_JOB_LOCK:
            busy = UPDATE_JOB.get("status") in ("running", "restarting")
        if busy:
            self.send_json({"error": "an update is already running",
                            "code": "update_busy"}, 409)
            return
        try:
            context = consume_update_token(body.get("token"), kind)
        except ValueError as exc:
            self.send_json({"error": str(exc), "code": "bad_token"}, 403)
            return
        if kind == "apply":
            target = str(body.get("version") or context.get("target") or "").lstrip("v")
            if not target or target != context.get("target"):
                self.send_json({"error": "requested version is not the checked release",
                                "code": "bad_version"}, 409)
                return
        else:
            backup = updater.rollback_candidate(
                current_version=updater.read_version(ROOT)
            )
            if not backup:
                self.send_json({"error": "no previous-version backup is available",
                                "code": "no_backup"}, 404)
                return
            target = str(backup.get("version") or "")
        try:
            job = start_update_job(kind, target)
        except ValueError as exc:
            self.send_json({"error": str(exc), "code": "update_busy"}, 409)
            return
        self.send_json({"ok": True, "job": job}, 202)

    def stream_mission_messages(self, qs):
        if not MISSION_STORE:
            self.send_json({"error": "mission store is not available"}, 503)
            return
        try:
            since = int((qs.get("since") or [self.headers.get("Last-Event-ID") or "0"])[0])
        except ValueError:
            since = 0
        try:
            self.send_response(200)
            self.cors()
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            self.wfile.write(b"retry: 2000\n\nevent: ready\ndata: {}\n\n")
            self.wfile.flush()
            last_ping = time.time()
            while True:
                rows = MISSION_STORE.messages_since(since)
                for message in rows:
                    since = max(since, int(message.get("seq") or since))
                    payload = json.dumps(message, ensure_ascii=False)
                    frame = ("id: %s\nevent: message\ndata: %s\n\n"
                             % (since, payload)).encode("utf-8")
                    self.wfile.write(frame)
                    self.wfile.flush()
                if time.time() - last_ping >= 15:
                    self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
                    last_ping = time.time()
                time.sleep(0.8)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def stream_messages(self, qs):
        try:
            since = int((qs.get("since") or [self.headers.get("Last-Event-ID") or "0"])[0])
        except ValueError:
            since = 0
        try:
            self.send_response(200)
            self.cors()
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            self.wfile.write(b"retry: 2000\n\nevent: ready\ndata: {}\n\n")
            self.wfile.flush()
            last_ping = time.time()
            while True:
                with LOCK:
                    messages = [m for m in STATE.get("messages", [])
                                if int(m.get("id") or 0) > since]
                for message in messages:
                    since = int(message.get("id") or since)
                    payload = json.dumps(message, ensure_ascii=False)
                    frame = ("id: %s\nevent: message\ndata: %s\n\n"
                             % (since, payload)).encode("utf-8")
                    self.wfile.write(frame)
                    self.wfile.flush()
                if time.time() - last_ping >= 15:
                    self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
                    last_ping = time.time()
                time.sleep(0.8)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def do_OPTIONS(self):
        if not self.request_gate():
            return
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        if not self.request_gate():
            return
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query)
        if path == "/stream":
            self.stream_messages(qs)
            return
        if path == "/update/check":
            if not updater:
                self.send_json({"error": "updater module is not installed",
                                "code": "no_updater"}, 503)
                return
            force = str((qs.get("refresh") or [""])[0]).lower() in ("1", "true", "yes")
            try:
                check = updater.check_for_update(force=force)
            except updater.UpdateError as exc:
                self.send_json({"error": str(exc), "code": exc.code}, exc.status)
                return
            check.update(issue_update_tokens(check["latestVersion"]))
            self.send_json(check)
            return
        if path == "/update/status":
            self.send_json(update_public_status())
            return
        if path == "/update/manual/token":
            if not updater:
                self.send_json({"error": "updater module is not installed",
                                "code": "no_updater"}, 503)
                return
            self.send_json(issue_manual_token())
            return
        if path == "/missions/stream":
            self.stream_mission_messages(qs)
            return
        if path in ("/missions", "/missions/overview", "/missions/agents",
                    "/conversations", "/approvals", "/mission-tasks",
                    "/files") or path.startswith(("/missions/", "/conversations/", "/files/")):
            if not MISSION_STORE:
                self.send_json({"error": "mission store is not available",
                                "code": "no_missions"}, 503)
                return
            if path == "/missions/agents":
                self.send_json({"agents": mission_agent_directory()})
                return
            if path == "/missions":
                self.send_json({"missions": MISSION_STORE.list_missions()})
                return
            if path == "/missions/overview":
                payload = MISSION_STORE.snapshot()
                payload["agents"] = mission_agent_directory()
                ai_candidates = mission_provider_candidates("")
                payload["ai"] = {
                    "available": bool(ai_candidates),
                    "provider": ai_candidates[0] if ai_candidates else "",
                }
                self.send_json(payload)
                return
            if path == "/conversations":
                mission_id = (qs.get("missionId") or [""])[0]
                kind = (qs.get("kind") or [""])[0]
                self.send_json({"conversations":
                                MISSION_STORE.list_conversations(mission_id, kind)})
                return
            if path == "/approvals":
                status = (qs.get("status") or [""])[0]
                self.send_json({"approvals": MISSION_STORE.list_approvals(status)})
                return
            if path == "/mission-tasks":
                agent_id = (qs.get("agentId") or [""])[0]
                self.send_json({"tasks": MISSION_STORE.list_tasks_for_agent(agent_id)})
                return
            if path == "/files":
                mission_id = (qs.get("missionId") or [""])[0]
                conversation_id = (qs.get("conversationId") or [""])[0]
                self.send_json({"artifacts": MISSION_STORE.list_artifacts(
                    mission_id, conversation_id)})
                return
            if path.startswith("/missions/") and path.count("/") == 2:
                mission = MISSION_STORE.get_mission(path.split("/")[2])
                if not mission:
                    self.send_json({"error": "mission not found"}, 404)
                    return
                self.send_json({"mission": mission})
                return
            if path.startswith("/conversations/") and path.endswith("/messages"):
                parts = path.split("/")
                if len(parts) == 4:
                    try:
                        since = int((qs.get("since") or ["0"])[0])
                    except ValueError:
                        since = 0
                    try:
                        messages = MISSION_STORE.list_messages(parts[2], since)
                    except missions.MissionError as exc:
                        self.send_json({"error": str(exc), "code": exc.code}, exc.status)
                        return
                    self.send_json({"messages": messages,
                                    "lastSeq": max([m["seq"] for m in messages] or [since])})
                    return
            if path.startswith("/conversations/") and path.count("/") == 2:
                conversation = MISSION_STORE.get_conversation(path.split("/")[2])
                if not conversation:
                    self.send_json({"error": "conversation not found"}, 404)
                    return
                self.send_json({"conversation": conversation})
                return
            if path.startswith("/files/") and path.endswith("/raw"):
                parts = path.split("/")
                if len(parts) == 4:
                    artifact = MISSION_STORE.find_artifact(parts[2])
                    if not artifact or not Path(artifact.get("path") or "").exists():
                        self.send_json({"error": "artifact not found"}, 404)
                        return
                    raw = Path(artifact["path"]).read_bytes()
                    mime = artifact.get("mime") or "application/octet-stream"
                    self.send_bytes(raw, mime, artifact.get("name") or "file",
                                    inline=artifact.get("kind") == "image")
                    return
            if path.startswith("/files/") and path.count("/") == 2:
                artifact = MISSION_STORE.find_artifact(path.split("/")[2])
                if not artifact:
                    self.send_json({"error": "artifact not found"}, 404)
                    return
                self.send_json({"artifact": MISSION_STORE.public_artifact(artifact)})
                return
        with LOCK:
            if path == "/health":
                self.send_json({
                    "ok": True,
                    "service": "agent-office-bridge",
                    "version": app_version(),
                    "bootId": BOOT_ID,
                    "agents": len(STATE["agents"]),
                    "events": len(STATE["events"]),
                    "lastEventId": STATE["nextEvent"] - 1,
                    "pendingPairs": sum(1 for p in STATE.get("pairs", []) if pair_status(p) == "pending"),
                    "assignments": len(STATE.get("assignments", [])),
                    "activeAssignments": sum(1 for a in STATE.get("assignments", [])
                                            if a.get("status") in ASSIGNMENT_ACTIVE),
                    "company": bool(STATE.get("company")),
                    "rooms": len((STATE.get("company") or {}).get("rooms", [])),
                    "messages": len(STATE.get("messages", [])),
                    "missions": (len(MISSION_STORE.data.get("missions", []))
                                 if MISSION_STORE else 0),
                    "pendingApprovals": (sum(1 for a in MISSION_STORE.data.get("approvals", [])
                                             if a.get("status") == "pending")
                                         if MISSION_STORE else 0),
                    "demo": bool(STATE.get("demo")),
                    "time": now_iso(),
                })
                return
            if path == "/company":
                self.send_json({"company": public_company()})
                return
            if path == "/rooms":
                company = STATE.get("company")
                self.send_json({"rooms": [dict(r) for r in (company or {}).get("rooms", [])]})
                return
            if path == "/messages":
                room_filter = (qs.get("roomId") or [""])[0]
                try:
                    since = int((qs.get("since") or ["0"])[0])
                except ValueError:
                    since = 0
                messages = [m for m in STATE.get("messages", [])
                            if int(m.get("id") or 0) > since
                            and (not room_filter or m.get("roomId") == room_filter)]
                self.send_json({"messages": messages,
                                "lastMessageId": max([m["id"] for m in messages] or
                                                     [int(STATE.get("messageSeq") or 0)])})
                return
            if path == "/assignments":
                agent_filter = (qs.get("agentId") or [""])[0]
                status_filter = (qs.get("status") or [""])[0]
                rows = []
                for assignment in STATE.get("assignments", []):
                    if agent_filter and assignment.get("agentId") != agent_filter:
                        continue
                    if status_filter and assignment.get("status") != status_filter:
                        continue
                    rows.append(public_assignment(assignment))
                rows.sort(key=lambda a: a.get("updatedAt", ""), reverse=True)
                self.send_json({"assignments": rows})
                return
            if path == "/providers":
                self.send_json(providers_payload())
                return
            if path.startswith("/providers/") and path.count("/") == 2:
                provider_id = path.split("/")[2]
                if provider_id not in PROVIDER_CATALOG:
                    self.send_json({"error": "unknown provider"}, 404)
                    return
                try:
                    self.send_json({"provider": provider_public(provider_id)})
                except ProviderCallError as exc:
                    self.send_json({"error": str(exc)}, 400)
                return
            if path == "/chat-capture/windows":
                self.send_json({"windows": list_chat_windows()})
                return
            if path == "/agents":
                self.send_json({
                    "agents": [public_agent(a) for a in STATE["agents"]],
                    "meta": missions.agent_meta() if missions else {"roles": [], "avatars": []},
                })
                return
            if path == "/pairs":
                live = [p for p in STATE.get("pairs", []) if pair_status(p) == "pending"]
                recent = [p for p in STATE.get("pairs", []) if pair_status(p) != "pending"]
                pairs = [public_pair(p) for p in live + recent[-30:]]
                pairs.sort(key=lambda p: p.get("createdAt", ""), reverse=True)
                self.send_json({"pairs": pairs})
                return
            if path.startswith("/pair/") and path.endswith("/setup.md"):
                code = path.split("/")[2]
                pair = find_pair(code)
                if not pair:
                    self.send_text("# Pair not found\n", 404, "text/plain; charset=utf-8")
                    return
                self.send_text(pair_setup_markdown(self.base_url(), pair), 200)
                return
            if path.startswith("/pair/") and path.count("/") == 2:
                code = path.split("/")[2]
                pair = find_pair(code)
                if not pair:
                    self.send_json({"error": "pair not found"}, 404)
                    return
                self.send_json({"pair": public_pair(pair)})
                return
            if path == "/events":
                try:
                    since = int((qs.get("since") or ["0"])[0])
                except ValueError:
                    since = 0
                events = [e for e in STATE["events"] if int(e["id"]) > since]
                self.send_json({"events": events, "lastEventId": STATE["nextEvent"] - 1})
                return
            if path == "/":
                self.send_json({
                    "service": "agent-office-bridge",
                    "endpoints": ["/health", "/update/check", "/update/status", "/update/apply", "/update/rollback", "/update/manual/token", "/update/manual", "/missions", "/missions/overview", "/missions/agents", "/missions/<id>", "/missions/<id>/discuss", "/missions/<id>/tasks/<taskId>/run", "/mission-tasks", "/mission-tasks/<id>", "/conversations", "/conversations/<id>/messages", "/approvals", "/approvals/<id>/resolve", "/files", "/files/<id>", "/files/<id>/raw", "/files/<id>/vision", "/missions/stream", "/chat-capture/windows", "/chat-capture/window", "/company", "/rooms", "/messages", "/stream", "/agents", "/providers", "/assignments", "/assignments/<id>", "/events?since=N", "/pair/code", "/pairs", "/pair/<code>/claim", "/providers/<id>/connect", "/providers/<id>/test", "/providers/<id>/run", "/demo/start", "/demo/stop"],
                })
                return
        self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        if not self.request_gate():
            return
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path == "/update/manual":
            self.handle_manual_update()
            return
        if path == "/files":
            self.handle_file_upload()
            return
        try:
            body = self.read_json()
        except Exception as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        if path == "/chat-capture/window":
            try:
                window_id = int(body.get("windowId") or 0)
                if window_id <= 0:
                    raise ValueError("windowId is required")
                self.send_json({"ok": True, **capture_chat_window(window_id)})
            except ValueError as exc:
                self.send_json({"error": str(exc), "code": "bad_window"}, 400)
            except Exception as exc:
                self.send_json({"error": str(exc)[:300], "code": "capture_failed"}, 502)
            return
        if path.startswith(("/missions", "/conversations", "/approvals", "/files/")):
            self.handle_mission_action(path, body)
            return
        if path.startswith("/providers/"):
            self.handle_provider_post(path, body)
            return
        if path in ("/update/apply", "/update/rollback"):
            self.handle_update_action(path, body)
            return
        with LOCK:
            if path == "/company/bootstrap":
                try:
                    company = company_bootstrap(body)
                except ValueError as exc:
                    self.send_json({"error": str(exc)}, 409)
                    return
                self.send_json({"ok": True, "company": public_company()})
                return
            if path == "/company/dispatch":
                count = dispatch_ready_company_tasks()
                save_state()
                self.send_json({"ok": True, "dispatched": count, "company": public_company()})
                return
            if path == "/messages":
                try:
                    message = company_post_message(body)
                except ValueError as exc:
                    self.send_json({"error": str(exc)}, 400)
                    return
                self.send_json({"ok": True, "message": message})
                return
            if path == "/assignments":
                try:
                    assignment = add_assignment(body)
                except ValueError as exc:
                    self.send_json({"error": str(exc)}, 400)
                    return
                self.send_json({"ok": True, "assignment": public_assignment(assignment)})
                return
            if path == "/pair/code":
                code = new_pair_code()
                expires_at = time.time() + 30 * 60
                role_id = str(body.get("roleId") or "")[:40]
                role_name = ""
                if role_id:
                    company = STATE.get("company")
                    role = next((r for r in (company or {}).get("roles", [])
                                 if r.get("id") == role_id), None)
                    if not role:
                        self.send_json({"error": "unknown role"}, 400)
                        return
                    role_name = str(role.get("titleZh") if (company or {}).get("language") != "en"
                                    else role.get("titleEn"))[:80]
                pair = {
                    "code": code,
                    "createdAt": now_iso(),
                    "expiresAt": expires_at,
                    "status": "pending",
                    "agentId": None,
                    "roleId": role_id or None,
                    "nameHint": str(body.get("nameHint") or role_name or "")[:40],
                }
                STATE.setdefault("pairs", []).append(pair)
                # Keep every live code. Pending codes expire on their own, so the
                # table stays bounded without silently invalidating an invite.
                pending = [p for p in STATE["pairs"] if pair_status(p) == "pending"]
                others = [p for p in STATE["pairs"] if pair_status(p) != "pending"]
                STATE["pairs"] = others[-30:] + pending
                save_state()
                base = self.base_url()
                self.send_json({
                    "pair": public_pair(pair),
                    "setupUrl": pair_setup_url(base, code),
                    "message": pair_message(base, code, expires_at, role_name),
                })
                return
            if path.startswith("/pair/") and path.endswith("/claim"):
                code = path.split("/")[2]
                pair = find_pair(code)
                if not pair:
                    self.send_json({"error": "pair not found"}, 404)
                    return
                if pair_status(pair) != "pending":
                    self.send_json({"error": "pair already used or expired", "status": pair_status(pair)}, 409)
                    return
                name = str(body.get("name") or pair.get("nameHint") or "External Agent")[:40]
                body["name"] = name
                if pair.get("roleId"):
                    company = STATE.get("company")
                    role = next((r for r in (company or {}).get("roles", [])
                                 if r.get("id") == pair.get("roleId")), None)
                    if not company or not role:
                        self.send_json({"error": "company role no longer exists"}, 409)
                        return
                    agent_id = role.get("agentId") or company_role_agent_id(role["id"])
                    agent = find_agent(agent_id)
                    if not agent:
                        agent = {
                            "id": agent_id, "name": name, "runtime": "role-slot",
                            "endpoint": "", "skills": list(role.get("skills") or []),
                            "note": "", "color": role.get("color", "#b58cff"),
                            "createdAt": now_iso(), "lastSeen": None, "lastSeenTs": 0,
                            "companyId": company.get("id"), "roleId": role["id"],
                        }
                        STATE["agents"].append(agent)
                    agent["name"] = name
                    agent["runtime"] = str(body.get("runtime") or "role-slot")[:40]
                    agent["endpoint"] = str(body.get("endpoint") or "")[:300]
                    if isinstance(body.get("skills"), list) and body["skills"]:
                        agent["skills"] = body["skills"]
                    if body.get("note"):
                        agent["note"] = str(body["note"])[:300]
                    agent["lastSeen"] = now_iso()
                    agent["lastSeenTs"] = time.time()
                else:
                    # A pairing code always mints a fresh identity; it must not be
                    # able to take over an existing id supplied in the body.
                    try:
                        agent = create_agent_from_payload(body, "ext-" + uuid.uuid4().hex[:8])
                    except ValueError as exc:
                        self.send_json({"error": str(exc)}, 400)
                        return
                agent["lastSeen"] = now_iso()
                agent["lastSeenTs"] = time.time()
                pair["status"] = "claimed"
                pair["agentId"] = agent["id"]
                pair["claimedAt"] = now_iso()
                greeting = add_event({
                    "agentId": agent["id"],
                    "kind": "hello",
                    "action": "已接入 Agent Office，向你问好",
                    "note": "通过一次性连接码接入",
                })
                save_state()
                self.send_json({
                    "ok": True,
                    "agent": public_agent(agent),
                    "pair": public_pair(pair),
                    "bridge": self.base_url(),
                    "greeting": greeting,
                })
                return
            if path == "/agents":
                agent_id = str(body.get("id") or ("ext-" + uuid.uuid4().hex[:8]))
                try:
                    agent = create_agent_from_payload(body, agent_id)
                except ValueError as exc:
                    self.send_json({"error": str(exc)}, 400)
                    return
                save_state()
                self.send_json({"agent": public_agent(agent)})
                return
            if path.startswith("/agents/") and path.endswith("/heartbeat"):
                agent_id = path.split("/")[2]
                agent = find_agent(agent_id)
                if not agent:
                    self.send_json({"error": "unknown agent"}, 404)
                    return
                agent["lastSeen"] = now_iso()
                agent["lastSeenTs"] = time.time()
                if body.get("note"):
                    agent["lastNote"] = str(body["note"])[:200]
                save_state()
                self.send_json({"ok": True, "agent": public_agent(agent)})
                return
            if path == "/events":
                try:
                    event = add_event(body)
                except ValueError as exc:
                    self.send_json({"error": str(exc)}, 400)
                    return
                self.send_json({"ok": True, "event": event})
                return
            if path == "/demo/start":
                start_demo()
                self.send_json({"ok": True, "demo": True, "agent": public_agent(ensure_demo_agent())})
                return
            if path == "/demo/stop":
                stop_demo()
                self.send_json({"ok": True, "demo": False})
                return
        self.send_json({"error": "not found"}, 404)

    def handle_provider_post(self, path, body):
        parts = [part for part in path.split("/") if part]
        if len(parts) != 3 or parts[0] != "providers":
            self.send_json({"error": "not found"}, 404)
            return
        provider_id, action = parts[1], parts[2]
        if provider_id not in PROVIDER_CATALOG:
            self.send_json({"error": "unknown provider"}, 404)
            return
        if action == "connect":
            try:
                agent, created = connect_provider(provider_id)
            except ProviderNotConfigured as exc:
                self.send_json({"error": str(exc), "code": "provider_not_configured"}, 409)
                return
            except ProviderCallError as exc:
                self.send_json({"error": str(exc)}, 400)
                return
            self.send_json({"ok": True, "created": created, "agent": public_agent(agent)})
            return
        if action not in ("test", "run"):
            self.send_json({"error": "not found"}, 404)
            return
        try:
            settings = provider_settings(provider_id)
        except ProviderCallError as exc:
            self.send_json({"error": str(exc), "code": "provider_config_error"}, 400)
            return
        if not settings:
            self.send_json({"error": "unknown provider"}, 404)
            return
        prompt = str(body.get("prompt") or "").strip()
        if action == "test":
            prompt = prompt or "Reply with exactly: OK"
            max_tokens = 32
        else:
            prompt = prompt or "用一句话说明你能为这个团队做什么，并给出一个风险提示。"
            try:
                requested_tokens = int(body.get("maxTokens") or 512)
            except (TypeError, ValueError):
                requested_tokens = 512
            max_tokens = min(800, max(32, requested_tokens))
        started = time.time()
        try:
            result = provider_chat(provider_id, prompt, str(body.get("system") or ""), max_tokens)
        except ProviderNotConfigured as exc:
            self.send_json({"error": str(exc), "code": "provider_not_configured"}, 409)
            return
        except ProviderCallError as exc:
            self.send_json({"error": str(exc), "code": "provider_call_failed"}, 502)
            return
        duration_ms = int((time.time() - started) * 1000)
        if action == "test":
            self.send_json({
                "ok": True,
                "provider": provider_id,
                "model": result["model"],
                "text": result["text"][:500],
                "tokensIn": result["tokensIn"],
                "tokensOut": result["tokensOut"],
                "durationMs": duration_ms,
            })
            return
        with LOCK:
            try:
                agent, _ = ensure_provider_agent(provider_id)
            except (ProviderNotConfigured, ProviderCallError) as exc:
                self.send_json({"error": str(exc)}, 409)
                return
            agent["lastSeen"] = now_iso()
            agent["lastSeenTs"] = time.time()
            snippet = result["text"][:80] + ("…" if len(result["text"]) > 80 else "")
            event = add_event({
                "agentId": agent["id"],
                "kind": "skill",
                "action": settings["name"] + " · " + snippet,
                "skill": "model-call",
                "tool": provider_id,
                "tokensIn": result["tokensIn"],
                "tokensOut": result["tokensOut"],
                "durationMs": duration_ms,
                "model": result["model"],
                "note": result["text"][:500],
                "provider": provider_id,
            })
            save_state()
        self.send_json({
            "ok": True,
            "provider": provider_id,
            "model": result["model"],
            "text": result["text"][:2000],
            "tokensIn": result["tokensIn"],
            "tokensOut": result["tokensOut"],
            "durationMs": duration_ms,
            "event": event,
            "agent": public_agent(agent),
        })

    def do_PATCH(self):
        if not self.request_gate():
            return
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            body = self.read_json()
        except Exception as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        if path.startswith("/mission-tasks/") and path.count("/") == 2:
            if not MISSION_STORE:
                self.send_json({"error": "mission store is not available"}, 503)
                return
            task_id = path.split("/")[2]
            try:
                with MISSION_STORE.lock:
                    task = MISSION_STORE.update_task(
                        task_id, body, str(body.get("agentId") or ""))
                    mission, _ = MISSION_STORE.find_task(task_id)
                    mission_view = (MISSION_STORE.get_mission(mission["id"])
                                    if mission else None)
            except missions.MissionError as exc:
                self.send_json({"error": str(exc), "code": exc.code}, exc.status)
                return
            self.send_json({"ok": True, "task": task, "mission": mission_view})
            return
        with LOCK:
            if path.startswith("/assignments/") and path.count("/") == 2:
                assignment_id = path.split("/")[2]
                try:
                    assignment = update_assignment(assignment_id, body)
                except ValueError as exc:
                    self.send_json({"error": str(exc)}, 400)
                    return
                self.send_json({"ok": True, "assignment": public_assignment(assignment)})
                return
            if path.startswith("/agents/"):
                agent_id = path.split("/")[2]
                agent = find_agent(agent_id)
                if not agent:
                    self.send_json({"error": "unknown agent"}, 404)
                    return
                try:
                    updates = clean_agent_updates(body)
                except ValueError as exc:
                    self.send_json({"error": str(exc)}, 400)
                    return
                agent.update(updates)
                save_state()
                self.send_json({"agent": public_agent(agent)})
                return
        self.send_json({"error": "not found"}, 404)

    def do_DELETE(self):
        if not self.request_gate():
            return
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path.startswith("/missions/") and path.count("/") == 2:
            if not MISSION_STORE:
                self.send_json({"error": "mission store is not available"}, 503)
                return
            with MISSION_STORE.lock:
                ok = MISSION_STORE.delete_mission(path.split("/")[2])
            self.send_json({"ok": bool(ok)}, 200 if ok else 404)
            return
        if path.startswith("/conversations/") and path.count("/") == 2:
            if not MISSION_STORE:
                self.send_json({"error": "mission store is not available"}, 503)
                return
            try:
                with MISSION_STORE.lock:
                    ok = MISSION_STORE.delete_conversation(path.split("/")[2])
            except missions.MissionError as exc:
                self.send_json({"error": str(exc), "code": exc.code}, exc.status)
                return
            self.send_json({"ok": bool(ok)}, 200 if ok else 404)
            return
        with LOCK:
            if path == "/company":
                company = STATE.get("company")
                if company:
                    old_id = company.get("id")
                    STATE["agents"] = [a for a in STATE["agents"]
                                       if a.get("companyId") != old_id]
                    STATE["assignments"] = [a for a in STATE.get("assignments", [])
                                            if a.get("companyId") != old_id]
                STATE["company"] = None
                STATE["messages"] = []
                STATE["messageSeq"] = 0
                save_state()
                self.send_json({"ok": True})
                return
            if path.startswith("/assignments/") and path.count("/") == 2:
                assignment_id = path.split("/")[2]
                assignment = find_assignment(assignment_id)
                if not assignment:
                    self.send_json({"error": "unknown assignment"}, 404)
                    return
                try:
                    assignment = update_assignment(assignment_id, {"status": "cancelled"})
                except ValueError as exc:
                    self.send_json({"error": str(exc)}, 400)
                    return
                self.send_json({"ok": True, "assignment": public_assignment(assignment)})
                return
            if path.startswith("/pair/") and path.count("/") == 2:
                code = path.split("/")[2]
                pair = find_pair(code)
                if not pair:
                    self.send_json({"error": "pair not found"}, 404)
                    return
                if pair_status(pair) == "claimed":
                    self.send_json({"error": "pair already claimed"}, 409)
                    return
                STATE["pairs"] = [p for p in STATE.get("pairs", []) if p.get("code") != code]
                save_state()
                self.send_json({"ok": True})
                return
            if path.startswith("/agents/"):
                agent_id = path.split("/")[2]
                before = len(STATE["agents"])
                STATE["agents"] = [a for a in STATE["agents"] if a.get("id") != agent_id]
                if len(STATE["agents"]) == before:
                    self.send_json({"error": "unknown agent"}, 404)
                    return
                save_state()
                self.send_json({"ok": True})
                return
        self.send_json({"error": "not found"}, 404)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    if STATE.get("demo"):
        start_demo()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Agent Office Bridge on http://{args.host}:{args.port}")
    print("  GET  /health")
    print("  GET  /agents")
    print("  POST /agents")
    print("  POST /agents/<id>/heartbeat")
    print("  POST /events")
    print("  GET  /events?since=N")
    print("  POST /demo/start  |  POST /demo/stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
