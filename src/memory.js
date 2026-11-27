(function () {
  "use strict";

  const AO = window.AgentOffice;
  const CUI = AO.ChatUI;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  class MemoryPanel {
    constructor(renderer) {
      this.renderer = renderer;
      this.root = document.getElementById("memoryRoot");
      this.items = [];
      this.agents = [];
      this.scope = "all";
      this.query = "";
      this.selectedId = "";
      this.view = "browse";
      this.draft = null;
      this.deleteArmed = "";
      this.loading = false;
      this.lastFocus = null;
      this.bind();
    }

    t(key, fallback, vars) {
      const value = AO.t(key, vars);
      return value === key ? (fallback || key) : value;
    }

    bridge() {
      const ext = this.renderer && this.renderer.external;
      return String((ext && ext.bridgeUrl) || AO.BRIDGE_DEFAULT || "").replace(/\/+$/, "");
    }

    async api(path, options) {
      const res = await fetch(this.bridge() + path, Object.assign({
        cache: "no-store",
        headers: { "Content-Type": "application/json" }
      }, options || {}));
      let data = {};
      try { data = await res.json(); } catch (err) {}
      if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
      return data;
    }

    toast(text) {
      if (this.renderer && this.renderer.toast) this.renderer.toast(text);
    }

    open(selectedId) {
      if (!this.root) return;
      this.selectedId = selectedId || "";
      this.view = "browse";
      this.draft = null;
      this.deleteArmed = "";
      this.lastFocus = document.activeElement;
      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");
      if (AO.syncAppInert) AO.syncAppInert();
      this.renderShell();
      this.root.classList.remove("memory-show-main");
      this.load();
    }

    close() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.innerHTML = "";
      this.root.setAttribute("aria-hidden", "true");
      this.root.classList.remove("memory-show-main");
      if (AO.syncAppInert) AO.syncAppInert();
      if (this.lastFocus && this.lastFocus.isConnected) {
        try { this.lastFocus.focus({ preventScroll: true }); } catch (err) {}
      }
      this.lastFocus = null;
    }

    async load() {
      this.loading = true;
      this.render();
      try {
        const [memories, agents] = await Promise.all([
          this.api("/memories"),
          this.api("/missions/agents")
        ]);
        this.items = memories.memories || [];
        this.agents = agents.agents || [];
        if (this.selectedId && !this.items.some((item) => item.id === this.selectedId)) {
          this.selectedId = "";
        }
        if (!this.selectedId && this.items.length && this.view !== "edit") {
          this.selectedId = this.items[0].id;
        }
      } catch (err) {
        this.toast(this.t("memoryError", "记忆库读取失败"));
      } finally {
        this.loading = false;
        this.render();
      }
    }

    renderShell() {
      this.root.innerHTML =
        '<div class="memory-backdrop" data-memory-close></div>' +
        '<section class="memory-window" role="dialog" aria-modal="true" aria-labelledby="memoryTitle">' +
        '<header class="memory-head"><div><span class="memory-eyebrow">COMPANY MEMORY</span>' +
        '<h2 id="memoryTitle">' + esc(this.t("memoryTitle", "团队记忆")) + '</h2>' +
        '<p>' + esc(this.t("memorySub", "跨任务保留的判断、偏好与事实。Agent 会把它当作参考资料，而不是命令。")) + '</p></div>' +
        '<button type="button" class="memory-close" data-memory-close aria-label="' +
        esc(this.t("close", "关闭")) + '">×</button></header>' +
        '<div class="memory-body"><aside class="memory-side">' +
        '<div class="memory-side-head"><span class="memory-count" id="memoryCount"></span>' +
        '<button type="button" class="memory-new" data-memory-new>+ ' + esc(this.t("memoryNew", "新记忆")) + '</button></div>' +
        '<div class="memory-search"><span>⌕</span><input id="memorySearch" type="search" autocomplete="off" placeholder="' +
        esc(this.t("memorySearch", "搜索标题、内容或标签")) + '" value="' + esc(this.query) + '" /></div>' +
        '<div class="memory-filters" role="tablist">' +
        [["all", "memoryAll", "全部"], ["workspace", "memoryTeamScope", "团队"], ["agent", "memoryAgentScope", "Agent"]]
          .map((row) => '<button type="button" role="tab" data-memory-filter="' + row[0] +
            '" class="' + (this.scope === row[0] ? "active" : "") + '" aria-selected="' +
            (this.scope === row[0] ? "true" : "false") + '">' + esc(this.t(row[1], row[2])) + '</button>').join("") +
        '</div><div class="memory-list" id="memoryList"></div></aside>' +
        '<main class="memory-main" id="memoryMain"></main></div></section>';
      const search = this.root.querySelector("#memorySearch");
      if (search) {
        search.addEventListener("input", (event) => {
          this.query = event.target.value;
          this.renderList();
        });
      }
      window.setTimeout(() => {
        const input = this.root && this.root.querySelector("#memorySearch");
        if (input && window.innerWidth > 760) {
          try { input.focus({ preventScroll: true }); } catch (err) {}
        }
      }, 40);
    }

    visibleItems() {
      const q = this.query.trim().toLowerCase();
      return this.items.filter((item) => {
        if (this.scope !== "all" && item.scope !== this.scope) return false;
        if (!q) return true;
        return [item.title, item.text, (item.tags || []).join(" ")]
          .join(" ").toLowerCase().indexOf(q) >= 0;
      });
    }

    render() {
      if (!this.root || this.root.hidden) return;
      this.renderCount();
      this.renderList();
      this.renderMain();
    }

    renderCount() {
      const count = this.root.querySelector("#memoryCount");
      if (!count) return;
      const total = this.items.length;
      count.textContent = total ? this.t("memoryCount", total + " 条记忆", { count: total }) : "";
    }

    renderList() {
      const box = this.root && this.root.querySelector("#memoryList");
      if (!box) return;
      const rows = this.visibleItems();
      if (!rows.length) {
        box.innerHTML = '<div class="memory-list-empty">' + esc(this.t("memoryNoResults", "没有匹配的记忆")) + "</div>";
        return;
      }
      box.innerHTML = rows.map((item) => {
        const scope = item.scope === "agent" ? this.agentName(item.agentId) : this.t("memoryTeamScope", "团队");
        const active = item.id === this.selectedId && this.view !== "edit";
        return '<button type="button" class="memory-row' + (active ? " active" : "") +
          '" data-memory-row="' + esc(item.id) + '">' +
          '<span class="memory-row-top"><em class="memory-scope ' + esc(item.scope) + '">' +
          esc(scope) + "</em>" + (item.pinned ? '<i class="memory-pin">★</i>' : "") +
          '<time>' + esc(CUI.smartTime(item.updatedAt)) + "</time></span>" +
          "<b>" + esc(item.title) + "</b><span>" + esc(String(item.text || "").slice(0, 90)) +
          "</span></button>";
      }).join("");
    }

    agentName(id) {
      const agent = this.agents.find((row) => row.id === id);
      return agent ? (agent.titleZh || agent.name || id) : id;
    }

    renderMain() {
      const main = this.root && this.root.querySelector("#memoryMain");
      if (!main) return;
      if (this.loading) {
        main.innerHTML = '<div class="memory-empty"><span>◇</span><b>' +
          esc(this.t("memoryLoading", "加载记忆…")) + "</b></div>";
        return;
      }
      if (this.view === "edit") {
        main.innerHTML = this.editorHTML();
        this.bindEditor();
        return;
      }
      const item = this.items.find((row) => row.id === this.selectedId);
      if (!item) {
        main.innerHTML = '<div class="memory-empty"><span>✦</span><b>' +
          esc(this.t("memoryEmptyTitle", "把团队的经验留下来")) + "</b><p>" +
          esc(this.t("memoryEmptyHint", "记录一个判断、一条偏好或一个不能忘记的事实，之后的任务和聊天会自动带上它。")) +
          '</p><button type="button" class="memory-primary" data-memory-new>+ ' +
          esc(this.t("memoryNew", "新记忆")) + "</button></div>";
        return;
      }
      const scope = item.scope === "agent" ? this.agentName(item.agentId) : this.t("memoryTeamScope", "团队");
      const armed = this.deleteArmed === item.id;
      main.innerHTML = '<article class="memory-detail">' +
        '<button type="button" class="memory-back" data-memory-back>‹ ' + esc(this.t("memoryBack", "返回")) + "</button>" +
        '<header class="memory-detail-head"><div><span class="memory-scope ' + esc(item.scope) + '">' +
        esc(scope) + '</span><h3>' + esc(item.title) + '</h3><p>' + esc(this.t("memoryUpdated", "更新于")) +
        " " + esc(CUI.smartTime(item.updatedAt)) + '</p></div><div class="memory-actions">' +
        '<button type="button" class="memory-icon' + (item.pinned ? " active" : "") +
        '" data-memory-pin="' + esc(item.id) + '" title="' + esc(item.pinned ? this.t("memoryUnpin", "取消固定") : this.t("memoryPin", "固定")) + '">★</button>' +
        '<button type="button" class="memory-icon" data-memory-edit="' + esc(item.id) + '" title="' +
        esc(this.t("memoryEdit", "编辑")) + '">✎</button>' +
        '<button type="button" class="memory-icon danger" data-memory-delete="' + esc(item.id) + '">' +
        (armed ? esc(this.t("memoryDeleteConfirm", "确认删除")) : "×") + "</button></div></header>" +
        (item.tags && item.tags.length ? '<div class="memory-tags">' + item.tags.map((tag) =>
          "<span>" + esc(tag) + "</span>").join("") + "</div>" : "") +
        '<div class="memory-text">' + CUI.markdown(item.text || "") + "</div>" +
        '<footer class="memory-detail-foot">' + esc(this.t("memoryPersisted", "保存在本机 bridge，可跨任务使用。")) + "</footer>" +
        "</article>";
    }

    editorHTML() {
      const draft = this.draft || { title: "", text: "", scope: "workspace", agentId: "", tags: [], pinned: false };
      const isAgent = draft.scope === "agent";
      return '<div class="memory-editor"><div class="memory-editor-head"><span class="memory-eyebrow">' +
        esc(draft.id ? "EDIT MEMORY" : "NEW MEMORY") + "</span><h3>" +
        esc(draft.id ? this.t("memoryEdit", "编辑") : this.t("memoryNew", "新记忆")) + "</h3></div>" +
        '<form id="memoryForm"><label class="memory-field"><span>' +
        esc(this.t("memoryTitleLabel", "标题")) + '</span><input name="title" maxlength="120" value="' +
        esc(draft.title) + '" placeholder="' + esc(this.t("memoryTitlePlaceholder", "例如：发布前必须做回滚演练")) + '" /></label>' +
        '<div class="memory-field"><span>' + esc(this.t("memoryScopeLabel", "范围")) + '</span>' +
        '<div class="memory-scope-pick"><button type="button" data-memory-scope="workspace" class="' +
        (!isAgent ? "active" : "") + '">' + esc(this.t("memoryTeamScope", "团队")) +
        '</button><button type="button" data-memory-scope="agent" class="' + (isAgent ? "active" : "") +
        '">' + esc(this.t("memoryAgentScope", "Agent")) + "</button></div></div>" +
        '<label class="memory-field memory-agent-field" ' + (isAgent ? "" : "hidden") + '><span>' +
        esc(this.t("memoryAgentLabel", "Agent")) + '</span><select name="agentId"><option value="">' +
        esc(this.t("memorySelectAgent", "选择 Agent")) + "</option>" + this.agents.map((agent) =>
          '<option value="' + esc(agent.id) + '"' + (draft.agentId === agent.id ? " selected" : "") + ">" +
          esc(agent.titleZh || agent.name || agent.id) + "</option>").join("") + "</select></label>" +
        '<label class="memory-field"><span>' + esc(this.t("memoryTextLabel", "内容")) +
        '</span><textarea name="text" maxlength="6000" rows="8" placeholder="' +
        esc(this.t("memoryContentPlaceholder", "写清楚一个可复用的判断或事实。")) + '">' +
        esc(draft.text) + "</textarea></label>" +
        '<label class="memory-field"><span>' + esc(this.t("memoryTagsLabel", "标签")) +
        '</span><input name="tags" value="' + esc((draft.tags || []).join(", ")) + '" placeholder="' +
        esc(this.t("memoryTagsPlaceholder", "发布, 风险, 偏好")) + '" /></label>' +
        '<label class="memory-check"><input type="checkbox" name="pinned"' + (draft.pinned ? " checked" : "") +
        " /> " + esc(this.t("memoryPinned", "固定在列表顶部")) + "</label>" +
        '<footer class="memory-form-foot"><button type="button" class="memory-secondary" data-memory-cancel>' +
        esc(this.t("memoryCancel", "取消")) + '</button><button type="submit" class="memory-primary">' +
        esc(this.t("memorySave", "保存记忆")) + "</button></footer></form></div>";
    }

    bindEditor() {
      const form = this.root.querySelector("#memoryForm");
      if (!form) return;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        this.save(form);
      });
      this.root.querySelectorAll("[data-memory-scope]").forEach((button) => {
        button.addEventListener("click", () => {
          const scope = button.getAttribute("data-memory-scope");
          if (!this.draft) return;
          const current = this.root.querySelector("#memoryForm");
          if (current) {
            const data = new FormData(current);
            this.draft.title = String(data.get("title") || "");
            this.draft.text = String(data.get("text") || "");
            this.draft.agentId = String(data.get("agentId") || "");
            this.draft.tags = String(data.get("tags") || "").split(/[,，]/)
              .map((tag) => tag.trim()).filter(Boolean);
            this.draft.pinned = !!data.get("pinned");
          }
          this.draft.scope = scope;
          if (scope === "workspace") this.draft.agentId = "";
          this.renderMain();
        });
      });
    }

    async save(form) {
      if (!this.draft) return;
      const data = new FormData(form);
      const payload = {
        title: String(data.get("title") || "").trim(),
        text: String(data.get("text") || "").trim(),
        scope: this.draft.scope || "workspace",
        agentId: String(data.get("agentId") || ""),
        tags: String(data.get("tags") || "").split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
        pinned: !!data.get("pinned")
      };
      if (!payload.text) {
        this.toast(this.t("memoryNeedsText", "记忆内容不能为空"));
        return;
      }
      const submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const result = await this.api(this.draft.id ? "/memories/" + encodeURIComponent(this.draft.id) : "/memories", {
          method: this.draft.id ? "PATCH" : "POST",
          body: JSON.stringify(payload)
        });
        const memory = result.memory;
        this.view = "browse";
        this.draft = null;
        this.selectedId = memory ? memory.id : this.selectedId;
        this.root.classList.remove("memory-show-main");
        await this.load();
        this.toast(this.t("memorySaved", "记忆已保存"));
      } catch (err) {
        this.toast(this.t("memorySaveError", "保存失败") + "：" + err.message);
        if (submit) submit.disabled = false;
      }
    }

    async togglePin(id) {
      const item = this.items.find((row) => row.id === id);
      if (!item) return;
      try {
        await this.api("/memories/" + encodeURIComponent(id), {
          method: "PATCH",
          body: JSON.stringify({ pinned: !item.pinned })
        });
        await this.load();
      } catch (err) {
        this.toast(this.t("memorySaveError", "保存失败") + "：" + err.message);
      }
    }

    async remove(id) {
      try {
        await this.api("/memories/" + encodeURIComponent(id), { method: "DELETE" });
        this.selectedId = "";
        this.deleteArmed = "";
        await this.load();
        this.toast(this.t("memoryDeleted", "记忆已删除"));
      } catch (err) {
        this.toast(this.t("memorySaveError", "保存失败") + "：" + err.message);
      }
    }

    startNew() {
      this.view = "edit";
      this.deleteArmed = "";
      this.draft = { title: "", text: "", scope: "workspace", agentId: "", tags: [], pinned: false };
      if (this.root) this.root.classList.add("memory-show-main");
      this.renderMain();
      const input = this.root && this.root.querySelector('#memoryForm input[name="title"]');
      if (input) {
        try { input.focus({ preventScroll: true }); } catch (err) {}
      }
    }

    startEdit(id) {
      const item = this.items.find((row) => row.id === id);
      if (!item) return;
      this.view = "edit";
      this.deleteArmed = "";
      this.draft = Object.assign({}, item, { tags: (item.tags || []).slice() });
      if (this.root) this.root.classList.add("memory-show-main");
      this.renderMain();
    }

    bind() {
      if (!this.root) return;
      this.root.addEventListener("click", (event) => {
        const target = event.target;
        if (target.closest("[data-memory-close]")) { this.close(); return; }
        if (target.closest("[data-memory-new]")) { this.startNew(); return; }
        if (target.closest("[data-memory-back]")) {
          this.root.classList.remove("memory-show-main");
          this.view = "browse";
          this.render();
          return;
        }
        if (target.closest("[data-memory-cancel]")) {
          this.root.classList.remove("memory-show-main");
          this.view = "browse";
          this.draft = null;
          this.render();
          return;
        }
        const filter = target.closest("[data-memory-filter]");
        if (filter) {
          this.scope = filter.getAttribute("data-memory-filter") || "all";
          this.renderShell();
          this.render();
          return;
        }
        const row = target.closest("[data-memory-row]");
        if (row) {
          this.selectedId = row.getAttribute("data-memory-row");
          this.view = "browse";
          this.deleteArmed = "";
          this.root.classList.add("memory-show-main");
          this.render();
          return;
        }
        const edit = target.closest("[data-memory-edit]");
        if (edit) { this.startEdit(edit.getAttribute("data-memory-edit")); return; }
        const pin = target.closest("[data-memory-pin]");
        if (pin) { this.togglePin(pin.getAttribute("data-memory-pin")); return; }
        const del = target.closest("[data-memory-delete]");
        if (del) {
          const id = del.getAttribute("data-memory-delete");
          if (this.deleteArmed === id) this.remove(id);
          else { this.deleteArmed = id; this.renderMain(); }
        }
      });
      document.addEventListener("keydown", (event) => {
        if (!this.root || this.root.hidden) return;
        if (event.key === "Escape") {
          if (this.view === "edit") {
            this.view = "browse";
            this.draft = null;
            this.render();
          } else {
            this.close();
          }
        }
      });
    }
  }

  AO.MemoryPanel = MemoryPanel;
})();
