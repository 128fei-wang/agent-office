(function () {
  "use strict";

  const AO = window.AgentOffice;

  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function hex32(n, len) {
    let out = (n >>> 0).toString(16);
    while (out.length < len) out = "0" + out;
    return out.slice(-len);
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function segmentHitsRect(a, b, r, pad) {
    pad = pad || 0;
    const xmin = r.x - pad;
    const ymin = r.y - pad;
    const xmax = r.x + r.w + pad;
    const ymax = r.y + r.h + pad;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const p = [-dx, dx, -dy, dy];
    const q = [a.x - xmin, xmax - a.x, a.y - ymin, ymax - a.y];
    let t0 = 0;
    let t1 = 1;
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-9) {
        if (q[i] < 0) return false;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) {
          if (t > t1) return false;
          if (t > t0) t0 = t;
        } else {
          if (t < t0) return false;
          if (t < t1) t1 = t;
        }
      }
    }
    return true;
  }

  function pathBlocked(a, b) {
    for (let i = 0; i < AO.OBSTACLES.length; i++) {
      if (segmentHitsRect(a, b, AO.OBSTACLES[i], 9)) return true;
    }
    return false;
  }

  function pointBlocked(p) {
    for (let i = 0; i < AO.OBSTACLES.length; i++) {
      const r = AO.OBSTACLES[i];
      if (
        p.x > r.x - 9 && p.x < r.x + r.w + 9 &&
        p.y > r.y - 9 && p.y < r.y + r.h + 9
      ) return true;
    }
    return false;
  }

  const DEBUG = (AO.DEBUG = AO.DEBUG || { pathFails: [], targetBlocked: [] });

  function pathFor(from, to) {
    if (!pathBlocked(from, to)) return [to];
    const hubs = AO.HUBS;
    const used = new Array(hubs.length).fill(false);

    // 依次尝试 1~4 个走廊节点。第一个能走通的层数即返回，
    // 办公室有玻璃隔断后，跨房间通常需要 2~4 个中继点。
    for (let depth = 1; depth <= 4; depth++) {
      let best = null;

      function walk(prev, points) {
        if (points.length === depth) {
          if (pathBlocked(prev, to)) return;
          let total = 0;
          let cursor = from;
          for (let i = 0; i < points.length; i++) {
            total += dist(cursor, points[i]);
            cursor = points[i];
          }
          total += dist(cursor, to);
          if (!best || total < best.total) {
            best = { total: total, points: points.slice() };
          }
          return;
        }
        for (let i = 0; i < hubs.length; i++) {
          if (used[i]) continue;
          const hub = hubs[i];
          if (pathBlocked(prev, hub)) continue;
          used[i] = true;
          points.push(hub);
          walk(hub, points);
          points.pop();
          used[i] = false;
        }
      }

      walk(from, []);
      if (best) return best.points.concat([to]);
    }
    DEBUG.pathFails.push({
      from: { x: Math.round(from.x), y: Math.round(from.y) },
      to: { x: Math.round(to.x), y: Math.round(to.y) }
    });
    return [to];
  }

  class Engine {
    constructor(scenarioId) {
      this.scenarioId = scenarioId || "launch";
      this.speed = 1;
      this.paused = false;
      this.reset(this.scenarioId);
    }

    get stepMs() {
      return Math.max(140, Math.round(850 / this.speed));
    }

    reset(scenarioId) {
      const sc = AO.SCENARIOS[scenarioId] || AO.SCENARIOS.launch;
      this.scenarioId = sc.id;
      this.rng = mulberry32(20261124 + (sc.id === "incident" ? 7 : 0));
      const w = {
        scenarioId: sc.id,
        scenarioName: sc.name,
        officeName: sc.officeName || "SPRINT OFFICE",
        neon: sc.neon || "SHIP IT",
        brief: sc.brief,
        goal: sc.goal,
        finishText: sc.finishText,
        finishBubble: sc.finishBubble,
        tick: 0,
        minutes: 9 * 60,
        day: 1,
        agents: [],
        tasks: [],
        messages: [],
        meeting: null,
        eventsApplied: {},
        stats: { meetings: 0, reviews: 0, approvals: 0, coffees: 0, messages: 0, externalCompletions: 0 },
        done: false,
        finishedAt: null,
        messageSeq: 0,
        injected: 0,
        history: [],
        ledger: [],
        ledgerSeq: 0,
        evalRuns: [],
        humanReview: null,
        runId: hex32(hash32(sc.id + "|" + sc.goal + "|" + Date.now()), 16)
      };
      this.world = w;

      w.agents = AO.AGENTS.map((def, index) => this.makeAgent(def, index));

      w.tasks = sc.tasks.map((t) => this.makeTask(t, sc.id, 0));
      AO.AGENTS.forEach((def) => {
        if (!def.hired) return;
        const onboard = this.makeTask({
          id: "onb-" + def.id,
          title: "入职：熟悉工具链与看板",
          role: def.role,
          effort: 3,
          priority: 2,
          deps: [],
          desc: "新同事的第一天：读文档、跑本地工具链、接一个真实任务。"
        }, sc.id, 0);
        onboard.assignee = def.id;
        w.tasks.push(onboard);
      });

      this.addMessage("system", "办公室开门了。今天的目标：" + w.goal);
      this.addMessage("system", w.brief);
      this.world.agents.forEach((a) => {
        this.remember(a, "09:00 到办公室，准备开工");
      });
      this.recordEvent({
        kind: "system",
        action: "场景开始 · " + sc.name,
        note: w.goal + " · " + sc.tasks.length + " 个任务"
      });
    }

    makeAgent(def, index, startOverride) {
      const start = startOverride || AO.START_POSITIONS[index] || { x: 640, y: 558 };
      return {
        id: def.id,
        name: def.name,
        role: def.role,
        deskId: def.deskId,
        skin: def.skin,
        hair: def.hair,
        hairStyle: def.hairStyle,
        shirt: def.shirt,
        accessory: def.accessory,
        trait: def.trait,
        hired: !!def.hired,
        x: start.x,
        y: start.y,
        path: [],
        pending: null,
        state: "idle",
        activity: "刚到办公室",
        intent: "",
        taskId: null,
        energy: 56 + Math.round(this.rand() * 14),
        mood: 70 + Math.round(this.rand() * 16),
        bubble: null,
        bubbleUntil: 0,
        reviewTicks: 0,
        coffeeTicks: 0,
        chatTicks: 0,
        blockedTicks: 0,
        celebrateTicks: 0,
        deskTicks: 0,
        chatTarget: null,
        flip: false,
        memory: [],
        speed: 180,
        skills: (AO.ROLE_SKILLS[def.role] || []).slice(),
        skillUse: {},
        filesTouched: {}
      };
    }

    makeTask(def, scenarioId, createdAt) {
      const plan = AO.WORK[scenarioId + ":" + def.id] ||
        AO.FALLBACK_WORK[def.role] || [];
      const checks = (AO.CHECK_TEMPLATES[def.role] || []).map((c) => ({
        id: c.id,
        label: c.label,
        severity: c.severity,
        status: "pending",
        note: "",
        eventId: null,
        agentId: null
      }));
      return {
        id: def.id,
        title: def.title,
        role: def.role,
        effort: def.effort,
        priority: def.priority,
        deps: (def.deps || []).slice(),
        desc: def.desc,
        status: "backlog",
        assignee: null,
        reviewerId: null,
        progress: 0,
        blockedReason: null,
        createdAt: createdAt || 0,
        startedAt: null,
        completedAt: null,
        work: plan.map((step) => ({
          skill: step.skill,
          tool: step.tool,
          action: step.action,
          file: step.file,
          line: step.line ? step.line.slice() : null,
          add: step.add || 0,
          del: step.del || 0,
          frames: step.frames || 0,
          checks: (step.checks || []).slice(),
          diff: step.diff ? step.diff.slice() : null,
          note: step.note || ""
        })),
        checks: checks,
        workStep: 0,
        reworkCount: 0
      };
    }

    hireAgent(spec) {
      const w = this.world;
      const role = spec && spec.role;
      const allowed = (AO.HIRE_ROLES || ["engineer", "design", "research", "qa"]);
      if (!AO.ROLES[role] || allowed.indexOf(role) === -1) {
        return { ok: false, error: "不支持这个角色" };
      }
      const desk = AO.DESKS.find((d) => d.hot &&
        !w.agents.some((a) => a.deskId === d.id) &&
        !AO.AGENTS.some((a) => a.deskId === d.id));
      if (!desk) return { ok: false, error: "热桌已满（当前上限 8 个 agent）" };
      const name = String(spec.name || "新同事").trim().slice(0, 12) || "新同事";
      const used = new Set(AO.AGENTS.map((a) => a.id));
      let n = 1;
      while (used.has("a" + n)) n += 1;
      const id = "a" + n;
      const roleInfo = AO.ROLES[role];
      const def = {
        id: id,
        name: name,
        role: role,
        deskId: desk.id,
        skin: spec.skin || "#e8b08a",
        hair: spec.hair || "#2b1d16",
        hairStyle: spec.hairStyle || "short",
        shirt: spec.shirt || roleInfo.color,
        accessory: spec.accessory || "none",
        trait: String(spec.trait || "刚加入团队，正在熟悉工具链。").slice(0, 80),
        hired: true
      };
      const start = this.safePoint({
        x: desk.x,
        y: Math.min(585, desk.y + 55)
      });
      const index = AO.AGENTS.length;
      AO.AGENTS.push(def);
      AO.START_POSITIONS[index] = start;
      const agent = this.makeAgent(def, index, start);
      w.agents.push(agent);
      this.remember(agent, "入职：" + name);
      this.addMessage("work", name + " 入职，热桌 " + desk.id + "，准备开始。", agent.id);
      this.recordEvent({
        agentId: agent.id,
        kind: "hire",
        action: "入职 · " + name,
        status: "new",
        note: roleInfo.label + " · 热桌 " + desk.id + " · onboarding 已创建"
      });

      const onboarding = this.makeTask({
        id: "onb-" + agent.id,
        title: "入职：熟悉工具链与看板",
        role: role,
        effort: 3,
        priority: 2,
        deps: [],
        desc: "新同事的第一天：读文档、跑本地工具链、接一个真实任务。"
      }, this.scenarioId, w.tick);
      onboarding.assignee = agent.id;
      w.tasks.push(onboarding);
      w.done = false;
      w.finishedAt = null;
      w.humanReview = null;

      if (typeof AO.saveHires === "function") AO.saveHires();
      return { ok: true, agent: agent, desk: desk, task: onboarding };
    }

    renameAgent(id, name) {
      const next = String(name || "").trim().slice(0, 16);
      if (!next) return { ok: false, error: "名字不能为空" };
      const agent = this.agentById(id);
      const def = AO.AGENTS.find((a) => a.id === id);
      if (!agent || !def) return { ok: false, error: "找不到这个 agent" };
      const old = agent.name;
      if (old === next) return { ok: true, oldName: old, name: next, unchanged: true };
      agent.name = next;
      def.name = next;
      if (typeof AO.saveName === "function") AO.saveName(id, next);
      if (def.hired && typeof AO.saveHires === "function") AO.saveHires();
      this.recordEvent({
        agentId: id,
        kind: "rename",
        action: "重命名 · " + old + " → " + next,
        note: "agent 名称已更新，历史 ledger 保留旧记录"
      });
      this.addMessage("work", old + " 改名为 " + next, id);
      return { ok: true, oldName: old, name: next };
    }

    ingestExternalEvent(ev) {
      if (!ev || ev.id == null || !ev.agentId) return null;
      const externalId = "ext:" + String(ev.id);
      if (this.world.ledger.some((e) => e.externalId === externalId)) return null;
      const task = ev.taskId ? this.taskById(ev.taskId) : null;
      const event = this.recordEvent({
        agentId: ev.agentId,
        agentName: ev.agentName || ev.agentId,
        runtime: ev.runtime || "external",
        external: true,
        externalId: externalId,
        provider: ev.provider || null,
        kind: ev.kind || "external",
        action: ev.action || "external event",
        taskId: task ? task.id : (ev.taskId || null),
        skill: ev.skill || null,
        tool: ev.tool || null,
        file: ev.file || null,
        line: ev.line || null,
        add: ev.add || 0,
        del: ev.del || 0,
        note: ev.note || "",
        tokensIn: ev.tokensIn || 0,
        tokensOut: ev.tokensOut || 0,
        cost: ev.cost || 0,
        durationMs: ev.durationMs || 0,
        model: ev.model || "external-agent"
      });
      if (event) {
        this.addMessage(
          "work",
          (ev.agentName || ev.agentId) + " · " + (ev.action || "external event"),
          ev.agentId
        );
      }
      return event;
    }

    skillName(id) {
      const s = AO.SKILL_CATALOG[id];
      return s ? s.name : id;
    }

    recordEvent(ev) {
      const w = this.world;
      if (!w) return null;
      w.ledgerSeq += 1;
      const e = {
        id: w.ledgerSeq,
        tick: w.tick,
        minutes: w.minutes,
        clock: this.clockLabel(w.minutes),
        agentId: ev.agentId || null,
        taskId: ev.taskId || null,
        kind: ev.kind || "work",
        action: ev.action || "",
        skill: ev.skill || null,
        tool: ev.tool || null,
        file: ev.file || null,
        lineStart: ev.line && ev.line[0] != null ? ev.line[0] : null,
        lineEnd: ev.line && ev.line[1] != null ? ev.line[1] : null,
        add: ev.add || 0,
        del: ev.del || 0,
        frames: ev.frames || 0,
        checks: (ev.checks || []).slice(),
        diff: ev.diff ? ev.diff.slice() : null,
        note: ev.note || "",
        status: ev.status || "ok",
        agentName: ev.agentName || null,
        runtime: ev.runtime || null,
        provider: ev.provider || null,
        external: !!ev.external,
        externalId: ev.externalId || null,
        tokensIn: Number(ev.tokensIn) || 0,
        tokensOut: Number(ev.tokensOut) || 0,
        cost: Number(ev.cost) || 0,
        durationMs: Number(ev.durationMs) || 0,
        model: ev.model || null
      };
      w.ledger.push(e);
      if (w.ledger.length > 600) w.ledger.shift();

      const agent = e.agentId ? this.agentById(e.agentId) : null;
      if (agent) {
        if (e.skill) {
          agent.skillUse[e.skill] = (agent.skillUse[e.skill] || 0) + 1;
        }
        if (e.file) {
          const f = agent.filesTouched[e.file] || {
            file: e.file, count: 0, add: 0, del: 0,
            lineStart: null, lineEnd: null
          };
          f.count += 1;
          f.add += e.add;
          f.del += e.del;
          if (e.lineStart != null) {
            f.lineStart = f.lineStart == null
              ? e.lineStart : Math.min(f.lineStart, e.lineStart);
            f.lineEnd = f.lineEnd == null
              ? e.lineEnd : Math.max(f.lineEnd, e.lineEnd);
          }
          agent.filesTouched[e.file] = f;
        }
      }
      return e;
    }

    taskEvents(taskId) {
      return this.world.ledger.filter((e) => e.taskId === taskId);
    }

    runWorkStep(agent, task, step) {
      if (!agent || !task || !step) return null;
      const event = this.recordEvent({
        agentId: agent.id,
        taskId: task.id,
        kind: "skill",
        action: step.action,
        skill: step.skill,
        tool: step.tool,
        file: step.file,
        line: step.line,
        add: step.add,
        del: step.del,
        frames: step.frames,
        checks: step.checks,
        diff: step.diff,
        note: step.note
      });
      task.workStep += 1;
      (step.checks || []).forEach((id) => {
        const check = task.checks.find((c) => c.id === id);
        if (check && check.status !== "done") {
          check.status = "done";
          check.note = step.note || ("由 " + this.skillName(step.skill) + " 覆盖");
          check.eventId = event ? event.id : null;
          check.agentId = agent.id;
        }
      });
      agent.bubble = "调用 " + this.skillName(step.skill) + "…";
      agent.bubbleUntil = this.world.tick + 2;
      this.remember(agent, "技能 " + this.skillName(step.skill) + "：" + step.action);
      return event;
    }

    maybeRunWorkStep(agent, task) {
      const plan = task.work || [];
      const step = plan[task.workStep];
      if (!step) return;
      const threshold = Math.min(92, ((task.workStep + 1) / plan.length) * 82);
      if (task.progress >= threshold) this.runWorkStep(agent, task, step);
    }

    finalizeChecks(task, reviewerId) {
      let done = 0;
      let risk = 0;
      let missed = 0;
      task.checks.forEach((c) => {
        if (c.status === "done") {
          done += 1;
        } else if (c.status === "pending") {
          if (c.severity === "high") {
            c.status = "risk";
            c.note = "评审通过但未验证，保留为风险";
            risk += 1;
          } else {
            c.status = "missed";
            c.note = "评审时未覆盖";
            missed += 1;
          }
          if (!c.agentId) c.agentId = task.assignee;
        } else if (c.status === "risk") {
          risk += 1;
        } else if (c.status === "missed") {
          missed += 1;
        }
      });
      return { done, risk, missed, total: task.checks.length };
    }

    audit() {
      const tasks = this.world.tasks;
      const rows = [];
      tasks.forEach((t) => {
        t.checks.forEach((c) => {
          rows.push({
            taskId: t.id,
            taskTitle: t.title,
            taskStatus: t.status,
            role: t.role,
            assignee: t.assignee,
            checkId: c.id,
            label: c.label,
            severity: c.severity,
            status: c.status,
            note: c.note,
            agentId: c.agentId
          });
        });
      });
      const done = rows.filter((r) => r.status === "done");
      const risk = rows.filter((r) => r.status === "risk");
      const missed = rows.filter((r) => r.status === "missed");
      const pending = rows.filter((r) => r.status === "pending");
      const evaluated = done.length + risk.length + missed.length;
      const score = evaluated ? Math.round((done.length / evaluated) * 100) : 0;
      const reworks = tasks.reduce((n, t) => n + t.reworkCount, 0);
      const open = tasks.filter((t) => t.status !== "done");
      const blocked = tasks.filter((t) => t.status === "blocked");
      return {
        rows: rows,
        done: done,
        risk: risk,
        missed: missed,
        pending: pending,
        evaluated: evaluated,
        total: rows.length,
        score: score,
        reworks: reworks,
        open: open,
        blocked: blocked,
        tasks: tasks,
        humanReview: this.world.humanReview
      };
    }

    snapshot() {
      return {
        version: 1,
        savedAt: new Date().toISOString(),
        scenarioId: this.scenarioId,
        speed: this.speed,
        paused: this.paused,
        world: this.world
      };
    }

    restoreSnapshot(snap) {
      if (!snap || snap.version !== 1 || !snap.world) {
        throw new Error("快照格式不兼容");
      }
      const w = snap.world;
      if (!Array.isArray(w.agents) || !Array.isArray(w.tasks)) {
        throw new Error("快照缺少 agents / tasks");
      }
      w.ledger = Array.isArray(w.ledger) ? w.ledger : [];
      w.messages = Array.isArray(w.messages) ? w.messages : [];
      w.history = Array.isArray(w.history) ? w.history : [];
      w.eventsApplied = w.eventsApplied || {};
      w.evalRuns = Array.isArray(w.evalRuns) ? w.evalRuns : [];
      w.humanReview = w.humanReview || null;
      w.runId = w.runId || hex32(hash32(w.scenarioId + "|" + w.goal + "|" + w.tick), 16);
      w.stats = w.stats || { meetings: 0, reviews: 0, approvals: 0, coffees: 0, messages: 0, externalCompletions: 0 };
      w.stats.externalCompletions = Number(w.stats.externalCompletions) || 0;
      w.tick = Number(w.tick) || 0;
      w.minutes = Number(w.minutes) || 9 * 60;
      w.ledgerSeq = Number(w.ledgerSeq) ||
        (w.ledger.length ? w.ledger[w.ledger.length - 1].id : 0);
      w.messageSeq = Number(w.messageSeq) ||
        (w.messages.length ? w.messages[w.messages.length - 1].id : 0);
      w.injected = Number(w.injected) || 0;
      w.done = !!w.done;
      w.tasks.forEach((t) => {
        t.checks = Array.isArray(t.checks) ? t.checks : [];
        t.work = Array.isArray(t.work) ? t.work : [];
        t.workStep = Number(t.workStep) || 0;
        t.reworkCount = Number(t.reworkCount) || 0;
        t.deps = Array.isArray(t.deps) ? t.deps : [];
      });
      w.agents.forEach((a) => {
        a.skills = Array.isArray(a.skills) ? a.skills : [];
        a.skillUse = a.skillUse || {};
        a.filesTouched = a.filesTouched || {};
        a.memory = Array.isArray(a.memory) ? a.memory : [];
      });
      this.world = w;
      w.agents.forEach((a) => {
        if (AO.AGENTS.some((x) => x.id === a.id)) return;
        AO.AGENTS.push({
          id: a.id, name: a.name, role: a.role, deskId: a.deskId,
          skin: a.skin, hair: a.hair, hairStyle: a.hairStyle,
          shirt: a.shirt, accessory: a.accessory, trait: a.trait,
          hired: true
        });
        AO.START_POSITIONS[AO.AGENTS.length - 1] = { x: a.x, y: a.y };
      });
      if (typeof AO.saveHires === "function") AO.saveHires();
      this.scenarioId = w.scenarioId || "launch";
      this.speed = snap.speed || 1;
      this.paused = !!snap.paused;
      this.rng = mulberry32(20261124 + (w.tick || 0));
      return this.world;
    }

    traceMeta(e) {
      if (e.external) {
        return {
          durationMs: Number(e.durationMs) || 180,
          tokensIn: Number(e.tokensIn) || 0,
          tokensOut: Number(e.tokensOut) || 0,
          cost: Number(e.cost) || 0,
          model: e.model || "external-agent"
        };
      }
      const seed = hash32([
        e.id, e.kind, e.action, e.file || "", e.agentId || "", e.taskId || ""
      ].join("|"));
      const agent = e.agentId ? this.agentById(e.agentId) : null;
      let durationMs = 120;
      let tokensIn = 0;
      let tokensOut = 0;
      if (e.kind === "skill") {
        durationMs = 700 + (seed % 2600);
        tokensIn = 320 + (seed % 1300);
        tokensOut = 90 + ((seed >>> 7) % 620);
      } else if (e.kind === "rework") {
        durationMs = 500 + (seed % 1600);
        tokensIn = 260 + (seed % 800);
        tokensOut = 80 + ((seed >>> 6) % 420);
      } else if (e.kind === "review") {
        durationMs = 600 + (seed % 1800);
        tokensIn = 420 + (seed % 900);
        tokensOut = 60 + ((seed >>> 5) % 260);
      } else if (e.kind === "meeting" || e.kind === "decision") {
        durationMs = 2200 + (seed % 2500);
        tokensIn = 500 + (seed % 1400);
        tokensOut = 120 + ((seed >>> 4) % 500);
      } else if (e.kind === "handoff") {
        durationMs = 180 + (seed % 200);
      } else if (e.kind === "claim" || e.kind === "resume") {
        durationMs = 100 + (seed % 120);
      } else if (e.kind === "eval" || e.kind === "human") {
        durationMs = 80 + (seed % 220);
      } else if (e.kind === "risk") {
        durationMs = 220 + (seed % 300);
      }
      const cost = (tokensIn * 3 + tokensOut * 15) / 1000000;
      const model = (tokensIn || tokensOut)
        ? (agent && agent.role === "manager" ? "claude-opus-5-5" : "claude-sonnet-5-5")
        : "agent-runtime";
      return {
        durationMs: durationMs,
        tokensIn: tokensIn,
        tokensOut: tokensOut,
        cost: cost,
        model: model
      };
    }

    traceModel() {
      const w = this.world;
      const eventMax = w.ledger.reduce((m, e) => Math.max(m, e.tick), 0);
      const maxTick = Math.max(
        1,
        w.finishedAt != null ? w.finishedAt : w.tick,
        eventMax
      );
      const events = w.ledger.map((e) => {
        const trace = this.traceMeta(e);
        return Object.assign({}, e, { trace: trace });
      });
      const taskSpans = w.tasks.map((t) => {
        const evs = events.filter((e) => e.taskId === t.id);
        const start = t.startedAt != null ? t.startedAt : maxTick;
        const end = t.completedAt != null ? t.completedAt : maxTick;
        const tokensIn = evs.reduce((n, e) => n + e.trace.tokensIn, 0);
        const tokensOut = evs.reduce((n, e) => n + e.trace.tokensOut, 0);
        const cost = evs.reduce((n, e) => n + e.trace.cost, 0);
        const role = AO.ROLES[t.role] || { color: "#55d6c2" };
        return {
          id: "task:" + t.id,
          type: "task",
          taskId: t.id,
          name: t.id + " · " + t.title,
          agentId: t.assignee,
          start: start,
          end: Math.max(start, end),
          status: t.status,
          color: role.color,
          tokensIn: tokensIn,
          tokensOut: tokensOut,
          cost: cost,
          events: evs
        };
      });
      const tokensIn = events.reduce((n, e) => n + e.trace.tokensIn, 0);
      const tokensOut = events.reduce((n, e) => n + e.trace.tokensOut, 0);
      const cost = events.reduce((n, e) => n + e.trace.cost, 0);
      const toolCalls = events.filter(
        (e) => e.tool && (e.kind === "skill" || e.kind === "rework")
      ).length;
      const errors = events.filter(
        (e) => e.kind === "risk" || e.status === "rejected"
      ).length;
      return {
        maxTick: maxTick,
        events: events,
        taskSpans: taskSpans,
        summary: {
          spanCount: 1 + taskSpans.length + events.length,
          taskCount: w.tasks.length,
          eventCount: events.length,
          toolCalls: toolCalls,
          skillCalls: events.filter((e) => e.skill).length,
          tokensIn: tokensIn,
          tokensOut: tokensOut,
          cost: cost,
          errors: errors,
          durationTicks: maxTick,
          humanDecision: w.humanReview,
          gate: this.releaseGate()
        }
      };
    }

    replayState(cursor) {
      const w = this.world;
      const status = {};
      w.tasks.forEach((t) => { status[t.id] = "backlog"; });
      const agents = {};
      let lastEvent = null;
      w.ledger.forEach((e) => {
        if (e.tick > cursor) return;
        lastEvent = e;
        if (e.taskId) {
          if (e.kind === "claim" || e.kind === "resume") status[e.taskId] = "in_progress";
          else if (e.kind === "handoff") status[e.taskId] = "review";
          else if (e.kind === "complete") status[e.taskId] = "done";
          else if (e.kind === "risk") status[e.taskId] = "blocked";
          else if (e.kind === "review") {
            status[e.taskId] = e.status === "approved" ? "done" : "in_progress";
          } else if (e.kind === "decision") {
            Object.keys(status).forEach((id) => {
              if (status[id] === "blocked") status[id] = "in_progress";
            });
          }
        }
        if (e.agentId) {
          const a = this.agentById(e.agentId);
          agents[e.agentId] = {
            id: e.agentId,
            name: a ? a.name : e.agentId,
            action: e.action,
            kind: e.kind,
            clock: e.clock
          };
        }
      });
      const counts = { done: 0, in_progress: 0, review: 0, blocked: 0, backlog: 0 };
      Object.keys(status).forEach((id) => {
        const s = status[id];
        if (counts[s] != null) counts[s] += 1;
      });
      return {
        tick: cursor,
        clock: this.clockLabel(540 + cursor * 3),
        counts: counts,
        tasks: status,
        agents: agents,
        lastEvent: lastEvent
      };
    }

    evaluate() {
      const w = this.world;
      const audit = this.audit();
      const doneTasks = w.tasks.filter((t) => t.status === "done");
      const totalTasks = w.tasks.length;
      const completionScore = totalTasks
        ? Math.round((doneTasks.length / totalTasks) * 100) : 100;

      let traceOk = 0;
      const traceMissing = [];
      doneTasks.forEach((t) => {
        const evs = w.ledger.filter((e) => e.taskId === t.id);
        const hasClaim = evs.some((e) => e.kind === "claim" || e.kind === "resume");
        const hasSkill = evs.some((e) => e.kind === "skill" || e.kind === "rework");
        const hasHandoff = evs.some((e) => e.kind === "handoff");
        const hasClose = evs.some((e) => e.kind === "review" || e.kind === "complete");
        if (hasClaim && hasSkill && hasHandoff && hasClose) traceOk += 1;
        else traceMissing.push(t.id);
      });
      const traceScore = doneTasks.length
        ? Math.round((traceOk / doneTasks.length) * 100) : 0;

      const engTasks = w.tasks.filter((t) => t.role === "engineer");
      const engOk = engTasks.filter((t) => {
        return w.ledger.some((e) => e.taskId === t.id && e.file &&
          (e.lineStart != null || e.kind === "skill"));
      }).length;
      const codeScore = engTasks.length
        ? Math.round((engOk / engTasks.length) * 100) : 100;

      const reviewed = w.tasks.filter((t) => t.reviewerId && t.assignee);
      const independent = reviewed.filter((t) => t.reviewerId !== t.assignee);
      const reviewScore = reviewed.length
        ? Math.round((independent.length / reviewed.length) * 100) : 100;

      const qualityScore = audit.score;
      const riskPenalty = Math.min(100, audit.risk.length * 12);
      const safetyScore = Math.max(0, 100 - riskPenalty);
      const gate = this.releaseGate();
      const humanScore = gate.key === "approved" || gate.key === "pass"
        ? 100 : gate.key === "rejected" ? 35 : 55;

      const cases = [
        { id: "completion", name: "任务完成率", score: completionScore,
          detail: doneTasks.length + "/" + totalTasks + " 任务完成", evidence: totalTasks },
        { id: "trace", name: "Trace 完整性", score: traceScore,
          detail: traceOk + "/" + doneTasks.length + " 个完成任务具备 claim → skill → handoff → review",
          evidence: traceMissing.length ? "缺少: " + traceMissing.join(", ") : "全部完整" },
        { id: "code", name: "代码证据覆盖", score: codeScore,
          detail: engOk + "/" + engTasks.length + " 个工程任务带文件/行号或 diff 证据",
          evidence: engTasks.length + " 个工程任务" },
        { id: "review", name: "评审独立性", score: reviewScore,
          detail: independent.length + "/" + reviewed.length + " 个评审人独立于作者",
          evidence: reviewed.length + " 个评审" },
        { id: "quality", name: "基础工作质量", score: qualityScore,
          detail: audit.done.length + "/" + audit.total + " 项基础工作覆盖",
          evidence: "风险 " + audit.risk.length + " · 遗漏 " + audit.missed.length },
        { id: "safety", name: "发布安全", score: safetyScore,
          detail: audit.risk.length ? audit.risk.length + " 项高风险未验证" : "无高风险项",
          evidence: "penalty " + riskPenalty },
        { id: "human", name: "人类审批", score: humanScore,
          detail: w.humanReview
            ? "人工决策：" + (w.humanReview.status === "approved" ? "批准例外发布" : "打回")
            : (gate.key === "blocked" ? "等待人工决策" : "无需人工例外"),
          evidence: w.humanReview ? w.humanReview.clock : "—" }
      ];
      cases.forEach((c) => {
        c.status = c.score >= 90 ? "pass" : c.score >= 70 ? "warn" : "fail";
      });
      const overall = cases.length
        ? Math.round(cases.reduce((n, c) => n + c.score, 0) / cases.length) : 0;
      return {
        score: overall,
        cases: cases,
        passed: cases.filter((c) => c.status === "pass").length,
        total: cases.length,
        gate: gate,
        at: w.tick
      };
    }

    runEvals() {
      const result = this.evaluate();
      const lastEval = this.world.evalRuns.length
        ? this.world.evalRuns[this.world.evalRuns.length - 1].id : 0;
      const run = {
        id: (lastEval || 0) + 1,
        tick: this.world.tick,
        clock: this.clockLabel(),
        score: result.score,
        passed: result.passed,
        total: result.total,
        gate: result.gate.key.toUpperCase()
      };
      this.world.evalRuns.push(run);
      if (this.world.evalRuns.length > 40) this.world.evalRuns.shift();
      this.recordEvent({
        kind: "eval",
        action: "运行评测 · " + result.score + "%",
        status: result.score >= 70 ? "ok" : "warn",
        note: result.passed + "/" + result.total + " 项通过 · 门禁 " + result.gate.label
      });
      return result;
    }

    humanDecision(status, note) {
      const w = this.world;
      if (!w.tasks.length || !w.tasks.every((t) => t.status === "done")) return false;
      if (status !== "approved" && status !== "rejected") return false;
      w.humanReview = {
        status: status,
        tick: w.tick,
        minutes: w.minutes,
        clock: this.clockLabel(),
        by: "你",
        note: note || (status === "approved"
          ? "批准带风险发布，缺口进入后续迭代"
          : "打回，要求补齐高风险项")
      };
      this.recordEvent({
        kind: "human",
        action: status === "approved" ? "人工批准例外发布" : "人工打回发布",
        status: status,
        note: w.humanReview.note
      });
      return true;
    }

    releaseGate() {
      const w = this.world;
      if (w.humanReview) {
        return w.humanReview.status === "approved"
          ? { key: "approved", label: "RELEASED · EXCEPTIONS" }
          : { key: "rejected", label: "HUMAN REVIEW · REJECTED" };
      }
      const audit = this.audit();
      if (audit.open.length || audit.risk.length) {
        return { key: "blocked", label: "RELEASE GATE · BLOCKED" };
      }
      if (audit.missed.length) {
        return { key: "conditional", label: "RELEASE GATE · CONDITIONAL" };
      }
      return { key: "pass", label: "RELEASE GATE · PASS" };
    }

    otlp() {
      const w = this.world;
      const model = this.traceModel();
      const traceId = hex32(hash32(w.runId || (w.scenarioId + "|" + w.goal)), 16) +
        hex32(hash32("run:" + (w.runId || w.scenarioId)), 16);
      const base = Date.UTC(2026, 10, 24, 1, 0, 0);
      const nano = (ms) => String(Math.round(ms * 1e6));
      const attr = (key, value) => {
        if (value == null || value === "") return null;
        if (typeof value === "number") {
          return Number.isInteger(value)
            ? { key: key, value: { intValue: String(value) } }
            : { key: key, value: { doubleValue: value } };
        }
        return { key: key, value: { stringValue: String(value) } };
      };
      const spanFromEvent = (e) => {
        const agent = e.agentId ? this.agentById(e.agentId) : null;
        const task = e.taskId ? this.taskById(e.taskId) : null;
        const agentName = agent ? agent.name : (e.agentName || "office");
        const startMs = base + (e.minutes - 540) * 60000 + (e.id % 60) * 1000;
        const operation = (e.kind === "skill" || e.kind === "rework")
          ? "execute_tool" : e.kind === "review" ? "chat" : e.kind;
        const attrs = [
          attr("gen_ai.operation.name", operation),
          attr("gen_ai.agent.name", agentName),
          attr("gen_ai.agent.id", e.agentId),
          attr("agentops.external", e.external ? "true" : null),
          attr("agentops.runtime", e.runtime),
          attr("agentops.provider", e.provider),
          attr("gen_ai.task.id", e.taskId),
          attr("gen_ai.task.name", task ? task.title : null),
          attr("gen_ai.skill.name", e.skill),
          attr("gen_ai.tool.name", e.tool),
          attr("gen_ai.request.model", (e.trace.tokensIn || e.trace.tokensOut) ? e.trace.model : null),
          attr("gen_ai.usage.input_tokens", e.trace.tokensIn || null),
          attr("gen_ai.usage.output_tokens", e.trace.tokensOut || null),
          attr("gen_ai.usage.total_tokens", (e.trace.tokensIn + e.trace.tokensOut) || null),
          attr("gen_ai.usage.cost_usd", e.trace.cost || null),
          attr("code.filepath", e.file),
          attr("code.lineno", e.lineStart),
          attr("code.lines.added", e.add),
          attr("code.lines.removed", e.del),
          attr("openinference.span.kind",
            e.skill || e.tool ? "TOOL" : e.kind === "review" ? "LLM" : "CHAIN"),
          attr("agentops.event.kind", e.kind),
          attr("agentops.event.status", e.status)
        ].filter(Boolean);
        return {
          traceId: traceId,
          spanId: hex32(hash32("event:" + e.id + ":" + e.tick), 16),
          parentSpanId: e.taskId
            ? hex32(hash32("task:" + e.taskId), 16)
            : hex32(hash32("run:" + w.scenarioId), 16),
          name: e.action,
          kind: "SPAN_KIND_INTERNAL",
          startTimeUnixNano: nano(startMs),
          endTimeUnixNano: nano(startMs + e.trace.durationMs),
          attributes: attrs,
          status: {
            code: (e.kind === "risk" || e.status === "rejected" || e.status === "blocked")
              ? "STATUS_CODE_ERROR" : "STATUS_CODE_OK"
          }
        };
      };
      const runStart = base;
      const runEnd = base + (model.maxTick * 3 * 60000);
      const spans = [{
        traceId: traceId,
        spanId: hex32(hash32("run:" + w.scenarioId), 16),
        parentSpanId: "",
        name: "agent-office.run · " + w.scenarioName,
        kind: "SPAN_KIND_INTERNAL",
        startTimeUnixNano: nano(runStart),
        endTimeUnixNano: nano(runEnd),
        attributes: [
          attr("service.name", "agent-office"),
          attr("gen_ai.operation.name", "run"),
          attr("agentops.run.scenario", w.scenarioName),
          attr("agentops.run.goal", w.goal),
          attr("agentops.run.tasks", w.tasks.length),
          attr("agentops.run.events", w.ledger.length),
          attr("agentops.run.gate", this.releaseGate().key)
        ].filter(Boolean),
        status: { code: "STATUS_CODE_OK" }
      }];
      model.taskSpans.forEach((t) => {
        const start = base + t.start * 3 * 60000;
        const end = base + Math.max(t.start, t.end) * 3 * 60000;
        spans.push({
          traceId: traceId,
          spanId: hex32(hash32("task:" + t.taskId), 16),
          parentSpanId: hex32(hash32("run:" + w.scenarioId), 16),
          name: t.name,
          kind: "SPAN_KIND_INTERNAL",
          startTimeUnixNano: nano(start),
          endTimeUnixNano: nano(end),
          attributes: [
            attr("gen_ai.operation.name", "task"),
            attr("gen_ai.task.id", t.taskId),
            attr("agentops.task.status", t.status),
            attr("agentops.task.owner", t.agentId),
            attr("gen_ai.usage.input_tokens", t.tokensIn),
            attr("gen_ai.usage.output_tokens", t.tokensOut),
            attr("gen_ai.usage.total_tokens", t.tokensIn + t.tokensOut),
            attr("gen_ai.usage.cost_usd", t.cost)
          ].filter(Boolean),
          status: { code: t.status === "blocked" ? "STATUS_CODE_ERROR" : "STATUS_CODE_OK" }
        });
      });
      model.events.forEach((e) => spans.push(spanFromEvent(e)));
      return {
        resourceSpans: [{
          resource: {
            attributes: [
              attr("service.name", "agent-office"),
              attr("service.version", "3.0"),
              attr("deployment.environment", "local-simulation")
            ].filter(Boolean)
          },
          scopeSpans: [{
            scope: { name: "agent-office.trace", version: "1.0" },
            spans: spans
          }]
        }]
      };
    }

    rand() {
      return this.rng();
    }

    pick(arr) {
      return arr[Math.floor(this.rand() * arr.length) % arr.length];
    }

    fill(template, vars) {
      return template.replace(/\{(\w+)\}/g, function (m, key) {
        return vars[key] != null ? vars[key] : m;
      });
    }

    agentById(id) {
      return this.world.agents.find((a) => a.id === id);
    }

    taskById(id) {
      return this.world.tasks.find((t) => t.id === id);
    }

    canDelegateTask(task) {
      if (!task) return { ok: false, error: "找不到任务" };
      if (task.status !== "backlog") {
        return { ok: false, error: "只能委托待办任务" };
      }
      const missing = (task.deps || []).filter((id) => {
        const dep = this.taskById(id);
        return dep && dep.status !== "done";
      });
      if (missing.length) {
        return { ok: false, error: "依赖未完成：" + missing.join(", ") };
      }
      return { ok: true };
    }

    delegateTaskToExternal(taskId, agent, assignmentId) {
      const task = this.taskById(taskId);
      if (!task || !agent) return null;
      task.assignee = agent.id;
      task.external = true;
      task.externalName = agent.name;
      task.externalProvider = agent.provider || agent.runtime || "external";
      task.externalAssignmentId = assignmentId || null;
      task.externalStatus = "assigned";
      task.externalResult = "";
      task.externalEvidence = [];
      task.status = "in_progress";
      task.progress = 0;
      task.startedAt = this.world.tick;
      task.completedAt = null;
      task.reviewerId = null;
      task.blockedReason = null;
      return task;
    }

    applyExternalAssignment(assignment, agentMeta) {
      if (!assignment || !assignment.taskId) return null;
      const w = this.world;
      if (assignment.scenarioId && assignment.scenarioId !== this.scenarioId) return null;
      if (assignment.runId && w.runId && assignment.runId !== w.runId) return null;
      const task = this.taskById(assignment.taskId);
      if (!task) return null;
      const name = assignment.agentName || (agentMeta && agentMeta.name) || "External Agent";
      const provider = assignment.provider || (agentMeta && (agentMeta.provider || agentMeta.runtime)) || "external";
      const first = task.externalAssignmentId !== assignment.id;
      task.external = true;
      task.externalAssignmentId = assignment.id;
      task.externalName = name;
      task.externalProvider = provider;
      task.externalStatus = assignment.status || "assigned";
      task.externalResult = assignment.result || "";
      task.externalEvidence = Array.isArray(assignment.evidence) ? assignment.evidence.slice() : [];
      task.assignee = assignment.agentId;
      task.reviewerId = null;

      if (first) {
        task.status = "in_progress";
        task.progress = Math.max(0, Math.min(100, Number(assignment.progress) || 0));
        task.startedAt = w.tick;
        task.completedAt = null;
        task.blockedReason = null;
        this.recordEvent({
          agentId: task.assignee,
          agentName: name,
          runtime: provider,
          provider: provider,
          external: true,
          taskId: task.id,
          kind: "claim",
          action: "外部委托 · " + task.title,
          status: "claimed",
          note: (assignment.brief || task.desc || "").slice(0, 300)
        });
      } else if (task.status !== "done") {
        task.progress = Math.max(0, Math.min(100, Number(assignment.progress) || 0));
      }

      if (assignment.status === "completed") {
        if (task.status !== "done") {
          task.status = "done";
          task.progress = 100;
          task.completedAt = w.tick;
          task.blockedReason = null;
          const summary = this.finalizeExternalChecks(task, assignment);
          w.stats.externalCompletions = (w.stats.externalCompletions || 0) + 1;
          this.recordEvent({
            agentId: task.assignee,
            agentName: name,
            runtime: provider,
            provider: provider,
            external: true,
            taskId: task.id,
            kind: "review",
            action: "外部完成 · 未本地评审 · " + task.title,
            status: "external",
            note: (assignment.result || "外部 Agent 自报完成") +
              " · 基础工作 " + summary.done + "/" + summary.total +
              " · 风险 " + summary.risk + " · 遗漏 " + summary.missed
          });
          this.addMessage(
            "done",
            name + " 外部完成「" + task.title + "」，等待本地审计",
            task.assignee
          );
          this.checkDone();
        }
      } else if (assignment.status === "failed") {
        if (task.status !== "done") {
          task.status = "blocked";
          task.blockedReason = "外部 Agent 失败：" +
            (assignment.result || "未返回原因");
          this.addMessage(
            "alert",
            name + " 外部任务失败「" + task.title + "」",
            task.assignee
          );
        }
      } else if (assignment.status === "cancelled") {
        if (task.status !== "done") {
          task.status = "backlog";
          task.progress = 0;
          task.assignee = null;
          task.external = false;
          task.externalStatus = "cancelled";
          task.externalAssignmentId = null;
          task.externalName = null;
          task.startedAt = null;
          task.blockedReason = null;
        }
      } else if (task.status !== "done") {
        task.status = task.status === "blocked" ? "in_progress" : "in_progress";
        task.progress = Math.max(0, Math.min(100, Number(assignment.progress) || 0));
        task.blockedReason = null;
      }
      return task;
    }

    finalizeExternalChecks(task, assignment) {
      let done = 0;
      let risk = 0;
      let missed = 0;
      (task.checks || []).forEach((check) => {
        if (check.status === "done") {
          done += 1;
          return;
        }
        if (check.severity === "high") {
          check.status = "risk";
          risk += 1;
        } else {
          check.status = "missed";
          missed += 1;
        }
        check.note = "外部 Agent 自报完成，未提供本地验证";
        check.agentId = assignment.agentId;
      });
      return { done, risk, missed, total: (task.checks || []).length };
    }

    deskSeat(agent) {
      const desk = AO.DESKS.find((d) => d.id === agent.deskId) || AO.DESKS[0];
      return { x: desk.x, y: desk.y };
    }

    clockLabel(minutes) {
      const total = minutes == null ? this.world.minutes : minutes;
      const h = Math.floor(total / 60) % 24;
      const m = total % 60;
      return pad2(h) + ":" + pad2(m);
    }

    addMessage(kind, text, agentId, extra) {
      const w = this.world;
      w.messageSeq += 1;
      w.messages.push({
        id: w.messageSeq,
        kind: kind,
        text: text,
        agentId: agentId || null,
        minutes: w.minutes,
        tick: w.tick,
        extra: extra || null
      });
      w.stats.messages = w.messages.length;
      if (w.messages.length > 220) w.messages.shift();
    }

    remember(agent, text) {
      agent.memory.push(this.clockLabel() + " " + text);
      if (agent.memory.length > 8) agent.memory.shift();
    }

    say(agent, lines, opts) {
      if (!agent) return;
      const text = Array.isArray(lines) ? this.pick(lines) : lines;
      agent.bubble = text;
      agent.bubbleUntil = this.world.tick + 3;
      if (opts && opts.feed) {
        this.addMessage(opts.kind || "chat", agent.name + "：" + text, agent.id);
      }
    }

    depsDone(task) {
      return task.deps.every((id) => {
        const dep = this.taskById(id);
        return !dep || dep.status === "done";
      });
    }

    agentOnTask(taskId, exceptId) {
      return this.world.agents.some(
        (a) => a.taskId === taskId && a.id !== exceptId
      );
    }

    safePoint(point) {
      if (!point) return point;
      const base = {
        x: Math.max(30, Math.min(970, point.x)),
        y: Math.max(70, Math.min(590, point.y))
      };
      if (!pointBlocked(base)) return base;
      for (let radius = 10; radius <= 80; radius += 10) {
        for (let i = 0; i < 16; i++) {
          const angle = (Math.PI * 2 * i) / 16;
          const p = {
            x: base.x + Math.cos(angle) * radius,
            y: base.y + Math.sin(angle) * radius
          };
          if (p.x < 30 || p.x > 970 || p.y < 70 || p.y > 590) continue;
          if (!pointBlocked(p)) return p;
        }
      }
      return base;
    }

    goTo(agent, point, pending, intent) {
      if (!point) {
        agent.state = "idle";
        return;
      }
      point = this.safePoint(point);
      if (!pending || pending.type !== "desk") agent.deskTicks = 0;
      if (!pending || pending.type !== "chat") agent.chatTarget = null;
      agent.path = pathFor({ x: agent.x, y: agent.y }, point);
      agent.pending = pending || null;
      agent.state = "walking";
      agent.intent = intent || "";
      agent.activity = intent || "移动中";
      const next = agent.path[0] || point;
      agent.flip = next.x < agent.x;
    }

    step() {
      const w = this.world;
      w.tick += 1;
      w.minutes += 3;

      this.applyEvents();
      if (w.meeting) this.tickMeeting();

      for (let i = 0; i < w.agents.length; i++) this.tickAgent(w.agents[i]);

      this.managerSweep();
      this.checkDone();
      this.watchdog();

      if (w.done) this.celebrationTick();

      const busy = w.agents.filter(function (a) {
        return a.state === "working" || a.state === "reviewing" || a.state === "meeting";
      }).length;
      w.history.push({
        tick: w.tick,
        done: w.tasks.filter(function (t) { return t.status === "done"; }).length,
        busy: busy,
        messages: w.messages.length
      });
      if (w.history.length > 120) w.history.shift();

      return w;
    }

    tickAgent(a) {
      const w = this.world;
      if (a.bubbleUntil <= w.tick) a.bubble = null;

      if (a.state === "walking") {
        this.moveAgent(a);
      } else if (a.state === "working") {
        this.workTick(a);
      } else if (a.state === "reviewing") {
        this.reviewTick(a);
      } else if (a.state === "coffee") {
        this.coffeeTick(a);
      } else if (a.state === "chatting") {
        this.chatTick(a);
      } else if (a.state === "blocked") {
        this.blockedTick(a);
      } else if (a.state === "celebrating") {
        this.celebrateAgentTick(a);
      } else if (a.state === "meeting") {
        const m = w.meeting;
        if (m && m.participants.indexOf(a.id) !== -1) {
          a.activity = "会议：" + m.title;
        } else {
          a.state = "idle";
        }
      } else if (a.state === "idle") {
        if (a.deskTicks > 0) {
          a.deskTicks -= 1;
          a.activity = "在办公室看板";
          return;
        }
        this.decide(a);
      }
    }

    moveAgent(a) {
      if (!a.path.length) {
        this.arrive(a);
        return;
      }
      let budget = a.speed;
      while (budget > 0 && a.path.length) {
        const wp = a.path[0];
        const d = dist(a, wp);
        if (d <= budget) {
          a.x = wp.x;
          a.y = wp.y;
          a.path.shift();
          budget -= d;
        } else {
          a.x += ((wp.x - a.x) / d) * budget;
          a.y += ((wp.y - a.y) / d) * budget;
          budget = 0;
        }
      }
      if (a.path.length) {
        a.flip = a.path[0].x < a.x;
      }
      if (!a.path.length) this.arrive(a);
    }

    arrive(a) {
      const p = a.pending;
      a.pending = null;
      a.state = "idle";

      if (!p) {
        a.activity = "发呆";
        return;
      }

      if (p.type === "work") {
        const task = this.taskById(p.taskId);
        if (!task) return;
        if (task.status === "backlog") {
          task.status = "in_progress";
          task.startedAt = this.world.tick;
        }
        if (task.status !== "in_progress") return;
        a.state = "working";
        a.taskId = task.id;
        a.activity = "正在做：" + task.title;
        this.remember(a, "开始动手：" + task.title);
      } else if (p.type === "review") {
        const task = this.taskById(p.taskId);
        if (!task || task.status !== "review") return;
        a.state = "reviewing";
        a.taskId = task.id;
        a.reviewTicks = 1;
        a.activity = "评审中：" + task.title;
        this.say(a, AO.LINES.reviewStart);
      } else if (p.type === "meeting") {
        a.state = "meeting";
        a.activity = this.world.meeting
          ? "会议：" + this.world.meeting.title
          : "开会中";
        if (this.rand() < 0.3) this.say(a, AO.LINES.meetingJoin);
      } else if (p.type === "coffee") {
        a.state = "coffee";
        a.coffeeTicks = 2;
        a.activity = "咖啡时间";
        this.world.stats.coffees += 1;
      } else if (p.type === "chat") {
        a.state = "chatting";
        a.chatTicks = 1;
        a.chatTarget = p.targetId;
        a.activity = "和同事聊两句";
        this.chatWith(a, p.targetId);
      } else if (p.type === "celebrate") {
        a.state = "celebrating";
        a.celebrateTicks = 0;
        a.activity = "庆祝中";
        this.say(a, AO.LINES.celebrate);
      } else if (p.type === "wander") {
        a.state = "idle";
        a.activity = "四处看看";
      } else if (p.type === "desk") {
        a.state = "idle";
        a.deskTicks = 1 + Math.floor(this.rand() * 2);
        a.activity = "在办公室看板";
        if (this.rand() < 0.35) this.say(a, "先把看板过一遍。");
      }
    }

    decide(a) {
      const w = this.world;
      if (w.done) {
        // Completion is a one-shot celebration, not a terminal pose. Keep the
        // office alive with a mix of celebrating, chatting, coffee and wandering
        // so a finished sprint never looks frozen.
        const roll = this.rand();
        if (roll < 0.28) {
          this.startCelebration(a);
        } else if (roll < 0.53) {
          this.socialize(a);
        } else if (roll < 0.71) {
          this.goCoffee(a);
        } else if (roll < 0.88) {
          this.wander(a);
        } else {
          this.goTo(a, this.deskSeat(a), { type: "desk" }, "回看本轮成果");
        }
        return;
      }

      if (a.energy < 38) {
        this.goCoffee(a);
        return;
      }

      const own = w.tasks.find(
        (t) =>
          t.assignee === a.id &&
          (t.status === "in_progress" || t.status === "backlog") &&
          !this.agentOnTask(t.id, a.id)
      );
      if (own) {
        this.goWork(a, own, true);
        return;
      }

      const review = w.tasks.find(
        (t) =>
          t.status === "review" &&
          t.reviewerId === a.id &&
          !this.agentOnTask(t.id, a.id)
      );
      if (review) {
        this.goReview(a, review);
        return;
      }

      const candidates = w.tasks.filter(
        (t) =>
          t.status === "backlog" &&
          !t.assignee &&
          this.depsDone(t) &&
          t.role === a.role
      );
      if (candidates.length) {
        candidates.sort(
          (x, y) => y.priority - x.priority || x.id.localeCompare(y.id)
        );
        this.goWork(a, candidates[0], false);
        return;
      }

      if (a.role === "manager" && this.rand() < 0.55) {
        this.goTo(a, this.deskSeat(a), { type: "desk" }, "回办公室看板");
        return;
      }

      if (a.role === "manager" && this.rand() < 0.35) {
        this.managerNudge(a);
        return;
      }

      if (this.rand() < 0.52) {
        this.socialize(a);
      } else {
        this.wander(a);
      }
    }

    goWork(a, task, resume) {
      const w = this.world;
      if (!resume) {
        if (task.assignee && task.assignee !== a.id) return;
        task.assignee = a.id;
        this.say(a, this.fill(this.pick(AO.LINES.claim), { task: task.title }));
        this.addMessage(
          "work",
          a.name + " 接下「" + task.title + "」",
          a.id
        );
        this.remember(a, "认领任务：" + task.title);
        this.recordEvent({
          agentId: a.id,
          taskId: task.id,
          kind: "claim",
          action: "认领任务 · " + task.title,
          note: "优先级 P" + task.priority + " · 预计 " + task.effort + " tick · " +
            (task.checks.length ? task.checks.length + " 项基础工作" : "无检查清单")
        });
      } else {
        this.say(a, this.fill(this.pick(AO.LINES.resume), { task: task.title }));
        this.recordEvent({
          agentId: a.id,
          taskId: task.id,
          kind: "resume",
          action: "继续处理 · " + task.title,
          note: task.reworkCount ? "第 " + task.reworkCount + " 次返工后继续" : "恢复未完成任务"
        });
      }
      a.taskId = task.id;
      a.intent = "前往工位：" + task.title;
      this.goTo(a, this.deskSeat(a), { type: "work", taskId: task.id }, "前往工位");
    }

    goReview(a, task) {
      const author = this.agentById(task.assignee);
      const seat = author ? this.deskSeat(author) : this.deskSeat(a);
      const spot = { x: seat.x + 38, y: seat.y + 10 };
      a.taskId = task.id;
      a.intent = "去评审：" + task.title;
      this.addMessage(
        "review",
        a.name + " 开始评审「" + task.title + "」",
        a.id
      );
      this.goTo(a, spot, { type: "review", taskId: task.id }, "前往评审");
    }

    goCoffee(a) {
      if (a.state === "coffee") return;
      a.taskId = null;
      a.intent = "去咖啡机";
      if (this.rand() < 0.55) {
        this.say(a, AO.LINES.coffee);
      }
      this.goTo(a, AO.LAYOUT.anchors.coffee, { type: "coffee" }, "去咖啡机");
    }

    workTick(a) {
      const w = this.world;
      const task = this.taskById(a.taskId);
      if (!task || task.status !== "in_progress") {
        a.state = "idle";
        a.taskId = null;
        a.activity = "找点事做";
        return;
      }

      a.energy = Math.max(0, a.energy - 2.2);
      if (a.energy < 28) {
        this.goCoffee(a);
        return;
      }

      const step = (100 / task.effort) * (1.05 + this.rand() * 0.35);
      task.progress = Math.min(100, task.progress + step);
      a.activity = "正在做：" + task.title;
      this.maybeRunWorkStep(a, task);

      if (task.progress >= 50 && !task._milestone) {
        task._milestone = true;
        this.say(
          a,
          this.fill(this.pick(AO.LINES.milestone), {
            task: task.title,
            p: Math.round(task.progress)
          })
        );
      } else if (w.tick % 3 === 0) {
        this.say(
          a,
          this.fill(this.pick(AO.LINES.work), {
            task: task.title,
            p: Math.round(task.progress)
          })
        );
      }

      if (task.progress >= 100) {
        task.progress = 100;
        while (task.workStep < task.work.length) {
          this.runWorkStep(a, task, task.work[task.workStep]);
        }
        task.status = "review";
        task.reviewerId = this.pickReviewer(task);
        const reviewer = this.agentById(task.reviewerId);
        const covered = task.checks.filter((c) => c.status === "done").length;
        this.recordEvent({
          agentId: a.id,
          taskId: task.id,
          kind: "handoff",
          action: "提交评审 · " + task.title,
          note: "基础工作 " + covered + "/" + task.checks.length +
            " 项已覆盖 · 评审人 " + (reviewer ? reviewer.name : "待定")
        });
        a.taskId = null;
        a.state = "idle";
        a.activity = "刚提交评审";
        this.say(
          a,
          this.fill(this.pick(AO.LINES.reviewAsk), {
            task: task.title,
            to: reviewer ? reviewer.name : "大家"
          })
        );
        this.addMessage(
          "review",
          a.name + " 提交「" + task.title + "」等待评审",
          a.id
        );
        this.remember(a, "提交评审：" + task.title);
      }
    }

    pickReviewer(task) {
      const qa = this.world.agents.find((a) => a.role === "qa");
      const manager = this.world.agents.find((a) => a.role === "manager");
      let person;
      if (task.role === "engineer") {
        person = qa && qa.id !== task.assignee ? qa : manager;
      } else {
        person = manager && manager.id !== task.assignee ? manager : qa;
      }
      return person ? person.id : task.assignee;
    }

    reviewTick(a) {
      const task = this.taskById(a.taskId);
      if (!task || task.status !== "review") {
        a.state = "idle";
        a.taskId = null;
        a.activity = "评审结束";
        return;
      }

      a.reviewTicks -= 1;
      if (a.reviewTicks > 0) {
        if (this.rand() < 0.4) {
          a.bubble = "再看看边界情况…";
          a.bubbleUntil = this.world.tick + 2;
        }
        return;
      }

      const author = this.agentById(task.assignee);
      this.world.stats.reviews += 1;

      if (this.rand() < 0.12) {
        const pending = task.checks.filter((c) => c.status === "pending");
        pending.sort((x, y) => {
          const rank = { high: 0, medium: 1, low: 2 };
          return (rank[x.severity] != null ? rank[x.severity] : 3) - (rank[y.severity] != null ? rank[y.severity] : 3);
        });
        const gap = pending[0] || null;
        task.status = "in_progress";
        task.progress = Math.min(62, Math.max(25, task.progress - 25));
        task.reviewerId = null;
        task._milestone = false;
        task.reworkCount += 1;
        if (gap) {
          gap.status = "done";
          gap.note = "返工补齐（第 " + task.reworkCount + " 次退回）";
          gap.agentId = task.assignee;
        }
        this.recordEvent({
          agentId: a.id,
          taskId: task.id,
          kind: "review",
          action: "退回评审 · " + task.title,
          status: "rejected",
          note: "退回原因：" + (gap ? gap.label : "边界情况需要补") +
            " · 已要求返工"
        });
        const last = task.work[task.work.length - 1];
        const reworkEvent = author ? this.recordEvent({
          agentId: author.id,
          taskId: task.id,
          kind: "rework",
          action: "返工补齐 · " + (gap ? gap.label : "评审意见"),
          skill: last ? last.skill : null,
          tool: last ? last.tool : "edit",
          file: last ? last.file : null,
          line: last && last.line ? [last.line[0] + 2, last.line[1]] : null,
          add: gap ? 6 : 2,
          del: 1,
          checks: gap ? [gap.id] : [],
          diff: gap ? [
            "+ // fix: " + gap.label,
            "+ if (!input) return <EmptyState />;",
            "- // TODO"
          ] : null,
          note: "评审退回：" + (gap ? gap.label : "边界情况需要补")
        }) : null;
        if (gap && reworkEvent) gap.eventId = reworkEvent.id;
        if (author) {
          author.mood = Math.max(0, author.mood - 4);
          this.remember(author, "「" + task.title + "」被退回修改");
        }
        this.say(
          a,
          this.fill(this.pick(AO.LINES.reject), { task: task.title })
        );
        this.addMessage(
          "alert",
          a.name + " 退回「" + task.title + "」：边界情况需要补",
          a.id
        );
        a.state = "idle";
        a.taskId = null;
        a.activity = "刚退回一个任务";
        return;
      }

      task.status = "done";
      task.completedAt = this.world.tick;
      this.world.stats.approvals += 1;
      const summary = this.finalizeChecks(task, a.id);
      this.recordEvent({
        agentId: a.id,
        taskId: task.id,
        kind: "review",
        action: "评审通过 · " + task.title,
        status: "approved",
        note: "基础工作 " + summary.done + "/" + summary.total +
          " · 风险 " + summary.risk + " · 遗漏 " + summary.missed
      });
      this.recordEvent({
        agentId: task.assignee,
        taskId: task.id,
        kind: "complete",
        action: "完成 · " + task.title,
        note: "文件 " + (task.work.filter((s) => s.file).length) +
          " 个 · 技能 " + (task.work.filter((s) => s.skill).length) +
          " 次 · 返工 " + task.reworkCount + " 次"
      });
      if (author) {
        author.mood = Math.min(100, author.mood + 7);
        this.remember(author, "「" + task.title + "」通过评审");
        this.say(
          author,
          this.fill(this.pick(AO.LINES.done), { task: task.title })
        );
      }
      this.say(a, this.fill(this.pick(AO.LINES.approve), { task: task.title }));
      this.addMessage(
        "done",
        a.name + " 通过「" + task.title + "」",
        a.id
      );
      this.remember(a, "通过评审：" + task.title);
      a.state = "idle";
      a.taskId = null;
      a.activity = "刚通过一个评审";
    }

    coffeeTick(a) {
      a.coffeeTicks -= 1;
      a.energy = Math.min(100, a.energy + 24);
      a.mood = Math.min(100, a.mood + 1);
      a.activity = "喝咖啡，回血中";
      if (a.coffeeTicks <= 0) {
        a.state = "idle";
        a.activity = "刚喝完咖啡";
        this.say(a, AO.LINES.coffeeDone);
        this.remember(a, "去咖啡机回了个血");
      }
    }

    chatTick(a) {
      a.chatTicks -= 1;
      a.activity = "和同事聊两句";
      if (a.chatTicks <= 0) {
        a.state = "idle";
        a.chatTarget = null;
        a.activity = "聊完了";
      }
    }

    blockedTick(a) {
      a.blockedTicks += 1;
      a.activity = "被阻塞，等待决策";
      if (a.blockedTicks === 3 && this.rand() < 0.5) {
        this.say(a, "还没人拍板吗…");
      }
      if (a.blockedTicks > 6 && !this.world.meeting && !this.world.done) {
        this.callMeeting("阻塞清除会", "把卡住的问题当场定下来");
      }
      if (!this.world.tasks.some((t) => t.status === "blocked")) {
        a.state = "idle";
        a.blockedTicks = 0;
        a.activity = "阻塞解除";
      }
    }

    celebrateAgentTick(a) {
      a.celebrateTicks += 1;
      a.activity = "庆祝目标达成";
      // Success/celebration is a ONESHOT state: play briefly, then return to
      // the ambient office loop. Never leave every agent on a terminal pose.
      const limit = this.world.done ? 3 : 1;
      if (a.celebrateTicks > limit) {
        a.state = "idle";
        a.celebrateTicks = 0;
        a.activity = this.world.done ? "收工后自由活动" : "回到工位";
      }
    }

    watchdog() {
      const w = this.world;
      if (w.done || w.meeting) return;
      if (w.tick % 8 !== 0) return;
      w.tasks.forEach((task) => {
        if (task.status !== "in_progress") {
          task._watchProgress = null;
          task._watchTick = 0;
          return;
        }
        if (task._watchProgress == null ||
            task.progress > task._watchProgress + 0.01) {
          task._watchProgress = task.progress;
          task._watchTick = w.tick;
          return;
        }
        if (!task._watchTick) task._watchTick = w.tick;
        if (w.tick - task._watchTick < 24) return;
        const owner = w.agents.find((a) => a.id === task.assignee);
        const onTask = w.agents.some((a) => a.taskId === task.id);
        if (owner && !onTask) {
          this.goWork(owner, task, true);
          this.addMessage(
            "alert",
            "任务「" + task.title + "」长时间无进展，已让 " + owner.name + " 继续处理",
            owner.id
          );
          this.recordEvent({
            agentId: owner.id,
            taskId: task.id,
            kind: "recover",
            action: "超时恢复 · " + task.title,
            note: "24 tick 无进度，重新指派给 " + owner.name
          });
        } else if (!onTask) {
          task.status = "backlog";
          task.assignee = null;
          task.progress = Math.max(0, task.progress - 10);
          this.addMessage(
            "alert",
            "任务「" + task.title + "」长时间无进展，已放回看板",
            null
          );
          this.recordEvent({
            taskId: task.id,
            kind: "recover",
            action: "超时回收 · " + task.title,
            note: "24 tick 无进度，重新进入待领取"
          });
        }
        task._watchProgress = task.progress;
        task._watchTick = w.tick;
      });
    }

    socialize(a) {
      a.taskId = null;
      const others = this.world.agents.filter(
        (o) =>
          o.id !== a.id &&
          (o.state === "idle" ||
            o.state === "chatting" ||
            o.state === "celebrating") &&
          !(o.x > 650 && o.x < 950 && o.y > 118 && o.y < 350)
      );
      if (!others.length) {
        this.wander(a);
        return;
      }
      const target = this.pick(others);
      a.intent = "找 " + target.name + " 聊两句";
      this.goTo(
        a,
        { x: target.x + 30, y: target.y + 12 },
        { type: "chat", targetId: target.id },
        "找人聊天"
      );
    }

    chatWith(a, targetId) {
      const other = this.agentById(targetId);
      if (!other) return;
      const line = this.pick(AO.LINES.chat);
      this.say(a, line);
      if (
        this.rand() < 0.35 &&
        other.state !== "meeting" &&
        other.state !== "working"
      ) {
        other.bubble = this.pick([
          "还行，就是有点忙。",
          "我觉得可以。",
          "等我先把这版跑完。",
          "别聊了，看板又红了。"
        ]);
        other.bubbleUntil = this.world.tick + 2;
      }
      if (this.rand() < 0.35) {
        this.addMessage(
          "chat",
          a.name + " 和 " + other.name + " 聊了两句：" + line,
          a.id
        );
      }
      this.remember(a, "和 " + other.name + " 聊了两句");
    }

    wander(a) {
      a.taskId = null;
      const spots = [
        AO.LAYOUT.whiteboardSpot,
        AO.LAYOUT.anchors.window,
        AO.LAYOUT.anchors.chat
      ].concat(AO.LAYOUT.anchors.wander);
      const target = this.pick(spots);
      a.intent = "四处看看";
      this.goTo(a, target, { type: "wander" }, "四处看看");
    }

    managerNudge(manager) {
      const ready = this.world.tasks.filter(
        (t) => t.status === "backlog" && !t.assignee && this.depsDone(t)
      );
      if (!ready.length) {
        this.wander(manager);
        return;
      }
      const task = this.pick(ready);
      const role = AO.ROLES[task.role];
      const text =
        "「" + task.title + "」还空着，" + (role ? role.label : "有人") + "接一下。";
      this.say(manager, text);
      this.addMessage("work", manager.name + "：" + text, manager.id);
      this.wander(manager);
    }

    pickReviewerForBlocked() {
      return this.world.agents.find((a) => a.role === "qa") || this.world.agents[0];
    }

    eventReady(ev) {
      const w = this.world;
      if (w.tick < ev.at) return false;
      if (!ev.when) return true;
      const done = (id) => {
        const t = this.taskById(id);
        return !!t && t.status === "done";
      };
      if (ev.when === "t1done") return done("t1");
      if (ev.when === "t3done") return done("t3");
      if (ev.when === "t6done") return done("t6");
      if (ev.when === "t7done") return done("t7");
      if (ev.when === "engineerActive") {
        return w.tasks.some(
          (t) => t.role === "engineer" && t.status === "in_progress"
        );
      }
      return true;
    }

    applyEvents() {
      const sc = AO.SCENARIOS[this.scenarioId];
      if (!sc) return;
      const w = this.world;
      for (let i = 0; i < sc.events.length; i++) {
        if (w.eventsApplied[i]) continue;
        const ev = sc.events[i];
        if (!this.eventReady(ev)) continue;
        if (w.done) continue;

        if (ev.kind === "blocker") {
          const task = w.tasks.find(
            (t) => t.role === ev.role && t.status === "in_progress"
          );
          if (!task) continue;
          w.eventsApplied[i] = true;
          const owner = this.agentById(task.assignee);
          task.status = "blocked";
          task.blockedReason = ev.text;
          task.progress = Math.max(8, task.progress - 4);
          if (owner) {
            owner.state = "blocked";
            owner.blockedTicks = 0;
            owner.taskId = null;
            owner.path = [];
            owner.pending = null;
            owner.activity = "被阻塞，等待决策";
            this.say(owner, this.fill(this.pick(AO.LINES.blocked), { reason: "接口字段没对齐" }));
            this.remember(owner, "任务被阻塞：" + task.title);
          }
          this.recordEvent({
            agentId: owner ? owner.id : null,
            taskId: task.id,
            kind: "risk",
            action: "阻塞 · " + task.title,
            status: "blocked",
            note: ev.text
          });
          this.addMessage("alert", "⚠ " + ev.text, owner ? owner.id : null);
          const qa = this.world.agents.find((a) => a.role === "qa");
          this.callMeeting("阻塞清除会", ev.text, [
            "a1",
            task.assignee,
            qa ? qa.id : null,
            this.world.agents.find((a) => a.role === "design") ? "a2" : null
          ].filter(Boolean));
          return;
        }

        w.eventsApplied[i] = true;

        if (ev.kind === "say") {
          const agent = this.agentById(ev.agent);
          if (agent) {
            this.say(agent, ev.text, { feed: true, kind: "chat" });
            this.remember(agent, "发言：" + ev.text);
          }
        } else if (ev.kind === "meeting") {
          if (!this.callMeeting(ev.title, ev.agenda, ev.participants)) {
            w.eventsApplied[i] = false;
            return;
          }
        } else if (ev.kind === "newTask") {
          if (!this.taskById(ev.task.id)) {
            w.tasks.push(this.makeTask(ev.task, this.scenarioId, w.tick));
            w.done = false;
            w.humanReview = null;
            this.addMessage("alert", "📌 新任务：" + ev.task.title, null);
            this.addMessage("chat", ev.text, "a1");
            this.recordEvent({
              kind: "inject",
              taskId: ev.task.id,
              action: "插入任务 · " + ev.task.title,
              status: "new",
              note: ev.text
            });
          }
        }
      }
    }

    callMeeting(title, agenda, participantIds) {
      const w = this.world;
      if (w.meeting || w.done) return false;

      let ids = [];
      if (participantIds && participantIds.length) {
        ids = participantIds.filter((id) => {
          const a = this.agentById(id);
          return a && a.state !== "meeting" && a.state !== "reviewing" && a.state !== "coffee";
        });
      }
      if (!ids.length) {
        const manager = w.agents.find((a) => a.role === "manager");
        if (manager) ids.push(manager.id);
        w.agents.forEach((a) => {
          if (ids.length >= 4) return;
          if (ids.indexOf(a.id) !== -1) return;
          if (
            a.state === "working" ||
            a.state === "idle" ||
            a.state === "blocked"
          ) {
            ids.push(a.id);
          }
        });
      }
      if (ids.length < 2) return false;
      if (ids.indexOf("a1") === -1) ids.unshift("a1");
      ids = ids.slice(0, 6);

      const seats = AO.MEETING.seats;
      const participants = [];
      ids.forEach((id, index) => {
        const a = this.agentById(id);
        if (!a) return;
        const seat = seats[index % seats.length];
        if (a.state === "working") {
          a.taskId = null;
          a.activity = "去开会";
        } else if (a.state === "walking") {
          a.pending = null;
        }
        a.state = "walking";
        a.deskTicks = 0;
        a.chatTarget = null;
        a.path = pathFor({ x: a.x, y: a.y }, seat);
        a.pending = { type: "meeting" };
        a.intent = "去开会";
        a.activity = "去开会";
        participants.push(a.id);
      });

      const manager = this.agentById("a1");
      if (manager) this.say(manager, AO.LINES.meetingCall);

      w.meeting = {
        title: title,
        agenda: agenda,
        participants: participants,
        startTick: w.tick,
        endTick: w.tick + 5
      };
      this.addMessage(
        "meeting",
        "会议召集｜" + title + "：" + agenda,
        manager ? manager.id : null
      );
      this.recordEvent({
        agentId: manager ? manager.id : null,
        kind: "meeting",
        action: "召集会议 · " + title,
        status: "open",
        note: agenda + " · 参与：" + participants
          .map((id) => {
            const p = this.agentById(id);
            return p ? p.name : id;
          })
          .join("、")
      });
      return true;
    }

    tickMeeting() {
      const w = this.world;
      const m = w.meeting;
      if (!m) return;
      if (w.tick >= m.endTick) {
        this.concludeMeeting();
        return;
      }
      if (w.tick % 2 === 0) {
        const seated = m.participants
          .map((id) => this.agentById(id))
          .filter((a) => a && a.state === "meeting");
        if (seated.length) {
          const speaker = this.pick(seated);
          const line = this.pick(AO.LINES.meetingLine);
          speaker.bubble = line;
          speaker.bubbleUntil = w.tick + 3;
        }
      }
    }

    concludeMeeting() {
      const w = this.world;
      const m = w.meeting;
      if (!m) return;
      w.meeting = null;
      w.stats.meetings += 1;

      m.participants.forEach((id) => {
        const a = this.agentById(id);
        if (!a) return;
        a.state = "idle";
        a.taskId = null;
        a.path = [];
        a.pending = null;
        a.activity = "刚开完会";
        if (a.id === "a1") {
          a.bubble = this.pick(AO.LINES.meetingEnd);
          a.bubbleUntil = w.tick + 3;
        }
        this.remember(a, "参加会议：" + m.title);
      });

      let resolved = 0;
      w.tasks.forEach((t) => {
        if (t.status === "blocked") {
          t.status = "in_progress";
          t.progress = Math.min(95, t.progress + 8);
          t.blockedReason = null;
          t._milestone = false;
          resolved += 1;
        }
      });

      if (!resolved) {
        w.tasks.forEach((t) => {
          if (t.status === "in_progress") {
            t.progress = Math.min(96, t.progress + 5);
          }
        });
      }

      const decision = this.pick([
        "先跑通主流程，细节后补。",
        "按现有方案继续，风险会后同步。",
        "接口字段由工程侧定稿，设计今晚补图。",
        "止血优先，发布窗口顺延。",
        "不确定的部分先做开关，随时回滚。"
      ]);
      this.addMessage(
        "meeting",
        "会议纪要｜" + m.title + "。结论：" + decision +
          (resolved ? " 阻塞项已解除。" : ""),
        "a1"
      );
      this.recordEvent({
        agentId: "a1",
        kind: "decision",
        action: "会议结论 · " + m.title,
        status: "closed",
        note: decision + (resolved ? " 阻塞项已解除。" : "")
      });
    }

    managerSweep() {
      const w = this.world;
      if (w.done || w.meeting) return;
      if (w.tick > 0 && w.tick % 12 === 0) {
        const done = w.tasks.filter((t) => t.status === "done").length;
        const active = w.tasks.filter((t) => t.status === "in_progress").length;
        const manager = this.agentById("a1");
        if (manager && manager.state !== "meeting" && manager.bubbleUntil <= w.tick) {
          this.say(
            manager,
            "站会：已完成 " + done + "/" + w.tasks.length +
              "，当前 " + active + " 个在跑。"
          );
          this.addMessage(
            "work",
            "站会｜已完成 " + done + "/" + w.tasks.length +
              "，当前 " + active + " 个任务进行中",
            "a1"
          );
        }
      }
    }

    checkDone() {
      const w = this.world;
      if (w.done) return;
      if (!w.tasks.length) return;
      if (!w.tasks.every((t) => t.status === "done")) return;

      const sc = AO.SCENARIOS[this.scenarioId];
      const pendingNewTask = sc.events.some(
        (ev, i) => !w.eventsApplied[i] && ev.kind === "newTask"
      );
      if (pendingNewTask) return;
      this.finish();
    }

    finish() {
      const w = this.world;
      w.done = true;
      w.finishedAt = w.tick;
      const manager = this.agentById("a1");
      this.addMessage(
        "done",
        "🎉 " + w.finishText + "（" + this.clockLabel() + "）",
        manager ? manager.id : null
      );
      if (manager) {
        this.say(manager, "收工。今天没人加班。", { feed: true, kind: "done" });
        this.remember(manager, "目标达成：" + w.goal);
      }
      if (w.meeting) w.meeting = null;
      const audit = this.audit();
      this.recordEvent({
        kind: "milestone",
        action: "目标达成 · " + w.goal,
        status: "done",
        note: "基础工作覆盖 " + audit.done.length + "/" + audit.total +
          " · 风险 " + audit.risk.length + " · 遗漏 " + audit.missed.length +
          " · 返工 " + audit.reworks
      });
      w.agents.forEach((a) => {
        a.state = "idle";
        a.taskId = null;
        a.chatTarget = null;
        a.path = [];
        a.pending = null;
        this.startCelebration(a);
      });
    }

    startCelebration(a) {
      if (a.state === "celebrating") return;
      const spots = [
        AO.LAYOUT.anchors.couch,
        AO.LAYOUT.anchors.chat,
        { x: 660, y: 555 },
        { x: 820, y: 560 },
        { x: 560, y: 545 }
      ];
      const spot = this.pick(spots);
      this.goTo(a, spot, { type: "celebrate" }, "去庆祝");
    }

    celebrationTick() {
      const w = this.world;
      if (w.tick % 4 !== 0) return;
      const agents = w.agents.filter((a) => a.bubbleUntil <= w.tick);
      if (!agents.length) return;
      const a = this.pick(agents);
      this.say(a, AO.LINES.celebrate);
    }

    injectEvent() {
      const w = this.world;
      const pool = [
        { title: "SEO 与分享卡片", role: "manager", effort: 4, priority: 3, text: "市场同学问：分享出去的卡片能好看点吗？" },
        { title: "客户 Logo 墙", role: "design", effort: 4, priority: 2, text: "销售临时要加 8 个客户 logo。" },
        { title: "CDN 证书告警", role: "engineer", effort: 5, priority: 4, text: "监控告警：CDN 证书 2 小时后过期。" },
        { title: "无障碍检查", role: "qa", effort: 5, priority: 3, text: "有人提了 accessibility，顺手查一遍。" }
      ];
      const chosen = pool[Math.floor(this.rand() * pool.length)];
      w.injected += 1;
      const id = "x" + w.injected;
      w.tasks.push(this.makeTask({
        id: id,
        title: chosen.title,
        role: chosen.role,
        effort: chosen.effort,
        priority: chosen.priority,
        deps: [],
        desc: "临时插进来的事"
      }, this.scenarioId, w.tick));
      w.humanReview = null;
      if (w.done) {
        w.done = false;
        w.finishedAt = null;
      }
      this.addMessage("alert", "📌 意外事件：" + chosen.title, null);
      this.addMessage("chat", "林澈：" + chosen.text, "a1");
      this.recordEvent({
        kind: "inject",
        taskId: id,
        action: "意外任务 · " + chosen.title,
        status: "new",
        note: chosen.text
      });
      const manager = this.agentById("a1");
      if (manager) this.say(manager, "又来活了，谁接一下？");
      return chosen;
    }
  }

  AO.Engine = Engine;
})();
