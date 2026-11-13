import { ref, onValue } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";
import { database, TEAMS, HOLES, TOTAL_HOLES, DEFAULT_SETTINGS, readTeamScore, playerKey, formatScore } from "./config.js?v=8";

const grid = document.getElementById('team-grid');
const connection = document.getElementById('teams-connection');
const escapeHTML = (v) => String(v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let allTeams = {}, settings = DEFAULT_SETTINGS;
function initial(name) { return String(name).trim().slice(0,1).toUpperCase(); }
function buildCard(team, place) {
  const playerList = team.members.map((name) => `<div class="team-member"><span class="member-avatar" aria-hidden="true">${escapeHTML(initial(name))}</span><span class="member-name">${escapeHTML(name)}</span></div>`).join('');
  const holes = HOLES.map((hole) => `<div class="mini-hole"><span>H${hole.number}</span><strong>${team.progress[hole.number].complete ? formatScore(team.holeScores[hole.number]) : '–'}</strong></div>`).join('');
  const playerRows = team.members.map((name) => {
    const key = playerKey(name);
    return `<div class="bpg-member-detail"><strong>${escapeHTML(name)}</strong><span>${HOLES.map((hole) => {
      const raw = allTeams[team.id]?.playerScores?.[hole.number]?.[key];
      return raw === undefined || raw === null ? '–' : String(Number(raw));
    }).join(' · ')}</span></div>`;
  }).join('');
  return `<details class="team-card team-card-${team.id}" id="team-${team.id}" style="--team-accent:${team.colour}">
    <summary class="team-card-summary"><div class="team-card-header"><span class="team-card-glyph" aria-hidden="true">👥</span><h3>${escapeHTML(team.name)}</h3><span class="team-card-arrow">⌄</span></div>
    <div class="team-members">${playerList}</div><div class="team-card-bottom"><span>${team.members.length} PLAYERS</span><span>${team.hasActivity ? `${formatScore(team.total)} AVERAGE TOTAL` : 'NOT STARTED'}</span></div>
    <div class="team-card-open">Tap to see scores ↓</div></summary>
    <div class="team-card-detail"><div class="team-stats"><div><span>POSITION</span><strong>${team.hasActivity ? place : '—'}</strong></div><div><span>TOTAL</span><strong>${team.hasActivity ? formatScore(team.total) : '—'}</strong></div><div><span>HOLES</span><strong>${team.holesPlayed}/${TOTAL_HOLES}</strong></div></div>
    <p class="mini-heading">TEAM HOLE AVERAGES</p><div class="mini-score-grid">${holes}</div>
    <p class="mini-heading">INDIVIDUAL STROKES (HOLES 1–9)</p><div class="bpg-member-legend">Players' normal scores, before penalties</div><div class="bpg-member-list">${playerRows}</div>
    <p class="team-photo-note">Player photos can be added later.</p></div></details>`;
}
function render() {
  const opened = new Set([...grid.querySelectorAll('details[open]')].map(e=>e.id));
  const hashTarget = decodeURIComponent(location.hash.replace(/^#/,''));
  const done = Math.max(0,Math.min(TOTAL_HOLES, Number(settings.completedHoles||0)));
  const teams = TEAMS.map((t) => ({...t, ...readTeamScore(allTeams[t.id]||{}, t, done)}));
  const ranked = teams.filter(t=>t.hasActivity).sort((a,b)=>a.total-b.total);
  const ranks = new Map(ranked.map((t,i)=>[t.id, ['1st','2nd','3rd'][i]]));
  grid.innerHTML = teams.map(t=>buildCard(t,ranks.get(t.id)||'—')).join('');
  for (const card of grid.querySelectorAll('details')) {
    if (opened.has(card.id) || card.id === hashTarget) card.open=true;
  }
  if (hashTarget && !opened.size) {
    const target=document.getElementById(hashTarget);
    if (target) requestAnimationFrame(()=>target.scrollIntoView({block:'center'}));
  }
}
onValue(ref(database,'teams'), (s)=>{allTeams=s.val()||{};connection.textContent='● Live team scores';connection.classList.remove('error');render();},(e)=>{console.error(e);connection.textContent='Cannot load live scores';connection.classList.add('error');render();});
onValue(ref(database,'settings'),(s)=>{settings={...DEFAULT_SETTINGS,...(s.val()||{})};render();});
render();
