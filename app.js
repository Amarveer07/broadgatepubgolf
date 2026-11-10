import { ref, onValue } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";
import { database, TEAMS, HOLES, TOTAL_HOLES, DEFAULT_SETTINGS, readTeamScore } from "./config.js?v=1";

const elements = {
  leaderboard: document.getElementById("leaderboard"),
  databaseStatus: document.getElementById("database-status"),
  databaseDot: document.getElementById("database-dot"),
  holeIndicator: document.getElementById("hole-indicator"),
  holeProgress: document.getElementById("hole-progress"),
  currentPub: document.getElementById("current-pub-name"),
  currentDrink: document.getElementById("current-drink"),
  history: document.getElementById("activity-list"),
  scorecardBody: document.getElementById("scorecard-body"),
  scorecardFoot: document.getElementById("scorecard-foot")
};

const state = { teams: {}, settings: DEFAULT_SETTINGS, history: {}, teamsReady: false, settingsReady: false, error: null };
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function buildRows() {
  return TEAMS.map((team) => {
    const record = state.teams[team.id] || {};
    return { ...team, ...readTeamScore(record), name: record.name || team.name };
  });
}

function renderLeaderboard(rows) {
  const sorted = [...rows].sort((a, b) => {
    if (a.hasActivity !== b.hasActivity) return a.hasActivity ? -1 : 1;
    if (a.hasActivity && b.hasActivity && a.total !== b.total) return a.total - b.total;
    return TEAMS.findIndex((t) => t.id === a.id) - TEAMS.findIndex((t) => t.id === b.id);
  });
  elements.leaderboard.innerHTML = sorted.map((team, i) => `
    <div class="leader-row ${i === 0 && team.hasActivity ? 'leader-row-first' : ''}">
      <span class="position ${i === 0 && team.hasActivity ? 'position-gold' : ''}">${team.hasActivity ? i + 1 : '—'}</span>
      <span class="team-colour ${team.id === 'white' ? 'team-white' : ''}" style="--team-color:${team.colour}"></span>
      <span class="team-name">${escapeHTML(team.name)}</span>
      <span class="holes-count">${team.holesPlayed}/${TOTAL_HOLES}</span>
      <span class="team-total">${team.hasActivity ? team.total : '—'}</span>
    </div>
  `).join("");
}

function renderProgress() {
  const completed = Math.max(0, Math.min(TOTAL_HOLES, Number(state.settings.completedHoles || 0)));
  const current = Math.max(1, Math.min(TOTAL_HOLES, Number(state.settings.currentHole || 1)));
  const hole = HOLES[current - 1];
  elements.holeIndicator.textContent = completed === TOTAL_HOLES ? 'ALL 9 COMPLETE' : `HOLE ${current} OF ${TOTAL_HOLES}`;
  elements.holeProgress.innerHTML = HOLES.map((item) => {
    const isDone = item.number <= completed;
    const isCurrent = item.number === current && completed < TOTAL_HOLES;
    return `<span class="hole-point ${isDone ? 'is-done' : ''} ${isCurrent ? 'is-current' : ''}" title="Hole ${item.number}" aria-label="Hole ${item.number}: ${isDone ? 'complete' : isCurrent ? 'current' : 'upcoming'}">${isDone ? '✓' : item.number}</span>`;
  }).join('');
  elements.currentPub.textContent = completed === TOTAL_HOLES ? 'All nine holes completed!' : hole.pub;
  elements.currentDrink.textContent = completed === TOTAL_HOLES ? 'Final scores are in' : `Drink: ${hole.drink}`;
}

function renderHistory() {
  const entries = Object.values(state.history || {})
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.text === 'string')
    .sort((a, b) => Number(b.time || 0) - Number(a.time || 0)).slice(0, 4);
  if (!entries.length) {
    elements.history.innerHTML = '<div class="empty-state">No activity yet — scores will appear here when the game starts.</div>';
    return;
  }
  elements.history.innerHTML = entries.map((entry) => {
    const time = Number(entry.time) ? new Date(entry.time).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="activity-entry"><span class="activity-mark">⚑</span><span class="activity-text">${escapeHTML(entry.text)}</span><time>${escapeHTML(time)}</time></div>`;
  }).join('');
}

function getHoleScore(row, n) {
  if (!Object.hasOwn(row.holeScores, n)) return '–';
  const value = Number(row.holeScores[n]);
  return Number.isFinite(value) ? value : '–';
}

function renderScorecard(rows) {
  elements.scorecardBody.innerHTML = HOLES.map((hole) => `<tr>
    <th scope="row">${hole.number}</th>
    ${rows.map((row) => `<td>${getHoleScore(row, hole.number)}</td>`).join('')}
  </tr>`).join('');
  const numberRow = (label, fn, className = '') => `<tr class="${className}"><th scope="row">${label}</th>${rows.map((row) => `<td>${fn(row)}</td>`).join('')}</tr>`;
  elements.scorecardFoot.innerHTML =
    numberRow('BASE', (r) => r.base || (r.hasActivity ? 0 : '–')) +
    numberRow('PEN.', (r) => r.penalties ? `+${r.penalties}` : '–') +
    numberRow('CHAL.', (r) => r.challenges ? `−${r.challenges}` : '–') +
    numberRow('TOTAL', (r) => r.hasActivity ? r.total : '–', 'total-row');
}

function updateConnectionLabel() {
  const dot = elements.databaseDot;
  if (state.error) {
    elements.databaseStatus.textContent = 'Unable to load live scores. Try refreshing.';
    dot.className = 'live-dot offline';
  } else if (!state.teamsReady || !state.settingsReady) {
    elements.databaseStatus.textContent = 'Connecting to live scores…';
    dot.className = 'live-dot connecting';
  } else if (Object.keys(state.teams).length === 0) {
    elements.databaseStatus.textContent = 'Connected · event scores not entered yet';
    dot.className = 'live-dot';
  } else {
    elements.databaseStatus.textContent = 'Live scores · updated automatically';
    dot.className = 'live-dot';
  }
}

function renderAll() {
  const rows = buildRows();
  renderLeaderboard(rows);
  renderProgress();
  renderHistory();
  renderScorecard(rows);
  updateConnectionLabel();
}

function handleError(error) {
  console.error('Firebase database read failed:', error);
  state.error = error;
  renderAll();
}

onValue(ref(database, 'teams'), (snapshot) => {
  state.teams = snapshot.val() || {};
  state.teamsReady = true;
  renderAll();
}, handleError);

onValue(ref(database, 'settings'), (snapshot) => {
  state.settings = { ...DEFAULT_SETTINGS, ...(snapshot.val() || {}) };
  state.settingsReady = true;
  renderAll();
}, handleError);

onValue(ref(database, 'history'), (snapshot) => {
  state.history = snapshot.val() || {};
  renderAll();
}, handleError);

renderAll();
