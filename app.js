import { ref, onValue } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";
import { database, TEAMS, HOLES, TOTAL_HOLES, DEFAULT_SETTINGS, readTeamScore, formatScore } from "./config.js?v=8";

const elements = {
  leaderboard: document.getElementById("leaderboard"), databaseStatus: document.getElementById("database-status"),
  databaseDot: document.getElementById("database-dot"), holeIndicator: document.getElementById("hole-indicator"),
  holeProgress: document.getElementById("hole-progress"), currentPub: document.getElementById("current-pub-name"),
  currentDrink: document.getElementById("current-drink"), history: document.getElementById("activity-list"),
  scorecardBody: document.getElementById("scorecard-body"), scorecardFoot: document.getElementById("scorecard-foot")
};
const state = { teams: {}, settings: DEFAULT_SETTINGS, history: {}, teamsReady: false, settingsReady: false, error: null };
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const completed = () => Math.max(0, Math.min(TOTAL_HOLES, Number(state.settings.completedHoles || 0)));
function rows() {
  return TEAMS.map((team) => ({ ...team, ...readTeamScore(state.teams[team.id] || {}, team, completed()) }));
}
function renderLeaderboard(teams) {
  const ranked = [...teams].sort((a, b) => Number(b.hasActivity) - Number(a.hasActivity) || a.total - b.total);
  elements.leaderboard.innerHTML = ranked.map((team, i) => `
    <a href="teams.html#team-${team.id}" class="leader-row ${i === 0 && team.hasActivity ? 'leader-row-first' : ''}" aria-label="Open ${escapeHTML(team.name)}">
      <span class="position ${i === 0 && team.hasActivity ? 'position-gold' : ''}">${team.hasActivity ? i + 1 : '—'}</span>
      <span class="team-colour" style="--team-color:${team.colour}"></span>
      <span class="team-name">${escapeHTML(team.name)}</span>
      <span class="holes-count">${team.holesPlayed}/${TOTAL_HOLES}</span>
      <span class="team-total">${team.hasActivity ? formatScore(team.total) : '—'}</span>
    </a>`).join("");
}
function renderProgress() {
  const done = completed();
  const current = Math.max(1, Math.min(TOTAL_HOLES, Number(state.settings.currentHole || 1)));
  const hole = HOLES[current - 1];
  elements.holeIndicator.textContent = done === TOTAL_HOLES ? 'ALL 9 COMPLETE' : `HOLE ${current} OF ${TOTAL_HOLES}`;
  elements.holeProgress.innerHTML = HOLES.map((item) => {
    const isDone = item.number <= done;
    const isCurrent = item.number === current && done < TOTAL_HOLES;
    return `<span class="hole-point ${isDone ? 'is-done' : ''} ${isCurrent ? 'is-current' : ''}" aria-label="Hole ${item.number}">${isDone ? '✓' : item.number}</span>`;
  }).join('');
  elements.currentPub.textContent = done === TOTAL_HOLES ? 'All nine holes completed!' : hole.pub;
  elements.currentDrink.textContent = done === TOTAL_HOLES ? 'Final results are in' : `Drink: ${hole.drink}`;
}
function renderHistory() {
  const entries = Object.values(state.history || {}).filter((item) => item && item.text)
    .sort((a,b) => Number(b.time || 0) - Number(a.time || 0)).slice(0,4);
  elements.history.innerHTML = entries.length ? entries.map((item) => `<div class="activity-entry">
    <span class="activity-mark">⚑</span><span class="activity-text">${escapeHTML(item.text)}</span>
    <time>${item.time ? new Date(item.time).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}) : ''}</time></div>`).join('') :
    '<div class="empty-state">No activity yet — scores will appear when the event starts.</div>';
}
function renderScorecard(teams) {
  elements.scorecardBody.innerHTML = HOLES.map((hole) => `<tr><th scope="row">${hole.number}</th>${teams.map((t) => `<td>${t.progress[hole.number].complete ? formatScore(t.holeScores[hole.number]) : '–'}</td>`).join('')}</tr>`).join('');
  elements.scorecardFoot.innerHTML = `<tr class="total-row"><th scope="row">TOTAL</th>${teams.map((t) => `<td>${t.hasActivity ? formatScore(t.total) : '–'}</td>`).join('')}</tr>`;
}
function renderConnection() {
  if (state.error) {
    elements.databaseStatus.textContent = 'Unable to load live scores. Try refreshing.';
    elements.databaseDot.className = 'live-dot offline';
  } else if (!state.teamsReady || !state.settingsReady) {
    elements.databaseStatus.textContent = 'Connecting to live scores…';
    elements.databaseDot.className = 'live-dot connecting';
  } else {
    elements.databaseStatus.textContent = 'Live scores · official totals update after each completed hole';
    elements.databaseDot.className = 'live-dot';
  }
}
function renderAll() {
  const teamRows = rows();
  renderLeaderboard(teamRows);
  renderProgress();
  renderHistory();
  renderScorecard(teamRows);
  renderConnection();
}
const failure = (error) => { console.error(error); state.error = error; renderAll(); };
onValue(ref(database, 'teams'), (snapshot) => { state.teams = snapshot.val() || {}; state.teamsReady = true; renderAll(); }, failure);
onValue(ref(database, 'settings'), (snapshot) => { state.settings = { ...DEFAULT_SETTINGS, ...(snapshot.val() || {}) }; state.settingsReady = true; renderAll(); }, failure);
onValue(ref(database, 'history'), (snapshot) => { state.history = snapshot.val() || {}; renderHistory(); }, failure);
renderAll();
