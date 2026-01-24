/* Police Precinct Companion - Plain JS PWA starter */

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "pp_companion_settings_v1";

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

// --- Audio paths ---
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

// Use HTMLAudioElement for simplicity (fine for a companion app)
const music = {
  current: null,
  main: new Audio(AUDIO.music_main),
  crisis: new Audio(AUDIO.music_crisis)
};

music.main.loop = true;
music.crisis.loop = true;

// one-shot sfx helper
function playSfx(src, gain = 1) {
  const a = new Audio(src);
  a.volume = clamp01(settings.volMaster * settings.volSfx * gain);
  a.play().catch(() => {
    // Autoplay restrictions: ignored if user hasn't tapped start yet
  });
}

function setMusicVolume() {
  const v = clamp01(settings.volMaster * settings.volMusic);
  music.main.volume = v;
  music.crisis.volume = v;
}

function startMusic(isCrisis) {
  setMusicVolume();
  const target = isCrisis ? music.crisis : music.main;
  const other = isCrisis ? music.main : music.crisis;

  // stop other track
  if (!other.paused) {
    other.pause();
    other.currentTime = 0;
  }

  // start target
  target.currentTime = 0;
  target.play().catch(() => {});
  music.current = target;
}

function stopAllAudio() {
  [music.main, music.crisis].forEach(m => {
    m.pause();
    m.currentTime = 0;
  });
  music.current = null;
}

function scheduleRandomSfx() {
  clearTimeout(sfxTimer);
  if (!running) return;

  const enabledKeys = Object.entries(settings.enabled)
    .filter(([, on]) => on)
    .map(([k]) => k);

  if (enabledKeys.length === 0) {
    $("txtNext").textContent = "Next random SFX: (none enabled)";
    return;
  }

  const minMs = Math.max(0, (Number(settings.minIntervalSec) || 0) * 1000);
  const maxMs = Math.max(minMs, (Number(settings.maxIntervalSec) || 0) * 1000);

  const delay = randInt(minMs, maxMs);
  nextSfxAt = Date.now() + delay;

  updateNextLabel();

  sfxTimer = setTimeout(() => {
    const key = enabledKeys[randInt(0, enabledKeys.length - 1)];
    // Slight variance in gain; siren a bit quieter by default
    const gain = (key === "siren") ? 0.7 : 1.0;
    playSfx(AUDIO[key], gain);

    // Re-schedule
    scheduleRandomSfx();
  }, delay);
}

function updateNextLabel() {
  if (!running || !nextSfxAt) {
    $("txtNext").textContent = "Next random SFX: —";
    return;
  }
  const sec = Math.max(0, Math.round((nextSfxAt - Date.now()) / 1000));
  $("txtNext").textContent = `Next random SFX: in ~${sec}s`;
}

setInterval(updateNextLabel, 500);

// --- UI actions ---
function setRunning(on) {
  running = on;
  $("btnStart").disabled = on;
  $("btnStop").disabled = !on;

  $("dotRunning").classList.toggle("on", on);
  $("txtRunning").textContent = on ? (crisisMode ? "Running (CRISIS)" : "Running") : "Stopped";

  if (!on) {
    clearTimeout(sfxTimer);
    sfxTimer = null;
    nextSfxAt = null;
    stopAllAudio();
    updateNextLabel();
  } else {
    // audio begins on explicit user action
    startMusic(crisisMode);
    scheduleRandomSfx();
  }
}

function toggleCrisis() {
  crisisMode = !crisisMode;
  playSfx(AUDIO.crisis, 1.0);
  if (running) startMusic(crisisMode);
  $("txtRunning").textContent = running ? (crisisMode ? "Running (CRISIS)" : "Running") : "Stopped";
}

function fireDispatch() {
  playSfx(AUDIO.dispatch, 1.0);
  // you can also show a UI toast/notification here later
}

// --- Settings UI ---
function bindSettingsToUI() {
  $("volMaster").value = settings.volMaster;
  $("volMusic").value = settings.volMusic;
  $("volSfx").value = settings.volSfx;

  $("minInterval").value = settings.minIntervalSec;
  $("maxInterval").value = settings.maxIntervalSec;

  $("sfx_city").checked = !!settings.enabled.city;
  $("sfx_radio").checked = !!settings.enabled.radio;
  $("sfx_beep").checked = !!settings.enabled.beep;
  $("sfx_traffic").checked = !!settings.enabled.traffic;
  $("sfx_siren").checked = !!settings.enabled.siren;
}

function readSettingsFromUI() {
  const minI = Number($("minInterval").value);
  const maxI = Number($("maxInterval").value);

  settings = {
    volMaster: Number($("volMaster").value),
    volMusic: Number($("volMusic").value),
    volSfx: Number($("volSfx").value),
    minIntervalSec: Number.isFinite(minI) ? minI : DEFAULTS.minIntervalSec,
    maxIntervalSec: Number.isFinite(maxI) ? maxI : DEFAULTS.maxIntervalSec,
    enabled: {
      city: $("sfx_city").checked,
      radio: $("sfx_radio").checked,
      beep: $("sfx_beep").checked,
      traffic: $("sfx_traffic").checked,
      siren: $("sfx_siren").checked
    }
  };

  // enforce sane min/max
  if (settings.maxIntervalSec < settings.minIntervalSec) {
    settings.maxIntervalSec = settings.minIntervalSec;
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);

    // merge defaults to handle new fields later
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      enabled: { ...structuredClone(DEFAULTS.enabled), ...(parsed.enabled || {}) }
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function resetDefaults() {
  settings = structuredClone(DEFAULTS);
  saveSettings();
  bindSettingsToUI();
  if (running) {
    setMusicVolume();
    scheduleRandomSfx();
  }
}

// --- panel toggling ---
function toggleSettingsPanel() {
  const panel = $("settingsPanel");
  const btn = $("btnSettings");
  const isHidden = panel.hasAttribute("hidden");
  if (isHidden) {
    panel.removeAttribute("hidden");
    btn.setAttribute("aria-expanded", "true");
  } else {
    panel.setAttribute("hidden", "");
    btn.setAttribute("aria-expanded", "false");
  }
}

// --- helpers ---
function randInt(min, max) {
  // inclusive
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// --- event wiring ---
window.addEventListener("DOMContentLoaded", () => {
  bindSettingsToUI();
  setMusicVolume();

  $("btnStart").addEventListener("click", () => setRunning(true));
  $("btnStop").addEventListener("click", () => setRunning(false));

  $("btnDispatch").addEventListener("click", fireDispatch);
  $("btnCrisis").addEventListener("click", toggleCrisis);

  $("btnSettings").addEventListener("click", toggleSettingsPanel);

  $("btnSave").addEventListener("click", () => {
    readSettingsFromUI();
    saveSettings();
    setMusicVolume();
    if (running) scheduleRandomSfx();
  });

  $("btnReset").addEventListener("click", resetDefaults);

  // live volume preview as you drag sliders
  ["volMaster","volMusic"].forEach(id => {
    $(id).addEventListener("input", () => {
      readSettingsFromUI();
      setMusicVolume();
    });
  });
});

// --- PWA service worker registration ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
