(function () {
  "use strict";

  const AO = window.AgentOffice;
  const ROLE_TO_LOCAL = {
    chief: "manager",
    product: "research",
    design: "design",
    engineer: "engineer",
    qa: "qa"
  };
  const ACTIVE = ["running", "discussing", "queued", "waiting_boss", "scheduled"];

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  class MissionLive {
    constructor(renderer) {
      this.renderer = renderer;
      this.viewport = renderer.viewport;
      this.stage = renderer.stage;
      this.hud = null;
      this.layer = null;
      this.busy = false;
      this.timer = null;
      this.timerTick = null;
      this.activity = null;
      this.lastActive = null;
      this.completedUntil = 0;
      this.lastSignature = "";
      const localHost = ["127.0.0.1", "localhost", "::1"].indexOf(location.hostname) >= 0;
      const customBridge = (function () {
        try { return !!localStorage.getItem("agent-office.bridge-url"); } catch (err) { return false; }
      })();
      this.enabled = localHost || customBridge;
      this.noStream = false;
      try {
        this.noStream = new URLSearchParams(location.search).get("noStream") === "1";
      } catch (err) {}
      this.eventStream = null;
      this.build();
      if (this.enabled) {
        this.poll();
        if (!this.noStream) this.startStream();
        this.timer = window.setInterval(this.poll.bind(this), 2500);
        this.timerTick = window.setInterval(this.renderTimers.bind(this), 1000);
      }
    }

    startStream() {
      if (typeof EventSource === "undefined") return;
      const self = this;
      try {
        this.eventStream = new EventSource(this.bridge() +
          "/missions/stream?since=999999999");
        this.eventStream.addEventListener("overview", function () {
          if (!document.hidden) self.poll();
        });
        this.eventStream.onerror = function () {};
      } catch (err) {}
    }

    build() {
      if (!this.viewport || !this.stage) return;
      this.hud = document.createElement("div");
      this.hud.className = "mission-live-hud";
      this.hud.hidden = true;
      this.hud.addEventListener("click", (event) => {
        if (event.target.closest("[data-mission-live-stop]")) {
          this.stopRun();
          return;
        }
        if (!event.target.closest("[data-mission-live-open]")) return;
        const id = this.activity && this.activity.missionId;
        const pending = (this.activity && this.activity.pendingApprovals) || 0;
        const view = this.renderer.missions;
        if (!id || !view) return;
        Promise.resolve(view.open()).then(function () {
          return view.selectMission(id);
        }).then(function () {
          if (!pending || !view) return;
          view.detailTab = "approvals";
          view.mobileDetail = true;
          view.render();
        }).catch(function () {});
      });
      this.viewport.appendChild(this.hud);

      this.layer = document.createElement("div");
      this.layer.className = "mission-live-layer";
      this.layer.setAttribute("aria-hidden", "true");
      this.layer.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-real-desktop-agent]");
        if (chip) this.renderer.openExternalDrawer(chip.getAttribute("data-real-desktop-agent"));
      });
      this.stage.appendChild(this.layer);
      document.addEventListener("agent-office:demo-change", () => {
        window.setTimeout(() => this.poll(), 120);
      });
    }

    renderRealDesks() {
      if (!this.layer) return;
      const demoOff = AO.DemoMode && !AO.DemoMode.enabled;
      if (!demoOff) {
        this.lastRealDeskSig = "";
        this.layer.innerHTML = "";
        return;
      }
      const agents = (this.renderer.external && this.renderer.external.agents) || [];
      const sig = agents.slice(0, 4).map(function (agent) {
        return [agent.id, agent.name, agent.status, agent.logoText,
          agent.logoColor, agent.avatar].join(":");
      }).join("|");
      if (sig === this.lastRealDeskSig) return;
      this.lastRealDeskSig = sig;
      const hot = AO.DESKS.filter(function (desk) { return desk.hot; });
      const rest = AO.DESKS.filter(function (desk) { return !desk.hot; });
      const anchors = hot.concat(rest).slice(0, 4);
      this.layer.innerHTML = agents.slice(0, anchors.length).map((agent, index) => {
        const anchor = anchors[index];
        const online = agent.status === "online";
        const left = Math.max(10, anchor.x + 38);
        const top = Math.max(70, anchor.y - 52);
        return '<button type="button" class="real-agent-desk ' + (online ? "online" : "") +
          '" data-real-desktop-agent="' + esc(agent.id) + '" style="left:' + left + "px;top:" +
          top + 'px;--c:' + esc(agent.logoColor || "#55d6c2") + '" title="' +
          esc((agent.name || agent.id) + " · " + (online ? "在线" : "离线") + " · 点击查看档案") +
          '"><span class="rad-logo' + AO.logoClass(agent) + '">' + AO.logoMarkHTML(agent) +
          '</span><span class="rad-copy"><b>' + esc(agent.name || agent.id) +
          '</b><em>' + esc(online ? "ONLINE" : "OFFLINE") + '</em></span>' +
          '<i class="rad-dot"></i></button>';
      }).join("");
    }

    bridge() {
      const ext = this.renderer && this.renderer.external;
      return String((ext && ext.bridgeUrl) || AO.BRIDGE_DEFAULT || "")
        .replace(/\/+$/, "");
    }

    async poll() {
      if (this.busy || document.hidden) return;
      this.busy = true;
      try {
        const response = await fetch(this.bridge() + "/missions/overview", {
          cache: "no-store",
          headers: { "Content-Type": "application/json" }
        });
        if (!response.ok) return;
        const data = await response.json();
        this.applyOverview(data);
      } catch (err) {
        // The static demo has no bridge; silently keep the office simulation.
      } finally {
        this.busy = false;
      }
    }

    syncTopbar(data) {
      const pending = (data.approvals || []).filter(function (a) {
        return a && a.status === "pending";
      }).length;
      ["missionBadge", "railWorkBadge"].forEach(function (id) {
        const badge = document.getElementById(id);
        if (!badge) return;
        badge.hidden = pending === 0;
        badge.textContent = pending > 99 ? "99+" : String(pending);
      });
      const quick = document.getElementById("approvalQuickBtn");
      if (quick) {
        quick.hidden = pending === 0;
        const count = quick.querySelector("b");
        if (count) count.textContent = pending > 99 ? "99+" : String(pending);
        quick.title = pending ? pending + " 个待审批，点击打开 Boss Inbox" : "";
      }
      const button = document.getElementById("missionBtn");
      if (button) {
        button.title = pending ? pending + " 个待审批" : "任务中心";
        button.classList.toggle("has-approvals", pending > 0);
      }
      if (this.lastPending != null && pending > this.lastPending && this.renderer) {
        this.renderer.toast(AO.t("missionNewApproval") || "有新的审批待处理");
      }
      this.lastPending = pending;
    }

    localAgent(role) {
      const target = ROLE_TO_LOCAL[role];
      if (!target || !this.renderer || !this.renderer.world) return null;
      return this.renderer.world.agents.find(function (agent) {
        return agent.role === target;
      }) || null;
    }

    applyOverview(data) {
      this.lastOverview = data || null;
      this.syncTopbar(data || {});
      if (AO.DemoMode && AO.DemoMode.refreshCover) AO.DemoMode.refreshCover();
      const demoSafe = !(AO.DemoMode && !AO.DemoMode.enabled);
      if (!demoSafe && this.renderer) {
        this.renderer.renderBoard();
        this.renderer.renderHeader();
        this.renderer.renderRoster();
        if (this.renderer.renderFeed) this.renderer.renderFeed(true);
      }
      const missions = ((data && data.missions) || []).filter(function (m) { return !m.archived; });
      const ranked = missions.filter(function (m) {
        return ACTIVE.indexOf(((m.autoRun || {}).status)) >= 0;
      }).sort(function (a, b) {
        const rank = { running: 0, discussing: 1, waiting_boss: 2, queued: 3 };
        return (rank[(a.autoRun || {}).status] || 9) - (rank[(b.autoRun || {}).status] || 9);
      });
      let mission = ranked[0] || null;
      let transient = false;

      if (!mission && this.lastActive) {
        const finished = missions.find((m) => m.id === this.lastActive.missionId);
        if (finished && (finished.autoRun || {}).status === "done") {
          if (!this.completedUntil) this.completedUntil = Date.now() + 12000;
          if (Date.now() < this.completedUntil) {
            mission = finished;
            transient = true;
          }
        }
      }
      if (!mission && this.completedUntil && Date.now() >= this.completedUntil) {
        this.completedUntil = 0;
        this.lastActive = null;
      }

      if (!mission) {
        if (this.activity) this.clear();
        this.renderRealDesks();
        return;
      }

      const auto = mission.autoRun || {};
      const status = auto.status || "off";
      const member = (mission.members || []).find(function (item) {
        return item.id === auto.currentAgentId;
      }) || null;
      const ext = this.renderer.external && auto.currentAgentId ?
        this.renderer.external.agentById(auto.currentAgentId) : null;
      const agent = ext || member || null;
      const role = auto.currentRole || (member && member.role) || "";
      const total = Number(auto.total || (mission.stats && mission.stats.tasks) || 0);
      const done = Number(auto.completed || (mission.stats && mission.stats.done) || 0);
      const external = !!(ext || (member && member.source === "external"));
      const local = external ? null : this.localAgent(role);
      const item = {
        missionId: mission.id,
        missionTitle: mission.title || "",
        status: status,
        taskId: auto.currentTaskId || "",
        taskTitle: auto.currentTaskTitle || "",
        agentId: auto.currentAgentId || "",
        agentName: (agent && (agent.name || agent.titleZh)) || auto.currentAgentName || "",
        agent: agent,
        external: external,
        localAgentId: local ? local.id : "",
        total: total,
        done: done,
        pendingApprovals: Number((mission.stats && mission.stats.approvals) || 0),
        error: auto.error || "",
        taskStartedAt: auto.currentTaskStartedAt || auto.startedAt || "",
        startedAt: auto.startedAt || "",
        transient: transient
      };
      if (ACTIVE.indexOf(status) >= 0) {
        this.lastActive = item;
        this.completedUntil = 0;
      }
      this.activity = item;
      this.renderAll(item);
    }

    statusLabel(item) {
      const labels = {
        running: AO.t("missionLiveRunning"),
        discussing: AO.t("missionLiveDiscussing"),
        waiting_boss: AO.t("missionLiveWaiting"),
        queued: AO.t("missionLiveQueued"),
        scheduled: AO.t("missionAutoRunScheduled"),
        done: AO.t("missionLiveDone")
      };
      return labels[item.status] || AO.t("missionLiveQueued");
    }

    hint(item) {
      if (item.status === "waiting_boss" || item.pendingApprovals) {
        return AO.t("missionLiveBoss");
      }
      return AO.t("missionLiveNoAction");
    }

    renderAll(item) {
      const sig = [item.missionId, item.status, item.taskId, item.agentId,
        item.done, item.total, item.transient ? "t" : "p"].join("|");
      const changed = sig !== this.lastSignature;
      if (changed) {
        this.lastSignature = sig;
        this.renderHud(item);
        this.renderStage(item);
        this.renderBubbles(item);
        if (this.renderer) {
          this.renderer.missionActivity = item;
          this.renderer.renderRoster();
        }
      } else {
        this.renderBubbles(item);
        this.updateBubblePosition(item);
      }
    }

    renderHud(item) {
      if (!this.hud) return;
      const percent = item.total ? Math.min(100, Math.round((item.done / item.total) * 100)) : 0;
      const logo = item.agent ? AO.logoMarkHTML(item.agent) :
        '<span class="mlh-spinner"></span>';
      const task = item.taskTitle ||
        (item.status === "discussing" ? AO.t("missionLiveDiscussing") :
          item.status === "waiting_boss" ? AO.t("missionLiveWaiting") : "");
      this.hud.hidden = false;
      this.hud.className = "mission-live-hud status-" + item.status;
      this.hud.innerHTML =
        '<div class="mlh-top"><span class="mlh-live"><i></i>MISSION LIVE</span><b>' +
        esc(this.statusLabel(item)) + '</b></div>' +
        '<div class="mlh-row"><span class="mlh-logo' + AO.logoClass(item.agent) + '" style="--c:' +
        esc((item.agent && item.agent.logoColor) || "#55d6c2") + '">' + logo + '</span>' +
        '<div class="mlh-copy"><b>' + esc(item.missionTitle) + '</b><p>' +
        (task ? esc(task) : esc(AO.t("missionAutoRunProgress", {
          done: item.done, total: item.total
        }))) + '</p></div><em class="mlh-count">' + item.done + '/' + item.total + '</em></div>' +
        '<div class="mlh-bar"><i style="width:' + percent + '%"></i></div>' +
        '<div class="mlh-foot"><span class="mlh-hint">' + esc(this.hint(item)) +
        '<em class="mlh-elapsed" data-mlh-elapsed></em></span>' +
        (["running", "discussing", "queued", "scheduled"].indexOf(item.status) >= 0 ?
          '<button type="button" class="mlh-stop" data-mission-live-stop>' +
          esc(AO.t("missionLiveStop")) + '</button>' : '') +
        '<button type="button" data-mission-live-open>' + esc(AO.t("missionLiveOpen")) + '</button></div>';
      this.renderTimers();
    }

    renderStage(item) {
      if (!this.layer) return;
      const external = item.external && item.agent;
      if (!external) {
        this.renderRealDesks();
        return;
      }
      const desk = AO.DESKS.find((d) => d.hot) || { x: 435, y: 230 };
      const left = desk.x + 35;
      const top = Math.max(80, desk.y - 44);
      const logo = AO.logoMarkHTML(item.agent);
      this.layer.innerHTML =
        '<div class="mission-desk-chip status-' + esc(item.status) + '" style="left:' +
        left + 'px;top:' + top + 'px"><span class="mdc-logo' + AO.logoClass(item.agent) +
        '" style="--c:' + esc(item.agent.logoColor || "#b58cff") + '">' + logo + '</span>' +
        '<div class="mdc-copy"><b>' + esc(item.agentName || item.agent.name || "Agent") +
        '</b><em>' + esc(item.taskTitle || this.statusLabel(item)) + '</em></div>' +
        '<span class="mdc-elapsed" data-mlh-elapsed></span>' +
        '<span class="mdc-dots"><i></i><i></i><i></i></span></div>';
      this.renderTimers();
    }

    renderBubbles(item) {
      if (!this.renderer || !this.renderer.charEls) return;
      Object.keys(this.renderer.charEls).forEach((id) => {
        const el = this.renderer.charEls[id];
        const old = el.querySelector(".mission-task-bubble");
        const busy = id === item.localAgentId;
        el.classList.toggle("mission-busy", busy);
        if (!busy) {
          if (old) old.remove();
          return;
        }
        let bubble = old;
        if (!bubble) {
          bubble = document.createElement("div");
          bubble.className = "mission-task-bubble";
          el.appendChild(bubble);
        }
        bubble.innerHTML = '<b>' + esc(item.agentName || "Agent") + '</b><span>' +
          esc(item.taskTitle || this.statusLabel(item)) + '</span>';
      });
    }

    updateBubblePosition() {
      // The bubble is a child of the animated character, so it follows it.
    }

    formatElapsed(ms) {
      const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
      const minutes = Math.floor(total / 60);
      const seconds = total % 60;
      if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        return hours + ":" + String(minutes % 60).padStart(2, "0") +
          ":" + String(seconds).padStart(2, "0");
      }
      return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
    }

    renderTimers() {
      const item = this.activity;
      const active = item && ["running", "discussing", "queued"].indexOf(item.status) >= 0;
      let label = "";
      const startedAt = item && (item.status === "running" ?
        (item.taskStartedAt || item.startedAt) : item.startedAt);
      if (active && startedAt) {
        const started = Date.parse(startedAt);
        if (!Number.isNaN(started)) {
          label = this.formatElapsed(Date.now() - started);
        }
      }
      if (this.hud) {
        this.hud.querySelectorAll("[data-mlh-elapsed]").forEach((node) => {
          node.textContent = label ? "· " + label : "";
          node.hidden = !label;
        });
      }
      if (this.layer) {
        this.layer.querySelectorAll("[data-mlh-elapsed]").forEach((node) => {
          node.textContent = label;
          node.hidden = !label;
        });
      }
    }

    async stopRun() {
      const item = this.activity;
      if (!item || !item.missionId) return;
      const button = this.hud && this.hud.querySelector("[data-mission-live-stop]");
      if (button) {
        button.disabled = true;
        button.textContent = AO.t("missionLiveStopping");
      }
      try {
        const response = await fetch(this.bridge() + "/missions/" +
          encodeURIComponent(item.missionId) + "/autorun/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        if (this.renderer && this.renderer.toast) {
          this.renderer.toast(AO.t("missionLiveStopped"));
        }
        await this.poll();
      } catch (err) {
        if (this.renderer && this.renderer.toast) {
          this.renderer.toast(AO.t("missionLiveStopFailed"));
        }
        if (button) {
          button.disabled = false;
          button.textContent = AO.t("missionLiveStop");
        }
      }
    }

    clear() {
      this.activity = null;
      this.lastSignature = "";
      this.renderer.missionActivity = null;
      if (this.hud) {
        this.hud.hidden = true;
        this.hud.innerHTML = "";
      }
      if (this.layer) this.layer.innerHTML = "";
      if (this.renderer.charEls) {
        Object.keys(this.renderer.charEls).forEach((id) => {
          const el = this.renderer.charEls[id];
          el.classList.remove("mission-busy");
          const bubble = el.querySelector(".mission-task-bubble");
          if (bubble) bubble.remove();
        });
      }
      this.renderer.renderRoster();
    }

    stop() {
      if (this.timer) window.clearInterval(this.timer);
      if (this.timerTick) window.clearInterval(this.timerTick);
      if (this.eventStream) {
        this.eventStream.close();
        this.eventStream = null;
      }
      this.timer = null;
      this.timerTick = null;
    }
  }

  AO.MissionLive = MissionLive;
})();
