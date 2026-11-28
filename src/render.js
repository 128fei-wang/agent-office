(function () {
  "use strict";

  const AO = window.AgentOffice;

  function div(cls, css, html) {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    if (css) d.style.cssText = css;
    if (html != null) d.innerHTML = html;
    return d;
  }

  function pos(x, y, w, h) {
    return (
      "left:" + x + "px;top:" + y + "px;width:" + w + "px;height:" + h + "px;"
    );
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fileLabel(ev) {
    if (!ev.file) return "";
    let label = ev.file;
    if (ev.lineStart != null) {
      label += ":" + ev.lineStart;
      if (ev.lineEnd != null && ev.lineEnd !== ev.lineStart) {
        label += "-" + ev.lineEnd;
      }
    }
    return label;
  }

  function deltaLabel(ev) {
    if (ev.frames) return ev.frames + " 帧";
    if (!ev.add && !ev.del) return "";
    return "+" + ev.add + " / −" + ev.del;
  }

  const TRACE_ICONS = {
    system: "·",
    claim: "◈",
    resume: "↻",
    skill: "⌘",
    handoff: "⇄",
    review: "◉",
    complete: "✓",
    risk: "!",
    meeting: "▣",
    decision: "◇",
    rework: "↺",
    inject: "＋",
    milestone: "★",
    external: "⇢",
    rename: "✎",
    hire: "＋"
  };

  const FEED_ICONS = {
    system: "·",
    chat: "💬",
    work: "▸",
    review: "◉",
    meeting: "▣",
    alert: "!",
    done: "✓"
  };

  const STATE_ORDER = ["working", "reviewing", "meeting", "walking", "blocked", "coffee", "chatting", "idle", "celebrating"];

  const TASK_STATUS = {
    backlog: "待办",
    in_progress: "进行中",
    review: "评审中",
    blocked: "阻塞",
    done: "已完成"
  };

  const SEVERITY = { high: "高", medium: "中", low: "低" };

  class Renderer {
    constructor(engine) {
      this.engine = engine;
      this.world = engine.world;
      this.stage = document.getElementById("stage");
      this.viewport = document.getElementById("stageViewport");
      this.officeLayer = document.getElementById("officeLayer");
      this.ambienceLayer = document.getElementById("ambienceLayer");
      this.charLayer = document.getElementById("charLayer");
      this.confettiLayer = document.getElementById("confettiLayer");
      this.teamList = document.getElementById("teamList");
      this.board = document.getElementById("board");
      this.auditView = document.getElementById("auditView");
      this.boardTabs = document.getElementById("boardTabs");
      this.feedList = document.getElementById("feedList");
      this.inspector = document.getElementById("inspector");
      this.drawer = document.getElementById("detailDrawer");
      this.drawerBackdrop = document.getElementById("drawerBackdrop");
      this.selectedId = null;
      this.feedFilter = "all";
      this.boardView = "board";
      this.drawerMode = null;
      this.drawerId = null;
      this.drawerHistory = [];
      this.lastFocus = null;
      this.toastEl = document.getElementById("toast");
      this.toastTimer = null;
      this.snapshotKey = "agent-office.snapshot.v1";
      this.lastLedgerSig = 0;
      this.lastAuditSig = "";
      this.lastMessageId = 0;
      this.wasDone = false;
      this.charEls = {};
      this.meetingRoom = null;
      this.bind();
      this.fx = new AO.FX(this.stage, engine);
      this.traceLab = new AO.TraceLab(engine, this);
      this.hiring = new AO.Hiring(engine, this);
      this.external = new AO.ExternalAgents(engine, this);
      this.renameDialog = new AO.RenameDialog(engine, this, this.external);
      this.doneSeen = new Set();
      this.wasMeetingFx = false;
      this.wasDoneFx = false;
    }

    bind() {
      const self = this;
      this.teamList.addEventListener("click", function (e) {
        if (e.target.closest("[data-ext-pair-open]")) {
          if (self.external) self.external.open();
          return;
        }
        const ext = e.target.closest("[data-external]");
        if (ext) {
          self.openExternalDrawer(ext.getAttribute("data-external"));
          return;
        }
        const card = e.target.closest("[data-agent]");
        if (card) self.select(card.getAttribute("data-agent"));
      });
      this.board.addEventListener("click", function (e) {
        const card = e.target.closest("[data-task]");
        if (card) self.openTaskDrawer(card.getAttribute("data-task"));
      });
      this.board.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        const card = e.target.closest("[data-task]");
        if (!card) return;
        e.preventDefault();
        e.stopPropagation();
        self.openTaskDrawer(card.getAttribute("data-task"));
      });
      this.auditView.addEventListener("click", function (e) {
        if (e.target.closest("[data-trace-open]")) {
          if (self.traceLab) self.traceLab.open();
          return;
        }
        const humanBtn = e.target.closest("[data-human]");
        if (humanBtn) {
          const status = humanBtn.getAttribute("data-human");
          const ok = self.engine.humanDecision(status, null);
          if (ok) {
            self.toast(status === "approved"
              ? "已记录人工批准 · 例外发布"
              : "已记录人工打回 · 要求补齐");
            self.lastAuditSig = "";
            self.renderAudit(true);
            self.renderHeader();
            if (self.traceLab) self.traceLab.refresh(true);
          }
          return;
        }
        const snapBtn = e.target.closest("[data-snapshot]");
        if (snapBtn) {
          if (snapBtn.getAttribute("data-snapshot") === "save") self.saveSnapshot();
          else self.restoreSnapshot();
          return;
        }
        const exportBtn = e.target.closest("[data-export-audit]");
        if (exportBtn) {
          self.exportAudit(exportBtn.getAttribute("data-export-audit"));
          return;
        }
        const agentBtn = e.target.closest("[data-open-agent]");
        if (agentBtn) {
          self.openAgentDrawer(agentBtn.getAttribute("data-open-agent"));
          return;
        }
        const card = e.target.closest("[data-task]");
        if (card) self.openTaskDrawer(card.getAttribute("data-task"));
      });
      this.charLayer.addEventListener("click", function (e) {
        const el = e.target.closest(".agent");
        if (!el) return;
        const id = el.getAttribute("data-id");
        if (window.matchMedia("(max-width: 720px)").matches) self.openAgentDrawer(id);
        else self.select(id);
      });
      this.charLayer.addEventListener("keydown", function (e) {
        const el = e.target.closest(".agent");
        if (!el || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        const id = el.getAttribute("data-id");
        if (window.matchMedia("(max-width: 720px)").matches) self.openAgentDrawer(id);
        else self.select(id);
      });
      this.inspector.addEventListener("click", function (e) {
        if (e.target.closest("[data-close]")) {
          self.selectedId = null;
          self.renderInspector();
          return;
        }
        const rename = e.target.closest("[data-rename-local]");
        if (rename) {
          const a = self.engine.agentById(rename.getAttribute("data-rename-local"));
          if (a) self.renameDialog.open("local", a.id, a.name);
          return;
        }
        const detail = e.target.closest("[data-open-agent]");
        if (detail) { self.openAgentDrawer(detail.getAttribute("data-open-agent")); return; }
        const openTask = e.target.closest("[data-open-task]");
        if (openTask) self.openTaskDrawer(openTask.getAttribute("data-open-task"));
      });
      this.boardTabs.addEventListener("click", function (e) {
        const btn = e.target.closest("[data-view]");
        if (btn) self.switchBoardView(btn.getAttribute("data-view"));
      });
      this.feedList.addEventListener("click", function (e) {
        const row = e.target.closest("[data-task]");
        if (row) self.openTaskDrawer(row.getAttribute("data-task"));
      });
      this.feedList.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        const row = e.target.closest("[data-task]");
        if (!row) return;
        e.preventDefault();
        e.stopPropagation();
        self.openTaskDrawer(row.getAttribute("data-task"));
      });
      this.drawer.addEventListener("click", function (e) {
        if (e.target.closest("[data-drawer-close]")) {
          self.closeDrawer();
          return;
        }
        if (e.target.closest("[data-drawer-back]")) {
          self.drawerBack();
          return;
        }
        if (e.target.closest("[data-refresh-drawer]")) {
          const top = self.drawer.scrollTop;
          self.renderDrawer();
          self.drawer.scrollTop = top;
          const again = self.drawer.querySelector("[data-refresh-drawer]");
          if (again) again.focus({ preventScroll: true });
          return;
        }
        const heartbeat = e.target.closest("[data-ext-heartbeat]");
        if (heartbeat) {
          if (self.external) self.external.testHeartbeat(heartbeat.getAttribute("data-ext-heartbeat"), heartbeat);
          return;
        }
        const renameLocal = e.target.closest("[data-rename-local]");
        if (renameLocal) {
          const a = self.engine.agentById(renameLocal.getAttribute("data-rename-local"));
          if (a) self.renameDialog.open("local", a.id, a.name);
          return;
        }
        const renameExternal = e.target.closest("[data-rename-external]");
        if (renameExternal) {
          const a = self.external.agentById(renameExternal.getAttribute("data-rename-external"));
          if (a) self.renameDialog.open("external", a.id, a.name);
          return;
        }
        if (e.target.closest("[data-ext-refresh]")) {
          self.external.refresh();
          self.toast("正在刷新外部 Agent…");
          return;
        }
        if (e.target.closest("[data-ext-diagnose]")) {
          const a = self.external.agentById(self.drawerId);
          if (a) self.external.diagnose(a);
          return;
        }
        const avatarSave = e.target.closest("[data-ext-avatar-save]");
        if (avatarSave) {
          const id = avatarSave.getAttribute("data-ext-avatar-save");
          const text = self.drawer.querySelector("[data-ext-avatar-text]");
          const color = self.drawer.querySelector("[data-ext-avatar-color]");
          self.external.updateProfile(id, {
            avatar: "custom",
            avatarText: text ? text.value.trim().slice(0, 2) : "",
            avatarColor: color ? color.value : ""
          });
          return;
        }
        if (e.target.closest("[data-open-external]")) {
          if (self.external) self.external.open();
          return;
        }
        const delegateBtn = e.target.closest("[data-delegate-task]");
        if (delegateBtn) {
          const select = self.drawer.querySelector("#delegateAgentSelect");
          const brief = self.drawer.querySelector("#delegateBrief");
          if (select && self.external) {
            self.external.delegateTask(
              delegateBtn.getAttribute("data-delegate-task"),
              select.value,
              brief ? brief.value : ""
            );
          }
          return;
        }
        const runProvider = e.target.closest("[data-ext-run-provider]");
        if (runProvider) {
          self.external.runProvider(runProvider.getAttribute("data-ext-run-provider"));
          return;
        }
        const removeExternal = e.target.closest("[data-ext-remove]");
        if (removeExternal) {
          self.external.remove(removeExternal.getAttribute("data-ext-remove"));
          self.closeDrawer();
          return;
        }
        const missionTaskBtn = e.target.closest("[data-open-mission-task]");
        if (missionTaskBtn) {
          self.openMissionTask(
            missionTaskBtn.getAttribute("data-mission-id"),
            missionTaskBtn.getAttribute("data-open-mission-task"),
            missionTaskBtn.getAttribute("data-mission-agent")
          );
          return;
        }
        const taskBtn = e.target.closest("[data-open-task]");
        if (taskBtn) {
          self.openTaskDrawer(taskBtn.getAttribute("data-open-task"));
          return;
        }
        const agentBtn = e.target.closest("[data-open-agent]");
        if (agentBtn) self.openAgentDrawer(agentBtn.getAttribute("data-open-agent"));
      });
      this.drawer.addEventListener("change", function (e) {
        const role = e.target.closest("[data-ext-role]");
        if (role) {
          self.external.updateProfile(role.getAttribute("data-ext-role"), { role: role.value });
          return;
        }
        const avatar = e.target.closest("[data-ext-avatar]");
        if (avatar) {
          self.external.updateProfile(avatar.getAttribute("data-ext-avatar"), { avatar: avatar.value });
        }
      });
      this.drawerBackdrop.addEventListener("click", function () {
        self.closeDrawer();
      });
      document.addEventListener("keydown", function (e) {
        if (!self.drawerMode) return;
        if (e.key === "Escape") {
          self.closeDrawer();
          return;
        }
        if (e.key === "Tab" && !self.drawer.hidden) {
          const nodes = Array.from(self.drawer.querySelectorAll(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), ' +
            'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )).filter(function (node) { return node.offsetParent !== null; });
          if (!nodes.length) return;
          const first = nodes[0];
          const last = nodes[nodes.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      });
      document.getElementById("feedFilters").addEventListener("click", function (e) {
        const btn = e.target.closest("[data-filter]");
        if (!btn) return;
        self.feedFilter = btn.getAttribute("data-filter");
        document.querySelectorAll("#feedFilters button").forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
        self.renderFeed(true);
      });
    }

    switchBoardView(view) {
      this.boardView = this.demoOff() ? "board" : (view === "audit" ? "audit" : "board");
      this.board.hidden = this.boardView !== "board";
      this.auditView.hidden = this.boardView !== "audit";
      if (this.boardTabs) {
        this.boardTabs.querySelectorAll("[data-view]").forEach((b) => {
          const on = b.getAttribute("data-view") === this.boardView;
          b.classList.toggle("active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
      }
      if (this.boardView === "audit") this.renderAudit(true);
      else this.renderBoard();
    }

    build() {
      this.world = this.engine.world;
      this.officeLayer.innerHTML = "";
      if (this.ambienceLayer) this.ambienceLayer.innerHTML = "";
      this.charLayer.innerHTML = "";
      this.confettiLayer.innerHTML = "";
      this.charEls = {};
      this.lastMessageId = 0;
      this.lastLedgerSig = 0;
      this.lastBoardSig = "";
      this.wasDone = false;
      this.doneSeen = new Set(
        this.world.tasks.filter(function (t) { return t.status === "done"; })
          .map(function (t) { return t.id; })
      );
      this.wasMeetingFx = !!this.world.meeting;
      this.wasDoneFx = false;
      this.closeDrawer();
      this.buildOffice();
      this.buildAmbience();
      this.buildCharacters();
      this.feedList.innerHTML = "";
      this.board.hidden = this.boardView !== "board";
      this.auditView.hidden = this.boardView !== "audit";
      this.lastAuditSig = "";
      if (this.fx) this.fx.invalidate();
      this.render(true);
    }

    buildOffice() {
      const stage = this.officeLayer;
      const boss = AO.BOSS_OFFICE;
      const meeting = AO.MEETING;
      const layout = AO.LAYOUT;

      // ----------------------------------------------------
      // shell
      // ----------------------------------------------------
      stage.appendChild(div("floor"));
      stage.appendChild(div("floor-grid"));
      stage.appendChild(div("floor-reflect r-boss", pos(60, 292, 230, 74)));
      stage.appendChild(div("floor-reflect r-meet", pos(650, 350, 300, 84)));
      stage.appendChild(div("floor-reflect r-lounge", pos(650, 578, 300, 32)));
      stage.appendChild(div("wall wall-top"));
      stage.appendChild(div("wall wall-left"));
      stage.appendChild(div("wall wall-right"));
      stage.appendChild(div("wall wall-bottom"));
      stage.appendChild(div("wall-trim"));

      // warm pools of light
      [
        { x: 60, y: 100, w: 230, h: 190 },
        { x: 300, y: 230, w: 320, h: 220 },
        { x: 100, y: 390, w: 480, h: 210 },
        { x: 655, y: 125, w: 300, h: 230 },
        { x: 655, y: 430, w: 300, h: 160 },
        { x: 100, y: 285, w: 160, h: 135 }
      ].forEach((p) => {
        stage.appendChild(div("light-pool", pos(p.x, p.y, p.w, p.h)));
      });

      // ----------------------------------------------------
      // wall dressing
      // ----------------------------------------------------
      const win = div("window", pos(300, 10, 200, 30));
      win.innerHTML =
        '<div class="window-sky"></div>' +
        '<i style="left:12px;height:12px"></i><i style="left:28px;height:18px"></i>' +
        '<i style="left:45px;height:9px"></i><i style="left:61px;height:16px"></i>' +
        '<i style="left:80px;height:11px"></i><i style="left:98px;height:20px"></i>' +
        '<i style="left:118px;height:14px"></i><i style="left:138px;height:8px"></i>' +
        '<i style="left:154px;height:17px"></i><i style="left:174px;height:12px"></i>';
      stage.appendChild(win);

      stage.appendChild(
        div("wall-logo", pos(58, 8, 190, 36),
          '<b>AGENT CO.</b><span>BUILD · SHIP · REPEAT</span>')
      );

      const neon = div("neon", pos(742, 6, 196, 34));
      neon.id = "neonSign";
      neon.textContent = this.world.neon;
      stage.appendChild(neon);

      const clock = div("wall-clock", pos(952, 8, 28, 28));
      clock.innerHTML = '<i class="hand hour" id="wallHour"></i><i class="hand minute" id="wallMinute"></i>';
      stage.appendChild(clock);

      stage.appendChild(
        div("poster", pos(608, 62, 38, 52), '<b>v2</b><span>less<br>meetings</span>')
      );

      // whiteboard
      const board = div("whiteboard", pos(340, 58, 250, 82));
      board.innerHTML =
        '<div class="wb-top"><span id="wbSprint">SPRINT 01</span><span id="wbDay">DAY 1</span></div>' +
        '<div class="wb-goal" id="wbGoal"></div>' +
        '<div class="wb-line"><span id="wbMeta"></span><i class="wb-bar"><b id="wbBar"></b></i></div>';
      stage.appendChild(board);

      // ----------------------------------------------------
      // rugs
      // ----------------------------------------------------
      stage.appendChild(div("office-rug open-top", pos(
        layout.openOffice.rugTop.x, layout.openOffice.rugTop.y,
        layout.openOffice.rugTop.w, layout.openOffice.rugTop.h
      )));
      stage.appendChild(div("office-rug open-bottom", pos(
        layout.openOffice.rugBottom.x, layout.openOffice.rugBottom.y,
        layout.openOffice.rugBottom.w, layout.openOffice.rugBottom.h
      )));
      stage.appendChild(div("aisle-rug", pos(
        layout.openOffice.aisleRug.x, layout.openOffice.aisleRug.y,
        layout.openOffice.aisleRug.w, layout.openOffice.aisleRug.h
      )));
      stage.appendChild(div("floor-deck", pos(148, 236, 504, 344)));

      // ----------------------------------------------------
      // boss office
      // ----------------------------------------------------
      let bossWindow =
        '<div class="bw-sky"></div>';
      const bwHeights = [12, 18, 9, 15, 21, 11, 17, 8, 14, 20, 10, 16, 13, 19];
      for (let i = 0; i < bwHeights.length; i++) {
        bossWindow += '<i style="left:' + (8 + i * 14) + 'px;height:' + bwHeights[i] + 'px"></i>';
      }
      bossWindow +=
        '<i class="bw-mullion m1"></i><i class="bw-mullion m2"></i>' +
        '<i class="bw-blinds"></i>';

      const bossEl = div("boss-office", pos(
        boss.rect.x, boss.rect.y, boss.rect.w, boss.rect.h
      ));
      const bdx = boss.rect.x;
      const bdy = boss.rect.y;
      bossEl.innerHTML =
        '<div class="boss-rug" style="left:' + (boss.rug.x - bdx) + "px;top:" +
          (boss.rug.y - bdy) + "px;width:" + boss.rug.w + "px;height:" + boss.rug.h + 'px;"></div>' +
        '<div class="boss-window" style="left:' + (boss.window.x - bdx) + "px;top:" +
          (boss.window.y - bdy) + "px;width:" + boss.window.w + "px;height:" +
          boss.window.h + 'px;">' + bossWindow + "</div>" +
        '<div class="boss-glass g-top"></div>' +
        '<div class="boss-glass g-left"></div>' +
        '<div class="boss-glass g-right"></div>' +
        '<div class="boss-glass g-bottom-left"></div>' +
        '<div class="boss-glass g-bottom-right"></div>' +
        '<div class="boss-door" style="left:' + (boss.door.x - bdx) + "px;top:" +
          (boss.door.y - bdy) + "px;width:" + boss.door.w + "px;height:" +
          boss.door.h + 'px;"><i class="door-leaf"></i><i class="door-handle"></i><span>CEO</span></div>' +
        '<div class="room-plaque boss-plaque"><i class="boss-occupancy" id="bossOccupancy"></i>CEO OFFICE</div>' +
        '<div class="boss-shelf" style="left:' + (boss.shelf.x - bdx) + "px;top:" +
          (boss.shelf.y - bdy) + "px;width:" + boss.shelf.w + "px;height:" +
          boss.shelf.h + 'px;"><i></i><i></i><i></i></div>' +
        '<div class="boss-guest-rug" style="left:' + (boss.guestRug.x - bdx) + "px;top:" +
          (boss.guestRug.y - bdy) + "px;width:" + boss.guestRug.w + "px;height:" +
          boss.guestRug.h + 'px;"></div>' +
        '<div class="boss-trophy-wall" style="left:' + (boss.trophyWall.x - bdx) + "px;top:" +
          (boss.trophyWall.y - bdy) + "px;width:" + boss.trophyWall.w + "px;height:" +
          boss.trophyWall.h + 'px;">' +
          '<i class="trophy t1"></i><i class="trophy t2"></i><i class="trophy t3"></i>' +
          '<span>FOUNDER\'S CLUB</span></div>' +
        '<div class="boss-sofa" style="left:' + (boss.sofa.x - bdx) + "px;top:" +
          (boss.sofa.y - bdy) + "px;width:" + boss.sofa.w + "px;height:" +
          boss.sofa.h + 'px;"><i class="bs-cushion c1"></i><i class="bs-cushion c2"></i><i class="bs-arm"></i></div>' +
        '<div class="boss-table" style="left:' + (boss.coffeeTable.x - bdx) + "px;top:" +
          (boss.coffeeTable.y - bdy) + "px;width:" + boss.coffeeTable.w + "px;height:" +
          boss.coffeeTable.h + 'px;"><i class="bt-cup"></i><i class="bt-mag"></i></div>' +
        '<div class="boss-armchair" style="left:' + (boss.armchair.x - bdx) + "px;top:" +
          (boss.armchair.y - bdy) + "px;width:" + boss.armchair.w + "px;height:" +
          boss.armchair.h + 'px;"><i class="ba-cushion"></i><i class="ba-arm"></i></div>' +
        '<div class="boss-bar" style="left:' + (boss.bar.x - bdx) + "px;top:" +
          (boss.bar.y - bdy) + "px;width:" + boss.bar.w + "px;height:" +
          boss.bar.h + 'px;"><i class="bar-mirror"></i><i class="bar-rail"></i>' +
          '<i class="bar-bottle b1"></i><i class="bar-bottle b2"></i><i class="bar-bottle b3"></i>' +
          '<i class="bar-glass g1"></i><i class="bar-glass g2"></i><span>BAR</span></div>' +
        '<div class="floor-lamp boss-lamp" style="left:' + (boss.lamp.x - bdx) + "px;top:" +
          (boss.lamp.y - bdy) + 'px;width:16px;height:62px;">' +
          '<i class="lamp-shade"></i><i class="lamp-pole"></i></div>';
      stage.appendChild(bossEl);

      // ----------------------------------------------------
      // executive assistant / reception
      // ----------------------------------------------------
      const reception = layout.reception;
      stage.appendChild(div("reception-rug", pos(
        reception.rug.x, reception.rug.y, reception.rug.w, reception.rug.h
      )));
      const secGlow = div("desk-glow", pos(
        reception.rug.x - 12, reception.rug.y + 8, reception.rug.w + 24, reception.rug.h - 16
      ));
      secGlow.style.setProperty("--glow", "#c9a0dc");
      stage.appendChild(secGlow);
      const sdesk = div("secretary-desk", pos(
        reception.desk.x, reception.desk.y, reception.desk.w, reception.desk.h
      ));
      sdesk.innerHTML =
        '<div class="sd-monitor"><i class="sd-screen"></i></div>' +
        '<div class="sd-phone"></div><div class="sd-paper"></div><div class="sd-cup"></div>' +
        '<div class="sd-name">小满 · EA</div>';
      stage.appendChild(sdesk);
      stage.appendChild(div("secretary-chair", pos(
        reception.chair.x, reception.chair.y, reception.chair.w, reception.chair.h
      )));

      // ----------------------------------------------------
      // meeting room
      // ----------------------------------------------------
      const room = div("meeting-room", pos(
        meeting.room.x, meeting.room.y, meeting.room.w, meeting.room.h
      ));
      room.id = "meetingRoom";
      const mdx = meeting.room.x;
      const mdy = meeting.room.y;
      room.innerHTML =
        '<div class="meeting-rug" style="left:' + (meeting.rug.x - mdx) + "px;top:" +
          (meeting.rug.y - mdy) + "px;width:" + meeting.rug.w + "px;height:" +
          meeting.rug.h + 'px;"></div>' +
        '<div class="glass-wall m-top"></div>' +
        '<div class="glass-wall m-left"></div>' +
        '<div class="glass-wall m-right"></div>' +
        '<div class="glass-wall m-bottom-left"></div>' +
        '<div class="glass-wall m-bottom-right"></div>' +
        '<div class="meeting-door" style="left:' + (meeting.door.x - mdx) + "px;top:" +
          (meeting.door.y - mdy) + "px;width:" + meeting.door.w + "px;height:" +
          meeting.door.h + 'px;"><i class="door-leaf"></i><i class="door-handle"></i><span>MEETING</span></div>' +
        '<div class="room-plaque meeting-plaque">MEETING ROOM</div>' +
        '<div class="meeting-screen" style="left:' + (meeting.screen.x - mdx) + "px;top:" +
          (meeting.screen.y - mdy) + "px;width:" + meeting.screen.w + "px;height:" +
          meeting.screen.h + 'px;"><i class="ms-glow"></i><span id="meetingScreenLabel">Q3 · SHIP IT</span>' +
          '<i class="ms-chart"><b></b><b></b><b></b><b></b></i></div>' +
        '<div class="meeting-table" style="left:' + (meeting.table.x - mdx) + "px;top:" +
          (meeting.table.y - mdy) + "px;width:" + meeting.table.w + "px;height:" +
          meeting.table.h + 'px;">' +
          '<i class="table-paper"></i><i class="table-mug"></i><i class="table-pen"></i>' +
          '<i class="table-laptop"></i><i class="table-pitcher"></i><i class="table-plant"></i>' +
          "</div>";
      meeting.seats.forEach((seat) => {
        room.appendChild(div(
          "meeting-chair",
          pos(seat.x - mdx - 15, seat.y - mdy - 13, 30, 14)
        ));
      });
      stage.appendChild(room);
      this.meetingRoom = room;

      // ----------------------------------------------------
      // lounge
      // ----------------------------------------------------
      const lounge = div("lounge-rug", pos(650, 430, 300, 150));
      lounge.innerHTML = '<div class="room-tag lounge-tag">LOUNGE</div>';
      stage.appendChild(lounge);

      const couch = div("couch", pos(690, 480, 150, 40));
      couch.innerHTML =
        '<i class="cushion c1"></i><i class="cushion c2"></i>' +
        '<i class="couch-arm"></i><i class="throw"></i>';
      stage.appendChild(couch);

      const coffee = div("coffee-machine", pos(900, 435, 36, 58));
      coffee.innerHTML =
        '<i class="coffee-light"></i><i class="coffee-screen"></i><i class="coffee-slot"></i>' +
        '<i class="steam s1"></i><i class="steam s2"></i>';
      stage.appendChild(coffee);

      const side = div("side-table", pos(800, 520, 50, 28));
      side.innerHTML = '<i class="side-mug"></i><i class="side-mag"></i>';
      stage.appendChild(side);

      const beanbag = div("beanbag", pos(850, 548, 30, 22));
      beanbag.innerHTML = '<i></i>';
      stage.appendChild(beanbag);

      const cat = div("cat", pos(768, 484, 26, 16));
      cat.innerHTML =
        '<i class="cat-tail"></i><i class="cat-body"></i><i class="cat-head"></i>' +
        '<i class="cat-ear e1"></i><i class="cat-ear e2"></i><i class="cat-eye"></i>' +
        '<i class="cat-z">z</i>';
      stage.appendChild(cat);

      const lamp = div("floor-lamp", pos(662, 468, 16, 62));
      lamp.innerHTML = '<i class="lamp-shade"></i><i class="lamp-pole"></i>';
      stage.appendChild(lamp);

      const coffeeSign = div("coffee-sign", pos(894, 414, 48, 14), "COFFEE");
      stage.appendChild(coffeeSign);

      // ----------------------------------------------------
      // desks
      // ----------------------------------------------------
      AO.DESKS.forEach((desk) => {
        const agent = AO.AGENTS.find((a) => a.deskId === desk.id);
        const role = agent ? AO.ROLES[agent.role] : null;
        const color = role ? role.color : "#55d6c2";
        const isBoss = !!desk.boss;
        const w = isBoss ? 104 : (desk.w || 90);
        const h = isBoss ? 46 : (desk.h || 42);
        const left = desk.x - w / 2;
        const top = desk.y - (isBoss ? 74 : 70);
        const halo = div("desk-glow", pos(
          desk.x - (isBoss ? 72 : 60),
          desk.y - (isBoss ? 64 : 58),
          isBoss ? 144 : 120,
          isBoss ? 118 : 110
        ));
        halo.style.setProperty("--glow", color);
        stage.appendChild(halo);

        const d = div("desk" + (isBoss ? " boss-desk" : "") +
          (desk.hot ? " hot-desk" : ""), pos(left, top, w, h));
        d.setAttribute("data-desk", desk.id);
        d.style.setProperty("--glow", color);
        d.innerHTML =
          '<div class="desk-monitor' + (isBoss ? " dual" : "") + '">' +
            '<i class="desk-screen"></i>' +
            (isBoss ? '<i class="desk-screen second"></i>' : "") +
          "</div>" +
          '<div class="desk-keyboard"></div>' +
          '<div class="desk-mug"></div>' +
          '<div class="desk-paper"></div>' +
          '<div class="desk-lamp' + (isBoss ? " exec-lamp" : "") + '"><i></i></div>' +
          (isBoss ? '<div class="desk-nameplate">林澈 · CEO</div>' : "") +
          ((desk.id === "d2" || desk.id === "d6" || isBoss)
            ? '<div class="desk-plant"><i></i><i></i></div>' : "");
        stage.appendChild(d);

        const chair = div(
          isBoss ? "exec-chair" : "desk-chair",
          pos(desk.x - (isBoss ? 16 : 13), desk.y - (isBoss ? 20 : 16),
            isBoss ? 32 : 26, isBoss ? 18 : 14)
        );
        stage.appendChild(chair);

        if (agent) {
          const label = div(
            "desk-label" + (isBoss ? " boss-label" : "") + (desk.hot ? " hot-label" : ""),
            pos(desk.x - (isBoss ? 52 : 48), desk.y - (isBoss ? 92 : 84),
              isBoss ? 104 : 96, 12),
            '<i style="background:' + color + '"></i>' +
              agent.name + (isBoss ? " · CEO" : "")
          );
          stage.appendChild(label);
        } else if (desk.hot) {
          const label = div(
            "desk-label hot-label empty",
            pos(desk.x - 52, desk.y - 84, 104, 12),
            '<i style="background:#3d5364"></i>HOT DESK · 空位'
          );
          stage.appendChild(label);
        }
      });

      // planter dividers
      [
        { x: 205, y: 394, w: 50, h: 12 },
        { x: 385, y: 394, w: 50, h: 12 }
      ].forEach((p) => {
        const planter = div("planter", pos(p.x, p.y, p.w, p.h));
        planter.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
        stage.appendChild(planter);
      });

      // ----------------------------------------------------
      // plants + left wall storage
      // ----------------------------------------------------
      AO.LAYOUT.plants.forEach((p) => {
        const plant = div("plant" + (p.big ? " plant-big" : ""),
          pos(p.x - 12, p.y - 42, 24, 42));
        plant.innerHTML =
          '<i class="pot"></i><i class="leaf l1"></i><i class="leaf l2"></i>' +
          '<i class="leaf l3"></i><i class="leaf l4"></i>';
        stage.appendChild(plant);
      });

      const shelf = div("shelf", pos(
        layout.leftFurniture.shelf.x, layout.leftFurniture.shelf.y,
        layout.leftFurniture.shelf.w, layout.leftFurniture.shelf.h
      ));
      shelf.innerHTML = '<i></i><i></i><i></i><i></i>';
      stage.appendChild(shelf);

      const rack = div("server-rack", pos(
        layout.leftFurniture.serverRack.x, layout.leftFurniture.serverRack.y,
        layout.leftFurniture.serverRack.w, layout.leftFurniture.serverRack.h
      ));
      rack.innerHTML = '<i></i><i></i><i></i><i></i>';
      stage.appendChild(rack);

      const printer = div("printer", pos(
        layout.leftFurniture.printer.x, layout.leftFurniture.printer.y,
        layout.leftFurniture.printer.w, layout.leftFurniture.printer.h
      ));
      printer.innerHTML =
        '<i class="printer-slot"></i><i class="printer-paper"></i><i class="printer-led"></i>';
      stage.appendChild(printer);

      // wing door
      const door = div("door", pos(962, 310, 38, 100));
      door.innerHTML = '<i class="door-handle"></i><span>EXIT</span>';
      stage.appendChild(door);

      // floor stencils
      stage.appendChild(div("zone-label", pos(140, 556, 150, 14), "OPEN OFFICE"));
      stage.appendChild(div("zone-label", pos(672, 562, 120, 14), "LOUNGE"));
    }

    buildAmbience() {
      if (!this.ambienceLayer) return;
      const layer = this.ambienceLayer;
      const dust = div("ambience-dust");
      const motes = [
        [80, 120, 2, 11], [210, 90, 1, 15], [350, 180, 2, 13], [520, 120, 1, 17],
        [690, 90, 2, 12], [820, 160, 1, 16], [930, 95, 2, 14], [140, 300, 1, 18],
        [300, 360, 2, 12], [460, 290, 1, 15], [610, 360, 2, 13], [760, 300, 1, 17],
        [880, 380, 2, 14], [200, 520, 1, 16], [380, 550, 2, 12], [540, 500, 1, 19],
        [700, 560, 2, 13], [900, 520, 1, 15], [470, 80, 1, 14], [590, 220, 2, 16]
      ];
      motes.forEach(function (m, i) {
        const mote = document.createElement("i");
        mote.style.left = m[0] + "px";
        mote.style.top = m[1] + "px";
        mote.style.width = m[2] + "px";
        mote.style.height = m[2] + "px";
        mote.style.animationDelay = (-i * 0.73) + "s";
        mote.style.animationDuration = (m[3] + 6) + "s";
        dust.appendChild(mote);
      });
      layer.appendChild(dust);

      const beams = div("ambience-beams");
      beams.innerHTML = '<i class="b1"></i><i class="b2"></i><i class="b3"></i>';
      layer.appendChild(beams);

      const monitors = div("ambience-monitors");
      AO.DESKS.filter(function (desk) { return !desk.boss; }).forEach(function (desk, i) {
        const glow = document.createElement("i");
        glow.style.left = (desk.x - 22 - (i % 2) * 3) + "px";
        glow.style.top = (desk.y - 57 + (i % 3) * 2) + "px";
        glow.style.animationDelay = (-i * 0.9) + "s";
        monitors.appendChild(glow);
      });
      layer.appendChild(monitors);

      const projector = div("ambience-projector");
      projector.style.left = (AO.MEETING.screen.x - 6) + "px";
      projector.style.top = (AO.MEETING.screen.y + AO.MEETING.screen.h) + "px";
      projector.style.width = (AO.MEETING.screen.w + 12) + "px";
      projector.style.height = (AO.MEETING.table.y - AO.MEETING.screen.y - AO.MEETING.screen.h + 10) + "px";
      layer.appendChild(projector);

      const steam = div("ambience-steam");
      steam.style.left = "914px";
      steam.style.top = "430px";
      steam.innerHTML = '<i></i><i></i><i></i><i></i>';
      layer.appendChild(steam);

      const scan = div("ambience-scan");
      layer.appendChild(scan);

      const roomba = document.createElement("i");
      roomba.className = "ambience-roomba";
      roomba.setAttribute("aria-hidden", "true");
      layer.appendChild(roomba);

      const pendants = div("ambience-pendants");
      [190, 470, 790].forEach(function (x, i) {
        const pendant = document.createElement("i");
        pendant.className = "ambience-pendant p" + i;
        pendant.style.left = x + "px";
        pendant.innerHTML = '<b></b><u></u>';
        pendants.appendChild(pendant);
      });
      layer.appendChild(pendants);
    }

    buildCharacters() {
      this.world.agents.forEach((a) => {
        const role = AO.ROLES[a.role];
        const el = div("agent", pos(a.x, a.y, 0, 0));
        el.setAttribute("data-id", a.id);
        el.style.zIndex = String(100 + Math.round(a.y));
        el.style.setProperty("--role", role.color);
        el.tabIndex = 0;
        el.setAttribute("role", "button");
        el.innerHTML =
          '<div class="agent-hit"></div>' +
          '<div class="agent-shadow"></div>' +
          '<div class="agent-aura"></div>' +
          '<div class="agent-ring" style="--role:' + role.color + '"></div>' +
          '<div class="agent-bubble"></div>' +
          '<div class="agent-badge"></div>' +
          '<div class="sprite"><div class="sprite-inner">' +
          AO.spriteSVG(a, 44) +
          "</div></div>" +
          '<div class="nametag"><i style="background:' + role.color + '"></i><span>' +
          a.name + "</span></div>" +
          '<div class="agent-progress"><i></i></div>';
        this.charLayer.appendChild(el);
        this.charEls[a.id] = el;
      });

      const sec = AO.SECRETARY;
      if (sec) {
        const secRole = AO.ROLES[sec.role] || { color: sec.shirt };
        const npc = div("npc secretary", pos(sec.x, sec.y, 0, 0));
        npc.style.zIndex = String(100 + Math.round(sec.y));
        npc.innerHTML =
          '<div class="npc-shadow"></div>' +
          '<div class="sprite"><div class="sprite-inner">' +
          AO.spriteSVG(sec, 44) +
          "</div></div>" +
          '<div class="nametag"><i style="background:' + secRole.color +
          '"></i><span>' + sec.name + " · EA</span></div>";
        this.charLayer.appendChild(npc);
      }
    }

    select(id) {
      this.selectedId = id;
      this.renderInspector();
      this.updateCharacters();
    }

    fit() {
      const vw = this.viewport.clientWidth;
      const vh = this.viewport.clientHeight;
      if (!vw || !vh) return;
      const scale = Math.min(vw / AO.STAGE.w, vh / AO.STAGE.h);
      const x = (vw - AO.STAGE.w * scale) / 2;
      const y = (vh - AO.STAGE.h * scale) / 2;
      this.stage.style.transform =
        "translate(" + x + "px," + y + "px) scale(" + scale + ")";
      const hitScale = scale > 0 && scale < 0.92
        ? Math.min(3, 0.92 / scale)
        : 1;
      this.stage.style.setProperty("--hit-scale", hitScale.toFixed(3));
    }

    setMoveDuration(ms) {
      this.stage.style.setProperty("--move", ms + "ms");
    }

    demoOff() {
      return !!(AO.DemoMode && !AO.DemoMode.enabled);
    }

    render(force) {
      const real = this.demoOff();
      if (!real) {
        this.updateCharacters();
        this.updateDesks();
        if (this.fx) {
          this.fx.update(this.selectedId);
          this.detectBursts();
        }
      }
      this.renderRoster();
      if (!real && this.boardView === "audit") this.renderAudit();
      else this.renderBoard();
      this.renderHeader();
      this.renderTelemetry();
      this.renderWhiteboard();
      if (!real) this.renderInspector();
      this.renderFeed(!!force);
      if (!real) this.updateMeetingRoom();
      if (this.drawerMode && !this.drawer.hidden) this.syncDrawerLive();
      if (this.traceLab) this.traceLab.refresh();
    }

    drawerSignature() {
      if (!this.drawerMode) return "";
      const w = this.world;
      if (this.drawerMode === "task") {
        const task = this.engine.taskById(this.drawerId);
        if (!task) return "gone";
        return [
          "task", task.id, task.status, task.progress, task.assignee || "",
          task.reviewerId || "", task.reworkCount,
          task.checks.map(function (c) { return c.id + ":" + c.status; }).join(","),
          w.ledger.length, task.externalResult || "",
          (task.externalEvidence || []).join("|")
        ].join("~");
      }
      if (this.drawerMode === "external") {
        const agent = this.external ? this.external.agentById(this.drawerId) : null;
        if (!agent) return "gone";
        return [
          "external", agent.name, agent.status, agent.eventCount || 0,
          (agent.skills || []).join("|"), agent.roleOverride || "",
          agent.avatar || "", agent.avatarText || "", agent.avatarColor || "",
          JSON.stringify(this.external.missionTasksFor(agent.id) || []),
          JSON.stringify(this.external.assignmentsFor(agent.id) || [])
        ].join("~");
      }
      const agent = this.engine.agentById(this.drawerId);
      if (!agent) return "gone";
      const task = this.engine.tasksForAgent
        ? this.engine.tasksForAgent(agent.id)
        : w.tasks.filter(function (t) { return t.assignee === agent.id; });
      return [
        "agent", agent.name, agent.state, agent.taskId || "", agent.energy,
        agent.mood, w.ledger.length,
        task.map(function (t) { return t.id + ":" + t.status + ":" + t.progress; }).join(",")
      ].join("~");
    }

    syncDrawerLive() {
      const sig = this.drawerSignature();
      if (sig === this.drawerSig) return;
      const activeTag = document.activeElement && document.activeElement.tagName;
      if (this.drawer.contains(document.activeElement) &&
          (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT")) {
        return;
      }
      const scroll = this.drawer.scrollTop;
      const focusables = Array.from(this.drawer.querySelectorAll(
        "button, a[href], input, select, textarea"
      ));
      const focusIndex = focusables.indexOf(document.activeElement);
      this.renderDrawer();
      this.drawer.scrollTop = scroll;
      if (focusIndex >= 0) {
        const next = Array.from(this.drawer.querySelectorAll(
          "button, a[href], input, select, textarea"
        ))[focusIndex];
        if (next) next.focus({ preventScroll: true });
      }
    }

    detectBursts() {
      const w = this.world;
      const self = this;

      w.tasks.forEach(function (t) {
        if (t.status !== "done" || self.doneSeen.has(t.id)) return;
        self.doneSeen.add(t.id);
        const author = w.agents.find(function (a) { return a.id === t.assignee; });
        const role = AO.ROLES[t.role];
        const color = role ? role.color : "#55d6c2";
        if (author) self.fx.burst(author.x, author.y - 22, color);
        self.fx.burst(465, 140, color);
      });

      if (w.meeting && !this.wasMeetingFx) {
        this.fx.burst(800, 235, "#f2b544");
      }
      this.wasMeetingFx = !!w.meeting;

      if (w.done && !this.wasDoneFx) {
        this.wasDoneFx = true;
        [
          [745, 520, "#f2b544"],
          [610, 515, "#55d6c2"],
          [800, 500, "#b58cff"]
        ].forEach(function (b) {
          self.fx.burst(b[0], b[1], b[2]);
        });
      }
      if (!w.done) this.wasDoneFx = false;
    }

    updateDesks() {
      const w = this.world;
      AO.DESKS.forEach((desk) => {
        const el = this.officeLayer.querySelector('[data-desk="' + desk.id + '"]');
        if (!el) return;
        const agent = w.agents.find((a) => a.deskId === desk.id);
        const active =
          !!agent && (agent.state === "working" || agent.state === "reviewing");
        el.classList.toggle("is-active", active);
      });
    }

    updateCharacters() {
      const tick = this.world.tick;
      this.world.agents.forEach((a) => {
        const el = this.charEls[a.id];
        if (!el) return;
        el.style.left = a.x + "px";
        el.style.top = a.y + "px";
        el.style.zIndex = String(100 + Math.round(a.y));

        STATE_ORDER.forEach((s) => el.classList.remove("state-" + s));
        el.classList.add("state-" + a.state);
        el.classList.toggle("flip", !!a.flip);
        el.classList.toggle("selected", a.id === this.selectedId);
        const charTask = a.taskId ? this.engine.taskById(a.taskId) : null;
        const charLabel = a.name + " · " +
          (AO.STATE_LABELS[a.state] || a.state) +
          (charTask ? " · " + charTask.title + " " + Math.round(charTask.progress || 0) + "%" : "");
        if (el.title !== charLabel) el.title = charLabel;
        if (el.getAttribute("aria-label") !== charLabel) el.setAttribute("aria-label", charLabel);

        const badge = el.querySelector(".agent-badge");
        if (badge) {
          badge.textContent = AO.STATE_BADGES[a.state] || "·";
          badge.setAttribute("title", AO.STATE_LABELS[a.state] || a.state);
        }

        const bubble = el.querySelector(".agent-bubble");
        if (bubble) {
          if (a.bubble && a.bubbleUntil > tick) {
            bubble.textContent = a.bubble;
            bubble.classList.add("show");
          } else {
            bubble.classList.remove("show");
          }
        }

        const task = a.taskId ? this.engine.taskById(a.taskId) : null;
        const live = this.missionActivity && this.missionActivity.localAgentId === a.id;
        const progress = el.querySelector(".agent-progress");
        if (progress) {
          const show = !this.demoOff() && !live && !!task &&
            (a.state === "working" || a.state === "reviewing");
          progress.classList.toggle("show", show);
          const bar = progress.querySelector("i");
          if (bar) {
            const pct = a.state === "reviewing" ? 100 :
              Math.max(0, Math.min(100, Number(task && task.progress) || 0));
            bar.style.width = show ? pct + "%" : "0%";
          }
          progress.title = show && task ? task.title + " · " +
            (a.state === "reviewing" ? "评审中" : Math.round(task.progress) + "%") : "";
        }
      });
    }

    renderRoster() {
      const w = this.world;
      const real = this.demoOff();
      let html = "";
      if (!real) {
        w.agents.forEach((a) => {
          const role = AO.ROLES[a.role];
          const task = a.taskId ? this.engine.taskById(a.taskId) : null;
          const live = this.missionActivity && this.missionActivity.localAgentId === a.id;
          const stateLabel = live ? AO.t("missionLiveRunning") : (AO.STATE_LABELS[a.state] || a.state);
          const pct = task ? Math.round(task.progress || 0) : null;
          const detail = live ? (this.missionActivity.taskTitle || AO.t("missionLiveRunning")) :
            (task ? task.title :
              (a.intent || a.activity || ""));
          html +=
            '<button class="team-card state-' + a.state +
            (live ? " mission-active" : "") +
            (a.id === this.selectedId ? " selected" : "") +
            '" data-agent="' + a.id + '" style="--role:' + role.color + '" title="' +
            esc(live ? (this.missionActivity.missionTitle + " · " + detail) : a.trait) + '">' +
            '<span class="team-avatar">' + AO.spriteSVG(a, 26) + "</span>" +
            '<span class="team-main">' +
            '<span class="team-line"><b>' + esc(a.name) + "</b>" +
            '<em class="role-pill">' + role.short + "</em></span>" +
            '<span class="team-state"><i class="state-dot ' + a.state + '"></i>' +
            stateLabel + " · " + detail + "</span>" +
            '<span class="energy"><i style="width:' + Math.round(a.energy) + '%"></i></span>' +
            "</span>" +
            (pct != null ?
              '<span class="team-mood task-pct" title="任务进度 ' + pct + '% · 士气 ' +
              Math.round(a.mood) + '">' + pct + "%</span>" :
              '<span class="team-mood" title="士气 ' + Math.round(a.mood) + '">' +
              Math.round(a.mood) + "</span>") +
            "</button>";
        });
      }
      const ext = this.external ? this.external.agents : [];
      if (ext.length) {
        const liveState = this.missionLive || AO.missionLive;
        const liveMission = liveState && liveState.realMission;
        const liveDetail = liveState && liveState.realDetail;
        const liveStatus = (liveMission && liveMission.autoRun && liveMission.autoRun.status) || "";
        const liveActive = ["running", "discussing", "queued", "waiting_boss", "scheduled"].indexOf(liveStatus) >= 0;
        const liveCelebrating = !!(liveMission && liveState.realTransient && liveStatus === "done");
        const liveMembers = new Set(((liveMission && liveMission.members) || []).map(function (m) { return m.id; }));
        html += '<div class="team-external-title"><span>EXTERNAL AGENTS</span><b>' +
          ext.length + "</b></div>";
        ext.forEach((a, index) => {
          const online = a.status === "online";
          const ready = online || !!(a.runtime || a.endpoint);
          const roleName = AO.lang === "en" ? a.roleLabelEn : a.roleLabelZh;
          const idlePlan = real && !liveMission && liveState && typeof liveState.realIdlePlan === "function" ?
            liveState.realIdlePlan(a, index, Date.now()) : null;
          const currentLive = this.missionActivity && this.missionActivity.external &&
            this.missionActivity.agentId === a.id;
          const liveProgress = currentLive && this.missionActivity.total ?
            Math.min(100, Math.round((this.missionActivity.done / this.missionActivity.total) * 100)) : 0;
          const memberLive = real && !currentLive && (liveActive || liveCelebrating) && liveMembers.has(a.id);
          const memberTask = memberLive && liveDetail && liveDetail.id === liveMission.id ?
            ((liveDetail.tasks || []).find(function (task) {
              return task.assigneeId === a.id &&
                ["in_progress", "review", "assigned", "blocked"].indexOf(task.status) >= 0;
            }) || (liveDetail.tasks || []).find(function (task) {
              return task.assigneeId === a.id;
            })) : null;
          const missionPct = memberLive ? Math.max(0, Math.min(100,
            Math.round(Number((liveMission.stats || {}).progress ||
              (liveMission.autoRun || {}).completed || 0)))) : 0;
          const memberProgress = (memberLive && liveCelebrating) ? 100 :
            (memberLive && (liveStatus === "discussing" ||
            liveStatus === "queued" || liveStatus === "scheduled" ||
            liveStatus === "waiting_boss")) ? missionPct :
            (memberTask ? Math.max(0, Math.min(100, Math.round(Number(memberTask.progress ||
              (memberTask.status === "done" ? 100 : 0))))) : 0);
          const activeCard = currentLive || memberLive;
          const progressWidth = currentLive ? liveProgress : (memberLive ? Math.max(2, memberProgress) : (ready ? 62 : 18));
          let stateClass = currentLive || memberLive ? "mission" :
            (idlePlan && idlePlan.state !== "idle" ?
              (idlePlan.state === "reviewing" ? "working" : idlePlan.state) :
              (online ? "online" : (ready ? "ready" : "offline")));
          let stateText = "";
          if (currentLive) {
            stateText = AO.t("missionLiveRunning") + " · " + (this.missionActivity.taskTitle || "");
          } else if (memberLive) {
            if (liveCelebrating) {
              stateText = AO.t("missionLiveDone") + " · " + (liveMission.title || "");
            } else if (liveStatus === "waiting_boss") {
              stateText = AO.t("missionLiveWaiting") + " · " + (liveMission.title || "");
            } else if (liveStatus === "discussing" || liveStatus === "queued" || liveStatus === "scheduled") {
              stateText = AO.t("missionLiveDiscussing") + " · " + (liveMission.title || "");
            } else if (memberTask) {
              const taskLabel = memberTask.status === "review" ? AO.t("boardReview") :
                memberTask.status === "assigned" ? AO.t("missionLiveQueued") :
                memberTask.status === "blocked" ? AO.t("statusBlocked") :
                memberTask.status === "done" ? AO.t("missionLiveDone") :
                AO.t("missionLiveRunning");
              stateText = taskLabel + " · " + memberTask.title;
            } else {
              stateText = AO.t("realModeReady") + " · " + (liveMission.title || "");
            }
          } else if (idlePlan) {
            stateText = idlePlan.bubble || (idlePlan.state === "reviewing" ? "复盘交付" :
              (idlePlan.state === "coffee" ? "咖啡时间" :
                (idlePlan.state === "chatting" ? "回群消息" : "巡检中 · 待命")));
          } else {
            stateText = (ready ? AO.t("realModeReady") : (roleName || a.role || "operator")) + " · " +
              (a.provider ? a.provider + (a.model ? " · " + a.model : "") : (a.runtime || "external")) +
              (ready ? " · 可调度" : " · " + (a.eventCount || 0) + " ev");
          }
          const moodText = currentLive ? liveProgress + "%" :
            (memberLive ? memberProgress + "%" :
              (idlePlan ? (idlePlan.state === "coffee" ? "☕" :
                (idlePlan.state === "chatting" ? "…" :
                  (idlePlan.state === "reviewing" ? "◎" : "·"))) :
                (ready ? AO.t("realModeReady") : "⇢")));
          html += '<button class="team-card external-card' + (activeCard ? " mission-active" : "") +
            '" data-external="' + a.id +
            '" title="' + esc(activeCard && liveMission ?
              (liveMission.title + " · " + (currentLive ? (this.missionActivity.taskTitle || "") : (memberTask ? memberTask.title : stateText))) :
              (a.brand ? a.brand + " · " : "") + (a.note || a.endpoint || "外部 agent") +
              (ready && !online ? " · 未连接心跳，仍可由本机 AI 调度" : "")) + '">' +
            '<span class="ext-glyph' + (a.logoText ? " brand-mark" : "") +
            (a.logoSource === "preset" ? " emoji" : "") + AO.logoClass(a) +
            '" style="--c:' + esc(a.logoColor || "#b58cff") + '">' + AO.logoMarkHTML(a) + '</span>' +
            '<span class="team-main"><span class="team-line"><b>' + esc(a.name) +
            '</b><em class="role-pill ext">EXT</em></span>' +
            '<span class="team-state"><i class="state-dot ' + stateClass +
            '"></i>' + esc(stateText) + '</span>' +
            '<span class="energy ext-bar"><i style="width:' + progressWidth +
            '%"></i></span></span>' +
            '<span class="team-mood">' + esc(moodText) + '</span></button>';
        });
      }
      const waitingPairs = this.external ? this.external.pendingPairs() : [];
      if (waitingPairs.length) {
        html += '<div class="team-external-title waiting"><span>WAITING FOR AGENT</span><b>' +
          waitingPairs.length + "</b></div>";
        waitingPairs.forEach((p) => {
          html += '<button class="team-card external-card waiting-card" data-ext-pair-open="' +
            p.code + '"><span class="ext-glyph">⌁</span>' +
            '<span class="team-main"><span class="team-line"><b>' + esc(p.code) +
            '</b><em class="role-pill ext">CODE</em></span>' +
            '<span class="team-state"><i class="state-dot waiting"></i>等待接入 · 一次性</span>' +
            '<span class="energy ext-bar"><i style="width:42%"></i></span></span>' +
            '<span class="team-mood">⌁</span></button>';
        });
      }
      if (real && !ext.length && !waitingPairs.length) {
        html += '<div class="team-real-empty"><b>' + esc(AO.t("realModeTeamTitle")) +
          '</b><p>' + esc(AO.t("realModeTeamEmpty")) + '</p>' +
          '<button type="button" data-real-open-external>' +
          esc(AO.t("realModeAddAgent")) + '</button></div>';
      }
      if (html !== this.lastRosterHTML) {
        const buttons = Array.from(this.teamList.querySelectorAll("button"));
        const focusIndex = buttons.indexOf(document.activeElement);
        const scroll = this.teamList.scrollTop;
        this.teamList.innerHTML = html;
        this.lastRosterHTML = html;
        this.teamList.scrollTop = scroll;
        if (focusIndex >= 0) {
          const next = this.teamList.querySelectorAll("button")[focusIndex];
          if (next) next.focus({ preventScroll: true });
        }
      }

      let morale;
      if (real) {
        const ext = (this.external && this.external.agents) || [];
        const ready = ext.filter(function (agent) {
          return agent.status === "online" || !!(agent.runtime || agent.endpoint);
        }).length;
        const live = this.missionLive || AO.missionLive;
        const overview = live && live.lastOverview;
        const missions = ((overview && overview.missions) || []).filter(function (mission) { return !mission.archived; });
        const progress = missions.length ?
          missions.reduce(function (sum, mission) {
            return sum + Number((mission.stats || {}).progress || 0);
          }, 0) / missions.length : 0;
        const active = missions.filter(function (mission) {
          return Number((mission.stats || {}).progress || 0) < 100;
        }).length;
        const readyRatio = ext.length ? ready / ext.length : 0;
        morale = Math.min(100, 40 + readyRatio * 25 + progress * 0.35 + (active ? 10 : 0));
      } else {
        morale = w.agents.reduce((sum, a) => sum + a.mood, 0) / Math.max(1, w.agents.length);
      }
      const moraleEl = document.getElementById("teamMorale");
      if (moraleEl) {
        moraleEl.textContent = Math.round(morale) + " / 100";
        moraleEl.title = real ? AO.t("realMoraleHint") : "";
      }
      const moraleBar = document.getElementById("moraleBar");
      if (moraleBar) {
        moraleBar.style.width = morale + "%";
        moraleBar.title = real ? AO.t("realMoraleHint") : "";
      }
      const teamSub = document.getElementById("teamSub");
      if (teamSub) {
        const hot = AO.DESKS.filter((d) => d.hot &&
          !w.agents.some((a) => a.deskId === d.id)).length;
        const extCount = this.external ? this.external.agents.length : 0;
        const waiting = this.external ? this.external.pendingPairs().length : 0;
        if (real) {
          const ready = this.external ? this.external.agents.filter(function (a) {
            return a.status === "online" || !!(a.runtime || a.endpoint);
          }).length : 0;
          teamSub.textContent = AO.t("realModeTeamSub", {
            count: extCount,
            online: ready
          });
        } else {
          teamSub.textContent = w.agents.length + " " + AO.t("local") +
            (extCount ? " · " + extCount + " " + AO.t("external") : "") +
            (waiting ? " · " + waiting + " " + AO.t("waiting") : "") +
            " · " + (hot ? hot + " " + AO.t("hotDesk") : AO.t("hotDeskFull"));
        }
      }
      const teamHint = document.querySelector(".team-panel .hint");
      if (teamHint) {
        const hintText = AO.t(real ? "realModeTeamHint" : "teamHint");
        if (teamHint.textContent !== hintText) teamHint.textContent = hintText;
      }
      if (AO.DemoMode && AO.DemoMode.refreshCover) AO.DemoMode.refreshCover();
    }

    renderRealBoard() {
      if (!this.board) return;
      this.boardView = "board";
      this.board.hidden = false;
      if (this.auditView) this.auditView.hidden = true;
      if (this.boardTabs) {
        this.boardTabs.querySelectorAll("[data-view]").forEach((button) => {
          const on = button.getAttribute("data-view") === "board";
          button.classList.toggle("active", on);
          button.setAttribute("aria-selected", on ? "true" : "false");
        });
      }
      const live = this.missionLive || AO.missionLive;
      const overview = (live && live.lastOverview) || null;
      const missions = ((overview && overview.missions) || [])
        .filter(function (mission) { return !mission.archived; })
        .slice()
        .sort(function (a, b) {
          return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
        });
      let focusHtml = "";
      const focusMission = live && live.realMission;
      const focusDetail = live && live.realDetail;
      if (focusMission && focusDetail && focusDetail.id === focusMission.id) {
        const focusTasks = focusDetail.tasks || [];
        const focusStats = focusMission.stats || {};
        const focusAuto = focusMission.autoRun || {};
        const focusTotal = Number(focusAuto.total || focusStats.tasks || focusTasks.length || 0);
        const focusDone = Number(focusAuto.completed || focusStats.done || 0);
        const focusPct = focusTotal ? Math.min(100, Math.round((focusDone / focusTotal) * 100)) : 0;
        const groups = [
          { key: "active", label: "进行中", rows: focusTasks.filter(function (t) { return t.status === "in_progress" || t.status === "blocked"; }) },
          { key: "review", label: "评审中", rows: focusTasks.filter(function (t) { return t.status === "review"; }) },
          { key: "todo", label: "待开始", rows: focusTasks.filter(function (t) { return t.status === "assigned" || t.status === "backlog"; }) },
          { key: "done", label: "已完成", rows: focusTasks.filter(function (t) { return t.status === "done"; }).slice(-3) }
        ];
        const groupsHtml = groups.map(function (group) {
          if (!group.rows.length) return "";
          const taskRows = group.rows.slice(0, 5).map(function (task) {
            const pct = Math.max(0, Math.min(100, Math.round(Number(task.progress || (task.status === "done" ? 100 : 0)))));
            return '<button type="button" class="real-focus-task status-' + esc(task.status || "") +
              '" data-real-mission="' + esc(focusMission.id) + '"><i></i><span><b>' +
              esc(task.title || task.id) + '</b><em>' + esc(task.assigneeName || "未分配") +
              '</em></span><strong>' + pct + '%</strong></button>';
          }).join("");
          return '<div class="real-focus-group"><div class="real-focus-label"><span>' +
            esc(group.label) + '</span><b>' + group.rows.length + '</b></div>' + taskRows + '</div>';
        }).join("");
        focusHtml = '<div class="real-board-focus"><div class="real-focus-head"><span>MISSION FOCUS</span><b>' +
          focusPct + '%</b></div><div class="real-focus-title">' + esc(focusMission.title || focusMission.id) +
          '</div><div class="real-focus-bar"><i style="width:' + focusPct + '%"></i></div>' +
          '<div class="real-focus-meta"><span>' + focusDone + '/' + focusTotal + ' 任务</span><span>' +
          (focusAuto.currentTaskTitle ? esc(focusAuto.currentTaskTitle) : esc(this.autorunShort(focusAuto.status || "off"))) +
          '</span></div>' + (groupsHtml || '<div class="real-focus-none">任务正在编排中…</div>') + '</div>';
      }
      const rows = missions.map((mission) => {
        const auto = mission.autoRun || {};
        const stats = mission.stats || {};
        const status = auto.status || "off";
        const done = Number(auto.completed || stats.done || 0);
        const total = Number(auto.total || stats.tasks || 0);
        const progress = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
        const autoLabel = this.autorunShort(status);
        const detail = [autoLabel, done + "/" + total];
        if (stats.approvals) detail.push(stats.approvals + " " + AO.t("missionApprovals"));
        if (auto.currentTaskTitle) detail.push(auto.currentTaskTitle);
        return '<button type="button" class="real-mission-row" data-real-mission="' +
          esc(mission.id) + '"><i class="real-mission-dot ' + esc(status) + '"></i>' +
          '<span class="real-mission-copy"><b>' + esc(mission.title || mission.id) +
          '</b><span>' + esc(detail.join(" · ")) + '</span></span>' +
          '<em>' + progress + '%</em></button>';
      }).join("");
      let nextActionHtml = "";
      if (!focusMission && missions.length) {
        const latest = missions[0];
        const latestStats = latest.stats || {};
        const latestAuto = latest.autoRun || {};
        const latestDone = Number(latestAuto.completed || latestStats.done || 0);
        const latestTotal = Number(latestAuto.total || latestStats.tasks || 0);
        const finished = latestTotal > 0 && latestDone >= latestTotal;
        const aiReady = !!(overview && overview.ai && overview.ai.available);
        nextActionHtml = '<div class="real-next-action"><span>NEXT ACTION</span><b>' +
          esc(finished ? "本轮已交付，下一步？" : "任务待继续") + '</b><p>' +
          esc((latest.title || latest.id) + " · " + latestDone + "/" + latestTotal) + '</p>' +
          '<div><button type="button" class="primary" data-real-mission="' +
          esc(latest.id) + '">' + esc(finished ? "查看交付 / 下一轮" : "打开任务") + '</button>' +
          '<button type="button" data-real-create-mission>新建任务</button>' +
          (!aiReady ? '<button type="button" data-real-open-ai>接入 AI</button>' : '') +
          '</div></div>';
      }
      const loading = !overview;
      const empty = !loading && !missions.length ?
        '<div class="real-board-empty"><b>' + esc(AO.t("realModeBoardEmpty")) + '</b>' +
        '<p>' + esc(AO.t("realModeBoardEmptyHint")) + '</p>' +
        '<button type="button" data-real-create-mission>' +
        esc(AO.t("realModeCreateMission")) + '</button></div>' : "";
      const loadingHtml = loading ?
        '<div class="real-board-empty"><b>正在读取真实任务…</b><p>等待本地 bridge 返回 Missions 数据。</p></div>' : "";
      const activity = (overview && overview.activity) || [];
      const artifacts = activity.filter(function (row) { return row.kind === "artifact"; }).slice(0, 3);
      let deliverableRows = artifacts.map(function (row) {
        return '<button type="button" class="real-deliverable-row" data-real-mission="' +
          esc(row.missionId || "") + '"><i>▣</i><span><b>' +
          esc(row.artifactName || row.title || "交付物") + '</b><em>' +
          esc(row.missionTitle || row.detail || "") + '</em></span><strong>↗</strong></button>';
      }).join("");
      if (!deliverableRows && overview && (overview.artifacts || []).length) {
        const byId = {};
        missions.forEach(function (mission) { byId[mission.id] = mission; });
        deliverableRows = (overview.artifacts || []).filter(function (artifact) {
          return byId[artifact.missionId];
        }).slice(-3).reverse().map(function (artifact) {
          return '<button type="button" class="real-deliverable-row" data-real-mission="' +
            esc(artifact.missionId || "") + '"><i>▣</i><span><b>' +
            esc(artifact.name || "交付物") + '</b><em>' +
            esc((byId[artifact.missionId] || {}).title || "") +
            '</em></span><strong>↗</strong></button>';
        }).join("");
      }
      const deliverablesHtml = deliverableRows ?
        '<div class="real-board-head deliverables"><span>DELIVERABLES</span><b>最近交付</b><em>' +
        (artifacts.length || (deliverableRows.match(/real-deliverable-row/g) || []).length) +
        '</em></div>' + deliverableRows : "";
      this.board.innerHTML = '<div class="real-board">' + focusHtml + nextActionHtml +
        '<div class="real-board-head"><span>REAL OPERATIONS</span><b>' +
        esc(AO.t("realModeBoardTitle")) + '</b><em>' + missions.length + '</em></div>' +
        (rows || loadingHtml || empty) + deliverablesHtml + '</div>';
    }

    autorunShort(status) {
      const map = {
        running: "missionLiveRunning",
        discussing: "missionLiveDiscussing",
        waiting_boss: "missionLiveWaiting",
        queued: "missionLiveQueued",
        scheduled: "missionAutoRunScheduled",
        done: "missionLiveDone",
        stopped: "missionAutoRunStopped",
        error: "missionAutoRunError"
      };
      return map[status] ? AO.t(map[status]) : AO.t("missionAutoRunOff");
    }

    renderBoard() {
      if (this.demoOff()) {
        this.renderRealBoard();
        return;
      }
      const w = this.world;
      const signature = w.tasks.map(function (task) {
        return [task.id, task.status, Math.round(Number(task.progress || 0) / 5) * 5,
          task.assignee, task.reviewerId, task.priority,
          task.checks.map(function (check) { return check.status; }).join("")].join(":");
      }).join("|");
      if (signature === this.lastBoardSig && this.board.childElementCount) return;
      this.lastBoardSig = signature;
      const scroll = this.board.scrollTop;
      const groups = [
        {
          key: "active",
          label: AO.t("boardActive"),
          tasks: w.tasks.filter((t) => t.status === "in_progress" || t.status === "blocked")
        },
        {
          key: "review",
          label: AO.t("boardReview"),
          tasks: w.tasks.filter((t) => t.status === "review")
        },
        {
          key: "backlog",
          label: AO.t("boardBacklog"),
          tasks: w.tasks.filter((t) => t.status === "backlog")
        },
        {
          key: "done",
          label: AO.t("boardDone"),
          tasks: w.tasks.filter((t) => t.status === "done")
        }
      ];

      let html = "";
      groups.forEach((group) => {
        html +=
          '<div class="board-section ' + group.key + '">' +
          '<div class="board-head"><span>' + group.label + "</span><b>" +
          group.tasks.length + "</b></div>";
        if (!group.tasks.length) {
          html += '<div class="board-empty">' + esc(AO.t("boardEmpty")) + '</div>';
        } else {
          group.tasks
            .slice()
            .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
            .forEach((t) => {
              const role = AO.ROLES[t.role];
              const assignee = t.assignee ? this.engine.agentById(t.assignee) : null;
              const reviewer = t.reviewerId ? this.engine.agentById(t.reviewerId) : null;
              const meta = t.status === "review"
                ? (reviewer ? reviewer.name + " 评审中" : "等待评审")
                : (t.externalName || (assignee ? assignee.name : "待认领"));
              const blocked = t.status === "blocked";
              const checkDone = t.checks.filter((c) => c.status === "done").length;
              const checkRisk = t.checks.filter((c) => c.status === "risk").length;
              const checkMissed = t.checks.filter((c) => c.status === "missed").length;
              html +=
                '<div class="task-card ' + t.status + (blocked ? " is-blocked" : "") +
                '" data-task="' + t.id + '" tabindex="0" role="button" aria-label="' +
                esc(t.title + " · " + (AO.taskStatusLabel(t.status) || t.status) +
                  " · 查看工作轨迹") + '" title="' +
                esc((t.desc || t.title) + " · 点击查看工作轨迹") + '">' +
                '<div class="task-top"><i class="role-dot" style="background:' +
                role.color + '"></i><span class="task-title">' + esc(t.title) + "</span>" +
                (t.external ? '<em class="external-chip">EXT</em>' : "") +
                (blocked ? '<em class="blocked-chip">阻塞</em>' : "") + "</div>" +
                '<div class="task-meta"><span>' +
                (assignee ? '<i class="task-owner">' + AO.spriteSVG(assignee, 13) + "</i>" : "") +
                esc(meta) + "</span><span>" +
                Math.round(t.progress) + "%</span></div>" +
                '<div class="task-bar"><i style="width:' + Math.round(t.progress) +
                '%;background:' + role.color + '"></i></div>' +
                (t.checks.length
                  ? '<div class="task-checks"><span class="qc-done">' + checkDone +
                    "/" + t.checks.length + ' 基础工作</span>' +
                    (checkRisk ? '<span class="qc-risk">' + checkRisk + " 风险</span>" : "") +
                    (checkMissed ? '<span class="qc-miss">' + checkMissed + " 遗漏</span>" : "") +
                    "</div>"
                  : "") +
                "</div>";
            });
        }
        html += "</div>";
      });
      const boardCards = Array.from(this.board.querySelectorAll("[data-task]"));
      const boardFocus = boardCards.indexOf(document.activeElement);
      this.board.innerHTML = html;
      this.board.scrollTop = scroll;
      if (boardFocus >= 0) {
        const next = this.board.querySelectorAll("[data-task]")[boardFocus];
        if (next) next.focus({ preventScroll: true });
      }
    }

    renderAudit(force) {
      const w = this.world;
      const audit = this.engine.audit();
      const sig = w.tasks.map(function (t) {
        return [t.id, t.status, Math.round(t.progress), t.assignee,
          t.reviewerId, t.reworkCount,
          t.checks.map(function (c) { return c.status + ":" + c.note; }).join(",")
        ].join("|");
      }).join(";") + "#" + w.ledger.length + ":" +
        (w.ledger.length ? w.ledger[w.ledger.length - 1].id : 0);
      if (!force && sig === this.lastAuditSig) return;
      this.lastAuditSig = sig;
      const scroll = this.auditView.scrollTop;
      const coverage = audit.total
        ? Math.round((audit.done.length / audit.total) * 100) : 0;
      const gaps = audit.risk.concat(audit.missed).sort((a, b) => {
        const rank = { high: 0, medium: 1, low: 2 };
        const bySev = (rank[a.severity] != null ? rank[a.severity] : 3) - (rank[b.severity] != null ? rank[b.severity] : 3);
        if (bySev) return bySev;
        if (a.status !== b.status) return a.status === "risk" ? -1 : 1;
        return a.taskId.localeCompare(b.taskId) || a.checkId.localeCompare(b.checkId);
      });
      const ownerName = (task) => {
        const a = task.assignee ? this.engine.agentById(task.assignee) : null;
        return a ? a.name : (task.externalName || "待认领");
      };

      let gapHtml = "";
      gaps.slice(0, 30).forEach((row) => {
        const task = this.engine.taskById(row.taskId);
        if (!task) return;
        const isRisk = row.status === "risk";
        const reviewer = task.reviewerId ? this.engine.agentById(task.reviewerId) : null;
        const action = AO.CHECK_ACTIONS[row.checkId] || "补齐该项基础工作";
        gapHtml +=
          '<button class="audit-item sev-' + row.severity + " status-" + row.status +
          '" data-task="' + row.taskId + '" type="button">' +
          '<span class="audit-flag">' + (isRisk ? "风险" : "遗漏") + " · " +
          (SEVERITY[row.severity] || "中") + "</span>" +
          '<span class="audit-copy"><b>' + esc(row.label) + "</b>" +
          "<em>" + esc(task.id + " · " + task.title) + "</em>" +
          "<small>" + esc(ownerName(task)) + " · 评审 " +
          esc(reviewer ? reviewer.name : "未评审") + "</small>" +
          '<small class="audit-action">→ ' + esc(action) + "</small></span>" +
          '<span class="audit-arrow">›</span>' +
          "</button>";
      });
      if (!gaps.length) {
        gapHtml =
          '<div class="audit-empty">暂无遗漏或风险。' +
          (audit.pending.length
            ? audit.pending.length + " 项基础工作仍待验证。"
            : "所有基础工作已覆盖。") +
          "</div>";
      }

      let openHtml = "";
      if (!audit.open.length) {
        openHtml = '<div class="audit-empty">所有任务已完成。</div>';
      } else {
        audit.open
          .slice()
          .sort((a, b) => {
            const rank = { blocked: 0, review: 1, in_progress: 2, backlog: 3 };
            return (rank[a.status] != null ? rank[a.status] : 9) - (rank[b.status] != null ? rank[b.status] : 9);
          })
          .forEach((t) => {
            openHtml +=
              '<button class="audit-task" data-task="' + t.id + '" type="button">' +
              '<span class="audit-task-dot ' + t.status + '"></span>' +
              '<span><b>' + esc(t.title) + "</b><em>" +
              esc(ownerName(t)) + " · " + (AO.taskStatusLabel(t.status) || t.status) +
              "</em></span><span class=\"audit-pct\">" +
              Math.round(t.progress) + "%</span></button>";
          });
      }

      const reworks = w.ledger.filter((e) => e.kind === "rework").slice(-6).reverse();
      let reworkHtml = "";
      reworks.forEach((e) => {
        const agent = e.agentId ? this.engine.agentById(e.agentId) : null;
        const task = e.taskId ? this.engine.taskById(e.taskId) : null;
        reworkHtml +=
          '<button class="audit-rework" data-task="' + (e.taskId || "") + '" type="button">' +
          '<span class="rw-time">' + e.clock + "</span>" +
          '<span class="rw-copy"><b>' + esc(e.action) + "</b><em>" +
          esc((agent ? agent.name : "SYSTEM") + " · " + (task ? task.title : "—")) +
          "</em></span><span class=\"rw-icon\">↺</span></button>";
      });
      if (!reworkHtml) reworkHtml = '<div class="audit-empty">暂无返工记录。</div>';

      const doneTasks = w.tasks.filter((t) => t.status === "done").length;
      const gate = this.engine.releaseGate();
      const doneAll = w.tasks.length > 0 && doneTasks === w.tasks.length;
      const gapCount = audit.risk.length + audit.missed.length;
      const human = w.humanReview;
      let humanHtml = "";
      if (doneAll) {
        if (gapCount) {
          humanHtml =
            '<div class="audit-section human-review"><div class="audit-head">' +
            "<span>HUMAN REVIEW</span><b>" + (human ? "1" : "!") + "</b></div>" +
            '<p class="human-note">' + (human
              ? "人类已介入。当前决策：" +
                (human.status === "approved" ? "批准带例外发布" : "打回补齐") + "。"
              : "任务已全部完成，但仍有 <b>" + gapCount +
                "</b> 项基础工作未覆盖或未验证。发布需要人工确认。") + "</p>" +
            '<div class="human-actions">' +
            '<button type="button" data-human="approved">批准例外发布</button>' +
            '<button type="button" class="reject" data-human="rejected">打回补齐</button>' +
            "</div>" +
            (human
              ? '<div class="human-decision ' + (human.status === "rejected" ? "rejected" : "") +
                '">' + (human.status === "approved" ? "✓ 已批准例外发布" : "× 已打回发布") +
                "<em>" + esc(human.clock + " · " + human.by + " · " + human.note) + "</em></div>"
              : "") +
            "</div>";
        } else {
          humanHtml =
            '<div class="audit-section human-review"><div class="audit-head">' +
            '<span>HUMAN REVIEW</span><b>✓</b></div>' +
            '<p class="human-note">质量门禁通过，无需人工例外。</p></div>';
        }
      }
      const shift = w.agents.map((a) => {
        const assigned = w.tasks.filter((t) => t.assignee === a.id);
        return {
          agent: a,
          total: assigned.length,
          done: assigned.filter((t) => t.status === "done").length,
          skills: Object.keys(a.skillUse).reduce(function (n, k) {
            return n + a.skillUse[k];
          }, 0),
          gaps: audit.rows.filter(function (r) {
            return r.assignee === a.id &&
              (r.status === "risk" || r.status === "missed");
          }).length
        };
      }).sort(function (x, y) {
        return y.gaps - x.gaps || y.done - x.done;
      });
      let shiftHtml = "";
      shift.forEach(function (row) {
        const a = row.agent;
        const role = AO.ROLES[a.role] || { color: "#55d6c2", label: a.role };
        shiftHtml +=
          '<button class="shift-row" type="button" data-open-agent="' + a.id + '">' +
          '<span class="shift-avatar">' + AO.spriteSVG(a, 20) + "</span>" +
          '<span class="shift-name"><b>' + esc(a.name) + "</b><em>" +
          esc(role.label) + "</em></span>" +
          '<span class="shift-stats"><b>' + row.done + "/" + row.total +
          "</b><em>完成</em></span>" +
          '<span class="shift-stats"><b>' + row.skills + "</b><em>技能</em></span>" +
          '<span class="shift-gap' + (row.gaps ? "" : " is-zero") + '">' +
          row.gaps + "</span></button>";
      });
      this.auditView.innerHTML =
        '<div class="audit-hero">' +
        '<div class="audit-ring" style="--p:' + coverage + '"><b>' + coverage + "%</b></div>" +
        '<div class="audit-hero-copy"><span>BASELINE COVERAGE</span>' +
        "<h3>基础工作覆盖</h3><p>" + audit.done.length + " / " + audit.total +
        " 项已覆盖 · 已评审质量分 " + audit.score + "%</p>" +
        '<span class="audit-gate ' + gate.key + '">' + gate.label + "</span>" +
        "</div></div>" +
        '<div class="audit-kpis">' +
        '<span><b class="k-risk">' + audit.risk.length + "</b><em>风险</em></span>" +
        '<span><b class="k-miss">' + audit.missed.length + "</b><em>遗漏</em></span>" +
        '<span><b class="k-rework">' + audit.reworks + "</b><em>返工</em></span>" +
        '<span><b>' + audit.pending.length + "</b><em>待验证</em></span>" +
        "</div>" +
        humanHtml +
        '<div class="audit-section"><div class="audit-head"><span>AGENT SHIFT</span><b>' +
        shift.length + "</b></div>" + shiftHtml + "</div>" +
        '<div class="audit-section"><div class="audit-head"><span>遗漏 / 风险</span><b>' +
        gaps.length + "</b></div>" + gapHtml + "</div>" +
        '<div class="audit-section"><div class="audit-head"><span>未完成 / 阻塞</span><b>' +
        audit.open.length + "</b></div>" + openHtml + "</div>" +
        '<div class="audit-section"><div class="audit-head"><span>返工记录</span><b>' +
        reworks.length + "</b></div>" + reworkHtml + "</div>" +
        '<div class="audit-foot"><span>' + doneTasks + "/" + w.tasks.length +
        " 任务完成 · 审计随模拟实时更新</span>" +
        '<div class="audit-actions">' +
        '<button type="button" data-export-audit="md">审计 .md</button>' +
        '<button type="button" data-export-audit="json">JSON</button>' +
        '<button type="button" data-export-audit="standup">站会</button>' +
        "</div>" +
        '<div class="audit-actions secondary">' +
        '<button type="button" data-trace-open>TRACE LAB · T</button>' +
        '<button type="button" data-snapshot="save">保存</button>' +
        '<button type="button" data-snapshot="load">恢复</button>' +
        "</div></div>";
      this.auditView.scrollTop = scroll;
    }

    downloadFile(name, text, mime) {
      const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
    }

    exportAudit(format) {
      const w = this.world;
      const audit = this.engine.audit();
      const nameOf = (id) => {
        const a = id ? this.engine.agentById(id) : null;
        return a ? a.name : "未分配";
      };
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const base = "agent-office-" + w.scenarioId + "-" + stamp;
      const gateInfo = this.engine.releaseGate();
      const gate = gateInfo.label;

      if (format === "json") {
        const payload = {
          generatedAt: new Date().toISOString(),
          scenario: w.scenarioId,
          scenarioName: w.scenarioName,
          officeName: w.officeName,
          clock: this.engine.clockLabel(),
          tick: w.tick,
          goal: w.goal,
          summary: {
            tasksDone: w.tasks.filter((t) => t.status === "done").length,
            tasksTotal: w.tasks.length,
            baselineDone: audit.done.length,
            baselineTotal: audit.total,
            score: audit.score,
            risks: audit.risk.length,
            missed: audit.missed.length,
            pending: audit.pending.length,
            reworks: audit.reworks,
            meetings: w.stats.meetings,
            releaseGate: gateInfo.key.toUpperCase(),
            releaseGateLabel: gateInfo.label,
            humanReview: w.humanReview
          },
          audit: audit.rows,
          tasks: w.tasks.map((t) => ({
            id: t.id, title: t.title, role: t.role, status: t.status,
            priority: t.priority, assignee: t.assignee, reviewerId: t.reviewerId,
            progress: t.progress, reworkCount: t.reworkCount,
            startedAt: t.startedAt, completedAt: t.completedAt,
            work: t.work, checks: t.checks, deps: t.deps
          })),
          agents: w.agents.map((a) => ({
            id: a.id, name: a.name, role: a.role, state: a.state,
            skills: a.skills, skillUse: a.skillUse,
            filesTouched: a.filesTouched, memory: a.memory
          })),
          ledger: w.ledger
        };
        this.downloadFile(base + "-audit.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
        return;
      }

      if (format === "standup") {
        const sl = [];
        sl.push("# 站会摘要 · " + w.scenarioName);
        sl.push("");
        sl.push("> " + this.engine.clockLabel() + " · 发布门禁：" + gate +
          " · 基础工作覆盖 " + audit.done.length + "/" + audit.total +
          (w.humanReview ? " · 人类审批：" +
            (w.humanReview.status === "approved" ? "批准例外" : "打回") : ""));
        sl.push("");
        w.agents.forEach((a) => {
          const assigned = w.tasks.filter((t) => t.assignee === a.id);
          const done = assigned.filter((t) => t.status === "done");
          const current = assigned.filter((t) => t.status !== "done");
          const gaps = audit.rows.filter((r) => r.assignee === a.id &&
            (r.status === "risk" || r.status === "missed"));
          const skills = Object.keys(a.skillUse)
            .sort((x, y) => a.skillUse[y] - a.skillUse[x])
            .slice(0, 3)
            .map((id) => (AO.SKILL_CATALOG[id] ? AO.SKILL_CATALOG[id].name : id) +
              " ×" + a.skillUse[id]);
          sl.push("### " + a.name + " · " + (AO.ROLES[a.role] ? AO.ROLES[a.role].label : a.role));
          sl.push("- 完成：" + (done.length
            ? done.slice(0, 4).map((t) => t.title).join("、")
            : "无"));
          sl.push("- 进行中：" + (current.length
            ? current.map((t) => t.title + "（" + Math.round(t.progress) + "%）").join("、")
            : "无"));
          sl.push("- 技能：" + (skills.length ? skills.join("、") : "暂无调用"));
          if (gaps.length) {
            sl.push("- 缺口：" + gaps.slice(0, 3).map((r) => r.label).join("、"));
          }
          sl.push("");
        });
        sl.push("## 风险 / 阻塞");
        if (audit.risk.length) {
          audit.risk.slice(0, 6).forEach((row) => {
            const task = this.engine.taskById(row.taskId);
            sl.push("- [风险] " + row.label + " · `" + row.taskId + " " +
              (task ? task.title : "") + "` · 建议：" +
              (AO.CHECK_ACTIONS[row.checkId] || "补齐"));
          });
        } else {
          sl.push("- 无高风险项。");
        }
        sl.push("");
        sl.push("## 今天要补");
        audit.risk.concat(audit.missed).slice(0, 8).forEach((row) => {
          sl.push("- " + (AO.CHECK_ACTIONS[row.checkId] || "补齐 " + row.label));
        });
        sl.push("");
        this.downloadFile(base + "-standup.md", sl.join("\n"), "text/markdown;charset=utf-8");
        return;
      }

      const lines = [];
      lines.push("# Agent Office · 审计报告");
      lines.push("");
      lines.push("> 场景：" + w.scenarioName + " · 模拟时间：" + this.engine.clockLabel() +
        " · 导出时间：" + new Date().toLocaleString("zh-CN"));
      lines.push("> 目标：" + w.goal);
      lines.push("");
      lines.push("## 摘要");
      lines.push("");
      lines.push("| 指标 | 数值 |");
      lines.push("| --- | --- |");
      lines.push("| 任务完成 | " + w.tasks.filter((t) => t.status === "done").length + "/" + w.tasks.length + " |");
      lines.push("| 基础工作覆盖 | " + audit.done.length + "/" + audit.total + "（" +
        (audit.total ? Math.round(audit.done.length / audit.total * 100) : 0) + "%） |");
      lines.push("| 评审后质量分 | " + audit.score + "% |");
      lines.push("| 高风险 | " + audit.risk.length + " |");
      lines.push("| 遗漏 | " + audit.missed.length + " |");
      lines.push("| 待验证 | " + audit.pending.length + " |");
      lines.push("| 返工 | " + audit.reworks + " |");
      lines.push("| 会议 | " + w.stats.meetings + " |");
      lines.push("| 发布门禁 | " + gate + " |");
      lines.push("| 人类审批 | " + (w.humanReview
        ? (w.humanReview.status === "approved" ? "批准例外发布" : "打回") +
          " · " + w.humanReview.clock
        : "尚未决策") + " |");
      lines.push("");
      if (w.humanReview) {
        lines.push("## 人类审批");
        lines.push("");
        lines.push("- 决策：" + (w.humanReview.status === "approved"
          ? "批准带例外发布" : "打回补齐"));
        lines.push("- 时间：" + w.humanReview.clock + " · 决策人：" + w.humanReview.by);
        lines.push("- 备注：" + w.humanReview.note);
        lines.push("");
      }
      lines.push("## 遗漏与风险");
      lines.push("");
      if (!audit.risk.length && !audit.missed.length) {
        lines.push("- 暂无遗漏或风险。");
      } else {
        audit.risk.concat(audit.missed).forEach((row) => {
          const task = this.engine.taskById(row.taskId);
          lines.push("- **[" + (row.status === "risk" ? "风险" : "遗漏") + "][" +
            (SEVERITY[row.severity] || "中") + "] " + row.label + "** · `" +
            row.taskId + " " + (task ? task.title : "") + "` · 负责人：" +
            nameOf(task && task.assignee) + " · 评审：" +
            nameOf(task && task.reviewerId));
          if (row.note) lines.push("  - " + row.note);
          if (AO.CHECK_ACTIONS[row.checkId]) {
            lines.push("  - 建议：" + AO.CHECK_ACTIONS[row.checkId]);
          }
        });
      }
      lines.push("");
      lines.push("## 任务明细");
      w.tasks.forEach((task) => {
        const events = w.ledger.filter((e) => e.taskId === task.id);
        const done = task.checks.filter((c) => c.status === "done").length;
        const risk = task.checks.filter((c) => c.status === "risk").length;
        const missed = task.checks.filter((c) => c.status === "missed").length;
        lines.push("");
        lines.push("### " + task.id + " · " + task.title);
        lines.push("");
        lines.push("- 状态：" + (AO.taskStatusLabel(task.status) || task.status) +
          " · 负责人：" + nameOf(task.assignee) +
          " · 评审：" + nameOf(task.reviewerId) +
          " · 返工：" + task.reworkCount + " 次");
        lines.push("- 基础工作：" + done + "/" + task.checks.length +
          "（风险 " + risk + " · 遗漏 " + missed + "）");
        task.checks.forEach((c) => {
          const mark = c.status === "done" ? "x" :
            c.status === "risk" ? "!" : c.status === "missed" ? " " : "-";
          lines.push("  - [" + mark + "] " + c.label + "（" +
            (SEVERITY[c.severity] || "中") + "）" +
            (c.note ? " — " + c.note : ""));
        });
        if (events.length) {
          lines.push("- 工作轨迹：");
          events.forEach((e) => {
            let row = "  - " + e.clock + " · " + nameOf(e.agentId) + " · " + e.action;
            if (e.skill) row += " · 技能 `" + e.skill + "`";
            if (e.file) row += " · `" + fileLabel(e) + "`";
            if (e.add || e.del) row += " (+" + e.add + "/−" + e.del + ")";
            if (e.note) row += " — " + e.note;
            lines.push(row);
          });
        }
      });
      lines.push("");
      lines.push("## Agent 摘要");
      w.agents.forEach((a) => {
        const tasks = w.tasks.filter((t) => t.assignee === a.id);
        const done = tasks.filter((t) => t.status === "done").length;
        const skillUse = Object.keys(a.skillUse)
          .map((id) => (AO.SKILL_CATALOG[id] ? AO.SKILL_CATALOG[id].name : id) +
            " ×" + a.skillUse[id])
          .join("、");
        lines.push("");
        lines.push("### " + a.name + " · " + (AO.ROLES[a.role] ? AO.ROLES[a.role].label : a.role));
        lines.push("- 完成任务：" + done + "/" + tasks.length +
          " · 评审：" + w.ledger.filter((e) => e.kind === "review" && e.agentId === a.id).length +
          " · 返工：" + tasks.reduce((n, t) => n + t.reworkCount, 0));
        lines.push("- 技能调用：" + (skillUse || "暂无"));
        lines.push("- 触及文件：" + Object.keys(a.filesTouched).length + " 个");
      });
      lines.push("");
      lines.push("## 完整工作日志");
      lines.push("");
      w.ledger.forEach((e) => {
        let row = "- `" + e.clock + "` · " + nameOf(e.agentId) + " · **" + e.action + "**";
        if (e.skill) row += " · `" + e.skill + "`";
        if (e.file) row += " · `" + fileLabel(e) + "`";
        if (e.add || e.del) row += " (+" + e.add + "/−" + e.del + ")";
        if (e.note) row += " — " + e.note;
        lines.push(row);
      });
      lines.push("");
      this.downloadFile(base + "-audit.md", lines.join("\n"), "text/markdown;charset=utf-8");
    }

    openTaskDrawer(taskId) {
      const task = this.engine.taskById(taskId);
      if (!task) return;
      if (this.drawer.hidden) this.lastFocus = document.activeElement;
      else if (this.drawerMode) this.drawerHistory.push({ mode: this.drawerMode, id: this.drawerId });
      this.drawerMode = "task";
      this.drawerId = taskId;
      this.drawer.hidden = false;
      this.drawerBackdrop.hidden = false;
      this.drawer.classList.add("open");
      this.drawer.setAttribute("aria-hidden", "false");
      this.drawer.setAttribute("aria-modal", "true");
      document.body.classList.add("drawer-open");
      if (task.assignee && this.engine.agentById(task.assignee)) {
        this.selectedId = task.assignee;
        this.renderInspector();
        this.updateCharacters();
      }
      this.renderDrawer();
      this.drawer.scrollTop = 0;
      const close = this.drawer.querySelector("[data-drawer-close]");
      if (close) close.focus({ preventScroll: true });
    }

    openAgentDrawer(agentId) {
      const agent = this.engine.agentById(agentId);
      if (!agent) return;
      if (this.drawer.hidden) this.lastFocus = document.activeElement;
      else if (this.drawerMode) this.drawerHistory.push({ mode: this.drawerMode, id: this.drawerId });
      this.drawerMode = "agent";
      this.drawerId = agentId;
      this.drawer.hidden = false;
      this.drawerBackdrop.hidden = false;
      this.drawer.classList.add("open");
      this.drawer.setAttribute("aria-hidden", "false");
      this.drawer.setAttribute("aria-modal", "true");
      document.body.classList.add("drawer-open");
      this.renderDrawer();
      this.drawer.scrollTop = 0;
      const close = this.drawer.querySelector("[data-drawer-close]");
      if (close) close.focus({ preventScroll: true });
    }

    openExternalDrawer(agentId) {
      const agent = this.external ? this.external.agentById(agentId) : null;
      if (!agent) return;
      if (this.drawer.hidden) this.lastFocus = document.activeElement;
      else if (this.drawerMode) this.drawerHistory.push({ mode: this.drawerMode, id: this.drawerId });
      this.drawerMode = "external";
      this.drawerId = agentId;
      this.drawer.hidden = false;
      this.drawerBackdrop.hidden = false;
      this.drawer.classList.add("open");
      this.drawer.setAttribute("aria-hidden", "false");
      this.drawer.setAttribute("aria-modal", "true");
      document.body.classList.add("drawer-open");
      this.renderDrawer();
      this.drawer.scrollTop = 0;
      const close = this.drawer.querySelector("[data-drawer-close]");
      if (close) close.focus({ preventScroll: true });
      if (this.external) this.external.loadMissionTasks(agentId);
    }

    async openMissionTask(missionId, taskId, agentId) {
      if (!this.missions || !missionId) return;
      this.closeDrawer();
      try {
        await this.missions.open();
        await this.missions.selectMission(missionId);
        this.missions.taskAgentFilter = agentId || "";
        this.missions.detailTab = "tasks";
        this.missions.render();
      } catch (err) {}
    }

    closeDrawer() {
      if (!this.drawer) return;
      const wasOpen = !this.drawer.hidden;
      this.drawerMode = null;
      this.drawerId = null;
      this.drawerHistory = [];
      this.drawer.classList.remove("open");
      this.drawer.hidden = true;
      this.drawer.setAttribute("aria-hidden", "true");
      this.drawer.setAttribute("aria-modal", "false");
      if (this.drawerBackdrop) this.drawerBackdrop.hidden = true;
      document.body.classList.remove("drawer-open");
      if (wasOpen && this.lastFocus && this.lastFocus.isConnected &&
          typeof this.lastFocus.focus === "function") {
        this.lastFocus.focus({ preventScroll: true });
      }
      this.lastFocus = null;
    }

    toast(text) {
      if (!this.toastEl) return;
      this.toastEl.textContent = text;
      this.toastEl.classList.add("show");
      window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => {
        this.toastEl.classList.remove("show");
      }, 2400);
    }

    saveSnapshot() {
      try {
        const snap = this.engine.snapshot();
        localStorage.setItem(this.snapshotKey, JSON.stringify(snap));
        this.toast("进度已保存 · " + this.engine.clockLabel() +
          " · " + this.world.tick + " tick");
      } catch (err) {
        this.toast("保存失败：" + (err && err.message ? err.message : err));
      }
    }

    restoreSnapshot() {
      let raw = null;
      try {
        raw = localStorage.getItem(this.snapshotKey);
      } catch (err) {
        this.toast("无法读取本地快照");
        return;
      }
      if (!raw) {
        this.toast("还没有保存过进度");
        return;
      }
      try {
        const snap = JSON.parse(raw);
        this.engine.restoreSnapshot(snap);
        this.build();
        document.dispatchEvent(new CustomEvent("agent-office:restored"));
        this.toast("已恢复 · " + this.engine.clockLabel() +
          " · " + this.world.tick + " tick");
      } catch (err) {
        this.toast("恢复失败：" + (err && err.message ? err.message : err));
      }
    }

    renderDrawer() {
      if (!this.drawerMode) return;
      if (this.drawerMode === "task") {
        const task = this.engine.taskById(this.drawerId);
        if (!task) {
          this.closeDrawer();
          return;
        }
        this.drawer.innerHTML = this.taskDrawerHTML(task);
      } else if (this.drawerMode === "external") {
        const agent = this.external ? this.external.agentById(this.drawerId) : null;
        if (!agent) {
          this.closeDrawer();
          return;
        }
        this.drawer.innerHTML = this.externalDrawerHTML(agent);
      } else {
        const agent = this.engine.agentById(this.drawerId);
        if (!agent) {
          this.closeDrawer();
          return;
        }
        this.drawer.innerHTML = this.agentDrawerHTML(agent);
      }
      if (this.drawerHistory.length) {
        const head = this.drawer.querySelector(".drawer-head");
        if (head) {
          head.insertAdjacentHTML("afterbegin",
            '<button type="button" class="drawer-back" data-drawer-back aria-label="返回">‹</button>');
        }
      }
      this.drawerSig = this.drawerSignature();
    }

    drawerBack() {
      const previous = this.drawerHistory.pop();
      if (!previous) return;
      this.drawerMode = null;
      if (previous.mode === "task") this.openTaskDrawer(previous.id);
      else if (previous.mode === "agent") this.openAgentDrawer(previous.id);
      else if (previous.mode === "external") this.openExternalDrawer(previous.id);
    }

    traceEventHTML(e, task) {
      const agent = e.agentId ? this.engine.agentById(e.agentId) : null;
      const agentLabel = agent ? agent.name : (e.agentName || "SYSTEM");
      const skill = e.skill && AO.SKILL_CATALOG[e.skill]
        ? '<span class="trace-chip skill">' + esc(AO.SKILL_CATALOG[e.skill].name) + "</span>"
        : "";
      const tool = e.tool
        ? '<span class="trace-chip tool">' + esc(e.tool) + "</span>" : "";
      const file = e.file
        ? '<span class="trace-file">' + esc(fileLabel(e)) + "</span>" : "";
      const delta = deltaLabel(e)
        ? '<span class="trace-delta">' + esc(deltaLabel(e)) + "</span>" : "";
      const covered = (e.checks || []).map((id) => {
        const c = task.checks.find((x) => x.id === id);
        return c ? '<span class="trace-check">✓ ' + esc(c.label) + "</span>" : "";
      }).join("");
      let diff = "";
      if (e.diff && e.diff.length) {
        diff = '<pre class="trace-diff">' + e.diff.map((line) => {
          const cls = line.charAt(0) === "+" ? "add" :
            line.charAt(0) === "-" ? "del" : "ctx";
          return '<span class="diff-line ' + cls + '">' + esc(line) + "</span>";
        }).join("") + "</pre>";
      }
      return '<div class="trace-item kind-' + e.kind + '">' +
        '<div class="trace-rail"><span>' + (TRACE_ICONS[e.kind] || "·") + "</span></div>" +
        '<div class="trace-main">' +
        '<div class="trace-top"><b>' + esc(e.action) + "</b><time>" + e.clock + "</time></div>" +
        '<div class="trace-who">' + (agent
          ? '<button type="button" class="drawer-link" data-open-agent="' + agent.id + '">' +
            esc(agent.name) + "</button>"
          : '<span class="trace-system">' + esc(agentLabel) + "</span>") +
        '<span class="trace-kind">' + e.kind + "</span>" +
        (e.external ? '<span class="trace-chip external">EXT</span>' : "") + "</div>" +
        (skill || tool || file || delta
          ? '<div class="trace-meta">' + skill + tool + file + delta + "</div>" : "") +
        (covered ? '<div class="trace-checks">' + covered + "</div>" : "") +
        (e.note ? '<p class="trace-note">' + esc(e.note) + "</p>" : "") +
        diff +
        "</div></div>";
    }

    taskDrawerHTML(task) {
      const w = this.world;
      const events = w.ledger.filter((e) => e.taskId === task.id);
      const owner = task.assignee ? this.engine.agentById(task.assignee) : null;
      const reviewer = task.reviewerId ? this.engine.agentById(task.reviewerId) : null;
      const externalOwner = task.external ? (task.externalName || task.assignee) : null;
      const externalAgents = this.external ? (this.external.agents || []).filter(function (a) {
        // Model API agents are one-shot chat adapters, not assignment workers.
        return !a.managed && (a.status === "online" || a.provider || a.runtime);
      }) : [];
      const role = AO.ROLES[task.role] || { color: "#55d6c2", label: task.role };
      const pct = AO.taskProgressPercent(task);
      const done = task.checks.filter((c) => c.status === "done").length;
      const risk = task.checks.filter((c) => c.status === "risk").length;
      const missed = task.checks.filter((c) => c.status === "missed").length;
      const pending = task.checks.filter((c) => c.status === "pending").length;
      const cycle = task.startedAt != null && task.completedAt != null
        ? (task.completedAt - task.startedAt) + " tick"
        : task.startedAt != null ? "进行中" : "—";

      let checks = "";
      task.checks.forEach((c) => {
        const icon = c.status === "done" ? "✓" :
          c.status === "risk" ? "!" : c.status === "missed" ? "–" : "○";
        checks += '<div class="check-row status-' + c.status + '">' +
          '<span class="check-icon">' + icon + "</span>" +
          '<span class="check-copy"><b>' + esc(c.label) + "</b><em>" +
          (SEVERITY[c.severity] || "中") + "优先级" +
          (c.agentId ? " · " + esc((this.engine.agentById(c.agentId) || {}).name || "—") : "") +
          "</em>" +
          (c.note ? "<small>" + esc(c.note) + "</small>" : "") +
          "</span></div>";
      });
      if (!checks) checks = '<div class="drawer-empty">该角色暂无基础工作检查项。</div>';

      let artifacts = "";
      const files = {};
      events.forEach((e) => {
        if (!e.file) return;
        const f = files[e.file] || {
          file: e.file, count: 0, add: 0, del: 0,
          lineStart: null, lineEnd: null, frames: 0
        };
        f.count += 1;
        f.add += e.add;
        f.del += e.del;
        f.frames = Math.max(f.frames, e.frames || 0);
        if (e.lineStart != null) {
          f.lineStart = f.lineStart == null ? e.lineStart : Math.min(f.lineStart, e.lineStart);
          f.lineEnd = f.lineEnd == null ? e.lineEnd : Math.max(f.lineEnd, e.lineEnd);
        }
        files[e.file] = f;
      });
      Object.keys(files).forEach((key) => {
        const f = files[key];
        let range = f.lineStart != null
          ? "L" + f.lineStart + (f.lineEnd != null && f.lineEnd !== f.lineStart ? "–" + f.lineEnd : "")
          : f.frames ? f.frames + " 帧" : "";
        artifacts += '<div class="artifact-row"><span class="artifact-icon">▤</span>' +
          '<span class="artifact-copy"><b>' + esc(f.file) + "</b><em>" + range +
          " · " + f.count + " 次操作</em></span><span class=\"artifact-delta\">" +
          (f.add || f.del ? "+" + f.add + " / −" + f.del : "") +
          "</span></div>";
      });
      if (!artifacts) artifacts = '<div class="drawer-empty">暂无文件产出。</div>';

      let deps = "";
      (task.deps || []).forEach((id) => {
        const dep = this.engine.taskById(id);
        if (!dep) return;
        deps += '<button type="button" class="dep-chip" data-open-task="' + dep.id + '">' +
          esc(dep.id + " · " + dep.title) + " · " +
          (AO.taskStatusLabel(dep.status) || dep.status) + "</button>";
      });
      if (!deps) deps = '<span class="drawer-muted">无依赖</span>';

      const gapCount = risk + missed;
      let callout = "";
      if (task.external) {
        if (task.status === "done") {
          callout = '<div class="drawer-callout warn">外部 Agent 自报完成，<b>未经过本地评审</b>。未验证的基础工作已进入风险 / 遗漏，审计会保留这些缺口。</div>';
        } else if (task.status === "blocked") {
          callout = '<div class="drawer-callout warn">外部 Agent 报告失败：' +
            esc(task.blockedReason || "未返回原因") + "</div>";
        } else {
          callout = '<div class="drawer-callout">已委托外部 Agent，当前进度 <b>' +
            Math.round(task.progress) + "%</b>。状态由 bridge 回写。</div>";
        }
      } else if (task.status === "done" && gapCount) {
        callout = '<div class="drawer-callout warn">已通过评审，但仍有 <b>' + gapCount +
          "</b> 项基础工作未覆盖或未验证。审计报告会保留这些缺口。</div>";
      } else if (task.status === "review") {
        callout = '<div class="drawer-callout">评审中，' + pending +
          " 项基础工作等待验证。</div>";
      } else if (task.status === "blocked") {
        callout = '<div class="drawer-callout warn">已阻塞：' +
          esc(task.blockedReason || "等待依赖或人工处理") + "。当前进度 " + pct + "%。</div>";
      } else if (task.status === "in_progress") {
        callout = '<div class="drawer-callout">工作中，当前进度 ' + pct + "%，已覆盖 " + done + "/" +
          task.checks.length + " 项基础工作。</div>";
      }

      const timeline = events.length
        ? events.map((e) => this.traceEventHTML(e, task)).join("")
        : '<div class="drawer-empty">还没有工作记录。等 agent 认领后会在这里留下技能调用、文件变更和评审记录。</div>';

      let delegateSection = "";
      if (task.status === "backlog" && this.external) {
        if (!externalAgents.length) {
          delegateSection = '<div class="drawer-section delegate-section">' +
            '<div class="drawer-section-head"><h3>委托外部 Agent</h3><span>EXTERNAL</span></div>' +
            '<p class="drawer-muted">还没有外部 Agent。先从 TEAM 面板接入一个，或启动演示 Agent。</p>' +
            '<button type="button" class="dep-chip" data-open-external>打开外部 Agent 面板</button></div>';
        } else {
          const options = externalAgents.map(function (a) {
            const state = a.status === "online" ? "ONLINE" : "OFFLINE";
            return '<option value="' + esc(a.id) + '">' + esc(a.name) + " · " + state +
              " · " + esc(a.provider || a.runtime || "external") + "</option>";
          }).join("");
          delegateSection = '<div class="drawer-section delegate-section">' +
            '<div class="drawer-section-head"><h3>委托外部 Agent</h3><span>可选 ' +
            externalAgents.length + " 个</span></div>" +
            '<div class="delegate-form">' +
            '<select id="delegateAgentSelect">' + options + "</select>" +
            '<textarea id="delegateBrief" maxlength="800" placeholder="给外部 Agent 的任务说明（可选）">' +
            esc(task.desc || "") + "</textarea>" +
            '<div class="delegate-actions"><button type="button" class="dep-chip delegate-submit" data-delegate-task="' +
            esc(task.id) + '">派发任务</button></div></div>' +
            '<p class="drawer-muted">外部完成会回写状态并标记为「自报完成」，未验证的基础工作会进入风险 / 遗漏。模型 API Agent 只做单次调用，不参与任务委派；请使用 Claude Code / Codex / 演示 Agent。</p>' +
            "</div>";
        }
      }
      const externalResult = task.external && (task.externalResult || (task.externalEvidence || []).length)
        ? '<div class="drawer-section"><div class="drawer-section-head"><h3>外部回执</h3><span>' +
          esc(task.externalProvider || "external") + "</span></div>" +
          (task.externalResult ? '<p class="external-result">' + esc(task.externalResult) + "</p>" : "") +
          (task.externalEvidence && task.externalEvidence.length
            ? '<div class="drawer-chips">' + task.externalEvidence.map(function (e) {
                return '<span class="tl-chip">' + esc(e) + "</span>";
              }).join("") + "</div>"
            : "") + "</div>"
        : "";

      return '<div class="drawer-head">' +
        '<button type="button" class="drawer-close" data-drawer-close aria-label="关闭">×</button>' +
        '<button type="button" class="drawer-refresh" data-refresh-drawer aria-label="刷新" title="刷新轨迹">↻</button>' +
        '<div class="drawer-kicker">TASK TRACE · ' + esc(task.id) + "</div>" +
        "<h2>" + esc(task.title) + "</h2>" +
        '<p class="drawer-desc">' + esc(task.desc) + "</p>" +
        '<div class="drawer-chips"><span class="status-chip ' + task.status + '">' +
        (AO.taskStatusLabel(task.status) || task.status) + "</span>" +
        '<span class="role-chip" style="--role:' + role.color + '">' + esc(role.label) + "</span>" +
        '<span class="prio-chip">P' + task.priority + "</span>" +
        '<span class="prio-chip">' + done + "/" + task.checks.length + " 基础工作</span></div>" +
        '<div class="drawer-task-progress"><i><u style="width:' + pct + '%"></u></i>' +
        "<b>" + pct + "%</b><em>" +
        (task.status === "blocked" ? "已阻塞" : pct >= 100 ? "已完成" : "当前进度") +
        "</em></div>" +
        "</div>" +
        '<div class="drawer-body">' +
        '<div class="drawer-meta">' +
        "<div><span>负责人</span><b>" + (owner
          ? '<button type="button" class="drawer-link" data-open-agent="' + owner.id + '">' +
            esc(owner.name) + "</button>"
          : (externalOwner
            ? '<span class="external-owner">' + esc(externalOwner) +
              ' <em class="external-chip">EXT</em></span>'
            : "待认领")) + "</b></div>" +
        "<div><span>评审</span><b>" + (reviewer
          ? '<button type="button" class="drawer-link" data-open-agent="' + reviewer.id + '">' +
            esc(reviewer.name) + "</button>"
          : (task.external ? "外部自报 · 未本地评审" : "—")) + "</b></div>" +
        "<div><span>周期</span><b>" + cycle + "</b></div>" +
        "<div><span>返工</span><b>" + task.reworkCount + " 次</b></div>" +
        "</div>" +
        callout +
        delegateSection +
        externalResult +
        '<div class="drawer-section"><div class="drawer-section-head"><h3>工作轨迹</h3>' +
        "<span>" + events.length + " 条事件</span></div>" +
        '<div class="trace-list">' + timeline + "</div></div>" +
        '<div class="drawer-section"><div class="drawer-section-head"><h3>基础工作检查</h3>' +
        "<span>" + done + "/" + task.checks.length + " 已覆盖</span></div>" +
        '<div class="check-list">' + checks + "</div></div>" +
        '<div class="drawer-section"><div class="drawer-section-head"><h3>产出与证据</h3>' +
        "<span>" + Object.keys(files).length + " 个文件</span></div>" +
        '<div class="artifact-list">' + artifacts + "</div></div>" +
        '<div class="drawer-section"><div class="drawer-section-head"><h3>依赖</h3></div>' +
        '<div class="dep-list">' + deps + "</div></div>" +
        "</div>";
    }

    externalDrawerHTML(agent) {
      const events = this.external.eventsFor(agent.id);
      const assignments = this.external.assignmentsFor(agent.id);
      const missionTasks = this.external.missionTasksFor(agent.id).slice().sort(function (a, b) {
        const rank = { in_progress: 0, review: 1, assigned: 2, queued: 3, blocked: 4, done: 9 };
        return (rank[a.status] == null ? 5 : rank[a.status]) - (rank[b.status] == null ? 5 : rank[b.status]);
      });
      const online = agent.status === "online";
      const meta = this.external.meta || { roles: [], avatars: [] };
      const roleValue = String(agent.roleOverride || "");
      const avatarValue = String(agent.avatar || "auto");
      const roleName = AO.lang === "en" ? agent.roleLabelEn : agent.roleLabelZh;
      const roleOptions = '<option value="">系统自动分工（当前：' +
        esc(roleName || agent.role || "自动推断") + '）</option>' +
        (meta.roles || []).map(function (role) {
          return '<option value="' + esc(role.id) + '"' +
            (role.id === roleValue ? " selected" : "") + ">" +
            esc(AO.lang === "en" ? role.titleEn : role.titleZh) + "</option>";
        }).join("");
      const avatarOptions = (meta.avatars || []).map(function (item) {
        return '<option value="' + esc(item.id) + '"' +
          (item.id === avatarValue ? " selected" : "") + ">" +
          esc((item.glyph ? item.glyph + " " : "") +
            (AO.lang === "en" ? item.labelEn : item.labelZh)) + "</option>";
      }).join("");
      const customAvatar = avatarValue === "custom" ?
        '<div class="ext-custom-avatar">' +
        '<label>缩写<input data-ext-avatar-text="' + esc(agent.id) + '" maxlength="2" value="' +
        esc(agent.avatarText || "") + '" placeholder="AI" /></label>' +
        '<label>颜色<input type="color" data-ext-avatar-color="' + esc(agent.id) + '" value="' +
        esc(agent.avatarColor || "#b58cff") + '" /></label>' +
        '<button type="button" class="dep-chip" data-ext-avatar-save="' + esc(agent.id) +
        '">保存头像</button></div>' : "";
      const skills = (agent.skills || []).map(function (s) {
        return '<span class="tl-chip">' + esc(s) + "</span>";
      }).join("");
      let eventHtml = "";
      events.forEach((e) => {
        const task = e.taskId ? this.engine.taskById(e.taskId) : null;
        eventHtml += '<button type="button" class="agent-event" ' +
          (task ? 'data-open-task="' + task.id + '"' : 'disabled') + ">" +
          '<span class="ae-time">' + e.clock + '</span><span class="ae-copy"><b>' +
          esc(e.action) + "</b><em>" +
          esc([e.skill, e.tool, fileLabel(e), task ? task.title : ""].filter(Boolean).join(" · ")) +
          "</em></span><span class='ae-kind'>⇢</span></button>";
      });
      if (!eventHtml) {
        eventHtml = '<div class="drawer-empty">还没有外部事件。启动演示 Agent，或让外部 agent 调用 bridge 的 /events 接口。</div>';
      }
      let assignmentHtml = "";
      assignments.forEach((assignment) => {
        const task = this.engine.taskById(assignment.taskId);
        const state = assignment.status === "completed" ? "完成" :
          assignment.status === "failed" ? "失败" :
          assignment.status === "cancelled" ? "取消" :
          assignment.status === "in_progress" ? "进行中" : "已派发";
        const assignmentPct = Math.max(0, Math.min(100, Math.round(assignment.progress || 0)));
        assignmentHtml += '<button type="button" class="agent-event" ' +
          (task ? 'data-open-task="' + task.id + '"' : 'disabled') + ">" +
          '<span class="ae-time">' + assignmentPct + '%</span>' +
          '<span class="ae-copy"><b>' + esc(assignment.taskTitle || assignment.taskId) + "</b><em>" +
          esc(state + " · " + (assignment.updatedAt || "")) + "</em>" +
          '<span class="assignment-progress"><i><u style="width:' + assignmentPct +
          '%"></u></i></span></span>' +
          "<span class='ae-kind'>⇢</span></button>";
      });
      if (!assignmentHtml) {
        assignmentHtml = '<div class="drawer-empty">还没有委托任务。打开一个待办任务，选择这个外部 Agent 派发。</div>';
      }
      let missionTaskHtml = "";
      missionTasks.forEach(function (task) {
        const pct = AO.taskProgressPercent(task);
        const status = AO.taskStatusLabel(task.status) || task.status;
        missionTaskHtml += '<button type="button" class="agent-mission-task" data-open-mission-task="' +
          esc(task.id) + '" data-mission-id="' + esc(task.missionId) +
          '" data-mission-agent="' + esc(agent.id) + '"><span><b>' +
          esc(task.missionTitle || task.missionId) + '</b><em>' + esc(task.title) +
          ' · ' + esc(status) + '</em></span><strong>' + pct + '%</strong>' +
          '<i><u style="width:' + pct + '%"></u></i></button>';
      });
      if (!missionTaskHtml) {
        missionTaskHtml = '<div class="drawer-empty">' + esc(AO.t("externalNoMissionTasks")) + '</div>';
      }
      return '<div class="drawer-head">' +
        '<button type="button" class="drawer-close" data-drawer-close aria-label="关闭">×</button>' +
        '<div class="drawer-kicker">EXTERNAL AGENT · ' +
        esc(agent.brand || agent.runtime || "external") + "</div>" +
        '<h2>' + (agent.logoText ? '<span class="ext-drawer-logo' +
          (agent.logoSource === "preset" ? " emoji" : "") + AO.logoClass(agent) + '" style="--c:' +
          esc(agent.logoColor || "#b58cff") + '">' + AO.logoMarkHTML(agent) + "</span>" : "") +
        esc(agent.name) + "</h2>" +
        '<p class="drawer-desc">' + esc(agent.note || "外部 agent 通过本地 bridge 接入。") + "</p>" +
        '<div class="drawer-chips"><span class="status-chip ' + (online ? "done" : "blocked") + '">' +
        (online ? "ONLINE" : "OFFLINE") + "</span>" +
        '<span class="role-chip" style="--role:#b58cff">EXTERNAL</span>' +
        (roleName ? '<span class="prio-chip">' + esc(roleName) + "</span>" : "") +
        (agent.brand ? '<span class="prio-chip">' + esc(agent.brand) + "</span>" : "") +
        '<span class="prio-chip">' + esc(agent.runtime || "external") + "</span>" +
        (agent.provider ? '<span class="prio-chip">' + esc(agent.provider) + " · " + esc(agent.model || "api") + "</span>" : "") +
        '<button type="button" class="drawer-rename" data-rename-external="' + agent.id +
        '">✎ 重命名</button></div></div>' +
        '<div class="drawer-body">' +
        '<div class="drawer-section ext-appointment">' +
        '<div class="drawer-section-head"><h3>职务与头像</h3><span>用户可编辑</span></div>' +
        '<div class="ext-profile-grid">' +
        '<label>团队职务<select data-ext-role="' + esc(agent.id) + '">' +
        roleOptions + "</select></label>" +
        '<label>头像<select data-ext-avatar="' + esc(agent.id) + '">' +
        avatarOptions + "</select></label></div>" +
        '<p class="drawer-muted">默认职务由技能自动推断；手动选择后，任务推荐会按这个职务匹配。自动头像会识别 Codex / Claude / WorkBuddy / Gemini 等品牌。</p>' +
        customAvatar + "</div>" +
        '<div class="drawer-meta">' +
        "<div><span>ENDPOINT</span><b>" + esc(agent.endpoint || "未填写") + "</b></div>" +
        "<div><span>EVENTS</span><b>" + (agent.eventCount || events.length) + "</b></div>" +
        "<div><span>LAST SEEN</span><b>" + esc(agent.lastSeen || "—") + "</b></div>" +
        "<div><span>MODEL</span><b>" + esc(agent.model || "—") + "</b></div>" +
        "<div><span>BRIDGE</span><b>" + (this.external.bridgeOnline ? "ONLINE" : "OFFLINE") + "</b></div>" +
        "</div>" +
        (agent.provider
          ? '<div class="drawer-section"><div class="drawer-section-head"><h3>模型接口</h3>' +
            "<span>" + esc(agent.protocol || "api") + "</span></div>" +
            '<div class="drawer-actions" style="display:flex;gap:5px">' +
            '<button type="button" class="dep-chip" data-ext-run-provider="' + esc(agent.provider) +
            '">试跑一次</button>' +
            '<span class="drawer-muted">由 bridge 调用，API key 不进入前端；结果写入 ledger / Trace。</span>' +
            "</div></div>"
          : "") +
        '<div class="drawer-section"><div class="drawer-section-head"><h3>SKILLS</h3></div>' +
        '<div class="drawer-chips">' + (skills || '<span class="drawer-muted">未声明</span>') + "</div></div>" +
        '<div class="drawer-section"><div class="drawer-section-head"><h3>' + esc(AO.t("externalMissionTasks")) + '</h3>' +
        "<span>" + missionTasks.length + " 个</span></div>" + missionTaskHtml + "</div>" +
        '<div class="drawer-section"><div class="drawer-section-head"><h3>委托任务</h3>' +
        "<span>" + assignments.length + " 个</span></div>" + assignmentHtml + "</div>" +
        '<div class="drawer-section"><div class="drawer-section-head"><h3>最近外部事件</h3>' +
        "<span>" + events.length + " 条</span></div>" + eventHtml + "</div>" +
        '<div class="drawer-section"><div class="drawer-section-head"><h3>连接</h3></div>' +
        '<p class="drawer-muted">外部 agent 通过 <code>POST /events</code> 上报事件；心跳通过 <code>POST /agents/' +
        esc(agent.id) + '/heartbeat</code>。事件会进入 ledger、Trace Lab 和任务轨迹。</p></div>' +
        '<div class="drawer-section"><div class="drawer-actions" style="display:flex;gap:5px">' +
        '<button type="button" class="dep-chip" data-ext-refresh>刷新状态</button>' +
        '<button type="button" class="dep-chip" data-ext-heartbeat="' + esc(agent.id) + '">测试心跳</button>' +
        '<button type="button" class="dep-chip" data-ext-diagnose>诊断修复</button>' +
        '<button type="button" class="dep-chip" data-ext-remove="' + agent.id + '">移除外部 Agent</button>' +
        "</div></div></div>";
    }

    agentDrawerHTML(agent) {
      const w = this.world;
      const role = AO.ROLES[agent.role] || { color: "#55d6c2", label: agent.role };
      const tasks = w.tasks.filter((t) => t.assignee === agent.id);
      const doneTasks = tasks.filter((t) => t.status === "done").length;
      const reviews = w.ledger.filter((e) => e.kind === "review" && e.agentId === agent.id).length;
      const reworks = tasks.reduce((n, t) => n + t.reworkCount, 0);
      const skillCalls = Object.keys(agent.skillUse)
        .reduce((n, key) => n + agent.skillUse[key], 0);
      const files = Object.keys(agent.filesTouched).map((k) => agent.filesTouched[k])
        .sort((a, b) => b.count - a.count);
      const events = w.ledger.filter((e) => e.agentId === agent.id).slice(-12).reverse();
      const currentTask = agent.taskId ? this.engine.taskById(agent.taskId) : null;
      const currentPct = currentTask ? AO.taskProgressPercent(currentTask) : 0;
      const maxUse = Math.max(1, ...Object.values(agent.skillUse), 1);

      let skills = "";
      (agent.skills || []).forEach((id) => {
        const cat = AO.SKILL_CATALOG[id] || { name: id, category: "—" };
        const use = agent.skillUse[id] || 0;
        skills += '<div class="skill-row' + (use ? "" : " unused") + '">' +
          '<span class="skill-name"><b>' + esc(cat.name) + "</b><em>" + esc(cat.category) +
          "</em></span><i class=\"skill-bar\"><b style=\"width:" +
          Math.round((use / maxUse) * 100) + '%"></b></i><span class="skill-count">' +
          use + "</span></div>";
      });
      if (!skills) skills = '<div class="drawer-empty">该角色未配置技能。</div>';

      let taskHtml = "";
      tasks.forEach((t) => {
        const checks = t.checks.filter((c) => c.status === "done").length;
        const pct = AO.taskProgressPercent(t);
        taskHtml += '<button type="button" class="agent-task" data-open-task="' + t.id + '">' +
          '<span class="agent-task-dot ' + t.status + '"></span><span><b>' +
          esc(t.title) + "</b><em>" + (AO.taskStatusLabel(t.status) || t.status) +
          " · " + checks + "/" + t.checks.length + " 基础工作</em></span>" +
          '<span class="agent-task-pct">' + pct + "%</span>" +
          '<i class="agent-task-bar"><u style="width:' + pct + '%"></u></i></button>';
      });
      if (!taskHtml) taskHtml = '<div class="drawer-empty">还没有负责任务。</div>';

      let recent = "";
      events.forEach((e) => {
        const task = e.taskId ? this.engine.taskById(e.taskId) : null;
        recent += '<button type="button" class="agent-event" data-open-task="' +
          (e.taskId || "") + '"><span class="ae-time">' + e.clock + "</span>" +
          '<span class="ae-copy"><b>' + esc(e.action) + "</b><em>" +
          esc((e.skill ? this.engine.skillName(e.skill) + " · " : "") +
            (e.file ? fileLabel(e) : (task ? task.title : "—"))) +
          "</em></span><span class=\"ae-kind\">" + (TRACE_ICONS[e.kind] || "·") +
          "</span></button>";
      });
      if (!recent) recent = '<div class="drawer-empty">还没有行动记录。</div>';

      let fileHtml = "";
      files.forEach((f) => {
        const range = f.lineStart != null
          ? "L" + f.lineStart + (f.lineEnd != null && f.lineEnd !== f.lineStart ? "–" + f.lineEnd : "")
          : "";
        fileHtml += '<div class="artifact-row"><span class="artifact-icon">▤</span>' +
          '<span class="artifact-copy"><b>' + esc(f.file) + "</b><em>" + range +
          (range ? " · " : "") + f.count + " 次操作</em></span>" +
          '<span class="artifact-delta">' +
          (f.add || f.del ? "+" + f.add + " / −" + f.del : "") + "</span></div>";
      });
      if (!fileHtml) fileHtml = '<div class="drawer-empty">还没有触及文件。</div>';

      return '<div class="drawer-head">' +
        '<button type="button" class="drawer-close" data-drawer-close aria-label="关闭">×</button>' +
        '<button type="button" class="drawer-refresh" data-refresh-drawer aria-label="刷新" title="刷新档案">↻</button>' +
        '<div class="drawer-kicker">AGENT DOSSIER · ' + esc(agent.id) + "</div>" +
        '<div class="agent-drawer-head"><span class="agent-drawer-avatar">' +
        AO.spriteSVG(agent, 54) + "</span><div><h2>" + esc(agent.name) + "</h2>" +
        '<p class="drawer-desc">' + esc(agent.trait) + "</p>" +
        '<div class="drawer-chips"><span class="role-chip" style="--role:' + role.color +
        '">' + esc(role.label) + '</span><span class="status-chip state">' +
        esc(AO.STATE_LABELS[agent.state] || agent.state) + "</span>" +
        '<button type="button" class="drawer-rename" data-rename-local="' + agent.id +
        '">✎ 重命名</button></div></div></div>' +
        "</div>" +
        '<div class="drawer-body">' +
        '<div class="agent-stats">' +
        "<div><b>" + doneTasks + "/" + tasks.length + "</b><span>完成任务</span></div>" +
        "<div><b>" + reviews + "</b><span>评审动作</span></div>" +
        "<div><b>" + skillCalls + "</b><span>技能调用</span></div>" +
        "<div><b>" + reworks + "</b><span>返工</span></div>" +
        "</div>" +
        '<div class="drawer-section"><div class="drawer-section-head"><h3>当前焦点</h3></div>' +
        (currentTask
          ? '<button type="button" class="agent-focus" data-open-task="' + currentTask.id + '">' +
            '<span><b>' + esc(currentTask.title) + '</b><em>' +
            esc(AO.taskStatusLabel(currentTask.status) || currentTask.status) + " · " +
            currentPct + '%</em></span><strong>' + currentPct + '%</strong></button>' +
            '<div class="agent-focus-bar"><i><u style="width:' + currentPct + '%"></u></i></div>'
          : '<div class="drawer-muted">' + esc(agent.activity || "空闲") + "</div>") +
        "</div>" +
        '<div class="drawer-section"><div class="drawer-section-head"><h3>技能矩阵</h3>' +
        "<span>" + skillCalls + " 次调用</span></div><div class=\"skill-list\">" +
        skills + "</div></div>" +
        '<div class="drawer-section"><div class="drawer-section-head"><h3>最近行动</h3>' +
        "<span>最近 " + events.length + " 条</span></div><div class=\"agent-events\">" +
        recent + "</div></div>" +
        '<div class="drawer-section"><div class="drawer-section-head"><h3>负责任务</h3></div>' +
        '<div class="agent-tasks">' + taskHtml + "</div></div>" +
        '<div class="drawer-section"><div class="drawer-section-head"><h3>触及文件</h3>' +
        "<span>" + files.length + " 个</span></div><div class=\"artifact-list\">" +
        fileHtml + "</div></div>" +
        "</div>";
    }

    renderHeader() {
      const w = this.world;
      const total = w.tasks.length;
      const done = w.tasks.filter((t) => t.status === "done").length;
      const pct = total ? Math.round((done / total) * 100) : 0;

      document.getElementById("statTasks").textContent = done + "/" + total;
      document.getElementById("statMeetings").textContent = w.stats.meetings;
      document.getElementById("statMessages").textContent = w.messages.length;
      const statActions = document.getElementById("statActions");
      if (statActions) statActions.textContent = w.ledger.length;
      document.getElementById("clockLabel").textContent = this.engine.clockLabel();
      document.getElementById("dayLabel").textContent = "DAY " + w.day;

      const hour = Math.floor(w.minutes / 60) % 24;
      const minute = w.minutes % 60;
      const hourHand = document.getElementById("wallHour");
      const minuteHand = document.getElementById("wallMinute");
      if (hourHand) {
        hourHand.style.transform = "rotate(" + ((hour % 12) * 30 + minute * 0.5) + "deg)";
      }
      if (minuteHand) {
        minuteHand.style.transform = "rotate(" + (minute * 6) + "deg)";
      }
      this.stage.dataset.time =
        hour < 11 ? "morning" : hour < 14 ? "midday" : hour < 17 ? "afternoon" : "evening";

      const boss = this.engine.agentById("a1");
      const occupancy = document.getElementById("bossOccupancy");
      if (boss && occupancy) {
        const inside =
          boss.x >= 40 && boss.x <= 290 && boss.y >= 64 && boss.y <= 294;
        occupancy.classList.toggle("in", inside);
        occupancy.title = inside ? "老板在办公室" : "老板外出";
      }
      const real = this.demoOff();
      const officeName = document.getElementById("officeName");
      const officeSub = document.getElementById("officeSub");
      const boardTitle = document.getElementById("boardTitle");
      const boardSub = document.getElementById("boardSub");
      const feedTitle = document.getElementById("feedTitle");
      const feedSub = document.getElementById("feedSub");
      if (real) {
        const extCount = this.external ? this.external.agents.length : 0;
        const online = this.external ? this.external.agents.filter(function (a) {
          return a.status === "online" || !!(a.runtime || a.endpoint);
        }).length : 0;
        const live = this.missionLive || AO.missionLive;
        const overview = live && live.lastOverview;
        const missions = ((overview && overview.missions) || []).filter(function (mission) { return !mission.archived; });
        const taskTotal = missions.reduce(function (sum, m) {
          return sum + Number((m.stats || {}).tasks || 0);
        }, 0);
        const taskDone = missions.reduce(function (sum, m) {
          return sum + Number((m.stats || {}).done || 0);
        }, 0);
        const active = missions.filter(function (m) {
          return Number((m.stats || {}).progress || 0) < 100;
        }).length;
        const pending = (overview && overview.approvals ? overview.approvals.length : 0) ||
          missions.reduce(function (sum, m) {
            return sum + Number((m.stats || {}).approvals || 0);
          }, 0);
        const setStat = function (id, value) {
          const el = document.getElementById(id);
          if (el) el.textContent = value;
        };
        setStat("statLabelTasks", AO.t("realStatDone"));
        setStat("statLabelMeetings", AO.t("realStatActive"));
        setStat("statLabelMessages", AO.t("realStatApprovals"));
        setStat("statLabelActions", AO.t("realStatOnline"));
        setStat("statTasks", taskDone + "/" + taskTotal);
        setStat("statMeetings", active + "/" + missions.length);
        setStat("statMessages", String(pending));
        setStat("statActions", online + "/" + extCount);
        if (officeName) officeName.textContent = "REAL OPS";
        if (officeSub) officeSub.textContent = AO.t("realModeOfficeSub", {
          total: extCount, online: online
        });
        if (boardTitle) boardTitle.textContent = "REAL BOARD";
        if (boardSub) boardSub.textContent = AO.t("realModeBoardSub");
        if (feedTitle) feedTitle.textContent = "LIVE FEED";
        if (feedSub) feedSub.textContent = AO.t("realModeFeedSub");
      } else {
        const resetStat = function (id, key) {
          const el = document.getElementById(id);
          if (el) el.textContent = AO.t(key);
        };
        resetStat("statLabelTasks", "tasks");
        resetStat("statLabelMeetings", "meetings");
        resetStat("statLabelMessages", "messages");
        resetStat("statLabelActions", "actions");
        if (officeName) officeName.textContent = w.officeName;
        const scenarioLabel = w.scenarioId === "incident"
          ? AO.t("scenarioIncident")
          : AO.t("scenarioLaunch");
        if (officeSub) officeSub.textContent =
          "DAY " + w.day + " · " + scenarioLabel;
        if (boardTitle) boardTitle.textContent = "SPRINT BOARD";
        if (boardSub) boardSub.textContent = AO.t("goal") + ": " + w.goal;
        if (feedTitle) feedTitle.textContent = "LIVE FEED";
        if (feedSub) feedSub.textContent = AO.t("feedSub");
      }
      const neon = document.getElementById("neonSign");
      if (neon) neon.textContent = w.neon;
      const traceBtn = document.getElementById("traceBtn");
      if (traceBtn) traceBtn.hidden = real;
      const fxBtn = document.getElementById("fxBtn");
      if (fxBtn) fxBtn.hidden = real;

      const ring = document.getElementById("goalRing");
      ring.style.setProperty("--p", String(pct));
      ring.querySelector("b").textContent = pct + "%";
      ring.title = "任务完成度 " + pct + "% · 质量门禁见 AUDIT";

      const audit = this.engine.audit();
      const badge = document.getElementById("auditBadge");
      if (badge) {
        const gaps = audit.risk.length + audit.missed.length;
        badge.textContent = String(gaps);
        badge.classList.toggle("has-risk", audit.risk.length > 0);
        badge.title = audit.done.length + "/" + audit.total + " 基础工作已覆盖";
      }

      const banner = document.getElementById("doneBanner");
      const gate = this.engine.releaseGate();
      const gateLabels = {
        pass: "SHIPPED · GATE PASS",
        approved: "SHIPPED · EXCEPTIONS",
        conditional: "SHIPPED · CONDITIONAL",
        blocked: "DONE · RELEASE BLOCKED",
        rejected: "DONE · REVIEW REJECTED"
      };
      banner.classList.toggle("show", w.done);
      banner.classList.toggle("warn", gate.key !== "pass" && gate.key !== "approved");
      const gateEl = document.getElementById("doneGate");
      if (gateEl) gateEl.textContent = gateLabels[gate.key] || "DONE";
      document.getElementById("doneText").textContent = w.finishText + " · " + gate.label;
      ["newSprintBtn", "doneAuditBtn"].forEach(function (id) {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.disabled = !w.done;
        btn.tabIndex = w.done ? 0 : -1;
        btn.setAttribute("aria-hidden", w.done ? "false" : "true");
      });

      this.stage.classList.toggle("is-done", w.done);
      if (w.done && !this.wasDone) this.burstConfetti();
      this.wasDone = w.done;
    }

    renderTelemetry() {
      const hist = (this.world.history || []).slice(-40);
      const line = document.getElementById("feedLine");
      const area = document.getElementById("feedArea");
      const load = document.getElementById("feedLoad");
      if (!line || !area) return;
      if (hist.length < 2) {
        line.setAttribute("points", "");
        area.setAttribute("points", "");
        if (load) load.textContent = "0/6";
        return;
      }
      const pts = hist.map(function (h, i) {
        const x = (i / (hist.length - 1)) * 120;
        const y = 20 - (Math.min(6, h.busy) / 6) * 17;
        return x.toFixed(1) + "," + y.toFixed(1);
      });
      line.setAttribute("points", pts.join(" "));
      area.setAttribute("points", "0,22 " + pts.join(" ") + " 120,22");
      if (load) load.textContent = (hist[hist.length - 1].busy || 0) + "/6";
    }

    renderWhiteboard() {
      const w = this.world;
      let total = w.tasks.length;
      let done = w.tasks.filter((t) => t.status === "done").length;
      let active = w.tasks.filter((t) => t.status === "in_progress").length;
      let goal = w.goal;
      let sprint = "SPRINT 01";
      let day = "DAY " + w.day;
      if (this.demoOff()) {
        const live = this.missionLive || AO.missionLive;
        const overview = live && live.lastOverview;
        const missions = ((overview && overview.missions) || [])
          .filter(function (mission) { return !mission.archived; })
          .slice()
          .sort(function (a, b) {
            return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
          });
        const activeStatuses = ["running", "discussing", "queued", "waiting_boss", "scheduled"];
        const focus = missions.find(function (mission) {
          return activeStatuses.indexOf(((mission.autoRun || {}).status)) >= 0;
        }) || missions[0] || null;
        const stats = (focus && focus.stats) || {};
        total = Number(stats.tasks || 0);
        done = Number(stats.done || 0);
        active = Math.max(0, total - done);
        goal = focus ? (focus.title || focus.id) : (AO.lang === "en" ? "Awaiting a real mission" : "等待真实任务");
        sprint = "REAL OPS";
        day = "LIVE";
      }
      const goalEl = document.getElementById("wbGoal");
      if (goalEl) goalEl.textContent = goal;
      const metaEl = document.getElementById("wbMeta");
      if (metaEl) metaEl.textContent = done + "/" + total + " 完成 · " + active + " 进行中";
      const sprintEl = document.getElementById("wbSprint");
      if (sprintEl) sprintEl.textContent = sprint;
      const dayEl = document.getElementById("wbDay");
      if (dayEl) dayEl.textContent = day;
      const bar = document.getElementById("wbBar");
      if (bar) bar.style.width = (total ? (done / total) * 100 : 0) + "%";
      const meetingScreen = document.getElementById("meetingScreenLabel");
      if (meetingScreen) {
        meetingScreen.textContent = this.demoOff() ? "REAL OPS · LIVE" : "Q3 · SHIP IT";
      }
    }

    renderInspector() {
      const w = this.world;
      const a = this.selectedId ? this.engine.agentById(this.selectedId) : null;
      if (!a) {
        this.inspector.innerHTML = "";
        this.inspector.classList.add("is-empty");
        return;
      }
      this.inspector.classList.remove("is-empty");
      const role = AO.ROLES[a.role];
      const task = a.taskId ? this.engine.taskById(a.taskId) : null;
      const taskPct = task ? AO.taskProgressPercent(task) : 0;
      const memories = a.memory.slice(-5).reverse();
      let memHtml = "";
      memories.forEach((m) => {
        memHtml += '<li>' + m + "</li>";
      });
      if (!memHtml) memHtml = "<li>还没有记忆。</li>";

      this.inspector.innerHTML =
        '<button class="inspector-close" data-close type="button" aria-label="关闭">×</button>' +
        '<div class="inspector-head">' +
        '<span class="inspector-avatar">' + AO.spriteSVG(a, 34) + "</span>" +
        "<div><b>" + esc(a.name) + '</b><button class="rename-mini" type="button" data-rename-local="' +
        a.id + '" title="重命名" aria-label="重命名">✎</button>' +
        '<span style="color:' + role.color + '">' +
        role.label + " · " + AO.STATE_LABELS[a.state] + "</span></div>" +
        "</div>" +
        '<p class="inspector-trait">' + esc(a.trait) + "</p>" +
        '<div class="inspector-bars">' +
        '<label>精力 <i><b style="width:' + Math.round(a.energy) +
        '%;background:#55d6c2"></b></i></label>' +
        '<label>士气 <i><b style="width:' + Math.round(a.mood) +
        '%;background:#f2b544"></b></i></label>' +
        "</div>" +
        (task
          ? '<button type="button" class="inspector-task is-link" data-open-task="' + task.id +
            '" title="打开任务轨迹"><span>当前</span><b>' + esc(task.title) + "</b><em>" +
            esc(AO.taskStatusLabel(task.status) || task.status) + " · " + taskPct +
            "% ↗</em></button>"
          : '<div class="inspector-task"><span>当前</span><b>' +
            esc(a.activity || "空闲") + "</b></div>") +
        (task ? '<div class="inspector-task-progress"><i><u style="width:' + taskPct +
          '%"></u></i></div>' : "") +
        '<div class="inspector-memory"><span>最近记忆</span><ul>' + memHtml + "</ul></div>" +
        '<button class="inspector-detail" type="button" data-open-agent="' + a.id +
        '">完整档案 · 技能 / 文件 / 轨迹 →</button>';
    }

    renderFeed(force) {
      const w = this.world;
      if (this.demoOff()) {
        const live = this.missionLive || AO.missionLive;
        const overview = live && live.lastOverview;
        const missions = ((overview && overview.missions) || []).filter(function (mission) { return !mission.archived; });
        const activity = (overview && overview.activity) || [];
        const filter = this.realFeedFilter || "all";
        const kindMatch = {
          task: function (row) { return row.kind === "task"; },
          artifact: function (row) { return row.kind === "artifact"; },
          model: function (row) { return row.kind === "model"; },
          approval: function (row) { return row.kind === "approval"; },
          discussion: function (row) { return row.kind === "discussion"; }
        };
        const filtered = filter === "all" ? activity : activity.filter(kindMatch[filter] || function () { return true; });
        const feedTime = function (value) {
          const parsed = Date.parse(value || "");
          if (Number.isNaN(parsed)) return "";
          const date = new Date(parsed);
          return String(date.getHours()).padStart(2, "0") + ":" +
            String(date.getMinutes()).padStart(2, "0");
        };
        const feedStatus = {
          done: "完成", review: "评审中", in_progress: "进行中", assigned: "待开始",
          blocked: "阻塞", backlog: "待办", approved: "已批准", rejected: "已驳回",
          pending: "待审批", ok: "调用成功", error: "失败", stopped: "已停止"
        };
        if (!missions.length) {
          this.feedList.innerHTML = '<div class="real-feed-empty"><b>REAL OPERATIONS ONLY</b>' +
            '<p>' + esc(AO.t("realModeFeedText")) + '</p>' +
            '<button type="button" data-real-open-missions>' +
            esc(AO.t("realModeOpenMissions")) + '</button></div>';
        } else {
          const icons = {
            task: "✓", artifact: "▣", model: "⌁", approval: "◆", discussion: "◌"
          };
          const counts = { all: activity.length };
          activity.forEach(function (row) { counts[row.kind] = (counts[row.kind] || 0) + 1; });
          const tabs = [
            ["all", AO.t("realFeedAll")],
            ["task", AO.t("realFeedTasks")],
            ["artifact", AO.t("realFeedArtifacts")],
            ["model", AO.t("realFeedModels")],
            ["approval", AO.t("realFeedApprovals")]
          ].map(function (pair) {
            return '<button type="button" data-real-feed-filter="' + pair[0] + '"' +
              (filter === pair[0] ? ' class="active"' : '') + '>' + esc(pair[1]) +
              '<em>' + (counts[pair[0]] || 0) + '</em></button>';
          }).join("");
          const rows = filtered.slice(0, 12).map(function (row) {
            const actor = row.actorName ? row.actorName + " " : "";
            const statusText = row.kind === "task" && row.status === "done" ? "" :
              (feedStatus[row.status] || row.status || "");
            const meta = [row.missionTitle, statusText].filter(Boolean).join(" · ");
            const icon = row.kind === "task" ?
              (row.status === "done" ? "✓" : row.status === "review" ? "◉" :
                row.status === "blocked" ? "!" : row.status === "in_progress" ? "▶" : "·") :
              (icons[row.kind] || "·");
            return '<button type="button" class="real-feed-row activity kind-' +
              esc(row.kind || "task") + ' status-' + esc(row.status || "") +
              '" data-real-mission="' + esc(row.missionId || "") +
              '" title="' + esc(actor + row.title) + '">' +
              '<i class="real-feed-icon">' + icon + '</i>' +
              '<span><b>' + esc(actor + row.title) + '</b><em>' + esc(meta) + '</em></span>' +
              '<time>' + esc(feedTime(row.at)) + '</time></button>';
          }).join("");
          // Older bridges do not ship recent activity yet. Keep the panel
          // useful by falling back to real mission rows instead of an empty box.
          const fallbackRows = activity.length ? "" : missions.slice(0, 6).map((mission) => {
            const auto = mission.autoRun || {};
            const stats = mission.stats || {};
            const status = auto.status || "off";
            const progress = Number(stats.progress || 0);
            return '<button type="button" class="real-feed-row activity kind-task status-' +
              esc(status) + '" data-real-mission="' + esc(mission.id) + '">' +
              '<i class="real-feed-icon">✓</i><span><b>' +
              esc(mission.title || mission.id) + '</b><em>' +
              esc(this.autorunShort(status) + " · " + progress + "%") +
              '</em></span><time>—</time></button>';
          }).join("");
          this.feedList.innerHTML = '<div class="real-feed-list activity-feed">' +
            '<div class="real-feed-head"><span>' + esc(AO.t("realModeFeedActive")) +
            '</span><b>' + filtered.length + '</b><em>LIVE</em></div>' +
            '<div class="real-feed-filters">' + tabs + '</div>' +
            (rows || fallbackRows || '<div class="real-feed-none">' + esc(AO.t("realFeedEmpty")) + '</div>') +
            '</div>';
        }
        this.lastMessageId = 0;
        return;
      }
      if (this.feedList.querySelector(".real-feed-empty, .real-feed-list")) {
        this.feedList.innerHTML = "";
        this.lastMessageId = 0;
      }
      if (this.feedFilter === "ledger") {
        this.renderLedgerFeed(!!force);
        return;
      }
      if (force) {
        this.feedList.innerHTML = "";
        this.lastMessageId = 0;
      }
      const fragment = document.createDocumentFragment();
      w.messages.forEach((m) => {
        if (m.id <= this.lastMessageId) return;
        this.lastMessageId = Math.max(this.lastMessageId, m.id);
        if (this.feedFilter === "chat" && m.kind !== "chat") return;
        if (this.feedFilter === "meeting" && m.kind !== "meeting") return;

        const row = document.createElement("div");
        row.className = "feed-row kind-" + m.kind;
        const icon = document.createElement("span");
        icon.className = "feed-icon";
        icon.textContent = FEED_ICONS[m.kind] || "·";
        const time = document.createElement("span");
        time.className = "feed-time";
        time.textContent = this.engine.clockLabel(m.minutes);
        const text = document.createElement("span");
        text.className = "feed-text";
        text.textContent = m.text;
        row.appendChild(icon);
        row.appendChild(time);
        row.appendChild(text);
        fragment.appendChild(row);
      });
      this.feedList.appendChild(fragment);
      if (!this.feedList.childElementCount) {
        const empty = document.createElement("div");
        empty.className = "feed-empty";
        empty.textContent = AO.t(this.feedFilter === "chat" ? "feedEmptyChat" :
          this.feedFilter === "meeting" ? "feedEmptyMeeting" : "feedEmpty");
        this.feedList.appendChild(empty);
      }
      this.feedList.scrollTop = this.feedList.scrollHeight;
    }

    renderLedgerFeed(force) {
      const w = this.world;
      const events = w.ledger.slice(-90);
      const lastId = events.length ? events[events.length - 1].id : 0;
      if (!force && this.lastLedgerSig === lastId && this.feedList.childElementCount) {
        return;
      }
      this.lastLedgerSig = lastId;
      const stick = this.feedList.scrollTop + this.feedList.clientHeight >=
        this.feedList.scrollHeight - 18;
      const previousTop = this.feedList.scrollTop;
      this.feedList.innerHTML = "";
      if (!events.length) {
        const empty = document.createElement("div");
        empty.className = "feed-empty";
        empty.textContent = "还没有行动记录。";
        this.feedList.appendChild(empty);
        return;
      }
      const fragment = document.createDocumentFragment();
      events.forEach((e) => {
        const agent = e.agentId ? this.engine.agentById(e.agentId) : null;
        const row = document.createElement("div");
        row.className = "feed-row feed-ledger kind-" + e.kind + (e.external ? " is-external" : "");
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        row.setAttribute("aria-label", (agent ? agent.name : "SYSTEM") + " " + e.action);
        if (e.taskId) row.setAttribute("data-task", e.taskId);
        const icon = document.createElement("span");
        icon.className = "feed-icon";
        icon.textContent = TRACE_ICONS[e.kind] || "·";
        const time = document.createElement("span");
        time.className = "feed-time";
        time.textContent = e.clock;
        const text = document.createElement("span");
        text.className = "feed-text";
        let meta = "";
        if (e.skill && AO.SKILL_CATALOG[e.skill]) {
          meta += '<span class="feed-skill">' + esc(AO.SKILL_CATALOG[e.skill].name) + "</span>";
        }
        if (e.file) {
          meta += '<span class="feed-file">' + esc(fileLabel(e)) + "</span>";
        }
        if (e.add || e.del) {
          meta += '<span class="feed-delta">+' + e.add + " / −" + e.del + "</span>";
        }
        text.innerHTML =
          '<span class="feed-agent">' + esc(agent ? agent.name : (e.agentName || "SYSTEM")) + "</span>" +
          (e.external ? '<span class="feed-skill">EXT</span>' : "") +
          '<span class="feed-action">' + esc(e.action) + "</span>" +
          (meta ? '<span class="feed-meta">' + meta + "</span>" : "") +
          (e.note ? '<span class="feed-note">' + esc(e.note) + "</span>" : "");
        row.appendChild(icon);
        row.appendChild(time);
        row.appendChild(text);
        fragment.appendChild(row);
      });
      this.feedList.appendChild(fragment);
      this.feedList.scrollTop = stick ? this.feedList.scrollHeight : previousTop;
    }

    updateMeetingRoom() {
      if (!this.meetingRoom) return;
      this.meetingRoom.classList.toggle("active", !!this.world.meeting);
    }

    burstConfetti() {
      const colors = ["#55d6c2", "#f2b544", "#ff7fa8", "#b58cff", "#7bd88f", "#ff6b6b"];
      this.confettiLayer.innerHTML = "";
      for (let i = 0; i < 80; i++) {
        const piece = document.createElement("i");
        piece.className = "confetti";
        piece.style.left = Math.random() * 100 + "%";
        piece.style.background = colors[i % colors.length];
        piece.style.animationDelay = Math.random() * 1.2 + "s";
        piece.style.animationDuration = 2.6 + Math.random() * 2.4 + "s";
        piece.style.width = 4 + Math.round(Math.random() * 5) + "px";
        piece.style.height = 6 + Math.round(Math.random() * 8) + "px";
        piece.style.transform = "rotate(" + Math.random() * 360 + "deg)";
        this.confettiLayer.appendChild(piece);
      }
      window.setTimeout(() => {
        this.confettiLayer.innerHTML = "";
      }, 7000);
    }
  }

  AO.Renderer = Renderer;
})();
