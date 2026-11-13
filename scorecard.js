import { ref, onValue } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";
import { database, TEAMS, HOLES, TOTAL_HOLES, DEFAULT_SETTINGS, readTeamScore, formatScore } from "./config.js?v=8";

const body = document.getElementById('sc-table-body');
const foot = document.getElementById('sc-table-foot');
const rankGrid = document.getElementById('sc-rank-grid');
const statusNumber = document.getElementById('sc-current-number');
const pub = document.getElementById('sc-current-pub');
const drink = document.getElementById('sc-current-drink');
const steps = document.getElementById('sc-nine-step');
const caption = document.getElementById('sc-progress-caption');
const connection = document.getElementById('sc-status-text');
const dot = document.querySelector('#sc-live-indicator .live-dot');
const state = { teams: {}, settings: DEFAULT_SETTINGS, readyTeams: false, readySettings: false, failed: false };
const escapeHTML = (v) => String(v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (x,lo,hi) => Math.max(lo, Math.min(hi,x));
function render() {
  const done = clamp(Number(state.settings.completedHoles || 0), 0, TOTAL_HOLES);
  const current = clamp(Number(state.settings.currentHole || 1), 1, TOTAL_HOLES);
  const finished = done >= TOTAL_HOLES;
  const teamRows = TEAMS.map((team) => ({ ...team, ...readTeamScore(state.teams[team.id] || {}, team, done) }));
  statusNumber.textContent = String(current);
  pub.textContent = finished ? 'All nine holes completed!' : HOLES[current - 1].pub;
  drink.textContent = finished ? 'Final results are in' : HOLES[current - 1].drink;
  steps.innerHTML = HOLES.map((hole) => {
    const isDone = hole.number <= done;
    const selected = !finished && hole.number === current;
    return `<span class="sc-step ${isDone ? 'is-done' : ''} ${selected ? 'is-current' : ''}">${isDone ? '✓' : hole.number}</span>`;
  }).join('');
  caption.textContent = `${done} of ${TOTAL_HOLES} holes completed`;
  body.innerHTML = HOLES.map((hole) => `<tr class="${!finished && current === hole.number ? 'sc-row-current' : ''} ${hole.number <= done ? 'sc-row-done' : ''}">
    <th scope="row"><span class="sc-hole-num">${String(hole.number).padStart(2,'0')}</span><span class="sc-hole-details"><strong>${escapeHTML(hole.pub)}</strong><small>${escapeHTML(hole.drink)}</small></span></th>
    ${teamRows.map((team) => `<td>${team.progress[hole.number].complete ? formatScore(team.holeScores[hole.number]) : '–'}</td>`).join('')}
  </tr>`).join('');
  foot.innerHTML = `<tr class="sc-grand-total"><th scope="row">TOTAL</th>${teamRows.map((t) => `<td>${t.hasActivity ? formatScore(t.total) : '–'}</td>`).join('')}</tr>`;
  const ranked = [...teamRows].sort((a,b) => Number(b.hasActivity) - Number(a.hasActivity) || a.total - b.total);
  rankGrid.innerHTML = ranked.map((team, i) => `<a class="sc-rank-card sc-rank-${team.id}" href="teams.html#team-${team.id}">
    <span class="sc-rank-num">${team.hasActivity ? ['1st','2nd','3rd'][i] : '—'}</span>
    <span class="sc-rank-team">${escapeHTML(team.name)}</span>
    <strong class="sc-rank-score">${team.hasActivity ? formatScore(team.total) : '—'}</strong>
  </a>`).join('');
  connection.textContent = state.failed ? 'Could not load live scores' : state.readyTeams && state.readySettings ? 'Live scores' : 'Connecting…';
  dot.className = 'live-dot ' + (state.failed ? 'offline' : state.readyTeams && state.readySettings ? '' : 'connecting');
}
const fail = (e) => { console.error(e); state.failed = true; render(); };
onValue(ref(database,'teams'), (s) => { state.teams=s.val()||{}; state.readyTeams=true; render(); }, fail);
onValue(ref(database,'settings'), (s) => { state.settings={...DEFAULT_SETTINGS,...(s.val()||{})}; state.readySettings=true; render(); }, fail);
render();
