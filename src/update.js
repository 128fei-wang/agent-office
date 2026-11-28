(function () {
  "use strict";

  const AO = window.AgentOffice;
  const CHECK_KEY = "agent-office.update-check.v1";
  const AUTO_CHECK_MS = 6 * 60 * 60 * 1000;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function versionTuple(value) {
    return String(value || "").replace(/^v/, "").split(".").map(function (part) {
      return parseInt(part, 10) || 0;
    });
  }

  function versionAtLeast(value, target) {
    const a = versionTuple(value);
    const b = versionTuple(target);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const av = a[i] || 0;
      const bv = b[i] || 0;
      if (av !== bv) return av > bv;
    }
    return true;
  }

  function cap(value) {
    const text = String(value || "");
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  class UpdateCenter {
    constructor(renderer) {
      this.renderer = renderer;
      this.external = renderer ? renderer.external : null;
      this.root = document.getElementById("updateModal");
      this.btn = document.getElementById("updateBtn");
      this.badge = document.getElementById("updateBadge");
      this.isOpen = false;
      this.checking = false;
      this.data = null;
      this.job = null;
      this.error = "";
      this.confirm = "";
      this.token = "";
      this.rollbackToken = "";
      this.manualFile = null;
      this.manualError = "";
      this.pollTimer = null;
      this.pollBusy = false;
      this.pollFailures = 0;
      this.waiting = false;
      this.bootId = "";
      this.checkedAt = 0;
      this.ai = null;
      this.aiLoading = false;
      this.aiError = "";
      this.aiNotice = "";
      this.mcp = null;
      this.mcpLoading = false;
      this.mcpError = "";
      this.mcpNotice = "";
      this.mcpAgentId = "";
      this.params = new URLSearchParams(window.location.search);
      this.noReload = this.params.get("noUpdateReload") === "1" ||
        window.__AO_NO_UPDATE_RELOAD__ === true;
      this.bind();
    }

    bridge() {
      return String((this.external && this.external.bridgeUrl) || AO.BRIDGE_DEFAULT || "")
        .replace(/\/+$/, "");
    }

    t(key, vars) {
      return AO.t(key, vars);
    }

    bind() {
      const self = this;
      if (this.btn) {
        this.btn.addEventListener("click", function () { self.toggle(); });
      }
      if (this.root) {
        this.root.addEventListener("click", function (event) {
          if (event.target.closest("[data-update-close]")) {
            self.close();
            return;
          }
          const mcpButton = event.target.closest("[data-mcp-action]");
          if (mcpButton) {
            const mcpAction = mcpButton.getAttribute("data-mcp-action");
            if (mcpAction === "refresh") self.loadMCP(true);
            else if (mcpAction === "create") self.createMcpAgent();
            else if (mcpAction === "copy") self.copyMcpConfig();
            else if (mcpAction === "test") self.testMCP();
            return;
          }
          const aiButton = event.target.closest("[data-ai-action]");
          if (aiButton) {
            const aiAction = aiButton.getAttribute("data-ai-action");
            if (aiAction === "refresh") self.loadAI(true);
            else if (aiAction === "setup") {
              if (AO.aiSetup) AO.aiSetup.open();
            } else if (aiAction === "copy-example") self.copyAIExample();
            else if (aiAction === "open-providers") {
              self.close();
              if (self.external) self.external.open();
            } else if (aiAction === "test") {
              self.testProvider(aiButton.getAttribute("data-ai-provider"));
            }
            return;
          }
          const demoTool = event.target.closest("[data-demo-tool]");
          if (demoTool) {
            const action = demoTool.getAttribute("data-demo-tool");
            if (action === "toggle" && AO.DemoMode) {
              const next = !AO.DemoMode.enabled;
              AO.DemoMode.setEnabled(next);
              if (self.renderer && self.renderer.toast) {
                self.renderer.toast(AO.t(next ? "demoModeOn" : "demoModeOff"));
              }
              window.setTimeout(function () { self.render(); }, 280);
            } else if (action === "clean" && AO.DemoMode) {
              AO.DemoMode.stopDemoAgent().then(function () {
                if (self.isOpen) self.render();
              });
            } else if (action === "missions") {
              self.close();
              if (self.renderer && self.renderer.missions) self.renderer.missions.open();
            }
            return;
          }
          const button = event.target.closest("[data-update-action]");
          if (!button) return;
          const action = button.getAttribute("data-update-action");
          if (action === "check") { self.confirm = ""; self.check(true, false); }
          else if (action === "apply") { self.confirm = "apply"; self.render(); }
          else if (action === "manual") { self.confirm = "manual"; self.render(); }
          else if (action === "rollback") { self.confirm = "rollback"; self.render(); }
          else if (action === "cancel") { self.confirm = ""; self.render(); }
          else if (action === "confirm-apply") { self.runApply(); }
          else if (action === "confirm-manual") { self.runManual(); }
          else if (action === "confirm-rollback") { self.runRollback(); }
          else if (action === "reload") { window.location.reload(); }
        });
        this.root.addEventListener("change", function (event) {
          if (event.target && event.target.id === "mcpAgentSelect") {
            self.mcpAgentId = event.target.value;
            self.render();
            return;
          }
          if (!event.target || event.target.id !== "updateFile") return;
          const file = event.target.files && event.target.files[0];
          self.manualFile = file || null;
          self.manualError = "";
          if (file && file.size > 80 * 1024 * 1024) {
            self.manualFile = null;
            self.manualError = self.t("manualTooLarge");
          }
          const label = self.root.querySelector("#updateFileLabel");
          if (label) {
            label.textContent = self.manualFile
              ? self.manualFile.name + " · " + self.formatSize(self.manualFile.size)
              : self.t("manualFileHint");
          }
          const apply = self.root.querySelector('[data-update-action="manual"]');
          if (apply) apply.disabled = !self.manualFile;
          const inline = self.root.querySelector("#updateManualError");
          if (inline) {
            inline.hidden = !self.manualError;
            inline.textContent = self.manualError;
          }
        });
      }
      document.addEventListener("agent-office:lang", function () {
        if (self.isOpen) self.render();
        self.updateBadge();
      });
      document.addEventListener("agent-office:ai-ready", function () {
        if (self.isOpen) self.loadAI(true);
      });
      if (this.params.get("update") !== "0") {
        window.setTimeout(function () {
          try {
            const last = Number(localStorage.getItem(CHECK_KEY) || 0);
            if (!last || Date.now() - last > AUTO_CHECK_MS) self.check(false, true);
          } catch (err) {
            self.check(false, true);
          }
        }, 2500);
      }
    }

    toggle() {
      if (this.isOpen) this.close();
      else this.open();
    }

    open() {
      if (!this.root) return;
      this.isOpen = true;
      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");
      document.body.classList.add("update-open");
      this.render();
      this.loadAI();
      this.loadMCP();
      if (!this.data || Date.now() - this.checkedAt > 5 * 60 * 1000) {
        this.check(false, false);
      } else if (this.job && (this.job.status === "running" || this.job.status === "restarting")) {
        this.startPoll();
      }
      window.setTimeout(function () {
        const close = this.root && this.root.querySelector(".update-close");
        if (close) close.focus();
      }.bind(this), 30);
    }

    close() {
      if (!this.root) return;
      this.isOpen = false;
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      document.body.classList.remove("update-open");
      if (this.btn) this.btn.focus();
    }

    async fetchJson(path, options) {
      const opts = options || {};
      const controller = new AbortController();
      const timer = window.setTimeout(function () { controller.abort(); }, opts.timeout || 30000);
      try {
        const raw = opts.raw === true;
        const response = await fetch(this.bridge() + path, {
          cache: "no-store",
          signal: controller.signal,
          headers: {
            "Content-Type": raw ? "application/octet-stream" : "application/json",
            ...(opts.headers || {})
          },
          method: opts.method || "GET",
          body: opts.body === undefined ? undefined : (raw ? opts.body : JSON.stringify(opts.body))
        });
        const text = await response.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (err) { data = { error: text }; }
        if (!response.ok) {
          const error = new Error(data.error || ("HTTP " + response.status));
          error.code = data.code || "http_" + response.status;
          error.status = response.status;
          throw error;
        }
        return data;
      } catch (err) {
        if (err && err.name === "AbortError") {
          const timeout = new Error("request timed out");
          timeout.code = "timeout";
          throw timeout;
        }
        if (err && !err.code) err.code = "network";
        throw err;
      } finally {
        window.clearTimeout(timer);
      }
    }

    errorText(err) {
      if (!err) return this.t("updateError");
      if (err.code === "network" || err.code === "timeout") return this.t("updateBridgeOffline");
      if (err.code === "bad_token") return this.t("updateTokenExpired");
      return err.message || String(err);
    }

    storeCheck() {
      try { localStorage.setItem(CHECK_KEY, String(Date.now())); } catch (err) {}
    }

    updateBadge() {
      if (!this.badge) return;
      const available = !!(this.data && this.data.updateAvailable);
      this.badge.hidden = !available;
      const railTools = document.querySelector('#featureRail [data-rail-section="settings"]');
      if (railTools) railTools.classList.toggle("has-update", available);
      if (this.btn) {
        this.btn.classList.toggle("has-update", available);
        this.btn.title = available
          ? this.t("updateAvailable") + " · " + this.data.latestVersion
          : this.t("updateCheck");
      }
    }

    async check(force, silent) {
      if (this.checking) return;
      if (this.job && (this.job.status === "running" || this.job.status === "restarting")) return;
      this.checking = true;
      if (silent) this.storeCheck();
      if (!silent) this.error = "";
      if (this.isOpen) this.render();
      try {
        const data = await this.fetchJson("/update/check" + (force ? "?refresh=1" : ""));
        this.data = data;
        this.token = data.token || "";
        this.rollbackToken = data.rollbackToken || "";
        this.checkedAt = Date.now();
        this.error = "";
        this.storeCheck();
        this.updateBadge();
      } catch (err) {
        this.error = this.errorText(err);
      } finally {
        this.checking = false;
        if (this.isOpen) this.render();
      }
    }

    deploymentText(deployment) {
      if (!deployment) return "";
      return deployment.mode === "git" ? this.t("updateModeGit") : this.t("updateModeArchive");
    }

    blockedText(reason) {
      const keys = {
        git_dirty: "updateGitDirty",
        git_detached: "updateGitDetached",
        git_error: "updateGitError",
        read_only: "updateReadOnly"
      };
      return keys[reason] ? this.t(keys[reason]) : (reason || "");
    }

    stageLabel(stage) {
      const key = "updateStage" + String(stage || "").split("_").map(cap).join("");
      const value = this.t(key);
      return value === key ? (stage || this.t("updateWorking")) : value;
    }

    formatSize(bytes) {
      const size = Number(bytes) || 0;
      if (size < 1024) return size + " B";
      if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
      return (size / (1024 * 1024)).toFixed(1) + " MB";
    }

    formatDate(value) {
      if (!value) return "";
      const date = new Date(value);
      if (isNaN(date.getTime())) return value;
      try {
        return date.toLocaleString(AO.lang === "en" ? "en-US" : "zh-CN", {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
        });
      } catch (err) {
        return value;
      }
    }

    jobBlock() {
      const job = this.job;
      if (!job) return "";
      if (job.status === "restarting" || job.status === "reloading") {
        return '<div class="update-progress-card is-restarting">' +
          '<div class="update-spinner"></div><div><b>' +
          esc(job.status === "reloading" ? this.t("updateReloading") : this.t("updateRestarting")) +
          '</b><p>' + esc(this.t("updateRestartHint")) + '</p></div></div>';
      }
      if (job.status === "done") {
        return '<div class="update-result ok"><b>' + esc(this.t("updateDone")) +
          '</b><p>' + esc(this.t("updateDoneHint")) + '</p></div>';
      }
      if (job.status === "error") {
        return '<div class="update-result bad"><b>' + esc(this.t("updateError")) +
          '</b><p>' + esc(job.error || this.t("updateErrorHint")) + '</p></div>';
      }
      if (job.status === "running") {
        const percent = Math.max(0, Math.min(100, Number(job.percent) || 0));
        return '<div class="update-progress-card">' +
          '<div class="update-progress-head"><b>' + esc(this.stageLabel(job.stage)) +
          '</b><span>' + percent + '%</span></div>' +
          '<div class="update-progress"><i style="width:' + percent + '%"></i></div>' +
          '<p>' + esc(job.message || this.t("updateWorking")) + '</p></div>';
      }
      return "";
    }

    confirmBlock() {
      if (!this.confirm) return "";
      const applying = this.confirm === "apply";
      const manual = this.confirm === "manual";
      const version = applying
        ? (this.data && this.data.latestVersion)
        : (this.data && this.data.backup && this.data.backup.version);
      const file = this.manualFile ? this.manualFile.name : "";
      let title;
      let hint;
      let action;
      let label;
      if (manual) {
        title = this.t("manualConfirmTitle");
        hint = this.t("manualConfirmHint", { file: file });
        action = "confirm-manual";
        label = this.t("manualConfirm");
      } else if (applying) {
        title = this.t("updateConfirmTitle");
        hint = this.t("updateConfirmHint", { version: version || "" });
        action = "confirm-apply";
        label = this.t("updateConfirm");
      } else {
        title = this.t("updateRollbackConfirmTitle");
        hint = this.t("updateRollbackConfirmHint", { version: version || "" });
        action = "confirm-rollback";
        label = this.t("updateRollbackConfirm");
      }
      return '<div class="update-confirm">' +
        '<b>' + esc(title) + '</b><p>' + esc(hint) + '</p>' +
        '<div class="update-actions">' +
        '<button class="btn primary" type="button" data-update-action="' + action + '">' +
        esc(label) + '</button>' +
        '<button class="btn ghost" type="button" data-update-action="cancel">' +
        esc(this.t("cancel")) + '</button></div></div>';
    }

    manualBlock() {
      const file = this.manualFile;
      const label = file
        ? file.name + " · " + this.formatSize(file.size)
        : this.t("manualFileHint");
      return '<div class="update-section update-manual">' +
        '<h3>' + esc(this.t("manualTitle")) + '</h3>' +
        '<p class="update-hint">' + esc(this.t("manualHint")) + '</p>' +
        '<div class="update-file-row">' +
        '<label class="update-file-pick"><input type="file" id="updateFile" ' +
        'accept=".tar.gz,.tgz,.zip"><span>' + esc(this.t("manualChoose")) + '</span></label>' +
        '<span class="update-file-name" id="updateFileLabel">' + esc(label) + '</span></div>' +
        '<p class="update-inline-error" id="updateManualError"' +
        (this.manualError ? '' : ' hidden') + '>' + esc(this.manualError) + '</p>' +
        '<div class="update-actions"><button class="btn" type="button" ' +
        'data-update-action="manual"' + (file ? '' : ' disabled') + '>' +
        esc(this.t("manualApply")) + '</button></div>' +
        '<p class="update-hint">' + esc(this.t("toolsManualHint")) + '</p></div>';
    }

    async loadAI(force) {
      if (this.aiLoading) return;
      this.aiLoading = true;
      this.aiError = "";
      if (this.isOpen && force) this.render();
      try {
        const providers = await this.fetchJson("/providers", { timeout: 8000 });
        let overview = {};
        try {
          overview = await this.fetchJson("/missions/overview", { timeout: 8000 });
        } catch (err) {}
        this.ai = {
          providers: providers.providers || [],
          configFile: providers.configFile || "providers.json",
          configError: providers.configError || "",
          available: !!(overview.ai && overview.ai.available),
          provider: (overview.ai && overview.ai.provider) || ""
        };
      } catch (err) {
        this.aiError = this.errorText(err);
      } finally {
        this.aiLoading = false;
        if (this.isOpen) this.render();
      }
    }

    async copyAIExample() {
      const example = JSON.stringify({
        deepseek: { apiKey: "sk-...", model: "deepseek-chat" },
        gemini: { apiKey: "...", model: "gemini-2.5-flash" },
        workbuddy: { baseUrl: "http://127.0.0.1:10108/v1", model: "hy3" }
      }, null, 2);
      const text = "~/.agent-office/providers.json\n\n" + example;
      try {
        await navigator.clipboard.writeText(text);
        this.aiNotice = this.t("aiExampleCopied");
        this.render();
      } catch (err) {
        this.aiNotice = example;
        this.render();
      }
    }

    async testProvider(providerId) {
      if (!providerId || this.aiLoading) return;
      this.aiNotice = this.t("aiTesting");
      this.render();
      try {
        const result = await this.fetchJson("/providers/" + encodeURIComponent(providerId) + "/test", {
          method: "POST", body: "{}", timeout: 45000
        });
        this.aiNotice = this.t("aiTestOk", {
          provider: providerId,
          tokens: (result.tokensIn || 0) + "/" + (result.tokensOut || 0),
          ms: result.durationMs || 0
        });
      } catch (err) {
        this.aiNotice = this.t("aiTestFailed") + " " + this.errorText(err);
      }
      await this.loadAI(true);
    }

    async loadMCP(force) {
      if (this.mcpLoading) return;
      this.mcpLoading = true;
      this.mcpError = "";
      if (this.isOpen && force) this.render();
      try {
        const data = await this.fetchJson("/agents", { timeout: 8000 });
        const agents = (data.agents || []).filter((agent) => agent.source === "external");
        if (!agents.some((agent) => agent.id === this.mcpAgentId)) {
          this.mcpAgentId = agents.length ? agents[0].id : "";
        }
        this.mcp = { agents: agents, endpoint: this.bridge() + "/mcp" };
      } catch (err) {
        this.mcpError = this.errorText(err);
      } finally {
        this.mcpLoading = false;
        if (this.isOpen) this.render();
      }
    }

    mcpConfig() {
      return JSON.stringify({
        mcpServers: {
          "agent-office": {
            type: "http",
            url: (this.mcp && this.mcp.endpoint) || (this.bridge() + "/mcp"),
            headers: { "X-Agent-Id": this.mcpAgentId || "ext-mcp-agent" }
          }
        }
      }, null, 2);
    }

    async createMcpAgent() {
      if (this.mcpLoading) return;
      this.mcpLoading = true;
      this.mcpError = "";
      try {
        const id = "ext-mcp-" + Math.random().toString(16).slice(2, 10);
        const data = await this.fetchJson("/agents", {
          method: "POST",
          body: {
            id: id,
            name: "MCP Agent",
            runtime: "mcp",
            skills: ["mcp", "tasks", "chat", "report"],
            role: "operator",
            avatar: "bot",
            note: "通过 MCP 接入 Agent Office"
          }
        });
        this.mcpAgentId = (data.agent && data.agent.id) || id;
        this.mcpNotice = this.t("mcpCreated");
        await this.loadMCP();
      } catch (err) {
        this.mcpError = this.errorText(err);
        this.render();
      } finally {
        this.mcpLoading = false;
      }
    }

    async copyMcpConfig() {
      const text = this.mcpConfig();
      try {
        await navigator.clipboard.writeText(text);
        this.mcpNotice = this.t("mcpConfigCopied");
      } catch (err) {
        this.mcpNotice = text;
      }
      this.render();
    }

    async testMCP() {
      if (this.mcpLoading) return;
      this.mcpLoading = true;
      this.mcpNotice = this.t("mcpTesting");
      this.render();
      try {
        const init = await this.fetchJson("/mcp", {
          method: "POST",
          headers: { "X-Agent-Id": this.mcpAgentId || "" },
          body: {
            jsonrpc: "2.0", id: 1, method: "initialize",
            params: { protocolVersion: "2025-06-18", capabilities: {},
                      clientInfo: { name: "agent-office-tools", version: "1" } }
          },
          timeout: 10000
        });
        const tools = await this.fetchJson("/mcp", {
          method: "POST",
          headers: { "X-Agent-Id": this.mcpAgentId || "" },
          body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
          timeout: 10000
        });
        const count = (tools.result && tools.result.tools && tools.result.tools.length) || 0;
        this.mcpNotice = this.t("mcpTestOk", { tools: count });
      } catch (err) {
        this.mcpNotice = this.t("mcpTestFailed") + " " + this.errorText(err);
      } finally {
        this.mcpLoading = false;
        this.render();
      }
    }

    mcpBlock() {
      if (!this.mcp && !this.mcpLoading && !this.mcpError) return "";
      const agents = (this.mcp && this.mcp.agents) || [];
      const endpoint = (this.mcp && this.mcp.endpoint) || (this.bridge() + "/mcp");
      const options = agents.map((agent) =>
        '<option value="' + esc(agent.id) + '"' + (agent.id === this.mcpAgentId ? " selected" : "") + '>' +
        esc(agent.name || agent.id) + ' · ' + esc(agent.roleLabelZh || agent.role || "external") + '</option>').join("");
      return '<div class="update-section update-mcp">' +
        '<div class="update-ai-head"><div><span>MCP DEPLOY</span><h3>' + esc(this.t("mcpTitle")) + '</h3></div>' +
        '<b class="ai-status ' + (agents.length ? "ok" : "off") + '">' + esc(agents.length ? this.t("mcpReady") : this.t("mcpNoAgent")) + '</b></div>' +
        '<p class="update-hint">' + esc(this.t("mcpHint")) + '</p>' +
        (this.mcpError ? '<div class="update-result bad"><b>' + esc(this.t("mcpLoadError")) +
          '</b><p>' + esc(this.mcpError) + '</p></div>' : "") +
        (this.mcpLoading ? '<div class="update-loading small"><div class="update-spinner"></div><span>' +
          esc(this.t("mcpLoading")) + '</span></div>' : "") +
        '<div class="mcp-endpoint"><span>ENDPOINT</span><code>' + esc(endpoint) + '</code></div>' +
        '<div class="mcp-row"><label>' + esc(this.t("mcpAgent")) + '<select id="mcpAgentSelect">' +
        (options || '<option value="">—</option>') + '</select></label>' +
        '<button type="button" class="update-mini" data-mcp-action="create">＋ ' + esc(this.t("mcpCreateAgent")) + '</button></div>' +
        '<pre class="mcp-config">' + esc(this.mcpConfig()) + '</pre>' +
        '<p class="update-hint">' + esc(this.t("mcpTools")) + '</p>' +
        '<p class="update-hint">' + esc(this.t("mcpSigningHint")) + '</p>' +
        (this.mcpNotice ? '<p class="update-hint ai-notice">' + esc(this.mcpNotice) + '</p>' : "") +
        '<div class="update-actions"><button type="button" class="btn" data-mcp-action="refresh">' +
        esc(this.t("mcpRefresh")) + '</button><button type="button" class="btn ghost" data-mcp-action="copy">' +
        esc(this.t("mcpCopy")) + '</button><button type="button" class="btn ghost" data-mcp-action="test">' +
        esc(this.t("mcpTest")) + '</button></div></div>';
    }

    demoBlock() {
      const enabled = AO.DemoMode ? AO.DemoMode.enabled : true;
      return '<div class="update-section tools-demo' + (enabled ? '' : ' is-real') + '">' +
        '<div class="update-ai-head"><div><span>WORKSPACE MODE</span><h3>' +
        esc(this.t("settingsDemo")) + '</h3></div><b class="ai-status ' +
        (enabled ? "ok" : "off") + '">' + esc(enabled ? this.t("demoModeOn") :
          this.t("demoModeOff")) + '</b></div>' +
        '<p class="update-hint">' + esc(enabled ? this.t("settingsDemoDesc") : this.t("settingsDemoNote")) + '</p>' +
        '<div class="tools-demo-actions">' +
        '<button type="button" class="btn ' + (enabled ? "ghost" : "primary") +
        '" data-demo-tool="toggle">' + esc(enabled ? this.t("demoModeOff") : this.t("realModeRestore")) +
        '</button>' +
        '<button type="button" class="btn ghost" data-demo-tool="clean">' +
        esc(this.t("settingsDemoClean")) + '</button>' +
        '<button type="button" class="btn ghost" data-demo-tool="missions">' +
        esc(this.t("realModeOpenMissions")) + '</button></div></div>';
    }

    aiBlock() {
      if (!this.ai && !this.aiLoading && !this.aiError) return "";
      const ai = this.ai || { providers: [], available: false, provider: "" };
      const providers = ai.providers || [];
      const active = providers.find((item) => item.id === ai.provider) || null;
      const detected = providers.filter((item) => item.detected);
      const configuredCount = providers.filter((item) => item.configured).length;
      const state = ai.available ? this.t("aiAvailable") :
        (ai.configError ? this.t("aiConfigBroken") :
          (configuredCount ? this.t("aiConfiguredUnreachable") : this.t("aiUnavailable")));
      const rows = providers.map((provider) => {
        const configured = !!provider.configured;
        const source = provider.detected ? this.t("aiSetupDetected") :
          provider.keySource === "file" ? this.t("aiConfigured") :
            provider.localReady ? this.t("aiSetupLocalReady") : this.t("aiNotConfigured");
        return '<div class="ai-provider-row"><span class="ai-provider-dot ' + (configured ? "ok" : "off") + '"></span>' +
          '<div><b>' + esc(provider.name || provider.id) + '</b><em>' + esc(provider.vendor || provider.protocol || "") +
          ' · ' + esc(provider.model || "") + '</em></div>' +
          '<span class="ai-provider-state ' + (configured ? "ok" : "off") + '">' + esc(source) + '</span>' +
          (configured ? '<button type="button" class="update-mini" data-ai-action="test" data-ai-provider="' +
            esc(provider.id) + '">' + esc(this.t("aiTest")) + '</button>' : '') +
          '</div>';
      }).join("");
      const readyCard = ai.available ?
        '<div class="ai-ready-card"><span>✓</span><div><b>' + esc(this.t("aiSetupSuccess")) +
        (active ? ' · ' + esc(active.name || active.id) : "") + '</b><p>' +
        esc(active ? (active.model || "") + (active.detected ? ' · ' + this.t("aiSetupDetected") : "") : this.t("aiAvailable")) +
        '</p></div></div>' :
        '<div class="ai-blocked-card"><b>' + esc(this.t("aiUnavailable")) + '</b><p>' +
        esc(this.t("aiSetupSub")) + '</p><button type="button" class="btn primary" data-ai-action="setup">' +
        esc(this.t("aiSetupOpen")) + '</button></div>';
      const detectedNote = (!ai.available && detected.length) ?
        '<p class="ai-detected-note">' + esc(this.t("aiSetupDetectedHint", {
          env: detected[0].keyEnv || "environment"
        })) + '</p>' : "";
      return '<div class="update-section update-ai">' +
        '<div class="update-ai-head"><div><span>AI SETTINGS</span><h3>' + esc(this.t("aiTitle")) + '</h3></div>' +
        '<b class="ai-status ' + (ai.available ? "ok" : "off") + '">' + esc(state) +
        (ai.provider ? ' · ' + esc(ai.provider) : '') + '</b></div>' +
        '<p class="update-hint">' + esc(this.t("aiHint")) + '</p>' +
        (this.aiError ? '<div class="update-result bad"><b>' + esc(this.t("aiLoadError")) +
          '</b><p>' + esc(this.aiError) + '</p></div>' : "") +
        (this.aiLoading ? '<div class="update-loading small"><div class="update-spinner"></div><span>' +
          esc(this.t("aiLoading")) + '</span></div>' : "") +
        readyCard + detectedNote +
        '<div class="update-actions"><button type="button" class="btn ' + (ai.available ? "ghost" : "primary") +
        '" data-ai-action="setup">' + esc(ai.available ? this.t("aiSetupChange") : this.t("aiSetupOpen")) +
        '</button><button type="button" class="btn ghost" data-ai-action="refresh">' +
        esc(this.t("aiRefresh")) + '</button>' +
        (active ? '<button type="button" class="btn ghost" data-ai-action="test" data-ai-provider="' +
          esc(active.id) + '">' + esc(this.t("aiTest")) + '</button>' : '') + '</div>' +
        '<details class="ai-provider-details"><summary>' + esc(this.t("aiTitle")) + ' · ' +
        providers.length + '</summary><div class="ai-provider-list">' +
        (rows || '<p class="update-hint">' + esc(this.t("aiNoProviders")) + '</p>') + '</div></details>' +
        '<details class="ai-provider-details ai-advanced-config"><summary>' + esc(this.t("aiHowTo")) +
        '</summary><div class="ai-config-box"><ol><li>' + esc(this.t("aiStep1")) + '</li><li>' +
        esc(this.t("aiStep2")) + '</li><li>' + esc(this.t("aiStep3")) + '</li></ol>' +
        '<code>~/.agent-office/providers.json</code>' +
        '<pre>{ "deepseek": { "apiKey": "sk-...", "model": "deepseek-chat" } }</pre>' +
        '<p class="update-hint">' + esc(this.t("aiKeySafety")) + '</p>' +
        '<div class="update-actions"><button type="button" class="btn ghost" data-ai-action="copy-example">' +
        esc(this.t("aiCopyExample")) + '</button><button type="button" class="btn ghost" data-ai-action="open-providers">' +
        esc(this.t("aiOpenManage")) + '</button></div></div></details>' +
        (this.aiNotice ? '<p class="update-hint ai-notice">' + esc(this.aiNotice) + '</p>' : "") +
        '</div>';
    }

    toolsBlock() {
      return '<div class="update-section update-tools">' +
        '<h3>' + esc(this.t("toolsCli")) + '</h3>' +
        '<p class="update-hint">' + esc(this.t("toolsCliHint")) + '</p>' +
        '<code>./update.sh --check</code>' +
        '<code>./update.sh --apply</code>' +
        '<code>./update.sh --manual release.tar.gz</code>' +
        '<code>./update.sh --rollback</code>' +
        '<p class="update-hint">' + esc(this.t("toolsBackup")) +
        ': <b>~/.agent-office/backups</b></p></div>';
    }

    actionsBlock() {
      if (!this.data) {
        return '<div class="update-actions"><button class="btn primary" type="button" ' +
          'data-update-action="check">' + esc(this.t("updateRetry")) + '</button>' +
          '<button class="btn ghost" type="button" data-update-close>' +
          esc(this.t("close")) + '</button></div>';
      }
      const job = this.job;
      if (job && job.status === "running") {
        return '<div class="update-actions"><button class="btn ghost" type="button" ' +
          'data-update-close>' + esc(this.t("close")) + '</button></div>';
      }
      if (job && job.status === "restarting") {
        return '<div class="update-actions"><button class="btn ghost" type="button" ' +
          'data-update-close>' + esc(this.t("close")) + '</button></div>';
      }
      const data = this.data;
      let html = '<div class="update-actions">';
      html += '<button class="btn" type="button" data-update-action="check"' +
        (this.checking ? " disabled" : "") + '>' +
        esc(this.checking ? this.t("updateChecking") : this.t("updateCheck")) + '</button>';
      if (data.updateAvailable && data.deployment && data.deployment.canApply && this.token) {
        html += '<button class="btn primary" type="button" data-update-action="apply">' +
          esc(this.t("updateApply")) + '</button>';
      }
      if (data.backup && this.rollbackToken) {
        html += '<button class="btn ghost" type="button" data-update-action="rollback">' +
          esc(this.t("updateRollback")) + '</button>';
      }
      html += '<button class="btn ghost" type="button" data-update-close>' +
        esc(this.t("close")) + '</button></div>';
      return html;
    }

    render() {
      if (!this.root || !this.isOpen) return;
      const data = this.data;
      const job = this.job;
      const busy = job && (job.status === "running" || job.status === "restarting" ||
        job.status === "reloading");
      let body = "";
      body += '<div class="update-versions">' +
        '<div><span>' + esc(this.t("updateCurrent")) + '</span><b>' +
        esc(data ? data.currentVersion : (job && job.currentVersion) || "—") + '</b></div>' +
        '<i>→</i><div><span>' + esc(this.t("updateLatest")) + '</span><b>' +
        esc(data ? data.latestVersion : (job && job.toVersion) || "—") + '</b></div>' +
        '<em class="update-mode">' + esc(data ? this.deploymentText(data.deployment) : "") +
        '</em></div>';

      if (this.checking && !data) {
        body += '<div class="update-loading"><div class="update-spinner"></div>' +
          '<span>' + esc(this.t("updateChecking")) + '</span></div>';
      }
      if (this.error) {
        body += '<div class="update-result bad"><b>' + esc(this.t("updateError")) +
          '</b><p>' + esc(this.error) + '</p></div>';
      }
      if (data) {
        if (data.updateAvailable) {
          body += '<div class="update-status available"><i></i><div><b>' +
            esc(this.t("updateAvailable")) + '</b><p>' +
            esc(data.release.name || data.release.tag) +
            (data.release.publishedAt ? ' · ' + esc(this.formatDate(data.release.publishedAt)) : '') +
            '</p></div></div>';
          if (data.release.notes) {
            body += '<div class="update-section"><h3>' + esc(this.t("updateNotes")) +
              '</h3><pre class="update-notes">' + esc(data.release.notes) + '</pre></div>';
          }
          if (data.deployment && !data.deployment.canApply) {
            body += '<div class="update-warning"><b>' + esc(this.t("updateBlocked")) +
              '</b><p>' + esc(this.blockedText(data.deployment.reason)) + '</p></div>';
          } else if (data.deployment && data.deployment.mode === "git") {
            body += '<p class="update-hint">' + esc(this.t("updateGitHint")) + '</p>';
          }
        } else {
          body += '<div class="update-status current"><i></i><div><b>' +
            esc(this.t("updateUpToDate")) + '</b><p>' +
            esc(this.t("updateUpToDateHint")) + '</p></div></div>';
        }
        if (data.backup) {
          body += '<div class="update-backup"><span>' + esc(this.t("updateBackup")) +
            '</span><b>v' + esc(data.backup.version) + '</b><em>' +
            esc(this.formatDate(data.backup.createdAt)) + '</em></div>';
        }
      }
      if (job) body += this.jobBlock();
      if (!busy && !this.confirm) body += this.aiBlock();
      if (!busy && !this.confirm) body += this.mcpBlock();
      if (!busy && !this.confirm) body += this.demoBlock();
      if (!busy && !this.confirm) body += this.manualBlock();
      if (!busy) body += this.toolsBlock();
      if (this.confirm) body += this.confirmBlock();
      if (!busy) body += this.actionsBlock();

      let footer = '<span>' + esc(this.t("updateSafety")) + '</span>';
      if (data && data.release && data.release.url) {
        footer += '<a href="' + esc(data.release.url) +
          '" target="_blank" rel="noopener noreferrer">' +
          esc(this.t("updateReleasePage")) + ' ↗</a>';
      }
      this.root.innerHTML =
        '<div class="update-backdrop" data-update-close></div>' +
        '<section class="update-card" role="dialog" aria-modal="true" aria-labelledby="updateTitle">' +
        '<header class="update-head"><div><span class="update-kicker">SYSTEM / TOOLS</span>' +
        '<h2 id="updateTitle">' + esc(this.t("updateTitle")) + '</h2></div>' +
        '<button class="update-close" type="button" data-update-close aria-label="' +
        esc(this.t("close")) + '">×</button></header>' +
        '<div class="update-body">' + body + '</div>' +
        '<footer class="update-foot">' + footer + '</footer></section>';
    }

    async runApply() {
      if (!this.data || !this.token) {
        this.error = this.t("updateTokenExpired");
        this.confirm = "";
        this.render();
        return;
      }
      this.confirm = "";
      this.error = "";
      this.bootId = "";
      try {
        const health = await this.fetchJson("/health", { timeout: 5000 });
        this.bootId = health.bootId || "";
      } catch (err) {}
      const token = this.token;
      this.token = "";
      this.job = {
        status: "running", stage: "preparing", percent: 2,
        message: this.t("updateWorking"), toVersion: this.data.latestVersion
      };
      this.render();
      try {
        const response = await this.fetchJson("/update/apply", {
          method: "POST",
          body: { token: token, version: this.data.latestVersion }
        });
        this.job = response.job || this.job;
        this.render();
        this.startPoll();
      } catch (err) {
        this.job = { status: "error", error: this.errorText(err), code: err.code || "" };
        this.render();
      }
    }

    async runManual() {
      const file = this.manualFile;
      if (!file) {
        this.manualError = this.t("manualNoFile");
        this.confirm = "";
        this.render();
        return;
      }
      if (file.size > 80 * 1024 * 1024) {
        this.manualError = this.t("manualTooLarge");
        this.confirm = "";
        this.render();
        return;
      }
      this.confirm = "";
      this.error = "";
      this.manualError = "";
      this.bootId = "";
      try {
        const health = await this.fetchJson("/health", { timeout: 5000 });
        this.bootId = health.bootId || "";
      } catch (err) {}
      this.job = {
        status: "running", stage: "preparing", percent: 2,
        message: this.t("manualWorking"), toVersion: ""
      };
      this.render();
      try {
        const token = await this.fetchJson("/update/manual/token", { timeout: 8000 });
        const response = await this.fetchJson("/update/manual", {
          method: "POST",
          raw: true,
          body: file,
          timeout: 120000,
          headers: {
            "X-Update-Token": token.token || "",
            "X-Filename": encodeURIComponent(file.name)
          }
        });
        this.manualFile = null;
        this.job = response.job || this.job;
        this.render();
        this.startPoll();
      } catch (err) {
        this.job = { status: "error", error: this.errorText(err), code: err.code || "" };
        this.render();
      }
    }

    async runRollback() {
      if (!this.rollbackToken) {
        this.error = this.t("updateTokenExpired");
        this.confirm = "";
        this.render();
        return;
      }
      this.confirm = "";
      this.error = "";
      const version = this.data && this.data.backup ? this.data.backup.version : "";
      this.bootId = "";
      try {
        const health = await this.fetchJson("/health", { timeout: 5000 });
        this.bootId = health.bootId || "";
      } catch (err) {}
      const token = this.rollbackToken;
      this.rollbackToken = "";
      this.job = {
        status: "running", stage: "rollback", percent: 2,
        message: this.t("updateRollbackWorking"), toVersion: version
      };
      this.render();
      try {
        const response = await this.fetchJson("/update/rollback", {
          method: "POST",
          body: { token: token }
        });
        this.job = response.job || this.job;
        this.render();
        this.startPoll();
      } catch (err) {
        this.job = { status: "error", error: this.errorText(err), code: err.code || "" };
        this.render();
      }
    }

    startPoll() {
      this.stopPoll();
      this.pollFailures = 0;
      const self = this;
      this.pollTimer = window.setInterval(function () { self.pollJob(); }, 900);
      this.pollJob();
    }

    stopPoll() {
      if (this.pollTimer) {
        window.clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    }

    async pollJob() {
      if (this.pollBusy) return;
      this.pollBusy = true;
      try {
        const job = await this.fetchJson("/update/status", { timeout: 8000 });
        this.pollFailures = 0;
        this.job = job;
        const last = job.last || {};
        if ((!job.status || job.status === "idle") &&
            (last.status === "updated" || last.status === "rolled_back")) {
          this.stopPoll();
          this.waitForHealth(last.toVersion || job.toVersion ||
            (this.data && this.data.latestVersion));
          return;
        }
        if (job.status === "restarting") {
          this.stopPoll();
          this.render();
          this.waitForHealth(job.toVersion || (this.data && this.data.latestVersion));
          return;
        }
        if (job.status === "error") {
          this.stopPoll();
          this.render();
          return;
        }
        if (this.isOpen) this.render();
      } catch (err) {
        this.pollFailures += 1;
        const restarting = this.job && (
          this.job.status === "restarting" ||
          (this.job.status === "running" && this.pollFailures >= 2)
        );
        if (restarting) {
          this.stopPoll();
          this.waitForHealth(this.job.toVersion);
        }
      } finally {
        this.pollBusy = false;
      }
    }

    async waitForHealth(target) {
      if (this.waiting) return;
      this.waiting = true;
      this.job = Object.assign({}, this.job || {}, {
        status: "restarting",
        message: this.t("updateRestarting"),
        toVersion: target || ""
      });
      this.render();
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(this.bridge() + "/health", { cache: "no-store" });
          if (response.ok) {
            const health = await response.json();
            const restarted = this.bootId && health.bootId &&
              health.bootId !== this.bootId;
            const versionReady = !target || versionAtLeast(health.version, target);
            if ((this.bootId ? restarted : versionReady) && versionReady) {
              this.job = Object.assign({}, this.job, { status: "reloading" });
              this.render();
              await sleep(900);
              if (this.noReload) {
                this.waiting = false;
                this.job = Object.assign({}, this.job, { status: "done" });
                this.render();
                return;
              }
              window.location.reload();
              return;
            }
          }
        } catch (err) {}
        await sleep(900);
      }
      this.waiting = false;
      this.job = Object.assign({}, this.job, {
        status: "error", error: this.t("updateRestartTimeout")
      });
      this.render();
    }
  }

  AO.UpdateCenter = UpdateCenter;
})();
