(function () {
  "use strict";

  const AO = window.AgentOffice;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function shortId(value) {
    return String(value || "").replace(/^exec-/, "").slice(0, 10);
  }

  class CompanyView {
    constructor(engine, renderer, external) {
      this.engine = engine;
      this.renderer = renderer;
      this.external = external;
      this.root = document.getElementById("companyLab");
      this.isOpen = false;
      this.company = null;
      this.messages = [];
      this.roomId = "opc-room-founder";
      this.lastMessageId = 0;
      this.stream = null;
      this.pollTimer = null;
      this.busy = false;
      this.pair = null;
      this.draft = "";
      this.buildShell();
      this.bind();
    }

    t(key) { return AO.t(key); }

    buildShell() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      this.root.setAttribute("role", "dialog");
      this.root.setAttribute("aria-modal", "true");
      this.root.innerHTML = '<div class="company-backdrop" data-company-close></div>' +
        '<div class="company-shell" id="companyShell"></div>';
      this.shell = this.root.querySelector("#companyShell");
      this.render();
    }

    bind() {
      const self = this;
      if (!this.root) return;
      this.root.addEventListener("click", (event) => {
        if (event.target.closest("[data-company-close]")) {
          self.close();
          return;
        }
        if (event.target.closest("[data-company-refresh]")) {
          self.refresh();
          return;
        }
        if (event.target.closest("[data-company-rebuild]")) {
          if (window.confirm(self.t("rebuildCompany") + "?")) self.renderBuilder(true);
          return;
        }
        const connect = event.target.closest("[data-company-connect-role]");
        if (connect) {
          self.connectRole(connect.getAttribute("data-company-connect-role"));
          return;
        }
        const taskRoom = event.target.closest("[data-company-task-room]");
        if (taskRoom) {
          self.switchRoom(taskRoom.getAttribute("data-company-task-room"));
          return;
        }
        const room = event.target.closest("[data-company-room]");
        if (room) {
          self.switchRoom(room.getAttribute("data-company-room"));
          return;
        }
        const copy = event.target.closest("[data-company-copy]");
        if (copy) {
          self.copySetup();
          return;
        }
        if (event.target.closest("[data-company-pair-close]")) {
          self.pair = null;
          self.render();
        }
        if (event.target.closest("[data-company-lang]")) {
          AO.setLang(AO.lang === "en" ? "zh" : "en", true);
          self.render();
          return;
        }
      });
      this.root.addEventListener("submit", (event) => {
        event.preventDefault();
        if (event.target.id === "companyForm") self.bootstrap(event.target);
        if (event.target.id === "companyChatForm") self.sendMessage(event.target);
      });
      this.root.addEventListener("input", (event) => {
        if (event.target.id === "companyMessage") self.draft = event.target.value;
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && self.isOpen) self.close();
      });
    }

    async open() {
      if (!this.root) return;
      this.isOpen = true;
      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");
      const app = document.getElementById("app");
      if (app) app.inert = true;
      await this.refresh();
      this.startPolling();
      const close = this.root.querySelector("[data-company-close]");
      if (close) close.focus({ preventScroll: true });
    }

    close() {
      if (!this.root) return;
      this.isOpen = false;
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      const app = document.getElementById("app");
      if (app) app.inert = false;
      this.stopStream();
      this.stopPolling();
      const btn = document.getElementById("companyBtn");
      if (btn) btn.focus({ preventScroll: true });
    }

    async request(path, options, timeout) {
      return this.external.request(path, options, timeout || 5000);
    }

    startPolling() {
      this.stopPolling();
      this.pollTimer = window.setInterval(() => {
        if (this.isOpen && !this.busy) this.refreshCompany();
      }, 4000);
    }

    stopPolling() {
      if (this.pollTimer) window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    stopStream() {
      if (this.stream) this.stream.close();
      this.stream = null;
    }

    async refresh() {
      if (!this.root) return;
      try {
        const data = await this.request("/company");
        this.external.bridgeOnline = true;
        this.company = data.company || null;
        if (this.company) {
          const exists = (this.company.rooms || []).some((r) => r.id === this.roomId);
          if (!exists) this.roomId = this.company.rooms && this.company.rooms[0] ? this.company.rooms[0].id : "";
          await this.loadMessages();
          this.startStream();
        } else {
          this.stopStream();
          this.messages = [];
        }
      } catch (err) {
        this.external.bridgeOnline = false;
        this.company = null;
      }
      this.render();
    }

    async refreshCompany() {
      if (this.busy || !this.isOpen) return;
      this.busy = true;
      try {
        const data = await this.request("/company");
        const next = data.company || null;
        const changed = JSON.stringify(next) !== JSON.stringify(this.company);
        this.company = next;
        if (changed) this.render();
        if (changed && this.company && this.roomId) await this.loadMessages();
      } catch (err) {}
      finally { this.busy = false; }
    }

    async loadMessages() {
      if (!this.company || !this.roomId) {
        this.messages = [];
        return;
      }
      try {
        const data = await this.request("/messages?roomId=" + encodeURIComponent(this.roomId));
        this.messages = data.messages || [];
        this.lastMessageId = Math.max(this.lastMessageId,
          ...this.messages.map((m) => Number(m.id) || 0), Number(data.lastMessageId) || 0);
      } catch (err) {
        this.messages = [];
      }
    }

    startStream() {
      this.stopStream();
      if (typeof EventSource === "undefined") return;
      try {
        if (new URLSearchParams(window.location.search).get("noStream") === "1") return;
      } catch (err) {}
      const url = this.external.bridgeUrl.replace(/\/+$/, "") + "/stream?since=" + this.lastMessageId;
      try {
        this.stream = new EventSource(url);
        this.stream.addEventListener("message", (event) => {
          try {
            const message = JSON.parse(event.data);
            this.lastMessageId = Math.max(this.lastMessageId, Number(message.id) || 0);
            this.addMessage(message);
          } catch (err) {}
        });
        this.stream.onerror = () => {};
      } catch (err) {}
    }

    addMessage(message) {
      if (!message || !message.id) return;
      if (this.messages.some((m) => Number(m.id) === Number(message.id))) return;
      this.messages.push(message);
      this.messages.sort((a, b) => Number(a.id) - Number(b.id));
      if (message.roomId === this.roomId) {
        this.appendMessageDOM(message);
        this.renderRoomList();
      }
      if (this.company) this.renderCompanyMeta();
    }

    appendMessageDOM(message) {
      const list = this.root.querySelector("#companyMessages");
      if (!list) return;
      const empty = list.querySelector(".company-empty");
      if (empty) empty.remove();
      list.insertAdjacentHTML("beforeend", this.messageHTML(message));
      list.scrollTop = list.scrollHeight;
    }

    async bootstrap(form) {
      const data = new FormData(form);
      const payload = {
        name: String(data.get("name") || "").trim(),
        product: String(data.get("product") || "").trim(),
        goal: String(data.get("goal") || "").trim(),
        language: String(data.get("language") || AO.lang),
        template: "one-person-company",
        replace: form.getAttribute("data-replace") === "1"
      };
      if (!payload.name) return;
      try {
        const res = await this.request("/company/bootstrap", {
          method: "POST", body: JSON.stringify(payload)
        }, 12000);
        this.company = res.company;
        this.roomId = "opc-room-founder";
        this.messages = [];
        this.lastMessageId = 0;
        await this.refresh();
        this.renderer.toast(this.t("companyCreated"));
      } catch (err) {
        this.renderer.toast(this.t("seedError") + " · " + String(err.message || "").slice(0, 80));
      }
    }

    async connectRole(roleId) {
      try {
        const res = await this.request("/pair/code", {
          method: "POST", body: JSON.stringify({ roleId: roleId })
        }, 8000);
        this.pair = { roleId: roleId, ...res };
        this.render();
      } catch (err) {
        this.renderer.toast(this.t("rolePairError"));
      }
    }

    async copySetup() {
      if (!this.pair) return;
      try {
        await navigator.clipboard.writeText(this.pair.message || "");
      } catch (err) {}
      this.renderer.toast(this.t("copied"));
    }

    async switchRoom(roomId) {
      if (!roomId || roomId === this.roomId) return;
      this.roomId = roomId;
      this.draft = "";
      this.messages = [];
      await this.loadMessages();
      this.render();
      this.startStream();
    }

    async sendMessage(form) {
      const input = form.querySelector("#companyMessage");
      const content = String(input.value || "").trim();
      if (!content || !this.company) return;
      try {
        const res = await this.request("/messages", {
          method: "POST",
          body: JSON.stringify({ roomId: this.roomId, content: content })
        }, 8000);
        input.value = "";
        this.draft = "";
        this.addMessage(res.message);
        this.renderRoomList();
      } catch (err) {
        this.renderer.toast(this.t("chatError"));
      }
    }

    langValue(obj, base) {
      if (!obj) return "";
      return AO.lang === "en" ? (obj[base + "En"] || obj[base + "Zh"] || "") : (obj[base + "Zh"] || obj[base + "En"] || "");
    }

    taskStatus(task) {
      const map = {
        waiting: "taskWaiting", assigned: "taskAssigned", in_progress: "taskInProgress",
        completed: "taskCompleted", failed: "taskFailed", cancelled: "taskWaiting"
      };
      return this.t(map[task.status] || task.status);
    }

    statusClass(status) {
      return status === "in_progress" ? "is-running" :
        status === "completed" ? "is-done" :
        status === "failed" ? "is-failed" :
        status === "assigned" ? "is-assigned" : "is-waiting";
    }

    roleById(id) {
      return this.company ? (this.company.roles || []).find((r) => r.id === id) : null;
    }

    taskById(id) {
      return this.company ? (this.company.tasks || []).find((t) => t.id === id) : null;
    }

    roomById(id) {
      return this.company ? (this.company.rooms || []).find((r) => r.id === id) : null;
    }

    render() {
      if (!this.shell) return;
      if (!this.company) {
        this.renderBuilder(false);
        return;
      }
      this.renderDashboard();
    }

    renderBuilder(replace) {
      const bridge = this.external.bridgeOnline;
      this.shell.innerHTML = `
        <header class="company-head">
          <div>
            <span>ONE-PERSON COMPANY / WORKSPACE</span>
            <h2>${esc(this.t("buildCompany"))}</h2>
            <p>${esc(this.t("companyEmptyDesc"))}</p>
          </div>
          <div class="company-head-actions">
            <button type="button" class="company-btn ghost company-lang" data-company-lang>${AO.lang === "en" ? "中" : "EN"}</button>
            <button type="button" class="company-icon" data-company-refresh title="${esc(this.t("refresh"))}">↻</button>
            <button type="button" class="company-icon" data-company-close aria-label="${esc(this.t("close"))}">×</button>
          </div>
        </header>
        <div class="company-builder">
          <div class="company-builder-mark">${replace ? "↻" : "+"}</div>
          <h3>${esc(this.t("companyTemplate"))}</h3>
          <p>${esc(this.t("companyTemplateDesc"))}</p>
          <form id="companyForm" data-replace="${replace ? "1" : "0"}" class="company-form">
            <label>${esc(this.t("companyName"))}
              <input name="name" maxlength="80" placeholder="${esc(this.t("companyNamePlaceholder"))}" required />
            </label>
            <label>${esc(this.t("product"))}
              <input name="product" maxlength="240" placeholder="${esc(this.t("productPlaceholder"))}" />
            </label>
            <label>${esc(this.t("companyGoal"))}
              <textarea name="goal" maxlength="400" placeholder="${esc(this.t("goalPlaceholder"))}"></textarea>
            </label>
            <label>${esc(this.t("languageLabel"))}
              <select name="language">
                <option value="zh" ${AO.lang === "zh" ? "selected" : ""}>中文</option>
                <option value="en" ${AO.lang === "en" ? "selected" : ""}>English</option>
              </select>
            </label>
            <button type="submit" class="company-primary" ${bridge ? "" : "disabled"}>${esc(this.t("generateCompany"))}</button>
          </form>
          <div class="company-template-roles">
            <span>CHIEF OF STAFF</span><span>PRODUCT</span><span>COPY</span><span>DESIGN</span>
            <span>ENGINEER</span><span>QA</span><span>GROWTH</span><span>VIDEO</span>
          </div>
          ${bridge ? "" : `<p class="company-warning">${esc(this.t("bridgeOffline"))}</p>`}
        </div>`;
    }

    renderDashboard() {
      const c = this.company;
      const roles = c.roles || [];
      const tasks = c.tasks || [];
      const rooms = c.rooms || [];
      const active = tasks.filter((t) => t.status === "in_progress").length;
      const done = tasks.filter((t) => t.status === "completed").length;
      const room = this.roomById(this.roomId);
      const role = room && room.roleId ? this.roleById(room.roleId) : null;
      this.shell.innerHTML = `
        <header class="company-head">
          <div>
            <span>ONE-PERSON COMPANY / ${esc(c.id)}</span>
            <h2>${esc(c.name)}</h2>
            <p>${esc(c.product || "")}</p>
          </div>
          <div class="company-head-actions">
            <button type="button" class="company-btn ghost company-lang" data-company-lang>${AO.lang === "en" ? "中" : "EN"}</button>
            <button type="button" class="company-btn" data-company-refresh>${esc(this.t("refresh"))}</button>
            <button type="button" class="company-btn ghost" data-company-rebuild>${esc(this.t("rebuildCompany"))}</button>
            <button type="button" class="company-icon" data-company-close aria-label="${esc(this.t("close"))}">×</button>
          </div>
        </header>
        <div class="company-meta">
          <span><b>${tasks.length}</b> ${esc(this.t("taskCount"))}</span>
          <span><b>${roles.length}</b> ${esc(this.t("roleCount"))}</span>
          <span><b>${rooms.length}</b> ${esc(this.t("roomCount"))}</span>
          <span><b>${done}/${tasks.length}</b> ${esc(this.t("progress"))}</span>
          <span class="company-live"><i></i>${esc(this.t("workMode"))} · ${esc(this.t("live"))}</span>
        </div>
        <div class="company-grid">
          <aside class="company-roles">
            <div class="company-section-head"><h3>${esc(this.t("orgChart"))}</h3><span>${roles.length}</span></div>
            <div class="company-role-list">${roles.map((r) => this.roleHTML(r)).join("")}</div>
          </aside>
          <main class="company-tasks">
            <div class="company-section-head"><h3>${esc(this.t("taskBoard"))}</h3><span>${active} ${esc(this.t("taskInProgress"))}</span></div>
            <div class="company-task-board">${this.taskColumns(tasks)}</div>
          </main>
          <section class="company-chat">
            <div class="company-section-head"><h3>${esc(this.t("chat"))}</h3><span>${esc(this.t("chatIsolation"))}</span></div>
            <div class="company-room-list" id="companyRoomList">${this.roomListHTML(rooms)}</div>
            <div class="company-chat-head">
              <b>${esc(room ? this.langValue(room, "name") : this.t("rooms"))}</b>
              <span>${esc(role ? this.langValue(role, "title") : (room && room.kind === "task" ? this.t("taskRoom") : this.t("departmentRoom")))}</span>
            </div>
            <p class="company-isolation">${esc(this.t("executionIsolation"))}</p>
            <div class="company-messages" id="companyMessages">${this.messages.length ? this.messages.map((m) => this.messageHTML(m)).join("") : `<div class="company-empty">${esc(this.t("noMessages"))}</div>`}</div>
            <form id="companyChatForm" class="company-chat-form">
              <input id="companyMessage" name="content" maxlength="4000" value="${esc(this.draft)}" placeholder="${esc(this.t("sendPlaceholder"))}" autocomplete="off" />
              <button type="submit">${esc(this.t("send"))}</button>
            </form>
          </section>
        </div>
        ${this.pairHTML()}`;
      const messages = this.root.querySelector("#companyMessages");
      if (messages) messages.scrollTop = messages.scrollHeight;
    }

    roleHTML(role) {
      const online = role.agentStatus === "online";
      const tasks = (this.company.tasks || []).filter((t) => t.roleId === role.id);
      const done = tasks.filter((t) => t.status === "completed").length;
      return `<div class="company-role-card">
        <div class="company-role-top"><i style="--role-color:${esc(role.color)}"></i><b>${esc(this.langValue(role, "title"))}</b>
          <span class="${online ? "online" : "offline"}">${esc(online ? this.t("roleOnline") : this.t("roleOffline"))}</span></div>
        <p>${esc(this.langValue(role, "mission"))}</p>
        <div class="company-role-agent">${esc(role.agentName || this.t("roleUnbound"))} · ${done}/${tasks.length}</div>
        <div class="company-role-actions"><button type="button" data-company-connect-role="${esc(role.id)}">${esc(this.t("connectAgent"))}</button>
          <span>${esc((role.skills || []).slice(0, 3).join(" · "))}</span></div>
      </div>`;
    }

    taskColumns(tasks) {
      const columns = [
        ["waiting", "taskWaiting"], ["assigned", "taskAssigned"],
        ["in_progress", "taskInProgress"], ["completed", "taskCompleted"]
      ];
      return `<div class="company-task-columns">${columns.map(([status, label]) => {
        const list = tasks.filter((t) => (status === "waiting" ? (t.status === "waiting" || t.status === "failed") : t.status === status));
        return `<div class="company-task-col ${status}">
          <div class="company-col-head">${esc(this.t(label))}<b>${list.length}</b></div>
          ${list.map((t) => this.taskHTML(t)).join("") || `<div class="company-empty small">—</div>`}
        </div>`;
      }).join("")}</div>`;
    }

    taskHTML(task) {
      const role = this.roleById(task.roleId);
      const assigned = task.assignmentId ? this.company.assignments.find((a) => a.id === task.assignmentId) : null;
      const evidence = (task.evidence || []).length;
      return `<button type="button" class="company-task-card ${this.statusClass(task.status)}"
        data-company-task-room="${esc(task.roomId)}">
        <span class="company-task-title">${esc(this.langValue(task, "title"))}</span>
        <span class="company-task-role">${esc(role ? this.langValue(role, "title") : "")} · ${esc(this.taskStatus(task))}</span>
        <span class="company-task-bar"><i style="width:${Math.round(task.progress || 0)}%"></i></span>
        <span class="company-task-foot"><b>${Math.round(task.progress || 0)}%</b>
          <em>${assigned && assigned.executionId ? "exec " + esc(shortId(assigned.executionId)) : esc(this.t("autoDispatched"))}</em>
          ${evidence ? `<strong>${evidence} evidence</strong>` : ""}</span>
      </button>`;
    }

    roomListHTML(rooms) {
      const departments = rooms.filter((r) => r.kind === "department");
      const tasks = rooms.filter((r) => r.kind === "task");
      const item = (r) => {
        const active = r.id === this.roomId ? " active" : "";
        const task = r.taskId ? this.taskById(r.taskId) : null;
        return `<button type="button" class="company-room${active}" data-company-room="${esc(r.id)}">
          <i></i><span>${esc(task ? this.langValue(task, "title") : this.langValue(r, "name"))}</span>
        </button>`;
      };
      return departments.map(item).join("") + (tasks.length ? `<div class="company-room-label">${esc(this.t("taskRoom"))}</div>` + tasks.map(item).join("") : "");
    }

    renderRoomList() {
      const el = this.root.querySelector("#companyRoomList");
      if (el && this.company) el.innerHTML = this.roomListHTML(this.company.rooms || []);
    }

    renderCompanyMeta() {
      if (!this.company) return;
      // Let the next poll pick up assignment changes; keep the chat DOM stable.
    }

    messageHTML(message) {
      const isTask = message.taskId;
      const kind = message.kind || "agent";
      return `<div class="company-message kind-${esc(kind)}">
        <div class="company-message-top"><b>${esc(message.agentName || (kind === "human" ? this.t("human") : this.t("system")))}</b>
          <span>${esc((message.createdAt || "").slice(11, 19))}</span></div>
        <div class="company-message-text">${esc(message.content)}</div>
        ${isTask ? `<div class="company-message-context">${esc(this.t("taskContext"))} ${esc(message.taskId)}${message.executionId ? " · exec " + esc(shortId(message.executionId)) : ""}</div>` : ""}
      </div>`;
    }

    pairHTML() {
      if (!this.pair) return "";
      const role = this.roleById(this.pair.roleId);
      const pair = this.pair.pair || {};
      return `<div class="company-pair-card">
        <button type="button" class="company-icon" data-company-pair-close>×</button>
        <span>ROLE PAIRING</span>
        <h3>${esc(role ? this.langValue(role, "title") : this.t("rolePairTitle"))}</h3>
        <p>${esc(this.t("waitingForAgent"))}</p>
        <code class="company-pair-code">${esc(pair.code || "")}</code>
        <div class="company-pair-actions">
          <button type="button" data-company-copy>${esc(this.t("copySetup"))}</button>
          <a href="${esc(this.external.bridgeUrl + "/pair/" + (pair.code || "") + "/setup.md")}" target="_blank" rel="noopener">${esc(this.t("setupLink"))}</a>
        </div>
      </div>`;
    }

    renderPairCard() {
      const old = this.root.querySelector(".company-pair-card");
      if (old) old.remove();
      if (!this.pair) return;
      this.shell.insertAdjacentHTML("beforeend", this.pairHTML());
    }
  }

  AO.CompanyView = CompanyView;
})();
