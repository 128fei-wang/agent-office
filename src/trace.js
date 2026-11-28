(function () {
  "use strict";

  const AO = window.AgentOffice;

  const ICONS = {
    system: "·", claim: "◈", resume: "↻", skill: "⌘", handoff: "⇄",
    review: "◉", complete: "✓", risk: "!", meeting: "▣", decision: "◇",
    rework: "↺", inject: "＋", milestone: "★", eval: "⌁", human: "⚑",
    external: "⇢", rename: "✎", hire: "＋"
  };

  const FILTERS = [
    ["all", "ALL"],
    ["skill", "TOOL"],
    ["review", "REVIEW"],
    ["risk", "RISK"],
    ["human", "HUMAN"],
    ["external", "EXT"],
    ["eval", "EVAL"]
  ];

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function fileLabel(e) {
    if (!e.file) return "";
    let out = e.file;
    if (e.lineStart != null) {
      out += ":" + e.lineStart;
      if (e.lineEnd != null && e.lineEnd !== e.lineStart) out += "-" + e.lineEnd;
    }
    return out;
  }

  function fmtTokens(n) {
    n = n || 0;
    return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
  }

  function fmtCost(n) {
    n = n || 0;
    if (!n) return "$0";
    return "$" + n.toFixed(n < 0.01 ? 4 : 3);
  }

  function stamp() {
    return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  }

  class TraceLab {
    constructor(engine, renderer) {
      this.engine = engine;
      this.renderer = renderer;
      this.root = document.getElementById("traceLab");
      if (!this.root) {
        this.root = document.createElement("div");
        this.root.id = "traceLab";
        this.root.className = "trace-lab";
        (document.getElementById("app") || document.body).appendChild(this.root);
      }
      this.btn = document.getElementById("traceBtn");
      this.isOpen = false;
      this.tab = "trace";
      this.filter = "all";
      this.query = "";
      this.cursor = 0;
      this.follow = true;
      this.selected = "run";
      this.replayTimer = null;
      this.lastSig = "";
      this.model = null;
      this.buildShell();
      this.bind();
    }

    buildShell() {
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      this.root.setAttribute("aria-modal", "true");
      this.root.setAttribute("role", "dialog");
      this.root.setAttribute("aria-label", "Trace Lab");
      this.root.innerHTML =
        '<div class="tl-shell">' +
          '<header class="tl-head">' +
            '<div class="tl-title"><span>TRACE LAB · DEMO TELEMETRY</span>' +
              '<h2 id="tlTitle">AGENT OFFICE RUN</h2><p id="tlSub">trace loading…</p></div>' +
            '<div class="tl-tabs" role="tablist">' +
              '<button type="button" data-tl-tab="trace" class="active">TRACE</button>' +
              '<button type="button" data-tl-tab="evals">EVALS</button>' +
            '</div>' +
            '<button type="button" class="tl-close" data-tl-close aria-label="关闭">×</button>' +
          '</header>' +
          '<div class="tl-kpis" id="tlKpis"></div>' +
          '<div class="tl-toolbar" id="tlToolbar">' +
            '<div class="tl-search"><input id="tlSearch" type="search" placeholder="搜索 agent / task / file / skill" aria-label="搜索 trace" /></div>' +
            '<div class="tl-filters" id="tlFilters"></div>' +
            '<div class="tl-exports">' +
              '<button type="button" data-tl-export="otlp" class="primary">OTLP JSON</button>' +
              '<button type="button" data-tl-export="json">TRACE JSON</button>' +
            '</div>' +
          '</div>' +
          '<div class="tl-workspace" id="tlWorkspace">' +
            '<aside class="tl-tree-pane"><div class="tl-pane-head"><span>TRACE TREE</span><b id="tlTreeCount">0</b></div><div id="tlTree"></div></aside>' +
            '<section class="tl-water-pane"><div class="tl-pane-head"><span>EXECUTION TIMELINE</span><b id="tlWaterCount">0</b></div><div id="tlWater"></div></section>' +
            '<aside class="tl-detail-pane"><div class="tl-pane-head"><span>SPAN DETAIL</span><b id="tlDetailId">RUN</b></div><div id="tlDetail"></div></aside>' +
          '</div>' +
          '<div class="tl-evals" id="tlEvals" hidden></div>' +
          '<footer class="tl-replay" id="tlReplay">' +
            '<button type="button" data-tl-play>▶ Replay</button>' +
            '<button type="button" data-tl-live>LIVE</button>' +
            '<input id="tlScrub" class="tl-scrub" type="range" min="0" max="1" value="0" step="1" aria-label="Trace replay cursor" />' +
            '<span class="tl-cursor-label" id="tlCursorLabel">tick 0</span>' +
            '<span class="tl-replay-state" id="tlReplayState"></span>' +
          '</footer>' +
        '</div>';
      this.titleEl = this.root.querySelector("#tlTitle");
      this.subEl = this.root.querySelector("#tlSub");
      this.kpisEl = this.root.querySelector("#tlKpis");
      this.toolbarEl = this.root.querySelector("#tlToolbar");
      this.filtersEl = this.root.querySelector("#tlFilters");
      this.searchEl = this.root.querySelector("#tlSearch");
      this.workspaceEl = this.root.querySelector("#tlWorkspace");
      this.treeEl = this.root.querySelector("#tlTree");
      this.treeCountEl = this.root.querySelector("#tlTreeCount");
      this.waterEl = this.root.querySelector("#tlWater");
      this.waterCountEl = this.root.querySelector("#tlWaterCount");
      this.detailEl = this.root.querySelector("#tlDetail");
      this.detailIdEl = this.root.querySelector("#tlDetailId");
      this.evalsEl = this.root.querySelector("#tlEvals");
      this.replayEl = this.root.querySelector("#tlReplay");
      this.scrubEl = this.root.querySelector("#tlScrub");
      this.cursorLabelEl = this.root.querySelector("#tlCursorLabel");
      this.replayStateEl = this.root.querySelector("#tlReplayState");
      this.filtersEl.innerHTML = FILTERS.map(function (f) {
        return '<button type="button" data-tl-filter="' + f[0] + '"' +
          (f[0] === "all" ? ' class="active"' : "") + ">" + f[1] + "</button>";
      }).join("");
    }

    bind() {
      const self = this;
      if (this.btn) {
        this.btn.addEventListener("click", function () { self.toggle(); });
      }
      this.root.addEventListener("click", function (e) {
        if (e.target.closest("[data-tl-close]")) {
          self.close();
          return;
        }
        const tab = e.target.closest("[data-tl-tab]");
        if (tab) {
          self.setTab(tab.getAttribute("data-tl-tab"));
          return;
        }
        const filter = e.target.closest("[data-tl-filter]");
        if (filter) {
          self.filter = filter.getAttribute("data-tl-filter");
          self.render(true);
          return;
        }
        const select = e.target.closest("[data-tl-select]");
        if (select) {
          self.selected = select.getAttribute("data-tl-select");
          self.render(true);
          return;
        }
        if (e.target.closest("[data-tl-play]")) {
          self.toggleReplay();
          return;
        }
        if (e.target.closest("[data-tl-live]")) {
          self.follow = true;
          self.stopReplay();
          self.cursor = self.model ? self.model.maxTick : 0;
          self.render(true);
          return;
        }
        const exportBtn = e.target.closest("[data-tl-export]");
        if (exportBtn) {
          self.exportTrace(exportBtn.getAttribute("data-tl-export"));
          return;
        }
        if (e.target.closest("[data-tl-eval-run]")) {
          self.runEvals();
          return;
        }
        const taskBtn = e.target.closest("[data-tl-open-task]");
        if (taskBtn) {
          self.close();
          self.renderer.openTaskDrawer(taskBtn.getAttribute("data-tl-open-task"));
          return;
        }
        const agentBtn = e.target.closest("[data-tl-open-agent]");
        if (agentBtn) {
          self.close();
          self.renderer.openAgentDrawer(agentBtn.getAttribute("data-tl-open-agent"));
          return;
        }
        const extBtn = e.target.closest("[data-tl-open-external]");
        if (extBtn) {
          self.close();
          self.renderer.openExternalDrawer(extBtn.getAttribute("data-tl-open-external"));
          return;
        }
        if (e.target.closest("[data-tl-open-audit]")) {
          self.close();
          self.renderer.switchBoardView("audit");
        }
      });
      this.searchEl.addEventListener("input", function () {
        self.query = self.searchEl.value.trim();
        self.render(true);
      });
      this.scrubEl.addEventListener("input", function () {
        self.follow = false;
        self.stopReplay();
        self.cursor = Number(self.scrubEl.value) || 0;
        self.render(true);
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && self.isOpen) {
          self.close();
        }
      });
    }

    open() {
      this.isOpen = true;
      this.follow = true;
      this.selected = "run";
      this.root.hidden = false;
      this.root.classList.add("open");
      this.root.setAttribute("aria-hidden", "false");
      document.body.classList.add("trace-open");
      const app = document.getElementById("app");
      if (app) app.inert = true;
      const model = this.engine.traceModel();
      this.cursor = model.maxTick;
      this.lastSig = "";
      this.render(true);
      const close = this.root.querySelector("[data-tl-close]");
      if (close) close.focus({ preventScroll: true });
    }

    close() {
      this.stopReplay();
      this.isOpen = false;
      this.root.hidden = true;
      this.root.classList.remove("open");
      this.root.setAttribute("aria-hidden", "true");
      document.body.classList.remove("trace-open");
      const app = document.getElementById("app");
      if (app) app.inert = false;
      if (this.btn) this.btn.focus({ preventScroll: true });
    }

    toggle() {
      if (this.isOpen) this.close();
      else this.open();
    }

    setTab(tab) {
      this.tab = tab === "evals" ? "evals" : "trace";
      this.root.querySelectorAll("[data-tl-tab]").forEach((b) => {
        const on = b.getAttribute("data-tl-tab") === this.tab;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      this.render(true);
    }

    refresh(force) {
      if (!this.isOpen) return;
      const model = this.engine.traceModel();
      if (this.follow) this.cursor = model.maxTick;
      const sig = [
        model.summary.eventCount, model.summary.taskCount, model.maxTick,
        this.cursor, this.selected, this.filter, this.query, this.tab,
        this.engine.world.evalRuns.length,
        this.engine.world.humanReview ? this.engine.world.humanReview.status : "none",
        model.summary.gate.key
      ].join("|");
      if (!force && sig === this.lastSig) return;
      this.lastSig = sig;
      this.render(false);
    }

    render(force) {
      const model = this.engine.traceModel();
      this.model = model;
      if (this.follow) this.cursor = model.maxTick;
      this.cursor = Math.max(0, Math.min(model.maxTick, this.cursor));
      const gate = model.summary.gate;
      this.titleEl.textContent = "AGENT OFFICE · " + this.engine.world.scenarioName;
      this.subEl.textContent = "RUN " + this.engine.world.scenarioId + " · " +
        model.summary.taskCount + " tasks · " + model.summary.eventCount +
        " events · " + gate.label +
        (model.summary.humanDecision ? " · HUMAN " + model.summary.humanDecision.status.toUpperCase() : "");
      this.renderKpis();
      this.filtersEl.querySelectorAll("[data-tl-filter]").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-tl-filter") === this.filter);
      });
      this.toolbarEl.hidden = this.tab !== "trace";
      this.workspaceEl.hidden = this.tab !== "trace";
      this.replayEl.hidden = this.tab !== "trace";
      this.evalsEl.hidden = this.tab !== "evals";
      if (this.tab === "trace") {
        const treeTop = this.treeEl.scrollTop;
        const waterTop = this.waterEl.scrollTop;
        const detailTop = this.detailEl.scrollTop;
        this.renderTree();
        this.renderWaterfall();
        this.renderDetail();
        this.renderReplay();
        this.treeEl.scrollTop = treeTop;
        this.waterEl.scrollTop = waterTop;
        this.detailEl.scrollTop = detailTop;
      } else {
        this.renderEvals();
      }
      this.lastSig = [
        model.summary.eventCount, model.summary.taskCount, model.maxTick,
        this.cursor, this.selected, this.filter, this.query, this.tab,
        this.engine.world.evalRuns.length,
        this.engine.world.humanReview ? this.engine.world.humanReview.status : "none",
        gate.key
      ].join("|");
    }

    renderKpis() {
      const s = this.model.summary;
      const gate = s.gate;
      const cost = "$" + s.cost.toFixed(s.cost < 0.01 ? 4 : 3);
      this.kpisEl.innerHTML =
        '<div class="tl-kpi"><span>RUN</span><b>' + s.durationTicks + " tick</b><em>" +
          this.engine.clockLabel(540 + s.durationTicks * 3) + "</em></div>" +
        '<div class="tl-kpi"><span>SPANS</span><b>' + s.spanCount + "</b><em>" +
          s.eventCount + " ledger events</em></div>" +
        '<div class="tl-kpi"><span>TOOL CALLS</span><b>' + s.toolCalls + "</b><em>" +
          s.skillCalls + " skill invocations</em></div>" +
        '<div class="tl-kpi"><span>TOKENS</span><b>' + fmtTokens(s.tokensIn) + " / " +
          fmtTokens(s.tokensOut) + "</b><em>in / out · SIM EST.</em></div>" +
        '<div class="tl-kpi"><span>EST. COST</span><b>' + cost +
          "</b><em>simulated model usage</em></div>" +
        '<div class="tl-kpi"><span>ERRORS</span><b class="' +
          (s.errors ? "bad" : "ok") + '">' + s.errors + "</b><em>" + gate.label + "</em></div>";
    }

    matches(e) {
      if (this.filter === "skill" && e.kind !== "skill" && e.kind !== "rework") return false;
      if (this.filter === "review" && e.kind !== "review") return false;
      if (this.filter === "risk" && e.kind !== "risk" && e.status !== "rejected") return false;
      if (this.filter === "human" && e.kind !== "human") return false;
      if (this.filter === "external" && !e.external) return false;
      if (this.filter === "eval" && e.kind !== "eval") return false;
      if (!this.query) return true;
      const agent = e.agentId ? this.engine.agentById(e.agentId) : null;
      const agentName = agent ? agent.name : (e.agentName || "SYSTEM / HUMAN");
      const task = e.taskId ? this.engine.taskById(e.taskId) : null;
      const skill = e.skill && AO.SKILL_CATALOG[e.skill] ? AO.SKILL_CATALOG[e.skill].name : "";
      const hay = [e.action, e.note, e.file, e.tool, skill,
        agent ? agent.name : "", task ? task.title : ""].join(" ").toLowerCase();
      return hay.indexOf(this.query.toLowerCase()) !== -1;
    }

    visibleEvents() {
      return this.model.events.filter((e) => this.matches(e));
    }

    renderTree() {
      const model = this.model;
      const events = this.visibleEvents();
      const runEvents = events.filter((e) => !e.taskId && e.tick <= this.cursor);
      const byTask = {};
      events.forEach((e) => {
        if (!e.taskId || e.tick > this.cursor) return;
        if (!byTask[e.taskId]) byTask[e.taskId] = [];
        byTask[e.taskId].push(e);
      });
      let html = "";
      html += '<button type="button" class="tl-run-row' +
        (this.selected === "run" ? " is-selected" : "") +
        '" data-tl-select="run"><b>RUN · ' + esc(this.engine.world.scenarioName) + "</b><span>" +
        model.maxTick + " tick · " + runEvents.length + " run-level events</span></button>";
      if (runEvents.length) {
        html += '<div class="tl-task-events">';
        runEvents.forEach((e) => {
          html += this.eventRow(e);
        });
        html += "</div>";
      }

      model.taskSpans.slice().sort((a, b) => a.start - b.start || a.taskId.localeCompare(b.taskId)).forEach((span) => {
        const task = this.engine.taskById(span.taskId);
        if (!task) return;
        const evs = byTask[task.id] || [];
        const owner = task.assignee ? this.engine.agentById(task.assignee) : null;
        html += '<div class="tl-task-group"><button type="button" class="tl-task-row' +
          (this.selected === "task:" + task.id ? " is-selected" : "") +
          '" data-tl-select="task:' + task.id + '" style="--c:' + span.color + '">' +
          '<span class="tl-task-dot"></span><span class="tl-task-copy"><b>' +
          esc(task.id + " · " + task.title) + "</b><em>" +
          esc((owner ? owner.name : "待认领") + " · " + (task.status || "backlog")) +
          '</em></span><span class="tl-task-count">' + evs.length + " ev</span></button>";
        if (evs.length) {
          html += '<div class="tl-task-events">';
          evs.forEach((e) => { html += this.eventRow(e); });
          html += "</div>";
        }
        html += "</div>";
      });
      if (!model.taskSpans.length) {
        html += '<div class="tl-tree-empty">还没有任务。</div>';
      }
      this.treeEl.innerHTML = html;
      this.treeCountEl.textContent = events.filter((e) => e.tick <= this.cursor).length + " / " + events.length;
    }

    eventRow(e) {
      const agent = e.agentId ? this.engine.agentById(e.agentId) : null;
      const skill = e.skill && AO.SKILL_CATALOG[e.skill] ? AO.SKILL_CATALOG[e.skill].name : "";
      const meta = [skill, e.tool, fileLabel(e)].filter(Boolean).join(" · ");
      return '<button type="button" class="tl-event-row k-' + e.kind +
        (this.selected === "event:" + e.id ? " is-selected" : "") +
        '" data-tl-select="event:' + e.id + '">' +
        '<span class="tl-event-icon">' + (ICONS[e.kind] || "·") + "</span>" +
        '<span class="tl-event-time">' + e.clock + "</span>" +
        '<span class="tl-event-copy">' + esc(e.action) +
        (meta ? "<em>" + esc(meta) + "</em>" : "") +
        "</span></button>";
    }

    renderWaterfall() {
      const model = this.model;
      const events = this.visibleEvents();
      const max = Math.max(1, model.maxTick);
      const labels = [0, 0.25, 0.5, 0.75, 1].map((p) => {
        const tick = Math.round(max * p);
        const min = 540 + tick * 3;
        return '<span style="left:' + (p * 100) + '%">' + tick + " · " +
          this.engine.clockLabel(min) + "</span>";
      }).join("");
      let html = '<div class="tl-axis">' + labels + '</div><div class="tl-water-rows">';
      const pct = (n) => Math.max(0, Math.min(100, (n / max) * 100));
      const runEvents = events.filter((e) => !e.taskId);
      html += '<div class="tl-water-row"><div class="tl-water-label"><b>RUN</b><em>' +
        this.engine.world.scenarioName + '</em></div><div class="tl-water-track" data-tl-select="run">' +
        '<i class="tl-water-bar" style="left:0;width:' + pct(this.cursor) +
        '%;--c:#55d6c2;opacity:.45"></i>' +
        runEvents.map((e) => this.dot(e, pct)).join("") +
        '<i class="tl-cursor" style="left:' + pct(this.cursor) + '%"></i>' +
        '</div></div>';

      model.taskSpans.slice().sort((a, b) => a.start - b.start || a.taskId.localeCompare(b.taskId)).forEach((span) => {
        const task = this.engine.taskById(span.taskId);
        if (!task) return;
        const owner = task.assignee ? this.engine.agentById(task.assignee) : null;
        const start = span.start;
        const end = Math.min(span.end, this.cursor);
        const width = Math.max(0, pct(end) - pct(start));
        const taskEvents = events.filter((e) => e.taskId === span.taskId);
        html += '<div class="tl-water-row"><div class="tl-water-label"><b>' +
          esc(span.taskId + " · " + task.title) + "</b><em>" +
          esc((owner ? owner.name : "待认领") + " · " + task.status) +
          '</em></div><div class="tl-water-track" data-tl-select="task:' + task.id + '" style="--c:' + span.color + '">' +
          '<i class="tl-water-bar" style="left:' + pct(start) + "%;width:" + width +
          '%;--c:' + span.color + '"></i>' +
          taskEvents.map((e) => this.dot(e, pct)).join("") +
          '<i class="tl-cursor" style="left:' + pct(this.cursor) + '%"></i>' +
          '</div></div>';
      });
      html += "</div>";
      if (!model.taskSpans.length) {
        html = '<div class="tl-water-empty">还没有执行数据。</div>';
      }
      this.waterEl.innerHTML = html;
      this.waterCountEl.textContent = this.cursor + " / " + max + " tick";
    }

    dot(e, pct) {
      return '<button type="button" class="tl-dot k-' + e.kind +
        (this.selected === "event:" + e.id ? " is-selected" : "") +
        (e.tick > this.cursor ? " future" : "") +
        '" style="left:' + pct(e.tick) + '%" data-tl-select="event:' + e.id +
        '" title="' + esc(e.clock + " · " + e.action) + '"></button>';
    }

    renderDetail() {
      const model = this.model;
      const sel = this.selected || "run";
      let html = "";
      if (sel.indexOf("event:") === 0) {
        const id = Number(sel.slice(6));
        const e = model.events.find((x) => x.id === id);
        if (e) html = this.eventDetail(e);
      } else if (sel.indexOf("task:") === 0) {
        const task = this.engine.taskById(sel.slice(5));
        if (task) html = this.taskDetail(task);
      }
      if (!html) html = this.runDetail();
      this.detailEl.innerHTML = html;
      this.detailIdEl.textContent = sel.replace(":", " · ").toUpperCase();
    }

    eventDetail(e) {
      const agent = e.agentId ? this.engine.agentById(e.agentId) : null;
      const agentName = agent ? agent.name : (e.agentName || "SYSTEM / HUMAN");
      const task = e.taskId ? this.engine.taskById(e.taskId) : null;
      const skill = e.skill && AO.SKILL_CATALOG[e.skill] ? AO.SKILL_CATALOG[e.skill].name : "";
      const diff = e.diff && e.diff.length
        ? '<pre class="tl-diff">' + e.diff.map((line) => {
            const cls = line[0] === "+" ? "add" : line[0] === "-" ? "del" : "ctx";
            return '<span class="' + cls + '">' + esc(line) + "</span>";
          }).join("") + "</pre>"
        : "";
      const checks = (e.checks || []).map((id) => {
        const c = task ? task.checks.find((x) => x.id === id) : null;
        return c ? '<div class="tl-check"><b>✓</b><span>' + esc(c.label) + "</span></div>" : "";
      }).join("");
      const statusClass = e.kind === "risk" || e.status === "rejected" || e.status === "blocked"
        ? "bad" : e.kind === "skill" || e.kind === "complete" ? "ok" : "";
      return '<div class="tl-detail-inner"><div class="tl-detail-kicker">EVENT · ' +
        esc(e.kind.toUpperCase()) + "</div><h3>" + esc(e.action) + "</h3>" +
        '<p class="tl-detail-sub">' + e.clock + " · tick " + e.tick + " · " +
        e.trace.durationMs + " ms · " + esc(e.trace.model) + "</p>" +
        '<div class="tl-detail-chips"><span class="tl-chip ' + statusClass + '">' +
        esc(e.status || "ok") + "</span>" +
        (skill ? '<span class="tl-chip cyan">' + esc(skill) + "</span>" : "") +
        (e.tool ? '<span class="tl-chip">' + esc(e.tool) + "</span>" : "") +
        (e.provider ? '<span class="tl-chip violet">PROVIDER · ' + esc(e.provider) + "</span>" : "") +
        (e.external
          ? '<span class="tl-chip violet">EXTERNAL · ' + esc(e.runtime || e.model || "agent") + "</span>"
          : '<span class="tl-chip">SIM TELEMETRY</span>') + "</div>" +
        '<div class="tl-meta">' +
        "<div><span>AGENT</span><b>" + esc(agentName) + "</b></div>" +
        "<div><span>TASK</span><b>" + esc(task ? task.id + " · " + task.title : "—") + "</b></div>" +
        "<div><span>TOKENS</span><b>" + fmtTokens(e.trace.tokensIn) + " / " +
        fmtTokens(e.trace.tokensOut) + "</b></div>" +
        "<div><span>EST. COST</span><b>" + fmtCost(e.trace.cost) + "</b></div>" +
        "</div>" +
        (e.file ? '<div class="tl-detail-section"><h4>EVIDENCE</h4><div class="tl-file-row">' +
          esc(fileLabel(e)) + "<em>+" + e.add + " / −" + e.del + "</em></div>" + diff + "</div>" : "") +
        (checks ? '<div class="tl-detail-section"><h4>CHECKS COVERED</h4>' + checks + "</div>" : "") +
        (e.note ? '<div class="tl-detail-section"><h4>NOTE</h4><p class="tl-detail-note">' +
          esc(e.note) + "</p></div>" : "") +
        '<div class="tl-detail-actions">' +
        (e.taskId ? '<button type="button" data-tl-open-task="' + e.taskId + '">打开任务</button>' : "") +
        (agent ? '<button type="button" data-tl-open-agent="' + e.agentId + '">打开 Agent</button>' : "") +
        (e.external ? '<button type="button" data-tl-open-external="' + e.agentId + '">打开外部 Agent</button>' : "") +
        "</div>" +
        '<details class="tl-raw"><summary>RAW SPAN JSON</summary><pre>' +
        esc(JSON.stringify(e, null, 2)) + "</pre></details></div>";
    }

    taskDetail(task) {
      const events = this.model.events.filter((e) => e.taskId === task.id);
      const owner = task.assignee ? this.engine.agentById(task.assignee) : null;
      const reviewer = task.reviewerId ? this.engine.agentById(task.reviewerId) : null;
      const done = task.checks.filter((c) => c.status === "done").length;
      const risk = task.checks.filter((c) => c.status === "risk").length;
      const missed = task.checks.filter((c) => c.status === "missed").length;
      const files = {};
      events.forEach((e) => { if (e.file) files[e.file] = true; });
      const tokensIn = events.reduce((n, e) => n + e.trace.tokensIn, 0);
      const tokensOut = events.reduce((n, e) => n + e.trace.tokensOut, 0);
      const cost = events.reduce((n, e) => n + e.trace.cost, 0);
      const checkRows = task.checks.map((c) => {
        return '<div class="tl-check ' + c.status + '"><b>' +
          (c.status === "done" ? "✓" : c.status === "risk" ? "!" : c.status === "missed" ? "–" : "○") +
          "</b><span>" + esc(c.label) + "</span></div>";
      }).join("");
      return '<div class="tl-detail-inner"><div class="tl-detail-kicker">TASK SPAN · ' +
        esc(task.id) + "</div><h3>" + esc(task.title) + "</h3>" +
        '<p class="tl-detail-sub">' + esc(task.desc || "") + "</p>" +
        '<div class="tl-detail-chips"><span class="tl-chip ' +
        (task.status === "done" ? "ok" : task.status === "blocked" ? "bad" : "") + '">' +
        esc(task.status) + "</span><span class=\"tl-chip\">" + done + "/" +
        task.checks.length + " checks</span></div>" +
        '<div class="tl-meta">' +
        "<div><span>OWNER</span><b>" + esc(owner ? owner.name : "待认领") + "</b></div>" +
        "<div><span>REVIEWER</span><b>" + esc(reviewer ? reviewer.name : "—") + "</b></div>" +
        "<div><span>CYCLE</span><b>" + (task.startedAt != null && task.completedAt != null
          ? (task.completedAt - task.startedAt) + " tick" : "—") + "</b></div>" +
        "<div><span>REWORKS</span><b>" + task.reworkCount + "</b></div>" +
        "<div><span>TOKENS</span><b>" + fmtTokens(tokensIn) + " / " + fmtTokens(tokensOut) + "</b></div>" +
        "<div><span>EST. COST</span><b>" + fmtCost(cost) + "</b></div>" +
        "</div>" +
        '<div class="tl-detail-section"><h4>BASELINE CHECKS</h4>' + checkRows +
        '<div class="tl-detail-chips" style="margin-top:5px">' +
        (risk ? '<span class="tl-chip bad">' + risk + " risk</span>" : "") +
        (missed ? '<span class="tl-chip warn">' + missed + " missed</span>" : "") +
        "</div></div>" +
        '<div class="tl-detail-section"><h4>FILES</h4>' +
        (Object.keys(files).length
          ? Object.keys(files).map((f) => '<div class="tl-file-row">' + esc(f) + "</div>").join("")
          : '<p class="tl-detail-note">暂无文件证据。</p>') + "</div>" +
        '<div class="tl-detail-section"><h4>EVENTS · ' + events.length + "</h4>" +
        events.slice(-8).reverse().map((e) =>
          '<div class="tl-check"><b>' + (ICONS[e.kind] || "·") + "</b><span>" +
          esc(e.clock + " · " + e.action) + "</span></div>").join("") + "</div>" +
        '<div class="tl-detail-actions"><button type="button" data-tl-open-task="' +
        task.id + '">打开任务抽屉</button></div></div>';
    }

    runDetail() {
      const s = this.model.summary;
      const h = s.humanDecision;
      return '<div class="tl-detail-inner"><div class="tl-detail-kicker">RUN SPAN · ' +
        esc(this.engine.world.scenarioId) + "</div><h3>" +
        esc(this.engine.world.scenarioName) + "</h3>" +
        '<p class="tl-detail-sub">' + esc(this.engine.world.goal) + "</p>" +
        '<div class="tl-detail-chips"><span class="tl-chip ' +
        (s.gate.key === "blocked" || s.gate.key === "rejected" ? "bad" : "ok") + '">' +
        esc(s.gate.label) + "</span><span class=\"tl-chip\">" +
        (h ? "HUMAN " + h.status.toUpperCase() : "NO HUMAN DECISION") + "</span></div>" +
        '<div class="tl-meta">' +
        "<div><span>DURATION</span><b>" + s.durationTicks + " tick</b></div>" +
        "<div><span>SPANS</span><b>" + s.spanCount + "</b></div>" +
        "<div><span>TOOL CALLS</span><b>" + s.toolCalls + "</b></div>" +
        "<div><span>ERRORS</span><b>" + s.errors + "</b></div>" +
        "<div><span>TOKENS</span><b>" + fmtTokens(s.tokensIn) + " / " + fmtTokens(s.tokensOut) + "</b></div>" +
        "<div><span>EST. COST</span><b>" + fmtCost(s.cost) + "</b></div>" +
        "</div>" +
        (h ? '<div class="tl-detail-section"><h4>HUMAN DECISION</h4><p class="tl-detail-note">' +
          esc(h.clock + " · " + (h.status === "approved" ? "批准例外发布" : "打回") + " · " + h.note) +
          "</p></div>" : "") +
        '<div class="tl-detail-section"><h4>READING THE TRACE</h4><p class="tl-detail-note">' +
        "点击左侧事件或时间线圆点查看单条 span；拖动底部 scrub 回放，或点 Replay 自动播放。" +
        "OTLP JSON 可导入 Phoenix / Langfuse 等兼容 OpenTelemetry 的工具。</p></div>" +
        '<div class="tl-detail-actions"><button type="button" data-tl-open-audit>打开审计面板</button></div></div>';
    }

    renderReplay() {
      const max = Math.max(1, this.model.maxTick);
      this.scrubEl.max = String(max);
      this.scrubEl.value = String(this.cursor);
      const st = this.engine.replayState(this.cursor);
      this.cursorLabelEl.textContent = "tick " + this.cursor + " / " + max + " · " + st.clock;
      const last = st.lastEvent;
      const lastText = last
        ? (last.agentId ? (this.engine.agentById(last.agentId) || {}).name || "SYSTEM" : "SYSTEM") +
          " · " + last.action
        : "等待第一条 trace";
      this.replayStateEl.innerHTML = "完成 <b>" + st.counts.done + "</b> · 进行 <b>" +
        st.counts.in_progress + "</b> · 评审 <b>" + st.counts.review + "</b> · 阻塞 <b>" +
        st.counts.blocked + "</b> · " + esc(lastText);
      const playBtn = this.root.querySelector("[data-tl-play]");
      if (playBtn) {
        playBtn.textContent = this.replayTimer ? "❚❚ Pause" : "▶ Replay";
        playBtn.classList.toggle("is-playing", !!this.replayTimer);
      }
    }

    toggleReplay() {
      if (this.replayTimer) {
        this.stopReplay();
        this.render(true);
        return;
      }
      this.follow = false;
      if (this.cursor >= this.model.maxTick) this.cursor = 0;
      const self = this;
      this.replayTimer = window.setInterval(function () {
        self.cursor = Math.min(self.model.maxTick, self.cursor + 1);
        self.render(true);
        if (self.cursor >= self.model.maxTick) {
          self.stopReplay();
          self.render(true);
        }
      }, 120);
      this.render(true);
    }

    stopReplay() {
      if (this.replayTimer) {
        window.clearInterval(this.replayTimer);
        this.replayTimer = null;
      }
    }

    renderEvals() {
      const top = this.evalsEl.scrollTop;
      const result = this.engine.evaluate();
      const history = this.engine.world.evalRuns.slice(-8).reverse();
      const cases = result.cases.map((c) => {
        return '<div class="tl-eval-case ' + c.status + '"><div class="tl-eval-case-top"><b>' +
          esc(c.name) + "</b><span>" + c.score + "</span></div>" +
          '<div class="tl-eval-bar"><i style="width:' + c.score + '%"></i></div>' +
          "<p>" + esc(c.detail) + "</p><em>" + esc(c.evidence) + "</em></div>";
      }).join("");
      const hist = history.length
        ? history.map((r) => '<div class="tl-eval-run-row"><b>#' + r.id + "</b><span>" +
            esc(r.clock) + "</span><span>" + r.score + "%</span><em>" +
            r.passed + "/" + r.total + " · " + r.gate + "</em></div>").join("")
        : '<div class="tl-eval-empty">还没有评测运行。点「RUN EVALS」记录一次。</div>';
      this.evalsEl.innerHTML =
        '<div class="tl-eval-head"><div class="tl-eval-ring" style="--p:' + result.score +
        '"><b>' + result.score + '%</b></div><div class="tl-eval-copy"><h3>Run Evals</h3>' +
        "<p>7 个确定性断言：完成率、Trace 完整性、代码证据、评审独立性、基础工作质量、发布安全、人类审批。</p>" +
        '<span class="tl-chip ' + (result.score >= 90 ? "ok" : result.score >= 70 ? "warn" : "bad") +
        '">' + result.passed + "/" + result.total + " PASS · " + result.gate.label + "</span></div>" +
        '<div class="tl-eval-actions"><button type="button" data-tl-eval-run>RUN EVALS</button>' +
        '<button type="button" data-tl-export="evals">EVALS JSON</button>' +
        '<button type="button" data-tl-open-audit>OPEN AUDIT</button></div></div>' +
        '<div class="tl-eval-grid">' + cases + "</div>" +
        '<div class="tl-eval-history"><h4>RUN HISTORY</h4>' + hist + "</div>";
      this.evalsEl.scrollTop = top;
    }

    runEvals() {
      const result = this.engine.runEvals();
      this.renderer.toast("评测完成 · " + result.score + "% · " +
        result.passed + "/" + result.total + " 通过");
      this.renderer.renderHeader();
      if (this.renderer.boardView === "audit") this.renderer.renderAudit(true);
      this.lastSig = "";
      this.render(true);
    }

    exportTrace(kind) {
      const w = this.engine.world;
      const base = "agent-office-" + w.scenarioId + "-trace-" + stamp();
      if (kind === "otlp") {
        const data = this.engine.otlp();
        this.renderer.downloadFile(base + ".otlp.json", JSON.stringify(data, null, 2),
          "application/json;charset=utf-8");
        this.renderer.toast("OTLP JSON 已导出 · 模拟 span，可用于 Phoenix / Langfuse");
        return;
      }
      if (kind === "evals") {
        const data = {
          generatedAt: new Date().toISOString(),
          scenario: w.scenarioId,
          current: this.engine.evaluate(),
          history: w.evalRuns,
          humanReview: w.humanReview
        };
        this.renderer.downloadFile(base + "-evals.json", JSON.stringify(data, null, 2),
          "application/json;charset=utf-8");
        this.renderer.toast("Evals JSON 已导出");
        return;
      }
      const model = this.engine.traceModel();
      const data = {
        generatedAt: new Date().toISOString(),
        scenario: w.scenarioId,
        scenarioName: w.scenarioName,
        summary: model.summary,
        tasks: w.tasks.map((t) => ({
          id: t.id, title: t.title, role: t.role, status: t.status,
          assignee: t.assignee, reviewerId: t.reviewerId,
          startedAt: t.startedAt, completedAt: t.completedAt,
          reworkCount: t.reworkCount, checks: t.checks
        })),
        events: model.events,
        eval: this.engine.evaluate(),
        evalRuns: w.evalRuns,
        humanReview: w.humanReview
      };
      this.renderer.downloadFile(base + ".trace.json", JSON.stringify(data, null, 2),
        "application/json;charset=utf-8");
      this.renderer.toast("Trace JSON 已导出");
    }
  }

  AO.TraceLab = TraceLab;
})();
