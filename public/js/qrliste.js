/**
 * Druckbare Liste aller Einladungen/Gruppen mit QR-Code und Login-Code.
 */
document.addEventListener('DOMContentLoaded', () => {
  let apiMode = 'auto';
  let toastTimer = null;

  const els = {
    loading: document.getElementById('qr-loading'),
    app: document.getElementById('qr-app'),
    sheet: document.getElementById('qr-sheet'),
    summary: document.getElementById('qr-summary'),
    print: document.getElementById('btn-print-qr'),
    logout: document.getElementById('btn-admin-logout'),
    toast: document.getElementById('qr-toast')
  };

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
    window.location.replace(`admin.html?return=${encodeURIComponent('qrliste.html')}`);
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

  async function load() {
    try {
      const [groupsResponse, qrResponse] = await Promise.all([
        apiFetch('admin/groups'),
        apiFetch('admin/qrcodes')
      ]);
      if (groupsResponse.status === 401 || qrResponse.status === 401) {
        goToLogin();
        return;
      }
      if (!groupsResponse.ok) throw new Error('Die Einladungen konnten nicht geladen werden.');

      const groupData = await groupsResponse.json();
      const groups = Array.isArray(groupData.groups) ? groupData.groups : [];
      const qrMap = new Map();
      if (qrResponse.ok) {
        const qrData = await qrResponse.json();
        for (const item of (qrData.qrList || [])) {
          qrMap.set(String(item.code).toLowerCase(), item);
        }
      }

      render(groups, qrMap);
      els.loading.style.display = 'none';
      els.app.style.display = 'block';
    } catch (error) {
      els.loading.textContent = error.message || 'QR-Liste konnte nicht geladen werden.';
      showToast(error.message || 'QR-Liste konnte nicht geladen werden.', true);
    }
  }

  function render(groups, qrMap) {
    els.sheet.replaceChildren();
    const totalPersons = groups.reduce((sum, group) => sum + (group.personCount || 0), 0);
    els.summary.textContent = `${groups.length} Einladungen · ${totalPersons} Personen`;

    for (const group of groups) {
      const card = document.createElement('article');
      card.className = 'qr-sheet-card';

      const qr = qrMap.get(String(group.code).toLowerCase());
      if (qr && qr.qrDataUrl) {
        const img = document.createElement('img');
        img.src = qr.qrDataUrl;
        img.alt = `QR-Code für ${group.name}`;
        card.appendChild(img);
      }

      const info = document.createElement('div');
      info.className = 'qr-sheet-info';

      const name = document.createElement('h3');
      name.textContent = group.name;
      info.appendChild(name);

      const code = document.createElement('code');
      code.className = 'qr-sheet-code';
      code.textContent = group.code;
      info.appendChild(code);

      const persons = document.createElement('div');
      persons.className = 'qr-sheet-persons';
      if (group.persons && group.persons.length) {
        for (const person of group.persons) {
          const wrapper = document.createElement('span');
          wrapper.textContent = person.name;
          if (person.child) {
            const child = document.createElement('span');
            child.className = 'people-child-badge';
            child.textContent = 'Kind';
            wrapper.appendChild(child);
          }
          persons.appendChild(wrapper);
        }
      } else {
        persons.textContent = 'Noch keine Personen zugeordnet';
      }
      info.appendChild(persons);

      card.appendChild(info);
      els.sheet.appendChild(card);
    }
  }

  function showToast(message, isError = false) {
    els.toast.textContent = message;
    els.toast.classList.toggle('error', isError);
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4000);
  }

  els.print.addEventListener('click', () => window.print());
  els.logout.addEventListener('click', async () => {
    try { await apiFetch('admin/logout', { method: 'POST' }); } catch (error) { /* ignorieren */ }
    window.location.href = 'admin.html';
  });

  (async () => {
    if (await checkAuth()) await load();
  })();
});
