// app.js
(() => {
  const STORAGE_KEY = "pp_dispatcher_state_v1";

  const DEFAULT_SETTINGS = {
    audio: { musicEnabled: true, musicVolume: 0.5, sfxEnabled: true, sfxVolume: 0.8 },
    features: { commendations: true, dispatches: true, crisis: true },
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
    dispatches: [],
    commendations: [],
    crises: []
  };


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
  const btnQuickAudio = $("#btnQuickAudio");
  const btnHowTo = $("#btnHowTo");
  const btnClearData = $("#btnClearData");

  const btnActivityLog = $("#btnActivityLog");
  const btnEndShift = $("#btnEndShift");

  const btnInstallApp = $("#btnInstallApp");

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
    const active = !!state.game?.active;
    btnBeginShift.textContent = active ? "Continue Shift" : "Begin Shift";
  }

  function showGame() {
    if (!state.game?.active) startNewGame();
    setActiveView(viewGame);
    renderGame();

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
        swRegistration = await navigator.serviceWorker.register("./sw.js");

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
      openConfirmModal({
        title: "Ending your shift?",
        text: "This will end the current game in progress.",
        confirmText: "End Shift",
        confirmClass: "warn",
        onConfirm: () => openEndShiftModal()
      });
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

      recordAction(cat, action);
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
      return { success: 0, fail: 0, commProgress: 0 };
    }
  }

  // -------------------------
  // Core game logic
  // -------------------------
  function recordAction(cat, action) {
    const g = state.game;
    g.clickCount += 1;

    const c = g.categories[cat];
    if (action === "success") c.success += 1;
    else c.fail += 1;

    g.log.unshift({ t: Date.now(), type: "action", cat, result: action });

    // Commendations
    if (state.settings.features.commendations && action === "success") {
      c.commProgress += 1;
      const thresh = COMM_THRESHOLDS[cat];
      if (c.commProgress >= thresh) {
        c.commProgress = 0;
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

    audio.playUi(AUDIO_FILES.dispatch);
    openDispatchModal(dispatch);
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
      $(`#${cat}Pct`).textContent = fmtPct(getSuccessRate(cat));
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
      ds.slice(0, 6).forEach(d => {
        const el = document.createElement("div");
        el.className = "tag";
        el.textContent = `${cap(d.cat)}: ${d.short}`;
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
    const setup = state.setupDraft || { players: 4, generated: null };

    openModal({
      title: "Setup",
      modalType: "setup",
      bodyHtml: `
        <div class="row">
          <div class="field">
            <div class="label">Number of Players</div>
            <input class="input" id="setupPlayers" type="number" min="1" max="6" value="${setup.players}">
          </div>
          <div class="field">
            <div class="label">Police Cards per Player</div>
            <input class="input" id="setupPoliceCards" type="text" value="${calcPoliceCards(setup.players)}" disabled>
          </div>
        </div>

        <div class="row">
          <div class="field">
            <div class="label">Punk Pool</div>
            <input class="input" id="setupPunkPool" type="text" value="${calcPunkPool(setup.players)}" disabled>
          </div>
          <div class="field">
            <div class="label">Calendar Start</div>
            <input class="input" id="setupCalendarStart" type="text" value="${calcCalendarStart(setup.players)}" disabled>
          </div>
        </div>

        <hr class="sep"/>

        <div class="row">
          <button class="btn primary" id="btnGenerateSetup">Generate Setup Rolls</button>
          <button class="btn" id="btnReRollSetup">Re-Roll</button>
        </div>

        <div id="setupResults" class="list" style="margin-top:12px;"></div>
      `,
      footerButtons: [{ text: "Done", className: "btn primary", onClick: closeModal }],
      onOpen: () => {
        const playersEl = $("#setupPlayers");
        const resultsEl = $("#setupResults");

        const updateAutos = () => {
          const p = clampInt(playersEl.value, 1, 6);
          $("#setupPoliceCards").value = calcPoliceCards(p);
          $("#setupPunkPool").value = calcPunkPool(p);
          $("#setupCalendarStart").value = calcCalendarStart(p);
        };

        playersEl.addEventListener("input", updateAutos);

        const renderSetup = (gen) => {
          if (!gen) {
            resultsEl.innerHTML = `<div class="item"><div class="item-text">Tap <b>Generate Setup Rolls</b> to create random block placements and punk distribution.</div></div>`;
            return;
          }

          const punksByBlock = gen.punksByBlock;

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
              <div class="item-title">3) Deal Police Cards</div>
              <div class="item-text">Deal <b>${calcPoliceCards(setup.players)}</b> Police Cards to each player.</div>
            </div>

            <div class="item">
              <div class="item-title">4) Punk Pool</div>
              <div class="item-text">Add <b>${calcPunkPool(setup.players)}</b> Punk Tokens to pool (return rest to box).</div>
            </div>

            <div class="item">
              <div class="item-title">5) Calendar Marker</div>
              <div class="item-text">Start Calendar Marker on <b>${calcCalendarStart(setup.players)}</b>.</div>
            </div>

            <div class="item">
              <div class="item-title">6) Emergency Cards</div>
              <div class="item-text">Draw <b>2</b> Emergency cards.</div>
            </div>

            <div class="item">
              <div class="item-title">7) Place 6 Punks</div>
              <div class="item-text">
                ${Object.keys(punksByBlock).sort().map(k => `Block ${k}: <b>${punksByBlock[k]}</b>`).join("<br/>")}
                <br/><span class="muted tiny">(Max 3 per block enforced)</span>
              </div>
            </div>

            <div class="item">
              <div class="item-title">8) Choose Characters</div>
              <div class="item-text">Players select a character card.</div>
            </div>
          `;
        };

        const generate = () => {
          setup.players = clampInt(playersEl.value, 1, 6);
          setup.generated = generateSetupRolls();
          state.setupDraft = setup;
          saveState();
          renderSetup(setup.generated);
        };

        $("#btnGenerateSetup").addEventListener("click", generate);
        $("#btnReRollSetup").addEventListener("click", generate);

        renderSetup(setup.generated);
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
          <div class="item-title">Audio</div>
          <div class="row">
            <div class="field">
              <div class="label">Music</div>
              <select class="select" id="setMusicEnabled">
                <option value="true" ${s.audio.musicEnabled ? "selected":""}>On</option>
                <option value="false" ${!s.audio.musicEnabled ? "selected":""}>Off</option>
              </select>
            </div>
            <div class="field">
              <div class="label">Music Volume</div>
              <input class="input" id="setMusicVol" type="number" min="0" max="1" step="0.05" value="${s.audio.musicVolume}">
            </div>
          </div>

          <div class="row">
            <div class="field">
              <div class="label">Sounds</div>
              <select class="select" id="setSfxEnabled">
                <option value="true" ${s.audio.sfxEnabled ? "selected":""}>On</option>
                <option value="false" ${!s.audio.sfxEnabled ? "selected":""}>Off</option>
              </select>
            </div>
            <div class="field">
              <div class="label">SFX Volume</div>
              <input class="input" id="setSfxVol" type="number" min="0" max="1" step="0.05" value="${s.audio.sfxVolume}">
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
          <div class="tiny muted">Note: Vibration only works on supported devices/browsers and may be blocked in some contexts.</div>
        </div>

        <div class="item">
          <div class="item-title">Features</div>
          <div class="row">
            <div class="field">
              <div class="label">Commendations</div>
              <select class="select" id="setComm">
                <option value="true" ${s.features.commendations ? "selected":""}>On</option>
                <option value="false" ${!s.features.commendations ? "selected":""}>Off</option>
              </select>
            </div>
            <div class="field">
              <div class="label">Dispatches / Radio</div>
              <select class="select" id="setDisp">
                <option value="true" ${s.features.dispatches ? "selected":""}>On</option>
                <option value="false" ${!s.features.dispatches ? "selected":""}>Off</option>
              </select>
            </div>
            <div class="field">
              <div class="label">Crisis</div>
              <select class="select" id="setCrisis">
                <option value="true" ${s.features.crisis ? "selected":""}>On</option>
                <option value="false" ${!s.features.crisis ? "selected":""}>Off</option>
              </select>
            </div>
          </div>
        </div>

        <div class="item">
          <div class="item-title">Pacing</div>
          <div class="row">
            <div class="field">
              <div class="label">Dispatch Frequency</div>
              <select class="select" id="setDispRate">
                <option value="low" ${s.pacing.dispatchRate==="low"?"selected":""}>Low</option>
                <option value="normal" ${s.pacing.dispatchRate==="normal"?"selected":""}>Normal</option>
                <option value="high" ${s.pacing.dispatchRate==="high"?"selected":""}>High</option>
              </select>
            </div>
            <div class="field">
              <div class="label">Crisis Frequency</div>
              <select class="select" id="setCrisisRate">
                <option value="rare" ${s.pacing.crisisRate==="rare"?"selected":""}>Rare</option>
                <option value="normal" ${s.pacing.crisisRate==="normal"?"selected":""}>Normal</option>
                <option value="frequent" ${s.pacing.crisisRate==="frequent"?"selected":""}>Frequent</option>
              </select>
            </div>
          </div>
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

        const readBool = (id) => $(`#${id}`).value === "true";
        $("#setMusicEnabled").addEventListener("change", () => {
          s.audio.musicEnabled = readBool("setMusicEnabled");
          saveState();
          updateQuickAudioIcon();
          audio.applySettings();
        });
        $("#setSfxEnabled").addEventListener("change", () => {
          s.audio.sfxEnabled = readBool("setSfxEnabled");
          saveState();
          updateQuickAudioIcon();
          audio.applySettings();
        });

        $("#setMusicVol").addEventListener("input", () => {
          s.audio.musicVolume = clampNum($("#setMusicVol").value, 0, 1);
          saveState();
          audio.applySettings();
        });
        $("#setSfxVol").addEventListener("input", () => {
          s.audio.sfxVolume = clampNum($("#setSfxVol").value, 0, 1);
          saveState();
          audio.applySettings();
        });

        $("#setComm").addEventListener("change", () => { s.features.commendations = readBool("setComm"); saveState(); renderGame(); });
        $("#setDisp").addEventListener("change", () => { s.features.dispatches = readBool("setDisp"); saveState(); renderGame(); });
        $("#setCrisis").addEventListener("change", () => { s.features.crisis = readBool("setCrisis"); saveState(); });

        $("#setDispRate").addEventListener("change", () => { s.pacing.dispatchRate = $("#setDispRate").value; saveState(); });
        $("#setCrisisRate").addEventListener("change", () => { s.pacing.crisisRate = $("#setCrisisRate").value; saveState(); });
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

  function openLogModal() {
    if (!state.game) return;
    const g = state.game;

    const rows = g.log.slice(0, 100).map(entry => {
      const time = new Date(entry.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (entry.type === "action") {
        const icon = entry.result === "success" ? "✅" : "❌";
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
      return "";
    }).join("");

    openModal({
      title: "Case Log",
      modalType: "log",
      bodyHtml: `<div class="list">${rows || `<div class="item"><div class="item-text">No activity yet.</div></div>`}</div>`,
      footerButtons: [{ text: "Close", className: "btn primary", onClick: closeModal }]
    });
  }

  function openEndShiftModal() {
    audio.setMode("ending");

    const g = state.game;
    if (!g) return;

    openModal({
      title: "Shift Report",
      modalType: "endShift",
      bodyHtml: `
      <div class="item">
        <div class="item-title">Outcome</div>
        <div class="row">
          <div class="field">
            <div class="label">Result</div>
            <select class="select" id="endOutcome">
              <option value="win">Win</option>
              <option value="loss">Loss</option>
            </select>
          </div>

          <div class="field">
            <div class="label">Reason</div>
            <select class="select" id="endReason"></select>
          </div>
        </div>
      </div>

      <div class="newsprint" id="newsprint">
        <div class="newsprint-paper">THE PRECINCT TIMES</div>
      
        <div class="newsprint-masthead" id="npMasthead"></div>
        <div class="newsprint-dateline" id="npDateline"></div>
        <div class="newsprint-ads" id="npAds"></div>
        <div class="newsprint-classifieds" id="npClassifieds"></div>
        <div class="newsprint-headline" id="npHeadline"></div>
        <div class="newsprint-subhead" id="npSubhead"></div>
        <div class="newsprint-body" id="npBody"></div>
      </div>
    `,
      footerButtons: [
        { text: "Copy Article", className: "btn", onClick: () => copyToClipboard(buildArticleText()) },
        { text: "Save as Image", className: "btn", onClick: () => saveNewsprintAsImage() },
        {
          text: "End & Return Home",
          className: "btn warn",
          onClick: () => {
            const outcome = $("#endOutcome").value;
            const reason = $("#endReason").value;
            endGame(outcome, reason);
            closeModal();
            audio.setMode("none");
            location.hash = "#/home";
          }
        }
      ],
      onOpen: () => {
        const outcomeEl = $("#endOutcome");
        const reasonEl = $("#endReason");

        const setReasonOptions = () => {
          const isWin = outcomeEl.value === "win";
          const opts = isWin ? [
            { v: "caught_before_appeared", t: "Caught murderer before he appeared" },
            { v: "caught_after_appeared", t: "Caught murderer after he appeared" }
          ] : [
            { v: "crime_track_max", t: "Crime track reached the end" },
            { v: "calendar_ran_out", t: "Calendar ran out" },
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

        const render = () => renderNewspaperArticle(outcomeEl.value, reasonEl.value);

        outcomeEl.addEventListener("change", () => { setReasonOptions(); render(); });
        reasonEl.addEventListener("change", render);

        setReasonOptions();
        render();
      }
    });

    function buildArticleText() {
      const outcome = $("#endOutcome").value;
      const reason = $("#endReason").value;
      const article = buildNewspaperArticle(outcome, reason);
      return `${article.headline}\n\n${article.subhead}\n\n${article.body.join("\n\n")}`;
    }
  }

  function openDispatchModal(dispatch, fromStrip=false) {
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
      const res = await fetch(url, { cache: "no-store" });
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

    const [ads, classifieds, dispatches, commendations, crises] = await Promise.all([
      loadJson("./assets/data/ads.json", empty),
      loadJson("./assets/data/classifieds.json", empty),
      loadJson("./assets/data/dispatches.json", empty),
      loadJson("./assets/data/commendations.json", empty),
      loadJson("./assets/data/crises.json", empty)
    ]);

    CONTENT.ads = ads.items || [];
    CONTENT.classifieds = classifieds.items || [];
    CONTENT.dispatches = dispatches.items || [];
    CONTENT.commendations = commendations.items || [];
    CONTENT.crises = crises.items || [];

    // Optional: quick sanity log
    console.log("Content loaded:", {
      ads: CONTENT.ads.length,
      classifieds: CONTENT.classifieds.length,
      dispatches: CONTENT.dispatches.length,
      commendations: CONTENT.commendations.length,
      crises: CONTENT.crises.length
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

    const items = g?.selectedClassifieds || [];
    if (!items.length) {
      host.innerHTML = "";
      return;
    }

    host.innerHTML = `
    <div class="classifieds-title">Classifieds</div>
    <div class="classifieds-grid">
      ${items.map(x => `
        <div class="classified"><b>${escapeHtml(x.head)}</b> — ${escapeHtml(x.text)}</div>
      `).join("")}
    </div>
  `;
  }

  function pickClassifiedsForReport() {
    const g = state.game;
    if (!g) return [];

    const ctx = getReportContext();

    const focus = getGameFocusProfile(g);
    const count = randInt(3, 6);

    const weighted = CONTENT.classifieds.map(c => {
      let w = 1;
      const tags = c.tags || [];
      if (tags.includes(focus.primary)) w += 2.5;
      if (tags.includes(focus.secondary)) w += 1.2;
      if (tags.includes("night") && focus.intensity > 0.35) w += 0.7;
      if (tags.includes("calm") && focus.intensity < 0.25) w += 0.6;
      return { item: c, weight: Math.max(0.2, w) };
    });

    const picked = [];
    const used = new Set();
    while (picked.length < count) {
      const c = weightedPick(weighted);
      if (!c) break;
      if (used.has(c.id)) continue;
      used.add(c.id);
      picked.push({
        id: c.id,
        head: c.head || c.label || "NOTICE",
        text: applyTemplate(c.textTpl || c.text || "", ctx),
        tags: c.tags || []
      });
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

  function buildWeightedAdPool(focus) {
    // Base weight for all ads, then boost by category tags
    // Add tags to ads in the AD_POOL (shown below)
    const out = [];

    for (const ad of CONTENT.ads) {
      let w = 1;

      const tags = ad.tags || [];

      // Primary category matters more than secondary
      if (tags.includes(focus.primary)) w += 3;
      if (tags.includes(focus.secondary)) w += 1.5;

      // “City vibe” tags — you can use these later
      if (tags.includes("night") && focus.intensity > 0.4) w += 0.8;
      if (tags.includes("calm") && focus.intensity < 0.25) w += 0.6;

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

    const ads = g?.selectedAds || [];
    if (!ads.length) {
      host.innerHTML = "";
      return;
    }

    host.innerHTML = ads.map((ad, idx) => {
      const sizeClass = ads.length === 2 && idx === 1 ? "small" : "";
      if (ad.type === "image") {
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
      return `
      <div class="news-ad ${sizeClass}">
        <div class="ad-title">${escapeHtml(ad.title)}</div>
        <div class="ad-body">${escapeHtml(ad.body)}</div>
        ${ad.fine ? `<div class="ad-fine">${escapeHtml(ad.fine)}</div>` : ""}
      </div>
    `;
    }).join("");
  }

  function pickAdsForReport() {
    const g = state.game;
    if (!g) return [];

    const count = Math.random() < 0.55 ? 1 : 2;

    const focus = getGameFocusProfile(g); // {primary, secondary, intensity}
    const weighted = buildWeightedAdPool(focus);

    // Pick unique ads by weighted draw
    const picked = [];
    const used = new Set();
    while (picked.length < count && weighted.length) {
      const ad = weightedPick(weighted);
      if (!ad) break;
      if (used.has(ad.id)) continue;
      used.add(ad.id);
      picked.push(ad);
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
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.drawImage(img, 0, 0);

      const pngUrl = canvas.toDataURL("image/png");
      downloadDataUrl(pngUrl, makeNewsFilename());
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


  function renderNewspaperArticle(outcome, reason) {
    const a = buildNewspaperArticle(outcome, reason);

    $("#npMasthead").textContent = a.masthead;
    $("#npDateline").textContent = a.dateline;

    renderNewsAds();
    renderClassifieds();

    $("#npHeadline").textContent = a.headline;
    $("#npSubhead").textContent = a.subhead;
    $("#npBody").innerHTML = a.body.map(p => `<p>${escapeHtml(p)}</p>`).join("");
  }


  function buildNewspaperArticle(outcome, reason) {
    const g = state.game;

    const overall = getOverallRate();
    const inv = getSuccessRate("investigation");
    const arr = getSuccessRate("arrest");
    const eme = getSuccessRate("emergency");

    const cats = [
      { k:"investigation", r:inv, total: g.categories.investigation.success + g.categories.investigation.fail },
      { k:"arrest", r:arr, total: g.categories.arrest.success + g.categories.arrest.fail },
      { k:"emergency", r:eme, total: g.categories.emergency.success + g.categories.emergency.fail }
    ];

    const best = [...cats].sort((a,b)=>b.r-a.r)[0];
    const worst = [...cats].sort((a,b)=>a.r-b.r)[0];

    const actions = getOverallActions();
    const commTotal = g.commendations.investigation + g.commendations.arrest + g.commendations.emergency;
    const dispatchCount = g.log.filter(x => x.type === "dispatch").length;
    const crisisCount = g.log.filter(x => x.type === "crisis" && x.status === "started").length;

    const reasonText = outcome === "win"
        ? (reason === "caught_before_appeared" ? "before the suspect could fully surface" : "after the suspect emerged and the pressure spiked")
        : (reason === "crime_track_max" ? "as crime overflowed the city’s limits"
            : reason === "calendar_ran_out" ? "as the calendar ran out on the task force"
                : "after the trail went cold and the suspect slipped away");

    const headline = outcome === "win"
        ? "CASE CLOSED: CITY BREATHES AGAIN"
        : "CASE GOES COLD: CITY LEFT ON EDGE";

    const subhead = `${g.players}-unit shift logs ${actions} field actions with ${fmtPct(overall)} overall success — ${reasonText}.`;

    const p1 =
        `A coordinated ${g.players}-unit detail worked the streets through a tense shift, balancing leads, arrests, and emergencies as the city’s pressure mounted. ` +
        `By shift’s end, the unit posted ${fmtPct(overall)} overall success across all actions, with ${fmtPct(best.r)} performance in ${cap(best.k)} standing out as the day’s strongest pillar.`;

    const p2 =
        `Not every channel held steady. ${cap(worst.k)} proved the roughest stretch, landing at ${fmtPct(worst.r)} and forcing the unit to compensate in the field. ` +
        `Commendations were issued ${commTotal} time(s), reflecting moments of sharp execution under pressure.`;

    const p3 =
        `Dispatch traffic remained active (${dispatchCount} advisories) and the city tested the squad with ${crisisCount} major incident(s). ` +
        `Veteran observers noted that the unit’s rhythm — particularly in ${cap(best.k)} — likely shaped the final outcome more than any single roll of fate.`;

    const masthead = "POLICE PRECINCT — SHIFT REPORT";

    const dateline = `${formatLongDate(new Date())} • Precinct Desk • Case File ${g.caseFile || "PP-????"}`;

    return { masthead, dateline, headline, subhead, body: [p1, p2, p3] };
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
