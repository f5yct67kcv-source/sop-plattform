<?php
declare(strict_types=1);
require __DIR__ . '/db.php';
require_once __DIR__ . '/anmeldung.php';   // PASSWORT_KOSTEN (ENT-075)
require_once __DIR__ . '/mitarbeiter.php';   // ma_nur_menschen() (ENT-631)

// Einmaliges Bootstrap: legt den ersten Admin-Account an. Sperrt sich danach
// selbst -- sobald ein Mitarbeiter existiert, tut dieses Skript nichts mehr.
// Kann danach auf dem Server bleiben, ist aber empfehlenswert, es via FTP
// zu loeschen, sobald der erste Admin-Account erstellt ist.

// Das Support-Konto zaehlt hier NICHT mit (ENT-631). Es entsteht bei der
// Einrichtung, also bevor der erste Admin angelegt wird -- wuerde es
// mitgezaehlt, haette sich dieses Bootstrap in jedem neuen Betrieb
// gesperrt, noch ehe ein Mensch darin war.
$count = (int)db()->query(
    'SELECT COUNT(*) AS c FROM mitarbeiter WHERE ' . ma_nur_menschen(db())
)->fetch()['c'];
if ($count > 0) {
    json_response(['status' => 'error', 'message' => 'bereits eingerichtet -- diese Datei kann geloescht werden'], 403);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST. Aufruf: {"name":"...", "password":"..."}'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$name = trim((string)($input['name'] ?? ''));
$password = (string)($input['password'] ?? '');

if ($name === '') {
    json_response(['status' => 'error', 'message' => 'Name erforderlich'], 400);
}
// Dieselbe Regel wie ueberall sonst (ENT-502). Bis hierher stand hier ein
// eigenes "strlen < 6" -- und damit entstand ausgerechnet das ERSTE Konto
// der Anlage, das per Definition ein Verwaltungszugang ist (ist_admin = 1
// weiter unten), an der Passwortregel vorbei. Aufgefallen beim
// Zurueckdrehen der Erprobungs-Absenkung: test_passwortfelder.mjs
// beanstandete den Text in setup.html, und dahinter lag die Pruefung, die
// es gar nicht gab.
//
// istAdmin = true, weil dieses Konto eines ist. Damit gilt hier
// PASSWORT_MIN_ADMIN, nicht die kuerzere Laenge. passwort_pruefen() kommt
// aus anmeldung.php, das oben ohnehin schon fuer PASSWORT_KOSTEN
// eingebunden ist.
$pwFehler = passwort_pruefen($password, $name, true);
if ($pwFehler !== null) {
    json_response(['status' => 'error', 'message' => $pwFehler], 400);
}

$hash = password_hash($password, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN]);
// Personalnummer gleich mit (ENT-684): Bis hierher bekam das Erstkonto
// eines neuen Betriebs KEINE -- als einziger Anlegeweg neben
// mitarbeiter_create.php, das seit ENT-387 immer eine vergibt. Bei jedem
// neuen Mandanten entstand damit genau eine Person ohne Nummer, und dafuer
// gab es einen eigenen Nachtrags-Bildschirm. Die Luecke gehoert hierher
// geschlossen, nicht hinterher aufgeraeumt.
$stmt = db()->prepare(
    'INSERT INTO mitarbeiter (name, password_hash, ist_admin, personalnummer) VALUES (?, ?, 1, ?)'
);
$stmt->execute([$name, $hash, ma_personalnummer_generieren(db())]);

json_response(['status' => 'ok', 'message' => 'Admin-Account erstellt. Diese Datei jetzt loeschen.']);
