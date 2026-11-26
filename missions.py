#!/usr/bin/env python3
"""Mission workspace: tasks, conversations, artifacts and approvals.

This module is intentionally independent of the simulation engine. It stores
real task workspaces, chat messages, uploaded files and boss approval gates in
a small JSON document under ~/.agent-office.

Only four kinds of decisions may require the boss:
    spend, decision, login, authorization

Everything else is a team decision. Reports must include a solution and every
mission member must have primary or standby coverage.
"""
from __future__ import annotations

import datetime
import hashlib
import html
import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import zipfile
from pathlib import Path

BOSS_GATES = ("spend", "decision", "login", "authorization")
REPORT_FIELDS = ("summary", "done", "next", "risks", "solution")
TASK_STATUSES = ("queued", "assigned", "in_progress", "review", "blocked", "done")
TASK_PROGRESS_DEFAULT = {
    "queued": 5,
    "assigned": 15,
    "in_progress": 45,
    "review": 85,
    "blocked": 35,
    "done": 100,
}
MAX_TEXT = 12000

ROLE_EFFORT = {
    "chief": (20, 2500),
    "product": (45, 6000),
    "copy": (35, 4000),
    "design": (60, 7500),
    "engineer": (120, 16000),
    "qa": (45, 5000),
    "growth": (40, 5000),
    "video": (60, 6500),
    "operator": (60, 7000),
}

BRAND_LOGOS = {
    "Codex": "assets/logos/codex.svg",
    "OpenAI": "assets/logos/openai.svg",
    "Claude": "assets/logos/claude.svg",
    "WorkBuddy": "assets/logos/workbuddy.svg",
    "Gemini": "assets/logos/gemini.svg",
    "DeepSeek": "assets/logos/deepseek.svg",
    "Doubao": "assets/logos/doubao-mark.svg",
    "Kimi": "assets/logos/kimi.svg",
    "Qwen": "assets/logos/qwen.svg",
    "Ollama": "assets/logos/ollama.svg",
}

BRAND_PATTERNS = [
    (r"codex", "Codex", "CX", "#10A37F"),
    (r"claude|anthropic", "Claude", "C", "#e8a07e"),
    (r"workbuddy|work buddy|混元|hunyuan|hy3", "WorkBuddy", "WB", "#0EC8A9"),
    (r"gemini|google", "Gemini", "✦", "#b9a6ff"),
    (r"deepseek", "DeepSeek", "DS", "#7fa7ff"),
    (r"doubao|豆包|volcengine|ark", "Doubao", "豆", "#7fb4ff"),
    (r"kimi|moonshot", "Kimi", "K", "#9b9cff"),
    (r"qwen|通义|dashscope", "Qwen", "Q", "#b18cff"),
    (r"ollama", "Ollama", "OL", "#74d6a3"),
    (r"openai|gpt", "OpenAI", "AI", "#74d6a3"),
]

ROLE_META = [
    ("chief", "总协调", "Chief of Staff", "#d0a27a"),
    ("product", "产品策略", "Product", "#55d6c2"),
    ("copy", "内容文案", "Content", "#ff9ec0"),
    ("design", "设计", "Design", "#b58cff"),
    ("engineer", "工程师", "Engineer", "#7cb7ff"),
    ("qa", "质量", "QA", "#f2b544"),
    ("growth", "增长", "Growth", "#74d6a3"),
    ("video", "视频", "Video", "#e3a06c"),
    ("operator", "执行", "Operator", "#8fa5b7"),
]

AVATAR_PRESETS = [
    {"id": "auto", "glyph": "A", "labelZh": "自动识别品牌", "labelEn": "Auto brand", "color": "#b58cff"},
    {"id": "bot", "glyph": "🤖", "labelZh": "机器人", "labelEn": "Bot", "color": "#7cb7ff"},
    {"id": "fox", "glyph": "🦊", "labelZh": "狐狸", "labelEn": "Fox", "color": "#ffb45e"},
    {"id": "owl", "glyph": "🦉", "labelZh": "猫头鹰", "labelEn": "Owl", "color": "#c9a0dc"},
    {"id": "cat", "glyph": "🐱", "labelZh": "猫", "labelEn": "Cat", "color": "#ff9ec0"},
    {"id": "rocket", "glyph": "🚀", "labelZh": "火箭", "labelEn": "Rocket", "color": "#55d6c2"},
    {"id": "star", "glyph": "⭐", "labelZh": "星星", "labelEn": "Star", "color": "#f2b544"},
    {"id": "ghost", "glyph": "👻", "labelZh": "幽灵", "labelEn": "Ghost", "color": "#b9a6ff"},
    {"id": "alien", "glyph": "👾", "labelZh": "像素怪", "labelEn": "Alien", "color": "#74d6a3"},
    {"id": "spark", "glyph": "✨", "labelZh": "闪光", "labelEn": "Spark", "color": "#e8a07e"},
    {"id": "wrench", "glyph": "🛠️", "labelZh": "工匠", "labelEn": "Builder", "color": "#8fa5b7"},
    {"id": "crown", "glyph": "👑", "labelZh": "负责人", "labelEn": "Lead", "color": "#f2b544"},
    {"id": "custom", "glyph": "✎", "labelZh": "自定义缩写", "labelEn": "Custom initials", "color": "#b58cff"},
]

_role_labels = {item[0]: (item[1], item[2]) for item in ROLE_META}
_avatar_by_id = {item["id"]: item for item in AVATAR_PRESETS}


def role_catalog():
    return [
        {"id": role, "titleZh": zh, "titleEn": en, "color": color}
        for role, zh, en, color in ROLE_META
    ]


def avatar_catalog():
    return [dict(item) for item in AVATAR_PRESETS]


def agent_meta():
    return {"roles": role_catalog(), "avatars": avatar_catalog()}


def role_label(role):
    zh, en = _role_labels.get(str(role or ""), (str(role or "Agent"), str(role or "Agent")))
    return {"roleLabelZh": zh, "roleLabelEn": en}


def _safe_color(value, fallback="#b58cff"):
    text = str(value or "").strip()
    if re.fullmatch(r"#[0-9a-fA-F]{3,8}", text):
        return text
    return fallback


def _safe_logo_url(value):
    text = str(value or "").strip()
    if not text:
        return ""
    if re.match(r"^/?assets/logos/[A-Za-z0-9_.-]+$", text):
        return text
    if re.match(r"^https://[^\s<>\"']+$", text):
        return text[:500]
    return ""


def logo_info(row, source="role"):
    name = str(row.get("name") or row.get("titleEn") or row.get("titleZh") or "")
    runtime = str(row.get("runtime") or row.get("provider") or "")
    role = str(row.get("role") or "").replace("msn-", "").replace("opc-", "")
    haystack = (name + " " + runtime).lower()
    if source == "external":
        avatar = str(row.get("avatar") or "auto")
        preset = _avatar_by_id.get(avatar)
        if preset and avatar not in ("auto", "custom"):
            return {
                "brand": preset["labelEn"], "logoText": preset["glyph"],
                "logoColor": preset["color"], "avatar": avatar, "logoUrl": "",
            }
        if avatar == "custom":
            letters = "".join(part[0] for part in re.split(r"[\s·._-]+", name) if part)[:2]
            text = str(row.get("avatarText") or "").strip()[:2] or letters.upper() or "EX"
            return {
                "brand": "Custom avatar", "logoText": text.upper(),
                "logoColor": _safe_color(row.get("avatarColor") or row.get("color")),
                "avatar": "custom", "logoUrl": _safe_logo_url(row.get("logoUrl")),
            }
        for pattern, brand, mark, color in BRAND_PATTERNS:
            if re.search(pattern, haystack):
                return {
                    "brand": brand, "logoText": mark, "logoColor": color,
                    "avatar": "auto", "logoUrl": _safe_logo_url(row.get("logoUrl")) or BRAND_LOGOS.get(brand, ""),
                }
        letters = "".join(part[0] for part in re.split(r"[\s·._-]+", name) if part)[:2]
        return {"brand": "External agent", "logoText": letters.upper() or "EX",
                "logoColor": row.get("color") or "#7cb7ff", "avatar": "auto",
                "logoUrl": _safe_logo_url(row.get("logoUrl"))}
    labels = {
        "chief": "CH", "product": "PR", "copy": "CO", "design": "DE",
        "engineer": "EN", "qa": "QA", "growth": "GR", "video": "VI",
        "operator": "OP",
    }
    return {
        "brand": str(row.get("titleEn") or row.get("brand") or role or "Agent"),
        "logoText": labels.get(role, (role[:2] or "AI").upper()),
        "logoColor": row.get("color") or "#7cb7ff",
        "logoUrl": "",
    }


BUILTIN_AGENTS = [
    {"id": "msn-chief", "role": "chief", "titleZh": "总协调", "titleEn": "Chief of Staff",
     "skills": ["planning", "coordination", "review", "risk"], "color": "#d0a27a"},
    {"id": "msn-product", "role": "product", "titleZh": "产品策略", "titleEn": "Product",
     "skills": ["research", "prd", "acceptance", "positioning"], "color": "#55d6c2"},
    {"id": "msn-copy", "role": "copy", "titleZh": "内容文案", "titleEn": "Content",
     "skills": ["copy", "content", "email", "seo"], "color": "#ff9ec0"},
    {"id": "msn-design", "role": "design", "titleZh": "设计", "titleEn": "Design",
     "skills": ["ui", "ux", "brand", "prototype"], "color": "#b58cff"},
    {"id": "msn-engineer", "role": "engineer", "titleZh": "工程师", "titleEn": "Engineer",
     "skills": ["frontend", "backend", "api", "deploy"], "color": "#7cb7ff"},
    {"id": "msn-qa", "role": "qa", "titleZh": "质量", "titleEn": "QA",
     "skills": ["test", "accessibility", "regression", "release"], "color": "#f2b544"},
    {"id": "msn-growth", "role": "growth", "titleZh": "增长", "titleEn": "Growth",
     "skills": ["launch", "analytics", "channel", "metrics"], "color": "#74d6a3"},
    {"id": "msn-video", "role": "video", "titleZh": "视频", "titleEn": "Video",
     "skills": ["script", "video", "editing", "storyboard"], "color": "#e3a06c"},
]


class MissionError(ValueError):
    def __init__(self, message, code="mission_error", status=400):
        super().__init__(message)
        self.code = code
        self.status = status


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _mid(prefix):
    return prefix + "-" + secrets.token_hex(4)


def _text(value, limit=MAX_TEXT):
    return str(value or "").strip()[:limit]


def _list(value):
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _safe_json(value, fallback):
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def normalize_agent(row, source="role"):
    role = str(row.get("role") or row.get("id") or "").replace("msn-", "").replace("opc-", "")
    title_zh = str(row.get("titleZh") or row.get("title") or row.get("name") or role)
    title_en = str(row.get("titleEn") or row.get("title") or row.get("name") or role)
    logo = logo_info(row, source)
    return {
        "id": str(row.get("id") or _mid("agent")),
        "name": str(row.get("name") or title_en),
        "role": role,
        "titleZh": title_zh,
        "titleEn": title_en,
        "skills": _list(row.get("skills")),
        "color": str(row.get("color") or "#7cb7ff"),
        "source": source,
        "virtual": bool(row.get("virtual", source in ("role", "company"))),
        "runtime": str(row.get("runtime") or row.get("provider") or ""),
        "online": bool(row.get("online", False)),
        "avatar": str(row.get("avatar") or "auto"),
        "avatarText": str(row.get("avatarText") or ""),
        "avatarColor": str(row.get("avatarColor") or ""),
        **role_label(role),
        **logo,
    }


def builtin_directory():
    rows = []
    for item in BUILTIN_AGENTS:
        row = dict(item)
        row["name"] = item["titleEn"]
        rows.append(normalize_agent(row, "role"))
    return rows


def score_agent(agent, task, load):
    skills = set(agent.get("skills") or [])
    required = set(task.get("requiredSkills") or [])
    score = len(skills & required) * 10
    if agent.get("role") == task.get("role"):
        score += 8
    if agent.get("source") == "external":
        score += 1
    score -= load * 4
    return score


def estimate_task(task, mission, agent, load=0):
    role = str(task.get("role") or agent.get("role") or "operator")
    base_minutes, base_tokens = ROLE_EFFORT.get(role, ROLE_EFFORT["operator"])
    required = set(task.get("requiredSkills") or [])
    skills = set(agent.get("skills") or []) if agent else set()
    coverage = (len(required & skills) / len(required)) if required else 0.5
    complexity = 1.0
    complexity += min(0.8, len(str(mission.get("description") or "")) / 5000.0)
    complexity += min(0.4, len(mission.get("artifactIds") or []) * 0.08)
    if str(mission.get("priority") or "").upper() == "P0":
        complexity += 0.2
    skill_factor = 1.25 - (0.35 * coverage)
    load_factor = 1.0 + (0.12 * max(0, int(load or 0) - 1))
    minutes = max(8, round(base_minutes * complexity * skill_factor * load_factor))
    tokens = max(800, round(base_tokens * complexity * skill_factor * load_factor))
    confidence = "high" if coverage >= 0.66 and load <= 1 else (
        "medium" if coverage >= 0.33 or load <= 2 else "low")
    return {
        "minutes": minutes,
        "tokens": tokens,
        "confidence": confidence,
        "match": round(coverage * 100),
        "basis": "role base × task complexity × skill match × current load",
    }


def _task_actual_default():
    return {"minutes": 0, "tokens": 0, "durationMs": 0, "startedAt": "", "finishedAt": ""}


def _minutes_between(start, end=None):
    if not start:
        return 0
    try:
        a = datetime.datetime.strptime(start, "%Y-%m-%dT%H:%M:%SZ")
        b = (datetime.datetime.utcnow() if end is None
             else datetime.datetime.strptime(end, "%Y-%m-%dT%H:%M:%SZ"))
        return max(0, int(round((b - a).total_seconds() / 60.0)))
    except (TypeError, ValueError):
        return 0


def _mark_task_actual(task, status):
    actual = task.setdefault("actual", _task_actual_default())
    now = now_iso()
    if status in ("in_progress", "review", "done") and not actual.get("startedAt"):
        actual["startedAt"] = now
    if status == "done":
        actual["finishedAt"] = now
        actual["minutes"] = _minutes_between(actual.get("startedAt"), now)
    elif status == "review":
        actual["minutes"] = _minutes_between(actual.get("startedAt"), now)


def _record_task_usage(task, usage):
    if not isinstance(usage, dict):
        return
    try:
        tokens_in = max(0, int(usage.get("tokensIn") or usage.get("inputTokens") or 0))
        tokens_out = max(0, int(usage.get("tokensOut") or usage.get("outputTokens") or 0))
    except (TypeError, ValueError):
        tokens_in = tokens_out = 0
    item = {
        "provider": _text(usage.get("provider"), 80),
        "model": _text(usage.get("model"), 120),
        "tokensIn": tokens_in,
        "tokensOut": tokens_out,
        "durationMs": max(0, int(usage.get("durationMs") or 0)),
        "source": _text(usage.get("source") or "agent", 40),
        "at": now_iso(),
    }
    task.setdefault("usages", []).append(item)
    actual = task.setdefault("actual", _task_actual_default())
    actual["tokens"] = sum(int(u.get("tokensIn") or 0) + int(u.get("tokensOut") or 0)
                           for u in task["usages"])
    actual["durationMs"] = sum(int(u.get("durationMs") or 0) for u in task["usages"])


def choose_agents(directory, requested, description):
    by_id = {a["id"]: a for a in directory}
    if requested:
        picked = [by_id[item] for item in requested if item in by_id]
        if not picked:
            raise MissionError("selected agents are not available", "unknown_agent", 400)
        return picked[:12]
    text = (description or "").lower()
    wanted = ["chief", "product", "engineer", "qa", "design", "growth"]
    if re.search(r"文案|内容|邮件|marketing|content|copy|seo", text):
        wanted.insert(4, "copy")
    if re.search(r"视频|脚本|demo|video|storyboard", text):
        wanted.append("video")
    picked = []
    seen = set()

    def add(agent):
        if agent and agent["id"] not in seen and len(picked) < 10:
            seen.add(agent["id"])
            picked.append(agent)

    for role in wanted:
        add(next((a for a in directory if a.get("role") == role and a.get("source") != "external"), None))
    for agent in directory:
        if agent.get("source") == "external":
            add(agent)
    for agent in directory:
        add(agent)
    return picked


class MissionStore:
    def __init__(self, path, upload_dir):
        self.path = Path(path)
        self.upload_dir = Path(upload_dir)
        self.lock = threading.RLock()
        self.data = self._load()

    def _empty(self):
        return {
            "version": 1,
            "missions": [],
            "conversations": [],
            "messages": [],
            "approvals": [],
            "artifacts": [],
            "next": {"message": 1},
        }

    def _load(self):
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text("utf-8"))
                if isinstance(data, dict):
                    data.setdefault("missions", [])
                    data.setdefault("conversations", [])
                    data.setdefault("messages", [])
                    data.setdefault("approvals", [])
                    data.setdefault("artifacts", [])
                    data.setdefault("next", {"message": 1})
                    return data
            except Exception:
                pass
        return self._empty()

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), "utf-8")
        tmp.replace(self.path)

    def _next_message(self):
        value = int(self.data["next"].get("message") or 1)
        self.data["next"]["message"] = value + 1
        return value

    # ---------------------------------------------------------------- lookups

    def find_mission(self, mission_id):
        return next((m for m in self.data["missions"] if m.get("id") == mission_id), None)

    def find_conversation(self, conversation_id):
        return next((c for c in self.data["conversations"] if c.get("id") == conversation_id), None)

    def find_task(self, task_id):
        for mission in self.data["missions"]:
            for task in mission.get("tasks", []):
                if task.get("id") == task_id:
                    return mission, task
        return None, None

    def find_artifact(self, artifact_id):
        return next((a for a in self.data["artifacts"] if a.get("id") == artifact_id), None)

    def find_approval(self, approval_id):
        return next((a for a in self.data["approvals"] if a.get("id") == approval_id), None)

    def mission_conversation(self, mission):
        return self.find_conversation(mission.get("conversationId"))

    # ------------------------------------------------------------ public data

    def public_artifact(self, artifact):
        if not artifact:
            return None
        out = {k: artifact.get(k) for k in (
            "id", "name", "mime", "size", "kind", "createdAt", "missionId",
            "conversationId", "uploadedBy", "extractedText", "extraction",
            "visionSummary", "visionProvider",
        )}
        out["url"] = "/files/" + str(artifact.get("id") or "") + "/raw"
        return out

    def public_message(self, message):
        if not message:
            return None
        out = dict(message)
        out["attachments"] = [
            self.public_artifact(self.find_artifact(aid))
            for aid in message.get("attachmentIds") or []
        ]
        out["attachments"] = [a for a in out["attachments"] if a]
        out.pop("attachmentIds", None)
        return out

    def _workload(self, mission):
        load = {}
        for task in mission.get("tasks", []):
            if task.get("status") != "done":
                load[task.get("assigneeId")] = load.get(task.get("assigneeId"), 0) + 1
        return load

    def public_task(self, task, mission=None):
        out = dict(task)
        out["report"] = task.get("report")
        out["overdue"] = False
        if "progress" not in out:
            out["progress"] = TASK_PROGRESS_DEFAULT.get(task.get("status"), 0)
        return out

    def mission_evaluation(self, mission):
        tasks = mission.get("tasks", [])
        estimated_minutes = sum(int((t.get("estimate") or {}).get("minutes") or 0) for t in tasks)
        estimated_tokens = sum(int((t.get("estimate") or {}).get("tokens") or 0) for t in tasks)
        actual_minutes = sum(int((t.get("actual") or {}).get("minutes") or 0) for t in tasks)
        actual_duration_ms = sum(int((t.get("actual") or {}).get("durationMs") or 0) for t in tasks)
        actual_tokens = sum(int((t.get("actual") or {}).get("tokens") or 0) for t in tasks)
        remaining_minutes = sum(int((t.get("estimate") or {}).get("minutes") or 0)
                                for t in tasks if t.get("status") != "done")
        confidences = [(t.get("estimate") or {}).get("confidence") for t in tasks]
        confidence = ("low" if "low" in confidences else
                      "medium" if "medium" in confidences else "high")
        discussion = mission.get("discussion") or {}
        discussion_usage = discussion.get("usage") if isinstance(discussion.get("usage"), dict) else {}
        discussion_tokens = (int(discussion_usage.get("tokensIn") or 0) +
                             int(discussion_usage.get("tokensOut") or 0))
        discussion_minutes = int(round((int(discussion_usage.get("durationMs") or 0)) / 60000.0))
        deadline = str(mission.get("deadline") or "")
        deadline_risk = "none"
        deadline_days = None
        if deadline:
            try:
                due = datetime.date.fromisoformat(deadline)
                deadline_days = (due - datetime.date.today()).days
                if any(t.get("status") != "done" for t in tasks):
                    if deadline_days < 0:
                        deadline_risk = "overdue"
                    elif remaining_minutes > max(1, deadline_days) * 480:
                        deadline_risk = "at_risk"
                    else:
                        deadline_risk = "ok"
            except ValueError:
                deadline_days = None
        elapsed_minutes = _minutes_between(mission.get("createdAt"))
        agents = []
        for member in mission.get("members", []):
            mine = [t for t in tasks if t.get("assigneeId") == member.get("id")]
            agents.append({
                "id": member.get("id"),
                "name": member.get("titleZh") or member.get("name"),
                "logoText": member.get("logoText"),
                "logoColor": member.get("logoColor"),
                "logoUrl": member.get("logoUrl") or "",
                "brand": member.get("brand"),
                "tasks": len(mine),
                "open": sum(1 for t in mine if t.get("status") != "done"),
                "estimatedMinutes": sum(int((t.get("estimate") or {}).get("minutes") or 0) for t in mine),
                "actualMinutes": sum(int((t.get("actual") or {}).get("minutes") or 0) for t in mine),
                "actualDurationMs": sum(int((t.get("actual") or {}).get("durationMs") or 0) for t in mine),
                "estimatedTokens": sum(int((t.get("estimate") or {}).get("tokens") or 0) for t in mine),
                "actualTokens": sum(int((t.get("actual") or {}).get("tokens") or 0) for t in mine),
            })
        token_budget = int(mission.get("tokenBudget") or 0)
        total_tokens = actual_tokens + discussion_tokens
        return {
            "estimatedMinutes": estimated_minutes,
            "estimatedTokens": estimated_tokens,
            "actualMinutes": actual_minutes,
            "actualDurationMs": actual_duration_ms,
            "actualTokens": actual_tokens,
            "tokenBudget": token_budget,
            "totalTokens": total_tokens,
            "tokenBudgetRemaining": (max(0, token_budget - total_tokens)
                                     if token_budget else None),
            "remainingMinutes": remaining_minutes,
            "elapsedMinutes": elapsed_minutes,
            "discussionTokens": discussion_tokens,
            "discussionMinutes": discussion_minutes,
            "confidence": confidence,
            "deadline": deadline,
            "deadlineDays": deadline_days,
            "deadlineRisk": deadline_risk,
            "agents": agents,
        }

    def public_mission(self, mission, summary=False):
        if not mission:
            return None
        tasks = mission.get("tasks", [])
        done = sum(1 for t in tasks if t.get("status") == "done")
        review = sum(1 for t in tasks if t.get("status") == "review")
        blocked = sum(1 for t in tasks if t.get("status") == "blocked")
        load = self._workload(mission)
        all_done = bool(tasks) and done >= len(tasks)
        idle = [] if all_done else [
            a for a in mission.get("members", []) if load.get(a.get("id"), 0) == 0
        ]
        approvals = [a for a in self.data["approvals"] if a.get("missionId") == mission.get("id")]
        pending = [a for a in approvals if a.get("status") == "pending"]
        out = {
            "id": mission.get("id"),
            "title": mission.get("title"),
            "description": mission.get("description"),
            "acceptance": mission.get("acceptance"),
            "priority": mission.get("priority"),
            "status": mission.get("status"),
            "budget": mission.get("budget"),
            "tokenBudget": mission.get("tokenBudget", 0),
            "memberScope": mission.get("memberScope", "mixed"),
            "previousMissionId": mission.get("previousMissionId", ""),
            "archived": bool(mission.get("archivedAt")),
            "currency": mission.get("currency"),
            "deadline": mission.get("deadline"),
            "createdAt": mission.get("createdAt"),
            "updatedAt": mission.get("updatedAt"),
            "conversationId": mission.get("conversationId"),
            "members": mission.get("members", []),
            "rules": mission.get("rules", []),
            "charter": mission.get("charter", {}),
            "coverage": {
                "total": len(mission.get("members", [])),
                "assigned": len(mission.get("members", [])) - len(idle),
                "idle": [a.get("id") for a in idle],
                "noIdle": len(idle) == 0,
                "completed": all_done,
            },
            "stats": {
                "tasks": len(tasks),
                "done": done,
                "review": review,
                "blocked": blocked,
                "progress": round((done / len(tasks)) * 100) if tasks else 0,
                "approvals": len(pending),
            },
            "decisions": mission.get("decisions", []),
            "evaluation": self.mission_evaluation(mission),
            "autoDiscuss": bool(mission.get("autoDiscuss")),
            "autoRun": mission.get("autoRun", {}),
            "discussion": mission.get("discussion", {}),
            "approvals": [self.public_approval(a) for a in approvals][-20:],
            "artifacts": [self.public_artifact(self.find_artifact(i))
                          for i in mission.get("artifactIds", [])],
        }
        out["artifacts"] = [a for a in out["artifacts"] if a]
        if not summary:
            out["tasks"] = [self.public_task(t, mission) for t in tasks]
        return out

    def public_conversation(self, conversation):
        if not conversation:
            return None
        messages = [m for m in self.data["messages"]
                    if m.get("conversationId") == conversation.get("id")]
        last = messages[-1] if messages else None
        out = {k: conversation.get(k) for k in (
            "id", "kind", "title", "missionId", "members", "createdAt", "updatedAt",
        )}
        out["lastMessage"] = ({
            "id": last.get("id"), "text": (last.get("text") or "")[:120],
            "senderName": last.get("senderName"), "createdAt": last.get("createdAt"),
        } if last else None)
        out["messageCount"] = len(messages)
        return out

    def public_approval(self, approval):
        if not approval:
            return None
        out = dict(approval)
        out["task"] = None
        if approval.get("taskId"):
            _, task = self.find_task(approval["taskId"])
            out["task"] = ({"id": task.get("id"), "title": task.get("title")} if task else None)
        out["attachments"] = [
            self.public_artifact(self.find_artifact(aid))
            for aid in approval.get("attachmentIds") or []
        ]
        out["attachments"] = [a for a in out["attachments"] if a]
        return out

    # --------------------------------------------------------------- creation

    def create_mission(self, body, directory):
        title = _text(body.get("title"), 120)
        description = _text(body.get("description"), 6000)
        if len(title) < 2:
            raise MissionError("mission title is too short", "bad_title", 400)
        if len(description) < 8:
            raise MissionError("mission description is too short", "bad_description", 400)
        acceptance = _text(body.get("acceptance"), 4000)
        if not acceptance:
            acceptance = "所有子任务通过验收；关键风险有解决方案；交付物和证据可追溯。"
        real_only = bool(body.get("realOnly"))
        if real_only:
            directory = [a for a in directory if a.get("source") == "external"]
            if not directory:
                raise MissionError(
                    "real-agent mode has no external agent; connect one first",
                    "no_external_agents", 409)
        members = choose_agents(directory, _list(body.get("memberIds")), description)
        if not members:
            raise MissionError("no agents are available", "no_agents", 409)
        budget = 0.0
        try:
            budget = max(0.0, float(body.get("budget") or 0))
        except (TypeError, ValueError):
            budget = 0.0
        token_budget = 0
        try:
            token_budget = max(0, min(2000000, int(float(body.get("tokenBudget") or 0))))
        except (TypeError, ValueError, OverflowError):
            token_budget = 0
        schedule_at = _text(body.get("scheduleAt"), 40)
        if schedule_at:
            try:
                datetime.datetime.fromisoformat(schedule_at.replace("Z", ""))
            except ValueError:
                raise MissionError("scheduleAt must be an ISO date-time", "bad_schedule", 400)
        mission_id = _mid("msn")
        conversation = {
            "id": _mid("conv"),
            "kind": "group",
            "title": "# " + title,
            "missionId": mission_id,
            "members": members,
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
        }
        self.data["conversations"].append(conversation)
        rules = [
            "只有花费、拍板、扫码登录、授权四类事项需要老板处理。",
            "技术方案、架构、工具、排期、测试、文案和设计取舍由 Agent 在任务群内讨论达成一致，不得把技术问题原样上交。",
            "每个 Agent 必须有主任务或待命巡检任务，不允许空岗。",
            "遇到阻塞必须给出解决方案或替代路径；不能等待问题自己消失。",
            "汇报必须包含：已完成、下一步、风险、解决方案、证据；缺少解决方案会被拒绝。",
            "花费、拍板、登录、授权必须走审批卡片；审批通过前不得擅自执行。",
            "所有决策、审批、文件和汇报进入任务审计记录。",
        ]
        charter = {
            "version": 1,
            "frozenAt": now_iso(),
            "objective": description,
            "acceptance": acceptance,
            "deadline": _text(body.get("deadline"), 40),
            "nonGoals": _text(body.get("nonGoals"), 3000),
            "constraints": _text(body.get("constraints"), 3000),
            "bossGates": list(BOSS_GATES),
            "decisionRule": "非老板门禁事项由成员提案、讨论并达成一致；分歧由总协调记录取舍。",
            "reportFormat": "已完成 / 下一步 / 风险 / 解决方案 / 证据",
            "communication": "任务群用于决策和汇报；私聊用于一对一澄清，不替代任务记录。",
        }
        auto_run = bool(body.get("autoRun"))
        mission = {
            "id": mission_id,
            "title": title,
            "description": description,
            "acceptance": acceptance,
            "priority": str(body.get("priority") or "P1")[:8],
            "status": "active",
            "budget": budget,
            "tokenBudget": token_budget,
            "memberScope": "external" if real_only else "mixed",
            "previousMissionId": _text(body.get("previousMissionId"), 80),
            "currency": str(body.get("currency") or "CNY")[:8],
            "deadline": _text(body.get("deadline"), 40),
            "language": "en" if str(body.get("language") or "").lower().startswith("en") else "zh",
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
            "conversationId": conversation["id"],
            "members": members,
            "rules": rules,
            "charter": charter,
            "tasks": [],
            "decisions": [],
            "artifactIds": _list(body.get("artifactIds")),
            "autoDiscuss": bool(body.get("autoDiscuss", True)),
            "discussion": {"status": "pending" if body.get("autoDiscuss", True) else "off",
                           "startedAt": "", "finishedAt": "", "provider": "", "error": ""},
            "autoRun": {
                "enabled": auto_run,
                "status": ("scheduled" if schedule_at else "pending") if auto_run else "off",
                "scheduledAt": schedule_at if auto_run else "",
                "provider": "",
                "currentTaskId": "",
                "currentTaskTitle": "",
                "currentTaskStartedAt": "",
                "completed": 0,
                "total": 0,
                "tokensUsed": 0,
                "tokenBudget": token_budget,
                "startedAt": "",
                "finishedAt": "",
                "error": "",
            },
        }
        preferred = body.get("preferredExecutors")
        mission["preferredExecutors"] = preferred if isinstance(preferred, dict) else {}
        mission["tasks"] = self._plan_tasks(mission)
        self._assign_tasks(mission)
        self._ensure_no_idle(mission)
        self._promote_ready(mission)
        self.data["missions"].append(mission)
        self._system_message(
            mission, "mission-created",
            "任务已创建。\n\n**目标**\n" + description +
            "\n\n**验收**\n" + acceptance +
            "\n\n**老板门禁**\n" + " / ".join(BOSS_GATES) +
            "\n\n**规则**\n" + "\n".join("- " + rule for rule in rules) +
            "\n\n**分配**\n" + "\n".join(
                "- " + agent.get("titleZh", agent.get("name")) + "：" +
                "、".join(t.get("title") for t in mission["tasks"] if t.get("assigneeId") == agent.get("id"))
                for agent in members
            ),
        )
        if budget > 0:
            self.create_approval(mission, {
                "type": "spend",
                "title": "任务预算审批 · " + mission["title"],
                "description": "任务启动预算 %s %s" % (budget, mission["currency"]),
                "amount": budget,
                "currency": mission["currency"],
                "requestedBy": members[0].get("id"),
                "purpose": description[:500],
            })
        self._save()
        return self.public_mission(mission)

    def recommend(self, directory, body):
        description = _text(body.get("description"), 6000)
        if len(description) < 8:
            description = "通用交付任务：需求、设计、实现、验收和发布。"
        acceptance = _text(body.get("acceptance"), 4000)
        temp = {
            "description": description,
            "acceptance": acceptance,
            "priority": str(body.get("priority") or "P1"),
            "artifactIds": _list(body.get("artifactIds")),
            "members": directory,
            "id": "recommendation",
        }
        tasks = self._plan_tasks(temp)
        real_only = bool(body.get("realOnly"))
        external = [a for a in directory if a.get("source") == "external"]
        candidates = external if real_only else (external or list(directory))
        scope = "external" if (external or real_only) else "system"
        load = {}
        for mission in self.data["missions"]:
            if mission.get("status") == "done":
                continue
            for task in mission.get("tasks", []):
                if task.get("status") != "done":
                    load[task.get("assigneeId")] = load.get(task.get("assigneeId"), 0) + 1
        output = []
        suggested = []
        preferred = {}
        for task in tasks:
            ranked = []
            for agent in candidates:
                score = score_agent(agent, task, load.get(agent.get("id"), 0))
                if agent.get("source") == "external" and agent.get("online"):
                    score += 18 if task.get("role") in ("engineer", "qa") else 5
                estimate = estimate_task(task, temp, agent, load.get(agent.get("id"), 0))
                overlap = sorted(set(agent.get("skills") or []) & set(task.get("requiredSkills") or []))
                match = min(100, max(5, round(
                    45 + (len(overlap) / max(1, len(task.get("requiredSkills") or []))) * 40
                    + (12 if agent.get("role") == task.get("role") else 0)
                    - min(10, load.get(agent.get("id"), 0) * 2)
                )))
                reason = "技能：" + ("、".join(overlap) if overlap else "角色匹配")
                if agent.get("source") == "external" and agent.get("online"):
                    reason += "；在线外部执行器"
                reason += "；当前负载 " + str(load.get(agent.get("id"), 0))
                ranked.append({
                    **agent, "score": score, "match": match,
                    "reason": reason, "estimate": estimate,
                })
            ranked.sort(key=lambda a: (a["score"], a["match"]), reverse=True)
            top = ranked[:3]
            output.append({
                "key": task["key"],
                "title": task["title"],
                "role": task["role"],
                "estimate": estimate_task(task, temp, top[0] if top else None,
                                          load.get(top[0]["id"], 0) if top else 0),
                "recommended": top,
            })
            if top:
                preferred[task["key"]] = top[0]["id"]
                if top[0]["id"] not in suggested:
                    suggested.append(top[0]["id"])
        if scope == "external":
            # A connected external agent is a real worker, not a virtual role:
            # include every external agent (up to the team cap) so none is
            # silently left out. The per-task preferredExecutors still picks
            # the best match.
            for agent in candidates:
                if agent["id"] not in suggested and len(suggested) < 8:
                    suggested.append(agent["id"])
        else:
            chief = next((a for a in candidates if a.get("role") == "chief"), None)
            if chief and chief["id"] not in suggested and len(suggested) < 8:
                suggested.append(chief["id"])
        suggested = suggested[:8]
        preferred = {key: value for key, value in preferred.items() if value in suggested}
        english = str(body.get("language") or "").lower().startswith("en")
        if real_only and not candidates:
            note = ("Real-agent mode is on, but no external agent is connected. "
                    "Connect one before creating a mission." if english else
                    "真实模式已开启，但还没有接入外部 Agent。请先接入，再创建任务。")
        elif scope == "external":
            if english:
                note = ("Real-agent mode: only connected external agents are used, ranked by their editable "
                        "role, skills, online state and current load." if real_only else
                        "Recommendations prioritise connected external agents, ranked by their editable role, "
                        "skills, online state and current load. You can also select a system role manually.")
            else:
                note = ("真实模式：只使用已接入的真实外部 Agent，已结合职务、技能、在线状态和当前负载。"
                        if real_only else
                        "优先从真实外部 Agent 中推荐：已结合各自可编辑的职务、技能、在线状态和当前负载。"
                        "可继续在外部 Agent 详情里调整职务，或手动勾选系统角色。")
        else:
            note = ("No connected external agent is available, so system roles are used until one connects."
                    if english else
                    "当前没有已接入的真实外部 Agent，暂用系统角色推荐；接入外部 Agent 后会自动切换。")
        return {
            "tasks": output,
            "suggestedMemberIds": suggested,
            "preferredExecutors": preferred,
            "scope": scope,
            "candidateCount": len(candidates),
            "requiresExternal": real_only,
            "notes": note,
        }

    def _plan_tasks(self, mission):
        members = mission["members"]
        text = (mission.get("description") or "").lower()
        tasks = []

        def add(key, title, role, brief, acceptance, skills, deps, deliverable):
            tasks.append({
                "id": _mid("task"),
                "missionId": mission["id"],
                "key": key,
                "title": title,
                "brief": brief,
                "role": role,
                "requiredSkills": skills,
                "acceptance": acceptance,
                "deliverable": deliverable,
                "deps": deps,
                "assigneeId": "",
                "assigneeName": "",
                "status": "queued",
                "priority": mission["priority"],
                "report": None,
                "estimate": None,
                "actual": _task_actual_default(),
                "usages": [],
                "createdAt": now_iso(),
                "updatedAt": now_iso(),
            })

        acceptance = mission["acceptance"]
        add("requirements", "需求边界与验收", "product",
            "澄清目标、用户、范围、非目标和验收标准；把模糊需求变成可执行任务。",
            acceptance, ["research", "prd", "acceptance"], [], "需求摘要、范围、验收清单")
        add("design", "方案与体验设计", "design",
            "基于需求产出信息架构、关键流程和界面方案；标注取舍。",
            "关键流程有可评审方案；边界状态有说明。", ["ui", "ux", "prototype"],
            ["requirements"], "设计说明、关键界面/流程")
        add("build", "实现与技术方案", "engineer",
            "给出技术方案并完成实现；遇阻先提替代方案，不等待。",
            "实现覆盖验收标准；关键路径可验证。", ["frontend", "backend", "api"],
            ["requirements"], "代码/实现说明、验证证据")
        add("qa", "验收与回归", "qa",
            "按验收标准做功能、边界、可访问性和回归检查；风险要有解决方案。",
            "关键路径通过；风险有处理建议。", ["test", "accessibility", "regression"],
            ["design", "build"], "验收矩阵、缺陷与回归结果")
        add("launch", "发布与指标", "growth",
            "准备发布清单、指标和回滚方案；需要登录或授权时走审批。",
            "发布步骤可执行；指标和回滚明确。", ["launch", "analytics", "metrics"],
            ["qa"], "发布清单、指标看板、回滚方案")
        add("coordination", "统筹、风险与决策记录", "chief",
            "维护依赖、决策记录和风险清单；确保每个 Agent 有任务；需要老板的事项只限四类。",
            "无空岗；所有技术分歧有记录；老板门禁清晰。", ["planning", "coordination", "risk"],
            [], "决策记录、风险清单、覆盖报告")
        if re.search(r"文案|内容|邮件|marketing|content|copy|seo", text):
            add("content", "内容与对外表达", "copy",
                "产出任务相关文案、术语和对外表达；与设计/产品对齐。",
                "关键文案有版本和验收人。", ["copy", "content", "email"],
                ["requirements"], "文案/内容稿")
        if re.search(r"视频|脚本|demo|video|storyboard", text):
            add("video", "视频/演示素材", "video",
                "产出脚本、分镜或演示素材；标注依赖。",
                "脚本可拍摄/可演示；素材清单完整。", ["script", "video", "storyboard"],
                ["requirements"], "脚本/分镜/素材清单")
        by_key = {task["key"]: task["id"] for task in tasks}
        for task in tasks:
            task["deps"] = [by_key.get(dep, dep) for dep in task.get("deps") or []]
        return tasks

    def _assign_tasks(self, mission):
        load = {}
        preferred = mission.get("preferredExecutors") or {}
        by_id = {a["id"]: a for a in mission["members"]}
        for task in mission["tasks"]:
            candidates = mission["members"]
            preferred_agent = by_id.get(preferred.get(task.get("key")))
            best = preferred_agent or max(
                candidates, key=lambda a: score_agent(a, task, load.get(a.get("id"), 0)))
            task["assigneeId"] = best["id"]
            task["assigneeName"] = best.get("titleZh") or best.get("name")
            overlap = sorted(set(best.get("skills") or []) & set(task.get("requiredSkills") or []))
            task["assignmentReason"] = (
                "技能匹配 " + ("、".join(overlap) if overlap else "角色匹配")
                + "；当前负载 " + str(load.get(best["id"], 0))
            )
            task["estimate"] = estimate_task(task, mission, best, load.get(best["id"], 0))
            load[best["id"]] = load.get(best["id"], 0) + 1

    def _standby_spec(self, agent):
        role = agent.get("role")
        specs = {
            "chief": ("依赖与风险巡检", "检查阻塞、审批和空岗；每个风险给出解决方案。",
                      ["planning", "coordination", "risk"]),
            "product": ("需求边界补充", "补充用户/场景/非目标，检查验收是否可测。",
                        ["research", "prd", "acceptance"]),
            "design": ("体验走查与素材清单", "走查关键流程和边界状态，列出素材与取舍。",
                       ["ui", "ux", "brand"]),
            "engineer": ("技术风险预检", "检查环境、依赖、数据和安全风险，给出替代路径。",
                         ["frontend", "backend", "deploy"]),
            "qa": ("验收矩阵与回归清单", "补齐边界、可访问性和回归检查，标出风险。",
                   ["test", "accessibility", "regression"]),
            "growth": ("渠道与指标预案", "准备发布渠道、指标和回滚触发条件。",
                       ["launch", "analytics", "metrics"]),
            "copy": ("术语表与对外文案", "统一术语，准备对外说明和常见问题。",
                     ["copy", "content", "seo"]),
            "video": ("素材与分镜预检", "准备可复用素材、分镜和演示路径。",
                      ["script", "video", "storyboard"]),
        }
        title, brief, skills = specs.get(role, (
            "环境与协作预检", "检查可用工具、权限和输入材料，列出阻塞与解决方案。",
            agent.get("skills") or ["coordination"]))
        return title, brief, skills

    def _ensure_no_idle(self, mission):
        load = self._workload(mission)
        for agent in mission["members"]:
            if load.get(agent.get("id"), 0):
                continue
            title, brief, skills = self._standby_spec(agent)
            task = {
                "id": _mid("task"),
                "missionId": mission["id"],
                "key": "standby-" + agent.get("id"),
                "title": title,
                "brief": brief + " 汇报必须带解决方案，不能把技术问题原样上交。",
                "role": agent.get("role"),
                "requiredSkills": skills,
                "acceptance": "有明确产出或风险结论，并给出下一步。",
                "deliverable": "巡检/预检记录",
                "deps": [],
                "assigneeId": agent.get("id"),
                "assigneeName": agent.get("titleZh") or agent.get("name"),
                "assignmentReason": "待命覆盖：该 Agent 暂无主任务，分配可验证的风险/证据巡检。",
                "status": "assigned",
                "priority": "P2",
                "report": None,
                "estimate": None,
                "actual": _task_actual_default(),
                "usages": [],
                "source": "standby",
                "createdAt": now_iso(),
                "updatedAt": now_iso(),
            }
            task["estimate"] = estimate_task(task, mission, agent, load.get(agent.get("id"), 0))
            mission["tasks"].append(task)
            load[agent.get("id")] = 1

    def _promote_ready(self, mission):
        by_id = {t["id"]: t for t in mission["tasks"]}
        changed = True
        while changed:
            changed = False
            for task in mission["tasks"]:
                if task.get("status") != "queued":
                    continue
                if all(by_id.get(dep, {}).get("status") == "done" for dep in task.get("deps") or []):
                    task["status"] = "assigned"
                    task["updatedAt"] = now_iso()
                    changed = True

    # -------------------------------------------------------------- decisions

    def add_decision(self, mission, topic, outcome, rationale="", decided_by="team", votes=None):
        decision = {
            "id": _mid("dec"),
            "topic": _text(topic, 200),
            "outcome": _text(outcome, 2000),
            "rationale": _text(rationale, 2000),
            "decidedBy": decided_by,
            "votes": votes or [],
            "createdAt": now_iso(),
        }
        mission.setdefault("decisions", []).append(decision)
        mission["updatedAt"] = now_iso()
        self._system_message(mission, "decision", "团队决策：" + decision["topic"] +
                             "\n结论：" + decision["outcome"] +
                             ("\n理由：" + decision["rationale"] if decision["rationale"] else ""))
        self._save()
        return decision

    # ------------------------------------------------------------- approvals

    def create_approval(self, mission, data):
        gate = str(data.get("type") or "")
        if gate not in BOSS_GATES:
            raise MissionError(
                "technical issues must be solved by the team; only spend/decision/login/authorization need the boss",
                "not_boss_gate", 400)
        if gate == "spend":
            try:
                amount = float(data.get("amount") or 0)
            except (TypeError, ValueError):
                amount = 0
            if amount <= 0:
                raise MissionError("spend approval needs a positive amount", "bad_amount", 400)
        raw_options = data.get("options")
        if isinstance(raw_options, str):
            raw_options = [part.strip() for part in raw_options.split("|") if part.strip()]
        options = []
        for index, option in enumerate(raw_options if isinstance(raw_options, list) else []):
            if isinstance(option, dict):
                options.append({
                    "id": str(option.get("id") or ("option-" + str(index + 1))),
                    "label": str(option.get("label") or option.get("id") or option),
                    "pros": _text(option.get("pros"), 1000),
                    "cons": _text(option.get("cons"), 1000),
                })
            else:
                options.append({"id": "option-" + str(index + 1), "label": str(option)})
        if gate == "decision" and len(options) < 2:
            raise MissionError("decision approval needs at least two options", "bad_options", 400)
        if gate == "login" and not _text(data.get("service"), 200):
            raise MissionError("login approval needs a service", "bad_service", 400)
        if gate == "authorization" and not _list(data.get("scopes")):
            raise MissionError("authorization approval needs scopes", "bad_scopes", 400)
        approval = {
            "id": _mid("apr"),
            "missionId": mission["id"],
            "type": gate,
            "title": _text(data.get("title") or gate, 200),
            "description": _text(data.get("description"), 2000),
            "amount": float(data.get("amount") or 0),
            "currency": str(data.get("currency") or mission.get("currency") or "CNY")[:8],
            "options": options,
            "scopes": _list(data.get("scopes")),
            "service": _text(data.get("service"), 200),
            "requestedBy": _text(data.get("requestedBy"), 80),
            "taskId": _text(data.get("taskId"), 80),
            "attachmentIds": _list(data.get("attachmentIds")),
            "status": "pending",
            "createdAt": now_iso(),
            "resolvedAt": "",
            "resolution": None,
        }
        self.data["approvals"].append(approval)
        self._system_message(
            mission, "approval",
            "需要老板审批 [" + gate + "]：" + approval["title"] +
            ("\n金额：" + str(approval["amount"]) + " " + approval["currency"] if gate == "spend" else "") +
            ("\n服务：" + approval["service"] if gate == "login" else "") +
            ("\n权限：" + "、".join(approval["scopes"]) if gate == "authorization" else "") +
            "\n审批通过前，相关执行不得继续。",
            meta={"approvalId": approval["id"], "approvalType": gate},
        )
        self._save()
        return self.public_approval(approval)

    def resolve_approval(self, approval_id, decision, note="", option_id=""):
        approval = self.find_approval(approval_id)
        if not approval:
            raise MissionError("approval not found", "not_found", 404)
        if approval.get("status") != "pending":
            raise MissionError("approval already resolved", "already_resolved", 409)
        if decision not in ("approved", "rejected"):
            raise MissionError("decision must be approved or rejected", "bad_decision", 400)
        if decision == "approved" and approval.get("type") == "decision":
            if option_id and not any(str(o.get("id")) == option_id for o in approval.get("options") or []):
                raise MissionError("unknown decision option", "bad_option", 400)
        approval["status"] = decision
        approval["resolvedAt"] = now_iso()
        approval["resolution"] = {
            "note": _text(note, 2000),
            "optionId": _text(option_id, 80),
            "by": "boss",
        }
        mission = self.find_mission(approval.get("missionId"))
        if mission:
            task = None
            if approval.get("taskId"):
                _, task = self.find_task(approval["taskId"])
            if task:
                if decision == "approved":
                    task["status"] = "assigned" if task.get("status") in ("blocked", "queued") else task.get("status")
                    task["updatedAt"] = now_iso()
                else:
                    task["status"] = "blocked"
                    task["updatedAt"] = now_iso()
            self._system_message(
                mission, "approval",
                "老板" + ("批准" if decision == "approved" else "驳回") + "：" + approval["title"] +
                ("\n选项：" + option_id if option_id else "") +
                ("\n备注：" + note if note else ""),
                meta={"approvalId": approval["id"], "status": decision},
            )
            self._save()
        return self.public_approval(approval)

    # -------------------------------------------------------------- reports

    def validate_report(self, report):
        if not isinstance(report, dict):
            raise MissionError("report must be an object", "bad_report", 400)
        missing = [key for key in REPORT_FIELDS if not _list(report.get(key)) if key in ("done", "next", "risks")]
        if not _text(report.get("summary"), 4000):
            missing.append("summary")
        if not _text(report.get("solution"), 4000):
            missing.append("solution")
        if missing:
            raise MissionError(
                "report must include: " + ", ".join(missing) + "; technical reports need a solution",
                "report_needs_solution", 400)
        needs = _list(report.get("needsBoss"))
        bad = [item for item in needs if item not in BOSS_GATES]
        if bad:
            raise MissionError(
                "technical issues must be solved by the team; boss gates are only spend/decision/login/authorization",
                "technical_issue_must_be_solved", 400)
        return {
            "summary": _text(report.get("summary")),
            "done": _list(report.get("done")),
            "next": _list(report.get("next")),
            "risks": _list(report.get("risks")),
            "solution": _text(report.get("solution")),
            "evidence": _list(report.get("evidence")),
            "needsBoss": needs,
            "approval": report.get("approval") if isinstance(report.get("approval"), dict) else None,
        }

    def submit_task_report(self, task_id, body, actor="", status="review"):
        mission, task = self.find_task(task_id)
        if not mission or not task:
            raise MissionError("task not found", "not_found", 404)
        report = self.validate_report(body.get("report"))
        if actor and task.get("assigneeId") and actor != task.get("assigneeId"):
            raise MissionError("only the assignee can report this task", "not_assignee", 403)
        if status not in TASK_STATUSES:
            status = "review"
        task["report"] = report
        task["status"] = status
        task["progress"] = TASK_PROGRESS_DEFAULT.get(status, 90)
        task["updatedAt"] = now_iso()
        _mark_task_actual(task, status)
        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        if not usage and isinstance(report.get("usage"), dict):
            usage = report["usage"]
        if usage:
            _record_task_usage(task, usage)
        mission["status"] = "review" if status == "review" else mission.get("status")
        mission["updatedAt"] = now_iso()
        if status == "done":
            self._promote_ready(mission)
            if mission.get("tasks") and all(t.get("status") == "done" for t in mission["tasks"]):
                mission["status"] = "done"
        self._system_message(
            mission, "report",
            "任务汇报 · " + task["title"] + "\n" + report["summary"],
            meta={"taskId": task["id"], "report": report, "status": status},
            sender_id=task.get("assigneeId") or "agent",
            sender_name=task.get("assigneeName") or "Agent",
            sender_type="agent",
        )
        if report.get("needsBoss"):
            approval_data = dict(report.get("approval") or {})
            approval_data.setdefault("type", report["needsBoss"][0])
            approval_data.setdefault("title", "审批 · " + task["title"])
            approval_data.setdefault("requestedBy", task.get("assigneeId"))
            approval_data.setdefault("taskId", task["id"])
            approval_data["description"] = approval_data.get("description") or report["summary"]
            self.create_approval(mission, approval_data)
        self._save()
        return self.public_task(task, mission)

    def update_task(self, task_id, body, actor=""):
        mission, task = self.find_task(task_id)
        if not mission or not task:
            raise MissionError("task not found", "not_found", 404)
        if body.get("report") is not None:
            return self.submit_task_report(task_id, body, actor,
                                           str(body.get("status") or "review"))
        status = str(body.get("status") or "")
        if status and status not in TASK_STATUSES:
            raise MissionError("unknown task status", "bad_status", 400)
        for field, limit in (("title", 200), ("brief", 4000), ("acceptance", 2000)):
            if body.get(field) is not None:
                value = _text(body.get(field), limit)
                if field == "title" and len(value) < 2:
                    raise MissionError("task title is too short", "bad_title", 400)
                task[field] = value
        if body.get("priority") is not None:
            task["priority"] = _text(body.get("priority"), 8) or task.get("priority")
        if status:
            task["status"] = status
            task["progress"] = TASK_PROGRESS_DEFAULT.get(status, task.get("progress", 0))
            _mark_task_actual(task, status)
        if body.get("progress") is not None:
            try:
                progress = int(body.get("progress"))
            except (TypeError, ValueError):
                raise MissionError("progress must be a number", "bad_progress", 400)
            task["progress"] = max(0, min(100, progress))
        if body.get("assigneeId"):
            member = next((m for m in mission["members"] if m["id"] == body["assigneeId"]), None)
            if not member:
                raise MissionError("assignee is not a mission member", "bad_assignee", 400)
            task["assigneeId"] = member["id"]
            task["assigneeName"] = member.get("titleZh") or member.get("name")
        if body.get("blockedReason") is not None:
            task["blockedReason"] = str(body.get("blockedReason") or "")[:500]
        if status and status != "blocked":
            task.pop("blockedReason", None)
        task["updatedAt"] = now_iso()
        mission["updatedAt"] = now_iso()
        if status == "done":
            self._promote_ready(mission)
        if mission.get("tasks") and all(t.get("status") == "done" for t in mission["tasks"]):
            mission["status"] = "done"
        self._save()
        return self.public_task(task, mission)

    # --------------------------------------------------------------- messages

    def add_agent_message(self, mission, agent_id, text, kind="text", meta=None):
        member = next((m for m in mission.get("members", []) if m.get("id") == agent_id), None)
        if not member:
            raise MissionError("agent is not a mission member", "not_member", 403)
        conversation = self.find_conversation(mission.get("conversationId"))
        if not conversation:
            raise MissionError("mission conversation not found", "not_found", 404)
        message = self._append_message(conversation, {
            "senderId": member["id"],
            "senderName": member.get("titleZh") or member.get("name"),
            "senderType": "agent",
            "type": kind if kind in ("text", "proposal", "decision", "report") else "text",
            "text": _text(text, 8000),
            "meta": meta or {},
        })
        self._save()
        return message

    def set_discussion(self, mission_id, **fields):
        mission = self.find_mission(mission_id)
        if not mission:
            raise MissionError("mission not found", "not_found", 404)
        discussion = mission.setdefault("discussion", {})
        discussion.update(fields)
        mission["updatedAt"] = now_iso()
        self._save()
        return discussion

    def set_autorun(self, mission_id, **fields):
        mission = self.find_mission(mission_id)
        if not mission:
            raise MissionError("mission not found", "not_found", 404)
        autorun = mission.setdefault("autoRun", {})
        autorun.update(fields)
        autorun["updatedAt"] = now_iso()
        mission["updatedAt"] = now_iso()
        self._save()
        return dict(autorun)

    def update_token_budget(self, mission_id, value):
        mission = self.find_mission(mission_id)
        if not mission:
            raise MissionError("mission not found", "not_found", 404)
        try:
            budget = max(0, min(2000000, int(float(value or 0))))
        except (TypeError, ValueError, OverflowError):
            raise MissionError("tokenBudget must be a number", "bad_budget", 400)
        mission["tokenBudget"] = budget
        mission.setdefault("autoRun", {})["tokenBudget"] = budget
        mission["updatedAt"] = now_iso()
        self._save()
        return self.get_mission(mission_id)

    def messages_since(self, since=0):
        rows = [m for m in self.data["messages"] if int(m.get("seq") or 0) > int(since)]
        rows.sort(key=lambda m: int(m.get("seq") or 0))
        return [self.public_message(m) for m in rows]

    def list_approvals(self, status=""):
        rows = [a for a in self.data["approvals"] if not status or a.get("status") == status]
        rows.sort(key=lambda a: a.get("createdAt", ""), reverse=True)
        return [self.public_approval(a) for a in rows]

    def list_tasks_for_agent(self, agent_id):
        rows = []
        for mission in self.data["missions"]:
            for task in mission.get("tasks", []):
                if task.get("assigneeId") == agent_id:
                    item = self.public_task(task, mission)
                    item["missionTitle"] = mission.get("title")
                    item["missionDescription"] = mission.get("description")
                    rows.append(item)
        rows.sort(key=lambda t: t.get("updatedAt", ""), reverse=True)
        return rows

    def _system_message(self, mission, kind, text, meta=None, sender_id="system",
                        sender_name="System", sender_type="system"):
        conversation = self.find_conversation(mission.get("conversationId"))
        if not conversation:
            return None
        return self._append_message(conversation, {
            "senderId": sender_id,
            "senderName": sender_name,
            "senderType": sender_type,
            "type": kind,
            "text": text,
            "meta": meta or {},
            "attachmentIds": (meta or {}).get("attachmentIds") or [],
        })

    def _append_message(self, conversation, data):
        message = {
            "id": _mid("msg"),
            "seq": self._next_message(),
            "conversationId": conversation["id"],
            "missionId": conversation.get("missionId") or "",
            "senderId": _text(data.get("senderId"), 80),
            "senderName": _text(data.get("senderName"), 120),
            "senderType": str(data.get("senderType") or "agent"),
            "type": str(data.get("type") or "text"),
            "text": _text(data.get("text"), 8000),
            "meta": data.get("meta") if isinstance(data.get("meta"), dict) else {},
            "attachmentIds": _list(data.get("attachmentIds")),
            "usage": data.get("usage") if isinstance(data.get("usage"), dict) else {},
            "createdAt": now_iso(),
        }
        self.data["messages"].append(message)
        conversation["updatedAt"] = message["createdAt"]
        if len(self.data["messages"]) > 5000:
            self.data["messages"] = self.data["messages"][-5000:]
        return self.public_message(message)

    def post_message(self, conversation_id, body):
        conversation = self.find_conversation(conversation_id)
        if not conversation:
            raise MissionError("conversation not found", "not_found", 404)
        sender_type = str(body.get("senderType") or "agent")
        sender_id = _text(body.get("senderId") or ("boss" if sender_type == "boss" else ""), 80)
        if sender_type == "agent":
            member = next((m for m in conversation.get("members", []) if m["id"] == sender_id), None)
            if not member:
                raise MissionError("sender is not a conversation member", "not_member", 403)
            sender_name = member.get("titleZh") or member.get("name")
        elif sender_type == "boss":
            sender_id = "boss"
            sender_name = "老板"
        else:
            raise MissionError("senderType must be boss or agent", "bad_sender", 400)
        message_type = str(body.get("type") or "text")
        if message_type not in ("text", "report", "proposal", "decision", "attachment"):
            raise MissionError("unsupported message type", "bad_type", 400)
        text = _text(body.get("text"), 8000)
        report = None
        if message_type == "report":
            report = self.validate_report(body.get("report"))
            text = text or report["summary"]
        if not text and not body.get("attachmentIds"):
            raise MissionError("message is empty", "empty_message", 400)
        attachment_ids = _list(body.get("attachmentIds"))
        for artifact_id in attachment_ids:
            if not self.find_artifact(artifact_id):
                raise MissionError("unknown attachment: " + artifact_id, "bad_attachment", 400)
        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        message = self._append_message(conversation, {
            "senderId": sender_id, "senderName": sender_name, "senderType": sender_type,
            "type": message_type, "text": text,
            "meta": {"report": report} if report else (body.get("meta") or {}),
            "attachmentIds": attachment_ids,
            "usage": usage,
        })
        mission = self.find_mission(conversation.get("missionId"))
        if mission and message_type == "report":
            task_id = _text(body.get("taskId"), 80)
            if task_id:
                _, task = self.find_task(task_id)
                if task and task.get("assigneeId") == sender_id:
                    task["report"] = report
                    task["status"] = "review"
                    task["updatedAt"] = now_iso()
                    _mark_task_actual(task, "review")
                    if usage:
                        _record_task_usage(task, usage)
                    mission["status"] = "review"
                    mission["updatedAt"] = now_iso()
                    message["meta"]["taskId"] = task_id
            if report.get("needsBoss"):
                approval_data = dict(report.get("approval") or {})
                approval_data.setdefault("type", report["needsBoss"][0])
                approval_data.setdefault("title", "审批 · " + (task_id or "任务汇报"))
                approval_data.setdefault("requestedBy", sender_id)
                approval_data.setdefault("taskId", task_id)
                approval_data["description"] = (
                    approval_data.get("description") or report["summary"])
                self.create_approval(mission, approval_data)
        self._save()
        return message

    def list_messages(self, conversation_id, since=0):
        conversation = self.find_conversation(conversation_id)
        if not conversation:
            raise MissionError("conversation not found", "not_found", 404)
        rows = [m for m in self.data["messages"]
                if m.get("conversationId") == conversation_id and int(m.get("seq") or 0) > since]
        return [self.public_message(m) for m in rows]

    # ---------------------------------------------------------- conversations

    def create_conversation(self, body, directory):
        kind = str(body.get("kind") or "group")
        if kind not in ("group", "direct"):
            raise MissionError("conversation kind must be group or direct", "bad_kind", 400)
        member_ids = _list(body.get("memberIds"))
        by_id = {a["id"]: a for a in directory}
        members = [by_id[item] for item in member_ids if item in by_id]
        if not members:
            raise MissionError("choose at least one agent", "no_members", 400)
        if kind == "direct" and len(members) != 1:
            raise MissionError("direct chat needs exactly one agent", "bad_members", 400)
        title = _text(body.get("title"), 120)
        if not title:
            title = ("私聊 · " + (members[0].get("titleZh") or members[0].get("name"))
                     if kind == "direct" else "新群聊")
        conversation = {
            "id": _mid("conv"),
            "kind": kind,
            "title": title,
            "missionId": "",
            "members": members,
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
        }
        self.data["conversations"].append(conversation)
        self._append_message(conversation, {
            "senderId": "system", "senderName": "System", "senderType": "system",
            "type": "system", "text": "会话已创建。技术问题由 Agent 讨论解决；只有花费、拍板、登录、授权需要老板审批。",
        })
        self._save()
        return self.public_conversation(conversation)

    def list_conversations(self, mission_id="", kind=""):
        rows = []
        for conversation in self.data["conversations"]:
            if mission_id and conversation.get("missionId") != mission_id:
                continue
            if kind and conversation.get("kind") != kind:
                continue
            rows.append(self.public_conversation(conversation))
        rows.sort(key=lambda c: c.get("updatedAt", ""), reverse=True)
        return rows

    # -------------------------------------------------------------- artifacts

    def add_artifact(self, data):
        artifact = {
            "id": _mid("art"),
            "name": _text(data.get("name"), 200),
            "mime": _text(data.get("mime"), 120),
            "size": int(data.get("size") or 0),
            "kind": str(data.get("kind") or "other"),
            "path": str(data.get("path") or ""),
            "createdAt": now_iso(),
            "missionId": _text(data.get("missionId"), 80),
            "conversationId": _text(data.get("conversationId"), 80),
            "uploadedBy": _text(data.get("uploadedBy") or "boss", 80),
            "extractedText": _text(data.get("extractedText"), 20000),
            "extraction": str(data.get("extraction") or "none"),
            "visionSummary": _text(data.get("visionSummary"), 12000),
            "visionProvider": _text(data.get("visionProvider"), 80),
        }
        self.data["artifacts"].append(artifact)
        if artifact["missionId"]:
            mission = self.find_mission(artifact["missionId"])
            if mission:
                mission.setdefault("artifactIds", []).append(artifact["id"])
                mission["updatedAt"] = now_iso()
        self._save()
        return self.public_artifact(artifact)

    def update_artifact(self, artifact_id, **fields):
        artifact = self.find_artifact(artifact_id)
        if not artifact:
            raise MissionError("artifact not found", "not_found", 404)
        for key in ("extractedText", "extraction", "visionSummary", "visionProvider"):
            if key in fields:
                artifact[key] = _text(fields[key], 20000)
        self._save()
        return self.public_artifact(artifact)

    def list_artifacts(self, mission_id="", conversation_id=""):
        rows = []
        for artifact in self.data["artifacts"]:
            if mission_id and artifact.get("missionId") != mission_id:
                continue
            if conversation_id and artifact.get("conversationId") != conversation_id:
                continue
            rows.append(self.public_artifact(artifact))
        rows.sort(key=lambda a: a.get("createdAt", ""), reverse=True)
        return rows

    # --------------------------------------------------------------- overview

    def list_missions(self):
        rows = [self.public_mission(m, summary=True) for m in self.data["missions"]]
        rows.sort(key=lambda m: m.get("updatedAt", ""), reverse=True)
        return rows

    def get_mission(self, mission_id):
        mission = self.find_mission(mission_id)
        if not mission:
            return None
        return self.public_mission(mission)

    def get_conversation(self, conversation_id):
        return self.public_conversation(self.find_conversation(conversation_id))

    def revision(self):
        """Cheap change token for real-time overview streams."""
        missions = []
        for mission in self.data["missions"]:
            auto = mission.get("autoRun") or {}
            missions.append([
                mission.get("id"),
                mission.get("status"),
                mission.get("updatedAt"),
                auto.get("status"),
                auto.get("currentTaskId"),
                auto.get("currentAgentId"),
                auto.get("completed"),
                auto.get("tokensUsed"),
                auto.get("error"),
                [[t.get("id"), t.get("status"), t.get("progress"),
                  t.get("updatedAt"), t.get("assigneeId")]
                 for t in mission.get("tasks", [])],
            ])
        approvals = [[a.get("id"), a.get("status"), a.get("resolvedAt"),
                      a.get("createdAt")] for a in self.data["approvals"]]
        conversations = [[c.get("id"), c.get("updatedAt"),
                          (c.get("lastMessage") or {}).get("seq")]
                         for c in self.data["conversations"]]
        artifacts = [[a.get("id"), a.get("createdAt")]
                     for a in self.data["artifacts"][-80:]]
        payload = json.dumps([missions, approvals, conversations, artifacts],
                             ensure_ascii=False, sort_keys=True)
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:20]

    def snapshot(self):
        return {
            "revision": self.revision(),
            "missions": [self.public_mission(m, summary=True) for m in self.data["missions"]],
            "conversations": self.list_conversations(),
            "approvals": [self.public_approval(a) for a in self.data["approvals"]
                          if a.get("status") == "pending"],
            "artifacts": [self.public_artifact(a) for a in self.data["artifacts"][-50:]],
        }

    def _delete_artifacts(self, predicate):
        keep = []
        for artifact in self.data["artifacts"]:
            if predicate(artifact):
                try:
                    Path(artifact.get("path") or "").unlink()
                except OSError:
                    pass
            else:
                keep.append(artifact)
        self.data["artifacts"] = keep

    def set_archived(self, mission_id, archived=True):
        mission = self.find_mission(mission_id)
        if not mission:
            return None
        mission["archivedAt"] = now_iso() if archived else ""
        mission["updatedAt"] = now_iso()
        self._save()
        return self.public_mission(mission, summary=True)

    def delete_mission(self, mission_id):
        mission = self.find_mission(mission_id)
        if not mission:
            return False
        conv_ids = {c["id"] for c in self.data["conversations"] if c.get("missionId") == mission_id}
        self.data["messages"] = [m for m in self.data["messages"]
                                 if m.get("conversationId") not in conv_ids]
        self.data["conversations"] = [c for c in self.data["conversations"]
                                      if c.get("missionId") != mission_id]
        self.data["missions"] = [m for m in self.data["missions"] if m.get("id") != mission_id]
        self.data["approvals"] = [a for a in self.data["approvals"]
                                  if a.get("missionId") != mission_id]
        self._delete_artifacts(lambda a: a.get("missionId") == mission_id)
        self._save()
        return True

    def delete_conversation(self, conversation_id):
        conversation = self.find_conversation(conversation_id)
        if not conversation:
            return False
        if conversation.get("missionId"):
            raise MissionError("mission conversations are deleted with the mission",
                               "mission_conversation", 409)
        self.data["messages"] = [m for m in self.data["messages"]
                                 if m.get("conversationId") != conversation_id]
        self.data["conversations"] = [c for c in self.data["conversations"]
                                      if c.get("id") != conversation_id]
        self._delete_artifacts(lambda a: a.get("conversationId") == conversation_id)
        self._save()
        return True


# --------------------------------------------------------------- extraction

def extract_text(path, mime="", name=""):
    """Best-effort text extraction using stdlib and optional system tools."""
    path = Path(path)
    lower = (name or path.name).lower()
    mime = str(mime or "").lower()
    try:
        if lower.endswith((".txt", ".md", ".markdown", ".csv", ".json", ".log", ".yaml", ".yml")):
            return path.read_text("utf-8", errors="replace")[:20000], "text"
        if lower.endswith((".html", ".htm")) or "html" in mime:
            raw = path.read_text("utf-8", errors="replace")
            raw = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", raw)
            return html.unescape(re.sub(r"(?s)<[^>]+>", " ", raw))[:20000], "html"
        if lower.endswith(".docx"):
            with zipfile.ZipFile(path) as zf:
                raw = zf.read("word/document.xml").decode("utf-8", "replace")
            raw = re.sub(r"</w:p>", "\n", raw)
            return html.unescape(re.sub(r"(?s)<[^>]+>", " ", raw)).strip()[:20000], "docx"
        if lower.endswith(".doc"):
            tool = shutil.which("textutil")
            if tool:
                result = subprocess.run([tool, "-convert", "txt", "-stdout", str(path)],
                                        capture_output=True, text=True, timeout=20)
                if result.returncode == 0:
                    return result.stdout[:20000], "textutil"
        if lower.endswith(".pdf"):
            tool = shutil.which("pdftotext")
            if tool:
                result = subprocess.run([tool, str(path), "-"], capture_output=True,
                                        text=True, timeout=30)
                if result.returncode == 0:
                    return result.stdout[:20000], "pdftotext"
        if lower.endswith((".xlsx", ".xlsm")):
            with zipfile.ZipFile(path) as zf:
                names = [n for n in zf.namelist() if n.startswith("xl/sharedStrings")]
                parts = []
                for name in names:
                    raw = zf.read(name).decode("utf-8", "replace")
                    parts.extend(html.unescape(re.sub(r"(?s)<[^>]+>", " ", raw)).split())
                return " ".join(parts)[:20000], "xlsx"
    except (OSError, zipfile.BadZipFile, subprocess.SubprocessError, UnicodeDecodeError):
        return "", "none"
    return "", "none"
