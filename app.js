import { mergeChampionships } from './sync.mjs';
import {
  GENERATIONS,
  generationLabel,
  FORMATS,
  formatLabel,
  SCORINGS,
  scoringSummary,
  championshipInitials,
  WIN_POINT_CHOICES,
  DEFAULT_WIN_POINTS,
  DEFAULT_NAME,
  isFreeForAll,
  teamSize,
  orderedSports,
  matchesForSport,
  matchesPerSport,
  pedroNeeded,
  sportsToCoverEveryone,
  pairCoverage,
  playersSittingOut,
  buildProgramme,
  buildAllProgrammes,
  createMatch,
  validateSides,
  pedroMatches,
  standInsOf,
  isStandIn,
  entrantsOf,
  addPlayer,
  addStandIn,
  removeEntrant,
  matchesWith,
  sportProgress,
  upgradeTime,
  DEFAULT_STAND_IN,
  winningSide,
  standings,
  nextUnplayed,
  progress,
  migrateState,
  STATE_VERSION,
} from './tournament.js';

/* Shown at the foot of the menu. When something is reported as still broken,
   this is the first thing to ask for: it says whether the fix ever arrived. */
const APP_VERSION = 13;
const APP_DATE = '25 Jul 2026';

const LIBRARY_KEY = 'dadchamps.library.v1';
const LEGACY_STATE_KEYS = ['dadchamps.state.v3', 'dadchamps.state.v2'];
const DRAFT_KEY = 'dadchamps.draft.v3';

const SPORT_SUGGESTIONS = [
  'Padel', 'Darts', 'Bowling', 'Table tennis', 'Mini golf', 'Pool',
  'Badminton', 'Basketball shootout', 'Shuffleboard', 'Boules',
];

const OTHER = '__other';

const LIMITS = {
  sports: { min: 1, max: 10 },
  players: { min: 2, max: 20 },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ----------------------------- persistence ----------------------------- */
/* Everything lives on the phone that keeps score: it survives a refresh, a
   restart and a day with no signal. The phone keeps a library rather than a
   single championship, so last summer's is still there when you start this
   year's. The store is migrated in place on load, so an app update never
   costs you a running championship.                                         */

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full storage — the app still works for this session */
  }
}

function newChampionshipId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The library: every championship this phone has kept, newest touched first,
 * and which one is open. A championship saved by a one-at-a-time version of
 * the app is taken over as the first entry.
 */
function loadLibrary() {
  const saved = load(LIBRARY_KEY, null);
  const list = [];

  if (saved && Array.isArray(saved.championships)) {
    for (const entry of saved.championships) {
      const migrated = migrateState(entry);
      if (!migrated) continue;
      migrated.id = entry.id || newChampionshipId();
      migrated.updatedAt = entry.updatedAt || migrated.createdAt || null;
      list.push(migrated);
    }
    return { version: 1, currentId: saved.currentId || (list[0] && list[0].id) || null, championships: list };
  }

  for (const key of LEGACY_STATE_KEYS) {
    const migrated = migrateState(load(key, null));
    if (!migrated) continue;
    migrated.id = newChampionshipId();
    migrated.updatedAt = migrated.createdAt || null;
    list.push(migrated);
    break;
  }
  const library = { version: 1, currentId: list.length ? list[0].id : null, championships: list };
  if (list.length) save(LIBRARY_KEY, library);
  return library;
}

/* -------------------------------- state -------------------------------- */

let library = loadLibrary();
let state = library.championships.find((c) => c.id === library.currentId) || null;

let draft = load(DRAFT_KEY, null) || {
  step: 1,
  name: '',
  playerCount: 4,
  playerNames: ['', '', '', ''],
  playerGenerations: ['dad', 'dad', 'granddad', 'kid'],
  sportCount: 3,
  sportNames: SPORT_SUGGESTIONS.slice(0, 3),
  sportCustom: [false, false, false],
  sportFormats: ['1v1', '1v1', '1v1'],
  sportScorings: ['match', 'match', 'match'],
  sportWinPoints: [3, 3, 3],
};

let view = 'sports';
let openSportId = null;
let tableFilter = 'all';
let editingSportId = null;
let editing = null; // the match being edited
let newSport = null; // the sport being added mid-championship

const saveLibrary = () => save(LIBRARY_KEY, library);

/** Every write to the open championship goes through here, so the library
    always holds it and the list stays in "last touched first" order.        */
/** A change to the field itself — the name, the players, the sports. */
function touchField() {
  if (state) state.metaAt = new Date().toISOString();
}

/** A change to one match, so the merge can tell whose result is newer. */
function touchMatch(match) {
  if (match) match.updatedAt = new Date().toISOString();
}

/** A thing taken out, remembered so it cannot come back from another phone. */
function rememberRemoved(...ids) {
  if (!state) return;
  state.removed = state.removed || {};
  const now = new Date().toISOString();
  for (const id of ids) state.removed[id] = now;
}

function saveState() {
  if (!state) return saveLibrary();
  state.updatedAt = new Date().toISOString();
  library.championships = [state, ...library.championships.filter((c) => c.id !== state.id)];
  library.currentId = state.id;
  saveLibrary();
  if (typeof pushSoon === 'function') pushSoon();
}

const saveDraft = () => save(DRAFT_KEY, draft);

/* ------------------------------- helpers ------------------------------- */

function playerOf(playerId) {
  return state.players.find((p) => p.id === playerId);
}

/** A name for anybody who can be in a match — a player or a stand-in. */
function nameOf(playerId) {
  const entrant = entrantsOf(state).find((e) => e.id === playerId);
  return entrant ? entrant.name : '?';
}

function teamHtml(players) {
  return players.map((id) => escapeHtml(nameOf(id))).join(' <span class="and">&</span> ');
}

function teamText(players) {
  return players.map((id) => nameOf(id)).join(' & ');
}

function sportOf(sportId) {
  return state.sports.find((s) => s.id === sportId);
}

function sportName(sportId) {
  const sport = sportOf(sportId);
  return sport ? sport.name : '';
}

function matchOf(matchId) {
  return state.matches.find((m) => m.id === matchId);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** A select, drawn as a control rather than a browser default. */
function selectHtml({ id = '', attr = '', options, value, extra = '' }) {
  const opts = options
    .map(
      (o) =>
        `<option value="${escapeHtml(o.value)}"${
          String(o.value) === String(value) ? ' selected' : ''
        }>${escapeHtml(o.label)}</option>`
    )
    .join('');
  return `<span class="sel ${extra}">
    <select ${id ? `id="${id}"` : ''} ${attr}>${opts}</select>
  </span>`;
}

function countOptions(kind, noun) {
  const { min, max } = LIMITS[kind];
  return Array.from({ length: max - min + 1 }, (_, i) => ({
    value: String(min + i),
    label: `${min + i} ${noun}${min + i === 1 ? '' : 's'}`,
  }));
}

const FORMAT_OPTIONS = FORMATS.map((f) => ({ value: f.id, label: f.label }));
const FORMAT_OPTIONS_LONG = FORMATS.map((f) => ({ value: f.id, label: `${f.label} — ${f.note}` }));
const SCORING_OPTIONS = SCORINGS.map((s) => ({ value: s.id, label: s.label }));
const SCORING_OPTIONS_LONG = SCORINGS.map((s) => ({ value: s.id, label: `${s.label} — ${s.note}` }));
const WIN_POINT_OPTIONS = WIN_POINT_CHOICES.map((n) => ({
  value: String(n),
  label: `Winner gets ${n}`,
}));
const SPORT_NAME_OPTIONS = [
  ...SPORT_SUGGESTIONS.map((s) => ({ value: s, label: s })),
  { value: OTHER, label: 'Other sport…' },
];
const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];

/** Brass, silver and bronze discs for the podium; a plain numeral below it. */
function medal(rank) {
  const cls = rank <= 3 ? `medal medal-${rank}` : 'medal medal-plain';
  return `<span class="${cls}">${rank}</span>`;
}

function genTag(generation) {
  return `<span class="gen gen-${generation}">${escapeHtml(generationLabel(generation))}</span>`;
}

const TROPHY_SVG = `
  <svg class="cup" width="98" height="98" viewBox="0 0 512 512" aria-hidden="true">
    <defs><linearGradient id="brass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d8ab4a"/><stop offset="1" stop-color="#8a6318"/>
    </linearGradient></defs>
    <g fill="none" stroke="url(#brass)" stroke-width="20">
      <path d="M148 132 a52 52 0 1 0 14 88"/>
      <path d="M364 132 a52 52 0 1 1 -14 88"/>
    </g>
    <path fill="url(#brass)"
          d="M158 122 h196 v54 c0 64-32 118-78 130 v46 h24 v18 h30 v30 h-148 v-30 h30 v-18 h24 v-46 c-46-12-78-66-78-130z"/>
  </svg>`;

/**
 * The crest: a court-blue shield with a brass rule and the championship's own
 * monogram, drawn from its name. Every instance needs its own gradient ids.
 */
function crestSvg(name, size = 44, key = 'a') {
  const initials = championshipInitials(name);
  const fontSize = initials.length >= 3 ? 13 : 16.5;
  return `
  <svg class="crest" width="${size}" height="${size}" viewBox="0 0 48 52" aria-hidden="true">
    <defs>
      <linearGradient id="court-${key}" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stop-color="#2f80e8"/><stop offset="1" stop-color="#0e458f"/>
      </linearGradient>
      <linearGradient id="brass-${key}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#e2bd6b"/><stop offset="0.5" stop-color="#a97c22"/>
        <stop offset="1" stop-color="#e2bd6b"/>
      </linearGradient>
    </defs>
    <path d="M24 1.5 L45 7.5 v18.5 C45 38 36 46 24 50.5 12 46 3 38 3 26 V7.5 Z"
          fill="url(#court-${key})"/>
    <path d="M24 5 L41.5 10 v16 C41.5 36 34 43 24 47 14 43 6.5 36 6.5 26 V10 Z"
          fill="none" stroke="url(#brass-${key})" stroke-width="1.1" opacity="0.95"/>
    <text x="24" y="27" text-anchor="middle" font-size="${fontSize}" font-weight="700"
          letter-spacing="0.6" fill="#fff"
          font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
          >${escapeHtml(initials)}</text>
    <path d="M15 33 h18" stroke="url(#brass-${key})" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="24" cy="38.5" r="2" fill="url(#brass-${key})"/>
  </svg>`;
}

/* ---------------------------- a booked time ----------------------------- */
/* A booked time is a day and a clock time, because a championship can run over
   a weekend. On screen the day is said the way you would say it out loud. */

const DAY_MS = 86400000;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * "Today 14:30", "Tomorrow 09:00", "Sat 26 Jul 14:30" — and with short: true,
 * just enough to fit the chip in the sports list.
 */
function whenLabel(value, { short = false } = {}) {
  if (!value) return '';
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return String(value);

  const clock = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const days = Math.round((startOfDay(when) - startOfDay(new Date())) / DAY_MS);
  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Tomorrow ${clock}`;
  if (days === -1) return `Yesterday ${clock}`;

  const day = when.toLocaleDateString([], short ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} ${clock}`;
}

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ============================ ASKING YES OR NO ========================== */
/* The browser's own confirm box is not shown at all in a web app that has
   been added to the home screen, which silently killed every button behind
   one. The app asks for itself instead, in the same sheet as everything else. */

let confirmResolve = null;

function ask(title, { body = '', yes = 'Yes', danger = false } = {}) {
  $('#confirm-title').textContent = title;
  $('#confirm-body').textContent = body;
  $('#confirm-body').hidden = !body;
  const yesBtn = $('#confirm-yes');
  yesBtn.textContent = yes;
  yesBtn.classList.toggle('danger', danger);
  yesBtn.classList.toggle('primary', !danger);
  $('#confirm-sheet').hidden = false;

  return new Promise((resolve) => {
    confirmResolve = (answer) => {
      confirmResolve = null;
      $('#confirm-sheet').hidden = true;
      resolve(answer);
    };
  });
}

/* ================================ SETUP ================================ */

function renderSetup() {
  $$('#stepper li').forEach((li) => {
    const step = Number(li.dataset.step);
    li.classList.toggle('active', step === draft.step);
    li.classList.toggle('done', step < draft.step);
  });
  $$('.step').forEach((el) => { el.hidden = Number(el.dataset.step) !== draft.step; });

  const nameInput = $('#champ-name-input');
  if (nameInput.value !== draft.name) nameInput.value = draft.name || '';
  $('#crest-preview').innerHTML = crestSvg(draft.name || DEFAULT_NAME, 52, 'setup');

  $('#players-count-field').innerHTML = selectHtml({
    attr: 'data-count="players"',
    options: countOptions('players', 'player'),
    value: String(draft.playerCount),
    extra: 'sel-big',
  });
  $('#sports-count-field').innerHTML = selectHtml({
    attr: 'data-count="sports"',
    options: countOptions('sports', 'sport'),
    value: String(draft.sportCount),
    extra: 'sel-big',
  });

  renderPlayerRows();
  renderSportRows();
  renderPreview();
}

function renderPlayerRows() {
  const container = $('#player-names');
  container.innerHTML = '';
  for (let i = 0; i < draft.playerCount; i++) {
    const generation = draft.playerGenerations[i] || 'dad';
    const row = document.createElement('div');
    row.className = 'name-row';
    row.innerHTML = `
      <span class="badge">${i + 1}</span>
      <input type="text" data-kind="player" data-index="${i}"
             value="${escapeHtml(draft.playerNames[i] || '')}"
             placeholder="Name ${i + 1}"
             enterkeyhint="next"
             autocapitalize="words" autocomplete="off" spellcheck="false">
      ${selectHtml({
        attr: `data-gen-index="${i}" aria-label="Generation"`,
        options: GENERATIONS.map((g) => ({ value: g.id, label: g.label })),
        value: generation,
        extra: `sel-gen gen-${generation}`,
      })}`;
    container.appendChild(row);
  }
}

function renderSportRows() {
  const container = $('#sport-rows');
  container.innerHTML = '';
  for (let i = 0; i < draft.sportCount; i++) {
    const custom = Boolean(draft.sportCustom[i]);
    const name = draft.sportNames[i] || '';
    const format = draft.sportFormats[i] || '1v1';
    const scoring = draft.sportScorings[i] || 'match';
    const winPoints = draft.sportWinPoints[i] || DEFAULT_WIN_POINTS;
    const matches = matchesPerSport(draft.playerCount, format);

    const row = document.createElement('div');
    row.className = 'sport-row';
    row.innerHTML = `
      ${selectHtml({
        attr: `data-sport-index="${i}" aria-label="Sport ${i + 1}"`,
        options: SPORT_NAME_OPTIONS,
        value: custom ? OTHER : name,
        extra: 'sel-title',
      })}
      ${
        custom
          ? `<input type="text" data-kind="sport" data-index="${i}" class="custom-name"
                    value="${escapeHtml(name)}" placeholder="Name the sport"
                    autocapitalize="words" autocomplete="off" spellcheck="false">`
          : ''
      }
      <div class="sport-row-controls">
        ${selectHtml({
          attr: `data-format-index="${i}" aria-label="Game type"`,
          options: FORMAT_OPTIONS,
          value: format,
          extra: 'sel-soft',
        })}
        ${selectHtml({
          attr: `data-scoring-index="${i}" aria-label="Point type"`,
          options: SCORING_OPTIONS,
          value: scoring,
          extra: 'sel-soft',
        })}
        ${
          scoring === 'match'
            ? selectHtml({
                attr: `data-winpoints-index="${i}" aria-label="What a win is worth"`,
                options: WIN_POINT_OPTIONS,
                value: String(winPoints),
                extra: 'sel-soft',
              })
            : ''
        }
        <span class="row-note">${
          matches ? `${matches} ${matches === 1 ? 'match' : 'matches'}` : 'needs more players'
        }</span>
      </div>`;
    container.appendChild(row);
  }
}

function resolvedNames(values, count, fallback) {
  return Array.from({ length: count }, (_, i) => (values[i] || '').trim() || fallback(i));
}

function renderPreview() {
  const counts = { dad: 0, granddad: 0, kid: 0 };
  for (let i = 0; i < draft.playerCount; i++) counts[draft.playerGenerations[i] || 'dad'] += 1;
  const parts = GENERATIONS
    .filter((g) => counts[g.id] > 0)
    .map((g) => `${counts[g.id]} ${counts[g.id] === 1 ? g.label.toLowerCase() : `${g.label.toLowerCase()}s`}`);

  const formats = draft.sportFormats.slice(0, draft.sportCount);
  const total = formats.reduce((sum, format) => sum + matchesPerSport(draft.playerCount, format || '1v1'), 0);
  const anyPedro = formats.some((f) => pedroNeeded(draft.playerCount, f || '1v1'));

  const heaviest = formats.includes('1v1') ? '1v1' : formats[0] || '1v1';
  const needed = sportsToCoverEveryone(draft.playerCount, heaviest);
  const coverage =
    draft.sportCount >= needed
      ? `With <strong>${draft.sportCount}</strong> ${draft.sportCount === 1 ? 'sport' : 'sports'} everyone has met everyone.`
      : `Everyone has met everyone after <strong>${needed}</strong> sports — you can add more later.`;

  $('#setup-preview').innerHTML =
    `<strong>${parts.join(', ')}</strong> across ` +
    `<strong>${draft.sportCount}</strong> ${draft.sportCount === 1 ? 'sport' : 'sports'}, ` +
    `<strong>${total}</strong> ${total === 1 ? 'match' : 'matches'} in all. ` +
    `One match each per sport${
      anyPedro ? ', and the odd one out plays the last player so nobody sits out' : ''
    }. ` +
    `${coverage}<br>` +
    `You put the times on afterwards, as you book the courts.`;

  const error = validateDraft();
  $('#setup-error').hidden = !error;
  $('#setup-error').textContent = error || '';
  $('#btn-create').disabled = Boolean(error);
}

function validateDraft() {
  if (draft.playerCount < 2) return 'You need at least 2 players.';
  if (draft.sportCount < 1) return 'Pick at least one sport.';
  for (let i = 0; i < draft.sportCount; i++) {
    const format = FORMATS.find((f) => f.id === (draft.sportFormats[i] || '1v1'));
    if (draft.playerCount < format.min) {
      return `${format.label} needs at least ${format.min} players. Add more, or change that sport's game type.`;
    }
  }
  return null;
}

function createChampionship() {
  if (validateDraft()) return;

  const players = resolvedNames(draft.playerNames, draft.playerCount, (i) => `Player ${i + 1}`).map(
    (name, i) => ({ id: `p${i + 1}`, name, generation: draft.playerGenerations[i] || 'dad' })
  );

  const sports = resolvedNames(draft.sportNames, draft.sportCount, (i) =>
    SPORT_SUGGESTIONS[i] || `Sport ${i + 1}`
  ).map((name, i) => ({
    id: `s${i + 1}`,
    name,
    order: i,
    format: draft.sportFormats[i] || '1v1',
    scoring: draft.sportScorings[i] || 'match',
    winPoints: draft.sportWinPoints[i] || DEFAULT_WIN_POINTS,
    time: null, // set later, on the sport's own page, as the courts are booked
  }));

  state = {
    version: STATE_VERSION,
    id: newChampionshipId(),
    name: (draft.name || '').trim() || DEFAULT_NAME,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metaAt: new Date().toISOString(),
    removed: {},
    players,
    standIns: [{ id: 'x1', name: DEFAULT_STAND_IN }],
    sports,
    matches: [],
    nextMatchNo: 0,
  };
  buildAllProgrammes(state);

  library.championships.unshift(state);
  library.currentId = state.id;
  saveState();
  view = 'sports';
  openSportId = null;
  tableFilter = 'all';
  render();
}

/* ============================= THE BRAND =============================== */

function renderBrand() {
  if (!state) {
    $('#brand').innerHTML = `
      <div class="brand-text">
        <h1>Dad Championships</h1>
        <p class="sub">Set up a new championship</p>
      </div>`;
    return;
  }

  const counts = { dad: 0, granddad: 0, kid: 0 };
  for (const p of state.players) counts[p.generation] = (counts[p.generation] || 0) + 1;
  const who = GENERATIONS.filter((g) => counts[g.id] > 0)
    .map((g) => `${counts[g.id]} ${g.label.toLowerCase()}${counts[g.id] === 1 ? '' : 's'}`)
    .join(' · ');

  const sub = view === 'sport' && openSportId ? sportName(openSportId) : who;
  const long = state.name.length > 17;
  const veryLong = state.name.length > 26;

  $('#brand').innerHTML = `
    ${crestSvg(state.name, 42, 'top')}
    <div class="brand-text">
      <h1 class="${veryLong ? 'tiny' : long ? 'small' : ''}">${escapeHtml(state.name)}</h1>
      <p class="sub">${escapeHtml(sub)}</p>
    </div>`;
}

/* =========================== THE SPORTS LIST =========================== */

/** What another sport would buy you: the pairings nobody has played yet. */
function coverageLine() {
  const { missing } = pairCoverage(state);
  if (!missing.length) {
    return '<p class="hint cover-line met">Everyone has met everyone.</p>';
  }
  const shown = missing
    .slice(0, 3)
    .map(([a, b]) => `${escapeHtml(nameOf(a))}–${escapeHtml(nameOf(b))}`)
    .join(', ');
  const rest = missing.length > 3 ? `, and ${missing.length - 3} more` : '';
  return `<p class="hint cover-line">Still to meet: ${shown}${rest}. Add a sport and the app picks those first.</p>`;
}

/** Who came out on top of one finished sport, for the overview line. */
function sportWinner(sportId) {
  const rows = standings(state, sportId).filter((r) => r.played > 0);
  if (!rows.length) return null;
  if (rows.length > 1 && rows[1].points === rows[0].points) return null; // shared
  return rows[0].name;
}

function renderSports() {
  const body = $('#sports-body');
  const { done, total } = progress(state.matches);
  const upNext = nextUnplayed(state);
  const timed = state.sports.filter((s) => s.time).length;

  const header = total
    ? `<div class="bar"><i style="width:${(done / total) * 100}%"></i></div>
       <p class="eyebrow">${done} of ${total} ${total === 1 ? 'match' : 'matches'} played</p>`
    : '';

  const banner = upNext
    ? `<div class="up-next">
         <span class="label">Next up${
           sportOf(upNext.sportId).time ? ` — ${escapeHtml(whenLabel(sportOf(upNext.sportId).time))}` : ''
         }</span>
         <strong>${escapeHtml(sportName(upNext.sportId))}: ${
           upNext.sides.length > 2
             ? 'everybody'
             : `${escapeHtml(teamText(upNext.sides[0].players))} vs ${escapeHtml(
                 teamText(upNext.sides[1].players)
               )}`
         }</strong>
       </div>`
    : '';

  const timeHint =
    timed < state.sports.length
      ? `<p class="hint time-hint">${
          state.sports.length - timed === 1 ? '1 sport has' : `${state.sports.length - timed} sports have`
        } no day and time yet — open the sport to set it. The list sorts itself by when things happen.</p>`
      : '';

  const rows = orderedSports(state.sports)
    .map((sport) => {
      const matches = matchesForSport(state.matches, sport.id);
      const here = sportProgress(state, sport.id);
      const pedroHere = matches.filter((m) => m.pedro).length;
      const winner = here.complete ? sportWinner(sport.id) : null;
      return `
        <button class="sport-link ${here.complete ? 'done' : ''}" data-open="${sport.id}">
          <span class="sl-main">
            <span class="sl-name">${escapeHtml(sport.name)}${
              here.complete ? '<span class="done-tick" aria-hidden="true"></span>' : ''
            }</span>
            <span class="sl-meta">${
              here.complete && winner
                ? `Done · won by ${escapeHtml(winner)}`
                : `${escapeHtml(formatLabel(sport.format))} · ${escapeHtml(scoringSummary(sport))} · ${
                    matches.length
                  } ${matches.length === 1 ? 'match' : 'matches'}${pedroHere ? ' · Pedro' : ''}`
            }</span>
          </span>
          <span class="sl-right">
            <span class="sl-time ${sport.time ? 'set' : ''}">${
              sport.time ? escapeHtml(whenLabel(sport.time, { short: true })) : 'no time'
            }</span>
            <span class="sl-count ${here.complete ? 'all-in' : ''}">${
              here.complete ? 'Done' : `${here.done} / ${here.total}`
            }</span>
          </span>
          <span class="chev" aria-hidden="true"></span>
        </button>`;
    })
    .join('');

  body.innerHTML =
    header +
    banner +
    timeHint +
    coverageLine() +
    `<p class="eyebrow list-label">The sports — tap one for its matches</p>
     <div class="sport-list">${rows}</div>
     <button class="add-match" id="btn-add-sport"><span aria-hidden="true">+</span> Add a sport</button>`;

  $$('#sports-body .sport-link').forEach((btn) => {
    btn.onclick = () => { openSportId = btn.dataset.open; view = 'sport'; render(); window.scrollTo({ top: 0 }); };
  });
  $('#btn-add-sport').onclick = openNewSportSheet;
}

/* ======================= ONE SPORT AND ITS MATCHES ===================== */

function fixtureRow(match, upNext) {
  const isNow = upNext && match.id === upNext.id;
  const classes = `fixture ${match.done ? 'played' : ''} ${isNow ? 'now' : ''}`;
  const badge = match.pedro ? '<span class="pedro-badge">Pedro</span>' : '';

  if (match.sides.length > 2) {
    const winner = winningSide(match);
    const result = match.done
      ? winner
        ? `${escapeHtml(nameOf(winner.players[0]))} ${winner.score}`
        : 'Tied'
      : isNow
        ? '<em>Up next</em>'
        : '—';
    return `
      <button class="${classes} ffa" data-match="${match.id}">
        <span class="who">${match.sides
          .map((side) => `${escapeHtml(nameOf(side.players[0]))}${
            match.done ? ` <b>${side.score}</b>` : ''
          }`)
          .join(' <span class="and">·</span> ')}${badge}</span>
        <span class="res">${result}</span>
      </button>`;
  }

  const [a, b] = match.sides;
  return `
    <button class="${classes}" data-match="${match.id}">
      <span class="who">${teamHtml(a.players)}<br>${teamHtml(b.players)}${badge}</span>
      <span class="res">${
        match.done ? `${a.score} – ${b.score}` : isNow ? '<em>Up next</em>' : '—'
      }</span>
    </button>`;
}

function renderSportPage() {
  const sport = sportOf(openSportId);
  if (!sport) { view = 'sports'; renderSports(); return; }

  const matches = matchesForSport(state.matches, sport.id);
  const played = matches.filter((m) => m.done).length;
  const upNext = nextUnplayed(state);
  const sittingOut = playersSittingOut(state, sport.id);
  const pedroHere = matches.filter((m) => m.pedro);

  $('#sport-body').innerHTML = `
    <div class="sport-page-head">
      <h2>${escapeHtml(sport.name)}</h2>
      <p class="meta">${escapeHtml(formatLabel(sport.format))} · ${escapeHtml(
        scoringSummary(sport)
      )} · ${sport.time ? escapeHtml(whenLabel(sport.time)) : 'no time yet'} · ${played} of ${
        matches.length
      } played</p>
      <div class="two-btns">
        <button class="ghost" id="sport-settings">Sport settings</button>
        <button class="ghost" id="sport-add-match">Add a match</button>
      </div>
    </div>

    <p class="eyebrow">The matches — tap one to edit it or enter the score</p>
    ${
      matches.length
        ? `<div class="fixtures">${matches.map((m) => fixtureRow(m, upNext)).join('')}</div>`
        : '<p class="empty">No matches in this sport yet.<br>Add one, or draw a new programme from the menu.</p>'
    }

    ${
      pedroHere.length
        ? `<p class="sitting-out">${pedroHere.length === 1 ? 'One match here is' : `${pedroHere.length} matches here are`} a Pedro match — the extra match so the odd one out does not sit down. Open it to play against a stand-in instead.</p>`
        : ''
    }
    ${
      sittingOut.length
        ? `<p class="sitting-out warn">Nobody should sit out: ${sittingOut
            .map((p) => escapeHtml(p.name))
            .join(', ')} ${sittingOut.length === 1 ? 'has' : 'have'} no match here. Add one.</p>`
        : ''
    }`;

  $$('#sport-body .fixture').forEach((btn) => {
    btn.onclick = () => openMatchSheet(btn.dataset.match);
  });
  $('#sport-settings').onclick = () => openSportSheet(sport.id);
  $('#sport-add-match').onclick = () => {
    try {
      const match = createMatch(state, sport.id);
      touchMatch(match);
      state.matches.push(match);
      saveState();
      render();
      openMatchSheet(match.id);
    } catch (error) {
      toast(error.message);
    }
  };
}

/* =========================== THE MATCH EDITOR ========================== */

function scoreStepper(key, value) {
  return `
    <div class="score-control">
      <button class="round-btn" data-score="${key}" data-delta="-1" aria-label="Lower">−</button>
      <input id="score-${key}" type="number" inputmode="numeric" pattern="[0-9]*" min="0"
             value="${value === null || value === undefined ? '' : value}" placeholder="0">
      <button class="round-btn" data-score="${key}" data-delta="1" aria-label="Raise">+</button>
    </div>`;
}

function openMatchSheet(matchId) {
  const match = matchOf(matchId);
  if (!match) return;
  const sport = sportOf(match.sportId);

  editing = {
    matchId,
    format: sport.format,
    sides: match.sides.map((side) => side.players.slice()),
    scores: match.sides.map((side) => (side.score === null ? '' : String(side.score))),
    pedro: Boolean(match.pedro),
    // all vs all: who is in the round at all
    ffaIn: new Set(match.sides.flatMap((side) => side.players)),
  };

  $('#match-title').textContent = `${sport.name} — ${formatLabel(sport.format)}`;
  renderMatchSheet();
  $('#match-sheet').hidden = false;
}

/** Read what is on screen back into the editor before re-drawing it. */
function readMatchSheet() {
  if (!editing) return;
  if (isFreeForAll(editing.format)) {
    for (const player of state.players) {
      const input = $(`#score-${player.id}`);
      if (input) editing.ffaScores = { ...(editing.ffaScores || {}), [player.id]: input.value };
    }
    return;
  }
  editing.scores = editing.sides.map((_, i) => {
    const input = $(`#score-${i}`);
    return input ? input.value : editing.scores[i] || '';
  });
}

function renderMatchSheet() {
  const body = $('#match-body');
  // Anders v Pedro: a stand-in is picked exactly like a player, marked so you
  // can see the match is against somebody outside the championship.
  const playerOptions = [
    ...state.players.map((p) => ({ value: p.id, label: p.name })),
    ...standInsOf(state).map((s) => ({ value: s.id, label: `${s.name} — stands in` })),
  ];
  $('#match-error').hidden = true;

  if (isFreeForAll(editing.format)) {
    const scores = editing.ffaScores || {};
    // seed the score of everyone already in the round
    const match = matchOf(editing.matchId);
    for (const side of match.sides) {
      const id = side.players[0];
      if (scores[id] === undefined) scores[id] = side.score === null ? '' : String(side.score);
    }
    editing.ffaScores = scores;

    body.innerHTML = `
      <p class="eyebrow">Everybody's own score</p>
      <div class="ffa-scores">
        ${state.players
          .map(
            (p) => `
          <div class="ffa-row ${editing.ffaIn.has(p.id) ? '' : 'out'}">
            <span class="ffa-name">${escapeHtml(p.name)} ${genTag(p.generation)}</span>
            ${selectHtml({
              attr: `data-ffa-in="${p.id}" aria-label="In the round"`,
              options: YES_NO,
              value: editing.ffaIn.has(p.id) ? 'yes' : 'no',
              extra: 'sel-soft',
            })}
            ${scoreStepper(p.id, scores[p.id] ?? '')}
          </div>`
          )
          .join('')}
      </div>
      ${pedroPickerHtml()}`;
  } else {
    const size = teamSize(editing.format);
    const sideBlock = (index) => `
      <div class="editor-side">
        <p class="eyebrow">Side ${index === 0 ? 'A' : 'B'} — ${
          size === 2 ? 'the team and its score' : 'the player and the score'
        }</p>
        ${Array.from({ length: size }, (_, slot) =>
          selectHtml({
            attr: `data-slot="${index}-${slot}" aria-label="Side ${index === 0 ? 'A' : 'B'} player ${slot + 1}"`,
            options: playerOptions,
            value: editing.sides[index] ? editing.sides[index][slot] : '',
            extra: 'sel-wide sel-player',
          })
        ).join('')}
        ${scoreStepper(String(index), editing.scores[index] ?? '')}
      </div>`;

    body.innerHTML = `
      ${sideBlock(0)}
      <div class="net"><span>VS</span></div>
      ${sideBlock(1)}
      ${pedroPickerHtml()}`;
  }

  $$('#match-body [data-score]').forEach((btn) => {
    btn.onclick = () => {
      const input = $(`#score-${btn.dataset.score}`);
      const current = input.value === '' ? 0 : Number(input.value) || 0;
      input.value = Math.max(0, current + Number(btn.dataset.delta));
    };
  });

  const match = matchOf(editing.matchId);
  $('#match-clear').hidden = !match.done;
}

function pedroPickerHtml() {
  return `
    <p class="eyebrow">A Pedro match?</p>
    ${selectHtml({
      id: 'match-pedro',
      options: [
        { value: 'no', label: 'No — a normal match' },
        { value: 'yes', label: 'Yes — an extra Pedro match' },
      ],
      value: editing.pedro ? 'yes' : 'no',
      extra: 'sel-wide',
    })}
    <p class="hint">A Pedro match is the extra match played when the numbers do not go up, so the
      odd one out does not sit down. It counts like any other match. Put a stand-in on the other
      side and it is played against somebody outside the championship.</p>`;
}

function saveMatchSheet() {
  readMatchSheet();
  const match = matchOf(editing.matchId);
  if (!match) return closeMatchSheet();

  let sides;
  if (isFreeForAll(editing.format)) {
    sides = state.players
      .filter((p) => editing.ffaIn.has(p.id))
      .map((p) => ({ players: [p.id], score: editing.ffaScores[p.id] }));
  } else {
    sides = editing.sides.map((players, i) => ({ players, score: editing.scores[i] }));
  }

  const error = validateSides(sides.map((s) => s.players), editing.format);
  if (error) {
    $('#match-error').textContent = error;
    $('#match-error').hidden = false;
    return;
  }

  // A match counts as played once every side has a score; leave it open if not.
  const allScored = sides.every((side) => String(side.score ?? '').trim() !== '');
  match.sides = sides.map((side) => ({
    players: side.players.slice(),
    score: allScored ? Math.max(0, Math.round(Number(side.score) || 0)) : null,
  }));
  match.done = allScored;
  match.pedro = editing.pedro;
  touchMatch(match);

  saveState();
  closeMatchSheet();
  render();
  toast(allScored ? 'Result saved' : 'Match saved');
}

function closeMatchSheet() {
  $('#match-sheet').hidden = true;
  editing = null;
}

/* ============================ SPORT SETTINGS =========================== */

function winPointsRowHtml(id, scoring, winPoints) {
  return `<div class="win-points-row" ${scoring === 'match' ? '' : 'hidden'}>
    <p class="eyebrow">What a win is worth</p>
    ${selectHtml({ id, options: WIN_POINT_OPTIONS, value: String(winPoints), extra: 'sel-wide' })}
  </div>`;
}

function openSportSheet(sportId) {
  const sport = sportOf(sportId);
  editingSportId = sportId;
  $('#sport-sheet-title').textContent = sport.name;
  $('#sport-name').value = sport.name;
  $('#sport-time').value = sport.time || '';

  $('#sport-format-field').innerHTML = selectHtml({
    id: 'sport-format',
    options: FORMAT_OPTIONS_LONG,
    value: sport.format,
    extra: 'sel-wide',
  });
  $('#sport-scoring-field').innerHTML =
    selectHtml({
      id: 'sport-scoring',
      options: SCORING_OPTIONS_LONG,
      value: sport.scoring,
      extra: 'sel-wide',
    }) + winPointsRowHtml('sport-winpoints', sport.scoring, sport.winPoints || DEFAULT_WIN_POINTS);

  $('#sport-delete').hidden = state.sports.length < 2;
  $('#sport-sheet').hidden = false;
}

async function saveSportSheet() {
  const sport = sportOf(editingSportId);
  const name = $('#sport-name').value.trim() || sport.name;
  const time = $('#sport-time').value || null;
  const format = $('#sport-format').value;
  const scoring = $('#sport-scoring').value;
  const winPoints = Number($('#sport-winpoints').value) || DEFAULT_WIN_POINTS;

  if (format !== sport.format) {
    const wanted = FORMATS.find((f) => f.id === format);
    if (state.players.length < wanted.min) {
      toast(`${wanted.label} needs at least ${wanted.min} players`);
      return;
    }
    const finished = matchesForSport(state.matches, sport.id).filter((m) => m.done).length;
    const body = finished
      ? `New matches are drawn for ${sport.name}, and the ${finished} ${
          finished === 1 ? 'result' : 'results'
        } already entered for it are lost. Every other sport keeps its matches.`
      : `New matches are drawn for ${sport.name}. Every other sport keeps its matches.`;
    const go = await ask(`Change ${sport.name} to ${formatLabel(format)}?`, {
      body,
      yes: 'Change it',
      danger: finished > 0,
    });
    if (!go) return;

    sport.format = format;
    state.matches = state.matches.filter((m) => m.sportId !== sport.id);
    state.matches.push(...buildProgramme(state, sport.id));
  }
  sport.name = name;
  sport.scoring = scoring;
  sport.winPoints = winPoints;
  sport.time = time;

  touchField();
  saveState();
  $('#sport-sheet').hidden = true;
  editingSportId = null;
  render();
  toast('Sport updated');
}

async function deleteSport() {
  const sport = sportOf(editingSportId);
  const go = await ask(`Delete ${sport.name}?`, {
    body: 'The sport and all its matches go with it.',
    yes: 'Delete it',
    danger: true,
  });
  if (!go) return;
  rememberRemoved(sport.id, ...matchesForSport(state.matches, sport.id).map((m) => m.id));
  state.sports = state.sports.filter((s) => s.id !== sport.id);
  state.matches = state.matches.filter((m) => m.sportId !== sport.id);
  touchField();
  if (tableFilter === sport.id) tableFilter = 'all';
  saveState();
  $('#sport-sheet').hidden = true;
  editingSportId = null;
  openSportId = null;
  view = 'sports';
  render();
  toast(`${sport.name} deleted`);
}

/* =========================== A SPORT ADDED LATER ======================== */

function openNewSportSheet() {
  const taken = state.sports.map((s) => s.name);
  const suggestion = SPORT_SUGGESTIONS.find((s) => !taken.includes(s)) || SPORT_SUGGESTIONS[0];
  newSport = { name: suggestion, custom: false, format: '1v1', scoring: 'match', winPoints: DEFAULT_WIN_POINTS, time: '' };
  renderNewSportSheet();
  $('#new-sport-sheet').hidden = false;
}

function renderNewSportSheet() {
  const matches = matchesPerSport(state.players.length, newSport.format);
  const { missing } = pairCoverage(state);

  $('#new-sport-body').innerHTML = `
    <p class="eyebrow">Sport</p>
    ${selectHtml({ id: 'new-sport-name', options: SPORT_NAME_OPTIONS, value: newSport.custom ? OTHER : newSport.name, extra: 'sel-wide' })}
    ${
      newSport.custom
        ? `<input type="text" id="new-sport-custom" class="sheet-input" value="${escapeHtml(
            newSport.name
          )}" placeholder="Name the sport" autocapitalize="words" autocomplete="off" spellcheck="false">`
        : ''
    }

    <p class="eyebrow">Game type</p>
    ${selectHtml({ id: 'new-sport-format', options: FORMAT_OPTIONS_LONG, value: newSport.format, extra: 'sel-wide' })}

    <p class="eyebrow">Point type</p>
    ${selectHtml({ id: 'new-sport-scoring', options: SCORING_OPTIONS_LONG, value: newSport.scoring, extra: 'sel-wide' })}
    ${winPointsRowHtml('new-sport-winpoints', newSport.scoring, newSport.winPoints)}

    <p class="eyebrow">Booked day and time (optional)</p>
    <div class="time-row">
      <input id="new-sport-time" type="datetime-local" value="${escapeHtml(newSport.time || '')}">
      <button class="link-btn" id="new-sport-time-clear">Clear</button>
    </div>

    <div class="preview">
      ${
        matches
          ? `<strong>${matches}</strong> ${matches === 1 ? 'match' : 'matches'}, one for each player. ` +
            (missing.length
              ? `The app picks from the <strong>${missing.length}</strong> ${
                  missing.length === 1 ? 'pairing' : 'pairings'
                } nobody has played yet.`
              : 'Everyone has already met everyone, so this one is for the fun of it.')
          : `${formatLabel(newSport.format)} needs more players than you have.`
      }
    </div>`;

  $('#new-sport-time-clear').onclick = () => { $('#new-sport-time').value = ''; toast('Time cleared'); };
  $('#new-sport-save').disabled = !matches;
}

function readNewSportSheet() {
  const custom = $('#new-sport-custom');
  const time = $('#new-sport-time');
  if (time) newSport.time = time.value || '';
  if (custom) newSport.name = custom.value;
}

function addNewSport() {
  readNewSportSheet();
  const name = (newSport.name || '').trim() || 'New sport';
  const nextNo = state.sports.reduce((max, s) => Math.max(max, Number(String(s.id).slice(1)) || 0), 0) + 1;
  const sport = {
    id: `s${nextNo}`,
    name,
    order: state.sports.length,
    format: newSport.format,
    scoring: newSport.scoring,
    winPoints: newSport.winPoints,
    time: newSport.time || null,
  };
  state.sports.push(sport);
  const built = buildProgramme(state, sport.id);
  if (!built.length) {
    state.sports.pop();
    toast(`${formatLabel(sport.format)} needs more players`);
    return;
  }
  built.forEach(touchMatch);
  state.matches.push(...built);

  touchField();
  saveState();
  $('#new-sport-sheet').hidden = true;
  newSport = null;
  openSportId = sport.id;
  view = 'sport';
  render();
  toast(`${name} added`);
}

/* =========================== THE PEDRO BOARD =========================== */

/* ================================ TABLE ================================= */

function pointsHeaderFor(filter) {
  if (filter === 'all') return 'Pts';
  const sport = sportOf(filter);
  return sport && sport.scoring === 'score' ? 'Score' : 'Pts';
}

function renderTable() {
  // A sport can be deleted from under a filter; fall back to the overall table.
  if (tableFilter !== 'all' && !sportOf(tableFilter)) tableFilter = 'all';

  const chips = $('#table-chips');
  chips.innerHTML =
    `<button data-filter="all" class="${tableFilter === 'all' ? 'on' : ''}">Overall</button>` +
    orderedSports(state.sports)
      .map(
        (s) =>
          `<button data-filter="${s.id}" class="${tableFilter === s.id ? 'on' : ''}">${escapeHtml(
            s.name
          )}</button>`
      )
      .join('');
  chips.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => { tableFilter = btn.dataset.filter; render(); };
  });

  const rows = standings(state, tableFilter === 'all' ? null : tableFilter);
  const anyPlayed = rows.some((r) => r.played > 0);

  if (!anyPlayed) {
    $('#table-body').innerHTML =
      '<p class="empty">Nothing on the board yet.<br>Play a match, enter the score, and the standings fill themselves in.</p>';
    return;
  }

  const counted = state.matches.filter((m) => tableFilter === 'all' || m.sportId === tableFilter);
  const playedHere = counted.filter((m) => m.done).length;
  const pointsHeader = pointsHeaderFor(tableFilter);

  // The one question this screen exists to answer, answered before the detail.
  const leaderRow = rows[0];
  const runnerUp = rows[1];
  const gap = runnerUp ? leaderRow.points - runnerUp.points : 0;
  const margin = !runnerUp
    ? 'The only one on the board'
    : gap === 0
      ? `Level with ${escapeHtml(runnerUp.name)} on points`
      : `${gap} ${gap === 1 ? 'point' : 'points'} clear of ${escapeHtml(runnerUp.name)}`;

  const finished = counted.length > 0 && playedHere === counted.length;

  $('#table-body').innerHTML = `
    ${finished ? `<div class="champion-strip">${TROPHY_SVG}</div>` : ''}
    <div class="leader">
      ${medal(1)}
      <div class="leader-text">
        <span class="label">${finished ? 'Winner' : 'Leading'}</span>
        <span class="name">${escapeHtml(leaderRow.name)}</span>
        <span class="margin">${margin}</span>
      </div>
      <div class="total"><b>${leaderRow.points}</b><span>${pointsHeader}</span></div>
    </div>

    <p class="eyebrow">After ${playedHere} of ${counted.length} ${counted.length === 1 ? 'match' : 'matches'}</p>
    <div class="standings">
      <div class="standings-head">
        <span class="spacer"></span>
        <span class="who-name">Player</span>
        <span class="record">W · D · L</span>
        <span class="diff">+/−</span>
        <span class="pts">${pointsHeader}</span>
      </div>
      ${rows
        .map(
          (row, i) => `
        <div class="standings-row${i === 0 ? ' top' : ''}">
          ${medal(i + 1)}
          <span class="who-name">
            <span class="nm">${escapeHtml(row.name)}</span>
            <span class="gen gen-line gen-${row.generation}">${escapeHtml(
              generationLabel(row.generation)
            )}</span>
          </span>
          <span class="record">${row.won} · ${row.drawn} · ${row.lost}</span>
          <span class="diff ${row.diff > 0 ? 'up' : row.diff < 0 ? 'down' : ''}">${
            row.diff > 0 ? '+' : ''
          }${row.diff}</span>
          <span class="pts">${row.points}</span>
        </div>`
        )
        .join('')}
    </div>`;
}

/* ================================ SHARE ================================= */

function shareText() {
  const rows = standings(state, tableFilter === 'all' ? null : tableFilter);
  const { done, total } = progress(state.matches);
  const title = tableFilter === 'all' ? state.name : `${state.name} — ${sportName(tableFilter)}`;
  const medals = ['🥇', '🥈', '🥉'];
  const width = Math.max(...rows.map((r) => r.name.length));

  const lines = rows.map((row, i) => {
    const rank = i < 3 ? medals[i] : `${i + 1}.`;
    return `${rank} ${row.name.padEnd(width)}  ${row.points}`;
  });

  const timetable = orderedSports(state.sports)
    .filter((s) => s.time)
    .map((s) => `${whenLabel(s.time)}  ${s.name}`);

  return (
    `🏆 ${title}\n${done} of ${total} matches played\n\n${lines.join('\n')}` +
    (timetable.length ? `\n\nToday\n${timetable.join('\n')}` : '')
  );
}

/**
 * Sharing has three ways to fail on a phone and every one of them used to be
 * swallowed, which left a button that did nothing at all. Now each step falls
 * through to the next, and the last step always works: the table on screen,
 * ready to be selected and copied by hand.
 */
async function share() {
  const text = shareText();

  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (error) {
      // the user closing the share sheet is not a failure — leave them alone
      if (error && error.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    toast('Table copied');
    return;
  } catch {
    /* no clipboard here either — show it instead */
  }

  $('#share-text').value = text;
  $('#share-sheet').hidden = false;
  $('#share-text').select();
}

/* ========================= CHAMPIONSHIPS ONLINE ========================== */
/* When the app is served from its own address rather than as static files, it
   has somewhere shared to keep championships. Everyone opens the same address,
   picks the championship off the list, and enters scores on their own phone.
   No login: the list is the way in, which is right for a family and wrong for
   anything else.

   The phone stays in charge of its own copy. It sends the whole championship
   up, the server merges it with what is there, and sends the result back — so
   a score entered with no signal is not lost, it just arrives late.          */

const SYNC_EVERY = 4000;
let pushTimer = null;
function pushSoon() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushAndPull(), 400);
}
let syncTimer = null;
let syncing = false;
let onlineNote = '';
let hasServer = false;

/** Whether this copy of the app has a server behind it at all. */
async function serverIsThere() {
  try {
    const res = await fetch('api/health', { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

const isShared = () => Boolean(state && state.code);

async function pushAndPull() {
  if (!isShared() || syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const res = await fetch(`api/champs/${state.code}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ championship: state }),
    });
    if (!res.ok) return;
    const { championship } = await res.json();
    if (!championship) return;

    // what came back already holds everything this phone sent
    const merged = mergeChampionships(championship, state);
    const changed = JSON.stringify(merged) !== JSON.stringify(state);
    Object.assign(state, merged);
    library.championships = [state, ...library.championships.filter((c) => c.id !== state.id)];
    saveLibrary();
    if (changed) render();
    onlineNote = '';
  } catch {
    onlineNote = 'no signal — your scores go up when it is back';
  } finally {
    syncing = false;
  }
}

function keepInStep() {
  clearInterval(syncTimer);
  if (!isShared()) return;
  syncTimer = setInterval(() => {
    if (!document.hidden) pushAndPull();
  }, SYNC_EVERY);
  pushAndPull();
}

async function putOnline() {
  if (!state) return;
  if (state.code) {
    toast('This one is already online');
    return;
  }
  try {
    const res = await fetch('api/champs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ championship: state }),
    });
    if (!res.ok) throw new Error('refused');
    const { code } = await res.json();
    state.code = code;
    saveState();
    keepInStep();
    renderOnlineList();
    render();
    toast(`Online — everybody can find it now`);
  } catch {
    toast('Could not put it online');
  }
}

async function openOnline(code) {
  try {
    const res = await fetch(`api/champs/${code}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('gone');
    const { championship } = await res.json();
    const champ = migrateState(championship);
    if (!champ) throw new Error('empty');
    champ.code = code;
    if (!champ.id) champ.id = newChampionshipId();

    // a phone that already follows this one keeps its own unsent scores
    const mine = library.championships.find((c) => c.code === code || c.id === champ.id);
    state = mine ? Object.assign(mine, mergeChampionships(champ, mine)) : champ;
    if (!mine) library.championships.unshift(state);
    library.currentId = state.id;
    saveLibrary();

    $('#online-sheet').hidden = true;
    view = 'sports';
    openSportId = null;
    tableFilter = 'all';
    render();
    keepInStep();
    toast(`${state.name} opened`);
  } catch {
    toast('That championship is not there any more');
  }
}

function renderOnlineList(list) {
  const box = $('#online-list');
  if (!list) {
    box.innerHTML = '<p class="empty small">Looking…</p>';
    return;
  }
  if (!list.length) {
    box.innerHTML = '<p class="empty small">Nothing online yet. Put yours up and the others can join it.</p>';
    return;
  }
  box.innerHTML = list
    .map((c, i) => {
      const open = state && state.code === c.code;
      return `
        <div class="champ-row ${open ? 'open' : ''}">
          <button class="champ-open" data-online="${escapeHtml(c.code)}">
            ${crestSvg(c.name, 40, `on${i}`)}
            <span class="champ-text">
              <span class="champ-name">${escapeHtml(c.name)}</span>
              <span class="champ-meta">${c.players} ${c.players === 1 ? 'player' : 'players'} · ${
                c.sports
              } ${c.sports === 1 ? 'sport' : 'sports'} · ${c.played} of ${c.matches} played</span>
            </span>
            <span class="champ-state">${open ? 'Open' : escapeHtml(c.code)}</span>
          </button>
        </div>`;
    })
    .join('');
  $$('#online-list .champ-open').forEach((btn) => {
    btn.onclick = () => openOnline(btn.dataset.online);
  });
}

async function openOnlineSheet() {
  $('#online-sheet').hidden = false;
  $('#online-put').hidden = !state || Boolean(state.code);
  renderOnlineList();
  try {
    const res = await fetch('api/champs', { cache: 'no-store' });
    const { championships } = await res.json();
    renderOnlineList(championships || []);
  } catch {
    renderOnlineList([]);
    $('#online-note').textContent =
      'No signal, so the list could not be fetched. Your own scores are safe on this phone.';
  }
}

/* ====================== A CHAMPIONSHIP IN A LINK ======================== */
/* A phone browser cannot write a file by itself — Safari has no such thing, on
   the phone or the Mac; only Chrome on a computer can. So the way to hand a
   championship to everybody is the one thing every phone can already do: send
   a link. The whole championship travels inside it, squeezed down and tacked
   on after the #, which means it never leaves the family chat for a server. */

const LINK_MARK = '#c=';
const LINK_LIMIT = 16000; // beyond this a link stops being reliable to send

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function squeeze(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unsqueeze(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

async function championshipLink(champ) {
  const packed = bytesToBase64Url(await squeeze(JSON.stringify(champ)));
  const base = location.href.split('#')[0].split('?')[0];
  return `${base}${LINK_MARK}${packed}`;
}

/** Send the whole championship to whoever should have it. */
async function shareChampionship() {
  if (!state) return;
  let link;
  try {
    link = await championshipLink(state);
  } catch {
    toast('Could not build the link');
    return;
  }

  if (link.length > LINK_LIMIT) {
    toast('This championship is too big for a link — use Save to a file');
    return;
  }

  const text = `${state.name} — open it here:`;
  if (navigator.share) {
    try {
      await navigator.share({ title: state.name, text, url: link });
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    toast('Link copied — paste it to the others');
    return;
  } catch {
    /* no clipboard here — show it instead */
  }
  $('#share-text').value = link;
  $('#share-sheet').hidden = false;
  $('#share-text').select();
}

/**
 * Someone opened a link with a championship in it. It is added to this phone's
 * own library, so opening a link never costs you what you already had.
 */
async function openFromLink() {
  const hash = location.hash || '';
  if (!hash.startsWith(LINK_MARK)) return false;

  // taken out of the address straight away, so a refresh cannot open it twice
  const packed = hash.slice(LINK_MARK.length);
  history.replaceState(null, '', location.pathname + location.search);

  let champ = null;
  try {
    champ = migrateState(JSON.parse(await unsqueeze(base64UrlToBytes(packed))));
  } catch {
    champ = null;
  }
  if (!champ) {
    toast('That link does not hold a championship');
    return false;
  }

  const mine = champ.id ? library.championships.find((c) => c.id === champ.id) : null;
  if (mine) {
    const replace = await ask(`Open ${champ.name}?`, {
      body: 'You already have this championship on this phone. Opening the link replaces your copy with the one in the link.',
      yes: 'Use the link',
      danger: true,
    });
    if (!replace) return false;
    library.championships = library.championships.filter((c) => c.id !== champ.id);
  }
  if (!champ.id) champ.id = newChampionshipId();

  champ.updatedAt = new Date().toISOString();
  state = champ;
  library.championships.unshift(champ);
  library.currentId = champ.id;
  saveState();
  view = 'sports';
  openSportId = null;
  tableFilter = 'all';
  render();
  toast(`${champ.name} opened`);
  return true;
}

/* ========================= A CHAMPIONSHIP IN A FILE ====================== */
/* One file holds one whole championship: the field, the programme and every
   result. Send it to whoever is keeping score next and they open it on their
   own phone. It is a copy, not a shared line — see the note in the menu. */

const FILE_KIND = 'dad-championships/championship';

function championshipFileName(champ) {
  const stub = champ.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'championship';
  const day = (champ.updatedAt || champ.createdAt || new Date().toISOString()).slice(0, 10);
  return `${stub}-${day}.json`;
}

async function exportChampionship() {
  if (!state) return;
  const payload = { kind: FILE_KIND, version: STATE_VERSION, savedAt: new Date().toISOString(), championship: state };
  const text = JSON.stringify(payload, null, 2);
  const name = championshipFileName(state);
  const file = new File([text], name, { type: 'application/json' });

  // On a phone the useful thing is to send it straight on — AirDrop, Messages,
  // Mail — so the share sheet comes first and saving to Files is one of its
  // own options. A desktop browser has no share sheet and downloads instead.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: state.name });
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
    }
  }

  try {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Saved as ${name}`);
  } catch {
    toast('This phone would not save the file');
  }
}

/** What is in the file, or a reason it cannot be used. */
function readChampionshipFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'That file is not a championship.' };
  }
  const raw = parsed && parsed.championship ? parsed.championship : parsed;
  const champ = migrateState(raw);
  if (!champ) return { error: 'That file does not hold a championship.' };
  return { champ };
}

async function importChampionship(file) {
  const { champ, error } = readChampionshipFile(await file.text());
  if (error) {
    toast(error);
    return;
  }

  const existing = champ.id ? library.championships.find((c) => c.id === champ.id) : null;
  if (existing) {
    const replace = await ask(`Open ${champ.name}?`, {
      body: `You already have a championship by that name on this phone. Opening the file replaces what is here with what is in the file.`,
      yes: 'Replace it',
      danger: true,
    });
    if (!replace) return;
    library.championships = library.championships.filter((c) => c.id !== champ.id);
  } else if (!champ.id) {
    champ.id = newChampionshipId();
  }

  champ.updatedAt = new Date().toISOString();
  state = champ;
  library.championships.unshift(champ);
  library.currentId = champ.id;
  saveState();
  view = 'sports';
  openSportId = null;
  tableFilter = 'all';
  render();
  window.scrollTo({ top: 0 });
  toast(`${champ.name} opened`);
}

/* ============================== THE FIELD =============================== */
/* The field is not settled when the championship starts. Somebody turns up
   late, somebody has to leave at four, and a name gets spelled wrong. All three
   are edited here, and nothing already played is disturbed.                  */

function rosterRow(entrant, standIn) {
  const played = matchesWith(state, entrant.id).length;
  return `
    <div class="roster-row">
      <input type="text" class="roster-name" data-rename="${escapeHtml(entrant.id)}"
             value="${escapeHtml(entrant.name)}" placeholder="${standIn ? 'Stand-in' : 'Name'}"
             autocapitalize="words" autocomplete="off" spellcheck="false">
      ${
        standIn
          ? ''
          : selectHtml({
              attr: `data-gen-for="${escapeHtml(entrant.id)}" aria-label="Generation"`,
              options: GENERATIONS.map((g) => ({ value: g.id, label: g.label })),
              value: entrant.generation,
              extra: `sel-gen gen-${entrant.generation}`,
            })
      }
      <button class="roster-del" data-remove="${escapeHtml(entrant.id)}"
              aria-label="Take ${escapeHtml(entrant.name)} out">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
          <path d="M4 6h12M8 6V4.5h4V6M6.5 6l.7 9.5h5.6L13.5 6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="roster-count">${played} ${played === 1 ? 'match' : 'matches'}</span>
    </div>`;
}

function renderPlayersSheet() {
  $('#players-list').innerHTML = state.players.map((p) => rosterRow(p, false)).join('');
  $('#standins-list').innerHTML = standInsOf(state).length
    ? standInsOf(state).map((s) => rosterRow(s, true)).join('')
    : '<p class="empty small">No stand-ins. Add one and you can play against him.</p>';

  $$('#players-sheet [data-remove]').forEach((btn) => {
    btn.onclick = () => removeFromField(btn.dataset.remove);
  });
}

function openPlayersSheet() {
  renderPlayersSheet();
  $('#players-sheet').hidden = false;
}

async function removeFromField(id) {
  const name = nameOf(id);
  const standIn = isStandIn(state, id);
  const inMatches = matchesWith(state, id).length;

  if (!standIn && state.players.length <= 2) {
    toast('A championship needs at least two players');
    return;
  }

  const body = inMatches
    ? `${name} is in ${inMatches} ${inMatches === 1 ? 'match' : 'matches'}. ${
        inMatches === 1 ? 'That match goes' : 'Those matches go'
      } too — a match with an empty side cannot be played. Every other result stays.`
    : `${name} is in no matches, so nothing else changes.`;

  if (!(await ask(`Take ${name} out?`, { body, yes: 'Take him out', danger: true }))) return;

  rememberRemoved(id, ...matchesWith(state, id).map((m) => m.id));
  removeEntrant(state, id);
  touchField();
  saveState();
  renderPlayersSheet();
  render();
  toast(`${name} taken out`);
}

/* ========================= EVERY CHAMPIONSHIP KEPT ====================== */
/* The phone keeps a library, not one championship. Starting this year's does
   not cost you last year's, and you switch between them from the menu.      */

function championshipSummary(champ) {
  const done = champ.matches.filter((m) => m.done).length;
  const total = champ.matches.length;
  const when = champ.updatedAt || champ.createdAt;
  const day = when
    ? new Date(when).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const players = `${champ.players.length} ${champ.players.length === 1 ? 'player' : 'players'}`;
  const sports = `${champ.sports.length} ${champ.sports.length === 1 ? 'sport' : 'sports'}`;
  return {
    done,
    total,
    day,
    line: `${players} · ${sports} · ${done} of ${total} played`,
    finished: total > 0 && done === total,
  };
}

function renderChampsList() {
  const list = $('#champs-list');
  if (!library.championships.length) {
    list.innerHTML = '<p class="empty">Nothing saved yet.</p>';
    return;
  }

  list.innerHTML = library.championships
    .map((champ, i) => {
      const s = championshipSummary(champ);
      const open = champ.id === library.currentId && Boolean(state);
      return `
        <div class="champ-row ${open ? 'open' : ''}">
          <button class="champ-open" data-champ="${escapeHtml(champ.id)}">
            ${crestSvg(champ.name, 40, `lib${i}`)}
            <span class="champ-text">
              <span class="champ-name">${escapeHtml(champ.name)}</span>
              <span class="champ-meta">${escapeHtml(s.line)}${s.day ? ` · ${escapeHtml(s.day)}` : ''}</span>
            </span>
            <span class="champ-state">${open ? 'Open' : s.finished ? 'Done' : 'Saved'}</span>
          </button>
          <button class="champ-del" data-champ-del="${escapeHtml(champ.id)}" aria-label="Delete ${escapeHtml(champ.name)}">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
              <path d="M4 6h12M8 6V4.5h4V6M6.5 6l.7 9.5h5.6L13.5 6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>`;
    })
    .join('');

  $$('#champs-list .champ-open').forEach((btn) => {
    btn.onclick = () => switchChampionship(btn.dataset.champ);
  });
  $$('#champs-list .champ-del').forEach((btn) => {
    btn.onclick = () => deleteChampionship(btn.dataset.champDel);
  });
}

function openChampsSheet() {
  renderChampsList();
  $('#champs-sheet').hidden = false;
}

function switchChampionship(id) {
  const champ = library.championships.find((c) => c.id === id);
  if (!champ) return;
  state = champ;
  library.currentId = id;
  saveLibrary();
  $('#champs-sheet').hidden = true;
  view = 'sports';
  openSportId = null;
  tableFilter = 'all';
  render();
  window.scrollTo({ top: 0 });
  toast(`${champ.name} opened`);
}

/** Leave the current one on the phone and set up a new one beside it. */
function startAnotherChampionship() {
  $('#champs-sheet').hidden = true;
  state = null;
  library.currentId = null;
  saveLibrary();
  draft.step = 1;
  saveDraft();
  render();
  window.scrollTo({ top: 0 });
}

async function deleteChampionship(id) {
  const champ = library.championships.find((c) => c.id === id);
  if (!champ) return;
  const s = championshipSummary(champ);
  const go = await ask(`Delete ${champ.name}?`, {
    body: `${s.line}. Once it is gone it cannot be brought back.`,
    yes: 'Delete it',
    danger: true,
  });
  if (!go) return;

  library.championships = library.championships.filter((c) => c.id !== id);
  if (library.currentId === id) {
    const next = library.championships[0] || null;
    state = next;
    library.currentId = next ? next.id : null;
    view = 'sports';
    openSportId = null;
    tableFilter = 'all';
  }
  saveLibrary();
  if (!$('#champs-sheet').hidden) renderChampsList();
  render();
  toast(`${champ.name} deleted`);
}

/* ================================ RENDER ================================ */

function render() {
  const setupMode = !state;
  const views = ['setup', 'sports', 'sport', 'table'];

  if (setupMode) view = 'setup';
  if (view === 'sport' && !sportOf(openSportId)) view = 'sports';

  views.forEach((name) => {
    $(`#view-${name}`).hidden = name !== (setupMode ? 'setup' : view);
  });
  $('#tabs').hidden = setupMode;
  $('#btn-menu').hidden = setupMode;
  $('#btn-back').hidden = view !== 'sport';

  renderBrand();

  if (setupMode) {
    // a way back to what is already saved, so setup is never a dead end
    $('#btn-setup-back').hidden = library.championships.length === 0;
    // and a way to join what the others are already playing
    $('#btn-setup-online').hidden = !hasServer;
    renderSetup();
    return;
  }

  $$('#tabs button').forEach((b) =>
    b.classList.toggle('on', b.dataset.view === (view === 'sport' ? 'sports' : view))
  );

  if (view === 'sports') renderSports();
  if (view === 'sport') renderSportPage();
  if (view === 'table') renderTable();
}

/* =============================== WIRING ================================= */

document.addEventListener('change', (event) => {
  const select = event.target.closest('select');
  if (!select) return;

  // ---- the setup screens
  if (select.dataset.count) {
    const field = select.dataset.count === 'sports' ? 'sportCount' : 'playerCount';
    draft[field] = Number(select.value);
    saveDraft();
    renderSetup();
    return;
  }
  if (select.dataset.genFor) {
    const player = state.players.find((p) => p.id === select.dataset.genFor);
    if (player) {
      player.generation = select.value;
      touchField();
      saveState();
      renderPlayersSheet();
      render();
    }
    return;
  }
  if (select.dataset.genIndex !== undefined) {
    draft.playerGenerations[Number(select.dataset.genIndex)] = select.value;
    saveDraft();
    renderSetup();
    return;
  }
  if (select.dataset.sportIndex !== undefined) {
    const index = Number(select.dataset.sportIndex);
    if (select.value === OTHER) {
      draft.sportCustom[index] = true;
      draft.sportNames[index] = '';
    } else {
      draft.sportCustom[index] = false;
      draft.sportNames[index] = select.value;
    }
    saveDraft();
    renderSetup();
    return;
  }
  if (select.dataset.formatIndex !== undefined) {
    draft.sportFormats[Number(select.dataset.formatIndex)] = select.value;
    saveDraft();
    renderSetup();
    return;
  }
  if (select.dataset.scoringIndex !== undefined) {
    draft.sportScorings[Number(select.dataset.scoringIndex)] = select.value;
    saveDraft();
    renderSetup();
    return;
  }
  if (select.dataset.winpointsIndex !== undefined) {
    draft.sportWinPoints[Number(select.dataset.winpointsIndex)] = Number(select.value);
    saveDraft();
    renderSetup();
    return;
  }

  // ---- the match editor: pick a player into a slot, swapping if he is already in
  if (select.dataset.slot) {
    readMatchSheet();
    const [sideIndex, slotIndex] = select.dataset.slot.split('-').map(Number);
    const chosen = select.value;
    const previous = editing.sides[sideIndex][slotIndex];
    editing.sides.forEach((side, s) => {
      side.forEach((id, k) => {
        if (id === chosen && !(s === sideIndex && k === slotIndex)) editing.sides[s][k] = previous;
      });
    });
    editing.sides[sideIndex][slotIndex] = chosen;
    renderMatchSheet();
    return;
  }
  if (select.dataset.ffaIn) {
    readMatchSheet();
    const id = select.dataset.ffaIn;
    if (select.value === 'yes') editing.ffaIn.add(id);
    else editing.ffaIn.delete(id);
    renderMatchSheet();
    return;
  }
  if (select.id === 'match-pedro') {
    editing.pedro = select.value === 'yes';
    return;
  }

  // ---- the sport sheet: the win-points choice only applies to one point type
  if (select.id === 'sport-scoring') {
    $('#sport-sheet .win-points-row').hidden = select.value !== 'match';
    return;
  }

  // ---- the sheet for a sport added later
  if (select.id === 'new-sport-name') {
    readNewSportSheet();
    if (select.value === OTHER) {
      newSport.custom = true;
      newSport.name = '';
    } else {
      newSport.custom = false;
      newSport.name = select.value;
    }
    renderNewSportSheet();
    return;
  }
  if (select.id === 'new-sport-format') {
    readNewSportSheet();
    newSport.format = select.value;
    renderNewSportSheet();
    return;
  }
  if (select.id === 'new-sport-scoring') {
    readNewSportSheet();
    newSport.scoring = select.value;
    renderNewSportSheet();
    return;
  }
  if (select.id === 'new-sport-winpoints') {
    newSport.winPoints = Number(select.value);
    return;
  }
});

document.addEventListener('click', (event) => {
  const goto = event.target.closest('[data-goto]');
  if (goto) {
    draft.step = Number(goto.dataset.goto);
    saveDraft();
    renderSetup();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const tab = event.target.closest('#tabs button');
  if (tab) {
    view = tab.dataset.view;
    if (view === 'sports') openSportId = null;
    render();
    window.scrollTo({ top: 0 });
  }
});

document.addEventListener('input', (event) => {
  const nameInput = event.target.closest('input[data-kind]');
  if (nameInput) {
    const index = Number(nameInput.dataset.index);
    const list = nameInput.dataset.kind === 'sport' ? draft.sportNames : draft.playerNames;
    list[index] = nameInput.value;
    saveDraft();
    renderPreview();
    return;
  }
  if (event.target.id === 'champ-name-input') {
    draft.name = event.target.value;
    saveDraft();
    $('#crest-preview').innerHTML = crestSvg(draft.name || DEFAULT_NAME, 52, 'setup');
    return;
  }
  if (event.target.id === 'name-input') {
    $('#name-crest').innerHTML = crestSvg(event.target.value || DEFAULT_NAME, 52, 'rename');
    return;
  }
  if (event.target.id === 'new-sport-custom') newSport.name = event.target.value;

  // ---- the field: a name is saved as it is typed, so nothing is lost
  const rename = event.target.closest('[data-rename]');
  if (rename) {
    const id = rename.dataset.rename;
    const entrant = state.players.find((p) => p.id === id) || standInsOf(state).find((x) => x.id === id);
    if (entrant) {
      entrant.name = rename.value;
      touchField();
      saveState();
      renderBrand();
    }
  }
});

/* On a phone the keyboard covers the bottom of the screen while you are typing
   names. Go / Next on the keyboard moves to the next name, and on the last one
   it puts the keyboard away — so the step's own button is never the only way
   forward, and never has to be hunted for underneath a keyboard. */
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const input = event.target.closest('#view-setup input[type="text"]');
  if (!input) return;
  event.preventDefault();

  const fields = $$('#view-setup .step:not([hidden]) input[type="text"]');
  const next = fields[fields.indexOf(input) + 1];
  if (next) next.focus();
  else input.blur();
});

$('#btn-create').onclick = createChampionship;

$('#btn-back').onclick = () => {
  view = 'sports';
  openSportId = null;
  render();
  window.scrollTo({ top: 0 });
};

/* ---------------------- a sheet you can pull closed --------------------- */
/* Every sheet closes three ways: the Cancel button, a tap on the dimmed area
   behind it, and — the one a thumb reaches for — a pull down on the sheet
   itself. The pull follows the finger and the sheet springs back if you let
   go too early, so a half-pull is never a surprise.                         */

const PULL_TO_CLOSE = 96; // how far down before letting go closes it
const FLICK = 0.55; // px per ms — a quick flick closes it from anywhere

function dismissible(sheetId, close) {
  const sheet = $(sheetId);
  const card = sheet.querySelector('.sheet-card');

  // The dimmed area closes the sheet only when the press STARTED there, so a
  // drag that begins inside the sheet and ends outside it never closes.
  let pressedBackdrop = false;
  sheet.addEventListener('pointerdown', (event) => { pressedBackdrop = event.target === sheet; });
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet && pressedBackdrop) close();
    pressedBackdrop = false;
  });

  let startY = 0;
  let prevY = 0;
  let prevAt = 0;
  let speed = 0;
  let distance = 0;
  let dragging = false;

  const settle = () => {
    card.style.transition = '';
    card.style.transform = '';
    sheet.style.setProperty('--veil', '1');
    card.classList.remove('dragging');
  };

  /* You can pull from the handle at all times. You can pull from the sheet
     itself when there is nothing to scroll, so the two gestures never fight. */
  const grips = (target) => {
    if (target.closest('select, input, textarea, button, a')) return false;
    if (target.closest('.grabber, .sheet-sport, h2')) return true;
    return card.scrollHeight <= card.clientHeight + 1 && card.scrollTop === 0;
  };

  card.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || !grips(event.target)) return;
    dragging = true;
    distance = 0;
    speed = 0;
    startY = event.clientY;
    prevY = event.clientY;
    prevAt = event.timeStamp;
    card.classList.add('dragging');
  });

  card.addEventListener('pointermove', (event) => {
    if (!dragging || !event.isPrimary) return;
    distance = event.clientY - startY;

    // once the pull is unmistakably a pull, take the gesture over completely
    if (distance > 6 && !card.hasPointerCapture(event.pointerId)) {
      try { card.setPointerCapture(event.pointerId); } catch { /* older engines */ }
    }
    const gap = event.timeStamp - prevAt;
    if (gap > 0) speed = (event.clientY - prevY) / gap;
    prevY = event.clientY;
    prevAt = event.timeStamp;

    if (distance <= 0) {
      card.style.transform = '';
      sheet.style.setProperty('--veil', '1');
      return;
    }
    if (event.cancelable) event.preventDefault();
    card.style.transform = `translateY(${distance}px)`;
    sheet.style.setProperty('--veil', String(Math.max(0, 1 - distance / 420)));
  });

  const release = () => {
    if (!dragging) return;
    dragging = false;
    if (distance > PULL_TO_CLOSE || (distance > 24 && speed > FLICK)) {
      card.classList.remove('dragging');
      card.style.transition = 'transform .2s var(--ease)';
      card.style.transform = 'translateY(110%)';
      setTimeout(() => { settle(); close(); }, 170);
      return;
    }
    settle();
  };

  card.addEventListener('pointerup', release);
  card.addEventListener('pointercancel', release);
}

const closeSportSheet = () => { $('#sport-sheet').hidden = true; editingSportId = null; };
const closeNewSportSheet = () => { $('#new-sport-sheet').hidden = true; newSport = null; };

dismissible('#match-sheet', closeMatchSheet);
dismissible('#sport-sheet', closeSportSheet);
dismissible('#new-sport-sheet', closeNewSportSheet);
dismissible('#name-sheet', () => { $('#name-sheet').hidden = true; });
dismissible('#menu', () => { $('#menu').hidden = true; });
dismissible('#champs-sheet', () => { $('#champs-sheet').hidden = true; });
dismissible('#share-sheet', () => { $('#share-sheet').hidden = true; });
dismissible('#online-sheet', () => { $('#online-sheet').hidden = true; });
dismissible('#players-sheet', () => { $('#players-sheet').hidden = true; render(); });
dismissible('#confirm-sheet', () => { if (confirmResolve) confirmResolve(false); });

$('#confirm-no').onclick = () => { if (confirmResolve) confirmResolve(false); };
$('#confirm-yes').onclick = () => { if (confirmResolve) confirmResolve(true); };

$('#champs-close').onclick = () => { $('#champs-sheet').hidden = true; };

$('#menu-players').onclick = () => { $('#menu').hidden = true; openPlayersSheet(); };
$('#players-done').onclick = () => { $('#players-sheet').hidden = true; render(); };
$('#players-add').onclick = () => {
  addPlayer(state, '', 'dad');
  touchField();
  saveState();
  renderPlayersSheet();
  render();
  const rows = $$('#players-list .roster-name');
  if (rows.length) rows[rows.length - 1].focus();
};
$('#standin-add').onclick = () => {
  addStandIn(state, standInsOf(state).length ? '' : DEFAULT_STAND_IN);
  touchField();
  saveState();
  renderPlayersSheet();
  const rows = $$('#standins-list .roster-name');
  if (rows.length) rows[rows.length - 1].focus();
};
$('#share-close').onclick = () => { $('#share-sheet').hidden = true; };
$('#champs-new').onclick = startAnotherChampionship;
$('#btn-setup-back').onclick = openChampsSheet;
$('#btn-setup-online').onclick = openOnlineSheet;

$('#match-cancel').onclick = closeMatchSheet;
$('#match-save').onclick = saveMatchSheet;
$('#match-clear').onclick = () => {
  const match = matchOf(editing.matchId);
  match.sides.forEach((side) => { side.score = null; });
  match.done = false;
  touchMatch(match);
  saveState();
  closeMatchSheet();
  render();
  toast('Result cleared');
};
$('#match-delete').onclick = async () => {
  const matchId = editing.matchId;
  if (!(await ask('Delete this match?', { yes: 'Delete it', danger: true }))) return;
  if (!editing || editing.matchId !== matchId) return;
  rememberRemoved(matchId);
  state.matches = state.matches.filter((m) => m.id !== matchId);
  saveState();
  closeMatchSheet();
  render();
  toast('Match deleted');
};

$('#sport-cancel').onclick = closeSportSheet;
$('#sport-save').onclick = saveSportSheet;
$('#sport-delete').onclick = deleteSport;
// an empty time field reads the same whether the tap worked or not, so say so
$('#sport-time-clear').onclick = () => { $('#sport-time').value = ''; toast('Time cleared — Save to keep it'); };

$('#new-sport-cancel').onclick = closeNewSportSheet;
$('#new-sport-save').onclick = addNewSport;

$('#name-cancel').onclick = () => { $('#name-sheet').hidden = true; };
$('#name-save').onclick = () => {
  state.name = $('#name-input').value.trim() || DEFAULT_NAME;
  touchField();
  saveState();
  $('#name-sheet').hidden = true;
  render();
  toast('Name and crest updated');
};

$('#btn-share').onclick = share;
$('#menu-share').onclick = () => { $('#menu').hidden = true; share(); };
$('#btn-menu').onclick = () => { $('#menu').hidden = false; };
$('#menu-close').onclick = () => { $('#menu').hidden = true; };

$('#menu-rename').onclick = () => {
  $('#menu').hidden = true;
  $('#name-input').value = state.name;
  $('#name-crest').innerHTML = crestSvg(state.name, 52, 'rename');
  $('#name-sheet').hidden = false;
};

$('#menu-reset').onclick = async () => {
  $('#menu').hidden = true;
  const go = await ask('Clear every result?', {
    body: 'The players, the sports and the programme all stay. Only the scores go.',
    yes: 'Clear them',
    danger: true,
  });
  if (!go) return;
  state.matches.forEach((m) => {
    m.sides.forEach((side) => { side.score = null; });
    m.done = false;
    touchMatch(m);
  });
  saveState();
  $('#menu').hidden = true;
  view = 'sports';
  render();
  toast('Results cleared');
};

$('#menu-rebuild').onclick = async () => {
  $('#menu').hidden = true;
  const go = await ask('Draw up a fresh programme?', {
    body: 'Every sport gets new matches, and all results entered so far are cleared.',
    yes: 'Draw it up',
    danger: true,
  });
  if (!go) return;
  rememberRemoved(...state.matches.map((m) => m.id));
  buildAllProgrammes(state);
  state.matches.forEach(touchMatch);
  saveState();
  view = 'sports';
  openSportId = null;
  render();
  toast('New programme drawn up');
};

/* Starting another championship no longer costs you this one: it is kept on
   the phone and you switch back to it from "Your championships".            */
$('#menu-new').onclick = () => {
  $('#menu').hidden = true;
  startAnotherChampionship();
};

$('#menu-delete').onclick = async () => {
  $('#menu').hidden = true;
  await deleteChampionship(state.id);
};

$('#menu-champs').onclick = () => {
  $('#menu').hidden = true;
  openChampsSheet();
};

$('#menu-online').onclick = () => { $('#menu').hidden = true; openOnlineSheet(); };
$('#online-close').onclick = () => { $('#online-sheet').hidden = true; };
$('#online-refresh').onclick = () => openOnlineSheet();
$('#online-put').onclick = putOnline;
$('#menu-share-champ').onclick = () => { $('#menu').hidden = true; shareChampionship(); };
$('#menu-export').onclick = () => { $('#menu').hidden = true; exportChampionship(); };
$('#menu-import').onclick = () => { $('#menu').hidden = true; $('#import-file').click(); };
$('#import-file').onchange = (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = ''; // so the same file can be opened twice in a row
  if (file) importChampionship(file);
};

/* How much of the screen the on-screen keyboard is covering. The layout
   viewport does not shrink when the keyboard opens on a phone, so anything
   pinned to the bottom would sit underneath it; the visual viewport does know,
   and every pinned action follows it. */
function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const sync = () => {
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--keyboard', `${Math.round(covered)}px`);
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
}
trackKeyboard();

// The nav bar keeps its hairline hidden until the content slides under it.
const topbar = $('#topbar');
const syncTopbar = () => topbar.classList.toggle('scrolled', window.scrollY > 4);
window.addEventListener('scroll', syncTopbar, { passive: true });
syncTopbar();

render();

// a shared championship keeps itself in step with everybody else's phone
serverIsThere().then((there) => {
  hasServer = there;
  $('#menu-online').hidden = !there;
  $('#btn-setup-online').hidden = !there || Boolean(state);
  if (there) keepInStep();
});
window.addEventListener('online', () => pushAndPull());
document.addEventListener('visibilitychange', () => { if (!document.hidden) pushAndPull(); });

// a link with a championship in it opens straight into that championship —
// on the first load, and again if a link is tapped while the app is open
openFromLink();
window.addEventListener('hashchange', openFromLink);

/* ============================ KEEPING IT CURRENT ======================== */
/* Added to the home screen, the app has no reload button, and the phone
   brings it back exactly as it was left — so a fix could sit on the server
   for days without ever reaching the screen. The app therefore checks for a
   new version itself, every time it is opened or brought back to the front,
   and reloads once when one arrives. "Update the app" in the menu is the way
   out if even that gets stuck.                                             */

$('#app-version').textContent = `Version ${APP_VERSION} · ${APP_DATE}`;

if ('serviceWorker' in navigator) {
  // a first install also changes the controller; only a real update reloads
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .then((registration) => {
        const check = () => registration.update().catch(() => {});
        check();
        // coming back to the app is the moment a waiting fix should land
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) check();
        });
        window.addEventListener('focus', check);
      })
      .catch(() => {
        /* offline support is a bonus, never a blocker */
      });
  });
}

async function forceUpdate() {
  toast('Fetching the newest version…');
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* nothing kept — reloading is still the right next step */
  }
  // a fresh address the phone has never cached, so nothing stale can win
  location.replace(`${location.pathname}?fresh=${Date.now()}`);
}

$('#menu-update').onclick = forceUpdate;
