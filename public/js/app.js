/**
 * Hochzeits-Webapp Bert & Bine - Client Application Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  // State
  let currentGuest = null;
  let menuData = null;
  let attendeesList = [];
  let apiMode = 'auto'; // 'auto', 'api', or 'php'

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
        // Fallback to api.php for webspaces without mod_rewrite
        apiMode = 'php';
        url = `api.php?route=${encodeURIComponent(clean)}`;
        res = await fetch(url, options);
      } else if (res.ok && apiMode === 'auto') {
        apiMode = 'api';
      }
      return res;
    } catch (e) {
      if (apiMode === 'auto') {
        apiMode = 'php';
        return await fetch(`api.php?route=${encodeURIComponent(clean)}`, options);
      }
      throw e;
    }
  }

  async function readJsonResponse(res, fallbackMessage) {
    try {
      return await res.json();
    } catch (error) {
      throw new Error(fallbackMessage || 'Die Antwort des Servers war ungültig. Bitte versuche es erneut.');
    }
  }

  function germanErrorMessage(error) {
    const message = String((error && error.message) || '');
    if (/failed to fetch|networkerror|load failed|unexpected token|not valid json/i.test(message)) {
      return 'Der Server ist momentan nicht erreichbar. Bitte prüfe deine Verbindung und versuche es erneut.';
    }
    return message || 'Es ist ein Fehler aufgetreten. Bitte versuche es erneut.';
  }

  // DOM Elements
  const codeStep = document.getElementById('rsvp-code-step');
  const formStep = document.getElementById('rsvp-form-step');
  const successStep = document.getElementById('rsvp-success-step');
  
  const codeInput = document.getElementById('guest-code-input');
  const codeSubmitBtn = document.getElementById('btn-check-code');
  const codeError = document.getElementById('code-error');

  const guestNameHeading = document.getElementById('guest-name-heading');
  const guestCodeBadge = document.getElementById('guest-code-badge');
  const existingStatusAlert = document.getElementById('existing-status-alert');

  const radioAttending = document.getElementById('status-attending');
  const radioDeclined = document.getElementById('status-declined');
  const attendingDetailsBox = document.getElementById('attending-details-box');
  const declinedDetailsBox = document.getElementById('declined-details-box');

  const attendeesContainer = document.getElementById('attendees-container');
  const btnAddAttendee = document.getElementById('btn-add-attendee');
  const commentInput = document.getElementById('rsvp-comment');
  const rsvpForm = document.getElementById('rsvp-main-form');
  const btnSubmitRsvp = document.getElementById('btn-submit-rsvp');
  const formError = document.getElementById('form-error');

  const successTitle = document.getElementById('success-title');
  const successMessage = document.getElementById('success-message');
  const btnEditRsvp = document.getElementById('btn-edit-rsvp');

  // Load Menu and Wedding Config
  loadMenu();
  initCountdown();

  // Check URL query param ?code=...
  const urlParams = new URLSearchParams(window.location.search);
  const codeFromUrl = urlParams.get('code');
  if (codeFromUrl) {
    codeInput.value = codeFromUrl.trim();
    checkGuestCode(codeFromUrl.trim());
  }

  // Code input submit listener
  codeSubmitBtn.addEventListener('click', () => {
    const code = codeInput.value.trim();
    if (!code) {
      showCodeError('Bitte gib deinen persönlichen Code ein.');
      return;
    }
    checkGuestCode(code);
  });

  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      codeSubmitBtn.click();
    }
  });

  // Decision radio toggle listeners
  radioAttending.addEventListener('change', () => {
    if (radioAttending.checked) {
      attendingDetailsBox.style.display = 'block';
      declinedDetailsBox.style.display = 'none';
      btnSubmitRsvp.textContent = 'Zusage verbindlich absenden 🎉';
    }
  });

  radioDeclined.addEventListener('change', () => {
    if (radioDeclined.checked) {
      attendingDetailsBox.style.display = 'none';
      declinedDetailsBox.style.display = 'block';
      btnSubmitRsvp.textContent = 'Absage übermitteln';
    }
  });

  // Add attendee button
  btnAddAttendee.addEventListener('click', () => {
    addAttendeeRow();
  });

  // Form submit handler
  rsvpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideFormError();

    if (!currentGuest) {
      showFormError('Kein gültiger Gast geladen. Bitte lade die Seite neu.');
      return;
    }

    const isAttending = radioAttending.checked;
    const isDeclined = radioDeclined.checked;

    if (!isAttending && !isDeclined) {
      showFormError('Bitte wähle aus, ob ihr kommen könnt oder leider absagen müsst.');
      return;
    }

    const payload = {
      code: currentGuest.code,
      status: isAttending ? 'attending' : 'declined',
      comment: commentInput.value.trim(),
      attendees: []
    };

    if (isAttending) {
      // Collect attendee inputs
      const cards = attendeesContainer.querySelectorAll('.attendee-card');
      if (cards.length === 0) {
        showFormError('Bitte gib mindestens eine teilnehmende Person an.');
        return;
      }

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const nameInput = card.querySelector('.attendee-name-input');
        const dietaryInput = card.querySelector('.attendee-dietary-input');
        const selectedDish = card.querySelector('input[type="radio"]:checked');

        const name = nameInput ? nameInput.value.trim() : '';
        if (!name) {
          showFormError(`Bitte gib den Namen für Person ${i + 1} an.`);
          nameInput.focus();
          return;
        }

        payload.attendees.push({
          name: name,
          dishId: selectedDish ? selectedDish.value : null,
          dietaryNotes: dietaryInput ? dietaryInput.value.trim() : ''
        });
      }
    }

    // Submit to server
    btnSubmitRsvp.disabled = true;
    btnSubmitRsvp.textContent = 'Wird gespeichert...';

    try {
      const res = await apiFetch('rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await readJsonResponse(res, 'Die Rückmeldung konnte nicht gelesen werden. Bitte versuche es erneut.');
      if (!res.ok) {
        throw new Error(data.error || 'Fehler beim Speichern der Rückmeldung.');
      }

      // Show success screen
      formStep.style.display = 'none';
      successStep.style.display = 'block';
      
      successTitle.textContent = isAttending ? 'Wir freuen uns riesig auf euch! 🎉' : 'Vielen Dank für deine Rückmeldung';
      successMessage.textContent = data.message;

      // Update URL without reloading to keep code bookmarkable
      const newUrl = window.location.pathname + '?code=' + encodeURIComponent(currentGuest.code);
      window.history.replaceState({ code: currentGuest.code }, '', newUrl);

      // Scroll to RSVP section
      document.getElementById('rsvp').scrollIntoView({ behavior: 'smooth' });

    } catch (err) {
      showFormError(germanErrorMessage(err));
    } finally {
      btnSubmitRsvp.disabled = false;
      btnSubmitRsvp.textContent = isAttending ? 'Zusage verbindlich absenden 🎉' : 'Absage übermitteln';
    }
  });

  // Re-edit RSVP after success
  btnEditRsvp.addEventListener('click', () => {
    successStep.style.display = 'none';
    formStep.style.display = 'block';
    // Re-fetch to have latest data
    if (currentGuest) {
      checkGuestCode(currentGuest.code);
    }
  });

  // ----------------------------------------------------
  // Helpers
  // ----------------------------------------------------

  async function loadMenu() {
    try {
      const res = await apiFetch('menu');
      if (res.ok) {
        menuData = await res.json();
      }
    } catch (e) {
      console.error('Menu load error:', e);
    }
  }

  async function checkGuestCode(code) {
    hideCodeError();
    codeSubmitBtn.disabled = true;
    codeSubmitBtn.textContent = 'Prüfe...';

    try {
      const res = await apiFetch(`guest/${encodeURIComponent(code)}`);
      const data = await readJsonResponse(res, 'Der Gästecode konnte nicht geprüft werden. Bitte prüfe deine Verbindung und versuche es erneut.');

      if (!res.ok) {
        throw new Error(data.error || 'Gästecode nicht gefunden.');
      }

      currentGuest = data;
      renderGuestForm(data);

      codeStep.style.display = 'none';
      formStep.style.display = 'block';
      successStep.style.display = 'none';

      // Scroll smoothly to form
      document.getElementById('rsvp').scrollIntoView({ behavior: 'smooth' });

    } catch (err) {
      showCodeError(germanErrorMessage(err));
    } finally {
      codeSubmitBtn.disabled = false;
      codeSubmitBtn.textContent = 'Weiter';
    }
  }

  function renderGuestForm(guest) {
    guestNameHeading.textContent = `Liebe/r ${guest.name}`;
    guestCodeBadge.textContent = `Code: ${guest.code}`;

    // Reset attendees
    attendeesContainer.replaceChildren();
    attendeesList = [];

    const seenNames = new Set();
    const addPrefilled = (name, dishId = null, dietaryNotes = '') => {
      const cleaned = String(name || '').trim();
      if (!cleaned) return;
      const key = cleaned.toLocaleLowerCase('de-DE');
      if (seenNames.has(key)) return;
      seenNames.add(key);
      addAttendeeRow(cleaned, dishId, dietaryNotes);
    };

    const groupPeople = Array.isArray(guest.people) ? guest.people : [];
    const existingAttendees = guest.rsvp && Array.isArray(guest.rsvp.attendees)
      ? guest.rsvp.attendees
      : [];

    if (guest.rsvp) {
      // Existing response
      existingStatusAlert.style.display = 'flex';
      const statusText = guest.rsvp.status === 'attending' ? 'Zugesagt' : 'Abgesagt';
      existingStatusAlert.textContent = `Du hast bereits geantwortet (${statusText}). Du kannst deine Angaben hier jederzeit bearbeiten.`;

      if (guest.rsvp.status === 'attending') {
        radioAttending.checked = true;
        attendingDetailsBox.style.display = 'block';
        declinedDetailsBox.style.display = 'none';
        btnSubmitRsvp.textContent = 'Änderungen speichern 🎉';
      } else {
        radioDeclined.checked = true;
        attendingDetailsBox.style.display = 'none';
        declinedDetailsBox.style.display = 'block';
        btnSubmitRsvp.textContent = 'Änderungen speichern';
      }

      // Erst die gespeicherte Antwort, danach noch nicht enthaltene Gruppenpersonen ergänzen.
      existingAttendees.forEach((att) => {
        addPrefilled(att.name, att.dishId, att.dietaryNotes);
      });
      groupPeople.forEach((person) => {
        addPrefilled(person.name);
      });
      if (!attendeesContainer.children.length) addPrefilled(guest.name);

      commentInput.value = guest.rsvp.comment || '';
    } else {
      // Fresh new RSVP
      existingStatusAlert.style.display = 'none';
      radioAttending.checked = true;
      attendingDetailsBox.style.display = 'block';
      declinedDetailsBox.style.display = 'none';
      btnSubmitRsvp.textContent = 'Zusage verbindlich absenden 🎉';
      commentInput.value = '';

      // Alle in der Personenverwaltung angelegten Gruppenpersonen vorbelegen.
      groupPeople.forEach((person) => addPrefilled(person.name));
      if (!attendeesContainer.children.length) addPrefilled(guest.name);
    }
  }

  function addAttendeeRow(name = '', selectedDishId = null, dietaryNotes = '') {
    const index = attendeesContainer.children.length + 1;
    const card = document.createElement('div');
    card.className = 'attendee-card';

    // Header
    const header = document.createElement('div');
    header.className = 'attendee-card-header';

    const title = document.createElement('div');
    title.className = 'attendee-card-title';
    title.textContent = `Person ${index}`;

    header.appendChild(title);

    // Only allow removing if more than 1 attendee
    if (index > 1) {
      const btnRemove = document.createElement('button');
      btnRemove.type = 'button';
      btnRemove.className = 'btn-remove-attendee';
      btnRemove.textContent = '✕ Entfernen';
      btnRemove.addEventListener('click', () => {
        card.remove();
        renumberAttendees();
      });
      header.appendChild(btnRemove);
    }

    card.appendChild(header);

    // Name Input
    const nameGroup = document.createElement('div');
    nameGroup.className = 'form-group';

    const nameLabel = document.createElement('label');
    nameLabel.className = 'form-label';
    nameLabel.textContent = 'Vor- und Nachname *';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'form-input attendee-name-input';
    nameInput.placeholder = 'z.B. Max Mustermann';
    nameInput.required = true;
    nameInput.value = name;

    nameGroup.appendChild(nameLabel);
    nameGroup.appendChild(nameInput);
    card.appendChild(nameGroup);

    // Food selection (from menuData)
    if (menuData && menuData.mains && menuData.mains.length > 0) {
      const foodGroup = document.createElement('div');
      foodGroup.className = 'form-group';

      const foodLabel = document.createElement('label');
      foodLabel.className = 'form-label';
      foodLabel.textContent = 'Gewünschte Hauptspeise:';

      const foodGrid = document.createElement('div');
      foodGrid.className = 'menu-options-grid';

      const radioGroupName = `dish_choice_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 5)}`;

      menuData.mains.forEach((dish, dIdx) => {
        const dishOption = document.createElement('label');
        dishOption.className = 'dish-option';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = radioGroupName;
        radio.value = dish.id;
        // Pre-select if matches or first dish default
        if (selectedDishId) {
          if (selectedDishId === dish.id) radio.checked = true;
        } else if (dIdx === 0) {
          radio.checked = true;
        }

        const dishCard = document.createElement('div');
        dishCard.className = 'dish-card';

        const dishHead = document.createElement('div');
        dishHead.className = 'dish-card-header';

        const dishTitle = document.createElement('div');
        dishTitle.className = 'dish-name';
        dishTitle.textContent = `${dish.icon || ''} ${dish.name}`;

        const dishBadge = document.createElement('span');
        dishBadge.className = `dish-tag ${dish.badgeClass || 'badge-veggie'}`;
        dishBadge.textContent = dish.tag;

        dishHead.appendChild(dishTitle);
        dishHead.appendChild(dishBadge);

        const dishDesc = document.createElement('div');
        dishDesc.className = 'dish-desc';
        dishDesc.textContent = dish.description;

        dishCard.appendChild(dishHead);
        dishCard.appendChild(dishDesc);

        dishOption.appendChild(radio);
        dishOption.appendChild(dishCard);

        foodGrid.appendChild(dishOption);
      });

      foodGroup.appendChild(foodLabel);
      foodGroup.appendChild(foodGrid);
      card.appendChild(foodGroup);
    }

    // Dietary Notes Input
    const dietaryGroup = document.createElement('div');
    dietaryGroup.className = 'form-group';

    const dietaryLabel = document.createElement('label');
    dietaryLabel.className = 'form-label';
    dietaryLabel.textContent = 'Unverträglichkeiten, Allergien oder Anmerkungen (optional):';

    const dietaryInput = document.createElement('input');
    dietaryInput.type = 'text';
    dietaryInput.className = 'form-input attendee-dietary-input';
    dietaryInput.placeholder = 'z.B. laktosefrei, nussfrei, schwanger...';
    dietaryInput.value = dietaryNotes;

    dietaryGroup.appendChild(dietaryLabel);
    dietaryGroup.appendChild(dietaryInput);
    card.appendChild(dietaryGroup);

    attendeesContainer.appendChild(card);
  }

  function renumberAttendees() {
    const cards = attendeesContainer.querySelectorAll('.attendee-card');
    cards.forEach((card, idx) => {
      const title = card.querySelector('.attendee-card-title');
      if (title) {
        title.textContent = `Person ${idx + 1}`;
      }
    });
  }

  function showCodeError(msg) {
    codeError.textContent = msg;
    codeError.style.display = 'block';
  }

  function hideCodeError() {
    codeError.textContent = '';
    codeError.style.display = 'none';
  }

  function showFormError(msg) {
    formError.textContent = msg;
    formError.style.display = 'block';
    formError.scrollIntoView({ behavior: 'smooth' });
  }

  function hideFormError() {
    formError.textContent = '';
    formError.style.display = 'none';
  }

  // Simple Countdown to Wedding Date
  async function initCountdown() {
    let targetDate = new Date('2027-03-20T14:00:00').getTime();

    try {
      const res = await apiFetch('config');
      if (res.ok) {
        const cfg = await res.json();
        if (cfg.wedding && cfg.wedding.date) {
          targetDate = new Date(`${cfg.wedding.date}T14:00:00`).getTime();
        }
      }
    } catch (e) {
      // fallback to 2027-03-20
    }

    function update() {
      const now = new Date().getTime();
      const difference = targetDate - now;

      if (difference <= 0) {
        const d = document.getElementById('cd-days');
        const h = document.getElementById('cd-hours');
        const m = document.getElementById('cd-mins');
        if (d) d.textContent = '0';
        if (h) h.textContent = '0';
        if (m) m.textContent = '0';
        return;
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));

      const dElem = document.getElementById('cd-days');
      const hElem = document.getElementById('cd-hours');
      const mElem = document.getElementById('cd-mins');

      if (dElem) dElem.textContent = days.toString();
      if (hElem) hElem.textContent = hours.toString();
      if (mElem) mElem.textContent = minutes.toString();
    }

    update();
    setInterval(update, 60000);
  }
});
