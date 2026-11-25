(function () {
  "use strict";

  const AO = window.AgentOffice;
  const READ_KEY = "agent-office.mission-read.v1";
  const BOSS_GATES = ["spend", "decision", "login", "authorization"];

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value && typeof value === "object" ? value : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {}
  }

  function fmtTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value).slice(11, 19);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return String(date.getHours()).padStart(2, "0") + ":" +
        String(date.getMinutes()).padStart(2, "0");
    }
    return (date.getMonth() + 1) + "/" + date.getDate() + " " +
      String(date.getHours()).padStart(2, "0") + ":" +
      String(date.getMinutes()).padStart(2, "0");
  }

  function fmtSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return value + " B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
    return (value / (1024 * 1024)).toFixed(1) + " MB";
  }

  function initials(name) {
    const text = String(name || "?").trim();
    return text ? text.slice(0, 1).toUpperCase() : "?";
  }

  function short(value, length) {
    const text = String(value || "");
    return text.length > length ? text.slice(0, length) + "…" : text;
  }

  class MissionView {
    constructor(renderer) {
      this.renderer = renderer;
      this.external = renderer ? renderer.external : null;
      this.root = document.getElementById("missionLab");
      this.btn = document.getElementById("missionBtn");
      this.shell = null;
      this.isOpen = false;
      this.data = { missions: [], conversations: [], approvals: [], agents: [], artifacts: [] };
      this.activeType = "";
      this.activeId = "";
      this.mission = null;
      this.conversation = null;
      this.messages = [];
      this.lastSeq = 0;
      this.viewMode = "chat";
      this.sideTab = "missions";
      this.detailTab = "overview";
      this.draft = "";
      this.files = [];
      this.formMode = "";
      this.formFiles = [];
      this.formBusy = false;
      this.uploading = false;
      this.artifactFocus = null;
      this.artifactBusy = false;
      this.mobileDetail = false;
      this.stream = null;
      this.pollTimer = null;
      this.busy = false;
      this.search = "";
      this.unread = readJson(READ_KEY, {});
      this.build();
      this.bind();
    }

    t(key, vars) { return AO.t(key, vars); }
    bridge() { return String((this.external && this.external.bridgeUrl) || AO.BRIDGE_DEFAULT || "").replace(/\/+$/, ""); }

    build() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      this.root.setAttribute("role", "dialog");
      this.root.setAttribute("aria-modal", "true");
      this.root.innerHTML =
        '<div class="mission-backdrop" data-mission-close></div>' +
        '<div class="mission-shell" id="missionShell"></div>';
      this.shell = this.root.querySelector("#missionShell");
    }

    bind() {
      const self = this;
      if (!this.root) return;
      this.root.addEventListener("click", function (event) {
        if (event.target.closest("[data-mission-close]")) { self.close(); return; }
        if (event.target.closest("[data-mission-refresh]")) { self.refreshAll(true); return; }
        if (event.target.closest("[data-mission-lang]")) {
          AO.setLang(AO.lang === "en" ? "zh" : "en", true);
          self.render();
          return;
        }
        const add = event.target.closest("[data-mission-new]");
        if (add) { self.openForm(add.getAttribute("data-mission-new")); return; }
        const tab = event.target.closest("[data-mission-side-tab]");
        if (tab) { self.sideTab = tab.getAttribute("data-mission-side-tab"); self.render(); return; }
        if (event.target.closest("[data-mobile-back]")) {
          self.activeId = ""; self.activeType = ""; self.mission = null;
          self.conversation = null; self.mobileDetail = false; self.render(); return;
        }
        if (event.target.closest("[data-mobile-detail]")) {
          self.mobileDetail = !self.mobileDetail; self.render(); return;
        }
        const mission = event.target.closest("[data-mission-id]");
        if (mission) { self.selectMission(mission.getAttribute("data-mission-id")); return; }
        const conversation = event.target.closest("[data-mission-conv]");
        if (conversation) { self.selectConversation(conversation.getAttribute("data-mission-conv"), conversation.getAttribute("data-conv-kind")); return; }
        if (event.target.closest("[data-mission-approvals]")) {
          self.viewMode = "approvals";
          self.detailTab = "approvals";
          self.render();
          return;
        }
        const detailTab = event.target.closest("[data-detail-tab]");
        if (detailTab) { self.detailTab = detailTab.getAttribute("data-detail-tab"); self.render(); return; }
        const approval = event.target.closest("[data-approval-decision]");
        if (approval) {
          const card = approval.closest(".mission-approval");
          const option = card ? card.querySelector("select") : null;
          const note = card ? card.querySelector('input[type="text"], input:not([type])') : null;
          self.resolveApproval(
            approval.getAttribute("data-approval-decision"),
            approval.getAttribute("data-approval-action"),
            option ? option.value : "",
            note ? note.value : ""
          );
          return;
        }
        const artifact = event.target.closest("[data-artifact-open]");
        if (artifact) { self.openArtifact(artifact.getAttribute("data-artifact-open")); return; }
        if (event.target.closest("[data-artifact-close]")) { self.artifactFocus = null; self.render(); return; }
        if (event.target.closest("[data-artifact-vision]")) { self.recognizeArtifact(); return; }
        const dm = event.target.closest("[data-dm-agent]");
        if (dm) { self.startDm(dm.getAttribute("data-dm-agent")); return; }
        const copy = event.target.closest("[data-copy-protocol]");
        if (copy) { self.copyTaskProtocol(copy.getAttribute("data-copy-protocol")); return; }
        const run = event.target.closest("[data-ai-task]");
        if (run) { self.runTask(run.getAttribute("data-ai-task"), run); return; }
        if (event.target.closest("[data-ai-discuss]")) { self.discuss(); return; }
        const formClose = event.target.closest("[data-mission-form-close]");
        if (formClose) { self.formMode = ""; self.formFiles = []; self.render(); return; }
        const drop = event.target.closest("[data-pending-file-remove]");
        if (drop) {
          const index = Number(drop.getAttribute("data-pending-file-remove"));
          self.files.splice(index, 1);
          self.render();
          return;
        }
        const formDrop = event.target.closest("[data-form-file-remove]");
        if (formDrop) {
          const index = Number(formDrop.getAttribute("data-form-file-remove"));
          self.formFiles.splice(index, 1);
          self.render();
          return;
        }
        const taskTab = event.target.closest("[data-task-open]");
        if (taskTab) { self.detailTab = "tasks"; self.render(); return; }
      });
      this.root.addEventListener("submit", function (event) {
        if (event.target.id === "missionChatForm") { event.preventDefault(); self.sendMessage(); }
        if (event.target.id === "missionCreateForm") { event.preventDefault(); self.submitForm(event.target); }
      });
      this.root.addEventListener("input", function (event) {
        if (event.target.id === "missionDraft") self.draft = event.target.value;
        if (event.target.id === "missionSearch") self.search = event.target.value;
      });
      this.root.addEventListener("change", function (event) {
        if (event.target.id === "missionFileInput") {
          self.files = self.files.concat(Array.from(event.target.files || []));
          self.render();
        }
        if (event.target.id === "missionCreateFiles") {
          self.formFiles = Array.from(event.target.files || []);
          const wrap = self.root.querySelector("#missionCreateFilesList");
          if (wrap) {
            wrap.innerHTML = self.formFiles.map(function (file, index) {
              return '<span class="mission-file-chip">' + esc(file.name) +
                ' <button type="button" data-form-file-remove="' + index + '">×</button></span>';
            }).join("");
          }
        }
      });
      document.addEventListener("keydown", function (event) {
        if (!self.isOpen) return;
        if (event.key === "Escape") {
          if (self.artifactFocus) { self.artifactFocus = null; self.render(); }
          else if (self.formMode) { self.formMode = ""; self.formFiles = []; self.render(); }
          else self.close();
        }
      });
      document.addEventListener("agent-office:lang", function () {
        if (self.isOpen) self.render();
      });
    }

    async api(path, options, timeout) {
      const controller = new AbortController();
      const timer = window.setTimeout(function () { controller.abort(); }, timeout || 12000);
      try {
        const res = await fetch(this.bridge() + path, Object.assign({
          cache: "no-store",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" }
        }, options || {}));
        let data = {};
        try { data = await res.json(); } catch (err) {}
        if (!res.ok) {
          const error = new Error(data.error || ("bridge " + res.status));
          error.code = data.code || "";
          error.status = res.status;
          throw error;
        }
        return data;
      } catch (err) {
        if (err && err.name === "AbortError") {
          const timeoutError = new Error("request timed out");
          timeoutError.code = "timeout";
          throw timeoutError;
        }
        if (err && !err.code) err.code = "network";
        throw err;
      } finally {
        window.clearTimeout(timer);
      }
    }

    async upload(file, missionId, conversationId) {
      const controller = new AbortController();
      const timer = window.setTimeout(function () { controller.abort(); }, 60000);
      try {
        const res = await fetch(this.bridge() + "/files", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Filename": encodeURIComponent(file.name),
            "X-Mime": file.type || "application/octet-stream",
            "X-Mission-Id": missionId || "",
            "X-Conversation-Id": conversationId || "",
            "X-Uploaded-By": "boss"
          },
          body: file
        });
        const data = await res.json();
        if (!res.ok) {
          const error = new Error(data.error || ("upload " + res.status));
          error.code = data.code || "";
          throw error;
        }
        return data.artifact;
      } finally {
        window.clearTimeout(timer);
      }
    }

    async open() {
      if (!this.root) return;
      this.isOpen = true;
      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");
      const app = document.getElementById("app");
      if (app) app.inert = true;
      this.render();
      await this.refreshAll(false);
      this.startStream();
      this.startPoll();
      const close = this.root.querySelector("[data-mission-close]");
      if (close) close.focus({ preventScroll: true });
    }

    close() {
      if (!this.root) return;
      this.isOpen = false;
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      this.formMode = "";
      this.formFiles = [];
      this.artifactFocus = null;
      const app = document.getElementById("app");
      if (app) app.inert = false;
      this.stopStream();
      this.stopPoll();
      if (this.btn) this.btn.focus({ preventScroll: true });
    }

    startStream() {
      this.stopStream();
      if (typeof EventSource === "undefined") return;
      try {
        if (new URLSearchParams(window.location.search).get("noStream") === "1") return;
      } catch (err) {}
      const self = this;
      try {
        this.stream = new EventSource(this.bridge() + "/missions/stream?since=" + this.lastSeq);
        this.stream.addEventListener("message", function (event) {
          try {
            const message = JSON.parse(event.data);
            if (!message || !message.id) return;
            self.lastSeq = Math.max(self.lastSeq, Number(message.seq) || 0);
            if (message.conversationId === (self.conversation && self.conversation.id)) {
              if (self.messages.some((m) => m.id === message.id)) return;
              self.messages.push(message);
              self.appendMessage(message);
              self.markRead();
              self.renderSidebarOnly();
            } else {
              self.refreshOverview();
            }
          } catch (err) {}
        });
        this.stream.onerror = function () {};
      } catch (err) {}
    }

    stopStream() {
      if (this.stream) this.stream.close();
      this.stream = null;
    }

    startPoll() {
      this.stopPoll();
      const self = this;
      this.pollTimer = window.setInterval(function () {
        if (self.isOpen && !self.busy) self.refreshOverview();
      }, 5000);
    }

    stopPoll() {
      if (this.pollTimer) window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    isEditing() {
      const active = document.activeElement;
      return !!(active && this.root.contains(active) &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA"));
    }

    async refreshOverview() {
      try {
        const data = await this.api("/missions/overview", null, 8000);
        const before = JSON.stringify(this.data);
        const beforeMission = JSON.stringify(this.mission);
        this.data = {
          missions: data.missions || [],
          conversations: data.conversations || [],
          approvals: data.approvals || [],
          agents: data.agents || [],
          artifacts: data.artifacts || []
        };
        if (this.activeId && this.activeType === "mission") {
          const detail = await this.api("/missions/" + encodeURIComponent(this.activeId), null, 8000);
          this.mission = detail.mission || null;
        }
        const changed = before !== JSON.stringify(this.data) ||
          beforeMission !== JSON.stringify(this.mission);
        if (changed && !this.formMode && !this.artifactFocus) {
          if (this.isEditing()) this.renderSidebarOnly();
          else this.render();
        }
      } catch (err) {}
    }

    async refreshAll(showToast) {
      if (this.busy) return;
      this.busy = true;
      try {
        const data = await this.api("/missions/overview", null, 10000);
        this.data = {
          missions: data.missions || [],
          conversations: data.conversations || [],
          approvals: data.approvals || [],
          agents: data.agents || [],
          artifacts: data.artifacts || []
        };
        if (!this.activeId) {
          if (this.data.missions.length) {
            this.activeType = "mission";
            this.activeId = this.data.missions[0].id;
          } else if (this.data.conversations.length) {
            this.activeType = this.data.conversations[0].kind;
            this.activeId = this.data.conversations[0].id;
          }
        }
        await this.loadActive();
        this.render();
        if (showToast) this.toast(this.t("missionRefreshed"));
      } catch (err) {
        this.toast(this.t("missionBridgeOffline"));
        this.render();
      } finally {
        this.busy = false;
      }
    }

    async loadActive() {
      this.mission = null;
      this.conversation = null;
      this.messages = [];
      if (!this.activeId) return;
      try {
        if (this.activeType === "mission") {
          const detail = await this.api("/missions/" + encodeURIComponent(this.activeId), null, 10000);
          this.mission = detail.mission || null;
          if (!this.mission) { this.activeId = ""; return; }
          this.activeId = this.mission.id;
          const conv = await this.api("/conversations/" + encodeURIComponent(this.mission.conversationId));
          this.conversation = conv.conversation || null;
        } else {
          const conv = await this.api("/conversations/" + encodeURIComponent(this.activeId));
          this.conversation = conv.conversation || null;
          this.mission = this.data.missions.find(function (m) {
            return m.conversationId === (conv.conversation || {}).id;
          }) || null;
        }
        if (this.conversation) {
          const data = await this.api("/conversations/" + encodeURIComponent(this.conversation.id) +
            "/messages?since=0");
          this.messages = data.messages || [];
          this.lastSeq = Math.max(this.lastSeq, ...this.messages.map(function (m) {
            return Number(m.seq) || 0;
          }), Number(data.lastSeq) || 0);
          this.markRead();
        }
      } catch (err) {}
    }

    async selectMission(id) {
      this.activeType = "mission";
      this.activeId = id;
      this.viewMode = "chat";
      this.detailTab = "overview";
      this.mission = this.data.missions.find(function (m) { return m.id === id; }) || null;
      this.messages = [];
      this.draft = "";
      this.files = [];
      await this.loadActive();
      this.render();
      this.startStream();
    }

    async selectConversation(id, kind) {
      this.activeType = kind || "group";
      this.activeId = id;
      this.viewMode = "chat";
      this.mission = null;
      this.messages = [];
      this.draft = "";
      this.files = [];
      await this.loadActive();
      this.render();
      this.startStream();
    }

    markRead() {
      if (!this.conversation) return;
      this.unread[this.conversation.id] = Date.now();
      writeJson(READ_KEY, this.unread);
    }

    unreadFor(conversation) {
      if (!conversation || !conversation.lastMessage) return false;
      const readAt = Number(this.unread[conversation.id] || 0);
      const at = new Date(conversation.lastMessage.createdAt || 0).getTime();
      return at > readAt && conversation.id !== (this.conversation && this.conversation.id);
    }

    toast(text) {
      if (this.renderer && this.renderer.toast) this.renderer.toast(text);
    }

    agentById(id) {
      return (this.data.agents || []).find((a) => a.id === id) ||
        ((this.mission && this.mission.members) || []).find((a) => a.id === id) || null;
    }

    agentName(agent) {
      if (!agent) return "";
      return AO.lang === "en" ? (agent.titleEn || agent.name || agent.id)
        : (agent.titleZh || agent.name || agent.id);
    }

    missionStatus(mission) {
      if (!mission) return "";
      if (mission.status === "done") return this.t("missionDone");
      if (mission.status === "review") return this.t("statusReview");
      if (mission.stats && mission.stats.blocked) return this.t("missionBlocked");
      if (mission.stats && mission.stats.approvals) return this.t("missionWaitingBoss");
      if (mission.stats && mission.stats.progress > 0) return this.t("missionActive");
      return this.t("missionActive");
    }

    taskStatus(status) {
      const map = {
        queued: "missionQueued", assigned: "taskAssigned", in_progress: "taskInProgress",
        review: "statusReview", blocked: "statusBlocked", done: "taskCompleted"
      };
      return this.t(map[status] || "taskAssigned");
    }

    taskClass(status) {
      return "is-" + String(status || "assigned").replace(/_/g, "-");
    }

    approvalType(type) {
      const map = {
        spend: "bossGateSpend", decision: "bossGateDecision",
        login: "bossGateLogin", authorization: "bossGateAuthorization"
      };
      return this.t(map[type] || type);
    }

    approveBadge() {
      const count = (this.data.approvals || []).length;
      return '<button class="mission-head-btn approval" type="button" data-mission-approvals>' +
        esc(this.t("missionBossInbox")) +
        (count ? '<b>' + count + '</b>' : "") + '</button>';
    }

    render() {
      if (!this.shell) return;
      const activeTitle = this.mission ? this.mission.title :
        (this.conversation ? this.conversation.title : "");
      this.shell.classList.toggle("has-active", !!this.conversation);
      this.shell.classList.toggle("detail-open", !!this.mobileDetail);
      this.shell.innerHTML =
        '<header class="mission-head">' +
        '<div class="mission-brand"><span class="mission-mark">▦</span><div><b>MISSION CONTROL</b>' +
        '<span>' + esc(this.t("missionTitle")) + (activeTitle ? ' · ' + esc(short(activeTitle, 40)) : '') +
        '</span></div></div>' +
        '<div class="mission-head-actions">' +
        '<button class="mission-head-btn primary" type="button" data-mission-new="mission">＋ ' +
        esc(this.t("missionNew")) + '</button>' +
        '<button class="mission-head-btn" type="button" data-mission-new="group">＋ ' +
        esc(this.t("missionGroupNew")) + '</button>' +
        '<button class="mission-head-btn" type="button" data-mission-new="direct">＋ ' +
        esc(this.t("missionDmNew")) + '</button>' +
        this.approveBadge() +
        '<button class="mission-head-btn ghost" type="button" data-mission-lang>' +
        (AO.lang === "en" ? "中" : "EN") + '</button>' +
        '<button class="mission-head-btn ghost" type="button" data-mission-refresh title="refresh">↻</button>' +
        '<button class="mission-head-btn ghost close" type="button" data-mission-close>×</button>' +
        '</div></header>' +
        '<div class="mission-body">' + this.renderSidebar() + this.renderMain() + this.renderDetail() + '</div>' +
        this.renderForm() + this.renderArtifact();
      const box = this.root.querySelector("#missionMessages");
      if (box) box.scrollTop = box.scrollHeight;
    }

    renderSidebar() {
      const self = this;
      const missions = (this.data.missions || []).filter(function (m) {
        return !self.search || String(m.title || "").toLowerCase().includes(self.search.toLowerCase());
      });
      const conversations = (this.data.conversations || []).filter(function (c) {
        if (c.missionId) return false;
        return c.kind === self.sideTab.slice(0, -1) || (self.sideTab === "dms" && c.kind === "direct") ||
          (self.sideTab === "groups" && c.kind === "group");
      }).filter(function (c) {
        return !self.search || String(c.title || "").toLowerCase().includes(self.search.toLowerCase());
      });
      const missionItem = function (mission) {
        const active = self.activeType === "mission" && self.activeId === mission.id;
        const conv = self.data.conversations.find(function (c) { return c.id === mission.conversationId; });
        const unread = self.unreadFor(conv);
        return '<button class="mission-item' + (active ? ' active' : '') + '" type="button" data-mission-id="' +
          esc(mission.id) + '"><span class="mission-item-dot ' + esc(mission.status || 'active') + '"></span>' +
          '<span class="mission-item-copy"><b>' + esc(mission.title) + '</b><em>' +
          (mission.stats ? mission.stats.progress : 0) + '% · ' + (mission.stats ? mission.stats.tasks : 0) +
          ' ' + esc(self.t("missionTasksLower")) + '</em></span>' +
          (mission.stats && mission.stats.approvals ? '<span class="mission-item-badge">' + mission.stats.approvals + '</span>' : '') +
          (unread ? '<span class="mission-unread"></span>' : '') + '</button>';
      };
      const convItem = function (conversation) {
        const active = self.activeType !== "mission" && self.activeId === conversation.id;
        const member = (conversation.members || [])[0];
        const unread = self.unreadFor(conversation);
        return '<button class="mission-conv' + (active ? ' active' : '') + '" type="button" data-mission-conv="' +
          esc(conversation.id) + '" data-conv-kind="' + esc(conversation.kind) + '">' +
          '<span class="mission-avatar" style="--c:' + esc((member && member.color) || '#7cb7ff') + '">' +
          esc(initials(conversation.kind === "direct" ? (member && self.agentName(member)) : conversation.title)) + '</span>' +
          '<span class="mission-conv-copy"><b>' + esc(conversation.title) + '</b><em>' +
          esc((conversation.lastMessage && conversation.lastMessage.text) || self.t("missionNoMessages")) +
          '</em></span>' + (unread ? '<span class="mission-unread"></span>' : '') + '</button>';
      };
      const tabs = [
        ["missions", this.t("missionTabTasks")],
        ["groups", this.t("missionGroups")],
        ["dms", this.t("missionDms")]
      ];
      return '<aside class="mission-side">' +
        '<div class="mission-side-tabs">' + tabs.map(function (row) {
          return '<button type="button" class="' + (self.sideTab === row[0] ? 'active' : '') +
            '" data-mission-side-tab="' + row[0] + '">' + esc(row[1]) + '</button>';
        }).join('') + '</div>' +
        '<div class="mission-side-tools"><input id="missionSearch" placeholder="' +
        esc(this.t("missionSearch")) + '" value="' + esc(this.search) + '" />' +
        '<button type="button" data-mission-new="' + (this.sideTab === 'missions' ? 'mission' : (this.sideTab === 'groups' ? 'group' : 'direct')) + '">＋</button></div>' +
        '<div class="mission-list">' +
        (this.sideTab === "missions" ? (missions.map(missionItem).join("") ||
          '<div class="mission-empty small">' + esc(this.t("missionNoMissions")) + '</div>')
          : (conversations.map(convItem).join("") ||
          '<div class="mission-empty small">' + esc(this.t("missionNoConversations")) + '</div>')) +
        '</div></aside>';
    }

    renderMain() {
      if (this.viewMode === "approvals") return this.renderApprovalsView();
      if (!this.conversation) return '<main class="mission-main">' +
        '<div class="mission-empty big"><span>▦</span><h2>' + esc(this.t("missionEmptyTitle")) + '</h2>' +
        '<p>' + esc(this.t("missionEmptyDesc")) + '</p>' +
        '<button class="mission-primary" type="button" data-mission-new="mission">＋ ' +
        esc(this.t("missionNew")) + '</button></div></main>';
      const isMission = !!this.mission;
      const title = this.mission ? this.mission.title : this.conversation.title;
      const members = (this.conversation.members || []).map((m) => this.agentName(m)).join(" · ");
      return '<main class="mission-main">' +
        '<header class="mission-chat-head">' +
        '<button type="button" class="mission-mobile-back" data-mobile-back>‹ ' +
        esc(this.t("missionTabTasks")) + '</button><div><span class="mission-kicker">' +
        esc(isMission ? this.t("missionGroup") : (this.conversation.kind === "direct" ? this.t("missionDm") : this.t("missionGroup"))) +
        '</span><h3>' + esc(title) + '</h3><p>' + esc(members) + '</p></div>' +
        '<div class="mission-chat-actions">' +
        '<button type="button" class="mission-mini mission-mobile-detail" data-mobile-detail>☰</button>' +
        (isMission ? '<button type="button" class="mission-mini" data-ai-discuss>' +
          (this.mission.discussion && this.mission.discussion.status === "running" ? '… ' : '✦ ') +
          esc(this.t("missionAiDiscuss")) + '</button>' : '') +
        (isMission ? '<button type="button" class="mission-mini" data-detail-tab="tasks">' +
          esc(this.t("missionTabTasks")) + '</button>' : '') +
        '</div></header>' +
        '<div class="mission-messages" id="missionMessages">' +
        (this.messages.length ? this.messages.map((m) => this.messageHTML(m)).join("") :
          '<div class="mission-empty small">' + esc(this.t("missionNoMessagesHint")) + '</div>') +
        '</div>' + this.renderComposer() + '</main>';
    }

    renderComposer() {
      const chips = this.files.map(function (file, index) {
        return '<span class="mission-file-chip">' + esc(file.name) +
          ' <button type="button" data-pending-file-remove="' + index + '">×</button></span>';
      }).join("");
      return '<form class="mission-composer" id="missionChatForm">' +
        (chips ? '<div class="mission-pending-files">' + chips + '</div>' : '') +
        '<textarea id="missionDraft" rows="1" maxlength="8000" placeholder="' +
        esc(this.t("missionSendPlaceholder")) + '">' + esc(this.draft) + '</textarea>' +
        '<div class="mission-composer-bar">' +
        '<label class="mission-attach">＋ ' + esc(this.t("missionAttach")) +
        '<input type="file" id="missionFileInput" multiple /></label>' +
        '<span>' + esc(this.t("missionSendHint")) + '</span>' +
        '<button class="mission-primary" type="submit"' + (this.uploading ? ' disabled' : '') + '>' +
        esc(this.uploading ? this.t("missionUploading") : this.t("missionSend")) + '</button></div></form>';
    }

    renderApprovalsView() {
      const approvals = this.data.approvals || [];
      return '<main class="mission-main mission-inbox"><header class="mission-chat-head">' +
        '<div><span class="mission-kicker">BOSS INBOX</span><h3>' + esc(this.t("missionBossInbox")) +
        '</h3><p>' + esc(this.t("missionBossInboxHint")) + '</p></div></header>' +
        '<div class="mission-inbox-list">' +
        (approvals.length ? approvals.map((a) => this.approvalHTML(a, true)).join("") :
          '<div class="mission-empty small">' + esc(this.t("missionNoApprovals")) + '</div>') +
        '</div></main>';
    }

    renderDetail() {
      if (!this.mission && !this.conversation) return '<aside class="mission-detail"></aside>';
      const tabs = this.mission ? [
        ["overview", this.t("missionOverview")],
        ["tasks", this.t("missionTabTasks")],
        ["rules", this.t("missionRules")],
        ["approvals", this.t("missionApprovals")],
        ["files", this.t("missionFiles")],
        ["members", this.t("missionMembers")]
      ] : [
        ["files", this.t("missionFiles")],
        ["members", this.t("missionMembers")]
      ];
      if (!tabs.some((row) => row[0] === this.detailTab)) this.detailTab = tabs[0][0];
      return '<aside class="mission-detail"><button type="button" class="mission-detail-close" ' +
        'data-mobile-detail>×</button><div class="mission-detail-tabs">' +
        tabs.map((row) => '<button type="button" class="' + (this.detailTab === row[0] ? 'active' : '') +
          '" data-detail-tab="' + row[0] + '">' + esc(row[1]) + '</button>').join('') +
        '</div><div class="mission-detail-body">' + this.detailBody() + '</div></aside>';
    }

    detailBody() {
      if (this.detailTab === "overview") return this.overviewTab();
      if (this.detailTab === "tasks") return this.tasksTab();
      if (this.detailTab === "rules") return this.rulesTab();
      if (this.detailTab === "approvals") return this.approvalsTab();
      if (this.detailTab === "files") return this.filesTab();
      if (this.detailTab === "members") return this.membersTab();
      return "";
    }

    overviewTab() {
      const m = this.mission;
      if (!m) return "";
      const coverage = m.coverage || {};
      const stats = m.stats || {};
      const discussion = m.discussion || {};
      const decisions = (m.decisions || []).slice(-4).reverse();
      return '<div class="mission-panel">' +
        '<div class="mission-stat-row"><div><b>' + (stats.progress || 0) + '%</b><span>' +
        esc(this.t("missionProgress")) + '</span></div><div><b>' + (stats.tasks || 0) + '</b><span>' +
        esc(this.t("missionTabTasks")) + '</span></div><div><b>' + (stats.review || 0) + '</b><span>' +
        esc(this.t("statusReview")) + '</span></div><div><b>' + (stats.approvals || 0) + '</b><span>' +
        esc(this.t("missionApprovals")) + '</span></div></div>' +
        '<div class="mission-coverage ' + (coverage.noIdle ? 'ok' : 'bad') + '"><b>' +
        esc(coverage.noIdle ? this.t("missionNoIdle") : this.t("missionIdle")) + '</b><p>' +
        esc(this.t("missionCoverageHint", { assigned: coverage.assigned || 0, total: coverage.total || 0 })) + '</p></div>' +
        '<h4>' + esc(this.t("missionGoal")) + '</h4><p class="mission-copy">' + esc(m.description) + '</p>' +
        '<h4>' + esc(this.t("missionAcceptance")) + '</h4><p class="mission-copy">' + esc(m.acceptance) + '</p>' +
        (m.budget ? '<p class="mission-note">' + esc(this.t("missionBudget")) + '：' + esc(m.budget) + ' ' + esc(m.currency) + '</p>' : '') +
        (m.deadline ? '<p class="mission-note">' + esc(this.t("missionDeadline")) + '：' + esc(m.deadline) + '</p>' : '') +
        '<div class="mission-discussion-card"><div><b>' + esc(this.t("missionAiDiscuss")) + '</b><p>' +
        esc(discussion.status === "done" ? this.t("missionAiDone") :
          discussion.status === "running" || discussion.status === "queued" ? this.t("missionAiRunning") :
          discussion.status === "error" ? this.t("missionAiError") :
          discussion.status === "unavailable" ? this.t("missionAiUnavailable") : this.t("missionAiPending")) +
        '</p>' + (discussion.error ? '<small>' + esc(short(discussion.error, 180)) + '</small>' : '') +
        '</div><button class="mission-primary small" type="button" data-ai-discuss>' +
        esc(this.t("missionAiRun")) + '</button></div>' +
        (decisions.length ? '<h4>' + esc(this.t("missionDecisions")) + '</h4>' +
          decisions.map((d) => '<div class="mission-decision"><b>' + esc(d.topic) + '</b><p>' +
            esc(d.outcome) + '</p><small>' + esc(d.decidedBy || 'team') + ' · ' + esc(fmtTime(d.createdAt)) + '</small></div>').join('') : '') +
        '</div>';
    }

    tasksTab() {
      const m = this.mission;
      if (!m) return "";
      const tasks = m.tasks || [];
      return '<div class="mission-panel">' + (tasks.map((task) => this.taskHTML(task)).join("") ||
        '<div class="mission-empty small">—</div>') + '</div>';
    }

    taskHTML(task) {
      const approval = (this.mission.approvals || []).find((a) => a.taskId === task.id);
      return '<details class="mission-task ' + this.taskClass(task.status) + '"><summary>' +
        '<span class="mission-task-status"></span><b>' + esc(task.title) + '</b><em>' +
        esc(task.assigneeName || task.assigneeId) + '</em><span>' + esc(this.taskStatus(task.status)) + '</span></summary>' +
        '<p>' + esc(task.brief) + '</p>' +
        '<div class="mission-task-meta"><span>' + esc(this.t("missionAcceptance")) + '：' +
        esc(task.acceptance) + '</span>' +
        (task.deps && task.deps.length ? '<span>' + esc(this.t("missionDeps")) + '：' +
          esc(task.deps.join(" · ")) + '</span>' : '') +
        (task.assignmentReason ? '<span>' + esc(task.assignmentReason) + '</span>' : '') +
        (approval ? '<span class="mission-gate">' + esc(this.approvalType(approval.type)) + ' · ' +
          esc(approval.status) + '</span>' : '') + '</div>' +
        (task.report ? '<div class="mission-report compact"><b>' + esc(this.t("missionReport")) + '</b><p>' +
          esc(task.report.summary) + '</p><span class="mission-solution">' + esc(this.t("missionSolution")) +
          '：' + esc(task.report.solution) + '</span></div>' : '') +
        '<div class="mission-task-actions"><button type="button" data-dm-agent="' +
        esc(task.assigneeId) + '">' + esc(this.t("missionDmAgent")) + '</button>' +
        (task.status !== "done" && !this.isExternalAgent(task.assigneeId) ?
          '<button type="button" data-ai-task="' + esc(task.id) + '">' +
          esc(this.t("missionAiTask")) + '</button>' : '') +
        '<button type="button" data-copy-protocol="' + esc(task.id) + '">' +
        esc(this.t("missionCopyProtocol")) + '</button></div></details>';
    }

    rulesTab() {
      const m = this.mission;
      if (!m) return "";
      const charter = m.charter || {};
      return '<div class="mission-panel"><h4>' + esc(this.t("missionRulesTitle")) + '</h4>' +
        '<ol class="mission-rules">' + (m.rules || []).map((r) => '<li>' + esc(r) + '</li>').join('') + '</ol>' +
        '<h4>' + esc(this.t("missionBossGates")) + '</h4><div class="mission-gate-list">' +
        BOSS_GATES.map((gate) => '<span>' + esc(this.approvalType(gate)) + '</span>').join('') + '</div>' +
        '<h4>' + esc(this.t("missionReportFormat")) + '</h4><p class="mission-copy">' +
        esc(charter.reportFormat || this.t("missionReportFormatDefault")) + '</p>' +
        (charter.nonGoals ? '<h4>' + esc(this.t("missionNonGoals")) + '</h4><p class="mission-copy">' +
          esc(charter.nonGoals) + '</p>' : '') +
        (charter.constraints ? '<h4>' + esc(this.t("missionConstraints")) + '</h4><p class="mission-copy">' +
          esc(charter.constraints) + '</p>' : '') +
        '<p class="mission-note">' + esc(this.t("missionCharterVersion", { version: charter.version || 1 })) + '</p></div>';
    }

    approvalsTab() {
      const missionApprovals = (this.mission && this.mission.approvals) || [];
      const global = this.data.approvals || [];
      const seen = new Set();
      const rows = [];
      missionApprovals.concat(global).forEach(function (a) {
        if (a && !seen.has(a.id)) { seen.add(a.id); rows.push(a); }
      });
      return '<div class="mission-panel">' + (rows.length ? rows.map((a) => this.approvalHTML(a, true)).join("") :
        '<div class="mission-empty small">' + esc(this.t("missionNoApprovals")) + '</div>') + '</div>';
    }

    filesTab() {
      const artifacts = this.mission ? (this.mission.artifacts || []) :
        (this.data.artifacts || []).filter((a) => a.conversationId === (this.conversation && this.conversation.id));
      return '<div class="mission-panel mission-files">' + (artifacts.length ? artifacts.map((a) =>
        this.artifactRow(a)).join("") : '<div class="mission-empty small">' +
        esc(this.t("missionNoFiles")) + '</div>') + '</div>';
    }

    membersTab() {
      const members = this.mission ? (this.mission.members || []) :
        ((this.conversation && this.conversation.members) || []);
      const tasks = (this.mission && this.mission.tasks) || [];
      return '<div class="mission-panel mission-members">' + members.map((member) => {
        const mine = tasks.filter((t) => t.assigneeId === member.id);
        const open = mine.filter((t) => t.status !== "done").length;
        return '<div class="mission-member"><span class="mission-avatar" style="--c:' +
          esc(member.color || '#7cb7ff') + '">' + esc(initials(this.agentName(member))) + '</span>' +
          '<div><b>' + esc(this.agentName(member)) + '</b><span>' +
          esc((member.skills || []).slice(0, 3).join(" · ")) + '</span><em>' +
          open + ' ' + esc(this.t("missionOpenTasks")) + ' · ' +
          esc(member.source === "external" ? this.t("missionExternalAgent") :
            member.virtual ? this.t("missionVirtualAgent") : this.t("missionRoleAgent")) + '</em></div>' +
          '<button type="button" data-dm-agent="' + esc(member.id) + '">' +
          esc(this.t("missionDm")) + '</button></div>';
      }).join('') + '</div>';
    }

    messageHTML(message) {
      const kind = message.senderType || "agent";
      const type = message.type || "text";
      if (type === "report" && message.meta && message.meta.report) {
        return this.reportHTML(message);
      }
      if (type === "proposal") return this.proposalHTML(message);
      if (type === "approval") {
        const approval = this.findApproval(message.meta && message.meta.approvalId);
        return '<div class="mission-event-card"><span>' + esc(this.t("missionApprovalEvent")) + '</span>' +
          (approval ? this.approvalHTML(approval, true) : '<p>' + esc(message.text) + '</p>') + '</div>';
      }
      if (type === "mission-created") {
        return '<div class="mission-charter-card"><div class="mission-charter-head"><span>CHARTER</span><b>' +
          esc(this.t("missionCharterCard")) + '</b><em>' + esc(fmtTime(message.createdAt)) +
          '</em></div><details><summary>' + esc(this.t("missionCharterOpen")) +
          '</summary><pre>' + esc(message.text || "") + '</pre></details></div>';
      }
      if (kind === "system" || type === "system") {
        return '<div class="mission-system"><span>' + esc(fmtTime(message.createdAt)) + '</span><pre>' +
          esc(message.text || "") + '</pre></div>';
      }
      return '<div class="mission-message kind-' + esc(kind) + '">' +
        '<div class="mission-message-avatar" style="--c:' +
        esc(this.agentColor(message.senderId)) + '">' + esc(initials(message.senderName)) + '</div>' +
        '<div class="mission-bubble"><div class="mission-message-top"><b>' +
        esc(message.senderName || this.t("missionAgent")) + '</b><span>' +
        esc(fmtTime(message.createdAt)) + '</span></div>' +
        (message.text ? '<div class="mission-message-text">' + esc(message.text) + '</div>' : '') +
        this.attachmentsHTML(message.attachments) + '</div></div>';
    }

    reportHTML(message) {
      const report = message.meta.report;
      const rows = [
        ["missionDone", report.done],
        ["missionNext", report.next],
        ["missionRisks", report.risks]
      ];
      return '<div class="mission-message kind-agent report-message"><div class="mission-message-avatar" style="--c:' +
        esc(this.agentColor(message.senderId)) + '">' + esc(initials(message.senderName)) + '</div>' +
        '<div class="mission-report"><div class="mission-report-head"><b>' + esc(message.senderName) +
        ' · ' + esc(this.t("missionReport")) + '</b><span>' + esc(fmtTime(message.createdAt)) + '</span></div>' +
        '<p class="mission-report-summary">' + esc(report.summary) + '</p>' +
        rows.map((row) => '<div class="mission-report-row"><span>' + esc(this.t(row[0])) +
          '</span><div>' + (row[1] || []).map((item) => '<em>' + esc(item) + '</em>').join("") + '</div></div>').join('') +
        '<div class="mission-solution"><b>' + esc(this.t("missionSolution")) + '</b><p>' +
        esc(report.solution) + '</p></div>' +
        (report.evidence && report.evidence.length ? '<div class="mission-evidence"><b>' +
          esc(this.t("missionEvidence")) + '</b>' + report.evidence.map((e) => '<code>' + esc(e) + '</code>').join("") + '</div>' : '') +
        (report.needsBoss && report.needsBoss.length ? '<div class="mission-needs-boss">' +
          esc(this.t("missionNeedsBoss")) + '：' + report.needsBoss.map((type) => '<span>' +
          esc(this.approvalType(type)) + '</span>').join("") + '</div>' : '') +
        this.attachmentsHTML(message.attachments) + '</div></div>';
    }

    proposalHTML(message) {
      const p = (message.meta && message.meta.proposal) || {};
      return '<div class="mission-message kind-agent proposal-message"><div class="mission-message-avatar" style="--c:' +
        esc(this.agentColor(message.senderId)) + '">' + esc(initials(message.senderName)) + '</div>' +
        '<div class="mission-proposal"><div class="mission-report-head"><b>' + esc(message.senderName) +
        ' · ' + esc(this.t("missionProposal")) + '</b><span>' + esc(fmtTime(message.createdAt)) + '</span></div>' +
        '<p>' + esc(message.text) + '</p>' +
        (p.topic ? '<div class="mission-proposal-meta"><b>' + esc(p.topic) + '</b><span>' +
          esc(p.option || "") + '</span>' + (p.rationale ? '<em>' + esc(p.rationale) + '</em>' : '') + '</div>' : '') +
        this.attachmentsHTML(message.attachments) + '</div></div>';
    }

    attachmentsHTML(attachments) {
      if (!attachments || !attachments.length) return "";
      return '<div class="mission-attachments">' + attachments.map((a) => {
        if (a.kind === "image") {
          return '<button type="button" class="mission-img" data-artifact-open="' + esc(a.id) + '">' +
            '<img src="' + esc(this.bridge() + a.url) + '" alt="' + esc(a.name) + '" loading="lazy" />' +
            '<span>' + esc(a.name) + '</span>' + (a.visionSummary ? '<b>OCR</b>' : '') + '</button>';
        }
        return '<button type="button" class="mission-file" data-artifact-open="' + esc(a.id) + '">' +
          '<i>DOC</i><span><b>' + esc(a.name) + '</b><em>' + fmtSize(a.size) + '</em></span></button>';
      }).join('') + '</div>';
    }

    artifactRow(artifact) {
      if (artifact.kind === "image") {
        return '<button type="button" class="mission-file-row image" data-artifact-open="' +
          esc(artifact.id) + '"><img src="' + esc(this.bridge() + artifact.url) + '" alt="" />' +
          '<span><b>' + esc(artifact.name) + '</b><em>' + fmtSize(artifact.size) +
          (artifact.visionSummary ? ' · OCR' : '') + '</em></span></button>';
      }
      return '<button type="button" class="mission-file-row" data-artifact-open="' + esc(artifact.id) + '">' +
        '<i>DOC</i><span><b>' + esc(artifact.name) + '</b><em>' +
        (artifact.extraction && artifact.extraction !== "none" ? artifact.extraction : fmtSize(artifact.size)) +
        '</em></span></button>';
    }

    approvalHTML(approval, actions) {
      if (!approval) return "";
      const pending = approval.status === "pending";
      const options = approval.type === "decision" && approval.options && approval.options.length ?
        '<select>' + approval.options.map((o) =>
          '<option value="' + esc(o.id || o.label) + '">' + esc(o.label || o.id) + '</option>').join('') + '</select>' : '';
      return '<div class="mission-approval ' + esc(approval.status) + '"><div class="mission-approval-head">' +
        '<span class="mission-gate">' + esc(this.approvalType(approval.type)) + '</span><b>' +
        esc(approval.title) + '</b><em>' + esc(approval.status) + '</em></div>' +
        '<p>' + esc(approval.description) + '</p>' +
        (approval.amount ? '<div class="mission-approval-amount">' + esc(approval.amount) + ' ' +
          esc(approval.currency || "") + '</div>' : '') +
        (approval.service ? '<div class="mission-note">' + esc(this.t("missionService")) + '：' +
          esc(approval.service) + '</div>' : '') +
        (approval.scopes && approval.scopes.length ? '<div class="mission-scopes">' +
          approval.scopes.map((s) => '<code>' + esc(s) + '</code>').join("") + '</div>' : '') +
        (approval.type === "login" ? '<p class="mission-note">' + esc(this.t("missionLoginHint")) + '</p>' : '') +
        this.attachmentsHTML(approval.attachments) +
        (options ? '<div class="mission-approval-options">' + options + '</div>' : '') +
        (pending && actions ? '<div class="mission-approval-actions"><input type="text" placeholder="' +
          esc(this.t("missionApprovalNote")) + '" />' +
          '<button type="button" class="mission-primary small" data-approval-decision="' + esc(approval.id) +
          '" data-approval-action="approved">' + esc(this.t("missionApprove")) + '</button>' +
          '<button type="button" class="mission-danger small" data-approval-decision="' + esc(approval.id) +
          '" data-approval-action="rejected">' + esc(this.t("missionReject")) + '</button></div>' : '') +
        (approval.resolution && approval.resolution.note ? '<p class="mission-note">' +
          esc(this.t("missionNote")) + '：' + esc(approval.resolution.note) + '</p>' : '') +
        '</div>';
    }

    findApproval(id) {
      if (!id) return null;
      return (this.data.approvals || []).find((a) => a.id === id) ||
        ((this.mission && this.mission.approvals) || []).find((a) => a.id === id) || null;
    }

    agentColor(id) {
      const agent = this.agentById(id);
      return (agent && agent.color) || "#7cb7ff";
    }

    isExternalAgent(id) {
      const agent = this.agentById(id);
      return !!(agent && agent.source === "external");
    }

    async runTask(taskId, button) {
      if (!this.mission || !taskId) return;
      if (button) {
        button.disabled = true;
        button.textContent = this.t("missionAiTaskRunning");
      }
      try {
        const result = await this.api("/missions/" + encodeURIComponent(this.mission.id) +
          "/tasks/" + encodeURIComponent(taskId) + "/run", {
          method: "POST", body: JSON.stringify({})
        }, 90000);
        this.toast(this.t("missionAiTaskDone"));
        await this.loadActive();
        this.render();
        if (result && result.message && result.message.id) this.markRead();
      } catch (err) {
        if (button) {
          button.disabled = false;
          button.textContent = this.t("missionAiTask");
        }
        this.toast(err.code === "no_provider" ?
          this.t("missionAiUnavailable") :
          this.t("missionAiTaskFailed") + " " + String(err.message || ""));
      }
    }

    appendMessage(message) {
      const box = this.root.querySelector("#missionMessages");
      if (!box) return;
      const empty = box.querySelector(".mission-empty");
      if (empty) empty.remove();
      box.insertAdjacentHTML("beforeend", this.messageHTML(message));
      box.scrollTop = box.scrollHeight;
    }

    renderSidebarOnly() {
      const side = this.root.querySelector(".mission-side");
      if (!side) return;
      side.outerHTML = this.renderSidebar();
    }

    renderForm() {
      if (!this.formMode) return "";
      const isMission = this.formMode === "mission";
      const isGroup = this.formMode === "group";
      const title = isMission ? this.t("missionNew") : (isGroup ? this.t("missionGroupNew") : this.t("missionDmNew"));
      const agents = this.data.agents || [];
      let fields = "";
      if (isMission) {
        fields =
          '<label>' + esc(this.t("missionTitleLabel")) + '<input name="title" maxlength="120" required placeholder="' +
          esc(this.t("missionTitlePh")) + '" /></label>' +
          '<label>' + esc(this.t("missionDescLabel")) + '<textarea name="description" rows="4" required placeholder="' +
          esc(this.t("missionDescPh")) + '"></textarea></label>' +
          '<label>' + esc(this.t("missionAcceptLabel")) + '<textarea name="acceptance" rows="2" placeholder="' +
          esc(this.t("missionAcceptPh")) + '"></textarea></label>' +
          '<div class="mission-form-grid"><label>' + esc(this.t("missionPriority")) +
          '<select name="priority"><option>P0</option><option selected>P1</option><option>P2</option></select></label>' +
          '<label>' + esc(this.t("missionBudget")) + '<input name="budget" type="number" min="0" step="1" placeholder="0" /></label>' +
          '<label>' + esc(this.t("missionDeadline")) + '<input name="deadline" type="date" /></label></div>' +
          '<label>' + esc(this.t("missionFiles")) + '<input id="missionCreateFiles" type="file" multiple />' +
          '<div id="missionCreateFilesList" class="mission-form-files">' +
          this.formFiles.map(function (file, index) {
            return '<span class="mission-file-chip">' + esc(file.name) +
              ' <button type="button" data-form-file-remove="' + index + '">×</button></span>';
          }).join("") + '</div></label>' +
          '<label class="mission-check"><input name="autoDiscuss" type="checkbox" checked /> ' +
          esc(this.t("missionAutoDiscuss")) + '</label>' +
          '<p class="mission-note">' + esc(this.t("missionAutoTeamHint")) + '</p>' +
          '<p class="mission-note">' + esc(this.t("missionBudgetHint")) + '</p>';
      } else if (isGroup) {
        fields = '<label>' + esc(this.t("missionGroupName")) +
          '<input name="title" maxlength="120" placeholder="' + esc(this.t("missionGroupNamePh")) + '" /></label>' +
          '<div class="mission-form-members"><span>' + esc(this.t("missionMembers")) + '</span>' +
          agents.map((a) => '<label><input type="checkbox" name="memberIds" value="' + esc(a.id) + '" /> ' +
            esc(this.agentName(a)) + ' <em>' + esc(a.role) + '</em></label>').join("") + '</div>';
      } else {
        fields = '<div class="mission-form-members"><span>' + esc(this.t("missionChooseAgent")) + '</span>' +
          agents.map((a) => '<label><input type="radio" name="memberId" value="' + esc(a.id) + '" /> ' +
            esc(this.agentName(a)) + ' <em>' + esc(a.role) + '</em></label>').join("") + '</div>';
      }
      return '<div class="mission-form-backdrop" data-mission-form-close></div><section class="mission-form">' +
        '<header><span>' + esc(isMission ? "NEW MISSION" : (isGroup ? "NEW GROUP" : "NEW DM")) + '</span><h3>' +
        esc(title) + '</h3><button type="button" data-mission-form-close>×</button></header>' +
        '<form id="missionCreateForm"><div class="mission-form-body">' + fields + '</div>' +
        '<footer><button type="button" class="mission-mini" data-mission-form-close>' +
        esc(this.t("cancel")) + '</button><button type="submit" class="mission-primary" ' +
        (this.formBusy ? 'disabled' : '') + '>' + esc(this.formBusy ? this.t("missionWorking") :
          (isMission ? this.t("missionCreate") : this.t("missionCreateChat"))) + '</button></footer></form></section>';
    }

    renderArtifact() {
      if (!this.artifactFocus) return "";
      const a = this.artifactFocus;
      return '<div class="mission-artifact-backdrop" data-artifact-close></div>' +
        '<section class="mission-artifact"><header><div><span>' + esc(a.kind === "image" ?
          "IMAGE" : "DOCUMENT") + '</span><h3>' + esc(a.name) + '</h3></div>' +
        '<button type="button" data-artifact-close>×</button></header>' +
        '<div class="mission-artifact-body">' +
        (a.kind === "image" ? '<img src="' + esc(this.bridge() + a.url) + '" alt="' + esc(a.name) + '" />' : '') +
        (a.extractedText ? '<pre>' + esc(a.extractedText) + '</pre>' :
          (a.kind === "image" ? '<p class="mission-note">' + esc(this.t("missionNoOcr")) + '</p>' : '')) +
        (a.kind === "image" ? '<button type="button" class="mission-primary" data-artifact-vision ' +
          (this.artifactBusy ? 'disabled' : '') + '>' + esc(this.artifactBusy ? this.t("missionOcrRunning") :
            this.t("missionOcr")) + '</button>' : '') +
        '</div></section>';
    }

    openForm(mode) {
      this.formMode = mode;
      this.formFiles = [];
      this.formBusy = false;
      this.render();
      const input = this.root.querySelector('#missionCreateForm input[name="title"], #missionCreateForm input[name="memberId"]');
      if (input) input.focus();
    }

    async submitForm(form) {
      if (this.formBusy) return;
      const data = new FormData(form);
      this.formBusy = true;
      const submit = form.querySelector('button[type="submit"]');
      if (submit) {
        submit.disabled = true;
        submit.textContent = this.t("missionWorking");
      }
      try {
        if (this.formMode === "mission") {
          const payload = {
            title: String(data.get("title") || "").trim(),
            description: String(data.get("description") || "").trim(),
            acceptance: String(data.get("acceptance") || "").trim(),
            priority: String(data.get("priority") || "P1"),
            budget: Number(data.get("budget") || 0),
            autoDiscuss: data.get("autoDiscuss") === "on",
            language: AO.lang
          };
          if (!payload.title || payload.description.length < 8) {
            this.toast(this.t("missionFormInvalid"));
            this.formBusy = false;
            if (submit) { submit.disabled = false; submit.textContent = this.t("missionCreate"); }
            return;
          }
          const created = await this.api("/missions", {
            method: "POST", body: JSON.stringify(payload)
          }, 30000);
          const mission = created.mission;
          const convId = mission.conversationId;
          const attachments = [];
          for (const file of this.formFiles) {
            try { attachments.push(await this.upload(file, mission.id, convId)); }
            catch (err) { this.toast(this.t("missionUploadFailed") + " " + file.name); }
          }
          if (attachments.length) {
            await this.api("/conversations/" + encodeURIComponent(convId) + "/messages", {
              method: "POST", body: JSON.stringify({
                senderId: "boss", senderType: "boss", type: "text",
                text: this.t("missionAttachmentsSent"), attachmentIds: attachments.map((a) => a.id)
              })
            });
          }
          this.formMode = "";
          this.formFiles = [];
          this.formBusy = false;
          this.activeType = "mission";
          this.activeId = mission.id;
          await this.refreshAll(false);
          await this.selectMission(mission.id);
          this.toast(this.t("missionCreated"));
        } else if (this.formMode === "group") {
          const memberIds = data.getAll("memberIds");
          if (!memberIds.length) {
            this.toast(this.t("missionChooseMembers"));
            this.formBusy = false;
            if (submit) { submit.disabled = false; submit.textContent = this.t("missionCreateChat"); }
            return;
          }
          const res = await this.api("/conversations", {
            method: "POST", body: JSON.stringify({
              kind: "group", title: String(data.get("title") || "").trim(), memberIds: memberIds
            })
          });
          this.formMode = "";
          this.formBusy = false;
          await this.refreshAll(false);
          await this.selectConversation(res.conversation.id, "group");
          this.toast(this.t("missionGroupCreated"));
        } else {
          const memberId = String(data.get("memberId") || "");
          if (!memberId) {
            this.toast(this.t("missionChooseAgent"));
            this.formBusy = false;
            if (submit) { submit.disabled = false; submit.textContent = this.t("missionCreateChat"); }
            return;
          }
          const res = await this.api("/conversations", {
            method: "POST", body: JSON.stringify({ kind: "direct", memberIds: [memberId] })
          });
          this.formMode = "";
          this.formBusy = false;
          await this.refreshAll(false);
          await this.selectConversation(res.conversation.id, "direct");
          this.toast(this.t("missionDmCreated"));
        }
      } catch (err) {
        this.formBusy = false;
        if (submit) { submit.disabled = false; submit.textContent = this.t("missionCreateChat"); }
        this.toast(this.t("missionError") + " " + String(err.message || ""));
      }
    }

    async sendMessage() {
      if (!this.conversation || this.uploading) return;
      const text = String(this.draft || "").trim();
      if (!text && !this.files.length) return;
      this.uploading = true;
      this.render();
      try {
        const attachments = [];
        for (const file of this.files) {
          attachments.push(await this.upload(file, this.mission ? this.mission.id : "", this.conversation.id));
        }
        const res = await this.api("/conversations/" + encodeURIComponent(this.conversation.id) + "/messages", {
          method: "POST", body: JSON.stringify({
            senderId: "boss", senderType: "boss", type: "text",
            text: text || this.t("missionAttachmentsSent"), attachmentIds: attachments.map((a) => a.id)
          })
        });
        this.messages.push(res.message);
        this.draft = "";
        this.files = [];
        this.uploading = false;
        this.render();
        this.markRead();
        this.refreshOverview();
      } catch (err) {
        this.uploading = false;
        this.render();
        this.toast(this.t("missionSendFailed") + " " + String(err.message || ""));
      }
    }

    async resolveApproval(id, decision, optionId, note) {
      try {
        await this.api("/approvals/" + encodeURIComponent(id) + "/resolve", {
          method: "POST", body: JSON.stringify({
            decision: decision, optionId: optionId || "", note: note || ""
          })
        });
        this.toast(decision === "approved" ? this.t("missionApprovedToast") : this.t("missionRejectedToast"));
        await this.refreshAll(false);
        await this.loadActive();
        this.render();
      } catch (err) {
        this.toast(this.t("missionError") + " " + String(err.message || ""));
      }
    }

    async discuss() {
      if (!this.mission) return;
      try {
        await this.api("/missions/" + encodeURIComponent(this.mission.id) + "/discuss", {
          method: "POST", body: JSON.stringify({})
        });
        this.toast(this.t("missionAiStarted"));
        await this.loadActive();
        this.render();
        let tries = 0;
        const missionId = this.mission.id;
        const timer = window.setInterval(async () => {
          tries += 1;
          if (this.activeId !== missionId) { window.clearInterval(timer); return; }
          try {
            const detail = await this.api("/missions/" + encodeURIComponent(missionId));
            this.mission = detail.mission;
            if (!this.isEditing()) this.render();
            const status = (this.mission.discussion || {}).status;
            if (status === "done" || status === "error" || status === "unavailable" || tries > 8) {
              window.clearInterval(timer);
              this.refreshOverview();
            }
          } catch (err) { window.clearInterval(timer); }
        }, 1500);
      } catch (err) {
        this.toast(this.t("missionAiFailed") + " " + String(err.message || ""));
      }
    }

    async openArtifact(id) {
      try {
        const res = await this.api("/files/" + encodeURIComponent(id));
        this.artifactFocus = res.artifact;
        this.render();
      } catch (err) {
        this.toast(this.t("missionError"));
      }
    }

    async recognizeArtifact() {
      if (!this.artifactFocus || this.artifactBusy) return;
      this.artifactBusy = true;
      this.render();
      try {
        const res = await this.api("/files/" + encodeURIComponent(this.artifactFocus.id) + "/vision", {
          method: "POST", body: JSON.stringify({})
        }, 60000);
        this.artifactFocus = res.artifact;
        const lists = [(this.data.artifacts || []), (this.mission && this.mission.artifacts) || []];
        lists.forEach((list) => {
          const index = list.findIndex((a) => a.id === res.artifact.id);
          if (index >= 0) list[index] = res.artifact;
        });
        this.toast(this.t("missionOcrDone"));
      } catch (err) {
        this.toast(err.code === "vision_unavailable" || err.status === 409 ?
          this.t("missionVisionUnavailable") : this.t("missionOcrFailed") + " " + String(err.message || ""));
      } finally {
        this.artifactBusy = false;
        this.render();
      }
    }

    async startDm(agentId) {
      if (!agentId) return;
      const existing = (this.data.conversations || []).find(function (c) {
        return c.kind === "direct" && c.members && c.members.some(function (m) { return m.id === agentId; });
      });
      if (existing) {
        await this.selectConversation(existing.id, "direct");
        return;
      }
      try {
        const res = await this.api("/conversations", {
          method: "POST", body: JSON.stringify({ kind: "direct", memberIds: [agentId] })
        });
        await this.refreshAll(false);
        await this.selectConversation(res.conversation.id, "direct");
      } catch (err) {
        this.toast(this.t("missionError") + " " + String(err.message || ""));
      }
    }

    copyTaskProtocol(taskId) {
      if (!this.mission) return;
      const task = (this.mission.tasks || []).find((t) => t.id === taskId);
      const agentId = task ? task.assigneeId : "";
      const text = "# Agent Office mission task\n\n" +
        "Bridge: " + this.bridge() + "\n" +
        "Mission: " + this.mission.id + " (" + this.mission.title + ")\n" +
        "Task: " + taskId + "\n" +
        "Agent: " + agentId + "\n\n" +
        "1. Pull this agent's tasks:\n" +
        "curl " + this.bridge() + "/mission-tasks?agentId=" + encodeURIComponent(agentId) + "\n\n" +
        "2. Report a structured result (solution is mandatory):\n" +
        "curl -X PATCH " + this.bridge() + "/mission-tasks/" + taskId + " \\\n" +
        "  -H 'Content-Type: application/json' \\\n" +
        "  -d '{\"agentId\":\"" + agentId + "\",\"status\":\"review\",\"report\":{"
        + "\"summary\":\"...\",\"done\":[\"...\"],\"next\":[\"...\"],\"risks\":[\"...\"],"
        + "\"solution\":\"...\",\"evidence\":[\"...\"],\"needsBoss\":[]}}'\n\n" +
        "Boss gates only: spend, decision, login, authorization. Technical problems must include a solution.\n";
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
      this.toast(this.t("missionCopied"));
    }
  }

  AO.MissionView = MissionView;
})();
