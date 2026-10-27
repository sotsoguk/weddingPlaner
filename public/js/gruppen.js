/**
 * Gruppen / Einladungen mit lesbaren Login-Codes und QR-Codes.
 */
document.addEventListener('DOMContentLoaded', () => {
  let apiMode = 'auto';
  let groups = [];
  let qrByCode = new Map();
  let toastTimer = null;
  let editingCode = null;

  const els = {
    loading: document.getElementById('groups-loading'),
    app: document.getElementById('groups-app'),
    logout: document.getElementById('btn-admin-logout'),
    refresh: document.getElementById('btn-refresh-groups'),
    form: document.getElementById('group-form'),
    name: document.getElementById('group-name'),
    max: document.getElementById('group-max'),
    result: document.getElementById('group-result'),
    table: document.getElementById('groups-table-body'),
    modal: document.getElementById('group-modal-overlay'),
    modalClose: document.getElementById('group-modal-close'),
    editForm: document.getElementById('group-edit-form'),
    editCode: document.getElementById('edit-group-code'),
    editName: document.getElementById('edit-group-name'),
    editMax: document.getElementById('edit-group-max'),
    editError: document.getElementById('group-edit-error'),
    editCancel: document.getElementById('group-edit-cancel'),
    toast: document.getElementById('groups-toast')
  };

  const STATUS_LABELS = { attending: 'Zugesagt', pending: 'Offen', declined: 'Abgesagt' };
  const STATUS_CLASS = { attending: 'status-attending', pending: 'status-pending', declined: 'status-declined' };

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
    window.location.replace(`admin.html?return=${encodeURIComponent('gruppen.html')}`);
  }

  async function checkAuth() {
    try {
      const response = await apiFetch('admin/check');
      if (!response.ok) { goToLogin(); return false; }
      return true;
    } catch (error) {
      goToLogin();
      return false;
    }
  }

  async function loadData() {
    try {
      const [groupsResponse, qrResponse] = await Promise.all([
        apiFetch('admin/groups'),
        apiFetch('admin/qrcodes')
      ]);
      if (groupsResponse.status === 401 || qrResponse.status === 401) {
        goToLogin();
        return;
      }
      if (!groupsResponse.ok) throw new Error('Gruppen konnten nicht geladen werden.');

      const groupData = await groupsResponse.json();
      groups = Array.isArray(groupData.groups) ? groupData.groups : [];
      qrByCode = new Map();

      if (qrResponse.ok) {
        const qrData = await qrResponse.json();
        for (const item of (qrData.qrList || [])) {
          qrByCode.set(String(item.code).toLowerCase(), item);
        }
      }

      renderTable();
      els.loading.style.display = 'none';
      els.app.style.display = 'block';
    } catch (error) {
      els.loading.textContent = error.message || 'Gruppen konnten nicht geladen werden.';
      showToast(error.message || 'Gruppen konnten nicht geladen werden.', true);
    }
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || 'Offen';
  }

  function renderTable() {
    els.table.replaceChildren();

    if (!groups.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.className = 'people-empty';
      cell.textContent = 'Noch keine Gruppen vorhanden. Lege oben die erste Einladung an.';
      row.appendChild(cell);
      els.table.appendChild(row);
      return;
    }

    for (const group of groups) {
      const row = document.createElement('tr');
      const status = ['attending', 'declined'].includes(group.status) ? group.status : 'pending';

      const tdGroup = document.createElement('td');
      const name = document.createElement('div');
      name.className = 'people-name';
      name.textContent = group.name;
      tdGroup.appendChild(name);

      const tdCode = document.createElement('td');
      const code = document.createElement('span');
      code.className = 'group-code';
      code.textContent = group.code;
      code.title = 'Login-Code';
      tdCode.appendChild(code);
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'mini-copy';
      copy.textContent = 'Kopieren';
      copy.addEventListener('click', () => copyCode(group.code));
      tdCode.appendChild(copy);

      const tdStatus = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = `status-pill ${STATUS_CLASS[status]}`;
      pill.textContent = statusLabel(status);
      tdStatus.appendChild(pill);

      const tdPersons = document.createElement('td');
      tdPersons.className = 'group-persons';
      if (group.persons && group.persons.length) {
        const count = document.createElement('div');
        count.className = 'group-person-count';
        count.textContent = `${group.personCount} ${group.personCount === 1 ? 'Person' : 'Personen'}${group.childCount ? ` · ${group.childCount} Kind${group.childCount === 1 ? '' : 'er'}` : ''}`;
        tdPersons.appendChild(count);
        const names = document.createElement('div');
        names.className = 'people-submeta';
        names.textContent = group.persons.map((person) => person.name).join(', ');
        tdPersons.appendChild(names);
      } else {
        tdPersons.textContent = '—';
      }

      const tdQr = document.createElement('td');
      const qr = qrByCode.get(String(group.code).toLowerCase());
      if (qr && qr.qrDataUrl) {
        const img = document.createElement('img');
        img.className = 'group-qr';
        img.src = qr.qrDataUrl;
        img.alt = `QR-Code für ${group.name}`;
        img.loading = 'lazy';
        tdQr.appendChild(img);
      } else {
        tdQr.textContent = '—';
      }

      const tdActions = document.createElement('td');
      tdActions.className = 'people-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn-admin btn-admin-secondary btn-sm';
      edit.textContent = 'Bearbeiten';
      edit.addEventListener('click', () => openEdit(group));
      const regenerate = document.createElement('button');
      regenerate.type = 'button';
      regenerate.className = 'btn-admin btn-admin-danger btn-sm';
      regenerate.textContent = 'Code erneuern';
      regenerate.addEventListener('click', () => regenerateCode(group));
      tdActions.appendChild(edit);
      tdActions.appendChild(regenerate);

      row.appendChild(tdGroup);
      row.appendChild(tdCode);
      row.appendChild(tdStatus);
      row.appendChild(tdPersons);
      row.appendChild(tdQr);
      row.appendChild(tdActions);
      els.table.appendChild(row);
    }
  }

  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      showToast(`Code „${code}“ kopiert.`);
    } catch (error) {
      window.prompt('Login-Code kopieren:', code);
    }
  }

  async function createGroup(event) {
    event.preventDefault();
    const payload = {
      name: els.name.value.trim(),
      maxPersons: Number(els.max.value)
    };
    if (!payload.name) {
      els.name.focus();
      return;
    }

    try {
      const response = await apiFetch('admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.status === 401) { goToLogin(); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Gruppe konnte nicht angelegt werden.');

      els.form.reset();
      els.max.value = '2';
      els.result.hidden = false;
      els.result.innerHTML = '';
      const text = document.createElement('div');
      text.textContent = 'Neue Einladung angelegt. Login-Code:';
      const code = document.createElement('code');
      code.className = 'group-code result-code';
      code.textContent = data.code;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'mini-copy';
      copy.textContent = 'Kopieren';
      copy.addEventListener('click', () => copyCode(data.code));
      els.result.appendChild(text);
      els.result.appendChild(code);
      els.result.appendChild(copy);
      showToast('Gruppe angelegt.');
      await loadData();
    } catch (error) {
      showToast(error.message || 'Gruppe konnte nicht angelegt werden.', true);
    }
  }

  async function regenerateCode(group) {
    const confirmed = window.confirm(
      `Neuen Login-Code für „${group.name}“ erzeugen?\n\n` +
      'Der bisherige Code und alle bereits gedruckten QR-Codes werden ungültig. ' +
      'Bereits abgegebene RSVP-Antworten bleiben erhalten und werden auf den neuen Code übertragen.'
    );
    if (!confirmed) return;

    try {
      const response = await apiFetch(`admin/groups/${encodeURIComponent(group.code)}/generate-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (response.status === 401) { goToLogin(); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Code konnte nicht erzeugt werden.');
      showToast(`Neuer Login-Code: ${data.code}`);
      els.result.hidden = false;
      els.result.textContent = `Neuer Login-Code für ${group.name}: ${data.code}`;
      await loadData();
    } catch (error) {
      showToast(error.message || 'Code konnte nicht erzeugt werden.', true);
    }
  }

  function openEdit(group) {
    editingCode = group.code;
    els.editCode.value = group.code;
    els.editName.value = group.name;
    els.editMax.value = String(group.maxPersons || 2);
    els.editError.style.display = 'none';
    els.modal.style.display = 'flex';
    setTimeout(() => els.editName.focus(), 20);
  }

  function closeEdit() {
    els.modal.style.display = 'none';
    editingCode = null;
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editingCode) return;
    const payload = {
      name: els.editName.value.trim(),
      maxPersons: Number(els.editMax.value)
    };
    if (!payload.name) {
      els.editError.textContent = 'Bitte einen Einladungsnamen eingeben.';
      els.editError.style.display = 'block';
      return;
    }

    try {
      const response = await apiFetch(`admin/groups/${encodeURIComponent(editingCode)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.status === 401) { goToLogin(); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Gruppe konnte nicht gespeichert werden.');
      closeEdit();
      showToast('Gruppe aktualisiert.');
      await loadData();
    } catch (error) {
      els.editError.textContent = error.message || 'Gruppe konnte nicht gespeichert werden.';
      els.editError.style.display = 'block';
    }
  }

  function showToast(message, isError = false) {
    els.toast.textContent = message;
    els.toast.classList.toggle('error', isError);
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4500);
  }

  els.form.addEventListener('submit', createGroup);
  els.refresh.addEventListener('click', loadData);
  els.modalClose.addEventListener('click', closeEdit);
  els.editCancel.addEventListener('click', closeEdit);
  els.editForm.addEventListener('submit', saveEdit);
  els.modal.addEventListener('click', (event) => {
    if (event.target === els.modal) closeEdit();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.modal.style.display !== 'none') closeEdit();
  });
  els.logout.addEventListener('click', async () => {
    try { await apiFetch('admin/logout', { method: 'POST' }); } catch (error) { /* ignorieren */ }
    window.location.href = 'admin.html';
  });

  (async () => {
    if (await checkAuth()) await loadData();
  })();
});
