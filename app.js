// ============================================================================
// app.js — state management and DOM rendering. All time/search/scoring logic
// lives in core.js and is loaded before this file. Keeping them separate lets
// core.js be unit-tested with plain `node tests/core.test.js`, no DOM needed.
// ============================================================================

const EMOJI_OPTIONS = ["😀","😎","🦊","🐼","🐨","🐸","🦁","🐯","🐵","🦉","🐳","🌵","🌸","⚡","🔥","🌙","☀️","🍀","🎧","🚀","☕","🏄","🎨","📚"];
const COLOR_OPTIONS = ["#F2A65A","#7C9CFF","#6FCF97","#E37373","#C792EA","#5DD5C8","#F2D06B","#FF8FB1","#9AA5FF","#8AD6C7"];
const STORE_KEY = "timetogether_v2";
const THEME_KEY = "timetogether_theme";

/* ---------------------------------------------------------------------------
 * STATE
 * `state.me`, when set, is a single person-shaped record kept OUTSIDE every
 * group's people list, so it's defined once and pinned into every group's
 * view instead of being duplicated (and going stale) per group.
 * -------------------------------------------------------------------------*/

const uid = () => Math.random().toString(36).slice(2, 10);

function seedState() {
  const person = (name, cityName, emoji, color) => {
    const c = PLACES.find(p => p.name === cityName) || PLACES[0];
    return {
      id: uid(), name, nickname: '', city: c.name, tz: c.tz, lat: c.lat, lon: c.lon,
      avatarMode: 'emoji', emoji, photoUrl: '', color
    };
  };
  const g1 = {
    id: uid(), name: 'Example Team', sortByTime: false,
    people: [
      person('Amy', 'San Francisco', '😎', '#F2A65A'),
      person('Raj', 'Bengaluru', '🚀', '#7C9CFF'),
      person('Lena', 'Berlin', '🌸', '#6FCF97'),
      person('Kenji', 'Tokyo', '🔥', '#E37373'),
    ]
  };
  return { activeGroup: g1.id, groups: [g1], me: null };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw);
    if (!parsed.groups || !parsed.groups.length) return seedState();
    if (!('me' in parsed)) parsed.me = null;
    parsed.groups.forEach(g => { if (!('sortByTime' in g)) g.sortByTime = false; });
    return parsed;
  } catch (e) {
    console.warn('Could not read saved data, starting fresh.', e);
    return seedState();
  }
}

let state = loadState();
const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));
const activeGroup = () => state.groups.find(g => g.id === state.activeGroup) || state.groups[0];

/* ---------------------------------------------------------------------------
 * THEME
 * -------------------------------------------------------------------------*/

function loadTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; }
  catch (e) { return 'dark'; }
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  const btn = el('themeToggleBtn');
  if (btn) btn.innerHTML = theme === 'dark'
    ? `<span class="sd-icon">☀</span>Light mode`
    : `<span class="sd-icon">☾</span>Dark mode`;
}
let currentTheme = loadTheme();
applyTheme(currentTheme);

/* ---------------------------------------------------------------------------
 * DOM refs & small utilities
 * -------------------------------------------------------------------------*/

const el = (id) => document.getElementById(id);
const tabsEl = el('tabs');
const contentEl = el('content');
const panelTitleEl = el('panelTitle');
const nowReadoutEl = el('nowReadout');
const tooltipEl = el('tooltip');
const panelToolbarEl = el('panelToolbar');
const tabsFadeLeftEl = el('tabsFadeLeft');
const tabsFadeRightEl = el('tabsFadeRight');
const sortToggleEl = el('sortToggle');

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function avatarInner(p) {
  if (p.avatarMode === 'photo' && p.photoUrl) return `<img src="${escapeHtml(p.photoUrl)}" alt="">`;
  if (p.avatarMode === 'nickname' && p.nickname) return escapeHtml(p.nickname.slice(0, 3));
  if (p.avatarMode === 'emoji' && p.emoji) return p.emoji;
  const initials = p.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return initials || '?';
}

function buildGradient(sunrise, sunset) {
  // Colors read from CSS custom properties so the gradient adapts to the
  // active theme instead of being hardcoded to dark-mode values.
  const rootStyle = getComputedStyle(document.documentElement);
  const dayColor = rootStyle.getPropertyValue('--day-fill').trim() || 'rgba(124,156,255,0.22)';
  const nightColor = rootStyle.getPropertyValue('--night-fill').trim() || 'rgba(10,11,18,0.9)';
  if (sunrise === null || sunset === null) return `linear-gradient(90deg, ${nightColor}, ${nightColor})`;
  const pct = h => (h / 24 * 100).toFixed(2) + '%';
  const fadeW = 0.7;
  const sr1 = Math.max(0, sunrise - fadeW), sr2 = Math.min(24, sunrise + fadeW);
  const ss1 = Math.max(0, sunset - fadeW), ss2 = Math.min(24, sunset + fadeW);
  return `linear-gradient(90deg,
    ${nightColor} 0%, ${nightColor} ${pct(sr1)},
    ${dayColor} ${pct(sr2)}, ${dayColor} ${pct(ss1)},
    ${nightColor} ${pct(ss2)}, ${nightColor} 100%)`;
}

/** "1 AM", "12 PM", etc. Full AM/PM instead of a bare "a"/"p" for readability (#9). */
function hourScaleLabels() {
  let s = '';
  for (let h = 0; h < 24; h++) {
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const ampm = h < 12 ? 'AM' : 'PM';
    s += `<span>${h12} ${ampm}</span>`;
  }
  return s;
}

function showTooltip(e, text) {
  tooltipEl.textContent = text;
  tooltipEl.classList.add('show');
  positionTooltip(e);
}
function positionTooltip(e) {
  tooltipEl.style.left = e.clientX + 'px';
  tooltipEl.style.top = e.clientY + 'px';
}
function hideTooltip() { tooltipEl.classList.remove('show'); }

/* ---------------------------------------------------------------------------
 * RENDERING
 * -------------------------------------------------------------------------*/

function updateTabsFade() {
  if (!tabsEl || !tabsFadeLeftEl || !tabsFadeRightEl) return;
  const overflowing = tabsEl.scrollWidth > tabsEl.clientWidth + 2;
  tabsFadeLeftEl.classList.toggle('show', overflowing && tabsEl.scrollLeft > 4);
  tabsFadeRightEl.classList.toggle('show', overflowing && tabsEl.scrollLeft < tabsEl.scrollWidth - tabsEl.clientWidth - 4);
}
if (tabsEl) tabsEl.addEventListener('scroll', updateTabsFade);
window.addEventListener('resize', updateTabsFade);

function renderTabs() {
  tabsEl.innerHTML = '';
  state.groups.forEach(g => {
    const t = document.createElement('div');
    t.className = 'tab' + (g.id === state.activeGroup ? ' active' : '');
    t.setAttribute('role', 'button');
    t.tabIndex = 0;
    t.innerHTML = `<span>${escapeHtml(g.name)}</span><span class="count">${g.people.length}</span>`;
    t.addEventListener('click', () => { state.activeGroup = g.id; save(); renderAll(); });
    t.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') t.click(); });
    tabsEl.appendChild(t);
  });
  // Fade indicators need layout to settle before measuring scrollWidth.
  requestAnimationFrame(updateTabsFade);
}

function renderPanelTitle() {
  panelTitleEl.value = activeGroup().name;
}

function renderPanelToolbar() {
  const g = activeGroup();
  const effectiveCount = g.people.length + (state.me ? 1 : 0);
  panelToolbarEl.innerHTML = `
    <button class="add-person-btn" id="addPersonBtn" type="button">+ Add person</button>
    ${effectiveCount >= 2 ? `<button class="suggest-btn" id="suggestBtn" type="button">✨ Suggest meeting times</button>` : ''}
  `;
  el('addPersonBtn').addEventListener('click', () => openPersonModal());
  const suggestBtn = el('suggestBtn');
  if (suggestBtn) suggestBtn.addEventListener('click', () => openSuggestModal());

  sortToggleEl.classList.toggle('active', !!g.sortByTime);
  sortToggleEl.setAttribute('aria-pressed', g.sortByTime ? 'true' : 'false');
}

sortToggleEl.addEventListener('click', () => {
  const g = activeGroup();
  g.sortByTime = !g.sortByTime;
  save(); renderPanelToolbar(); renderContent();
});
sortToggleEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') sortToggleEl.click(); });

/** People to actually display for a group: "me" pinned first (if set), then
 * the group's own people, optionally sorted earliest-to-latest local time. */
function displayPeopleFor(g, now) {
  const list = state.me ? [{ ...state.me, isMe: true }, ...g.people] : g.people.slice();
  if (!g.sortByTime) return list;
  return list
    .map(p => ({ p, hourFloat: localTimeParts(p.tz, now).hourFloat }))
    .sort((a, b) => a.hourFloat - b.hourFloat)
    .map(x => x.p);
}

function renderContent() {
  const g = activeGroup();
  const now = new Date();
  const people = displayPeopleFor(g, now);

  if (!people.length) {
    contentEl.innerHTML = `
      <div class="empty-state">
        <div class="glyph">🌍</div>
        <h3>No one in this group yet</h3>
        <p>Use "+ Add person" above to add a teammate — you'll see exactly where they are in their day, updating live.</p>
      </div>`;
    return;
  }

  let html = `<div class="rows">`;
  people.forEach(p => {
    const { hourFloat } = localTimeParts(p.tz, now);
    const clock = formatClock(p.tz, now);
    const [time, ampm] = clock.split(' ');
    const sun = sunTimes(p.lat, p.lon, p.tz, now);
    const gradient = buildGradient(sun.sunrise, sun.sunset);
    const leftPct = (hourFloat / 24 * 100).toFixed(3);

    let isDay = sun.sunrise !== null && sun.sunset !== null
      ? (hourFloat >= sun.sunrise && hourFloat <= sun.sunset)
      : true;
    const cost = personHourCost(hourFloat);
    let labelClass = 'night', labelText = 'Night';
    if (cost === 0) { labelClass = 'good'; labelText = 'Working hrs'; }
    else if (isDay) { labelClass = 'day'; labelText = 'Day'; }

    const workLeft = (SCORING.workStart / 24 * 100).toFixed(3);
    const workWidth = ((SCORING.workEnd - SCORING.workStart) / 24 * 100).toFixed(3);

    const actions = p.isMe
      ? `<div class="row-actions"><button class="editBtn" title="Edit your info" aria-label="Edit your info">✎</button></div>`
      : `<div class="row-actions">
           <button class="editBtn" title="Edit" aria-label="Edit ${escapeHtml(p.name)}">✎</button>
           <button class="delBtn" title="Remove from this group" aria-label="Remove ${escapeHtml(p.name)}">🗑</button>
         </div>`;

    html += `
    <div class="person-row${p.isMe ? ' is-you' : ''}" data-id="${p.id}" data-is-me="${!!p.isMe}">
      <div class="row-top">
        <div class="row-avatar${p.isMe ? ' row-avatar-you' : ''}" style="background:${p.color}">${avatarInner(p)}</div>
        <div class="row-meta">
          <div class="row-name">${escapeHtml(p.name)}${p.isMe ? '<span class="you-badge">You</span>' : ''}</div>
          <div class="row-city">${escapeHtml(p.city)}</div>
        </div>
        <div class="row-daylabel ${labelClass}">${labelText}</div>
        <div class="row-time${p.isMe ? ' row-time-you' : ''}">${time}<span class="ampm">${ampm}</span></div>
        ${actions}
      </div>
      <div class="track-wrap">
        <div class="track">
          <div class="track-gradient" style="background:${gradient}"></div>
          <div class="worktime-band" style="left:${workLeft}%; width:${workWidth}%"></div>
          <div class="track-hourlines">${'<div></div>'.repeat(24)}</div>
          <div class="now-tick" style="left:${leftPct}%"></div>
          <div class="bubble" style="left:${leftPct}%; background:${p.color}" data-tip="${escapeHtml(p.name)} · ${escapeHtml(p.city)} · ${clock}">${avatarInner(p)}</div>
        </div>
        <div class="hourscale">${hourScaleLabels()}</div>
      </div>
    </div>`;
  });
  html += `</div>`;
  contentEl.innerHTML = html;

  people.forEach(p => {
    const row = contentEl.querySelector(`.person-row[data-id="${p.id}"]`);
    if (!row) return;
    row.querySelector('.editBtn').addEventListener('click', () => {
      if (p.isMe) openOnboarding({ editing: true });
      else openPersonModal(p.id);
    });
    const delBtn = row.querySelector('.delBtn');
    if (delBtn) delBtn.addEventListener('click', () => {
      if (confirm(`Remove ${p.name} from this group?`)) {
        g.people = g.people.filter(x => x.id !== p.id);
        save(); renderAll();
      }
    });
    const bubble = row.querySelector('.bubble');
    bubble.addEventListener('mouseenter', e => showTooltip(e, bubble.dataset.tip));
    bubble.addEventListener('mousemove', positionTooltip);
    bubble.addEventListener('mouseleave', hideTooltip);
  });
}

function renderNowReadout() {
  nowReadoutEl.textContent = new Date().toLocaleString('en-US', {
    weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true
  }) + ' (your time)';
}

function renderAll() {
  renderTabs();
  renderPanelTitle();
  renderPanelToolbar();
  renderContent();
  renderNowReadout();
}

/* ---------------------------------------------------------------------------
 * ADD GROUP
 * -------------------------------------------------------------------------*/

el('addGroupBtn').addEventListener('click', () => {
  const name = prompt('Name this group (e.g. "Design Team", "Client calls with Acme")');
  if (name === null) return;
  const g = { id: uid(), name: name.trim() || 'New group', people: [], sortByTime: false };
  state.groups.push(g);
  state.activeGroup = g.id;
  save(); renderAll();
  openPersonModal();
});

panelTitleEl.addEventListener('change', () => {
  const g = activeGroup();
  g.name = panelTitleEl.value.trim() || 'Untitled group';
  save(); renderTabs();
});
panelTitleEl.addEventListener('keydown', e => { if (e.key === 'Enter') panelTitleEl.blur(); });

/* ---------------------------------------------------------------------------
 * PERSON MODAL (add / edit)
 * Search covers city, country, state/province, and aliases (core.searchPlaces).
 * If nothing matches, a manual UTC-offset picker is offered as a fallback so
 * no one is ever stuck unable to add a teammate.
 * -------------------------------------------------------------------------*/

let modalOverlay = null;

function openPersonModal(personId) {
  const editingId = personId || null;
  const g = activeGroup();
  const existing = editingId ? g.people.find(p => p.id === editingId) : null;

  const draft = existing ? { ...existing } : {
    name: '', nickname: '', city: '', tz: '', lat: 0, lon: 0,
    avatarMode: 'emoji', emoji: EMOJI_OPTIONS[Math.floor(Math.random() * EMOJI_OPTIONS.length)],
    photoUrl: '', color: COLOR_OPTIONS[g.people.length % COLOR_OPTIONS.length]
  };

  modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>${existing ? 'Edit person' : 'Add a person'}</h2>
      <p class="sub">${existing ? 'Update their details.' : 'Add a teammate to see their local time.'}</p>

      <div class="avatar-preview" id="avatarPreview" style="background:${draft.color}"></div>

      <div class="field">
        <label for="fName">Name</label>
        <input type="text" id="fName" placeholder="e.g. Amy Chen" value="${escapeHtml(draft.name)}">
      </div>

      <div class="field" style="position:relative;">
        <label for="fCity">City, state, or country</label>
        <input type="text" id="fCity" placeholder="Try a city, a state like California, or a country" value="${escapeHtml(draft.city)}" autocomplete="off">
        <div class="city-suggestions" id="citySuggestions"></div>
        <div class="hint" id="cityHint">${draft.tz ? draft.tz : 'Search finds cities by name, state/province, or country.'}</div>
        <button type="button" class="link-btn" id="manualOffsetToggle">Can't find their city? Set time zone manually</button>
        <div id="manualOffsetBody" style="display:none; margin-top:8px;"></div>
      </div>

      <div class="field">
        <label>Bubble shows</label>
        <div class="avatar-mode-tabs" id="avatarModeTabs">
          <button data-mode="emoji" type="button">Emoji</button>
          <button data-mode="initials" type="button">Initials</button>
          <button data-mode="nickname" type="button">Nickname</button>
          <button data-mode="photo" type="button">Photo</button>
        </div>
        <div id="modeBody"></div>
      </div>

      <div class="field">
        <label>Row color</label>
        <div class="color-grid" id="colorGrid"></div>
      </div>

      <div class="modal-actions">
        ${existing ? `<button class="btn btn-danger" id="deleteBtn" type="button">Remove</button>` : `<button class="btn btn-secondary" id="cancelBtn" type="button">Cancel</button>`}
        <button class="btn btn-primary" id="saveBtn" type="button">${existing ? 'Save' : 'Add person'}</button>
      </div>
      ${existing ? `<div style="margin-top:10px;"><button class="btn btn-secondary" id="cancelBtn2" type="button" style="width:100%;">Cancel</button></div>` : ''}
    </div>
  `;
  document.body.appendChild(modalOverlay);

  const fName = modalOverlay.querySelector('#fName');
  const fCity = modalOverlay.querySelector('#fCity');
  const citySuggestions = modalOverlay.querySelector('#citySuggestions');
  const cityHint = modalOverlay.querySelector('#cityHint');
  const avatarModeTabs = modalOverlay.querySelector('#avatarModeTabs');
  const modeBody = modalOverlay.querySelector('#modeBody');
  const colorGrid = modalOverlay.querySelector('#colorGrid');
  const avatarPreview = modalOverlay.querySelector('#avatarPreview');
  const manualToggle = modalOverlay.querySelector('#manualOffsetToggle');
  const manualBody = modalOverlay.querySelector('#manualOffsetBody');

  // selectedPlace: either a real PLACES entry, or a synthetic {name, tz:null, offsetMinutes, lat, lon}
  // built from the manual-offset picker. Both shapes are normalized before saving.
  let selectedPlace = draft.tz ? { name: draft.city, tz: draft.tz, lat: draft.lat, lon: draft.lon } : null;
  let manualOffsetMinutes = null;

  function updatePreview() {
    avatarPreview.style.background = draft.color;
    if (draft.avatarMode === 'photo' && draft.photoUrl) avatarPreview.innerHTML = `<img src="${escapeHtml(draft.photoUrl)}" alt="">`;
    else if (draft.avatarMode === 'nickname' && draft.nickname) avatarPreview.textContent = draft.nickname.slice(0, 3);
    else if (draft.avatarMode === 'emoji') avatarPreview.textContent = draft.emoji;
    else {
      const initials = (draft.name || '').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
      avatarPreview.textContent = initials || '?';
    }
  }

  function renderModeBody() {
    avatarModeTabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === draft.avatarMode));
    if (draft.avatarMode === 'emoji') {
      modeBody.innerHTML = `<div class="emoji-grid">${EMOJI_OPTIONS.map(e => `<button type="button" data-e="${e}" class="${e === draft.emoji ? 'sel' : ''}">${e}</button>`).join('')}</div>`;
      modeBody.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { draft.emoji = b.dataset.e; renderModeBody(); updatePreview(); }));
    } else if (draft.avatarMode === 'nickname') {
      modeBody.innerHTML = `<div class="field" style="margin-bottom:0;"><input type="text" id="fNick" maxlength="6" placeholder="e.g. Ray, A.C." value="${escapeHtml(draft.nickname)}"></div>`;
      modeBody.querySelector('#fNick').addEventListener('input', e => { draft.nickname = e.target.value; updatePreview(); });
    } else if (draft.avatarMode === 'photo') {
      modeBody.innerHTML = `<div class="field" style="margin-bottom:0;"><input type="text" id="fPhoto" placeholder="Paste an image URL" value="${escapeHtml(draft.photoUrl)}"><div class="hint">Any public image link. Nothing is uploaded — just linked.</div></div>`;
      modeBody.querySelector('#fPhoto').addEventListener('input', e => { draft.photoUrl = e.target.value; updatePreview(); });
    } else {
      modeBody.innerHTML = `<div class="hint">Uses the first letters of their name.</div>`;
    }
  }

  avatarModeTabs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { draft.avatarMode = b.dataset.mode; renderModeBody(); updatePreview(); }));

  colorGrid.innerHTML = COLOR_OPTIONS.map(c => `<div class="color-swatch ${c === draft.color ? 'sel' : ''}" data-c="${c}" style="background:${c}"></div>`).join('');
  colorGrid.querySelectorAll('.color-swatch').forEach(sw => sw.addEventListener('click', () => {
    draft.color = sw.dataset.c;
    colorGrid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('sel'));
    sw.classList.add('sel');
    updatePreview();
  }));

  fName.addEventListener('input', () => { draft.name = fName.value; updatePreview(); });

  function renderCitySuggestions(matches) {
    if (!matches.length) {
      citySuggestions.innerHTML = `<div class="no-match">No matching city. Try a state, country — or set the time zone manually below.</div>`;
      citySuggestions.classList.add('show');
      return;
    }
    citySuggestions.innerHTML = matches.map(c => {
      const sub = [c.admin, c.country].filter(Boolean).join(', ');
      return `<div data-name="${escapeHtml(c.name)}"><span>${escapeHtml(c.name)}</span><span class="csub">${escapeHtml(sub)}</span></div>`;
    }).join('');
    citySuggestions.classList.add('show');
    citySuggestions.querySelectorAll('div[data-name]').forEach(d => {
      d.addEventListener('click', () => {
        const c = PLACES.find(x => x.name === d.dataset.name);
        selectedPlace = c;
        manualOffsetMinutes = null;
        fCity.value = c.name;
        cityHint.textContent = c.tz;
        cityHint.style.color = '';
        citySuggestions.classList.remove('show');
        manualBody.style.display = 'none';
      });
    });
  }

  function invalidateSelectionAndSearch() {
    const q = fCity.value.trim();
    selectedPlace = null;
    manualOffsetMinutes = null; // typing again means neither prior choice is still valid
    if (el('fOffset')) el('fOffset').value = '';
    cityHint.textContent = 'Search finds cities by name, state/province, or country.';
    cityHint.style.color = '';
    if (!q) { citySuggestions.classList.remove('show'); return; }
    renderCitySuggestions(searchPlaces(PLACES, q, 8));
  }
  fCity.addEventListener('input', invalidateSelectionAndSearch);
  // Refocusing (e.g. clicking back in) should just re-show matches for what's
  // already typed, without discarding a selection the person already made.
  fCity.addEventListener('focus', () => {
    if (!fCity.value.trim()) return;
    if (selectedPlace || manualOffsetMinutes !== null) return;
    renderCitySuggestions(searchPlaces(PLACES, fCity.value.trim(), 8));
  });

  // Manual UTC-offset fallback (requirement: let people add someone even when
  // search can't find their city — e.g. a small town not in our dataset).
  manualToggle.addEventListener('click', () => {
    const showing = manualBody.style.display !== 'none';
    manualBody.style.display = showing ? 'none' : 'block';
    if (!showing) {
      manualBody.innerHTML = `
        <div class="field" style="margin-bottom:0;">
          <label for="fOffset">Their current time zone offset</label>
          <select id="fOffset">
            <option value="">Choose an offset…</option>
            ${UTC_OFFSETS.map(o => `<option value="${o.minutes}">${o.label}</option>`).join('')}
          </select>
          <div class="hint">Approximate — won't auto-adjust for daylight saving. Prefer searching a nearby big city if you can.</div>
        </div>`;
      el('fOffset').addEventListener('change', e => {
        const minutes = parseInt(e.target.value, 10);
        if (isNaN(minutes)) { manualOffsetMinutes = null; return; }
        manualOffsetMinutes = minutes;
        selectedPlace = null;
        const label = UTC_OFFSETS.find(o => o.minutes === minutes).label;
        fCity.value = fCity.value.trim() || label;
        cityHint.textContent = `Manual: ${label} (fixed, not DST-aware)`;
        cityHint.style.color = '';
        citySuggestions.classList.remove('show');
      });
    }
  });

  function outsideClose(e) {
    if (!citySuggestions.contains(e.target) && e.target !== fCity) citySuggestions.classList.remove('show');
  }
  document.addEventListener('click', outsideClose);

  renderModeBody();
  updatePreview();

  const closeModal = () => {
    document.removeEventListener('click', outsideClose);
    modalOverlay.remove();
    modalOverlay = null;
  };
  modalOverlay.querySelectorAll('#cancelBtn, #cancelBtn2').forEach(b => b && b.addEventListener('click', closeModal));
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

  const delBtn = modalOverlay.querySelector('#deleteBtn');
  if (delBtn) delBtn.addEventListener('click', () => {
    if (confirm(`Remove ${draft.name}?`)) {
      const gr = activeGroup();
      gr.people = gr.people.filter(p => p.id !== editingId);
      save(); closeModal(); renderAll();
    }
  });

  modalOverlay.querySelector('#saveBtn').addEventListener('click', () => {
    if (!draft.name.trim()) { fName.focus(); fName.style.borderColor = '#E37373'; return; }

    // Valid location = a freshly picked place, a freshly picked manual offset,
    // OR (when editing) the person's unchanged existing city.
    const unchangedExistingCity = existing && fCity.value === draft.city && draft.tz;
    if (!selectedPlace && manualOffsetMinutes === null && !unchangedExistingCity) {
      cityHint.textContent = 'Pick a suggested city, or set a time zone manually.';
      cityHint.style.color = '#E37373';
      fCity.focus();
      return;
    }

    let locationData;
    if (selectedPlace) {
      locationData = { city: selectedPlace.name, tz: selectedPlace.tz, lat: selectedPlace.lat, lon: selectedPlace.lon };
    } else if (manualOffsetMinutes !== null) {
      // Synthetic fixed-offset "timezone" (see core.js makeFixedTz) — supports
      // any offset including the fractional ones real IANA zones use (+5:30,
      // +5:45), unlike Intl's whole-hour-only Etc/GMT zones.
      const tzName = makeFixedTz(manualOffsetMinutes);
      const label = UTC_OFFSETS.find(o => o.minutes === manualOffsetMinutes).label;
      locationData = { city: fCity.value.trim() || label, tz: tzName, lat: 0, lon: 0 };
    } else {
      locationData = { city: draft.city, tz: draft.tz, lat: draft.lat, lon: draft.lon };
    }

    const gr = activeGroup();
    const record = {
      name: draft.name.trim(), nickname: draft.nickname,
      city: locationData.city, tz: locationData.tz, lat: locationData.lat, lon: locationData.lon,
      avatarMode: draft.avatarMode, emoji: draft.emoji, photoUrl: draft.photoUrl, color: draft.color
    };
    if (existing) Object.assign(existing, record);
    else gr.people.push({ id: uid(), ...record });

    save();
    closeModal();
    renderAll();
  });

  setTimeout(() => fName.focus(), 30);
}

/* ---------------------------------------------------------------------------
 * SUGGEST MEETING TIMES
 * Shows the top slots from suggestMeetingTimes(), each labeled with who it's
 * hardest on — so the scoring isn't a black box, and the "why" is visible.
 * -------------------------------------------------------------------------*/

function openSuggestModal() {
  const g = activeGroup();
  const people = displayPeopleFor(g, new Date()); // includes "me" if set, so suggestions account for your own schedule too
  const suggestions = suggestMeetingTimes(people, new Date(), 3);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>Good times to meet</h2>
      <p class="sub">Ranked to avoid badly inconveniencing any one person — not just the lowest total. Times are rounded to the nearest half hour.</p>
      <div id="suggestList"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="closeSuggest" type="button">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#closeSuggest').addEventListener('click', () => overlay.remove());

  const listEl = overlay.querySelector('#suggestList');
  if (!suggestions.length) {
    listEl.innerHTML = `<p class="hint">Add at least two people to get suggestions.</p>`;
    return;
  }

  listEl.innerHTML = suggestions.map((s, i) => {
    const rows = s.perPerson.map(pp => {
      const person = people.find(p => p.id === pp.personId);
      const clockStr = formatClock(person.tz, s.instant);
      const tag = pp.cost === 0 ? 'good' : pp.cost < 1 ? 'day' : 'night';
      const tagText = pp.cost === 0 ? 'Working hrs' : pp.cost < 1 ? 'Outside hours' : 'Asleep';
      return `<div class="suggest-person">
        <span class="row-avatar" style="width:22px;height:22px;font-size:11px;background:${person.color}">${avatarInner(person)}</span>
        <span class="suggest-name">${escapeHtml(person.name)}${person.isMe ? ' (you)' : ''}</span>
        <span class="suggest-clock">${clockStr}</span>
        <span class="row-daylabel ${tag}" style="font-size:9.5px;">${tagText}</span>
      </div>`;
    }).join('');
    const whenLabel = s.instant.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) + ' (your time)';
    return `
      <div class="suggest-slot">
        <div class="suggest-slot-head">
          <span class="suggest-rank">#${i + 1}</span>
          <span class="suggest-when">${whenLabel}</span>
        </div>
        <div class="suggest-why">Hardest on <strong>${escapeHtml(s.worstPerson)}</strong></div>
        <div class="suggest-people">${rows}</div>
      </div>`;
  }).join('');
}

/* ---------------------------------------------------------------------------
 * SETTINGS DROPDOWN (export / import / theme / edit-me)
 * -------------------------------------------------------------------------*/

const settingsMenuEl = el('settingsMenu');
const settingsBtnEl = el('settingsBtn');
const settingsDropdownEl = el('settingsDropdown');

function closeSettingsDropdown() {
  settingsDropdownEl.classList.remove('show');
  settingsBtnEl.setAttribute('aria-expanded', 'false');
}
settingsBtnEl.addEventListener('click', (e) => {
  e.stopPropagation();
  const showing = settingsDropdownEl.classList.toggle('show');
  settingsBtnEl.setAttribute('aria-expanded', showing ? 'true' : 'false');
});
document.addEventListener('click', (e) => {
  if (!settingsMenuEl.contains(e.target)) closeSettingsDropdown();
});

el('themeToggleBtn').addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(currentTheme);
  closeSettingsDropdown();
});

el('editMeBtn').addEventListener('click', () => {
  closeSettingsDropdown();
  openOnboarding({ editing: true });
});

el('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'timetogether-data.json';
  a.click();
  URL.revokeObjectURL(url);
  closeSettingsDropdown();
});
el('importBtn').addEventListener('click', () => { el('importFile').click(); closeSettingsDropdown(); });
el('importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.groups) throw new Error('bad format');
      if (!('me' in parsed)) parsed.me = null;
      parsed.groups.forEach(g => { if (!('sortByTime' in g)) g.sortByTime = false; });
      state = parsed;
      if (!state.activeGroup && state.groups.length) state.activeGroup = state.groups[0].id;
      save(); renderAll();
    } catch (err) {
      alert('Could not read that file — make sure it is a TimeTogether export.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ---------------------------------------------------------------------------
 * ONBOARDING ("who are you") — a lightweight one-time step so the person
 * using the app is a permanent, pinned row across every group, rather than
 * having to re-add themselves each time. Reuses the same field patterns as
 * the person modal, kept intentionally shorter (no avatar-mode picker) since
 * this always runs before the person has seen the rest of the UI.
 * -------------------------------------------------------------------------*/

function openOnboarding(opts = {}) {
  const editing = !!opts.editing;
  const draft = editing && state.me ? { ...state.me } : {
    name: '', city: '', tz: '', lat: 0, lon: 0, color: COLOR_OPTIONS[0]
  };
  let selectedPlace = draft.tz ? { name: draft.city, tz: draft.tz, lat: draft.lat, lon: draft.lon } : null;

  const root = el('onboardingRoot');
  const overlay = document.createElement('div');
  overlay.className = 'onboarding-overlay';
  overlay.innerHTML = `
    <div class="onboarding-card">
      <div class="glyph">👋</div>
      <h1>${editing ? 'Your info' : "What's your name and city?"}</h1>
      <p class="sub">${editing ? "Update how you appear — you're pinned to the top of every group." : "You'll show up pinned at the top of every group, so your team can always see your time at a glance."}</p>

      <div class="field">
        <label for="obName">Your name</label>
        <input type="text" id="obName" placeholder="e.g. Priya Shah" value="${escapeHtml(draft.name)}">
      </div>
      <div class="field" style="position:relative;">
        <label for="obCity">Your city</label>
        <input type="text" id="obCity" placeholder="Try a city, a state, or a country" value="${escapeHtml(draft.city)}" autocomplete="off">
        <div class="city-suggestions" id="obCitySuggestions"></div>
        <div class="hint" id="obCityHint">${draft.tz ? draft.tz : 'Search finds cities by name, state/province, or country.'}</div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-primary" id="obSaveBtn" type="button">${editing ? 'Save' : "That's me"}</button>
      </div>
      ${!editing ? `<button class="onboarding-skip" id="obSkipBtn" type="button">Skip for now</button>` : ''}
    </div>
  `;
  root.appendChild(overlay);

  const obName = overlay.querySelector('#obName');
  const obCity = overlay.querySelector('#obCity');
  const obCitySuggestions = overlay.querySelector('#obCitySuggestions');
  const obCityHint = overlay.querySelector('#obCityHint');

  function renderSuggestions(matches) {
    if (!matches.length) {
      obCitySuggestions.innerHTML = `<div class="no-match">No matching city. Try a state or country.</div>`;
      obCitySuggestions.classList.add('show');
      return;
    }
    obCitySuggestions.innerHTML = matches.map(c => {
      const sub = [c.admin, c.country].filter(Boolean).join(', ');
      return `<div data-name="${escapeHtml(c.name)}"><span>${escapeHtml(c.name)}</span><span class="csub">${escapeHtml(sub)}</span></div>`;
    }).join('');
    obCitySuggestions.classList.add('show');
    obCitySuggestions.querySelectorAll('div[data-name]').forEach(d => {
      d.addEventListener('click', () => {
        const c = PLACES.find(x => x.name === d.dataset.name);
        selectedPlace = c;
        obCity.value = c.name;
        obCityHint.textContent = c.tz;
        obCityHint.style.color = '';
        obCitySuggestions.classList.remove('show');
      });
    });
  }
  obCity.addEventListener('input', () => {
    selectedPlace = null;
    obCityHint.textContent = 'Search finds cities by name, state/province, or country.';
    obCityHint.style.color = '';
    const q = obCity.value.trim();
    if (!q) { obCitySuggestions.classList.remove('show'); return; }
    renderSuggestions(searchPlaces(PLACES, q, 8));
  });
  function outsideClose(e) {
    if (overlay.parentNode && !obCitySuggestions.contains(e.target) && e.target !== obCity) {
      obCitySuggestions.classList.remove('show');
    }
  }
  document.addEventListener('click', outsideClose);

  overlay.querySelector('#obSaveBtn').addEventListener('click', () => {
    if (!obName.value.trim()) { obName.focus(); obName.style.borderColor = 'var(--danger)'; return; }
    const unchanged = editing && obCity.value === draft.city && draft.tz;
    if (!selectedPlace && !unchanged) {
      obCityHint.textContent = 'Pick a suggested city from the list.';
      obCityHint.style.color = 'var(--danger)';
      obCity.focus();
      return;
    }
    const place = selectedPlace || { name: draft.city, tz: draft.tz, lat: draft.lat, lon: draft.lon };
    state.me = {
      id: (state.me && state.me.id) || uid(),
      name: obName.value.trim(),
      nickname: '', avatarMode: 'initials', emoji: '👋', photoUrl: '',
      color: draft.color,
      city: place.name, tz: place.tz, lat: place.lat, lon: place.lon
    };
    save();
    document.removeEventListener('click', outsideClose);
    overlay.remove();
    renderAll();
  });

  const skipBtn = overlay.querySelector('#obSkipBtn');
  if (skipBtn) skipBtn.addEventListener('click', () => {
    document.removeEventListener('click', outsideClose);
    overlay.remove();
  });

  setTimeout(() => obName.focus(), 30);
}

// First-run: if no one has set up "me" yet, offer onboarding once. Skippable,
// and re-openable anytime from Settings → Edit my info.
if (!state.me) openOnboarding({ editing: false });

/* ---------------------------------------------------------------------------
 * INIT
 * -------------------------------------------------------------------------*/

renderAll();
setInterval(() => { renderContent(); renderNowReadout(); }, 30000);
