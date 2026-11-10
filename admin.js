// Broadgate Pub Golf — authenticated referee controls.
// Scores are ONE combined total per team per hole.
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  ref,
  get,
  set,
  update,
  push,
  onValue
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";
import {
  app,
  database,
  TEAMS,
  HOLES,
  TOTAL_HOLES,
  DEFAULT_SETTINGS,
  readTeamScore
} from "./config.js?v=1";

// Firebase database rules provide the actual protection.
// This UID check also stops other signed-in accounts seeing ref controls.
const REF_UID = "gRcDNNx5uVeDNuy0gBzumMBgCJr1";
const auth = getAuth(app);
const teamsRef = ref(database, "teams");
const settingsRef = ref(database, "settings");
const historyRef = ref(database, "history");
const undoRef = ref(database, "undo/lastAction");
const rootRef = ref(database);

const $ = (id) => document.getElementById(id);
const ui = {
  loginView: $("ref-login-view"),
  loginForm: $("ref-login-form"),
  loginSubmit: $("ref-login-submit"),
  loginError: $("ref-login-error"),
  email: $("ref-email"),
  password: $("ref-password"),
  app: $("ref-app"),
  liveDot: $("ref-live-dot"),
  liveText: $("ref-live-text"),
  holeCount: $("ref-hole-count"),
  currentHole: $("ref-current-hole"),
  currentPub: $("ref-current-pub"),
  currentDrink: $("ref-current-drink"),
  progressLabel: $("ref-progress-label"),
  progressFill: $("ref-progress-fill"),
  teamInputs: $("ref-team-inputs"),
  standings: $("ref-standings-list"),
  sheetBody: $("ref-sheet-body"),
  sheetFoot: $("ref-sheet-footer"),
  history: $("ref-history-list"),
  feedback: $("ref-action-feedback"),
  complete: $("ref-complete"),
  saveScores: $("ref-save-scores"),
  overlay: $("ref-modal-overlay"),
  modalTitle: $("ref-modal-title"),
  modalSummary: $("ref-modal-summary"),
  modalForm: $("ref-modal-form"),
  modalTeamRow: $("ref-modal-team-row"),
  modalTeam: $("ref-modal-team"),
  modalLabel: $("ref-modal-label"),
  modalValue: $("ref-modal-value"),
  modalReason: $("ref-modal-reason"),
  modalReasonLabel: $("ref-reason-label"),
  modalClear: $("ref-modal-clear"),
  modalSave: $("ref-modal-save")
};

const state = {
  teams: {},
  settings: { ...DEFAULT_SETTINGS },
  history: {},
  busy: false,
  signedIn: false,
  unsubscribers: [],
  editing: null
};
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const getTeam = (id) => TEAMS.find((team) => team.id === id);
const num = (value) => Number(value) || 0;

function currentSettings() {
  const completed = clamp(num(state.settings.completedHoles), 0, TOTAL_HOLES);
  return {
    current: clamp(num(state.settings.currentHole) || 1, 1, TOTAL_HOLES),
    completed,
    finished: completed >= TOTAL_HOLES
  };
}
function teamState(team) {
  const record = state.teams[team.id] || {};
  return { ...team, name: record.name || team.name, ...readTeamScore(record) };
}
function feedback(text, error = false) {
  ui.feedback.textContent = text;
  ui.feedback.classList.toggle("error", error);
}
function setBusy(isBusy) {
  state.busy = isBusy;
  document.querySelectorAll("[data-ref-action]").forEach((button) => {
    button.disabled = isBusy;
  });
}
async function guarded(action) {
  if (state.busy || !state.signedIn) return;
  setBusy(true);
  feedback("");
  try {
    await action();
  } catch (error) {
    console.error("Ref action failed:", error);
    feedback(`Something went wrong: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

// Mobile-friendly confirmation sheets: do not rely on browser confirm()/prompt().
const confirmUI = {
  overlay: $("ref-confirm-overlay"),
  form: $("ref-confirm-form"),
  title: $("ref-confirm-title"),
  message: $("ref-confirm-message"),
  entryRow: $("ref-confirm-entry-row"),
  entry: $("ref-confirm-entry"),
  error: $("ref-confirm-error"),
  accept: $("ref-confirm-accept"),
  cancel: $("ref-confirm-cancel")
};
let pendingConfirmation = null;

function finishConfirmation(approved) {
  if (!pendingConfirmation) return;
  const { resolve, requiredText } = pendingConfirmation;
  if (approved && requiredText && confirmUI.entry.value.trim() !== requiredText) {
    confirmUI.error.hidden = false;
    confirmUI.entry.focus();
    return;
  }
  pendingConfirmation = null;
  confirmUI.overlay.hidden = true;
  confirmUI.error.hidden = true;
  document.body.classList.remove("ref-modal-open");
  resolve(approved);
}

function requestConfirmation({ title, message, confirmText, requiredText = null, danger = false }) {
  if (pendingConfirmation) return Promise.resolve(false);
  confirmUI.title.textContent = title;
  confirmUI.message.textContent = message;
  confirmUI.accept.textContent = confirmText;
  confirmUI.accept.classList.toggle("ref-confirm-danger", danger);
  confirmUI.entryRow.hidden = !requiredText;
  confirmUI.entry.value = "";
  confirmUI.error.hidden = true;
  confirmUI.overlay.hidden = false;
  document.body.classList.add("ref-modal-open");
  return new Promise((resolve) => {
    pendingConfirmation = { resolve, requiredText };
  });
}
confirmUI.form.addEventListener("submit", (event) => {
  event.preventDefault();
  finishConfirmation(true);
});
confirmUI.cancel.addEventListener("click", () => finishConfirmation(false));
confirmUI.overlay.addEventListener("click", (event) => {
  if (event.target === confirmUI.overlay) finishConfirmation(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && pendingConfirmation) finishConfirmation(false);
});

// A single undo snapshot restores both teams and event progress together.
// One new action replaces the previous undo, by design.
async function changeWithUndo(changes, description, type) {
  const [teamsSnapshot, settingsSnapshot] = await Promise.all([
    get(teamsRef), get(settingsRef)
  ]);
  const beforeTeams = teamsSnapshot.val();
  const beforeSettings = settingsSnapshot.val();
  if (!beforeTeams || !beforeSettings) throw new Error("Event data is not ready yet.");
  await set(undoRef, {
    kind: "snapshot",
    description,
    beforeTeams,
    beforeSettings
  });
  await update(rootRef, changes);
  await push(historyRef, { text: description, type, time: Date.now() });
  feedback(description);
}

// Initialise only missing records, preserving any scores already entered.
async function initialiseEvent() {
  const [teamSnap, settingSnap] = await Promise.all([
    get(teamsRef), get(settingsRef)
  ]);
  if (!settingSnap.exists()) {
    await set(settingsRef, DEFAULT_SETTINGS);
  }
  const records = teamSnap.val() || {};
  const missing = {};
  TEAMS.forEach((team) => {
    if (!hasOwn(records, team.id)) {
      missing[`teams/${team.id}`] = {
        name: team.name,
        strokes: 0,
        penalties: 0,
        challenges: 0,
        holesPlayed: 0
      };
    }
  });
  if (Object.keys(missing).length) await update(rootRef, missing);
}
function stopListeners() {
  state.unsubscribers.forEach((unsub) => unsub());
  state.unsubscribers = [];
}
function listen() {
  stopListeners();
  state.unsubscribers.push(onValue(teamsRef, (snapshot) => {
    state.teams = snapshot.val() || {};
    renderAll();
  }, showListenerError));
  state.unsubscribers.push(onValue(settingsRef, (snapshot) => {
    state.settings = { ...DEFAULT_SETTINGS, ...(snapshot.val() || {}) };
    renderAll();
  }, showListenerError));
  state.unsubscribers.push(onValue(historyRef, (snapshot) => {
    state.history = snapshot.val() || {};
    renderHistory();
  }, showListenerError));
}
function showListenerError(error) {
  console.error("Firebase subscription error:", error);
  ui.liveDot.className = "live-dot offline";
  ui.liveText.textContent = "Connection error";
  feedback("Cannot load live scores. Check your internet connection.", true);
}

function renderEvent() {
  const { current, completed, finished } = currentSettings();
  const hole = HOLES[current - 1];
  ui.currentHole.textContent = String(current).padStart(2, "0");
  ui.holeCount.textContent = finished ? "ALL 9 COMPLETE" : `HOLE ${current} OF ${TOTAL_HOLES}`;
  ui.currentPub.textContent = finished ? "All nine holes finished" : hole.pub;
  ui.currentDrink.textContent = finished ? "Final scores are in" : hole.drink;
  ui.progressLabel.textContent = `${completed} / ${TOTAL_HOLES} completed`;
  ui.progressFill.style.width = `${(completed / TOTAL_HOLES) * 100}%`;
  ui.complete.textContent = finished ? "✓ EVENT COMPLETE" :
    current === TOTAL_HOLES ? "✓ COMPLETE FINAL HOLE" : "✓ COMPLETE HOLE & MOVE ON";
  ui.complete.disabled = finished || state.busy;
  ui.saveScores.disabled = finished || state.busy;
  ui.liveDot.className = "live-dot";
  ui.liveText.textContent = "Live ref control";
}

function renderScoreInputs() {
  const { current, finished } = currentSettings();
  ui.teamInputs.innerHTML = TEAMS.map((team) => {
    const record = state.teams[team.id] || {};
    const holeScores = record.holeScores || {};
    const present = hasOwn(holeScores, current);
    const value = present ? Number(holeScores[current]) : "";
    return `<div class="ref-team-entry ref-team-${team.id}">
      <div class="ref-team-label"><i class="ref-team-swatch"></i><span>${escapeHTML(record.name || team.name)}</span><small>${present ? "Saved" : "Not entered"}</small></div>
      <div class="ref-stepper">
        <button type="button" class="ref-step-btn" data-step="-1" data-team="${team.id}" aria-label="Subtract one from ${escapeHTML(team.name)}" ${finished ? "disabled" : ""}>−</button>
        <input type="number" min="0" max="999" step="1" inputmode="numeric" id="ref-entry-${team.id}" data-score-entry="${team.id}" aria-label="${escapeHTML(team.name)} current hole strokes" placeholder="–" value="${Number.isFinite(value) ? value : ""}" ${finished ? "disabled" : ""} />
        <button type="button" class="ref-step-btn" data-step="1" data-team="${team.id}" aria-label="Add one to ${escapeHTML(team.name)}" ${finished ? "disabled" : ""}>+</button>
      </div>
    </div>`;
  }).join("");
}
function renderStandings() {
  const entries = TEAMS.map(teamState);
  entries.sort((a, b) => {
    if (a.hasActivity !== b.hasActivity) return a.hasActivity ? -1 : 1;
    if (a.total !== b.total) return a.total - b.total;
    return TEAMS.findIndex((t) => t.id === a.id) - TEAMS.findIndex((t) => t.id === b.id);
  });
  ui.standings.innerHTML = entries.map((team, i) => `<div class="ref-standing-row ref-standing-${team.id}">
    <span class="ref-standing-rank">${team.hasActivity ? i + 1 : "–"}</span>
    <i class="ref-team-swatch"></i><span class="ref-standing-name">${escapeHTML(team.name)}</span>
    <small>${team.holesPlayed}/${TOTAL_HOLES}</small>
    <strong>${team.hasActivity ? team.total : "–"}</strong>
  </div>`).join("");
}
function renderScorecard() {
  const { current, completed, finished } = currentSettings();
  const entries = TEAMS.map(teamState);
  ui.sheetBody.innerHTML = HOLES.map((hole) => {
    const active = !finished && current === hole.number;
    return `<tr class="${active ? "ref-sheet-current" : ""} ${hole.number <= completed ? "ref-sheet-done" : ""}">
      <th scope="row"><span class="ref-sheet-number">${hole.number}</span><span class="ref-sheet-stop"><strong>${escapeHTML(hole.pub)}</strong><small>${escapeHTML(hole.drink)}</small></span></th>
      ${entries.map((team) => {
        const present = hasOwn(team.holeScores, hole.number);
        const value = Number(team.holeScores[hole.number]);
        return `<td><button type="button" class="ref-cell-button" data-edit-team="${team.id}" data-edit-hole="${hole.number}" aria-label="Edit ${escapeHTML(team.name)} score for hole ${hole.number}">${present && Number.isFinite(value) ? value : "–"}</button></td>`;
      }).join("")}</tr>`;
  }).join("");
  const totalsRow = (label, getValue, className = "") => `<tr class="${className}"><th scope="row">${label}</th>${entries.map((entry) => `<td>${getValue(entry)}</td>`).join("")}</tr>`;
  ui.sheetFoot.innerHTML =
    totalsRow("BASE", (t) => t.hasActivity ? t.base : "–") +
    totalsRow("PEN.", (t) => t.penalties ? `+${t.penalties}` : "–") +
    totalsRow("CHAL.", (t) => t.challenges ? `−${t.challenges}` : "–") +
    totalsRow("TOTAL", (t) => t.hasActivity ? t.total : "–", "ref-sheet-total");
}
function renderHistory() {
  const entries = Object.values(state.history).filter(Boolean)
    .sort((a, b) => num(b.time) - num(a.time)).slice(0, 16);
  ui.history.innerHTML = entries.length ? entries.map((item) => {
    const time = item.time ? new Date(item.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
    return `<div class="ref-history-entry"><span class="ref-history-marker">●</span><span>${escapeHTML(item.text || "Event update")}</span><time>${escapeHTML(time)}</time></div>`;
  }).join("") : '<p class="ref-hint">No actions recorded yet.</p>';
}
function renderAll() {
  if (!state.signedIn) return;
  renderEvent();
  renderScoreInputs();
  renderStandings();
  renderScorecard();
  renderHistory();
}

function readDrafts() {
  const { current } = currentSettings();
  const changes = {};
  TEAMS.forEach((team) => {
    const input = $(`ref-entry-${team.id}`);
    const raw = input.value.trim();
    if (raw === "") return;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 999) {
      throw new Error(`${team.name}: enter a whole number from 0 to 999.`);
    }
    const old = (state.teams[team.id] || {}).holeScores || {};
    if (!hasOwn(old, current) || Number(old[current]) !== value) {
      changes[`teams/${team.id}/holeScores/${current}`] = value;
    }
  });
  return changes;
}
function currentCompleteness(changes) {
  const { current } = currentSettings();
  return TEAMS.filter((team) => {
    const path = `teams/${team.id}/holeScores/${current}`;
    const old = (state.teams[team.id] || {}).holeScores || {};
    return !hasOwn(changes, path) && !hasOwn(old, current);
  }).map((team) => team.name);
}

ui.teamInputs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-step]");
  if (!button) return;
  const field = $(`ref-entry-${button.dataset.team}`);
  if (!field) return;
  const current = field.value === "" ? 0 : Number(field.value);
  field.value = clamp((Number.isFinite(current) ? current : 0) + Number(button.dataset.step), 0, 999);
  field.focus({ preventScroll: true });
});
ui.saveScores.addEventListener("click", () => guarded(async () => {
  if (currentSettings().finished) throw new Error("Event is already complete.");
  const changes = readDrafts();
  if (!Object.keys(changes).length) {
    feedback("No changes to save.");
    return;
  }
  const hole = currentSettings().current;
  await changeWithUndo(changes, `Hole ${hole}: team scores saved`, "strokes");
}));
ui.complete.addEventListener("click", () => guarded(async () => {
  const { current, finished } = currentSettings();
  if (finished) return;
  const changes = readDrafts();
  const missing = currentCompleteness(changes);
  if (missing.length) {
    throw new Error(`Enter a score for: ${missing.join(", ")}.`);
  }
  // Completes the hole and saves any unsaved inputs in ONE undoable action.
  changes["settings/completedHoles"] = current;
  changes["settings/currentHole"] = Math.min(TOTAL_HOLES, current + 1);
  TEAMS.forEach((team) => {
    changes[`teams/${team.id}/holesPlayed`] = Math.max(num(state.teams[team.id]?.holesPlayed), current);
  });
  await changeWithUndo(changes,
    current === TOTAL_HOLES ? "Final hole completed — results ready" : `Hole ${current} completed — moved to Hole ${current + 1}`,
    "hole");
}));

function openModal(mode, teamId = null, holeNumber = null) {
  state.editing = { mode, teamId, holeNumber };
  const scoreMode = mode === "score";
  ui.modalTitle.textContent = scoreMode ? "EDIT HOLE SCORE" : mode === "penalty" ? "ADD PENALTY" : "ADD CHALLENGE";
  ui.modalTeamRow.hidden = scoreMode;
  ui.modalReason.hidden = scoreMode;
  ui.modalReasonLabel.hidden = scoreMode;
  ui.modalClear.hidden = !scoreMode;
  ui.modalValue.min = scoreMode ? "0" : "1";
  ui.modalLabel.textContent = scoreMode ? "Strokes for this hole" : "Amount (strokes)";
  ui.modalTeam.innerHTML = TEAMS.map((team) => `<option value="${team.id}">${escapeHTML(team.name)}</option>`).join("");
  ui.modalTeam.value = teamId || "red";
  ui.modalReason.value = "";
  if (scoreMode) {
    const team = getTeam(teamId);
    const hole = HOLES[holeNumber - 1];
    const old = state.teams[teamId]?.holeScores || {};
    ui.modalSummary.textContent = `${team.name} · Hole ${holeNumber} · ${hole.pub}`;
    ui.modalValue.value = hasOwn(old, holeNumber) ? old[holeNumber] : "";
    ui.modalClear.hidden = !hasOwn(old, holeNumber);
  } else {
    ui.modalSummary.textContent = mode === "penalty" ?
      "Add strokes to a team's overall total." : "Deduct strokes from a team's overall total.";
    ui.modalValue.value = "1";
  }
  ui.overlay.hidden = false;
  document.body.classList.add("ref-modal-open");
  ui.modalValue.focus();
}
function closeModal() {
  ui.overlay.hidden = true;
  document.body.classList.remove("ref-modal-open");
  state.editing = null;
}
ui.sheetBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-team]");
  if (button) openModal("score", button.dataset.editTeam, Number(button.dataset.editHole));
});
$("ref-penalty").addEventListener("click", () => openModal("penalty"));
$("ref-challenge").addEventListener("click", () => openModal("challenge"));
$("ref-modal-close").addEventListener("click", closeModal);
ui.overlay.addEventListener("click", (event) => {
  if (event.target === ui.overlay) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !ui.overlay.hidden) closeModal();
});
ui.modalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const editing = state.editing;
  if (!editing) return;
  guarded(async () => {
    const value = Number(ui.modalValue.value);
    const min = editing.mode === "score" ? 0 : 1;
    if (!Number.isInteger(value) || value < min || value > 999) {
      throw new Error(`Enter a whole number between ${min} and 999.`);
    }
    if (editing.mode === "score") {
      const { teamId, holeNumber } = editing;
      const current = state.teams[teamId]?.holeScores || {};
      if (hasOwn(current, holeNumber) && Number(current[holeNumber]) === value) {
        closeModal(); feedback("Score is already saved."); return;
      }
      await changeWithUndo({ [`teams/${teamId}/holeScores/${holeNumber}`]: value },
        `${getTeam(teamId).name}: Hole ${holeNumber} changed to ${value}`, "strokes");
    } else {
      const teamId = ui.modalTeam.value;
      const record = state.teams[teamId] || {};
      const key = editing.mode === "penalty" ? "penalties" : "challenges";
      const description = editing.mode === "penalty" ? "penalty" : "challenge deduction";
      const note = ui.modalReason.value.trim();
      await changeWithUndo({ [`teams/${teamId}/${key}`]: num(record[key]) + value },
        `${getTeam(teamId).name}: ${editing.mode === "penalty" ? "+" : "−"}${value} ${description}${note ? ` (${note})` : ""}`,
        editing.mode);
    }
    closeModal();
  });
});
ui.modalClear.addEventListener("click", () => {
  if (!state.editing || state.editing.mode !== "score") return;
  const { teamId, holeNumber } = state.editing;
  const confirmClear = confirm(`Clear ${getTeam(teamId).name}'s score for Hole ${holeNumber}?`);
  if (!confirmClear) return;
  guarded(async () => {
    await changeWithUndo({ [`teams/${teamId}/holeScores/${holeNumber}`]: null },
      `${getTeam(teamId).name}: Hole ${holeNumber} score cleared`, "strokes");
    closeModal();
  });
});

$("ref-undo").addEventListener("click", () => guarded(async () => {
  const snapshot = await get(undoRef);
  const undo = snapshot.val();
  if (!undo) { feedback("There is no action to undo."); return; }
  if (undo.kind !== "snapshot" || !undo.beforeTeams || !undo.beforeSettings) {
    throw new Error("This action cannot be undone. Please check your event data.");
  }
  const confirmUndo = await requestConfirmation({
    title: "Undo last action?",
    message: undo.description || "Reverse the most recent change.",
    confirmText: "YES, UNDO"
  });
  if (!confirmUndo) return;
  await update(rootRef, {
    teams: undo.beforeTeams,
    settings: undo.beforeSettings,
    "undo/lastAction": null
  });
  await push(historyRef, {
    text: `Undo: ${undo.description || "last action"}`,
    type: "undo",
    time: Date.now()
  });
  feedback("Last action reversed.");
}));

function clearedTeams() {
  const reset = {};
  TEAMS.forEach((team) => {
    const record = state.teams[team.id] || {};
    const { holeScores, ...preserved } = record;
    reset[team.id] = {
      ...preserved,
      name: record.name || team.name,
      penalties: 0,
      challenges: 0,
      strokes: 0,
      holesPlayed: 0
    };
  });
  return reset;
}
$("ref-reset-scores").addEventListener("click", () => guarded(async () => {
  const approved = await requestConfirmation({
    title: "Reset scores and progress?",
    message: "This clears all team scores and hole progress. You can undo it immediately afterward.",
    confirmText: "RESET SCORES",
    danger: true
  });
  if (!approved) return;
  const changes = { teams: clearedTeams(), settings: { ...state.settings, ...DEFAULT_SETTINGS } };
  await changeWithUndo(changes, "All scores and progress reset", "reset");
}));
$("ref-full-reset").addEventListener("click", () => guarded(async () => {
  const approved = await requestConfirmation({
    title: "Start a fresh event?",
    message: "This permanently clears all scores, progress, activity history and Undo. Team names and the pub route stay the same. Type RESET below to confirm.",
    confirmText: "START FRESH EVENT",
    requiredText: "RESET",
    danger: true
  });
  if (!approved) return;
  await update(rootRef, {
    teams: clearedTeams(),
    settings: { ...state.settings, ...DEFAULT_SETTINGS },
    history: null,
    "undo/lastAction": null
  });
  feedback("Fresh event ready — scores, progress and history cleared.");
}));

ui.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  ui.loginError.hidden = true;
  ui.loginSubmit.disabled = true;
  try {
    const credential = await signInWithEmailAndPassword(
      auth, ui.email.value.trim(), ui.password.value
    );
    if (credential.user.uid !== REF_UID) {
      await signOut(auth);
      throw new Error("That account is not authorised as the ref.");
    }
    ui.password.value = "";
  } catch (error) {
    console.error("Ref login failed", error);
    ui.loginError.hidden = false;
    ui.loginError.textContent = "Could not sign in. Check the email and password for your authorised ref account.";
  } finally {
    ui.loginSubmit.disabled = false;
  }
});
$("ref-signout").addEventListener("click", () => signOut(auth));
onAuthStateChanged(auth, async (user) => {
  stopListeners();
  state.signedIn = false;
  ui.loginView.hidden = false;
  ui.app.hidden = true;
  if (!user || user.uid !== REF_UID) {
    if (user && user.uid !== REF_UID) await signOut(auth);
    return;
  }
  try {
    await initialiseEvent();
    state.signedIn = true;
    ui.loginView.hidden = true;
    ui.app.hidden = false;
    listen();
    renderAll();
  } catch (error) {
    console.error("Ref initialisation failed", error);
    ui.loginError.hidden = false;
    ui.loginError.textContent = "Could not initialise the ref dashboard. Check Firebase rules and the account UID.";
  }
});
