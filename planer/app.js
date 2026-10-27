/* =========================================================
   Tischplaner – App-Logik
   Vanilla JavaScript, kein Build-Schritt, keine Abhängigkeiten.
   ========================================================= */
(function () {
  'use strict';

  /* ---------- Konstanten ---------- */

  const STORAGE_KEY = 'wedding-tischplaner-admin-v1';

  const ADMIN_MODE = true;
  const STATUS_LABELS = {
    attending: 'Zugesagt',
    pending: 'Offen',
    declined: 'Abgesagt'
  };

  const BOARD_W = 2400;
  const BOARD_H = 1600;

  const SEAT_W = 76;
  const SEAT_H = 34;
  const SEAT_GAP = 6;
  const CHAIR_GAP = 8;
  const TABLE_H = 84;
  const TABLE_PAD = 14;
  const MIN_TABLE_W = 150;
  const MAX_SEATS_PER_SIDE = 12;
  const MIN_SEATS_PER_SIDE = 1;
  const MIN_ROUND_SEATS = 2;
  const MAX_ROUND_SEATS = 24;
  const ROUND_SEAT_SPACING = 12;

  const SNAP = 10;
  const ZOOM_STEPS = [0.4, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 1.75, 2];

  const PRINT_SANS = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
  const PRINT_SERIF = 'Georgia, "Times New Roman", serif';

  // Farbpaletten: Akzentfarben für die Oberfläche und passende Druckfarben
  // für PNG/PDF. Die CSS-Werte dazu stehen in styles.css.
  const SCHEMES = {
    sage: {
      name: 'Salbei',
      accentLight: '#5f7f68',
      accentDark: '#93b79d',
      print: {
        table: '#f0f5f1',
        tableBorder: '#b9cbbd',
        seatBorder: '#d6dfd8',
        filled: '#e3efe6',
        filledBorder: '#7f9d88',
        child: '#5f7f68'
      }
    },
    ozean: {
      name: 'Ozean',
      accentLight: '#3f6e8a',
      accentDark: '#8cb8d1',
      print: {
        table: '#eff5f8',
        tableBorder: '#b9cfda',
        seatBorder: '#d6e2e8',
        filled: '#e1eef5',
        filledBorder: '#7098ae',
        child: '#3f6e8a'
      }
    },
    rose: {
      name: 'Rosé',
      accentLight: '#a85d70',
      accentDark: '#dda1b0',
      print: {
        table: '#fcf1f3',
        tableBorder: '#e2c0c9',
        seatBorder: '#ead7dc',
        filled: '#f9e4e9',
        filledBorder: '#ca8b9b',
        child: '#a85d70'
      }
    },
    lavendel: {
      name: 'Lavendel',
      accentLight: '#745e93',
      accentDark: '#b9a4d4',
      print: {
        table: '#f6f2fa',
        tableBorder: '#cfc2e0',
        seatBorder: '#e3dbea',
        filled: '#efe8f8',
        filledBorder: '#a28dbf',
        child: '#745e93'
      }
    },
    graphit: {
      name: 'Graphit',
      accentLight: '#525c69',
      accentDark: '#a9b6c6',
      print: {
        table: '#f3f5f7',
        tableBorder: '#c5ccd3',
        seatBorder: '#dde2e7',
        filled: '#e5e9ee',
        filledBorder: '#8894a2',
        child: '#525c69'
      }
    },
    terrakotta: {
      name: 'Terrakotta',
      accentLight: '#a9663f',
      accentDark: '#d99c66',
      print: {
        table: '#f7efe4',
        tableBorder: '#d8c3a7',
        seatBorder: '#dbd3c6',
        filled: '#f5e3ce',
        filledBorder: '#bf8755',
        child: '#b07a45'
      }
    }
  };

  const DEFAULT_SCHEME = 'sage';

  /* ---------- Kleine Helfer ---------- */

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function num(value, fallback) {
    const parsed = typeof value === 'string' ? parseFloat(value) : value;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  function uid(prefix) {
    const random = (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return prefix + '_' + random;
  }

  function normalizeAngle(value) {
    return ((value % 360) + 540) % 360 - 180;
  }

  function formatDateLong(date) {
    try {
      return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit', month: 'long', year: 'numeric'
      }).format(date || new Date());
    } catch (error) {
      return (date || new Date()).toLocaleDateString('de-DE');
    }
  }

  function formatTime(date) {
    try {
      return new Intl.DateTimeFormat('de-DE', {
        hour: '2-digit', minute: '2-digit'
      }).format(date);
    } catch (error) {
      return '';
    }
  }

  function dateStamp() {
    const now = new Date();
    return now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
  }

  function prefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function isRound(table) {
    return table.shape === 'round';
  }

  function roundSeatCount(table) {
    const fromProperty = num(table.seatCount, 0);
    const fromSeats = Array.isArray(table.seats) ? table.seats.length : 0;
    return clamp(
      Math.round(fromProperty || fromSeats || 8),
      MIN_ROUND_SEATS,
      MAX_ROUND_SEATS
    );
  }

  function roundTableRadius(table) {
    const seats = roundSeatCount(table);
    return Math.max(80, (seats * (SEAT_W + ROUND_SEAT_SPACING)) / (2 * Math.PI));
  }

  function tableWidth(table) {
    if (isRound(table)) return roundTableRadius(table) * 2;
    const seats = table.seatsPerSide;
    const content = seats * SEAT_W + (seats - 1) * SEAT_GAP;
    return Math.max(MIN_TABLE_W, TABLE_PAD * 2 + content);
  }

  function tableHeight(table) {
    return isRound(table) ? tableWidth(table) : TABLE_H;
  }

  function tableVisualSize(table) {
    if (isRound(table)) {
      const extent = roundTableRadius(table) + CHAIR_GAP + SEAT_W + 8;
      return { width: extent * 2, height: extent * 2 };
    }
    return {
      width: tableWidth(table) + 24,
      height: TABLE_H + 2 * (SEAT_H + CHAIR_GAP) + 24
    };
  }

  function seatStartX(table) {
    const content = table.seatsPerSide * SEAT_W + (table.seatsPerSide - 1) * SEAT_GAP;
    return (tableWidth(table) - content) / 2;
  }

  function roundSeatOffset(table, index) {
    const seats = roundSeatCount(table);
    const radius = roundTableRadius(table);
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / seats;
    const extent = Math.abs(Math.cos(angle)) * SEAT_W / 2 +
      Math.abs(Math.sin(angle)) * SEAT_H / 2;
    const ringRadius = radius + CHAIR_GAP + extent;

    return {
      x: Math.cos(angle) * ringRadius,
      y: Math.sin(angle) * ringRadius
    };
  }

  function seatTop(index, table) {
    if (isRound(table)) {
      return roundTableRadius(table) + roundSeatOffset(table, index).y - SEAT_H / 2;
    }
    return index < table.seatsPerSide ? -(SEAT_H + CHAIR_GAP) : TABLE_H + CHAIR_GAP;
  }

  function seatLeft(index, table) {
    if (isRound(table)) {
      return roundTableRadius(table) + roundSeatOffset(table, index).x - SEAT_W / 2;
    }
    const lane = index % table.seatsPerSide;
    return seatStartX(table) + lane * (SEAT_W + SEAT_GAP);
  }

  function seatPositionLabel(table, index) {
    if (isRound(table)) return 'Platz ' + (index + 1);
    const side = index < table.seatsPerSide ? 'oben' : 'unten';
    const position = (index % table.seatsPerSide) + 1;
    return side + ' ' + position;
  }

  /* ---------- Zustand ---------- */

  function defaultState() {
    return {
      version: 1,
      guests: [],
      tables: [],
      settings: {
        theme: prefersDark() ? 'dark' : 'light',
        scheme: DEFAULT_SCHEME,
        snap: true,
        zoom: 1
      }
    };
  }

  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;

    const guestIds = new Set();
    const guests = [];
    if (Array.isArray(raw.guests)) {
      for (const item of raw.guests) {
        if (!item || typeof item !== 'object') continue;
        const name = typeof item.name === 'string' ? item.name.trim().slice(0, 80) : '';
        if (!name) continue;
        let id = typeof item.id === 'string' && item.id ? item.id : uid('g');
        if (guestIds.has(id)) id = uid('g');
        guestIds.add(id);
        guests.push({ id: id, name: name, child: !!item.child });
      }
    }

    const tableIds = new Set();
    const usedSeats = new Set();
    const tables = [];
    if (Array.isArray(raw.tables)) {
      for (const item of raw.tables) {
        if (!item || typeof item !== 'object') continue;
        let id = typeof item.id === 'string' && item.id ? item.id : uid('t');
        if (tableIds.has(id)) id = uid('t');
        tableIds.add(id);

        const shape = item.shape === 'round' ? 'round' : 'rect';
        const seatsPerSide = clamp(
          Math.round(num(item.seatsPerSide, 4)),
          MIN_SEATS_PER_SIDE,
          MAX_SEATS_PER_SIDE
        );
        const oldSeats = Array.isArray(item.seats) ? item.seats : [];
        const seatCount = shape === 'round'
          ? clamp(Math.round(num(item.seatCount, oldSeats.length || 8)), MIN_ROUND_SEATS, MAX_ROUND_SEATS)
          : seatsPerSide * 2;
        const seats = [];
        for (let index = 0; index < seatCount; index += 1) {
          const guestId = oldSeats[index];
          if (typeof guestId === 'string' && guestIds.has(guestId) && !usedSeats.has(guestId)) {
            seats.push(guestId);
            usedSeats.add(guestId);
          } else {
            seats.push(null);
          }
        }

        tables.push({
          id: id,
          number: clamp(Math.round(num(item.number, tables.length + 1)), 1, 9999),
          x: clamp(num(item.x, 100), 0, BOARD_W - 60),
          y: clamp(num(item.y, 100), 0, BOARD_H - 60),
          shape: shape,
          seatsPerSide: seatsPerSide,
          seatCount: seatCount,
          rotation: normalizeAngle(num(item.rotation, 0)),
          seats: seats
        });
      }
    }

    const rawSettings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};

    return {
      version: 1,
      guests: guests,
      tables: tables,
      settings: {
        theme: rawSettings.theme === 'dark' ? 'dark'
          : rawSettings.theme === 'light' ? 'light'
            : base.settings.theme,
        scheme: SCHEMES[rawSettings.scheme] ? rawSettings.scheme : DEFAULT_SCHEME,
        snap: rawSettings.snap !== false,
        zoom: clamp(num(rawSettings.zoom, 1), 0.4, 2)
      }
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      console.warn('Gespeicherter Zustand konnte nicht geladen werden:', error);
      return defaultState();
    }
  }

  let state = loadState();
  const hadSavedState = (function () {
    try { return !!localStorage.getItem(STORAGE_KEY); } catch (error) { return false; }
  })();

  let selectedTableId = null;
  let editingGuestId = null;
  let popover = null;
  let pendingGuestImport = null;
  let history = [];
  let future = [];
  let saveTimer = null;
  let toastTimer = null;

  let apiMode = 'auto';
  let serverReady = false;
  let serverRevision = 0;
  let saveInFlight = false;
  let saveQueued = false;
  let serverConflict = false;
  let bootErrorShown = false;
  let guestStatusFilter = 'all';
  let guestAssignmentFilter = 'all';

  /* ---------- DOM ---------- */

  const els = {
    saveStatus: $('#saveStatus'),
    undoBtn: $('#undoBtn'),
    redoBtn: $('#redoBtn'),
    themeBtn: $('#themeBtn'),
    schemeBtn: $('#schemeBtn'),
    schemeMenu: $('#schemeMenu'),
    schemeOptions: $('#schemeOptions'),
    exportBtn: $('#exportBtn'),
    exportMenu: $('#exportMenu'),
    importFile: $('#importFile'),
    importGuestsFile: $('#importGuestsFile'),
    guestImportDialog: $('#guestImportDialog'),
    guestImportText: $('#guestImportText'),
    guestImportAdd: $('#guestImportAdd'),
    guestImportReplace: $('#guestImportReplace'),
    guestImportCancel: $('#guestImportCancel'),

    guestsPanel: $('#guestsPanel'),
    guestForm: $('#guestForm'),
    guestNameInput: $('#guestNameInput'),
    guestChildInput: $('#guestChildInput'),
    guestSearch: $('#guestSearch'),
    guestList: $('#guestList'),
    guestCount: $('#guestCount'),
    openCount: $('#openCount'),
    guestStatusFilter: $('#guestStatusFilter'),
    guestAssignmentFilter: $('#guestAssignmentFilter'),
    refreshGuestsBtn: $('#refreshGuestsBtn'),
    bootScreen: $('#bootScreen'),
    bootMessage: $('#bootMessage'),
    bootRetry: $('#bootRetry'),

    tableList: $('#tableList'),
    tableCount: $('#tableCount'),
    addTableBtn: $('#addTableBtn'),
    addRoundTableBtn: $('#addRoundTableBtn'),

    canvasArea: $('#canvasArea'),
    viewport: $('#viewport'),
    boardScale: $('#boardScale'),
    board: $('#board'),
    tablesLayer: $('#tablesLayer'),
    emptyState: $('#emptyState'),
    emptyAddTable: $('#emptyAddTable'),
    emptyAddRoundTable: $('#emptyAddRoundTable'),

    zoomOut: $('#zoomOut'),
    zoomIn: $('#zoomIn'),
    zoomLabel: $('#zoomLabel'),
    snapToggle: $('#snapToggle'),

    inspector: $('#inspector'),
    closeInspector: $('#closeInspector'),
    tableNumberInput: $('#tableNumberInput'),
    seatsLabel: $('#seatsLabel'),
    seatsMinus: $('#seatsMinus'),
    seatsPlus: $('#seatsPlus'),
    seatsValue: $('#seatsValue'),
    rotationValue: $('#rotationValue'),
    tableSeatInfo: $('#tableSeatInfo'),
    duplicateTable: $('#duplicateTable'),
    deleteTable: $('#deleteTable'),

    seatPopover: $('#seatPopover'),
    toast: $('#toast')
  };

  /* ---------- Abfragen ---------- */

  function getGuest(id) {
    return state.guests.find((guest) => guest.id === id) || null;
  }

  function getTable(id) {
    return state.tables.find((table) => table.id === id) || null;
  }

  function findSeatOfGuest(guestId) {
    for (const table of state.tables) {
      const index = table.seats.indexOf(guestId);
      if (index !== -1) return { table: table, index: index };
    }
    return null;
  }

  function assignmentMap() {
    const map = new Map();
    for (const table of state.tables) {
      table.seats.forEach((guestId, index) => {
        if (guestId && !map.has(guestId)) {
          map.set(guestId, { table: table, index: index });
        }
      });
    }
    return map;
  }

  function nextTableNumber() {
    return state.tables.reduce((max, table) => Math.max(max, table.number), 0) + 1;
  }

  function occupiedSeats(table) {
    return table.seats.filter(Boolean).length;
  }

  function padSeats(seats, count) {
    const next = seats.slice(0, count);
    while (next.length < count) next.push(null);
    return next;
  }

  function findFreePosition(startX, startY, draft) {
    const width = tableWidth(draft);
    const height = tableHeight(draft);
    const maxX = Math.max(20, BOARD_W - width - 20);
    const maxY = Math.max(20, BOARD_H - height - 40);
    const draftVisual = tableVisualSize(draft);
    let x = clamp(startX, 20, maxX);
    let y = clamp(startY, 20, maxY);

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      const collides = state.tables.some((table) => {
        const visual = tableVisualSize(table);
        const otherCenterX = table.x + tableWidth(table) / 2;
        const otherCenterY = table.y + tableHeight(table) / 2;
        return Math.abs(centerX - otherCenterX) < (draftVisual.width + visual.width) / 2 + 12 &&
          Math.abs(centerY - otherCenterY) < (draftVisual.height + visual.height) / 2 + 12;
      });
      if (!collides) break;

      x += 42;
      y += 42;
      if (x > maxX || y > maxY) {
        x = 20 + ((attempt * 53) % Math.max(20, maxX - 20));
        y = 20 + ((attempt * 79) % Math.max(20, maxY - 20));
      }
    }

    return { x: clamp(x, 20, maxX), y: clamp(y, 20, maxY) };
  }

  /* ---------- Status / API ---------- */

  function normalizeGuestStatus(status) {
    return status === 'attending' || status === 'declined' ? status : 'pending';
  }

  function guestStatusLabel(status) {
    return STATUS_LABELS[normalizeGuestStatus(status)] || STATUS_LABELS.pending;
  }

  async function apiFetch(endpoint, options) {
    const clean = String(endpoint).replace(/^\/+/, '');
    const opts = Object.assign({ credentials: 'same-origin' }, options || {});
    let url = apiMode === 'php'
      ? '../api.php?route=' + encodeURIComponent(clean)
      : '/api/' + clean;
    const usingPhp = url.includes('api.php');

    try {
      let response = await fetch(url, opts);
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      const isJson = contentType.includes('application/json');
      if (!usingPhp && (response.status === 404 || !isJson)) {
        apiMode = 'php';
        response = await fetch('../api.php?route=' + encodeURIComponent(clean), opts);
      } else if (response.ok && apiMode === 'auto') {
        apiMode = 'api';
      }
      return response;
    } catch (error) {
      if (apiMode === 'auto' || apiMode === 'api') {
        apiMode = 'php';
        return fetch('../api.php?route=' + encodeURIComponent(clean), opts);
      }
      throw error;
    }
  }

  function redirectToAdmin() {
    window.location.replace('../admin.html?return=' + encodeURIComponent('planer/index.html'));
  }

  function showBootError(message) {
    serverReady = false;
    bootErrorShown = true;
    els.bootScreen.hidden = false;
    els.bootMessage.textContent = message;
    els.bootRetry.hidden = false;
    setStatus('Laden fehlgeschlagen', 'error');
  }

  function peopleToGuests(people) {
    return people.map((person) => ({
      id: person.key,
      name: person.name,
      child: !!person.child,
      status: normalizeGuestStatus(person.status),
      group: person.group || '',
      rsvpCode: person.rsvpCode || '',
      partyName: person.partyName || '',
      dishId: person.dishId || '',
      dishName: person.dishName || '',
      dietaryNotes: person.dietaryNotes || ''
    }));
  }

  async function loadServerData() {
    setStatus('Lade vom Server …', 'saving');
    const response = await apiFetch('admin/seating');
    if (response.status === 401) {
      redirectToAdmin();
      return;
    }
    if (!response.ok) {
      throw new Error('Der Tischplan konnte nicht vom Server geladen werden.');
    }

    const data = await response.json();
    const people = Array.isArray(data.people) ? data.people : [];
    const plan = data.plan && typeof data.plan === 'object' ? data.plan : {};
    const combined = {
      guests: people.map((person) => ({
        id: person.key,
        name: person.name,
        child: !!person.child
      })),
      tables: Array.isArray(plan.tables) ? plan.tables : [],
      settings: plan.settings && typeof plan.settings === 'object' ? plan.settings : {}
    };
    const normalized = normalizeState(combined);
    const peopleMap = new Map(people.map((person) => [person.key, person]));

    normalized.guests = normalized.guests.map((guest) => {
      const person = peopleMap.get(guest.id) || {};
      return Object.assign({}, guest, {
        status: normalizeGuestStatus(person.status),
        group: person.group || '',
        rsvpCode: person.rsvpCode || '',
        partyName: person.partyName || '',
        dishId: person.dishId || '',
        dishName: person.dishName || '',
        dietaryNotes: person.dietaryNotes || ''
      });
    });

    state = normalized;
    serverRevision = Number(data.revision) || 0;
    serverReady = true;
    serverConflict = false;
    applyTheme();
    applyScheme();
    applyZoom();
    syncSettingsUi();
    els.guestForm.hidden = true;
    els.guestStatusFilter.hidden = false;
    renderAll();
    els.bootScreen.hidden = true;
    setStatus('Auf Server gespeichert');
    if (state.tables.length) requestAnimationFrame(scrollToPlanCenter);
  }

  async function refreshServerPeople() {
    if (!serverReady) return;
    try {
      const response = await apiFetch('admin/seating');
      if (response.status === 401) {
        redirectToAdmin();
        return;
      }
      if (!response.ok) throw new Error('Gästeliste konnte nicht geladen werden.');
      const data = await response.json();
      if (Number(data.revision) !== serverRevision) {
        showToast('Der Tischplan wurde zwischenzeitlich geändert. Bitte die Seite neu laden.', true);
        return;
      }
      const people = Array.isArray(data.people) ? data.people : [];
      const guests = peopleToGuests(people);
      const validKeys = new Set(guests.map((guest) => guest.id));

      state.guests = guests;
      for (const table of state.tables) {
        table.seats = table.seats.map((key) => (validKeys.has(key) ? key : null));
      }
      renderAll();
      showToast('Gästeliste wurde vom Server aktualisiert.');
    } catch (error) {
      showToast(error.message || 'Gästeliste konnte nicht aktualisiert werden.', true);
    }
  }

  /* ---------- Design / Zoom ---------- */

  function applyTheme() {
    const theme = state.settings.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    els.themeBtn.title = theme === 'dark' ? 'Helles Design' : 'Dunkles Design';
    els.themeBtn.setAttribute('aria-label', els.themeBtn.title);
  }

  function buildSchemeMenu() {
    els.schemeOptions.innerHTML = Object.keys(SCHEMES).map((key) => {
      const scheme = SCHEMES[key];
      return '<button type="button" class="scheme-option" role="menuitemradio" data-scheme="' + key +
        '" aria-checked="false">' +
          '<span class="scheme-swatch" aria-hidden="true">' +
            '<i style="background:' + scheme.accentLight + '"></i>' +
            '<i style="background:' + scheme.accentDark + '"></i>' +
          '</span>' +
          '<span class="scheme-name">' + escapeHtml(scheme.name) + '</span>' +
          '<span class="scheme-check" aria-hidden="true">✓</span>' +
        '</button>';
    }).join('');
    updateSchemeSelection();
  }

  function updateSchemeSelection() {
    $$('[data-scheme]', els.schemeOptions).forEach((button) => {
      const selected = button.dataset.scheme === state.settings.scheme;
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
  }

  function applyScheme() {
    const key = SCHEMES[state.settings.scheme] ? state.settings.scheme : DEFAULT_SCHEME;
    state.settings.scheme = key;
    document.documentElement.dataset.scheme = key;
    updateSchemeSelection();
    els.schemeBtn.title = 'Farbschema: ' + SCHEMES[key].name;
    els.schemeBtn.setAttribute('aria-label', els.schemeBtn.title);
  }

  function applyZoom() {
    const zoom = state.settings.zoom;
    els.board.style.transform = 'scale(' + zoom + ')';
    els.boardScale.style.width = (BOARD_W * zoom) + 'px';
    els.boardScale.style.height = (BOARD_H * zoom) + 'px';
    els.zoomLabel.textContent = Math.round(zoom * 100) + ' %';
  }

  function syncSettingsUi() {
    els.snapToggle.checked = state.settings.snap;
  }

  function setZoom(nextZoom, keepCenter) {
    const oldZoom = state.settings.zoom;
    const next = clamp(nextZoom, 0.4, 2);
    if (Math.abs(next - oldZoom) < 0.001) return;

    let centerX = null;
    let centerY = null;
    if (keepCenter) {
      centerX = (els.viewport.scrollLeft + els.viewport.clientWidth / 2) / oldZoom;
      centerY = (els.viewport.scrollTop + els.viewport.clientHeight / 2) / oldZoom;
    }

    state.settings.zoom = next;
    applyZoom();
    closePopover();

    if (keepCenter && centerX !== null) {
      els.viewport.scrollLeft = Math.max(0, centerX * next - els.viewport.clientWidth / 2);
      els.viewport.scrollTop = Math.max(0, centerY * next - els.viewport.clientHeight / 2);
    }

    scheduleSave();
  }

  function stepZoom(direction) {
    const current = state.settings.zoom;
    let target = current;
    if (direction > 0) {
      target = ZOOM_STEPS.find((step) => step > current + 0.001) || ZOOM_STEPS[ZOOM_STEPS.length - 1];
    } else {
      const lower = ZOOM_STEPS.filter((step) => step < current - 0.001);
      target = lower.length ? lower[lower.length - 1] : ZOOM_STEPS[0];
    }
    setZoom(target, true);
  }

  /* ---------- Speichern ---------- */

  function setStatus(text, kind) {
    els.saveStatus.textContent = text;
    els.saveStatus.dataset.kind = kind || '';
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('Lokaler Cache konnte nicht gespeichert werden:', error);
    }

    if (!serverReady) {
      setStatus('Nur lokal gesichert', 'saving');
      return;
    }

    queueServerSave();
  }

  async function queueServerSave() {
    if (serverConflict) return;
    if (saveInFlight) {
      saveQueued = true;
      return;
    }

    saveInFlight = true;
    setStatus('Speichert …', 'saving');

    try {
      const response = await apiFetch('admin/seating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: serverRevision,
          plan: {
            version: 1,
            tables: state.tables,
            settings: state.settings
          }
        })
      });

      if (response.status === 401) {
        redirectToAdmin();
        return;
      }

      if (response.status === 409) {
        serverConflict = true;
        setStatus('Speicherkonflikt', 'error');
        showToast('Der Plan wurde auf einem anderen Gerät geändert. Bitte die Seite neu laden, bevor du weiterarbeitest.', true);
        return;
      }

      if (!response.ok) {
        let message = 'Server-Speicherung fehlgeschlagen.';
        try {
          const data = await response.json();
          if (data && data.error) message = data.error;
        } catch (error) { /* ignorieren */ }
        throw new Error(message);
      }

      const data = await response.json();
      serverRevision = Number(data.revision) || serverRevision;
      setStatus('Auf Server gespeichert · ' + formatTime(new Date()));
    } catch (error) {
      setStatus('Nur lokal gesichert', 'error');
      if (!bootErrorShown) {
        bootErrorShown = true;
        showToast('Server momentan nicht erreichbar – der Stand ist lokal gesichert.', true);
      }
    } finally {
      saveInFlight = false;
      if (saveQueued && !serverConflict) {
        saveQueued = false;
        queueServerSave();
      }
    }
  }

  function scheduleSave() {
    setStatus('Speichert …', 'saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }

  /* ---------- Verlauf ---------- */

  function planSnapshot() {
    return JSON.stringify(ADMIN_MODE
      ? { tables: state.tables }
      : { guests: state.guests, tables: state.tables });
  }

  function updateUndoButtons() {
    els.undoBtn.disabled = history.length === 0;
    els.redoBtn.disabled = future.length === 0;
  }

  function remember() {
    const snapshot = planSnapshot();
    if (history.length && history[history.length - 1] === snapshot) return;
    history.push(snapshot);
    if (history.length > 80) history.shift();
    future = [];
    updateUndoButtons();
  }

  function applyPlanSnapshot(snapshot) {
    try {
      const parsed = JSON.parse(snapshot);
      state.tables = parsed.tables;
      if (!ADMIN_MODE) {
        state.guests = parsed.guests;
      } else {
        const validKeys = new Set(state.guests.map((guest) => guest.id));
        for (const table of state.tables) {
          table.seats = table.seats.map((key) => (validKeys.has(key) ? key : null));
        }
      }
    } catch (error) {
      return;
    }
    if (selectedTableId && !getTable(selectedTableId)) selectedTableId = null;
    editingGuestId = null;
    closePopover();
    renderAll();
    scheduleSave();
    updateUndoButtons();
  }

  function undo() {
    if (!history.length) return;
    const current = planSnapshot();
    const previous = history.pop();
    future.push(current);
    applyPlanSnapshot(previous);
  }

  function redo() {
    if (!future.length) return;
    const current = planSnapshot();
    const next = future.pop();
    history.push(current);
    applyPlanSnapshot(next);
  }

  /* ---------- Rendern ---------- */

  function renderAll() {
    renderTables();
    renderGuestList();
    renderTableList();
    renderInspector();
    renderPopover();
    updateUndoButtons();
  }

  function renderTables() {
    els.tablesLayer.innerHTML = '';

    for (const table of state.tables) {
      els.tablesLayer.appendChild(buildTableElement(table));
    }

    els.emptyState.hidden = state.tables.length > 0;
    els.tableCount.textContent = String(state.tables.length);
  }

  function buildTableElement(table) {
    const width = tableWidth(table);
    const height = tableHeight(table);
    const element = document.createElement('div');
    element.className = 'table' +
      (isRound(table) ? ' round' : '') +
      (table.id === selectedTableId ? ' selected' : '');
    element.dataset.tableId = table.id;
    element.style.left = table.x + 'px';
    element.style.top = table.y + 'px';
    element.style.width = width + 'px';
    element.style.height = height + 'px';
    element.style.transform = 'rotate(' + table.rotation + 'deg)';

    const body = document.createElement('div');
    body.className = 'table-body';
    body.title = 'Tisch ' + table.number + ' verschieben';
    body.innerHTML = '<div class="table-number"><small>Tisch</small><strong>' +
      escapeHtml(table.number) + '</strong></div>';
    body.addEventListener('pointerdown', onTablePointerDown);
    element.appendChild(body);

    table.seats.forEach((guestId, index) => {
      const guest = guestId ? getGuest(guestId) : null;
      const guestStatus = guest ? normalizeGuestStatus(guest.status) : null;
      const seat = document.createElement('div');
      seat.className = 'seat' + (guest ? ' occupied' : '') + (guestStatus ? ' status-' + guestStatus : '');
      seat.dataset.index = String(index);
      seat.style.left = seatLeft(index, table) + 'px';
      seat.style.top = seatTop(index, table) + 'px';
      seat.title = guest
        ? guest.name + (guest.child ? ' (Kind)' : '') +
          ' · ' + guestStatusLabel(guestStatus) +
          (guest.dishName ? ' · ' + guest.dishName : '') +
          ' · Tisch ' + table.number + ', ' + seatPositionLabel(table, index)
        : 'Platz an Tisch ' + table.number + ' besetzen';
      seat.setAttribute('aria-label', guest
        ? guest.name + ' (' + guestStatusLabel(guestStatus) + ') an Tisch ' + table.number
        : 'Freier Platz an Tisch ' + table.number + ', ' + seatPositionLabel(table, index));

      if (guest) {
        seat.innerHTML = '<span class="seat-status ' + guestStatus + '" aria-hidden="true"></span>' +
          '<span class="seat-name">' + escapeHtml(guest.name) + '</span>' +
          (guest.child ? '<span class="child-mark" aria-hidden="true">K</span>' : '');
      }

      seat.addEventListener('pointerdown', (event) => event.stopPropagation());
      seat.addEventListener('click', (event) => {
        event.stopPropagation();
        openPopover(table.id, index);
      });

      if (guest) {
        seat.draggable = true;
        seat.addEventListener('dragstart', (event) => {
          if (!table.seats[index]) {
            event.preventDefault();
            return;
          }
          event.stopPropagation();
          const dragData = {
            kind: 'guest',
            guestId: table.seats[index],
            from: { tableId: table.id, seatIndex: index }
          };
          event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
          event.dataTransfer.effectAllowed = 'move';
          document.body.classList.add('is-dragging-guest');
        });
        seat.addEventListener('dragend', () => {
          document.body.classList.remove('is-dragging-guest');
        });
      }

      seat.addEventListener('dragover', (event) => {
        if (!event.dataTransfer || !event.dataTransfer.types.includes('text/plain')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        seat.classList.add('drop-target');
      });
      seat.addEventListener('dragleave', (event) => {
        if (!seat.contains(event.relatedTarget)) seat.classList.remove('drop-target');
      });
      seat.addEventListener('drop', (event) => {
        event.preventDefault();
        seat.classList.remove('drop-target');
        document.body.classList.remove('is-dragging-guest');
        const dragData = readDragData(event);
        if (dragData) assignGuest(dragData.guestId, table.id, index);
      });

      element.appendChild(seat);
    });

    const rotateHandle = document.createElement('button');
    rotateHandle.type = 'button';
    rotateHandle.className = 'rotate-handle';
    rotateHandle.title = 'Ziehen zum Drehen';
    rotateHandle.setAttribute('aria-label', 'Tisch drehen');
    rotateHandle.innerHTML = '⟳';
    rotateHandle.addEventListener('pointerdown', onRotatePointerDown);
    rotateHandle.addEventListener('click', (event) => event.stopPropagation());
    element.appendChild(rotateHandle);

    return element;
  }

  function renderGuestList() {
    const query = els.guestSearch.value.trim().toLowerCase();
    const assignments = assignmentMap();
    const filtered = state.guests.filter((guest) => {
      const status = normalizeGuestStatus(guest.status);
      const assigned = assignments.has(guest.id);
      if (guestStatusFilter !== 'all' && status !== guestStatusFilter) return false;
      if (guestAssignmentFilter === 'assigned' && !assigned) return false;
      if (guestAssignmentFilter === 'unassigned' && assigned) return false;
      return !query || guest.name.toLowerCase().includes(query);
    });

    els.guestList.innerHTML = '';
    els.guestCount.textContent = String(state.guests.length);

    const unassigned = state.guests.filter((guest) => !assignments.has(guest.id)).length;
    els.openCount.textContent = unassigned === 0
      ? 'alle platziert'
      : unassigned + ' ohne Platz';

    if (!filtered.length) {
      const empty = document.createElement('li');
      empty.className = 'list-empty';
      empty.textContent = state.guests.length
        ? 'Keine Personen für diesen Filter.'
        : 'Noch keine Personen. Lege sie unter „Personen verwalten“ an.';
      els.guestList.appendChild(empty);
      return;
    }

    for (const guest of filtered) {
      const assignment = assignments.get(guest.id);
      const status = normalizeGuestStatus(guest.status);
      const statusLabel = guestStatusLabel(status);
      const group = guest.group ? ' · ' + escapeHtml(guest.group) : '';
      const assignmentText = assignment
        ? 'Tisch ' + escapeHtml(assignment.table.number) + ' · ' + seatPositionLabel(assignment.table, assignment.index)
        : 'nicht zugeordnet';

      const row = document.createElement('li');
      row.className = 'guest-row status-' + status;
      row.dataset.guestId = guest.id;
      row.dataset.assigned = assignment ? 'true' : 'false';
      row.draggable = true;
      row.innerHTML =
        '<span class="guest-status-dot ' + status + '" title="' + statusLabel + '"></span>' +
        '<div class="guest-main">' +
          '<span class="guest-name" title="' + escapeHtml(guest.name) + '">' +
            escapeHtml(guest.name) +
            (guest.child ? '<span class="guest-tag">Kind</span>' : '') +
          '</span>' +
          '<span class="guest-meta"><span class="guest-status-label ' + status + '">' +
            statusLabel + '</span>' + group + '</span>' +
          '<span class="guest-meta">' + assignmentText + '</span>' +
        '</div>';

      els.guestList.appendChild(row);
    }
  }

  function renderTableList() {
    els.tableList.innerHTML = '';
    els.tableCount.textContent = String(state.tables.length);

    if (!state.tables.length) {
      const empty = document.createElement('li');
      empty.className = 'list-empty';
      empty.textContent = 'Noch keine Tische angelegt.';
      els.tableList.appendChild(empty);
      return;
    }

    const sorted = state.tables.slice().sort((a, b) => a.number - b.number);
    for (const table of sorted) {
      const total = table.seats.length;
      const occupied = occupiedSeats(table);
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'table-row' + (table.id === selectedTableId ? ' selected' : '');
      button.dataset.tableId = table.id;
      const shapeLabel = isRound(table) ? 'Rund' : 'Rechteckig';
      button.innerHTML =
        '<span class="table-badge' + (isRound(table) ? ' round' : '') + '">' + escapeHtml(table.number) + '</span>' +
        '<span class="table-row-text">' +
          '<strong>Tisch ' + escapeHtml(table.number) + '</strong>' +
          '<small>' + shapeLabel + ' · ' + occupied + ' von ' + total + ' Plätzen belegt</small>' +
        '</span>';
      button.addEventListener('click', () => {
        selectTable(table.id);
        scrollTableIntoView(table);
      });
      item.appendChild(button);
      els.tableList.appendChild(item);
    }
  }

  function renderInspector() {
    const table = selectedTableId ? getTable(selectedTableId) : null;

    if (!table) {
      els.inspector.hidden = true;
      return;
    }

    const round = isRound(table);
    const seatValue = round ? roundSeatCount(table) : table.seatsPerSide;

    els.inspector.hidden = false;
    els.tableNumberInput.value = String(table.number);
    els.seatsLabel.textContent = round ? 'Plätze' : 'Plätze je Seite';
    els.seatsValue.textContent = String(seatValue);
    els.rotationValue.textContent = Math.round(table.rotation) + '°';
    els.seatsMinus.disabled = seatValue <= (round ? MIN_ROUND_SEATS : MIN_SEATS_PER_SIDE);
    els.seatsPlus.disabled = seatValue >= (round ? MAX_ROUND_SEATS : MAX_SEATS_PER_SIDE);

    $$('[data-table-shape]', els.inspector).forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.tableShape === table.shape ? 'true' : 'false');
    });

    const total = table.seats.length;
    const occupied = occupiedSeats(table);
    els.tableSeatInfo.textContent = occupied + ' von ' + total + ' Plätzen belegt · ' +
      (total - occupied) + ' frei';
  }

  /* ---------- Auswahl ---------- */

  function selectTable(id) {
    if (selectedTableId === id) {
      renderInspector();
      return;
    }
    selectedTableId = id;
    $$('.table', els.tablesLayer).forEach((element) => {
      element.classList.toggle('selected', element.dataset.tableId === id);
    });
    renderTableList();
    renderInspector();
    closePopover();
  }

  function clearSelection() {
    if (!selectedTableId) return;
    selectedTableId = null;
    $$('.table', els.tablesLayer).forEach((element) => element.classList.remove('selected'));
    renderTableList();
    renderInspector();
  }

  function scrollTableIntoView(table) {
    const zoom = state.settings.zoom;
    const centerX = (table.x + tableWidth(table) / 2) * zoom;
    const centerY = (table.y + tableHeight(table) / 2) * zoom;
    const left = clamp(centerX - els.viewport.clientWidth / 2, 0, Math.max(0, els.boardScale.scrollWidth - els.viewport.clientWidth));
    const top = clamp(centerY - els.viewport.clientHeight / 2, 0, Math.max(0, els.boardScale.scrollHeight - els.viewport.clientHeight));
    els.viewport.scrollTo({ left: left, top: top, behavior: 'smooth' });
  }

  function scrollToPlanCenter() {
    if (!state.tables.length) return;
    const bounds = getPlanBounds();
    if (!bounds) return;
    const zoom = state.settings.zoom;
    const centerX = ((bounds.minX + bounds.maxX) / 2) * zoom;
    const centerY = ((bounds.minY + bounds.maxY) / 2) * zoom;
    els.viewport.scrollLeft = Math.max(0, centerX - els.viewport.clientWidth / 2);
    els.viewport.scrollTop = Math.max(0, centerY - els.viewport.clientHeight / 2);
  }

  /* ---------- Tisch-Interaktion ---------- */

  function onTablePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const body = event.currentTarget;
    const tableElement = body.closest('.table');
    if (!tableElement) return;
    const table = getTable(tableElement.dataset.tableId);
    if (!table) return;

    event.stopPropagation();
    selectTable(table.id);

    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startX = table.x;
    const startY = table.y;
    const zoom = state.settings.zoom;
    let moved = false;

    body.classList.add('dragging');
    try { body.setPointerCapture(event.pointerId); } catch (error) { /* nicht kritisch */ }

    const onMove = (moveEvent) => {
      const deltaX = (moveEvent.clientX - startClientX) / zoom;
      const deltaY = (moveEvent.clientY - startClientY) / zoom;
      if (!moved && Math.hypot(deltaX, deltaY) < 2) return;
      if (!moved) {
        remember();
        moved = true;
      }

      let nextX = clamp(startX + deltaX, 0, BOARD_W - 60);
      let nextY = clamp(startY + deltaY, 0, BOARD_H - 60);
      if (state.settings.snap) {
        nextX = Math.round(nextX / SNAP) * SNAP;
        nextY = Math.round(nextY / SNAP) * SNAP;
      }

      table.x = nextX;
      table.y = nextY;
      tableElement.style.left = nextX + 'px';
      tableElement.style.top = nextY + 'px';
    };

    const onUp = () => {
      body.classList.remove('dragging');
      try { body.releasePointerCapture(event.pointerId); } catch (error) { /* nicht kritisch */ }
      body.removeEventListener('pointermove', onMove);
      body.removeEventListener('pointerup', onUp);
      body.removeEventListener('pointercancel', onUp);
      if (moved) scheduleSave();
    };

    body.addEventListener('pointermove', onMove);
    body.addEventListener('pointerup', onUp);
    body.addEventListener('pointercancel', onUp);
  }

  function onRotatePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const handle = event.currentTarget;
    const tableElement = handle.closest('.table');
    if (!tableElement) return;
    const table = getTable(tableElement.dataset.tableId);
    if (!table) return;

    event.preventDefault();
    event.stopPropagation();
    selectTable(table.id);

    const rect = tableElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let moved = false;

    handle.classList.add('dragging');
    try { handle.setPointerCapture(event.pointerId); } catch (error) { /* nicht kritisch */ }

    const onMove = (moveEvent) => {
      let angle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) * 180 / Math.PI + 90;
      if (moveEvent.shiftKey) angle = Math.round(angle / 15) * 15;
      angle = normalizeAngle(Math.round(angle * 10) / 10);

      if (!moved) {
        remember();
        moved = true;
      }

      table.rotation = angle;
      tableElement.style.transform = 'rotate(' + angle + 'deg)';
      els.rotationValue.textContent = Math.round(angle) + '°';
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      try { handle.releasePointerCapture(event.pointerId); } catch (error) { /* nicht kritisch */ }
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      if (moved) scheduleSave();
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function addTable(shape) {
    remember();

    const round = shape === 'round';
    const seatsPerSide = 4;
    const seatCount = round ? 8 : seatsPerSide * 2;
    const draft = {
      shape: round ? 'round' : 'rect',
      seatsPerSide: seatsPerSide,
      seatCount: seatCount
    };
    const width = tableWidth(draft);
    const height = tableHeight(draft);
    const zoom = state.settings.zoom;
    const centerX = (els.viewport.scrollLeft + els.viewport.clientWidth / 2) / zoom;
    const centerY = (els.viewport.scrollTop + els.viewport.clientHeight / 2) / zoom;

    let x = centerX - width / 2;
    let y = centerY - height / 2;
    if (state.settings.snap) {
      x = Math.round(x / SNAP) * SNAP;
      y = Math.round(y / SNAP) * SNAP;
    }
    const position = findFreePosition(x, y, draft);

    const table = {
      id: uid('t'),
      number: nextTableNumber(),
      x: position.x,
      y: position.y,
      shape: draft.shape,
      seatsPerSide: seatsPerSide,
      seatCount: seatCount,
      rotation: 0,
      seats: new Array(seatCount).fill(null)
    };

    state.tables.push(table);
    selectedTableId = table.id;
    renderAll();
    scheduleSave();
    requestAnimationFrame(() => scrollTableIntoView(table));
  }

  function duplicateSelectedTable() {
    const table = selectedTableId ? getTable(selectedTableId) : null;
    if (!table) return;

    remember();
    const total = table.seats.length;
    const copy = {
      id: uid('t'),
      number: nextTableNumber(),
      x: table.x,
      y: table.y,
      shape: table.shape,
      seatsPerSide: table.seatsPerSide,
      seatCount: isRound(table) ? roundSeatCount(table) : total,
      rotation: table.rotation,
      seats: new Array(total).fill(null)
    };
    const position = findFreePosition(table.x + 40, table.y + 40, copy);
    copy.x = position.x;
    copy.y = position.y;
    state.tables.push(copy);
    selectedTableId = copy.id;
    renderAll();
    scheduleSave();
    requestAnimationFrame(() => scrollTableIntoView(copy));
  }

  function deleteSelectedTable() {
    const table = selectedTableId ? getTable(selectedTableId) : null;
    if (!table) return;

    const occupied = occupiedSeats(table);
    if (occupied > 0) {
      const confirmed = window.confirm(
        'Tisch ' + table.number + ' löschen?\n\n' +
        occupied + (occupied === 1 ? ' Gast wird' : ' Gäste werden') +
        ' wieder als „nicht zugeordnet“ geführt.'
      );
      if (!confirmed) return;
    }

    remember();
    state.tables = state.tables.filter((item) => item.id !== table.id);
    selectedTableId = null;
    closePopover();
    renderAll();
    scheduleSave();
  }

  function changeSeats(delta) {
    const table = selectedTableId ? getTable(selectedTableId) : null;
    if (!table) return;

    if (isRound(table)) {
      const current = roundSeatCount(table);
      const next = clamp(current + delta, MIN_ROUND_SEATS, MAX_ROUND_SEATS);
      if (next === current) return;

      remember();
      const centerX = table.x + tableWidth(table) / 2;
      const centerY = table.y + tableHeight(table) / 2;

      table.seatCount = next;
      table.seats = padSeats(table.seats, next);

      const width = tableWidth(table);
      const height = tableHeight(table);
      table.x = clamp(centerX - width / 2, 0, BOARD_W - width);
      table.y = clamp(centerY - height / 2, 0, BOARD_H - height);

      renderAll();
      scheduleSave();
      return;
    }

    const next = clamp(table.seatsPerSide + delta, MIN_SEATS_PER_SIDE, MAX_SEATS_PER_SIDE);
    if (next === table.seatsPerSide) return;

    remember();
    const oldCount = table.seatsPerSide;
    const top = table.seats.slice(0, oldCount);
    const bottom = table.seats.slice(oldCount);
    const seats = [];
    for (let index = 0; index < next; index += 1) seats.push(top[index] || null);
    for (let index = 0; index < next; index += 1) seats.push(bottom[index] || null);

    table.seatsPerSide = next;
    table.seatCount = next * 2;
    table.seats = seats;
    renderAll();
    scheduleSave();
  }

  function setTableShape(shape) {
    const table = selectedTableId ? getTable(selectedTableId) : null;
    if (!table) return;

    const nextShape = shape === 'round' ? 'round' : 'rect';
    if ((table.shape === 'round' ? 'round' : 'rect') === nextShape) return;

    remember();
    const centerX = table.x + tableWidth(table) / 2;
    const centerY = table.y + tableHeight(table) / 2;
    const oldSeats = table.seats.slice();

    if (nextShape === 'round') {
      const count = clamp(oldSeats.length, MIN_ROUND_SEATS, MAX_ROUND_SEATS);
      table.shape = 'round';
      table.seatCount = count;
      table.seats = padSeats(oldSeats, count);
    } else {
      const seatsPerSide = clamp(
        Math.ceil(oldSeats.length / 2),
        MIN_SEATS_PER_SIDE,
        MAX_SEATS_PER_SIDE
      );
      table.shape = 'rect';
      table.seatsPerSide = seatsPerSide;
      table.seatCount = seatsPerSide * 2;
      table.seats = padSeats(oldSeats, seatsPerSide * 2);
    }

    const width = tableWidth(table);
    const height = tableHeight(table);
    table.x = clamp(centerX - width / 2, 0, BOARD_W - width);
    table.y = clamp(centerY - height / 2, 0, BOARD_H - height);

    renderAll();
    scheduleSave();
  }

  function rotateSelected(delta) {
    const table = selectedTableId ? getTable(selectedTableId) : null;
    if (!table) return;

    remember();
    table.rotation = delta === 'reset' ? 0 : normalizeAngle(table.rotation + delta);
    const element = $('.table[data-table-id="' + cssEscape(table.id) + '"]', els.tablesLayer);
    if (element) element.style.transform = 'rotate(' + table.rotation + 'deg)';
    renderInspector();
    scheduleSave();
  }

  /* ---------- Gäste-Interaktion ---------- */

  function addGuest(name, child) {
    if (ADMIN_MODE) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    remember();
    state.guests.push({ id: uid('g'), name: trimmed.slice(0, 80), child: !!child });
    renderAll();
    scheduleSave();
  }

  function deleteGuest(guestId) {
    if (ADMIN_MODE) return;
    const guest = getGuest(guestId);
    if (!guest) return;

    remember();
    for (const table of state.tables) {
      table.seats = table.seats.map((id) => (id === guestId ? null : id));
    }
    state.guests = state.guests.filter((item) => item.id !== guestId);
    if (editingGuestId === guestId) editingGuestId = null;
    renderAll();
    scheduleSave();
  }

  function toggleGuestChild(guestId, isChild) {
    if (ADMIN_MODE) return;
    const guest = getGuest(guestId);
    if (!guest || guest.child === isChild) return;
    remember();
    guest.child = !!isChild;
    renderAll();
    scheduleSave();
  }

  function startEditingGuest(guestId) {
    if (ADMIN_MODE || !getGuest(guestId)) return;
    editingGuestId = guestId;
    renderGuestList();
  }

  function commitGuestEdit(guestId, input) {
    if (ADMIN_MODE) return;
    const guest = getGuest(guestId);
    const cancelled = input.dataset.cancelled === '1';
    const value = input.value.trim();

    if (!cancelled && guest && value && value !== guest.name) {
      remember();
      guest.name = value.slice(0, 80);
      scheduleSave();
    }

    editingGuestId = null;
    renderAll();
  }

  function assignGuest(guestId, tableId, seatIndex) {
    const guest = getGuest(guestId);
    const target = getTable(tableId);
    if (!guest || !target || seatIndex < 0 || seatIndex >= target.seats.length) return;
    if (target.seats[seatIndex] === guestId) return;

    if (normalizeGuestStatus(guest.status) === 'declined') {
      const confirmed = window.confirm(
        guest.name + ' ist als abgesagt markiert. Trotzdem auf einen Platz setzen?'
      );
      if (!confirmed) return;
    }

    remember();

    const source = findSeatOfGuest(guestId);
    const displaced = target.seats[seatIndex];

    if (source) {
      source.table.seats[source.index] = null;
    }
    target.seats[seatIndex] = guestId;

    if (displaced && source && displaced !== guestId) {
      source.table.seats[source.index] = displaced;
    }

    renderAll();
    scheduleSave();
  }

  function clearSeat(tableId, seatIndex) {
    const table = getTable(tableId);
    if (!table || !table.seats[seatIndex]) return;

    remember();
    table.seats[seatIndex] = null;
    renderAll();
    scheduleSave();
  }

  function moveSelectedTableBy(deltaX, deltaY) {
    const table = selectedTableId ? getTable(selectedTableId) : null;
    if (!table) return;

    remember();
    table.x = clamp(table.x + deltaX, 0, BOARD_W - 60);
    table.y = clamp(table.y + deltaY, 0, BOARD_H - 60);

    const element = $('.table[data-table-id="' + cssEscape(table.id) + '"]', els.tablesLayer);
    if (element) {
      element.style.left = table.x + 'px';
      element.style.top = table.y + 'px';
    }
    scheduleSave();
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  /* ---------- Platz-Popover ---------- */

  function openPopover(tableId, seatIndex) {
    const table = getTable(tableId);
    if (!table || seatIndex < 0 || seatIndex >= table.seats.length) return;

    popover = { tableId: tableId, seatIndex: seatIndex, search: '' };
    renderPopover();
    if (!popover) return;
    positionPopover();
  }

  function positionPopover() {
    if (!popover) return;

    const seatElement = $(
      '.table[data-table-id="' + cssEscape(popover.tableId) + '"] .seat[data-index="' + popover.seatIndex + '"]',
      els.tablesLayer
    );
    if (!seatElement) {
      closePopover();
      return;
    }

    const areaRect = els.canvasArea.getBoundingClientRect();
    const viewportRect = els.viewport.getBoundingClientRect();
    const seatRect = seatElement.getBoundingClientRect();

    if (
      seatRect.bottom < viewportRect.top + 4 ||
      seatRect.top > viewportRect.bottom - 4 ||
      seatRect.right < viewportRect.left ||
      seatRect.left > viewportRect.right
    ) {
      closePopover();
      return;
    }

    const width = els.seatPopover.offsetWidth || 300;
    const height = els.seatPopover.offsetHeight || 360;

    let left = seatRect.left - areaRect.left + seatRect.width / 2 - width / 2;
    let top = seatRect.bottom - areaRect.top + 10;

    if (top + height > areaRect.height - 8) {
      top = seatRect.top - areaRect.top - height - 10;
    }
    if (top < 8) {
      top = clamp(seatRect.bottom - areaRect.top + 10, 8, Math.max(8, areaRect.height - height - 8));
    }

    left = clamp(left, 8, Math.max(8, areaRect.width - width - 8));
    top = clamp(top, 8, Math.max(8, areaRect.height - height - 8));

    els.seatPopover.style.left = left + 'px';
    els.seatPopover.style.top = top + 'px';
  }

  function closePopover() {
    popover = null;
    els.seatPopover.hidden = true;
    els.seatPopover.innerHTML = '';
  }

  function renderPopover() {
    if (!popover) {
      els.seatPopover.hidden = true;
      return;
    }

    const table = getTable(popover.tableId);
    if (!table || popover.seatIndex < 0 || popover.seatIndex >= table.seats.length) {
      closePopover();
      return;
    }

    const guestId = table.seats[popover.seatIndex];
    const guest = guestId ? getGuest(guestId) : null;
    const guestStatus = guest ? normalizeGuestStatus(guest.status) : null;
    const details = guest
      ? [
          guestStatusLabel(guestStatus),
          guest.group || '',
          guest.dishName || '',
          guest.dietaryNotes ? 'Hinweis: ' + guest.dietaryNotes : ''
        ].filter(Boolean).join(' · ')
      : '';

    els.seatPopover.innerHTML =
      '<div class="popover-head">' +
        '<div><strong>Tisch ' + escapeHtml(table.number) + '</strong>' +
          '<span class="muted"> · Platz ' + seatPositionLabel(table, popover.seatIndex) + '</span></div>' +
        '<button class="icon-btn small" type="button" data-pop-close title="Schließen" aria-label="Schließen">×</button>' +
      '</div>' +
      (guest
        ? '<div class="current-guest">' +
            '<span>' + escapeHtml(guest.name) +
              (guest.child ? '<span class="child-tag">Kind</span>' : '') +
            '</span>' +
            '<button class="mini-link" type="button" data-pop-clear>Platz leeren</button>' +
          '</div>' +
          '<div class="current-guest-details">' + escapeHtml(details) + '</div>'
        : '') +
      '<input id="popSearch" type="search" placeholder="Gast suchen …" value="' + escapeHtml(popover.search) + '" aria-label="Gast suchen">' +
      '<div class="pop-list" id="popList"></div>';

    els.seatPopover.hidden = false;
    renderPopoverList();
  }

  function renderPopoverList() {
    if (!popover) return;
    const list = $('#popList', els.seatPopover);
    if (!list) return;

    const table = getTable(popover.tableId);
    if (!table) return;

    const query = popover.search.trim().toLowerCase();
    const assignments = assignmentMap();
    const guests = state.guests
      .filter((guest) => !query || guest.name.toLowerCase().includes(query))
      .sort((a, b) => {
        const aAssigned = assignments.has(a.id) ? 1 : 0;
        const bAssigned = assignments.has(b.id) ? 1 : 0;
        if (aAssigned !== bAssigned) return aAssigned - bAssigned;
        return a.name.localeCompare(b.name, 'de');
      });

    if (!guests.length) {
      list.innerHTML = '<div class="pop-empty">' +
        (state.guests.length ? 'Kein Gast gefunden.' : 'Noch keine Gäste vorhanden. Füge sie links in der Gästeliste hinzu.') +
        '</div>';
      return;
    }

    list.innerHTML = guests.map((guest) => {
      const assignment = assignments.get(guest.id);
      const status = normalizeGuestStatus(guest.status);
      const meta = guestStatusLabel(status) + ' · ' + (assignment
        ? 'Tisch ' + escapeHtml(assignment.table.number) + ' · ' + seatPositionLabel(assignment.table, assignment.index)
        : 'frei');
      return '<button class="pop-guest' + (assignment ? ' assigned' : '') + '" type="button" data-guest-id="' +
        escapeHtml(guest.id) + '">' +
        '<span class="pop-guest-main">' +
          '<span class="guest-status-dot ' + status + '" aria-hidden="true"></span>' +
          '<span class="pop-name">' + escapeHtml(guest.name) +
            (guest.child ? '<span class="child-tag">Kind</span>' : '') + '</span>' +
        '</span>' +
        '<span class="pop-meta">' + meta + '</span>' +
      '</button>';
    }).join('');
  }

  /* ---------- Drag & Drop ---------- */

  function readDragData(event) {
    try {
      const raw = event.dataTransfer.getData('text/plain');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.kind !== 'guest' || typeof parsed.guestId !== 'string') return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function onGuestDragStart(event) {
    const row = event.target.closest('.guest-row');
    if (!row) return;
    if (event.target.closest('.child-toggle, .row-actions, .guest-name-input')) {
      event.preventDefault();
      return;
    }
    const guest = getGuest(row.dataset.guestId);
    if (!guest) {
      event.preventDefault();
      return;
    }
    const dragData = { kind: 'guest', guestId: guest.id, from: null };
    event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
    event.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
    document.body.classList.add('is-dragging-guest');
  }

  function onGuestDragEnd(event) {
    const row = event.target.closest('.guest-row');
    if (row) row.classList.remove('dragging');
    document.body.classList.remove('is-dragging-guest');
    els.guestsPanel.classList.remove('drop-active');
  }

  /* ---------- Plan-Grenzen / Export-Canvas ---------- */

  function getPlanBounds() {
    if (!state.tables.length) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const table of state.tables) {
      const width = tableWidth(table);
      const height = tableHeight(table);
      const centerX = table.x + width / 2;
      const centerY = table.y + height / 2;
      let halfWidth;
      let halfHeight;

      if (isRound(table)) {
        const half = roundTableRadius(table) + CHAIR_GAP + SEAT_W + 10;
        halfWidth = half;
        halfHeight = half;
      } else {
        halfWidth = width / 2 + 34;
        halfHeight = TABLE_H / 2 + SEAT_H + CHAIR_GAP + 28;
      }

      const radians = table.rotation * Math.PI / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const corners = [
        [-halfWidth, -halfHeight],
        [halfWidth, -halfHeight],
        [halfWidth, halfHeight],
        [-halfWidth, halfHeight]
      ];

      for (const corner of corners) {
        const pointX = centerX + corner[0] * cos - corner[1] * sin;
        const pointY = centerY + corner[0] * sin + corner[1] * cos;
        minX = Math.min(minX, pointX);
        minY = Math.min(minY, pointY);
        maxX = Math.max(maxX, pointX);
        maxY = Math.max(maxY, pointY);
      }
    }

    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function roundRectPath(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  function ellipsize(context, text, maxWidth) {
    if (context.measureText(text).width <= maxWidth) return text;
    let output = text;
    while (output.length > 1 && context.measureText(output + '…').width > maxWidth) {
      output = output.slice(0, -1);
    }
    return output + '…';
  }

  function wrapLines(context, text, maxWidth, maxLines) {
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];

    const lines = [];
    let wordIndex = 0;

    while (wordIndex < words.length && lines.length < maxLines) {
      let line = words[wordIndex];
      wordIndex += 1;

      if (context.measureText(line).width > maxWidth) {
        line = ellipsize(context, line, maxWidth);
      }

      while (wordIndex < words.length) {
        const candidate = line + ' ' + words[wordIndex];
        if (context.measureText(candidate).width <= maxWidth) {
          line = candidate;
          wordIndex += 1;
        } else {
          break;
        }
      }

      lines.push(line);
    }

    if (wordIndex < words.length && lines.length) {
      lines[lines.length - 1] = ellipsize(
        context,
        lines[lines.length - 1] + ' ' + words.slice(wordIndex).join(' '),
        maxWidth
      );
    }

    return lines;
  }

  function hasSeatedChildren() {
    for (const table of state.tables) {
      for (const guestId of table.seats) {
        const guest = guestId ? getGuest(guestId) : null;
        if (guest && guest.child) return true;
      }
    }
    return false;
  }

  function renderPlanCanvas() {
    const bounds = getPlanBounds();
    const palette = (SCHEMES[state.settings.scheme] || SCHEMES[DEFAULT_SCHEME]).print;
    const PAD = 36;
    const HEADER = 106;
    const hasChildren = hasSeatedChildren();

    let width;
    let height;
    let offsetX = 0;
    let offsetY = 0;

    if (bounds) {
      width = bounds.maxX - bounds.minX + PAD * 2;
      height = bounds.maxY - bounds.minY + HEADER + PAD;
      offsetX = PAD - bounds.minX;
      offsetY = HEADER - bounds.minY;
    } else {
      width = 760;
      height = 430;
    }

    const scale = clamp(3600 / Math.max(width, height), 0.6, 4);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const context = canvas.getContext('2d');
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);

    // Kopfzeile
    context.textBaseline = 'alphabetic';
    context.textAlign = 'left';
    context.fillStyle = '#2b2620';
    context.font = '600 27px ' + PRINT_SERIF;
    context.fillText('Tischplan', PAD, 62);

    context.textAlign = 'right';
    context.fillStyle = '#8a8177';
    context.font = '12px ' + PRINT_SANS;
    context.fillText(formatDateLong() + (hasChildren ? '   ·   K = Kind' : ''), width - PAD, 58);

    context.strokeStyle = palette.tableBorder;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(PAD, 84);
    context.lineTo(width - PAD, 84);
    context.stroke();

    if (!bounds) {
      context.textAlign = 'center';
      context.fillStyle = '#8a8177';
      context.font = '13px ' + PRINT_SANS;
      context.fillText('Noch keine Tische angelegt.', width / 2, height / 2 + 12);

      context.fillStyle = '#2b2620';
      context.font = '600 20px ' + PRINT_SERIF;
      context.fillText('Der Tischplan ist noch leer', width / 2, height / 2 - 18);
      return canvas;
    }

    context.save();
    context.translate(offsetX, offsetY);
    for (const table of state.tables) {
      drawTableOnCanvas(context, table, palette);
    }
    context.restore();

    return canvas;
  }

  function drawTableOnCanvas(context, table, palette) {
    if (isRound(table)) {
      drawRoundTableOnCanvas(context, table, palette);
      return;
    }

    const width = tableWidth(table);
    const height = TABLE_H;
    const centerX = width / 2;
    const centerY = height / 2;

    context.save();
    context.translate(table.x + centerX, table.y + centerY);
    context.rotate(table.rotation * Math.PI / 180);
    context.translate(-centerX, -centerY);

    // Schatten + Tischplatte
    context.save();
    context.shadowColor = 'rgba(80, 60, 35, 0.16)';
    context.shadowBlur = 14;
    context.shadowOffsetY = 5;
    roundRectPath(context, 0, 0, width, height, 16);
    context.fillStyle = palette.table;
    context.fill();
    context.restore();

    roundRectPath(context, 0, 0, width, height, 16);
    context.strokeStyle = palette.tableBorder;
    context.lineWidth = 1.2;
    context.stroke();

    // Tischnummer
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#8c8378';
    context.font = '700 8px ' + PRINT_SANS;
    context.fillText('TISCH', centerX, 35);
    context.fillStyle = '#322c25';
    context.font = '600 27px ' + PRINT_SERIF;
    context.fillText(String(table.number), centerX, 62);

    // Stühle
    table.seats.forEach((guestId, index) => {
      drawSeatOnCanvas(context, guestId, seatLeft(index, table), seatTop(index, table), palette);
    });

    context.restore();
  }

  function drawRoundTableOnCanvas(context, table, palette) {
    const radius = roundTableRadius(table);

    context.save();
    context.translate(table.x + radius, table.y + radius);
    context.rotate(table.rotation * Math.PI / 180);

    // Schatten + runde Tischplatte
    context.save();
    context.shadowColor = 'rgba(80, 60, 35, 0.16)';
    context.shadowBlur = 14;
    context.shadowOffsetY = 5;
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fillStyle = palette.table;
    context.fill();
    context.restore();

    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.strokeStyle = palette.tableBorder;
    context.lineWidth = 1.2;
    context.stroke();

    // Tischnummer
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#8c8378';
    context.font = '700 8px ' + PRINT_SANS;
    context.fillText('TISCH', 0, -6);
    context.fillStyle = '#322c25';
    context.font = '600 27px ' + PRINT_SERIF;
    context.fillText(String(table.number), 0, 22);

    // Stühle rund um den Tisch
    table.seats.forEach((guestId, index) => {
      const offset = roundSeatOffset(table, index);
      drawSeatOnCanvas(
        context,
        guestId,
        offset.x - SEAT_W / 2,
        offset.y - SEAT_H / 2,
        palette
      );
    });

    context.restore();
  }

  function drawSeatOnCanvas(context, guestId, x, y, palette) {
    const guest = guestId ? getGuest(guestId) : null;

    roundRectPath(context, x, y, SEAT_W, SEAT_H, 10);
    context.fillStyle = guest ? palette.filled : '#ffffff';
    context.fill();
    context.strokeStyle = guest ? palette.filledBorder : palette.seatBorder;
    context.lineWidth = 1.1;
    context.stroke();

    if (!guest) return;

    context.fillStyle = '#312b24';
    context.font = '500 10px ' + PRINT_SANS;
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    const lines = wrapLines(context, guest.name, SEAT_W - 10, 2);
    const startBaseline = lines.length > 1 ? y + 15 : y + 21;
    lines.forEach((line, lineIndex) => {
      context.fillText(line, x + SEAT_W / 2, startBaseline + lineIndex * 11);
    });

    if (guest.child) {
      context.beginPath();
      context.arc(x + SEAT_W - 5, y + 5, 7, 0, Math.PI * 2);
      context.fillStyle = palette.child;
      context.fill();
      context.fillStyle = '#ffffff';
      context.font = '700 7px ' + PRINT_SANS;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('K', x + SEAT_W - 5, y + 5.5);
    }

    context.textBaseline = 'alphabetic';
  }

  /* ---------- Downloads ---------- */

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      if (canvas.toBlob) {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas konnte nicht exportiert werden.'));
        }, type, quality);
        return;
      }
      try {
        const dataUrl = canvas.toDataURL(type, quality);
        resolve(dataUrlToBlob(dataUrl));
      } catch (error) {
        reject(error);
      }
    });
  }

  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime = /:(.*?);/.exec(parts[0]);
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime ? mime[1] : 'application/octet-stream' });
  }

  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function buildTextExport() {
    const lines = [];
    lines.push('Tischplan – ' + formatDateLong());
    lines.push('');

    const sorted = state.tables.slice().sort((a, b) => a.number - b.number);
    const seated = new Set();

    if (!sorted.length) {
      lines.push('Noch keine Tische angelegt.');
    }

    for (const table of sorted) {
      const names = [];
      for (const guestId of table.seats) {
        if (!guestId) continue;
        const guest = getGuest(guestId);
        if (!guest) continue;
        seated.add(guest.id);
        names.push(guest.name + (guest.child ? ' (Kind)' : ''));
      }
      lines.push('Tischnummer ' + table.number + ': ' + names.join(', '));
    }

    const unassigned = state.guests.filter((guest) => !seated.has(guest.id));
    if (unassigned.length) {
      lines.push('');
      lines.push('Nicht zugeordnet: ' + unassigned.map((guest) =>
        guest.name + (guest.child ? ' (Kind)' : '')
      ).join(', '));
    }

    if (state.guests.some((guest) => guest.child)) {
      lines.push('');
      lines.push('Kinder sind mit „(Kind)“ gekennzeichnet.');
    }

    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  function exportTxt() {
    const blob = new Blob([buildTextExport()], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, 'tischplan_' + dateStamp() + '.txt');
    showToast('Textdatei wurde erstellt.');
  }

  async function exportPng() {
    const canvas = renderPlanCanvas();
    const blob = await canvasToBlob(canvas, 'image/png');
    downloadBlob(blob, 'tischplan_' + dateStamp() + '.png');
    showToast('PNG wurde erstellt.');
  }

  function buildPdf(jpegBytes, imageWidth, imageHeight) {
    const A4_SHORT = 595.28;
    const A4_LONG = 841.89;
    const landscape = imageWidth >= imageHeight;
    const pageWidth = landscape ? A4_LONG : A4_SHORT;
    const pageHeight = landscape ? A4_SHORT : A4_LONG;
    const margin = 26;

    const fit = Math.min(
      (pageWidth - margin * 2) / imageWidth,
      (pageHeight - margin * 2) / imageHeight
    );
    const drawWidth = imageWidth * fit;
    const drawHeight = imageHeight * fit;
    const drawX = (pageWidth - drawWidth) / 2;
    const drawY = (pageHeight - drawHeight) / 2;

    const content = 'q\n' +
      drawWidth.toFixed(3) + ' 0 0 ' + drawHeight.toFixed(3) + ' ' +
      drawX.toFixed(3) + ' ' + drawY.toFixed(3) + ' cm\n' +
      '/Im0 Do\nQ\n';
    const contentBytes = new TextEncoder().encode(content);

    const encoder = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let size = 0;

    const push = (data) => {
      const bytes = typeof data === 'string' ? encoder.encode(data) : data;
      chunks.push(bytes);
      size += bytes.length;
    };

    push('%PDF-1.4\n');

    offsets[1] = size;
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    offsets[2] = size;
    push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

    offsets[3] = size;
    push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
      pageWidth.toFixed(2) + ' ' + pageHeight.toFixed(2) + '] ' +
      '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');

    offsets[4] = size;
    push('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + imageWidth +
      ' /Height ' + imageHeight +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
      jpegBytes.length + ' >>\nstream\n');
    push(jpegBytes);
    push('\nendstream\nendobj\n');

    offsets[5] = size;
    push('5 0 obj\n<< /Length ' + contentBytes.length + ' >>\nstream\n');
    push(contentBytes);
    push('endstream\nendobj\n');

    const xrefStart = size;
    let xref = 'xref\n0 6\n0000000000 65535 f \n';
    for (let index = 1; index <= 5; index += 1) {
      xref += String(offsets[index]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n');

    return new Blob(chunks, { type: 'application/pdf' });
  }

  function exportPdf() {
    const canvas = renderPlanCanvas();
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95);
    const jpegBytes = dataUrlToBytes(jpegDataUrl);
    const pdf = buildPdf(jpegBytes, canvas.width, canvas.height);
    downloadBlob(pdf, 'tischplan_' + dateStamp() + '.pdf');
    showToast('PDF wurde erstellt.');
  }

  /* ---------- JSON / Import / Reset ---------- */

  function exportJson() {
    const payload = {
      app: 'tischplaner',
      savedAt: new Date().toISOString(),
      version: 1,
      guests: state.guests,
      tables: state.tables,
      settings: state.settings
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'tischplan_' + dateStamp() + '.json');
    showToast('Projektdatei wurde gesichert.');
  }

  /* ----- Gästeliste als eigenständiges JSON ----- */

  function parseGuestListJson(text) {
    let parsed;
    const source = String(text).replace(/^\uFEFF/, '');
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error('Die Datei ist kein gültiges JSON.');
    }

    const list = Array.isArray(parsed)
      ? parsed
      : parsed && Array.isArray(parsed.guests) ? parsed.guests : null;

    if (!list) {
      throw new Error('Erwartet wird ein Gäste-Array oder ein Objekt mit dem Feld „guests“.');
    }
    if (!list.length) {
      throw new Error('Die Datei enthält keine Gäste.');
    }

    return list.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('Eintrag ' + (index + 1) + ': Objekt mit „name“ und „child“ erwartet.');
      }
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!name) {
        throw new Error('Eintrag ' + (index + 1) + ': „name“ fehlt oder ist leer.');
      }
      if (typeof item.child !== 'boolean') {
        throw new Error('Eintrag ' + (index + 1) + ': „child“ muss true (Kind) oder false (kein Kind) sein.');
      }
      return { name: name.slice(0, 80), child: item.child };
    });
  }

  function guestKey(guest) {
    return guest.name.trim().toLowerCase() + '|' + (guest.child ? '1' : '0');
  }

  async function importGuestListFile(file) {
    if (ADMIN_MODE) {
      showToast('Gästelisten werden zentral unter „Personen verwalten“ gepflegt.', true);
      return;
    }
    try {
      const guests = parseGuestListJson(await file.text());
      pendingGuestImport = guests;

      if (!state.guests.length) {
        applyGuestImport('add');
        return;
      }

      els.guestImportText.textContent =
        'Die Datei enthält ' + guests.length + ' ' +
        (guests.length === 1 ? 'Gast' : 'Gäste') + '. ' +
        'Im Tischplan sind bereits ' + state.guests.length + ' ' +
        (state.guests.length === 1 ? 'Gast' : 'Gäste') + ' vorhanden.';
      els.guestImportDialog.showModal();
    } catch (error) {
      pendingGuestImport = null;
      showToast(error.message || 'Gästeliste konnte nicht importiert werden.', true);
    }
  }

  function applyGuestImport(mode) {
    if (!pendingGuestImport) return;
    const imported = pendingGuestImport;
    pendingGuestImport = null;

    if (els.guestImportDialog.open) els.guestImportDialog.close();

    if (mode === 'replace') {
      remember();
      for (const table of state.tables) {
        table.seats = table.seats.map(() => null);
      }
      state.guests = imported.map((guest) => ({
        id: uid('g'),
        name: guest.name,
        child: guest.child
      }));
      editingGuestId = null;
      closePopover();
      renderAll();
      saveNow();
      showToast(state.guests.length + ' Gäste importiert. Bisherige Tischzuordnungen wurden entfernt.');
      return;
    }

    const existingKeys = new Set(state.guests.map(guestKey));
    const additions = [];
    let skipped = 0;

    for (const guest of imported) {
      const key = guestKey(guest);
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      additions.push({ id: uid('g'), name: guest.name, child: guest.child });
    }

    if (!additions.length) {
      showToast('Keine neuen Gäste – alle Einträge sind bereits vorhanden.');
      return;
    }

    remember();
    state.guests.push(...additions);
    renderAll();
    saveNow();
    showToast(
      additions.length + ' ' + (additions.length === 1 ? 'Gast' : 'Gäste') + ' hinzugefügt' +
      (skipped ? ', ' + skipped + ' übersprungen' : '') + '.'
    );
  }

  function exportGuestListJson() {
    const payload = {
      format: 'tischplaner-guestlist',
      version: 1,
      exportedAt: new Date().toISOString(),
      guests: state.guests.map((guest) => ({
        name: guest.name,
        child: guest.child
      }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'gaesteliste_' + dateStamp() + '.json');
    showToast('Gästeliste wurde exportiert.');
  }

  async function importJsonFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.guests) || !Array.isArray(parsed.tables)) {
        throw new Error('Die Datei enthält keine gültigen Tischplan-Daten.');
      }

      remember();

      if (ADMIN_MODE) {
        const currentGuests = state.guests.slice();
        const raw = JSON.parse(JSON.stringify(parsed));
        raw.guests = currentGuests.map((guest) => ({
          id: guest.id,
          name: guest.name,
          child: guest.child
        }));
        state = normalizeState(raw);
        state.guests = currentGuests;
      } else {
        state = normalizeState(parsed);
      }

      selectedTableId = null;
      editingGuestId = null;
      closePopover();
      applyTheme();
      applyScheme();
      applyZoom();
      syncSettingsUi();
      renderAll();
      saveNow();
      requestAnimationFrame(scrollToPlanCenter);
      showToast(ADMIN_MODE
        ? 'Plan geladen. Die zentrale Personenliste bleibt erhalten.'
        : 'Projekt wurde geladen.');
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Import fehlgeschlagen.', true);
    }
  }

  function resetAll() {
    const confirmed = window.confirm(ADMIN_MODE
      ? 'Tischplan zurücksetzen?\n\nAlle Tische und Sitzzuordnungen werden gelöscht. Die Personenliste bleibt erhalten.'
      : 'Wirklich alles zurücksetzen?\n\nAlle Gäste und Tische werden gelöscht. Mit „Rückgängig“ kannst du das direkt danach noch rückgängig machen.'
    );
    if (!confirmed) return;

    remember();
    if (!ADMIN_MODE) state.guests = [];
    state.tables = [];
    selectedTableId = null;
    editingGuestId = null;
    closePopover();
    renderAll();
    saveNow();
    showToast(ADMIN_MODE ? 'Tischplan wurde zurückgesetzt.' : 'Alles wurde zurückgesetzt.');
  }

  /* ---------- Toast / Menü ---------- */

  function showToast(message, isError) {
    els.toast.textContent = message;
    els.toast.classList.toggle('error', !!isError);
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 3000);
  }

  function openMenu() {
    closeSchemeMenu();
    els.exportMenu.hidden = false;
    els.exportBtn.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    els.exportMenu.hidden = true;
    els.exportBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleMenu() {
    if (els.exportMenu.hidden) openMenu();
    else closeMenu();
  }

  function openSchemeMenu() {
    closeMenu();
    els.schemeMenu.hidden = false;
    els.schemeBtn.setAttribute('aria-expanded', 'true');
  }

  function closeSchemeMenu() {
    els.schemeMenu.hidden = true;
    els.schemeBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleSchemeMenu() {
    if (els.schemeMenu.hidden) openSchemeMenu();
    else closeSchemeMenu();
  }

  async function handleMenuAction(action) {
    try {
      if (action === 'export-txt') exportTxt();
      else if (action === 'export-png') await exportPng();
      else if (action === 'export-pdf') exportPdf();
      else if (action === 'save-json') exportJson();
      else if (action === 'import-json') els.importFile.click();
      else if (action === 'import-guests') els.importGuestsFile.click();
      else if (action === 'export-guests') exportGuestListJson();
      else if (action === 'reset') resetAll();
    } catch (error) {
      console.error(error);
      showToast('Export fehlgeschlagen: ' + (error.message || 'Unbekannter Fehler'), true);
    }
  }

  /* ---------- Events ---------- */

  function bindEvents() {
    els.guestForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = els.guestNameInput.value.trim();
      if (!name) {
        els.guestNameInput.focus();
        return;
      }
      addGuest(name, els.guestChildInput.checked);
      els.guestNameInput.value = '';
      els.guestChildInput.checked = false;
      els.guestNameInput.focus();
    });

    els.guestSearch.addEventListener('input', renderGuestList);

    if (els.guestStatusFilter) {
      els.guestStatusFilter.addEventListener('click', (event) => {
        const button = event.target.closest('[data-guest-status]');
        if (!button) return;
        guestStatusFilter = button.dataset.guestStatus;
        $$('[data-guest-status]', els.guestStatusFilter).forEach((item) => {
          item.classList.toggle('active', item === button);
        });
        renderGuestList();
      });
    }

    if (els.guestAssignmentFilter) {
      els.guestAssignmentFilter.addEventListener('click', (event) => {
        const button = event.target.closest('[data-assignment-filter]');
        if (!button) return;
        guestAssignmentFilter = button.dataset.assignmentFilter;
        $$('[data-assignment-filter]', els.guestAssignmentFilter).forEach((item) => {
          item.classList.toggle('active', item === button);
        });
        renderGuestList();
      });
    }

    if (els.refreshGuestsBtn) {
      els.refreshGuestsBtn.addEventListener('click', refreshServerPeople);
    }

    if (els.bootRetry) {
      els.bootRetry.addEventListener('click', () => {
        bootErrorShown = false;
        els.bootRetry.hidden = true;
        els.bootMessage.textContent = 'Tischplan wird geladen …';
        loadServerData().catch((error) => {
          showBootError(error.message || 'Der Tischplan konnte nicht geladen werden.');
        });
      });
    }

    els.guestList.addEventListener('click', (event) => {
      if (ADMIN_MODE) return;
      const row = event.target.closest('.guest-row');
      if (!row) return;
      const guestId = row.dataset.guestId;

      if (event.target.closest('[data-action="delete"]')) {
        deleteGuest(guestId);
        return;
      }
      if (event.target.closest('[data-action="edit"]')) {
        startEditingGuest(guestId);
        return;
      }
      if (event.target.closest('.child-toggle')) {
        return;
      }
      if (event.target.closest('.guest-name') && event.detail >= 2) {
        startEditingGuest(guestId);
      }
    });

    els.guestList.addEventListener('dblclick', (event) => {
      const name = event.target.closest('.guest-name');
      const row = event.target.closest('.guest-row');
      if (name && row) startEditingGuest(row.dataset.guestId);
    });

    els.guestList.addEventListener('change', (event) => {
      if (!event.target.matches('.child-checkbox')) return;
      const row = event.target.closest('.guest-row');
      if (row) toggleGuestChild(row.dataset.guestId, event.target.checked);
    });

    els.guestList.addEventListener('keydown', (event) => {
      if (!event.target.matches('.guest-name-input')) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.target.dataset.cancelled = '1';
        event.target.blur();
      }
    });

    els.guestList.addEventListener('blur', (event) => {
      if (!event.target.matches('.guest-name-input')) return;
      const row = event.target.closest('.guest-row');
      if (row) commitGuestEdit(row.dataset.guestId, event.target);
    }, true);

    els.guestList.addEventListener('dragstart', onGuestDragStart);
    els.guestList.addEventListener('dragend', onGuestDragEnd);

    els.guestsPanel.addEventListener('dragover', (event) => {
      if (!event.dataTransfer || !event.dataTransfer.types.includes('text/plain')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      els.guestsPanel.classList.add('drop-active');
    });

    els.guestsPanel.addEventListener('dragleave', (event) => {
      if (!els.guestsPanel.contains(event.relatedTarget)) {
        els.guestsPanel.classList.remove('drop-active');
      }
    });

    els.guestsPanel.addEventListener('drop', (event) => {
      const dragData = readDragData(event);
      els.guestsPanel.classList.remove('drop-active');
      document.body.classList.remove('is-dragging-guest');
      if (!dragData || !dragData.from) return;
      event.preventDefault();
      clearSeat(dragData.from.tableId, dragData.from.seatIndex);
    });

    els.addTableBtn.addEventListener('click', () => addTable('rect'));
    els.addRoundTableBtn.addEventListener('click', () => addTable('round'));
    els.emptyAddTable.addEventListener('click', () => addTable('rect'));
    els.emptyAddRoundTable.addEventListener('click', () => addTable('round'));

    els.board.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.table')) return;
      clearSelection();
      closePopover();
    });

    els.viewport.addEventListener('scroll', () => {
      if (popover) positionPopover();
    }, { passive: true });

    window.addEventListener('resize', () => {
      if (popover) positionPopover();
    });

    els.zoomOut.addEventListener('click', () => stepZoom(-1));
    els.zoomIn.addEventListener('click', () => stepZoom(1));
    els.zoomLabel.addEventListener('click', () => setZoom(1, true));

    els.snapToggle.addEventListener('change', () => {
      state.settings.snap = els.snapToggle.checked;
      scheduleSave();
    });

    els.themeBtn.addEventListener('click', () => {
      state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      scheduleSave();
    });

    els.undoBtn.addEventListener('click', undo);
    els.redoBtn.addEventListener('click', redo);

    els.exportBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMenu();
    });

    els.exportMenu.addEventListener('click', (event) => {
      const actionButton = event.target.closest('[data-action]');
      if (!actionButton) return;
      closeMenu();
      handleMenuAction(actionButton.dataset.action);
    });

    els.schemeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleSchemeMenu();
    });

    els.schemeOptions.addEventListener('click', (event) => {
      const schemeButton = event.target.closest('[data-scheme]');
      if (!schemeButton) return;
      const key = schemeButton.dataset.scheme;
      if (!SCHEMES[key]) return;
      closeSchemeMenu();
      if (state.settings.scheme === key) return;
      state.settings.scheme = key;
      applyScheme();
      scheduleSave();
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.menu')) {
        closeMenu();
        closeSchemeMenu();
      }
    });

    els.importFile.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (file) importJsonFile(file);
      event.target.value = '';
    });

    els.importGuestsFile.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (file) importGuestListFile(file);
      event.target.value = '';
    });

    els.guestImportAdd.addEventListener('click', () => applyGuestImport('add'));
    els.guestImportReplace.addEventListener('click', () => applyGuestImport('replace'));
    els.guestImportCancel.addEventListener('click', () => {
      pendingGuestImport = null;
      els.guestImportDialog.close();
    });
    els.guestImportDialog.addEventListener('cancel', () => {
      pendingGuestImport = null;
    });

    els.closeInspector.addEventListener('click', clearSelection);

    els.tableNumberInput.addEventListener('change', () => {
      const table = selectedTableId ? getTable(selectedTableId) : null;
      if (!table) return;
      const value = Math.round(num(els.tableNumberInput.value, table.number));
      const next = clamp(value, 1, 9999);
      if (next === table.number) {
        els.tableNumberInput.value = String(table.number);
        return;
      }
      remember();
      table.number = next;
      renderAll();
      scheduleSave();
    });

    els.tableNumberInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        els.tableNumberInput.blur();
      }
    });

    els.seatsMinus.addEventListener('click', () => changeSeats(-1));
    els.seatsPlus.addEventListener('click', () => changeSeats(1));

    $$('[data-rotate]', els.inspector).forEach((button) => {
      button.addEventListener('click', () => {
        const value = button.dataset.rotate;
        rotateSelected(value === 'reset' ? 'reset' : Number(value));
      });
    });

    $$('[data-table-shape]', els.inspector).forEach((button) => {
      button.addEventListener('click', () => setTableShape(button.dataset.tableShape));
    });

    els.duplicateTable.addEventListener('click', duplicateSelectedTable);
    els.deleteTable.addEventListener('click', deleteSelectedTable);

    els.seatPopover.addEventListener('click', (event) => {
      if (event.target.closest('[data-pop-close]')) {
        closePopover();
        return;
      }
      if (event.target.closest('[data-pop-clear]')) {
        if (popover) clearSeat(popover.tableId, popover.seatIndex);
        return;
      }
      const guestButton = event.target.closest('[data-guest-id]');
      if (guestButton && popover) {
        assignGuest(guestButton.dataset.guestId, popover.tableId, popover.seatIndex);
      }
    });

    els.seatPopover.addEventListener('input', (event) => {
      if (event.target.id !== 'popSearch' || !popover) return;
      popover.search = event.target.value;
      renderPopoverList();
    });

    document.addEventListener('pointerdown', (event) => {
      if (!popover) return;
      if (event.target.closest('.seat-popover') || event.target.closest('.seat')) return;
      closePopover();
    }, true);

    document.addEventListener('keydown', (event) => {
      const typing = event.target.closest('input, textarea, select, [contenteditable="true"]');
      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && event.key.toLowerCase() === 'z' && !typing) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'y' && !typing) {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === 'Escape') {
        if (typing) {
          if (event.target.id === 'popSearch') closePopover();
          return;
        }
        if (!els.exportMenu.hidden || !els.schemeMenu.hidden) {
          closeMenu();
          closeSchemeMenu();
        } else if (popover) {
          closePopover();
        } else if (selectedTableId) {
          clearSelection();
        }
        return;
      }
      if (typing || !selectedTableId) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelectedTable();
        return;
      }

      const step = state.settings.snap ? SNAP : 1;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveSelectedTableBy(-step, 0);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveSelectedTableBy(step, 0);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelectedTableBy(0, -step);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelectedTableBy(0, step);
      }
    });

    document.addEventListener('dragend', () => {
      document.body.classList.remove('is-dragging-guest');
      els.guestsPanel.classList.remove('drop-active');
    });

    window.addEventListener('pagehide', () => {
      if (saveTimer) saveNow();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && saveTimer) saveNow();
    });
  }

  /* ---------- Init ---------- */

  function init() {
    buildSchemeMenu();
    applyTheme();
    applyScheme();
    applyZoom();
    syncSettingsUi();
    bindEvents();
    renderAll();
    updateUndoButtons();

    if (ADMIN_MODE) {
      els.guestForm.hidden = true;
      els.guestStatusFilter.hidden = false;
      $$('[data-action="import-guests"], [data-action="export-guests"]', els.exportMenu)
        .forEach((button) => { button.hidden = true; });
      setStatus('Lade vom Server …', 'saving');
      loadServerData().catch((error) => {
        showBootError(error.message || 'Der Tischplan konnte nicht geladen werden.');
      });
      return;
    }

    setStatus(hadSavedState ? 'Letzter Stand geladen' : 'Bereit');
    if (state.tables.length) {
      requestAnimationFrame(scrollToPlanCenter);
    }
  }

  init();
})();
