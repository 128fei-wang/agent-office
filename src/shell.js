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

  const DENSITY_KEY = "agent-office.density.v1";

  function readDensity() {
    try {
      return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
    } catch (err) {
      return "comfortable";
    }
  }

  function applyDensity(value) {
    const density = value === "compact" ? "compact" : "comfortable";
    document.documentElement.dataset.density = density;
    try { localStorage.setItem(DENSITY_KEY, density); } catch (err) {}
    return density;
  }

  applyDensity(readDensity());

  const MODAL_SELECTOR = [
    ".feature-modal-root:not([hidden])",
    ".guide-modal-root:not([hidden])",
    ".external-modal:not([hidden])",
    ".mission-lab:not([hidden])",
    ".update-modal:not([hidden])",
    ".ai-setup-root:not([hidden])",
    ".company-lab:not([hidden])",
    ".trace-lab:not([hidden])",
    ".command-root:not([hidden])",
    ".chat-window",
    "#detailDrawer.open"
  ].join(", ");

  function syncAppInert() {
    const app = document.getElementById("app");
    if (app) app.inert = !!document.querySelector(MODAL_SELECTOR);
  }

  function focusable(root) {
    return Array.from(root.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (node) {
      return node.offsetParent !== null;
    });
  }

  function trapTab(root, event) {
    if (event.key !== "Tab") return;
    const nodes = focusable(root);
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

  const ChatHub = AO.ChatHub;

  class FeatureDrawer {
    constructor(renderer, deps, shell) {
      this.renderer = renderer;
      this.deps = deps || {};
      this.shell = shell;
      this.root = document.getElementById("featureDrawer");
      this.backdrop = document.getElementById("featureDrawerBackdrop");
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
      const realMode = AO.DemoMode && !AO.DemoMode.enabled;
      if (realMode && ["company", "meeting", "incident", "reset"].indexOf(action) >= 0) {
        this.close();
        this.renderer.toast("真实模式下本地模拟已关闭。要使用这些功能，请先恢复演示。");
        return;
      }
      const click = function (id) {
        const button = document.getElementById(id);
        if (button) button.click();
      };
      if (action === "mission-center") {
        this.close();
        click("missionBtn");
        return;
      }
      if (action === "company") {
        this.close();
        click("companyBtn");
        return;
      }
      if (action === "meeting") {
        this.close();
        click("meetingBtn");
        return;
      }
      if (action === "incident") {
        this.close();
        click("eventBtn");
        return;
      }
      if (action === "reset") {
        this.close();
        click("resetBtn");
        return;
      }
      if (action === "theme") {
        click("themeBtn");
        return;
      }
      if (action === "lang") {
        click("langBtn");
        return;
      }
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
      if (action === "demo") {
        this.close();
        if (this.shell) this.shell.settings.open("demo");
        return;
      }
      if (action === "guide") {
        this.close();
        if (this.shell) this.shell.guide.open();
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
      }
    }
  }

  class RailMenu {
    constructor(renderer, shell) {
      this.renderer = renderer;
      this.shell = shell;
      this.root = document.getElementById("featureRail");
      this.flyout = document.getElementById("railFlyout");
      this.active = "";
      this.bind();
    }

    bind() {
      const self = this;
      if (!this.root || !this.flyout) return;
      this.root.addEventListener("click", function (event) {
        const button = event.target.closest("[data-rail-section]");
        if (!button) return;
        const section = button.getAttribute("data-rail-section");
        if (section === "all") {
          self.close();
          if (self.shell && self.shell.drawer) self.shell.drawer.open();
          return;
        }
        if (self.active === section && !self.flyout.hidden) self.close();
        else self.openSection(section, button);
      });
      this.flyout.addEventListener("click", function (event) {
        if (event.target.closest("[data-rail-close]")) { self.close(); return; }
        if (event.target.closest("[data-rail-open-all]")) {
          self.close();
          if (self.shell && self.shell.drawer) self.shell.drawer.open();
          return;
        }
        const style = event.target.closest("[data-chat-style]");
        if (style) {
          writeChatStyle(style.getAttribute("data-chat-style"));
          self.syncStyle();
          if (self.renderer && self.renderer.toast) {
            self.renderer.toast("聊天窗口风格 · " + style.getAttribute("data-chat-style").toUpperCase());
          }
          return;
        }
        const action = event.target.closest("[data-feature-action]");
        if (action) {
          self.close();
          if (self.shell && self.shell.drawer) self.shell.drawer.run(action.getAttribute("data-feature-action"));
        }
      });
      document.addEventListener("click", function (event) {
        if (!self.flyout || self.flyout.hidden) return;
        if (self.root.contains(event.target) || self.flyout.contains(event.target)) return;
        self.close();
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") self.close();
      });
      document.addEventListener(CHAT_STYLE_EVENT, function () { self.syncStyle(); });
      window.addEventListener("resize", function () {
        if (!self.flyout || self.flyout.hidden) return;
        const button = self.root.querySelector('[data-rail-section="' + self.active + '"]');
        if (button) self.position(button);
      });
    }

    close() {
      this.active = "";
      if (this.flyout) {
        this.flyout.hidden = true;
        this.flyout.innerHTML = "";
      }
      if (this.root) {
        this.root.querySelectorAll("[data-rail-section]").forEach(function (button) {
          button.classList.remove("active");
        });
      }
    }

    openSection(section, anchor) {
      if (!this.flyout || !this.root) return;
      this.active = section;
      this.root.querySelectorAll("[data-rail-section]").forEach(function (button) {
        button.classList.toggle("active", button.getAttribute("data-rail-section") === section);
      });
      this.flyout.hidden = false;
      this.flyout.innerHTML = this.render(section);
      this.position(anchor);
      this.syncStyle();
    }

    position(anchor) {
      if (!this.flyout || !anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(286, window.innerWidth - 70);
      let top = rect.top;
      const maxTop = Math.max(12, window.innerHeight - 340);
      top = Math.max(12, Math.min(top, maxTop));
      this.flyout.style.width = width + "px";
      this.flyout.style.left = Math.min(window.innerWidth - width - 8, rect.right + 8) + "px";
      this.flyout.style.top = top + "px";
    }

    actionRow(action, glyph, title, hint) {
      return '<button type="button" class="rail-action" data-feature-action="' + esc(action) + '">' +
        '<b>' + esc(glyph) + '</b><span><strong>' + esc(title) + '</strong><em>' + esc(hint) + '</em></span></button>';
    }

    render(section) {
      const t = function (key) { return AO.t(key); };
      let title = "";
      let body = "";
      if (section === "people") {
        title = t("featurePeople");
        body = this.actionRow("hire", "＋", t("featureAddFriend"), "本地 Agent · 热桌 · onboarding") +
          this.actionRow("external", "⇢", t("featureAddExternal"), "连接码 / 模型 API / MCP");
      } else if (section === "create") {
        title = t("featureCreate");
        body = this.actionRow("group", "＋", t("featureCreateGroup"), "群聊 / 任务群 / 私聊") +
          this.actionRow("mission", "▦", t("featureCreateTask"), "章程 / 自动拆解 / 审批");
      } else if (section === "settings") {
        title = t("featureSettingsGroup");
        const style = readChatStyle();
        body = this.actionRow("tools", "⚙", t("featureTools"), "升级 / AI / MCP") +
          this.actionRow("settings", "☷", t("featureSettings"), "设置中心") +
          this.actionRow("demo", "◌", t("settingsDemo"), t("settingsDemoHint")) +
          this.actionRow("guide", "?", t("guideButton"), "关闭演示 / 接入 AI / 任务流程") +
          this.actionRow("theme", "☾", t("settingsTheme"), document.documentElement.dataset.theme === "day" ? t("themeDay") : t("themeNight")) +
          this.actionRow("lang", "文", t("settingsLanguage"), AO.lang === "en" ? "English" : "中文") +
          '<div class="rail-style"><span>' + esc(t("settingsChatStyle")) + '</span><div class="feature-style-buttons">' +
          ["agent", "qq", "wechat"].map(function (id) {
            const label = id === "agent" ? "Agent" : id === "qq" ? "QQ" : "微信";
            return '<button type="button" data-chat-style="' + id + '" class="' + (style === id ? "active" : "") + '">' + label + '</button>';
          }).join("") + '</div></div>';
      } else if (section === "work") {
        title = t("featureWork");
        const realMode = AO.DemoMode && !AO.DemoMode.enabled;
        body = this.actionRow("mission-center", "▤", t("featureTaskCenter"), t("featureTaskCenterHint"));
        if (realMode) {
          body += '<p class="rail-real-note">本地模拟已关闭，Company、会议、事件和重置暂不可用。' +
            '恢复演示后可继续使用。</p>';
        } else {
          body += this.actionRow("company", "◫", t("featureCompany"), t("featureCompanyHint")) +
            this.actionRow("meeting", "◎", t("featureMeeting"), t("featureMeetingHint")) +
            this.actionRow("incident", "!", t("featureIncident"), t("featureIncidentHint")) +
            this.actionRow("reset", "↺", t("featureReset"), t("featureResetHint"));
        }
      } else {
        title = t("featureComms");
        body = this.actionRow("group-chat", "#", t("featureGroupChat"), "群聊 / 任务群浮窗") +
          this.actionRow("direct-chat", "@", t("featureDirectChat"), "和任一 Agent 私聊");
      }
      return '<header class="rail-flyout-head"><div><span>WORKSPACE</span><h3>' + esc(title) +
        '</h3></div><button type="button" data-rail-close>×</button></header>' +
        '<div class="rail-flyout-body">' + body + '</div>' +
        '<footer><button type="button" data-rail-open-all>☰ ' + esc(t("featureMenu")) + '</button></footer>';
    }

    syncStyle() {
      if (!this.flyout || this.flyout.hidden) return;
      const active = readChatStyle();
      this.flyout.querySelectorAll("[data-chat-style]").forEach(function (button) {
        button.classList.toggle("active", button.getAttribute("data-chat-style") === active);
      });
    }
  }

  class SettingsCenter {
    constructor(renderer) {
      this.renderer = renderer;
      this.root = document.getElementById("featureModalRoot");
      this.lastFocus = null;
      this.bindOnce();
    }

    open(section) {
      if (!this.root) return;
      const theme = document.documentElement.dataset.theme || "night";
      const style = readChatStyle();
      const demo = AO.DemoMode ? AO.DemoMode.enabled : true;
      const ext = this.renderer && this.renderer.external;
      const agents = (ext && ext.agents) || [];
      const online = agents.filter(function (agent) { return agent.status === "online"; }).length;
      if (this.root.hidden) this.lastFocus = document.activeElement;
      this.root.hidden = false;
      this.root.innerHTML = '<div class="feature-modal-backdrop" data-settings-close></div>' +
        '<section class="feature-settings" role="dialog" aria-modal="true" aria-labelledby="settingsTitle"><header><span>SETTINGS</span><h2 id="settingsTitle">' +
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
        '<p class="settings-note">' + esc(AO.t("settingsChatNote")) + '</p>' +
        '<div class="settings-row"><label>' + esc(AO.t("settingsDensity")) + '</label>' +
        '<div class="settings-seg">' +
        '<button type="button" data-settings-density="comfortable" class="' +
        (document.documentElement.dataset.density !== "compact" ? "active" : "") + '">' +
        esc(AO.t("settingsDensityComfortable")) + '</button>' +
        '<button type="button" data-settings-density="compact" class="' +
        (document.documentElement.dataset.density === "compact" ? "active" : "") + '">' +
        esc(AO.t("settingsDensityCompact")) + '</button></div></div>' +
        '<p class="settings-note">' + esc(AO.t("settingsDensityHint")) + '</p>' +
        '<div class="settings-section settings-demo" id="settingsDemo">' +
        '<div class="settings-section-head"><span>WORKSPACE MODE</span><h3>' +
        esc(AO.t("settingsDemo")) + '</h3></div>' +
        '<label class="settings-toggle"><input type="checkbox" data-settings-demo' +
        (demo ? ' checked' : '') + ' /><span><b>' + esc(AO.t("settingsDemoMode")) +
        '</b><em>' + esc(AO.t("settingsDemoDesc")) + '</em></span></label>' +
        '<p class="settings-note">' + esc(AO.t("settingsDemoNote")) + '</p>' +
        '<div class="settings-demo-actions">' +
        '<button type="button" data-settings-demo-clean>' + esc(AO.t("settingsDemoClean")) + '</button>' +
        '<button type="button" data-settings-demo-missions>' + esc(AO.t("realModeOpenMissions")) + '</button>' +
        '<button type="button" data-settings-guide>' + esc(AO.t("guideButton")) + '</button>' +
        '</div><div class="settings-demo-state' + (demo ? '' : ' off') + '"><i></i>' +
        esc(AO.t(demo ? "settingsDemoOn" : "settingsDemoOff", {
          total: agents.length, online: online
        })) + '</div></div>' +
        '</div></section>';
      this.bindOnce();
      syncAppInert();
      const close = this.root.querySelector("[data-settings-close]");
      if (close) close.focus({ preventScroll: true });
      if (section === "demo") {
        const target = this.root.querySelector("#settingsDemo");
        if (target && target.scrollIntoView) target.scrollIntoView({ block: "nearest" });
      }
    }

    bindOnce() {
      if (this._bound || !this.root) return;
      this._bound = true;
      const self = this;
      this.root.addEventListener("click", function (event) {
        if (event.target.closest("[data-settings-close]")) { self.close(); return; }
        const density = event.target.closest("[data-settings-density]");
        if (density) {
          applyDensity(density.getAttribute("data-settings-density"));
          self.open();
          return;
        }
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
          return;
        }
        if (event.target.closest("[data-settings-demo-clean]")) {
          if (AO.DemoMode) {
            AO.DemoMode.stopDemoAgent().then(function () {
              window.setTimeout(function () { self.open("demo"); }, 120);
            });
          }
          return;
        }
        if (event.target.closest("[data-settings-demo-missions]")) {
          self.close();
          if (self.renderer && self.renderer.missions) self.renderer.missions.open();
          return;
        }
        if (event.target.closest("[data-settings-guide]")) {
          self.close();
          if (self.renderer && self.renderer.features) self.renderer.features.guide.open();
        }
      });
      this.root.addEventListener("change", function (event) {
        if (event.target.matches("[data-settings-style]")) {
          writeChatStyle(event.target.value);
          if (self.renderer && self.renderer.toast) self.renderer.toast(AO.t("settingsSaved"));
          return;
        }
        if (event.target.matches("[data-settings-demo]")) {
          if (AO.DemoMode) {
            const enabled = event.target.checked;
            AO.DemoMode.setEnabled(enabled);
            if (self.renderer && self.renderer.toast) {
              self.renderer.toast(AO.t(enabled ? "demoModeOn" : "demoModeOff"));
            }
            window.setTimeout(function () { self.open("demo"); }, 260);
          }
        }
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && self.root && !self.root.hidden) self.close();
      });
      this.root.addEventListener("keydown", function (event) {
        if (self.root && !self.root.hidden) trapTab(self.root, event);
      });
      document.addEventListener("agent-office:demo-change", function () {
        if (self.root && !self.root.hidden) self.open("demo");
      });
    }

    close() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.innerHTML = "";
      syncAppInert();
      if (this.lastFocus && this.lastFocus.isConnected && !document.querySelector(MODAL_SELECTOR)) {
        this.lastFocus.focus({ preventScroll: true });
      }
      this.lastFocus = null;
    }
  }

  class GuideCenter {
    constructor(renderer) {
      this.renderer = renderer;
      this.root = document.getElementById("guideModalRoot");
      this.lastFocus = null;
      this.bindOnce();
    }

    copy(demo, agents, online) {
      const zh = AO.lang !== "en";
      const sections = zh ? [
        {
          title: "关闭演示 / 预设",
          body: "右上角演示开关（当前显示「关闭演示」）；或左侧 设置 → 演示与预设；或 工具 → 演示与预设。关闭后暂停模拟、隐藏 6 个本地角色和演示 Agent。",
          action: "settings", label: "打开设置"
        },
        {
          title: "接入真实 Agent",
          body: "人脉 → 添加外部 Agent。支持 Codex、Claude、WorkBuddy、Doubao、DeepSeek、Gemini 等品牌 Logo、模型 API、连接码和 MCP。离线只表示没有心跳，本机 AI 仍可按分配身份执行；要外部进程真正执行，请启动对应连接器。",
          action: "external", label: "接入 Agent"
        },
        {
          title: "3 步接入 AI",
          body: "工具 → AI 模型服务 → 3 步接入：选服务、填连接、测试并启用。密钥只写入本机 bridge，不进入浏览器或任务记录。",
          action: "ai", label: "接入 AI"
        },
        {
          title: "创建任务",
          body: "创建 → 任务管理。写目标、验收、预算和 Token 上限；系统会推荐团队、拆解任务，并允许逐个任务指定执行者。",
          action: "missions", label: "打开任务中心"
        },
        {
          title: "执行与审批",
          body: "只有花费、拍板、扫码登录、授权四类事项会暂停等你；技术问题由 Agent 讨论解决。首页 MISSION LIVE 显示任务、进度、已运行时间和停止按钮。",
          action: "missions", label: "查看任务"
        },
        {
          title: "完成后开启下一轮",
          body: "全部任务完成后显示「本轮已完成 · 全员收尾」。点「开启下一轮」复用团队、交付物、决策和汇报作为上下文；也可以先查看复盘。",
          action: "missions", label: "查看已完成任务"
        },
        {
          title: "工具与升级",
          body: "工具面板包含 AI 设置、MCP、演示开关、本地升级包和自动升级。按 ? 可以随时打开本指南。",
          action: "tools", label: "打开工具"
        }
      ] : [
        {
          title: "Turn off demo / presets",
          body: "Use the topbar demo switch (it reads “Turn off demo” while demo is on), or Settings → Demo & presets, or Tools → Demo & presets. It pauses simulation and hides the six local roles and demo agent.",
          action: "settings", label: "Open settings"
        },
        {
          title: "Connect real agents",
          body: "People → Add external agent. Codex, Claude, WorkBuddy, Doubao, DeepSeek, Gemini and more support brand logos, model APIs, pairing codes and MCP. Offline only means no heartbeat; local AI can still execute under the assigned identity. Start the connector for real external execution.",
          action: "external", label: "Connect agent"
        },
        {
          title: "Connect AI in 3 steps",
          body: "Tools → AI model service → Connect AI: choose a service, enter the connection, test and enable. Keys stay in the local bridge, never in browser or task records.",
          action: "ai", label: "Connect AI"
        },
        {
          title: "Create a mission",
          body: "Create → Mission Management. Add goal, acceptance, budget and token cap; the system recommends a team, plans tasks and lets you override each executor.",
          action: "missions", label: "Open Mission Control"
        },
        {
          title: "Execution and approvals",
          body: "Only spend, decision, login and authorization pause for you; technical issues are solved by agents. MISSION LIVE on the home page shows task, progress, elapsed time and Stop.",
          action: "missions", label: "View missions"
        },
        {
          title: "Start the next round",
          body: "When all tasks are done, the mission shows “Round complete · everyone wrapped up”. Start next round reuses the team, deliverables, decisions and reports as context; review the previous round first if you prefer.",
          action: "missions", label: "View completed mission"
        },
        {
          title: "Tools and updates",
          body: "The Tools panel contains AI setup, MCP, the demo switch, manual update and automatic update. Press ? to open this guide at any time.",
          action: "tools", label: "Open tools"
        }
      ];
      if (!demo) {
        sections[0].body = zh ?
          "右上角「恢复演示」按钮；或左侧 设置 → 演示与预设；或 工具 → 演示与预设。当前本地角色和演示 Agent 已隐藏。" :
          "Use the topbar Restore demo button, or Settings → Demo & presets, or Tools → Demo & presets. Local roles and the demo agent are currently hidden.";
      }
      return {
        title: zh ? "使用指南" : "Usage guide",
        heroTitle: zh ? "5 分钟从演示切到真实工作流" : "From demo to a real workflow in 5 minutes",
        hero: zh ? "关闭演示 → 接入真实 Agent → 3 步接入 AI → 创建任务 → 审批和汇报。" :
          "Turn off demo → connect real agents → connect AI in 3 steps → create a mission → approve and review.",
        status: demo ? (zh ? "演示模式开启 · " + AO.AGENTS.length + " 个本地角色" :
          "Demo mode on · " + AO.AGENTS.length + " local roles") :
          (zh ? "真实模式 · " + agents.length + " 个外部 Agent（" + online + " 在线）" :
            "Real-agent mode · " + agents.length + " external agents (" + online + " online)"),
        statusText: demo ? (zh ? "本地模拟正在运行。关闭后只使用真实外部 Agent；真实任务、上传、审批和汇报不会删除。" :
          "Local simulation is running. When off, only real external agents are used; real missions, uploads, approvals and reports are preserved.") :
          (zh ? "本地角色和剧本已隐藏；任务推荐与新建任务只使用真实外部 Agent。" :
            "Local roles and scripts are hidden; recommendations and new missions use real external agents only."),
        closeDemo: zh ? "关闭演示" : "Turn off demo",
        restoreDemo: zh ? "恢复演示" : "Restore demo",
        sections: sections,
        foot: zh ? "关闭演示只隐藏本地模拟，不会删除外部 Agent、任务、上传、审批或汇报。完整文档在仓库 docs/GUIDE.md。" :
          "Turning off demo only hides local simulation; external agents, missions, uploads, approvals and reports are preserved. Full documentation: docs/GUIDE.md in the repo."
      };
    }

    sectionHTML(index, section, demo) {
      return '<section class="guide-section"><span>0' + (index + 1) + '</span><div><h3>' +
        esc(section.title) + '</h3><p>' + esc(section.body) + '</p>' +
        '<button type="button" data-guide-action="' + esc(section.action) + '">' +
        esc(section.label) + '</button></div></section>';
    }

    open() {
      if (!this.root) return;
      const demo = AO.DemoMode ? AO.DemoMode.enabled : true;
      const ext = this.renderer && this.renderer.external;
      const agents = (ext && ext.agents) || [];
      const online = agents.filter(function (agent) { return agent.status === "online"; }).length;
      const copy = this.copy(demo, agents, online);
      if (this.root.hidden) this.lastFocus = document.activeElement;
      this.root.hidden = false;
      this.root.innerHTML = '<div class="feature-modal-backdrop" data-guide-close></div>' +
        '<section class="feature-settings feature-guide" role="dialog" aria-modal="true" aria-labelledby="guideTitle"><header><span>GUIDE / START HERE</span><h2 id="guideTitle">' +
        esc(copy.title) + '</h2><button type="button" data-guide-close>×</button></header>' +
        '<div class="feature-settings-body guide-body">' +
        '<div class="guide-hero"><span>5 MIN SETUP</span><h3>' + esc(copy.heroTitle) +
        '</h3><p>' + esc(copy.hero) + '</p></div>' +
        '<div class="guide-status ' + (demo ? 'on' : 'off') + '"><i></i><div><b>' +
        esc(copy.status) + '</b><p>' + esc(copy.statusText) + '</p></div>' +
        '<button type="button" data-guide-demo-toggle class="' + (demo ? 'ghost' : 'primary') + '">' +
        esc(demo ? copy.closeDemo : copy.restoreDemo) + '</button></div>' +
        '<div class="guide-grid">' +
        copy.sections.map((section, index) => this.sectionHTML(index, section, demo)).join("") +
        '</div><p class="guide-foot">' + esc(copy.foot) + '</p></div></section>';
      this.bindOnce();
      syncAppInert();
      const close = this.root.querySelector("[data-guide-close]");
      if (close) close.focus({ preventScroll: true });
    }

    bindOnce() {
      if (this._bound || !this.root) return;
      this._bound = true;
      const self = this;
      this.root.addEventListener("click", function (event) {
        if (event.target.closest("[data-guide-close]")) { self.close(); return; }
        if (event.target.closest("[data-guide-demo-toggle]")) {
          if (!AO.DemoMode) return;
          const next = !AO.DemoMode.enabled;
          AO.DemoMode.setEnabled(next);
          if (self.renderer && self.renderer.toast) {
            self.renderer.toast(AO.t(next ? "demoModeOn" : "demoModeOff"));
          }
          window.setTimeout(function () { self.open(); }, 240);
          return;
        }
        const action = event.target.closest("[data-guide-action]");
        if (!action) return;
        const kind = action.getAttribute("data-guide-action");
        self.close();
        if (kind === "external" && self.renderer && self.renderer.external) self.renderer.external.open();
        else if (kind === "ai") { if (AO.aiSetup) AO.aiSetup.open(); }
        else if (kind === "tools" && self.renderer && self.renderer.update) self.renderer.update.open();
        else if (kind === "missions" && self.renderer && self.renderer.missions) self.renderer.missions.open();
        else if (kind === "settings" && self.renderer && self.renderer.features) self.renderer.features.settings.open();
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && self.root && !self.root.hidden) self.close();
      });
      this.root.addEventListener("keydown", function (event) {
        if (self.root && !self.root.hidden) trapTab(self.root, event);
      });
      document.addEventListener("agent-office:demo-change", function () {
        if (self.root && !self.root.hidden) self.open();
      });
      document.addEventListener("agent-office:lang", function () {
        if (self.root && !self.root.hidden) self.open();
      });
    }

    close() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.innerHTML = "";
      syncAppInert();
      if (this.lastFocus && this.lastFocus.isConnected && !document.querySelector(MODAL_SELECTOR)) {
        this.lastFocus.focus({ preventScroll: true });
      }
      this.lastFocus = null;
    }
  }

  class CommandPalette {
    constructor(renderer) {
      this.renderer = renderer;
      this.root = document.getElementById("commandRoot");
      this.actions = [];
      this.visible = [];
      this.active = 0;
      this.query = "";
      this.lastFocus = null;
      this.bind();
    }

    open() {
      if (!this.root) return;
      this.lastFocus = document.activeElement;
      this.query = "";
      this.actions = this.buildActions();
      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");
      this.render();
      syncAppInert();
      const input = this.root.querySelector("#commandInput");
      if (input) input.focus();
    }

    close() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      this.root.innerHTML = "";
      syncAppInert();
      if (this.lastFocus && this.lastFocus.isConnected && !document.querySelector(MODAL_SELECTOR)) {
        this.lastFocus.focus({ preventScroll: true });
      }
      this.lastFocus = null;
    }

    add(list, zh, en, hintZh, hintEn, keywords, run) {
      list.push({
        label: AO.lang === "en" ? en : zh,
        hint: AO.lang === "en" ? hintEn : hintZh,
        keywords: keywords || "",
        run: run
      });
    }

    buildActions() {
      const renderer = this.renderer;
      const list = [];
      const view = renderer.missions;
      const demoOn = !(AO.DemoMode && !AO.DemoMode.enabled);
      this.add(list, "＋ 新建任务", "＋ New mission", "写目标、自动组队、拆解",
        "Goal, team and task plan", "new mission create 新建 任务",
        function () {
          if (!view) return;
          Promise.resolve(view.open()).then(function () { view.openForm("mission"); }).catch(function () {});
        });
      this.add(list, "▤ 打开任务中心", "▤ Open Mission Control", "任务、群聊、审批、文件",
        "Tasks, chats, approvals, files", "mission control tasks 任务中心",
        function () { if (view) view.open(); });
      this.add(list, "◉ Boss Inbox", "◉ Boss Inbox", "待处理审批与历史",
        "Pending approvals and history", "approval inbox 审批 老板",
        function () {
          if (!view) return;
          Promise.resolve(view.open()).then(function () {
            view.viewMode = "approvals";
            view.detailTab = "approvals";
            view.approvalFilter = "pending";
            view.render();
            view.loadApprovalHistory();
          }).catch(function () {});
        });
      this.add(list, "⇢ 接入外部 Agent", "⇢ Connect external agent", "Codex / Claude / 豆包 / DeepSeek",
        "Codex / Claude / Doubao / DeepSeek", "external agent connect 外部 接入 配对",
        function () { if (renderer.external) renderer.external.open(); });
      this.add(list, "✦ 接入 AI 模型", "✦ Connect AI", "3 步接入本机模型服务",
        "3-step local model setup", "ai model setup provider 接入 模型",
        function () { if (AO.aiSetup) AO.aiSetup.open(); });
      this.add(list, "? 使用指南", "? Usage guide", "关闭演示、真实 Agent、任务流程",
        "Demo, real agents and missions", "guide help 指南 帮助",
        function () { if (renderer.features) renderer.features.guide.open(); });
      this.add(list, "⚙ 设置中心", "⚙ Settings", "主题、语言、演示与预设",
        "Theme, language, demo presets", "settings 设置 主题 语言",
        function () { if (renderer.features) renderer.features.settings.open(); });
      this.add(list, "▦ 工具与升级", "▦ Tools & updates", "AI、MCP、升级、演示",
        "AI, MCP, updates, demo", "tools update mcp 工具 升级",
        function () { if (renderer.update) renderer.update.open(); });
      this.add(list, demoOn ? "◌ 关闭演示" : "◌ 恢复演示",
        demoOn ? "◌ Turn demo off" : "◌ Restore demo",
        demoOn ? "隐藏本地角色与剧本" : "恢复本地角色与剧本",
        demoOn ? "Hide local roles and script" : "Restore local roles and script",
        "demo preset 演示 预设",
        function () { if (AO.DemoMode) AO.DemoMode.setEnabled(!AO.DemoMode.enabled); });
      this.add(list, AO.lang === "en" ? "☀ 切换主题" : "☀ 切换主题",
        "☀ Toggle theme", "白天 / 夜间", "Day / night", "theme day night 主题 白天 夜间",
        function () { const btn = document.getElementById("themeBtn"); if (btn) btn.click(); });
      this.add(list, AO.lang === "en" ? "文 切换语言" : "文 切换语言",
        "文 Switch language", "中文 / English", "Chinese / English", "language lang 语言",
        function () { const btn = document.getElementById("langBtn"); if (btn) btn.click(); });
      this.add(list, "⛶ 全屏办公室", "⛶ Fullscreen office", "专注查看舞台",
        "Focus the stage", "fullscreen focus 全屏",
        function () { const btn = document.getElementById("focusBtn"); if (btn) btn.click(); });
      if (demoOn) {
        this.add(list, "◫ 打开一人公司", "◫ Open Company OS", "角色、房间与公司状态",
          "Roles, rooms and company state", "company 一人公司",
          function () { if (renderer.company) renderer.company.open(); });
        this.add(list, "◇ 打开 Trace Lab", "◇ Open Trace Lab", "Trace、回放与 Evals",
          "Trace, replay and evals", "trace evals 轨迹",
          function () { if (renderer.traceLab) renderer.traceLab.open(); });
      }
      const overview = (AO.missionLive && AO.missionLive.lastOverview) ||
        (view && view.data ? { missions: view.data.missions } : null);
      const missions = (overview && overview.missions) || [];
      missions.slice(0, 8).forEach(function (mission) {
        list.push({
          label: "▤ " + (mission.title || mission.id),
          hint: AO.lang === "en" ? "Open mission" : "打开任务",
          keywords: "mission " + (mission.title || "") + " 任务",
          run: function () {
            if (!view) return;
            Promise.resolve(view.open()).then(function () {
              return view.selectMission(mission.id);
            }).catch(function () {});
          }
        });
      });
      const agents = (renderer.external && renderer.external.agents) || [];
      agents.slice(0, 8).forEach(function (agent) {
        list.push({
          label: "◇ " + (agent.name || agent.id),
          hint: AO.lang === "en" ? "Open external dossier" : "打开外部 Agent 档案",
          keywords: "agent external " + (agent.name || "") + " 外部",
          run: function () { renderer.openExternalDrawer(agent.id); }
        });
      });
      return list;
    }

    filter() {
      const q = String(this.query || "").trim().toLowerCase();
      this.visible = !q ? this.actions.slice(0, 18) : this.actions.filter(function (action) {
        return (action.label + " " + action.hint + " " + action.keywords).toLowerCase().indexOf(q) >= 0;
      }).slice(0, 12);
      if (this.active >= this.visible.length) this.active = Math.max(0, this.visible.length - 1);
    }

    render() {
      if (!this.root) return;
      this.filter();
      const zh = AO.lang !== "en";
      const rows = this.visible.map((action, index) =>
        '<button type="button" class="command-item' + (index === this.active ? " active" : "") +
        '" data-command-index="' + index + '"><span><b>' + esc(action.label) + '</b><em>' +
        esc(action.hint) + '</em></span><kbd>' + (index === this.active ? "↵" : "") + '</kbd></button>'
      ).join("");
      this.root.innerHTML =
        '<div class="command-backdrop" data-command-close></div>' +
        '<section class="command-card" role="dialog" aria-modal="true" aria-labelledby="commandTitle">' +
        '<header><span>COMMAND</span><h2 id="commandTitle">' +
        esc(zh ? "跳转或执行操作" : "Jump to or run an action") + '</h2>' +
        '<button type="button" data-command-close aria-label="' + esc(AO.t("close")) + '">×</button></header>' +
        '<input id="commandInput" type="search" autocomplete="off" spellcheck="false" value="' +
        esc(this.query) + '" placeholder="' +
        esc(zh ? "输入任务、Agent 或操作…" : "Search missions, agents or actions…") + '" />' +
        '<div class="command-list">' + (rows ||
          '<p class="command-empty">' + esc(zh ? "没有匹配项" : "No matches") + '</p>') + '</div>' +
        '<footer><span>↑↓ ' + esc(zh ? "选择" : "select") + '</span><span>↵ ' +
        esc(zh ? "执行" : "run") + '</span><span>Esc ' + esc(zh ? "关闭" : "close") + '</span></footer>' +
        '</section>';
      const input = this.root.querySelector("#commandInput");
      if (input && document.activeElement !== input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }

    run(index) {
      const action = this.visible[index];
      if (!action) return;
      this.close();
      action.run();
    }

    bind() {
      if (!this.root) return;
      const self = this;
      this.root.addEventListener("input", function (event) {
        if (event.target.id !== "commandInput") return;
        self.query = event.target.value;
        self.active = 0;
        self.render();
      });
      this.root.addEventListener("click", function (event) {
        if (event.target.closest("[data-command-close]")) { self.close(); return; }
        const item = event.target.closest("[data-command-index]");
        if (item) self.run(Number(item.getAttribute("data-command-index")));
      });
      document.addEventListener("keydown", function (event) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          if (self.root.hidden) self.open();
          else self.close();
          return;
        }
        if (self.root.hidden) return;
        if (event.key === "Escape") { event.preventDefault(); self.close(); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (!self.visible.length) return;
          const delta = event.key === "ArrowDown" ? 1 : -1;
          self.active = (self.active + delta + self.visible.length) % self.visible.length;
          self.render();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          self.run(self.active);
        }
      });
      document.addEventListener("agent-office:lang", function () {
        if (self.root && !self.root.hidden) { self.actions = self.buildActions(); self.render(); }
      });
    }
  }

  class FeatureShell {
    constructor(renderer, deps) {
      this.chat = new ChatHub(renderer);
      this.settings = new SettingsCenter(renderer);
      this.guide = new GuideCenter(renderer);
      this.drawer = new FeatureDrawer(renderer, deps, this);
      this.rail = new RailMenu(renderer, this);
      this.command = new CommandPalette(renderer);
    }
  }

  AO.CommandPalette = CommandPalette;
  AO.FeatureShell = FeatureShell;
  AO.readChatStyle = readChatStyle;
  AO.syncAppInert = syncAppInert;
  AO.applyDensity = applyDensity;
})();
