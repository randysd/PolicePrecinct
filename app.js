/* Police Precinct Dispatcher - Plain JS PWA App */

// ===== VERSION (bump this each deploy) =====
const APP_VERSION = "2026.01.24.1";

// ===== Helpers =====
const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// ===== Settings persistence =====
const STORAGE_KEY = "pp_dispatcher_settings_v1";

const DEFAULTS = {
  volMaster: 0.9,
  volMusic: 0.35,
  volSfx: 0.7,
  minIntervalSec: 12,
  maxIntervalSec: 35,
  enabled: {
    city: true,
    radio: true,
    beep: true,
    traffic: true,
    siren: false
  }
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);

    // Merge defaults so you can add fields later without breaking existing users
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      enabled: { ...structuredClone(DEFAULTS.enabled), ...(parsed.enabled || {}) }
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// ===== Audio paths =====
// Ensure these paths match your repo exactly (case-sensitive)
const AUDIO = {
  music_main: "assets/audio/music_main.mp3",
  music_crisis: "assets/audio/music_crisis.mp3",
  dispatch: "assets/audio/sfx_dispatch.mp3",
  crisis: "assets/audio/sfx_crisis.mp3",
  city: "assets/audio/sfx_city.mp3",
  radio: "assets/audio/sfx_radio.mp3",
  beep: "assets/audio/sfx_beep.mp3",
  traffic: "assets/audio/sfx_traffic.mp3",
  siren: "assets/audio/sfx_siren.mp3"
};

let settings = loadSettings();
let running = false;
let crisisMode = false;

let sfxTimer = null;
let nextSfxAt = null;

// ===== Music players =====
const music = {
  current: null,
  main: new Audio(AUDIO.music_main),
  crisis: new Audio(AUDIO.music_crisis)
};
music.main.loop = true;
music.crisis.loop = true;

function setMusicVolume() {
  const v = clamp01(settings.volMaster * settings.volMusic);
  music.main.volume = v;
  music.crisis.volume = v;
}

function startMusic(isCrisis) {
  setMusicVolume();
  const target = isCrisis ? music.crisis : music.main;
  const other = isCrisis ? music.main : music.crisis;

  if (!other.paused) {
    other.pause();
    other.currentTime = 0;
  }

  target.currentTime = 0;
  target.play().catch(() => {
    // Mobile autoplay restrictions are normal until the user taps Start Shift
  });
  music.current = target;
}

function stopAllAudio() {
  [music.main, music.crisis].forEach((m) => {
    m.pause();
    m.currentTime = 0;
  });
  music.current = null;
}

// one-shot SFX helper
function playSfx(src, gain = 1) {
  const a = new Audio(src);
  a.volume = clamp01(settings.volMaster * settings.volSfx * gain);
  a.play().catch(() => {
    // Ignored if the user hasn't interacted yet
  });
}

// ===== Random background SFX scheduler =====
function updateNextLabel() {
  const el = $("txtNext");
  if (!el) return;

  if (!running || !nextSfxAt) {
    el.textContent = "Next random SFX: —";
    return;
  }
  const sec = Math.max(0, Math.round((nextSfxAt - Date.now()) / 1000));
  el.textContent = `Next random SFX: in ~${sec}s`;
}

setInterval(updateNextLabel, 500);

function scheduleRandomSfx() {
  clearTimeout(sfxTimer);
  if (!running) return;

  const enabledKeys = Object.entries(settings.enabled)
    .filter(([, on]) => on)
    .map(([k]) => k);

  if (enabledKeys.length === 0) {
    nextSfxAt = null;
    updateNextLabel();
    return;
  }

  const minMs = Math.max(0, (Number(settings.minIntervalSec) || 0) * 1000);
  const maxMs = Math.max(minMs, (Number(settings.maxIntervalSec) || 0) * 1000);

  const delay = randInt(minMs, maxMs);
  nextSfxAt = Date.now() + delay;
  updateNextLabel();

  sfxTimer = setTimeout(() => {
    const key = enabledKeys[randInt(0, enabledKeys.length - 1)];
    const gain = key === "siren" ? 0.7 : 1.0;
    playSfx(AUDIO[key], gain);
    scheduleRandomSfx();
  }, delay);
}

// ===== UI State =====
function setRunning(on) {
  running = on;

  const btnStart = $("btnStart");
  const btnStop = $("btnStop");
  if (btnStart) btnStart.disabled = on;
  if (btnStop) btnStop.disabled = !on;

  const dot = $("dotRunning");
  if (dot) dot.classList.toggle("on", on);

  const txt = $("txtRunning");
  if (txt) txt.textContent = on ? (crisisMode ? "Running (CRISIS)" : "Running") : "Stopped";

  if (!on) {
    clearTimeout(sfxTimer);
    sfxTimer = null;
    nextSfxAt = null;
    stopAllAudio();
    updateNextLabel();
  } else {
    // Must be triggered by a user gesture (Start Shift button) on mobile
    startMusic(crisisMode);
    scheduleRandomSfx();
  }
}

function toggleCrisis() {
  crisisMode = !crisisMode;
  playSfx(AUDIO.crisis, 1.0);

  if (running) startMusic(crisisMode);

  const txt = $("txtRunning");
  if (txt) txt.textContent = running ? (crisisMode ? "Running (CRISIS)" : "Running") : "Stopped";
}

function fireDispatch() {
  playSfx(AUDIO.dispatch, 1.0);
}

// ===== Settings Panel =====
function bindSettingsToUI() {
  if ($("volMaster")) $("volMaster").value = settings.volMaster;
  if ($("volMusic")) $("volMusic").value = settings.volMusic;
  if ($("volSfx")) $("volSfx").value = settings.volSfx;

  if ($("minInterval")) $("minInterval").value = settings.minIntervalSec;
  if ($("maxInterval")) $("maxInterval").value = settings.maxIntervalSec;

  if ($("sfx_city")) $("sfx_city").checked = !!settings.enabled.city;
  if ($("sfx_radio")) $("sfx_radio").checked = !!settings.enabled.radio;
  if ($("sfx_beep")) $("sfx_beep").checked = !!settings.enabled.beep;
  if ($("sfx_traffic")) $("sfx_traffic").checked = !!settings.enabled.traffic;
  if ($("sfx_siren")) $("sfx_siren").checked = !!settings.enabled.siren;
}

function readSettingsFromUI() {
  const minI = Number($("minInterval")?.value);
  const maxI = Number($("maxInterval")?.value);

  settings = {
    volMaster: Number($("volMaster")?.value ?? DEFAULTS.volMaster),
    volMusic: Number($("volMusic")?.value ?? DEFAULTS.volMusic),
    volSfx: Number($("volSfx")?.value ?? DEFAULTS.volSfx),
    minIntervalSec: Number.isFinite(minI) ? minI : DEFAULTS.minIntervalSec,
    maxIntervalSec: Number.isFinite(maxI) ? maxI : DEFAULTS.maxIntervalSec,
    enabled: {
      city: !!$("sfx_city")?.checked,
      radio: !!$("sfx_radio")?.checked,
      beep: !!$("sfx_beep")?.checked,
      traffic: !!$("sfx_traffic")?.checked,
      siren: !!$("sfx_siren")?.checked
    }
  };

  if (settings.maxIntervalSec < settings.minIntervalSec) {
    settings.maxIntervalSec = settings.minIntervalSec;
  }
}

function resetDefaults() {
  settings = structuredClone(DEFAULTS);
  saveSettings(settings);
  bindSettingsToUI();
  setMusicVolume();
  if (running) scheduleRandomSfx();
}

function toggleSettingsPanel() {
  const panel = $("settingsPanel");
  const btn = $("btnSettings");
  if (!panel) return;

  const isHidden = panel.hasAttribute("hidden");
  if (isHidden) {
    panel.removeAttribute("hidden");
    btn?.setAttribute("aria-expanded", "true");
  } else {
    panel.setAttribute("hidden", "");
    btn?.setAttribute("aria-expanded", "false");
  }
}

// ===== Update banner (Service Worker update flow) =====
let swReg = null;

function showUpdateBanner() {
  const banner = $("updateBanner");
  if (!banner) return;

  banner.hidden = false;

  const btn = $("btnUpdateReload");
  if (btn) {
    btn.onclick = async () => {
      // Tell waiting SW to activate now
      if (swReg && swReg.waiting) {
        swReg.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      // Fallback
      window.location.reload();
    };
  }
}

// ===== Wire up events =====
window.addEventListener("DOMContentLoaded", () => {
  // Version stamp
  const v = $("appVersion");
  if (v) v.textContent = APP_VERSION;

  // Initial UI
  bindSettingsToUI();
  setMusicVolume();
  setRunning(false);

  // Buttons
  $("btnStart")?.addEventListener("click", () => setRunning(true));
  $("btnStop")?.addEventListener("click", () => setRunning(false));
  $("btnDispatch")?.addEventListener("click", fireDispatch);
  $("btnCrisis")?.addEventListener("click", toggleCrisis);
  $("btnSettings")?.addEventListener("click", toggleSettingsPanel);

  $("btnSave")?.addEventListener("click", () => {
    readSettingsFromUI();
    saveSettings(settings);
    setMusicVolume();
    if (running) scheduleRandomSfx();
  });

  $("btnReset")?.addEventListener("click", resetDefaults);

  // Live slider preview for volumes
  ["volMaster", "volMusic", "volSfx"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      readSettingsFromUI();
      setMusicVolume();
    });
  });
});

// ===== PWA service worker registration + update detection =====
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      swReg = await navigator.serviceWorker.register("sw.js");

      // If a waiting SW already exists (rare), show banner
      if (swReg.waiting) showUpdateBanner();

      swReg.addEventListener("updatefound", () => {
        const newWorker = swReg.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          // Installed and there's an active controller => update ready (waiting)
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });

      // When the new SW takes control, reload to ensure new assets are used
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
      });
    } catch (e) {
      console.warn("Service worker registration failed", e);
    }
  });
}
