/**
 * Brautpaar Admin Dashboard Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  let overviewData = null;
  let currentFilter = 'all';
  let searchTerm = '';
  let apiMode = 'auto';

  function getSafeReturnTarget() {
    const target = new URLSearchParams(window.location.search).get('return');
    const allowed = ['personen.html', 'planer/', 'planer/index.html'];
    return allowed.includes(target) ? target : null;
  }

  const returnTarget = getSafeReturnTarget();

  // Resilient API Fetch Helper: Tries /api/... and seamlessly falls back to api.php?route=... for PHP webspace
  async function apiFetch(endpoint, options = {}) {
    const clean = endpoint.replace(/^\/+/, '').replace(/^api\//, '');
    let url = apiMode === 'php'
      ? `api.php?route=${encodeURIComponent(clean)}`
      : `/api/${clean}`;
    const usingPhp = url.startsWith('api.php');

    try {
      let res = await fetch(url, options);
      const contentType = String(res.headers.get('content-type') || '').toLowerCase();
      if (!usingPhp && (res.status === 404 || !contentType.includes('application/json'))) {
        apiMode = 'php';
        url = `api.php?route=${encodeURIComponent(clean)}`;
        updateExportLink();
        res = await fetch(url, options);
      } else if (res.ok && apiMode === 'auto') {
        apiMode = 'api';
      }
      return res;
    } catch (e) {
      if (apiMode === 'auto') {
        apiMode = 'php';
        updateExportLink();
        return await fetch(`api.php?route=${encodeURIComponent(clean)}`, options);
      }
      throw e;
    }
  }

  function updateExportLink() {
    const btnExp = document.getElementById('btn-export-csv');
    if (btnExp && apiMode === 'php') {
      btnExp.href = 'api.php?route=admin/export/csv';
    }
  }

  // DOM Elements
  const loginSection = document.getElementById('admin-login-section');
  const dashboardSection = document.getElementById('admin-dashboard-section');
  const loginForm = document.getElementById('admin-login-form');
  const loginPasswordInput = document.getElementById('admin-password');
  const loginError = document.getElementById('admin-login-error');
  const btnLogout = document.getElementById('btn-admin-logout');

  // Metrics elements
  const metricTotalParties = document.getElementById('metric-total-parties');
  const metricConfirmedPersons = document.getElementById('metric-confirmed-persons');
  const metricConfirmedParties = document.getElementById('metric-confirmed-parties');
  const metricDeclinedParties = document.getElementById('metric-declined-parties');
  const metricPendingParties = document.getElementById('metric-pending-parties');

  // Dishes Container
  const dishesGrid = document.getElementById('dishes-grid');

  // Table and Filters
  const guestsTableBody = document.getElementById('guests-table-body');
  const searchInput = document.getElementById('admin-search-input');
  const filterBtns = document.querySelectorAll('.filter-btn');

  // QR Modal / Section
  const qrSection = document.getElementById('admin-qr-section');
  const qrGrid = document.getElementById('qr-grid');
  const btnToggleQr = document.getElementById('btn-toggle-qr');

  // Guest Details Modal
  const modalOverlay = document.getElementById('guest-modal-overlay');
  const modalBody = document.getElementById('guest-modal-body');
  const modalClose = document.getElementById('guest-modal-close');

  // Initial Auth Check
  checkAuth();

  // Login submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';

    const pw = loginPasswordInput.value.trim();
    if (!pw) return;

    try {
      const res = await apiFetch('admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login fehlgeschlagen');

      loginPasswordInput.value = '';
      if (returnTarget) {
        window.location.href = returnTarget;
        return;
      }
      showDashboard();
      loadOverview();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.style.display = 'block';
    }
  });

  // Logout
  btnLogout.addEventListener('click', async () => {
    try {
      await apiFetch('admin/logout', { method: 'POST' });
    } catch (e) {}
    showLogin();
  });

  // Search input
  searchInput.addEventListener('input', (e) => {
    searchTerm = e.target.value.toLowerCase().trim();
    renderGuestsTable();
  });

  // Filter buttons
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderGuestsTable();
    });
  });

  // Toggle QR View
  btnToggleQr.addEventListener('click', () => {
    if (qrSection.style.display === 'none') {
      qrSection.style.display = 'block';
      btnToggleQr.textContent = 'Gästetabelle anzeigen';
      dashboardSection.querySelector('.card-table-wrap').style.display = 'none';
      loadQRCodes();
    } else {
      qrSection.style.display = 'none';
      btnToggleQr.textContent = 'QR-Codes anzeigen';
      dashboardSection.querySelector('.card-table-wrap').style.display = 'block';
    }
  });

  // Close details modal
  modalClose.addEventListener('click', () => {
    modalOverlay.style.display = 'none';
  });

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) modalOverlay.style.display = 'none';
  });

  // ----------------------------------------------------
  // Core Functions
  // ----------------------------------------------------

  async function checkAuth() {
    try {
      const res = await apiFetch('admin/check');
      if (res.ok) {
        if (returnTarget) {
          window.location.href = returnTarget;
          return;
        }
        showDashboard();
        loadOverview();
      } else {
        showLogin();
      }
    } catch (e) {
      showLogin();
    }
  }

  function showLogin() {
    loginSection.style.display = 'block';
    dashboardSection.style.display = 'none';
    btnLogout.style.display = 'none';
  }

  function showDashboard() {
    loginSection.style.display = 'none';
    dashboardSection.style.display = 'block';
    btnLogout.style.display = 'inline-flex';
  }

  async function loadOverview() {
    try {
      const res = await apiFetch('admin/overview');
      if (!res.ok) throw new Error('Fehler beim Laden der Daten');
      overviewData = await res.json();

      renderMetrics(overviewData.metrics);
      renderDishes(overviewData.dishBreakdown);
      renderGuestsTable();
    } catch (err) {
      console.error(err);
    }
  }

  function renderMetrics(m) {
    metricTotalParties.textContent = m.totalInvitedParties;
    metricConfirmedPersons.textContent = m.totalAttendingPersons;
    metricConfirmedParties.textContent = m.confirmedParties;
    metricDeclinedParties.textContent = m.declinedParties;
    metricPendingParties.textContent = m.pendingParties;
  }

  function renderDishes(dishes) {
    dishesGrid.replaceChildren();

    dishes.forEach(dish => {
      const box = document.createElement('div');
      box.className = 'dish-stat-box';

      const head = document.createElement('div');
      head.className = 'dish-stat-header';

      const name = document.createElement('div');
      name.className = 'dish-stat-name';
      name.textContent = dish.name;

      const tag = document.createElement('span');
      tag.className = 'dish-tag badge-veggie';
      tag.textContent = dish.tag;

      head.appendChild(name);
      head.appendChild(tag);

      const count = document.createElement('div');
      count.className = 'dish-stat-count';
      count.textContent = `${dish.count}x`;

      box.appendChild(head);
      box.appendChild(count);
      dishesGrid.appendChild(box);
    });
  }

  function renderGuestsTable() {
    guestsTableBody.replaceChildren();

    if (!overviewData || !overviewData.guests) return;

    const filtered = overviewData.guests.filter(g => {
      // Status filter
      if (currentFilter !== 'all' && g.status !== currentFilter) {
        return false;
      }
      // Search term
      if (searchTerm) {
        const matchesName = g.name.toLowerCase().includes(searchTerm);
        const matchesCode = g.code.toLowerCase().includes(searchTerm);
        const matchesPersons = g.attendees.some(a => a.name.toLowerCase().includes(searchTerm));
        if (!matchesName && !matchesCode && !matchesPersons) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      const emptyRow = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.style.textAlign = 'center';
      td.style.padding = '2rem';
      td.textContent = 'Keine Gäste für diesen Filter gefunden.';
      emptyRow.appendChild(td);
      guestsTableBody.appendChild(emptyRow);
      return;
    }

    filtered.forEach(g => {
      const row = document.createElement('tr');

      // 1. Code
      const tdCode = document.createElement('td');
      const codeSpan = document.createElement('span');
      codeSpan.className = 'badge-code';
      codeSpan.textContent = g.code;
      tdCode.appendChild(codeSpan);

      // 2. Name & Group
      const tdName = document.createElement('td');
      const nameDiv = document.createElement('div');
      nameDiv.style.fontWeight = '600';
      nameDiv.textContent = g.name;
      tdName.appendChild(nameDiv);

      // 3. Status
      const tdStatus = document.createElement('td');
      const statusPill = document.createElement('span');
      statusPill.className = `status-pill status-${g.status}`;
      if (g.status === 'attending') {
        statusPill.textContent = '✓ Zugesagt';
      } else if (g.status === 'declined') {
        statusPill.textContent = '✕ Abgesagt';
      } else {
        statusPill.textContent = '⏱ Offen';
      }
      tdStatus.appendChild(statusPill);

      // 4. Persons Count & Names
      const tdPersons = document.createElement('td');
      if (g.status === 'attending') {
        const pCount = document.createElement('div');
        pCount.style.fontWeight = '600';
        pCount.textContent = `${g.attendees.length} Person(en)`;

        const pList = document.createElement('div');
        pList.style.fontSize = '0.8rem';
        pList.style.color = 'var(--admin-text-muted)';
        pList.textContent = g.attendees.map(a => a.name).join(', ');

        tdPersons.appendChild(pCount);
        tdPersons.appendChild(pList);
      } else {
        tdPersons.textContent = '-';
      }

      // 5. Comment
      const tdComment = document.createElement('td');
      tdComment.style.maxWidth = '250px';
      tdComment.style.whiteSpace = 'nowrap';
      tdComment.style.overflow = 'hidden';
      tdComment.style.textOverflow = 'ellipsis';
      tdComment.textContent = g.comment || '-';

      // 6. Actions
      const tdActions = document.createElement('td');
      const btnView = document.createElement('button');
      btnView.type = 'button';
      btnView.className = 'btn-admin btn-admin-secondary btn-sm';
      btnView.textContent = 'Details';
      btnView.addEventListener('click', () => openGuestDetails(g));
      tdActions.appendChild(btnView);

      row.appendChild(tdCode);
      row.appendChild(tdName);
      row.appendChild(tdStatus);
      row.appendChild(tdPersons);
      row.appendChild(tdComment);
      row.appendChild(tdActions);

      guestsTableBody.appendChild(row);
    });
  }

  function openGuestDetails(g) {
    modalBody.replaceChildren();

    const title = document.createElement('h3');
    title.textContent = g.name;
    modalBody.appendChild(title);

    const codeInfo = document.createElement('p');
    codeInfo.style.marginBottom = '1.2rem';
    codeInfo.textContent = `Code: ${g.code} | Status: ${g.status.toUpperCase()}`;
    modalBody.appendChild(codeInfo);

    if (g.status === 'attending') {
      const attTitle = document.createElement('h4');
      attTitle.textContent = `Angemeldete Personen (${g.attendees.length}):`;
      modalBody.appendChild(attTitle);

      const attList = document.createElement('div');
      attList.style.display = 'flex';
      attList.style.flexDirection = 'column';
      attList.style.gap = '0.8rem';
      attList.style.margin = '0.8rem 0 1.5rem';

      g.attendees.forEach((a, i) => {
        const item = document.createElement('div');
        item.style.padding = '0.8rem';
        item.style.background = '#F8FAFC';
        item.style.borderRadius = '6px';
        item.style.border = '1px solid #E2E8F0';

        const pName = document.createElement('div');
        pName.style.fontWeight = '700';
        pName.textContent = `${i + 1}. ${a.name}`;

        const pDish = document.createElement('div');
        pDish.style.fontSize = '0.85rem';
        pDish.textContent = `Gericht: ${a.dishId || 'Keine Angabe'}`;

        item.appendChild(pName);
        item.appendChild(pDish);

        if (a.dietaryNotes) {
          const pDiet = document.createElement('div');
          pDiet.style.fontSize = '0.85rem';
          pDiet.style.color = '#B45309';
          pDiet.textContent = `⚠️ Allergien / Unverträglichkeiten: ${a.dietaryNotes}`;
          item.appendChild(pDiet);
        }

        attList.appendChild(item);
      });

      modalBody.appendChild(attList);
    }

    if (g.comment) {
      const commTitle = document.createElement('h4');
      commTitle.textContent = 'Nachricht an das Brautpaar:';
      modalBody.appendChild(commTitle);

      const commBox = document.createElement('blockquote');
      commBox.style.fontStyle = 'italic';
      commBox.style.padding = '0.8rem';
      commBox.style.background = '#FAF7F2';
      commBox.style.borderLeft = '4px solid var(--admin-primary)';
      commBox.style.margin = '0.5rem 0 1.5rem';
      commBox.textContent = g.comment;
      modalBody.appendChild(commBox);
    }

    // Direct guest URL for testing / preview
    const linkPara = document.createElement('p');
    linkPara.style.fontSize = '0.85rem';
    const link = document.createElement('a');
    link.href = `/?code=${encodeURIComponent(g.code)}`;
    link.target = '_blank';
    link.textContent = '🔗 Gästeseite direkt im neuen Tab öffnen';
    linkPara.appendChild(link);
    modalBody.appendChild(linkPara);

    modalOverlay.style.display = 'flex';
  }

  async function loadQRCodes() {
    qrGrid.replaceChildren();
    const loading = document.createElement('p');
    loading.textContent = 'Lade QR-Codes...';
    qrGrid.appendChild(loading);

    try {
      const res = await apiFetch('admin/qrcodes');
      const data = await res.json();
      qrGrid.replaceChildren();

      data.qrList.forEach(item => {
        const card = document.createElement('div');
        card.className = 'qr-card';

        const name = document.createElement('div');
        name.className = 'qr-guest-name';
        name.textContent = item.name;

        const code = document.createElement('div');
        code.className = 'qr-guest-code';
        code.textContent = item.code;

        const img = document.createElement('img');
        img.src = item.qrDataUrl;
        img.alt = `QR Code für ${item.name}`;

        const downloadLink = document.createElement('a');
        downloadLink.href = item.qrDataUrl;
        downloadLink.download = `QR_${item.code}.png`;
        downloadLink.className = 'btn-admin btn-admin-secondary btn-sm';
        downloadLink.textContent = 'Download PNG';

        card.appendChild(name);
        card.appendChild(code);
        card.appendChild(img);
        card.appendChild(downloadLink);

        qrGrid.appendChild(card);
      });
    } catch (err) {
      qrGrid.textContent = 'Fehler beim Laden der QR-Codes';
    }
  }
});
