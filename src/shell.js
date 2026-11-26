(function () {
  "use strict";

  const AO = window.AgentOffice;
  const CHAT_STYLE_KEY = "agent-office.chat.style.v1";
  const CHAT_STYLE_EVENT = "agent-office:chat-style";

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function initials(name) {
    const text = String(name || "?").trim();
    if (!text) return "?";
    const parts = text.split(/[\s·._-]+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  }

  function fmtTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (isNaN(date.getTime())) return "";
    return String(date.getHours()).padStart(2, "0") + ":" +
      String(date.getMinutes()).padStart(2, "0");
  }

  function readChatStyle() {
    try { return localStorage.getItem(CHAT_STYLE_KEY) || "agent"; }
    catch (err) { return "agent"; }
  }

  function writeChatStyle(style) {
    try { localStorage.setItem(CHAT_STYLE_KEY, style); } catch (err) {}
    document.dispatchEvent(new CustomEvent(CHAT_STYLE_EVENT, { detail: style }));
  }

  class ChatHub {
    constructor(renderer) {
      this.renderer = renderer;
      this.root = document.getElementById("chatHubRoot");
      this.active = null;
      this.messages = [];
      this.timer = null;
      this.view = "closed";
      this.onCapture = null;
      this.bind();
    }

    bridge() {
      const ext = this.renderer && this.renderer.external;
      return String((ext && ext.bridgeUrl) || AO.BRIDGE_DEFAULT || "")
        .replace(/\/+$/, "");
    }

    toast(text) {
      if (this.renderer && this.renderer.toast) this.renderer.toast(text);
    }

    t(key) { return AO.t(key); }

    async api(path, options, timeout) {
      const controller = new AbortController();
      const timer = window.setTimeout(function () { controller.abort(); }, timeout || 10000);
      try {
        const res = await fetch(this.bridge() + path, Object.assign({
          cache: "no-store",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" }
        }, options || {}));
        let data = {};
        try { data = await res.json(); } catch (err) {}
        if (!res.ok) {
          const error = new Error(data.error || data.code || ("HTTP " + res.status));
          error.status = res.status;
          error.code = data.code || "";
          throw error;
        }
        return data;
      } finally {
        window.clearTimeout(timer);
      }
    }

    setView(html) {
      if (!this.root) return;
      this.root.hidden = false;
      this.root.innerHTML = html;
    }

    close() {
      this.stopPoll();
      this.active = null;
      this.messages = [];
      this.view = "closed";
      if (this.root) {
        this.root.hidden = true;
        this.root.innerHTML = "";
      }
    }

    bind() {
      const self = this;
      if (!this.root) return;
      this.root.addEventListener("click", function (event) {
        if (event.target.closest("[data-chat-close]")) { self.close(); return; }
        if (event.target.closest("[data-chat-picker-close]")) { self.close(); return; }
        if (event.target.closest("[data-chat-back]")) {
          if (self.lastPicker === "direct") self.openDirectPicker();
          else self.openGroupPicker();
          return;
        }
        if (event.target.closest("[data-chat-new-group]")) {
          self.renderGroupForm();
          return;
        }
        const conv = event.target.closest("[data-chat-conv]");
        if (conv) {
          self.openConversation(conv.getAttribute("data-chat-conv"));
          return;
        }
        const agent = event.target.closest("[data-chat-agent]");
        if (agent) {
          self.ensureDirect(agent.getAttribute("data-chat-agent"));
          return;
        }
        if (event.target.closest("[data-chat-capture]")) {
          if (self.onCapture) self.onCapture();
          return;
        }
      });
      this.root.addEventListener("submit", function (event) {
        if (event.target.id === "chatSendForm") {
          event.preventDefault();
          const input = event.target.querySelector("textarea");
          self.sendText(input ? input.value : "");
        }
        if (event.target.id === "chatGroupForm") {
          event.preventDefault();
          self.createGroup(event.target);
        }
      });
      document.addEventListener(CHAT_STYLE_EVENT, function () {
        if (self.active && self.root && !self.root.hidden) {
          const win = self.root.querySelector(".chat-window");
          if (win) win.className = "chat-window style-" + readChatStyle();
        }
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && self.root && !self.root.hidden) self.close();
      });
    }

    async openGroupPicker() {
      this.stopPoll();
      this.active = null;
      this.messages = [];
      this.lastPicker = "group";
      this.view = "picker";
      this.setView('<div class="chat-hub-backdrop" data-chat-picker-close></div>' +
        '<section class="chat-picker"><header class="chat-picker-head"><div><span>MESSAGES</span><h3>' +
        esc(this.t("chatGroupTitle")) + '</h3></div><button type="button" data-chat-picker-close>×</button></header>' +
        '<div class="chat-picker-body"><div class="chat-empty">' + esc(this.t("chatLoading")) + '</div></div></section>');
      try {
        const data = await this.api("/conversations?kind=group");
        const rows = (data.conversations || []).map((c) =>
          '<button type="button" class="chat-pick-row" data-chat-conv="' + esc(c.id) + '">' +
          '<span class="chat-pick-avatar">#</span><span class="chat-pick-copy"><b>' +
          esc(c.title || this.t("chatGroupTitle")) + '</b><em>' +
          esc((c.members || []).length + " members · " +
            ((c.lastMessage && c.lastMessage.text) || this.t("chatEmpty"))) + '</em></span></button>').join("");
        this.setView('<div class="chat-hub-backdrop" data-chat-picker-close></div>' +
          '<section class="chat-picker"><header class="chat-picker-head"><div><span>MESSAGES</span><h3>' +
          esc(this.t("chatGroupTitle")) + '</h3></div><button type="button" data-chat-picker-close>×</button></header>' +
          '<div class="chat-picker-body">' + (rows || '<div class="chat-empty">' +
            esc(this.t("chatNoGroups")) + '</div>') +
          '<button type="button" class="chat-new-row" data-chat-new-group>＋ ' +
          esc(this.t("chatNewGroup")) + '</button></div></section>');
      } catch (err) {
        this.setPickerError();
      }
    }

    async openDirectPicker() {
      this.stopPoll();
      this.active = null;
      this.messages = [];
      this.lastPicker = "direct";
      this.view = "picker";
      this.setView('<div class="chat-hub-backdrop" data-chat-picker-close></div>' +
        '<section class="chat-picker"><header class="chat-picker-head"><div><span>MESSAGES</span><h3>' +
        esc(this.t("chatDirectTitle")) + '</h3></div><button type="button" data-chat-picker-close>×</button></header>' +
        '<div class="chat-picker-body"><div class="chat-empty">' + esc(this.t("chatLoading")) + '</div></div></section>');
      try {
        const [agentsRes, convRes] = await Promise.all([
          this.api("/missions/agents"),
          this.api("/conversations?kind=direct")
        ]);
        const conversations = convRes.conversations || [];
        const recent = conversations.map((c) => {
          const member = (c.members || [])[0] || {};
          return '<button type="button" class="chat-pick-row" data-chat-conv="' + esc(c.id) + '">' +
            '<span class="chat-pick-avatar">@</span><span class="chat-pick-copy"><b>' +
            esc(c.title || member.name || member.id) + '</b><em>' +
            esc((c.lastMessage && c.lastMessage.text) || this.t("chatEmpty")) + '</em></span></button>';
        }).join("");
        const directIds = new Set();
        conversations.forEach((c) => (c.members || []).forEach((m) => directIds.add(m.id)));
        const agents = (agentsRes.agents || []).map((a) =>
          '<button type="button" class="chat-pick-row" data-chat-agent="' + esc(a.id) + '">' +
          '<span class="chat-pick-avatar">' + esc(initials(a.titleZh || a.name)) + '</span>' +
          '<span class="chat-pick-copy"><b>' + esc(a.titleZh || a.name) +
          '</b><em>' + esc(a.roleLabelZh || a.role || "") + ' · ' +
          esc((a.skills || []).slice(0, 2).join(" · ")) + (directIds.has(a.id) ? " · 已有对话" : "") +
          '</em></span></button>').join("");
        this.setView('<div class="chat-hub-backdrop" data-chat-picker-close></div>' +
          '<section class="chat-picker"><header class="chat-picker-head"><div><span>MESSAGES</span><h3>' +
          esc(this.t("chatDirectTitle")) + '</h3></div><button type="button" data-chat-picker-close>×</button></header>' +
          '<div class="chat-picker-body">' +
          (recent ? '<div class="chat-pick-section">最近私聊</div>' + recent : "") +
          '<div class="chat-pick-section">' + esc(this.t("chatNewChat")) + '</div>' +
          (agents || '<div class="chat-empty">' + esc(this.t("chatNoAgents")) + '</div>') +
          '</div></section>');
      } catch (err) {
        this.setPickerError();
      }
    }

    setPickerError() {
      this.setView('<div class="chat-hub-backdrop" data-chat-picker-close></div>' +
        '<section class="chat-picker"><header class="chat-picker-head"><div><span>MESSAGES</span><h3>' +
        esc(this.t("chatDirectTitle")) + '</h3></div><button type="button" data-chat-picker-close>×</button></header>' +
        '<div class="chat-picker-body"><div class="chat-empty error">' + esc(this.t("chatError")) + '</div></div></section>');
    }

    async renderGroupForm() {
      try {
        const data = await this.api("/missions/agents");
        const agents = data.agents || [];
        const members = agents.map((a) =>
          '<label class="chat-member"><input type="checkbox" name="memberIds" value="' + esc(a.id) + '" checked />' +
          '<span>' + esc(a.titleZh || a.name) + '</span><em>' +
          esc(a.roleLabelZh || a.role || "") + '</em></label>').join("");
        this.setView('<div class="chat-hub-backdrop" data-chat-picker-close></div>' +
          '<section class="chat-picker"><header class="chat-picker-head"><div><span>NEW GROUP</span><h3>' +
          esc(this.t("chatNewGroup")) + '</h3></div><button type="button" data-chat-picker-close>×</button></header>' +
          '<form id="chatGroupForm" class="chat-create-form"><label>' + esc(this.t("chatGroupName")) +
          '<input name="title" maxlength="120" placeholder="例如：发布协作群" required /></label>' +
          '<div class="chat-members"><span>' + esc(this.t("chatMembers")) + '</span>' + members + '</div>' +
          '<footer><button type="button" class="chat-secondary" data-chat-back>' + esc(this.t("chatCancel")) + '</button>' +
          '<button type="submit" class="chat-primary">' + esc(this.t("chatCreate")) + '</button></footer></form></section>');
      } catch (err) {
        this.setPickerError();
      }
    }

    async createGroup(form) {
      const data = new FormData(form);
      const title = String(data.get("title") || "").trim();
      const memberIds = Array.from(form.querySelectorAll('input[name="memberIds"]:checked'))
        .map((input) => input.value);
      if (!title || !memberIds.length) {
        this.toast("群名称和成员不能为空");
        return;
      }
      try {
        const res = await this.api("/conversations", {
          method: "POST",
          body: JSON.stringify({ kind: "group", title, memberIds })
        });
        if (res.conversation) this.openConversation(res.conversation.id);
      } catch (err) {
        this.toast(this.t("chatError"));
      }
    }

    async ensureDirect(agentId) {
      try {
        const list = await this.api("/conversations?kind=direct");
        const existing = (list.conversations || []).find((c) =>
          (c.members || []).some((m) => m.id === agentId));
        if (existing) {
          this.openConversation(existing.id);
          return;
        }
        const res = await this.api("/conversations", {
          method: "POST",
          body: JSON.stringify({ kind: "direct", memberIds: [agentId] })
        });
        if (res.conversation) this.openConversation(res.conversation.id);
      } catch (err) {
        this.toast(this.t("chatError"));
      }
    }

    async openConversation(id) {
      try {
        const res = await this.api("/conversations/" + encodeURIComponent(id));
        const conversation = res.conversation;
        if (!conversation) return;
        this.active = conversation;
        this.view = "chat";
        this.renderWindow();
        await this.loadMessages(true);
        this.startPoll();
      } catch (err) {
        this.setPickerError();
      }
    }

    renderWindow() {
      const c = this.active;
      if (!c) return;
      const member = (c.members || [])[0] || {};
      const title = c.kind === "direct" ? (member.titleZh || member.name || c.title) : (c.title || this.t("chatGroupTitle"));
      this.setView('<div class="chat-hub-backdrop chat-window-backdrop" data-chat-close></div>' +
        '<section class="chat-window style-' + esc(readChatStyle()) + '">' +
        '<header class="chat-window-head"><div class="chat-window-id"><span class="chat-window-avatar">' +
        (c.kind === "direct" ? esc(initials(member.titleZh || member.name)) : "#") +
        '</span><div><b>' + esc(title) + '</b><span>' +
        (c.kind === "direct" ? esc(member.roleLabelZh || "DIRECT") : (c.members || []).length + " MEMBERS") +
        '</span></div></div><div class="chat-window-tools"><button type="button" data-chat-capture title="采集 QQ / 微信窗口">◉</button>' +
        '<button type="button" data-chat-close title="关闭">×</button></div></header>' +
        '<div class="chat-window-messages" id="chatWindowMessages"></div>' +
        '<form class="chat-window-composer" id="chatSendForm"><textarea rows="1" maxlength="4000" placeholder="' +
        esc(this.t("chatSend")) + '…"></textarea><button type="submit">' + esc(this.t("chatSend")) + '</button></form></section>');
    }

    async loadMessages(scroll) {
      if (!this.active) return;
      try {
        const data = await this.api("/conversations/" + encodeURIComponent(this.active.id) + "/messages");
        this.messages = data.messages || [];
        const box = this.root && this.root.querySelector("#chatWindowMessages");
        if (!box) return;
        box.innerHTML = this.messages.length ? this.messages.map((m) => this.messageHTML(m)).join("") :
          '<div class="chat-empty">' + esc(this.t("chatEmpty")) + '</div>';
        if (scroll) box.scrollTop = box.scrollHeight;
      } catch (err) {
        const box = this.root && this.root.querySelector("#chatWindowMessages");
        if (box) box.innerHTML = '<div class="chat-empty error">' + esc(this.t("chatError")) + '</div>';
      }
    }

    messageHTML(message) {
      if (!message) return "";
      if (message.senderType === "system" || message.type === "system") {
        return '<div class="chat-system"><span>' + esc(fmtTime(message.createdAt)) + '</span>' +
          esc(message.text || "") + '</div>';
      }
      const mine = message.senderType === "boss";
      const member = ((this.active && this.active.members) || [])
        .find((m) => m.id === message.senderId) || {};
      const text = message.type === "report" && message.meta && message.meta.report
        ? message.meta.report.summary : (message.text || "");
      return '<div class="chat-bubble-row ' + (mine ? "mine" : "theirs") + '">' +
        '<span class="chat-bubble-avatar">' + esc(mine ? "ME" : initials(member.titleZh || message.senderName || "?")) + '</span>' +
        '<div class="chat-bubble"><div class="chat-bubble-meta"><b>' +
        esc(mine ? this.t("chatYou") : (member.titleZh || message.senderName || "Agent")) +
        '</b><span>' + esc(fmtTime(message.createdAt)) + '</span></div>' +
        '<p>' + esc(text) + '</p></div></div>';
    }

    startPoll() {
      this.stopPoll();
      const self = this;
      this.timer = window.setInterval(function () {
        self.loadMessages(false);
      }, 2500);
    }

    stopPoll() {
      if (this.timer) window.clearInterval(this.timer);
      this.timer = null;
    }

    async sendText(text) {
      const value = String(text || "").trim();
      if (!value) return false;
      if (!this.active) {
        this.toast("请先打开一个群聊或单聊");
        return false;
      }
      try {
        await this.api("/conversations/" + encodeURIComponent(this.active.id) + "/messages", {
          method: "POST",
          body: JSON.stringify({ senderId: "boss", senderType: "boss", type: "text", text: value })
        });
        const input = this.root && this.root.querySelector("#chatSendForm textarea");
        if (input) input.value = "";
        await this.loadMessages(true);
        return true;
      } catch (err) {
        this.toast(this.t("chatError"));
        return false;
      }
    }
  }

  class FeatureDrawer {
    constructor(renderer, deps, shell) {
      this.renderer = renderer;
      this.deps = deps || {};
      this.shell = shell;
      this.root = document.getElementById("featureDrawer");
      this.backdrop = document.getElementById("featureDrawerBackdrop");
      this.btn = document.getElementById("featureBtn");
      this.bind();
    }

    open() {
      if (!this.root) return;
      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");
      if (this.backdrop) this.backdrop.hidden = false;
    }

    close() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      if (this.backdrop) this.backdrop.hidden = true;
    }

    bind() {
      const self = this;
      if (this.btn) this.btn.addEventListener("click", function () { self.open(); });
      if (this.backdrop) this.backdrop.addEventListener("click", function () { self.close(); });
      if (!this.root) return;
      this.root.addEventListener("click", function (event) {
        if (event.target.closest("[data-feature-close]")) { self.close(); return; }
        const action = event.target.closest("[data-feature-action]");
        if (action) self.run(action.getAttribute("data-feature-action"));
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") self.close();
      });
    }

    async run(action) {
      const deps = this.deps;
      const chat = this.shell && this.shell.chat;
      if (action === "hire" || action === "external") {
        this.close();
        const id = action === "hire" ? "hireBtn" : "externalBtn";
        const btn = document.getElementById(id);
        if (btn) btn.click();
        return;
      }
      if (action === "tools") {
        this.close();
        if (deps.updateCenter) deps.updateCenter.open();
        return;
      }
      if (action === "settings") {
        this.close();
        if (this.shell) this.shell.settings.open();
        return;
      }
      if (action === "group" || action === "mission") {
        this.close();
        if (!deps.missionView) return;
        try {
          await deps.missionView.open();
          deps.missionView.openForm(action === "group" ? "group" : "mission");
        } catch (err) {}
        return;
      }
      if (action === "group-chat") {
        this.close();
        if (chat) chat.openGroupPicker();
        return;
      }
      if (action === "direct-chat") {
        this.close();
        if (chat) chat.openDirectPicker();
        return;
      }
      if (action === "capture") {
        this.close();
        if (this.shell) this.shell.capture.open();
      }
    }
  }

  class SettingsCenter {
    constructor(renderer) {
      this.renderer = renderer;
      this.root = document.getElementById("featureModalRoot");
      this.bindOnce();
    }

    open() {
      if (!this.root) return;
      const theme = document.documentElement.dataset.theme || "night";
      const style = readChatStyle();
      this.root.hidden = false;
      this.root.innerHTML = '<div class="feature-modal-backdrop" data-settings-close></div>' +
        '<section class="feature-settings"><header><span>SETTINGS</span><h2>' +
        esc(AO.t("settingsTitle")) + '</h2><button type="button" data-settings-close>×</button></header>' +
        '<div class="feature-settings-body">' +
        '<div class="settings-row"><label>' + esc(AO.t("settingsTheme")) + '</label><div class="settings-seg">' +
        '<button type="button" data-settings-theme="night" class="' + (theme === "night" ? "active" : "") + '">' + esc(AO.t("themeNight")) + '</button>' +
        '<button type="button" data-settings-theme="day" class="' + (theme === "day" ? "active" : "") + '">' + esc(AO.t("themeDay")) + '</button></div></div>' +
        '<div class="settings-row"><label>' + esc(AO.t("settingsLanguage")) + '</label><div class="settings-seg">' +
        '<button type="button" data-settings-lang="zh" class="' + (AO.lang !== "en" ? "active" : "") + '">中文</button>' +
        '<button type="button" data-settings-lang="en" class="' + (AO.lang === "en" ? "active" : "") + '">English</button></div></div>' +
        '<div class="settings-row"><label>' + esc(AO.t("settingsChatStyle")) + '</label>' +
        '<select data-settings-style><option value="agent"' + (style === "agent" ? " selected" : "") + '>' + esc(AO.t("settingsChatAgent")) + '</option>' +
        '<option value="qq"' + (style === "qq" ? " selected" : "") + '>' + esc(AO.t("settingsChatQQ")) + '</option>' +
        '<option value="wechat"' + (style === "wechat" ? " selected" : "") + '>' + esc(AO.t("settingsChatWechat")) + '</option></select></div>' +
        '<p class="settings-note">聊天风格只改变弹窗外观，不改变消息内容。设置保存在本机。</p>' +
        '</div></section>';
      this.bindOnce();
    }

    bindOnce() {
      if (this._bound || !this.root) return;
      this._bound = true;
      const self = this;
      this.root.addEventListener("click", function (event) {
        if (event.target.closest("[data-settings-close]")) { self.close(); return; }
        const theme = event.target.closest("[data-settings-theme]");
        if (theme) {
          const want = theme.getAttribute("data-settings-theme");
          if ((document.documentElement.dataset.theme || "night") !== want) {
            const btn = document.getElementById("themeBtn"); if (btn) btn.click();
          }
          self.open();
          return;
        }
        const lang = event.target.closest("[data-settings-lang]");
        if (lang) {
          const want = lang.getAttribute("data-settings-lang");
          if ((AO.lang === "en" ? "en" : "zh") !== want) {
            const btn = document.getElementById("langBtn"); if (btn) btn.click();
          }
          window.setTimeout(function () { self.open(); }, 30);
        }
      });
      this.root.addEventListener("change", function (event) {
        if (event.target.matches("[data-settings-style]")) {
          writeChatStyle(event.target.value);
          if (self.renderer && self.renderer.toast) self.renderer.toast(AO.t("settingsSaved"));
        }
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && self.root && !self.root.hidden) self.close();
      });
    }

    close() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.innerHTML = "";
    }
  }

  class ChatCapture {
    constructor(renderer, chat) {
      this.renderer = renderer;
      this.chat = chat;
      this.root = document.getElementById("featureModalRoot");
      this.text = "";
      this.bind();
    }

    bridge() {
      return this.chat ? this.chat.bridge() : "";
    }

    toast(text) {
      if (this.renderer && this.renderer.toast) this.renderer.toast(text);
    }

    open() {
      if (!this.root) return;
      this.text = "";
      this.root.hidden = false;
      this.root.innerHTML = '<div class="feature-modal-backdrop" data-capture-close></div>' +
        '<section class="feature-capture"><header><div><span>CHAT CAPTURE</span><h2>' +
        esc(AO.t("captureTitle")) + '</h2></div><button type="button" data-capture-close>×</button></header>' +
        '<div class="capture-toolbar"><button type="button" class="capture-scan" data-capture-scan>◉ ' +
        esc(AO.t("captureScan")) + '</button><button type="button" class="capture-upload" data-capture-upload>＋ ' +
        esc(AO.t("captureUpload")) + '</button></div>' +
        '<p class="capture-hint">' + esc(AO.t("captureHint")) + '</p>' +
        '<div class="capture-windows" id="captureWindows"><div class="capture-empty">' +
        esc(AO.t("captureNoWindows")) + '</div></div>' +
        '<label class="capture-result-label">' + esc(AO.t("captureText")) + '</label>' +
        '<pre class="capture-result" id="captureResult">' + esc(AO.t("captureEmpty")) + '</pre>' +
        '<p class="capture-permission">' + esc(AO.t("capturePermission")) + '</p>' +
        '<footer><button type="button" class="chat-secondary" data-capture-copy>' + esc(AO.t("captureCopy")) +
        '</button><button type="button" class="chat-primary" data-capture-send>' + esc(AO.t("captureSend")) +
        '</button></footer><input type="file" accept="image/*" data-capture-file hidden /></section>';
    }

    close() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.innerHTML = "";
    }

    bind() {
      if (!this.root) return;
      const self = this;
      this.root.addEventListener("click", function (event) {
        if (event.target.closest("[data-capture-close]")) { self.close(); return; }
        if (event.target.closest("[data-capture-scan]")) { self.scan(); return; }
        if (event.target.closest("[data-capture-upload]")) {
          const input = self.root.querySelector("[data-capture-file]");
          if (input) input.click();
          return;
        }
        if (event.target.closest("[data-capture-copy]")) {
          if (self.text) {
            navigator.clipboard.writeText(self.text).then(function () {
              self.toast("已复制");
            }).catch(function () { self.toast("复制失败"); });
          }
          return;
        }
        if (event.target.closest("[data-capture-send]")) {
          if (!self.text) { self.toast("还没有识别结果"); return; }
          if (!self.chat || !self.chat.active) { self.toast("请先打开群聊或单聊"); return; }
          self.chat.sendText(self.text).then(function (ok) {
            if (ok) { self.close(); self.toast("已发送到当前聊天"); }
          });
          return;
        }
        const win = event.target.closest("[data-capture-window]");
        if (win) self.captureWindow(win.getAttribute("data-capture-window"));
      });
      this.root.addEventListener("change", function (event) {
        if (event.target.matches("[data-capture-file]")) {
          const file = event.target.files && event.target.files[0];
          if (file) self.upload(file);
        }
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && self.root && !self.root.hidden) self.close();
      });
    }

    setResult(text) {
      this.text = text || "";
      const out = this.root && this.root.querySelector("#captureResult");
      if (out) out.textContent = this.text || AO.t("captureEmpty");
    }

    async scan() {
      const box = this.root && this.root.querySelector("#captureWindows");
      if (box) box.innerHTML = '<div class="capture-empty">' + esc(AO.t("captureLoading")) + '</div>';
      try {
        const res = await fetch(this.bridge() + "/chat-capture/windows", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "scan failed");
        const windows = data.windows || [];
        if (box) {
          box.innerHTML = windows.length ? windows.map((w) =>
            '<button type="button" class="capture-window" data-capture-window="' + esc(w.id) + '">' +
            '<b>' + esc(w.app || "QQ / WeChat") + '</b><span>' + esc(w.title || "聊天窗口") +
            '</span><em>#' + esc(w.id) + '</em></button>').join("") :
            '<div class="capture-empty">' + esc(AO.t("captureNoWindows")) + '</div>';
        }
      } catch (err) {
        if (box) box.innerHTML = '<div class="capture-empty error">' + esc(AO.t("captureNoWindows")) + '</div>';
      }
    }

    async captureWindow(id) {
      const box = this.root && this.root.querySelector("#captureResult");
      if (box) box.textContent = AO.t("captureLoading");
      try {
        const res = await fetch(this.bridge() + "/chat-capture/window", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ windowId: Number(id) })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "capture failed");
        this.setResult(data.text || "");
        if (!data.text) this.toast("窗口已采集，但没有识别到文字");
      } catch (err) {
        this.setResult("");
        this.toast("采集失败 · 请授予屏幕录制权限或上传截图");
      }
    }

    async upload(file) {
      const box = this.root && this.root.querySelector("#captureResult");
      if (box) box.textContent = AO.t("captureLoading");
      try {
        const headers = {
          "X-Filename": file.name || "chat.png",
          "X-Mime": file.type || "image/png",
          "X-Uploaded-By": "boss"
        };
        if (this.chat && this.chat.active) {
          headers["X-Conversation-Id"] = this.chat.active.id;
          if (this.chat.active.missionId) headers["X-Mission-Id"] = this.chat.active.missionId;
        }
        const upload = await fetch(this.bridge() + "/files", { method: "POST", headers, body: file });
        const artifact = await upload.json();
        if (!upload.ok) throw new Error(artifact.error || "upload failed");
        const vision = await fetch(this.bridge() + "/files/" + encodeURIComponent(artifact.artifact.id) + "/vision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        });
        const result = await vision.json();
        if (!vision.ok) throw new Error(result.error || "vision failed");
        this.setResult((result.artifact && result.artifact.extractedText) || "");
      } catch (err) {
        this.setResult("");
        this.toast("截图识别失败 · 检查 OCR / 视觉服务");
      }
    }
  }

  class FeatureShell {
    constructor(renderer, deps) {
      this.chat = new ChatHub(renderer);
      this.settings = new SettingsCenter(renderer);
      this.capture = new ChatCapture(renderer, this.chat);
      this.drawer = new FeatureDrawer(renderer, deps, this);
      this.chat.onCapture = () => this.capture.open();
    }
  }

  AO.FeatureShell = FeatureShell;
  AO.readChatStyle = readChatStyle;
})();
