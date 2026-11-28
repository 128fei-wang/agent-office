(function () {
  "use strict";

  const AO = window.AgentOffice;
  const ROLE_TO_LOCAL = {
    chief: "manager",
    product: "research",
    design: "design",
    engineer: "engineer",
    qa: "qa"
  };
  const ACTIVE = ["running", "discussing", "queued", "waiting_boss", "scheduled"];

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function segmentHitsRect(a, b, rect, pad) {
    const left = rect.x - pad;
    const right = rect.x + rect.w + pad;
    const top = rect.y - pad;
    const bottom = rect.y + rect.h + pad;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t0 = 0;
    let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [a.x - left, right - a.x, a.y - top, bottom - a.y];
    for (let i = 0; i < 4; i += 1) {
      if (p[i] === 0) {
        if (q[i] < 0) return false;
      } else {
        const r = q[i] / p[i];
        if (p[i] < 0) {
          if (r > t1) return false;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return false;
          if (r < t1) t1 = r;
        }
      }
    }
    return true;
  }

  function pathBlocked(a, b) {
    const obstacles = AO.OBSTACLES || [];
    for (let i = 0; i < obstacles.length; i += 1) {
      if (segmentHitsRect(a, b, obstacles[i], 9)) return true;
    }
    return false;
  }

  function pathFor(from, to) {
    if (!pathBlocked(from, to)) return [to];
    const hubs = AO.HUBS || [];
    const used = new Array(hubs.length).fill(false);
    for (let depth = 1; depth <= 4; depth += 1) {
      let best = null;
      const walk = function (prev, points) {
        if (points.length === depth) {
          if (pathBlocked(prev, to)) return;
          let total = 0;
          let cursor = from;
          for (let i = 0; i < points.length; i += 1) {
            total += dist(cursor, points[i]);
            cursor = points[i];
          }
          total += dist(cursor, to);
          if (!best || total < best.total) best = { total: total, points: points.slice() };
          return;
        }
        for (let i = 0; i < hubs.length; i += 1) {
          if (used[i]) continue;
          const hub = hubs[i];
          if (pathBlocked(prev, hub)) continue;
          used[i] = true;
          points.push(hub);
          walk(hub, points);
          points.pop();
          used[i] = false;
        }
      };
      walk(from, []);
      if (best) return best.points.concat([to]);
    }
    return [to];
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  class MissionLive {
    constructor(renderer) {
      this.renderer = renderer;
      this.viewport = renderer.viewport;
      this.stage = renderer.stage;
      this.hud = null;
      this.layer = null;
      this.busy = false;
      this.timer = null;
      this.timerTick = null;
      this.activity = null;
      this.lastActive = null;
      this.realEls = {};
      this.realWander = 0;
      this.realTimer = null;
      this.realMission = null;
      this.realDetail = null;
      this.realDetailId = "";
      this.realDetailAt = 0;
      this.realTransient = false;
      this.realTargets = {};
      this.realWalkTimers = {};
      this.realAnims = {};
      this.realCelebrated = false;
      this.realConfettiAt = 0;
      this.realSpotlight = null;
      this.realWeb = null;
      this.realWebEls = {};
      this.realWebInfo = {};
      this.cinemaEl = null;
      this.cinemaKey = "";
      this.cinemaTimers = [];
      this.lastCompletion = { id: "", done: 0 };
      this.pulseEl = null;
      this.pulseTimer = null;
      this.completedUntil = 0;
      this.lastSignature = "";
      const localHost = ["127.0.0.1", "localhost", "::1"].indexOf(location.hostname) >= 0;
      const customBridge = (function () {
        try { return !!localStorage.getItem("agent-office.bridge-url"); } catch (err) { return false; }
      })();
      this.enabled = localHost || customBridge;
      this.noStream = false;
      try {
        this.noStream = new URLSearchParams(location.search).get("noStream") === "1";
      } catch (err) {}
      this.eventStream = null;
      this.build();
      if (this.enabled) {
        this.poll();
        if (!this.noStream) this.startStream();
        this.timer = window.setInterval(this.poll.bind(this), 2500);
        this.timerTick = window.setInterval(this.renderTimers.bind(this), 1000);
        this.realTimer = window.setInterval(this.tickRealOffice.bind(this), 2400);
      }
    }

    startStream() {
      if (typeof EventSource === "undefined") return;
      const self = this;
      try {
        this.eventStream = new EventSource(this.bridge() +
          "/missions/stream?since=999999999");
        this.eventStream.addEventListener("overview", function () {
          if (!document.hidden) self.poll();
        });
        this.eventStream.onerror = function () {};
      } catch (err) {}
    }

    build() {
      if (!this.viewport || !this.stage) return;
      this.hud = document.createElement("div");
      this.hud.className = "mission-live-hud";
      this.hud.hidden = true;
      this.hud.addEventListener("click", (event) => {
        if (event.target.closest("[data-mission-live-stop]")) {
          this.stopRun();
          return;
        }
        if (!event.target.closest("[data-mission-live-open]")) return;
        const id = this.activity && this.activity.missionId;
        const pending = (this.activity && this.activity.pendingApprovals) || 0;
        const view = this.renderer.missions;
        if (!id || !view) return;
        Promise.resolve(view.open()).then(function () {
          return view.selectMission(id);
        }).then(function () {
          if (!pending || !view) return;
          view.detailTab = "approvals";
          view.mobileDetail = true;
          view.render();
        }).catch(function () {});
      });
      this.viewport.appendChild(this.hud);

      this.layer = document.createElement("div");
      this.layer.className = "mission-live-layer";
      this.layer.setAttribute("aria-hidden", "true");
      this.layer.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-real-desktop-agent]");
        if (chip) this.renderer.openExternalDrawer(chip.getAttribute("data-real-desktop-agent"));
      });
      this.stage.appendChild(this.layer);
      this.realSpotlight = document.createElement("div");
      this.realSpotlight.className = "real-spotlight";
      this.realSpotlight.setAttribute("aria-hidden", "true");
      this.stage.appendChild(this.realSpotlight);
      document.addEventListener("agent-office:demo-change", () => {
        window.setTimeout(() => this.poll(), 120);
      });
      document.addEventListener("agent-office:external-agents", () => {
        if (AO.DemoMode && !AO.DemoMode.enabled) this.renderRealDesks();
      });
    }

    realAgentLook(agent) {
      const text = String(agent.id || agent.name || "agent");
      let hash = 0;
      for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
      const skins = ["#f2c6a0", "#d9a066", "#8d5524", "#ffdbac", "#c68642"];
      const hairs = ["#2b2118", "#4a2c1a", "#1c1c24", "#5b3a29", "#a86b3c"];
      const pairs = [
        ["#7cb7ff", "#b58cff"], ["#55d6c2", "#f2b544"], ["#ff9ec0", "#74d6a3"],
        ["#e3a06c", "#9b9cff"], ["#8fa5b7", "#ffb45e"]
      ];
      const pair = pairs[hash % pairs.length];
      const shirt = agent.logoColor && /^#[0-9a-f]{6}$/i.test(agent.logoColor)
        ? agent.logoColor : pair[0];
      return {
        id: agent.id,
        name: agent.name || agent.id,
        role: "engineer",
        skin: skins[hash % skins.length],
        hair: hairs[(hash >>> 3) % hairs.length],
        shirt: shirt,
        hairStyle: hash % 4 === 0 ? "long" : "short"
      };
    }

    realMissionFor(agentId) {
      const overview = this.lastOverview;
      const missions = (overview && overview.missions) || [];
      return missions.find(function (mission) {
        const auto = mission.autoRun || {};
        return !mission.archived && auto.currentAgentId === agentId &&
          ["running", "discussing", "queued", "waiting_boss", "scheduled"].indexOf(auto.status) >= 0;
      }) || null;
    }

    realDeskFor(index) {
      const desks = AO.DESKS.filter(function (desk) { return !desk.boss; });
      return desks[index % Math.max(1, desks.length)] || { x: 435, y: 330 };
    }

    realMeetingSeat(index) {
      const seats = (AO.MEETING && AO.MEETING.seats) || [];
      return seats[index % Math.max(1, seats.length)] || { x: 800, y: 260 };
    }

    realAgentMission(agent) {
      const mission = this.realMission;
      return mission && (mission.members || []).some(function (member) {
        return member.id === agent.id;
      }) ? mission : null;
    }

    realTaskFor(agent) {
      const tasks = (this.realDetail && this.realDetail.tasks) || [];
      return tasks.find(function (task) {
        return task.assigneeId === agent.id &&
          ["in_progress", "review", "assigned"].indexOf(task.status) >= 0;
      }) || null;
    }

    realIdleTask(agent) {
      const tasks = (this.realDetail && this.realDetail.tasks) || [];
      const mine = tasks.filter(function (task) { return task.assigneeId === agent.id; });
      return mine.find(function (task) { return task.status === "done"; }) ||
        mine.find(function (task) { return task.status === "review"; }) || mine[0] || null;
    }

    realIdleArtifact(agent) {
      const artifacts = (this.realDetail && this.realDetail.artifacts) || [];
      return artifacts.filter(function (artifact) {
        return artifact.uploadedBy === agent.id;
      }).slice(-1)[0] || null;
    }

    realClip(text, length) {
      const value = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
      return value.length > length ? value.slice(0, Math.max(0, length - 1)) + "…" : value;
    }

    realIdlePlan(agent, index, now) {
      const anchors = (AO.LAYOUT && AO.LAYOUT.anchors) || {};
      const phaseMs = 11000;
      const offset = index * 2100;
      const cycle = Math.floor((now + offset) / phaseMs);
      const local = (now + offset) % phaseMs;
      const role = (index * 2 + cycle + Math.floor(index / 5)) % 5;
      const task = this.realIdleTask(agent);
      const artifact = this.realIdleArtifact(agent);
      const coffee = [
        { x: 884, y: 516 }, { x: 904, y: 520 }, { x: 862, y: 524 }
      ];
      const lounge = [
        { x: 706, y: 548 }, { x: 766, y: 548 }, { x: 824, y: 556 }, { x: 680, y: 520 }
      ];
      const quiet = [
        { x: 460, y: 192 }, { x: 602, y: 192 }, { x: 620, y: 330 }, { x: 556, y: 232 }
      ];
      const wander = (anchors.wander || []).concat([
        { x: 600, y: 170 }, { x: 600, y: 320 }, { x: 600, y: 470 },
        { x: 410, y: 540 }, { x: 480, y: 200 }
      ]);
      let target;
      let state = "idle";
      let bubble = "";
      if (role === 0) {
        target = this.realDeskFor(index);
        if (task && task.status === "done") {
          state = "reviewing";
          bubble = "复盘 · " + this.realClip(task.title, 20);
        } else if (artifact) {
          state = "reviewing";
          bubble = "整理 · " + this.realClip(artifact.name, 18);
        } else {
          state = "idle";
          bubble = "整理工位 · 待命";
        }
      } else if (role === 1) {
        target = coffee[index % coffee.length];
        state = "coffee";
        bubble = "☕ 续一杯";
      } else if (role === 2) {
        target = lounge[index % lounge.length];
        state = "chatting";
        bubble = task ? "回群消息 · " + this.realClip(task.title, 16) : "回群里看一眼";
      } else if (role === 3) {
        target = quiet[index % quiet.length];
        state = "idle";
        bubble = artifact ? "检查 · " + this.realClip(artifact.name, 18) : "看看下一轮";
      } else {
        target = wander[(index + cycle * 2) % wander.length];
        state = "idle";
        bubble = "巡一下办公室";
      }
      if (local > 6200) bubble = "";
      return { target: target, state: state, bubble: bubble };
    }

    renderRealDesks() {
      if (!this.layer) return;
      const demoOff = AO.DemoMode && !AO.DemoMode.enabled;
      if (!demoOff) {
        Object.keys(this.realAnims).forEach((id) => {
          try { this.realAnims[id].cancel(); } catch (err) {}
        });
        this.lastRealDeskSig = "";
        this.realEls = {};
        this.realTargets = {};
        this.realAnims = {};
        this.realWeb = null;
        this.realWebEls = {};
        this.realWebInfo = {};
        this.layer.innerHTML = "";
        this.stage.classList.remove("real-meeting", "real-waiting", "real-celebrating", "has-current");
        if (this.realSpotlight) this.realSpotlight.classList.remove("show");
        if (this.cinemaEl && !this.cinemaEl.classList.contains("kind-intro")) {
          this.hideCinema(true);
        }
        return;
      }
      if (this.cinemaEl && this.cinemaEl.classList.contains("kind-intro")) {
        this.hideCinema(true);
      }
      const agents = (this.renderer.external && this.renderer.external.agents) || [];
      const visible = agents.slice(0, 8);
      const keep = {};
      visible.forEach((agent) => {
        keep[agent.id] = true;
        let el = this.realEls[agent.id];
        if (!el) {
          el = document.createElement("button");
          el.type = "button";
          el.className = "real-char agent";
          el.setAttribute("data-real-desktop-agent", agent.id);
          const look = this.realAgentLook(agent);
          el.style.setProperty("--role", look.shirt);
          el.innerHTML =
            '<div class="agent-hit"></div>' +
            '<div class="agent-shadow"></div>' +
            '<div class="agent-aura"></div>' +
            '<div class="agent-ring"></div>' +
            '<div class="agent-badge"></div>' +
            '<div class="sprite"><div class="sprite-inner">' + AO.spriteSVG(look, 44) + "</div></div>" +
            '<div class="nametag"><i style="background:' + esc(look.shirt) + '"></i><span>' +
            esc(agent.name || agent.id) + "</span></div>" +
            '<span class="rc-logo' + AO.logoClass(agent) + '" style="--c:' +
            esc(agent.logoColor || look.shirt || "#55d6c2") + '">' + AO.logoMarkHTML(agent) + "</span>" +
            '<span class="rc-bubble"></span>' +
            '<span class="rc-progress"><i></i></span>';
          this.layer.appendChild(el);
          this.realEls[agent.id] = el;
        }
        el.classList.toggle("online", agent.status === "online");
        el.title = (agent.name || agent.id) + " · 点击查看档案";
      });
      Object.keys(this.realEls).forEach((id) => {
        if (keep[id]) return;
        this.realEls[id].remove();
        delete this.realEls[id];
        delete this.realTargets[id];
        if (this.realWalkTimers[id]) clearTimeout(this.realWalkTimers[id]);
        delete this.realWalkTimers[id];
        if (this.realAnims[id]) {
          try { this.realAnims[id].cancel(); } catch (err) {}
          delete this.realAnims[id];
        }
        if (this.realWebEls[id]) {
          this.realWebEls[id].path.remove();
          this.realWebEls[id].bead.remove();
          this.realWebEls[id].node.remove();
          delete this.realWebEls[id];
        }
      });
      this.ensureRealWeb();
      this.tickRealOffice();
    }

    ensureRealWeb() {
      if (!this.layer || this.realWeb) return;
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "real-web");
      svg.setAttribute("viewBox", "0 0 1000 620");
      svg.setAttribute("aria-hidden", "true");
      this.layer.insertBefore(svg, this.layer.firstChild);
      this.realWeb = svg;
      this.realWebEls = {};
    }

    updateRealWeb(mission) {
      if (!this.realWeb) return;
      const NS = "http://www.w3.org/2000/svg";
      const active = !!mission;
      Object.keys(this.realWebInfo).forEach((id) => {
        let info = active ? this.realWebInfo[id] : null;
        let item = this.realWebEls[id];
        if (!info) {
          if (item) {
            item.path.style.display = "none";
            item.bead.style.display = "none";
            item.node.style.display = "none";
          }
          return;
        }
        if (!item) {
          const path = document.createElementNS(NS, "path");
          path.setAttribute("class", "real-web-link");
          const bead = document.createElementNS(NS, "path");
          bead.setAttribute("class", "real-web-bead");
          const node = document.createElementNS(NS, "circle");
          node.setAttribute("class", "real-web-node");
          node.setAttribute("r", "3.2");
          this.realWeb.appendChild(path);
          this.realWeb.appendChild(bead);
          this.realWeb.appendChild(node);
          item = { path: path, bead: bead, node: node };
          this.realWebEls[id] = item;
        }
        const hub = info.hub;
        const x1 = info.x;
        const y1 = info.y - 24;
        const cx = (x1 + hub.x) / 2 + (hub.y < y1 ? -34 : 34);
        const cy = (y1 + hub.y) / 2;
        const d = "M " + x1.toFixed(1) + " " + y1.toFixed(1) +
          " Q " + cx.toFixed(1) + " " + cy.toFixed(1) + " " +
          hub.x.toFixed(1) + " " + hub.y.toFixed(1);
        item.path.setAttribute("d", d);
        item.path.setAttribute("class", "real-web-link state-" + info.state +
          (info.current ? " current" : ""));
        item.path.style.display = "";
        item.bead.setAttribute("d", d);
        item.bead.setAttribute("class", "real-web-bead state-" + info.state +
          (info.current ? " current" : ""));
        item.bead.style.display = "";
        item.node.setAttribute("cx", x1.toFixed(1));
        item.node.setAttribute("cy", y1.toFixed(1));
        item.node.setAttribute("class", "real-web-node state-" + info.state);
        item.node.style.display = "";
      });
      Object.keys(this.realWebEls).forEach((id) => {
        if (this.realWebInfo[id]) return;
        this.realWebEls[id].path.style.display = "none";
        this.realWebEls[id].bead.style.display = "none";
        this.realWebEls[id].node.style.display = "none";
      });
    }

    realMoveTo(el, id, target) {
      const key = Math.round(target.x) + "," + Math.round(target.y);
      if (this.realTargets[id] === key) return;
      const first = !this.realTargets[id];
      this.realTargets[id] = key;
      el.style.zIndex = String(520 + Math.round(target.y));
      const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (first || reduced || typeof el.animate !== "function") {
        el.style.transition = "";
        el.style.left = target.x + "px";
        el.style.top = target.y + "px";
        return;
      }
      const computed = window.getComputedStyle(el);
      const from = {
        x: parseFloat(computed.left) || target.x,
        y: parseFloat(computed.top) || target.y
      };
      if (Math.abs(from.x - target.x) < 1 && Math.abs(from.y - target.y) < 1) {
        el.style.left = target.x + "px";
        el.style.top = target.y + "px";
        return;
      }
      if (this.realAnims[id]) {
        try { this.realAnims[id].cancel(); } catch (err) {}
        delete this.realAnims[id];
      }
      if (this.realWalkTimers[id]) clearTimeout(this.realWalkTimers[id]);
      const points = [from].concat(pathFor(from, target));
      let total = 0;
      for (let i = 1; i < points.length; i += 1) total += dist(points[i - 1], points[i]);
      if (!total) return;
      const frames = points.map(function (point, index) {
        let covered = 0;
        for (let i = 1; i <= index; i += 1) covered += dist(points[i - 1], points[i]);
        return {
          left: point.x + "px",
          top: point.y + "px",
          offset: index ? Math.min(1, covered / total) : 0
        };
      });
      const duration = Math.max(420, Math.min(3600, Math.round((total / 170) * 1000)));
      const direction = points[1] || target;
      if (direction.x < from.x - 2) el.classList.add("flip");
      else if (direction.x > from.x + 2) el.classList.remove("flip");
      el.style.transition = "none";
      el.style.left = target.x + "px";
      el.style.top = target.y + "px";
      el.classList.add("is-walking");
      let anim;
      try {
        anim = el.animate(frames, { duration: duration, easing: "linear", fill: "forwards" });
      } catch (err) {
        el.style.transition = "";
        el.classList.remove("is-walking");
        return;
      }
      this.realAnims[id] = anim;
      const done = () => {
        if (this.realAnims[id] !== anim) return;
        try { anim.cancel(); } catch (err) {}
        delete this.realAnims[id];
        el.style.transition = "";
        el.style.left = target.x + "px";
        el.style.top = target.y + "px";
        el.classList.remove("is-walking");
      };
      anim.onfinish = done;
      this.realWalkTimers[id] = window.setTimeout(done, duration + 120);
    }

    tickRealOffice() {
      if (!this.layer) return;
      const demoOff = AO.DemoMode && !AO.DemoMode.enabled;
      if (!demoOff) return;
      this.realWander += 1;
      const now = Date.now();
      const agents = (this.renderer.external && this.renderer.external.agents) || [];
      const mission = this.realMission;
      const auto = (mission && mission.autoRun) || {};
      const members = new Set(((mission && mission.members) || []).map(function (m) { return m.id; }));
      const membersList = (mission && mission.members) || [];
      const detailTasks = (this.realDetail && this.realDetail.tasks) || [];
      const celebrating = !!(mission && this.realTransient && auto.status === "done");
      if (celebrating && (!this.realCelebrated || now - this.realConfettiAt > 3800)) {
        this.realCelebrated = true;
        this.realConfettiAt = now;
        this.realConfetti();
      }
      if (!celebrating) {
        this.realCelebrated = false;
        this.realConfettiAt = 0;
      }
      const meeting = !!(mission && !celebrating && (
        auto.status === "discussing" || auto.status === "queued" ||
        (mission.discussion && ["running", "queued"].indexOf(mission.discussion.status) >= 0)));
      const partySpots = [
        { x: 468, y: 326 }, { x: 520, y: 306 }, { x: 574, y: 328 },
        { x: 628, y: 344 }, { x: 500, y: 390 }
      ];
      this.stage.classList.toggle("real-meeting", meeting);
      this.stage.classList.toggle("real-waiting", !!mission && auto.status === "waiting_boss");
      this.stage.classList.toggle("real-celebrating", celebrating);
      this.realWebInfo = {};
      let focusPoint = null;
      let focusColor = "#55d6c2";

      agents.slice(0, 8).forEach((agent, index) => {
        const el = this.realEls[agent.id];
        if (!el) return;
        const isMember = !!mission && members.has(agent.id);
        const current = isMember && auto.currentAgentId === agent.id;
        const task = isMember ? detailTasks.find(function (row) {
          return row.assigneeId === agent.id;
        }) : null;
        const openTask = isMember ? detailTasks.find(function (row) {
          return row.assigneeId === agent.id &&
            ["in_progress", "review", "assigned"].indexOf(row.status) >= 0;
        }) : null;
        let target = null;
        let state = "idle";
        let bubble = "";
        let progress = null;

        if (isMember && celebrating) {
          const memberIndex = Math.max(0, membersList.findIndex(function (m) { return m.id === agent.id; }));
          const speaker = membersList.length ? Math.floor(now / 3200) % membersList.length : -1;
          target = partySpots[index % partySpots.length];
          state = "celebrating";
          bubble = memberIndex === speaker ? "SHIP IT · " + this.realClip(mission.title || "", 16) : "";
        } else if (isMember && meeting) {
          const memberIndex = Math.max(0, membersList.findIndex(function (m) { return m.id === agent.id; }));
          target = this.realMeetingSeat(memberIndex);
          state = "meeting";
          // One speaker at a time. Five identical bubbles above the table
          // cover the room and look like a bug, not a meeting.
          const speaker = membersList.length ? Math.floor(now / 4200) % membersList.length : -1;
          bubble = memberIndex === speaker ? "讨论中 · " + this.realClip(mission.title || "", 14) : "";
        } else if (isMember && auto.status === "waiting_boss" && current) {
          target = { x: 258, y: 308 };
          state = "blocked";
          bubble = "等待老板审批";
        } else if (isMember) {
          target = this.realDeskFor(index);
          if (auto.status === "waiting_boss") {
            state = "idle";
            bubble = "等待决策 · " + this.realClip(mission.title || "", 16);
          } else if (current) {
            state = "working";
            bubble = auto.currentTaskTitle || "正在执行";
            const done = Number(auto.completed || 0);
            const total = Number(auto.total || (mission.stats && mission.stats.tasks) || 0);
            progress = total ? Math.round((done / total) * 100) : 0;
          } else if (openTask) {
            if (openTask.status === "review") {
              state = "reviewing";
              bubble = "评审 · " + openTask.title;
              progress = 100;
            } else if (openTask.status === "blocked") {
              state = "blocked";
              bubble = "阻塞 · " + openTask.title;
              progress = Number(openTask.progress || 0);
            } else if (openTask.status === "in_progress") {
              state = "working";
              bubble = openTask.title;
              progress = Number(openTask.progress || 0);
            } else {
              state = "idle";
              bubble = "准备执行 · " + openTask.title;
            }
          } else {
            state = "idle";
            bubble = task ? "本轮已完成 · 待命" :
              (now % 7000 < 3800 ? "待命 · 可调度" : "");
          }
        } else {
          const plan = this.realIdlePlan(agent, index, now);
          target = plan.target;
          state = plan.state;
          bubble = plan.bubble;
        }

        target = target || this.realDeskFor(index);
        target = {
          x: Math.max(28, Math.min(968, target.x)),
          y: Math.max(72, Math.min(592, target.y))
        };
        if (current) {
          focusPoint = target;
          focusColor = this.realAgentLook(agent).shirt;
        }
        this.realMoveTo(el, agent.id, target);
        const states = ["working", "reviewing", "meeting", "walking", "blocked",
          "coffee", "chatting", "idle", "celebrating"];
        states.forEach(function (name) { el.classList.remove("state-" + name); });
        el.classList.add("state-" + state);
        el.classList.toggle("is-working", state === "working" || state === "reviewing");
        el.classList.toggle("is-idle", state === "idle" || state === "coffee" || state === "chatting");
        el.classList.toggle("is-offline", agent.status !== "online");
        el.classList.toggle("selected", current || (state === "blocked"));
        if (isMember && ["working", "reviewing", "meeting", "blocked", "celebrating"].indexOf(state) >= 0) {
          const hub = state === "meeting" ? { x: 800, y: 246 } :
            state === "blocked" ? { x: 160, y: 195 } :
            state === "celebrating" ? { x: 540, y: 340 } :
            { x: 465, y: 152 };
          this.realWebInfo[agent.id] = {
            x: target.x, y: target.y, hub: hub, state: state, current: current
          };
        }
        const badge = el.querySelector(".agent-badge");
        if (badge) {
          badge.textContent = state === "working" ? "▶" : state === "reviewing" ? "◉" :
            state === "meeting" ? "▣" : state === "blocked" ? "!" :
            state === "celebrating" ? "★" : state === "coffee" ? "☕" :
            state === "chatting" ? "…" : "·";
          badge.setAttribute("title", state);
        }
        const bubbleEl = el.querySelector(".rc-bubble");
        if (bubbleEl) {
          if (bubbleEl.textContent !== bubble) bubbleEl.textContent = bubble;
          bubbleEl.classList.toggle("show", !!bubble);
        }
        const progressEl = el.querySelector(".rc-progress");
        if (progressEl) {
          const show = progress !== null && (state === "working" || state === "reviewing");
          progressEl.classList.toggle("show", show);
          const bar = progressEl.querySelector("i");
          if (bar) bar.style.width = String(Math.max(0, Math.min(100, progress || 0))) + "%";
        }
        el.title = (agent.name || agent.id) + " · " + state +
          (bubble ? " · " + bubble : "");
      });
      this.updateRealWeb(mission);
      this.stage.classList.toggle("has-current", !!focusPoint);
      if (this.realSpotlight) {
        if (focusPoint) {
          this.realSpotlight.style.left = focusPoint.x + "px";
          this.realSpotlight.style.top = focusPoint.y + "px";
          this.realSpotlight.style.setProperty("--c", focusColor);
          this.realSpotlight.classList.add("show");
        } else {
          this.realSpotlight.classList.remove("show");
        }
      }
    }

    showTaskPulse(mission, amount) {
      if (!this.stage) return;
      if (this.pulseEl) this.pulseEl.remove();
      if (this.pulseTimer) window.clearTimeout(this.pulseTimer);
      const el = document.createElement("div");
      el.className = "real-task-pulse";
      el.innerHTML = '<b>+' + amount + ' TASK</b><span>' +
        esc(mission.title || mission.id) + '</span><i></i>';
      this.stage.appendChild(el);
      this.pulseEl = el;
      this.stage.classList.add("task-flash");
      const self = this;
      this.pulseTimer = window.setTimeout(function () {
        el.remove();
        self.pulseEl = null;
        self.stage.classList.remove("task-flash");
      }, 2600);
    }

    hideCinema(reset) {
      this.cinemaTimers.forEach((timer) => window.clearTimeout(timer));
      this.cinemaTimers = [];
      if (this.cinemaEl) {
        this.cinemaEl.remove();
        this.cinemaEl = null;
      }
      if (reset) this.cinemaKey = "";
    }

    showCinema(kind, mission) {
      if (!this.stage || !mission) return;
      this.hideCinema(false);
      const auto = mission.autoRun || {};
      const done = Number(auto.completed || (mission.stats || {}).done || 0);
      const total = Number(auto.total || (mission.stats || {}).tasks || 0);
      const members = (mission.members || []).length;
      const title = kind === "wait" ? (auto.currentTaskTitle || mission.title) : mission.title;
      const kicker = kind === "done" ? AO.t("cinemaDoneKicker") :
        kind === "wait" ? AO.t("cinemaWaitKicker") :
        kind === "intro" ? AO.t("cinemaIntroKicker") : AO.t("cinemaStartKicker");
      const hint = kind === "done" ? AO.t("cinemaDoneHint") :
        kind === "wait" ? AO.t("cinemaWaitHint") :
        kind === "intro" ? AO.t("cinemaIntroHint") : AO.t("cinemaStartHint");
      const meta = kind === "wait" ?
        AO.t("cinemaWaitingMeta") :
        AO.t("cinemaMeta", { members: members, done: done, total: total });
      const crew = (mission.members || []).slice(0, 6).map(function (member, index) {
        const name = member.titleZh || member.name || member.id;
        const mark = member.logoText || member.logoUrl ? AO.logoMarkHTML(member) : AO.spriteSVG(member, 18);
        return '<span class="rc-crew-chip" style="--i:' + index + '"><i class="' +
          AO.logoClass(member) + '" style="--c:' + esc(member.logoColor || member.color || "#55d6c2") +
          '">' + mark + '</i><b>' + esc(name) + '</b></span>';
      }).join("");
      const el = document.createElement("div");
      el.className = "real-cinema kind-" + kind + " show";
      el.setAttribute("aria-hidden", "true");
      el.innerHTML =
        '<div class="rc-bar top"></div><div class="rc-bar bottom"></div>' +
        '<div class="rc-body"><span class="rc-kicker">' + esc(kicker) + '</span>' +
        '<h2>' + esc(title || mission.id) + '</h2>' +
        '<p class="rc-meta">' + esc(meta) + '</p>' +
        (kind === "intro" ? '<p class="rc-promise">' + esc(AO.t("tagline")) + '</p>' : '') +
        (crew ? '<div class="rc-crew">' + crew + '</div>' : '') +
        '<div class="rc-progress"><i style="width:' +
        (total ? Math.min(100, Math.round((done / total) * 100)) : 0) + '%"></i></div>' +
        '<span class="rc-hint">' + esc(hint) + '</span>' +
        (kind === "done" ? '<span class="rc-stamp">SHIPPED</span>' : '') +
        '</div><div class="rc-scan"></div>';
      this.stage.appendChild(el);
      this.cinemaEl = el;
      const life = kind === "done" ? 5000 : kind === "intro" ? 4700 : 4100;
      this.cinemaTimers.push(window.setTimeout(function () {
        el.classList.add("hide");
      }, life - 800));
      this.cinemaTimers.push(window.setTimeout(function () {
        if (this.cinemaEl === el) {
          el.remove();
          this.cinemaEl = null;
        }
      }.bind(this), life));
    }

    showIntro() {
      if (!this.renderer || !this.renderer.world || !this.stage) return;
      let seen = "";
      try { seen = sessionStorage.getItem("agent-office.cinema.intro.v1") || ""; } catch (err) {}
      if (seen === "1") return;
      try { sessionStorage.setItem("agent-office.cinema.intro.v1", "1"); } catch (err) {}
      const world = this.renderer.world;
      this.showCinema("intro", {
        id: "demo-sprint",
        title: world.goal,
        members: world.agents,
        stats: { tasks: world.tasks.length },
        autoRun: {
          completed: world.tasks.filter(function (task) { return task.status === "done"; }).length,
          total: world.tasks.length
        }
      });
    }

    maybeCinema(mission, transient) {
      if (!mission) {
        this.hideCinema(true);
        return;
      }
      const auto = mission.autoRun || {};
      const kind = transient && auto.status === "done" ? "done" :
        auto.status === "waiting_boss" ? "wait" : "start";
      const key = kind + ":" + mission.id + ":" + (kind === "wait" ? (auto.currentTaskId || "") : "");
      if (this.cinemaKey === key) return;
      this.cinemaKey = key;
      this.showCinema(kind, mission);
    }

    realConfetti() {
      if (!this.layer) return;
      const colors = ["#55d6c2", "#f2b544", "#ff7fa8", "#b58cff", "#7bd88f"];
      for (let i = 0; i < 34; i += 1) {
        const piece = document.createElement("i");
        piece.className = "real-confetti";
        piece.style.left = (360 + Math.random() * 420) + "px";
        piece.style.top = (160 + Math.random() * 120) + "px";
        piece.style.background = colors[i % colors.length];
        piece.style.animationDelay = (Math.random() * 0.4) + "s";
        piece.style.setProperty("--dx", String(Math.round((Math.random() - 0.5) * 260)) + "px");
        this.layer.appendChild(piece);
        window.setTimeout(function () { piece.remove(); }, 2600);
      }
    }

    bridge() {
      const ext = this.renderer && this.renderer.external;
      return String((ext && ext.bridgeUrl) || AO.BRIDGE_DEFAULT || "")
        .replace(/\/+$/, "");
    }

    async loadRealDetail(missionId, mode) {
      if (!missionId) return;
      const showcase = mode === "showcase";
      if (showcase) {
        if (this.realMission) return;
        if (!this.realShowcase || this.realShowcase.id !== missionId) return;
        if (this.realDetailId === missionId && this.realDetail &&
            Date.now() - this.realDetailAt < 60000) return;
      } else if (!this.realMission || this.realMission.id !== missionId) {
        return;
      }
      try {
        const response = await fetch(this.bridge() + "/missions/" +
          encodeURIComponent(missionId), { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (showcase) {
          if (this.realMission || !this.realShowcase || this.realShowcase.id !== missionId) return;
        } else if (!this.realMission || this.realMission.id !== missionId) {
          return;
        }
        this.realDetail = data.mission || null;
        this.realDetailId = missionId;
        this.realDetailAt = Date.now();
        if (this.renderer) {
          if (this.renderer.renderBoard) this.renderer.renderBoard();
          if (this.renderer.renderRoster) this.renderer.renderRoster();
        }
        this.tickRealOffice();
      } catch (err) {}
    }

    async poll() {
      if (this.busy || document.hidden) return;
      this.busy = true;
      try {
        const response = await fetch(this.bridge() + "/missions/overview", {
          cache: "no-store",
          headers: { "Content-Type": "application/json" }
        });
        if (!response.ok) return;
        const data = await response.json();
        this.applyOverview(data);
      } catch (err) {
        // The static demo has no bridge; silently keep the office simulation.
      } finally {
        this.busy = false;
      }
    }

    syncTopbar(data) {
      const pending = (data.approvals || []).filter(function (a) {
        return a && a.status === "pending";
      }).length;
      ["missionBadge", "railWorkBadge"].forEach(function (id) {
        const badge = document.getElementById(id);
        if (!badge) return;
        badge.hidden = pending === 0;
        badge.textContent = pending > 99 ? "99+" : String(pending);
      });
      const quick = document.getElementById("approvalQuickBtn");
      if (quick) {
        quick.hidden = pending === 0;
        const count = quick.querySelector("b");
        if (count) count.textContent = pending > 99 ? "99+" : String(pending);
        quick.title = pending ? pending + " 个待审批，点击打开 Boss Inbox" : "";
      }
      const button = document.getElementById("missionBtn");
      if (button) {
        button.title = pending ? pending + " 个待审批" : "任务中心";
        button.classList.toggle("has-approvals", pending > 0);
      }
      if (this.lastPending != null && pending > this.lastPending && this.renderer) {
        this.renderer.toast(AO.t("missionNewApproval") || "有新的审批待处理");
      }
      this.lastPending = pending;
    }

    localAgent(role) {
      const target = ROLE_TO_LOCAL[role];
      if (!target || !this.renderer || !this.renderer.world) return null;
      return this.renderer.world.agents.find(function (agent) {
        return agent.role === target;
      }) || null;
    }

    applyOverview(data) {
      this.lastOverview = data || null;
      this.syncTopbar(data || {});
      if (this.renderer && this.renderer.renderWhiteboard) this.renderer.renderWhiteboard();
      if (AO.DemoMode && !AO.DemoMode.enabled) this.renderRealDesks();
      if (AO.DemoMode && AO.DemoMode.refreshCover) AO.DemoMode.refreshCover();
      const demoSafe = !(AO.DemoMode && !AO.DemoMode.enabled);
      if (!demoSafe && this.renderer) {
        this.renderer.renderBoard();
        this.renderer.renderHeader();
        this.renderer.renderRoster();
        if (this.renderer.renderFeed) this.renderer.renderFeed(true);
      }
      const missions = ((data && data.missions) || []).filter(function (m) { return !m.archived; });
      if (AO.DemoMode && AO.DemoMode.setHasRealMissions) {
        AO.DemoMode.setHasRealMissions(missions.length > 0);
      }
      const ranked = missions.filter(function (m) {
        return ACTIVE.indexOf(((m.autoRun || {}).status)) >= 0;
      }).sort(function (a, b) {
        const rank = { running: 0, discussing: 1, waiting_boss: 2, queued: 3 };
        return (rank[(a.autoRun || {}).status] || 9) - (rank[(b.autoRun || {}).status] || 9);
      });
      let mission = ranked[0] || null;
      let transient = false;

      if (!mission && this.lastActive) {
        const finished = missions.find((m) => m.id === this.lastActive.missionId);
        if (finished && (finished.autoRun || {}).status === "done") {
          if (!this.completedUntil) this.completedUntil = Date.now() + 12000;
          if (Date.now() < this.completedUntil) {
            mission = finished;
            transient = true;
          }
        }
      }
      if (!mission && this.completedUntil && Date.now() >= this.completedUntil) {
        this.completedUntil = 0;
        this.lastActive = null;
      }

      if (!mission) {
        if (this.activity) this.clear();
        this.realMission = null;
        this.realTransient = false;
        const showcase = missions.slice().sort(function (a, b) {
          return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
        })[0] || null;
        this.realShowcase = showcase;
        if (!showcase) {
          this.realDetail = null;
          this.realDetailId = "";
        } else {
          if (this.realDetailId !== showcase.id) this.realDetail = null;
          this.loadRealDetail(showcase.id, "showcase");
        }
        if (AO.DemoMode && !AO.DemoMode.enabled) this.hideCinema(true);
        if (this.renderer && this.renderer.renderBoard) this.renderer.renderBoard();
        this.renderRealDesks();
        return;
      }

      this.realMission = mission;
      this.realShowcase = null;
      this.realTransient = transient;
      if (AO.DemoMode && !AO.DemoMode.enabled) this.maybeCinema(mission, transient);
      if (this.realDetailId !== mission.id) this.realDetail = null;
      if (this.realDetailId !== mission.id || Date.now() - this.realDetailAt > 5000) {
        this.loadRealDetail(mission.id);
      }
      if (this.renderer && this.renderer.renderBoard) this.renderer.renderBoard();
      this.renderRealDesks();

      const auto = mission.autoRun || {};
      const status = auto.status || "off";
      const member = (mission.members || []).find(function (item) {
        return item.id === auto.currentAgentId;
      }) || null;
      const ext = this.renderer.external && auto.currentAgentId ?
        this.renderer.external.agentById(auto.currentAgentId) : null;
      const agent = ext || member || null;
      const role = auto.currentRole || (member && member.role) || "";
      const total = Number(auto.total || (mission.stats && mission.stats.tasks) || 0);
      const done = Number(auto.completed || (mission.stats && mission.stats.done) || 0);
      const external = !!(ext || (member && member.source === "external"));
      const local = external ? null : this.localAgent(role);
      const item = {
        missionId: mission.id,
        missionTitle: mission.title || "",
        status: status,
        taskId: auto.currentTaskId || "",
        taskTitle: auto.currentTaskTitle || "",
        agentId: auto.currentAgentId || "",
        agentName: (agent && (agent.name || agent.titleZh)) || auto.currentAgentName || "",
        agent: agent,
        external: external,
        localAgentId: local ? local.id : "",
        total: total,
        done: done,
        pendingApprovals: Number((mission.stats && mission.stats.approvals) || 0),
        error: auto.error || "",
        taskStartedAt: auto.currentTaskStartedAt || auto.startedAt || "",
        startedAt: auto.startedAt || "",
        transient: transient
      };
      if (ACTIVE.indexOf(status) >= 0) {
        this.lastActive = item;
        this.completedUntil = 0;
      }
      if (this.lastCompletion.id === mission.id && this.lastCompletion.done < done) {
        this.showTaskPulse(mission, done - this.lastCompletion.done);
      }
      this.lastCompletion = { id: mission.id, done: done };
      this.activity = item;
      this.renderAll(item);
    }

    statusLabel(item) {
      const labels = {
        running: AO.t("missionLiveRunning"),
        discussing: AO.t("missionLiveDiscussing"),
        waiting_boss: AO.t("missionLiveWaiting"),
        queued: AO.t("missionLiveQueued"),
        scheduled: AO.t("missionAutoRunScheduled"),
        done: AO.t("missionLiveDone")
      };
      return labels[item.status] || AO.t("missionLiveQueued");
    }

    hint(item) {
      if (item.status === "waiting_boss" || item.pendingApprovals) {
        return AO.t("missionLiveBoss");
      }
      return AO.t("missionLiveNoAction");
    }

    renderAll(item) {
      const sig = [item.missionId, item.status, item.taskId, item.agentId,
        item.done, item.total, item.transient ? "t" : "p"].join("|");
      const changed = sig !== this.lastSignature;
      if (changed) {
        this.lastSignature = sig;
        this.renderHud(item);
        this.renderStage(item);
        this.renderBubbles(item);
        if (this.renderer) {
          this.renderer.missionActivity = item;
          this.renderer.renderRoster();
        }
      } else {
        this.renderBubbles(item);
        this.updateBubblePosition(item);
      }
    }

    renderHud(item) {
      if (!this.hud) return;
      const percent = item.total ? Math.min(100, Math.round((item.done / item.total) * 100)) : 0;
      const logo = item.agent ? AO.logoMarkHTML(item.agent) :
        '<span class="mlh-spinner"></span>';
      const task = item.taskTitle ||
        (item.status === "discussing" ? AO.t("missionLiveDiscussing") :
          item.status === "waiting_boss" ? AO.t("missionLiveWaiting") : "");
      this.hud.hidden = false;
      this.hud.className = "mission-live-hud status-" + item.status;
      this.hud.innerHTML =
        '<div class="mlh-top"><span class="mlh-live"><i></i>MISSION LIVE</span><b>' +
        esc(this.statusLabel(item)) + '</b></div>' +
        '<div class="mlh-row"><span class="mlh-logo' + AO.logoClass(item.agent) + '" style="--c:' +
        esc((item.agent && item.agent.logoColor) || "#55d6c2") + '">' + logo + '</span>' +
        '<div class="mlh-copy"><b>' + esc(item.missionTitle) + '</b><p>' +
        (task ? esc(task) : esc(AO.t("missionAutoRunProgress", {
          done: item.done, total: item.total
        }))) + '</p></div><em class="mlh-count">' + item.done + '/' + item.total + '</em></div>' +
        '<div class="mlh-bar"><i style="width:' + percent + '%"></i></div>' +
        '<div class="mlh-foot"><span class="mlh-hint">' + esc(this.hint(item)) +
        '<em class="mlh-elapsed" data-mlh-elapsed></em></span>' +
        (["running", "discussing", "queued", "scheduled"].indexOf(item.status) >= 0 ?
          '<button type="button" class="mlh-stop" data-mission-live-stop>' +
          esc(AO.t("missionLiveStop")) + '</button>' : '') +
        '<button type="button" data-mission-live-open>' + esc(AO.t("missionLiveOpen")) + '</button></div>';
      this.renderTimers();
    }

    renderStage(item) {
      if (!this.layer) return;
      if (AO.DemoMode && !AO.DemoMode.enabled) {
        this.renderRealDesks();
        return;
      }
      const external = item.external && item.agent;
      if (!external) {
        this.renderRealDesks();
        return;
      }
      const desk = AO.DESKS.find((d) => d.hot) || { x: 435, y: 230 };
      const left = desk.x + 35;
      const top = Math.max(80, desk.y - 44);
      const logo = AO.logoMarkHTML(item.agent);
      this.layer.innerHTML =
        '<div class="mission-desk-chip status-' + esc(item.status) + '" style="left:' +
        left + 'px;top:' + top + 'px"><span class="mdc-logo' + AO.logoClass(item.agent) +
        '" style="--c:' + esc(item.agent.logoColor || "#b58cff") + '">' + logo + '</span>' +
        '<div class="mdc-copy"><b>' + esc(item.agentName || item.agent.name || "Agent") +
        '</b><em>' + esc(item.taskTitle || this.statusLabel(item)) + '</em></div>' +
        '<span class="mdc-elapsed" data-mlh-elapsed></span>' +
        '<span class="mdc-dots"><i></i><i></i><i></i></span></div>';
      this.renderTimers();
    }

    renderBubbles(item) {
      if (!this.renderer || !this.renderer.charEls) return;
      Object.keys(this.renderer.charEls).forEach((id) => {
        const el = this.renderer.charEls[id];
        const old = el.querySelector(".mission-task-bubble");
        const busy = id === item.localAgentId;
        el.classList.toggle("mission-busy", busy);
        if (!busy) {
          if (old) old.remove();
          return;
        }
        let bubble = old;
        if (!bubble) {
          bubble = document.createElement("div");
          bubble.className = "mission-task-bubble";
          el.appendChild(bubble);
        }
        bubble.innerHTML = '<b>' + esc(item.agentName || "Agent") + '</b><span>' +
          esc(item.taskTitle || this.statusLabel(item)) + '</span>';
      });
    }

    updateBubblePosition() {
      // The bubble is a child of the animated character, so it follows it.
    }

    formatElapsed(ms) {
      const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
      const minutes = Math.floor(total / 60);
      const seconds = total % 60;
      if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        return hours + ":" + String(minutes % 60).padStart(2, "0") +
          ":" + String(seconds).padStart(2, "0");
      }
      return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
    }

    renderTimers() {
      if (AO.DemoMode && !AO.DemoMode.enabled) {
        const now = new Date();
        const clock = document.getElementById("clockLabel");
        const day = document.getElementById("dayLabel");
        if (clock) clock.textContent = String(now.getHours()).padStart(2, "0") + ":" +
          String(now.getMinutes()).padStart(2, "0");
        if (day) day.textContent = "LIVE";
        const pill = document.querySelector(".clock-pill");
        if (pill) pill.title = AO.lang === "en" ? "Local time" : "本地时间";
        const hour = now.getHours();
        const minute = now.getMinutes();
        const hourHand = document.getElementById("wallHour");
        const minuteHand = document.getElementById("wallMinute");
        if (hourHand) hourHand.style.transform = "rotate(" + ((hour % 12) * 30 + minute * 0.5) + "deg)";
        if (minuteHand) minuteHand.style.transform = "rotate(" + (minute * 6) + "deg)";
        if (this.stage) {
          this.stage.dataset.time = hour < 11 ? "morning" : hour < 14 ? "midday" :
            hour < 17 ? "afternoon" : "evening";
        }
      }
      const item = this.activity;
      const active = item && ["running", "discussing", "queued"].indexOf(item.status) >= 0;
      let label = "";
      const startedAt = item && (item.status === "running" ?
        (item.taskStartedAt || item.startedAt) : item.startedAt);
      if (active && startedAt) {
        const started = Date.parse(startedAt);
        if (!Number.isNaN(started)) {
          label = this.formatElapsed(Date.now() - started);
        }
      }
      if (this.hud) {
        this.hud.querySelectorAll("[data-mlh-elapsed]").forEach((node) => {
          node.textContent = label ? "· " + label : "";
          node.hidden = !label;
        });
      }
      if (this.layer) {
        this.layer.querySelectorAll("[data-mlh-elapsed]").forEach((node) => {
          node.textContent = label;
          node.hidden = !label;
        });
      }
    }

    async stopRun() {
      const item = this.activity;
      if (!item || !item.missionId) return;
      const button = this.hud && this.hud.querySelector("[data-mission-live-stop]");
      if (button) {
        button.disabled = true;
        button.textContent = AO.t("missionLiveStopping");
      }
      try {
        const response = await fetch(this.bridge() + "/missions/" +
          encodeURIComponent(item.missionId) + "/autorun/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        if (this.renderer && this.renderer.toast) {
          this.renderer.toast(AO.t("missionLiveStopped"));
        }
        await this.poll();
      } catch (err) {
        if (this.renderer && this.renderer.toast) {
          this.renderer.toast(AO.t("missionLiveStopFailed"));
        }
        if (button) {
          button.disabled = false;
          button.textContent = AO.t("missionLiveStop");
        }
      }
    }

    clear() {
      this.activity = null;
      this.lastSignature = "";
      this.renderer.missionActivity = null;
      if (this.hud) {
        this.hud.hidden = true;
        this.hud.innerHTML = "";
      }
      if (this.layer) {
        Object.keys(this.realAnims).forEach((id) => {
          try { this.realAnims[id].cancel(); } catch (err) {}
        });
        this.layer.innerHTML = "";
        this.realEls = {};
        this.realTargets = {};
        this.realAnims = {};
      }
      this.stage.classList.remove("real-meeting", "real-waiting", "real-celebrating", "has-current");
      if (this.realSpotlight) this.realSpotlight.classList.remove("show");
      this.realWeb = null;
      this.realWebEls = {};
      this.realWebInfo = {};
      this.hideCinema(true);
      if (this.renderer.charEls) {
        Object.keys(this.renderer.charEls).forEach((id) => {
          const el = this.renderer.charEls[id];
          el.classList.remove("mission-busy");
          const bubble = el.querySelector(".mission-task-bubble");
          if (bubble) bubble.remove();
        });
      }
      this.renderer.renderRoster();
    }

    stop() {
      if (this.timer) window.clearInterval(this.timer);
      if (this.timerTick) window.clearInterval(this.timerTick);
      if (this.realTimer) {
        window.clearInterval(this.realTimer);
        this.realTimer = null;
      }
      if (this.eventStream) {
        this.eventStream.close();
        this.eventStream = null;
      }
      this.timer = null;
      this.timerTick = null;
    }
  }

  AO.MissionLive = MissionLive;
})();
