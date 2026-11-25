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
MAX_TEXT = 12000

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
        return out

    def public_mission(self, mission, summary=False):
        if not mission:
            return None
        tasks = mission.get("tasks", [])
        done = sum(1 for t in tasks if t.get("status") == "done")
        review = sum(1 for t in tasks if t.get("status") == "review")
        blocked = sum(1 for t in tasks if t.get("status") == "blocked")
        load = self._workload(mission)
        idle = [a for a in mission.get("members", []) if load.get(a.get("id"), 0) == 0]
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
            "autoDiscuss": bool(mission.get("autoDiscuss")),
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
        members = choose_agents(directory, _list(body.get("memberIds")), description)
        if not members:
            raise MissionError("no agents are available", "no_agents", 409)
        budget = 0.0
        try:
            budget = max(0.0, float(body.get("budget") or 0))
        except (TypeError, ValueError):
            budget = 0.0
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
        mission = {
            "id": mission_id,
            "title": title,
            "description": description,
            "acceptance": acceptance,
            "priority": str(body.get("priority") or "P1")[:8],
            "status": "active",
            "budget": budget,
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
        }
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
        for task in mission["tasks"]:
            candidates = mission["members"]
            best = max(candidates, key=lambda a: score_agent(a, task, load.get(a.get("id"), 0)))
            task["assigneeId"] = best["id"]
            task["assigneeName"] = best.get("titleZh") or best.get("name")
            overlap = sorted(set(best.get("skills") or []) & set(task.get("requiredSkills") or []))
            task["assignmentReason"] = (
                "技能匹配 " + ("、".join(overlap) if overlap else "角色匹配")
                + "；当前负载 " + str(load.get(best["id"], 0))
            )
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
                "source": "standby",
                "createdAt": now_iso(),
                "updatedAt": now_iso(),
            }
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
        task["updatedAt"] = now_iso()
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
        if status:
            task["status"] = status
        if body.get("assigneeId"):
            member = next((m for m in mission["members"] if m["id"] == body["assigneeId"]), None)
            if not member:
                raise MissionError("assignee is not a mission member", "bad_assignee", 400)
            task["assigneeId"] = member["id"]
            task["assigneeName"] = member.get("titleZh") or member.get("name")
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
        message = self._append_message(conversation, {
            "senderId": sender_id, "senderName": sender_name, "senderType": sender_type,
            "type": message_type, "text": text,
            "meta": {"report": report} if report else (body.get("meta") or {}),
            "attachmentIds": attachment_ids,
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

    def snapshot(self):
        return {
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
