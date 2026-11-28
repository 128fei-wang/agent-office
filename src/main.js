(function () {
  "use strict";

  const AO = window.AgentOffice;
  const params = new URLSearchParams(window.location.search);
  if (typeof AO.initI18n === "function") AO.initI18n(params.get("lang"));

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
        if (e.key === "Tab") return;
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
  let pausedByDemo = false;
  if (AO.DemoMode && !AO.DemoMode.enabled) {
    engine.paused = true;
    pausedByDemo = true;
  }
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
  const langBtn = document.getElementById("langBtn");
  const guideBtn = document.getElementById("guideBtn");
  const demoQuickBtn = document.getElementById("demoQuickBtn");
  const realOpsBtn = document.getElementById("realOpsBtn");
  const realMissionBtn = document.getElementById("realMissionBtn");
  const companyBtn = document.getElementById("companyBtn");
  const missionBtn = document.getElementById("missionBtn");
  const THEME_KEY = "agent-office.theme.v1";

  function applyTheme(theme, persist) {
    const next = theme === "day" ? "day" : "night";
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle("theme-day", next === "day");
    document.documentElement.style.colorScheme = next === "day" ? "light" : "dark";
    if (themeIcon) themeIcon.textContent = next === "day" ? "☀" : "☾";
    if (themeLabel) themeLabel.textContent = next === "day" ? AO.t("themeDay") : AO.t("themeNight");
    if (themeBtn) {
      themeBtn.setAttribute("aria-pressed", next === "day" ? "true" : "false");
      themeBtn.title = next === "day" ? AO.t("themeToNight") : AO.t("themeToDay");
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

  function syncHud() {
    const readout = document.querySelector(".hud-readout");
    if (!readout) return;
    const on = renderer.fx ? renderer.fx.enabled : false;
    readout.classList.toggle("off", !on);
    const real = AO.DemoMode && !AO.DemoMode.enabled;
    const em = readout.querySelector("em");
    if (em) em.textContent = engine.paused && !real ? "PAUSED" : (on ? "ONLINE" : "OFFLINE");
  }

  function setFxState(on) {
    if (!fxBtn) return;
    fxBtn.classList.toggle("active", on);
    syncHud();
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
    playBtn.textContent = engine.paused ? AO.t("resume") : AO.t("pause");
    playBtn.classList.toggle("is-paused", engine.paused);
    const real = AO.DemoMode && !AO.DemoMode.enabled;
    document.body.classList.toggle("sim-paused", engine.paused && !real);
    syncHud();
    const dot = document.querySelector(".team-panel .live-dot");
    if (dot) {
      dot.classList.toggle("paused", engine.paused && !real);
      dot.title = real ? "真实模式 · 本地模拟已停止" :
        engine.paused ? "模拟已暂停" : "模拟运行中";
    }
  }

  function setLangLabel() {
    if (!langBtn) return;
    langBtn.textContent = AO.lang === "en" ? "中" : "EN";
    langBtn.title = AO.lang === "en" ? "切换到中文" : "Switch to English";
    langBtn.setAttribute("aria-label", langBtn.title);
  }
  setLangLabel();

  function syncDemoQuick() {
    if (!demoQuickBtn) return;
    const on = !AO.DemoMode || AO.DemoMode.enabled;
    demoQuickBtn.textContent = AO.t(on ? "demoQuickOn" : "demoQuickOff");
    demoQuickBtn.title = AO.t(on ? "demoQuickOnTitle" : "demoQuickOffTitle");
    demoQuickBtn.classList.toggle("is-real", !on);
    demoQuickBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (realMissionBtn) realMissionBtn.hidden = on;
    if (realOpsBtn) {
      const dismissed = !!(AO.DemoMode && AO.DemoMode.coverDismissed);
      realOpsBtn.hidden = on;
      realOpsBtn.textContent = AO.t(dismissed ? "realModeOpenPanel" : "realModeClosePanel");
      realOpsBtn.title = dismissed ?
        AO.t("realModeOpenPanelTitle") : AO.t("realModeClosePanelTitle");
      realOpsBtn.setAttribute("aria-expanded", dismissed ? "false" : "true");
      realOpsBtn.classList.toggle("is-dismissed", dismissed);
    }
  }

  function openGuide() {
    if (renderer && renderer.features && renderer.features.guide) {
      renderer.features.guide.open();
    }
  }

  syncDemoQuick();
  if (demoQuickBtn) {
    demoQuickBtn.addEventListener("click", function () {
      if (!AO.DemoMode) return;
      const next = !AO.DemoMode.enabled;
      AO.DemoMode.setEnabled(next);
      renderer.toast(AO.t(next ? "demoModeOn" : "demoModeOff"));
    });
  }
  if (guideBtn) guideBtn.addEventListener("click", openGuide);
  if (realMissionBtn) {
    realMissionBtn.addEventListener("click", function () {
      if (renderer.missions) renderer.missions.open();
    });
  }
  if (realOpsBtn) {
    realOpsBtn.addEventListener("click", function () {
      if (AO.DemoMode) AO.DemoMode.toggleCover();
      syncDemoQuick();
    });
  }
  document.addEventListener("agent-office:demo-change", syncDemoQuick);
  document.addEventListener("agent-office:cover-change", syncDemoQuick);

  if (langBtn) {
    langBtn.addEventListener("click", function () {
      AO.setLang(AO.lang === "en" ? "zh" : "en", true);
      setLangLabel();
      setPlayLabel();
      applyTheme(document.documentElement.dataset.theme === "day" ? "day" : "night", false);
      renderer.render();
      if (renderer.company && renderer.company.isOpen) renderer.company.render();
    });
  }
  document.addEventListener("agent-office:lang", function () {
    setLangLabel();
    syncDemoQuick();
    setPlayLabel();
    applyTheme(document.documentElement.dataset.theme === "day" ? "day" : "night", false);
    renderer.render();
    if (renderer.company && renderer.company.isOpen) renderer.company.render();
  });

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

  function resetTo(scenarioId, options) {
    const opts = options || {};
    const real = AO.DemoMode && !AO.DemoMode.enabled;
    if (opts.confirm && engine.world.tick > 0 && !real) {
      const ok = window.confirm("重置会清空当前模拟进度（tick " +
        engine.world.tick + "），确定继续？");
      if (!ok) return false;
    }
    engine.reset(scenarioId);
    engine.paused = real ? true : (opts.keepPaused ? engine.paused : false);
    renderer.build();
    renderer.setMoveDuration(Math.max(120, Math.round(engine.stepMs * 0.86)));
    setPlayLabel();
    window.requestAnimationFrame(function () {
      renderer.fit();
    });
    schedule();
    return true;
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
    resetTo(engine.scenarioId, { confirm: true });
  });

  const newSprintBtn = document.getElementById("newSprintBtn");
  if (newSprintBtn) {
    newSprintBtn.addEventListener("click", function () {
      resetTo(engine.scenarioId);
      renderer.toast(AO.t("newSprint"));
    });
  }

  const doneAuditBtn = document.getElementById("doneAuditBtn");
  if (doneAuditBtn) {
    doneAuditBtn.addEventListener("click", function () {
      renderer.switchBoardView("audit");
      renderer.toast(AO.t("doneOpenAudit") || "已打开审计面板");
    });
  }

  scenarioSelect.addEventListener("change", function () {
    if (resetTo(scenarioSelect.value, { confirm: true }) === false) {
      scenarioSelect.value = engine.scenarioId;
    }
  });

  document.addEventListener("keydown", function (e) {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
    if (tag === "BUTTON" && (e.code === "Space" || e.key === "Enter")) return;
    const modalOpen = document.querySelector(
      ".feature-modal-root:not([hidden]), .guide-modal-root:not([hidden]), " +
      ".external-modal:not([hidden]), .mission-lab:not([hidden]), " +
      ".update-modal:not([hidden]), .ai-setup-root:not([hidden]), .chat-window, " +
      ".company-lab:not([hidden]), .trace-lab:not([hidden]), .command-root:not([hidden]), #detailDrawer.open"
    );
    if (modalOpen) return;
    const realMode = AO.DemoMode && !AO.DemoMode.enabled;
    if (realMode && ["Space", "1", "2", "4", "m", "M", "e", "E", "a", "A",
      "l", "L", "c", "C", "t", "T"].indexOf(
      e.code === "Space" ? "Space" : e.key) >= 0) return;
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
    } else if (e.key === "c" || e.key === "C") {
      if (renderer.company) {
        if (renderer.company.isOpen) renderer.company.close();
        else renderer.company.open();
      }
    } else if (e.key === "u" || e.key === "U") {
      if (renderer.update) renderer.update.toggle();
    } else if (e.key === "?") {
      openGuide();
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

  if (companyBtn) {
    companyBtn.addEventListener("click", function () {
      if (renderer.company) renderer.company.open();
    });
  }
  if (missionBtn) {
    missionBtn.addEventListener("click", function () {
      if (renderer.missions) renderer.missions.open();
    });
  }
  const approvalQuickBtn = document.getElementById("approvalQuickBtn");
  if (approvalQuickBtn) {
    approvalQuickBtn.addEventListener("click", function () {
      const view = renderer.missions;
      if (!view) return;
      Promise.resolve(view.open()).then(function () {
        view.viewMode = "approvals";
        view.detailTab = "approvals";
        view.approvalFilter = "pending";
        view.render();
        view.loadApprovalHistory();
      }).catch(function () {});
    });
  }
  const companyView = AO.CompanyView ? new AO.CompanyView(engine, renderer, renderer.external) : null;
  renderer.company = companyView;
  const updateCenter = AO.UpdateCenter ? new AO.UpdateCenter(renderer) : null;
  renderer.update = updateCenter;
  const missionView = AO.MissionView ? new AO.MissionView(renderer) : null;
  renderer.missions = missionView;
  const aiSetup = AO.AISetup ? new AO.AISetup(document.getElementById("aiSetupRoot")) : null;
  AO.aiSetup = aiSetup;
  renderer.aiSetup = aiSetup;
  const featureShell = AO.FeatureShell ? new AO.FeatureShell(renderer, {
    missionView: missionView,
    updateCenter: updateCenter
  }) : null;
  renderer.features = featureShell;

  renderer.build();
  const missionLive = AO.MissionLive ? new AO.MissionLive(renderer) : null;
  renderer.missionLive = missionLive;
  AO.missionLive = missionLive;
  if (missionLive && params.get("intro") !== "0" && AO.DemoMode && AO.DemoMode.enabled) {
    window.setTimeout(function () { missionLive.showIntro(); }, 900);
  }

  document.addEventListener("agent-office:demo-change", function (event) {
    const enabled = event.detail && event.detail.enabled;
    if (!enabled) {
      if (!engine.paused) {
        engine.paused = true;
        pausedByDemo = true;
      }
      if (renderer.drawerMode && renderer.drawerMode !== "external") {
        renderer.closeDrawer();
      }
      if (renderer.boardView === "audit") renderer.switchBoardView("board");
    } else if (pausedByDemo) {
      engine.paused = false;
      pausedByDemo = false;
      if (missionLive) window.setTimeout(function () { missionLive.showIntro(); }, 250);
    }
    setPlayLabel();
    renderer.render();
    if (renderer.external) renderer.external.refresh();
    if (missionView && missionView.refreshOverview) missionView.refreshOverview();
  });

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
  if (params.get("company") === "1" && renderer.company) renderer.company.open();
  if (params.get("missions") === "1" && renderer.missions) renderer.missions.open();
  if (params.get("update") === "1" && renderer.update) renderer.update.open();
  if (params.get("ai") === "setup" && renderer.aiSetup) {
    window.setTimeout(function () { renderer.aiSetup.open(); }, 120);
  }
  if (params.get("features") === "1" && featureShell) featureShell.drawer.open();
  if (params.get("guide") === "1" && featureShell) featureShell.guide.open();
  if (params.get("command") === "1" && featureShell) {
    window.setTimeout(function () { featureShell.command.open(); }, 200);
  }
  if (params.get("chat") === "group" && featureShell) featureShell.chat.openGroupPicker();
  if (params.get("chat") === "direct" && featureShell) featureShell.chat.openDirectPicker();
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

/* Install identity: a network-only service worker makes the manifest
 * installable without caching stale local UI. */
if ("serviceWorker" in navigator &&
    (location.protocol === "https:" ||
     location.hostname === "127.0.0.1" ||
     location.hostname === "localhost")) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}
