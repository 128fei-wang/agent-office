(function () {
  "use strict";

  const AO = window.AgentOffice;
  const CUI = AO.ChatUI;
  const STYLE_KEY = "agent-office.chat.style.v1";
  const STYLE_EVENT = "agent-office:chat-style";
  const DRAFT_KEY = "agent-office.chat.drafts.v1";
  const MAX_FILES = 6;
  const MAX_FILE_BYTES = 25 * 1024 * 1024;

  const ICONS = {
    search: '<circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path>',
    info: '<circle cx="12" cy="12" r="8"></circle><path d="M12 11v5"></path><path d="M12 8h.01"></path>',
    close: '<path d="m6 6 12 12M18 6 6 18"></path>',
    plus: '<path d="M12 5v14M5 12h14"></path>',
    send: '<path d="m4 4 17 8-17 8 4-8-4-8Z"></path><path d="M8 12h13"></path>',
    clip: '<path d="m20 11-7.6 7.6a4 4 0 0 1-5.7-5.7l8.2-8.2a2.7 2.7 0 0 1 3.8 3.8l-8.2 8.2a1.3 1.3 0 0 1-1.9-1.9l7.6-7.6"></path>',
    smile: '<circle cx="12" cy="12" r="8"></circle><path d="M8.5 14.2a4 4 0 0 0 7 0"></path><path d="M9.2 9.5h.01M14.8 9.5h.01"></path>',
    at: '<circle cx="12" cy="12" r="4"></circle><path d="M16 12a4 4 0 1 0 4 4"></path><path d="M20 8v8"></path>',
    copy: '<rect x="8" y="8" width="10" height="10" rx="2"></rect><path d="M6 15V6a2 2 0 0 1 2-2h9"></path>',
    quote: '<path d="M9 7 4 12l5 5"></path><path d="M4 12h9a6 6 0 0 1 6 6v1"></path>',
    pin: '<path d="m9 4 6 0-.6 5 3.1 3v1H5.5v-1l3.1-3L8 4Z"></path><path d="M12 13v7"></path>',
    bellOff: '<path d="M6.5 9.5A5.5 5.5 0 0 1 12 4a5.5 5.5 0 0 1 5.5 5.5c0 2.4.7 4 1.5 5H9"></path><path d="M5 14.5h2"></path><path d="M10.5 18a2 2 0 0 0 3.8 0"></path><path d="m4 4 16 16"></path>',
    bell: '<path d="M6.5 9.5A5.5 5.5 0 0 1 12 4a5.5 5.5 0 0 1 5.5 5.5c0 2.4.7 4 1.5 5H5c.8-1 1.5-2.6 1.5-5Z"></path><path d="M10.5 18a2 2 0 0 0 3.8 0"></path>',
    trash: '<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"></path><path d="M10 11v5M14 11v5"></path>',
    more: '<circle cx="6" cy="12" r="1.2"></circle><circle cx="12" cy="12" r="1.2"></circle><circle cx="18" cy="12" r="1.2"></circle>',
    back: '<path d="m15 5-7 7 7 7"></path>',
    maximize: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"></path>',
    restore: '<path d="M9 9h11v11H9z"></path><path d="M5 15H4V4h11v1"></path>',
    external: '<path d="M14 5h5v5M19 5l-8 8"></path><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>',
    check: '<path d="m5 12 4 4L19 6"></path>',
    chevron: '<path d="m6 9 6 6 6-6"></path>',
    file: '<path d="M6 3h8l4 4v14H6z"></path><path d="M14 3v5h5"></path>',
    users: '<path d="M16 19v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V19"></path><circle cx="9.5" cy="7" r="3"></circle><path d="M17 11a3 3 0 1 0-1-5.8M21 19v-1.5a4 4 0 0 0-2.5-3.7"></path>',
    sparkle: '<path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3Z"></path><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"></path>',
    download: '<path d="M12 4v10"></path><path d="m8 10 4 4 4-4"></path><path d="M5 20h14"></path>'
  };

  function icon(name, size) {
    const box = Number(size) || 16;
    return '<svg class="chat-ico" width="' + box + '" height="' + box +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || ICONS.sparkle) + "</svg>";
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function readStyle() {
    try { return localStorage.getItem(STYLE_KEY) || "agent"; }
    catch (err) { return "agent"; }
  }

  function writeStyle(style) {
    try { localStorage.setItem(STYLE_KEY, style); } catch (err) {}
    document.dispatchEvent(new CustomEvent(STYLE_EVENT, { detail: style }));
  }

  function readDrafts() {
    try {
      const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch (err) { return {}; }
  }

  function writeDrafts(value) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(value || {})); } catch (err) {}
  }

  function isOnline(member) {
    return !!member && (member.online === true || member.status === "online");
  }

  function memberName(member) {
    if (!member) return "Agent";
    const label = AO.lang === "en" ?
      (member.titleEn || member.name || member.titleZh) :
      (member.titleZh || member.name);
    return label || member.id || "Agent";
  }

  function roleName(member) {
    if (!member) return "Agent";
    return (AO.lang === "en" ?
      (member.roleLabelEn || member.role) :
      (member.roleLabelZh || member.role)) || "Agent";
  }

  function groupTitle(conversation) {
    return String((conversation && conversation.title) || "").replace(/^#\s*/, "") ||
      (AO.t ? AO.t("chatGroupTitle") : "群聊");
  }

  function previewText(conversation) {
    const last = conversation && conversation.lastMessage;
    if (!last) return AO.t ? AO.t("chatNoMessagesPreview") : "还没有消息";
    const prefix = last.senderType === "boss" ? (AO.t ? AO.t("chatYouPrefix") : "你: ") : "";
    let text = String(last.text || "").replace(/\s+/g, " ").trim();
    if (!text) {
      text = last.attachmentCount ? (AO.t ? AO.t("chatAttachmentPreview") : "发送了附件") :
        (last.type === "report" ? (AO.t ? AO.t("chatReportPreview") : "汇报") :
          (AO.t ? AO.t("chatNewMessagePreview") : "新消息"));
    }
    const reportLabel = AO.t ? AO.t("chatReportPreview") : "汇报";
    if (last.type === "report" && text.indexOf(reportLabel) < 0) text = reportLabel + " · " + text;
    return prefix + text;
  }

  function timeValue(value) {
    const date = new Date(value || 0);
    return isNaN(date.getTime()) ? 0 : date.getTime();
  }

  class ChatHub {
    constructor(renderer) {
      this.renderer = renderer;
      this.root = document.getElementById("chatHubRoot");
      if (this.root) this.root.hidden = true;
      this.active = null;
      this.messages = [];
      this.conversations = [];
      this.agents = [];
      this.timer = null;
      this.convTimer = null;
      this.readTimer = null;
      this.replyTimer = null;
      this.timer = null;
      this.eventStream = null;
      this.streamRefreshTimer = null;
      this.replyPending = false;
      this.replySeq = 0;
      this.view = "closed";
      this.filter = "all";
      this.search = "";
      this.messageQuery = "";
      this.messageSearchOpen = false;
      this.lastPicker = "group";
      this.drafts = readDrafts();
      this.draftTimer = null;
      this.files = [];
      this.sending = false;
      this.loading = false;
      this.loadingMessages = false;
      this.lastSeq = 0;
      this.atBottom = true;
      this.pendingNew = 0;
      this.replyTo = null;
      this.detailsOpen = false;
      this.detailsFiles = [];
      this.maximized = false;
      this.emojiOpen = false;
      this.mention = null;
      this.menuId = "";
      this.deleteArmed = "";
      this.renameId = "";
      this.lastFocus = null;
      this.bind();
    }

    bridge() {
      const ext = this.renderer && this.renderer.external;
      return String((ext && ext.bridgeUrl) || AO.BRIDGE_DEFAULT || "").replace(/\/+$/, "");
    }

    t(key, vars) {
      return AO.t(key, vars);
    }

    toast(text) {
      if (this.renderer && this.renderer.toast) this.renderer.toast(text);
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

    section() {
      return this.root && this.root.querySelector(".chat-hub");
    }

    main() {
      return this.root && this.root.querySelector(".chat-main");
    }

    messagesBox() {
      return this.root && this.root.querySelector("#chatMessages");
    }

    bind() {
      const self = this;
      if (!this.root) return;
      this.root.addEventListener("click", function (event) {
        self.onClick(event);
      });
      this.root.addEventListener("submit", function (event) {
        if (event.target.id === "chatSendForm") {
          event.preventDefault();
          const input = event.target.querySelector("#chatDraft");
          self.sendText(input ? input.value : "");
        }
        if (event.target.id === "chatGroupForm") {
          event.preventDefault();
          self.createGroup(event.target);
        }
        if (event.target.id === "chatRenameForm") {
          event.preventDefault();
          self.saveRename(event.target);
        }
      });
      this.root.addEventListener("input", function (event) {
        self.onInput(event);
      });
      this.root.addEventListener("change", function (event) {
        if (event.target.id === "chatFileInput") {
          self.handleFiles(Array.from(event.target.files || []));
          event.target.value = "";
        }
      });
      this.root.addEventListener("keydown", function (event) {
        self.onKeydown(event);
      });
      this.root.addEventListener("scroll", function (event) {
        const box = event.target;
        if (!box || box.id !== "chatMessages") return;
        self.updateAtBottom(box);
      }, true);
      this.root.addEventListener("dragenter", function (event) {
        if (!self.active) return;
        event.preventDefault();
        self.drag(true);
      });
      this.root.addEventListener("dragover", function (event) {
        if (!self.active) return;
        event.preventDefault();
      });
      this.root.addEventListener("dragleave", function (event) {
        if (!event.relatedTarget || !self.root.contains(event.relatedTarget)) self.drag(false);
      });
      this.root.addEventListener("paste", function (event) {
        if (!self.active) return;
        const files = Array.from((event.clipboardData && event.clipboardData.files) || []);
        if (!files.length) return;
        event.preventDefault();
        self.handleFiles(files);
      });
      this.root.addEventListener("drop", function (event) {
        if (!self.active) return;
        event.preventDefault();
        self.drag(false);
        self.handleFiles(Array.from((event.dataTransfer && event.dataTransfer.files) || []));
      });
      document.addEventListener("keydown", function (event) {
        if (!self.root || self.root.hidden || !self.root.querySelector(".chat-hub")) return;
        if (event.key === "Escape") {
          if (self.root.querySelector("#chatDialog")) {
            self.closeRenameDialog();
            event.stopPropagation();
            return;
          }
          if (self.closeMenus()) { event.stopPropagation(); return; }
          if (self.messageSearchOpen) { self.toggleMessageSearch(false); event.stopPropagation(); return; }
          if (self.emojiOpen || self.mention) { self.closeMenus(); event.stopPropagation(); return; }
          self.close();
          event.stopPropagation();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const search = self.root.querySelector("#chatConvSearch");
          if (search) { search.focus(); search.select(); }
          return;
        }
        if ((event.metaKey || event.ctrlKey) && (event.key === "f" || event.key === "F")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          self.toggleMessageSearch(true);
          return;
        }
        const focusRoot = self.section();
        if (focusRoot) self.trapTab(focusRoot, event);
      });
      document.addEventListener(STYLE_EVENT, function () {
        self.applyStyle();
      });
      document.addEventListener("agent-office:lang", function () {
        if (self.root && !self.root.hidden) {
          self.renderSidebar();
          self.renderMain();
        }
      });
      window.addEventListener("resize", function () {
        self.closeMenus();
      });
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden && self.root && !self.root.hidden && self.active) {
          self.loadMessages(false);
          self.refreshConversations();
        }
      });
    }

    focusables() {
      const root = this.section();
      if (!root) return [];
      return Array.from(root.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(function (node) { return node.offsetParent !== null; });
    }

    trapTab(root, event) {
      if (event.key !== "Tab") return;
      const nodes = this.focusables();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    syncModalState() {
      if (AO.syncAppInert) AO.syncAppInert();
    }

    applyStyle() {
      const section = this.section();
      if (!section) return;
      ["agent", "qq", "wechat"].forEach(function (style) {
        section.classList.toggle("style-" + style, readStyle() === style);
      });
      const label = this.root.querySelector(".chat-style-label");
      if (label) label.textContent = readStyle().toUpperCase();
    }

    close() {
      this.stopPoll();
      this.stopConvPoll();
      this.stopStream();
      this.captureDraft();
      this.active = null;
      this.messages = [];
      this.files = [];
      this.replyTo = null;
      this.pendingNew = 0;
      this.replyPending = false;
      this.replySeq = 0;
      this.messageQuery = "";
      this.messageSearchOpen = false;
      this.detailsOpen = false;
      this.view = "closed";
      this.closeMenus();
      this.closeRenameDialog();
      if (this.replyTimer) window.clearTimeout(this.replyTimer);
      this.replyTimer = null;
      if (this.readTimer) window.clearTimeout(this.readTimer);
      this.readTimer = null;
      if (this.root) {
        this.root.hidden = true;
        this.root.innerHTML = "";
        this.root.classList.remove("chat-show-main");
      }
      this.syncModalState();
      if (this.lastFocus && this.lastFocus.isConnected) {
        try { this.lastFocus.focus({ preventScroll: true }); } catch (err) {}
      }
      this.lastFocus = null;
    }

    closeMenus() {
      const popover = this.root && this.root.querySelector("#chatPopover");
      let open = false;
      if (popover && !popover.hidden) {
        popover.hidden = true;
        popover.innerHTML = "";
        open = true;
      }
      if (this.emojiOpen) {
        this.emojiOpen = false;
        const emoji = this.root && this.root.querySelector("#chatEmojiPop");
        if (emoji) emoji.hidden = true;
        open = true;
      }
      if (this.mention) {
        this.mention = null;
        const menu = this.root && this.root.querySelector("#chatMentionMenu");
        if (menu) { menu.hidden = true; menu.innerHTML = ""; }
        open = true;
      }
      this.menuId = "";
      this.deleteArmed = "";
      return open;
    }

    drag(show) {
      const overlay = this.root && this.root.querySelector("#chatDropOverlay");
      if (!overlay) return;
      overlay.hidden = !show;
    }

    /* ------------------------------------------------------------- loading */

    async openHub(mode) {
      this.lastFocus = document.activeElement;
      this.captureDraft();
      this.stopPoll();
      this.stopConvPoll();
      this.stopStream();
      this.active = null;
      this.messages = [];
      this.files = [];
      this.replyTo = null;
      this.pendingNew = 0;
      this.replyPending = false;
      if (this.replyTimer) window.clearTimeout(this.replyTimer);
      this.replyTimer = null;
      this.lastSeq = 0;
      this.messageQuery = "";
      this.messageSearchOpen = false;
      this.detailsOpen = false;
      this.view = "welcome";
      this.search = "";
      this.filter = mode === "direct" ? "direct" : mode === "group" ? "group" : "all";
      this.lastPicker = this.filter === "direct" ? "direct" : "group";
      this.renderShell();
      if (this.root) this.root.classList.remove("chat-show-main");
      this.renderSidebar();
      this.renderMain();
      this.syncModalState();
      this.startConvPoll();
      await this.loadDirectory();
      if (!this.root || this.root.hidden) return;
      this.startStream();
      this.renderSidebar();
      if (!this.active) this.renderMain();
      const search = this.root.querySelector("#chatConvSearch");
      if (search && window.innerWidth > 760) {
        try { search.focus({ preventScroll: true }); } catch (err) {}
      }
    }

    openGroupPicker() {
      return this.openHub("group");
    }

    openDirectPicker() {
      return this.openHub("direct");
    }

    async loadDirectory() {
      try {
        const [convRes, agentRes] = await Promise.all([
          this.api("/conversations"),
          this.api("/missions/agents")
        ]);
        this.conversations = convRes.conversations || [];
        this.agents = agentRes.agents || [];
        if (this.active) {
          const fresh = this.conversations.find((row) => row.id === this.active.id);
          if (fresh) this.active = fresh;
        }
      } catch (err) {
        this.loadError = this.t("chatError");
      }
    }

    async refreshConversations() {
      if (!this.root || this.root.hidden) return;
      try {
        const data = await this.api("/conversations");
        const rows = data.conversations || [];
        const sig = JSON.stringify(rows.map((row) => [
          row.id, row.title, row.updatedAt, row.lastSeq, row.unreadCount,
          row.pinned, row.muted, row.readSeq
        ]));
        if (sig === this.convSig) return;
        this.convSig = sig;
        this.conversations = rows;
        if (this.active) {
          const fresh = rows.find((row) => row.id === this.active.id);
          if (fresh) this.active = Object.assign({}, this.active, fresh);
        }
        this.renderConversationList();
      } catch (err) {}
    }

    startConvPoll() {
      this.stopConvPoll();
      const self = this;
      this.convTimer = window.setInterval(function () {
        if (!document.hidden) self.refreshConversations();
      }, 5000);
    }

    stopConvPoll() {
      if (this.convTimer) window.clearInterval(this.convTimer);
      this.convTimer = null;
    }

    /* -------------------------------------------------------------- shell */

    renderShell() {
      if (!this.root) return;
      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");
      this.root.innerHTML =
        '<div class="chat-hub-backdrop" data-chat-close></div>' +
        '<section class="chat-window chat-hub' + (this.maximized ? " is-max" : "") +
        " style-" + esc(readStyle()) + '" role="dialog" aria-modal="true" aria-label="' +
        esc(this.t("chatMessages", "消息")) + '">' +
        '<aside class="chat-side" aria-label="' + esc(this.t("chatMessages", "消息")) + '">' +
        '<div class="chat-side-inner" id="chatSide"></div></aside>' +
        '<main class="chat-main" id="chatMain"></main>' +
        '<div class="chat-popover" id="chatPopover" hidden></div>' +
        '<div class="chat-drop-overlay" id="chatDropOverlay" hidden>' + icon("clip", 24) +
        '<b>' + esc(this.t("chatDropFiles", "松开发送文件")) + "</b></div>" +
        "</section>";
    }

    renderSidebar() {
      const side = this.root && this.root.querySelector("#chatSide");
      if (!side) return;
      const unread = this.conversations.reduce(function (sum, row) {
        return sum + (row.muted ? 0 : Number(row.unreadCount || 0));
      }, 0);
      side.innerHTML =
        '<header class="chat-side-head">' +
        '<div class="chat-side-title"><span class="chat-eyebrow">MESSAGES</span><h2 id="chatHubTitle">' +
        esc(this.t("chatMessages", "消息")) +
        (unread ? '<b class="chat-unread-total">' + (unread > 99 ? "99+" : unread) + "</b>" : "") +
        '</h2></div><div class="chat-side-actions">' +
        '<button type="button" class="chat-icon-btn" data-chat-new-group title="' +
        esc(this.t("chatNewGroup", "新建群聊")) + '" aria-label="' +
        esc(this.t("chatNewGroup", "新建群聊")) + '">' + icon("plus", 18) + "</button>" +
        '<button type="button" class="chat-icon-btn" data-chat-close title="' +
        esc(this.t("chatClose", "关闭")) + '" aria-label="' +
        esc(this.t("chatClose", "关闭")) + '">' + icon("close", 18) + "</button>" +
        "</div></header>" +
        '<div class="chat-side-search">' + icon("search", 15) +
        '<input id="chatConvSearch" type="search" autocomplete="off" placeholder="' +
        esc(this.t("chatSearchConversations", "搜索会话或成员")) + '" value="' +
        esc(this.search) + '" aria-label="' +
        esc(this.t("chatSearchConversations", "搜索会话或成员")) + '" /></div>' +
        '<div class="chat-filter-tabs" role="tablist">' +
        ["all", "group", "direct"].map((filter) =>
          '<button type="button" role="tab" data-chat-filter="' + filter +
          '" aria-selected="' + (this.filter === filter ? "true" : "false") +
          '" class="' + (this.filter === filter ? "active" : "") + '">' +
          esc(this.t(filter === "all" ? "chatAll" : filter === "group" ? "chatGroups" : "chatDirects",
            filter === "all" ? "全部" : filter === "group" ? "群聊" : "私聊")) + "</button>").join("") +
        "</div>" +
        '<div class="chat-conv-list" id="chatConvList" role="list"></div>' +
        '<footer class="chat-side-foot">' +
        '<button type="button" class="chat-side-new" data-chat-new-group>' + icon("plus", 15) +
        "<span>" + esc(this.t("chatNewGroup", "新建群聊")) + "</span></button>" +
        '<button type="button" class="chat-side-new ghost" data-chat-new-direct>' + icon("at", 15) +
        "<span>" + esc(this.t("chatNewChat", "私聊 Agent")) + "</span></button>" +
        "</footer>";
      this.renderConversationList();
      this.applyStyle();
    }

    renderConversationList() {
      const list = this.root && this.root.querySelector("#chatConvList");
      if (!list) return;
      const query = this.search.trim().toLowerCase();
      const rows = this.conversations
        .filter((row) => this.filter === "all" || row.kind === this.filter)
        .filter((row) => {
          if (!query) return true;
          const haystack = [
            row.title, previewText(row),
            (row.members || []).map(memberName).join(" ")
          ].join(" ").toLowerCase();
          return haystack.indexOf(query) >= 0;
        })
        .sort(function (a, b) {
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
          return timeValue(b.updatedAt) - timeValue(a.updatedAt);
        });
      const rowsHTML = rows.map((row) => this.conversationRow(row)).join("");
      const contacts = this.filter === "direct" ? this.agentContacts(query) : "";
      list.innerHTML = rowsHTML ||
        '<div class="chat-list-empty">' + icon("sparkle", 20) +
        '<b>' + esc(query ? this.t("chatNoResults", "没有匹配的会话") :
          this.filter === "direct" ? this.t("chatNoDirects", "还没有私聊") :
          this.t("chatNoGroups", "还没有群聊，创建一个吧。")) + "</b><span>" +
        esc(query ? this.t("chatSearchTryOther", "换个关键词试试") :
          this.t("chatStartHint", "和 Agent 团队同步进度、风险与决策")) + "</span></div>" +
        (rowsHTML ? "" : "");
      if (contacts) {
        list.innerHTML += '<div class="chat-side-section">' + esc(this.t("chatAgentContacts", "Agent 联系人")) +
          "</div>" + contacts;
      }
      this.applyStyle();
    }

    conversationRow(row) {
      const active = this.active && this.active.id === row.id;
      const unread = Number(row.unreadCount || 0);
      const member = (row.members || [])[0] || {};
      const online = row.kind === "direct" ? isOnline(member) :
        (row.members || []).some(isOnline);
      const title = row.kind === "direct" ? memberName(member) : groupTitle(row);
      const time = CUI.smartTime(row.updatedAt);
      const preview = previewText(row);
      return '<div class="chat-conv-row' + (active ? " active" : "") +
        (unread ? " unread" : "") + (row.muted ? " muted" : "") +
        '" role="button" tabindex="0" data-chat-conv="' + esc(row.id) + '" aria-label="' +
        esc(title) + '">' +
        '<span class="chat-conv-avatar-wrap">' +
        (row.kind === "direct" ? CUI.avatar(member, { size: 38 }) : this.groupAvatar(row, 38)) +
        '<i class="chat-presence ' + (online ? "online" : "") + '"></i></span>' +
        '<span class="chat-conv-copy"><span class="chat-conv-top"><b>' + esc(title) + "</b><time>" +
        esc(time) + '</time></span><span class="chat-conv-preview">' + esc(preview) +
        "</span></span>" +
        '<span class="chat-conv-side">' +
        (row.pinned ? '<i class="chat-pin-mark" title="' + esc(this.t("chatPinned", "已固定")) +
          '">' + icon("pin", 12) + "</i>" : "") +
        (row.muted ? '<i class="chat-muted-mark" title="' + esc(this.t("chatMuted", "已静音")) +
          '">' + icon("bellOff", 12) + "</i>" : "") +
        (unread ? '<b class="chat-unread-badge' + (row.muted ? " muted" : "") + '">' +
          (unread > 99 ? "99+" : unread) + "</b>" : "") +
        '<button type="button" class="chat-conv-menu-btn" data-chat-conv-menu="' + esc(row.id) +
        '" aria-label="' + esc(this.t("chatConversationOptions", "会话操作")) + '" title="' +
        esc(this.t("chatConversationOptions", "会话操作")) + '">' + icon("more", 16) + "</button>" +
        "</span></div>";
    }

    agentContacts(query) {
      const rows = this.agents.filter((agent) => {
        if (!query) return true;
        return [agent.titleZh, agent.name, agent.roleLabelZh, agent.role, (agent.skills || []).join(" ")]
          .join(" ").toLowerCase().indexOf(query) >= 0;
      });
      if (!rows.length) return "";
      return rows.map((agent) => {
        const name = memberName(agent);
        return '<button type="button" class="chat-agent-row" data-chat-agent="' + esc(agent.id) +
          '"><span class="chat-conv-avatar-wrap">' + CUI.avatar(agent, { size: 34 }) +
          '<i class="chat-presence ' + (isOnline(agent) ? "online" : "") + '"></i></span>' +
          '<span class="chat-conv-copy"><b>' + esc(name) + "</b><em>" +
          esc(roleName(agent)) + " · " +
          esc(isOnline(agent) ? this.t("chatOnline", "在线") : this.t("chatOffline", "离线")) +
          "</em></span><span class=\"chat-agent-plus\">" + icon("plus", 15) + "</span></button>";
      }).join("");
    }

    groupAvatar(conversation, size) {
      const members = (conversation && conversation.members) || [];
      const box = Number(size) || 38;
      if (!members.length) {
        return '<span class="chat-group-avatar" style="--avatar-size:' + box + 'px"><b>#</b></span>';
      }
      const avatarSize = Math.max(20, Math.round(box * 0.64));
      return '<span class="chat-group-avatar" style="--avatar-size:' + box + 'px">' +
        members.slice(0, 2).map((member) => CUI.avatar(member, { size: avatarSize })).join("") +
        (members.length > 2 ? '<em class="chat-group-count">' + members.length + "</em>" : "") +
        "</span>";
    }

    renderMain(skipCapture) {
      const main = this.main();
      if (!main) return;
      if (!skipCapture) this.captureDraft();
      if (this.view === "new-group") {
        main.innerHTML = this.groupFormHTML();
        const title = main.querySelector("#chatGroupTitle");
        if (title) {
          try { title.focus({ preventScroll: true }); } catch (err) {}
        }
        return;
      }
      if (!this.active) {
        main.innerHTML = this.welcomeHTML();
        return;
      }
      const conversation = this.active;
      const member = (conversation.members || [])[0] || {};
      const title = conversation.kind === "direct" ? memberName(member) : groupTitle(conversation);
      const online = (conversation.members || []).filter(isOnline).length;
      const subtitle = conversation.kind === "direct" ?
        (roleName(member) + " · " +
          (isOnline(member) ? this.t("chatOnline", "在线") : this.t("chatOffline", "离线"))) :
        (conversation.members || []).length + " " + this.t("chatMembersShort", "位成员") +
          " · " + online + " " + this.t("chatOnlineCount", "在线");
      main.innerHTML =
        '<header class="chat-head">' +
        '<button type="button" class="chat-back-btn" data-chat-sidebar-back aria-label="' +
        esc(this.t("chatBack", "返回会话")) + '">' + icon("back", 18) + "</button>" +
        '<div class="chat-head-id">' +
        (conversation.kind === "direct" ? CUI.avatar(member, { size: 36 }) : this.groupAvatar(conversation, 36)) +
        '<div class="chat-head-copy"><b>' + esc(title) + "</b><span>" +
        '<i class="chat-presence ' + (online ? "online" : "") + '"></i>' + esc(subtitle) + "</span></div></div>" +
        '<div class="chat-head-actions">' +
        '<button type="button" class="chat-icon-btn" data-chat-search-toggle title="' +
        esc(this.t("chatSearchMessages", "搜索消息")) + '" aria-label="' +
        esc(this.t("chatSearchMessages", "搜索消息")) + '">' + icon("search", 17) + "</button>" +
        '<button type="button" class="chat-icon-btn' + (this.detailsOpen ? " active" : "") +
        '" data-chat-info-toggle title="' + esc(this.t("chatDetails", "会话信息")) + '" aria-label="' +
        esc(this.t("chatDetails", "会话信息")) + '">' + icon("info", 17) + "</button>" +
        '<button type="button" class="chat-icon-btn" data-chat-style-toggle title="' +
        esc(this.t("chatStyle", "切换聊天风格")) + '" aria-label="' +
        esc(this.t("chatStyle", "切换聊天风格")) + '">' +
        '<span class="chat-style-letter">' + esc(readStyle().slice(0, 1).toUpperCase()) + "</span></button>" +
        '<button type="button" class="chat-icon-btn" data-chat-maximize title="' +
        esc(this.maximized ? this.t("chatRestore", "还原窗口") : this.t("chatMaximize", "最大化")) +
        '" aria-label="' + esc(this.maximized ? this.t("chatRestore", "还原窗口") : this.t("chatMaximize", "最大化")) +
        '">' + icon(this.maximized ? "restore" : "maximize", 17) + "</button>" +
        '<button type="button" class="chat-icon-btn" data-chat-close title="' +
        esc(this.t("chatClose", "关闭")) + '" aria-label="' + esc(this.t("chatClose", "关闭")) + '">' +
        icon("close", 18) + "</button></div></header>" +
        '<div class="chat-msg-search" id="chatMsgSearch"' + (this.messageSearchOpen ? "" : " hidden") + ">" +
        icon("search", 15) + '<input id="chatMsgSearchInput" type="search" value="' +
        esc(this.messageQuery) + '" placeholder="' + esc(this.t("chatSearchMessages", "搜索消息")) +
        '" aria-label="' + esc(this.t("chatSearchMessages", "搜索消息")) + '"><span id="chatMsgSearchCount"></span>' +
        '<button type="button" class="chat-icon-btn small" data-chat-search-close aria-label="' +
        esc(this.t("chatSearchClose", "关闭搜索")) + '">' + icon("close", 15) + "</button></div>" +
        '<div class="chat-messages" id="chatMessages" role="log" aria-live="polite" aria-relevant="additions"></div>' +
        '<button type="button" class="chat-new-pill" id="chatNewPill" data-chat-new hidden></button>' +
        this.composerHTML() +
        (this.detailsOpen ? '<aside class="chat-details" id="chatDetails"></aside>' : "");
      this.renderMessages(true);
      this.updateComposerState();
      if (this.detailsOpen) this.renderDetails();
    }

    welcomeHTML() {
      const groups = this.conversations.filter((row) => row.kind === "group").length;
      const directs = this.conversations.filter((row) => row.kind === "direct").length;
      return '<div class="chat-welcome">' +
        '<div class="chat-welcome-mark">' + icon("sparkle", 34) + "</div>" +
        '<span class="chat-eyebrow">TEAM MESSAGES</span>' +
        '<h2>' + esc(this.t("chatStartTitle", "和 Agent 团队保持同步")) + "</h2>" +
        '<p>' + esc(this.t("chatStartSub", "私聊 Agent，或在群里同步进度、风险和需要拍板的事项。")) + "</p>" +
        '<div class="chat-welcome-stats"><span><b>' + groups + "</b>" +
        esc(this.t("chatGroups", "群聊")) + "</span><span><b>" + directs + "</b>" +
        esc(this.t("chatDirects", "私聊")) + "</span><span><b>" +
        this.conversations.reduce((sum, row) => sum + Number(row.unreadCount || 0), 0) + "</b>" +
        esc(this.t("chatUnread", "未读")) + "</span></div>" +
        '<div class="chat-welcome-actions">' +
        '<button type="button" class="chat-primary" data-chat-new-group>' + icon("plus", 16) +
        esc(this.t("chatNewGroup", "新建群聊")) + "</button>" +
        '<button type="button" class="chat-secondary" data-chat-new-direct>' + icon("at", 16) +
        esc(this.t("chatNewChat", "私聊 Agent")) + "</button></div>" +
        '<div class="chat-welcome-tips">' +
        [["quote", this.t("chatTipQuote", "引用回复，保持上下文")],
         ["clip", this.t("chatTipFiles", "拖入文件或图片直接发送")],
         ["users", this.t("chatTipMention", "群聊里用 @ 指定 Agent")]]
          .map((item) => '<span>' + icon(item[0], 15) + item[1] + "</span>").join("") +
        "</div></div>";
    }

    groupFormHTML() {
      const selected = new Set(this.agents.slice(0, 2).map((agent) => agent.id));
      return '<div class="chat-create-pane">' +
        '<header class="chat-create-head"><button type="button" class="chat-icon-btn" data-chat-cancel-new aria-label="' +
        esc(this.t("chatBack", "返回")) + '">' + icon("back", 18) + "</button>" +
        '<div><span class="chat-eyebrow">NEW GROUP</span><h2>' + esc(this.t("chatNewGroup", "新建群聊")) +
        "</h2></div><button type=\"button\" class=\"chat-icon-btn\" data-chat-close aria-label=\"" +
        esc(this.t("chatClose", "关闭")) + "\">" + icon("close", 18) + "</button></header>" +
        '<form id="chatGroupForm" class="chat-group-form">' +
        '<label class="chat-field"><span>' + esc(this.t("chatGroupName", "群名称")) + "</span><input name=\"title\" id=\"chatGroupTitle\" maxlength=\"120\" placeholder=\"" +
        esc(this.t("chatGroupNamePlaceholder", "例如：发布协作群")) + '" required /></label>' +
        '<div class="chat-field"><span>' + esc(this.t("chatMembers", "选择成员")) + "</span>" +
        '<div class="chat-member-grid">' + this.agents.map((agent) => {
          const name = memberName(agent);
          return '<label class="chat-member-card"><input type="checkbox" name="memberIds" value="' +
            esc(agent.id) + '"' + (selected.has(agent.id) ? " checked" : "") + " />" +
            CUI.avatar(agent, { size: 34 }) + '<span><b>' + esc(name) + "</b><em>" +
            esc(roleName(agent)) + "</em></span></label>";
        }).join("") + "</div></div>" +
        '<footer class="chat-form-foot"><button type="button" class="chat-secondary" data-chat-cancel-new>' +
        esc(this.t("chatCancel", "取消")) + '</button><button type="submit" class="chat-primary">' +
        icon("plus", 15) + esc(this.t("chatCreate", "创建并打开")) + "</button></footer></form></div>";
    }

    composerHTML() {
      const id = this.active && this.active.id;
      const draft = this.drafts[id] || "";
      const hasFiles = this.files.some((file) => !file.uploading);
      const sendDisabled = this.sending || (!String(draft).trim() && !hasFiles);
      const pending = this.files.map((file, index) => this.pendingFileHTML(file, index)).join("");
      const reply = this.replyTo ? '<div class="chat-reply-preview">' +
        '<div><b>' + esc(this.t("chatReplyingTo", "回复")) + " " +
        esc(this.replyTo.senderName || this.t("chatYou", "我")) + "</b><span>" +
        esc(String(this.replyTo.text || "").slice(0, 180)) + "</span></div>" +
        '<button type="button" class="chat-icon-btn small" data-chat-quote-close aria-label="' +
        esc(this.t("chatCancelReply", "取消引用")) + '">' + icon("close", 14) + "</button></div>" : "";
      return '<div class="chat-composer-wrap">' + reply +
        (pending ? '<div class="chat-pending-files" id="chatPendingFiles">' + pending + "</div>" : "") +
        '<form class="chat-composer" id="chatSendForm">' +
        '<textarea id="chatDraft" rows="1" maxlength="8000" placeholder="' +
        esc(this.t("chatSendPlaceholder", "给 Agent 发消息…")) + '" aria-label="' +
        esc(this.t("chatSendPlaceholder", "给 Agent 发消息…")) + '">' + esc(draft) + "</textarea>" +
        '<div class="chat-composer-bar"><div class="chat-composer-tools">' +
        '<button type="button" class="chat-tool-btn" data-chat-attach title="' +
        esc(this.t("chatAttach", "添加附件")) + '" aria-label="' + esc(this.t("chatAttach", "添加附件")) + '">' +
        icon("clip", 17) + '</button><button type="button" class="chat-tool-btn" data-chat-emoji-toggle title="' +
        esc(this.t("chatEmoji", "插入表情")) + '" aria-label="' + esc(this.t("chatEmoji", "插入表情")) + '">' +
        icon("smile", 17) + '</button><button type="button" class="chat-tool-btn" data-chat-mention title="' +
        esc(this.t("chatMention", "提及成员")) + '" aria-label="' + esc(this.t("chatMention", "提及成员")) + '">' +
        icon("at", 17) + '</button></div><div class="chat-composer-send">' +
        '<span class="chat-char-count" id="chatCharCount"></span><button type="submit" class="chat-send-btn" id="chatSendBtn"' +
        (sendDisabled ? " disabled" : "") + ' aria-label="' +
        esc(this.t("chatSend", "发送")) + '" title="' + esc(this.t("chatSend", "发送")) + '">' +
        icon("send", 17) + "</button></div></div>" +
        '<input type="file" id="chatFileInput" multiple hidden />' +
        '<div class="chat-emoji-pop" id="chatEmojiPop" hidden>' +
        ["😀", "😄", "👍", "🙏", "🎉", "🔥", "✅", "👀", "🤝", "💡", "⚠️", "🚀", "📌", "📎", "❤️", "👌"]
          .map((emoji) => '<button type="button" data-chat-emoji="' + emoji + '">' + emoji + "</button>").join("") +
        "</div><div class=\"chat-mention-menu\" id=\"chatMentionMenu\" hidden></div></form></div>";
    }

    pendingFileHTML(file, index) {
      return '<span class="chat-pending-file' + (file.uploading ? " uploading" : "") + '">' +
        icon(file.uploading ? "sparkle" : "file", 14) + "<span>" + esc(file.name) + "</span><em>" +
        esc(file.uploading ? this.t("chatUploading", "上传中…") : CUI.fmtSize(file.size)) +
        '</em><button type="button" data-chat-file-remove="' + index + '" aria-label="' +
        esc(this.t("chatRemoveFile", "移除")) + '">' + icon("close", 12) + "</button></span>";
    }

    /* ------------------------------------------------------------ messages */

    memberFor(message) {
      const members = (this.active && this.active.members) || [];
      return members.find((member) => member.id === message.senderId) || {
        id: message.senderId,
        name: message.senderName || "Agent",
        titleZh: message.senderName || "Agent",
        logoText: CUI.initials(message.senderName || "Agent")
      };
    }

    bossMember() {
      return { id: "boss", name: this.t("chatYou", "我"), logoText: "ME", logoColor: "#55d6c2" };
    }

    renderMessages(scroll) {
      const box = this.messagesBox();
      if (!box) return;
      this.messages.sort(function (a, b) {
        return Number(a.seq || 0) - Number(b.seq || 0);
      });
      const oldTop = box.scrollTop;
      const wasBottom = this.atBottom || box.scrollHeight - box.scrollTop - box.clientHeight < 90;
      if (!this.messages.length) {
        box.innerHTML = '<div class="chat-conv-empty">' + icon("sparkle", 26) +
          "<b>" + esc(this.loadingMessages ? this.t("chatLoading", "加载中…") :
            this.t("chatNoMessages", "还没有消息，发第一句吧。")) + "</b><span>" +
          esc(this.t("chatNoMessagesHint", "Agent 会在这里回复，任务汇报也会同步进来。")) + "</span></div>";
        this.applyMessageSearch();
        return;
      }
      let html = "";
      let lastDay = "";
      let prev = null;
      this.messages.forEach((message) => {
        const day = CUI.dayKey(message.createdAt);
        if (day !== lastDay) {
          html += '<div class="chat-day"><span>' + esc(CUI.dayLabel(message.createdAt, (key) => this.t(key))) +
            "</span></div>";
          lastDay = day;
          prev = null;
        }
        const bubble = this.isBubble(message);
        const grouped = bubble && prev && prev.senderId === message.senderId &&
          this.isBubble(prev) && timeValue(message.createdAt) - timeValue(prev.createdAt) < 300000;
        html += this.messageHTML(message, grouped);
        prev = bubble ? message : null;
      });
      if (this.replyPending) html += this.typingHTML();
      box.innerHTML = html;
      if (scroll || wasBottom) {
        box.scrollTop = box.scrollHeight;
        this.atBottom = true;
        this.pendingNew = 0;
      } else {
        box.scrollTop = oldTop;
      }
      this.applyMessageSearch();
      this.updateNewPill();
    }

    isBubble(message) {
      return !message.type || message.type === "text" || message.type === "attachment";
    }

    messageHTML(message, grouped) {
      if (!message) return "";
      const mine = message.senderType === "boss";
      const member = mine ? this.bossMember() : this.memberFor(message);
      const quote = message.meta && message.meta.quote;
      const attachments = CUI.attachments(message.attachments, this.bridge(), { message: message });
      const actions = this.actionsHTML(message, !!attachments);
      const replyMeta = message.meta && message.meta.chatReply;
      const provider = message.meta && message.meta.provider ? String(message.meta.provider) : "";
      const time = CUI.clock(message.createdAt);
      if (message.senderType === "system" || message.type === "system" ||
          message.type === "mission-created") {
        return '<div class="chat-event" data-msg-id="' + esc(message.id) + '"><span>' +
          esc(CUI.smartTime(message.createdAt)) + "</span><p>" +
          CUI.markdown(String(message.text || "").slice(0, 700)) + "</p></div>";
      }
      if (message.type === "report") return this.reportHTML(message, grouped);
      if (message.type === "proposal") return this.proposalHTML(message, grouped);
      if (message.type === "approval") {
        return '<div class="chat-msg is-card' + (mine ? " mine" : "") + '" data-msg-id="' +
          esc(message.id) + '"><div class="chat-card chat-approval-card"><div class="chat-card-head">' +
          '<span class="chat-card-kicker">APPROVAL</span><b>' + esc(memberName(member)) +
          "</b><time>" + esc(time) + "</time></div>" +
          CUI.markdown(message.text || "") + actions + "</div></div>";
      }
      return '<div class="chat-msg ' + (mine ? "mine" : "theirs") + (grouped ? " grouped" : "") +
        '" data-msg-id="' + esc(message.id) + '">' +
        (grouped ? '<span class="chat-avatar-spacer"></span>' : CUI.avatar(member, { size: 30 })) +
        '<div class="chat-msg-body">' +
        (grouped ? "" : '<div class="chat-msg-head"><b>' + esc(memberName(member)) + "</b>" +
          (replyMeta ? '<span class="chat-ai-chip">AI' + (provider ? " · " + esc(provider.slice(0, 12)) : "") +
            "</span>" : "") + (mine ? "" : '<time>' + esc(time) + "</time>") + "</div>") +
        '<div class="chat-bubble">' + CUI.quoteHTML(quote) +
        CUI.markdown(message.text || "") + attachments + "</div>" +
        '<div class="chat-msg-foot">' + (grouped ? '<time>' + esc(time) + "</time>" :
          '<time>' + esc(time) + "</time>") +
        (mine ? '<span class="chat-delivery" title="' + esc(this.t("chatSent", "已发送")) + '">' +
          icon("check", 12) + "</span>" : "") + actions + "</div></div></div>";
    }

    reportHTML(message, grouped) {
      const report = (message.meta && message.meta.report) || {};
      const member = this.memberFor(message);
      const sections = [
        ["missionDone", report.done],
        ["missionNext", report.next],
        ["missionRisks", report.risks]
      ].filter((row) => row[1] && row[1].length);
      return '<div class="chat-msg is-card" data-msg-id="' + esc(message.id) + '">' +
        CUI.avatar(member, { size: 30 }) +
        '<div class="chat-card chat-report-card"><div class="chat-card-head">' +
        '<span class="chat-card-kicker">REPORT</span><b>' + esc(memberName(member)) +
        "</b><time>" + esc(CUI.clock(message.createdAt)) + "</time>" +
        (this.active && this.active.missionId ? '<button type="button" class="chat-card-link" data-chat-open-mission="' +
          esc(this.active.missionId) + '" title="' + esc(this.t("chatOpenMission", "在任务中心打开")) +
          '">' + icon("external", 14) + "</button>" : "") + "</div>" +
        '<div class="chat-card-summary">' + CUI.markdown(report.summary || message.text || "") + "</div>" +
        (sections.length ? '<div class="chat-report-grid">' + sections.map((row) =>
          '<div class="chat-report-section"><span>' + esc(this.t(row[0])) + "</span>" +
          row[1].map((item) => "<em>" + esc(item) + "</em>").join("") + "</div>").join("") + "</div>" : "") +
        ((report.solution || report.evidence || report.needsBoss) ?
          '<details class="chat-report-details"><summary>' + esc(this.t("chatReportDetails", "查看完整汇报")) +
          "</summary>" + (report.solution ? '<p><b>' + esc(this.t("missionSolution")) + "</b>" +
            esc(report.solution) + "</p>" : "") +
          (report.evidence && report.evidence.length ? '<p><b>' + esc(this.t("missionEvidence")) + "</b>" +
            report.evidence.map((item) => "<code>" + esc(item) + "</code>").join("") + "</p>" : "") +
          (report.needsBoss && report.needsBoss.length ? '<p><b>' + esc(this.t("missionNeedsBoss")) + "</b>" +
            report.needsBoss.map((item) => esc(item)).join(" · ") + "</p>" : "") + "</details>" : "") +
        CUI.attachments(message.attachments, this.bridge()) +
        this.actionsHTML(message, false) + "</div></div>";
    }

    proposalHTML(message, grouped) {
      const proposal = (message.meta && message.meta.proposal) || {};
      const member = this.memberFor(message);
      return '<div class="chat-msg is-card" data-msg-id="' + esc(message.id) + '">' +
        CUI.avatar(member, { size: 30 }) +
        '<div class="chat-card chat-proposal-card"><div class="chat-card-head">' +
        '<span class="chat-card-kicker">PROPOSAL</span><b>' + esc(memberName(member)) +
        "</b><time>" + esc(CUI.clock(message.createdAt)) + "</time></div>" +
        (proposal.topic ? '<p class="chat-card-topic">' + esc(proposal.topic) + "</p>" : "") +
        CUI.markdown(message.text || "") +
        (proposal.option ? '<div class="chat-card-option"><b>' + esc(proposal.option) + "</b>" +
          (proposal.rationale ? "<span>" + esc(proposal.rationale) + "</span>" : "") + "</div>" : "") +
        CUI.attachments(message.attachments, this.bridge()) + this.actionsHTML(message, false) +
        "</div></div>";
    }

    actionsHTML(message, hasAttachments) {
      const copyable = !!(message.text || (message.meta && message.meta.report &&
        message.meta.report.summary));
      return '<div class="chat-msg-actions">' +
        (copyable ? '<button type="button" data-chat-action="copy" data-msg-id="' +
          esc(message.id) + '" title="' + esc(this.t("chatCopy", "复制")) + '" aria-label="' +
          esc(this.t("chatCopy", "复制")) + '">' + icon("copy", 14) + "</button>" : "") +
        (this.isBubble(message) ? '<button type="button" data-chat-action="quote" data-msg-id="' +
          esc(message.id) + '" title="' + esc(this.t("chatQuote", "引用")) + '" aria-label="' +
          esc(this.t("chatQuote", "引用")) + '">' + icon("quote", 14) + "</button>" : "") +
        (this.active && this.active.missionId ? '<button type="button" data-chat-action="mission" data-msg-id="' +
          esc(message.id) + '" title="' + esc(this.t("chatOpenMission", "在任务中心打开")) +
          '" aria-label="' + esc(this.t("chatOpenMission", "在任务中心打开")) + '">' +
          icon("external", 14) + "</button>" : "") + "</div>";
    }

    typingHTML() {
      const members = (this.active && this.active.members) || [];
      const member = members.find(isOnline) || members[0] || { logoText: "AI" };
      return '<div class="chat-typing-row">' + CUI.avatar(member, { size: 26 }) +
        '<div class="chat-typing"><span><i></i><i></i><i></i></span>' +
        esc(this.t("chatAgentTyping", "Agent 正在输入…")) + "</div></div>";
    }

    updateAtBottom(box) {
      this.atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
      if (this.atBottom) {
        this.pendingNew = 0;
        this.updateNewPill();
        if (this.active) this.markRead();
      }
    }

    updateNewPill() {
      const pill = this.root && this.root.querySelector("#chatNewPill");
      if (!pill) return;
      if (this.pendingNew > 0) {
        pill.hidden = false;
        pill.innerHTML = icon("chevron", 14) +
          esc(this.t("chatNewMessages", "{count} 条新消息", { count: this.pendingNew }));
      } else {
        pill.hidden = true;
        pill.innerHTML = "";
      }
    }

    applyMessageSearch() {
      const box = this.messagesBox();
      if (!box) return;
      const query = this.messageQuery.trim().toLowerCase();
      const nodes = Array.from(box.querySelectorAll(".chat-msg, .chat-event, .chat-typing-row"));
      let visible = 0;
      nodes.forEach(function (node) {
        const match = !query || node.textContent.toLowerCase().indexOf(query) >= 0;
        node.classList.toggle("search-hidden", !match);
        if (match) visible += 1;
      });
      box.querySelectorAll(".chat-day").forEach(function (day) {
        day.classList.toggle("search-hidden", !!query);
      });
      const count = this.root && this.root.querySelector("#chatMsgSearchCount");
      if (count) count.textContent = query ? visible + "/" + nodes.length : "";
    }

    toggleMessageSearch(show) {
      this.messageSearchOpen = typeof show === "boolean" ? show : !this.messageSearchOpen;
      const bar = this.root && this.root.querySelector("#chatMsgSearch");
      if (!bar) return;
      bar.hidden = !this.messageSearchOpen;
      if (this.messageSearchOpen) {
        const input = bar.querySelector("input");
        if (input) {
          input.focus();
          input.select();
        }
      } else {
        this.messageQuery = "";
        const input = bar.querySelector("input");
        if (input) input.value = "";
        this.applyMessageSearch();
      }
    }

    /* -------------------------------------------------------------- detail */

    async renderDetails() {
      const panel = this.root && this.root.querySelector("#chatDetails");
      if (!panel || !this.active) return;
      const conversation = this.active;
      const members = conversation.members || [];
      panel.innerHTML = '<div class="chat-details-head"><div><span class="chat-eyebrow">CONVERSATION</span>' +
        "<h3>" + esc(conversation.kind === "direct" ? this.t("chatDirectTitle", "私聊") :
          this.t("chatGroupTitle", "群聊")) + '</h3></div><button type="button" class="chat-icon-btn small" data-chat-info-toggle aria-label="' +
        esc(this.t("chatClose", "关闭")) + '">' + icon("close", 15) + "</button></div>" +
        '<div class="chat-details-members"><span class="chat-details-label">' + esc(this.t("chatMembers", "成员")) +
        "</span>" + members.map((member) =>
          '<div class="chat-detail-member">' + CUI.avatar(member, { size: 30 }) +
          '<span><b>' + esc(memberName(member)) + '</b><em>' +
          esc(roleName(member)) + '</em></span><i class="chat-presence ' +
          (isOnline(member) ? "online" : "") + '"></i></div>').join("") + "</div>" +
        '<div class="chat-details-meta"><span class="chat-details-label">' + esc(this.t("chatInfo", "信息")) +
        "</span><div><span>" + esc(this.t("chatCreated", "创建")) + "</span><b>" +
        esc(CUI.smartTime(conversation.createdAt)) + "</b></div><div><span>" +
        esc(this.t("chatMessagesCount", "消息")) + "</span><b>" +
        Number(conversation.messageCount || 0) + "</b></div>" +
        (conversation.missionId ? '<div><span>' + esc(this.t("chatMission", "任务")) +
          '</span><button type="button" class="chat-inline-link" data-chat-open-mission="' +
          esc(conversation.missionId) + '">' + esc(this.t("chatOpenMission", "打开任务")) + "</button></div>" : "") +
        "</div>" +
        '<div class="chat-details-files"><div class="chat-details-files-head"><span class="chat-details-label">' +
        esc(this.t("chatFiles", "文件")) + '</span><button type="button" class="chat-icon-btn small" data-chat-files-refresh aria-label="' +
        esc(this.t("chatRefresh", "刷新")) + '">' + icon("download", 14) + "</button></div>" +
        (this.detailsFiles.length ? this.detailsFiles.map((file) =>
          '<a class="chat-detail-file" href="' + esc(CUI.rawFileUrl(this.bridge(), file)) +
          '" target="_blank" rel="noopener noreferrer" download="' + esc(file.name) + '">' +
          icon(file.kind === "image" ? "sparkle" : "file", 14) + "<span>" + esc(file.name) +
          "</span><em>" + esc(CUI.fmtSize(file.size)) + "</em></a>").join("") :
          '<p class="chat-details-empty">' + esc(this.t("chatNoFiles", "这个会话还没有文件")) + "</p>") +
        "</div>";
      await this.loadDetailsFiles();
    }

    async loadDetailsFiles() {
      if (!this.active) return;
      try {
        const data = await this.api("/files?conversationId=" + encodeURIComponent(this.active.id));
        this.detailsFiles = data.artifacts || [];
        const panel = this.root && this.root.querySelector("#chatDetails");
        if (!panel) return;
        const wrap = panel.querySelector(".chat-details-files");
        if (!wrap) return;
        const files = wrap.querySelectorAll(".chat-detail-file, .chat-details-empty");
        files.forEach((node) => node.remove());
        wrap.insertAdjacentHTML("beforeend", this.detailsFiles.length ?
          this.detailsFiles.map((file) =>
            '<a class="chat-detail-file" href="' + esc(CUI.rawFileUrl(this.bridge(), file)) +
            '" target="_blank" rel="noopener noreferrer" download="' + esc(file.name) + '">' +
            icon(file.kind === "image" ? "sparkle" : "file", 14) + "<span>" + esc(file.name) +
            "</span><em>" + esc(CUI.fmtSize(file.size)) + "</em></a>").join("") :
          '<p class="chat-details-empty">' + esc(this.t("chatNoFiles", "这个会话还没有文件")) + "</p>");
      } catch (err) {}
    }

    /* ------------------------------------------------------------ messages */

    async openConversation(id, options) {
      if (!id) return;
      this.closeMenus();
      this.captureDraft();
      this.stopPoll();
      try {
        const res = await this.api("/conversations/" + encodeURIComponent(id));
        const conversation = res.conversation;
        if (!conversation || !this.root || this.root.hidden) return;
        this.active = conversation;
        this.view = "chat";
        this.messages = [];
        this.lastSeq = 0;
        this.files = [];
        this.replyTo = null;
        this.replyPending = false;
        if (this.replyTimer) window.clearTimeout(this.replyTimer);
        this.replyTimer = null;
        this.replySeq = 0;
        this.messageQuery = "";
        this.messageSearchOpen = false;
        this.atBottom = true;
        this.pendingNew = 0;
        this.detailsFiles = [];
        this.detailsOpen = false;
        if (this.root) this.root.classList.add("chat-show-main");
        this.renderMain(true);
        this.renderConversationList();
        this.loadingMessages = true;
        const data = await this.api("/conversations/" + encodeURIComponent(id) + "/messages");
        if (!this.active || this.active.id !== id || !this.root || this.root.hidden) return;
        this.messages = data.messages || [];
        if (this.active) this.active.messageCount = this.messages.length;
        this.lastSeq = Number(data.lastSeq || (this.messages.length ?
          this.messages[this.messages.length - 1].seq : 0)) || 0;
        this.loadingMessages = false;
        this.renderMessages(true);
        this.markRead();
        this.startPoll();
        this.startStream();
        if (window.innerWidth > 760) {
          const input = this.root && this.root.querySelector("#chatDraft");
          if (input) {
            try { input.focus({ preventScroll: true }); } catch (err) {}
          }
        }
      } catch (err) {
        this.loadingMessages = false;
        this.toast(this.t("chatError"));
        this.renderMessages(true);
        if (this.active) this.startPoll();
      }
    }

    async ensureDirect(agentId) {
      try {
        const existing = this.conversations.find((conversation) =>
          conversation.kind === "direct" &&
          (conversation.members || []).some((member) => member.id === agentId));
        if (existing) {
          await this.openConversation(existing.id);
          return;
        }
        const res = await this.api("/conversations", {
          method: "POST",
          body: JSON.stringify({ kind: "direct", memberIds: [agentId] })
        });
        if (res.conversation) {
          this.conversations.unshift(res.conversation);
          this.renderConversationList();
          await this.openConversation(res.conversation.id);
        }
      } catch (err) {
        this.toast(this.t("chatError"));
      }
    }

    async createGroup(form) {
      const data = new FormData(form);
      const title = String(data.get("title") || "").trim();
      const memberIds = Array.from(form.querySelectorAll('input[name="memberIds"]:checked'))
        .map((input) => input.value);
      if (!title || !memberIds.length) {
        this.toast(this.t("chatGroupValidation", "群名称和成员不能为空"));
        return;
      }
      const submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const res = await this.api("/conversations", {
          method: "POST",
          body: JSON.stringify({ kind: "group", title, memberIds })
        });
        if (res.conversation) {
          this.conversations.unshift(res.conversation);
          this.view = "welcome";
          this.renderConversationList();
          await this.openConversation(res.conversation.id);
          this.toast(this.t("chatGroupCreated", "群聊已创建"));
        }
      } catch (err) {
        if (submit) submit.disabled = false;
        this.toast(this.t("chatError"));
      }
    }

    /* --------------------------------------------------------------- send */

    async uploadFile(file) {
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
            "X-Mission-Id": (this.active && this.active.missionId) || "",
            "X-Conversation-Id": (this.active && this.active.id) || "",
            "X-Uploaded-By": "boss"
          },
          body: file
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ("upload " + res.status));
        return data.artifact;
      } finally {
        window.clearTimeout(timer);
      }
    }

    async handleFiles(files) {
      if (!this.active || !files.length) return;
      const room = MAX_FILES - this.files.length;
      if (room <= 0) {
        this.toast(this.t("chatTooManyFiles", "最多同时发送 6 个文件"));
        return;
      }
      const accepted = [];
      files.slice(0, room).forEach((file) => {
        if (file.size > MAX_FILE_BYTES) {
          this.toast(this.t("chatFileTooLarge", "单个文件不能超过 25 MB"));
          return;
        }
        accepted.push(file);
      });
      if (!accepted.length) return;
      accepted.forEach((file) => {
        this.files.push({
          id: "upload-" + Math.random().toString(36).slice(2),
          name: file.name,
          size: file.size,
          mime: file.type,
          uploading: true
        });
      });
      this.renderPendingFiles();
      for (let index = 0; index < accepted.length; index += 1) {
        const file = accepted[index];
        const placeholder = this.files.find((row) => row.uploading && row.name === file.name && row.size === file.size);
        try {
          const artifact = await this.uploadFile(file);
          const at = this.files.indexOf(placeholder);
          if (at >= 0) this.files[at] = artifact;
        } catch (err) {
          const at = this.files.indexOf(placeholder);
          if (at >= 0) this.files.splice(at, 1);
          this.toast(this.t("chatUploadFailed", "上传失败：{name}", { name: file.name }));
        }
        this.renderPendingFiles();
      }
    }

    renderPendingFiles() {
      const box = this.root && this.root.querySelector("#chatPendingFiles");
      const composer = this.root && this.root.querySelector(".chat-composer-wrap");
      if (!box && composer) {
        if (!this.files.length) return;
        const html = '<div class="chat-pending-files" id="chatPendingFiles">' +
          this.files.map((file, index) => this.pendingFileHTML(file, index)).join("") + "</div>";
        composer.insertAdjacentHTML("afterbegin", html);
      } else if (box) {
        box.innerHTML = this.files.map((file, index) => this.pendingFileHTML(file, index)).join("");
        if (!this.files.length) box.remove();
      }
      this.updateComposerState();
    }

    insertAtCursor(text) {
      const input = this.root && this.root.querySelector("#chatDraft");
      if (!input) return;
      const start = typeof input.selectionStart === "number" ? input.selectionStart : input.value.length;
      const end = typeof input.selectionEnd === "number" ? input.selectionEnd : start;
      input.value = input.value.slice(0, start) + text + input.value.slice(end);
      const cursor = start + text.length;
      try { input.setSelectionRange(cursor, cursor); } catch (err) {}
      input.focus();
      if (this.active) {
        this.drafts[this.active.id] = input.value;
        this.saveDrafts();
      }
      this.updateComposerState();
    }

    updateComposerState() {
      const input = this.root && this.root.querySelector("#chatDraft");
      const button = this.root && this.root.querySelector("#chatSendBtn");
      const count = this.root && this.root.querySelector("#chatCharCount");
      const value = input ? input.value : "";
      const hasFiles = this.files.some((file) => !file.uploading);
      if (button) button.disabled = this.sending || (!value.trim() && !hasFiles);
      if (count) count.textContent = value.length > 2800 ? value.length + "/8000" : "";
    }

    async sendText(value) {
      const text = String(value || "").trim();
      if (!this.active) {
        this.toast(this.t("chatPickConversation", "请先打开一个群聊或单聊"));
        return false;
      }
      if (this.files.some((file) => file.uploading)) {
        this.toast(this.t("chatWaitUpload", "文件还在上传，请稍候"));
        return false;
      }
      const attachments = this.files.filter((file) => !file.uploading && file.id &&
        !String(file.id).startsWith("upload-"));
      if (!text && !attachments.length) return false;
      if (this.sending) return false;
      this.sending = true;
      this.updateComposerState();
      const quote = this.replyTo;
      try {
        const res = await this.api("/conversations/" + encodeURIComponent(this.active.id) + "/messages", {
          method: "POST",
          body: JSON.stringify({
            senderId: "boss",
            senderType: "boss",
            type: "text",
            text,
            attachmentIds: attachments.map((file) => file.id),
            meta: quote ? { quote: quote } : {}
          })
        });
        this.sending = false;
        if (!this.active || !this.root || this.root.hidden) return true;
        if (this.active) {
          this.drafts[this.active.id] = "";
          this.saveDrafts();
        }
        const currentInput = this.root && this.root.querySelector("#chatDraft");
        if (currentInput) currentInput.value = "";
        this.files = [];
        this.replyTo = null;
        if (!this.messages.some((message) => message.id === res.message.id)) {
          this.messages.push(res.message);
        }
        this.lastSeq = Math.max(this.lastSeq, Number(res.message.seq) || 0);
        if (this.active) {
          this.active.readSeq = this.lastSeq;
          this.active.lastSeq = this.lastSeq;
          this.active.updatedAt = res.message.createdAt || new Date().toISOString();
          this.active.lastMessage = {
            id: res.message.id, seq: res.message.seq, text: res.message.text,
            senderId: "boss", senderName: res.message.senderName, senderType: "boss",
            type: res.message.type, attachmentCount: (res.message.attachments || []).length,
            createdAt: res.message.createdAt
          };
          const row = this.conversations.find((item) => item.id === this.active.id);
          if (row) Object.assign(row, this.active);
        }
        const repliedEarly = this.messages.some((message) =>
          message.senderType === "agent" && message.meta && message.meta.chatReply &&
          Number(message.seq) > Number(res.message.seq));
        if (res.replyPending && !repliedEarly) {
          this.replyPending = true;
          this.replySeq = Number(res.message.seq) || 0;
          if (this.replyTimer) window.clearTimeout(this.replyTimer);
          this.replyTimer = window.setTimeout(() => {
            this.replyPending = false;
            this.replyTimer = null;
            this.renderMessages(false);
          }, 90000);
        } else {
          this.replyPending = false;
        }
        this.renderMain();
        this.renderConversationList();
        const input = this.root && this.root.querySelector("#chatDraft");
        if (input) {
          try { input.focus({ preventScroll: true }); } catch (err) {}
        }
        this.markRead();
        this.refreshConversations();
        return true;
      } catch (err) {
        this.sending = false;
        this.updateComposerState();
        this.toast(this.t("chatError"));
        return false;
      }
    }

    /* -------------------------------------------------------------- draft */

    captureDraft() {
      if (!this.active) return;
      const input = this.root && this.root.querySelector("#chatDraft");
      if (!input) return;
      this.drafts[this.active.id] = input.value;
      this.saveDrafts();
    }

    saveDrafts() {
      const self = this;
      if (this.draftTimer) window.clearTimeout(this.draftTimer);
      this.draftTimer = window.setTimeout(function () { writeDrafts(self.drafts); }, 250);
    }

    onInput(event) {
      const target = event.target;
      if (target.id === "chatConvSearch") {
        this.search = target.value;
        this.renderConversationList();
        return;
      }
      if (target.id === "chatMsgSearchInput") {
        this.messageQuery = target.value;
        this.applyMessageSearch();
        return;
      }
      if (target.id === "chatDraft") {
        if (this.active) {
          this.drafts[this.active.id] = target.value;
          this.saveDrafts();
        }
        this.autoGrow(target);
        this.updateComposerState();
        this.detectMention(target);
      }
    }

    autoGrow(input) {
      input.style.height = "auto";
      input.style.height = Math.min(150, Math.max(42, input.scrollHeight)) + "px";
    }

    detectMention(input) {
      if (!this.active || this.active.kind !== "group") {
        return this.hideMention();
      }
      const before = input.value.slice(0, input.selectionStart || 0);
      const match = before.match(/(^|[\s\n])@([^\s@]*)$/);
      if (!match) return this.hideMention();
      const query = match[2].toLowerCase();
      const members = (this.active.members || []).filter((member) => {
        const name = memberName(member).toLowerCase();
        return !query || name.indexOf(query) >= 0;
      });
      if (!members.length) return this.hideMention();
      this.mention = {
        start: (input.selectionStart || 0) - query.length - 1,
        end: input.selectionStart || 0,
        items: members,
        index: 0
      };
      this.renderMentionMenu();
    }

    renderMentionMenu() {
      const menu = this.root && this.root.querySelector("#chatMentionMenu");
      if (!menu || !this.mention) return;
      menu.hidden = false;
      menu.innerHTML = this.mention.items.map((member, index) =>
        '<button type="button" data-chat-mention-index="' + index + '" class="' +
        (index === this.mention.index ? "active" : "") + '">' + CUI.avatar(member, { size: 24 }) +
        "<span>" + esc(memberName(member)) + "</span><em>" +
        esc(roleName(member)) + "</em></button>").join("");
    }

    hideMention() {
      this.mention = null;
      const menu = this.root && this.root.querySelector("#chatMentionMenu");
      if (menu) { menu.hidden = true; menu.innerHTML = ""; }
    }

    insertMention(index) {
      if (!this.mention) return;
      const member = this.mention.items[index];
      if (!member) return;
      const input = this.root && this.root.querySelector("#chatDraft");
      if (!input) return;
      const start = this.mention.start;
      const end = input.selectionStart || this.mention.end;
      input.value = input.value.slice(0, start) + "@" + memberName(member) + " " +
        input.value.slice(end);
      const cursor = start + memberName(member).length + 2;
      try { input.setSelectionRange(cursor, cursor); } catch (err) {}
      if (this.active) {
        this.drafts[this.active.id] = input.value;
        this.saveDrafts();
      }
      this.hideMention();
      this.updateComposerState();
      input.focus();
    }

    /* --------------------------------------------------------------- read */

    markRead() {
      if (!this.active || !this.lastSeq) return;
      if (Number(this.active.readSeq || 0) >= this.lastSeq) return;
      const id = this.active.id;
      const seq = this.lastSeq;
      this.active.readSeq = seq;
      this.active.unreadCount = 0;
      const row = this.conversations.find((item) => item.id === id);
      if (row) { row.readSeq = seq; row.unreadCount = 0; }
      this.renderConversationList();
      if (this.readTimer) window.clearTimeout(this.readTimer);
      this.readTimer = window.setTimeout(async () => {
        try {
          const res = await this.api("/conversations/" + encodeURIComponent(id), {
            method: "PATCH",
            body: JSON.stringify({ readSeq: seq })
          });
          if (res.conversation) {
            const fresh = this.conversations.find((item) => item.id === id);
            if (fresh) Object.assign(fresh, res.conversation);
            if (this.active && this.active.id === id) {
              Object.assign(this.active, res.conversation);
            }
            this.renderConversationList();
          }
        } catch (err) {}
      }, 280);
    }

    /* --------------------------------------------------------------- poll */

    startStream() {
      if (typeof EventSource === "undefined" || this.eventStream) return;
      const streamParams = new URLSearchParams(window.location.search);
      if (streamParams.get("noStream") === "1" &&
          streamParams.get("chatStream") !== "1") return;
      const self = this;
      const since = this.active ? Number(this.lastSeq || 0) :
        Math.max(0, ...this.conversations.map((row) => Number(row.lastSeq || 0)));
      try {
        this.eventStream = new EventSource(this.bridge() +
          "/missions/stream?since=" + encodeURIComponent(since));
        this.eventStream.addEventListener("message", function (event) {
          let message = null;
          try { message = JSON.parse(event.data || "{}"); } catch (err) {}
          if (!message) return;
          if (self.active && message.conversationId === self.active.id) {
            self.loadMessages(false);
          }
          self.queueStreamRefresh();
        });
        this.eventStream.addEventListener("overview", function () {
          self.queueStreamRefresh();
        });
        this.eventStream.onerror = function () {};
      } catch (err) {
        this.eventStream = null;
      }
    }

    stopStream() {
      if (this.eventStream) {
        try { this.eventStream.close(); } catch (err) {}
      }
      this.eventStream = null;
      if (this.streamRefreshTimer) {
        window.clearTimeout(this.streamRefreshTimer);
        this.streamRefreshTimer = null;
      }
    }

    queueStreamRefresh() {
      if (this.streamRefreshTimer) return;
      const self = this;
      this.streamRefreshTimer = window.setTimeout(function () {
        self.streamRefreshTimer = null;
        if (self.root && !self.root.hidden) self.refreshConversations();
      }, 120);
    }

    startPoll() {
      this.stopPoll();
      const self = this;
      this.timer = window.setInterval(function () {
        if (self.active && !document.hidden) self.loadMessages(false);
      }, 3000);
    }

    stopPoll() {
      if (this.timer) window.clearInterval(this.timer);
      this.timer = null;
    }

    async loadMessages(scroll) {
      if (!this.active || this.loading) return;
      this.loading = true;
      const id = this.active.id;
      const since = this.lastSeq;
      try {
        const data = await this.api("/conversations/" + encodeURIComponent(id) +
          "/messages" + (since ? "?since=" + since : ""));
        if (!this.active || this.active.id !== id) return;
        const rows = data.messages || [];
        let added = 0;
        rows.forEach((message) => {
          if (this.messages.some((item) => item.id === message.id)) return;
          this.messages.push(message);
          added += 1;
        });
        this.lastSeq = Math.max(this.lastSeq, Number(data.lastSeq || 0),
          ...rows.map((message) => Number(message.seq) || 0));
        if (this.active) this.active.messageCount = this.messages.length;
        if (rows.some((message) => message.senderType === "agent" &&
          message.meta && message.meta.chatReply && Number(message.seq) > this.replySeq)) {
          this.clearReplyPending();
        }
        if (added || scroll) {
          const wasBottom = this.atBottom || scroll;
          this.renderMessages(!!scroll);
          this.atBottom = wasBottom;
          if (!wasBottom) this.pendingNew += rows.filter((message) =>
            message.senderType !== "boss").length;
          this.updateNewPill();
          if (this.atBottom) this.markRead();
        }
        if (!this.messages.length) this.renderMessages(true);
      } catch (err) {
        if (!this.messages.length) {
          const box = this.messagesBox();
          if (box) box.innerHTML = '<div class="chat-empty error">' + esc(this.t("chatError")) + "</div>";
        }
      } finally {
        this.loading = false;
      }
    }

    clearReplyPending() {
      this.replyPending = false;
      this.replySeq = 0;
      if (this.replyTimer) window.clearTimeout(this.replyTimer);
      this.replyTimer = null;
      this.renderMessages(false);
    }

    /* -------------------------------------------------------------- click */

    onClick(event) {
      const target = event.target;
      if (target.closest("[data-chat-close]")) { this.close(); return; }
      if (target.closest("[data-chat-dialog-close]")) { this.closeRenameDialog(); return; }
      if (target.closest("[data-chat-sidebar-back]")) {
        if (this.root) this.root.classList.remove("chat-show-main");
        return;
      }
      const filter = target.closest("[data-chat-filter]");
      if (filter) {
        this.filter = filter.getAttribute("data-chat-filter") || "all";
        this.root.querySelectorAll("[data-chat-filter]").forEach((node) => {
          const active = node.getAttribute("data-chat-filter") === this.filter;
          node.classList.toggle("active", active);
          node.setAttribute("aria-selected", active ? "true" : "false");
        });
        this.renderConversationList();
        return;
      }
      const menuButton = target.closest("[data-chat-conv-menu]");
      if (menuButton) {
        event.preventDefault();
        event.stopPropagation();
        this.showConversationMenu(menuButton.getAttribute("data-chat-conv-menu"), menuButton);
        return;
      }
      const row = target.closest("[data-chat-conv]");
      if (row) {
        this.openConversation(row.getAttribute("data-chat-conv"));
        return;
      }
      const agent = target.closest("[data-chat-agent]");
      if (agent) {
        this.ensureDirect(agent.getAttribute("data-chat-agent"));
        return;
      }
      if (target.closest("[data-chat-new-group]")) {
        this.captureDraft();
        this.view = "new-group";
        if (this.root) this.root.classList.add("chat-show-main");
        this.renderMain();
        return;
      }
      if (target.closest("[data-chat-new-direct]")) {
        this.filter = "direct";
        this.renderSidebar();
        const search = this.root.querySelector("#chatConvSearch");
        if (search) search.focus();
        return;
      }
      if (target.closest("[data-chat-cancel-new]")) {
        this.view = this.active ? "chat" : "welcome";
        if (this.active && this.root) this.root.classList.add("chat-show-main");
        if (!this.active && this.root) this.root.classList.remove("chat-show-main");
        this.renderMain();
        return;
      }
      if (target.closest("[data-chat-style-toggle]")) {
        const current = readStyle();
        const next = current === "agent" ? "qq" : current === "qq" ? "wechat" : "agent";
        writeStyle(next);
        this.toast(this.t("chatStyleChanged", "聊天窗口风格 · {style}", { style: next.toUpperCase() }));
        return;
      }
      if (target.closest("[data-chat-maximize]")) {
        this.maximized = !this.maximized;
        this.section().classList.toggle("is-max", this.maximized);
        const button = target.closest("[data-chat-maximize]");
        button.innerHTML = icon(this.maximized ? "restore" : "maximize", 17);
        button.setAttribute("aria-label", this.maximized ? this.t("chatRestore", "还原窗口") :
          this.t("chatMaximize", "最大化"));
        return;
      }
      if (target.closest("[data-chat-info-toggle]")) {
        this.detailsOpen = !this.detailsOpen;
        this.renderMain();
        return;
      }
      if (target.closest("[data-chat-search-toggle]")) {
        this.toggleMessageSearch(true);
        return;
      }
      if (target.closest("[data-chat-search-close]")) {
        this.toggleMessageSearch(false);
        return;
      }
      if (target.closest("[data-chat-new]")) {
        const box = this.messagesBox();
        if (box) box.scrollTop = box.scrollHeight;
        this.atBottom = true;
        this.pendingNew = 0;
        this.updateNewPill();
        this.markRead();
        return;
      }
      if (target.closest("[data-chat-attach]")) {
        const input = this.root.querySelector("#chatFileInput");
        if (input) input.click();
        return;
      }
      if (target.closest("[data-chat-emoji-toggle]")) {
        this.emojiOpen = !this.emojiOpen;
        const pop = this.root.querySelector("#chatEmojiPop");
        if (pop) pop.hidden = !this.emojiOpen;
        return;
      }
      const emoji = target.closest("[data-chat-emoji]");
      if (emoji) {
        this.insertAtCursor(emoji.getAttribute("data-chat-emoji") || "");
        this.emojiOpen = false;
        const pop = this.root.querySelector("#chatEmojiPop");
        if (pop) pop.hidden = true;
        return;
      }
      if (target.closest("[data-chat-mention]")) {
        this.insertAtCursor("@");
        const input = this.root.querySelector("#chatDraft");
        if (input) this.detectMention(input);
        return;
      }
      const mention = target.closest("[data-chat-mention-index]");
      if (mention) {
        this.insertMention(Number(mention.getAttribute("data-chat-mention-index")));
        return;
      }
      const fileRemove = target.closest("[data-chat-file-remove]");
      if (fileRemove) {
        const index = Number(fileRemove.getAttribute("data-chat-file-remove"));
        this.files.splice(index, 1);
        this.renderPendingFiles();
        return;
      }
      if (target.closest("[data-chat-quote-close]")) {
        this.replyTo = null;
        this.renderMain();
        return;
      }
      const action = target.closest("[data-chat-action]");
      if (action) {
        this.messageAction(action.getAttribute("data-chat-action"), action.getAttribute("data-msg-id"));
        return;
      }
      if (target.closest("[data-chat-files-refresh]")) {
        this.loadDetailsFiles();
        return;
      }
      const mission = target.closest("[data-chat-open-mission]");
      if (mission) {
        this.openMission(mission.getAttribute("data-chat-open-mission"));
        return;
      }
      const convAction = target.closest("[data-chat-conv-action]");
      if (convAction) {
        this.conversationAction(convAction.getAttribute("data-chat-conv-action"),
          convAction.getAttribute("data-chat-id"));
        return;
      }
      if (target.closest("[data-chat-picker-close]")) {
        this.close();
        return;
      }
      if (!target.closest("#chatPopover") && !target.closest("[data-chat-conv-menu]") &&
          !target.closest("#chatDialog")) {
        this.closeMenus();
      }
    }

    onKeydown(event) {
      const target = event.target;
      if (target && target.id === "chatConvSearch") {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          target.value = "";
          this.search = "";
          this.renderConversationList();
          target.blur();
        }
        if (event.key === "ArrowDown") {
          const first = this.root.querySelector("[data-chat-conv]");
          if (first) { event.preventDefault(); first.focus(); }
        }
        return;
      }
      if (target && target.matches && target.matches("[data-chat-conv]")) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.openConversation(target.getAttribute("data-chat-conv"));
        }
        return;
      }
      if (target && target.id === "chatMsgSearchInput") {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.toggleMessageSearch(false);
        }
        return;
      }
      if (target && target.id === "chatDraft") {
        if (this.mention) {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const count = this.mention.items.length;
            this.mention.index = (this.mention.index + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
            this.renderMentionMenu();
            return;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            this.insertMention(this.mention.index);
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            this.hideMention();
            return;
          }
        }
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          this.sendText(target.value);
        }
      }
    }

    messageAction(action, id) {
      const message = this.messages.find((item) => item.id === id);
      if (!message) return;
      if (action === "copy") {
        CUI.copyText((message.meta && message.meta.report && message.meta.report.summary) ||
          message.text || "").then(() => this.toast(this.t("chatCopied", "已复制"))).catch(() => {});
        return;
      }
      if (action === "quote") {
        const member = message.senderType === "boss" ? this.bossMember() : this.memberFor(message);
        this.replyTo = {
          id: message.id,
          senderName: memberName(member),
          text: (message.meta && message.meta.report && message.meta.report.summary) ||
            message.text || "",
          createdAt: message.createdAt
        };
        this.renderMain();
        this.markRead();
        return;
      }
      if (action === "mission" && this.active && this.active.missionId) {
        this.openMission(this.active.missionId);
      }
    }

    async openMission(missionId) {
      if (!missionId) return;
      const missions = this.renderer && this.renderer.missions;
      this.close();
      if (!missions) return;
      await missions.open();
      if (missions.selectMission) await missions.selectMission(missionId);
    }

    openRenameDialog(row) {
      if (!row || !this.section()) return;
      this.closeRenameDialog();
      this.renameId = row.id;
      const current = row.kind === "direct" ? memberName((row.members || [])[0]) : groupTitle(row);
      const layer = document.createElement("div");
      layer.className = "chat-dialog-layer";
      layer.id = "chatDialog";
      layer.innerHTML = '<div class="chat-dialog-backdrop" data-chat-dialog-close></div>' +
        '<form class="chat-dialog" id="chatRenameForm">' +
        '<div class="chat-dialog-head"><div><span class="chat-eyebrow">RENAME</span><h3>' +
        esc(this.t("chatRenameTitle", "重命名会话")) + "</h3></div>" +
        '<button type="button" class="chat-icon-btn small" data-chat-dialog-close aria-label="' +
        esc(this.t("chatClose", "关闭")) + '">' + icon("close", 15) + "</button></div>" +
        '<label class="chat-field"><span>' + esc(this.t("chatRenamePrompt", "输入新的会话名称")) +
        '</span><input name="title" maxlength="120" value="' + esc(current) + '" autocomplete="off" /></label>' +
        '<footer class="chat-form-foot"><button type="button" class="chat-secondary" data-chat-dialog-close>' +
        esc(this.t("chatCancel", "取消")) + '</button><button type="submit" class="chat-primary">' +
        esc(this.t("chatRenameSave", "保存")) + "</button></footer></form>";
      this.section().appendChild(layer);
      const input = layer.querySelector("input");
      if (input) {
        try { input.focus({ preventScroll: true }); input.select(); } catch (err) {}
      }
    }

    closeRenameDialog() {
      const layer = this.root && this.root.querySelector("#chatDialog");
      if (layer) layer.remove();
      this.renameId = "";
    }

    async saveRename(form) {
      const id = this.renameId;
      const title = String(form.elements.title.value || "").trim();
      if (!id || !title) return;
      const row = this.conversations.find((item) => item.id === id);
      if (!row) { this.closeRenameDialog(); return; }
      try {
        const res = await this.api("/conversations/" + encodeURIComponent(id), {
          method: "PATCH", body: JSON.stringify({ title: title })
        });
        if (res.conversation) {
          Object.assign(row, res.conversation);
          if (this.active && this.active.id === id) Object.assign(this.active, res.conversation);
          this.renderConversationList();
          if (this.active && this.active.id === id) this.renderMain();
          this.closeRenameDialog();
          this.toast(this.t("chatRenamed", "会话已重命名"));
        }
      } catch (err) {
        this.toast(this.t("chatRenameFailed", "重命名失败"));
      }
    }

    showConversationMenu(id, anchor) {
      const row = this.conversations.find((item) => item.id === id);
      if (!row) return;
      const popover = this.root.querySelector("#chatPopover");
      if (!popover) return;
      this.menuId = id;
      this.deleteArmed = "";
      popover.hidden = false;
      popover.innerHTML = '<button type="button" data-chat-conv-action="pin" data-chat-id="' + esc(id) + '">' +
        icon(row.pinned ? "pin" : "pin", 15) + "<span>" +
        esc(row.pinned ? this.t("chatUnpin", "取消固定") : this.t("chatPin", "固定会话")) + "</span></button>" +
        '<button type="button" data-chat-conv-action="mute" data-chat-id="' + esc(id) + '">' +
        icon(row.muted ? "bell" : "bellOff", 15) + "<span>" +
        esc(row.muted ? this.t("chatUnmute", "恢复提醒") : this.t("chatMute", "静音会话")) + "</span></button>" +
        (!row.missionId ? '<button type="button" class="danger" data-chat-conv-action="delete" data-chat-id="' +
          esc(id) + '">' + icon("trash", 15) + "<span>" + esc(this.t("chatDelete", "删除会话")) +
          "</span></button>" : "") +
        (row.kind === "group" ? '<button type="button" data-chat-conv-action="rename" data-chat-id="' +
          esc(id) + '">' + icon("quote", 15) + "<span>" + esc(this.t("chatRename", "重命名")) +
          "</span></button>" : "");
      const rect = anchor.getBoundingClientRect();
      const width = 188;
      const height = 172;
      const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.left - width + 24));
      const top = Math.min(window.innerHeight - height - 12, Math.max(12, rect.bottom + 4));
      popover.style.left = left + "px";
      popover.style.top = top + "px";
    }

    async conversationAction(action, id) {
      const row = this.conversations.find((item) => item.id === id);
      if (!row) return;
      if (action === "delete") {
        if (this.deleteArmed !== id) {
          this.deleteArmed = id;
          const button = this.root.querySelector('[data-chat-conv-action="delete"]');
          if (button) {
            button.classList.add("danger");
            button.querySelector("span").textContent = this.t("chatDeleteConfirm", "再点一次确认删除");
          }
          return;
        }
        try {
          await this.api("/conversations/" + encodeURIComponent(id), { method: "DELETE" });
          this.conversations = this.conversations.filter((item) => item.id !== id);
          if (this.active && this.active.id === id) {
            this.active = null;
            this.view = "welcome";
            this.messages = [];
            if (this.root) this.root.classList.remove("chat-show-main");
            this.renderMain();
          }
          this.closeMenus();
          this.renderConversationList();
          this.toast(this.t("chatDeleted", "会话已删除"));
        } catch (err) {
          this.toast(this.t("chatDeleteFailed", "删除会话失败"));
        }
        return;
      }
      if (action === "rename") {
        this.closeMenus();
        this.openRenameDialog(row);
        return;
      }
      const patch = action === "pin" ? { pinned: !row.pinned } :
        action === "mute" ? { muted: !row.muted } : null;
      if (!patch) return;
      try {
        const res = await this.api("/conversations/" + encodeURIComponent(id), {
          method: "PATCH", body: JSON.stringify(patch)
        });
        if (res.conversation) {
          Object.assign(row, res.conversation);
          if (this.active && this.active.id === id) Object.assign(this.active, res.conversation);
          this.closeMenus();
          this.renderConversationList();
          this.toast(action === "pin" ? (row.pinned ? this.t("chatPinned", "已固定") : this.t("chatUnpinned", "已取消固定")) :
            (row.muted ? this.t("chatMuted", "已静音") : this.t("chatUnmuted", "已恢复提醒")));
        }
      } catch (err) {
        this.toast(this.t("chatError"));
      }
    }
  }

  AO.ChatHub = ChatHub;
})();
