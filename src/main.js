(function () {
  "use strict";

  const AO = window.AgentOffice;
  const params = new URLSearchParams(window.location.search);

  (function runBoot() {
    const boot = document.getElementById("boot");
    if (!boot) return;
    const skipIntro =
      params.get("intro") === "0" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (skipIntro) {
      boot.remove();
      document.body.classList.add("app-ready");
      return;
    }

    document.body.classList.add("booting");
    const bar = document.getElementById("bootBar");
    const pct = document.getElementById("bootPct");
    const phase = document.getElementById("bootPhase");
    const log = document.getElementById("bootLog");
    const phases = [
      "LINKING AGENT GRID",
      "LOADING SPRINT BOARD",
      "SYNCING MEMORY",
      "MOUNTING PIXEL SECTOR",
      "CALIBRATING NETWORK",
      "SYSTEM ONLINE"
    ];
    const lines = [
      "> agent grid linked",
      "> sprint board loaded",
      "> memory sync complete",
      "> pixel sector mounted",
      "> network calibrated",
      "> all systems online"
    ];
    let step = 0;
    let finished = false;
    let timer = null;

    function addLine(text) {
      const line = document.createElement("span");
      line.textContent = text;
      log.appendChild(line);
      while (log.children.length > 5) log.removeChild(log.firstChild);
    }

    function setStep(n) {
      const p = Math.round((n / phases.length) * 100);
      bar.style.width = p + "%";
      pct.textContent = String(p).padStart(2, "0") + "%";
      phase.textContent = phases[Math.max(0, n - 1)];
      if (n > 0) addLine(lines[n - 1]);
    }

    function finish() {
      if (finished) return;
      finished = true;
      window.clearInterval(timer);
      if (bar) bar.style.width = "100%";
      if (pct) pct.textContent = "100%";
      if (phase) phase.textContent = "SYSTEM ONLINE";
      boot.classList.add("done");
      document.body.classList.remove("booting");
      document.body.classList.add("app-ready");
      window.setTimeout(function () {
        if (boot.parentNode) boot.remove();
      }, 800);
    }

    setStep(0);
    timer = window.setInterval(function () {
      step += 1;
      if (step >= phases.length) {
        setStep(step);
        finish();
        return;
      }
      setStep(step);
    }, 150);

    boot.addEventListener("click", finish);
    window.addEventListener(
      "keydown",
      function (e) {
        e.preventDefault();
        e.stopPropagation();
        finish();
      },
      { once: true, capture: true }
    );
  })();

  if (typeof AO.loadHires === "function") AO.loadHires();
  if (typeof AO.loadNames === "function") AO.loadNames();

  const startScenario = params.get("scenario");
  const engine = new AO.Engine(
    startScenario && AO.SCENARIOS[startScenario] ? startScenario : "launch"
  );
  const renderer = new AO.Renderer(engine);

  const startSpeed = Number(params.get("speed")) || 1;
  const advanceTicks = Math.max(
    0,
    Math.min(400, Number(params.get("ticks")) || 0)
  );
  if (advanceTicks) {
    for (let i = 0; i < advanceTicks; i++) engine.step();
  }

  const playBtn = document.getElementById("playBtn");
  const scenarioSelect = document.getElementById("scenarioSelect");
  const speedSeg = document.getElementById("speedSeg");
  const focusBtn = document.getElementById("focusBtn");
  const fxBtn = document.getElementById("fxBtn");
  const themeBtn = document.getElementById("themeBtn");
  const themeIcon = document.getElementById("themeIcon");
  const themeLabel = document.getElementById("themeLabel");
  const THEME_KEY = "agent-office.theme.v1";

  function applyTheme(theme, persist) {
    const next = theme === "day" ? "day" : "night";
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle("theme-day", next === "day");
    document.documentElement.style.colorScheme = next === "day" ? "light" : "dark";
    if (themeIcon) themeIcon.textContent = next === "day" ? "☀" : "☾";
    if (themeLabel) themeLabel.textContent = next === "day" ? "白天" : "夜间";
    if (themeBtn) {
      themeBtn.setAttribute("aria-pressed", next === "day" ? "true" : "false");
      themeBtn.title = next === "day" ? "切换到夜间模式（D）" : "切换到白天模式（D）";
    }
    if (persist) {
      try { localStorage.setItem(THEME_KEY, next); } catch (err) {}
    }
  }

  let initialTheme = "night";
  try { initialTheme = localStorage.getItem(THEME_KEY) || "night"; } catch (err) {}
  const themeParam = params.get("theme");
  if (themeParam === "day" || themeParam === "night") initialTheme = themeParam;
  applyTheme(initialTheme, false);
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      applyTheme(document.documentElement.dataset.theme === "day" ? "night" : "day", true);
    });
  }

  let timer = null;

  function toggleFocus() {
    const panel = document.querySelector(".stage-panel");
    if (!panel) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (panel.requestFullscreen) {
      panel.requestFullscreen();
    }
  }

  focusBtn.addEventListener("click", toggleFocus);

  function setFxState(on) {
    if (!fxBtn) return;
    fxBtn.classList.toggle("active", on);
    const readout = document.querySelector(".hud-readout");
    if (readout) {
      readout.classList.toggle("off", !on);
      const em = readout.querySelector("em");
      if (em) em.textContent = on ? "ONLINE" : "OFFLINE";
    }
  }

  if (fxBtn) {
    fxBtn.addEventListener("click", function () {
      const on = renderer.fx ? renderer.fx.toggle() : false;
      setFxState(on);
    });
    setFxState(renderer.fx ? renderer.fx.enabled : false);
  }
  document.addEventListener("fullscreenchange", function () {
    focusBtn.textContent = document.fullscreenElement ? "×" : "⛶";
    focusBtn.title = document.fullscreenElement ? "退出全屏" : "全屏查看办公室";
    window.setTimeout(function () {
      renderer.fit();
    }, 80);
  });

  function setPlayLabel() {
    playBtn.textContent = engine.paused ? "继续" : "暂停";
    playBtn.classList.toggle("is-paused", engine.paused);
    document.body.classList.toggle("sim-paused", engine.paused);
  }

  function applySpeed(value) {
    engine.speed = value;
    renderer.setMoveDuration(Math.max(120, Math.round(engine.stepMs * 0.86)));
    speedSeg.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("active", Number(b.getAttribute("data-speed")) === value);
    });
    schedule();
  }

  function schedule() {
    window.clearTimeout(timer);
    timer = window.setTimeout(frame, engine.stepMs);
  }

  function frame() {
    if (!engine.paused) {
      engine.step();
      renderer.render();
    }
    schedule();
  }

  function resetTo(scenarioId) {
    engine.reset(scenarioId);
    engine.paused = false;
    renderer.build();
    renderer.setMoveDuration(Math.max(120, Math.round(engine.stepMs * 0.86)));
    setPlayLabel();
    window.requestAnimationFrame(function () {
      renderer.fit();
    });
    schedule();
  }

  playBtn.addEventListener("click", function () {
    engine.paused = !engine.paused;
    setPlayLabel();
    if (!engine.paused) {
      engine.step();
      renderer.render();
    }
    schedule();
  });

  speedSeg.addEventListener("click", function (e) {
    const btn = e.target.closest("[data-speed]");
    if (!btn) return;
    applySpeed(Number(btn.getAttribute("data-speed")));
  });

  document.getElementById("meetingBtn").addEventListener("click", function () {
    engine.callMeeting("临时对齐会", "把当前依赖和风险过一遍");
    renderer.render();
  });

  document.getElementById("eventBtn").addEventListener("click", function () {
    engine.injectEvent();
    renderer.render();
  });

  document.getElementById("resetBtn").addEventListener("click", function () {
    resetTo(engine.scenarioId);
  });

  scenarioSelect.addEventListener("change", function () {
    resetTo(scenarioSelect.value);
  });

  document.addEventListener("keydown", function (e) {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
    if (tag === "BUTTON" && (e.code === "Space" || e.key === "Enter")) return;
    if (e.code === "Space") {
      e.preventDefault();
      playBtn.click();
    } else if (e.key === "1") {
      applySpeed(1);
    } else if (e.key === "2") {
      applySpeed(2);
    } else if (e.key === "4") {
      applySpeed(4);
    } else if (e.key === "m" || e.key === "M") {
      engine.callMeeting("临时对齐会", "把当前依赖和风险过一遍");
      renderer.render();
    } else if (e.key === "e" || e.key === "E") {
      engine.injectEvent();
      renderer.render();
    } else if (e.key === "f" || e.key === "F") {
      toggleFocus();
    } else if (e.key === "d" || e.key === "D") {
      applyTheme(document.documentElement.dataset.theme === "day" ? "night" : "day", true);
    } else if (e.key === "x" || e.key === "X") {
      if (fxBtn) fxBtn.click();
    } else if (e.key === "a" || e.key === "A") {
      renderer.switchBoardView(renderer.boardView === "audit" ? "board" : "audit");
    } else if (e.key === "l" || e.key === "L") {
      const btn = document.querySelector('#feedFilters [data-filter="ledger"]');
      if (btn) btn.click();
    } else if (e.key === "t" || e.key === "T") {
      if (renderer.traceLab) renderer.traceLab.toggle();
    }
  });

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(function () {
      renderer.fit();
    });
    ro.observe(document.getElementById("stageViewport"));
  } else {
    window.addEventListener("resize", function () {
      renderer.fit();
    });
  }

  renderer.build();
  setPlayLabel();
  scenarioSelect.value = engine.scenarioId;
  applySpeed(startSpeed);
  window.requestAnimationFrame(function () {
    renderer.fit();
  });

  // Deep links: ?audit=1, ?task=t4, ?agent=a1
  if (params.get("audit") === "1") renderer.switchBoardView("audit");
  if (params.get("hire") === "1" && renderer.hiring) renderer.hiring.open();
  if (params.get("external") === "1" && renderer.external) renderer.external.open();
  if ((params.get("trace") === "1" || params.get("trace") === "evals") && renderer.traceLab) {
    renderer.traceLab.open();
    if (params.get("trace") === "evals") renderer.traceLab.setTab("evals");
  }
  const taskParam = params.get("task");
  if (taskParam) renderer.openTaskDrawer(taskParam);
  const agentParam = params.get("agent");
  if (agentParam) renderer.openAgentDrawer(agentParam);

  window.AgentOfficeApp = { engine: engine, renderer: renderer };

  document.addEventListener("agent-office:restored", function () {
    setPlayLabel();
    scenarioSelect.value = engine.scenarioId;
    applySpeed(engine.speed || 1);
    window.requestAnimationFrame(function () {
      renderer.fit();
    });
  });
})();
