(function () {
  "use strict";

  const AO = window.AgentOffice;

  AO.HIRE_KEY = "agent-office.hires.v1";
  AO.HIRE_ROLES = ["engineer", "design", "research", "qa"];
  AO.HIRE_HAIR = [
    ["short", "短发"], ["bob", "波波头"], ["messy", "凌乱"],
    ["curly", "卷发"], ["long", "长发"], ["ponytail", "马尾"]
  ];
  AO.HIRE_ACCESSORY = [
    ["none", "无"], ["tie", "领带"], ["scarf", "围巾"],
    ["headphones", "耳机"], ["glasses", "眼镜"], ["cap", "帽子"]
  ];
  AO.HIRE_LOOKS = [
    { skin: "#e8b08a", hair: "#2b1d16" },
    { skin: "#d9a075", hair: "#1c2b33" },
    { skin: "#f2c6a8", hair: "#2a1f3a" },
    { skin: "#c98d63", hair: "#3a2a1a" },
    { skin: "#e6ac86", hair: "#3a1f1f" },
    { skin: "#f0c3a0", hair: "#5a2a3a" }
  ];

  function readHires() {
    try {
      const raw = localStorage.getItem(AO.HIRE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  AO.availableHotDesks = function () {
    return AO.DESKS.filter(function (d) {
      return d.hot && !AO.AGENTS.some(function (a) { return a.deskId === d.id; });
    });
  };

  AO.loadHires = function () {
    const list = readHires();
    const allowed = AO.HIRE_ROLES;
    list.slice(0, 2).forEach(function (h) {
      if (!h || allowed.indexOf(h.role) === -1) return;
      if (!AO.DESKS.some(function (d) { return d.id === h.deskId && d.hot; })) return;
      if (AO.AGENTS.some(function (a) { return a.deskId === h.deskId; })) return;
      let id = String(h.id || "");
      if (!id || AO.AGENTS.some(function (a) { return a.id === id; })) {
        let n = 1;
        while (AO.AGENTS.some(function (a) { return a.id === "a" + n; })) n += 1;
        id = "a" + n;
      }
      const desk = AO.DESKS.find(function (d) { return d.id === h.deskId; });
      const rawStart = h.start && Number.isFinite(h.start.x)
        ? { x: h.start.x, y: h.start.y }
        : { x: desk.x, y: Math.min(585, desk.y + 55) };
      const start = {
        x: Math.max(30, Math.min(970, rawStart.x)),
        y: Math.max(70, Math.min(590, rawStart.y))
      };
      const def = {
        id: id,
        name: String(h.name || "新同事").slice(0, 12),
        role: h.role,
        deskId: h.deskId,
        skin: h.skin || "#e8b08a",
        hair: h.hair || "#2b1d16",
        hairStyle: h.hairStyle || "short",
        shirt: h.shirt || AO.ROLES[h.role].color,
        accessory: h.accessory || "none",
        trait: String(h.trait || "刚加入团队，正在熟悉工具链。").slice(0, 80),
        hired: true
      };
      AO.AGENTS.push(def);
      AO.START_POSITIONS[AO.AGENTS.length - 1] = start;
    });
  };

  AO.saveHires = function () {
    try {
      const list = AO.AGENTS.map(function (a, i) {
        return {
          id: a.id, name: a.name, role: a.role, deskId: a.deskId,
          skin: a.skin, hair: a.hair, hairStyle: a.hairStyle,
          shirt: a.shirt, accessory: a.accessory, trait: a.trait,
          start: AO.START_POSITIONS[i] || null
        };
      }).filter(function (a, i) { return AO.AGENTS[i].hired; });
      localStorage.setItem(AO.HIRE_KEY, JSON.stringify(list));
    } catch (err) {
      /* localStorage may be unavailable on file://; hiring still works in-session. */
    }
  };

  class Hiring {
    constructor(engine, renderer) {
      this.engine = engine;
      this.renderer = renderer;
      this.root = document.getElementById("hireModal");
      this.btn = document.getElementById("hireBtn");
      this.look = AO.HIRE_LOOKS[0];
      this.buildShell();
      this.bind();
    }

    buildShell() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      this.root.setAttribute("role", "dialog");
      this.root.setAttribute("aria-modal", "true");
      this.root.setAttribute("aria-label", "添加 Agent");
      const roleOptions = AO.HIRE_ROLES.map(function (r) {
        const role = AO.ROLES[r];
        return '<option value="' + r + '">' + role.label + " · " + role.short + "</option>";
      }).join("");
      const hairOptions = AO.HIRE_HAIR.map(function (h) {
        return '<option value="' + h[0] + '">' + h[1] + "</option>";
      }).join("");
      const accOptions = AO.HIRE_ACCESSORY.map(function (a) {
        return '<option value="' + a[0] + '">' + a[1] + "</option>";
      }).join("");
      this.root.innerHTML =
        '<div class="hire-backdrop" data-hire-close></div>' +
        '<div class="hire-shell">' +
          '<header class="hire-head"><div><span>NEW HIRE · ONBOARDING</span>' +
          "<h2>添加 Agent</h2><p>新同事会占用一个热桌，并自动拿到 onboarding 任务。</p></div>" +
          '<button type="button" class="hire-close" data-hire-close aria-label="关闭">×</button></header>' +
          '<div class="hire-body">' +
            '<aside class="hire-preview"><div id="hireAvatar"></div>' +
            '<b id="hirePreviewName">新同事</b><em id="hirePreviewRole">工程师</em>' +
            '<span id="hireDeskNote">HOT DESK</span></aside>' +
            '<form id="hireForm" class="hire-form">' +
              '<label>名字<input id="hireName" maxlength="12" value="新同事" autocomplete="off" /></label>' +
              '<label>角色<select id="hireRole">' + roleOptions + "</select></label>" +
              '<label>性格 / 备注<input id="hireTrait" maxlength="80" value="刚加入团队，正在熟悉工具链。" autocomplete="off" /></label>' +
              '<div class="hire-style">' +
                '<label>发型<select id="hireHair">' + hairOptions + "</select></label>" +
                '<label>配饰<select id="hireAccessory">' + accOptions + "</select></label>" +
                '<button type="button" class="hire-random" id="hireRandom">随机外观</button>' +
              '</div>' +
              '<div class="hire-desk" id="hireDesk"></div>' +
              '<div class="hire-actions"><button type="button" class="ghost" data-hire-close>取消</button>' +
              '<button type="submit" class="primary" id="hireSubmit">入职并创建任务</button></div>' +
            "</form>" +
          "</div>" +
        "</div>";
      this.form = this.root.querySelector("#hireForm");
      this.nameEl = this.root.querySelector("#hireName");
      this.roleEl = this.root.querySelector("#hireRole");
      this.traitEl = this.root.querySelector("#hireTrait");
      this.hairEl = this.root.querySelector("#hireHair");
      this.accEl = this.root.querySelector("#hireAccessory");
      this.avatarEl = this.root.querySelector("#hireAvatar");
      this.previewName = this.root.querySelector("#hirePreviewName");
      this.previewRole = this.root.querySelector("#hirePreviewRole");
      this.deskNote = this.root.querySelector("#hireDeskNote");
      this.deskEl = this.root.querySelector("#hireDesk");
      this.submitEl = this.root.querySelector("#hireSubmit");
    }

    bind() {
      const self = this;
      if (this.btn) this.btn.addEventListener("click", function () { self.open(); });
      if (!this.root) return;
      this.root.addEventListener("click", function (e) {
        if (e.target.closest("[data-hire-close]")) {
          self.close();
          return;
        }
        if (e.target.closest("#hireRandom")) {
          self.randomize();
        }
      });
      this.form.addEventListener("input", function () { self.updatePreview(); });
      this.form.addEventListener("change", function () { self.updatePreview(); });
      this.form.addEventListener("submit", function (e) {
        e.preventDefault();
        self.submit();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && self.isOpen) self.close();
      });
    }

    open() {
      if (!this.root) return;
      this.renderer.closeDrawer();
      this.isOpen = true;
      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");
      const app = document.getElementById("app");
      if (app) app.inert = true;
      this.nameEl.value = "新同事";
      this.roleEl.value = "engineer";
      this.traitEl.value = "刚加入团队，正在熟悉工具链。";
      this.hairEl.value = "short";
      this.accEl.value = "none";
      this.look = AO.HIRE_LOOKS[Math.floor(Math.random() * AO.HIRE_LOOKS.length)];
      this.updateDesk();
      this.updatePreview();
      this.nameEl.focus({ preventScroll: true });
      this.nameEl.select();
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

    randomize() {
      this.look = AO.HIRE_LOOKS[Math.floor(Math.random() * AO.HIRE_LOOKS.length)];
      this.hairEl.value = AO.HIRE_HAIR[Math.floor(Math.random() * AO.HIRE_HAIR.length)][0];
      this.accEl.value = AO.HIRE_ACCESSORY[Math.floor(Math.random() * AO.HIRE_ACCESSORY.length)][0];
      this.updatePreview();
    }

    tempAgent() {
      const role = this.roleEl.value;
      return {
        role: role,
        name: this.nameEl.value || "新同事",
        skin: this.look.skin,
        hair: this.look.hair,
        hairStyle: this.hairEl.value,
        shirt: AO.ROLES[role] ? AO.ROLES[role].color : "#55d6c2",
        accessory: this.accEl.value
      };
    }

    updateDesk() {
      const desks = AO.availableHotDesks();
      const full = !desks.length;
      this.submitEl.disabled = full;
      this.deskNote.textContent = full ? "HOT DESK · FULL" : "HOT DESK · " + desks[0].id;
      this.deskEl.innerHTML = full
        ? '<b>热桌已满</b><span>当前办公室最多 8 个 agent；需要更多工位可扩展热桌池。</span>'
        : '<b>入职工位</b><span>' + desks.map(function (d) {
            return d.id.toUpperCase() + " · 空位";
          }).join(" / ") + " · 自动创建 onboarding 任务</span>";
    }

    updatePreview() {
      const agent = this.tempAgent();
      this.avatarEl.innerHTML = AO.spriteSVG(agent, 66);
      this.previewName.textContent = agent.name;
      this.previewRole.textContent = AO.ROLES[agent.role].label;
    }

    submit() {
      if (!this.isOpen) return;
      const agent = this.tempAgent();
      const result = this.engine.hireAgent({
        name: agent.name,
        role: agent.role,
        skin: agent.skin,
        hair: agent.hair,
        hairStyle: agent.hairStyle,
        shirt: agent.shirt,
        accessory: agent.accessory,
        trait: this.traitEl.value
      });
      if (!result.ok) {
        this.renderer.toast(result.error || "添加失败");
        this.updateDesk();
        return;
      }
      const name = result.agent.name;
      const desk = result.desk.id;
      this.close();
      this.renderer.build();
      this.renderer.select(result.agent.id);
      this.renderer.toast(name + " 已入职 · " + desk + " · onboarding 任务已创建");
    }
  }

  AO.Hiring = Hiring;
})();
