import { ref, onValue } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";
import { database, TEAMS, TOTAL_HOLES, readTeamScore } from "./config.js?v=1";

const grid = document.getElementById("team-grid");
const connection = document.getElementById("teams-connection");
let allTeams = {};

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function initials(name) {
  return String(name).trim().split(/\s+/).map((part) => part[0] || "").slice(0, 2).join("").toUpperCase();
}

function getRows() {
  return TEAMS.map((team) => {
    const record = allTeams[team.id] || {};
    return { ...team, name: record.name || team.name, ...readTeamScore(record) };
  });
}

function buildTeamCard(team, place) {
  const holeEntries = Array.from({ length: TOTAL_HOLES }, (_, index) => {
    const n = index + 1;
    const exists = Object.prototype.hasOwnProperty.call(team.holeScores, n);
    const score = exists ? Number(team.holeScores[n]) : null;
    return `<div class="mini-hole"><span>H${n}</span><strong>${exists && Number.isFinite(score) ? score : '–'}</strong></div>`;
  }).join("");

  const members = team.members.map((name) => `
    <div class="team-member">
      <span class="member-avatar" aria-hidden="true">${escapeHTML(initials(name))}</span>
      <span class="member-name">${escapeHTML(name)}</span>
    </div>
  `).join("");

  return `
    <details class="team-card team-card-${team.id}" id="team-${team.id}" style="--team-accent:${team.colour}">
      <summary class="team-card-summary">
        <div class="team-card-header">
          <span class="team-card-glyph" aria-hidden="true">👥</span>
          <h3>${escapeHTML(team.name)}</h3>
          <span class="team-card-arrow" aria-hidden="true">⌄</span>
        </div>
        <div class="team-members">${members}</div>
        <div class="team-card-bottom">
          <span>4 PLAYERS</span>
          <span>${team.hasActivity ? `${team.total} STROKES` : 'NOT STARTED'}</span>
        </div>
        <div class="team-card-open">Tap to see scores ↓</div>
      </summary>
      <div class="team-card-detail">
        <div class="team-stats">
          <div><span>POSITION</span><strong>${team.hasActivity ? place : '—'}</strong></div>
          <div><span>TOTAL</span><strong>${team.hasActivity ? team.total : '—'}</strong></div>
          <div><span>HOLES</span><strong>${team.holesPlayed}/${TOTAL_HOLES}</strong></div>
        </div>
        <p class="mini-heading">HOLE-BY-HOLE SCORES</p>
        <div class="mini-score-grid">${holeEntries}</div>
        <div class="team-adjustments"><span>Penalties <b>+${team.penalties}</b></span><span>Challenges <b>−${team.challenges}</b></span></div>
        <p class="team-photo-note">Player photos will be added later.</p>
      </div>
    </details>
  `;
}

function render() {
  const opened = new Set(Array.from(grid.querySelectorAll('details[open]')).map((item) => item.id));
  const hashTarget = decodeURIComponent(location.hash.replace(/^#/, ""));
  const rows = getRows();
  const ranked = rows.filter((r) => r.hasActivity).sort((a, b) => a.total - b.total);
  const positionById = new Map(ranked.map((team, index) => [team.id, `${index + 1}${index === 0 ? 'st' : index === 1 ? 'nd' : index === 2 ? 'rd' : 'th'}`]));
  grid.innerHTML = rows.map((team) => buildTeamCard(team, positionById.get(team.id) || '—')).join('');
  for (const card of grid.querySelectorAll('details')) {
    if (opened.has(card.id) || card.id === hashTarget) card.open = true;
  }
  if (hashTarget) {
    const target = document.getElementById(hashTarget);
    if (target && !opened.size) requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }));
  }
}

onValue(ref(database, 'teams'), (snapshot) => {
  allTeams = snapshot.val() || {};
  connection.textContent = '● Live team scores — updated automatically';
  connection.classList.remove('error');
  render();
}, (error) => {
  console.error('Unable to retrieve teams', error);
  connection.textContent = 'Could not connect to live scores. Team names are still available.';
  connection.classList.add('error');
  render();
});

render();
