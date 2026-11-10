import { ref, onValue } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";
import { database, TEAMS, HOLES, TOTAL_HOLES, DEFAULT_SETTINGS, readTeamScore } from "./config.js?v=1";

const body = document.getElementById("sc-table-body");
const foot = document.getElementById("sc-table-foot");
const rankGrid = document.getElementById("sc-rank-grid");
const currentNumber = document.getElementById("sc-current-number");
const currentPub = document.getElementById("sc-current-pub");
const currentDrink = document.getElementById("sc-current-drink");
const progress = document.getElementById("sc-nine-step");
const progressCaption = document.getElementById("sc-progress-caption");
const connection = document.getElementById("sc-status-text");
const dot = document.querySelector("#sc-live-indicator .live-dot");

const state = {
  teams: {},
  settings: { ...DEFAULT_SETTINGS },
  readyTeams: false,
  readySettings: false,
  failed: false
};

const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])
);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const hasOwn = (record, key) => Object.prototype.hasOwnProperty.call(record || {}, key);
const rows = () => TEAMS.map((team) => {
  const data = state.teams[team.id] || {};
  return { ...team, name: data.name || team.name, ...readTeamScore(data) };
});

function getValues(teamRows) {
  return HOLES.map((hole) => teamRows.map((team) => {
    if (!hasOwn(team.holeScores, hole.number)) return null;
    const value = Number(team.holeScores[hole.number]);
    return Number.isFinite(value) ? value : null;
  }));
}

function renderStatus() {
  const settings = state.settings;
  const current = clamp(Number(settings.currentHole) || 1, 1, TOTAL_HOLES);
  const completed = clamp(Number(settings.completedHoles) || 0, 0, TOTAL_HOLES);
  const final = completed === TOTAL_HOLES;
  const stop = HOLES[current - 1];

  currentNumber.textContent = final ? '9' : String(current);
  currentPub.textContent = final ? 'All nine holes completed!' : stop.pub;
  currentDrink.textContent = final ? 'Final results are in' : stop.drink;
  progress.innerHTML = HOLES.map((hole) => {
    const done = hole.number <= completed;
    const selected = !final && hole.number === current;
    return `<span class="sc-step ${done ? 'is-done' : ''} ${selected ? 'is-current' : ''}" aria-label="Hole ${hole.number}: ${done ? 'completed' : selected ? 'current' : 'upcoming'}">${done ? '✓' : hole.number}</span>`;
  }).join('');
  progressCaption.textContent = `${completed} of ${TOTAL_HOLES} holes completed`;
}

function renderTable(teamRows) {
  const allScores = getValues(teamRows);
  const current = clamp(Number(state.settings.currentHole) || 1, 1, TOTAL_HOLES);
  const completed = clamp(Number(state.settings.completedHoles) || 0, 0, TOTAL_HOLES);
  body.innerHTML = HOLES.map((hole, index) => {
    const currentClass = hole.number === current && completed < TOTAL_HOLES ? 'sc-row-current' : '';
    const completeClass = hole.number <= completed ? 'sc-row-done' : '';
    const name = escapeHTML(hole.pub);
    const drink = escapeHTML(hole.drink);
    return `<tr class="${currentClass} ${completeClass}">
      <th scope="row"><span class="sc-hole-num">${String(hole.number).padStart(2, '0')}</span><span class="sc-hole-details"><strong>${name}</strong><small>${drink}</small></span></th>
      ${allScores[index].map((value) => `<td class="${value === null ? 'sc-no-score' : ''}">${value === null ? '–' : value}</td>`).join('')}
    </tr>`;
  }).join('');
  const row = (label, transform, cssClass = '') => `<tr class="${cssClass}"><th scope="row">${label}</th>${teamRows.map((team) => `<td>${transform(team)}</td>`).join('')}</tr>`;
  foot.innerHTML =
    row('BASE', (team) => team.hasActivity ? team.base : '–') +
    row('PENALTIES', (team) => team.penalties ? `+${team.penalties}` : '–') +
    row('CHALLENGES', (team) => team.challenges ? `−${team.challenges}` : '–') +
    row('TOTAL', (team) => team.hasActivity ? team.total : '–', 'sc-grand-total');
}

function renderRankings(teamRows) {
  const ordered = [...teamRows].sort((a, b) => {
    if (a.hasActivity !== b.hasActivity) return a.hasActivity ? -1 : 1;
    if (a.hasActivity && b.hasActivity && a.total !== b.total) return a.total - b.total;
    return TEAMS.findIndex((t) => t.id === a.id) - TEAMS.findIndex((t) => t.id === b.id);
  });
  rankGrid.innerHTML = ordered.map((team, index) => `<a class="sc-rank-card sc-rank-${team.id}" href="teams.html#team-${team.id}">
    <span class="sc-rank-num">${team.hasActivity ? `${index + 1}${index === 0 ? 'st' : index === 1 ? 'nd' : index === 2 ? 'rd' : 'th'}` : '—'}</span>
    <span class="sc-rank-team">${escapeHTML(team.name)}</span>
    <strong class="sc-rank-score">${team.hasActivity ? team.total : '—'}</strong>
  </a>`).join('');
}

function renderConnection() {
  if (state.failed) {
    connection.textContent = 'Could not load live scores';
    dot.className = 'live-dot offline';
  } else if (!state.readyTeams || !state.readySettings) {
    connection.textContent = 'Connecting…';
    dot.className = 'live-dot connecting';
  } else {
    connection.textContent = 'Live scores';
    dot.className = 'live-dot';
  }
}

function renderAll() {
  const teamRows = rows();
  renderStatus();
  renderTable(teamRows);
  renderRankings(teamRows);
  renderConnection();
}
function handleError(error) {
  console.error('Could not read live scorecard:', error);
  state.failed = true;
  renderConnection();
}

onValue(ref(database, 'teams'), (snapshot) => {
  state.teams = snapshot.val() || {};
  state.readyTeams = true;
  renderAll();
}, handleError);

onValue(ref(database, 'settings'), (snapshot) => {
  state.settings = { ...DEFAULT_SETTINGS, ...(snapshot.val() || {}) };
  state.readySettings = true;
  renderAll();
}, handleError);

renderAll();
