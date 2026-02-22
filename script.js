const PHASES = {
  FOCUS: "focus",
  SHORT_BREAK: "short_break",
  LONG_BREAK: "long_break",
};

const PHASE_LABELS = {
  [PHASES.FOCUS]: "Focus",
  [PHASES.SHORT_BREAK]: "Short Break",
  [PHASES.LONG_BREAK]: "Long Break",
};

const FULL_PROGRESS_PERCENT = 100;
const NORMAL_SPEED_MULTIPLIER = 1;
const DEFAULT_BLOCKED_SITES = [
  "facebook.com",
  "twitter.com",
  "instagram.com",
  "youtube.com",
  "example.com",
];
const DEFAULT_SETTINGS = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 4,
  autoBlockFocusEnabled: true,
};

const STORAGE_KEYS = {
  BLOCKING_ENABLED: "blockingEnabled",
  BLOCKED_SITES: "blockedSites",
  AUTO_BLOCK_FOCUS_ENABLED: "autoBlockFocusEnabled",
  FOCUS_MINUTES: "pomodoroFocusMinutes",
  SHORT_BREAK_MINUTES: "pomodoroShortBreakMinutes",
  LONG_BREAK_MINUTES: "pomodoroLongBreakMinutes",
  SESSIONS_BEFORE_LONG_BREAK: "pomodoroSessionsBeforeLongBreak",
  IS_RUNNING: "pomodoroIsRunning",
  END_TIMESTAMP_MS: "pomodoroEndTimestampMs",
  REMAINING_SECONDS: "pomodoroRemainingSeconds",
  ACTIVE_SPEED_MULTIPLIER: "pomodoroActiveSpeedMultiplier",
  CURRENT_PHASE: "pomodoroCurrentPhase",
  COMPLETED_FOCUS_COUNT: "pomodoroCompletedFocusCount",
};

const countdownEl = document.getElementById("countdown");
const phaseEl = document.getElementById("phase");
const toggleButton = document.querySelector(".togglebutton");
const restartButton = document.getElementById("restartButton");
const progressEl = document.querySelector(".progress-stuff");
const blockedSitesInput = document.getElementById("blockedSitesInput");
const saveBlockedSitesButton = document.getElementById("saveBlockedSites");
const resetBlockedSitesButton = document.getElementById("resetBlockedSites");
const toggleAutoBlockFocus = document.getElementById("toggleAutoBlockFocus");
const focusMinutesInput = document.getElementById("focusMinutesInput");
const shortBreakMinutesInput = document.getElementById("shortBreakMinutesInput");
const longBreakMinutesInput = document.getElementById("longBreakMinutesInput");
const sessionsBeforeLongBreakInput = document.getElementById("sessionsBeforeLongBreakInput");
const savePomodoroSettingsButton = document.getElementById("savePomodoroSettings");

const timerState = {
  isRunning: false,
  remainingSeconds: DEFAULT_SETTINGS.focusMinutes * 60,
  endTimestampMs: null,
  intervalId: null,
  autoBlockFocusEnabled: DEFAULT_SETTINGS.autoBlockFocusEnabled,
  activeSpeedMultiplier: NORMAL_SPEED_MULTIPLIER,
  currentPhase: PHASES.FOCUS,
  completedFocusCount: 0,
  settings: {
    focusMinutes: DEFAULT_SETTINGS.focusMinutes,
    shortBreakMinutes: DEFAULT_SETTINGS.shortBreakMinutes,
    longBreakMinutes: DEFAULT_SETTINGS.longBreakMinutes,
    sessionsBeforeLongBreak: DEFAULT_SETTINGS.sessionsBeforeLongBreak,
  },
};

function formatSeconds(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getBadgeTextFromSeconds(remainingSeconds) {
  if (remainingSeconds <= 0) {
    return "";
  }

  if (remainingSeconds < 60) {
    return `${remainingSeconds}s`;
  }

  const minutesLeft = Math.ceil(remainingSeconds / 60);
  return minutesLeft > 99 ? "99+" : `${minutesLeft}m`;
}

function getBadgeColorsForPhase(phase) {
  if (phase === PHASES.FOCUS) {
    return { background: "#07172b", text: "#ffffff" };
  }

  return { background: "#e8eef9", text: "#07172b" };
}

function updateActionBadge() {
  if (!chrome.action) {
    return;
  }

  if (!timerState.isRunning || timerState.remainingSeconds <= 0) {
    void chrome.action.setBadgeText({ text: "" });
    return;
  }

  const badgeColors = getBadgeColorsForPhase(timerState.currentPhase);
  void chrome.action.setBadgeBackgroundColor({ color: badgeColors.background });
  if (typeof chrome.action.setBadgeTextColor === "function") {
    void chrome.action.setBadgeTextColor({ color: badgeColors.text });
  }
  void chrome.action.setBadgeText({ text: getBadgeTextFromSeconds(timerState.remainingSeconds) });
}

function normalizeBlockedSites(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return [...new Set(entries
    .map((entry) => String(entry).trim().toLowerCase())
    .filter(Boolean))];
}

function parseBlockedSitesText(rawText) {
  return normalizeBlockedSites(rawText.split(/\r?\n/));
}

function blockedSitesToText(sites) {
  return sites.join("\n");
}

function computeRemainingSeconds(endTimestampMs, speedMultiplier) {
  const realSecondsLeft = Math.max(0, (endTimestampMs - Date.now()) / 1000);
  return Math.max(0, Math.ceil(realSecondsLeft * speedMultiplier));
}

function getNextSessionSpeedMultiplier() {
  return NORMAL_SPEED_MULTIPLIER;
}

function getPhaseDurationSeconds(phase) {
  if (phase === PHASES.SHORT_BREAK) {
    return timerState.settings.shortBreakMinutes * 60;
  }

  if (phase === PHASES.LONG_BREAK) {
    return timerState.settings.longBreakMinutes * 60;
  }

  return timerState.settings.focusMinutes * 60;
}

function getNextPhase() {
  if (timerState.currentPhase === PHASES.FOCUS) {
    const needsLongBreak = timerState.completedFocusCount > 0
      && timerState.completedFocusCount % timerState.settings.sessionsBeforeLongBreak === 0;
    return needsLongBreak ? PHASES.LONG_BREAK : PHASES.SHORT_BREAK;
  }

  return PHASES.FOCUS;
}

function getValidatedInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.floor(parsed));
}

function updatePomodoroSettingsInputs() {
  focusMinutesInput.value = String(timerState.settings.focusMinutes);
  shortBreakMinutesInput.value = String(timerState.settings.shortBreakMinutes);
  longBreakMinutesInput.value = String(timerState.settings.longBreakMinutes);
  sessionsBeforeLongBreakInput.value = String(timerState.settings.sessionsBeforeLongBreak);
}

async function syncBlockingWithTimerState() {
  const shouldEnableBlocking = timerState.autoBlockFocusEnabled
    && timerState.isRunning
    && timerState.currentPhase === PHASES.FOCUS;

  await chrome.storage.local.set({ [STORAGE_KEYS.BLOCKING_ENABLED]: shouldEnableBlocking });
}

function updateUi() {
  countdownEl.textContent = formatSeconds(timerState.remainingSeconds);
  phaseEl.textContent = PHASE_LABELS[timerState.currentPhase] || PHASE_LABELS[PHASES.FOCUS];
  toggleButton.textContent = timerState.isRunning ? "Pause" : "Start";

  const totalPhaseSeconds = Math.max(1, getPhaseDurationSeconds(timerState.currentPhase));
  const elapsedRatio = 1 - (timerState.remainingSeconds / totalPhaseSeconds);
  const percent = FULL_PROGRESS_PERCENT + elapsedRatio * FULL_PROGRESS_PERCENT;
  progressEl.style.setProperty("--percent", String(Math.max(100, Math.min(200, percent))));

  restartButton.textContent = timerState.isRunning ? "Restart" : "Restart";
  updateActionBadge();
}

function clearTickInterval() {
  if (timerState.intervalId !== null) {
    clearInterval(timerState.intervalId);
    timerState.intervalId = null;
  }
}

async function persistTimerState() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.IS_RUNNING]: timerState.isRunning,
    [STORAGE_KEYS.END_TIMESTAMP_MS]: timerState.endTimestampMs,
    [STORAGE_KEYS.REMAINING_SECONDS]: timerState.remainingSeconds,
    [STORAGE_KEYS.ACTIVE_SPEED_MULTIPLIER]: timerState.activeSpeedMultiplier,
    [STORAGE_KEYS.CURRENT_PHASE]: timerState.currentPhase,
    [STORAGE_KEYS.COMPLETED_FOCUS_COUNT]: timerState.completedFocusCount,
  });
}

async function persistPomodoroSettings() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.FOCUS_MINUTES]: timerState.settings.focusMinutes,
    [STORAGE_KEYS.SHORT_BREAK_MINUTES]: timerState.settings.shortBreakMinutes,
    [STORAGE_KEYS.LONG_BREAK_MINUTES]: timerState.settings.longBreakMinutes,
    [STORAGE_KEYS.SESSIONS_BEFORE_LONG_BREAK]: timerState.settings.sessionsBeforeLongBreak,
  });
}

async function saveBlockedSitesFromInput() {
  const blockedSites = parseBlockedSitesText(blockedSitesInput.value);
  blockedSitesInput.value = blockedSitesToText(blockedSites);
  await chrome.storage.local.set({ [STORAGE_KEYS.BLOCKED_SITES]: blockedSites });
}

async function resetBlockedSitesToDefault() {
  blockedSitesInput.value = blockedSitesToText(DEFAULT_BLOCKED_SITES);
  await chrome.storage.local.set({ [STORAGE_KEYS.BLOCKED_SITES]: DEFAULT_BLOCKED_SITES });
}

async function savePomodoroSettingsFromInputs() {
  timerState.settings.focusMinutes = getValidatedInteger(focusMinutesInput.value, DEFAULT_SETTINGS.focusMinutes);
  timerState.settings.shortBreakMinutes = getValidatedInteger(shortBreakMinutesInput.value, DEFAULT_SETTINGS.shortBreakMinutes);
  timerState.settings.longBreakMinutes = getValidatedInteger(longBreakMinutesInput.value, DEFAULT_SETTINGS.longBreakMinutes);
  timerState.settings.sessionsBeforeLongBreak = getValidatedInteger(
    sessionsBeforeLongBreakInput.value,
    DEFAULT_SETTINGS.sessionsBeforeLongBreak,
  );

  updatePomodoroSettingsInputs();

  if (!timerState.isRunning) {
    timerState.remainingSeconds = Math.min(
      timerState.remainingSeconds,
      getPhaseDurationSeconds(timerState.currentPhase),
    );
    updateUi();
  }

  await persistPomodoroSettings();
  await persistTimerState();
}

function startTicking() {
  clearTickInterval();
  timerState.intervalId = setInterval(() => {
    void tick();
  }, 1000);
}

async function startCurrentPhase() {
  timerState.activeSpeedMultiplier = getNextSessionSpeedMultiplier();
  timerState.isRunning = true;
  timerState.endTimestampMs = Date.now() + (timerState.remainingSeconds * 1000 / timerState.activeSpeedMultiplier);

  await persistTimerState();
  await syncBlockingWithTimerState();
  updateUi();
  void tick();
  startTicking();
}

async function startTimer() {
  if (timerState.remainingSeconds <= 0) {
    timerState.remainingSeconds = getPhaseDurationSeconds(timerState.currentPhase);
  }

  await startCurrentPhase();
}

async function stopTimer() {
  if (!timerState.isRunning || timerState.endTimestampMs === null) {
    return;
  }

  timerState.remainingSeconds = computeRemainingSeconds(
    timerState.endTimestampMs,
    timerState.activeSpeedMultiplier,
  );
  timerState.isRunning = false;
  timerState.endTimestampMs = null;
  timerState.activeSpeedMultiplier = NORMAL_SPEED_MULTIPLIER;
  clearTickInterval();
  await persistTimerState();
  await syncBlockingWithTimerState();
  updateUi();
}

async function restartEntirePomodoro() {
  timerState.currentPhase = PHASES.FOCUS;
  timerState.completedFocusCount = 0;
  timerState.remainingSeconds = getPhaseDurationSeconds(PHASES.FOCUS);
  await startCurrentPhase();
}

async function advanceToNextPhase() {
  if (timerState.currentPhase === PHASES.FOCUS) {
    timerState.completedFocusCount += 1;
  }

  timerState.currentPhase = getNextPhase();
  timerState.remainingSeconds = getPhaseDurationSeconds(timerState.currentPhase);
  await startCurrentPhase();
}

async function tick() {
  if (!timerState.isRunning || timerState.endTimestampMs === null) {
    return;
  }

  const secondsLeft = computeRemainingSeconds(
    timerState.endTimestampMs,
    timerState.activeSpeedMultiplier,
  );
  timerState.remainingSeconds = secondsLeft;
  updateUi();

  if (secondsLeft === 0) {
    clearTickInterval();
    timerState.isRunning = false;
    timerState.endTimestampMs = null;
    timerState.activeSpeedMultiplier = NORMAL_SPEED_MULTIPLIER;
    await persistTimerState();
    await syncBlockingWithTimerState();
    await advanceToNextPhase();
  }
}

async function restoreTimerState() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.IS_RUNNING,
    STORAGE_KEYS.END_TIMESTAMP_MS,
    STORAGE_KEYS.REMAINING_SECONDS,
    STORAGE_KEYS.ACTIVE_SPEED_MULTIPLIER,
    STORAGE_KEYS.BLOCKED_SITES,
    STORAGE_KEYS.AUTO_BLOCK_FOCUS_ENABLED,
    STORAGE_KEYS.FOCUS_MINUTES,
    STORAGE_KEYS.SHORT_BREAK_MINUTES,
    STORAGE_KEYS.LONG_BREAK_MINUTES,
    STORAGE_KEYS.SESSIONS_BEFORE_LONG_BREAK,
    STORAGE_KEYS.CURRENT_PHASE,
    STORAGE_KEYS.COMPLETED_FOCUS_COUNT,
  ]);

  timerState.settings.focusMinutes = getValidatedInteger(stored[STORAGE_KEYS.FOCUS_MINUTES], DEFAULT_SETTINGS.focusMinutes);
  timerState.settings.shortBreakMinutes = getValidatedInteger(stored[STORAGE_KEYS.SHORT_BREAK_MINUTES], DEFAULT_SETTINGS.shortBreakMinutes);
  timerState.settings.longBreakMinutes = getValidatedInteger(stored[STORAGE_KEYS.LONG_BREAK_MINUTES], DEFAULT_SETTINGS.longBreakMinutes);
  timerState.settings.sessionsBeforeLongBreak = getValidatedInteger(
    stored[STORAGE_KEYS.SESSIONS_BEFORE_LONG_BREAK],
    DEFAULT_SETTINGS.sessionsBeforeLongBreak,
  );

  timerState.currentPhase = Object.values(PHASES).includes(stored[STORAGE_KEYS.CURRENT_PHASE])
    ? stored[STORAGE_KEYS.CURRENT_PHASE]
    : PHASES.FOCUS;

  timerState.completedFocusCount = Math.max(0, Number(stored[STORAGE_KEYS.COMPLETED_FOCUS_COUNT]) || 0);

  const storedRemaining = Number(stored[STORAGE_KEYS.REMAINING_SECONDS]);
  timerState.remainingSeconds = Number.isFinite(storedRemaining)
    ? Math.max(0, Math.min(getPhaseDurationSeconds(timerState.currentPhase), Math.floor(storedRemaining)))
    : getPhaseDurationSeconds(timerState.currentPhase);

  timerState.activeSpeedMultiplier = NORMAL_SPEED_MULTIPLIER;

  timerState.autoBlockFocusEnabled = stored[STORAGE_KEYS.AUTO_BLOCK_FOCUS_ENABLED] !== undefined
    ? Boolean(stored[STORAGE_KEYS.AUTO_BLOCK_FOCUS_ENABLED])
    : DEFAULT_SETTINGS.autoBlockFocusEnabled;
  toggleAutoBlockFocus.checked = timerState.autoBlockFocusEnabled;

  const blockedSites = normalizeBlockedSites(
    Array.isArray(stored[STORAGE_KEYS.BLOCKED_SITES])
      ? stored[STORAGE_KEYS.BLOCKED_SITES]
      : DEFAULT_BLOCKED_SITES,
  );
  blockedSitesInput.value = blockedSitesToText(blockedSites);

  updatePomodoroSettingsInputs();

  timerState.isRunning = Boolean(stored[STORAGE_KEYS.IS_RUNNING]);
  timerState.endTimestampMs = typeof stored[STORAGE_KEYS.END_TIMESTAMP_MS] === "number"
    ? stored[STORAGE_KEYS.END_TIMESTAMP_MS]
    : null;

  if (timerState.isRunning && timerState.endTimestampMs !== null) {
    const secondsLeft = computeRemainingSeconds(
      timerState.endTimestampMs,
      timerState.activeSpeedMultiplier,
    );

    if (secondsLeft === 0) {
      await advanceToNextPhase();
      return;
    }

    timerState.remainingSeconds = secondsLeft;
    await syncBlockingWithTimerState();
    startTicking();
  } else {
    timerState.isRunning = false;
    timerState.endTimestampMs = null;
    timerState.activeSpeedMultiplier = NORMAL_SPEED_MULTIPLIER;
    await syncBlockingWithTimerState();
    await persistTimerState();
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.AUTO_BLOCK_FOCUS_ENABLED]: timerState.autoBlockFocusEnabled,
    [STORAGE_KEYS.FOCUS_MINUTES]: timerState.settings.focusMinutes,
    [STORAGE_KEYS.SHORT_BREAK_MINUTES]: timerState.settings.shortBreakMinutes,
    [STORAGE_KEYS.LONG_BREAK_MINUTES]: timerState.settings.longBreakMinutes,
    [STORAGE_KEYS.SESSIONS_BEFORE_LONG_BREAK]: timerState.settings.sessionsBeforeLongBreak,
    [STORAGE_KEYS.CURRENT_PHASE]: timerState.currentPhase,
    [STORAGE_KEYS.COMPLETED_FOCUS_COUNT]: timerState.completedFocusCount,
  });

  updateUi();
}

function initSettingsControls() {
  saveBlockedSitesButton.addEventListener("click", () => {
    void saveBlockedSitesFromInput();
  });

  resetBlockedSitesButton.addEventListener("click", () => {
    void resetBlockedSitesToDefault();
  });

  savePomodoroSettingsButton.addEventListener("click", () => {
    void savePomodoroSettingsFromInputs();
  });

  toggleAutoBlockFocus.addEventListener("change", () => {
    timerState.autoBlockFocusEnabled = toggleAutoBlockFocus.checked;
    void chrome.storage.local.set({
      [STORAGE_KEYS.AUTO_BLOCK_FOCUS_ENABLED]: timerState.autoBlockFocusEnabled,
    });
    void syncBlockingWithTimerState();
  });
}

function initPomodoroControls() {
  toggleButton.addEventListener("click", () => {
    if (timerState.isRunning) {
      void stopTimer();
    } else {
      void startTimer();
    }
  });

  restartButton.addEventListener("click", () => {
    void restartEntirePomodoro();
  });
}

function init() {
  initSettingsControls();
  initPomodoroControls();
  void restoreTimerState();
}

init();
