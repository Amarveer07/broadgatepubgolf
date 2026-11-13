import { ref, onValue } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";
import { database, HOLES, TOTAL_HOLES, DEFAULT_SETTINGS } from "./config.js?v=8";

// The public route is read-only. Ref score changes are published through Firebase.
const list = document.getElementById('route-list');
const number = document.getElementById('route-current-number');
const pub = document.getElementById('route-current-pub');
const drink = document.getElementById('route-current-drink');
const caption = document.getElementById('route-progress-caption');
const progress = document.getElementById('route-progress-bar');
const connection = document.getElementById('route-connection');
const connectionText = document.getElementById('route-connection-text');

const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])
);
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function showRoute(settings) {
  const current = clamp(Number(settings.currentHole) || 1, 1, TOTAL_HOLES);
  const completed = clamp(Number(settings.completedHoles) || 0, 0, TOTAL_HOLES);
  const finished = completed >= TOTAL_HOLES;
  const stop = HOLES[current - 1];

  number.textContent = finished ? '09' : String(current).padStart(2, '0');
  pub.textContent = finished ? 'All nine holes completed!' : stop.pub;
  drink.textContent = finished ? 'Final results are in' : stop.drink;
  caption.textContent = `${completed} / ${TOTAL_HOLES} completed`;
  progress.setAttribute('aria-label', `Event progress, ${completed} of ${TOTAL_HOLES} holes completed`);
  progress.firstElementChild.style.width = `${(completed / TOTAL_HOLES) * 100}%`;

  list.innerHTML = HOLES.map((hole) => {
    const isDone = hole.number <= completed;
    const isCurrent = !finished && hole.number === current;
    const status = isDone ? 'COMPLETED' : isCurrent ? 'CURRENT' : 'UPCOMING';
    const css = isDone ? 'is-done' : isCurrent ? 'is-current' : 'is-upcoming';
    const statusCss = isDone ? 'route-status-done' : isCurrent ? 'route-status-current' : '';
    const label = `${hole.number}. ${hole.pub}: ${hole.drink} — ${status.toLowerCase()}`;
    return `<article class="route-stop ${css}" aria-label="${escapeHTML(label)}">
      <div class="route-stop-number" aria-hidden="true">${isDone ? '✓' : String(hole.number).padStart(2, '0')}</div>
      <div class="route-stop-content">
        <div class="route-stop-upper"><span class="route-stop-hole">HOLE ${String(hole.number).padStart(2,'0')}</span><span class="route-status ${statusCss}">${status}</span></div>
        <h3>${escapeHTML(hole.pub)}</h3>
        <p><span aria-hidden="true">🍺</span> ${escapeHTML(hole.drink)}</p>
      </div>
    </article>`;
  }).join('');
}

onValue(ref(database, 'settings'), (snapshot) => {
  const settings = { ...DEFAULT_SETTINGS, ...(snapshot.val() || {}) };
  showRoute(settings);
  connection.classList.remove('is-error');
  connectionText.textContent = 'Live route';
  connection.querySelector('.live-dot').className = 'live-dot';
}, (error) => {
  console.error('Unable to update route:', error);
  connection.classList.add('is-error');
  connectionText.textContent = 'Connection unavailable';
  connection.querySelector('.live-dot').className = 'live-dot offline';
});

// Show the planned stops immediately, before the first network result arrives.
showRoute(DEFAULT_SETTINGS);
