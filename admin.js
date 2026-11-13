// Broadgate Pub Golf — mobile-first ref dashboard (3 teams, 14 individual players).
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { ref, get, set, update, push, onValue } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";
import {
  app, database, TEAMS, HOLES, TOTAL_HOLES, DEFAULT_SETTINGS,
  SCHEMA_VERSION, readTeamScore, holeBreakdown, playerKey, formatScore, hasOwn
} from "./config.js?v=8";

const REF_UID = "gRcDNNx5uVeDNuy0gBzumMBgCJr1";
const auth = getAuth(app);
const teamsRef = ref(database, 'teams');
const settingsRef = ref(database, 'settings');
const historyRef = ref(database, 'history');
const undoRef = ref(database, 'undo/lastAction');
const rootRef = ref(database);
const $ = (id) => document.getElementById(id);
const ui = {
  login: $('ref-login-view'), loginForm: $('ref-login-form'), loginSubmit: $('ref-login-submit'), loginError: $('ref-login-error'),
  email: $('ref-email'), password: $('ref-password'), app: $('ref-app'), setupWarning: $('ref-setup-warning'),
  liveDot: $('ref-live-dot'), liveText: $('ref-live-text'), holeCount: $('ref-hole-count'),
  currentHole: $('ref-current-hole'), currentPub: $('ref-current-pub'), currentDrink: $('ref-current-drink'),
  progressLabel: $('ref-progress-label'), progressFill: $('ref-progress-fill'),
  tabs: $('ref-team-tabs'), inputs: $('ref-team-inputs'), completeness: $('ref-completeness'),
  viewLabel: $('ref-view-label'), holeHelp: $('ref-hole-help'), draftLabel: $('ref-draft-label'),
  prev: $('ref-prev'), next: $('ref-next'), returnCurrent: $('ref-return-current'), save: $('ref-save-scores'),
  saveNext: $('ref-save-next'), complete: $('ref-complete'), feedback: $('ref-action-feedback'),
  sheetBody: $('ref-sheet-body'), sheetFoot: $('ref-sheet-footer'), history: $('ref-history-list'),
  confirm: { overlay: $('ref-confirm-overlay'), form: $('ref-confirm-form'), title: $('ref-confirm-title'),
    message: $('ref-confirm-message'), entryRow: $('ref-confirm-entry-row'), entry: $('ref-confirm-entry'),
    error: $('ref-confirm-error'), accept: $('ref-confirm-accept'), cancel: $('ref-confirm-cancel') },
  penalty: { panel: $('ref-penalty-panel'), form: $('ref-penalty-form'), hole: $('ref-penalty-hole'),
    team: $('ref-penalty-team'), scope: $('ref-penalty-scope'), playerRow: $('ref-penalty-player-row'),
    player: $('ref-penalty-player'), amount: $('ref-penalty-amount'), direction: $('ref-penalty-direction') }
};
const state = {
  teams: {}, settings: { ...DEFAULT_SETTINGS }, history: {}, signedIn: false,
  busy: false, unsubscribers: [], activeTeam: 'blue', viewHole: null, drafts: new Map()
};
const escapeHTML = (v) => String(v).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const current = () => clamp(Number(state.settings.currentHole) || 1, 1, TOTAL_HOLES);
const completed = () => clamp(Number(state.settings.completedHoles) || 0, 0, TOTAL_HOLES);
const viewHole = () => Math.min(current(), state.viewHole || current());
const ready = () => Number(state.settings.schemaVersion) === SCHEMA_VERSION;
const getTeam = (id) => TEAMS.find((team) => team.id === id);
function feedback(text, error = false) {
  ui.feedback.textContent = text;
  ui.feedback.classList.toggle('error', error);
}
function setBusy(flag) {
  state.busy = flag;
  document.querySelectorAll('[data-ref-action]').forEach((element) => element.disabled = flag);
}
async function guarded(action, allowBeforeSetup = false) {
  if (state.busy || !state.signedIn) return;
  if (!ready() && !allowBeforeSetup) {
    feedback('Use Start Fresh Event once to activate the new 3-team format.', true);
    $('ref-more').open = true;
    ui.setupWarning.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  setBusy(true);
  feedback('');
  try { await action(); } catch (error) {
    console.error('Ref action failed:', error);
    feedback(`Could not save: ${error.message}`, true);
  } finally { setBusy(false); }
}

// In-page confirmation sheet, reliable on mobile even after an async Firebase read.
let pendingConfirmation = null;
function finishConfirmation(approved) {
  if (!pendingConfirmation) return;
  const { resolve, requiredText } = pendingConfirmation;
  if (approved && requiredText && ui.confirm.entry.value.trim() !== requiredText) {
    ui.confirm.error.hidden = false; ui.confirm.entry.focus(); return;
  }
  pendingConfirmation = null;
  ui.confirm.overlay.hidden = true;
  ui.confirm.error.hidden = true;
  document.body.classList.remove('ref-modal-open');
  resolve(approved);
}
function requestConfirmation({ title, message, accept, requiredText = null, danger = false }) {
  if (pendingConfirmation) return Promise.resolve(false);
  ui.confirm.title.textContent = title;
  ui.confirm.message.textContent = message;
  ui.confirm.accept.textContent = accept;
  ui.confirm.accept.classList.toggle('ref-confirm-danger', danger);
  ui.confirm.entryRow.hidden = !requiredText;
  ui.confirm.entry.value = '';
  ui.confirm.error.hidden = true;
  ui.confirm.overlay.hidden = false;
  document.body.classList.add('ref-modal-open');
  return new Promise((resolve) => { pendingConfirmation = { resolve, requiredText }; });
}
ui.confirm.form.addEventListener('submit', (e) => {e.preventDefault();finishConfirmation(true);});
ui.confirm.cancel.addEventListener('click',()=>finishConfirmation(false));
ui.confirm.overlay.addEventListener('click',(e)=>{if(e.target===ui.confirm.overlay)finishConfirmation(false);});
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&pendingConfirmation)finishConfirmation(false);});

// Snapshot before every write. Undo restores scores and official progress together.
async function changeWithUndo(changes, text, type) {
  const [teamSnap, settingsSnap] = await Promise.all([get(teamsRef), get(settingsRef)]);
  if (!teamSnap.exists() || !settingsSnap.exists()) throw new Error('Event has not been set up.');
  await set(undoRef, {
    kind:'snapshot', description:text,
    beforeTeams:teamSnap.val(), beforeSettings:settingsSnap.val()
  });
  await update(rootRef, changes);
  await push(historyRef, {text, type, time:Date.now()});
  feedback(text);
}
function blankTeams() {
  return Object.fromEntries(TEAMS.map((team)=>[team.id, {name:team.name,holesPlayed:0}]));
}
async function initialiseEvent() {
  const [settings, teams] = await Promise.all([get(settingsRef),get(teamsRef)]);
  if (!settings.exists() && !teams.exists()) {
    await update(rootRef,{settings:DEFAULT_SETTINGS,teams:blankTeams()});
  } else if (!settings.exists()) {
    await set(settingsRef, DEFAULT_SETTINGS);
  }
}
function stopListeners(){state.unsubscribers.forEach((f)=>f());state.unsubscribers=[];}
function listen() {
  stopListeners();
  state.unsubscribers.push(onValue(teamsRef,(s)=>{state.teams=s.val()||{};render();},connectionError));
  state.unsubscribers.push(onValue(settingsRef,(s)=>{state.settings={...DEFAULT_SETTINGS,...(s.val()||{}),schemaVersion:Number(s.val()?.schemaVersion||0)};
    // Preserve the previous view when editing; fall back to current after progression.
    if (state.viewHole && state.viewHole>current()) state.viewHole=null;
    render();},connectionError));
  state.unsubscribers.push(onValue(historyRef,(s)=>{state.history=s.val()||{};renderHistory();},connectionError));
}
function connectionError(error){console.error(error);ui.liveText.textContent='Connection error';ui.liveDot.className='live-dot offline';feedback('Connection error. Check your internet.',true);}

const draftKey = (hole, teamId, name) => `${hole}:${teamId}:${playerKey(name)}`;
function scoreValue(hole, teamId, name) {
  const key = draftKey(hole,teamId,name);
  if (state.drafts.has(key)) return state.drafts.get(key);
  const stored=state.teams[teamId]?.playerScores?.[hole] || {};
  const k=playerKey(name);
  return hasOwn(stored,k)?String(stored[k]):'';
}
function parseScores(hole) {
  const changes={};
  const missing=[];
  TEAMS.forEach((team)=>team.members.forEach((name)=>{
    const raw=scoreValue(hole,team.id,name).trim();
    if (raw==='') {missing.push(`${name} (${team.short})`);return;}
    const n=Number(raw);
    if (!Number.isInteger(n)||n<0||n>999) throw new Error(`${name}: enter a whole-number score between 0 and 999.`);
    const old=state.teams[team.id]?.playerScores?.[hole]||{};
    const member=playerKey(name);
    if (!hasOwn(old,member)||Number(old[member])!==n) changes[`teams/${team.id}/playerScores/${hole}/${member}`]=n;
  }));
  return {changes,missing};
}
function storedOrDraftCount(hole, team) {
  return team.members.filter((name)=>{
    const v=scoreValue(hole,team.id,name).trim();
    return v!=='' && Number.isInteger(Number(v)) && Number(v)>=0;
  }).length;
}
function updateCompletion() {
  const hole=viewHole();
  const entered=TEAMS.reduce((n,t)=>n+storedOrDraftCount(hole,t),0);
  ui.completeness.textContent=`${entered} / 14`;
  ui.draftLabel.textContent=state.drafts.size ? 'Unsaved changes are kept while you switch teams.' : '';
  ui.complete.disabled=state.busy||hole!==current()||completed()>=TOTAL_HOLES||entered!==14||!ready();
}
function renderHero() {
  const hole=viewHole();
  const done=completed();
  const viewingPast=hole<current();
  ui.setupWarning.hidden=ready();
  ui.liveDot.className='live-dot';ui.liveText.textContent='Live ref control';
  ui.currentHole.textContent=String(hole).padStart(2,'0');
  ui.holeCount.textContent=done>=TOTAL_HOLES?'EVENT COMPLETE':viewingPast?`REVIEWING HOLE ${hole}`:`HOLE ${current()} OF ${TOTAL_HOLES}`;
  ui.currentPub.textContent=HOLES[hole-1].pub;
  ui.currentDrink.textContent=HOLES[hole-1].drink;
  ui.progressLabel.textContent=`${done} / ${TOTAL_HOLES} officially completed`;
  ui.progressFill.style.width=`${done/TOTAL_HOLES*100}%`;
  ui.prev.disabled=hole===1;
  ui.next.disabled=hole>=current();
  ui.returnCurrent.hidden=!viewingPast;
  ui.viewLabel.textContent=`HOLE ${hole} / ${TOTAL_HOLES}`;
  ui.holeHelp.textContent=viewingPast?'Review or correct earlier scores. The official current hole will not change.':
    done>=TOTAL_HOLES?'Event complete — previous holes remain editable.':
    'Enter individual strokes: tap + / − or type a number. Switch teams to enter all 14.';
  ui.complete.textContent=current()===TOTAL_HOLES?'✓ COMPLETE FINAL HOLE':'✓ COMPLETE HOLE & MOVE ON';
  if (viewingPast || done>=TOTAL_HOLES) ui.complete.hidden=true;
  else ui.complete.hidden=false;
  updateCompletion();
}
function renderTabs() {
  const hole=viewHole();
  ui.tabs.innerHTML=TEAMS.map((team)=>{
    const count=storedOrDraftCount(hole,team);
    return `<button type="button" class="bpg-team-tab ${state.activeTeam===team.id?'is-selected':''} bpg-team-${team.id}" data-select-team="${team.id}" aria-pressed="${state.activeTeam===team.id}"><span class="bpg-team-swatch"></span><strong>${team.short}</strong><small>${count}/${team.members.length}</small></button>`;
  }).join('');
}
function renderInputs() {
  const hole=viewHole();
  const team=getTeam(state.activeTeam)||TEAMS[0];
  ui.inputs.innerHTML=`<div class="bpg-inputs-heading"><strong>${team.name}</strong><span>${team.members.length} players</span></div>`+
    team.members.map((name)=>{
      const value=scoreValue(hole,team.id,name);
      return `<div class="bpg-player-row"><label for="player-${playerKey(name)}">${escapeHTML(name)}</label><div class="bpg-player-stepper">
        <button type="button" data-step="-1" data-person="${playerKey(name)}" aria-label="Decrease ${escapeHTML(name)} score">−</button>
        <input id="player-${playerKey(name)}" data-player="${playerKey(name)}" type="number" min="0" max="999" step="1" inputmode="numeric" placeholder="—" value="${escapeHTML(value)}" aria-label="${escapeHTML(name)} strokes" />
        <button type="button" data-step="1" data-person="${playerKey(name)}" aria-label="Increase ${escapeHTML(name)} score">+</button>
      </div></div>`;
    }).join('');
  const progress=team.members.filter(n=>scoreValue(hole,team.id,n).trim()!=='').length;
  const scores=team.members.map(n=>scoreValue(hole,team.id,n));
  const avg=scores.every(v=>v!==''&&Number.isFinite(Number(v)))?scores.reduce((s,v)=>s+Number(v),0)/team.members.length:null;
  ui.inputs.insertAdjacentHTML('beforeend',`<div class="bpg-team-average"><span>Raw team average</span><strong id="ref-raw-average">${avg===null?'–':formatScore(avg)}</strong></div>`);
}
function renderScorecard() {
  const done=completed();
  ui.sheetBody.innerHTML=HOLES.map((hole)=>{
    const isCurrent=hole.number===current()&&done<TOTAL_HOLES;
    return `<tr class="${isCurrent?'ref-sheet-current':''} ${hole.number<=done?'ref-sheet-done':''}"><th scope="row"><span class="ref-sheet-number">${hole.number}</span><span class="ref-sheet-stop"><strong>${escapeHTML(hole.pub)}</strong><small>${escapeHTML(hole.drink)}</small></span></th>
      ${TEAMS.map((team)=>{
        const p=holeBreakdown(state.teams[team.id]||{},team,hole.number);
        return `<td><button type="button" class="ref-cell-button" data-jump-team="${team.id}" data-jump-hole="${hole.number}" aria-label="Edit ${escapeHTML(team.name)} Hole ${hole.number}">${p.complete?formatScore(p.average):p.entered?`${p.entered}/${p.count}`:'–'}</button></td>`;
      }).join('')}</tr>`;
  }).join('');
  ui.sheetFoot.innerHTML=`<tr class="ref-sheet-total"><th scope="row">TOTAL</th>${TEAMS.map((team)=>{
    const r=readTeamScore(state.teams[team.id]||{},team,done);
    return `<td>${r.hasActivity?formatScore(r.total):'–'}</td>`;
  }).join('')}</tr>`;
}
function renderHistory() {
  const items=Object.values(state.history).filter(Boolean).sort((a,b)=>Number(b.time||0)-Number(a.time||0)).slice(0,12);
  ui.history.innerHTML=items.length?items.map((entry)=>`<div class="ref-history-entry"><span class="ref-history-marker">●</span><span>${escapeHTML(entry.text||'Event update')}</span><time>${entry.time?new Date(entry.time).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):''}</time></div>`).join(''):'<p class="ref-hint">No activity yet.</p>';
}
function render() {
  if (!state.signedIn) return;
  renderHero();
  renderTabs();
  // Preserve the keyboard and user's in-progress typing during live Firebase updates.
  if (!ui.inputs.contains(document.activeElement)) renderInputs();
  renderScorecard();renderHistory();
}
function refreshInputs(){renderTabs();renderInputs();updateCompletion();}
ui.tabs.addEventListener('click',(e)=>{
  const button=e.target.closest('[data-select-team]');if(!button)return;
  state.activeTeam=button.dataset.selectTeam;
  refreshInputs();
});
ui.inputs.addEventListener('input',(e)=>{
  const input=e.target.closest('input[data-player]');if(!input)return;
  const team=getTeam(state.activeTeam);
  const name=team.members.find(n=>playerKey(n)===input.dataset.player);
  if(!name)return;
  state.drafts.set(draftKey(viewHole(),team.id,name),input.value);
  updateCompletion();
  renderTabs();
  const values=team.members.map(n=>scoreValue(viewHole(),team.id,n));
  const avg=values.every(v=>v!==''&&Number.isFinite(Number(v)))?values.reduce((a,v)=>a+Number(v),0)/team.members.length:null;
  const el=$('ref-raw-average');if(el)el.textContent=avg===null?'–':formatScore(avg);
});
ui.inputs.addEventListener('click',(e)=>{
  const button=e.target.closest('button[data-step]');if(!button)return;
  const input=$(`player-${button.dataset.person}`);if(!input)return;
  const n=input.value===''?0:Number(input.value);
  input.value=String(clamp((Number.isFinite(n)?n:0)+Number(button.dataset.step),0,999));
  input.dispatchEvent(new Event('input',{bubbles:true}));
});
function changeView(hole,teamId=state.activeTeam) {
  state.viewHole=hole===current()?null:hole;
  state.activeTeam=teamId;
  renderHero();refreshInputs();renderScorecard();
}
ui.prev.addEventListener('click',()=>changeView(Math.max(1,viewHole()-1)));
ui.next.addEventListener('click',()=>changeView(Math.min(current(),viewHole()+1)));
ui.returnCurrent.addEventListener('click',()=>changeView(current()));
ui.sheetBody.addEventListener('click',(e)=>{
  const cell=e.target.closest('button[data-jump-hole]');if(!cell)return;
  changeView(Number(cell.dataset.jumpHole),cell.dataset.jumpTeam);
  $('ref-entry').scrollIntoView({behavior:'smooth',block:'start'});
});
function clearDrafts(hole) {
  for(const key of [...state.drafts.keys()])if(key.startsWith(`${hole}:`))state.drafts.delete(key);
}
async function saveScores() {
  const hole=viewHole();
  const {changes}=parseScores(hole);
  if(!Object.keys(changes).length){feedback('No new scores to save.');return;}
  await changeWithUndo(changes,`Hole ${hole}: player scores saved`,'strokes');
  clearDrafts(hole);
  refreshInputs();
}
ui.save.addEventListener('click',()=>guarded(saveScores));
ui.saveNext.addEventListener('click',()=>guarded(async()=>{
  await saveScores();
  const i=TEAMS.findIndex(t=>t.id===state.activeTeam);
  state.activeTeam=TEAMS[(i+1)%TEAMS.length].id;
  refreshInputs();
}));
ui.complete.addEventListener('click',()=>guarded(async()=>{
  if(viewHole()!==current())throw new Error('Return to the current hole first.');
  if(completed()>=TOTAL_HOLES)throw new Error('The event is finished.');
  const hole=current();
  const {changes,missing}=parseScores(hole);
  if(missing.length)throw new Error(`Missing scores: ${missing.join(', ')}`);
  changes['settings/completedHoles']=hole;
  changes['settings/currentHole']=Math.min(TOTAL_HOLES,hole+1);
  TEAMS.forEach(t=>{changes[`teams/${t.id}/holesPlayed`]=hole;});
  await changeWithUndo(changes,hole===TOTAL_HOLES?'Final hole completed':`Hole ${hole} completed — moved to Hole ${hole+1}`,'hole');
  clearDrafts(hole);
  state.viewHole=null;
  state.activeTeam='blue';
  refreshInputs();
}));

// Optional penalty form stays hidden during everyday scoring.
function updatePenaltyPlayers() {
  const team=getTeam(ui.penalty.team.value)||TEAMS[0];
  ui.penalty.player.innerHTML=team.members.map((n)=>`<option value="${playerKey(n)}">${escapeHTML(n)}</option>`).join('');
  ui.penalty.playerRow.hidden=ui.penalty.scope.value==='team';
}
function initialisePenaltyForm() {
  ui.penalty.hole.innerHTML=HOLES.map(h=>`<option value="${h.number}">Hole ${h.number} — ${escapeHTML(h.pub)}</option>`).join('');
  ui.penalty.hole.value=String(viewHole());
  ui.penalty.team.innerHTML=TEAMS.map(t=>`<option value="${t.id}">${escapeHTML(t.name)}</option>`).join('');
  ui.penalty.team.value=state.activeTeam;
  ui.penalty.scope.value='player';
  ui.penalty.amount.value='1';ui.penalty.direction.value='add';
  updatePenaltyPlayers();
}
$('ref-show-penalties').addEventListener('click',()=>{
  const opening=ui.penalty.panel.hidden;
  ui.penalty.panel.hidden=!opening;
  if(opening)initialisePenaltyForm();
});
ui.penalty.team.addEventListener('change',updatePenaltyPlayers);
ui.penalty.scope.addEventListener('change',updatePenaltyPlayers);
ui.penalty.form.addEventListener('submit',(e)=>{e.preventDefault();guarded(async()=>{
  const teamId=ui.penalty.team.value;
  const team=getTeam(teamId);
  const hole=Number(ui.penalty.hole.value);
  const amount=Number(ui.penalty.amount.value);
  if(!team||!Number.isInteger(hole)||hole<1||hole>TOTAL_HOLES)throw new Error('Choose a valid team and hole.');
  if(!Number.isInteger(amount)||amount<1||amount>99)throw new Error('Enter 1–99 penalty strokes.');
  const person=ui.penalty.player.value;
  const isPlayer=ui.penalty.scope.value==='player';
  if(isPlayer&&!team.members.some(n=>playerKey(n)===person))throw new Error('Choose a player.');
  const path=isPlayer?`playerPenalties/${hole}/${person}`:`teamPenalties/${hole}`;
  const oldRecord=state.teams[teamId]||{};
  const old=isPlayer?Number(oldRecord.playerPenalties?.[hole]?.[person]||0):Number(oldRecord.teamPenalties?.[hole]||0);
  const next=old+(ui.penalty.direction.value==='remove'?-amount:amount);
  if(next<0)throw new Error(`There are only ${old} penalty strokes to remove.`);
  const name=isPlayer?team.members.find(n=>playerKey(n)===person):'whole team';
  const change=ui.penalty.direction.value==='remove'?'removed from':'added to';
  await changeWithUndo({[`teams/${teamId}/${path}`]:next===0?null:next},
    `${team.name}: ${amount} penalty stroke(s) ${change} ${name} on Hole ${hole}`,'penalty');
  ui.penalty.panel.hidden=true;
});});
$('ref-undo').addEventListener('click',()=>guarded(async()=>{
  const snapshot=await get(undoRef);
  const undo=snapshot.val();
  if(!undo){feedback('There is nothing to undo.');return;}
  if(undo.kind!=='snapshot'||!undo.beforeTeams||!undo.beforeSettings)throw new Error('Undo data is incomplete.');
  const approved=await requestConfirmation({title:'Undo last action?',message:undo.description||'Reverse the latest change',accept:'YES, UNDO'});
  if(!approved)return;
  await update(rootRef,{teams:undo.beforeTeams,settings:undo.beforeSettings,'undo/lastAction':null});
  state.drafts.clear();state.viewHole=null;
  await push(historyRef,{text:`Undo: ${undo.description||'last action'}`,type:'undo',time:Date.now()});
  feedback('Last action reversed.');
}));
$('ref-reset-scores').addEventListener('click',()=>guarded(async()=>{
  const approved=await requestConfirmation({title:'Reset scores and progress?',message:'Clear all team scores and return to Hole 1. You can undo this immediately.',accept:'RESET SCORES',danger:true});
  if(!approved)return;
  await changeWithUndo({teams:blankTeams(),settings:DEFAULT_SETTINGS},'Scores and progress reset','reset');
  state.drafts.clear();state.viewHole=null;state.activeTeam='blue';
}));
$('ref-full-reset').addEventListener('click',()=>guarded(async()=>{
  const approved=await requestConfirmation({title:'Start fresh with 3 teams?',message:'Replace the old 4-team setup with Blue, Black and Red. Clear ALL old scores, progress, history and Undo. Type RESET below.',accept:'START FRESH EVENT',requiredText:'RESET',danger:true});
  if(!approved)return;
  await update(rootRef,{teams:blankTeams(),settings:DEFAULT_SETTINGS,history:null,'undo/lastAction':null});
  state.drafts.clear();state.viewHole=null;state.activeTeam='blue';
  feedback('Fresh 3-team event ready.');
},true));

ui.loginForm.addEventListener('submit',async(e)=>{
  e.preventDefault();ui.loginError.hidden=true;ui.loginSubmit.disabled=true;
  try{
    const credential=await signInWithEmailAndPassword(auth,ui.email.value.trim(),ui.password.value);
    if(credential.user.uid!==REF_UID){await signOut(auth);throw new Error('Unauthorised account');}
    ui.password.value='';
  }catch(error){console.error(error);ui.loginError.hidden=false;ui.loginError.textContent='Could not sign in. Check your ref email and password.';}
  finally{ui.loginSubmit.disabled=false;}
});
$('ref-signout').addEventListener('click',()=>signOut(auth));
onAuthStateChanged(auth,async(user)=>{
  stopListeners();state.signedIn=false;
  ui.login.hidden=false;ui.app.hidden=true;
  if(!user||user.uid!==REF_UID){if(user&&user.uid!==REF_UID)await signOut(auth);return;}
  try{
    await initialiseEvent();state.signedIn=true;ui.login.hidden=true;ui.app.hidden=false;
    listen();render();
  }catch(error){console.error(error);ui.loginError.hidden=false;ui.loginError.textContent='Could not initialise the dashboard. Check your Firebase rules and account.';}
});
