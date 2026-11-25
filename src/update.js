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
