# Hochzeits-Webapp Bert & Bine – mit integriertem Tischplaner

Diese Version verbindet die bestehende RSVP-/Gästeverwaltung mit dem Tischplaner. Gästeliste, Personenverwaltung und Tischplan greifen auf denselben Server-Speicher zu.

## Neue Bereiche

- `/admin.html` – bisherige RSVP-, Catering- und Gästeübersicht
- `/personen.html` – gemeinsame Personenliste (Name, Kind, Einladung, Status, Tisch)
- `/planer/index.html` – Tischplaner mit serverseitiger Speicherung

Im Admin-Header gibt es direkte Links zu **Personen**, **Gruppen**, **Tischplan** und **QR-Liste**.

## Gruppen, Login-Codes und QR-Codes

Unter **`/gruppen.html`** werden Einladungen/Gruppen verwaltet:

- neue Einladung/Gruppe mit einem Namen (z. B. „Familie Dorn“) und max. Personenzahl anlegen
- automatisch generierter Login-Code aus drei deutschen Wörtern, z. B. `sonne-mond-stern`
- QR-Code direkt zur Gästeseite
- bestehende Codes können pro Gruppe neu erzeugt werden. Der alte Code und alte QR-Codes werden dadurch ungültig; vorhandene RSVP-Antworten und Personen werden auf den neuen Code übertragen.
- Name und max. Personenzahl lassen sich bearbeiten. Eine Einladung ist gleichzeitig die Gruppe; alle zugehörigen Personen werden darunter geführt.

Die Gästelogin-Seite akzeptiert sowohl die alten Codes (`GAST-001`) als auch die neuen lesbaren Codes. Die Code-Eingabe ist auf 60 Zeichen ausgelegt. In der Personenverwaltung vorab angelegte Gruppenpersonen werden im RSVP-Formular automatisch vorbelegt. Gäste können dort zusätzlich eigene Begleitpersonen hinzufügen.

Unter **`/qrliste.html`** liegt eine druckbare Liste aller Einladungen/Gruppen mit Login-Code, QR-Code und allen zugeordneten Personen. Über **„Drucken / als PDF speichern“** lässt sich daraus eine PDF-Datei erzeugen. Ein QR-Code gilt für die gesamte Einladung/Gruppe, da die Gäste sich mit dem Gruppen-Code anmelden und dort die teilnehmenden Personen eintragen.

## Gemeinsame Personenliste

Die Tabelle `people` ist die zentrale Personenliste für beide Bereiche. Jede Person hat:

- `name`
- `is_child`
- eine optionale Verknüpfung zu einem Einladungscode (`rsvp_code`)
- optional Gericht/Allergien aus der RSVP-Rückmeldung
- einen stabilen `person_key` für die Sitzplatz-Zuordnung

Der Status wird aus der zugehörigen Einladung abgeleitet:

- **Zugesagt** → grün
- **Offen** (noch keine Rückmeldung) → gelb
- **Abgesagt** → rot

Personen ohne Einladungscode sind ebenfalls offen/gelb. Beim RSVP-Eingang werden bestätigte Personen automatisch in die Personenliste übernommen. Über **„Aus RSVP übernehmen“** kann die Liste zusätzlich manuell abgeglichen werden.

Für offene oder abgesagte Einladungen können Personen in `/personen.html` manuell angelegt werden. Die Zuordnung zur Einladung bestimmt den Status. Kinder werden direkt in der Personenliste markiert.

## Tischplan

Der Planer lädt Personen und Tischplan über geschützte Admin-Endpunkte. Es gibt keine separate Gästeliste mehr im Tischplaner:

- Gäste werden zentral unter **Personen** gepflegt.
- Änderungen an Namen, Kind-Status oder Einladung erscheinen nach **Aktualisieren** im Tischplaner.
- Die Gästeliste lässt sich nach Status (zugesagt/offen/abgesagt) und zusätzlich nach **zugeordnet / nicht zugeordnet** filtern.
- Tischplan und Sitzzuordnungen werden automatisch auf dem Server gespeichert.
- Zusätzlich wird ein lokaler Browser-Cache als Fallback geführt.
- Beim Löschen einer Person werden ihre Sitzplätze serverseitig freigegeben.

Der Plan wird in der Tabelle `seating_state` als JSON mit Revision gespeichert. Bei paralleler Bearbeitung wird ein Konflikt erkannt und angezeigt.

## Datenbank-Migration

Beim ersten Aufruf der neuen API werden automatisch folgende Tabellen angelegt:

- `people`
- `seating_state`
- `app_meta`

Vor der ersten Schema-Migration wird automatisch eine Sicherung der SQLite-Datenbank im `data/`-Ordner angelegt (`wedding.backup-*.db`). Der `data/`-Ordner ist per `.htaccess` vollständig gesperrt.

## Deployment

**Vor dem Upload unbedingt die Live-Datenbank sichern** (z. B. `data/wedding.db` per Plesk-Dateimanager oder FTP herunterladen). Die lokale Entwicklungskopie ersetzt nicht die Live-Daten.

Zu ändernde bzw. neue Dateien:

```text
api.php
index.html
admin.html
personen.html
gruppen.html
qrliste.html
css/admin.css
js/app.js
js/admin.js
js/personen.js
js/gruppen.js
js/qrliste.js
planer/
  index.html
  app.js
  styles.css
  theme-init.js
```

Falls auf dem Webspace sowohl das Root-Verzeichnis als auch `public/` genutzt werden, die Dateien an beiden Stellen aktualisieren. **Nicht** die lokale `data/`-Datenbank hochladen – die Live-Datenbank bleibt bestehen und wird automatisch migriert. Das Git-Repository ignoriert `data/`, `exports/` und `node_modules/` vollständig.

Nach dem Upload:

1. Admin-Seite öffnen und anmelden.
2. Unter **Gruppen & Codes** die Einladungen prüfen, neue Gruppen anlegen und bei Bedarf lesbare Codes erzeugen.
3. Die Personenliste prüfen und fehlende Personen für offene Einladungen ergänzen.
4. Gegebenenfalls **„Aus RSVP übernehmen“** ausführen.
5. Tischplan öffnen und Tische anlegen.
6. Unter **QR-Liste** die druckbare Liste prüfen und als PDF speichern.

## Sicherheit

- Es gibt **kein fest eingebautes Standardpasswort**. Der Admin-Login benötigt eine `data/admin-config.json` mit `password` bzw. `password_hash` oder die Umgebungsvariable `ADMIN_PASSWORD`.
- Der Passwort-Hinweis mit dem früheren Standardpasswort wurde aus der Login-Seite entfernt.
- Ein bisher im Klartext gespeichertes Admin-Passwort wird bei der nächsten erfolgreichen Anmeldung automatisch durch einen Hash ersetzt; die alte Datei wird dabei gesichert.
- Schreibende Admin-Endpunkte verlangen JSON und prüfen die Request-Herkunft.
- Die PHP-Session nutzt `HttpOnly`, `SameSite=Lax` und – bei HTTPS – `Secure`.
- Admin-, Personen- und Planer-Seite sind auf `noindex, nofollow` gesetzt.
- Der Zugriffsschutz des Hosting-Panels bleibt weiterhin empfohlen.

## API-Überblick

Alle Endpunkte liegen unter `/api/...` (bzw. `api.php?route=...` als PHP-Fallback) und benötigen eine Admin-Session:

| Methode | Endpunkt | Zweck |
| --- | --- | --- |
| GET | `admin/seating` | Tischplan + Personen + Einladungen |
| POST | `admin/seating` | Tischplan mit Revision speichern |
| GET | `admin/people` | Personenliste + Einladungen |
| POST | `admin/people` | Person anlegen |
| PATCH | `admin/people/{key}` | Person bearbeiten |
| DELETE | `admin/people/{key}` | Person löschen, Sitzplatz freigeben |
| POST | `admin/people/sync-rsvp` | bestätigte RSVP-Personen übernehmen |
| GET | `admin/groups` | Gruppen/Einladungen mit Personen |
| POST | `admin/groups` | Gruppe mit lesbarem Code anlegen |
| PATCH | `admin/groups/{code}` | Gruppe bearbeiten |
| POST | `admin/groups/{code}/generate-code` | neuen lesbaren Code erzeugen und Daten migrieren |

## Hinweis zur lokalen Entwicklung

Live läuft die PHP-Variante. `server.js` ist die Node-Parallelvariante für lokale Tests und verwendet dieselbe SQLite-Datenbank.
