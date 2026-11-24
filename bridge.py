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
import json
import os
import secrets
import ssl
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

ROOT = Path(__file__).resolve().parent
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
                return data
        except Exception:
            pass
    return {"agents": [], "events": [], "nextEvent": 1, "demo": False, "pairs": []}


STATE = load_state()


def save_state() -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(STATE, ensure_ascii=False, indent=2), "utf-8")
    tmp.replace(STATE_FILE)


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


def pair_message(base: str, code: str, expires_at: float) -> str:
    setup = pair_setup_url(base, code)
    exp = time.strftime("%H:%M:%S", time.localtime(expires_at))
    return (
        "你正在接入 Agent Office。\n\n"
        "1. 打开下面的接入说明并按其操作：\n" + setup + "\n\n"
        "2. 连接码：" + code + "（一次性，30 分钟内有效，过期时间 " + exp + "）\n"
        "3. 完成后请向 Agent Office 发送一条问候事件，并在界面里确认接入。\n\n"
        "如果连接码已过期或被使用，请在 Agent Office 里重新生成一段。"
    )


def pair_setup_markdown(base: str, pair: dict) -> str:
    code = pair["code"]
    exp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(pair["expiresAt"]))
    return (
        "# Agent Office · External Agent Pairing\n\n"
        "You are connecting an external agent to Agent Office.\n\n"
        "- Bridge: `" + base + "`\n"
        "- Connect code: `" + code + "`\n"
        "- Expires: " + exp + " (one-time)\n\n"
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
        "Send `POST /events` with `kind: \"hello\"` and a short greeting. It will appear in Agent Office.\n"
    )


def create_agent_from_payload(body: dict, agent_id=None) -> dict:
    agent_id = agent_id or str(body.get("id") or ("ext-" + uuid.uuid4().hex[:8]))
    existing = find_agent(agent_id)
    if existing:
        for key in ("name", "runtime", "endpoint", "skills", "note", "color"):
            if key in body:
                existing[key] = body[key]
        return existing
    agent = {
        "id": agent_id,
        "name": str(body.get("name") or "External Agent")[:40],
        "runtime": str(body.get("runtime") or "http")[:40],
        "endpoint": str(body.get("endpoint") or "")[:300],
        "skills": body.get("skills") if isinstance(body.get("skills"), list) else [],
        "note": str(body.get("note") or "")[:300],
        "color": str(body.get("color") or "#b58cff"),
        "createdAt": now_iso(),
        "lastSeen": None,
        "lastSeenTs": 0,
    }
    STATE["agents"].append(agent)
    return agent


def find_agent(agent_id: str):
    for a in STATE["agents"]:
        if a.get("id") == agent_id:
            return a
    return None


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
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
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
        with LOCK:
            if path == "/health":
                self.send_json({
                    "ok": True,
                    "service": "agent-office-bridge",
                    "agents": len(STATE["agents"]),
                    "events": len(STATE["events"]),
                    "lastEventId": STATE["nextEvent"] - 1,
                    "pendingPairs": sum(1 for p in STATE.get("pairs", []) if pair_status(p) == "pending"),
                    "demo": bool(STATE.get("demo")),
                    "time": now_iso(),
                })
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
            if path == "/agents":
                self.send_json({"agents": [public_agent(a) for a in STATE["agents"]]})
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
                    "endpoints": ["/health", "/agents", "/providers", "/events?since=N", "/pair/code", "/pairs", "/pair/<code>/claim", "/providers/<id>/connect", "/providers/<id>/test", "/providers/<id>/run", "/demo/start", "/demo/stop"],
                })
                return
        self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        if not self.request_gate():
            return
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            body = self.read_json()
        except Exception as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        if path.startswith("/providers/"):
            self.handle_provider_post(path, body)
            return
        with LOCK:
            if path == "/pair/code":
                code = new_pair_code()
                expires_at = time.time() + 30 * 60
                pair = {
                    "code": code,
                    "createdAt": now_iso(),
                    "expiresAt": expires_at,
                    "status": "pending",
                    "agentId": None,
                    "nameHint": str(body.get("nameHint") or "")[:40],
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
                    "message": pair_message(base, code, expires_at),
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
                # A pairing code always mints a fresh identity; it must not be
                # able to take over an existing id supplied in the body.
                agent = create_agent_from_payload(body, "ext-" + uuid.uuid4().hex[:8])
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
                existing = find_agent(agent_id)
                if existing:
                    for key in ("name", "runtime", "endpoint", "skills", "note", "color"):
                        if key in body:
                            existing[key] = body[key]
                    agent = existing
                else:
                    agent = {
                        "id": agent_id,
                        "name": str(body.get("name") or "External Agent")[:40],
                        "runtime": str(body.get("runtime") or "http")[:40],
                        "endpoint": str(body.get("endpoint") or "")[:300],
                        "skills": body.get("skills") if isinstance(body.get("skills"), list) else [],
                        "note": str(body.get("note") or "")[:300],
                        "color": str(body.get("color") or "#b58cff"),
                        "createdAt": now_iso(),
                        "lastSeen": None,
                        "lastSeenTs": 0,
                    }
                    STATE["agents"].append(agent)
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
        with LOCK:
            if path.startswith("/agents/"):
                agent_id = path.split("/")[2]
                agent = find_agent(agent_id)
                if not agent:
                    self.send_json({"error": "unknown agent"}, 404)
                    return
                for key in ("name", "runtime", "endpoint", "skills", "note", "color"):
                    if key in body:
                        agent[key] = body[key]
                save_state()
                self.send_json({"agent": public_agent(agent)})
                return
        self.send_json({"error": "not found"}, 404)

    def do_DELETE(self):
        if not self.request_gate():
            return
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        with LOCK:
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
