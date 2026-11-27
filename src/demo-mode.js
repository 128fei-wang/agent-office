(function () {
  "use strict";

  const AO = window.AgentOffice;
  const KEY = "agent-office.demo-mode.v1";
  const COVER_KEY = "agent-office.real-cover-dismissed.v1";
  const DEMO_AGENT_ID = "ext-demo-claude";

  function read() {
    try { return localStorage.getItem(KEY) !== "off"; } catch (err) { return true; }
  }

  function readCoverDismissed() {
    try { return localStorage.getItem(COVER_KEY) === "1"; } catch (err) { return false; }
  }

  function writeCoverDismissed(value) {
    try { localStorage.setItem(COVER_KEY, value ? "1" : "0"); } catch (err) {}
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function app() {
    return window.AgentOfficeApp || null;
  }

  function renderer() {
    const root = app();
    return (root && root.renderer) || null;
  }

  function toast(text) {
    const view = renderer();
    if (view && view.toast) view.toast(text);
  }

  function bridge() {
    const view = renderer();
    let stored = "";
    try { stored = localStorage.getItem("agent-office.bridge-url") || ""; } catch (err) {}
    const ext = view && view.external;
    return String((ext && ext.bridgeUrl) || stored || AO.BRIDGE_DEFAULT || "http://127.0.0.1:8787")
      .replace(/\/+$/, "");
  }

  async function api(path, options, timeout) {
    const controller = new AbortController();
    const timer = window.setTimeout(function () { controller.abort(); }, timeout || 8000);
    try {
      const response = await fetch(bridge() + path, Object.assign({
        cache: "no-store",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" }
      }, options || {}));
      let data = {};
      try { data = await response.json(); } catch (err) {}
      if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function externalAgents() {
    const view = renderer();
    const ext = view && view.external;
    return (ext && ext.agents) || [];
  }

  function realCountLabel() {
    const list = externalAgents();
    const online = list.filter(function (agent) { return agent.status === "online"; }).length;
    return { total: list.length, online: online };
  }

  function statusLabel(status) {
    const keys = {
      running: "missionLiveRunning",
      discussing: "missionLiveDiscussing",
      queued: "missionLiveQueued",
      waiting_boss: "missionLiveWaiting",
      done: "missionLiveDone",
      error: "missionAutoRunError",
      stopped: "missionAutoRunStopped",
      off: "missionAutoRunOff"
    };
    return keys[status] ? AO.t(keys[status]) : (status || "");
  }

  function liveHTML() {
    const live = AO.missionLive;
    const overview = live && live.lastOverview;
    const ai = (overview && overview.ai) || null;
    const aiText = ai ? (ai.available ? AO.t("realModeAiReady", { provider: ai.provider || "" }) : AO.t("realModeAiOff")) :
      AO.t("realModeBridgeOffline");
    const aiClass = ai && ai.available ? "ok" : "off";
    let html = '<div class="real-live-head"><span>' + esc(AO.t("realModeActiveMissions")) +
      '</span><em class="' + aiClass + '">' + esc(aiText) + '</em></div>';
    const missions = (overview && overview.missions) || [];
    const active = missions.filter(function (mission) {
      return ["running", "discussing", "queued", "waiting_boss"].indexOf(
        (mission.autoRun || {}).status) >= 0;
    });
    const open = missions.filter(function (mission) {
      return Number((mission.stats || {}).progress || 0) < 100;
    });
    const seen = {};
    const rows = [];
    active.concat(open).forEach(function (mission) {
      if (seen[mission.id] || rows.length >= 2) return;
      seen[mission.id] = true;
      rows.push(mission);
    });
    if (rows.length) {
      html += rows.map(function (mission) {
        const auto = mission.autoRun || {};
        const stats = mission.stats || {};
        return '<button type="button" class="real-cover-mission" data-real-mission="' +
          esc(mission.id) + '"><i class="real-mission-dot ' + esc(auto.status || "off") + '"></i>' +
          '<span><b>' + esc(mission.title || mission.id) + '</b><em>' +
          esc(statusLabel(auto.status || "off")) + ' · ' + Number(stats.progress || 0) + '%</em></span>' +
          '<strong>→</strong></button>';
      }).join("");
    } else {
      html += '<p class="real-live-empty">' + esc(AO.t("realModeNoMissions")) + '</p>';
    }
    return html;
  }

  function agentChip(agent) {
    const online = agent.status === "online";
    return '<span class="real-agent-chip' + (online ? " online" : "") + '">' +
      '<i class="real-agent-logo' + AO.logoClass(agent) + '" style="--c:' +
      esc(agent.logoColor || "#55d6c2") + '">' + AO.logoMarkHTML(agent) + '</i>' +
      '<b>' + esc(agent.name || agent.id || "Agent") + '</b>' +
      '<em>' + esc(online ? AO.t("realModeOnline") : AO.t("realModeOffline")) + '</em></span>';
  }

  const DemoMode = {
    key: KEY,
    demoAgentId: DEMO_AGENT_ID,

    get enabled() {
      return read();
    },

    get coverDismissed() {
      return readCoverDismissed();
    },

    setEnabled(next, options) {
      const enabled = !!next;
      // Turning demo off should land in the real workspace, not a blocking cover.
      writeCoverDismissed(!enabled);
      try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch (err) {}
      this.apply();
      document.dispatchEvent(new CustomEvent("agent-office:demo-change", {
        detail: { enabled: enabled }
      }));
      if (!enabled) {
        this.stopDemoAgent({ silent: !!(options && options.silent) });
      }
      this.refreshCover();
      return enabled;
    },

    noteDismissed: false,

    setCoverDismissed(value, quiet) {
      writeCoverDismissed(!!value);
      this.noteDismissed = false;
      this.refreshCover();
      document.dispatchEvent(new CustomEvent("agent-office:cover-change", {
        detail: { dismissed: !!value }
      }));
      if (!quiet && value) toast(AO.t("realModeCoverClosed"));
    },

    closeCover() {
      this.setCoverDismissed(true);
    },

    openCover() {
      this.setCoverDismissed(false, true);
    },

    toggleCover() {
      this.setCoverDismissed(!this.coverDismissed, this.coverDismissed);
    },

    closeStageNote() {
      this.noteDismissed = true;
      const note = document.getElementById("realStageNote");
      if (note) note.hidden = true;
    },

    apply() {
      const enabled = this.enabled;
      document.documentElement.dataset.demo = enabled ? "on" : "off";
      this.refreshCover();
    },

    refreshCover() {
      const cover = document.getElementById("realModeCover");
      if (!cover) return;
      const enabled = this.enabled;
      document.documentElement.dataset.demo = enabled ? "on" : "off";
      cover.hidden = enabled || this.coverDismissed;
      const note = document.getElementById("realStageNote");
      if (note) note.hidden = enabled || !this.coverDismissed || this.noteDismissed;
      const close = cover.querySelector("[data-real-cover-close]");
      if (close) {
        close.title = AO.t("realModeClosePanelTitle");
        close.setAttribute("aria-label", AO.t("realModeClosePanelTitle"));
      }
      if (enabled || this.coverDismissed) return;
      const list = externalAgents().slice().sort(function (a, b) {
        if (a.status === b.status) return String(a.name || "").localeCompare(String(b.name || ""));
        return a.status === "online" ? -1 : 1;
      });
      const counts = realCountLabel();
      const count = document.getElementById("realModeCount");
      if (count) {
        count.textContent = counts.total + " agents · " + counts.online + " online";
      }
      const agents = document.getElementById("realModeAgents");
      if (agents) {
        agents.innerHTML = list.length ?
          list.slice(0, 8).map(agentChip).join("") :
          '<span class="real-agent-empty">' +
          esc(AO.t("realModeNoAgents")) + '</span>';
      }
      const live = document.getElementById("realModeLive");
      if (live) live.innerHTML = liveHTML();
    },

    async stopDemoAgent(options) {
      const silent = !!(options && options.silent);
      let stopped = false;
      try {
        await api("/demo/stop", { method: "POST" });
        stopped = true;
      } catch (err) {}
      try {
        await api("/agents/" + encodeURIComponent(DEMO_AGENT_ID), { method: "DELETE" });
      } catch (err) {}
      const view = renderer();
      const ext = view && view.external;
      if (ext) {
        const known = (ext.agents || []).some(function (agent) { return agent.id === DEMO_AGENT_ID; }) ||
          (ext.profiles || []).some(function (agent) { return agent.id === DEMO_AGENT_ID; });
        if (known && typeof ext.remove === "function") {
          try { await ext.remove(DEMO_AGENT_ID, true); } catch (err) {}
        } else if (typeof ext.refresh === "function") {
          try { await ext.refresh(); } catch (err) {}
        }
      }
      this.refreshCover();
      if (!silent) {
        toast(stopped ? AO.t("demoAgentCleaned") : AO.t("demoAgentCleanFailed"));
      }
      return stopped;
    },

    async openMissions(id) {
      const view = renderer();
      const missions = view && view.missions;
      if (!missions) return;
      try {
        await missions.open();
        if (id && typeof missions.selectMission === "function") {
          await missions.selectMission(id);
        }
      } catch (err) {}
    },

    async createMission() {
      const view = renderer();
      const missions = view && view.missions;
      if (!missions) return;
      try {
        await missions.open();
        missions.openForm("mission");
      } catch (err) {}
    },

    openExternal() {
      const view = renderer();
      if (view && view.external) view.external.open();
    },

    openAI() {
      if (AO.aiSetup) AO.aiSetup.open();
      else {
        const view = renderer();
        if (view && view.update) view.update.open();
      }
    }
  };

  AO.DemoMode = DemoMode;

  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-real-cover-close]")) {
      DemoMode.closeCover();
      return;
    }
    if (event.target.closest("[data-real-cover-open]")) {
      DemoMode.openCover();
      return;
    }
    if (event.target.closest("[data-real-stage-note-close]")) {
      DemoMode.closeStageNote();
      return;
    }
    const restore = event.target.closest("[data-real-restore]");
    if (restore) {
      DemoMode.setEnabled(true);
      toast(AO.t("demoModeRestored"));
      return;
    }
    const guide = event.target.closest("[data-real-guide]");
    if (guide) {
      const view = renderer();
      if (view && view.features && view.features.guide) view.features.guide.open();
      return;
    }
    const ai = event.target.closest("[data-real-open-ai]");
    if (ai) {
      DemoMode.openAI();
      return;
    }
    const external = event.target.closest("[data-real-open-external]");
    if (external) {
      DemoMode.openExternal();
      return;
    }
    const create = event.target.closest("[data-real-create-mission]");
    if (create) {
      DemoMode.createMission();
      return;
    }
    const mission = event.target.closest("[data-real-mission]");
    if (mission) {
      DemoMode.openMissions(mission.getAttribute("data-real-mission"));
      return;
    }
    if (event.target.closest("[data-real-open-missions]")) {
      DemoMode.openMissions();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    const cover = document.getElementById("realModeCover");
    if (!cover || cover.hidden) return;
    const other = document.querySelector(
      ".feature-modal-root:not([hidden]), .guide-modal-root:not([hidden]), " +
      ".external-modal:not([hidden]), .mission-lab:not([hidden]), " +
      ".update-modal:not([hidden]), .ai-setup-root:not([hidden]), .chat-window, " +
      ".company-lab:not([hidden]), .trace-lab:not([hidden]), #detailDrawer.open"
    );
    if (other) return;
    DemoMode.closeCover();
  });

  document.addEventListener("agent-office:lang", function () {
    DemoMode.refreshCover();
  });

  DemoMode.apply();
})();
