<?php
// Dokumente zu einem Einsatz (ENT-117).
//
// Der Planer haengt ein PDF an, die eingeteilte Person oeffnet es in der App
// -- Objektplan, Verkehrsanordnung, Sicherheitskonzept.
//
// WARUM DER INHALT IN DER DATENBANK LIEGT und nicht im Dateisystem: Ein Pfad
// braucht ein Verzeichnis, das nicht ueber das Web erreichbar sein darf. Ob
// eine .htaccess auf dem Zielserver wirklich greift, sieht man erst, wenn sie
// es nicht tut -- und dann liegen Kundenunterlagen unter einer ratbaren
// Adresse offen. In der Datenbank gibt es keine Adresse: Der einzige Weg
// heraus fuehrt durch diesen Endpunkt, und der prueft die Rechte.
//
// GET  ?einsatz_id=X            Liste der Dokumente (ohne Inhalt)
// GET  ?id=Y                    das Dokument selbst, als Datei
// POST aktion=hochladen         {einsatz_id, dateiname, inhalt(base64)}
// POST aktion=entfernen         {id}
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../planung.php';

$user = require_session();
$pdo = db();

// 4 MB, nicht 5: Der Inhalt kommt als base64 im JSON an und waechst dabei um
// ein Drittel. 4 MB Datei sind rund 5.4 MB Anfrage -- das passt noch unter
// die ueblichen post_max_size von 8 MB. Mit 5 MB waeren es 6.7 MB, und der
// Upload schlueg erst beim echten Dokument fehl, nicht beim Ausprobieren.
const DOK_MAX = 4 * 1024 * 1024;

/**
 * Darf diese Person die Dokumente dieses Einsatzes sehen?
 *
 * Zwei Wege, und nur diese zwei: Wer plant, sieht alles. Wer auf dem Einsatz
 * eingeteilt ist, sieht die Dokumente dieses einen Einsatzes -- nicht die
 * anderer. Ohne die zweite Bedingung koennte jede angemeldete Person mit
 * geratener Nummer fremde Unterlagen abrufen.
 */
function dok_zugriff(PDO $pdo, array $user, int $einsatzId): bool {
    if (darf($user, 'plan')) { return true; }
    $s = $pdo->prepare('SELECT 1 FROM einsatz_zuteilung WHERE einsatz_id = ? AND mitarbeiter_id = ?');
    $s->execute([$einsatzId, (int)$user['id']]);
    return (bool)$s->fetchColumn();
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // ── Ein einzelnes Dokument ausliefern
    if (!empty($_GET['id'])) {
        $s = $pdo->prepare('SELECT einsatz_id, dateiname, mime, inhalt FROM einsatz_dokument WHERE id = ?');
        $s->execute([(int)$_GET['id']]);
        $d = $s->fetch();
        if (!$d || !dok_zugriff($pdo, $user, (int)$d['einsatz_id'])) {
            // Bewusst dieselbe Antwort fuer "gibt es nicht" und "darfst du
            // nicht": Sonst liesse sich durch Ausprobieren herausfinden,
            // welche Nummern belegt sind.
            json_response(['status' => 'error', 'message' => 'Nicht gefunden.'], 404);
        }
        header('Content-Type: application/pdf');
        // inline, nicht attachment: In der App soll es sich oeffnen lassen,
        // ohne den Umweg ueber den Download-Ordner.
        header('Content-Disposition: inline; filename="' . preg_replace('/[^\w.\- ]/u', '_', $d['dateiname']) . '"');
        header('Content-Length: ' . strlen($d['inhalt']));
        // Kein Ausfuehren im Browserkontext, auch wenn der Inhalt manipuliert waere.
        header('X-Content-Type-Options: nosniff');
        header('Content-Security-Policy: sandbox');
        echo $d['inhalt'];
        exit;
    }

    $einsatzId = (int)($_GET['einsatz_id'] ?? 0);
    if (!$einsatzId) {
        json_response(['status' => 'error', 'message' => 'einsatz_id fehlt.'], 422);
    }
    if (!dok_zugriff($pdo, $user, $einsatzId)) {
        json_response(['status' => 'error', 'message' => 'Kein Zugriff.'], 403);
    }
    // Ohne inhalt: Die Liste soll nicht bei jedem Aufruf Megabytes schleppen.
    $s = $pdo->prepare('SELECT id, dateiname, mime, groesse, hochgeladen_am
                        FROM einsatz_dokument WHERE einsatz_id = ? ORDER BY hochgeladen_am, id');
    $s->execute([$einsatzId]);
    json_response(['status' => 'ok', 'dokumente' => array_map(fn($d) => [
        'id' => (int)$d['id'], 'dateiname' => $d['dateiname'], 'mime' => $d['mime'],
        'groesse' => (int)$d['groesse'], 'hochgeladen_am' => $d['hochgeladen_am'],
    ], $s->fetchAll())]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

// Anhaengen und Entfernen ist Planung, nicht Ansehen.
require_recht($user, 'plan');

$in = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$aktion = (string)($in['aktion'] ?? '');

if ($aktion === 'entfernen') {
    $id = (int)($in['id'] ?? 0);
    $s = $pdo->prepare('SELECT einsatz_id FROM einsatz_dokument WHERE id = ?');
    $s->execute([$id]);
    $einsatzId = (int)$s->fetchColumn();
    if (!$einsatzId) {
        json_response(['status' => 'error', 'message' => 'Nicht gefunden.'], 404);
    }
    // Eine festgeschriebene Schicht bleibt unveraendert (ENT-045) -- ihre
    // Unterlagen gehoeren zur Grundlage der Feststellung.
    einsatz_sperre_pruefen($pdo, $einsatzId);
    $pdo->prepare('DELETE FROM einsatz_dokument WHERE id = ?')->execute([$id]);
    json_response(['status' => 'ok']);
}

if ($aktion !== 'hochladen') {
    json_response(['status' => 'error', 'message' => 'Unbekannte Aktion.'], 422);
}

$einsatzId = (int)($in['einsatz_id'] ?? 0);
if (!$einsatzId) {
    json_response(['status' => 'error', 'message' => 'einsatz_id fehlt.'], 422);
}
einsatz_sperre_pruefen($pdo, $einsatzId);

$roh = base64_decode((string)($in['inhalt'] ?? ''), true);
if ($roh === false || $roh === '') {
    json_response(['status' => 'error', 'message' => 'Die Datei liess sich nicht lesen.'], 422);
}
if (strlen($roh) > DOK_MAX) {
    json_response(['status' => 'error', 'message' => 'Höchstens 4 MB pro Dokument.'], 422);
}
// Auf den INHALT pruefen, nicht auf die Endung und nicht auf den vom Browser
// gemeldeten Typ: Beides kommt vom Client und laesst sich frei setzen. Ein
// PDF beginnt mit "%PDF-".
if (substr($roh, 0, 5) !== '%PDF-') {
    json_response(['status' => 'error', 'message' => 'Nur PDF-Dateien.'], 422);
}

// Der Dateiname wird angezeigt und in einen Header geschrieben -- er darf
// weder Pfadanteile noch Zeilenumbrueche enthalten.
$name = trim((string)($in['dateiname'] ?? 'dokument.pdf'));
$name = basename(str_replace('\\', '/', $name));
$name = preg_replace('/[\x00-\x1F\x7F]/u', '', $name);
if ($name === '' || strlen($name) > 200) { $name = 'dokument.pdf'; }

$s = $pdo->prepare('INSERT INTO einsatz_dokument (einsatz_id, dateiname, mime, groesse, inhalt, hochgeladen_von)
                    VALUES (?, ?, ?, ?, ?, ?)');
$s->execute([$einsatzId, $name, 'application/pdf', strlen($roh), $roh, (int)$user['id']]);
json_response(['status' => 'ok', 'id' => (int)$pdo->lastInsertId(), 'dateiname' => $name,
               'groesse' => strlen($roh)]);
