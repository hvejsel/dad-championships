import {
  GENERATIONS,
  generationLabel,
  FORMATS,
  formatLabel,
  SCORINGS,
  scoringLabel,
  teamSize,
  isFreeForAll,
  orderedSports,
  matchesForSport,
  orderedMatches,
  fixtureCount,
  buildProgramme,
  buildAllProgrammes,
  validateMatch,
  createMatch,
  winningSide,
  standings,
  nextUnplayed,
  progress,
} from './tournament.js';

const STATE_KEY = 'dadchamps.state.v3';
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

/* -------------------------------- state -------------------------------- */

let state = load(STATE_KEY, null);

let draft = load(DRAFT_KEY, null) || {
  step: 1,
  playerCount: 4,
  playerNames: ['', '', '', ''],
  playerGenerations: ['dad', 'dad', 'granddad', 'kid'],
  sportCount: 3,
  sportNames: SPORT_SUGGESTIONS.slice(0, 3),
  sportCustom: [false, false, false],
  sportFormats: ['1v1', '1v1', '1v1'],
  sportScorings: ['match', 'match', 'match'],
};

let view = 'matches';
let tableFilter = 'all';
let editingMatchId = null;
let editingSportId = null;
let picking = null; // { sportId, sides: Map<playerId, 'a'|'b'> }

const saveState = () => save(STATE_KEY, state);
const saveDraft = () => save(DRAFT_KEY, draft);

/* ------------------------------- helpers ------------------------------- */

function playerOf(playerId) {
  return state.players.find((p) => p.id === playerId);
}

function nameOf(playerId) {
  const player = playerOf(playerId);
  return player ? player.name : '?';
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
        `<option value="${escapeHtml(o.value)}"${o.value === value ? ' selected' : ''}>${escapeHtml(
          o.label
        )}</option>`
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

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ================================ SETUP ================================ */

function renderSetup() {
  $$('#stepper li').forEach((li) => {
    const step = Number(li.dataset.step);
    li.classList.toggle('active', step === draft.step);
    li.classList.toggle('done', step < draft.step);
  });
  $$('.step').forEach((el) => { el.hidden = Number(el.dataset.step) !== draft.step; });

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
    const matches = fixtureCount(draft.playerCount, format);

    const row = document.createElement('div');
    row.className = 'sport-row';
    row.innerHTML = `
      ${selectHtml({
        attr: `data-sport-index="${i}" aria-label="Sport ${i + 1}"`,
        options: [
          ...SPORT_SUGGESTIONS.map((s) => ({ value: s, label: s })),
          { value: OTHER, label: 'Other sport…' },
        ],
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
          options: FORMATS.map((f) => ({ value: f.id, label: f.label })),
          value: format,
          extra: 'sel-soft',
        })}
        ${selectHtml({
          attr: `data-scoring-index="${i}" aria-label="Point type"`,
          options: SCORINGS.map((s) => ({ value: s.id, label: s.label })),
          value: scoring,
          extra: 'sel-soft',
        })}
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

  const total = draft.sportFormats
    .slice(0, draft.sportCount)
    .reduce((sum, format) => sum + fixtureCount(draft.playerCount, format || '1v1'), 0);

  $('#setup-preview').innerHTML =
    `<strong>${parts.join(', ')}</strong> across ` +
    `<strong>${draft.sportCount}</strong> ${draft.sportCount === 1 ? 'sport' : 'sports'}. ` +
    `The app draws up <strong>${total}</strong> ${total === 1 ? 'match' : 'matches'} by itself, ` +
    `so everyone meets everyone.<br>` +
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
    time: null, // set later, on the match list, as the courts are booked
  }));

  state = {
    version: 3,
    createdAt: new Date().toISOString(),
    players,
    sports,
    matches: [],
    nextMatchNo: 0,
  };
  buildAllProgrammes(state);

  saveState();
  view = 'matches';
  tableFilter = 'all';
  render();
}

/* =============================== MATCHES =============================== */

function fixtureRow(match, upNext) {
  const isNow = upNext && match.id === upNext.id;
  const classes = `fixture ${match.done ? 'played' : ''} ${isNow ? 'now' : ''}`;

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
          .map((side) => escapeHtml(nameOf(side.players[0])))
          .join(' <span class="and">·</span> ')}</span>
        <span class="res">${result}</span>
      </button>`;
  }

  const [a, b] = match.sides;
  return `
    <button class="${classes}" data-match="${match.id}">
      <span class="who">${teamHtml(a.players)}<br>${teamHtml(b.players)}</span>
      <span class="res">${
        match.done ? `${a.score} – ${b.score}` : isNow ? '<em>Up next</em>' : '—'
      }</span>
    </button>`;
}

function renderMatches() {
  const body = $('#matches-body');
  const { done, total } = progress(state.matches);
  const upNext = nextUnplayed(state);
  const timed = state.sports.filter((s) => s.time).length;

  const header = total
    ? `<div class="bar"><i style="width:${(done / total) * 100}%"></i></div>
       <p class="eyebrow">${done} of ${total} ${total === 1 ? 'match' : 'matches'} played</p>`
    : '';

  const banner =
    upNext && sportOf(upNext.sportId).time
      ? `<div class="up-next">
           <span class="label">Next up — ${escapeHtml(sportOf(upNext.sportId).time)}</span>
           <strong>${escapeHtml(sportName(upNext.sportId))}: ${
             upNext.sides.length > 2
               ? 'everybody'
               : `${escapeHtml(teamText(upNext.sides[0].players))} vs ${escapeHtml(
                   teamText(upNext.sides[1].players)
                 )}`
           }</strong>
         </div>`
      : '';

  // Times are put on as the courts are booked, so the list says what is missing.
  const timeHint =
    timed < state.sports.length
      ? `<p class="hint time-hint">${
          timed === 0
            ? 'Tap a sport to set the time when you have booked it.'
            : `${state.sports.length - timed} ${
                state.sports.length - timed === 1 ? 'sport has' : 'sports have'
              } no time yet — tap to set it.`
        } The list sorts itself by time.</p>`
      : '';

  const blocks = orderedSports(state.sports)
    .map((sport) => {
      const matches = matchesForSport(state.matches, sport.id);
      const playedHere = matches.filter((m) => m.done).length;

      return `
        <div class="sport-block">
          <div class="sport-head">
            <div class="sport-head-main">
              <h3>${escapeHtml(sport.name)}</h3>
              <button class="time-chip ${sport.time ? 'set' : ''}" data-sport="${sport.id}">
                ${sport.time ? escapeHtml(sport.time) : 'Set time'}
              </button>
            </div>
            <span>${escapeHtml(formatLabel(sport.format))} · ${escapeHtml(
              scoringLabel(sport.scoring)
            )} · ${
              matches.length ? `${playedHere} of ${matches.length} played` : 'no matches'
            }</span>
          </div>

          ${
            matches.length
              ? `<div class="fixtures">${matches.map((m) => fixtureRow(m, upNext)).join('')}</div>`
              : ''
          }

          ${
            isFreeForAll(sport.format)
              ? ''
              : `<button class="add-match" data-add="${sport.id}">
                   <span aria-hidden="true">+</span> Add an extra match
                 </button>`
          }
        </div>`;
    })
    .join('');

  body.innerHTML = header + banner + timeHint + blocks;

  $$('#matches-body .fixture').forEach((btn) => {
    btn.onclick = () => openScoreSheet(btn.dataset.match);
  });
  $$('#matches-body .time-chip').forEach((btn) => {
    btn.onclick = () => openSportSheet(btn.dataset.sport);
  });
  $$('#matches-body .add-match').forEach((btn) => {
    btn.onclick = () => openPickSheet(btn.dataset.add);
  });
}

/* ========================== EXTRA MATCH BUILDER ========================= */

function openPickSheet(sportId) {
  const sport = sportOf(sportId);
  picking = { sportId, sides: new Map() };
  $('#pick-title').textContent = `${sport.name} — ${formatLabel(sport.format)}`;
  $('#pick-error').hidden = true;
  renderPickList();
  $('#pick-sheet').hidden = false;
}

function renderPickList() {
  const sport = sportOf(picking.sportId);
  const size = teamSize(sport.format);
  const countA = [...picking.sides.values()].filter((v) => v === 'a').length;
  const countB = [...picking.sides.values()].filter((v) => v === 'b').length;

  $('#pick-counts').innerHTML =
    `<span class="side-a">Side A ${countA}/${size}</span>` +
    `<span class="side-b">Side B ${countB}/${size}</span>`;

  $('#pick-list').innerHTML = state.players
    .map((p) => {
      const side = picking.sides.get(p.id);
      return `
      <button class="pick-row ${side ? `on side-${side}` : ''}" data-pick="${p.id}">
        <span class="pick-name">${escapeHtml(p.name)}</span>
        ${genTag(p.generation)}
        <span class="pick-slot">${side ? side.toUpperCase() : ''}</span>
      </button>`;
    })
    .join('');

  $$('#pick-list .pick-row').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.pick;
      const current = picking.sides.get(id);
      // Tapping cycles a player through side A, side B and off again.
      if (!current) picking.sides.set(id, 'a');
      else if (current === 'a') picking.sides.set(id, 'b');
      else picking.sides.delete(id);
      $('#pick-error').hidden = true;
      renderPickList();
    };
  });
}

function confirmPick() {
  const sport = sportOf(picking.sportId);
  const teamA = [...picking.sides.entries()].filter(([, s]) => s === 'a').map(([id]) => id);
  const teamB = [...picking.sides.entries()].filter(([, s]) => s === 'b').map(([id]) => id);
  const error = validateMatch(teamA, teamB, sport.format);
  if (error) {
    $('#pick-error').textContent = error;
    $('#pick-error').hidden = false;
    return;
  }
  state.matches.push(createMatch(state, picking.sportId, teamA, teamB));
  saveState();
  $('#pick-sheet').hidden = true;
  picking = null;
  render();
  toast('Match added');
}

/* ============================ SPORT SETTINGS =========================== */

function openSportSheet(sportId) {
  const sport = sportOf(sportId);
  editingSportId = sportId;
  $('#sport-sheet-title').textContent = sport.name;
  $('#sport-time').value = sport.time || '';

  $('#sport-format-field').innerHTML = selectHtml({
    id: 'sport-format',
    options: FORMATS.map((f) => ({ value: f.id, label: `${f.label} — ${f.note}` })),
    value: sport.format,
    extra: 'sel-wide',
  });
  $('#sport-scoring-field').innerHTML = selectHtml({
    id: 'sport-scoring',
    options: SCORINGS.map((s) => ({ value: s.id, label: `${s.label} — ${s.note}` })),
    value: sport.scoring,
    extra: 'sel-wide',
  });

  $('#sport-sheet').hidden = false;
}

function saveSportSheet() {
  const sport = sportOf(editingSportId);
  const time = $('#sport-time').value || null;
  const format = $('#sport-format').value;
  const scoring = $('#sport-scoring').value;

  if (format !== sport.format) {
    const shortage = FORMATS.find((f) => f.id === format);
    if (state.players.length < shortage.min) {
      toast(`${shortage.label} needs at least ${shortage.min} players`);
      return;
    }
    const finished = matchesForSport(state.matches, sport.id).filter((m) => m.done).length;
    const question = finished
      ? `Change ${sport.name} to ${formatLabel(format)}? A new programme is drawn up and the ${finished} ${
          finished === 1 ? 'result' : 'results'
        } already entered for this sport are lost.`
      : `Change ${sport.name} to ${formatLabel(format)}? A new programme is drawn up for this sport.`;
    if (!confirm(question)) return;

    sport.format = format;
    state.matches = state.matches.filter((m) => m.sportId !== sport.id);
    state.matches.push(...buildProgramme(state, sport.id));
  }
  sport.scoring = scoring;
  sport.time = time;

  saveState();
  $('#sport-sheet').hidden = true;
  editingSportId = null;
  render();
  toast('Sport updated');
}

/* ============================== SCORE SHEET ============================= */

function scoreStepper(key, value) {
  return `
    <div class="score-control">
      <button class="round-btn" data-score="${key}" data-delta="-1" aria-label="Lower">−</button>
      <input id="score-${key}" type="number" inputmode="numeric" pattern="[0-9]*" min="0" value="${value}">
      <button class="round-btn" data-score="${key}" data-delta="1" aria-label="Raise">+</button>
    </div>`;
}

function openScoreSheet(matchId) {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return;
  editingMatchId = matchId;
  $('#sheet-sport').textContent = sportName(match.sportId);

  if (match.sides.length > 2) {
    // All vs all: everybody enters his own score in one list.
    $('#sheet-body').innerHTML = `
      <div class="ffa-scores">
        ${match.sides
          .map(
            (side, i) => `
          <div class="ffa-row">
            <span class="ffa-name">${escapeHtml(nameOf(side.players[0]))}
              ${genTag(playerOf(side.players[0]).generation)}</span>
            ${scoreStepper(String(i), side.score ?? 0)}
          </div>`
          )
          .join('')}
      </div>`;
  } else {
    $('#sheet-body').innerHTML = `
      <div class="score-row">
        <div class="court-side">
          <p class="team-names">${teamHtml(match.sides[0].players)}</p>
          ${scoreStepper('0', match.sides[0].score ?? 0)}
        </div>
        <div class="net"><span>VS</span></div>
        <div class="court-side">
          <p class="team-names">${teamHtml(match.sides[1].players)}</p>
          ${scoreStepper('1', match.sides[1].score ?? 0)}
        </div>
      </div>`;
  }

  $$('#sheet-body [data-score]').forEach((btn) => {
    btn.onclick = () => {
      const input = $(`#score-${btn.dataset.score}`);
      input.value = Math.max(0, (Number(input.value) || 0) + Number(btn.dataset.delta));
    };
  });

  // A generated match belongs to the programme; only an extra one is removable.
  $('#sheet-remove').hidden = match.sides.length > 2;
  $('#sheet').hidden = false;
}

function closeSheet() {
  $('#sheet').hidden = true;
  editingMatchId = null;
}

function saveScoreSheet() {
  const match = state.matches.find((m) => m.id === editingMatchId);
  if (!match) return closeSheet();
  match.sides.forEach((side, i) => {
    const input = $(`#score-${i}`);
    side.score = Math.max(0, Math.round(Number(input && input.value) || 0));
  });
  match.done = true;
  closeSheet();
  saveState();
  render();
  toast('Result saved');
}

/* ================================ TABLE ================================= */

function pointsHeaderFor(filter) {
  if (filter === 'all') return 'Pts';
  const sport = sportOf(filter);
  return sport && sport.scoring === 'score' ? 'Score' : 'Pts';
}

function renderTable() {
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

  const scope = state.matches.filter((m) => tableFilter === 'all' || m.sportId === tableFilter);
  const playedHere = scope.filter((m) => m.done).length;
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

  const finished = scope.length > 0 && playedHere === scope.length;

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

    <p class="eyebrow">After ${playedHere} of ${scope.length} ${scope.length === 1 ? 'match' : 'matches'}</p>
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
  const title = tableFilter === 'all' ? 'Dad Championships' : `Dad Championships — ${sportName(tableFilter)}`;
  const medals = ['🥇', '🥈', '🥉'];
  const width = Math.max(...rows.map((r) => r.name.length));

  const lines = rows.map((row, i) => {
    const rank = i < 3 ? medals[i] : `${i + 1}.`;
    return `${rank} ${row.name.padEnd(width)}  ${row.points}`;
  });

  const timetable = orderedSports(state.sports)
    .filter((s) => s.time)
    .map((s) => `${s.time}  ${s.name}`);

  return (
    `🏆 ${title}\n${done} of ${total} matches played\n\n${lines.join('\n')}` +
    (timetable.length ? `\n\nToday\n${timetable.join('\n')}` : '')
  );
}

async function share() {
  const text = shareText();
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('Table copied');
  } catch {
    /* the user dismissed the share sheet — nothing to report */
  }
}

/* ================================ RENDER ================================ */

function render() {
  const setupMode = !state;

  $('#view-setup').hidden = !setupMode;
  $('#tabs').hidden = setupMode;
  $('#btn-menu').hidden = setupMode;
  ['matches', 'table'].forEach((name) => {
    $(`#view-${name}`).hidden = setupMode || view !== name;
  });

  if (setupMode) {
    $('#champ-name').textContent = 'Dad Championships';
    $('#champ-sub').textContent = 'Set up a new championship';
    renderSetup();
    return;
  }

  const counts = { dad: 0, granddad: 0, kid: 0 };
  for (const p of state.players) counts[p.generation] = (counts[p.generation] || 0) + 1;
  const who = GENERATIONS.filter((g) => counts[g.id] > 0)
    .map((g) => `${counts[g.id]} ${g.label.toLowerCase()}${counts[g.id] === 1 ? '' : 's'}`)
    .join(' · ');

  $('#champ-name').textContent = 'Dad Championships';
  $('#champ-sub').textContent = who;

  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));

  if (view === 'matches') renderMatches();
  if (view === 'table') renderTable();
}

/* =============================== WIRING ================================= */

document.addEventListener('change', (event) => {
  const select = event.target.closest('select');
  if (!select) return;

  if (select.dataset.count) {
    const field = select.dataset.count === 'sports' ? 'sportCount' : 'playerCount';
    draft[field] = Number(select.value);
    saveDraft();
    renderSetup();
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
    render();
  }
});

document.addEventListener('input', (event) => {
  const nameInput = event.target.closest('input[data-kind]');
  if (!nameInput) return;
  const index = Number(nameInput.dataset.index);
  const list = nameInput.dataset.kind === 'sport' ? draft.sportNames : draft.playerNames;
  list[index] = nameInput.value;
  saveDraft();
  renderPreview();
});

$('#btn-create').onclick = createChampionship;

$('#sheet-cancel').onclick = closeSheet;
$('#sheet').onclick = (event) => { if (event.target.id === 'sheet') closeSheet(); };
$('#sheet-save').onclick = saveScoreSheet;
$('#sheet-remove').onclick = () => {
  if (!confirm('Remove this match from the championship?')) return;
  const id = editingMatchId;
  closeSheet();
  state.matches = state.matches.filter((m) => m.id !== id);
  saveState();
  render();
  toast('Match removed');
};

$('#pick-cancel').onclick = () => { $('#pick-sheet').hidden = true; picking = null; };
$('#pick-sheet').onclick = (event) => {
  if (event.target.id === 'pick-sheet') { $('#pick-sheet').hidden = true; picking = null; }
};
$('#pick-save').onclick = confirmPick;

$('#sport-cancel').onclick = () => { $('#sport-sheet').hidden = true; editingSportId = null; };
$('#sport-sheet').onclick = (event) => {
  if (event.target.id === 'sport-sheet') { $('#sport-sheet').hidden = true; editingSportId = null; }
};
$('#sport-save').onclick = saveSportSheet;
$('#sport-time-clear').onclick = () => { $('#sport-time').value = ''; };

$('#btn-share').onclick = share;
$('#menu-share').onclick = () => { $('#menu').hidden = true; share(); };
$('#btn-menu').onclick = () => { $('#menu').hidden = false; };
$('#menu-close').onclick = () => { $('#menu').hidden = true; };
$('#menu').onclick = (event) => { if (event.target.id === 'menu') $('#menu').hidden = true; };

$('#menu-reset').onclick = () => {
  if (!confirm('Clear every result but keep the players, the sports and the programme?')) return;
  state.matches.forEach((m) => {
    m.sides.forEach((side) => { side.score = null; });
    m.done = false;
  });
  saveState();
  $('#menu').hidden = true;
  view = 'matches';
  render();
  toast('Results cleared');
};

$('#menu-rebuild').onclick = () => {
  if (!confirm('Draw up a fresh programme for every sport? All results are cleared.')) return;
  buildAllProgrammes(state);
  saveState();
  $('#menu').hidden = true;
  view = 'matches';
  render();
  toast('New programme drawn up');
};

$('#menu-new').onclick = () => {
  if (!confirm('Start over? This championship and all its results are deleted.')) return;
  state = null;
  localStorage.removeItem(STATE_KEY);
  draft.step = 1;
  saveDraft();
  $('#menu').hidden = true;
  render();
};

// The nav bar keeps its hairline hidden until the content slides under it.
const topbar = $('#topbar');
const syncTopbar = () => topbar.classList.toggle('scrolled', window.scrollY > 4);
window.addEventListener('scroll', syncTopbar, { passive: true });
syncTopbar();

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* offline support is a bonus, never a blocker */
    });
  });
}
