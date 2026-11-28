(function () {
  "use strict";

  const AO = window.AgentOffice;
  const CUI = AO.ChatUI;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function fmtCost(value, currency) {
    if (value === null || value === undefined) return "—";
    const code = String(currency || "").toUpperCase();
    if (code === "MIXED") return "MIXED";
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return "—";
    const prefix = code === "CNY" ? "¥" : code === "USD" ? "$" :
      (code ? code + " " : "");
    const amount = n > 0 && n < 0.0001 ? "<0.0001" :
      (n >= 1 ? n.toFixed(2) : n.toFixed(4));
    return prefix + amount;
  }

  function fmt(value) {
    const n = Number(value || 0);
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K";
    return String(Math.round(n));
  }

  class UsagePanel {
    constructor(renderer) {
      this.renderer = renderer;
      this.root = document.getElementById("usageRoot");
      this.calls = [];
      this.summary = {};
      this.missions = [];
      this.missionId = "";
      this.purpose = "all";
      this.query = "";
      this.selectedId = "";
      this.timer = null;
      this.loading = false;
      this.lastFocus = null;
      this.bind();
    }

    t(key, fallback) {
      const value = AO.t(key);
      return value === key ? (fallback || key) : value;
    }

    bridge() {
      const ext = this.renderer && this.renderer.external;
      return String((ext && ext.bridgeUrl) || AO.BRIDGE_DEFAULT || "").replace(/\/+$/, "");
    }

    async api(path) {
      const res = await fetch(this.bridge() + path, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
      return data;
    }

    open(options) {
      if (!this.root) return;
      const opts = options || {};
      this.lastFocus = document.activeElement;
      this.missionId = opts.missionId || "";
      this.selectedId = "";
      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");
      this.renderShell();
      if (AO.syncAppInert) AO.syncAppInert();
      this.load();
      this.stopAuto();
      this.timer = window.setInterval(() => {
        if (!document.hidden && this.root && !this.root.hidden) this.load(true);
      }, 7000);
    }

    close() {
      if (!this.root) return;
      this.stopAuto();
      this.root.hidden = true;
      this.root.innerHTML = "";
      this.root.setAttribute("aria-hidden", "true");
      if (AO.syncAppInert) AO.syncAppInert();
      if (this.lastFocus && this.lastFocus.isConnected) {
        try { this.lastFocus.focus({ preventScroll: true }); } catch (err) {}
      }
      this.lastFocus = null;
    }

    stopAuto() {
      if (this.timer) window.clearInterval(this.timer);
      this.timer = null;
    }

    async load(quiet) {
      if (!this.root || this.root.hidden) return;
      if (!quiet) this.loading = true;
      try {
        const params = new URLSearchParams();
        if (this.missionId) params.set("missionId", this.missionId);
        if (this.purpose !== "all") params.set("purpose", this.purpose);
        if (this.query) params.set("q", this.query);
        params.set("limit", "200");
        const [calls, missions] = await Promise.all([
          this.api("/model-calls?" + params.toString()),
          this.missions.length ? Promise.resolve({ missions: this.missions }) : this.api("/missions")
        ]);
        this.calls = calls.calls || [];
        this.summary = calls.summary || {};
        this.missions = missions.missions || [];
        this.loading = false;
        const select = this.root && this.root.querySelector("#usageMission");
        if (select) {
          select.innerHTML = '<option value="">' + esc(this.t("usageAllMissions", "全部任务")) + "</option>" +
            this.missions.map((m) => '<option value="' + esc(m.id) + '">' +
              esc(m.title) + "</option>").join("");
          select.value = this.missionId;
        }
        this.renderBody();
      } catch (err) {
        this.loading = false;
        const body = this.root && this.root.querySelector("#usageBody");
        if (body) body.innerHTML = '<div class="usage-empty"><span>!</span><b>' +
          esc(this.t("usageError", "模型调用读取失败")) + "</b><p>" + esc(err.message) + "</p></div>";
      }
    }

    renderShell() {
      this.root.innerHTML =
        '<div class="usage-backdrop" data-usage-close></div>' +
        '<section class="usage-window" role="dialog" aria-modal="true" aria-labelledby="usageTitle">' +
        '<header class="usage-head"><div><span class="usage-eyebrow">MODEL CALLS / TOKEN INSIGHT</span>' +
        '<h2 id="usageTitle">' + esc(this.t("usageTitle", "模型调用")) + '</h2>' +
        '<p>' + esc(this.t("usageSub", "每次讨论、任务、交付物和聊天调用的输入、输出、延迟与上下文，一眼看清消耗。")) + '</p></div>' +
        '<div class="usage-head-actions"><button type="button" class="usage-icon" data-usage-refresh title="' +
        esc(this.t("usageRefresh", "刷新")) + '">↻</button><button type="button" class="usage-icon" data-usage-close aria-label="' +
        esc(this.t("close", "关闭")) + '">×</button></div></header>' +
        '<div class="usage-toolbar">' +
        '<div class="usage-search">⌕<input id="usageSearch" type="search" value="' + esc(this.query) +
        '" placeholder="' + esc(this.t("usageSearch", "搜索任务、Agent、Provider 或错误")) + '" /></div>' +
        '<select id="usageMission"><option value="">' + esc(this.t("usageAllMissions", "全部任务")) + '</option>' +
        this.missions.map((m) => '<option value="' + esc(m.id) + '"' + (m.id === this.missionId ? " selected" : "") + '>' +
          esc(m.title) + '</option>').join("") + '</select>' +
        '<select id="usagePurpose">' +
        [["all", "usagePurposeAll", "全部类型"], ["task", "usagePurposeTask", "任务"],
         ["discussion", "usagePurposeDiscussion", "讨论"], ["deliverable", "usagePurposeDeliverable", "交付物"],
         ["chat", "usagePurposeChat", "聊天"]].map((row) =>
          '<option value="' + row[0] + '"' + (this.purpose === row[0] ? " selected" : "") + '>' +
          esc(this.t(row[1], row[2])) + '</option>').join("") + '</select></div>' +
        '<div class="usage-body" id="usageBody"></div></section>';
      const search = this.root.querySelector("#usageSearch");
      if (search) search.addEventListener("input", (event) => {
        this.query = event.target.value;
        window.clearTimeout(this.searchTimer);
        this.searchTimer = window.setTimeout(() => this.load(), 240);
      });
      const mission = this.root.querySelector("#usageMission");
      if (mission) mission.addEventListener("change", (event) => {
        this.missionId = event.target.value;
        this.selectedId = "";
        this.load();
      });
      const purpose = this.root.querySelector("#usagePurpose");
      if (purpose) purpose.addEventListener("change", (event) => {
        this.purpose = event.target.value;
        this.selectedId = "";
        this.load();
      });
      window.setTimeout(() => {
        const input = this.root && this.root.querySelector("#usageSearch");
        if (input && window.innerWidth > 760) {
          try { input.focus({ preventScroll: true }); } catch (err) {}
        }
      }, 40);
    }

    renderBody() {
      const body = this.root && this.root.querySelector("#usageBody");
      if (!body) return;
      const summary = this.summary || {};
      const rows = this.calls.map((call) => this.rowHTML(call)).join("");
      const selected = this.calls.find((call) => call.id === this.selectedId);
      body.innerHTML =
        '<div class="usage-stats">' +
        this.stat("usageStatCalls", "调用", summary.calls || 0) +
        this.stat("usageStatIn", "输入 Tokens", fmt(summary.tokensIn)) +
        this.stat("usageStatOut", "输出 Tokens", fmt(summary.tokensOut)) +
        this.stat("usageStatLatency", "平均延迟", (summary.avgMs || 0) + " ms") +
        this.stat("usageStatFailures", "失败", summary.failures || 0, summary.failures ? "bad" : "") +
        this.stat("usageStatCost", "成本",
          summary.currency === "MIXED" ? this.t("usageCostMixed", "混合币种") :
            fmtCost(summary.cost, summary.currency),
          summary.pricedCalls ? "cost" : "") +
        '</div>' +
        '<div class="usage-table-head"><span>' + esc(this.t("usageTime", "时间")) + '</span><span>' +
        esc(this.t("usagePurpose", "类型")) + '</span><span>' + esc(this.t("usageCall", "调用")) +
        '</span><span>' + esc(this.t("usageContext", "上下文")) + '</span><span>' +
        esc(this.t("usageTokens", "Tokens" )) + '</span><span>' + esc(this.t("usageCost", "成本")) +
        '</span><span>' + esc(this.t("usageLatency", "延迟")) + '</span></div>' +
        '<div class="usage-list">' + (rows ||
          '<div class="usage-empty"><span>◇</span><b>' + esc(this.t("usageEmpty", "还没有模型调用")) +
          '</b><p>' + esc(this.t("usageEmptyHint", "执行一次讨论、任务或聊天后，这里会出现真实调用记录。")) +
          '</p></div>') + '</div>' +
        (selected ? this.detailHTML(selected) : "");
    }

    stat(key, fallback, value, cls) {
      return '<div class="usage-stat ' + (cls || "") + '"><span>' + esc(this.t(key, fallback)) +
        '</span><b>' + esc(value) + '</b></div>';
    }

    purposeLabel(purpose) {
      const map = {
        task: ["usagePurposeTask", "任务"], discussion: ["usagePurposeDiscussion", "讨论"],
        deliverable: ["usagePurposeDeliverable", "交付物"], chat: ["usagePurposeChat", "聊天"],
        "provider-test": ["usagePurposeTest", "模型测试"], "provider-run": ["usagePurposeTest", "模型测试"]
      };
      const row = map[purpose] || ["usagePurposeOther", "其他"];
      return this.t(row[0], row[1]);
    }

    rowHTML(call) {
      const context = Number(call.promptChars || 0) + Number(call.systemChars || 0);
      return '<button type="button" class="usage-row' + (call.ok === false ? " failed" : "") +
        (call.id === this.selectedId ? " active" : "") + '" data-usage-row="' + esc(call.id) + '">' +
        '<span class="usage-time">' + esc(CUI.smartTime(call.createdAt)) + '</span>' +
        '<span class="usage-purpose ' + esc(call.purpose) + '">' + esc(this.purposeLabel(call.purpose)) + '</span>' +
        '<span class="usage-call"><b>' + esc(call.provider || "—") + '</b><em>' + esc(call.model || "") +
        '</em><i>' + esc(call.missionTitle || "—") + (call.taskTitle ? " · " + esc(call.taskTitle) : "") + '</i></span>' +
        '<span class="usage-context"><b>~' + fmt(call.contextTokens || Math.round(context / 3.2)) +
        '</b><em>' + fmt(context) + ' chars</em></span>' +
        '<span class="usage-tokens"><b>' + fmt(call.tokensIn) + ' / ' + fmt(call.tokensOut) +
        '</b><em>in / out</em></span>' +
        '<span class="usage-cost"><b>' + esc(fmtCost(call.cost, call.currency)) +
        '</b><em>' + esc(call.cost == null ? this.t("usageCostUnknown", "未配置价格") : "model") +
        '</em></span>' +
        '<span class="usage-latency"><b>' + (call.durationMs || 0) + ' ms</b><em class="' +
        (call.ok === false ? "fail" : "ok") + '">' + (call.ok === false ? esc(this.t("usageFailed", "失败")) : "OK") + '</em></span>' +
        '</button>';
    }

    detailHTML(call) {
      return '<div class="usage-detail"><div class="usage-detail-head"><b>' + esc(call.provider || "—") +
        ' · ' + esc(call.model || "") + '</b><button type="button" data-usage-detail-close>×</button></div>' +
        '<div class="usage-detail-grid">' +
        '<div><span>Mission</span><b>' + esc(call.missionTitle || "—") + '</b></div>' +
        '<div><span>Task</span><b>' + esc(call.taskTitle || "—") + '</b></div>' +
        '<div><span>Agent</span><b>' + esc(call.agentName || "—") + '</b></div>' +
        '<div><span>Context</span><b>~' + fmt(call.contextTokens) + ' tokens · ' +
        fmt(Number(call.promptChars || 0) + Number(call.systemChars || 0)) + ' chars</b></div>' +
        '<div><span>Tokens in / out</span><b>' + fmt(call.tokensIn) + ' / ' + fmt(call.tokensOut) + '</b></div>' +
        '<div><span>Latency</span><b>' + (call.durationMs || 0) + ' ms</b></div>' +
        '<div><span>' + esc(this.t("usageCost", "成本")) + '</span><b>' +
        esc(fmtCost(call.cost, call.currency)) + '</b></div>' +
        '</div>' + (call.error ? '<p class="usage-error">' + esc(call.error) + '</p>' : "") + '</div>';
    }

    bind() {
      if (!this.root) return;
      this.root.addEventListener("click", (event) => {
        if (event.target.closest("[data-usage-close]")) { this.close(); return; }
        if (event.target.closest("[data-usage-refresh]")) { this.load(); return; }
        if (event.target.closest("[data-usage-detail-close]")) { this.selectedId = ""; this.renderBody(); return; }
        const row = event.target.closest("[data-usage-row]");
        if (row) {
          const id = row.getAttribute("data-usage-row");
          this.selectedId = this.selectedId === id ? "" : id;
          this.renderBody();
        }
      });
      document.addEventListener("keydown", (event) => {
        if (!this.root || this.root.hidden) return;
        if (event.key === "Escape") this.close();
      });
    }
  }

  AO.UsagePanel = UsagePanel;
})();
