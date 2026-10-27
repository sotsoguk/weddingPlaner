/**
 * Gemeinsame Personenliste – Admin
 */
document.addEventListener('DOMContentLoaded', () => {
  let apiMode = 'auto';
  let peopleData = { people: [], parties: [] };
  let filterStatus = 'all';
  let searchTerm = '';
  let toastTimer = null;

  const els = {
    loading: document.getElementById('people-loading'),
    app: document.getElementById('people-app'),
    logout: document.getElementById('btn-admin-logout'),
    summary: document.getElementById('people-summary'),
    search: document.getElementById('people-search'),
    tableBody: document.getElementById('people-table-body'),
    filters: document.querySelectorAll('.filter-btn'),
    refresh: document.getElementById('btn-refresh-people'),
    sync: document.getElementById('btn-sync-rsvp'),
    add: document.getElementById('btn-add-person'),
    modal: document.getElementById('person-modal-overlay'),
    modalClose: document.getElementById('person-modal-close'),
    modalTitle: document.getElementById('person-modal-title'),
    form: document.getElementById('person-form'),
    key: document.getElementById('person-key'),
    name: document.getElementById('person-name'),
    code: document.getElementById('person-code'),
    groupPreview: document.getElementById('person-group-preview'),
    refreshGroups: document.getElementById('btn-refresh-group-options'),
    child: document.getElementById('person-child'),
    error: document.getElementById('person-form-error'),
    cancel: document.getElementById('person-cancel'),
    toast: document.getElementById('people-toast')
  };

  const STATUS_LABELS = {
    attending: 'Zugesagt',
    pending: 'Offen',
    declined: 'Abgesagt'
  };

  function normalizeStatus(status) {
    return status === 'attending' || status === 'declined' ? status : 'pending';
  }

  async function apiFetch(endpoint, options = {}) {
    const clean = String(endpoint).replace(/^\/+/, '').replace(/^api\//, '');
    const opts = Object.assign({ credentials: 'same-origin' }, options);
    let url = apiMode === 'php'
      ? `api.php?route=${encodeURIComponent(clean)}`
      : `/api/${clean}`;
    const usingPhp = url.startsWith('api.php');

    try {
      let response = await fetch(url, opts);
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!usingPhp && (response.status === 404 || !contentType.includes('application/json'))) {
        apiMode = 'php';
        response = await fetch(`api.php?route=${encodeURIComponent(clean)}`, opts);
      } else if (response.ok && apiMode === 'auto') {
        apiMode = 'api';
      }
      return response;
    } catch (error) {
      if (apiMode === 'auto' || apiMode === 'api') {
        apiMode = 'php';
        return fetch(`api.php?route=${encodeURIComponent(clean)}`, opts);
      }
      throw error;
    }
  }

  function goToLogin() {
    window.location.replace(`admin.html?return=${encodeURIComponent('personen.html')}`);
  }

  async function checkAuth() {
    try {
      const response = await apiFetch('admin/check');
      if (!response.ok) {
        goToLogin();
        return false;
      }
      return true;
    } catch (error) {
      goToLogin();
      return false;
    }
  }

  async function loadPeople() {
    try {
      const response = await apiFetch('admin/people');
      if (response.status === 401) {
        goToLogin();
        return;
      }
      if (!response.ok) throw new Error('Personenliste konnte nicht geladen werden.');
      peopleData = await response.json();
      if (!Array.isArray(peopleData.people)) peopleData.people = [];
      if (!Array.isArray(peopleData.parties)) peopleData.parties = [];
      renderSummary();
      renderTable();
      renderCodeOptions();
      els.loading.style.display = 'none';
      els.app.style.display = 'block';
    } catch (error) {
      els.loading.textContent = error.message || 'Personenliste konnte nicht geladen werden.';
      showToast(error.message || 'Personenliste konnte nicht geladen werden.', true);
    }
  }

  function renderSummary() {
    const counts = { all: peopleData.people.length, attending: 0, pending: 0, declined: 0, children: 0 };
    for (const person of peopleData.people) {
      counts[normalizeStatus(person.status)] += 1;
      if (person.child) counts.children += 1;
    }
    els.summary.textContent =
      `${counts.all} ${counts.all === 1 ? 'Person' : 'Personen'} · ` +
      `${counts.attending} zugesagt · ${counts.pending} offen · ${counts.declined} abgesagt · ` +
      `${counts.children} ${counts.children === 1 ? 'Kind' : 'Kinder'}`;
  }

  function updateGroupPreview() {
    const party = peopleData.parties.find((item) => item.code === els.code.value);
    if (!party) {
      els.groupPreview.textContent = 'Keine Gruppe ausgewählt – die Person erscheint als „Offen“.';
      return;
    }
    els.groupPreview.textContent = `Einladung: ${party.name} · Status: ${STATUS_LABELS[normalizeStatus(party.status)]}`;
  }

  function renderCodeOptions() {
    const selected = els.code.value;
    els.code.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— keine Zuordnung —';
    els.code.appendChild(none);

    for (const party of peopleData.parties) {
      const option = document.createElement('option');
      option.value = party.code;
      option.textContent = `${party.code} · ${party.name}`;
      els.code.appendChild(option);
    }
    if (selected) els.code.value = selected;
    updateGroupPreview();
  }

  function renderTable() {
    els.tableBody.replaceChildren();
    const search = searchTerm.toLowerCase();
    const filtered = peopleData.people.filter((person) => {
      if (filterStatus !== 'all' && normalizeStatus(person.status) !== filterStatus) return false;
      if (!search) return true;
      return [person.name, person.rsvpCode, person.partyName, person.group, person.dishName, person.dietaryNotes]
        .some((value) => String(value || '').toLowerCase().includes(search));
    });

    if (!filtered.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.className = 'people-empty';
      cell.textContent = peopleData.people.length
        ? 'Keine Personen für diesen Filter.'
        : 'Noch keine Personen. Lege die erste Person über „+ Person“ an.';
      row.appendChild(cell);
      els.tableBody.appendChild(row);
      return;
    }

    for (const person of filtered) {
      const row = document.createElement('tr');
      const status = normalizeStatus(person.status);

      const tdStatus = document.createElement('td');
      const statusWrap = document.createElement('span');
      statusWrap.className = 'people-status';
      const dot = document.createElement('span');
      dot.className = `people-status-dot ${status}`;
      const statusText = document.createElement('span');
      statusText.className = `people-status-text ${status}`;
      statusText.textContent = STATUS_LABELS[status];
      statusWrap.appendChild(dot);
      statusWrap.appendChild(statusText);
      tdStatus.appendChild(statusWrap);

      const tdName = document.createElement('td');
      const name = document.createElement('div');
      name.className = 'people-name';
      name.textContent = person.name;
      if (person.child) {
        const child = document.createElement('span');
        child.className = 'people-child-badge';
        child.textContent = 'Kind';
        name.appendChild(child);
      }
      tdName.appendChild(name);

      const tdParty = document.createElement('td');
      if (person.rsvpCode) {
        const code = document.createElement('span');
        code.className = 'badge-code';
        code.textContent = person.rsvpCode;
        tdParty.appendChild(code);
        if (person.group || person.partyName) {
          const meta = document.createElement('div');
          meta.className = 'people-submeta';
          meta.textContent = person.partyName;
          tdParty.appendChild(meta);
        }
      } else {
        tdParty.textContent = '—';
      }

      const tdTable = document.createElement('td');
      tdTable.textContent = person.table
        ? `Tisch ${person.table.number} · Platz ${person.table.seatIndex}`
        : '—';

      const tdFood = document.createElement('td');
      const foodParts = [person.dishName, person.dietaryNotes ? `Hinweis: ${person.dietaryNotes}` : '']
        .filter(Boolean);
      tdFood.textContent = foodParts.join(' · ') || '—';
      tdFood.className = 'people-food';

      const tdActions = document.createElement('td');
      tdActions.className = 'people-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn-admin btn-admin-secondary btn-sm';
      edit.textContent = 'Bearbeiten';
      edit.addEventListener('click', () => openModal(person));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn-admin btn-admin-danger btn-sm';
      remove.textContent = 'Löschen';
      remove.addEventListener('click', () => deletePerson(person));
      tdActions.appendChild(edit);
      tdActions.appendChild(remove);

      row.appendChild(tdStatus);
      row.appendChild(tdName);
      row.appendChild(tdParty);
      row.appendChild(tdTable);
      row.appendChild(tdFood);
      row.appendChild(tdActions);
      els.tableBody.appendChild(row);
    }
  }

  function openModal(person = null) {
    els.form.reset();
    els.error.style.display = 'none';
    els.key.value = person ? person.key : '';
    els.modalTitle.textContent = person ? 'Person bearbeiten' : 'Person hinzufügen';
    els.name.value = person ? person.name : '';
    els.child.checked = !!(person && person.child);
    renderCodeOptions();
    els.code.value = person ? (person.rsvpCode || '') : '';
    updateGroupPreview();
    els.modal.style.display = 'flex';
    setTimeout(() => els.name.focus(), 20);
  }

  function closeModal() {
    els.modal.style.display = 'none';
  }

  async function savePerson(event) {
    event.preventDefault();
    const key = els.key.value;
    const name = els.name.value.trim();
    if (!name) {
      els.error.textContent = 'Bitte einen Namen eingeben.';
      els.error.style.display = 'block';
      return;
    }

    const payload = {
      name: name,
      child: els.child.checked,
      rsvpCode: els.code.value
    };

    try {
      const response = await apiFetch(key ? `admin/people/${encodeURIComponent(key)}` : 'admin/people', {
        method: key ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.status === 401) {
        goToLogin();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Person konnte nicht gespeichert werden.');
      closeModal();
      showToast(key ? 'Person wurde aktualisiert.' : 'Person wurde angelegt.');
      await loadPeople();
    } catch (error) {
      els.error.textContent = error.message || 'Person konnte nicht gespeichert werden.';
      els.error.style.display = 'block';
    }
  }

  async function deletePerson(person) {
    const assignment = person.table
      ? `\n\nAchtung: Die Person sitzt aktuell an Tisch ${person.table.number}, Platz ${person.table.seatIndex}. Der Platz wird frei.`
      : '';
    if (!window.confirm(`„${person.name}“ wirklich löschen?${assignment}`)) return;

    try {
      const response = await apiFetch(`admin/people/${encodeURIComponent(person.key)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      if (response.status === 401) {
        goToLogin();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Person konnte nicht gelöscht werden.');
      showToast('Person wurde gelöscht.');
      await loadPeople();
    } catch (error) {
      showToast(error.message || 'Person konnte nicht gelöscht werden.', true);
    }
  }

  async function syncRsvp() {
    els.sync.disabled = true;
    try {
      const response = await apiFetch('admin/people/sync-rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (response.status === 401) {
        goToLogin();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Synchronisierung fehlgeschlagen.');
      showToast(`${data.added || 0} neue Person(en) übernommen, ${data.updated || 0} aktualisiert.`);
      await loadPeople();
    } catch (error) {
      showToast(error.message || 'Synchronisierung fehlgeschlagen.', true);
    } finally {
      els.sync.disabled = false;
    }
  }

  function showToast(message, isError = false) {
    els.toast.textContent = message;
    els.toast.classList.toggle('error', isError);
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 4000);
  }

  els.code.addEventListener('change', updateGroupPreview);
  els.refreshGroups.addEventListener('click', async () => {
    await loadPeople();
    showToast('Gruppen und Personen wurden aktualisiert.');
  });

  els.search.addEventListener('input', () => {
    searchTerm = els.search.value.trim();
    renderTable();
  });

  els.filters.forEach((button) => {
    button.addEventListener('click', () => {
      els.filters.forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      filterStatus = button.dataset.status;
      renderTable();
    });
  });

  els.refresh.addEventListener('click', loadPeople);
  els.add.addEventListener('click', () => openModal());
  els.sync.addEventListener('click', syncRsvp);
  els.modalClose.addEventListener('click', closeModal);
  els.cancel.addEventListener('click', closeModal);
  els.form.addEventListener('submit', savePerson);

  els.modal.addEventListener('click', (event) => {
    if (event.target === els.modal) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.modal.style.display !== 'none') closeModal();
  });

  els.logout.addEventListener('click', async () => {
    try {
      await apiFetch('admin/logout', { method: 'POST' });
    } catch (error) { /* ignorieren */ }
    window.location.href = 'admin.html';
  });

  (async () => {
    if (await checkAuth()) {
      await loadPeople();
    }
  })();
});
