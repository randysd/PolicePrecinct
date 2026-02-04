// app.js
(() => {
  const STORAGE_KEY = "pp_dispatcher_state_v1";

  const DEFAULT_SETTINGS = {
    audio: { musicEnabled: true, musicVolume: 0.5, sfxEnabled: true, sfxVolume: 0.8 },
    features: { commendations: true, commendationsTiming: false, dispatches: true, crisis: true },
    pacing: { dispatchRate: "normal", crisisRate: "rare" } // low|normal|high, rare|normal|frequent
  };

  const DEFAULT_UI = {
    dice: { count: 2, values: [1, 1] }
  };

  const COMM_THRESHOLDS = { investigation: 3, arrest: 4, emergency: 5 };

  const SETUP_TABLE = {
    "1": { policeCards: 2, punkPool: 14, calendarStart: "1st" },
    "2": { policeCards: 2, punkPool: 14, calendarStart: "1st" },
    "3": { policeCards: 3, punkPool: 16, calendarStart: "8th" },
    "4": { policeCards: 2, punkPool: 15, calendarStart: "12th" },
    "5": { policeCards: 2, punkPool: 14, calendarStart: "14th" },
    "6": { policeCards: 2, punkPool: 13, calendarStart: "15th" }
  };

  const CONTENT = {
    ads: [],
    classifieds: [],
    articleTemplates: null,
    dispatches: [],
    commendations: [],
    crises: []
  };

  // Content load guard (helps with edge cases where a saved PWA session
  // boots into UI before runtime cache is warm, or older state triggers
  // end-of-shift immediately).
  let CONTENT_LOADED_ONCE = false;


  // -------------------------
  // Audio config
  // -------------------------
  const AUDIO_BASE = "./assets/audio/";

  const AUDIO_FILES = {
    musicMain: "music_main.mp3",
    musicCrisis: "music_crisis.mp3",
    musicEnding: "music_ending.mp3",

    ambient: [
      "sfx_city.mp3",
      "sfx_traffic.mp3"
      // Add more ambient files here later...
    ],

    button: "sfx_button.mp3",

    dice: "sfx_dice.mp3",

    investigateSuccess: "sfx_investigate_success.mp3",
    investigateFail: "sfx_investigate_fail.mp3",
    arrestSuccess: "sfx_arrest_success.mp3",
    arrestFail: "sfx_arrest_fail.mp3",
    emergencySuccess: "sfx_emergency_success.mp3",
    emergencyFail: "sfx_emergency_fail.mp3",

    commendation: "sfx_commendation.mp3",
    dispatch: "sfx_dispatch.mp3",
    crisis: "sfx_crisis.mp3"
  };

  // -------------------------
  // DOM
  // -------------------------
  const viewHome = $("#viewHome");
  const viewGame = $("#viewGame");

  const btnBeginShift = $("#btnBeginShift");
  const btnSetup = $("#btnSetup");
  const btnSettings = $("#btnSettings");
  const btnOpenSettings = $("#btnOpenSettings");
  const btnDice = $("#btnDice");
  const btnStartPlayer = $("#btnStartPlayer");
  const btnOpenSettings2 = $("#btnOpenSettings2");
  const btnCredits = $("#btnCredits");
  const btnQuickAudio = $("#btnQuickAudio");
  const btnHowTo = $("#btnHowTo");
  const btnClearData = $("#btnClearData");

  // Home: contextual/status UI
  const homeStatusPrimary = $("#homeStatusPrimary");
  const homeStatusSecondary = $("#homeStatusSecondary");
  const btnHomeSecondary = $("#btnHomeSecondary");
  const homeStickyBar = $("#homeStickyBar");
  const btnHomeEndShift = $("#btnHomeEndShift");
  const btnHomeResume = $("#btnHomeResume");

  const btnActivityLog = $("#btnActivityLog");
  const btnEndShift = $("#btnEndShift");

  const btnInstallApp = $("#btnInstallApp");

  // Header home badge (top-left)
  const homeBadgeBtn = $("#homeBadgeBtn");

  const overallPct = $("#overallPct");
  const overallActions = $("#overallActions");

  const activeDispatchStrip = $("#activeDispatchStrip");
  const activeDispatchList = $("#activeDispatchList");

  const dispatchFadeLeft = $("#dispatchFadeLeft");
  const dispatchFadeRight = $("#dispatchFadeRight");


  // Update banner
  const updateBanner = $("#updateBanner");
  const btnUpdateNow = $("#btnUpdateNow");
  const btnUpdateLater = $("#btnUpdateLater");

  // Modal
  const modalOverlay = $("#modalOverlay");
  const modalEl = modalOverlay.querySelector(".modal");
  const modalTitle = $("#modalTitle");
  const modalHeaderCenter = $("#modalHeaderCenter");
  const modalBody = $("#modalBody");
  const modalFooter = $("#modalFooter");
  const btnCloseModal = $("#btnCloseModal");

  // Starting Player Selector (fullscreen)
  const startPlayerOverlay = $("#startPlayerOverlay");
  const btnCloseStartPlayer = $("#btnCloseStartPlayer");
  const startPlayerStage = $("#startPlayerStage");
  const startPlayerCanvas = $("#startPlayerCanvas");
  const startPlayerHint = $("#startPlayerHint");
  const startPlayerCountdown = $("#startPlayerCountdown");
  const startPlayerCountdownNum = $("#startPlayerCountdownNum");

  // --- State
  let state = loadState();

  // PWA install prompt
  let deferredInstallPrompt = null;

  // SW update flow
  let swRegistration = null;
  let waitingSW = null;

  // Track current modal type for music switching
  let currentModalType = null;
  let currentModalOptions = { backdropClose: true };

  // Audio manager
  const audio = createAudioManager({
    getSettings: () => state.settings.audio
  });

  // --- Init
  // Content (JSON) must be loaded before we render any UI that depends on it.
  async function init() {
    registerServiceWorkerWithUpdateBanner();
    wireInstallPrompt();
    wireGlobal();
    wireActionButtons();
    wireGlobalButtonSfx();
    route();
    window.addEventListener("hashchange", route);
  }

  (async function boot() {
    await loadContent();
    await init();
  })();

  // -------------------------
  // Routing
  // -------------------------
  function route() {
    const hash = location.hash || "#/home";
    if (hash.startsWith("#/game")) {
      showGame();
    } else {
      showHome();
    }
  }

function showHome() {
  setActiveView(viewHome);
  setBeginShiftButton(!!state.game?.active);

  // Don't show the "go home" badge when we're already on the home screen
  homeBadgeBtn?.classList.add("hidden");
}


  function showGame() {
    if (!state.game?.active) startNewGame();
    setActiveView(viewGame);
    renderGame();

    // End Shift control is relevant while in-game
    btnEndShift?.classList.remove("hidden");

    // Show the home badge when in-game so users can jump back to the home screen
    homeBadgeBtn?.classList.remove("hidden");

    // Start/ensure main audio when entering game (requires user gesture; this is called after Begin/Continue click)
    audio.setMode("main");
  }

  function setActiveView(viewEl) {
    [viewHome, viewGame].forEach(v => v.classList.remove("active"));
    viewEl.classList.add("active");
  }

  // -------------------------
  // Service Worker + Update Banner
  // -------------------------
  function registerServiceWorkerWithUpdateBanner() {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", async () => {
      try {
        swRegistration = await navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" });

        // Proactively check for updates (helps on mobile where SW script can be sticky)
        try { await swRegistration.update(); } catch {}
        // Re-check when the tab becomes visible again
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") {
            swRegistration?.update?.().catch(() => {});
          }
        });
        // Re-check periodically while the app is open
        setInterval(() => {
          swRegistration?.update?.().catch(() => {});
        }, 60 * 1000);


        // If there's already a waiting SW (rare but possible)
        if (swRegistration.waiting) {
          waitingSW = swRegistration.waiting;
          showUpdateBanner();
        }

        swRegistration.addEventListener("updatefound", () => {
          const newWorker = swRegistration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            // When installed, if there's an existing controller, it means an update is ready
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              waitingSW = swRegistration.waiting;
              showUpdateBanner();
            }
          });
        });

        // When the new SW takes control, reload to use fresh caches
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          window.location.reload();
        });

      } catch {
        // silent for bones build
      }
    });

    btnUpdateLater?.addEventListener("click", () => hideUpdateBanner());
    btnUpdateNow?.addEventListener("click", () => {
      if (!waitingSW) return;
      // Tell SW to activate immediately
      waitingSW.postMessage({ type: "SKIP_WAITING" });
      // controllerchange will reload
    });
  }

  function showUpdateBanner() {
    updateBanner?.classList.remove("hidden");
  }
  function hideUpdateBanner() {
    updateBanner?.classList.add("hidden");
  }

  // -------------------------
  // PWA: Install prompt
  // -------------------------
  function wireInstallPrompt() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      btnInstallApp.classList.remove("hidden");
    });

    btnInstallApp.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      btnInstallApp.classList.add("hidden");
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      btnInstallApp.classList.add("hidden");
    });
  }

  // -------------------------
  // Global wiring
  // -------------------------
  function wireGlobal() {
    // Header badge = quick nav back to home
    homeBadgeBtn?.addEventListener("click", async () => {
      // user gesture happened; safe to attempt audio start (for any UI sound)
      await audio.userGestureKick();
      location.hash = "#/home";
    });

    btnBeginShift.addEventListener("click", async () => {
      // Route FIRST so a persistence failure can't abort navigation.
      // The game view will start a new shift if needed.
      location.hash = "#/game";
      // user gesture happened; safe to attempt audio start
      await audio.userGestureKick();
    });

    btnSetup.addEventListener("click", async () => {
      await audio.userGestureKick();
      openSetupModal();
    });

    // Home: contextual "next best" action (Setup when no shift, Case Log when active)
    btnHomeSecondary?.addEventListener("click", async () => {
      await audio.userGestureKick();
      if (state.game?.active) {
        openLogModal();
      } else {
        openSetupModal();
      }
    });

    // Home: sticky shift controls
    btnHomeResume?.addEventListener("click", async () => {
      await audio.userGestureKick();
      location.hash = "#/game";
    });
    btnHomeEndShift?.addEventListener("click", async () => {
      await audio.userGestureKick();
      openEndShiftConfirmModal();
    });

    btnSettings.addEventListener("click", async () => {
      await audio.userGestureKick();
      openSettingsModal();
    });

    btnOpenSettings.addEventListener("click", async () => {
      await audio.userGestureKick();
      openSettingsModal();
    });

    btnOpenSettings2.addEventListener("click", async () => {
      await audio.userGestureKick();
      openSettingsModal();
    });

    btnCredits?.addEventListener("click", async () => {
      await audio.userGestureKick();
      openCreditsModal();
    });

    btnQuickAudio.addEventListener("click", async () => {
      await audio.userGestureKick();
      openAudioModal();
    });

    btnDice.addEventListener("click", async () => {
      await audio.userGestureKick();
      openDiceModal();
    });

    btnStartPlayer.addEventListener("click", async () => {
      await audio.userGestureKick();
      openStartingPlayerSelector();
    });

    btnHowTo.addEventListener("click", async () => {
      await audio.userGestureKick();
      openHowToModal();
    });

    // Home: contextual secondary CTA
    btnHomeSecondary?.addEventListener("click", async () => {
      await audio.userGestureKick();
      if (state.game?.active) {
        openLogModal();
      } else {
        openSetupModal();
      }
    });

    // Home: sticky bar controls (only visible when shift active)
    btnHomeResume?.addEventListener("click", async () => {
      await audio.userGestureKick();
      location.hash = "#/game";
    });

    btnHomeEndShift?.addEventListener("click", async () => {
      await audio.userGestureKick();
      openEndShiftConfirmModal();
    });

    // Action headers (center instruction text)
    document.querySelectorAll(".card-instructions").forEach((el) => {
      el.addEventListener("click", async () => {
        await audio.userGestureKick();
        openActionHelp(el.dataset.cat);
      });
    });

    activeDispatchList.addEventListener("scroll", updateDispatchFades);
    window.addEventListener("resize", updateDispatchFades);

    dispatchFadeLeft.addEventListener("click", () => nudgeDispatchScroll(-1));
    dispatchFadeRight.addEventListener("click", () => nudgeDispatchScroll(1));

    btnClearData.addEventListener("click", async () => {
      await audio.userGestureKick();
      openConfirmModal({
        title: "Reset App Data?",
        text: "This will clear settings and any in-progress shift.",
        confirmText: "Reset",
        confirmClass: "danger",
        onConfirm: () => {
          localStorage.removeItem(STORAGE_KEY);
          state = loadState(true);
          updateQuickAudioIcon();
          audio.applySettings();
          location.hash = "#/home";
        }
      });
    });

    btnActivityLog.addEventListener("click", async () => {
      await audio.userGestureKick();
      openLogModal();
    });

    btnEndShift.addEventListener("click", async () => {
      await audio.userGestureKick();
      openEndShiftConfirmModal();
    });

    btnCloseModal.addEventListener("click", () => {
      closeModal();
    });

    modalOverlay.addEventListener("click", (e) => {
      if (e.target !== modalOverlay) return;
      if (currentModalOptions?.backdropClose === false) return;
      closeModal();
    });

    updateQuickAudioIcon();
    audio.applySettings();
  }

  function updateQuickAudioIcon() {
    const a = state.settings.audio;
    const anyOn = a.musicEnabled || a.sfxEnabled;
    btnQuickAudio.textContent = anyOn ? "🔊" : "🔇";
  }

  // -------------------------
  // Button SFX (global)
  // -------------------------
  function wireGlobalButtonSfx() {
    document.body.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;

      // Don’t double-play when we explicitly play specific sounds below:
      // We'll still play the generic click sound for all buttons, including action buttons.
      audio.playUi(AUDIO_FILES.button);
    });
  }

  // -------------------------
  // Game actions wiring
  // -------------------------
  function wireActionButtons() {
    document.body.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action][data-cat]");
      if (!btn) return;
      if (!state.game?.active) return;

      const action = btn.dataset.action; // success|fail
      const cat = btn.dataset.cat;        // investigation|arrest|emergency

      // Specific action SFX
      if (cat === "investigation") audio.playUi(action === "success" ? AUDIO_FILES.investigateSuccess : AUDIO_FILES.investigateFail);
      if (cat === "arrest") audio.playUi(action === "success" ? AUDIO_FILES.arrestSuccess : AUDIO_FILES.arrestFail);
      if (cat === "emergency") audio.playUi(action === "success" ? AUDIO_FILES.emergencySuccess : AUDIO_FILES.emergencyFail);

      // For segmented SUCCESS buttons, capture the "how many" value that was clicked.
      // - Investigation: clue cards drawn (1 | 2 | 3+)
      // - Arrest: thugs removed (1 | 2 | 3+)
      let amount = 1;
      if (action === "success" && (cat === "investigation" || cat === "arrest")) {
        const seg = e.target.closest(".seg");
        const raw = seg?.getAttribute("data-amount");
        const parsed = raw ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(parsed) && parsed > 0) {
          amount = parsed;
        } else {
          // Fallback: split the button into thirds based on click position.
          const rect = btn.getBoundingClientRect();
          const x = (e.clientX || 0) - rect.left;
          const w = Math.max(1, rect.width);
          const third = w / 3;
          amount = x < third ? 1 : (x < 2 * third ? 2 : 3);
        }
      }

      recordAction(cat, action, amount);
    });
  }

  function startNewGame() {
    const players = clampInt(state.setupDraft?.players ?? 4, 1, 6);
    state.game = createNewGameState();
    state.game.selectedAds = pickAdsForReport();
    state.game.selectedClassifieds = pickClassifiedsForReport();
    saveState();
  }

  function createNewGameState() {
    const players = clampInt(state.setupDraft?.players ?? 4, 1, 6);
    return {
      caseFile: makeCaseFileId(),
      active: true,
      startedAt: Date.now(),
      endedAt: null,
      outcome: null,
      clickCount: 0,
      players,

      categories: {
        investigation: mkCat(),
        arrest: mkCat(),
        emergency: mkCat()
      },

      commendations: {
        investigation: 0,
        arrest: 0,
        emergency: 0
      },

      activeDispatches: [],
      lastDispatchAtClick: 0,
      lastCrisisAtClick: 0,
      crisisActive: null,
      selectedAds: [],        // set after game starts
      selectedClassifieds: [],// set after game starts
      log: []
    };

    function mkCat() {
      // success/fail track button presses (used for success rates)
      // points track the "how many" value for segmented successes (clues, thugs, etc.)
      return { success: 0, fail: 0, commProgress: 0, points: 0 };
    }
  }

  // -------------------------
  // Core game logic
  // -------------------------
  function recordAction(cat, action, amount = 1) {
    const g = state.game;
    g.clickCount += 1;

    const c = g.categories[cat];
    if (action === "success") c.success += 1;
    else c.fail += 1;

    // Segmented success: Investigation = clues found; Arrest = thugs removed
    const isSegmented = (action === "success") && (cat === "investigation" || cat === "arrest");
    if (isSegmented) {
      const pts = clampInt(amount, 1, 3);
      c.points += pts;
      g.log.unshift({ t: Date.now(), type: "action", cat, result: action, amount: pts });
    } else {
      g.log.unshift({ t: Date.now(), type: "action", cat, result: action });
    }

    // Commendations
    if (state.settings.features.commendations && action === "success") {
      // Investigation/Arrest progress is based on points; Emergency remains 1-per-success.
      const inc = (cat === "investigation" || cat === "arrest") ? clampInt(amount, 1, 3) : 1;
      c.commProgress += inc;
      const thresh = COMM_THRESHOLDS[cat];
      // If a segmented click pushes us past the threshold, carry the remainder.
      while (c.commProgress >= thresh) {
        c.commProgress -= thresh;
        g.commendations[cat] += 1;

        const comm = pickCommendation(cat);
        const commTitle = (comm && typeof comm === "object") ? (comm.title || `${cap(cat)} Commendation`) : `${cap(cat)} Commendation`;
        const commText = (comm && typeof comm === "object") ? (comm.text || comm.title || "Commendation issued.") : (comm || "Commendation issued.");

        g.log.unshift({ t: Date.now(), type: "commendation", cat, text: commText, title: commTitle });

        audio.playUi(AUDIO_FILES.commendation);

        openInfoModal({
          title: "Commendation Awarded",
          bodyHtml: `
            <div class="item">
              <div class="item-title">${escapeHtml(commTitle)}</div>
              <div class="item-text">${escapeHtml(commText)}</div>
            </div>
          `,
          primaryText: "Acknowledge",
          modalType: "commendation"
        });
      }
    }

    // Arrest 3+ reminder: +1 donut
    if (action === "success" && cat === "arrest" && clampInt(amount, 1, 3) >= 3) {
      g.log.unshift({ t: Date.now(), type: "reminder", cat, text: "+1 Donut (3+ thugs arrested)" });
      openInfoModal({
        title: "Bonus Donut",
        modalType: "reminder",
        bodyHtml: `
          <div class="item">
            <div class="item-title">Arrest (3+)</div>
            <div class="item-text">Remember: you earn <b>+1 Donut</b> for removing 3+ thugs.</div>
          </div>
        `,
        primaryText: "Got it"
      });
    }

    if (state.settings.features.dispatches) maybeDispatch(cat);
    if (state.settings.features.crisis) maybeCrisis();

    saveState();
    renderGame();
  }

  function maybeDispatch(cat) {
    const g = state.game;
    const cooldown = 4;
    if (g.clickCount - g.lastDispatchAtClick < cooldown) return;

    const p = dispatchProbability(state.settings.pacing.dispatchRate);
    if (Math.random() > p) return;

    g.lastDispatchAtClick = g.clickCount;

    const catRate = getSuccessRate(cat);
    const helpful = catRate < 0.60;

    // Prefer JSON-driven dispatch content; fallback to legacy pools.
    const polarity = helpful ? "helpful" : "hurtful";
    const picked = pickDispatch(cat, polarity);

    const dispatch = picked
      ? {
          id: uid(),
          cat,
          helpful,
          title: picked.title || "Radio Dispatch",
          text: picked.text || "Dispatch update received.",
          // Keep the raw object (if any) but always show a friendly string in UI
          effectObj: picked.effect,
          effect: formatEffect(picked.effect, cat),
          short: picked.title ? picked.title : (helpful ? "Bonus" : "Penalty")
        }
      : buildDispatch(cat, helpful);

    g.activeDispatches.unshift(dispatch);
    g.log.unshift({ t: Date.now(), type: "dispatch", cat, helpful, text: dispatch.text });

    // audio.playUi(AUDIO_FILES.dispatch);
    dispatchStripAlert();
    openDispatchModal(dispatch);
  }

  // Briefly "flicker" the active dispatch strip like a radio/terminal getting new traffic.
  function dispatchStripAlert() {
    try {
      if (!activeDispatchStrip) return;
      // restart animation if it was already running
      activeDispatchStrip.classList.remove("is-alerting");
      // force reflow to allow re-adding the class to retrigger the keyframes
      void activeDispatchStrip.offsetWidth;
      activeDispatchStrip.classList.add("is-alerting");
      window.setTimeout(() => activeDispatchStrip.classList.remove("is-alerting"), 650);
    } catch (_) {}
  }

  function dispatchProbability(rate) {
    switch (rate) {
      case "low": return 0.12;
      case "high": return 0.28;
      default: return 0.20;
    }
  }

  function maybeCrisis() {
    const g = state.game;
    if (g.crisisActive) return;

    const cooldown = crisisCooldown(state.settings.pacing.crisisRate);
    if (g.clickCount - g.lastCrisisAtClick < cooldown) return;

    const p = crisisProbability(state.settings.pacing.crisisRate);
    if (Math.random() > p) return;

    g.lastCrisisAtClick = g.clickCount;

    const crisis = buildCrisis();
    g.crisisActive = crisis;
    g.log.unshift({ t: Date.now(), type: "crisis", status: "started", text: crisis.title });

    audio.playUi(AUDIO_FILES.crisis);
    audio.setMode("crisis"); // switch music while crisis is open
    openCrisisModal(crisis);
  }

  function crisisProbability(rate) {
    switch (rate) {
      case "frequent": return 0.08;
      case "normal": return 0.05;
      default: return 0.03;
    }
  }

  function crisisCooldown(rate) {
    switch (rate) {
      case "frequent": return 10;
      case "normal": return 14;
      default: return 18;
    }
  }

  // -------------------------
  // Rendering
  // -------------------------
  function renderGame() {
    const g = state.game;
    if (!g) return;

    ["investigation", "arrest", "emergency"].forEach(cat => {
      const c = g.categories[cat];
      $(`#${cat}Success`).textContent = c.success;
      $(`#${cat}Fail`).textContent = c.fail;
      const rate = getSuccessRate(cat);
      $(`#${cat}Pct`).textContent = fmtPct(rate);

      const led = document.getElementById(`${cat}Led`);
      if (led) {
        led.classList.remove("red","redorange","orange","yelloworange","yellow","yellowgreen","green","bluegreen","blue");
        led.classList.add(ledClassForRate(rate));
        led.title = `${fmtPct(rate)} success rate`;
      }

      // Optional "points" readouts for segmented categories
      const ptsEl = document.getElementById(`${cat}Points`);
      if (ptsEl) ptsEl.textContent = String(c.points || 0);
    });

    overallPct.textContent = fmtPct(getOverallRate());
    overallActions.textContent = getOverallActions();

    const commOn = state.settings.features.commendations;
    ["investigation","arrest","emergency"].forEach(cat => {
      const wrap = $(`#${cat}CommWrap`);
      if (!commOn) { wrap.classList.add("hidden"); return; }
      wrap.classList.remove("hidden");

      const c = g.categories[cat];
      const thresh = COMM_THRESHOLDS[cat];
      $(`#${cat}CommText`).textContent = `${c.commProgress}/${thresh}`;
      const pct = Math.round((c.commProgress / thresh) * 100);
      $(`#${cat}CommBar`).style.width = `${pct}%`;
    });

    const ds = g.activeDispatches || [];
    if (state.settings.features.dispatches && ds.length > 0) {
      activeDispatchStrip.classList.remove("hidden");
      activeDispatchList.innerHTML = "";

      const catCode = (c) => {
        switch (c) {
          case "investigation": return "INV";
          case "arrest": return "ARR";
          case "emergency": return "EMG";
          default: return String(c || "").slice(0, 3).toUpperCase();
        }
      };

      ds.slice(0, 6).forEach(d => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "dispatch-chip";
        el.classList.add(`cat-${d.cat || "unknown"}`);
        el.classList.add(d.helpful ? "is-helpful" : "is-hurtful");
        el.setAttribute("aria-label", `${cap(d.cat)} dispatch: ${d.short}`);

        // Build structured content for a more "dispatcher terminal" feel.
        const dot = document.createElement("span");
        dot.className = "dc-dot";

        const code = document.createElement("span");
        code.className = "dc-code";
        code.textContent = catCode(d.cat);

        const text = document.createElement("span");
        text.className = "dc-text";
        text.textContent = d.short;

        el.appendChild(dot);
        el.appendChild(code);
        el.appendChild(text);

        el.addEventListener("click", () => openDispatchModal(d, true));
        activeDispatchList.appendChild(el);
      });
    } else {
      activeDispatchStrip.classList.add("hidden");
    }

    requestAnimationFrame(updateDispatchFades);
  }

  function getOverallActions() {
    const g = state.game;
    const cats = g.categories;
    return ["investigation","arrest","emergency"]
      .map(k => cats[k].success + cats[k].fail)
      .reduce((a,b)=>a+b,0);
  }

  function getSuccessRate(cat) {
    const c = state.game.categories[cat];
    const total = c.success + c.fail;
    if (!total) return 0;
    return c.success / total;
  }

  function getOverallRate() {
    const g = state.game;
    const totalS = g.categories.investigation.success + g.categories.arrest.success + g.categories.emergency.success;
    const totalF = g.categories.investigation.fail + g.categories.arrest.fail + g.categories.emergency.fail;
    const total = totalS + totalF;
    if (!total) return 0;
    return totalS / total;
  }

  // -------------------------
  // Modals
  // -------------------------
function openAudioModal() {
  const a = state.settings.audio;

  openModal({
    title: "Audio Controls",
    modalType: "audio",
    bodyHtml: `
      <div class="item">
        <div class="item-title">Music</div>
        <div class="row" style="align-items:center;">
          <div class="field" style="flex:1;">
            <input class="range" id="musicVol" type="range" min="0" max="1" step="0.01" value="${a.musicVolume}">
            <div class="muted tiny">Ambient city/traffic uses Music volume</div>
          </div>
          <div class="mono" style="width:64px; text-align:right;" id="musicVolLabel">${Math.round(a.musicVolume * 100)}%</div>
        </div>
        <div class="row" style="margin-top:8px;">
          <button class="btn small" id="musicToggle">${a.musicEnabled ? "Music: On" : "Music: Off"}</button>
        </div>
      </div>

      <div class="item">
        <div class="item-title">Sound</div>
        <div class="row" style="align-items:center;">
          <div class="field" style="flex:1;">
            <input class="range" id="sfxVol" type="range" min="0" max="1" step="0.01" value="${a.sfxVolume}">
          </div>
          <div class="mono" style="width:64px; text-align:right;" id="sfxVolLabel">${Math.round(a.sfxVolume * 100)}%</div>
        </div>
        <div class="row" style="margin-top:8px;">
          <button class="btn small" id="sfxToggle">${a.sfxEnabled ? "Sound: On" : "Sound: Off"}</button>
        </div>
      </div>
    `,
    footerButtons: [{ text: "Close", className: "btn primary", onClick: closeModal }],
    onOpen: () => {
      const musicVol = $("#musicVol");
      const sfxVol = $("#sfxVol");
      const musicLabel = $("#musicVolLabel");
      const sfxLabel = $("#sfxVolLabel");
      const musicToggle = $("#musicToggle");
      const sfxToggle = $("#sfxToggle");

      const syncLabels = () => {
        musicLabel.textContent = `${Math.round(state.settings.audio.musicVolume * 100)}%`;
        sfxLabel.textContent = `${Math.round(state.settings.audio.sfxVolume * 100)}%`;
        musicToggle.textContent = state.settings.audio.musicEnabled ? "Music: On" : "Music: Off";
        sfxToggle.textContent = state.settings.audio.sfxEnabled ? "Sound: On" : "Sound: Off";
      };

      musicVol.addEventListener("input", () => {
        state.settings.audio.musicVolume = clampNum(musicVol.value, 0, 1);
        saveState();
        audio.applySettings();
        syncLabels();
      });

      sfxVol.addEventListener("input", () => {
        state.settings.audio.sfxVolume = clampNum(sfxVol.value, 0, 1);
        saveState();
        audio.applySettings();
        syncLabels();
      });

      musicToggle.addEventListener("click", () => {
        state.settings.audio.musicEnabled = !state.settings.audio.musicEnabled;
        saveState();
        audio.applySettings();
        syncLabels();
      });

      sfxToggle.addEventListener("click", () => {
        state.settings.audio.sfxEnabled = !state.settings.audio.sfxEnabled;
        saveState();
        syncLabels();
      });

      syncLabels();
    }
  });
}

function openDiceModal() {
  // Ensure ui exists (older stored states)
  state.ui = state.ui || structuredClone(DEFAULT_UI);
  state.ui.dice = state.ui.dice || structuredClone(DEFAULT_UI.dice);
  // Dice roller is intentionally compact + fast to use: 1..10 dice
  state.ui.dice.count = clampInt(state.ui.dice.count, 1, 10);
  state.ui.dice.values = Array.isArray(state.ui.dice.values) ? state.ui.dice.values : [];
  while (state.ui.dice.values.length < state.ui.dice.count) state.ui.dice.values.push(1);
  if (state.ui.dice.values.length > state.ui.dice.count) state.ui.dice.values = state.ui.dice.values.slice(0, state.ui.dice.count);

  openModal({
    title: "Dice Roller",
    modalType: "dice",
    backdropClose: false,
    bodyHtml: `
      <div id="diceArea" class="dice-area" role="button" aria-label="Tap to roll dice"></div>
    `,
    footerButtons: [],
    onOpen: () => {
      const diceArea = $("#diceArea");
      const headerCenter = $("#modalHeaderCenter");

      // Header center: [-]  3 Dice  [+]
      if (headerCenter) {
        headerCenter.innerHTML = `
          <div class="dice-header-controls">
            <button class="icon-btn small" id="btnDiceMinus" aria-label="Decrease dice">−</button>
            <div class="dice-count-label" id="diceCountLabel"></div>
            <button class="icon-btn small" id="btnDicePlus" aria-label="Increase dice">+</button>
          </div>
        `;
      }

      const btnMinus = $("#btnDiceMinus");
      const btnPlus = $("#btnDicePlus");
      const label = $("#diceCountLabel");

      renderDiceArea(diceArea, state.ui.dice.values);

      const syncHeader = () => {
        const n = clampInt(state.ui.dice.count, 1, 10);
        const word = n === 1 ? "Die" : "Dice";
        if (label) label.textContent = `${n} ${word}`;
        if (btnMinus) btnMinus.disabled = n <= 1;
        if (btnPlus) btnPlus.disabled = n >= 10;
      };

      const applyCount = (nextCount) => {
        const n = clampInt(nextCount, 1, 10);
        state.ui.dice.count = n;
        state.ui.dice.values = (state.ui.dice.values || []).slice(0, n);
        while (state.ui.dice.values.length < n) state.ui.dice.values.push(1);
        saveState();
        renderDiceArea(diceArea, state.ui.dice.values);
        syncHeader();
      };

      syncHeader();

      btnMinus?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyCount(state.ui.dice.count - 1);
      });

      btnPlus?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyCount(state.ui.dice.count + 1);
      });

      // Tap anywhere on the dice area to roll
      diceArea?.addEventListener("click", () => rollDiceFromModal());

      // Also support touchstart to feel snappier on phones
      diceArea?.addEventListener("touchstart", (e) => {
        // Avoid double-trigger (touchstart + click)
        e.preventDefault();
        rollDiceFromModal();
      }, { passive: false });

      // Keep header in sync if state count was clamped
      applyCount(state.ui.dice.count);
    }
  });

  let settleTimers = [];

  function rollDiceFromModal() {
    const diceArea = $("#diceArea");
    if (!diceArea) return;

    // Cancel any prior settle timers so repeated rolls feel responsive
    settleTimers.forEach(id => window.clearTimeout(id));
    settleTimers = [];

    const count = clampInt(state.ui.dice.count, 1, 10);
    const nextValues = Array.from({ length: count }, () => randInt(1, 6));

    // Update + persist state immediately
    state.ui.dice.count = count;
    state.ui.dice.values = nextValues;
    saveState();

    // Ensure correct number of dice is visible before the animation
    renderDiceArea(diceArea, nextValues.map(() => 0));

    // SFX
    audio.playUi(AUDIO_FILES.dice);

    // Haptic
    hapticRoll();


    const diceEls = Array.from(diceArea.querySelectorAll(".die"));
    diceEls.forEach((el) => {
      el.classList.add("rolling");
      el.setAttribute("data-value", "0");
    });

    // Stagger the settle a bit for a nicer feel
    diceEls.forEach((el, idx) => {
      const settleMs = 900 + idx * 160;
      const t = window.setTimeout(() => {
        el.classList.remove("rolling");
        el.setAttribute("data-value", String(nextValues[idx] || 1));
      }, settleMs);
      settleTimers.push(t);
    });
  }
}

function renderDiceArea(containerEl, values) {
  const html = values.map(v => createDieHtml(v)).join("");
  containerEl.innerHTML = html || `<div class="tiny muted">Tap to roll.</div>`;
}

function createDieHtml(value) {
  const v = clampInt(value, 0, 6);
  return `
    <div class="die" data-value="${v}">
      <span class="pip p1"></span>
      <span class="pip p2"></span>
      <span class="pip p3"></span>
      <span class="pip p4"></span>
      <span class="pip p5"></span>
      <span class="pip p6"></span>
      <span class="pip p7"></span>
    </div>
  `;
}


// -------------------------
// Starting Player Selector (fullscreen)
// -------------------------
function openStartingPlayerSelector() {
  startPlayerOverlay.classList.remove("hidden");
  startPlayerOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");

  // Visual text reset
  startPlayerHint.textContent =
    "Place a finger on the screen. When everyone is ready, hold steady to randomly choose.";
  startPlayerCountdown.classList.add("hidden");
  startPlayerCountdownNum.textContent = "3";

  const canvas = startPlayerCanvas;
  const ctx = canvas.getContext("2d");

  // Color palette for touch circles
  const palette = [
    "#38bdf8", // sky
    "#fb7185", // rose
    "#a78bfa", // violet
    "#34d399", // emerald
    "#fbbf24", // amber
    "#f472b6", // pink
    "#22c55e", // green
    "#60a5fa", // blue
    "#f97316", // orange
    "#e879f9"  // fuchsia
  ];

  const touches = new Map(); // id -> { x, y, color, bornAt, phase }
  let paletteIndex = 0;

  let rafId = 0;
  let countdownIntervalId = 0;
  let countdownDeadline = 0;
  let isSelecting = false;
  let selectedId = null;
  let selectedColor = "#38bdf8";
  let selectStartAt = 0;
  // Once a winner is chosen, freeze the reveal position so it cannot be dragged.
  // (We keep rendering the black "winner" circle at this spot even if the finger lifts.)
  let selectedPos = null; // { x, y }

  const BASE_RADIUS = 48;
  const PULSE_AMPL = 8;
  const SELECT_ANIM_MS = 950;

  // Haptics (best-effort). Mobile browsers may ignore if not supported.
  const tryVibrate = (pattern) => {
    try {
      if (navigator && typeof navigator.vibrate === "function") {
        navigator.vibrate(pattern);
      }
    } catch (_) {
      // no-op
    }
  };

  const resize = () => {
    const rect = startPlayerStage.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${Math.floor(rect.width)}px`;
    canvas.style.height = `${Math.floor(rect.height)}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const maxRadiusToCover = (x, y) => {
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const d1 = Math.hypot(x - 0, y - 0);
    const d2 = Math.hypot(x - w, y - 0);
    const d3 = Math.hypot(x - 0, y - h);
    const d4 = Math.hypot(x - w, y - h);
    return Math.max(d1, d2, d3, d4) + 20;
  };

  const stopCountdown = () => {
    if (countdownIntervalId) window.clearInterval(countdownIntervalId);
    countdownIntervalId = 0;
    countdownDeadline = 0;
    startPlayerCountdown.classList.add("hidden");
  };

  const startCountdown = () => {
    stopCountdown();
    if (touches.size <= 0 || isSelecting) return;
    countdownDeadline = Date.now() + 3000;
    startPlayerCountdown.classList.remove("hidden");
    startPlayerCountdownNum.textContent = "3";

    countdownIntervalId = window.setInterval(() => {
      const msLeft = Math.max(0, countdownDeadline - Date.now());
      const secLeft = Math.ceil(msLeft / 1000);
      startPlayerCountdownNum.textContent = String(Math.min(3, Math.max(0, secLeft)));
      if (msLeft <= 0) {
        stopCountdown();
        selectRandom();
      }
    }, 100);
  };

  const selectRandom = () => {
    if (isSelecting || touches.size === 0) return;
    isSelecting = true;
    const ids = Array.from(touches.keys());
    selectedId = ids[randInt(0, ids.length - 1)];
    const t = touches.get(selectedId);
    selectedColor = t?.color || palette[0];
    // Snapshot the position at the moment of selection.
    selectedPos = t ? { x: t.x, y: t.y } : { x: 0, y: 0 };
    // Hard-lock input so the winner reveal can't be dragged on any device/browser.
    // (Close button is outside the canvas and still works.)
    canvas.style.pointerEvents = "none";
    selectStartAt = performance.now();
    startPlayerHint.textContent = "Starting player selected.";

    // Winner haptics
    tryVibrate([30, 40, 80]);
  };

  const getPosFromTouch = (touch) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top
    };
  };

  const onTouchStart = (e) => {
    e.preventDefault();
    if (isSelecting) return;
    for (const touch of Array.from(e.changedTouches || [])) {
      const { x, y } = getPosFromTouch(touch);
      const id = touch.identifier;
      if (!touches.has(id)) {
        const color = palette[paletteIndex % palette.length];
        paletteIndex += 1;
        touches.set(id, {
          x,
          y,
          color,
          bornAt: performance.now(),
          phase: Math.random() * Math.PI * 2
        });

        // Light haptic when a new finger lands
        tryVibrate(12);
      } else {
        const t = touches.get(id);
        t.x = x; t.y = y;
      }
    }
    startCountdown();
  };

  const onTouchMove = (e) => {
    e.preventDefault();
    if (isSelecting) return;
    for (const touch of Array.from(e.changedTouches || [])) {
      const id = touch.identifier;
      const t = touches.get(id);
      if (!t) continue;
      const { x, y } = getPosFromTouch(touch);
      t.x = x; t.y = y;
    }
  };

  const onTouchEnd = (e) => {
    e.preventDefault();
    if (isSelecting) return;
    for (const touch of Array.from(e.changedTouches || [])) {
      touches.delete(touch.identifier);
    }
    if (touches.size === 0) {
      stopCountdown();
      startPlayerHint.textContent = "Place a finger on the screen. When everyone is ready, hold steady to randomly choose.";
    } else {
      startCountdown();
    }
  };

  // Desktop/testing fallback (one "finger")
  let pointerDown = false;
  const onPointerDown = (e) => {
    if (e.pointerType === "touch") return; // touch handled above
    if (isSelecting) return;
    pointerDown = true;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    touches.set("mouse", {
      x,
      y,
      color: palette[0],
      bornAt: performance.now(),
      phase: 0
    });

    // Light haptic for desktop testing on devices with pointer input
    tryVibrate(12);
    startCountdown();
  };
  const onPointerMove = (e) => {
    if (!pointerDown) return;
    if (isSelecting) return;
    const t = touches.get("mouse");
    if (!t) return;
    const rect = canvas.getBoundingClientRect();
    t.x = e.clientX - rect.left;
    t.y = e.clientY - rect.top;
  };
  const onPointerUp = () => {
    if (isSelecting) return;
    pointerDown = false;
    touches.delete("mouse");
    stopCountdown();
  };

  const render = (now) => {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    // Clear to black
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    if (!isSelecting) {
      // Draw all active touch circles
      for (const t of touches.values()) {
        const age = (now - t.bornAt) / 1000;
        const pulse = Math.sin(age * 2.8 + t.phase) * PULSE_AMPL;
        const radius = BASE_RADIUS + pulse;

        // Outer glow
        const g = ctx.createRadialGradient(t.x, t.y, radius * 0.2, t.x, t.y, radius * 1.4);
        g.addColorStop(0, `${t.color}cc`);
        g.addColorStop(1, `${t.color}00`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(t.x, t.y, radius * 1.4, 0, Math.PI * 2);
        ctx.fill();

        // Solid core
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.arc(t.x, t.y, Math.max(18, radius * 0.55), 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Use frozen selection point so the reveal can't be dragged.
      const pt = selectedPos || touches.get(selectedId);
      if (pt) {
        const elapsed = now - selectStartAt;
        const p = Math.min(1, elapsed / SELECT_ANIM_MS);
        const eased = 1 - Math.pow(1 - p, 3);
        const R = BASE_RADIUS + eased * (maxRadiusToCover(pt.x, pt.y) - BASE_RADIUS);

        // Expanding fill
        ctx.fillStyle = selectedColor;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, R, 0, Math.PI * 2);
        ctx.fill();

        // Final "reverse": black circle under the chosen finger
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, BASE_RADIUS * 0.62, 0, Math.PI * 2);
        ctx.fill();

        // Optional edge ring for readability
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, BASE_RADIUS * 0.62 + 1.5, 0, Math.PI * 2);
        ctx.stroke();

        if (p >= 1) {
          // Lock in: keep only the selected touch so others don't interfere
          for (const id of Array.from(touches.keys())) {
            if (id !== selectedId) touches.delete(id);
          }
        }
      }
    }

    rafId = window.requestAnimationFrame(render);
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") close();
  };

  const close = () => {
    stopCountdown();
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
    touches.clear();
    isSelecting = false;
    selectedId = null;
    selectedPos = null;
    canvas.style.pointerEvents = "auto";
    document.body.classList.remove("no-scroll");
    startPlayerOverlay.classList.add("hidden");
    startPlayerOverlay.setAttribute("aria-hidden", "true");

    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onTouchEnd);
    canvas.removeEventListener("touchcancel", onTouchEnd);
    canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("resize", resize);
    window.removeEventListener("keydown", onKeyDown);
    btnCloseStartPlayer.removeEventListener("click", close);
  };

  // Start lifecycle
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", onKeyDown);

  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd, { passive: false });
  canvas.addEventListener("touchcancel", onTouchEnd, { passive: false });

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  btnCloseStartPlayer.addEventListener("click", close);

  rafId = window.requestAnimationFrame(render);
}


  function openSetupModal() {
    const setup = state.setupDraft || { players: 4, dirtyMode: null, generated: null };
    // Back-compat: older saved drafts won't have dirtyMode.
    if (!Object.prototype.hasOwnProperty.call(setup, "dirtyMode")) setup.dirtyMode = null;

    openModal({
      title: "Setup",
      modalType: "setup",
      bodyHtml: `
        <div class="row">
          <div class="field" style="flex:1;">
            <div class="label">Players</div>
            <select class="input" id="setupPlayers">
              ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${Number(setup.players)===n?"selected":""}>${n}</option>`).join("")}
            </select>
          </div>

          <div class="field" style="flex:1;">
            <div class="label">Dirty Cop</div>
            <select class="input" id="setupDirty">
              <option value="" ${!setup.dirtyMode ? "selected" : ""}>None (0 Dirty Cops)</option>
              <option value="1" ${setup.dirtyMode==="1" ? "selected" : ""}>1 Dirty Cop</option>
              <option value="likely1" ${setup.dirtyMode==="likely1" ? "selected" : ""}>Likely 1 Dirty Cop</option>
              <option value="2" ${setup.dirtyMode==="2" ? "selected" : ""}>2 Dirty Cops</option>
              <option value="likely2" ${setup.dirtyMode==="likely2" ? "selected" : ""}>Likely 2 Dirty Cops</option>
              <option value="ia" ${setup.dirtyMode==="ia" ? "selected" : ""}>Internal Affairs Free-For-All</option>
            </select>
          </div>
        </div>

        <hr class="sep"/>

        <div class="row">
          <button class="btn" id="btnReRollSetup">Re-Roll</button>
        </div>

        <div id="setupResults" class="list" style="margin-top:12px;"></div>
      `,
      footerButtons: [{ text: "Done", className: "btn primary", onClick: closeModal }],
      onOpen: () => {
        const playersEl = $("#setupPlayers");
        const dirtyEl = $("#setupDirty");
        const resultsEl = $("#setupResults");

        const loyaltyText = (players, dirtyMode) => {
          const p = clampInt(players, 1, 6);
          const mode = dirtyMode || null;

          if (!mode) return `No Loyalty Cards (0 Dirty Cops).`;
          if (mode === "1") return `Use <b>${p}</b> Loyalty Cards total, including <b>1</b> Dirty Cop.`;
          if (mode === "likely1") return `Use <b>${p + 1}</b> Loyalty Cards total, including <b>1</b> Dirty Cop.`;
          if (mode === "2") return `Use <b>${p}</b> Loyalty Cards total, including <b>2</b> Dirty Cops.`;
          if (mode === "likely2") return `Use <b>${p + 2}</b> Loyalty Cards total, including <b>2</b> Dirty Cops.`;
          if (mode === "ia") return `Use <b>ALL</b> Loyalty Cards (entire deck), regardless of player count.`;
          return `No Loyalty Cards (0 Dirty Cops).`;
        };

        const setupNumbers = (players, dirtyMode) => {
          const p = clampInt(players, 1, 6);
          const base = setupRow(p);
          const mode = dirtyMode || null;

          // Overrides only apply for the Dirty Cop variants called out in the rules.
          // (Internal Affairs mode uses normal setup numbers unless you later define a special table.)
          const isOne = (mode === "1" || mode === "likely1");
          const isTwo = (mode === "2" || mode === "likely2");

          // Defaults
          let policeCards = base.policeCards;
          let punkPool = base.punkPool;
          let calendarStart = base.calendarStart;
          let patrolOfficers = null;

          // Variant table (only where explicitly defined)
          if (p === 3 && isOne) {
            policeCards = 6; punkPool = 17; calendarStart = "8th"; patrolOfficers = 5;
          } else if (p === 4 && isOne) {
            policeCards = 6; punkPool = 16; calendarStart = "12th"; patrolOfficers = 4;
          } else if (p === 4 && isTwo) {
            policeCards = 7; punkPool = 17; calendarStart = "12th"; patrolOfficers = 5;
          } else if (p === 5 && isOne) {
            policeCards = 5; punkPool = 16; calendarStart = "14th"; patrolOfficers = 4;
          } else if (p === 5 && isTwo) {
            policeCards = 6; punkPool = 17; calendarStart = "14th"; patrolOfficers = 5;
          } else if (p === 6 && isOne) {
            policeCards = 4; punkPool = 15; calendarStart = "15th"; patrolOfficers = 4;
          } else if (p === 6 && isTwo) {
            policeCards = 5; punkPool = 16; calendarStart = "15th"; patrolOfficers = 5;
          }

          return { policeCards, punkPool, calendarStart, patrolOfficers };
        };

        const renderSetup = (gen) => {
          if (!gen) {
            resultsEl.innerHTML = `<div class="item"><div class="item-text">Adjust <b>Players</b> or <b>Dirty Cop</b> to generate setup instructions.</div></div>`;
            return;
          }

          const punksByBlock = gen.punksByBlock;
          const nums = setupNumbers(setup.players, setup.dirtyMode);

          resultsEl.innerHTML = `
            <div class="item">
              <div class="item-title">1) Place Core Components</div>
              <div class="item-text">Place Game Board, dice, Murder Investigation Board, and City Crime Track on the table.</div>
            </div>

            <div class="item">
              <div class="item-title">2) Investigation Cards</div>
              <div class="item-text">
                a) Place Examine Body cards at Morgue<br/>
                b) Place Crime Scene cards on Parking Lot space<br/>
                c) Place Murder Weapon cards on warehouse of <b>Block ${gen.murderWeaponBlock}</b><br/>
                d) Place Witness cards on apartment building of <b>Block ${gen.witnessBlock}</b>
              </div>
            </div>

            <div class="item">
              <div class="item-title">3) Loyalty Cards</div>
              <div class="item-text">${loyaltyText(setup.players, setup.dirtyMode)}</div>
            </div>

            <div class="item">
              <div class="item-title">4) Deal Police Cards</div>
              <div class="item-text">Deal <b>${nums.policeCards}</b> Police Cards face-down to each player.</div>
            </div>

            <div class="item">
              <div class="item-title">5) Punk Pool</div>
              <div class="item-text">Add <b>${nums.punkPool}</b> Punk Tokens to pool (return rest to box).</div>
            </div>

            <div class="item">
              <div class="item-title">6) Calendar Marker</div>
              <div class="item-text">Start Calendar Marker on <b>${nums.calendarStart}</b>.</div>
            </div>

            ${nums.patrolOfficers ? `
              <div class="item">
                <div class="item-title">7) Patrol Officer Pool</div>
                <div class="item-text">Add <b>${nums.patrolOfficers}</b> Patrol Officers to pool.</div>
              </div>
            ` : ""}

            <div class="item">
              <div class="item-title">${nums.patrolOfficers ? "8" : "7"}) Emergency Cards</div>
              <div class="item-text">Draw <b>2</b> Emergency cards.</div>
            </div>

            <div class="item">
              <div class="item-title">${nums.patrolOfficers ? "9" : "8"}) Place 6 Punks</div>
              <div class="item-text">
                ${Object.keys(punksByBlock).sort().map(k => `Block ${k}: <b>${punksByBlock[k]}</b>`).join("<br/>")}
                <br/><span class="muted tiny">(Max 3 per block enforced)</span>
              </div>
            </div>

            <div class="item">
              <div class="item-title">${nums.patrolOfficers ? "10" : "9"}) Choose Characters</div>
              <div class="item-text">Players select a character card.</div>
            </div>
          `;
        };

        // Auto-generate rolls whenever Players or Dirty Cop changes.
        let lastKey = null;
        const generate = (force=false) => {
          const p = clampInt(playersEl.value, 1, 6);
          const dirty = dirtyEl.value || null;
          const key = `${p}|${dirty || ""}`;

          if (!force && key === lastKey) return;
          lastKey = key;

          setup.players = p;
          setup.dirtyMode = dirty;
          setup.generated = generateSetupRolls();
          state.setupDraft = setup;
          saveState();
          renderSetup(setup.generated);
        };

        // Re-roll keeps the same selections.
        $("#btnReRollSetup").addEventListener("click", () => generate(true));

        playersEl.addEventListener("change", () => generate(false));
        dirtyEl.addEventListener("change", () => generate(false));

        // On open, always show generated setup based on current selections.
        generate(true);
      }
    });
  }

  function openSettingsModal() {
    const s = state.settings;

    openModal({
      title: "Settings",
      modalType: "settings",
      bodyHtml: `
        <div class="item">
          <div class="item-title">Commendations</div>
          <div class="row">
            <label class="toggle">
              <input type="checkbox" id="setCommEnabled" ${s.features.commendations ? "checked" : ""}>
              <span>Enable</span>
            </label>
            <label class="toggle" title="If enabled, your overall progress bar can slowly drift downward over time until the next logged action.">
              <input type="checkbox" id="setCommTiming" ${s.features.commendationsTiming ? "checked" : ""}>
              <span>Timed</span>
            </label>
          </div>
          <!--<div class="tiny muted">Commendations trigger when clue/arrest/emergency totals hit milestones.</div>-->
        </div>

        <div class="item">
          <div class="item-title">Dispatches</div>
          <div class="row">
            <label class="toggle">
              <input type="checkbox" id="setDispEnabled" ${s.features.dispatches ? "checked" : ""}>
              <span>Enable</span>
            </label>
            <div class="field" style="flex:1;">
              <div class="label">Frequency</div>
              <select class="select" id="setDispRate">
                <option value="low" ${s.pacing.dispatchRate==="low"?"selected":""}>Low</option>
                <option value="normal" ${s.pacing.dispatchRate==="normal"?"selected":""}>Normal</option>
                <option value="high" ${s.pacing.dispatchRate==="high"?"selected":""}>High</option>
              </select>
            </div>
          </div>
        </div>

        <div class="item">
          <div class="item-title">Crisis</div>
          <div class="row">
            <label class="toggle">
              <input type="checkbox" id="setCrisisEnabled" ${s.features.crisis ? "checked" : ""}>
              <span>Enable</span>
            </label>
            <div class="field" style="flex:1;">
              <div class="label">Frequency</div>
              <select class="select" id="setCrisisRate">
                <option value="rare" ${s.pacing.crisisRate==="rare"?"selected":""}>Rare</option>
                <option value="normal" ${s.pacing.crisisRate==="normal"?"selected":""}>Normal</option>
                <option value="frequent" ${s.pacing.crisisRate==="frequent"?"selected":""}>Frequent</option>
              </select>
            </div>
          </div>
        </div>

        <div class="item">
          <div class="item-title">Haptics</div>
          <div class="row">
            <button class="btn" id="btnTestHaptics">Test Vibration</button>
            <div class="field" style="flex:1;">
              <div class="label">Status</div>
              <div class="tiny muted" id="hapticsStatus">—</div>
            </div>
          </div>
          <div class="tiny muted">Vibration works only on supported devices/browsers and may be blocked in some contexts.</div>
        </div>
      `,
      footerButtons: [
        { text: "Close", className: "btn primary", onClick: () => { closeModal(); renderGame(); } }
      ],
      onOpen: () => {
        // Haptics debug/test
        const hapticsStatus = $("#hapticsStatus");
        const hasVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
        hapticsStatus.textContent = hasVibrate ? "Supported (requires user gesture)" : "Not supported";

        $("#btnTestHaptics").addEventListener("click", () => {
          const ok = hasVibrate ? navigator.vibrate([20, 30, 20]) : false;
          hapticsStatus.textContent = hasVibrate
            ? (ok ? "Vibration requested ✅" : "Vibration blocked by browser/OS ❌")
            : "Not supported";
        });

        // Feature + pacing toggles
        const commEnabledEl = document.getElementById("setCommEnabled");
        const commTimingEl = document.getElementById("setCommTiming");
        const dispEnabledEl = document.getElementById("setDispEnabled");
        const dispRateEl = document.getElementById("setDispRate");
        const crisisEnabledEl = document.getElementById("setCrisisEnabled");
        const crisisRateEl = document.getElementById("setCrisisRate");

        const syncDisabled = () => {
          if (commTimingEl && commEnabledEl) commTimingEl.disabled = !commEnabledEl.checked;
          if (dispRateEl && dispEnabledEl) dispRateEl.disabled = !dispEnabledEl.checked;
          if (crisisRateEl && crisisEnabledEl) crisisRateEl.disabled = !crisisEnabledEl.checked;
        };

        if (commEnabledEl) {
          commEnabledEl.addEventListener("change", () => {
            s.features.commendations = commEnabledEl.checked;
            if (!s.features.commendations) s.features.commendationsTiming = false;
            saveState();
            syncDisabled();
            renderGame();
          });
        }
        if (commTimingEl) {
          commTimingEl.addEventListener("change", () => {
            s.features.commendationsTiming = !!commTimingEl.checked;
            saveState();
          });
        }

        if (dispEnabledEl) {
          dispEnabledEl.addEventListener("change", () => {
            s.features.dispatches = dispEnabledEl.checked;
            saveState();
            syncDisabled();
            renderGame();
          });
        }
        if (dispRateEl) {
          dispRateEl.addEventListener("change", () => {
            s.pacing.dispatchRate = dispRateEl.value;
            saveState();
          });
        }

        if (crisisEnabledEl) {
          crisisEnabledEl.addEventListener("change", () => {
            s.features.crisis = crisisEnabledEl.checked;
            saveState();
            syncDisabled();
          });
        }
        if (crisisRateEl) {
          crisisRateEl.addEventListener("change", () => {
            s.pacing.crisisRate = crisisRateEl.value;
            saveState();
          });
        }

        syncDisabled();
      }
    });
  }

  function openHowToModal() {
    openModal({
      title: "How to Use",
      modalType: "howto",
      bodyHtml: `
        <div class="item">
          <div class="item-title">During Play</div>
          <div class="item-text">
            In Phase 2 of each player turn, press <b>SUCCESS</b> or <b>FAIL</b> for the action they attempted:
            Investigation, Arrest, or Emergency.
          </div>
        </div>
      `,
      footerButtons: [{ text: "Close", className: "btn primary", onClick: closeModal }]
    });
  }

  function openCreditsModal() {
    // Keep links here so they can be updated in one place.
    const koFiUrl = "https://ko-fi.com/randyd426";
    const issuesUrl = "https://github.com/randysd/PolicePrecinct/issues";

    openModal({
      title: "Credits",
      modalType: "credits",
      bodyHtml: `
        <div class="list credits-list">

          <div class="item">
            <div class="item-title">Police Precinct</div>
            <div class="item-text">
              This is a fan-made companion app created out of love for the board game <b>Police Precinct</b>.
              Special thanks to <b>Ole Steiness</b> (designer) and <b>Common Man Games</b> (publisher) for creating
              such a memorable game — and to the community of fans for keeping interest in it alive.
            </div>
          </div>

          <div class="item">
            <div class="item-title">IP / Disclaimer</div>
            <div class="item-text">
              Police Precinct and related names, logos, and game content referenced in this app are the property of
              their respective owners and may be protected by copyright and/or trademark.
              This app is <b>not affiliated with</b>, endorsed by, or sponsored by <b>Common Man Games</b> or <b>Ole Steiness</b>.
            </div>
          </div>

          <div class="item">
            <div class="item-title">Feedback / Bug Reports</div>
            <div class="item-text">
              Found a bug or have an idea? Please share it so the app can keep improving.
            </div>
            <div class="credits-actions">
              <a class="btn small primary" role="button" href="${issuesUrl}" target="_blank" rel="noopener">GitHub Issues</a>
              <a class="btn small" role="button" href="mailto:rdykstra1@yahoo.com?subject=Police%20Precinct%20App%20Feedback">Email</a>
            </div>
          </div>

          <div class="item donate">
            <div class="item-title">Support Development</div>
            <div class="item-text">
              If you enjoy the app and want to support future updates (and future board game projects), donations are appreciated.
              Donations are optional and do not unlock features.
            </div>
            <div class="credits-actions">
              <a class="btn small success" role="button" href="${koFiUrl}" target="_blank" rel="noopener">Support on Ko-fi</a>
            </div>
          </div>

        </div>
      `,
      footerButtons: [{ text: "Close", className: "btn primary", onClick: closeModal }]
    });
  }

  function openActionHelp(cat) {
    const k = String(cat || "").toLowerCase();
    const title = k === "investigation" ? "Investigation" : k === "arrest" ? "Arrest" : "Emergency";
    const bodyHtml = (() => {
      if (k === "investigation") {
        return `
          <div class="item">
            <div class="item-title">Draw to find clues</div>
            <div class="item-text">
              When the table resolves an <b>Investigation</b> action, mark <b>SUCCESS</b> or <b>FAIL</b>.
            </div>
          </div>
          <div class="item">
            <div class="item-title">If SUCCESS…</div>
            <div class="item-text">Tap <b>1 / 2 / 3+</b> to log how many clues were found.</div>
          </div>
          <div class="item">
            <div class="item-title">If FAIL…</div>
            <div class="item-text">Tap <b>FAIL</b> to log it and keep the pressure on your success rate.</div>
          </div>
        `;
      }
      if (k === "arrest") {
        return `
          <div class="item">
            <div class="item-title">Roll to remove punks</div>
            <div class="item-text">
              When the table resolves an <b>Arrest</b> action, mark <b>SUCCESS</b> or <b>FAIL</b>.
            </div>
          </div>
          <div class="item">
            <div class="item-title">If SUCCESS…</div>
            <div class="item-text">Tap <b>1 / 2 / 3+</b> to log how many punks were removed.</div>
          </div>
          <div class="item">
            <div class="item-title">If FAIL…</div>
            <div class="item-text">Tap <b>FAIL</b> to log it.</div>
          </div>
        `;
      }
      return `
        <div class="item">
          <div class="item-title">Roll to handle emergencies</div>
          <div class="item-text">
            When the table resolves an <b>Emergency</b> action, tap <b>SUCCESS</b> or <b>FAIL</b>.
          </div>
        </div>
      `;
    })();

    openModal({
      title,
      modalType: "info",
      bodyHtml,
      footerButtons: [{ text: "Close", className: "btn primary", onClick: closeModal }]
    });
  }

  function openLogModal() {
    if (!state.game) return;
    const g = state.game;

    const rows = g.log.slice(0, 100).map(entry => {
      const time = new Date(entry.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (entry.type === "action") {
        const icon = entry.result === "success" ? "✅" : "❌";
        if (entry.result === "success" && (entry.cat === "investigation" || entry.cat === "arrest") && entry.amount) {
          const label = entry.cat === "investigation" ? "Clues" : "Thugs";
          return `<div class="item"><div class="item-title">${time} — ${icon} ${cap(entry.cat)}</div><div class="item-text">SUCCESS — <b>${label}: ${escapeHtml(String(entry.amount))}</b>.</div></div>`;
        }
        return `<div class="item"><div class="item-title">${time} — ${icon} ${cap(entry.cat)}</div><div class="item-text">${cap(entry.cat)} marked as <b>${entry.result.toUpperCase()}</b>.</div></div>`;
      }
      if (entry.type === "commendation") {
        return `<div class="item"><div class="item-title">${time} — 🏅 Commendation</div><div class="item-text"><b>${cap(entry.cat)}</b>: ${escapeHtml(entry.text)}</div></div>`;
      }
      if (entry.type === "dispatch") {
        return `<div class="item"><div class="item-title">${time} — 📻 Dispatch</div><div class="item-text"><b>${cap(entry.cat)}</b>: ${escapeHtml(entry.text)}</div></div>`;
      }
      if (entry.type === "crisis") {
        return `<div class="item"><div class="item-title">${time} — ⏱ Crisis</div><div class="item-text">${escapeHtml(entry.text)} (${entry.status})</div></div>`;
      }
      if (entry.type === "reminder") {
        return `<div class="item"><div class="item-title">${time} — 🍩 Reminder</div><div class="item-text">${escapeHtml(entry.text)}</div></div>`;
      }
      return "";
    }).join("");

    openModal({
      title: "Case Log",
      modalType: "log",
      bodyHtml: `<div class="list">${rows || `<div class="item"><div class="item-text">No activity yet.</div></div>`}</div>`,
      footerButtons: [{ text: "Close", className: "btn primary", onClick: closeModal }]
    });
  }

  // Shift Report (newsprint recap). Outcome is chosen in the "Ending your shift?" dialog.
  // This modal is always read-only for outcome/reason.
  function openEndShiftModal(presetOutcome=null, presetReason=null) {
    audio.setMode("ending");

    const g = state.game;
    if (!g) return;

    // Back-compat: allow callers without explicit args (older flows),
    // but prefer the already-selected outcome/reason stored on the game.
    const hasPreset = true;
    const finalOutcome = presetOutcome || g.outcome || g.endOutcome || "loss";
    const finalReason = presetReason || g.reason || g.endReason || "crime_track_max";

    openModal({
      title: "Shift Report",
      modalType: "endShift",
      bodyHtml: `
      <div class="item" style="display: none">
        <div class="item-title">Outcome</div>
        <div class="row">
          <div class="field">
            <div class="label">Result</div>
            <div class="value" id="endOutcomeLabel"></div>
          </div>
          <div class="field">
            <div class="label">Reason</div>
            <div class="value" id="endReasonLabel"></div>
          </div>
        </div>
      </div>

      <div class="newsprint" id="newsprint">
        <div class="newsprint-paper" id="npPaperTitle">THE COMMONVILLE GAZETTE</div>
      
        <div class="newsprint-masthead" id="npMasthead"></div>
        <div class="newsprint-dateline" id="npDateline"></div>
        <div class="newsprint-grid">
          <div class="newsprint-main">
            <div class="newsprint-headline" id="npHeadline"></div>
            <div class="newsprint-subhead" id="npSubhead"></div>
            <div class="newsprint-body" id="npBody"></div>
          </div>

          <aside class="newsprint-sidebar">
            <div class="np-box">
              <div class="np-box-title">POLICE BLOTTER</div>
              <ul class="np-bullets" id="npBlotter"></ul>
            </div>

            <div class="np-box hidden" id="npAsideBox">
              <div class="np-box-title">EDITOR'S NOTE</div>
              <div class="np-aside" id="npAside"></div>
            </div>
          </aside>
        </div>

        <!-- Ads + classifieds belong at the bottom of the article -->
        <div class="newsprint-ads" id="npAds"></div>
        <div class="newsprint-classifieds" id="npClassifieds"></div>
      </div>
    `,
      footerButtons: [
        { text: "Copy Article", className: "btn", onClick: () => copyToClipboard(buildArticleText()) },
        { text: "Save as Image", className: "btn", onClick: () => saveNewsprintAsImage() },
        { text: "Save as PDF", className: "btn", onClick: () => saveNewsprintAsPdfServer() },
        {
          text: "End & Return Home",
          className: "btn warn",
          onClick: () => {
            endGame(finalOutcome, finalReason);
            closeModal();
            audio.setMode("none");
            location.hash = "#/home";
          }
        }
      ],
      onOpen: () => {
        // Render the read-only labels and article.
        const outcomeLabel = finalOutcome === "win" ? "Win" : "Loss";
        const reasonLabel = humanizeEndReason(finalOutcome, finalReason);
        const outEl = $("#endOutcomeLabel");
        const reaEl = $("#endReasonLabel");
        if (outEl) outEl.textContent = outcomeLabel;
        if (reaEl) reaEl.textContent = reasonLabel;
        (async () => {
          await renderNewspaperArticle(finalOutcome, finalReason);
        })();
      }
    });

    function buildArticleText() {
      const outcome = finalOutcome;
      const reason = finalReason;
      const article = buildNewspaperArticle(outcome, reason);
      return `${article.headline}\n\n${article.subhead}\n\n${article.body.join("\n\n")}`;
    }
  }

  function humanizeEndReason(outcome, reason) {
    const isWin = outcome === "win";
    const mapWin = {
      caught_before_appeared: "Caught murderer before he appeared",
      caught_after_appeared: "Caught murderer after he appeared"
    };
    const mapLoss = {
      crime_track_max: "Crime track reached the end",
      murderer_escaped: "Murderer escaped / not captured"
    };
    return (isWin ? mapWin : mapLoss)[reason] || String(reason || "");
  }

  function openEndShiftConfirmModal() {
    const g = state.game;
    if (!g?.active) return;

    openModal({
      title: "Ending your shift?",
      modalType: "endShiftConfirm",
      bodyHtml: `
        <div class="item">
          <div class="item-text">This will end the current game in progress. Choose your result and how it ended.</div>
        </div>
        <div class="item">
          <div class="item-title">Outcome</div>
          <div class="row">
            <div class="field">
              <div class="label">Result</div>
              <select class="select" id="endConfirmOutcome">
                <option value="win">Win</option>
                <option value="loss">Loss</option>
              </select>
            </div>
            <div class="field">
              <div class="label">Reason</div>
              <select class="select" id="endConfirmReason"></select>
            </div>
          </div>
        </div>
      `,
      footerButtons: [
        { text: "Cancel", className: "btn", onClick: closeModal },
        {
          text: "End Shift",
          className: "btn warn",
          onClick: () => {
            const outcome = $("#endConfirmOutcome")?.value || "loss";
            const reason = $("#endConfirmReason")?.value || "crime_track_max";

            // Persist the ending selection + a derived tone profile so the report,
            // ad selection, and classifieds can reflect how the shift actually ended.
            try {
              const g = state.game;
              if (g) {
                g.endOutcome = outcome;
                g.endReason = reason;
                g.reportTone = buildToneProfile(outcome, reason, g);
                // Build a stable, end-of-run snapshot for the report. This prevents
                // the newspaper from changing if the user re-opens the Shift Report later.
                g.reportSummary = buildEndgameSummary(outcome, reason, g);
                // Build the article once to emit narrative hooks, then use those hooks
                // to choose ads/classifieds that feel intentionally placed.
                buildNewspaperArticle(outcome, reason);
                // Refresh endgame extras now so the report is instantly populated.
                g.selectedAds = pickAdsForReport();
                g.selectedClassifieds = pickClassifiedsForReport();
                saveState();
              }
            } catch (e) {
              console.warn("Failed to build endgame tone", e);
            }
            closeModal();
            openEndShiftModal(outcome, reason);
          }
        }
      ],
      onOpen: () => {
        const outcomeEl = $("#endConfirmOutcome");
        const reasonEl = $("#endConfirmReason");

        const setReasonOptions = () => {
          const isWin = outcomeEl.value === "win";
          const opts = isWin ? [
            { v: "caught_before_appeared", t: "Caught murderer before he appeared" },
            { v: "caught_after_appeared", t: "Caught murderer after he appeared" }
          ] : [
            { v: "crime_track_max", t: "Crime track reached the end" },
            { v: "murderer_escaped", t: "Murderer escaped / not captured" }
          ];

          reasonEl.innerHTML = "";
          opts.forEach(o => {
            const opt = document.createElement("option");
            opt.value = o.v;
            opt.textContent = o.t;
            reasonEl.appendChild(opt);
          });
        };

        outcomeEl.addEventListener("change", setReasonOptions);
        setReasonOptions();
      }
    });
  }

  function openDispatchModal(dispatch, fromStrip=false) {
    audio.playUi(AUDIO_FILES.dispatch);
    openModal({
      title: "Radio Dispatch",
      modalType: "dispatch",
      bodyHtml: `
        <div class="item">
          <div class="item-title">${cap(dispatch.cat)} — ${dispatch.helpful ? "Helpful Intel" : "Complication"}</div>
          <div class="item-text">${escapeHtml(dispatch.text)}</div>
        </div>
        <div class="item">
          <div class="item-title">Effect</div>
          <div class="item-text"><b>${escapeHtml(dispatch.effect)}</b></div>
        </div>
        <div class="item">
          <div class="item-text muted tiny">Remains active until marked applied.</div>
        </div>
      `,
      footerButtons: [
        { text: "Close", className: "btn", onClick: closeModal },
        {
          text: "Mark Applied",
          className: "btn primary",
          onClick: () => {
            state.game.activeDispatches = state.game.activeDispatches.filter(d => d.id !== dispatch.id);
            state.game.log.unshift({ t: Date.now(), type: "dispatch", cat: dispatch.cat, helpful: dispatch.helpful, text: `APPLIED: ${dispatch.text}` });
            saveState();
            closeModal();
            renderGame();
            if (!fromStrip) {}
          }
        }
      ]
    });
  }

  function openCrisisModal(crisis) {
    openModal({
      title: "Crisis Incoming",
      modalType: "crisis",
      bodyHtml: `
        <div class="item">
          <div class="item-title">⏱ ${escapeHtml(crisis.title)}</div>
          <div class="item-text">${escapeHtml(crisis.description)}</div>
        </div>

        <div class="item">
          <div class="item-title">Resolve Instructions</div>
          <div class="item-text">${escapeHtml(crisis.instructions)}</div>
        </div>

        <div class="item">
          <div class="item-title">Time Remaining</div>
          <div class="item-text"><span class="mono" id="crisisTimer">${crisis.seconds}s</span></div>
        </div>
      `,
      footerButtons: [
        { text: "Resolved!", className: "btn success", onClick: () => resolveCrisis(true) },
        { text: "Close", className: "btn", onClick: () => { closeModal(); /* will restore main */ } }
      ],
      onOpen: () => {
        const timerEl = $("#crisisTimer");
        let remaining = crisis.seconds;

        crisis._interval = setInterval(() => {
          remaining -= 1;
          timerEl.textContent = `${remaining}s`;
          if (remaining <= 0) {
            clearInterval(crisis._interval);
            resolveCrisis(false);
          }
        }, 1000);
      }
    });

    function resolveCrisis(success) {
      const g = state.game;
      if (!g || !g.crisisActive) return;

      const active = g.crisisActive;
      if (active?._interval) clearInterval(active._interval);

      g.log.unshift({ t: Date.now(), type: "crisis", status: success ? "resolved" : "failed", text: active.title });
      g.crisisActive = null;

      saveState();
      closeModal();
      renderGame();

      openInfoModal({
        title: success ? "Crisis Resolved" : "Crisis Failed",
        modalType: "crisisResult",
        bodyHtml: `
          <div class="item">
            <div class="item-title">${escapeHtml(active.title)}</div>
            <div class="item-text">${escapeHtml(success ? active.reward : active.penalty)}</div>
          </div>
        `,
        primaryText: "Continue"
      });
    }
  }

  function openConfirmModal({ title, text, confirmText, confirmClass, onConfirm }) {
    openModal({
      title,
      modalType: "confirm",
      bodyHtml: `<div class="item"><div class="item-text">${escapeHtml(text)}</div></div>`,
      footerButtons: [
        { text: "Cancel", className: "btn", onClick: closeModal },
        { text: confirmText, className: `btn ${confirmClass || "primary"}`, onClick: () => { closeModal(); onConfirm?.(); } }
      ]
    });
  }

  function openInfoModal({ title, bodyHtml, primaryText="OK", modalType="info" }) {
    openModal({
      title,
      modalType,
      bodyHtml,
      footerButtons: [{ text: primaryText, className: "btn primary", onClick: closeModal }]
    });
  }

  function openModal({ title, bodyHtml, footerButtons=[], onOpen, modalType, backdropClose=true }) {
    currentModalType = modalType || null;
    currentModalOptions = { backdropClose };

    // Tag the modal so CSS can adapt per modal type
    if (modalEl) modalEl.setAttribute("data-modal", currentModalType || "");

    modalTitle.textContent = title;
    if (modalHeaderCenter) modalHeaderCenter.innerHTML = "";
    modalBody.innerHTML = bodyHtml;
    modalFooter.innerHTML = "";

    footerButtons.forEach(b => {
      const btn = document.createElement("button");
      btn.className = b.className || "btn";
      btn.textContent = b.text;
      btn.addEventListener("click", b.onClick || closeModal);
      modalFooter.appendChild(btn);
    });

    modalOverlay.classList.remove("hidden");
    modalOverlay.setAttribute("aria-hidden", "false");
    onOpen?.();
  }

  function closeModal() {
    // If crisis modal closes (without resolving), return to main music
    if (currentModalType === "crisis") {
      audio.setMode("main");
    }
    // If end shift modal closes (cancel path), return to main music
    if (currentModalType === "endShift") {
      audio.setMode("main");
    }

    currentModalType = null;
    currentModalOptions = { backdropClose: true };

    if (modalEl) modalEl.setAttribute("data-modal", "");
    if (modalHeaderCenter) modalHeaderCenter.innerHTML = "";

    if (modalEl) modalEl.setAttribute("data-modal", "");
    if (modalHeaderCenter) modalHeaderCenter.innerHTML = "";

    modalOverlay.classList.add("hidden");
    modalOverlay.setAttribute("aria-hidden", "true");
    modalBody.innerHTML = "";
    modalFooter.innerHTML = "";
  }

  // -------------------------
  // Setup generation
  // -------------------------
  function generateSetupRolls() {
    const murderWeaponBlock = randInt(1, 6);
    const witnessBlock = randInt(1, 6);

    const punksByBlock = { 1:0,2:0,3:0,4:0,5:0,6:0 };
    let placed = 0;
    while (placed < 6) {
      const b = randInt(1, 6);
      if (punksByBlock[b] >= 3) continue;
      punksByBlock[b] += 1;
      placed += 1;
    }

    return { murderWeaponBlock, witnessBlock, punksByBlock };
  }

  // -------------------------
  // End game + report
  // -------------------------
  function endGame(outcome, reason) {
    const g = state.game;
    if (!g) return;

    g.active = false;
    g.endedAt = Date.now();
    g.outcome = outcome;
    g.reason = reason;


    state.history = state.history || [];
    state.history.unshift({
      endedAt: g.endedAt,
      outcome: g.outcome,
      reason: g.reason,
      report: buildReportText(outcome)
    });

    state.game = null;
    saveState();
  }

  function buildReportText(outcome) {
    const g = state.game;
    const overall = fmtPct(getOverallRate());
    const actions = getOverallActions();

    const catUsage = ["investigation","arrest","emergency"].map(cat => ({
      cat,
      total: (g.categories[cat].success + g.categories[cat].fail),
      rate: getSuccessRate(cat)
    })).sort((a,b)=>b.total-a.total);

    const top = catUsage[0];
    const worst = [...catUsage].sort((a,b)=>a.rate-b.rate)[0];

    const headline = outcome === "win"
      ? `CITY BREATHES AGAIN — CASE CLOSED`
      : `CASE GOES COLD — CITY ON EDGE`;

    const sub = outcome === "win"
      ? `Detectives end the shift with ${overall} overall success after ${actions} field actions.`
      : `The shift ends with ${overall} overall success after ${actions} field actions — the pressure mounts.`;

    const detail =
`Most used: ${cap(top.cat)} (${top.total} actions)
Shakiest: ${cap(worst.cat)} (${fmtPct(worst.rate)} success)

Commendations:
- Investigation: ${g.commendations.investigation}
- Arrest: ${g.commendations.arrest}
- Emergency: ${g.commendations.emergency}

Dispatches issued: ${g.log.filter(x=>x.type==="dispatch").length}
Crises encountered: ${g.log.filter(x=>x.type==="crisis" && x.status==="started").length}`;

    return `${headline}\n\n${sub}\n\n${detail}`;
  }

  // -------------------------
  // Content generators
  // -------------------------
  function pickCommendationLegacy(cat) {
    const pool = {
      investigation: [
        "Forensics fast-track — draw +1 card on your next Investigate action.",
        "Witness hotline — your next Investigate success grants a bonus clue.",
        "Lab overtime — ignore the next Investigate penalty you receive."
      ],
      arrest: [
        "Backup arrives — roll +1 die on your next Arrest attempt.",
        "Street sweep — remove 1 punk from any block after your next Arrest success.",
        "Warrant in hand — treat a tie as a win on your next Arrest roll."
      ],
      emergency: [
        "EMS surge — reduce an Emergency by 1 step on your next successful response.",
        "Traffic control — reroll one die during the next Emergency resolution.",
        "Mutual aid — cancel the next Emergency complication you receive."
      ]
    };
    return pick(pool[cat] || ["Commendation issued."]);
  }

  function buildDispatch(cat, helpful) {
    const helpfulPool = {
      investigation: [
        { text: "Anonymous tip comes in — the suspect was seen near the docks.", effect: "Next Investigate: draw +1 card." },
        { text: "Detective from another precinct shares notes.", effect: "Next Investigate: treat the first miss as a redraw." }
      ],
      arrest: [
        { text: "Unit reports a clean line of sight on the target.", effect: "Next Arrest: roll +1 die." },
        { text: "K9 team is standing by.", effect: "Next Arrest: +1 to the highest die result." }
      ],
      emergency: [
        { text: "Dispatch reroutes traffic for you.", effect: "Next Emergency: reroll one die." },
        { text: "Fire department arrives early.", effect: "Next Emergency: +1 to your total." }
      ]
    };

    const badPool = {
      investigation: [
        { text: "Radio chatter spikes — too many false leads flooding in.", effect: "Next Investigate: draw -1 card." },
        { text: "Evidence locker misfiles a bag.", effect: "Next Investigate: first draw is ignored." }
      ],
      arrest: [
        { text: "Suspect slips into a crowd.", effect: "Next Arrest: roll -1 die." },
        { text: "A bystander blocks the approach.", effect: "Next Arrest: -1 to your total." }
      ],
      emergency: [
        { text: "A second call stacks on the first.", effect: "Next Emergency: -1 to your total." },
        { text: "Road closure forces a detour.", effect: "Next Emergency: you must reroll your best die." }
      ]
    };

    const chosen = pick((helpful ? helpfulPool : badPool)[cat] || [{ text:"Dispatch update received.", effect:"No effect." }]);

    return {
      id: uid(),
      cat,
      helpful,
      text: chosen.text,
      effect: chosen.effect,
      short: helpful ? "Bonus" : "Penalty"
    };
  }

  function buildCrisis() {
    const overall = getOverallRate();

    const templates = [
      {
        title: "Bomb Threat",
        description: "A credible threat hits multiple blocks. The city needs an immediate coordinated response.",
        instructions: "All players roll simultaneously. If anyone rolls a 6 before time runs out, the crisis is resolved.",
        seconds: overall >= 0.6 ? 45 : 60,
        reward: "Reward: Remove 1 Emergency from the board OR reduce Crime Track by 1.",
        penalty: "Penalty: Advance Crime Track by 1 OR add 1 punk to any block."
      },
      {
        title: "Hostage Situation",
        description: "A tense standoff escalates. Negotiation and positioning must be immediate.",
        instructions: "Group rolls until the total sum of a round reaches 18+ before time ends.",
        seconds: overall >= 0.6 ? 50 : 70,
        reward: "Reward: Gain 1 Police Card (choose a player).",
        penalty: "Penalty: Each player loses 1 Donut (or equivalent setback)."
      },
      {
        title: "Multi-Car Pileup",
        description: "Traffic locks up. Units must secure the scene and clear the lanes fast.",
        instructions: "Everyone rolls; the highest die wins. On a tie, reroll immediately. If the winner is a 6, gain the bonus.",
        seconds: overall >= 0.6 ? 40 : 60,
        reward: "Reward: Winner gains 1 Police Card OR remove 1 punk from the street.",
        penalty: "Penalty: Draw 1 additional Emergency card."
      }
    ];

    return pick(templates);
  }

  const AD_BASE = "./assets/ads/";

  const AD_POOL = [
    // Image ads
    { id: "donut", type: "image", src: "ad_donut_shop.png", alt: "Donut ad", tags:["night","calm","investigation"] },
    { id: "tow", type: "image", src: "ad_tow_truck.png", alt: "Tow service ad", tags:["emergency","night"] },
    { id: "pawn", type: "image", src: "ad_pawn_shop.png", alt: "Pawn shop ad", tags:["arrest","investigation"] },
    { id: "diner", type: "image", src: "ad_diner.png", alt: "Diner ad", tags:["night","calm"] },
    { id: "radio", type: "image", src: "ad_police_scanner.png", alt: "Police scanner ad", tags:["investigation","arrest"] },

    // Text ads
    { id:"coffee", type:"text", title:"NIGHT OWL COFFEE", body:"Open 24/7. Free refills for uniformed officers.", fine:"Corner of 6th & Marlowe", tags:["night","investigation"] },
    { id:"bail", type:"text", title:"QUICK BAIL • NO JUDGMENT", body:"Fast paperwork. Discreet service. We answer at 3 a.m.", fine:"CALL 555-0113", tags:["arrest","night"] },
    { id:"locksmith", type:"text", title:"METRO LOCK & KEY", body:"Locked out? Evidence room jammed? Licensed & insured.", fine:"SERVICE IN ALL BLOCKS", tags:["investigation","arrest"] },
    { id:"bodyshop", type:"text", title:"HARDLINE AUTO BODY", body:"Fender benders to full rebuilds. We erase the night’s mistakes.", fine:"EST. 1978", tags:["emergency","night"] }
  ];

  const CLASSIFIEDS_POOL = [
    // Investigation-flavored
    { id:"camshop", head:"CAMERAS", text:"Used security cams. Cheap. No questions. (Block 3)", tags:["investigation"] },
    { id:"typing", head:"CLERK", text:"Fast typist needed nights. Pay cash. Call after 10pm.", tags:["investigation","night"] },
    { id:"lostcat", head:"LOST", text:"Orange cat ‘Marlowe’. Last seen near parking lot.", tags:["investigation","calm"] },

    // Arrest-flavored
    { id:"bail2", head:"LEGAL", text:"Bail assistance. Discreet. Same-night paperwork.", tags:["arrest","night"] },
    { id:"dojo", head:"TRAINING", text:"Self-defense classes. First lesson free. (Block 6)", tags:["arrest"] },
    { id:"security", head:"SECURITY", text:"Night guards wanted. Steady work. Apply in person.", tags:["arrest","night"] },

    // Emergency-flavored
    { id:"tow2", head:"TOWING", text:"24/7 towing. Accidents, breakdowns, “mystery dents”.", tags:["emergency","night"] },
    { id:"paramedic", head:"EMS", text:"Volunteer EMTs needed. Training provided.", tags:["emergency"] },
    { id:"plumber", head:"REPAIR", text:"Burst pipe? Fast response. Licensed.", tags:["emergency"] },

    // City flavor
    { id:"apts", head:"RENT", text:"Studio apt. Cheap. Thin walls. (Block 2)", tags:["night"] },
    { id:"diner2", head:"EATS", text:"Late-night specials at Marlowe Diner. Pie fresh.", tags:["night","calm"] },
    { id:"pawn2", head:"CASH", text:"Pawn & trade. Watches, tools, “collectibles”.", tags:["arrest","investigation"] }
  ];



  // -------------------------
  // Setup formulas (REAL table)
  // -------------------------
  function setupRow(players) {
    const p = clampInt(players, 1, 6);
    return SETUP_TABLE[String(p)];
  }
  function calcPoliceCards(players) { return setupRow(players).policeCards; }
  function calcPunkPool(players) { return setupRow(players).punkPool; }
  function calcCalendarStart(players) { return setupRow(players).calendarStart; }

  // -------------------------
  // Persistence
  // -------------------------
  function loadState(reset=false) {
    if (reset) {
      return { settings: structuredClone(DEFAULT_SETTINGS), ui: structuredClone(DEFAULT_UI), game: null, setupDraft: null, history: [] };
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { settings: structuredClone(DEFAULT_SETTINGS), ui: structuredClone(DEFAULT_UI), game: null, setupDraft: null, history: [] };
      const parsed = JSON.parse(raw);

      parsed.settings = parsed.settings || structuredClone(DEFAULT_SETTINGS);
      parsed.settings.audio = { ...DEFAULT_SETTINGS.audio, ...(parsed.settings.audio || {}) };
      parsed.settings.features = { ...DEFAULT_SETTINGS.features, ...(parsed.settings.features || {}) };
      parsed.settings.pacing = { ...DEFAULT_SETTINGS.pacing, ...(parsed.settings.pacing || {}) };

      parsed.game = parsed.game || null;
      parsed.ui = parsed.ui || structuredClone(DEFAULT_UI);
      parsed.ui.dice = { ...structuredClone(DEFAULT_UI.dice), ...(parsed.ui.dice || {}) };
      parsed.ui.dice.count = clampInt(parsed.ui.dice.count, 1, 12);
      parsed.ui.dice.values = Array.isArray(parsed.ui.dice.values) ? parsed.ui.dice.values : [];
      parsed.ui.dice.values = parsed.ui.dice.values.slice(0, parsed.ui.dice.count);
      while (parsed.ui.dice.values.length < parsed.ui.dice.count) parsed.ui.dice.values.push(1);
      parsed.setupDraft = parsed.setupDraft || null;
      parsed.history = parsed.history || [];
      return parsed;
    } catch {
      return { settings: structuredClone(DEFAULT_SETTINGS), ui: structuredClone(DEFAULT_UI), game: null, setupDraft: null, history: [] };
    }
  }

  // -------------------------
  // Persistence (robust)
  // -------------------------
  // NOTE: localStorage has a small quota and can throw QuotaExceededError.
  // If that exception bubbles out of a click handler, it can look like the app
  // "froze" (navigation never happens because the handler aborts).
  //
  // This app's state can grow over time (e.g., shift log/history). We cap
  // growth and catch storage errors so the UI keeps running even if persistence
  // fails.
  const MAX_GAME_LOG = 250;
  const MAX_HISTORY = 50;
  const MAX_ACTIVE_DISPATCHES = 25;

  function trimStateForStorage() {
    try {
      if (state?.game?.log && Array.isArray(state.game.log) && state.game.log.length > MAX_GAME_LOG) {
        state.game.log = state.game.log.slice(0, MAX_GAME_LOG);
      }
      if (state?.history && Array.isArray(state.history) && state.history.length > MAX_HISTORY) {
        state.history = state.history.slice(0, MAX_HISTORY);
      }
      if (state?.game?.activeDispatches && Array.isArray(state.game.activeDispatches) && state.game.activeDispatches.length > MAX_ACTIVE_DISPATCHES) {
        state.game.activeDispatches = state.game.activeDispatches.slice(0, MAX_ACTIVE_DISPATCHES);
      }
    } catch (_) {
      // no-op
    }
  }

  function saveState() {
    try {
      trimStateForStorage();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      // QuotaExceededError or storage blocked (private mode / iOS PWA constraints)
      try {
        // One retry with more aggressive trimming
        if (state?.game) {
          if (Array.isArray(state.game.log)) state.game.log = state.game.log.slice(0, 80);
          if (Array.isArray(state.game.activeDispatches)) state.game.activeDispatches = state.game.activeDispatches.slice(0, 10);
        }
        if (state?.history && Array.isArray(state.history)) state.history = state.history.slice(0, 20);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
      } catch (e2) {
        console.warn("saveState failed (storage quota or blocked). Continuing without persisting.", e2);
        return false;
      }
    }
  }

  // -------------------------
  // Audio Manager
  // -------------------------
  function createAudioManager({ getSettings }) {
    // Keep ONE looped music element, and spawn one-shots for sfx.
    const musicEl = new Audio();
    musicEl.loop = true;
    musicEl.preload = "auto";

    // For ambient, we'll create one-shots too (but controlled by Music settings)
    let mode = "none"; // none|main|crisis|ending
    let ambientTimer = null;

    // Some browsers require user gesture to start audio.
    let gestureUnlocked = false;

    const musicMap = {
      none: null,
      main: AUDIO_FILES.musicMain,
      crisis: AUDIO_FILES.musicCrisis,
      ending: AUDIO_FILES.musicEnding
    };

    function applySettings() {
      const s = getSettings();
      // music volume governs BOTH: music + ambient
      musicEl.volume = clampNum(s.musicVolume, 0, 1);
      if (!s.musicEnabled) {
        safePause(musicEl);
      } else {
        // only play if in a mode that wants music, and user has interacted
        if (mode !== "none" && gestureUnlocked) safePlay(musicEl);
      }
    }

    async function userGestureKick() {
      if (gestureUnlocked) return true;
      gestureUnlocked = true;
      applySettings();
      // Also schedule ambient if in game mode
      ensureAmbient();
      return true;
    }

    function setMode(nextMode) {
      mode = nextMode;

      const file = musicMap[mode];
      if (!file) {
        safePause(musicEl);
        stopAmbient();
        return;
      }

      // Swap track if different
      const nextSrc = AUDIO_BASE + file;
      if (musicEl.src !== nextSrc) {
        musicEl.src = nextSrc;
        musicEl.currentTime = 0;
      }

      applySettings();

      // Ambient only on main/crisis (you can change this)
      ensureAmbient();
    }

    function ensureAmbient() {
      const s = getSettings();
      const shouldAmbient = (mode === "main" || mode === "crisis") && s.musicEnabled;

      if (!gestureUnlocked || !shouldAmbient) {
        stopAmbient();
        return;
      }

      if (ambientTimer) return; // already running
      scheduleNextAmbient();
    }

    function scheduleNextAmbient() {
      stopAmbient();

      // Random interval (seconds). Adjust as desired.
      const minMs = 12000; // 12s
      const maxMs = 28000; // 28s
      const delay = randInt(minMs, maxMs);

      ambientTimer = setTimeout(() => {
        playAmbientRandom();
        scheduleNextAmbient();
      }, delay);
    }

    function stopAmbient() {
      if (ambientTimer) {
        clearTimeout(ambientTimer);
        ambientTimer = null;
      }
    }

    function playAmbientRandom() {
      const s = getSettings();
      if (!gestureUnlocked || !s.musicEnabled) return;
      if (!(mode === "main" || mode === "crisis")) return;

      const file = pick(AUDIO_FILES.ambient);
      if (!file) return;

      const el = new Audio(AUDIO_BASE + file);
      el.preload = "auto";
      el.volume = clampNum(s.musicVolume, 0, 1); // uses MUSIC controls
      safePlay(el).finally(() => {
        // allow GC
      });
    }

    function playUi(file) {
      const s = getSettings();
      if (!gestureUnlocked) return;
      if (!s.sfxEnabled) return;
      if (!file) return;

      const el = new Audio(AUDIO_BASE + file);
      el.preload = "auto";
      el.volume = clampNum(s.sfxVolume, 0, 1);
      safePlay(el).finally(() => {});
    }

    function safePlay(el) {
      try {
        const p = el.play();
        if (p && typeof p.catch === "function") return p.catch(() => {});
      } catch {}
      return Promise.resolve();
    }

    function safePause(el) {
      try { el.pause(); } catch {}
    }

    return { applySettings, userGestureKick, setMode, playUi };
  }

  // -------------------------
  // Helpers
  // -------------------------

function setBeginShiftButton(isActive) {
  const textEl = btnBeginShift?.querySelector?.(".pp-begin-text");
  if (textEl) textEl.textContent = isActive ? "CONTINUE SHIFT" : "BEGIN SHIFT";
  btnBeginShift?.classList.toggle("continue-shift", !!isActive);

  // Home status card
  if (homeStatusPrimary) {
    homeStatusPrimary.textContent = isActive ? "Shift in progress" : "No active shift";
  }
  if (homeStatusSecondary) {
    if (isActive && state.game) {
      const p = state.game.players || 0;
      const a = Array.isArray(state.game.log) ? state.game.log.length : 0;
      homeStatusSecondary.textContent = `Players: ${p} • Actions logged: ${a}`;
    } else {
      homeStatusSecondary.textContent = "Ready when you are";
    }
  }

  // Contextual secondary action label
  if (btnHomeSecondary) {
    btnHomeSecondary.textContent = isActive ? "Case Log" : "Setup Game";
  }

  // End Shift visibility: show only when a shift is active
  btnEndShift?.classList.toggle("hidden", !isActive);
  homeStickyBar?.classList.toggle("hidden", !isActive);
}


  function pickDispatch(category, polarity) {
    const list = (CONTENT.dispatches || []).filter(d =>
        d.category === category && d.polarity === polarity
    );
    if (!list.length) return null;
    return list[randInt(0, list.length - 1)];
  }

  function pickCommendation(category) {
    const list = (CONTENT.commendations || []).filter(c => c.category === category);
    if (!list.length) return null;
    return list[randInt(0, list.length - 1)];
  }

  function pickCrisis() {
    const list = CONTENT.crises || [];
    if (!list.length) return null;
    return list[randInt(0, list.length - 1)];
  }



  async function loadJson(url, fallback) {
    try {
      // IMPORTANT:
      // Do not use cache:"no-store" here.
      // In PWAs, a Request with cache:"no-store" often fails to match the Service Worker cache,
      // which can cause offline/installed sessions to load EMPTY content (no ads/classifieds).
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      console.warn("Failed to load", url, e);
      return fallback;
    }
  }

  async function loadContent() {
    // Minimal fallbacks (so app still runs even if files missing)
    const empty = { items: [] };

    // Article templates fallback (so the endgame report stays readable even if the file is missing).
    const defaultTemplates = getDefaultArticleTemplates();

    const [ads, classifieds, dispatches, commendations, crises, articleTemplates] = await Promise.all([
      loadJson("./assets/data/ads.json", empty),
      loadJson("./assets/data/classifieds.json", empty),
      loadJson("./assets/data/dispatches.json", empty),
      loadJson("./assets/data/commendations.json", empty),
      loadJson("./assets/data/crises.json", empty),
      loadJson("./assets/data/article_templates.json", defaultTemplates)
    ]);

    CONTENT.ads = ads.items || [];
    CONTENT.classifieds = classifieds.items || [];
    CONTENT.dispatches = dispatches.items || [];
    CONTENT.commendations = commendations.items || [];
    CONTENT.crises = crises.items || [];
    CONTENT.articleTemplates = articleTemplates || defaultTemplates;

    // Robust fallbacks:
    // In some installed PWA states (or when a JSON fetch is blocked/old cache),
    // content lists can come back empty. Never let the endgame newspaper render
    // with "No inventory available" if we have built-in pools.
    if (!CONTENT.ads.length && Array.isArray(AD_POOL) && AD_POOL.length) {
      CONTENT.ads = [...AD_POOL];
    }
    if (!CONTENT.classifieds.length && Array.isArray(CLASSIFIEDS_POOL) && CLASSIFIEDS_POOL.length) {
      // Normalize pool shape to match JSON items.
      CONTENT.classifieds = CLASSIFIEDS_POOL.map(c => ({
        id: c.id,
        head: c.head,
        textTpl: c.textTpl || c.text,
        tags: c.tags || []
      }));
    }

    CONTENT_LOADED_ONCE = true;

    // Optional: quick sanity log
    console.log("Content loaded:", {
      ads: CONTENT.ads.length,
      classifieds: CONTENT.classifieds.length,
      dispatches: CONTENT.dispatches.length,
      commendations: CONTENT.commendations.length,
      crises: CONTENT.crises.length,
      articleTemplates: !!CONTENT.articleTemplates
    });
  }

  function rollSetupBlocks() {
    const weaponBlock = randInt(1, 6);
    const witnessBlock = randInt(1, 6);

    // 6 punks, blocks 1-6, max 3 per block
    const punksByBlock = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
    let placed = 0;

    while (placed < 6) {
      const b = randInt(1, 6);
      if (punksByBlock[b] >= 3) continue;
      punksByBlock[b]++;
      placed++;
    }

    return { weaponBlock, witnessBlock, punksByBlock };
  }

  function getHotBlocks(punksByBlock) {
    const arr = Object.entries(punksByBlock).map(([k,v]) => ({ block: Number(k), count: v }));
    arr.sort((a,b)=>b.count-a.count);
    const max = arr[0]?.count ?? 0;
    const hot = arr.filter(x => x.count === max && max > 0).map(x => x.block);
    return { max, hot };
  }

  function getReportContext() {
    // Prefer the user's Setup rolls if available so the article feels consistent.
    const gen = state.setupDraft?.generated;

    const weaponBlock = clampInt(gen?.murderWeaponBlock ?? gen?.weaponBlock ?? randInt(1, 6), 1, 6);
    const witnessBlock = clampInt(gen?.witnessBlock ?? randInt(1, 6), 1, 6);

    const punks = gen?.punksByBlock || null;
    const hotInfo = punks ? getHotBlocks(punks) : { hot: [] };
    const hotBlock = clampInt(hotInfo.hot?.[0] ?? weaponBlock, 1, 6);

    return { weaponBlock, witnessBlock, hotBlock };
  }

  function getDefaultArticleTemplates() {
    return {
      masthead: {
        title: "THE COMMONVILLE GAZETTE",
        tagline: "Serving Commonville Since 1898"
      },
      mastheads: [
        "FROM THE POLICE BEAT",
        "COMMONVILLE POLICE BLOTTER",
        "GAZETTE SPECIAL REPORT"
      ],
      kickers: [
        "Gazette Desk",
        "By Staff Writer",
        "City Desk"
      ],
      headline: {
        win: [
          "COMMONVILLE BREATHES AGAIN AFTER SUSPECT TAKEN INTO CUSTODY",
          "LONG NIGHT ENDS WITH ARREST IN COMMONVILLE",
          "PRECINCT BREAKS CASE AFTER TENSE SHIFT"
        ],
        loss_unsolved: [
          "SUSPECT SLIPS AWAY AS LEADS RUN COLD",
          "COMMONVILLE LEFT WAITING AFTER CASE STALLS",
          "QUESTIONS LINGER FOLLOWING INCONCLUSIVE SHIFT"
        ],
        loss_crimewave: [
          "SIRENS DOMINATE THE NIGHT AS CALLS OVERWHELM PRECINCT",
          "COMMONVILLE STRETCHED THIN DURING CHAOTIC SHIFT",
          "CITY REELS AFTER RELENTLESS RUN OF INCIDENTS"
        ]
      },
      subhead: {
        excellent: [
          "A decisive shift brought clear results and a noticeable sense of relief across {neighborhoodA} and beyond.",
          "Steady police work kept pressure on throughout the night as Commonville finally found room to breathe."
        ],
        strong: [
          "Coordinated efforts paid off after hours of tense activity across {neighborhoodA}, {neighborhoodB}, and nearby blocks.",
          "Responders kept their footing through a demanding run of calls, maintaining control where it counted."
        ],
        mixed: [
          "Moments of progress were tempered by mounting challenges as the shift moved across the city.",
          "An uneven night tested officers across multiple fronts, with momentum shifting more than once."
        ],
        struggling: [
          "Limited resources and mounting calls complicated the response as pressure rose across {neighborhoodB}.",
          "The department faced an uphill battle from the outset, with little time to reset between incidents."
        ],
        dire: [
          "A difficult night left the city uneasy, with the radio rarely quiet and answers hard to come by.",
          "Commonville felt the strain as officers fought to keep pace with a punishing run of activity."
        ]
      },
      body: {
        opening: [
          "What began as a routine shift quickly took on added urgency as events unfolded across Commonville.",
          "Officers found themselves navigating a rapidly evolving situation as calls came in from {neighborhoodA} to {neighborhoodC}.",
          "The tone of the shift shifted early as circumstances refused to settle."
        ],
        focus_investigation: [
          "Investigators worked methodically, following threads wherever they led and refusing to let promising leads slip away.",
          "Detectives leaned heavily on legwork and intuition, piecing together fragments as the night wore on."
        ],
        focus_arrest: [
          "Arrests came through assertive action, with officers moving quickly when opportunities presented themselves.",
          "Street units played a decisive role, stepping in repeatedly to bring volatile situations under control."
        ],
        focus_emergency: [
          "Emergency calls demanded immediate attention, forcing rapid decisions under mounting pressure.",
          "First responders were stretched across the city, juggling urgent situations back-to-back."
        ],
        pressure_calm: [
          "Despite the activity, the shift maintained a measured pace for much of the night.",
          "For long stretches, the city held its breath rather than erupting."
        ],
        pressure_busy: [
          "The night moved in waves, with brief lulls giving way to fresh bursts of radio traffic.",
          "Units cycled through calls with little downtime, keeping the city from tipping too far."
        ],
        pressure_chaotic: [
          "Radio chatter rarely quieted, with officers bouncing from one urgent call to the next.",
          "As the night wore on, the sense of urgency only intensified."
        ]
      },
      closing: {
        win: [
          "By the end of the shift, relief was evident as the case reached its conclusion.",
          "When the dust settled, officers could finally step back knowing their efforts had paid off."
        ],
        loss: [
          "As the shift drew to a close, unanswered questions remained.",
          "The night ended without clear resolution, leaving the city waiting for what comes next."
        ]
      },
      editorial_asides: {
        tough: [
          "The Gazette notes that consistent follow-through — not luck — is what keeps a city safe when the night turns sharp.",
          "Calls for stronger coordination across precinct resources have grown louder among residents."
        ],
        community: [
          "Residents are reminded to report tips promptly; small details can matter when a case tightens late in the night.",
          "City officials urged patience and cooperation as investigators continue their work."
        ],
        skeptical: [
          "Some neighbors questioned whether the city’s fragmented response can keep pace when a case refuses to break.",
          "Public confidence tends to fray when timelines stretch and answers remain scarce."
        ],
        supportive: [
          "Veteran observers noted that even disciplined crews can be overwhelmed when calls stack faster than units can clear them.",
          "Officials emphasized that recovery begins with rest, regrouping, and learning from the night’s pressure."
        ],
        ia: [
          "Internal Affairs sources indicated that procedure reviews remain ongoing in sensitive cases.",
          "The Gazette encourages transparency and documentation whenever questions of conduct arise."
        ],
        default: [
          "Officials declined to comment on specifics, citing the ongoing nature of the case.",
          "Residents were urged to remain vigilant."
        ]
      },
      blotter: {
        default: [
          "{district} — Residents reported a disturbance; units cleared the scene without further incident.",
          "{district} — Patrol presence increased following multiple late-night complaints.",
          "{district} — A brief traffic stop caused delays before the roadway reopened."
        ],
        win: [
          "{district} — Officers confirmed an arrest following a late-breaking lead.",
          "{district} — A coordinated response brought a tense situation under control."
        ],
        loss: [
          "{district} — Calls continued into the late hours as residents reported concerns.",
          "{district} — Units canvassed the area after reports of suspicious activity."
        ],
        investigation: [
          "{district} — Detectives followed up on tips as neighbors shared details from earlier in the day.",
          "{district} — Investigators canvassed nearby businesses for additional information."
        ],
        arrest: [
          "{district} — One individual was taken into custody following a brief pursuit.",
          "{district} — Officers responded to a disorderly conduct call; situation stabilized."
        ],
        emergency: [
          "{district} — Medical response requested; EMS assisted on scene.",
          "{district} — Fire/medical call resolved; residents advised to avoid the area temporarily."
        ]
      }
    };
  }

  function applyTemplate(tpl, ctx) {
    if (!tpl) return "";
    return String(tpl).replace(/\{(\w+)\}/g, (_, key) => {
      const v = ctx?.[key];
      return (v === null || v === undefined) ? "" : String(v);
    });
  }

  function formatEffect(effect, cat) {
    if (!effect) return "No effect.";
    if (typeof effect === "string") return effect;

    if (typeof effect === "object") {
      const t = effect.type || "";
      const amt = Number(effect.amount ?? effect.value ?? 0);

      switch (t) {
        case "investigation_draw_bonus":
          return `Next Investigation: draw +${amt || 1} card${(amt || 1) === 1 ? "" : "s"}.`;
        case "arrest_dice_penalty":
          return `Next Arrest: roll -${amt || 1} die (min 1).`;
        case "arrest_dice_bonus":
          return `Next Arrest: roll +${amt || 1} die.`;
        case "emergency_total_bonus":
          return `Next Emergency: +${amt || 1} to your total.`;
        default:
          // Best-effort readable fallback
          return effect.text || effect.description || (t ? `Effect: ${t}` : JSON.stringify(effect));
      }
    }

    return String(effect);
  }

  function renderClassifieds() {
    const g = state.game;
    const host = $("#npClassifieds");
    if (!host) return;

    const raw = g?.selectedClassifieds || [];
    const items = Array.isArray(raw) ? raw : [];
    if (!items.length) {
      // Always show something so the paper doesn't look broken.
      host.innerHTML = `
        <div class="classifieds-title">Classifieds</div>
        <div class="classifieds-grid">
          <div class="classified"><b>NOTICE</b> — No classifieds available.</div>
        </div>
      `;
      return;
    }

    host.innerHTML = `
      <div class="classifieds-title">Classifieds</div>
      <div class="classifieds-grid">
        ${items.map(x => {
          const head = x?.head || x?.label || "NOTICE";
          const text = x?.text || x?.body || x?.textTpl || "";
          return `<div class="classified"><b>${escapeHtml(head)}</b> — ${escapeHtml(text)}</div>`;
        }).join("")}
      </div>
    `;
  }

  function pickClassifiedsForReport() {
    const g = state.game;
    if (!g) return [];

    // Classifieds can reference both board-flavor (blocks) and narrative flavor (districts/caseFile).
    const baseCtx = (state.game?.reportSummary?.ctx) || {};
    const ctx = { ...getReportContext(), ...baseCtx };

    const focus = getGameFocusProfile(g);
    const sum = g.reportSummary || null;
    const count = randInt(3, 6);

    const toneW = g.reportTone?.tagWeights || null;
    const bestKey = sum?.best?.k || null;
    const worstKey = sum?.worst?.k || null;
    const intensity = sum?.intensity || null;
    const perf = sum?.ctx?.performanceKey || null;
    const voice = sum?.ctx?.voiceKey || null;

    const hookSet = new Set(Array.isArray(g.reportHooks || sum?.ctx?.hooks) ? (g.reportHooks || sum?.ctx?.hooks).filter(Boolean) : []);

    const weighted = CONTENT.classifieds.map(c => {
      let w = 1;
      const tags = c.tags || [];
      if (tags.includes(focus.primary)) w += 2.5;
      if (tags.includes(focus.secondary)) w += 1.2;
      if (bestKey && tags.includes(bestKey)) w += 0.8;
      if (worstKey && tags.includes(worstKey)) w += 1.6;
      if (intensity === "chaos") {
        if (tags.includes("crimewave")) w += 0.8;
        if (tags.includes("sirens")) w += 0.6;
        if (tags.includes("night")) w += 0.4;
      } else if (intensity === "calm") {
        if (tags.includes("calm")) w += 0.7;
        if (tags.includes("community")) w += 0.4;
      }
      if (perf === "dire" || perf === "struggling") {
        if (tags.includes("grim")) w += 0.6;
        if (tags.includes("fear")) w += 0.5;
        if (tags.includes("unsolved")) w += 0.5;
      }
      if (perf === "excellent" || perf === "strong") {
        if (tags.includes("victory")) w += 0.5;
        if (tags.includes("relief")) w += 0.4;
      }
      if (voice) {
        if (voice === "ia" && tags.includes("internalaffairs")) w += 0.8;
        if (voice === "tough" && tags.includes("tough")) w += 0.4;
        if (voice === "community" && tags.includes("community")) w += 0.4;
      }
      if (tags.includes("night") && focus.intensity > 0.35) w += 0.7;
      if (tags.includes("calm") && focus.intensity < 0.25) w += 0.6;
      if (toneW) {
        for (const t of tags) {
          const boost = toneW[t];
          if (boost) w += 0.5 * boost;
        }
      }

      // Narrative hooks (same idea as ads): the article text can hint at "paperwork", "coffee",
      // "injury", "security", etc. When that happens, classifieds that share those tags are more likely.
      if (hookSet.size) {
        for (const t of tags) {
          if (hookSet.has(t)) { w += 1.1; break; }
        }
      }
      return { item: c, weight: Math.max(0.2, w) };
    });

    const picked = [];
    const used = new Set();
    let attempts = 0;

    while (picked.length < count && weighted.length && attempts < 300) {
      attempts++;
      const c = weightedPick(weighted);
      if (!c) break;

      // Robust uniqueness key (classifieds may not have an id)
      const key = c.id ?? c.head ?? c.label ?? c.textTpl ?? c.text ?? JSON.stringify(c);

      if (used.has(key)) continue;
      used.add(key);

      picked.push({
        id: c.id ?? key,
        head: c.head || c.label || "NOTICE",
        text: applyTemplate(c.textTpl || c.text || "", ctx),
        tags: c.tags || []
      });

      // Remove chosen item from pool
      for (let i = weighted.length - 1; i >= 0; i--) {
        const x = weighted[i]?.item;
        const xKey = x?.id ?? x?.head ?? x?.label ?? x?.textTpl ?? x?.text ?? JSON.stringify(x);
        if (xKey === key) weighted.splice(i, 1);
      }
    }
    return picked;
  }

  function getGameFocusProfile(g) {
    const invT = g.categories.investigation.success + g.categories.investigation.fail;
    const arrT = g.categories.arrest.success + g.categories.arrest.fail;
    const emeT = g.categories.emergency.success + g.categories.emergency.fail;

    const totals = [
      { k: "investigation", v: invT },
      { k: "arrest", v: arrT },
      { k: "emergency", v: emeT }
    ].sort((a,b)=>b.v-a.v);

    const primary = totals[0].k;
    const secondary = totals[1].k;

    const actions = invT + arrT + emeT;
    const intensity = actions ? Math.min(1, actions / 60) : 0; // 0..1 vibe scaler

    return { primary, secondary, intensity };
  }

  function buildToneProfile(outcome, reason, g) {
    // Returns a { tagWeights } map. This drives endgame ads/classifieds + flavor text.
    // Keep it small + explainable.
    const w = Object.create(null);
    const add = (tag, amt = 1) => {
      if (!tag) return;
      w[tag] = (w[tag] || 0) + amt;
    };

    const isWin = outcome === "win";
    add(isWin ? "victory" : "grim", 2);

    // Ending reason tags
    if (isWin) {
      add("justice", 1);
      add("manhunt", 2);
      if (reason === "caught_before_appeared") add("swift", 1);
      if (reason === "caught_after_appeared") add("overtime", 1);
    } else {
      if (reason === "crime_track_max") {
        add("crimewave", 2);
        add("overrun", 1);
      }
      if (reason === "murderer_escaped") {
        add("unsolved", 2);
        add("fear", 1);
      }
    }

    // Gameplay performance tags
    const overall = getOverallRate();
    const overallPct = Math.round(overall * 100);
    if (overallPct >= 75) add("competent", 1);
    if (overallPct <= 45) add("struggling", 1);

    const focus = getGameFocusProfile(g);
    add(focus.primary, 2);
    add(focus.secondary, 1);
    if (focus.intensity > 0.5) add("sirens", 1);
    if (focus.intensity < 0.25) add("quiet", 1);

    // Dirty cop / IA flavor (if enabled in setup)
    const dc = state.setupDraft?.dirtyMode || null;
    if (dc) {
      if (dc === "1" || dc === "likely1" || dc === "2" || dc === "likely2") add("corruption", 1);
      if (dc === "ia") add("internalaffairs", 2);
    }

    return { tagWeights: w };
  }

  function buildWeightedAdPool(focus, tone, sum, hooks) {
    // Base weight for all ads, then boost by category tags
    // Add tags to ads in the AD_POOL (shown below)
    const out = [];

    const toneW = tone?.tagWeights || null;
    const bestKey = sum?.best?.k || null;
    const worstKey = sum?.worst?.k || null;
    const intensity = sum?.intensity || null; // calm | steady | chaos
    const perf = sum?.ctx?.performanceKey || null; // excellent | strong | mixed | struggling | dire
    const voice = sum?.ctx?.voiceKey || null; // community | tough | supportive | skeptical | ia

    const hookSet = new Set(Array.isArray(hooks) ? hooks.filter(Boolean) : []);

    for (const ad of CONTENT.ads) {
      let w = 1;

      const tags = ad.tags || [];

      // Primary category matters more than secondary
      if (tags.includes(focus.primary)) w += 3;
      if (tags.includes(focus.secondary)) w += 1.5;

      // Narrative “best/worst” — helps match ads to the *story* of the shift.
      if (bestKey && tags.includes(bestKey)) w += 1.0;
      if (worstKey && tags.includes(worstKey)) w += 2.0;

      // Intensity nudges (chaos prefers sirens/crimewave/night; calm prefers community/coffee)
      if (intensity === "chaos") {
        if (tags.includes("sirens")) w += 1.2;
        if (tags.includes("crimewave")) w += 1.0;
        if (tags.includes("night")) w += 0.8;
      } else if (intensity === "calm") {
        if (tags.includes("calm")) w += 0.9;
        if (tags.includes("community")) w += 0.7;
        if (tags.includes("coffee")) w += 0.6;
      }

      // Performance nudges
      if (perf === "dire" || perf === "struggling") {
        if (tags.includes("grim")) w += 0.9;
        if (tags.includes("fear")) w += 0.7;
        if (tags.includes("security")) w += 0.7;
        if (tags.includes("bail")) w += 0.6;
      }
      if (perf === "excellent" || perf === "strong") {
        if (tags.includes("victory")) w += 0.8;
        if (tags.includes("justice")) w += 0.6;
        if (tags.includes("relief")) w += 0.6;
      }

      // Editorial voice nudges (kept subtle)
      if (voice) {
        if (voice === "ia" && tags.includes("internalaffairs")) w += 1.0;
        if (voice === "tough" && tags.includes("tough")) w += 0.6;
        if (voice === "community" && tags.includes("community")) w += 0.6;
      }

      // “City vibe” tags — you can use these later
      if (tags.includes("night") && focus.intensity > 0.4) w += 0.8;
      if (tags.includes("calm") && focus.intensity < 0.25) w += 0.6;

      // Endgame tone boost (win/loss, reason, corruption, etc.)
      if (toneW) {
        for (const t of tags) {
          const boost = toneW[t];
          if (boost) w += 0.7 * boost;
        }
      }

      // Narrative hooks: if the article text hints at paperwork/coffee/injury/etc.,
      // prefer ads whose tags match those hooks.
      if (hookSet.size) {
        for (const t of tags) {
          if (hookSet.has(t)) {
            w += 1.8;
            break;
          }
        }
      }

      // If it’s an image ad but the file isn't there yet, slightly reduce weight
      if (ad.type === "image") w -= 0.2;

      out.push({ item: ad, weight: Math.max(0.2, w) });
    }

    return out;
  }

  function weightedPick(weightedArr) {
    const total = weightedArr.reduce((s, x) => s + x.weight, 0);
    if (total <= 0) return null;

    let r = Math.random() * total;
    for (const x of weightedArr) {
      r -= x.weight;
      if (r <= 0) return x.item;
    }
    return weightedArr[weightedArr.length - 1].item;
  }

  function renderNewsAds() {
    const g = state.game;
    const host = $("#npAds");
    if (!host) return;

    const raw = g?.selectedAds || [];
    const ads = Array.isArray(raw) ? raw : [];
    if (!ads.length) {
      // Always render a placeholder so the paper doesn't look empty/broken.
      host.innerHTML = `
        <div class="news-ad">
          <div class="ad-title">ADVERTISEMENT</div>
          <div class="ad-body">No ad inventory available.</div>
        </div>
      `;
      return;
    }

    host.innerHTML = ads.map((ad, idx) => {
      const sizeClass = ads.length === 2 && idx === 1 ? "small" : "";
      if (ad.type === "image" && ad.src) {
        // Use <img> but also fallback to a text ad look if missing
        const src = AD_BASE + ad.src;
        return `
        <div class="news-ad ${sizeClass}">
          <img src="${src}" alt="${escapeHtml(ad.alt || "Advertisement")}"
               onerror="this.style.display='none'; this.parentElement.querySelector('.ad-fallback').style.display='block';">
          <div class="ad-fallback" style="display:none;">
            <div class="ad-title">ADVERTISEMENT</div>
            <div class="ad-body">Local business message unavailable.</div>
            <div class="ad-fine">${escapeHtml(ad.src)}</div>
          </div>
        </div>
      `;
      }

      // Text ad
      // Text ad (with legacy fallbacks)
      const title = ad.title || ad.head || ad.label || "ADVERTISEMENT";
      const body = ad.body || ad.text || "Local business message unavailable.";
      const fine = ad.fine || "";
      return `
        <div class="news-ad ${sizeClass}">
          <div class="ad-title">${escapeHtml(title)}</div>
          <div class="ad-body">${escapeHtml(body)}</div>
          ${fine ? `<div class="ad-fine">${escapeHtml(fine)}</div>` : ""}
        </div>
      `;
    }).join("");
  }

  function pickAdsForReport() {
    const g = state.game;
    if (!g) return [];

    const count = Math.random() < 0.55 ? 1 : 2;

    const focus = getGameFocusProfile(g); // {primary, secondary, intensity}
    const tone = g.reportTone || null;
    const sum = g.reportSummary || null;
    const hooks = g.reportHooks || sum?.ctx?.hooks || [];
    const weighted = buildWeightedAdPool(focus, tone, sum, hooks);

    // Pick unique ads by weighted draw (safe: supports missing ids and prevents infinite loops)
    const picked = [];
    const used = new Set();
    let attempts = 0;

    while (picked.length < count && weighted.length && attempts < 150) {
      attempts++;
      const ad = weightedPick(weighted);
      if (!ad) break;

      // Robust uniqueness key (ads may not have an id)
      const key = ad.id ?? ad.src ?? ad.title ?? ad.label ?? JSON.stringify(ad);

      if (used.has(key)) continue;
      used.add(key);
      picked.push(ad);

      // Remove chosen item from the pool so we don't keep re-picking it
      for (let i = weighted.length - 1; i >= 0; i--) {
        const x = weighted[i]?.item;
        const xKey = x?.id ?? x?.src ?? x?.title ?? x?.label ?? JSON.stringify(x);
        if (xKey === key) weighted.splice(i, 1);
      }
    }

    // Fallback if something went weird
    if (!picked.length) {
      return [...CONTENT.ads].sort(() => Math.random() - 0.5).slice(0, count);
    }

    return picked;
  }


  function formatLongDate(d) {
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  }

  function makeCaseFileId() {
    // Example: PP-4821 (easy to read)
    return `PP-${randInt(1000, 9999)}`;
  }

  // Convert <img> tags in a cloned DOM subtree into data: URLs so the
  // SVG foreignObject snapshot can be exported without tainting the canvas.
  // (Any non-CORS image referenced inside the SVG will taint the canvas.)
  async function inlineImages(rootEl) {
    const imgs = Array.from(rootEl.querySelectorAll("img"));
    for (const img of imgs) {
      const src = (img.getAttribute("src") || "").trim();
      if (!src) continue;
      if (src.startsWith("data:")) continue;
      if (src.startsWith("blob:")) continue;

      try {
        const abs = toAbsoluteUrl(src);
        const dataUrl = await fetchAsDataUrl(abs);
        img.setAttribute("src", dataUrl);
      } catch (e) {
        // As a safe fallback, remove the image rather than risking a tainted export.
        // (This keeps the export working even if a single asset 404s or is blocked.)
        const alt = img.getAttribute("alt") || "";
        const span = document.createElement("span");
        span.textContent = alt ? `[${alt}]` : "";
        img.replaceWith(span);
        console.warn("Newsprint export: failed to inline image", src, e);
      }
    }
  }

  function toAbsoluteUrl(url) {
    try {
      return new URL(url, window.location.href).toString();
    } catch {
      return url;
    }
  }

  async function fetchAsDataUrl(url) {
    const res = await fetch(url, { cache: "no-cache", credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function saveNewsprintAsImage() {
    const node = document.querySelector("#newsprint");
    if (!node) return;

    try {

    // Make sure fonts/layout are settled
    await waitNextFrame();
    await waitNextFrame();

    const rect = node.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    // Inline computed styles + structure into an SVG foreignObject snapshot
    const cloned = node.cloneNode(true);
    inlineAllStyles(node, cloned);

    // IMPORTANT: inline any <img> sources so the export canvas is not tainted.
    await inlineImages(cloned);

    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml">
          ${cloned.outerHTML}
        </div>
      </foreignObject>
    </svg>
  `.trim();

      const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      try {
        const img = await loadImage(url);

        const canvas = document.createElement("canvas");
        const scale = 2; // sharper output
        canvas.width = width * scale;
        canvas.height = height * scale;

        const ctx = canvas.getContext("2d");
        // Some browsers can return null here in restricted contexts
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.drawImage(img, 0, 0);

        const pngUrl = canvas.toDataURL("image/png");
        downloadDataUrl(pngUrl, makeNewsFilename());
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.warn("Save as Image failed", e);

      // Try the server-side export (works on iOS / in-app browsers) if it's been deployed.
      try {
        await saveNewsprintAsImageServer();
        return;
      } catch (serverErr) {
        console.warn("Server image export also failed", serverErr);
      }

      // iOS Safari (and some in-app browsers) can block foreignObject rendering.
      openInfoModal({
        title: "Save as Image",
        modalType: "saveImageHelp",
        bodyHtml: `
          <div class="item">
            <div class="item-text">Your browser blocked the image export method used by the app.</div>
          </div>
          <div class="item">
            <div class="item-title">Workarounds</div>
            <div class="item-text">
              <ul style="margin:8px 0 0 18px;">
                <li>Try Chrome or Edge on desktop.</li>
                <li>On iPhone/iPad, try opening in Safari (not an in-app browser) and retry.</li>
                <li>Try the <b>Save as PDF (Server)</b> option if available.</li>
                <li>As a fallback, take a screenshot of the Shift Report.</li>
              </ul>
            </div>
          </div>
        `,
        primaryText: "OK"
      });
    }
  }

  async function buildNewsprintHtmlDocument({ pageBg = "#0b1320", padding = 32 } = {}) {
    const node = document.querySelector("#newsprint");
    if (!node) throw new Error("#newsprint not found");

    // Make sure fonts/layout are settled
    await waitNextFrame();
    await waitNextFrame();

    const cloned = node.cloneNode(true);
    inlineAllStyles(node, cloned);
    await inlineImages(cloned);

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    html, body { margin:0; padding:0; background:${pageBg}; }
    body { display:flex; justify-content:center; padding:${padding}px; }
    #newsprint { display:block; }
  </style>
</head>
<body>
  ${cloned.outerHTML}
</body>
</html>`;
  }

  async function saveNewsprintAsImageServer() {
    const htmlDoc = await buildNewsprintHtmlDocument({ pageBg: "#0b1320", padding: 32 });

    const res = await fetch("/api/newsprint.png", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: htmlDoc })
    });
    if (!res.ok) throw new Error(`Server export failed: ${res.status}`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = makeNewsFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function saveNewsprintAsPdfServer() {
    const htmlDoc = await buildNewsprintHtmlDocument({ pageBg: "#ffffff", padding: 24 });

    const res = await fetch("/api/newsprint.pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: htmlDoc })
    });
    if (!res.ok) throw new Error(`Server PDF export failed: ${res.status}`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = makeNewsFilename().replace(/\.png$/i, ".pdf");
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function makeNewsFilename() {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
    return `police_precinct_shift_report_${stamp}.png`;
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function hapticRoll() {
    try {
      if (navigator && typeof navigator.vibrate === "function") {
        navigator.vibrate([25, 15, 25]);
      }
    } catch (_) {
      // no-op
    }
  }

  function waitNextFrame() {
    return new Promise(res => requestAnimationFrame(() => res()));
  }

  function inlineAllStyles(sourceNode, targetNode) {
    // Inline computed styles for the target tree to make the snapshot self-contained
    const srcEls = [sourceNode, ...sourceNode.querySelectorAll("*")];
    const tgtEls = [targetNode, ...targetNode.querySelectorAll("*")];

    for (let i = 0; i < srcEls.length; i++) {
      const src = srcEls[i];
      const tgt = tgtEls[i];
      const cs = window.getComputedStyle(src);

      // Write a minimal-but-sufficient set (you can expand later)
      const props = [
        "display","position","boxSizing",
        "width","height",
        "padding","margin",
        "border","borderRadius",
        "background","backgroundColor",
        "color",
        "fontFamily","fontSize","fontWeight","fontStyle","letterSpacing","textTransform",
        "lineHeight","textAlign","whiteSpace",
        "boxShadow",
        "opacity"
      ];

      let style = "";
      for (const p of props) {
        style += `${p}:${cs.getPropertyValue(p)};`;
      }
      tgt.setAttribute("style", style);
    }
  }


  async function renderNewspaperArticle(outcome, reason) {
    await ensureReportExtras(outcome, reason);
    const a = buildNewspaperArticle(outcome, reason);

    const paperEl = document.querySelector("#npPaperTitle");
    if (paperEl && a.paperTitle) paperEl.textContent = a.paperTitle;

    $("#npMasthead").textContent = a.masthead;
    $("#npDateline").textContent = a.dateline;

    renderNewsAds();
    renderClassifieds();

    $("#npHeadline").textContent = a.headline;
    $("#npSubhead").textContent = a.subhead;
    // Templates often return sentence-sized fragments; newspapers typically combine
    // sentences into fewer, longer paragraphs for a more natural look.
    const groupedParas = (function groupIntoParagraphs(lines){
      const arr = Array.isArray(lines) ? lines.filter(Boolean) : [];
      if (arr.length <= 2) return arr;

      // Aim for 2 paragraphs. We'll pack sentences into the first until we hit a
      // reasonable length, then put the remainder into the second.
      const targetLen = 520; // ~1-2 short paragraphs on mobile, 2 on desktop
      let p1 = "";
      let i = 0;
      for (; i < arr.length; i++) {
        const next = (p1 ? (p1.endsWith("-") ? "" : " ") : "") + arr[i];
        if (p1.length && next.length > targetLen) break;
        p1 = next;
      }
      const p2 = arr.slice(i).join(" ");
      const out = [];
      if (p1.trim()) out.push(p1.trim());
      if (p2.trim()) out.push(p2.trim());
      return out.length ? out : arr;
    })(a.body);

    $("#npBody").innerHTML = groupedParas.map(p => `<p>${escapeHtml(p)}</p>`).join("");

    // Sidebar: police blotter + editorial aside (optional)
    const blot = Array.isArray(a.blotter) ? a.blotter : [];
    const blotEl = document.querySelector("#npBlotter");
    if (blotEl) blotEl.innerHTML = blot.map(x => `<li>${escapeHtml(x)}</li>`).join("") || `<li>${escapeHtml(pickFrom(["No incidents reported.", "No additional reports filed."], "No incidents reported."))}</li>`;

    const asideEl = document.querySelector("#npAside");
    const asideBox = document.querySelector("#npAsideBox");
    if (asideEl && asideBox) {
      if (a.editorialAside) {
        asideEl.textContent = a.editorialAside;
        asideBox.classList.remove("hidden");
      } else {
        asideEl.textContent = "";
        asideBox.classList.add("hidden");
      }
    }
  }

  async function ensureReportExtras(outcome, reason) {
    // Older saved games (or edge cases) may not have selected ads/classifieds.
    // Ensure we always have something to render for the end-of-shift article.
    const g = state.game;
    if (!g) return;

    // If content failed to load for some reason (common symptom: "No ad inventory available"),
    // try one more reload before selecting ads/classifieds.
    if (!CONTENT_LOADED_ONCE || (CONTENT.ads.length === 0 && CONTENT.classifieds.length === 0)) {
      try {
        await loadContent();
      } catch (e) {
        console.warn("Report content reload failed", e);
      }
    }

    let changed = false;

    // Ensure we have narrative hooks for weighting ad/classified selection.
    // (These are emitted when the article is built.)
    if (!Array.isArray(g.reportHooks) || g.reportHooks.length === 0) {
      try {
        const o = outcome || g.endOutcome || "loss";
        const r = reason || g.endReason || "crime_track_max";
        buildNewspaperArticle(o, r);
        changed = true;
      } catch (e) {
        console.warn("Report hook build failed", e);
      }
    }

    if (!Array.isArray(g.selectedAds) || g.selectedAds.length === 0) {
      g.selectedAds = pickAdsForReport();
      changed = true;
    }

    if (!Array.isArray(g.selectedClassifieds) || g.selectedClassifieds.length === 0) {
      g.selectedClassifieds = pickClassifiedsForReport();
      changed = true;
    }

    if (changed) saveState();
  }


  // -------------------------
  // Endgame Summary + Newspaper Templates
  // -------------------------

  function buildEndgameSummary(outcome, reason, g) {
    const overallRate = getOverallRate();
    const actions = getOverallActions();

    const invRate = getSuccessRate("investigation");
    const arrRate = getSuccessRate("arrest");
    const emeRate = getSuccessRate("emergency");

    const invTotal = (g?.categories?.investigation?.success || 0) + (g?.categories?.investigation?.fail || 0);
    const arrTotal = (g?.categories?.arrest?.success || 0) + (g?.categories?.arrest?.fail || 0);
    const emeTotal = (g?.categories?.emergency?.success || 0) + (g?.categories?.emergency?.fail || 0);

    const cats = [
      { k: "investigation", r: invRate, total: invTotal },
      { k: "arrest", r: arrRate, total: arrTotal },
      { k: "emergency", r: emeRate, total: emeTotal }
    ];

    const best = [...cats].sort((a, b) => b.r - a.r)[0];
    const worst = [...cats].sort((a, b) => a.r - b.r)[0];

    const commTotal = (g?.commendations?.investigation || 0) + (g?.commendations?.arrest || 0) + (g?.commendations?.emergency || 0);
    const dispatchApplied = (g?.log || []).filter(x => x.type === "dispatch").length;
    const crisisStarted = (g?.log || []).filter(x => x.type === "crisis" && x.status === "started").length;
    const crisisResolved = (g?.log || []).filter(x => x.type === "crisis" && x.status === "resolved").length;
    const crisisFailed = (g?.log || []).filter(x => x.type === "crisis" && x.status === "failed").length;

    const cluesFound = g?.categories?.investigation?.points || 0;
    const thugsArrested = g?.categories?.arrest?.points || 0;

    // Intensity band (drives wording tone)
    const intensity = actions <= 10 ? "calm" : (actions <= 18 ? "steady" : "chaos");

    // Convert numbers into newspaper-friendly language bands (keep raw values internal)
    const performanceKey = rateBand(overallRate);
    const paceKey = actionsBand(actions);

    // Which arm of the precinct carried the night (for narrative focus)
    const focusProfile = getGameFocusProfile(g);
    const focusKey = focusProfile.primary || "investigation";

    // Outcome bucket
    const outcomeKey = outcome === "win" ? "win" : (reason === "crime_track_max" ? "loss_crimewave" : "loss_unsolved");

    // Pull some stable “board flavor” from setup rolls (no extra input needed)
    const blocks = getReportContext(); // { weaponBlock, witnessBlock, hotBlock }

    // Neighborhood flavor: pick a few recurring Commonville districts deterministically
    const neighborhoods = pickNeighborhoods(blocks, g?.caseFile || "");

    // Notable events: short, human lines from the log
    const notable = [];
    const log = g?.log || [];
    const lastComm = log.find(x => x.type === "commendation");
    const lastDispatch = log.find(x => x.type === "dispatch" && typeof x.text === "string");
    if (crisisFailed > 0) notable.push("A major incident slipped past the response window.");
    if (lastDispatch?.text) notable.push(`Radio traffic included: ${trimSentence(lastDispatch.text, 90)}`);
    if (lastComm?.text) notable.push(`Commendation noted: ${trimSentence(lastComm.text, 90)}`);

    // Determine a light editorial voice (subtle bias)
    const dirtyMode = state.setupDraft?.dirtyMode || null;
    let voiceKey = "community";
    if (dirtyMode === "ia") voiceKey = "ia";
    else if (performanceKey === "dire" || performanceKey === "struggling") voiceKey = "supportive";
    else if (outcomeKey === "loss_unsolved") voiceKey = "skeptical";
    else voiceKey = (Math.random() < 0.55 ? "tough" : "community");

    const cityMood = cityMoodFor(outcomeKey, performanceKey, intensity);

    // Template context (placeholders)
    const ctx = {
      paperName: "THE COMMONVILLE GAZETTE",
      players: g?.players || 0,
      actions,
      // Raw stats remain available for internal use, but templates should prefer the language bands below.
      overallPct: fmtPct(overallRate),
      bestCat: cap(best.k),
      bestPct: fmtPct(best.r),
      worstCat: cap(worst.k),
      worstPct: fmtPct(worst.r),
      performanceKey,
      paceKey,
      cityMood,
      districtA: neighborhoods[0] || "Commonville",
      districtB: neighborhoods[1] || "Downtown",
      districtC: neighborhoods[2] || "Westside",
      voiceKey,
      focusCat: cap(focusKey),
      commTotal,
      dispatchCount: dispatchApplied,
      crisisCount: crisisStarted,
      crisisResolved,
      crisisFailed,
      cluesFound,
      thugsArrested,
      caseFile: g?.caseFile || "PP-????",
      dateLong: formatLongDate(new Date(g?.endedAt || Date.now())),
      outcomeLabel: outcome === "win" ? "Win" : "Loss",
      reasonLabel: humanizeEndReason(outcome, reason),
      weaponBlock: blocks.weaponBlock,
      witnessBlock: blocks.witnessBlock,
      hotBlock: blocks.hotBlock,
      intensity,
      performanceKey,
      paceKey,
      cityMood,
      voiceKey,
      neighborhoodA: neighborhoods[0] || "Downtown",
      neighborhoodB: neighborhoods[1] || "Riverview",
      neighborhoodC: neighborhoods[2] || "Westgate",
      notable1: notable[0] || "",
      notable2: notable[1] || "",
      notable3: notable[2] || ""
    };

    return {
      outcomeKey,
      intensity,
      focusKey,
      best,
      worst,
      tags: g?.reportTone?.tagWeights || null,
      ctx
    };
  }

  function trimSentence(s, maxLen) {
    const str = String(s || "").trim();
    if (str.length <= maxLen) return str;
    return str.slice(0, Math.max(0, maxLen - 1)).trimEnd() + "…";
  }

  function pickFrom(arr, fallback = "") {
    if (!Array.isArray(arr) || !arr.length) return fallback;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Template segments can be either:
  //  - a string
  //  - an object: { text: string, hooks?: string[] }
  // This helper normalizes the selection and returns both the text and any narrative hooks.
  function pickSegment(arr, fallbackText = "") {
    const picked = pickFrom(arr, null);
    if (!picked) return { text: fallbackText, hooks: [] };
    if (typeof picked === "string") return { text: picked, hooks: [] };
    if (typeof picked === "object") {
      const text = picked.text ?? picked.tpl ?? picked.value ?? "";
      const hooks = Array.isArray(picked.hooks) ? picked.hooks.filter(Boolean) : [];
      return { text: String(text || fallbackText), hooks };
    }
    return { text: String(picked), hooks: [] };
  }

  // Pick up to `count` unique segments from an array (strings or {text, hooks}).
  // Uses a shuffled copy so we don't repeatedly grab the same line.
  function pickManySegments(arr, count) {
    if (!Array.isArray(arr) || !arr.length || !count || count <= 0) return [];
    const copy = arr.slice();
    // Fisher–Yates shuffle
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    const out = [];
    const want = Math.min(count, copy.length);
    for (let i = 0; i < want; i++) {
      out.push(pickSegment([copy[i]], ""));
    }
    return out;
  }

  function wordCount(str) {
    return String(str || "").trim().split(/\s+/).filter(Boolean).length;
  }

  function uniqStrings(arr) {
    const out = [];
    const s = new Set();
    for (const x of (arr || [])) {
      const k = String(x || "").trim().toLowerCase();
      if (!k) continue;
      if (s.has(k)) continue;
      s.add(k);
      out.push(k);
    }
    return out;
  }

  // -------------------------
  // Newspaper language helpers
  // -------------------------

  function rateBand(rate) {
    const r = clampNum(rate || 0, 0, 1);
    if (r >= 0.78) return "excellent";
    if (r >= 0.65) return "strong";
    if (r >= 0.5) return "mixed";
    if (r >= 0.35) return "struggling";
    return "dire";
  }

  function actionsBand(actions) {
    const a = Math.max(0, actions || 0);
    if (a <= 8) return "quiet";
    if (a <= 16) return "busy";
    return "nonstop";
  }

  function cityMoodFor(outcomeKey, performanceKey, intensity) {
    const isWin = outcomeKey === "win";
    if (isWin && performanceKey === "excellent") return "relieved and energized";
    if (isWin) return "relieved";
    if (outcomeKey === "loss_crimewave") return intensity === "chaos" ? "frayed" : "uneasy";
    // loss_unsolved
    if (performanceKey === "strong" || performanceKey === "excellent") return "restless";
    return "on edge";
  }

  function stableHash(str) {
    const s = String(str || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
  }

  function pickNeighborhoods(blocks, seedStr) {
    const neighborhoods = [
      "Old Harbor",
      "Railyard District",
      "Maple Heights",
      "South Commons",
      "Riverview",
      "Market Square",
      "Bricktown",
      "Westgate",
      "Northside",
      "Pineview",
      "The Flats",
      "Civic Center"
    ];
    const base = stableHash(`${seedStr}|${blocks?.weaponBlock}|${blocks?.witnessBlock}|${blocks?.hotBlock}`);
    const a = neighborhoods[base % neighborhoods.length];
    const b = neighborhoods[(base >>> 5) % neighborhoods.length];
    const c = neighborhoods[(base >>> 11) % neighborhoods.length];
    // ensure variety
    const uniq = [...new Set([a, b, c])];
    while (uniq.length < 3) {
      uniq.push(neighborhoods[(base + uniq.length * 7) % neighborhoods.length]);
    }
    return uniq.slice(0, 3);
  }

  function buildBlotterLines(templates, ctx, sum) {
    const bank = (templates && templates.blotter) || {};
    const lines = [];

    const districts = [ctx.neighborhoodA, ctx.neighborhoodB, ctx.neighborhoodC].filter(Boolean);
    const outcomeGroup = sum.outcomeKey === "win" ? "win" : "loss";
    const focusGroup = (sum.focusKey || "investigation").toLowerCase();

    const pools = [];
    if (bank[outcomeGroup]) pools.push(bank[outcomeGroup]);
    if (bank[focusGroup]) pools.push(bank[focusGroup]);
    if (bank.default) pools.push(bank.default);
    const pool = pools.flat().filter(Boolean);

    // Fallback if templates are missing
    if (!pool.length) {
      return [
        `${districts[0] || "Commonville"} — Units responded to a late-night call; scene cleared without further incident.`,
        `${districts[1] || "Commonville"} — Patrol presence increased as residents reported disturbances.`,
        `${districts[2] || "Commonville"} — A routine stop produced a brief delay; traffic resumed shortly after.`
      ];
    }

    // Pick 3 unique-ish entries
    const used = new Set();
    for (let i = 0; i < 3; i++) {
      let tpl = "";
      for (let tries = 0; tries < 6; tries++) {
        const candidate = pickFrom(pool, "");
        if (!candidate) continue;
        if (!used.has(candidate)) { tpl = candidate; used.add(candidate); break; }
      }
      if (!tpl) tpl = pickFrom(pool, "");
      const district = districts[i % districts.length] || "Commonville";
      const line = applyTemplate(tpl, { ...ctx, district });
      lines.push(line);
    }
    return lines;
  }

  function buildNewspaperArticle(outcome, reason) {
    const g = state.game;
    const templates = CONTENT.articleTemplates || getDefaultArticleTemplates();
    const sum = buildEndgameSummary(outcome, reason, g);
    const ctx = sum.ctx;

    // Collect narrative hooks from selected template segments.
    // These hooks are used to weight ad + classifieds selection so the layout feels intentional
    // (e.g., an overtime/paperwork paragraph increases the chance of a paper company ad).
    const hooks = [];

    // Masthead + byline
    const paperTitle = (templates.masthead?.title) || ctx.paperName || "THE COMMONVILLE GAZETTE";
    const kicker = pickFrom(templates.kickers, "Gazette Desk");
    const mastheadTpl = pickFrom(templates.mastheads, "FROM THE POLICE BEAT");
    const masthead = applyTemplate(mastheadTpl, ctx);
    const dateline = `${ctx.dateLong} • ${kicker} • Case File ${ctx.caseFile}`;

    // Headline + subhead (avoid raw stats; use language bands)
    const headlineMap = templates.headline || templates.headlines || {};
    const subheadMap = templates.subhead || templates.subheads || {};
    const headlineSeg = pickSegment(headlineMap[sum.outcomeKey], "SHIFT REPORT");
    const subheadSeg = pickSegment(subheadMap[ctx.performanceKey] || subheadMap.mixed || [], "A demanding shift tested officers across multiple fronts.");
    hooks.push(...headlineSeg.hooks, ...subheadSeg.hooks);

    const headline = applyTemplate(headlineSeg.text, ctx);
    const subhead = applyTemplate(subheadSeg.text, ctx);

    // Body: build a longer "real" article out of multiple snippets,
    // then pack them into 1–2 newspaper-style paragraphs.
    const bodyBank = templates.body || (templates.paragraphs || {});
    const openingArr = bodyBank.opening || bodyBank.intro?.[sum.outcomeKey] || bodyBank.intro?.default || [];
    const focusKey = ("focus_" + (sum.focusKey || "investigation")).toLowerCase();
    const focusArr = bodyBank[focusKey] || bodyBank.focus_investigation || [];
    const pressureKey = sum.intensity === "steady" ? "busy" : (sum.intensity === "chaos" ? "chaotic" : "calm");
    const pressureArr = bodyBank["pressure_" + pressureKey] || bodyBank["pressure_" + sum.intensity] || bodyBank.pressure_calm || [];
    const closingMap = templates.closing || (templates.paragraphs || {}).close || {};
    const closingKey = sum.outcomeKey === "win" ? "win" : "loss";
    const closingArr = closingMap[sum.outcomeKey] || closingMap[closingKey] || closingMap.default || [];

    // Select more snippets so the article doesn't collapse into 2 sentences.
    // Counts scale slightly with intensity.
    const openingSegs = pickManySegments(openingArr, 2);
    const focusSegs = pickManySegments(focusArr, sum.intensity === "chaos" ? 4 : 3);
    const pressureSegs = pickManySegments(pressureArr, sum.intensity === "chaos" ? 2 : 1);
    const closingSegs = pickManySegments(closingArr, 2);

    const allSegs = [...openingSegs, ...focusSegs, ...pressureSegs, ...closingSegs]
      .filter(s => s && String(s.text || "").trim());
    hooks.push(...allSegs.flatMap(s => s.hooks || []));

    const fragments = allSegs.map(s => applyTemplate(s.text, ctx)).filter(Boolean);

    // Pack fragments into 1–2 paragraphs so it reads like an article.
    // If we somehow end up short, just keep everything in one paragraph.
    const para1Target = 90; // words
    const para2Target = 80; // words
    const p1Parts = [];
    const p2Parts = [];
    let wc1 = 0;
    let wc2 = 0;
    for (const frag of fragments) {
      const w = wordCount(frag);
      // Fill paragraph 1 until we hit target and have at least 3 fragments.
      if (wc1 < para1Target || p1Parts.length < 3) {
        p1Parts.push(frag);
        wc1 += w;
      } else {
        p2Parts.push(frag);
        wc2 += w;
      }
    }
    // If paragraph 2 is too tiny, merge it back.
    const para1 = p1Parts.join(" ").trim();
    let para2 = p2Parts.join(" ").trim();
    if (p2Parts.length < 2 || wc2 < 35) {
      para2 = "";
    }
    const body = [para1, para2].filter(Boolean);

    // Optional editorial aside (subtle bias)
    const asideBank = templates.editorial_asides || {};
    const asideSeg = pickSegment(asideBank[ctx.voiceKey] || asideBank.default || [], "");
    hooks.push(...asideSeg.hooks);
    const editorialAside = asideSeg.text ? applyTemplate(asideSeg.text, ctx) : "";

    // Police blotter sidebar
    const blotter = buildBlotterLines(templates, ctx, sum);

    // Store hooks on the run so ads/classifieds can be chosen consistently.
    const uniqHooks = uniqStrings(hooks);
    if (g) {
      g.reportHooks = uniqHooks;
      if (g.reportSummary?.ctx) g.reportSummary.ctx.hooks = uniqHooks;
    }

    return { paperTitle, masthead, dateline, headline, subhead, body, blotter, editorialAside, hooks: uniqHooks };
  }

  function updateDispatchFades() {
    const el = activeDispatchList;
    if (!el || activeDispatchStrip.classList.contains("hidden")) return;

    const maxScroll = el.scrollWidth - el.clientWidth;
    const leftOn = el.scrollLeft > 2;
    const rightOn = el.scrollLeft < maxScroll - 2;

    dispatchFadeLeft.classList.toggle("on", leftOn);
    dispatchFadeRight.classList.toggle("on", rightOn);
  }

  function nudgeDispatchScroll(dir) {
    // dir: -1 left, +1 right
    const el = activeDispatchList;
    if (!el) return;

    const nudge = Math.max(120, Math.floor(el.clientWidth * 0.6));
    el.scrollBy({ left: dir * nudge, behavior: "smooth" });

    // fades update after scroll animation starts
    setTimeout(updateDispatchFades, 120);
  }

  function $(sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Missing element: ${sel}`);
    return el;
  }
  function cap(s) { return (s || "").slice(0,1).toUpperCase() + (s || "").slice(1); }
  function fmtPct(x) { return `${Math.round((x || 0) * 100)}%`; }

  function ledClassForRate(r) {
    const pct = Math.round((r || 0) * 100);
    if (pct < 15) return "red";
    if (pct < 25) return "redorange";
    if (pct < 35) return "orange";
    if (pct < 45) return "yelloworange";
    if (pct < 55) return "yellow";
    if (pct < 65) return "yellowgreen";
    if (pct < 75) return "green";
    if (pct < 85) return "bluegreen";
    return "blue";
  }
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function uid() { return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16); }
  function clampInt(v, min, max) { const n = parseInt(v, 10); if (Number.isNaN(n)) return min; return Math.max(min, Math.min(max, n)); }
  function clampNum(v, min, max) { const n = parseFloat(v); if (Number.isNaN(n)) return min; return Math.max(min, Math.min(max, n)); }
  function escapeHtml(str) {
    return String(str)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }
  function copyToClipboard(text) { navigator.clipboard?.writeText(text).catch(() => {}); }
})();
