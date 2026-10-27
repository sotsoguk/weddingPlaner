<?php
/**
 * Hochzeits-Webapp für Bert + Sabine
 * PHP API Backend für Webspace (Apache / Nginx + PHP 7.4 / 8.x + SQLite3/PDO)
 */

// Headers & Security
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: strict-origin-when-cross-origin');

// Session configuration
if (session_status() === PHP_SESSION_NONE) {
    $forwardedProto = isset($_SERVER['HTTP_X_FORWARDED_PROTO']) ? strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) : '';
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || strpos($forwardedProto, 'https') !== false
        || (isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443);
    session_set_cookie_params([
        'lifetime' => 7 * 24 * 60 * 60,
        'path' => '/',
        'httponly' => true,
        'secure' => $isHttps,
        'samesite' => 'Lax'
    ]);
    session_start();
}

// Locate data directory (supports both root and public/ folder deployments)
$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir) && is_dir(__DIR__ . '/../data')) {
    $dataDir = __DIR__ . '/../data';
}
if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0755, true);
}

// Database connection via PDO SQLite
$dbPath = $dataDir . '/wedding.db';
try {
    $db = new PDO('sqlite:' . $dbPath);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    // Vor der ersten Schema-Migration automatisch eine Datenbank-Sicherung anlegen.
    $peopleTableExists = $db->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'people'")->fetchColumn();
    if (!$peopleTableExists && file_exists($dbPath)) {
        $backupPath = $dataDir . '/wedding.backup-' . date('Ymd-His') . '.db';
        @copy($dbPath, $backupPath);
        @chmod($backupPath, 0600);
    }

    // Initialize tables
    $db->exec("
        CREATE TABLE IF NOT EXISTS rsvps (
            code TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            comment TEXT,
            submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS attendees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rsvp_code TEXT NOT NULL,
            name TEXT NOT NULL,
            dish_id TEXT,
            dietary_notes TEXT,
            FOREIGN KEY (rsvp_code) REFERENCES rsvps(code) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS people (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            is_child INTEGER NOT NULL DEFAULT 0,
            rsvp_code TEXT,
            dish_id TEXT,
            dietary_notes TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            rsvp_listed INTEGER DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS seating_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            state_json TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS app_meta (
            meta_key TEXT PRIMARY KEY,
            meta_value TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_people_rsvp_code ON people(rsvp_code);
        CREATE INDEX IF NOT EXISTS idx_people_sort_order ON people(sort_order);
    ");

    $peopleColumns = $db->query('PRAGMA table_info(people)')->fetchAll();
    $hasRsvpListed = false;
    foreach ($peopleColumns as $column) {
        if ($column['name'] === 'rsvp_listed') {
            $hasRsvpListed = true;
            break;
        }
    }
    if (!$hasRsvpListed) {
        $db->exec('ALTER TABLE people ADD COLUMN rsvp_listed INTEGER DEFAULT NULL');
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Datenbankfehler: ' . $e->getMessage()]);
    exit;
}

// Helper: Load Guests (JSON or CSV)
function loadGuests($dataDir) {
    $jsonFile = $dataDir . '/guests.json';
    if (file_exists($jsonFile)) {
        $content = file_get_contents($jsonFile);
        $data = json_decode($content, true);
        if (is_array($data)) return $data;
    }

    $csvFile = $dataDir . '/guests.csv';
    if (file_exists($csvFile)) {
        $guests = [];
        if (($handle = fopen($csvFile, "r")) !== FALSE) {
            $header = fgetcsv($handle, 1000, ",");
            while (($row = fgetcsv($handle, 1000, ",")) !== FALSE) {
                if (!empty($row[0])) {
                    $guests[] = [
                        'code' => trim($row[0]),
                        'name' => isset($row[1]) ? trim($row[1]) : trim($row[0]),
                        'maxPersons' => isset($row[2]) ? (int)$row[2] : 2,
                        'group' => isset($row[3]) ? trim($row[3]) : ''
                    ];
                }
            }
            fclose($handle);
        }
        return $guests;
    }
    return [];
}

// Helper: Load Menu
function loadMenu($dataDir) {
    $menuFile = $dataDir . '/menu.json';
    if (file_exists($menuFile)) {
        $data = json_decode(file_get_contents($menuFile), true);
        if (is_array($data)) return $data;
    }
    return ['title' => 'Hochzeitsmenü', 'mains' => []];
}

// Helper: Load Config
function loadWeddingConfig($dataDir) {
    $configFile = $dataDir . '/config.json';
    if (file_exists($configFile)) {
        $data = json_decode(file_get_contents($configFile), true);
        if (is_array($data)) return $data;
    }
    return ['couple' => ['partner1' => 'Sabine', 'partner2' => 'Bert']];
}

// Helper: Admin-Passwort prüfen (unterstützt Hash und Migration alter Klartext-Dateien)
function verifyAdminPassword($input, $dataDir) {
    $envPassword = getenv('ADMIN_PASSWORD');
    if ($envPassword === false && isset($_ENV['ADMIN_PASSWORD'])) {
        $envPassword = $_ENV['ADMIN_PASSWORD'];
    }
    if ($envPassword !== false && $envPassword !== '') {
        return hash_equals((string)$envPassword, (string)$input);
    }

    $pwFile = $dataDir . '/admin-config.json';
    $data = [];
    if (file_exists($pwFile)) {
        $decoded = json_decode(file_get_contents($pwFile), true);
        if (is_array($decoded)) $data = $decoded;
    }

    if (!empty($data['password_hash'])) {
        return password_verify((string)$input, (string)$data['password_hash']);
    }

    $valid = false;
    if (!empty($data['password'])) {
        $valid = hash_equals((string)$data['password'], (string)$input);
    }

    if ($valid) {
        // Klartext-Passwort direkt nach erfolgreicher Anmeldung durch einen Hash ersetzen.
        $data['password_hash'] = password_hash((string)$input, PASSWORD_DEFAULT);
        unset($data['password']);
        $encoded = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($encoded !== false) {
            if (file_exists($pwFile)) {
                $configBackup = $dataDir . '/admin-config.backup-' . date('Ymd-His') . '.json';
                @copy($pwFile, $configBackup);
                @chmod($configBackup, 0600);
            }
            @file_put_contents($pwFile, $encoded . "\n", LOCK_EX);
            @chmod($pwFile, 0600);
        }
    }

    return $valid;
}

// ------------------------------------------------------------------
// Helpers: Personen & Tischplan
// ------------------------------------------------------------------

function makePersonKey() {
    return bin2hex(random_bytes(16));
}

function normalizePersonName($name) {
    $name = trim((string)$name);
    return function_exists('mb_strtolower') ? mb_strtolower($name, 'UTF-8') : strtolower($name);
}

function readJsonBody() {
    $contentType = isset($_SERVER['CONTENT_TYPE']) ? $_SERVER['CONTENT_TYPE'] : '';
    if (stripos($contentType, 'application/json') === false) {
        http_response_code(415);
        echo json_encode(['error' => 'Content-Type application/json erforderlich']);
        exit;
    }
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) {
        http_response_code(400);
        echo json_encode(['error' => 'Ungültige JSON-Daten']);
        exit;
    }
    return $body;
}

function checkSameOrigin() {
    if (empty($_SERVER['HTTP_ORIGIN'])) return;
    $originHost = parse_url($_SERVER['HTTP_ORIGIN'], PHP_URL_HOST);
    $requestHost = isset($_SERVER['HTTP_HOST']) ? preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST']) : '';
    if (!$originHost || strcasecmp($originHost, $requestHost) !== 0) {
        http_response_code(403);
        echo json_encode(['error' => 'Ungültige Anfrage-Herkunft']);
        exit;
    }
}

function getParties($db, $dataDir) {
    $guests = loadGuests($dataDir);
    $rsvpStatus = [];
    foreach ($db->query('SELECT code, status FROM rsvps')->fetchAll() as $row) {
        $rsvpStatus[strtoupper($row['code'])] = $row['status'];
    }

    $parties = [];
    foreach ($guests as $guest) {
        if (empty($guest['code'])) continue;
        $code = (string)$guest['code'];
        $parties[] = [
            'code' => $code,
            'name' => isset($guest['name']) ? $guest['name'] : $code,
            'group' => isset($guest['group']) ? $guest['group'] : '',
            'maxPersons' => isset($guest['maxPersons']) ? (int)$guest['maxPersons'] : 2,
            'status' => isset($rsvpStatus[strtoupper($code)]) ? $rsvpStatus[strtoupper($code)] : 'pending'
        ];
    }

    usort($parties, function ($a, $b) {
        return strcasecmp($a['name'], $b['name']);
    });
    return $parties;
}

function getSeatingState($db) {
    $row = $db->query('SELECT state_json, revision, updated_at FROM seating_state WHERE id = 1')->fetch();
    if (!$row) {
        return [
            'revision' => 0,
            'updatedAt' => null,
            'plan' => ['tables' => [], 'settings' => []]
        ];
    }

    $plan = json_decode($row['state_json'], true);
    if (!is_array($plan)) $plan = [];
    if (!isset($plan['tables']) || !is_array($plan['tables'])) $plan['tables'] = [];
    if (!isset($plan['settings']) || !is_array($plan['settings'])) $plan['settings'] = [];

    return [
        'revision' => (int)$row['revision'],
        'updatedAt' => $row['updated_at'],
        'plan' => $plan
    ];
}

function validSeatingPlan($plan) {
    if (!is_array($plan)) return false;
    if (!isset($plan['tables']) || !is_array($plan['tables'])) return false;
    if (count($plan['tables']) > 200) return false;
    if (isset($plan['settings']) && !is_array($plan['settings'])) return false;

    foreach ($plan['tables'] as $table) {
        if (!is_array($table)) return false;
        if (isset($table['seats'])) {
            if (!is_array($table['seats']) || count($table['seats']) > 100) return false;
        }
    }
    return true;
}

function saveSeatingState($db, $plan, $expectedRevision) {
    if (!validSeatingPlan($plan)) {
        throw new InvalidArgumentException('Ungültiger Tischplan');
    }

    $cleanPlan = [
        'version' => 1,
        'tables' => $plan['tables'],
        'settings' => isset($plan['settings']) && is_array($plan['settings']) ? $plan['settings'] : []
    ];
    $json = json_encode($cleanPlan, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) throw new InvalidArgumentException('Tischplan konnte nicht kodiert werden');
    if (strlen($json) > 2 * 1024 * 1024) throw new InvalidArgumentException('Tischplan ist zu groß');

    $db->beginTransaction();
    try {
        $row = $db->query('SELECT revision FROM seating_state WHERE id = 1')->fetch();
        $currentRevision = $row ? (int)$row['revision'] : 0;

        if ($expectedRevision !== null && (int)$expectedRevision !== $currentRevision) {
            $db->rollBack();
            return [
                'conflict' => true,
                'revision' => $currentRevision,
                'state' => getSeatingState($db)
            ];
        }

        $nextRevision = $currentRevision + 1;
        if ($row) {
            $stmt = $db->prepare("UPDATE seating_state SET state_json = ?, revision = ?, updated_at = datetime('now') WHERE id = 1");
            $stmt->execute([$json, $nextRevision]);
        } else {
            $stmt = $db->prepare("INSERT INTO seating_state (id, state_json, revision, updated_at) VALUES (1, ?, ?, datetime('now'))");
            $stmt->execute([$json, $nextRevision]);
        }

        $db->commit();
        return ['conflict' => false, 'revision' => $nextRevision];
    } catch (Exception $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
}

function getPeopleData($db, $dataDir) {
    $parties = getParties($db, $dataDir);
    $partyMap = [];
    $statusMap = [];
    foreach ($parties as $party) {
        $partyMap[$party['code']] = $party;
        $statusMap[strtoupper($party['code'])] = $party['status'];
    }

    $menu = loadMenu($dataDir);
    $dishMap = [];
    if (!empty($menu['mains']) && is_array($menu['mains'])) {
        foreach ($menu['mains'] as $dish) {
            if (!isset($dish['id'])) continue;
            $dishMap[$dish['id']] = (isset($dish['name']) ? $dish['name'] : $dish['id'])
                . (!empty($dish['tag']) ? ' (' . $dish['tag'] . ')' : '');
        }
    }

    $seating = getSeatingState($db);
    $tableMap = [];
    foreach ($seating['plan']['tables'] as $table) {
        if (empty($table['seats']) || !is_array($table['seats'])) continue;
        foreach ($table['seats'] as $seatIndex => $personKey) {
            if (!is_string($personKey) || $personKey === '') continue;
            $tableMap[$personKey] = [
                'number' => isset($table['number']) ? $table['number'] : '',
                'seatIndex' => $seatIndex + 1
            ];
        }
    }

    $people = [];
    $rows = $db->query('SELECT * FROM people ORDER BY sort_order ASC, name COLLATE NOCASE ASC')->fetchAll();
    foreach ($rows as $row) {
        $code = (string)$row['rsvp_code'];
        $party = isset($partyMap[$code]) ? $partyMap[$code] : null;
        $status = $code !== '' && isset($statusMap[strtoupper($code)])
            ? $statusMap[strtoupper($code)]
            : 'pending';
        if ($status === 'attending' && isset($row['rsvp_listed']) && (int)$row['rsvp_listed'] === 0) {
            $status = 'declined';
        }
        $dishId = (string)$row['dish_id'];
        $key = $row['person_key'];

        $people[] = [
            'key' => $key,
            'name' => $row['name'],
            'child' => ((int)$row['is_child'] === 1),
            'status' => $status,
            'rsvpCode' => $code,
            'partyName' => $party ? $party['name'] : '',
            'group' => $party ? $party['group'] : '',
            'dishId' => $dishId,
            'dishName' => ($dishId !== '' && isset($dishMap[$dishId])) ? $dishMap[$dishId] : '',
            'dietaryNotes' => $row['dietary_notes'] ?: '',
            'table' => isset($tableMap[$key]) ? $tableMap[$key] : null
        ];
    }

    return ['people' => $people, 'parties' => $parties];
}

function getCodeWords() {
    return [
        'sonne', 'mond', 'stern', 'wolke', 'licht', 'morgen', 'abend', 'sommer', 'winter', 'herbst',
        'rose', 'tulpe', 'lilie', 'garten', 'wiese', 'wald', 'see', 'berg', 'tal', 'fluss',
        'insel', 'strand', 'hafen', 'steg', 'weg', 'haus', 'hof', 'dorf', 'tisch', 'bank',
        'kerze', 'laterne', 'glocke', 'band', 'schleife', 'feder', 'segel', 'herz', 'freude', 'lachen',
        'tanz', 'musik', 'lied', 'fest', 'feier', 'wunsch', 'traum', 'ruhe', 'kraft', 'zeit',
        'kaffee', 'kuchen', 'honig', 'apfel', 'kirsche', 'zitrone', 'minze', 'lavendel', 'zimt', 'brot',
        'wein', 'salz', 'perle', 'gold', 'silber', 'samt', 'seide', 'boot', 'reise', 'ufer',
        'quelle', 'brunnen', 'biene', 'vogel', 'schwan', 'fuchs', 'reh', 'kirche', 'kapelle', 'kranz',
        'brief', 'karte', 'wort', 'meer', 'bucht', 'welle', 'feuer', 'funke', 'glanz', 'zauber',
        'wunder', 'picknick'
    ];
}

function generateReadableCode($existingCodes) {
    $words = getCodeWords();
    for ($attempt = 0; $attempt < 100; $attempt++) {
        $picked = [];
        while (count($picked) < 3) {
            $word = $words[random_int(0, count($words) - 1)];
            if (!in_array($word, $picked, true)) $picked[] = $word;
        }
        $code = implode('-', $picked);
        if (!isset($existingCodes[strtoupper($code)])) {
            return $code;
        }
    }
    throw new RuntimeException('Es konnte kein freier Gästecode erzeugt werden.');
}

function saveGuests($dataDir, $guests) {
    $file = $dataDir . '/guests.json';
    $backup = null;
    if (file_exists($file)) {
        $backup = $dataDir . '/guests.backup-' . date('Ymd-His') . '.json';
        @copy($file, $backup);
        @chmod($backup, 0600);
    }

    $json = json_encode(array_values($guests), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) throw new RuntimeException('Gästeliste konnte nicht kodiert werden.');

    $temp = $file . '.tmp';
    if (@file_put_contents($temp, $json . "\n", LOCK_EX) === false) {
        throw new RuntimeException('Gästeliste konnte nicht gespeichert werden.');
    }
    @chmod($temp, 0644);
    if (!@rename($temp, $file)) {
        @unlink($temp);
        throw new RuntimeException('Gästeliste konnte nicht gespeichert werden.');
    }
    return $backup;
}

function getGroups($db, $dataDir) {
    $parties = getParties($db, $dataDir);
    $people = getPeopleData($db, $dataDir)['people'];
    $byCode = [];
    foreach ($people as $person) {
        $code = (string)$person['rsvpCode'];
        if ($code === '') continue;
        if (!isset($byCode[$code])) $byCode[$code] = [];
        $byCode[$code][] = $person;
    }

    $groups = [];
    foreach ($parties as $party) {
        $members = isset($byCode[$party['code']]) ? $byCode[$party['code']] : [];
        $childCount = 0;
        foreach ($members as $member) {
            if (!empty($member['child'])) $childCount++;
        }
        $groups[] = array_merge($party, [
            'persons' => $members,
            'personCount' => count($members),
            'childCount' => $childCount
        ]);
    }
    return ['groups' => $groups];
}

function syncPeopleFromRsvp($db) {
    $rows = $db->query(
        "SELECT a.rsvp_code, a.name, a.dish_id, a.dietary_notes
         FROM attendees a
         JOIN rsvps r ON UPPER(r.code) = UPPER(a.rsvp_code)
         WHERE r.status = 'attending'
         ORDER BY a.rsvp_code ASC, a.id ASC"
    )->fetchAll();

    $existing = [];
    foreach ($db->query('SELECT * FROM people ORDER BY id ASC')->fetchAll() as $person) {
        $code = (string)$person['rsvp_code'];
        $existing[$code][normalizePersonName($person['name'])][] = $person;
    }

    $maxOrder = (int)$db->query('SELECT COALESCE(MAX(sort_order), 0) FROM people')->fetchColumn();
    $added = 0;
    $updated = 0;

    $db->beginTransaction();
    try {
        $attendingCodes = [];
        foreach ($rows as $row) {
            $attendingCodes[(string)$row['rsvp_code']] = true;
        }
        $resetListed = $db->prepare('UPDATE people SET rsvp_listed = 0 WHERE rsvp_code = ? AND rsvp_listed = 1');
        foreach (array_keys($attendingCodes) as $attendingCode) {
            $resetListed->execute([$attendingCode]);
        }

        foreach ($rows as $row) {
            $code = (string)$row['rsvp_code'];
            $name = trim((string)$row['name']);
            if ($name === '') continue;
            $normalized = normalizePersonName($name);
            $match = null;

            if (isset($existing[$code][$normalized]) && count($existing[$code][$normalized]) > 0) {
                $match = array_shift($existing[$code][$normalized]);
            }

            if ($match) {
                $stmt = $db->prepare("UPDATE people SET dish_id = ?, dietary_notes = ?, rsvp_listed = 1, updated_at = datetime('now') WHERE id = ?");
                $stmt->execute([$row['dish_id'] ?: null, $row['dietary_notes'] ?: '', $match['id']]);
                $updated++;
            } else {
                $maxOrder++;
                $stmt = $db->prepare(
                    "INSERT INTO people (person_key, name, is_child, rsvp_code, dish_id, dietary_notes, sort_order, rsvp_listed)
                     VALUES (?, ?, 0, ?, ?, ?, ?, 1)"
                );
                $stmt->execute([
                    makePersonKey(),
                    mb_substr($name, 0, 80),
                    $code,
                    $row['dish_id'] ?: null,
                    $row['dietary_notes'] ?: '',
                    $maxOrder
                ]);
                $added++;
            }
        }
        $db->commit();
    } catch (Exception $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }

    return ['added' => $added, 'updated' => $updated];
}

function seedPeopleOnce($db) {
    $seeded = $db->query("SELECT meta_value FROM app_meta WHERE meta_key = 'people_seeded'")->fetchColumn();
    if ($seeded === '1') return;

    $count = (int)$db->query('SELECT COUNT(*) FROM people')->fetchColumn();
    if ($count === 0) {
        syncPeopleFromRsvp($db);
    }

    $stmt = $db->prepare("INSERT OR REPLACE INTO app_meta (meta_key, meta_value) VALUES ('people_seeded', '1')");
    $stmt->execute();
}

function removePersonFromSeating($db, $personKey) {
    $seating = getSeatingState($db);
    $changed = false;
    foreach ($seating['plan']['tables'] as &$table) {
        if (!isset($table['seats']) || !is_array($table['seats'])) continue;
        foreach ($table['seats'] as $index => $key) {
            if ($key === $personKey) {
                $table['seats'][$index] = null;
                $changed = true;
            }
        }
    }
    unset($table);

    if ($changed) {
        saveSeatingState($db, $seating['plan'], $seating['revision']);
    }
}

try {
    seedPeopleOnce($db);
} catch (Exception $e) {
    // Ein fehlgeschlagenes Seeding darf die übrige Anwendung nicht blockieren.
    error_log('People seeding failed: ' . $e->getMessage());
}

// Parse route from URL or query
$route = '';
if (isset($_GET['route'])) {
    $route = trim($_GET['route'], '/');
} elseif (isset($_SERVER['PATH_INFO'])) {
    $route = trim($_SERVER['PATH_INFO'], '/');
} else {
    $uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $scriptName = $_SERVER['SCRIPT_NAME'];
    if (strpos($uri, '/api/') !== false) {
        $parts = explode('/api/', $uri, 2);
        $route = isset($parts[1]) ? trim($parts[1], '/') : '';
    }
}

$method = $_SERVER['REQUEST_METHOD'];

// ------------------------------------------------------------------
// ROUTING
// ------------------------------------------------------------------

// 1. GET /api/config
if ($route === 'config' && $method === 'GET') {
    echo json_encode(loadWeddingConfig($dataDir));
    exit;
}

// 2. GET /api/menu
if ($route === 'menu' && $method === 'GET') {
    echo json_encode(loadMenu($dataDir));
    exit;
}

// 3. GET /api/guest/{code}
if (preg_match('#^guest/([^/]+)$#', $route, $matches) && $method === 'GET') {
    $code = strtoupper(trim(urldecode($matches[1])));
    $guests = loadGuests($dataDir);

    $foundGuest = null;
    foreach ($guests as $g) {
        if (strtoupper(trim($g['code'])) === $code) {
            $foundGuest = $g;
            break;
        }
    }

    if (!$foundGuest) {
        http_response_code(404);
        echo json_encode(['error' => 'Ungültiger Gästecode. Bitte überprüfe deine Einladung.']);
        exit;
    }

    // Check existing RSVP
    $stmt = $db->prepare('SELECT * FROM rsvps WHERE UPPER(code) = ?');
    $stmt->execute([$code]);
    $rsvp = $stmt->fetch();

    $attendees = [];
    if ($rsvp) {
        $stmtAtt = $db->prepare('SELECT name, dish_id, dietary_notes FROM attendees WHERE rsvp_code = ?');
        $stmtAtt->execute([$rsvp['code']]);
        $rawAttendees = $stmtAtt->fetchAll();
        foreach ($rawAttendees as $ra) {
            $attendees[] = [
                'name' => $ra['name'],
                'dishId' => $ra['dish_id'],
                'dietaryNotes' => $ra['dietary_notes'] ?: ''
            ];
        }
    }

    // Vorab in der Personenverwaltung angelegte Personen der Gruppe immer mitliefern.
    $groupPeople = [];
    $stmtPeople = $db->prepare(
        'SELECT name, is_child FROM people WHERE UPPER(rsvp_code) = ? AND (rsvp_listed IS NULL OR rsvp_listed <> 0) ORDER BY sort_order ASC, name COLLATE NOCASE ASC'
    );
    $stmtPeople->execute([strtoupper($foundGuest['code'])]);
    foreach ($stmtPeople->fetchAll() as $person) {
        $groupPeople[] = [
            'name' => $person['name'],
            'child' => ((int)$person['is_child'] === 1)
        ];
    }

    echo json_encode([
        'code' => $foundGuest['code'],
        'name' => $foundGuest['name'],
        'maxPersons' => isset($foundGuest['maxPersons']) ? (int)$foundGuest['maxPersons'] : 2,
        'group' => isset($foundGuest['group']) ? $foundGuest['group'] : '',
        'people' => $groupPeople,
        'rsvp' => $rsvp ? [
            'status' => $rsvp['status'],
            'comment' => $rsvp['comment'] ?: '',
            'submitted_at' => $rsvp['submitted_at'],
            'updated_at' => $rsvp['updated_at'],
            'attendees' => $attendees
        ] : null
    ]);
    exit;
}

// 4. POST /api/rsvp
if ($route === 'rsvp' && $method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) {
        http_response_code(400);
        echo json_encode(['error' => 'Ungültige Formulardaten.']);
        exit;
    }

    $code = strtoupper(trim(isset($body['code']) ? $body['code'] : ''));
    $status = isset($body['status']) ? $body['status'] : '';
    $comment = isset($body['comment']) ? mb_substr(trim($body['comment']), 0, 1000) : '';
    $attendees = isset($body['attendees']) && is_array($body['attendees']) ? $body['attendees'] : [];

    if (empty($code)) {
        http_response_code(400);
        echo json_encode(['error' => 'Code fehlt']);
        exit;
    }

    $guests = loadGuests($dataDir);
    $foundGuest = null;
    foreach ($guests as $g) {
        if (strtoupper(trim($g['code'])) === $code) {
            $foundGuest = $g;
            break;
        }
    }

    if (!$foundGuest) {
        http_response_code(404);
        echo json_encode(['error' => 'Ungültiger Gästecode']);
        exit;
    }

    if ($status !== 'attending' && $status !== 'declined') {
        http_response_code(400);
        echo json_encode(['error' => 'Ungültiger Status']);
        exit;
    }

    // Validate attendees
    $cleanAttendees = [];
    if ($status === 'attending') {
        if (empty($attendees)) {
            http_response_code(400);
            echo json_encode(['error' => 'Bitte gib mindestens eine teilnehmende Person an.']);
            exit;
        }

        foreach ($attendees as $idx => $a) {
            $name = trim(isset($a['name']) ? $a['name'] : '');
            if (empty($name)) {
                http_response_code(400);
                echo json_encode(['error' => 'Bitte gib den Namen für Person ' . ($idx + 1) . ' an.']);
                exit;
            }
            $cleanAttendees[] = [
                'name' => mb_substr($name, 0, 100),
                'dishId' => isset($a['dishId']) ? trim($a['dishId']) : null,
                'dietaryNotes' => isset($a['dietaryNotes']) ? mb_substr(trim($a['dietaryNotes']), 0, 300) : ''
            ];
        }
    }

    // Transaction save
    try {
        $db->beginTransaction();

        $targetCode = $foundGuest['code'];

        $stmtCheck = $db->prepare('SELECT code FROM rsvps WHERE UPPER(code) = ?');
        $stmtCheck->execute([$code]);
        $existing = $stmtCheck->fetch();

        if ($existing) {
            $stmtUpd = $db->prepare("
                UPDATE rsvps 
                SET status = ?, comment = ?, updated_at = datetime('now')
                WHERE code = ?
            ");
            $stmtUpd->execute([$status, $comment, $existing['code']]);
        } else {
            $stmtIns = $db->prepare("
                INSERT INTO rsvps (code, status, comment, submitted_at, updated_at)
                VALUES (?, ?, ?, datetime('now'), datetime('now'))
            ");
            $stmtIns->execute([$targetCode, $status, $comment]);
        }

        // Delete existing attendees
        $stmtDel = $db->prepare('DELETE FROM attendees WHERE rsvp_code = ?');
        $stmtDel->execute([$targetCode]);

        // Insert new attendees if attending
        if ($status === 'attending') {
            $stmtAtt = $db->prepare('INSERT INTO attendees (rsvp_code, name, dish_id, dietary_notes) VALUES (?, ?, ?, ?)');
            foreach ($cleanAttendees as $att) {
                $stmtAtt->execute([$targetCode, $att['name'], $att['dishId'], $att['dietaryNotes']]);
            }
        }

        $db->commit();

        // Bestätigte RSVP-Personen direkt in die gemeinsame Personenliste übernehmen.
        try {
            syncPeopleFromRsvp($db);
        } catch (Exception $syncError) {
            error_log('People sync after RSVP failed: ' . $syncError->getMessage());
        }

        echo json_encode([
            'success' => true,
            'message' => $status === 'attending'
                ? 'Vielen Dank! Wir haben deine Zusage erhalten und freuen uns riesig auf euch!'
                : 'Vielen Dank für deine Rückmeldung. Schade, dass ihr nicht dabei sein könnt!'
        ]);
        exit;

    } catch (Exception $e) {
        if ($db->inTransaction()) $db->rollBack();
        http_response_code(500);
        echo json_encode(['error' => 'Fehler beim Speichern: ' . $e->getMessage()]);
        exit;
    }
}

// ------------------------------------------------------------------
// ADMIN ROUTING
// ------------------------------------------------------------------

// 5. POST /api/admin/login
if ($route === 'admin/login' && $method === 'POST') {
    checkSameOrigin();
    $body = json_decode(file_get_contents('php://input'), true);
    $pw = is_array($body) && isset($body['password']) ? trim((string)$body['password']) : '';
    $valid = verifyAdminPassword($pw, $dataDir);

    if ($valid) {
        session_regenerate_id(true);
        $_SESSION['is_admin'] = true;
        echo json_encode(['success' => true, 'message' => 'Erfolgreich angemeldet']);
    } else {
        usleep(250000);
        http_response_code(401);
        echo json_encode(['error' => 'Falsches Passwort']);
    }
    exit;
}

// 6. GET /api/admin/check
if ($route === 'admin/check' && $method === 'GET') {
    if (!empty($_SESSION['is_admin'])) {
        echo json_encode(['authenticated' => true]);
    } else {
        http_response_code(401);
        echo json_encode(['authenticated' => false]);
    }
    exit;
}

// 7. POST /api/admin/logout
if ($route === 'admin/logout' && $method === 'POST') {
    $_SESSION = [];
    if (session_id() != "" || isset($_COOKIE[session_name()])) {
        setcookie(session_name(), '', time() - 2592000, '/');
    }
    session_destroy();
    echo json_encode(['success' => true]);
    exit;
}

// Protected Admin Middleware check for remaining admin endpoints
function checkAdminAuth() {
    if (empty($_SESSION['is_admin'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Nicht angemeldet']);
        exit;
    }
}

// 7b. Gemeinsame Personenliste / Tischplan
if ($route === 'admin/seating' && $method === 'GET') {
    checkAdminAuth();
    header('Cache-Control: no-store');
    $seating = getSeatingState($db);
    $data = getPeopleData($db, $dataDir);
    echo json_encode([
        'revision' => $seating['revision'],
        'updatedAt' => $seating['updatedAt'],
        'plan' => $seating['plan'],
        'people' => $data['people'],
        'parties' => $data['parties']
    ]);
    exit;
}

if ($route === 'admin/seating' && $method === 'POST') {
    checkAdminAuth();
    checkSameOrigin();
    header('Cache-Control: no-store');
    $body = readJsonBody();
    $revision = isset($body['revision']) ? (int)$body['revision'] : null;
    $plan = isset($body['plan']) && is_array($body['plan']) ? $body['plan'] : null;
    if ($plan === null) {
        http_response_code(400);
        echo json_encode(['error' => 'Tischplan fehlt']);
        exit;
    }

    try {
        $result = saveSeatingState($db, $plan, $revision);
        if (!empty($result['conflict'])) {
            http_response_code(409);
            echo json_encode([
                'error' => 'Der Tischplan wurde zwischenzeitlich geändert.',
                'revision' => $result['revision'],
                'state' => $result['state']
            ]);
        } else {
            echo json_encode(['success' => true, 'revision' => $result['revision']]);
        }
    } catch (InvalidArgumentException $e) {
        http_response_code(422);
        echo json_encode(['error' => $e->getMessage()]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Tischplan konnte nicht gespeichert werden']);
    }
    exit;
}

if ($route === 'admin/people' && $method === 'GET') {
    checkAdminAuth();
    header('Cache-Control: no-store');
    $data = getPeopleData($db, $dataDir);
    echo json_encode($data);
    exit;
}

if ($route === 'admin/people' && $method === 'POST') {
    checkAdminAuth();
    checkSameOrigin();
    $body = readJsonBody();

    $name = isset($body['name']) ? trim((string)$body['name']) : '';
    $child = array_key_exists('child', $body) ? $body['child'] : false;
    $code = isset($body['rsvpCode']) ? trim((string)$body['rsvpCode']) : '';

    if ($name === '' || (function_exists('mb_strlen') ? mb_strlen($name) : strlen($name)) > 80) {
        http_response_code(422);
        echo json_encode(['error' => 'Name fehlt oder ist zu lang (max. 80 Zeichen).']);
        exit;
    }
    if (!is_bool($child)) {
        http_response_code(422);
        echo json_encode(['error' => 'child muss true oder false sein.']);
        exit;
    }

    $validCodes = [];
    foreach (loadGuests($dataDir) as $guest) {
        if (!empty($guest['code'])) $validCodes[] = (string)$guest['code'];
    }
    if ($code !== '' && !in_array($code, $validCodes, true)) {
        http_response_code(422);
        echo json_encode(['error' => 'Unbekannter Einladungscode.']);
        exit;
    }

    $key = makePersonKey();
    $order = (int)$db->query('SELECT COALESCE(MAX(sort_order), 0) FROM people')->fetchColumn() + 1;
    $stmt = $db->prepare(
        "INSERT INTO people (person_key, name, is_child, rsvp_code, sort_order)
         VALUES (?, ?, ?, ?, ?)"
    );
    $stmt->execute([$key, $name, $child ? 1 : 0, $code !== '' ? $code : null, $order]);

    echo json_encode(['success' => true, 'personKey' => $key]);
    exit;
}

if ($route === 'admin/people/sync-rsvp' && $method === 'POST') {
    checkAdminAuth();
    checkSameOrigin();
    try {
        $result = syncPeopleFromRsvp($db);
        echo json_encode(['success' => true, 'added' => $result['added'], 'updated' => $result['updated']]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'RSVP-Synchronisierung fehlgeschlagen']);
    }
    exit;
}

if (preg_match('#^admin/people/([^/]+)$#', $route, $matches)) {
    checkAdminAuth();
    checkSameOrigin();
    $personKey = urldecode($matches[1]);
    $stmt = $db->prepare('SELECT * FROM people WHERE person_key = ?');
    $stmt->execute([$personKey]);
    $person = $stmt->fetch();

    if (!$person) {
        http_response_code(404);
        echo json_encode(['error' => 'Person nicht gefunden']);
        exit;
    }

    if ($method === 'PATCH') {
        $body = readJsonBody();
        $updates = [];
        $params = [];

        if (array_key_exists('name', $body)) {
            $name = trim((string)$body['name']);
            if ($name === '' || (function_exists('mb_strlen') ? mb_strlen($name) : strlen($name)) > 80) {
                http_response_code(422);
                echo json_encode(['error' => 'Name fehlt oder ist zu lang (max. 80 Zeichen).']);
                exit;
            }
            $updates[] = 'name = ?';
            $params[] = $name;
        }

        if (array_key_exists('child', $body)) {
            if (!is_bool($body['child'])) {
                http_response_code(422);
                echo json_encode(['error' => 'child muss true oder false sein.']);
                exit;
            }
            $updates[] = 'is_child = ?';
            $params[] = $body['child'] ? 1 : 0;
        }

        if (array_key_exists('rsvpCode', $body)) {
            $code = trim((string)$body['rsvpCode']);
            $validCodes = [];
            foreach (loadGuests($dataDir) as $guest) {
                if (!empty($guest['code'])) $validCodes[] = (string)$guest['code'];
            }
            if ($code !== '' && !in_array($code, $validCodes, true)) {
                http_response_code(422);
                echo json_encode(['error' => 'Unbekannter Einladungscode.']);
                exit;
            }
            $updates[] = 'rsvp_code = ?';
            $params[] = $code !== '' ? $code : null;
        }

        if (empty($updates)) {
            http_response_code(400);
            echo json_encode(['error' => 'Keine Änderungen übergeben']);
            exit;
        }

        $updates[] = "updated_at = datetime('now')";
        $params[] = $person['id'];
        $stmt = $db->prepare('UPDATE people SET ' . implode(', ', $updates) . ' WHERE id = ?');
        $stmt->execute($params);
        echo json_encode(['success' => true]);
        exit;
    }

    if ($method === 'DELETE') {
        $stmt = $db->prepare('DELETE FROM people WHERE id = ?');
        $stmt->execute([$person['id']]);
        removePersonFromSeating($db, $personKey);
        echo json_encode(['success' => true]);
        exit;
    }

    http_response_code(405);
    echo json_encode(['error' => 'Methode nicht erlaubt']);
    exit;
}

// 7c. Gruppen / Einladungen mit lesbaren Codes
if ($route === 'admin/groups' && $method === 'GET') {
    checkAdminAuth();
    header('Cache-Control: no-store');
    echo json_encode(getGroups($db, $dataDir));
    exit;
}

if ($route === 'admin/groups' && $method === 'POST') {
    checkAdminAuth();
    checkSameOrigin();
    $body = readJsonBody();
    $name = isset($body['name']) ? trim((string)$body['name']) : '';
    $groupName = isset($body['group']) ? trim((string)$body['group']) : '';
    $maxPersons = isset($body['maxPersons']) ? (int)$body['maxPersons'] : 2;

    if ($name === '' || mb_strlen($name) > 100) {
        http_response_code(422);
        echo json_encode(['error' => 'Name der Einladung fehlt oder ist zu lang (max. 100 Zeichen).']);
        exit;
    }
    if (mb_strlen($groupName) > 80) {
        http_response_code(422);
        echo json_encode(['error' => 'Gruppenname ist zu lang (max. 80 Zeichen).']);
        exit;
    }
    if ($maxPersons < 1 || $maxPersons > 20) {
        http_response_code(422);
        echo json_encode(['error' => 'Max. Personen muss zwischen 1 und 20 liegen.']);
        exit;
    }

    $guests = loadGuests($dataDir);
    $existingCodes = [];
    foreach ($guests as $guest) {
        if (!empty($guest['code'])) $existingCodes[strtoupper($guest['code'])] = true;
    }
    foreach ($db->query('SELECT code FROM rsvps')->fetchAll() as $rsvpRow) {
        $existingCodes[strtoupper($rsvpRow['code'])] = true;
    }

    try {
        $code = generateReadableCode($existingCodes);
        $guests[] = [
            'code' => $code,
            'name' => $name,
            'maxPersons' => $maxPersons,
            'group' => $groupName
        ];
        saveGuests($dataDir, $guests);
        echo json_encode(['success' => true, 'code' => $code]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Gruppe konnte nicht angelegt werden.']);
    }
    exit;
}

if (preg_match('#^admin/groups/([^/]+)/generate-code$#', $route, $matches) && $method === 'POST') {
    checkAdminAuth();
    checkSameOrigin();
    $oldCode = urldecode($matches[1]);
    $guests = loadGuests($dataDir);
    $groupIndex = -1;
    foreach ($guests as $index => $guest) {
        if (strcasecmp((string)$guest['code'], $oldCode) === 0) {
            $groupIndex = $index;
            break;
        }
    }
    if ($groupIndex === -1) {
        http_response_code(404);
        echo json_encode(['error' => 'Gruppe nicht gefunden.']);
        exit;
    }

    $existingCodes = [];
    foreach ($guests as $guest) {
        if (!empty($guest['code'])) $existingCodes[strtoupper($guest['code'])] = true;
    }
    foreach ($db->query('SELECT code FROM rsvps')->fetchAll() as $rsvpRow) {
        $existingCodes[strtoupper($rsvpRow['code'])] = true;
    }

    $newCode = generateReadableCode($existingCodes);
    $oldGuests = $guests;
    $guests[$groupIndex]['code'] = $newCode;
    $backupFile = null;

    try {
        $backupFile = saveGuests($dataDir, $guests);
        $db->beginTransaction();

        $stmt = $db->prepare('SELECT * FROM rsvps WHERE UPPER(code) = ?');
        $stmt->execute([strtoupper($oldCode)]);
        $rsvp = $stmt->fetch();

        if ($rsvp) {
            $check = $db->prepare('SELECT code FROM rsvps WHERE UPPER(code) = ?');
            $check->execute([strtoupper($newCode)]);
            if ($check->fetch()) throw new RuntimeException('Neuer Code kollidiert mit einer Rückmeldung.');

            $insert = $db->prepare(
                'INSERT INTO rsvps (code, status, comment, submitted_at, updated_at)
                 SELECT ?, status, comment, submitted_at, updated_at FROM rsvps WHERE UPPER(code) = ?'
            );
            $insert->execute([$newCode, strtoupper($oldCode)]);

            $updateAttendees = $db->prepare('UPDATE attendees SET rsvp_code = ? WHERE UPPER(rsvp_code) = ?');
            $updateAttendees->execute([$newCode, strtoupper($oldCode)]);

            $updatePeople = $db->prepare('UPDATE people SET rsvp_code = ? WHERE UPPER(rsvp_code) = ?');
            $updatePeople->execute([$newCode, strtoupper($oldCode)]);

            $deleteOld = $db->prepare('DELETE FROM rsvps WHERE UPPER(code) = ?');
            $deleteOld->execute([strtoupper($oldCode)]);
        } else {
            $updatePeople = $db->prepare('UPDATE people SET rsvp_code = ? WHERE UPPER(rsvp_code) = ?');
            $updatePeople->execute([$newCode, strtoupper($oldCode)]);
        }

        $db->commit();
        echo json_encode(['success' => true, 'code' => $newCode]);
    } catch (Exception $e) {
        if ($db->inTransaction()) $db->rollBack();
        if ($backupFile && file_exists($backupFile)) {
            @copy($backupFile, $dataDir . '/guests.json');
        } else {
            try { saveGuests($dataDir, $oldGuests); } catch (Exception $restoreError) { /* ignorieren */ }
        }
        error_log('Code generation failed: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['error' => 'Neuer Code konnte nicht gespeichert werden.']);
    }
    exit;
}

if (preg_match('#^admin/groups/([^/]+)$#', $route, $matches) && $method === 'PATCH') {
    checkAdminAuth();
    checkSameOrigin();
    $code = urldecode($matches[1]);
    $body = readJsonBody();
    $guests = loadGuests($dataDir);
    $groupIndex = -1;
    foreach ($guests as $index => $guest) {
        if (strcasecmp((string)$guest['code'], $code) === 0) {
            $groupIndex = $index;
            break;
        }
    }
    if ($groupIndex === -1) {
        http_response_code(404);
        echo json_encode(['error' => 'Gruppe nicht gefunden.']);
        exit;
    }

    if (isset($body['name'])) {
        $name = trim((string)$body['name']);
        if ($name === '' || mb_strlen($name) > 100) {
            http_response_code(422);
            echo json_encode(['error' => 'Name der Einladung fehlt oder ist zu lang.']);
            exit;
        }
        $guests[$groupIndex]['name'] = $name;
    }
    if (isset($body['group'])) {
        $groupName = trim((string)$body['group']);
        if (mb_strlen($groupName) > 80) {
            http_response_code(422);
            echo json_encode(['error' => 'Gruppenname ist zu lang.']);
            exit;
        }
        $guests[$groupIndex]['group'] = $groupName;
    }
    if (isset($body['maxPersons'])) {
        $maxPersons = (int)$body['maxPersons'];
        if ($maxPersons < 1 || $maxPersons > 20) {
            http_response_code(422);
            echo json_encode(['error' => 'Max. Personen muss zwischen 1 und 20 liegen.']);
            exit;
        }
        $guests[$groupIndex]['maxPersons'] = $maxPersons;
    }

    try {
        saveGuests($dataDir, $guests);
        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Gruppe konnte nicht gespeichert werden.']);
    }
    exit;
}

// 8. GET /api/admin/overview
if ($route === 'admin/overview' && $method === 'GET') {
    checkAdminAuth();

    $guests = loadGuests($dataDir);
    $menu = loadMenu($dataDir);

    $rsvps = $db->query('SELECT * FROM rsvps')->fetchAll();
    $attendees = $db->query('SELECT * FROM attendees')->fetchAll();

    $rsvpMap = [];
    foreach ($rsvps as $r) {
        $rsvpMap[strtoupper($r['code'])] = $r;
    }

    $attendeeMap = [];
    foreach ($attendees as $a) {
        $code = strtoupper($a['rsvp_code']);
        if (!isset($attendeeMap[$code])) $attendeeMap[$code] = [];
        $attendeeMap[$code][] = $a;
    }

    $confirmedParties = 0;
    $declinedParties = 0;
    $pendingParties = 0;
    $totalAttendingPersons = 0;

    $dishCounts = [];
    if (!empty($menu['mains'])) {
        foreach ($menu['mains'] as $m) {
            $dishCounts[$m['id']] = ['id' => $m['id'], 'name' => $m['name'], 'tag' => $m['tag'], 'count' => 0];
        }
    }
    $dishCounts['none'] = ['id' => 'none', 'name' => 'Keine Angabe', 'tag' => 'Ohne', 'count' => 0];

    $dietaryAlerts = [];
    $guestList = [];

    foreach ($guests as $g) {
        $code = strtoupper($g['code']);
        $r = isset($rsvpMap[$code]) ? $rsvpMap[$code] : null;
        $attList = isset($attendeeMap[$code]) ? $attendeeMap[$code] : [];

        $status = 'pending';
        if ($r) {
            $status = $r['status'];
            if ($status === 'attending') {
                $confirmedParties++;
                $totalAttendingPersons += count($attList);
                foreach ($attList as $att) {
                    $dId = !empty($att['dish_id']) && isset($dishCounts[$att['dish_id']]) ? $att['dish_id'] : 'none';
                    $dishCounts[$dId]['count']++;
                    if (!empty($att['dietary_notes'])) {
                        $dietaryAlerts[] = [
                            'guest' => $g['name'],
                            'person' => $att['name'],
                            'notes' => $att['dietary_notes']
                        ];
                    }
                }
            } elseif ($status === 'declined') {
                $declinedParties++;
            }
        } else {
            $pendingParties++;
        }

        $formattedAttendees = [];
        foreach ($attList as $att) {
            $formattedAttendees[] = [
                'name' => $att['name'],
                'dishId' => $att['dish_id'],
                'dietaryNotes' => $att['dietary_notes']
            ];
        }

        $guestList[] = [
            'code' => $g['code'],
            'name' => $g['name'],
            'group' => isset($g['group']) ? $g['group'] : '',
            'maxPersons' => isset($g['maxPersons']) ? (int)$g['maxPersons'] : 2,
            'status' => $status,
            'comment' => $r ? $r['comment'] : '',
            'submittedAt' => $r ? $r['submitted_at'] : null,
            'updatedAt' => $r ? $r['updated_at'] : null,
            'attendees' => $formattedAttendees
        ];
    }

    echo json_encode([
        'metrics' => [
            'totalInvitedParties' => count($guests),
            'confirmedParties' => $confirmedParties,
            'declinedParties' => $declinedParties,
            'pendingParties' => $pendingParties,
            'totalAttendingPersons' => $totalAttendingPersons
        ],
        'dishBreakdown' => array_values($dishCounts),
        'dietaryAlerts' => $dietaryAlerts,
        'guests' => $guestList
    ]);
    exit;
}

// 9. GET /api/admin/export/csv
if ($route === 'admin/export/csv' && $method === 'GET') {
    checkAdminAuth();

    $guests = loadGuests($dataDir);
    $menu = loadMenu($dataDir);
    $rsvps = $db->query('SELECT * FROM rsvps')->fetchAll();
    $attendees = $db->query('SELECT * FROM attendees')->fetchAll();

    $menuDishMap = [];
    if (!empty($menu['mains'])) {
        foreach ($menu['mains'] as $m) {
            $menuDishMap[$m['id']] = $m['name'] . ' (' . $m['tag'] . ')';
        }
    }

    $rsvpMap = [];
    foreach ($rsvps as $r) {
        $rsvpMap[strtoupper($r['code'])] = $r;
    }

    $attendeeMap = [];
    foreach ($attendees as $a) {
        $code = strtoupper($a['rsvp_code']);
        if (!isset($attendeeMap[$code])) $attendeeMap[$code] = [];
        $attendeeMap[$code][] = $a;
    }

    // UTF-8 BOM
    $csv = "\xEF\xBB\xBF";
    $csv .= "Code;Eingeladener Gast;Gruppe;Status;Person Name;Gericht;Allergien & Unverträglichkeiten;Kommentar;Datum\n";

    $sanitize = function($val) {
        $s = str_replace(['"', "\r", "\n"], ['""', '', ' '], (string)$val);
        return '"' . $s . '"';
    };

    foreach ($guests as $g) {
        $code = strtoupper($g['code']);
        $r = isset($rsvpMap[$code]) ? $rsvpMap[$code] : null;
        $attList = isset($attendeeMap[$code]) ? $attendeeMap[$code] : [];

        if (!$r) {
            $csv .= $sanitize($g['code']) . ';' . $sanitize($g['name']) . ';' . $sanitize(isset($g['group']) ? $g['group'] : '') . ';"Ausstehend";"";"";"";"";""' . "\n";
        } elseif ($r['status'] === 'declined') {
            $csv .= $sanitize($g['code']) . ';' . $sanitize($g['name']) . ';' . $sanitize(isset($g['group']) ? $g['group'] : '') . ';"Abgesagt";"";"";"";' . $sanitize($r['comment']) . ';' . $sanitize($r['updated_at'] ?: $r['submitted_at']) . "\n";
        } else {
            if (empty($attList)) {
                $csv .= $sanitize($g['code']) . ';' . $sanitize($g['name']) . ';' . $sanitize(isset($g['group']) ? $g['group'] : '') . ';"Zugesagt (ohne Personen)";"";"";"";' . $sanitize($r['comment']) . ';' . $sanitize($r['updated_at'] ?: $r['submitted_at']) . "\n";
            } else {
                foreach ($attList as $a) {
                    $dishName = isset($menuDishMap[$a['dish_id']]) ? $menuDishMap[$a['dish_id']] : ($a['dish_id'] ?: 'Keine Angabe');
                    $csv .= $sanitize($g['code']) . ';' . $sanitize($g['name']) . ';' . $sanitize(isset($g['group']) ? $g['group'] : '') . ';"Zugesagt";' . $sanitize($a['name']) . ';' . $sanitize($dishName) . ';' . $sanitize($a['dietary_notes']) . ';' . $sanitize($r['comment']) . ';' . $sanitize($r['updated_at'] ?: $r['submitted_at']) . "\n";
                }
            }
        }
    }

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="Hochzeit_Bert_Sabine_Gaeste_' . date('Y-m-d') . '.csv"');
    echo $csv;
    exit;
}

// 10. GET /api/admin/qrcodes
if ($route === 'admin/qrcodes' && $method === 'GET') {
    checkAdminAuth();

    $guests = loadGuests($dataDir);
    $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'hochzeit.bertundbine.de';
    $proto = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') ? 'https' : 'http';
    $baseUrl = $proto . '://' . $host;

    $qrList = [];
    foreach ($guests as $g) {
        $guestUrl = $baseUrl . '/?code=' . urlencode($g['code']);
        // Use standard high-quality QR code image generator URL
        $qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&color=111111&data=' . urlencode($guestUrl);
        $qrList[] = [
            'code' => $g['code'],
            'name' => $g['name'],
            'group' => isset($g['group']) ? $g['group'] : '',
            'url' => $guestUrl,
            'qrDataUrl' => $qrApiUrl
        ];
    }

    echo json_encode(['qrList' => $qrList]);
    exit;
}

// Fallback 404 for unknown API routes
http_response_code(404);
echo json_encode(['error' => 'API Endpoint nicht gefunden: ' . htmlspecialchars($route)]);
