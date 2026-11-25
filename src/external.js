(function () {
  "use strict";

  const AO = window.AgentOffice;
  const NAME_KEY = "agent-office.names.v1";
  const EXT_KEY = "agent-office.external.v1";
  const BRIDGE_KEY = "agent-office.bridge-url";
  const DEFAULT_BRIDGE = "http://127.0.0.1:8787";

  AO.NAME_KEY = NAME_KEY;
  AO.EXTERNAL_KEY = EXT_KEY;
  AO.BRIDGE_DEFAULT = DEFAULT_BRIDGE;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {}
  }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function timeShort(epoch) {
    const d = new Date(Number(epoch) * 1000);
    return String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0");
  }

  function countdown(epoch) {
    const left = Math.max(0, Math.floor(Number(epoch) - Date.now() / 1000));
    if (!left) return "已过期";
    const m = Math.floor(left / 60);
    const s = left % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  AO.loadNames = function () {
    const names = readJson(NAME_KEY, {});
    if (!names || typeof names !== "object") return;
    AO.AGENTS.forEach(function (agent) {
      if (names[agent.id]) agent.name = String(names[agent.id]).slice(0, 16);
    });
  };

  AO.saveName = function (id, name) {
    const names = readJson(NAME_KEY, {});
    names[id] = String(name).slice(0, 16);
    writeJson(NAME_KEY, names);
  };

  class ExternalAgents {
    constructor(engine, renderer) {
      this.engine = engine;
      this.renderer = renderer;
      this.root = document.getElementById("externalModal");
      this.btn = document.getElementById("externalBtn");
      this.bridgeUrl = (function () {
        try { return localStorage.getItem(BRIDGE_KEY) || DEFAULT_BRIDGE; }
        catch (err) { return DEFAULT_BRIDGE; }
      })();
      this.profiles = readJson(EXT_KEY, []);
      if (!Array.isArray(this.profiles)) this.profiles = [];
      this.pairs = [];
      this.pairMessages = {};
      this.agents = [];
      this.assignments = [];
      this.providers = [];
      this.providerBusy = {};
      this.providerConfigError = "";
      this.bridgeOnline = false;
      this.demo = false;
      this.cursor = null;
      this.busy = false;
      this.lastSig = "";
      this.pollTimer = null;
      this.buildShell();
      this.bind();
      this.refresh();
      this.pollTimer = window.setInterval(() => this.refresh(), 2500);
    }

    buildShell() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      this.root.setAttribute("role", "dialog");
      this.root.setAttribute("aria-modal", "true");
      this.root.setAttribute("aria-label", "接入外部 Agent");
      this.root.innerHTML =
        '<div class="ext-backdrop" data-ext-close></div>' +
        '<div class="ext-shell">' +
          '<header class="ext-head"><div><span>EXTERNAL AGENT LINK</span>' +
          '<h2>接入外部 Agent</h2><p>本地 bridge 负责注册、心跳和事件转发；API key 不进入前端。</p></div>' +
          '<button type="button" class="ext-close" data-ext-close aria-label="关闭">×</button></header>' +
          '<div class="ext-bridge">' +
            '<label>BRIDGE<input id="extBridgeUrl" value="' + esc(this.bridgeUrl) + '" /></label>' +
            '<button type="button" data-ext-check>测试连接</button>' +
            '<span class="ext-status" id="extBridgeStatus">CHECKING…</span>' +
            '<button type="button" data-ext-demo class="ext-demo">启动演示 Agent</button>' +
          '</div>' +
          '<section class="ext-providers">' +
            '<div class="ext-provider-head">' +
              '<div><h3>MODEL APIS</h3><span>豆包 / DeepSeek / WorkBuddy / Gemini / Claude / OpenAI …</span></div>' +
              '<div class="ext-provider-head-actions">' +
                '<button type="button" data-ext-provider-help>密钥配置</button>' +
                '<button type="button" data-ext-providers-refresh>刷新</button>' +
              '</div>' +
            '</div>' +
            '<div class="ext-provider-rail" id="extProviderList"></div>' +
            '<p class="ext-provider-note">API key 只放 bridge 环境变量或 <code>~/.agent-office/providers.json</code>，前端永远不接触密钥；点「接入」创建一个可试跑的模型 Agent。</p>' +
          '</section>' +
          '<div class="ext-body">' +
            '<div class="ext-left">' +
              '<section class="ext-invite">' +
                '<h3>INVITE AGENT</h3>' +
                '<p>生成一次性连接码，把下面这段话发给 Claude Code / Codex / 任意能执行命令的 Agent。它读完 setup.md 后会自己完成配对。</p>' +
                '<button type="button" class="ext-pair-new" data-ext-pair-new>生成一次性连接码</button>' +
                '<div class="ext-pair-list" id="extPairList"></div>' +
                '<p class="ext-hint">连接码一次性有效，30 分钟后过期。每次生成都会得到新的码；旧码在过期前仍可用。不要把连接码发到公开群。</p>' +
              '</section>' +
              '<details class="ext-manual"><summary>手动登记离线档案</summary>' +
                '<section class="ext-form">' +
                  '<label>名称<input id="extName" maxlength="40" value="Claude Code · Remote" /></label>' +
                  '<label>Runtime<select id="extRuntime">' +
                    '<option value="claude-code">Claude Code</option>' +
                    '<option value="codex">Codex</option>' +
                    '<option value="doubao">豆包 Doubao</option>' +
                    '<option value="deepseek">DeepSeek</option>' +
                    '<option value="workbuddy">WorkBuddy</option>' +
                    '<option value="gemini">Gemini</option>' +
                    '<option value="openai">OpenAI</option>' +
                    '<option value="anthropic">Claude API</option>' +
                    '<option value="kimi">Kimi</option>' +
                    '<option value="qwen">Qwen</option>' +
                    '<option value="ollama">Ollama</option>' +
                    '<option value="http">HTTP Agent</option>' +
                    '<option value="otel">OTel / SDK</option>' +
                    '<option value="other">Other</option>' +
                  '</select></label>' +
                  '<label>Endpoint<input id="extEndpoint" placeholder="http://127.0.0.1:9000 或 local://..." /></label>' +
                  '<label>Skills（逗号分隔）<input id="extSkills" value="repo-map, edit, test" /></label>' +
                  '<label>备注<input id="extNote" value="外部 agent 通过 bridge 上报心跳和事件" /></label>' +
                  '<button type="button" class="ext-add" data-ext-add>登记离线档案</button>' +
                '</section>' +
              '</details>' +
            '</div>' +
            '<section class="ext-list-wrap"><div class="ext-list-head"><h3>CONNECTED</h3><b id="extCount">0</b></div>' +
              '<div class="ext-list" id="extList"></div></section>' +
          '</div>' +
        '</div>';
      this.urlEl = this.root.querySelector("#extBridgeUrl");
      this.statusEl = this.root.querySelector("#extBridgeStatus");
      this.listEl = this.root.querySelector("#extList");
      this.countEl = this.root.querySelector("#extCount");
      this.pairListEl = this.root.querySelector("#extPairList");
      this.providerListEl = this.root.querySelector("#extProviderList");
      this.demoBtn = this.root.querySelector("[data-ext-demo]");
      this.nameEl = this.root.querySelector("#extName");
      this.runtimeEl = this.root.querySelector("#extRuntime");
      this.endpointEl = this.root.querySelector("#extEndpoint");
      this.skillsEl = this.root.querySelector("#extSkills");
      this.noteEl = this.root.querySelector("#extNote");
      this.renderList();
      this.renderProviders();
    }

    bind() {
      const self = this;
      if (this.btn) this.btn.addEventListener("click", function () { self.open(); });
      if (!this.root) return;
      this.root.addEventListener("click", function (e) {
        if (e.target.closest("[data-ext-close]")) {
          self.close();
          return;
        }
        if (e.target.closest("[data-ext-check]")) {
          self.check();
          return;
        }
        if (e.target.closest("[data-ext-pair-new]")) {
          self.generatePair();
          return;
        }
        const copyPair = e.target.closest("[data-ext-copy-pair]");
        if (copyPair) {
          self.copyPair(copyPair.getAttribute("data-ext-copy-pair"));
          return;
        }
        const cancelPair = e.target.closest("[data-ext-cancel-pair]");
        if (cancelPair) {
          self.cancelPair(cancelPair.getAttribute("data-ext-cancel-pair"));
          return;
        }
        if (e.target.closest("[data-ext-add]")) {
          self.addFromForm();
          return;
        }
        if (e.target.closest("[data-ext-demo]")) {
          self.toggleDemo();
          return;
        }
        if (e.target.closest("[data-ext-provider-help]")) {
          self.copyProviderHelp();
          return;
        }
        if (e.target.closest("[data-ext-providers-refresh]")) {
          self.refreshProviders();
          return;
        }
        const providerConnect = e.target.closest("[data-ext-provider-connect]");
        if (providerConnect) {
          self.connectProvider(providerConnect.getAttribute("data-ext-provider-connect"));
          return;
        }
        const providerRun = e.target.closest("[data-ext-provider-run]");
        if (providerRun) {
          self.runProvider(providerRun.getAttribute("data-ext-provider-run"));
          return;
        }
        const rename = e.target.closest("[data-ext-rename]");
        if (rename) {
          const agent = self.agentById(rename.getAttribute("data-ext-rename"));
          if (agent && self.renderer.renameDialog) {
            self.renderer.renameDialog.open("external", agent.id, agent.name);
          }
          return;
        }
        const remove = e.target.closest("[data-ext-remove]");
        if (remove) {
          self.remove(remove.getAttribute("data-ext-remove"));
        }
      });
      if (this.urlEl) {
        this.urlEl.addEventListener("change", function () {
          self.setBridgeUrl(self.urlEl.value);
        });
      }
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && self.isOpen) self.close();
      });
    }

    open() {
      if (!this.root) return;
      this.isOpen = true;
      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");
      const app = document.getElementById("app");
      if (app) app.inert = true;
      this.renderList();
      this.renderPairs();
      this.renderProviders();
      this.check();
      this.refresh();
      const pairNew = this.root.querySelector("[data-ext-pair-new]");
      if (pairNew) pairNew.focus({ preventScroll: true });
    }

    close() {
      if (!this.root) return;
      this.isOpen = false;
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      const app = document.getElementById("app");
      if (app) app.inert = false;
      if (this.btn) this.btn.focus({ preventScroll: true });
    }

    async request(path, options, timeoutMs) {
      const controller = new AbortController();
      const timer = window.setTimeout(function () { controller.abort(); }, timeoutMs || 2600);
      try {
        const url = this.bridgeUrl.replace(/\/+$/, "") + path;
        const res = await fetch(url, Object.assign({
          signal: controller.signal,
          headers: { "Content-Type": "application/json" }
        }, options || {}));
        let data = null;
        try { data = await res.json(); } catch (err) {}
        if (!res.ok) {
          const error = new Error((data && data.error) || ("bridge " + res.status));
          error.status = res.status;
          error.data = data;
          throw error;
        }
        return data;
      } finally {
        window.clearTimeout(timer);
      }
    }

    setBridgeUrl(url) {
      this.bridgeUrl = String(url || "").trim().replace(/\/+$/, "") || DEFAULT_BRIDGE;
      try { localStorage.setItem(BRIDGE_KEY, this.bridgeUrl); } catch (err) {}
      this.cursor = null;
      this.bridgeOnline = false;
      this.pairs = [];
      this.providers = [];
      this._pairStatus = {};
      this.renderProviders();
      this.refresh();
    }

    async check() {
      if (this.statusEl) this.statusEl.textContent = "CHECKING…";
      try {
        const health = await this.request("/health");
        this.bridgeOnline = true;
        this.demo = !!health.demo;
        if (this.statusEl) {
          this.statusEl.textContent = "ONLINE · " + health.agents + " agents · " + health.events + " events";
          this.statusEl.className = "ext-status online";
        }
        return health;
      } catch (err) {
        this.bridgeOnline = false;
        this.demo = false;
        if (this.statusEl) {
          this.statusEl.textContent = "OFFLINE · 启动 python3 bridge.py";
          this.statusEl.className = "ext-status offline";
        }
        return null;
      }
    }

    async refresh() {
      if (this.busy) return;
      this.busy = true;
      try {
        const health = await this.request("/health");
        this.bridgeOnline = true;
        this.demo = !!health.demo;
        try {
          const providerRes = await this.request("/providers");
          this.providers = providerRes.providers || [];
          this.providerConfigError = providerRes.configError || "";
        } catch (err) {
          this.providers = [];
          this.providerConfigError = "";
        }
        const pairRes = await this.request("/pairs");
        const previousStatus = this._pairStatus || {};
        this.pairs = pairRes.pairs || [];
        this._pairStatus = {};
        this.pairs.forEach((p) => {
          this._pairStatus[p.code] = p.status;
          if (previousStatus[p.code] === "pending" && p.status === "claimed") {
            const claimed = this.agentById(p.agentId) ||
              (this.agents || []).find((a) => a.id === p.agentId);
            this.renderer.toast((claimed ? claimed.name : "外部 Agent") + " 已接入");
          }
        });
        let bridgeAgents = (await this.request("/agents")).agents || [];

        // offline-created local profiles are authoritative until synced
        let synced = false;
        for (const p of this.profiles) {
          if (!p.dirty) continue;
          try {
            await this.request("/agents", {
              method: "POST",
              body: JSON.stringify({
                id: p.id, name: p.name, runtime: p.runtime,
                endpoint: p.endpoint, skills: p.skills, note: p.note, color: p.color
              })
            });
            p.dirty = false;
            synced = true;
          } catch (err) {}
        }
        if (synced) {
          writeJson(EXT_KEY, this.profiles);
          bridgeAgents = (await this.request("/agents")).agents || [];
        }

        const map = {};
        this.profiles.forEach(function (p) {
          map[p.id] = Object.assign({}, p, { status: "offline", eventCount: 0 });
        });
        bridgeAgents.forEach(function (a) {
          map[a.id] = Object.assign({}, map[a.id] || {}, a, {
            status: a.status || "offline",
            eventCount: a.eventCount || 0
          });
        });
        this.agents = Object.keys(map).map(function (id) { return map[id]; });

        try {
          const assignmentRes = await this.request("/assignments");
          this.assignments = assignmentRes.assignments || [];
          this.assignments.forEach((assignment) => {
            this.engine.applyExternalAssignment(assignment, this.agentById(assignment.agentId));
          });
        } catch (err) {
          this.assignments = [];
        }

        if (this.cursor == null) this.cursor = health.lastEventId || 0;
        if ((health.lastEventId || 0) < this.cursor) this.cursor = health.lastEventId || 0;
        const result = await this.request("/events?since=" + this.cursor);
        const events = result.events || [];
        let ingested = 0;
        const self = this;
        events.forEach(function (e) {
          if (self.engine.ingestExternalEvent(e)) ingested += 1;
        });
        if (events.length) {
          this.cursor = Math.max.apply(null, events.map(function (e) { return e.id; }));
          try { localStorage.setItem("agent-office.ext-cursor", String(this.cursor)); } catch (err) {}
        }

        this.setStatus(true, health);
        if (ingested) {
          this.renderer.render();
        } else {
          this.notifyRoster();
        }
        this.renderList();
        this.renderPairs();
        this.renderProviders();
      } catch (err) {
        this.bridgeOnline = false;
        this.demo = false;
        this.agents = this.profiles.map(function (p) {
          return Object.assign({}, p, { status: "offline", eventCount: 0 });
        });
        this.setStatus(false, null);
        this.notifyRoster();
        this.renderList();
        this.renderPairs();
        this.renderProviders();
      } finally {
        this.busy = false;
      }
    }

    setStatus(online, health) {
      if (this.statusEl) {
        this.statusEl.textContent = online
          ? "ONLINE · " + (health ? health.events : 0) + " events"
          : "OFFLINE · 启动 python3 bridge.py";
        this.statusEl.className = "ext-status " + (online ? "online" : "offline");
      }
      if (this.demoBtn) {
        this.demoBtn.textContent = this.demo ? "停止演示 Agent" : "启动演示 Agent";
        this.demoBtn.classList.toggle("is-on", this.demo);
      }
    }

    notifyRoster() {
      const sig = this.agents.map(function (a) {
        return a.id + ":" + a.name + ":" + a.status + ":" + (a.eventCount || 0);
      }).join("|") + "|" + this.bridgeOnline + "|" + this.demo + "|" +
        this.pendingPairs().map(function (p) { return p.code + ":" + p.status; }).join(",");
      if (sig === this.lastSig) return;
      this.lastSig = sig;
      if (this.renderer && this.renderer.world) this.renderer.renderRoster();
      if (this.renderer && this.renderer.drawerMode === "external") {
        this.renderer.renderDrawer();
      }
    }

    agentById(id) {
      return this.agents.find(function (a) { return a.id === id; });
    }

    eventsFor(id) {
      return this.engine.world.ledger.filter(function (e) {
        return e.agentId === id;
      }).slice(-16).reverse();
    }

    assignmentsFor(id) {
      return (this.assignments || []).filter(function (assignment) {
        return assignment.agentId === id;
      }).slice(0, 8);
    }

    assignmentForTask(taskId) {
      return (this.assignments || []).find(function (assignment) {
        return assignment.taskId === taskId &&
          (assignment.status === "assigned" || assignment.status === "in_progress");
      }) || null;
    }

    async delegateTask(taskId, agentId, brief) {
      if (!this.bridgeOnline) {
        this.renderer.toast("先启动 bridge：python3 bridge.py");
        return false;
      }
      const task = this.engine.taskById(taskId);
      const agent = this.agentById(agentId);
      if (!task || !agent) {
        this.renderer.toast("找不到任务或外部 Agent");
        return false;
      }
      const check = this.engine.canDelegateTask(task);
      if (!check.ok) {
        this.renderer.toast(check.error || "这个任务不能委托");
        return false;
      }
      try {
        const res = await this.request("/assignments", {
          method: "POST",
          body: JSON.stringify({
            agentId: agentId,
            taskId: task.id,
            title: task.title,
            scenarioId: this.engine.scenarioId,
            runId: this.engine.world.runId,
            brief: String(brief || task.desc || "").slice(0, 800)
          })
        }, 8000);
        this.assignments = [res.assignment].concat((this.assignments || []).filter(function (a) {
          return a.id !== res.assignment.id;
        }));
        this.engine.applyExternalAssignment(res.assignment, agent);
        this.renderer.render();
        if (this.renderer.drawerMode === "task") this.renderer.renderDrawer();
        this.renderer.toast("任务已派给 " + agent.name);
        await this.refresh();
        return true;
      } catch (err) {
        this.renderer.toast("派发失败 · " + String(err.message || "检查 bridge").slice(0, 100));
        return false;
      }
    }

    async addFromForm() {
      const name = String(this.nameEl.value || "").trim();
      if (!name) {
        this.renderer.toast("先给外部 agent 起个名字");
        return;
      }
      const profile = {
        id: "ext-" + Math.random().toString(16).slice(2, 10),
        name: name.slice(0, 40),
        runtime: this.runtimeEl.value,
        endpoint: String(this.endpointEl.value || "").trim(),
        skills: String(this.skillsEl.value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean),
        note: String(this.noteEl.value || "").trim(),
        color: "#b58cff",
        createdAt: new Date().toISOString(),
        status: "offline",
        eventCount: 0,
        dirty: true
      };
      this.profiles.push(profile);
      writeJson(EXT_KEY, this.profiles);
      if (this.bridgeOnline) {
        try {
          await this.request("/agents", { method: "POST", body: JSON.stringify(profile) });
          profile.dirty = false;
          writeJson(EXT_KEY, this.profiles);
        } catch (err) {}
      }
      this.close();
      this.renderer.toast(profile.name + " 已登记 · " + (this.bridgeOnline ? "等待心跳" : "bridge 上线后同步"));
      this.refresh();
    }

    async rename(id, name) {
      const next = String(name || "").trim();
      if (!next) return false;
      let p = this.profiles.find(function (x) { return x.id === id; });
      if (p) {
        p.name = next;
        p.dirty = true;
        writeJson(EXT_KEY, this.profiles);
      }
      if (this.bridgeOnline) {
        try {
          await this.request("/agents/" + encodeURIComponent(id), {
            method: "PATCH", body: JSON.stringify({ name: next })
          });
          if (p) { p.dirty = false; writeJson(EXT_KEY, this.profiles); }
        } catch (err) {}
      }
      await this.refresh();
      return true;
    }

    async diagnose(agent) {
      if (!agent) return;
      const message = "Agent Office connection diagnostics\n\n" +
        "Bridge: " + this.bridgeUrl + "\n" +
        "Agent ID: " + agent.id + "\n" +
        "Runtime: " + (agent.runtime || "external") + "\n" +
        (agent.provider ? "Provider: " + agent.provider + " · " + (agent.model || "") + "\n" : "") +
        "Status: " + (agent.status || "offline") + "\n\n" +
        "1. Heartbeat: POST " + this.bridgeUrl + "/agents/" + agent.id + "/heartbeat" +
        " with {\"note\":\"alive\"}\n" +
        "2. Send a test event: POST " + this.bridgeUrl + "/events" +
        " with {\"agentId\":\"" + agent.id + "\",\"kind\":\"hello\",\"action\":\"reconnect test\"}\n" +
        "3. If the bridge restarted, keep the same agentId; do not create a new identity.\n" +
        "4. If the runtime needs a restart, restart it and send the heartbeat again.";
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(message);
        } else {
          const ta = document.createElement("textarea");
          ta.value = message;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        this.renderer.toast("诊断修复指令已复制");
      } catch (err) {
        this.renderer.toast("复制诊断指令失败");
      }
    }

    async remove(id) {
      const agent = this.agentById(id);
      this.profiles = this.profiles.filter(function (p) { return p.id !== id; });
      writeJson(EXT_KEY, this.profiles);
      if (this.bridgeOnline) {
        try {
          await this.request("/agents/" + encodeURIComponent(id), { method: "DELETE" });
        } catch (err) {}
      }
      this.renderer.toast((agent ? agent.name : "外部 agent") + " 已移除 · 历史事件保留");
      this.refresh();
    }

    async toggleDemo() {
      if (!this.bridgeOnline) {
        this.renderer.toast("先启动 bridge：python3 bridge.py");
        return;
      }
      try {
        await this.request(this.demo ? "/demo/stop" : "/demo/start", { method: "POST" });
        await this.refresh();
        this.renderer.toast(this.demo ? "演示 Agent 已启动" : "演示 Agent 已停止");
      } catch (err) {
        this.renderer.toast("演示 Agent 启动失败");
      }
    }

    providerById(id) {
      return (this.providers || []).find(function (p) { return p.id === id; });
    }

    async refreshProviders() {
      try {
        const res = await this.request("/providers", null, 8000);
        this.providers = res.providers || [];
        this.providerConfigError = res.configError || "";
        this.renderProviders();
        this.renderer.toast("模型接口列表已刷新");
      } catch (err) {
        this.renderer.toast("刷新模型接口失败 · 检查 bridge");
      }
    }

    async copyProviderHelp() {
      const message = "Agent Office · 模型 API 密钥配置\n\n" +
        "API key 只放在 bridge，不进入前端。两种方式：\n\n" +
        "1) 环境变量（重启 bridge 生效）\n" +
        "   export DEEPSEEK_API_KEY=sk-...\n" +
        "   export GEMINI_API_KEY=...\n" +
        "   export DOUBAO_API_KEY=...\n" +
        "   export WORKBUDDY_API_KEY=...   # 本地网关可留空\n\n" +
        "2) 新建 ~/.agent-office/providers.json（不在网页目录，无需重启）\n" +
        "{\n" +
        '  "deepseek": { "apiKey": "sk-...", "model": "deepseek-chat" },\n' +
        '  "gemini": { "apiKey": "...", "model": "gemini-2.5-flash" },\n' +
        '  "workbuddy": { "baseUrl": "http://127.0.0.1:10108/v1", "model": "hy3" }\n' +
        "}\n\n" +
        "保存后点「刷新」。密钥不会进入浏览器或导出的 trace。\n" +
        "完整说明：docs/PROVIDERS.md";
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(message);
        } else {
          const ta = document.createElement("textarea");
          ta.value = message;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        this.renderer.toast("密钥配置说明已复制");
      } catch (err) {
        this.renderer.toast("复制失败，请查看 docs/PROVIDERS.md");
      }
    }

    async connectProvider(id) {
      if (!this.bridgeOnline) {
        this.renderer.toast("先启动 bridge：python3 bridge.py");
        return;
      }
      this.providerBusy[id] = "connect";
      this.renderProviders();
      try {
        const res = await this.request("/providers/" + encodeURIComponent(id) + "/connect", {
          method: "POST", body: "{}"
        }, 12000);
        this.renderer.toast((res.agent && res.agent.name || id) + (res.created ? " 已接入" : " 已重新连接"));
        await this.refresh();
      } catch (err) {
        this.renderer.toast("接入失败 · " + String(err.message || "检查密钥").slice(0, 90));
      } finally {
        delete this.providerBusy[id];
        this.renderProviders();
      }
    }

    async runProvider(id) {
      if (!this.bridgeOnline) {
        this.renderer.toast("先启动 bridge：python3 bridge.py");
        return;
      }
      this.providerBusy[id] = "run";
      this.renderProviders();
      try {
        const res = await this.request("/providers/" + encodeURIComponent(id) + "/run", {
          method: "POST",
          body: JSON.stringify({
            prompt: "用一句话说明你能为这个团队做什么，并给出一个风险提示。",
            maxTokens: 240
          })
        }, 45000);
        const tokens = (res.tokensIn || 0) + "/" + (res.tokensOut || 0);
        this.renderer.toast("模型已返回 · " + tokens + " tokens · " + (res.durationMs || 0) + "ms");
        await this.refresh();
      } catch (err) {
        this.renderer.toast("模型调用失败 · " + String(err.message || "检查 bridge").slice(0, 100));
      } finally {
        delete this.providerBusy[id];
        this.renderProviders();
      }
    }

    renderProviders() {
      if (!this.providerListEl) return;
      const providers = this.providers || [];
      if (!providers.length) {
        this.providerListEl.innerHTML =
          '<div class="ext-provider-empty">bridge 在线后显示模型接口；启动 <code>python3 bridge.py</code> 再点刷新。</div>';
        return;
      }
      const configError = this.providerConfigError
        ? '<div class="ext-provider-error">配置读取失败：' + esc(this.providerConfigError) + "</div>"
        : "";
      this.providerListEl.innerHTML = configError + providers.map((p) => {
        const configured = !!p.configured;
        const busy = this.providerBusy[p.id];
        const state = busy ? (busy === "run" ? "RUNNING" : "LINKING")
          : configured ? (p.local ? "LOCAL" : "READY") : "NO KEY";
        const actions = busy
          ? '<span class="ep-busy">' + (busy === "run" ? "调用中…" : "接入中…") + "</span>"
          : configured
            ? '<button type="button" data-ext-provider-connect="' + esc(p.id) + '">接入</button>' +
              '<button type="button" data-ext-provider-run="' + esc(p.id) + '" class="primary">试跑</button>'
            : '<button type="button" data-ext-provider-help title="配置 ' + esc(p.keyEnv || "API key") + '">配置密钥</button>';
        return '<div class="ext-provider' + (configured ? " is-ready" : "") +
          (busy ? " is-busy" : "") + '" data-provider="' + esc(p.id) + '">' +
          '<div class="ep-top"><b>' + esc(p.name) + "</b>" +
          '<span class="ep-state ' + (configured ? "ready" : "missing") + '">' + state + "</span></div>" +
          '<em title="' + esc(p.vendor + " · " + p.model) + '">' + esc(p.vendor) + " · " + esc(p.model) + "</em>" +
          '<div class="ep-actions">' + actions + "</div></div>";
      }).join("");
    }

    pendingPairs() {
      return (this.pairs || []).filter(function (p) { return p.status === "pending"; });
    }

    pairMessage(pair) {
      if (this.pairMessages[pair.code]) return this.pairMessages[pair.code];
      const setup = this.bridgeUrl.replace(/\/+$/, "") + "/pair/" + pair.code + "/setup.md";
      const exp = pair.expiresAt
        ? timeShort(pair.expiresAt) : "30 分钟内";
      return "你正在接入 Agent Office。\n\n" +
        "1. 打开下面的接入说明并按其操作：\n" + setup + "\n\n" +
        "2. 连接码：" + pair.code + "（一次性，30 分钟内有效，过期时间 " + exp + "）\n" +
        "3. 完成后请向 Agent Office 发送一条问候事件。\n\n" +
        "如果连接码已过期或被使用，请在 Agent Office 里重新生成一段。";
    }

    async generatePair() {
      if (!this.bridgeOnline) {
        this.renderer.toast("先启动 bridge：python3 bridge.py");
        await this.check();
        return;
      }
      try {
        const res = await this.request("/pair/code", {
          method: "POST",
          body: JSON.stringify({ nameHint: "External Agent" })
        });
        const pair = res.pair;
        this.pairMessages[pair.code] = res.message || this.pairMessage(pair);
        this.pairs = [pair].concat((this.pairs || []).filter(function (p) {
          return p.code !== pair.code;
        }));
        this._pairStatus = this._pairStatus || {};
        this._pairStatus[pair.code] = "pending";
        this.renderPairs();
        this.renderer.toast("连接码已生成 · 点「复制给 Agent」");
      } catch (err) {
        this.renderer.toast("生成连接码失败，检查 bridge 是否在线");
      }
    }

    async copyPair(code) {
      const pair = (this.pairs || []).find(function (p) { return p.code === code; });
      if (!pair) return;
      const message = this.pairMessage(pair);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(message);
        } else {
          const ta = document.createElement("textarea");
          ta.value = message;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        this.renderer.toast("连接说明已复制 · 发给你的 Agent");
      } catch (err) {
        this.renderer.toast("复制失败，请手动选择连接说明");
      }
    }

    async cancelPair(code) {
      try {
        if (this.bridgeOnline) {
          await this.request("/pair/" + encodeURIComponent(code), { method: "DELETE" });
        }
      } catch (err) {}
      this.pairs = (this.pairs || []).filter(function (p) { return p.code !== code; });
      delete this.pairMessages[code];
      this.renderPairs();
      this.refresh();
    }

    renderPairs() {
      if (this.renderer && this.renderer.world) {
        this.renderer.renderRoster();
      }
      if (!this.pairListEl) return;
      const pairs = (this.pairs || []).filter(function (p) {
        return p.status === "pending" || p.status === "expired";
      }).sort(function (a, b) {
        return String(b.createdAt).localeCompare(String(a.createdAt));
      }).slice(0, 5);
      if (!pairs.length) {
        this.pairListEl.innerHTML =
          '<div class="ext-pair-empty">还没有待接入的连接码。点上面的按钮生成一个。</div>';
        return;
      }
      this.pairListEl.innerHTML = pairs.map((p) => {
        const expired = p.status === "expired";
        const code = esc(p.code);
        const setup = this.bridgeUrl.replace(/\/+$/, "") + "/pair/" + encodeURIComponent(p.code) + "/setup.md";
        const remain = expired ? "已过期" : countdown(p.expiresAt);
        return '<div class="ext-pair-item ' + (expired ? "is-expired" : "") + '">' +
          '<div class="ext-pair-top"><b class="ext-pair-code">' + code + "</b>" +
          '<span class="ext-pair-time">' + remain + "</span></div>" +
          '<div class="ext-pair-note">' + (expired
            ? "连接码已失效，请重新生成"
            : "等待 Agent 完成 setup · 一次性") + "</div>" +
          '<div class="ext-pair-actions">' +
          (expired ? "" : '<button type="button" data-ext-copy-pair="' + code +
            '" class="primary">复制给 Agent</button>') +
          '<a href="' + setup + '" target="_blank" rel="noopener">setup.md</a>' +
          '<button type="button" data-ext-cancel-pair="' + code + '">取消</button>' +
          "</div></div>";
      }).join("");
    }

    renderList() {
      if (!this.listEl) return;
      const agents = this.agents.length ? this.agents : this.profiles;
      this.countEl.textContent = String(agents.length);
      if (!agents.length) {
        this.listEl.innerHTML = '<div class="ext-empty">还没有外部 agent。添加一个档案，或启动演示 Agent。</div>';
        return;
      }
      this.listEl.innerHTML = agents.map((a) => {
        const online = a.status === "online";
        const detail = [a.runtime || "external", a.model, (a.eventCount || 0) + " events",
          a.demo ? "DEMO" : "", a.managed ? "API" : ""].filter(Boolean).join(" · ");
        return '<div class="ext-item"><span class="ext-item-dot ' + (online ? "online" : "offline") + '"></span>' +
          '<div class="ext-item-copy"><b>' + esc(a.name) + '</b><em>' + esc(detail) + "</em></div>" +
          '<div class="ext-item-actions"><button type="button" data-ext-rename="' + esc(a.id) +
          '" title="重命名">✎</button><button type="button" data-ext-remove="' + esc(a.id) +
          '" title="移除">×</button></div></div>';
      }).join("");
    }
  }

  class RenameDialog {
    constructor(engine, renderer, external) {
      this.engine = engine;
      this.renderer = renderer;
      this.external = external;
      this.root = document.getElementById("renameModal");
      this.kind = "local";
      this.id = null;
      this.buildShell();
      this.bind();
    }

    buildShell() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      this.root.setAttribute("role", "dialog");
      this.root.setAttribute("aria-modal", "true");
      this.root.innerHTML =
        '<div class="rename-backdrop" data-rename-close></div>' +
        '<div class="rename-shell"><header><span id="renameKicker">RENAME AGENT</span>' +
        '<h2>重命名 Agent</h2><p>改名不会丢失历史任务、trace 或审计记录。</p></header>' +
        '<label>新名字<input id="renameInput" maxlength="16" autocomplete="off" /></label>' +
        '<div class="rename-actions"><button type="button" data-rename-close>取消</button>' +
        '<button type="button" class="primary" id="renameSubmit">保存</button></div></div>';
      this.input = this.root.querySelector("#renameInput");
      this.submitEl = this.root.querySelector("#renameSubmit");
    }

    bind() {
      const self = this;
      if (!this.root) return;
      this.root.addEventListener("click", function (e) {
        if (e.target.closest("[data-rename-close]")) self.close();
        if (e.target.closest("#renameSubmit")) self.submit();
      });
      this.input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); self.submit(); }
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && self.isOpen) self.close();
      });
    }

    open(kind, id, name) {
      if (!this.root) return;
      this.kind = kind;
      this.id = id;
      this.isOpen = true;
      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");
      const app = document.getElementById("app");
      if (app) app.inert = true;
      this.input.value = name || "";
      this.root.querySelector("#renameKicker").textContent =
        kind === "external" ? "EXTERNAL AGENT · RENAME" : "LOCAL AGENT · RENAME";
      this.input.focus({ preventScroll: true });
      this.input.select();
    }

    close() {
      if (!this.root) return;
      this.isOpen = false;
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      const app = document.getElementById("app");
      if (app) app.inert = !!(this.external && this.external.isOpen);
    }

    async submit() {
      const name = String(this.input.value || "").trim();
      if (!name) {
        this.renderer.toast("名字不能为空");
        return;
      }
      if (this.kind === "local") {
        const result = this.engine.renameAgent(this.id, name);
        if (!result.ok) {
          this.renderer.toast(result.error || "重命名失败");
          return;
        }
        this.close();
        this.renderer.build();
        this.renderer.toast("已重命名 · " + result.name);
        return;
      }
      const ok = await this.external.rename(this.id, name);
      if (!ok) {
        this.renderer.toast("重命名失败");
        return;
      }
      this.close();
      this.renderer.render();
      if (this.renderer.drawerMode === "external") this.renderer.renderDrawer();
      this.renderer.toast("外部 Agent 已重命名 · " + name);
    }
  }

  AO.ExternalAgents = ExternalAgents;
  AO.RenameDialog = RenameDialog;
})();
