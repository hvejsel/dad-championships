import {
  buildSchedule,
  standings,
  nextMatchIndex,
  progress,
  defaultDoublesMatchCount,
} from './tournament.js';

const STATE_KEY = 'dadchamps.state.v1';
const DRAFT_KEY = 'dadchamps.draft.v1';

const SPORT_SUGGESTIONS = [
  'Padel', 'Darts', 'Bowling', 'Table tennis', 'Mini golf', 'Pool',
  'Badminton', 'Basketball shootout', 'Beer pong', 'Shuffleboard',
];

const LIMITS = {
  sports: { min: 1, max: 10 },
  players: { min: 2, max: 16 },
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
  sportCount: 3,
  sportNames: SPORT_SUGGESTIONS.slice(0, 3),
  playerCount: 4,
  playerNames: ['', '', '', ''],
  format: '1v1',
  scoring: 'match',
  matchesPerSport: defaultDoublesMatchCount(4),
  matchesTouched: false,
};

let view = 'play';
let tableFilter = 'all';
let editingMatchId = null;

const saveState = () => save(STATE_KEY, state);
const saveDraft = () => save(DRAFT_KEY, draft);

/* ------------------------------- helpers ------------------------------- */

function nameOf(playerId) {
  const player = state.players.find((p) => p.id === playerId);
  return player ? player.name : '?';
}

function teamHtml(team) {
  return team.map((id) => escapeHtml(nameOf(id))).join(' <span class="and">&</span> ');
}

function teamText(team) {
  return team.map((id) => nameOf(id)).join(' & ');
}

function sportName(sportId) {
  const sport = state.sports.find((s) => s.id === sportId);
  return sport ? sport.name : '';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ================================ SETUP ================================ */

function clampCount(kind, value) {
  const limit = LIMITS[kind];
  const min = kind === 'players' && draft.format === '2v2' ? 4 : limit.min;
  return Math.min(limit.max, Math.max(min, value));
}

function renderSetup() {
  $$('#stepper li').forEach((li) => {
    const step = Number(li.dataset.step);
    li.classList.toggle('active', step === draft.step);
    li.classList.toggle('done', step < draft.step);
  });
  $$('.step').forEach((el) => { el.hidden = Number(el.dataset.step) !== draft.step; });

  $('#sports-count').textContent = draft.sportCount;
  $('#players-count').textContent = draft.playerCount;
  $('#matches-count').textContent = draft.matchesPerSport;

  renderNameList('#sport-names', draft.sportCount, draft.sportNames, 'sport', (i) =>
    SPORT_SUGGESTIONS[i] || `Sport ${i + 1}`
  );
  renderNameList('#player-names', draft.playerCount, draft.playerNames, 'player', (i) => `Dad ${i + 1}`);

  $$('#seg-format button').forEach((b) => b.classList.toggle('on', b.dataset.value === draft.format));
  $$('#seg-scoring button').forEach((b) => b.classList.toggle('on', b.dataset.value === draft.scoring));
  $('#field-matchcount').hidden = draft.format !== '2v2';

  renderPreview();
}

function renderNameList(selector, count, values, kind, placeholder) {
  const container = $(selector);
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'name-row';
    row.innerHTML = `
      <span class="badge">${i + 1}</span>
      <input type="text" data-kind="${kind}" data-index="${i}"
             value="${escapeHtml(values[i] || '')}"
             placeholder="${escapeHtml(placeholder(i))}"
             autocapitalize="words" autocomplete="off" spellcheck="false">`;
    container.appendChild(row);
  }
}

function resolvedNames(values, count, fallback) {
  return Array.from({ length: count }, (_, i) => (values[i] || '').trim() || fallback(i));
}

function renderPreview() {
  const players = draft.playerCount;
  const sports = draft.sportCount;
  const perSport =
    draft.format === '2v2' ? draft.matchesPerSport : (players * (players - 1)) / 2;
  const total = perSport * sports;
  const each =
    draft.format === '2v2'
      ? Math.round((perSport * 4 * 10) / players) / 10
      : players - 1;

  $('#setup-preview').innerHTML =
    `<strong>${total} matches</strong> in total — ${perSport} per sport across ${sports} ` +
    `${sports === 1 ? 'sport' : 'sports'}.<br>` +
    `Each dad plays about <strong>${each}</strong> ${each === 1 ? 'match' : 'matches'} per sport, ` +
    `one at a time on the same pitch.`;

  const error = validateDraft();
  $('#setup-error').hidden = !error;
  $('#setup-error').textContent = error || '';
  $('#btn-create').disabled = Boolean(error);
}

function validateDraft() {
  if (draft.format === '2v2' && draft.playerCount < 4) {
    return 'Doubles needs at least 4 dads. Go back and add more, or switch to 1 v 1.';
  }
  if (draft.playerCount < 2) return 'You need at least 2 dads.';
  if (draft.sportCount < 1) return 'Pick at least one sport.';
  return null;
}

function createChampionship() {
  if (validateDraft()) return;

  const sports = resolvedNames(draft.sportNames, draft.sportCount, (i) =>
    SPORT_SUGGESTIONS[i] || `Sport ${i + 1}`
  ).map((name, i) => ({ id: `s${i + 1}`, name }));

  const players = resolvedNames(draft.playerNames, draft.playerCount, (i) => `Dad ${i + 1}`).map(
    (name, i) => ({ id: `p${i + 1}`, name })
  );

  state = {
    version: 1,
    createdAt: new Date().toISOString(),
    format: draft.format,
    scoring: draft.scoring,
    players,
    sports,
    matchesPerSport: draft.matchesPerSport,
    matches: buildSchedule({
      format: draft.format,
      players,
      sports,
      matchesPerSport: draft.matchesPerSport,
    }),
  };

  saveState();
  view = 'play';
  tableFilter = 'all';
  render();
}

/* ================================= PLAY ================================= */

function renderPlay() {
  const body = $('#play-body');
  const index = nextMatchIndex(state.matches);
  const { done, total } = progress(state.matches);

  if (index === null) {
    const table = standings(state);
    const podium = table.slice(0, 3);
    const medals = ['🥇', '🥈', '🥉'];
    body.innerHTML = `
      <div class="champion">
        <div class="cup">🏆</div>
        <h2>Champion</h2>
        <p class="who">${escapeHtml(table[0].name)}</p>
        <p class="note">${table[0].points} points from ${total} matches</p>
        ${podium
          .map(
            (row, i) =>
              `<div class="up-next"><span class="label">${medals[i]} ${
                i === 0 ? 'Winner' : `Number ${i + 1}`
              }</span><strong>${escapeHtml(row.name)} — ${row.points} points</strong></div>`
          )
          .join('')}
        <button class="primary wide" id="btn-see-table">See the full table</button>
      </div>`;
    $('#btn-see-table').onclick = () => { view = 'table'; render(); };
    return;
  }

  const match = state.matches[index];
  const upcoming = state.matches[index + 1];
  const inSport = state.matches.filter((m) => m.sportId === match.sportId);
  const doneInSport = inSport.filter((m) => m.done).length;

  body.innerHTML = `
    <div class="play-head">
      <h2 class="play-sport">${escapeHtml(sportName(match.sportId))}</h2>
      <span class="play-count">Match ${doneInSport + 1} of ${inSport.length}</span>
    </div>
    <div class="bar"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>

    <div class="match-card">
      <p class="team-names">${teamHtml(match.teamA)}</p>
      <div class="score-control">
        <button class="round-btn" data-live="a" data-delta="-1" aria-label="Lower">−</button>
        <input id="live-a" type="number" inputmode="numeric" pattern="[0-9]*" min="0" value="0">
        <button class="round-btn" data-live="a" data-delta="1" aria-label="Raise">+</button>
      </div>
      <p class="vs">versus</p>
      <p class="team-names">${teamHtml(match.teamB)}</p>
      <div class="score-control">
        <button class="round-btn" data-live="b" data-delta="-1" aria-label="Lower">−</button>
        <input id="live-b" type="number" inputmode="numeric" pattern="[0-9]*" min="0" value="0">
        <button class="round-btn" data-live="b" data-delta="1" aria-label="Raise">+</button>
      </div>
    </div>

    <button class="primary wide" id="btn-save-live">Save result</button>

    ${
      upcoming
        ? `<div class="up-next"><span class="label">Up next — ${escapeHtml(
            sportName(upcoming.sportId)
          )}</span><strong>${teamText(upcoming.teamA)} vs ${teamText(upcoming.teamB)}</strong></div>`
        : `<div class="up-next"><span class="label">Up next</span><strong>Last match of the championship</strong></div>`
    }`;

  $$('[data-live]').forEach((btn) => {
    btn.onclick = () => {
      const input = $(`#live-${btn.dataset.live}`);
      input.value = Math.max(0, (Number(input.value) || 0) + Number(btn.dataset.delta));
    };
  });

  $('#btn-save-live').onclick = () => {
    recordResult(match.id, Number($('#live-a').value) || 0, Number($('#live-b').value) || 0);
    toast('Result saved');
  };
}

function recordResult(matchId, scoreA, scoreB) {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return;
  match.scoreA = Math.max(0, Math.round(scoreA));
  match.scoreB = Math.max(0, Math.round(scoreB));
  match.done = true;
  saveState();
  render();
}

/* ================================ TABLE ================================= */

function renderTable() {
  const chips = $('#table-chips');
  chips.innerHTML =
    `<button data-filter="all" class="${tableFilter === 'all' ? 'on' : ''}">Overall</button>` +
    state.sports
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
      '<p class="empty">No results yet.<br>Play the first match and the table fills itself in.</p>';
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const pointsHeader = state.scoring === 'score' ? 'Score' : 'Pts';

  $('#table-body').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th><th>Dad</th><th>P</th><th>W</th><th>D</th><th>L</th><th>+/−</th><th>${pointsHeader}</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row, i) => `
          <tr class="rank-${i + 1}">
            <td class="rank">${i < 3 ? `<span class="rank-medal">${medals[i]}</span>` : i + 1}</td>
            <td class="name">${escapeHtml(row.name)}</td>
            <td>${row.played}</td>
            <td>${row.won}</td>
            <td>${row.drawn}</td>
            <td>${row.lost}</td>
            <td>${row.diff > 0 ? '+' : ''}${row.diff}</td>
            <td class="pts">${row.points}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

/* =============================== SCHEDULE =============================== */

function renderSchedule() {
  const currentIndex = nextMatchIndex(state.matches);
  const currentId = currentIndex === null ? null : state.matches[currentIndex].id;

  $('#schedule-body').innerHTML = state.sports
    .map((sport) => {
      const matches = state.matches.filter((m) => m.sportId === sport.id);
      const played = matches.filter((m) => m.done).length;
      return `
        <div class="sport-block">
          <div class="sport-head">
            <h3>${escapeHtml(sport.name)}</h3>
            <span>${played} of ${matches.length} played</span>
          </div>
          ${matches
            .map(
              (m) => `
            <button class="fixture ${m.done ? 'played' : ''} ${m.id === currentId ? 'now' : ''}"
                    data-match="${m.id}">
              <span class="no">${m.roundInSport}</span>
              <span class="who">${teamHtml(m.teamA)}<br>${teamHtml(m.teamB)}</span>
              <span class="res">${m.done ? `${m.scoreA} – ${m.scoreB}` : '– – –'}</span>
            </button>`
            )
            .join('')}
        </div>`;
    })
    .join('');

  $$('#schedule-body .fixture').forEach((btn) => {
    btn.onclick = () => openSheet(btn.dataset.match);
  });
}

/* ============================= SCORE SHEET ============================== */

function openSheet(matchId) {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return;
  editingMatchId = matchId;
  $('#sheet-sport').textContent = `${sportName(match.sportId)} — match ${match.roundInSport}`;
  $('#sheet-team-a').innerHTML = teamHtml(match.teamA);
  $('#sheet-team-b').innerHTML = teamHtml(match.teamB);
  $('#sheet-score-a').value = match.scoreA ?? 0;
  $('#sheet-score-b').value = match.scoreB ?? 0;
  $('#sheet').hidden = false;
}

function closeSheet() {
  $('#sheet').hidden = true;
  editingMatchId = null;
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

  return `🏆 ${title}\n${done} of ${total} matches played\n\n${lines.join('\n')}`;
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
  ['play', 'table', 'schedule'].forEach((name) => {
    $(`#view-${name}`).hidden = setupMode || view !== name;
  });

  if (setupMode) {
    $('#champ-name').textContent = 'Dad Championships';
    $('#champ-sub').textContent = 'Set up a new championship';
    renderSetup();
    return;
  }

  const { done, total } = progress(state.matches);
  $('#champ-name').textContent = 'Dad Championships';
  $('#champ-sub').textContent =
    `${state.format} · ${state.sports.length} ${state.sports.length === 1 ? 'sport' : 'sports'} · ${done}/${total} played`;

  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));

  if (view === 'play') renderPlay();
  if (view === 'table') renderTable();
  if (view === 'schedule') renderSchedule();
}

/* =============================== WIRING ================================= */

document.addEventListener('click', (event) => {
  const countBtn = event.target.closest('[data-count]');
  if (countBtn) {
    const kind = countBtn.dataset.count;
    const delta = Number(countBtn.dataset.delta);
    if (kind === 'matches') {
      draft.matchesPerSport = Math.min(60, Math.max(1, draft.matchesPerSport + delta));
      draft.matchesTouched = true;
    } else {
      const field = kind === 'sports' ? 'sportCount' : 'playerCount';
      draft[field] = clampCount(kind, draft[field] + delta);
      if (kind === 'players' && !draft.matchesTouched) {
        draft.matchesPerSport = defaultDoublesMatchCount(draft.playerCount);
      }
    }
    saveDraft();
    renderSetup();
    return;
  }

  const goto = event.target.closest('[data-goto]');
  if (goto) {
    draft.step = Number(goto.dataset.goto);
    saveDraft();
    renderSetup();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const seg = event.target.closest('#seg-format button, #seg-scoring button');
  if (seg) {
    const group = seg.closest('.segmented').id;
    if (group === 'seg-format') {
      draft.format = seg.dataset.value;
      draft.playerCount = clampCount('players', draft.playerCount);
      if (!draft.matchesTouched) draft.matchesPerSport = defaultDoublesMatchCount(draft.playerCount);
    } else {
      draft.scoring = seg.dataset.value;
    }
    saveDraft();
    renderSetup();
    return;
  }

  const tab = event.target.closest('#tabs button');
  if (tab) {
    view = tab.dataset.view;
    render();
  }
});

document.addEventListener('input', (event) => {
  const input = event.target.closest('input[data-kind]');
  if (!input) return;
  const index = Number(input.dataset.index);
  const list = input.dataset.kind === 'sport' ? draft.sportNames : draft.playerNames;
  list[index] = input.value;
  saveDraft();
});

$('#btn-create').onclick = createChampionship;

$$('[data-score]').forEach((btn) => {
  btn.onclick = () => {
    const input = $(`#sheet-score-${btn.dataset.score}`);
    input.value = Math.max(0, (Number(input.value) || 0) + Number(btn.dataset.delta));
  };
});

$('#sheet-cancel').onclick = closeSheet;
$('#sheet').onclick = (event) => { if (event.target.id === 'sheet') closeSheet(); };
$('#sheet-save').onclick = () => {
  const id = editingMatchId;
  const a = Number($('#sheet-score-a').value) || 0;
  const b = Number($('#sheet-score-b').value) || 0;
  closeSheet();
  recordResult(id, a, b);
  toast('Result saved');
};

$('#btn-share').onclick = share;
$('#menu-share').onclick = () => { $('#menu').hidden = true; share(); };
$('#btn-menu').onclick = () => { $('#menu').hidden = false; };
$('#menu-close').onclick = () => { $('#menu').hidden = true; };
$('#menu').onclick = (event) => { if (event.target.id === 'menu') $('#menu').hidden = true; };

$('#menu-reset').onclick = () => {
  if (!confirm('Clear every result but keep the dads, the sports and the schedule?')) return;
  state.matches.forEach((m) => { m.scoreA = null; m.scoreB = null; m.done = false; });
  saveState();
  $('#menu').hidden = true;
  view = 'play';
  render();
  toast('Results cleared');
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

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* offline support is a bonus, never a blocker */
    });
  });
}
