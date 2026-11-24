(function () {
  "use strict";

  const AO = window.AgentOffice;
  const NS = "http://www.w3.org/2000/svg";

  const C = {
    cyan: "#55d6c2",
    purple: "#b58cff",
    amber: "#f2b544",
    pink: "#ff7fa8",
    red: "#ff6b6b",
    green: "#7bd88f",
    lavender: "#c9a0dc"
  };

  const ROOMS = [
    { id: "ceo", x: 165, y: 180, color: C.amber, label: "CEO" },
    { id: "ea", x: 170, y: 345, color: C.lavender, label: "EA" },
    { id: "board", x: 465, y: 120, color: C.pink, label: "TASK" },
    { id: "ops", x: 400, y: 355, color: C.cyan, label: "OPS" },
    { id: "meet", x: 800, y: 235, color: C.cyan, label: "MEET" },
    { id: "lounge", x: 800, y: 510, color: C.purple, label: "LNG" }
  ];

  const ROOM_LINKS = [
    ["board", "ceo"],
    ["board", "ops"],
    ["ceo", "ea"],
    ["ea", "ops"],
    ["ops", "meet"],
    ["ops", "lounge"],
    ["meet", "lounge"],
    ["ceo", "meet"],
    ["board", "meet"]
  ];

  function el(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        node.setAttribute(key, attrs[key]);
      });
    }
    return node;
  }

  function div(cls, css) {
    const node = document.createElement("div");
    node.className = cls;
    if (css) node.style.cssText = css;
    return node;
  }

  function controlPoint(a, b, bend) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: (a.x + b.x) / 2 + (-dy / len) * bend,
      y: (a.y + b.y) / 2 + (dx / len) * bend
    };
  }

  function curve(a, b, bend) {
    const c = controlPoint(a, b, bend);
    return (
      "M " + a.x.toFixed(1) + " " + a.y.toFixed(1) +
      " Q " + c.x.toFixed(1) + " " + c.y.toFixed(1) +
      " " + b.x.toFixed(1) + " " + b.y.toFixed(1)
    );
  }

  function curveMid(a, b, bend) {
    const c = controlPoint(a, b, bend);
    return {
      x: a.x * 0.25 + c.x * 0.5 + b.x * 0.25,
      y: a.y * 0.25 + c.y * 0.5 + b.y * 0.25
    };
  }

  function point(a) {
    return { x: a.x, y: a.y - 24 };
  }

  class FX {
    constructor(stage, engine) {
      this.stage = stage;
      this.engine = engine;
      this.enabled = true;
      this.lastSig = "";
      this.selectedId = null;
      this.agentNodes = {};

      this.layer = div("fx-layer");
      this.layer.appendChild(div("fx-wash"));
      this.layer.appendChild(div("fx-grid"));
      const shafts = div("fx-shafts");
      shafts.innerHTML = '<i class="s1"></i><i class="s2"></i><i class="s3"></i><i class="s4"></i>';
      this.layer.appendChild(shafts);

      // colored grading pools
      [
        ["cyan", 520, 80, 470, 330],
        ["violet", 590, 370, 400, 270],
        ["amber", 20, 60, 330, 290],
        ["rose", 90, 330, 430, 280],
        ["teal", 120, 240, 500, 340],
        ["warm", 260, 390, 280, 180]
      ].forEach(function (g) {
        const pool = div("fx-glow " + g[0]);
        pool.style.left = g[1] + "px";
        pool.style.top = g[2] + "px";
        pool.style.width = g[3] + "px";
        pool.style.height = g[4] + "px";
        this.layer.appendChild(pool);
      }, this);

      this.svg = el("svg", {
        class: "fx-svg",
        viewBox: "0 0 1000 620",
        width: "1000",
        height: "620"
      });
      this.webGroup = el("g", { class: "fx-web" });
      this.nodeGroup = el("g", { class: "fx-agent-nodes" });
      this.liveGroup = el("g", { class: "fx-live" });
      this.radar = div("fx-meeting-radar");
      this.layer.appendChild(this.radar);

      this.svg.appendChild(this.webGroup);
      this.svg.appendChild(this.nodeGroup);
      this.svg.appendChild(this.liveGroup);
      this.layer.appendChild(this.svg);

      this.layer.appendChild(div("fx-sweep"));
      this.motes = div("fx-motes");
      this.layer.appendChild(this.motes);
      this.layer.appendChild(div("fx-grain"));

      this.buildWeb();
      this.buildMotes();
      this.buildAgentNodes();

      const charLayer = stage.querySelector(".char-layer");
      if (charLayer) stage.insertBefore(this.layer, charLayer);
      else stage.appendChild(this.layer);
    }

    buildWeb() {
      const nodes = {};
      const self = this;

      ROOMS.forEach(function (room) {
        nodes[room.id] = room;
        const dot = el("circle", {
          cx: room.x,
          cy: room.y,
          r: 2.4,
          class: "fx-room-node",
          fill: room.color,
          style: "color:" + room.color
        });
        const pulse = el("circle", {
          cx: room.x,
          cy: room.y,
          r: 8,
          class: "fx-room-pulse",
          style: "color:" + room.color
        });
        const label = el("text", {
          x: room.x + 7,
          y: room.y - 6,
          class: "fx-room-label"
        });
        label.textContent = room.label;
        self.webGroup.appendChild(pulse);
        self.webGroup.appendChild(dot);
        self.webGroup.appendChild(label);
      });

      // Etched floor routes: solid hairlines + one crisp bead. No dashed
      // strokes, no blurred twin path, no drop shadows.
      ROOM_LINKS.forEach(function (pair, i) {
        const a = nodes[pair[0]];
        const b = nodes[pair[1]];
        if (!a || !b) return;
        const bend = (i % 2 === 0 ? 1 : -1) * (26 + (i % 4) * 9);
        const d = curve(a, b, bend);
        const path = el("path", {
          d: d,
          class: "fx-route-line",
          stroke: a.color,
          style: "color:" + a.color
        });
        self.webGroup.appendChild(path);

        const bead = el("circle", {
          r: 1.25,
          class: "fx-route-bead",
          fill: b.color,
          style: "color:" + b.color
        });
        bead.appendChild(el("animateMotion", {
          dur: 7 + (i % 4) * 1.4 + "s",
          begin: (-i * 0.8) + "s",
          repeatCount: "indefinite",
          path: d
        }));
        self.webGroup.appendChild(bead);
      });

      // rotating rings around the meeting table
      this.meetingRings = el("g", { class: "fx-meeting-rings" });
      const r1 = el("circle", {
        cx: 800,
        cy: 235,
        r: 89,
        class: "fx-meet-ring",
        style: "color:" + C.cyan
      });
      r1.appendChild(el("animateTransform", {
        attributeName: "transform",
        type: "rotate",
        from: "0 800 235",
        to: "360 800 235",
        dur: "18s",
        repeatCount: "indefinite"
      }));
      const r2 = el("circle", {
        cx: 800,
        cy: 235,
        r: 70,
        class: "fx-meet-ring reverse",
        style: "color:" + C.amber
      });
      r2.appendChild(el("animateTransform", {
        attributeName: "transform",
        type: "rotate",
        from: "360 800 235",
        to: "0 800 235",
        dur: "24s",
        repeatCount: "indefinite"
      }));
      const hubPulse = el("circle", {
        cx: 800,
        cy: 235,
        r: 16,
        class: "fx-meet-hub-pulse",
        style: "color:" + C.cyan
      });
      const core = el("circle", {
        cx: 800,
        cy: 235,
        r: 4,
        class: "fx-meet-core",
        fill: C.cyan,
        style: "color:" + C.cyan
      });
      this.meetingRings.appendChild(r1);
      this.meetingRings.appendChild(r2);
      this.meetingRings.appendChild(hubPulse);
      this.meetingRings.appendChild(core);
      this.webGroup.appendChild(this.meetingRings);
    }

    buildAgentNodes() {
      const self = this;
      this.engine.world.agents.forEach(function (a) {
        const role = AO.ROLES[a.role] || { color: C.cyan };
        const ring = el("ellipse", {
          cx: a.x,
          cy: a.y - 2,
          rx: 17,
          ry: 6.5,
          class: "fx-agent-node state-idle",
          stroke: role.color,
          style: "color:" + role.color
        });
        self.nodeGroup.appendChild(ring);
        self.agentNodes[a.id] = ring;
      });
    }

    buildMotes() {
      const colors = [C.cyan, C.purple, C.amber, C.pink, "#d9f3ff"];
      for (let i = 0; i < 26; i++) {
        const mote = document.createElement("i");
        mote.className = "fx-mote";
        mote.style.left = 60 + Math.random() * 880 + "px";
        mote.style.top = 70 + Math.random() * 510 + "px";
        mote.style.background = colors[i % colors.length];
        mote.style.color = colors[i % colors.length];
        mote.style.setProperty("--dx", Math.random() * 70 - 35 + "px");
        mote.style.setProperty("--dy", -18 - Math.random() * 56 + "px");
        mote.style.setProperty("--dur", 7 + Math.random() * 11 + "s");
        mote.style.setProperty("--delay", -Math.random() * 15 + "s");
        mote.style.opacity = String(0.22 + Math.random() * 0.38);
        this.motes.appendChild(mote);
      }
    }

    update(selectedId) {
      if (!this.enabled) return;
      this.selectedId = selectedId;

      const world = this.engine.world;
      const agents = world.agents;
      const byId = function (id) {
        return agents.find(function (a) { return a.id === id; });
      };

      agents.forEach(function (a) {
        const ring = this.agentNodes[a.id];
        if (!ring) return;
        ring.setAttribute("cx", a.x.toFixed(1));
        ring.setAttribute("cy", (a.y - 2).toFixed(1));
        ring.setAttribute(
          "class",
          "fx-agent-node state-" + a.state + (a.id === selectedId ? " selected" : "")
        );
      }, this);

      if (this.meetingRings) {
        this.meetingRings.classList.toggle("active", !!world.meeting);
      }
      if (this.radar) {
        this.radar.classList.toggle("active", !!world.meeting);
      }

      const links = [];

      // review handoffs
      world.tasks.forEach(function (t) {
        if (t.status !== "review" || !t.reviewerId || !t.assignee) return;
        const reviewer = byId(t.reviewerId);
        const author = byId(t.assignee);
        if (!reviewer || !author) return;
        links.push({
          key: "review:" + t.id,
          a: point(reviewer),
          b: point(author),
          color: C.purple,
          bend: -34
        });
      });

      // meeting spokes
      if (world.meeting) {
        world.meeting.participants.forEach(function (id) {
          const a = byId(id);
          if (!a || a.state !== "meeting") return;
          links.push({
            key: "meet:" + id,
            a: point(a),
            b: { x: 800, y: 235 },
            color: C.amber,
            bend: (id.charCodeAt(id.length - 1) % 2 === 0 ? 1 : -1) * 34
          });
        });
      }

      // conversations
      agents.forEach(function (a) {
        if (a.state !== "chatting" || !a.chatTarget) return;
        const b = byId(a.chatTarget);
        if (!b) return;
        links.push({
          key: "chat:" + a.id + ":" + b.id,
          a: point(a),
          b: point(b),
          color: C.pink,
          bend: -24
        });
      });

      // escalations
      agents.forEach(function (a) {
        if (a.state !== "blocked") return;
        const manager = byId("a1");
        if (!manager) return;
        links.push({
          key: "blocked:" + a.id,
          a: point(a),
          b: point(manager),
          color: C.red,
          bend: 28
        });
      });

      links.sort(function (x, y) {
        const order = { review: 0, meet: 1, blocked: 2, chat: 3 };
        return (order[x.key.split(":")[0]] || 4) - (order[y.key.split(":")[0]] || 4);
      });
      links.splice(8);

      const sig = links
        .map(function (l) {
          return l.key + ":" + Math.round(l.a.x) + "," + Math.round(l.a.y) +
            "," + Math.round(l.b.x) + "," + Math.round(l.b.y);
        })
        .join("|");

      if (sig === this.lastSig) return;
      this.lastSig = sig;
      this.liveGroup.innerHTML = "";

      const self = this;
      links.forEach(function (link, i) {
        const d = curve(link.a, link.b, link.bend);
        const base = el("path", {
          d: d,
          class: "fx-live-base",
          stroke: link.color,
          style: "color:" + link.color
        });
        const comet = el("path", {
          d: d,
          class: "fx-live-comet",
          pathLength: "100",
          stroke: link.color,
          style: "color:" + link.color
        });
        const dotA = el("circle", {
          cx: link.a.x,
          cy: link.a.y,
          r: 1.8,
          class: "fx-node-dot",
          fill: link.color,
          style: "color:" + link.color
        });
        const dotB = el("circle", {
          cx: link.b.x,
          cy: link.b.y,
          r: 1.8,
          class: "fx-node-dot",
          fill: link.color,
          style: "color:" + link.color
        });

        self.liveGroup.appendChild(base);
        self.liveGroup.appendChild(comet);
        self.liveGroup.appendChild(dotA);
        self.liveGroup.appendChild(dotB);

        const kind = link.key.split(":")[0];
        const labelText = { review: "REVIEW", blocked: "ESCALATE", chat: "SYNC" }[kind];
        if (labelText) {
          const mid = curveMid(link.a, link.b, link.bend);
          const label = el("text", {
            x: mid.x.toFixed(1),
            y: (mid.y - 3).toFixed(1),
            class: "fx-link-label",
            fill: link.color,
            style: "color:" + link.color
          });
          label.textContent = labelText;
          self.liveGroup.appendChild(label);
        }
      });
    }

    burst(x, y, color) {
      if (!this.enabled) return;
      const burst = document.createElement("div");
      burst.className = "fx-burst";
      burst.style.left = x + "px";
      burst.style.top = y + "px";
      burst.style.color = color;
      burst.innerHTML = "<i></i><i></i>";
      this.layer.appendChild(burst);
      window.setTimeout(function () {
        burst.remove();
      }, 1300);
    }

    invalidate() {
      this.lastSig = "";
    }

    setEnabled(on) {
      this.enabled = !!on;
      this.layer.classList.toggle("is-off", !this.enabled);
      this.stage.classList.toggle("fx-off", !this.enabled);
      if (this.enabled) {
        this.invalidate();
        this.update(this.selectedId);
      }
      return this.enabled;
    }

    toggle() {
      return this.setEnabled(!this.enabled);
    }
  }

  AO.FX = FX;
})();
