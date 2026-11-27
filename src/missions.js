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

  function fmtDuration(minutes, durationMs) {
    const value = Math.max(0, Math.round(Number(minutes) || 0));
    const ms = Math.max(0, Number(durationMs) || 0);
    if (!value && ms) {
      const seconds = ms / 1000;
      return seconds < 60 ? seconds.toFixed(seconds < 10 ? 1 : 0) + "s" :
        Math.round(seconds / 60) + "m";
    }
    if (value < 60) return value + "m";
    return Math.floor(value / 60) + "h " + (value % 60) + "m";
  }

  function fmtTokens(tokens) {
    const value = Math.max(0, Math.round(Number(tokens) || 0));
    if (value < 1000) return String(value);
    return (value / 1000).toFixed(value < 10000 ? 1 : 0) + "k";
  }

  function initials(name) {
    const text = String(name || "?").trim();
    return text ? text.slice(0, 1).toUpperCase() : "?";
  }

  function short(value, length) {
    const text = String(value || "");
    return text.length > length ? text.slice(0, length) + "…" : text;
  }

  const TASK_PERCENT = {
    queued: 5, assigned: 15, in_progress: 45, review: 80, blocked: 35, done: 100
  };

  function taskProgressPercent(task) {
    if (!task) return 0;
    if (task.status === "done") return 100;
    const raw = Number(task.progress);
    if (Number.isFinite(raw) && raw > 0) return Math.max(0, Math.min(100, Math.round(raw)));
    return TASK_PERCENT[task.status] || 0;
  }

  AO.taskProgressPercent = taskProgressPercent;

  class MissionView {
    constructor(renderer) {
      this.renderer = renderer;
      this.external = renderer ? renderer.external : null;
      this.root = document.getElementById("missionLab");
      this.btn = document.getElementById("missionBtn");
      this.shell = null;
      this.isOpen = false;
      this.data = { missions: [], conversations: [], approvals: [], agents: [], artifacts: [] };
      this.ai = { available: false, provider: "" };
      this.activeType = "";
      this.activeId = "";
      this.mission = null;
      this.conversation = null;
      this.messages = [];
      this.lastSeq = 0;
      this.loadSeq = 0;
      this.viewMode = "chat";
      this.sideTab = "missions";
      this.detailTab = "overview";
      this.draft = "";
      this.files = [];
      this.formMode = "";
      this.formFiles = [];
      this.formBusy = false;
      this.nextRoundBusy = false;
      this.uploading = false;
      this.recommendation = null;
      this.recommendBusy = false;
      this.recommendTimer = null;
      this.autoTeam = true;
      this.selectedAgents = [];
      this.teamTouched = false;
      this.taskExecutors = {};
      this.taskAgentFilter = "";
      this.artifactFocus = null;
      this.artifactBusy = false;
      this.mobileDetail = false;
      this.stream = null;
      this.pollTimer = null;
      this.busy = false;
      this.search = "";
      this.missionFilter = "all";
      this.approvalFilter = "pending";
      this.approvalHistory = null;
      this.approvalLoading = false;
      this.selectedApprovals = new Set();
      this.bulkBusy = false;
      this.messageQuery = "";
      this.messageSearchOpen = false;
      this.replyPending = false;
      this.replyPendingConversation = "";
      this.replyTimer = null;
      this.replyPollTimer = null;
      this.taskEditId = "";
      this.archivingMission = false;
      this.duplicatingMission = false;
      this.selectedTasks = new Set();
      this.bulkTaskBusy = false;
      this.connectionLost = false;
      this.filesUploading = false;
      this.uploadCache = {};
      this.unread = readJson(READ_KEY, {});
      this.build();
      this.bind();
    }

    t(key, vars) { return AO.t(key, vars); }
    bridge() { return String((this.external && this.external.bridgeUrl) || AO.BRIDGE_DEFAULT || "").replace(/\/+$/, ""); }
    realOnly() { return !!(AO.DemoMode && !AO.DemoMode.enabled); }
    visibleAgents(list) {
      const agents = list || [];
      return this.realOnly() ? agents.filter(function (agent) {
        return agent && agent.source === "external";
      }) : agents;
    }

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
        if (event.target.closest("[data-mission-retry]")) { self.refreshAll(true); return; }
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
          self.viewMode = "chat";
          self.activeId = ""; self.activeType = ""; self.mission = null;
          self.conversation = null;
          self.mobileDetail = false;
          self.render();
          return;
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
          self.loadApprovalHistory();
          return;
        }
        if (event.target.closest("[data-mission-export]")) {
          self.exportMission();
          return;
        }
        if (event.target.closest("[data-mission-delete]")) {
          self.deleteMission();
          return;
        }
        if (event.target.closest("[data-mission-archive]")) {
          self.archiveMission();
          return;
        }
        if (event.target.closest("[data-mission-duplicate]")) {
          self.duplicateMission();
          return;
        }
        const detailTab = event.target.closest("[data-detail-tab]");
        if (detailTab) { self.detailTab = detailTab.getAttribute("data-detail-tab"); self.render(); return; }
        const approval = event.target.closest("[data-approval-decision]");
        if (approval) {
          const card = approval.closest(".mission-approval");
          const option = card ? card.querySelector('input[type="radio"]:checked, select') : null;
          const note = card ? card.querySelector('input[type="text"], input:not([type])') : null;
          self.resolveApproval(
            approval.getAttribute("data-approval-decision"),
            approval.getAttribute("data-approval-action"),
            option ? option.value : "",
            note ? note.value : ""
          );
          return;
        }
        const approvalMission = event.target.closest("[data-open-approval-mission]");
        if (approvalMission) {
          self.selectMission(approvalMission.getAttribute("data-open-approval-mission"));
          return;
        }
        const approvalFilter = event.target.closest("[data-approval-filter]");
        if (approvalFilter) {
          self.approvalFilter = approvalFilter.getAttribute("data-approval-filter") || "pending";
          self.render();
          if (self.approvalFilter !== "pending" && !self.approvalHistory) {
            self.loadApprovalHistory();
          }
          return;
        }
        const bulkApproval = event.target.closest("[data-approval-bulk]");
        if (bulkApproval) {
          self.bulkResolve(bulkApproval.getAttribute("data-approval-bulk"));
          return;
        }
        const bulkTask = event.target.closest("[data-task-bulk]");
        if (bulkTask) {
          const action = bulkTask.getAttribute("data-task-bulk");
          if (action === "clear") {
            self.selectedTasks.clear();
            self.render();
          } else {
            self.bulkTaskAction(action);
          }
          return;
        }
        const editTask = event.target.closest("[data-task-edit]");
        if (editTask) {
          self.taskEditId = editTask.getAttribute("data-task-edit");
          self.render();
          return;
        }
        if (event.target.closest("[data-task-edit-close]")) {
          self.taskEditId = "";
          self.render();
          return;
        }
        if (event.target.closest("[data-message-search-toggle]")) {
          self.messageSearchOpen = true;
          self.render();
          const input = self.root.querySelector("#missionMessageSearch");
          if (input) input.focus();
          return;
        }
        if (event.target.closest("[data-message-search-clear]")) {
          self.messageQuery = "";
          self.messageSearchOpen = false;
          self.render();
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
        const acceptTask = event.target.closest("[data-task-accept]");
        if (acceptTask) { self.patchTask(acceptTask.getAttribute("data-task-accept"), { status: "done" }); return; }
        const sendBack = event.target.closest("[data-task-sendback]");
        if (sendBack) { self.patchTask(sendBack.getAttribute("data-task-sendback"), { status: "in_progress" }); return; }
        const blockTask = event.target.closest("[data-task-block]");
        if (blockTask) {
          self.patchTask(blockTask.getAttribute("data-task-block"), {
            status: "blocked", blockedReason: "老板手动标记阻塞"
          });
          return;
        }
        const resumeTask = event.target.closest("[data-task-resume]");
        if (resumeTask) { self.patchTask(resumeTask.getAttribute("data-task-resume"), { status: "in_progress" }); return; }
        if (event.target.closest("[data-ai-discuss]")) { self.discuss(); return; }
        const autorun = event.target.closest("[data-mission-autorun]");
        if (autorun) {
          self.startAutorun(autorun.getAttribute("data-mission-autorun") === "discuss");
          return;
        }
        if (event.target.closest("[data-mission-autorun-stop]")) { self.stopAutorun(); return; }
        if (event.target.closest("[data-mission-recommend]")) {
          self.refreshRecommendation(false);
          return;
        }
        if (event.target.closest("[data-mission-ai-settings]")) {
          if (AO.aiSetup) AO.aiSetup.open();
          else if (self.renderer && self.renderer.update) self.renderer.update.open();
          return;
        }
        if (event.target.closest("[data-mission-open-external]")) {
          if (self.renderer && self.renderer.external) self.renderer.external.open();
          return;
        }
        if (event.target.closest("[data-mission-budget-save]")) {
          self.saveBudget();
          return;
        }
        if (event.target.closest("[data-mission-next-round]")) {
          self.startNextRound();
          return;
        }
        const template = event.target.closest("[data-mission-template]");
        if (template) {
          self.applyMissionTemplate(template.getAttribute("data-mission-template"));
          return;
        }
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
        const memberTasks = event.target.closest("[data-member-tasks]");
        if (memberTasks) {
          self.taskAgentFilter = memberTasks.getAttribute("data-member-tasks") || "";
          self.detailTab = "tasks";
          self.render();
          return;
        }
        if (event.target.closest("[data-task-filter-clear]")) {
          self.taskAgentFilter = "";
          self.render();
          return;
        }
        const missionFilter = event.target.closest("[data-mission-filter]");
        if (missionFilter) {
          self.missionFilter = missionFilter.getAttribute("data-mission-filter") || "all";
          self.render();
          return;
        }
      });
      this.root.addEventListener("submit", function (event) {
        if (event.target.id === "missionChatForm") { event.preventDefault(); self.sendMessage(); }
        if (event.target.id === "missionCreateForm") { event.preventDefault(); self.submitForm(event.target); }
        if (event.target.id === "missionTaskEditForm") { event.preventDefault(); self.saveTaskEdit(event.target); }
      });
      this.root.addEventListener("input", function (event) {
        if (event.target.id === "missionDraft") self.draft = event.target.value;
        if (event.target.id === "missionMessageSearch") {
          self.messageQuery = event.target.value;
          self.applyMessageFilter();
        }
        if (event.target.id === "missionSearch") {
          self.search = event.target.value;
          self.renderSidebarOnly();
        }
        if (self.formMode === "mission" &&
            ["title", "description", "acceptance", "priority"].indexOf(event.target.name) >= 0) {
          window.clearTimeout(self.recommendTimer);
          self.recommendTimer = window.setTimeout(function () {
            self.refreshRecommendation(false);
          }, 800);
        }
      });
      this.root.addEventListener("change", function (event) {
        if (event.target.matches("[data-approval-select-all]")) {
          const boxes = Array.from(self.root.querySelectorAll("[data-approval-select]"));
          boxes.forEach(function (box) {
            box.checked = event.target.checked;
            if (box.checked) self.selectedApprovals.add(box.getAttribute("data-approval-select"));
            else self.selectedApprovals.delete(box.getAttribute("data-approval-select"));
          });
          self.syncBulkBar();
          return;
        }
        const approvalSelect = event.target.closest("[data-approval-select]");
        if (approvalSelect) {
          const id = approvalSelect.getAttribute("data-approval-select");
          if (approvalSelect.checked) self.selectedApprovals.add(id);
          else self.selectedApprovals.delete(id);
          self.syncBulkBar();
          return;
        }
        const taskSelect = event.target.closest("[data-task-select]");
        if (taskSelect) {
          const id = taskSelect.getAttribute("data-task-select");
          if (taskSelect.checked) self.selectedTasks.add(id);
          else self.selectedTasks.delete(id);
          self.render();
          return;
        }
        const reassign = event.target.closest("[data-task-reassign]");
        if (reassign) {
          self.patchTask(reassign.getAttribute("data-task-reassign"), {
            assigneeId: reassign.value
          });
          return;
        }
        if (event.target.id === "missionFilesUpload") {
          self.uploadFilesTab(Array.from(event.target.files || []));
          return;
        }
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
        if (event.target.matches && event.target.matches("[data-task-agent-filter]")) {
          self.taskAgentFilter = event.target.value || "";
          self.render();
          return;
        }
        if (event.target.id === "missionAutoTeam") {
          self.autoTeam = event.target.checked;
          if (self.autoTeam && self.recommendation) {
            self.selectedAgents = (self.recommendation.suggestedMemberIds || []).slice();
            self.syncTaskExecutors();
            self.renderTeamPickerOnly();
          }
        }
        if (event.target.matches && event.target.matches("[data-task-executor]")) {
          const key = event.target.getAttribute("data-task-executor");
          self.taskExecutors[key] = event.target.value;
          const task = ((self.recommendation && self.recommendation.tasks) || [])
            .find((row) => row.key === key);
          const agent = task && (task.recommended || [])
            .find((row) => row.id === event.target.value);
          if (agent && agent.estimate) {
            const cell = event.target.closest(".mission-plan-row");
            const estimate = cell && cell.querySelector("em");
            if (estimate) estimate.textContent = "~" + agent.estimate.minutes + "m · ~" +
              Math.round(agent.estimate.tokens / 100) / 10 + "k tokens";
          }
          self.autoTeam = false;
          const auto = self.root.querySelector("#missionAutoTeam");
          if (auto) auto.checked = false;
        }
        if (event.target.matches && event.target.matches("[data-team-agent]")) {
          const id = event.target.getAttribute("data-team-agent");
          const index = self.selectedAgents.indexOf(id);
          if (event.target.checked && index < 0) self.selectedAgents.push(id);
          if (!event.target.checked && index >= 0) self.selectedAgents.splice(index, 1);
          self.teamTouched = true;
          if (!event.target.checked) self.autoTeam = false;
          self.syncTaskExecutors();
          const auto = self.root.querySelector("#missionAutoTeam");
          if (auto) auto.checked = self.autoTeam;
          self.renderTeamPickerOnly();
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
      document.addEventListener("agent-office:ai-ready", function () {
        if (!self.isOpen) return;
        self.applyAIReady();
      });
      document.addEventListener("agent-office:demo-change", function () {
        if (!self.isOpen) return;
        self.selectedAgents = [];
        self.recommendation = null;
        self.refreshAll(false);
      });
    }

    async applyAIReady() {
      try {
        const data = await this.api("/missions/overview", null, 8000);
        this.ai = data.ai || { available: false, provider: "" };
        if (this.formMode === "mission") {
          const input = this.root.querySelector("#missionAutoRun");
          const note = this.root.querySelector("[data-mission-ai-state]");
          if (input) {
            input.disabled = false;
            if (!input.checked) input.checked = true;
          }
          if (note) note.innerHTML = this.aiStateHTML();
          const hint = this.root.querySelector(".mission-ai-note");
          if (hint) {
            hint.textContent = this.t("missionAutoRunHint");
            hint.classList.remove("mission-ai-note");
            hint.classList.add("mission-auto-note");
          }
          return;
        }
        if (this.mission) await this.loadActive();
        this.render();
      } catch (err) {}
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

    async uploadFilesTab(files) {
      if (!this.mission || !files.length || this.filesUploading) return;
      this.filesUploading = true;
      this.render();
      try {
        for (const file of files) {
          await this.upload(file, this.mission.id,
            (this.conversation && this.conversation.id) || "");
        }
        this.toast(this.t("missionFileUploaded"));
        await this.loadActive();
        await this.refreshOverview();
      } catch (err) {
        this.toast(this.t("missionFileUploadFailed") + String(err.message || err));
      } finally {
        this.filesUploading = false;
        this.render();
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
      this.viewMode = "chat";
      this.approvalFilter = "pending";
      this.clearReplyPending();
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
        this.stream.addEventListener("overview", function () {
          window.clearTimeout(self.overviewRefreshTimer);
          self.overviewRefreshTimer = window.setTimeout(function () {
            self.refreshOverview();
          }, 120);
        });
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
      if (this.autoRunTimer) window.clearInterval(this.autoRunTimer);
      this.autoRunTimer = null;
    }

    isEditing() {
      const active = document.activeElement;
      return !!(active && this.root.contains(active) &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA"));
    }

    async refreshOverview() {
      try {
        const data = await this.api("/missions/overview", null, 8000);
        const wasLost = this.connectionLost;
        this.connectionLost = false;
        const before = JSON.stringify(this.data);
        const beforeMission = JSON.stringify(this.mission);
        const wantedId = this.activeId;
        const wantedType = this.activeType;
        this.data = {
          missions: data.missions || [],
          conversations: data.conversations || [],
          approvals: data.approvals || [],
          agents: this.visibleAgents(data.agents),
          artifacts: data.artifacts || []
        };
        this.ai = data.ai || { available: false, provider: "" };
        if (wantedId && wantedType === "mission") {
          const detail = await this.api("/missions/" + encodeURIComponent(wantedId), null, 8000);
          if (this.activeId !== wantedId || this.activeType !== wantedType) return;
          this.mission = detail.mission || null;
        } else if (this.activeId !== wantedId) {
          return;
        }
        const changed = wasLost || before !== JSON.stringify(this.data) ||
          beforeMission !== JSON.stringify(this.mission);
        if (changed && !this.formMode && !this.artifactFocus) {
          if (this.isEditing()) this.renderSidebarOnly();
          else this.render();
        }
      } catch (err) {
        if (!this.connectionLost) {
          this.connectionLost = true;
          if (!this.formMode && !this.artifactFocus && !this.isEditing()) this.render();
        }
      }
    }

    async refreshAll(showToast) {
      if (this.busy) return;
      this.busy = true;
      try {
        const data = await this.api("/missions/overview", null, 10000);
        this.connectionLost = false;
        this.data = {
          missions: data.missions || [],
          conversations: data.conversations || [],
          approvals: data.approvals || [],
          agents: this.visibleAgents(data.agents),
          artifacts: data.artifacts || []
        };
        this.ai = data.ai || { available: false, provider: "" };
        if (!this.activeId && window.innerWidth > 700) {
          const firstMission = this.data.missions.find(function (mission) {
            return !mission.archived;
          }) || this.data.missions[0];
          if (firstMission) {
            this.activeType = "mission";
            this.activeId = firstMission.id;
          } else if (this.data.conversations.length) {
            this.activeType = this.data.conversations[0].kind;
            this.activeId = this.data.conversations[0].id;
          }
        }
        await this.loadActive();
        this.render();
        if (showToast) this.toast(this.t("missionRefreshed"));
      } catch (err) {
        this.connectionLost = true;
        this.toast(this.t("missionBridgeOffline"));
        this.render();
      } finally {
        this.busy = false;
      }
    }

    async loadActive() {
      const seq = ++this.loadSeq;
      const wantedId = this.activeId;
      const wantedType = this.activeType;
      const stale = () => seq !== this.loadSeq;
      this.mission = null;
      this.conversation = null;
      this.messages = [];
      if (!wantedId) return;
      try {
        if (wantedType === "mission") {
          const detail = await this.api("/missions/" + encodeURIComponent(wantedId), null, 10000);
          if (stale()) return;
          this.mission = detail.mission || null;
          if (!this.mission) {
            if (!stale()) this.activeId = "";
            return;
          }
          this.activeId = this.mission.id;
          const conv = await this.api("/conversations/" + encodeURIComponent(this.mission.conversationId));
          if (stale()) return;
          this.conversation = conv.conversation || null;
        } else {
          const conv = await this.api("/conversations/" + encodeURIComponent(wantedId));
          if (stale()) return;
          this.conversation = conv.conversation || null;
          this.mission = this.data.missions.find(function (m) {
            return m.conversationId === (conv.conversation || {}).id;
          }) || null;
        }
        if (this.conversation) {
          const data = await this.api("/conversations/" + encodeURIComponent(this.conversation.id) +
            "/messages?since=0");
          if (stale()) return;
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
      this.taskAgentFilter = "";
      this.detailTab = "overview";
      this.messageQuery = "";
      this.messageSearchOpen = false;
      this.clearReplyPending();
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
      this.taskAgentFilter = "";
      this.mission = null;
      this.messageQuery = "";
      this.messageSearchOpen = false;
      this.clearReplyPending();
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
        ((this.mission && this.mission.members) || []).find((a) => a.id === id) ||
        ((this.conversation && this.conversation.members) || []).find((a) => a.id === id) || null;
    }

    agentAvatar(agent, extraClass) {
      const name = agent ? this.agentName(agent) : "?";
      const text = (agent && agent.logoText) || initials(name);
      const color = (agent && (agent.logoColor || agent.color)) || "#7cb7ff";
      const title = (agent && agent.brand) ? agent.brand : name;
      const emoji = agent && agent.avatar && agent.avatar !== "auto" && agent.avatar !== "custom";
      const logoAgent = agent || { logoText: text, logoUrl: "" };
      return '<span class="mission-avatar ' + (extraClass || '') +
        (emoji ? ' avatar-emoji' : '') + AO.logoClass(logoAgent) +
        '" style="--c:' + esc(color) + '" title="' + esc(title) + '">' +
        AO.logoMarkHTML(logoAgent) + '</span>';
    }

    messageAvatar(message) {
      if (message.senderType === "boss") {
        return '<span class="mission-avatar boss" style="--c:#55d6c2" title="Boss">B</span>';
      }
      return this.agentAvatar(this.agentById(message.senderId), "message-logo");
    }

    agentName(agent) {
      if (!agent) return "";
      return AO.lang === "en" ? (agent.titleEn || agent.name || agent.id)
        : (agent.titleZh || agent.name || agent.id);
    }

    missionStatus(mission) {
      if (!mission) return "";
      const auto = mission.autoRun || {};
      if (auto.status === "error") return this.t("missionAutoRunError");
      if (auto.status === "running" || auto.status === "discussing" || auto.status === "starting") {
        return this.t("missionAutoRunRunning");
      }
      if (auto.status === "stopped") return this.t("missionAutoRunStopped");
      if (auto.status === "scheduled") return this.t("missionAutoRunScheduled");
      if (mission.stats && mission.stats.progress >= 100) return this.t("missionDone");
      if (mission.stats && mission.stats.blocked) return this.t("missionBlocked");
      if (mission.stats && mission.stats.approvals) return this.t("missionWaitingBoss");
      if (mission.status === "review" || (mission.stats && mission.stats.review)) {
        return this.t("statusReview");
      }
      return this.t("missionActive");
    }

    missionDisplayStatus(mission) {
      const auto = mission.autoRun || {};
      const stats = mission.stats || {};
      if (auto.status === "error") return "blocked";
      if (auto.status === "running" || auto.status === "discussing" || auto.status === "starting") {
        return "active";
      }
      if (auto.status === "scheduled") return "waiting";
      if (Number(stats.progress || 0) >= 100) return "done";
      if (Number(stats.approvals || 0) > 0) return "waiting";
      if (Number(stats.blocked || 0) > 0) return "blocked";
      if (Number(stats.review || 0) > 0) return "review";
      return "active";
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
      const prevBox = this.root.querySelector("#missionMessages");
      const prevConv = this.renderedConvId || "";
      const currentConv = (this.conversation && this.conversation.id) || "";
      const nearBottom = !prevBox ||
        prevBox.scrollHeight - prevBox.scrollTop - prevBox.clientHeight < 70;
      const stickBottom = nearBottom || prevConv !== currentConv;
      const prevScroll = prevBox ? prevBox.scrollTop : 0;
      const openTasks = Array.from(this.root.querySelectorAll(".mission-task[open]")).map(function (node) {
        return node.getAttribute("data-mission-task");
      }).filter(Boolean);
      const detailBody = this.root.querySelector(".mission-detail-body");
      const detailScroll = detailBody ? detailBody.scrollTop : 0;
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
        (this.connectionLost ?
          '<button class="mission-head-btn danger" type="button" data-mission-retry title="' +
          esc(this.t("missionBridgeOffline")) + '">重试连接 ↻</button>' : '') +
        '<button class="mission-head-btn ghost" type="button" data-mission-refresh title="refresh">↻</button>' +
        '<button class="mission-head-btn ghost close" type="button" data-mission-close>×</button>' +
        '</div></header>' +
        '<div class="mission-body">' + this.renderSidebar() + this.renderMain() + this.renderDetail() + '</div>' +
        this.renderForm() + this.renderArtifact() + this.renderTaskEdit();
      this.renderedConvId = currentConv;
      const box = this.root.querySelector("#missionMessages");
      if (box) box.scrollTop = stickBottom ? box.scrollHeight : prevScroll;
      openTasks.forEach((taskId) => {
        const node = this.root.querySelector('.mission-task[data-mission-task="' + taskId + '"]');
        if (node) node.setAttribute("open", "");
      });
      const nextDetail = this.root.querySelector(".mission-detail-body");
      if (nextDetail) nextDetail.scrollTop = detailScroll;
      if (this.messageQuery) this.applyMessageFilter();
    }

    renderSidebar() {
      const self = this;
      const needle = String(this.search || "").trim().toLowerCase();
      const allMissions = (this.data.missions || []).filter(function (m) {
        if (!needle) return true;
        return [m.title, m.description, m.goal].some(function (value) {
          return String(value || "").toLowerCase().includes(needle);
        });
      });
      const matchesFilter = function (mission) {
        const stats = mission.stats || {};
        const progress = Number(stats.progress || 0);
        const archived = !!mission.archived;
        if (self.missionFilter === "archived") return archived;
        if (archived) return false;
        if (self.missionFilter === "active") return progress < 100;
        if (self.missionFilter === "approvals") return Number(stats.approvals || 0) > 0;
        if (self.missionFilter === "done") return progress >= 100;
        return true;
      };
      const missions = allMissions.filter(matchesFilter);
      const counts = {
        all: allMissions.filter(function (m) { return !m.archived; }).length,
        active: allMissions.filter(function (m) { return !m.archived && Number((m.stats || {}).progress || 0) < 100; }).length,
        approvals: allMissions.filter(function (m) { return !m.archived && Number((m.stats || {}).approvals || 0) > 0; }).length,
        done: allMissions.filter(function (m) { return !m.archived && Number((m.stats || {}).progress || 0) >= 100; }).length,
        archived: allMissions.filter(function (m) { return !!m.archived; }).length
      };
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
        const showStatus = self.missionDisplayStatus(mission);
        const lastAt = Math.max(Number(mission.updatedAt) || 0,
          Number(conv && conv.updatedAt) || 0);
        const lastText = lastAt ? new Date(lastAt).toLocaleString(AO.lang === "en" ? "en" : "zh-CN",
          { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
        return '<button class="mission-item' + (active ? ' active' : '') + (mission.archived ? ' is-archived' : '') + '" type="button" data-mission-id="' +
          esc(mission.id) + '" title="' + esc(self.missionStatus(mission) +
            (mission.priority ? " · P" + mission.priority : "") + (lastText ? " · " + lastText : "")) +
          '"><span class="mission-item-dot ' + esc(showStatus) + '"></span>' +
          '<span class="mission-item-copy"><b>' + esc(mission.title) + '</b><em>' +
          esc(self.missionStatus(mission)) + ' · ' +
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
          self.agentAvatar(member, "conv-logo") +
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
        (this.sideTab === "missions" ?
          '<div class="mission-list-filters">' +
          [["all", this.t("missionFilterAll")], ["active", this.t("missionFilterActive")],
           ["approvals", this.t("missionFilterApprovals")], ["done", this.t("missionFilterDone")],
           ["archived", this.t("missionFilterArchived")]]
            .map(function (row) {
              return '<button type="button" data-mission-filter="' + row[0] + '" class="' +
                (self.missionFilter === row[0] ? "active" : "") + '">' + esc(row[1]) +
                ' <b>' + (counts[row[0]] || 0) + '</b></button>';
            }).join("") + '</div>' : '') +
        '<div class="mission-list">' +
        (this.sideTab === "missions" ? (missions.map(missionItem).join("") ||
          '<div class="mission-empty small">' +
          esc(this.t(this.search ? "missionNoSearchResults" : "missionNoMissions")) + '</div>')
          : (conversations.map(convItem).join("") ||
          '<div class="mission-empty small">' +
          esc(this.t(this.search ? "missionNoSearchResults" : "missionNoConversations")) + '</div>')) +
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
        '<button type="button" class="mission-mini" data-message-search-toggle title="' +
        esc(this.t("missionSearchMessages")) + '">⌕</button>' +
        '<button type="button" class="mission-mini mission-mobile-detail" data-mobile-detail>☰</button>' +
        (isMission ? '<button type="button" class="mission-mini" data-ai-discuss>' +
          (this.mission.discussion && this.mission.discussion.status === "running" ? '… ' : '✦ ') +
          esc(this.t("missionAiDiscuss")) + '</button>' : '') +
        (isMission ? '<button type="button" class="mission-mini" data-detail-tab="tasks">' +
          esc(this.t("missionTabTasks")) + '</button>' : '') +
        (isMission ? '<button type="button" class="mission-mini" data-mission-export>↓ ' +
          esc(this.t("missionExport")) + '</button>' : '') +
        '</div></header>' +
        (isMission ? this.missionCommand(this.mission) : '') +
        '<div class="mission-message-search"' + (this.messageSearchOpen ? "" : " hidden") + '>' +
        '<input id="missionMessageSearch" type="search" value="' + esc(this.messageQuery) +
        '" placeholder="' + esc(this.t("missionSearchMessages")) + '" />' +
        '<span id="missionMessageSearchCount"></span>' +
        '<button type="button" data-message-search-clear aria-label="' +
        esc(this.t("missionSearchClear")) + '">×</button></div>' +
        '<div class="mission-messages" id="missionMessages">' +
        (this.messages.length ? this.messages.map((m) => this.messageHTML(m)).join("") :
          '<div class="mission-empty small">' + esc(this.t("missionNoMessagesHint")) + '</div>') +
        (this.replyPending && this.replyPendingConversation === (this.conversation && this.conversation.id) ?
          '<div class="mission-typing"><span><i></i><i></i><i></i></span>' +
          esc(this.t("missionTyping")) + '</div>' : "") +
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
      const filter = this.approvalFilter || "pending";
      const all = this.approvalHistory || null;
      let approvals;
      if (filter === "pending") {
        approvals = this.data.approvals || [];
      } else if (!all) {
        approvals = [];
      } else if (filter === "resolved") {
        approvals = all.filter(function (a) { return a.status !== "pending"; });
      } else {
        approvals = all;
      }
      const tabs = [["pending", "missionApprovalPendingTab"],
        ["resolved", "missionApprovalResolvedTab"], ["all", "missionApprovalAllTab"]];
      const bulkable = filter === "pending" ? approvals.filter(function (a) {
        return a.type !== "decision";
      }) : [];
      const bulkSelected = bulkable.filter(function (a) {
        return this.selectedApprovals.has(a.id);
      }, this).length;
      const bulkBar = bulkable.length > 1 ?
        '<div class="mission-bulk-bar"><label><input type="checkbox" data-approval-select-all' +
        (bulkSelected === bulkable.length ? " checked" : "") + ' /> ' +
        esc(this.t("missionBulkSelectAll")) + '</label><span>' +
        esc(this.t("missionBulkSelected", { count: bulkSelected })) + '</span>' +
        '<button type="button" data-approval-bulk="approved"' + (bulkSelected ? "" : " disabled") +
        '>' + esc(this.t("missionBulkApprove")) + '</button>' +
        '<button type="button" class="danger" data-approval-bulk="rejected"' +
        (bulkSelected ? "" : " disabled") + '>' + esc(this.t("missionBulkReject")) + '</button>' +
        (approvals.some(function (a) { return a.type === "decision"; }) ?
          '<em>' + esc(this.t("missionBulkDecisionHint")) + '</em>' : "") + '</div>' : "";
      return '<main class="mission-main mission-inbox"><header class="mission-chat-head">' +
        '<button type="button" class="mission-mobile-back" data-mobile-back>‹ ' +
        esc(this.t("missionTabTasks")) + '</button>' +
        '<div><span class="mission-kicker">BOSS INBOX</span><h3>' + esc(this.t("missionBossInbox")) +
        '</h3><p>' + esc(this.t("missionBossInboxHint")) + '</p></div></header>' +
        '<div class="mission-approval-filters">' + tabs.map((row) =>
          '<button type="button" data-approval-filter="' + row[0] + '" class="' +
          (filter === row[0] ? "active" : "") + '">' + esc(this.t(row[1])) +
          (row[0] === "pending" && (this.data.approvals || []).length ?
            ' <b>' + this.data.approvals.length + '</b>' : "") + '</button>').join("") +
        '</div>' + bulkBar + '<div class="mission-inbox-list">' +
        (this.approvalLoading && filter !== "pending" ?
          '<div class="mission-empty small">' + esc(this.t("missionApprovalLoading")) + '</div>' :
          approvals.length ? approvals.map((a) => this.approvalHTML(a, true, filter === 'pending' && a.type !== 'decision')).join("") :
          '<div class="mission-empty small">' + esc(filter === "pending" ?
            this.t("missionNoApprovals") : this.t("missionApprovalNoHistory")) + '</div>') +
        '</div></main>';
    }

    syncBulkBar() {
      const bar = this.root.querySelector(".mission-bulk-bar");
      if (!bar) return;
      const boxes = Array.from(bar.parentNode.querySelectorAll("[data-approval-select]"));
      const count = boxes.filter(function (box) { return box.checked; }).length;
      const label = bar.querySelector("span");
      if (label) label.textContent = this.t("missionBulkSelected", { count: count });
      bar.querySelectorAll("[data-approval-bulk]").forEach(function (button) {
        button.disabled = count === 0 || this.bulkBusy;
      }, this);
      const all = bar.querySelector("[data-approval-select-all]");
      if (all) {
        all.checked = boxes.length > 0 && count === boxes.length;
        all.indeterminate = count > 0 && count < boxes.length;
      }
    }

    async bulkResolve(decision) {
      if (this.bulkBusy) return;
      const ids = Array.from(this.selectedApprovals).filter((id) => {
        return (this.data.approvals || []).some(function (approval) {
          return approval.id === id && approval.type !== "decision";
        });
      });
      if (!ids.length) return;
      this.bulkBusy = true;
      this.syncBulkBar();
      let done = 0;
      for (const id of ids) {
        try {
          await this.api("/approvals/" + encodeURIComponent(id) + "/resolve", {
            method: "POST",
            body: JSON.stringify({ decision: decision, optionId: "", note: "" })
          });
          done += 1;
        } catch (err) {}
      }
      this.selectedApprovals.clear();
      this.bulkBusy = false;
      this.toast(this.t("missionBulkDone", { done: done, total: ids.length }));
      await this.refreshAll(false);
      await this.loadActive();
      this.render();
    }

    async loadApprovalHistory() {
      if (this.approvalLoading) return;
      this.approvalLoading = true;
      try {
        const data = await this.api("/approvals", null, 8000);
        this.approvalHistory = data.approvals || [];
      } catch (err) {
        this.approvalHistory = this.approvalHistory || [];
        this.toast(this.t("missionBridgeOffline"));
      } finally {
        this.approvalLoading = false;
        if (this.viewMode === "approvals") this.render();
      }
    }

    renderDetail() {
      if (!this.mission && !this.conversation) return '<aside class="mission-detail"></aside>';
      const tabs = this.mission ? [
        ["overview", this.t("missionOverview")],
        ["tasks", this.t("missionTabTasks")],
        ["eval", this.t("missionEval")],
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
      if (this.detailTab === "eval") return this.evalTab();
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
      const coverageDone = !!coverage.completed ||
        (Number(stats.tasks || 0) > 0 && Number(stats.done || 0) >= Number(stats.tasks || 0));
      const nextCard = coverageDone ?
        '<div class="mission-next-card"><span>NEXT ROUND</span><b>' +
        esc(this.t("missionNextRoundCardTitle")) + '</b><p>' +
        esc(this.t("missionNextRoundHint")) + '</p><div class="mission-next-actions">' +
        '<button type="button" class="mission-command-btn primary" data-mission-next-round' +
        (this.nextRoundBusy ? ' disabled' : '') + '>' +
        esc(this.t(this.nextRoundBusy ? "missionNextRoundBusy" : "missionNextRound")) + '</button>' +
        '<button type="button" class="mission-command-btn" data-detail-tab="eval">' +
        esc(this.t("missionReview")) + '</button></div></div>' : '';
      return '<div class="mission-panel">' +
        '<div class="mission-stat-row"><div><b>' + (stats.progress || 0) + '%</b><span>' +
        esc(this.t("missionProgress")) + '</span></div><div><b>' + (stats.tasks || 0) + '</b><span>' +
        esc(this.t("missionTabTasks")) + '</span></div><div><b>' + (stats.review || 0) + '</b><span>' +
        esc(this.t("statusReview")) + '</span></div><div><b>' + (stats.approvals || 0) + '</b><span>' +
        esc(this.t("missionApprovals")) + '</span></div></div>' +
        this.autorunHTML(m) +
        '<div class="mission-coverage ' + ((coverageDone || coverage.noIdle) ? 'ok' : 'bad') + '"><b>' +
        esc(coverageDone ? this.t("missionAllDoneCoverage") :
          (coverage.noIdle ? this.t("missionNoIdle") : this.t("missionIdle"))) + '</b><p>' +
        esc(coverageDone ? this.t("missionAllDoneCoverageHint", { total: coverage.total || 0 }) :
          this.t("missionCoverageHint", { assigned: coverage.assigned || 0, total: coverage.total || 0 })) +
        '</p></div>' + nextCard +
        '<h4>' + esc(this.t("missionGoal")) + '</h4><p class="mission-copy">' + esc(m.description) + '</p>' +
        '<h4>' + esc(this.t("missionAcceptance")) + '</h4><p class="mission-copy">' + esc(m.acceptance) + '</p>' +
        (m.budget ? '<p class="mission-note">' + esc(this.t("missionBudget")) + '：' + esc(m.budget) + ' ' + esc(m.currency) + '</p>' : '') +
        (m.tokenBudget ? '<p class="mission-note">' + esc(this.t("missionTokenBudget")) + '：' +
          fmtTokens(m.tokenBudget) + ' tokens · ' + esc(this.t("missionTokenBudgetUsed")) + ' ' +
          fmtTokens((m.evaluation && m.evaluation.totalTokens) || 0) + '</p>' : '') +
        (m.deadline ? '<p class="mission-note">' + esc(this.t("missionDeadline")) + '：' + esc(m.deadline) + '</p>' : '') +
        '<p class="mission-note">' + esc(this.t("missionContextHint")) + '</p>' +
        '<div class="mission-discussion-card"><div><b>' + esc(this.t("missionAiDiscuss")) + '</b><p>' +
        esc(discussion.status === "done" ? this.t("missionAiDone") :
          discussion.status === "running" || discussion.status === "queued" ? this.t("missionAiRunning") :
          discussion.status === "error" ? this.t("missionAiError") :
          discussion.status === "unavailable" ? (this.ai.available ? this.t("missionAiReadyRetry") : this.t("missionAiUnavailable")) :
          this.t("missionAiPending")) +
        '</p>' + (discussion.error && !(discussion.status === "unavailable" && this.ai.available) ?
          '<small>' + esc(short(discussion.error, 180)) + '</small>' : '') +
        '</div><div class="mission-discussion-actions">' +
        (this.ai.available ? '' : '<button class="mission-mini" type="button" data-mission-ai-settings>' +
          esc(this.t("missionAiSettings")) + '</button>') +
        '<button class="mission-mini" type="button" data-ai-discuss>' +
        esc(discussion.status === "done" || discussion.status === "partial" ?
          this.t("missionAiRediscuss") : this.t("missionAiDiscussOnly")) + '</button></div></div>' +
        (decisions.length ? '<h4>' + esc(this.t("missionDecisions")) + '</h4>' +
          decisions.map((d) => '<div class="mission-decision"><b>' + esc(d.topic) + '</b><p>' +
            esc(d.outcome) + '</p><small>' + esc(d.decidedBy || 'team') + ' · ' + esc(fmtTime(d.createdAt)) + '</small></div>').join('') : '') +
        '<div class="mission-danger-zone"><p>' + esc(this.t("missionDeleteHint")) + '</p>' +
        '<div class="mission-danger-actions">' +
        '<button type="button" class="mission-mini" data-mission-duplicate>' +
        esc(this.t("missionDuplicate")) + '</button>' +
        '<button type="button" class="mission-mini" data-mission-archive>' +
        esc(this.t(m.archived ? "missionUnarchive" : "missionArchive")) + '</button>' +
        '<button type="button" class="mission-danger small" data-mission-delete>' +
        esc(this.t("missionDelete")) + '</button></div></div>' +
        '</div>';
    }

    tasksTab() {
      const m = this.mission;
      if (!m) return "";
      const all = m.tasks || [];
      const members = m.members || [];
      const tasks = this.taskAgentFilter ?
        all.filter((task) => task.assigneeId === this.taskAgentFilter) : all;
      const filterName = (members.find((item) => item.id === this.taskAgentFilter) || {}).titleZh ||
        (members.find((item) => item.id === this.taskAgentFilter) || {}).name || "";
      const options = '<option value="">' + esc(this.t("missionAllAgents")) + '</option>' +
        members.map((member) => '<option value="' + esc(member.id) + '"' +
          (member.id === this.taskAgentFilter ? " selected" : "") + '>' +
          esc(this.agentName(member)) + '</option>').join("");
      const selected = all.filter((task) => this.selectedTasks.has(task.id));
      const selectedReview = selected.filter((task) => task.status === "review");
      const selectedOpen = selected.filter((task) => task.status !== "done");
      const bulk = selected.length ?
        '<div class="mission-task-bulk"><span>' +
        esc(this.t("missionBulkSelected", { count: selected.length })) + '</span>' +
        '<button type="button" data-task-bulk="accept"' + (selectedReview.length ? "" : " disabled") +
        '>' + esc(this.t("missionAcceptDone")) + '</button>' +
        '<button type="button" data-task-bulk="block"' + (selectedOpen.length ? "" : " disabled") +
        '>' + esc(this.t("missionBlockTask")) + '</button>' +
        '<button type="button" data-task-bulk="clear">' + esc(this.t("missionCancel")) +
        '</button></div>' : "";
      return '<div class="mission-panel">' +
        '<div class="mission-task-toolbar"><label>' + esc(this.t("missionFilterAgent")) +
        '<select data-task-agent-filter>' + options + '</select></label>' +
        '<span>' + esc(this.t("missionFilteredTasks", {
          count: tasks.length, total: all.length, agent: filterName || this.t("missionAllAgents")
        })) + '</span></div>' + bulk +
        (tasks.map((task) => this.taskHTML(task)).join("") ||
          '<div class="mission-empty small">' + esc(this.t("missionNoTasksForAgent")) + '</div>') +
        '</div>';
    }

    currentTaskId() {
      const m = this.mission;
      if (!m) return "";
      const auto = m.autoRun || {};
      if (auto.currentTaskId) return auto.currentTaskId;
      const tasks = m.tasks || [];
      const active = tasks.find(function (task) { return task.status === "in_progress"; }) ||
        tasks.find(function (task) { return task.status === "review"; });
      return active ? active.id : "";
    }

    taskHTML(task) {
      const approval = (this.mission.approvals || []).find((a) => a.taskId === task.id);
      const pct = taskProgressPercent(task);
      const current = task.id === this.currentTaskId() &&
        task.status !== "done";
      return '<details class="mission-task ' + this.taskClass(task.status) +
        (current ? " is-current" : "") + '" data-mission-task="' + esc(task.id) + '"' +
        (current ? " open" : "") + '><summary>' +
        '<input type="checkbox" class="mission-task-check" data-task-select="' + esc(task.id) + '"' +
        (this.selectedTasks.has(task.id) ? " checked" : "") +
        ' onclick="event.stopPropagation()" aria-label="' + esc(this.t("missionSelectTask")) + '" />' +
        '<span class="mission-task-status"></span><b>' + esc(task.title) + '</b><em>' +
        esc(task.assigneeName || task.assigneeId) + '</em>' +
        (current ? '<i class="mission-task-live">' + esc(this.t("missionCurrent")) + '</i>' : '') +
        '<span>' + esc(this.taskStatus(task.status)) + '</span></summary>' +
        '<div class="mission-task-progress"><i><u style="width:' + pct + '%"></u></i><b>' + pct + '%</b></div>' +
        '<p>' + esc(task.brief) + '</p>' +
        '<div class="mission-task-meta"><span>' + esc(this.t("missionAcceptance")) + '：' +
        esc(task.acceptance) + '</span>' +
        (current && task.startedAt ? '<span>' + esc(this.t("missionStartedAt")) + '：' +
          esc(fmtTime(task.startedAt)) + '</span>' : '') +
        (task.deps && task.deps.length ? '<span>' + esc(this.t("missionDeps")) + '：' +
          esc(task.deps.join(" · ")) + '</span>' : '') +
        (task.assignmentReason ? '<span>' + esc(task.assignmentReason) + '</span>' : '') +
        (task.estimate ? '<span>' + esc(this.t("missionEstimate")) + '：~' +
          fmtDuration(task.estimate.minutes) + ' · ~' + fmtTokens(task.estimate.tokens) +
          ' tokens</span>' : '') +
        (task.actual && (task.actual.minutes || task.actual.tokens || task.actual.durationMs) ?
          '<span>' + esc(this.t("missionActual")) + '：' +
          fmtDuration(task.actual.minutes, task.actual.durationMs) + ' · ' +
          fmtTokens(task.actual.tokens) + ' tokens</span>' : '') +
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
        (task.status === "review" ?
          '<button type="button" class="task-accept" data-task-accept="' + esc(task.id) + '">' +
          esc(this.t("missionAcceptDone")) + '</button>' +
          '<button type="button" data-task-sendback="' + esc(task.id) + '">' +
          esc(this.t("missionSendBack")) + '</button>' : '') +
        (task.status === "blocked" ?
          '<button type="button" data-task-resume="' + esc(task.id) + '">' +
          esc(this.t("missionResumeTask")) + '</button>' :
          (task.status !== "done" ?
            '<button type="button" data-task-block="' + esc(task.id) + '">' +
            esc(this.t("missionBlockTask")) + '</button>' : '')) +
        (task.status !== "done" && (this.mission.members || []).length > 1 ?
          '<select class="mission-task-reassign" data-task-reassign="' + esc(task.id) +
          '" aria-label="' + esc(this.t("missionReassign")) + '">' +
          (this.mission.members || []).map(function (member) {
            return '<option value="' + esc(member.id) + '"' +
              (member.id === task.assigneeId ? " selected" : "") + '>' +
              esc(member.titleZh || member.name || member.id) + '</option>';
          }).join("") + '</select>' : '') +
        '<button type="button" data-copy-protocol="' + esc(task.id) + '">' +
        esc(this.t("missionCopyProtocol")) + '</button>' +
        (task.status !== "done" ? '<button type="button" data-task-edit="' + esc(task.id) +
          '">' + esc(this.t("missionEditTask")) + '</button>' : '') +
        '</div></details>';
    }

    evalTab() {
      const m = this.mission;
      if (!m) return "";
      const ev = m.evaluation || {};
      const tasks = m.tasks || [];
      const budget = Number(ev.tokenBudget || m.tokenBudget || 0);
      const totalTokens = Number(ev.totalTokens || ev.actualTokens || 0);
      const budgetPct = budget ? Math.min(100, Math.round((totalTokens / budget) * 100)) : 0;
      const tokenPct = ev.estimatedTokens ? Math.min(100, Math.round((ev.actualTokens / ev.estimatedTokens) * 100)) : 0;
      const timePct = ev.estimatedMinutes ? Math.min(100, Math.round((ev.actualMinutes / ev.estimatedMinutes) * 100)) : 0;
      const risk = ev.deadlineRisk || "none";
      const riskLabel = risk === "overdue" ? this.t("missionRiskOverdue") :
        risk === "at_risk" ? this.t("missionRiskAtRisk") :
        risk === "ok" ? this.t("missionRiskOk") : this.t("missionRiskNone");
      const rows = tasks.map((task) => {
        const est = task.estimate || {};
        const actual = task.actual || {};
        const delta = (actual.tokens || 0) - (est.tokens || 0);
        return '<div class="mission-eval-row"><span class="mission-eval-status ' + this.taskClass(task.status) +
          '"></span><div><b>' + esc(task.title) + '</b><em>' + esc(task.assigneeName || "") + '</em></div>' +
          '<span>' + fmtDuration(est.minutes) + ' / ' +
          fmtDuration(actual.minutes, actual.durationMs) + '</span>' +
          '<span>' + fmtTokens(est.tokens) + ' / ' + fmtTokens(actual.tokens) + '</span>' +
          '<em class="' + (delta > 0 ? 'over' : 'under') + '">' + (delta >= 0 ? '+' : '') +
          fmtTokens(delta) + '</em></div>';
      }).join("");
      const agents = (ev.agents || []).map((agent) =>
        '<div class="mission-agent-cost">' + (agent.logoText ? '<span class="mission-avatar' +
          AO.logoClass(agent) + '" style="--c:' +
          esc(agent.logoColor || "#7cb7ff") + '">' + AO.logoMarkHTML(agent) + '</span>' : '') +
          '<b>' + esc(agent.name) + '</b><span>' + agent.tasks + ' ' + esc(this.t("missionTasksLower")) +
          '</span><span>' + fmtDuration(agent.estimatedMinutes) + ' / ' +
          fmtDuration(agent.actualMinutes, agent.actualDurationMs) +
          '</span><span>' + fmtTokens(agent.estimatedTokens) + ' / ' + fmtTokens(agent.actualTokens) + '</span></div>'
      ).join("");
      return '<div class="mission-panel mission-eval">' +
        '<div class="mission-eval-grid">' +
        '<div><span>' + esc(this.t("missionEstTime")) + '</span><b>' + fmtDuration(ev.estimatedMinutes) + '</b></div>' +
        '<div><span>' + esc(this.t("missionActualTime")) + '</span><b>' +
        fmtDuration(ev.actualMinutes, ev.actualDurationMs) + '</b></div>' +
        '<div><span>' + esc(this.t("missionEstTokens")) + '</span><b>' + fmtTokens(ev.estimatedTokens) + '</b></div>' +
        '<div><span>' + esc(this.t("missionActualTokens")) + '</span><b>' + fmtTokens(ev.actualTokens) + '</b></div>' +
        '<div><span>' + esc(this.t("missionElapsed")) + '</span><b>' + fmtDuration(ev.elapsedMinutes) + '</b></div>' +
        '<div><span>' + esc(this.t("missionConfidence")) + '</span><b>' + esc(ev.confidence || "medium") + '</b></div>' +
        '</div>' +
        '<div class="mission-eval-bar"><div><span>' + esc(this.t("missionTimeUsage")) + ' ' + timePct + '%</span>' +
        '<i><b style="width:' + timePct + '%"></b></i></div>' +
        '<div><span>' + esc(this.t("missionTokenUsage")) + ' ' + tokenPct + '%</span>' +
        '<i><b style="width:' + tokenPct + '%"></b></i></div></div>' +
        '<div class="mission-budget-editor' + (budget && totalTokens >= budget ? ' over' : '') + '">' +
        '<label>' + esc(this.t("missionTokenBudget")) + '<input id="missionTokenBudget" type="number" min="0" step="1000" value="' +
        (budget || "") + '" placeholder="' + esc(this.t("missionTokenBudgetPh")) + '" /></label>' +
        '<button type="button" class="mission-mini" data-mission-budget-save>' +
        esc(this.t("missionTokenBudgetSave")) + '</button>' +
        '<span>' + esc(this.t("missionTokenBudgetUsed")) + ' ' + fmtTokens(totalTokens) +
        (budget ? ' / ' + fmtTokens(budget) + ' · ' + budgetPct + '%' : '') + '</span></div>' +
        (budget ? '<div class="mission-budget-bar"><i style="width:' + budgetPct + '%"></i></div>' : '') +
        ((ev.discussionTokens || ev.discussionMinutes) ?
          '<p class="mission-note">' + esc(this.t("missionDiscussionUsage")) + '：' +
          fmtDuration(ev.discussionMinutes) + ' · ' + fmtTokens(ev.discussionTokens) +
          ' tokens</p>' : '') +
        '<div class="mission-eval-risk ' + esc(risk) + '"><b>' + esc(this.t("missionDeadlineRisk")) + '：' +
        esc(riskLabel) + '</b><span>' + esc(ev.deadline || this.t("missionNoDeadline")) +
        (ev.deadlineDays !== null && ev.deadlineDays !== undefined ? ' · ' + ev.deadlineDays + 'd' : '') + '</span></div>' +
        '<h4>' + esc(this.t("missionTaskEval")) + '</h4>' +
        '<div class="mission-eval-head"><span></span><span>' + esc(this.t("missionTask")) + '</span><span>' +
        esc(this.t("missionTimeEstimate")) + '</span><span>' + esc(this.t("missionTokenEstimate")) +
        '</span><span>Δ</span></div>' + (rows || '<div class="mission-empty small">—</div>') +
        '<h4>' + esc(this.t("missionAgentCost")) + '</h4>' + (agents || '<div class="mission-empty small">—</div>') +
        '<p class="mission-note">' + esc(this.t("missionEvalHint")) + '</p></div>';
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
      const rows = ((this.mission && this.mission.approvals) || []).slice().sort(function (a, b) {
        if ((a.status === "pending") !== (b.status === "pending")) {
          return a.status === "pending" ? -1 : 1;
        }
        return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      });
      return '<div class="mission-panel">' + (rows.length ? rows.map((a) => this.approvalHTML(a, true)).join("") :
        '<div class="mission-empty small">' + esc(this.t("missionNoApprovals")) + '</div>') + '</div>';
    }

    filesTab() {
      const artifacts = this.mission ? (this.mission.artifacts || []) :
        (this.data.artifacts || []).filter((a) => a.conversationId === (this.conversation && this.conversation.id));
      const upload = this.mission ?
        '<label class="mission-file-add">＋ ' +
        esc(this.filesUploading ? this.t("missionFileUploading") : this.t("missionFileUpload")) +
        '<input type="file" id="missionFilesUpload" multiple' +
        (this.filesUploading ? " disabled" : "") + ' /></label>' : "";
      return '<div class="mission-panel mission-files">' + upload +
        (artifacts.length ? artifacts.map((a) =>
          this.artifactRow(a)).join("") : '<div class="mission-empty small">' +
          esc(this.t("missionNoFiles")) + '</div>') + '</div>';
    }

    membersTab() {
      const members = this.mission ? (this.mission.members || []) :
        ((this.conversation && this.conversation.members) || []);
      const tasks = (this.mission && this.mission.tasks) || [];
      return '<div class="mission-panel mission-members">' + members.map((member) => {
        const mine = tasks.filter((t) => t.assigneeId === member.id);
        const done = mine.filter((t) => t.status === "done").length;
        const open = mine.length - done;
        const pct = mine.length ?
          Math.round(mine.reduce((sum, task) => sum + taskProgressPercent(task), 0) / mine.length) : 0;
        const current = mine.find((t) =>
          ["in_progress", "review", "assigned", "blocked"].indexOf(t.status) >= 0) || null;
        const directory = (this.data.agents || []).find(function (agent) {
          return agent.id === member.id;
        });
        const online = directory && typeof directory.online === "boolean"
          ? directory.online : member.online;
        return '<div class="mission-member">' + this.agentAvatar(member) +
          '<div class="mission-member-main"><b>' + esc(this.agentName(member)) +
          (member.source === "external" ?
            '<i class="mission-member-online ' + (online ? "on" : "off") + '">' +
            esc(online ? this.t("missionOnline") : this.t("missionOffline")) + '</i>' : "") +
          '</b><span>' +
          esc((member.skills || []).slice(0, 3).join(" · ")) + '</span><em>' +
          done + '/' + mine.length + ' · ' + open + ' ' + esc(this.t("missionOpenTasks")) + ' · ' +
          esc(member.source === "external" ? this.t("missionExternalAgent") :
            member.virtual ? this.t("missionVirtualAgent") : this.t("missionRoleAgent")) + '</em>' +
          (this.mission ? '<div class="mission-member-progress"><i><u style="width:' + pct +
            '%"></u></i><b>' + pct + '%</b></div>' : '') +
          (current ? '<span class="mission-member-current">' + esc(this.t("missionCurrentTask")) +
            '：' + esc(current.title) + ' · ' + esc(this.taskStatus(current.status)) + '</span>' : '') +
          '</div><div class="mission-member-actions">' +
          (this.mission ? '<button type="button" data-member-tasks="' + esc(member.id) + '">' +
            esc(this.t("missionViewTasks")) + '</button>' : '') +
          '<button type="button" data-dm-agent="' + esc(member.id) + '">' +
          esc(this.t("missionDm")) + '</button></div></div>';
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
        this.messageAvatar(message).replace("mission-avatar", "mission-message-avatar") +
        '<div class="mission-bubble"><div class="mission-message-top"><b>' +
        esc(message.senderName || this.t("missionAgent")) + '</b><span>' +
        esc(fmtTime(message.createdAt)) + '</span></div>' +
        (message.text ? '<div class="mission-message-text">' + esc(message.text) + '</div>' : '') +
        this.attachmentsHTML(message.attachments) + '</div></div>';
    }

    reportHTML(message) {
      const report = message.meta.report;
      const usage = message.usage || {};
      const usageTokens = Number(usage.tokensIn || 0) + Number(usage.tokensOut || 0);
      const rows = [
        ["missionDone", report.done],
        ["missionNext", report.next],
        ["missionRisks", report.risks]
      ];
      return '<div class="mission-message kind-agent report-message">' +
        this.messageAvatar(message).replace("mission-avatar", "mission-message-avatar") +
        '<div class="mission-report"><div class="mission-report-head"><b>' + esc(message.senderName) +
        ' · ' + esc(this.t("missionReport")) + '</b><span>' + esc(fmtTime(message.createdAt)) + '</span></div>' +
        (usageTokens || usage.durationMs ? '<div class="mission-usage-chip">TOKENS ' +
          esc(usage.tokensIn || 0) + ' in · ' + esc(usage.tokensOut || 0) + ' out · ' +
          fmtDuration(0, usage.durationMs) + '</div>' : '') +
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
      return '<div class="mission-message kind-agent proposal-message">' +
        this.messageAvatar(message).replace("mission-avatar", "mission-message-avatar") +
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
      const raw = this.bridge() + (artifact.url || ("/files/" + artifact.id + "/raw"));
      const download = '<a class="mission-file-dl" href="' + esc(raw) + '" download="' +
        esc(artifact.name) + '" title="' + esc(this.t("missionDownload")) + '" ' +
        'aria-label="' + esc(this.t("missionDownload")) + '">↓</a>';
      if (artifact.kind === "image") {
        return '<div class="mission-file-wrap"><button type="button" class="mission-file-row image" data-artifact-open="' +
          esc(artifact.id) + '"><img src="' + esc(this.bridge() + artifact.url) + '" alt="" />' +
          '<span><b>' + esc(artifact.name) + '</b><em>' + fmtSize(artifact.size) +
          (artifact.visionSummary ? ' · OCR' : '') + '</em></span></button>' + download + '</div>';
      }
      return '<div class="mission-file-wrap"><button type="button" class="mission-file-row" data-artifact-open="' +
        esc(artifact.id) + '"><i>DOC</i><span><b>' + esc(artifact.name) + '</b><em>' +
        (artifact.extraction && artifact.extraction !== "none" ? artifact.extraction : fmtSize(artifact.size)) +
        '</em></span></button>' + download + '</div>';
    }

    approvalHTML(approval, actions, bulk) {
      if (!approval) return "";
      const pending = approval.status === "pending";
      const bulkSelect = bulk && pending ?
        '<label class="mission-approval-select" title="' +
        esc(this.t("missionBulkSelectAll")) + '"><input type="checkbox" data-approval-select="' +
        esc(approval.id) + '"' + (this.selectedApprovals.has(approval.id) ? " checked" : "") +
        ' /></label>' : "";
      const mission = (this.data.missions || []).find(function (m) {
        return m.id === approval.missionId;
      });
      const requester = (this.data.agents || []).find(function (a) {
        return a.id === approval.requestedBy;
      });
      const requesterName = requester
        ? (requester.titleZh || requester.name || requester.id)
        : (approval.requestedBy || "");
      const missionButton = approval.missionId ?
        '<button type="button" class="mission-approval-link" data-open-approval-mission="' +
        esc(approval.missionId) + '">' + esc(this.t("missionApprovalOpenMission")) + '</button>' : "";
      const context = '<div class="mission-approval-context">' +
        (mission ? '<b>' + esc(mission.title) + '</b>' : "") +
        (approval.task ? '<span>▦ ' + esc(approval.task.title) + '</span>' : "") +
        (requesterName ? '<span>' + esc(this.t("missionRequester")) + " · " + esc(requesterName) + '</span>' : "") +
        (approval.createdAt ? '<span>' + esc(this.t("missionApprovalAt")) + " · " +
          esc(fmtTime(approval.createdAt)) + '</span>' : "") + missionButton + '</div>';
      const options = approval.type === "decision" && approval.options && approval.options.length ?
        '<div class="mission-approval-options">' + approval.options.map(function (o, index) {
          const id = "approval-option-" + approval.id + "-" + index;
          return '<label class="mission-approval-option" for="' + esc(id) + '">' +
            '<input type="radio" id="' + esc(id) + '" name="approval-option-' + esc(approval.id) +
            '" value="' + esc(o.id || o.label) + '"' + (index === 0 ? " checked" : "") +
            (pending ? "" : " disabled") + ' />' +
            '<span><b>' + esc(o.label || o.id) + '</b>' +
            (o.pros ? '<em class="pros">' + esc(this.t("missionApprovalPros")) + " · " + esc(o.pros) + '</em>' : "") +
            (o.cons ? '<em class="cons">' + esc(this.t("missionApprovalCons")) + " · " + esc(o.cons) + '</em>' : "") +
            '</span></label>';
        }, this).join('') + '</div>' : '';
      return '<div class="mission-approval ' + esc(approval.status) + '">' + bulkSelect +
        '<div class="mission-approval-head">' +
        '<span class="mission-gate">' + esc(this.approvalType(approval.type)) + '</span><b>' +
        esc(approval.title) + '</b><em>' + esc(approval.status) + '</em></div>' +
        context +
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

    flowStep(number, label, status, stateLabel) {
      return '<span class="mission-flow-step ' + esc(status) + '"><i>' + number + '</i><b>' +
        esc(label) + '</b><em>' + esc(stateLabel) + '</em></span>';
    }

    missionCommand(m) {
      if (!m) return "";
      const tasks = m.tasks || [];
      const total = tasks.length;
      const done = tasks.filter(function (t) { return t.status === "done"; }).length;
      const approvals = m.approvals || [];
      const pending = approvals.filter(function (a) { return a.status === "pending"; }).length ||
        ((m.stats && m.stats.approvals) || 0);
      const approved = approvals.filter(function (a) { return a.status === "approved"; }).length;
      const discussion = m.discussion || {};
      const discussing = discussion.status === "running" || discussion.status === "queued";
      const discussed = discussion.status === "done" || discussion.status === "partial";
      const auto = m.autoRun || {};
      const autoStatus = auto.status || "off";
      const active = ["pending", "queued", "discussing", "running"].indexOf(autoStatus) >= 0;
      const autoDiscussing = discussing || autoStatus === "discussing";
      const executing = autoStatus === "running" || (active && discussed);
      const allDone = total > 0 && done >= total;
      const aiReady = !!(this.ai && this.ai.available);
      const nextTask = tasks.find(function (t) { return t.status !== "done"; }) || {};
      const current = auto.currentTaskTitle || nextTask.title || "";

      let tone = "idle";
      let boss = false;
      let title = this.t("missionNextPending");
      let actions = "";

      if (pending) {
        tone = "warn"; boss = true;
        title = this.t("missionNextApprovals", { count: pending });
        actions = '<button type="button" class="mission-command-btn primary" data-detail-tab="approvals">' +
          esc(this.t("missionHandleApprovals")) + '</button>';
      } else if (allDone) {
        tone = "done"; boss = false;
        title = this.t("missionNextDone");
        actions = '<button type="button" class="mission-command-btn primary" data-mission-next-round' +
          (this.nextRoundBusy ? ' disabled' : '') + '>' +
          esc(this.t(this.nextRoundBusy ? "missionNextRoundBusy" : "missionNextRound")) + '</button>' +
          '<button type="button" class="mission-command-btn" data-detail-tab="eval">' +
          esc(this.t("missionReview")) + '</button>' +
          '<button type="button" class="mission-command-btn" data-detail-tab="tasks">' +
          esc(this.t("missionViewPlan")) + '</button>';
      } else if (autoStatus === "scheduled") {
        tone = "wait"; boss = false;
        title = this.t("missionNextScheduled", {
          time: auto.scheduledAt ? fmtTime(auto.scheduledAt) : "—"
        });
        actions = '<button type="button" class="mission-command-btn primary" data-mission-autorun="run">' +
          esc(this.t("missionRunNow")) + '</button>';
      } else if (active) {
        tone = "run"; boss = false;
        title = autoDiscussing ? this.t("missionNextDiscussing") : this.t("missionNextRunning", {
          done: done, total: total, task: current || this.t("missionWorking")
        });
        actions = '<button type="button" class="mission-command-btn danger" data-mission-autorun-stop>' +
          esc(this.t("missionAutoRunStop")) + '</button>';
      } else if (discussing) {
        tone = "run"; boss = false;
        title = this.t("missionNextDiscussing");
      } else if (!aiReady) {
        tone = "warn"; boss = true;
        title = this.t("missionNextAi");
        actions = '<button type="button" class="mission-command-btn primary" data-mission-ai-settings>' +
          esc(this.t("missionAutoRunSetup")) + '</button>';
      } else if (discussed) {
        const budgetStopped = autoStatus === "stopped" &&
          /token budget/i.test(String(auto.error || ""));
        if (budgetStopped) {
          tone = "warn"; boss = true;
          title = this.t("missionNextBudget", {
            used: fmtTokens(auto.tokensUsed || (m.evaluation && m.evaluation.totalTokens) || 0),
            budget: fmtTokens(auto.tokenBudget || m.tokenBudget || 0)
          });
          actions = '<button type="button" class="mission-command-btn primary" data-detail-tab="eval">' +
            esc(this.t("missionTokenBudgetAdjust")) + '</button>' +
            '<button type="button" class="mission-command-btn" data-mission-autorun="run">' +
            esc(this.t("missionAutoRunRestart", { count: total - done })) + '</button>';
        } else {
          if (autoStatus === "error") {
            tone = "error"; boss = true;
            title = this.t("missionNextError", { error: short(auto.error || "", 160) });
          } else if (autoStatus === "stopped") {
            tone = "warn"; boss = true;
            title = this.t("missionNextStopped", { done: done, total: total });
          } else {
            tone = "warn"; boss = true;
            title = this.t("missionNextStart", {
              count: total - done, task: nextTask.title || this.t("missionWorking")
            });
          }
          actions = '<button type="button" class="mission-command-btn primary" data-mission-autorun="run">' +
            esc(this.t(autoStatus === "error" || autoStatus === "stopped" ?
              "missionAutoRunRestart" : "missionStartTasks", { count: total - done })) + '</button>' +
            '<button type="button" class="mission-command-btn" data-detail-tab="tasks">' +
            esc(this.t("missionViewPlan")) + '</button>';
        }
      } else {
        tone = "warn"; boss = true;
        title = this.t("missionNextDiscuss");
        actions = '<button type="button" class="mission-command-btn primary" data-mission-autorun="discuss">' +
          esc(this.t("missionDiscussAndRun")) + '</button>' +
          '<button type="button" class="mission-command-btn" data-detail-tab="tasks">' +
          esc(this.t("missionViewPlan")) + '</button>';
      }

      const discussState = discussed ? "done" : (discussing ? "run" : "wait");
      const approveState = pending ? "warn" : (approved ? "done" : "wait");
      const executeState = allDone ? "done" : (executing ? "run" : "wait");
      const reportState = allDone ? "done" : (done ? "run" : "wait");
      const discussLabel = discussed ? this.t("missionFlowDone") :
        (discussing ? this.t("missionFlowRunning") : this.t("missionFlowWait"));
      const approveLabel = pending ? this.t("missionPendingCount", { count: pending }) :
        (approved ? this.t("missionApprovedCount", { count: approved }) : this.t("missionFlowNoNeed"));
      const executeLabel = allDone ? this.t("missionFlowDone") :
        (executing ? (done + "/" + total) : this.t("missionFlowWait"));
      const reportLabel = allDone ? this.t("missionFlowDone") :
        (done ? (done + "/" + total) : this.t("missionFlowWait"));

      return '<div class="mission-command ' + esc(tone) + '">' +
        '<div class="mission-flow">' +
        this.flowStep(1, this.t("missionFlowDiscuss"), discussState, discussLabel) +
        this.flowStep(2, this.t("missionFlowApprove"), approveState, approveLabel) +
        this.flowStep(3, this.t("missionFlowExecute"), executeState, executeLabel) +
        this.flowStep(4, this.t("missionFlowReport"), reportState, reportLabel) +
        '</div>' +
        '<div class="mission-command-row"><div class="mission-command-copy"><span>' +
        esc(this.t("missionNextLabel")) + ' · ' + esc(boss ? this.t("missionNextBoss") : this.t("missionNextAuto")) +
        '</span><b>' + esc(title) + '</b>' +
        '</div>' + (actions ? '<div class="mission-command-actions">' + actions + '</div>' : '') +
        '</div></div>';
    }

    aiStateHTML() {
      if (this.ai && this.ai.available) {
        return '<span class="mission-ai-state ok">' + esc(this.t("missionAutoRunReady")) +
          (this.ai.provider ? ' · ' + esc(this.ai.provider) : '') + '</span>';
      }
      return '<span class="mission-ai-state off">' + esc(this.t("aiUnavailable")) + '</span>' +
        '<button type="button" class="mission-mini" data-mission-ai-settings>' +
        esc(this.t("missionAutoRunSetup")) + '</button>';
    }

    autorunLabel(status) {
      return {
        off: this.t("missionAutoRunOff"),
        pending: this.t("missionAutoRunPending"),
        scheduled: this.t("missionAutoRunScheduled"),
        queued: this.t("missionAutoRunQueued"),
        discussing: this.t("missionAutoRunDiscussing"),
        running: this.t("missionAutoRunRunning"),
        waiting_boss: this.t("missionAutoRunWaiting"),
        stopped: this.t("missionAutoRunStopped"),
        done: this.t("missionAutoRunDone"),
        error: this.t("missionAutoRunError")
      }[status] || this.t("missionAutoRunOff");
    }

    autorunHTML(m) {
      if (!m) return "";
      const auto = m.autoRun || {};
      const status = auto.status || "off";
      const active = status === "pending" || status === "queued" ||
        status === "discussing" || status === "running";
      const total = Number(auto.total || (m.stats && m.stats.tasks) || 0);
      const done = Number(auto.completed || (m.stats && m.stats.done) || 0);
      const tokenBudget = Number(auto.tokenBudget || m.tokenBudget || 0);
      const tokensUsed = Number(auto.tokensUsed ||
        (m.evaluation && m.evaluation.totalTokens) || (m.evaluation && m.evaluation.actualTokens) || 0);
      const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
      const hint = status === "waiting_boss" ? this.t("missionAutoRunPausedHint") :
        status === "done" ? this.t("missionAutoRunDoneHint") :
        status === "stopped" ? this.t("missionAutoRunStoppedHint") :
        status === "error" ? (auto.error || this.t("missionAutoRunErrorHint")) :
        Number(auto.retry || 0) ? this.t("missionAutoRunRetrying") :
        !(this.ai && this.ai.available) ? this.t("missionAutoRunSetupHint") :
        this.t("missionAutoRunHint");
      return '<div class="mission-autorun-card ' + esc(status) + '">' +
        '<div class="mission-autorun-head"><b>' + esc(this.t("missionAutoRunTitle")) +
        '</b><span>' + esc(this.autorunLabel(status)) + '</span>' +
        (total ? '<em>' + esc(this.t("missionAutoRunProgress", { done: done, total: total })) +
          '</em>' : '') + '</div>' +
        '<div class="mission-autorun-bar"><i style="width:' + pct + '%"></i></div>' +
        (auto.currentTaskTitle ? '<p>' + esc(this.t("missionAutoRunCurrent", {
          task: auto.currentTaskTitle
        })) + '</p>' : '') +
        '<p class="mission-autorun-budget">' + esc(this.t("missionTokenBudgetUsed")) + ' ' +
        fmtTokens(tokensUsed) + (tokenBudget ? ' / ' + fmtTokens(tokenBudget) : '') + '</p>' +
        '<p class="mission-autorun-hint">' + esc(hint) + '</p>' +
        (status === "running" || status === "discussing" || status === "waiting_boss" ?
          '<p class="mission-autorun-hint">' + esc(this.t("missionAutoAcceptNote")) + '</p>' : '') +
        '</div>';
    }

    nextRoundTitle(title) {
      const text = String(title || "").trim();
      const match = text.match(/第\s*(\d+)\s*轮\s*$/);
      if (match) {
        return text.replace(/第\s*\d+\s*轮\s*$/, "第 " + (Number(match[1]) + 1) + " 轮").slice(0, 120);
      }
      return (text + " · 第 2 轮").slice(0, 120);
    }

    nextRoundPayload(m) {
      if (!m) return null;
      const tasks = m.tasks || [];
      const reports = tasks.filter(function (task) {
        return task.report && task.report.summary;
      }).slice(-6).map(function (task) {
        const report = task.report || {};
        const next = (report.next || []).slice(0, 3).join("、");
        return "- " + (task.title || task.id) + "：" + (report.summary || "").slice(0, 300) +
          (next ? "；下一步：" + next : "");
      });
      const decisions = (m.decisions || []).slice(-4).map(function (decision) {
        return "- " + (decision.topic || "") + "：" + (decision.outcome || "");
      });
      let description = String(m.description || "");
      description += "\n\n上一轮「" + (m.title || m.id) + "」已完成。";
      if (reports.length) description += "\n上一轮交付摘要：\n" + reports.join("\n");
      if (decisions.length) description += "\n已确认决策：\n" + decisions.join("\n");
      description += "\n\n请基于以上上下文继续下一轮迭代：补齐未完成项、吸收上一轮风险与解决方案，并给出可验收的新交付物。";
      description = description.slice(0, 6000);

      let memberIds = (m.members || []).map(function (member) { return member.id; }).filter(Boolean);
      if (this.realOnly()) {
        const external = new Set((this.data.agents || []).filter(function (agent) {
          return agent.source === "external";
        }).map(function (agent) { return agent.id; }));
        memberIds = memberIds.filter(function (id) { return external.has(id); });
      }
      const artifactIds = (m.artifacts || []).map(function (artifact) {
        return artifact && artifact.id;
      }).filter(Boolean);
      const aiReady = !!(this.ai && this.ai.available);
      const hadAutoRun = !!(m.autoRun && m.autoRun.enabled);
      return {
        title: this.nextRoundTitle(m.title),
        description: description,
        acceptance: m.acceptance || "",
        priority: m.priority || "P1",
        budget: Number(m.budget || 0),
        tokenBudget: Number(m.tokenBudget || 0),
        autoRun: aiReady && hadAutoRun,
        autoDiscuss: aiReady && hadAutoRun,
        language: AO.lang,
        realOnly: this.realOnly(),
        memberIds: memberIds,
        artifactIds: artifactIds,
        previousMissionId: m.id
      };
    }

    async startNextRound() {
      if (!this.mission || this.nextRoundBusy) return;
      const payload = this.nextRoundPayload(this.mission);
      if (!payload || !payload.memberIds.length) {
        this.toast(this.t("missionNextRoundNoTeam"));
        return;
      }
      const team = (this.mission.members || []).filter(function (member) {
        return payload.memberIds.indexOf(member.id) >= 0;
      }).map(function (member) {
        return member.titleZh || member.name || member.id;
      }).join("、");
      const summary = "开启下一轮？\n\n" + payload.title + "\n团队：" + team +
        "\nToken 预算：" + (payload.tokenBudget || "不限") +
        "\n全自动执行：" + (payload.autoRun ? "是（会消耗 Token）" : "否");
      if (!window.confirm(summary)) return;
      this.nextRoundBusy = true;
      this.render();
      try {
        const result = await this.api("/missions", {
          method: "POST", body: JSON.stringify(payload)
        }, 30000);
        const next = result.mission;
        this.nextRoundBusy = false;
        this.activeType = "mission";
        this.activeId = next.id;
        await this.refreshAll(false);
        await this.selectMission(next.id);
        if (payload.autoRun) this.watchAutorun(next.id);
        this.toast(this.t(payload.autoRun ? "missionNextRoundStarted" : "missionNextRoundCreated"));
      } catch (err) {
        this.nextRoundBusy = false;
        this.render();
        this.toast(this.t("missionNextRoundFailed") + " " + String(err.message || ""));
      }
    }

    async saveBudget() {
      if (!this.mission) return;
      const input = this.root.querySelector("#missionTokenBudget");
      const value = Number(input && input.value || 0);
      try {
        const result = await this.api("/missions/" + encodeURIComponent(this.mission.id) + "/budget", {
          method: "POST", body: JSON.stringify({ tokenBudget: value })
        }, 12000);
        this.mission = result.mission || this.mission;
        this.toast(this.t("missionTokenBudgetSaved"));
        this.render();
      } catch (err) {
        this.toast(this.t("missionTokenBudgetSaveFailed") + " " + String(err.message || ""));
      }
    }

    async startAutorun(forceDiscuss) {
      if (!this.mission) return;
      const missionId = this.mission.id;
      try {
        await this.api("/missions/" + encodeURIComponent(missionId) + "/autorun", {
          method: "POST", body: JSON.stringify({ discuss: !!forceDiscuss })
        }, 30000);
        this.toast(this.t("missionAutoRunStarted"));
        await this.loadActive();
        this.render();
        this.watchAutorun(missionId);
      } catch (err) {
        this.toast(err.code === "no_provider" ? this.t("missionAiUnavailable") :
          this.t("missionAutoRunFailed") + " " + String(err.message || ""));
      }
    }

    async stopAutorun() {
      if (!this.mission) return;
      try {
        await this.api("/missions/" + encodeURIComponent(this.mission.id) + "/autorun/stop", {
          method: "POST", body: JSON.stringify({})
        }, 20000);
        this.toast(this.t("missionAutoRunStoppedToast"));
        await this.loadActive();
        this.render();
      } catch (err) {
        this.toast(String(err.message || err));
      }
    }

    watchAutorun(missionId) {
      if (this.autoRunTimer) window.clearInterval(this.autoRunTimer);
      const self = this;
      let tries = 0;
      this.autoRunTimer = window.setInterval(async function () {
        tries += 1;
        if (!self.isOpen || self.activeId !== missionId || tries > 120) {
          window.clearInterval(self.autoRunTimer);
          self.autoRunTimer = null;
          return;
        }
        try {
          const detail = await self.api("/missions/" + encodeURIComponent(missionId));
          self.mission = detail.mission;
          if (!self.isEditing()) self.render();
          const status = ((self.mission || {}).autoRun || {}).status;
          if (["done", "error", "waiting_boss", "stopped", "off"].indexOf(status) >= 0) {
            window.clearInterval(self.autoRunTimer);
            self.autoRunTimer = null;
            self.refreshOverview();
          }
        } catch (err) {
          window.clearInterval(self.autoRunTimer);
          self.autoRunTimer = null;
        }
      }, 2000);
    }

    exportMission() {
      const m = this.mission;
      if (!m) return;
      const lines = [];
      lines.push("# " + (m.title || "Mission"));
      lines.push("");
      lines.push("- 状态：" + this.missionStatus(m));
      lines.push("- 优先级：P" + (m.priority || 2));
      lines.push("- 创建：" + (m.createdAt || ""));
      lines.push("- 成员：" + (m.members || []).map((a) => a.titleZh || a.name || a.id).join("、"));
      if (m.deadline) lines.push("- 截止：" + m.deadline);
      if (m.tokenBudget) lines.push("- Token 预算：" + m.tokenBudget);
      lines.push("");
      lines.push("## 目标");
      lines.push("");
      lines.push(m.description || "");
      lines.push("");
      lines.push("## 验收标准");
      lines.push("");
      lines.push(m.acceptance || "");
      lines.push("");
      lines.push("## 任务");
      lines.push("");
      (m.tasks || []).forEach(function (task) {
        const pct = taskProgressPercent(task);
        lines.push("### " + task.title + " · " + task.status + " · " + pct + "%");
        lines.push("");
        lines.push("- 负责人：" + (task.assigneeName || task.assigneeId || ""));
        if (task.brief) lines.push("- 说明：" + task.brief);
        if (task.report) {
          lines.push("- 汇报：" + (task.report.summary || ""));
          if (task.report.solution) lines.push("- 方案：" + task.report.solution);
          if (task.report.risks && task.report.risks.length) {
            lines.push("- 风险：" + task.report.risks.join("；"));
          }
        }
        lines.push("");
      });
      const approvals = m.approvals || [];
      if (approvals.length) {
        lines.push("## 审批");
        lines.push("");
        approvals.forEach(function (a) {
          lines.push("- [" + a.status + "] " + a.title + (a.amount ?
            " · " + a.amount + " " + (a.currency || "") : ""));
        });
        lines.push("");
      }
      const artifacts = m.artifacts || [];
      if (artifacts.length) {
        lines.push("## 文件");
        lines.push("");
        artifacts.forEach(function (a) {
          lines.push("- " + a.name + " · " + fmtSize(a.size) +
            " · " + location.origin + (a.url || ("/files/" + a.id + "/raw")));
        });
        lines.push("");
      }
      if ((m.decisions || []).length) {
        lines.push("## 决策");
        lines.push("");
        m.decisions.forEach(function (d) {
          lines.push("- **" + d.topic + "**：" + d.outcome);
        });
        lines.push("");
      }
      lines.push("## 对话记录");
      lines.push("");
      (this.messages || []).forEach(function (message) {
        lines.push("- `" + fmtTime(message.createdAt) + "` **" +
          (message.senderName || message.senderId || "system") + "**：" +
          String(message.text || "").replace(/\s+/g, " "));
      });
      const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (m.title || "mission").replace(/[\\/:*?"<>|]+/g, "-") + "-archive.md";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      this.toast(this.t("missionExportDone"));
    }

    async archiveMission() {
      if (!this.mission || this.archivingMission) return;
      const archived = !this.mission.archived;
      this.archivingMission = true;
      try {
        await this.api("/missions/" + encodeURIComponent(this.mission.id) + "/archive", {
          method: "POST", body: JSON.stringify({ archived: archived })
        });
        this.toast(this.t(archived ? "missionArchivedToast" : "missionUnarchivedToast"));
        await this.refreshAll(false);
      } catch (err) {
        this.toast(this.t("missionError") + " " + String(err.message || ""));
      } finally {
        this.archivingMission = false;
      }
    }

    async duplicateMission() {
      if (!this.mission || this.duplicatingMission) return;
      const source = this.mission;
      const memberIds = (source.members || []).map(function (member) { return member.id; });
      if (!memberIds.length) {
        this.toast(this.t("missionNextRoundNoTeam"));
        return;
      }
      this.duplicatingMission = true;
      try {
        const result = await this.api("/missions", {
          method: "POST",
          body: JSON.stringify({
            title: (source.title + " · " + (AO.lang === "en" ? "Copy" : "副本")).slice(0, 120),
            description: source.description,
            acceptance: source.acceptance,
            priority: source.priority || "P1",
            budget: 0,
            tokenBudget: source.tokenBudget || 0,
            autoRun: false,
            autoDiscuss: false,
            language: AO.lang,
            realOnly: this.realOnly(),
            memberIds: memberIds
          })
        }, 30000);
        const next = result.mission;
        this.activeType = "mission";
        this.activeId = next.id;
        await this.refreshAll(false);
        await this.selectMission(next.id);
        this.toast(this.t("missionDuplicatedToast"));
      } catch (err) {
        this.toast(this.t("missionNextRoundFailed") + " " + String(err.message || ""));
      } finally {
        this.duplicatingMission = false;
      }
    }

    async deleteMission() {
      if (!this.mission || this.deletingMission) return;
      if (!window.confirm(this.t("missionDeleteConfirm"))) return;
      this.deletingMission = true;
      try {
        await this.api("/missions/" + encodeURIComponent(this.mission.id), { method: "DELETE" });
        this.toast(this.t("missionDeleted"));
        this.activeId = "";
        this.activeType = "";
        this.mission = null;
        this.conversation = null;
        this.messages = [];
        this.viewMode = "chat";
        await this.refreshAll(false);
      } catch (err) {
        this.toast(this.t("missionError") + " " + String(err.message || ""));
      } finally {
        this.deletingMission = false;
      }
    }

    async bulkTaskAction(action) {
      if (!this.mission || this.bulkTaskBusy) return;
      const tasks = (this.mission.tasks || []).filter((task) => this.selectedTasks.has(task.id));
      const targets = tasks.filter(function (task) {
        return action === "accept" ? task.status === "review" : task.status !== "done";
      });
      if (!targets.length) return;
      this.bulkTaskBusy = true;
      let done = 0;
      for (const task of targets) {
        try {
          await this.api("/mission-tasks/" + encodeURIComponent(task.id), {
            method: "PATCH",
            body: JSON.stringify(action === "accept" ?
              { status: "done" } :
              { status: "blocked", blockedReason: "批量标记阻塞" })
          });
          done += 1;
        } catch (err) {}
      }
      this.selectedTasks.clear();
      this.bulkTaskBusy = false;
      this.toast(this.t("missionBulkTaskDone", { done: done, total: targets.length }));
      if (this.mission) {
        const detail = await this.api("/missions/" + encodeURIComponent(this.mission.id));
        this.mission = detail.mission || this.mission;
      }
      await this.refreshOverview();
      this.render();
    }

    async patchTask(taskId, patch) {
      if (!taskId || this.patchingTask) return;
      this.patchingTask = taskId;
      try {
        await this.api("/mission-tasks/" + encodeURIComponent(taskId), {
          method: "PATCH", body: JSON.stringify(patch)
        });
        this.toast(this.t("missionTaskUpdated"));
        if (this.mission) {
          const detail = await this.api("/missions/" + encodeURIComponent(this.mission.id));
          this.mission = detail.mission || this.mission;
        }
        await this.refreshOverview();
        this.render();
      } catch (err) {
        this.toast(this.t("missionTaskUpdateFailed") +
          (err.message ? " · " + err.message : ""));
      } finally {
        this.patchingTask = null;
      }
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

    applyMessageFilter() {
      const box = this.root.querySelector("#missionMessages");
      if (!box) return;
      const query = String(this.messageQuery || "").trim().toLowerCase();
      let visible = 0;
      let total = 0;
      Array.from(box.children).forEach(function (node) {
        if (node.classList.contains("mission-search-empty")) {
          node.remove();
          return;
        }
        if (node.classList.contains("mission-empty")) {
          node.hidden = !!query;
          return;
        }
        total += 1;
        const match = !query || String(node.textContent || "").toLowerCase().includes(query);
        node.hidden = !match;
        node.classList.toggle("search-hidden", !match);
        if (match) visible += 1;
      });
      const count = this.root.querySelector("#missionMessageSearchCount");
      if (count) count.textContent = query ? visible + "/" + total : "";
      if (query && visible === 0) {
        const empty = document.createElement("div");
        empty.className = "mission-search-empty mission-empty small";
        empty.textContent = this.t("missionSearchNoResults");
        box.appendChild(empty);
      }
    }

    appendMessage(message) {
      const box = this.root.querySelector("#missionMessages");
      if (!box) return;
      const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
      if (message && message.senderType === "agent") this.clearReplyPending();
      const typing = box.querySelector(".mission-typing");
      if (typing) typing.remove();
      const empty = box.querySelector(".mission-empty");
      if (empty) empty.remove();
      box.insertAdjacentHTML("beforeend", this.messageHTML(message));
      this.applyMessageFilter();
      if (stick) box.scrollTop = box.scrollHeight;
    }

    clearReplyPending() {
      this.replyPending = false;
      this.replyPendingConversation = "";
      if (this.replyTimer) {
        window.clearTimeout(this.replyTimer);
        this.replyTimer = null;
      }
      if (this.replyPollTimer) {
        window.clearInterval(this.replyPollTimer);
        this.replyPollTimer = null;
      }
    }

    waitForReply(conversationId) {
      this.replyPending = true;
      this.replyPendingConversation = conversationId || "";
      if (this.replyTimer) window.clearTimeout(this.replyTimer);
      this.replyTimer = window.setTimeout(() => {
        this.replyPending = false;
        this.replyPendingConversation = "";
        this.replyTimer = null;
        if (this.replyPollTimer) {
          window.clearInterval(this.replyPollTimer);
          this.replyPollTimer = null;
        }
        if (this.conversation && this.conversation.id === conversationId) this.render();
      }, 90000);
      if (this.replyPollTimer) window.clearInterval(this.replyPollTimer);
      this.replyPollTimer = window.setInterval(async () => {
        if (!this.conversation || this.conversation.id !== conversationId || !this.replyPending) {
          if (this.replyPollTimer) window.clearInterval(this.replyPollTimer);
          this.replyPollTimer = null;
          return;
        }
        try {
          const data = await this.api("/conversations/" + encodeURIComponent(conversationId) +
            "/messages?since=" + encodeURIComponent(this.lastSeq || 0), null, 8000);
          const rows = data.messages || [];
          let gotAgent = false;
          rows.forEach((message) => {
            if (this.messages.some((item) => item.id === message.id)) return;
            this.messages.push(message);
            this.lastSeq = Math.max(Number(this.lastSeq) || 0, Number(message.seq) || 0);
            this.appendMessage(message);
            if (message.senderType === "agent") gotAgent = true;
          });
          if (gotAgent) this.clearReplyPending();
        } catch (err) {}
      }, 2500);
    }

    renderSidebarOnly() {
      const side = this.root.querySelector(".mission-side");
      if (!side) return;
      const search = side.querySelector("#missionSearch");
      const hadFocus = !!search && document.activeElement === search;
      const caret = search && typeof search.selectionStart === "number"
        ? search.selectionStart : null;
      const list = side.querySelector(".mission-list");
      const scroll = list ? list.scrollTop : 0;
      side.outerHTML = this.renderSidebar();
      const nextSide = this.root.querySelector(".mission-side");
      if (!nextSide) return;
      const nextList = nextSide.querySelector(".mission-list");
      if (nextList) nextList.scrollTop = scroll;
      if (hadFocus) {
        const nextSearch = nextSide.querySelector("#missionSearch");
        if (nextSearch) {
          nextSearch.focus({ preventScroll: true });
          if (caret != null) {
            try { nextSearch.setSelectionRange(caret, caret); } catch (err) {}
          }
        }
      }
    }

    missionTemplates() {
      const zh = AO.lang !== "en";
      return [
        {
          key: "ecom",
          label: zh ? "电商运营" : "E-commerce",
          title: zh ? "电商运营：选品到首周复盘" : "E-commerce launch: assortment to week-one review",
          description: zh ? "为一个电商店铺完成选品、详情页、内容种草、投放计划和首周数据复盘，输出可直接执行的清单。" :
            "Plan assortment, product pages, content, paid launch and a week-one review for an e-commerce store; output an executable checklist.",
          acceptance: zh ? "选品清单、详情页结构、投放计划和首周复盘模板齐全，关键风险有应对方案。" :
            "Assortment list, PDP structure, paid plan and week-one review template are complete, with risks addressed.",
          priority: "P1",
          budget: "",
          tokenBudget: "300000"
        },
        {
          key: "content",
          label: zh ? "内容增长" : "Content",
          title: zh ? "内容增长：一周选题与分发" : "Content growth: one-week editorial sprint",
          description: zh ? "围绕目标人群规划一周选题、脚本、视觉素材和分发节奏，并给出可追踪的增长指标。" :
            "Plan a one-week editorial calendar with scripts, visuals and distribution, plus trackable growth metrics.",
          acceptance: zh ? "7 条选题、3 条脚本、视觉规范和分发排期完成，指标可追踪。" :
            "Seven topics, three scripts, visual rules and a distribution schedule are complete and measurable.",
          priority: "P1",
          budget: "",
          tokenBudget: "180000"
        },
        {
          key: "launch",
          label: zh ? "产品发布" : "Product launch",
          title: zh ? "产品发布：从需求到上线" : "Product launch: requirements to release",
          description: zh ? "把一个产品需求拆成可交付版本：需求边界、设计、实现、测试、发布和上线后监控。" :
            "Turn a product request into a shippable release: scope, design, implementation, QA, launch and post-launch monitoring.",
          acceptance: zh ? "可运行版本、测试证据、发布说明和监控项齐全，发布风险有回滚方案。" :
            "A running build, test evidence, release notes and monitoring are complete, with a rollback plan for release risks.",
          priority: "P0",
          budget: "",
          tokenBudget: "500000"
        },
        {
          key: "incident",
          label: zh ? "故障复盘" : "Incident review",
          title: zh ? "线上故障：定位、修复与复盘" : "Production incident: diagnose, fix, review",
          description: zh ? "针对一个线上故障完成影响面评估、根因定位、修复、回归验证和复盘行动项。" :
            "Assess impact, find root cause, fix, verify and produce follow-up actions for a production incident.",
          acceptance: zh ? "根因和影响面有证据，修复已回归，复盘行动项有负责人和截止时间。" :
            "Root cause and impact are evidenced, the fix is verified, and follow-up actions have owners and dates.",
          priority: "P0",
          budget: "",
          tokenBudget: "250000"
        }
      ];
    }

    applyMissionTemplate(key) {
      const template = this.missionTemplates().find(function (item) { return item.key === key; });
      const form = this.root.querySelector("#missionCreateForm");
      if (!template || !form) return;
      ["title", "description", "acceptance", "priority", "budget", "tokenBudget"].forEach(function (name) {
        const field = form.elements[name];
        if (!field) return;
        field.value = template[name] || "";
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      this.root.querySelectorAll("[data-mission-template]").forEach(function (button) {
        button.classList.toggle("active", button.getAttribute("data-mission-template") === key);
      });
      window.clearTimeout(this.recommendTimer);
      this.recommendTimer = window.setTimeout(() => this.refreshRecommendation(false), 300);
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
          '<div class="mission-template-row"><span>' + esc(this.t("missionTemplates")) + '</span>' +
          this.missionTemplates().map((template) =>
            '<button type="button" data-mission-template="' + template.key + '">' +
            esc(template.label) + '</button>').join("") + '</div>' +
          '<label>' + esc(this.t("missionTitleLabel")) + '<input name="title" maxlength="120" required placeholder="' +
          esc(this.t("missionTitlePh")) + '" /></label>' +
          '<label>' + esc(this.t("missionDescLabel")) + '<textarea name="description" rows="4" required placeholder="' +
          esc(this.t("missionDescPh")) + '"></textarea></label>' +
          '<label>' + esc(this.t("missionAcceptLabel")) + '<textarea name="acceptance" rows="2" placeholder="' +
          esc(this.t("missionAcceptPh")) + '"></textarea></label>' +
          '<div class="mission-form-grid"><label>' + esc(this.t("missionPriority")) +
          '<select name="priority"><option>P0</option><option selected>P1</option><option>P2</option></select></label>' +
          '<label>' + esc(this.t("missionBudget")) + '<input name="budget" type="number" min="0" step="1" placeholder="0" /></label>' +
          '<label>' + esc(this.t("missionDeadline")) + '<input name="deadline" type="date" /></label>' +
          '<label>' + esc(this.t("missionScheduleAt")) + '<input name="scheduleAt" type="datetime-local" /></label></div>' +
          '<p class="mission-note">' + esc(this.t("missionScheduleHint")) + '</p>' +
          '<label class="mission-token-limit">' + esc(this.t("missionTokenBudget")) +
          '<input name="tokenBudget" type="number" min="0" step="1000" placeholder="' +
          esc(this.t("missionTokenBudgetPh")) + '" /></label>' +
          '<p class="mission-note">' + esc(this.t("missionTokenBudgetHint")) + '</p>' +
          '<div class="mission-autorun-option"><label class="mission-check"><input id="missionAutoRun" name="autoRun" type="checkbox"' +
          (this.ai.available ? ' checked' : ' disabled') + ' /> ' +
          esc(this.t("missionAutoRun")) + '</label><div class="mission-ai-state-wrap" data-mission-ai-state>' +
          this.aiStateHTML() + '</div></div>' +
          (this.ai.available ? '<p class="mission-note mission-auto-note">' +
            esc(this.t("missionAutoRunHint")) + '</p>' :
            '<p class="mission-note mission-ai-note">' + esc(this.t("missionAiUnavailableHint")) + '</p>') +
          (this.realOnly() ? '<p class="mission-note mission-real-mode-note">' +
            esc(this.t("missionRealOnlyHint")) + '</p>' : '') +
          '<div class="mission-team-section" id="missionTeamPicker">' +
          this.renderTeamPickerHTML() + '</div>' +
          '<label>' + esc(this.t("missionFiles")) + '<input id="missionCreateFiles" type="file" multiple />' +
          '<div id="missionCreateFilesList" class="mission-form-files">' +
          this.formFiles.map(function (file, index) {
            return '<span class="mission-file-chip">' + esc(file.name) +
              ' <button type="button" data-form-file-remove="' + index + '">×</button></span>';
          }).join("") + '</div></label>' +
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

    renderTaskEdit() {
      if (!this.taskEditId || !this.mission) return "";
      const task = (this.mission.tasks || []).find((item) => item.id === this.taskEditId);
      if (!task) return "";
      const priorities = ["P0", "P1", "P2"].map(function (value) {
        return '<option value="' + value + '"' + ((task.priority || "P1") === value ? " selected" : "") +
          ">" + value + "</option>";
      }).join("");
      return '<div class="mission-task-edit-backdrop" data-task-edit-close></div>' +
        '<section class="mission-task-edit"><header><div><span>TASK EDIT</span><h3>' +
        esc(this.t("missionEditTask")) + '</h3></div>' +
        '<button type="button" data-task-edit-close aria-label="' + esc(this.t("close")) + '">×</button></header>' +
        '<form id="missionTaskEditForm" data-task-id="' + esc(task.id) + '">' +
        '<label>' + esc(this.t("missionTaskTitle")) + '<input name="title" maxlength="200" required value="' +
        esc(task.title || "") + '" /></label>' +
        '<label>' + esc(this.t("missionTaskBrief")) + '<textarea name="brief" rows="3" maxlength="4000">' +
        esc(task.brief || "") + '</textarea></label>' +
        '<label>' + esc(this.t("missionAcceptance")) + '<textarea name="acceptance" rows="2" maxlength="2000">' +
        esc(task.acceptance || "") + '</textarea></label>' +
        '<div class="mission-task-edit-grid"><label>' + esc(this.t("missionPriority")) +
        '<select name="priority">' + priorities + '</select></label></div>' +
        '<div class="mission-task-edit-actions"><button type="button" class="mission-mini" data-task-edit-close>' +
        esc(this.t("missionCancel")) + '</button><button type="submit" class="mission-primary">' +
        esc(this.t("missionSave")) + '</button></div></form></section>';
    }

    async saveTaskEdit(form) {
      const taskId = form.getAttribute("data-task-id");
      const fields = new FormData(form);
      const title = String(fields.get("title") || "").trim();
      if (!taskId || title.length < 2) {
        this.toast(this.t("missionFormInvalid"));
        return;
      }
      const submit = form.querySelector('button[type="submit"]');
      if (submit) { submit.disabled = true; submit.textContent = this.t("missionWorking"); }
      this.taskEditId = "";
      await this.patchTask(taskId, {
        title: title,
        brief: String(fields.get("brief") || ""),
        acceptance: String(fields.get("acceptance") || ""),
        priority: String(fields.get("priority") || "P1")
      });
    }

    renderArtifact() {
      if (!this.artifactFocus) return "";
      const a = this.artifactFocus;
      return '<div class="mission-artifact-backdrop" data-artifact-close></div>' +
        '<section class="mission-artifact"><header><div><span>' + esc(a.kind === "image" ?
          "IMAGE" : "DOCUMENT") + '</span><h3>' + esc(a.name) + '</h3></div>' +
        '<a class="mission-artifact-download" href="' +
        esc(this.bridge() + (a.url || ("/files/" + a.id + "/raw"))) + '" download="' +
        esc(a.name) + '">↓ ' + esc(this.t("missionDownload")) + '</a>' +
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
      this.recommendation = null;
      this.selectedAgents = [];
      this.teamTouched = false;
      this.taskExecutors = {};
      this.autoTeam = true;
      this.recommendBusy = false;
      this.render();
      if (mode === "mission") {
        window.setTimeout(() => this.refreshRecommendation(true), 80);
      }
      const input = this.root.querySelector('#missionCreateForm input[name="title"], #missionCreateForm input[name="memberId"]');
      if (input) input.focus();
    }

    syncTaskExecutors() {
      if (!this.recommendation) return;
      const allowed = new Set(this.selectedAgents.length ?
        this.selectedAgents : (this.data.agents || []).map((a) => a.id));
      const next = {};
      (this.recommendation.tasks || []).forEach((task) => {
        let current = this.taskExecutors[task.key];
        if (!allowed.has(current)) {
          const fallback = (task.recommended || []).find((a) => allowed.has(a.id)) ||
            (task.recommended || [])[0];
          current = fallback ? fallback.id : "";
        }
        if (current) next[task.key] = current;
      });
      this.taskExecutors = next;
    }

    recommendedAgentInfo(agentId) {
      if (!this.recommendation) return null;
      let best = null;
      (this.recommendation.tasks || []).forEach(function (task) {
        (task.recommended || []).forEach(function (agent) {
          if (agent.id !== agentId) return;
          if (!best || (agent.match || 0) > (best.match || 0)) {
            best = { ...agent, taskTitle: task.title, taskKey: task.key };
          }
        });
      });
      return best;
    }

    renderTeamPickerHTML() {
      if (this.realOnly() && !(this.data.agents || []).length) {
        return '<div class="mission-empty mission-real-empty"><b>' +
          esc(this.t("missionRealOnlyEmpty")) + '</b><p>' +
          esc(this.t("missionRealOnlyEmptyHint")) + '</p>' +
          '<button type="button" data-mission-open-external>' +
          esc(this.t("realModeAddAgent")) + '</button></div>';
      }
      if (this.recommendBusy && !this.recommendation) {
        return '<div class="mission-team-loading">' + esc(this.t("missionRecommendLoading")) + '</div>';
      }
      if (!this.recommendation) {
        return '<div class="mission-empty small">' + esc(this.t("missionRecommendEmpty")) + '</div>';
      }
      const selected = new Set(this.selectedAgents || []);
      const recommendedIds = new Set(this.recommendation.suggestedMemberIds || []);
      const selfInfo = (id) => this.recommendedAgentInfo(id);
      const agents = (this.data.agents || []).slice().sort(function (a, b) {
        const ai = selfInfo(a.id), bi = selfInfo(b.id);
        const ar = recommendedIds.has(a.id) ? 1 : 0;
        const br = recommendedIds.has(b.id) ? 1 : 0;
        if (ar !== br) return br - ar;
        return (bi ? bi.match : 0) - (ai ? ai.match : 0);
      });
      const cards = agents.map((agent) => {
        const info = this.recommendedAgentInfo(agent.id);
        const checked = selected.has(agent.id);
        return '<label class="mission-agent-pick' + (checked ? ' selected' : '') +
          (recommendedIds.has(agent.id) ? ' recommended' : '') + '">' +
          '<input type="checkbox" data-team-agent="' + esc(agent.id) + '"' +
          (checked ? ' checked' : '') + ' />' +
          this.agentAvatar(agent) +
          '<span class="mission-agent-pick-copy"><b>' + esc(this.agentName(agent)) +
          (recommendedIds.has(agent.id) ? '<em>' + esc(this.t("missionRecommended")) + '</em>' : '') +
          '</b><span>' + esc((AO.lang === "en" ? agent.roleLabelEn : agent.roleLabelZh) ||
            agent.role || "") + ' · ' +
          esc((agent.skills || []).slice(0, 3).join(" · ")) + '</span>' +
          (info ? '<small>' + esc(info.reason || "") + '</small>' : '') + '</span>' +
          '<span class="mission-agent-pick-score">' + (info ? (info.match || 0) + '%' : "") +
          (info && info.estimate ? '<em>~' + info.estimate.minutes + 'm · ~' +
            Math.round(info.estimate.tokens / 100) / 10 + 'k</em>' : '') + '</span></label>';
      }).join("");
      const allowed = this.selectedAgents.length ?
        this.selectedAgents : (this.data.agents || []).map((a) => a.id);
      const allowedSet = new Set(allowed);
      const pool = (this.data.agents || []).filter((a) => allowedSet.has(a.id));
      const plan = (this.recommendation.tasks || []).map((task) => {
        const top = (task.recommended || [])[0];
        const current = this.taskExecutors[task.key] || (top && top.id) || "";
        const chosen = (task.recommended || []).find((agent) => agent.id === current) || top;
        const estimate = (chosen && chosen.estimate) || task.estimate;
        const rankedIds = new Set();
        const optionsAgents = [];
        (task.recommended || []).forEach((agent) => {
          const match = pool.find((row) => row.id === agent.id);
          if (match) { rankedIds.add(agent.id); optionsAgents.push({ ...match, match: agent.match }); }
        });
        pool.forEach((agent) => {
          if (!rankedIds.has(agent.id)) optionsAgents.push(agent);
        });
        const options = optionsAgents.map((agent) => '<option value="' + esc(agent.id) + '"' +
          (agent.id === current ? " selected" : "") + '>' + esc(this.agentName(agent)) +
          (agent.match ? " · " + agent.match + "%" : "") +
          (top && agent.id === top.id ? " ★" : "") + '</option>').join("");
        return '<div class="mission-plan-row"><span>' + esc(task.title) + '</span>' +
          (options ? '<select class="mission-task-executor" data-task-executor="' + esc(task.key) +
            '" title="' + esc(this.t("missionExecutor")) + '">' + options + '</select>' :
            '<b>' + esc(this.t("missionUnassigned")) + '</b>') +
          '<em>' + (estimate ? '~' + estimate.minutes + 'm · ~' +
            Math.round(estimate.tokens / 100) / 10 + 'k tokens' : '') + '</em></div>';
      }).join("");
      return '<div class="mission-team-head"><b>' + esc(this.t("missionTeam")) + '</b>' +
        (this.recommendation.scope === "external" ?
          '<span class="mission-recommend-scope">' + esc(this.t("missionExternalScope")) +
          ' · ' + (this.recommendation.candidateCount || 0) + '</span>' : '') +
        '<label class="mission-check"><input id="missionAutoTeam" type="checkbox"' +
        (this.autoTeam ? ' checked' : '') + ' /> ' + esc(this.t("missionAutoTeam")) + '</label>' +
        '<button class="mission-mini" type="button" data-mission-recommend>' +
        esc(this.t("missionRecommendAgain")) + '</button></div>' +
        '<div class="mission-agent-grid">' + cards + '</div>' +
        '<div class="mission-plan"><div class="mission-plan-head">' + esc(this.t("missionPlan")) + '</div>' +
        plan + '</div>' +
        '<p class="mission-note">' + esc(this.recommendation.notes || this.t("missionRecommendHint")) + '</p>';
    }

    renderTeamPickerOnly() {
      const el = this.root.querySelector("#missionTeamPicker");
      if (el) el.innerHTML = this.renderTeamPickerHTML();
    }

    async refreshRecommendation(initial) {
      if (this.formMode !== "mission" || this.recommendBusy) return;
      const form = this.root.querySelector("#missionCreateForm");
      if (!form) return;
      const data = new FormData(form);
      this.recommendBusy = true;
      if (!this.recommendation || initial) {
        const el = this.root.querySelector("#missionTeamPicker");
        if (el) el.innerHTML = '<div class="mission-team-loading">' +
          esc(this.t("missionRecommendLoading")) + '</div>';
      }
      try {
        const result = await this.api("/missions/recommend", {
          method: "POST",
          body: JSON.stringify({
            title: String(data.get("title") || ""),
            description: String(data.get("description") || ""),
            acceptance: String(data.get("acceptance") || ""),
            priority: String(data.get("priority") || "P1"),
            language: AO.lang,
            realOnly: this.realOnly()
          })
        }, 12000);
        this.recommendation = result;
        if (this.autoTeam || !this.selectedAgents.length) {
          this.selectedAgents = (result.suggestedMemberIds || []).slice();
        } else {
          const existing = new Set((this.data.agents || []).map((a) => a.id));
          this.selectedAgents = this.selectedAgents.filter((id) => existing.has(id));
        }
        this.syncTaskExecutors();
      } catch (err) {
        this.recommendation = null;
      } finally {
        this.recommendBusy = false;
        this.renderTeamPickerOnly();
      }
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
          let team = Array.from(form.querySelectorAll("[data-team-agent]:checked"))
            .map((input) => input.getAttribute("data-team-agent"));
          if (!team.length && !this.teamTouched) {
            if (!this.recommendation) {
              try {
                this.recommendation = await this.api("/missions/recommend", {
                  method: "POST",
                  body: JSON.stringify({
                    title: String(data.get("title") || ""),
                    description: String(data.get("description") || ""),
                    acceptance: String(data.get("acceptance") || ""),
                    priority: String(data.get("priority") || "P1"),
                    language: AO.lang,
                    realOnly: this.realOnly()
                  })
                }, 12000);
              } catch (err) {
                this.recommendation = null;
              }
            }
            if (this.recommendation) {
              this.selectedAgents = (this.recommendation.suggestedMemberIds || []).slice();
              this.autoTeam = true;
              this.renderTeamPickerOnly();
              team = this.selectedAgents.slice();
            }
          }
          if (!team.length) {
            this.toast(this.realOnly() ? this.t("missionRealOnlyEmpty") : this.t("missionChooseMembers"));
            this.formBusy = false;
            if (submit) { submit.disabled = false; submit.textContent = this.t("missionCreate"); }
            return;
          }
          const preferred = {};
          Object.keys(this.taskExecutors || {}).forEach((key) => {
            const agentId = this.taskExecutors[key];
            if (team.indexOf(agentId) >= 0) preferred[key] = agentId;
          });
          if (this.recommendation && this.recommendation.preferredExecutors) {
            Object.keys(this.recommendation.preferredExecutors).forEach((key) => {
              const agentId = this.recommendation.preferredExecutors[key];
              if (!preferred[key] && team.indexOf(agentId) >= 0) preferred[key] = agentId;
            });
          }
          const autoRun = data.get("autoRun") === "on" && !!this.ai.available;
          const payload = {
            title: String(data.get("title") || "").trim(),
            description: String(data.get("description") || "").trim(),
            acceptance: String(data.get("acceptance") || "").trim(),
            priority: String(data.get("priority") || "P1"),
            budget: Number(data.get("budget") || 0),
            tokenBudget: Number(data.get("tokenBudget") || 0),
            autoRun: autoRun,
            autoDiscuss: autoRun,
            scheduleAt: String(data.get("scheduleAt") || ""),
            language: AO.lang,
            realOnly: this.realOnly(),
            memberIds: team,
            preferredExecutors: preferred
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
          let uploadFailed = 0;
          for (const file of this.formFiles) {
            let uploaded = null;
            for (let attempt = 0; attempt < 2 && !uploaded; attempt += 1) {
              try { uploaded = await this.upload(file, mission.id, convId); }
              catch (err) {}
            }
            if (uploaded) attachments.push(uploaded);
            else uploadFailed += 1;
          }
          if (uploadFailed) {
            this.toast(this.t("missionFilesPartialFail", { count: uploadFailed }));
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
          if (autoRun) this.watchAutorun(mission.id);
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
        this.toast(err.code === "no_external_agents" ?
          this.t("missionRealOnlyEmpty") :
          this.t("missionError") + " " + String(err.message || ""));
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
          const key = [file.name, file.size, file.lastModified].join(":");
          if (!this.uploadCache[key]) {
            this.uploadCache[key] = await this.upload(file,
              this.mission ? this.mission.id : "", this.conversation.id);
          }
          attachments.push(this.uploadCache[key]);
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
        this.uploadCache = {};
        this.uploading = false;
        const repliedEarly = this.messages.some(function (item) {
          return item.senderType === "agent" && Number(item.seq) > Number(res.message.seq);
        });
        if (res.replyPending && !repliedEarly) this.waitForReply(this.conversation.id);
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
      if (this.resolvingApproval) return;
      this.resolvingApproval = id;
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
      } finally {
        this.resolvingApproval = null;
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
