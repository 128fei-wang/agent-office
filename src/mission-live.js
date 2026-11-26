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
  const ACTIVE = ["running", "discussing", "queued", "waiting_boss"];

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
      this.activity = null;
      this.lastActive = null;
      this.completedUntil = 0;
      this.lastSignature = "";
      const localHost = ["127.0.0.1", "localhost", "::1"].indexOf(location.hostname) >= 0;
      const customBridge = (function () {
        try { return !!localStorage.getItem("agent-office.bridge-url"); } catch (err) { return false; }
      })();
      this.enabled = localHost || customBridge;
      this.build();
      if (this.enabled) {
        this.poll();
        this.timer = window.setInterval(this.poll.bind(this), 2500);
      }
    }

    build() {
      if (!this.viewport || !this.stage) return;
      this.hud = document.createElement("div");
      this.hud.className = "mission-live-hud";
      this.hud.hidden = true;
      this.hud.addEventListener("click", (event) => {
        if (!event.target.closest("[data-mission-live-open]")) return;
        const id = this.activity && this.activity.missionId;
        const view = this.renderer.missions;
        if (!id || !view) return;
        Promise.resolve(view.open()).then(function () {
          return view.selectMission(id);
        }).catch(function () {});
      });
      this.viewport.appendChild(this.hud);

      this.layer = document.createElement("div");
      this.layer.className = "mission-live-layer";
      this.layer.setAttribute("aria-hidden", "true");
      this.stage.appendChild(this.layer);
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

    localAgent(role) {
      const target = ROLE_TO_LOCAL[role];
      if (!target || !this.renderer || !this.renderer.world) return null;
      return this.renderer.world.agents.find(function (agent) {
        return agent.role === target;
      }) || null;
    }

    applyOverview(data) {
      const missions = (data && data.missions) || [];
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
        '<div class="mlh-foot"><span>' + esc(this.hint(item)) + '</span>' +
        '<button type="button" data-mission-live-open>' + esc(AO.t("missionLiveOpen")) + '</button></div>';
    }

    renderStage(item) {
      if (!this.layer) return;
      const external = item.external && item.agent;
      if (!external) {
        this.layer.innerHTML = "";
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
        '<span class="mdc-dots"><i></i><i></i><i></i></span></div>';
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
      this.timer = null;
    }
  }

  AO.MissionLive = MissionLive;
})();
