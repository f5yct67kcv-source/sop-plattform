<?php
// Ansprechpartner AM OBJEKT (ENT-300) -- lesen und speichern.
//
// GET  ?objekt_id=N  -> { status, personen: [...], kontaktwege: [...] }
// POST { objekt_id, personen: [...], kontaktwege: [...] }
//
// Speichern ersetzt den Bestand eines Objekts VOLLSTAENDIG -- dasselbe
// Vorgehen wie bei den Kunden-Ansprechpartnern (backend/kunden.php) und bei
// der Einsatz-Zuteilung (ENT-020): Das Formular schickt den gewuenschten
// Endzustand, nicht einzelne Aenderungsbefehle. Das ist der Grund, warum es
// hier keine Einzel-Endpunkte zum Anlegen/Loeschen braucht.
//
// Eigener Endpunkt statt einer Erweiterung von objekt_save.php: Jenes
// speichert die Stammdaten aus einem anderen Formular, das die
// Ansprechpartner gar nicht kennt. Ein gemeinsamer Weg wuerde beim Speichern
// der Stammdaten die hier nicht mitgeschickten Personen loeschen -- genau
// der Fehler, den betrieb.php mit seinen getrennten Zweigen vermeidet
// (ENT-245).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'plan');

const OP_WEG_ARTEN = ['telefon', 'mobil', 'email', 'webseite', 'fax'];

function op_tabellen_da(PDO $pdo): bool {
    return hat_tabelle($pdo, 'objekt_person') && hat_tabelle($pdo, 'objekt_kontaktweg');
}

// Nur bekannte Arten und nur nicht-leere Werte. Eine leere Zeile entsteht im
// Formular bei jedem "Weitere Kontaktmoeglichkeit hinzufuegen" und darf nicht
// als gepflegter Kontaktweg in der Datenbank landen -- in der App stuende
// sonst eine Zeile, die man antippen kann und die nirgendwohin fuehrt.
function op_wege_saeubern(array $roh): array {
    $sauber = [];
    foreach ($roh as $w) {
        $art = (string)($w['art'] ?? '');
        $wert = trim((string)($w['wert'] ?? ''));
        if ($wert === '' || !in_array($art, OP_WEG_ARTEN, true)) { continue; }
        if (mb_strlen($wert) > 255) { $wert = mb_substr($wert, 0, 255); }
        $sauber[] = ['art' => $art, 'wert' => $wert];
    }
    return $sauber;
}

function op_lesen(PDO $pdo, int $objektId): array {
    if (!op_tabellen_da($pdo)) { return ['personen' => [], 'kontaktwege' => []]; }

    $wege = [];
    $wStmt = $pdo->prepare(
        'SELECT person_id, art, wert FROM objekt_kontaktweg
          WHERE objekt_id = ? ORDER BY sortierung, id'
    );
    $wStmt->execute([$objektId]);
    foreach ($wStmt->fetchAll(PDO::FETCH_ASSOC) as $w) {
        $schluessel = $w['person_id'] === null ? 'objekt' : (string)(int)$w['person_id'];
        $wege[$schluessel][] = ['art' => $w['art'], 'wert' => $w['wert']];
    }

    $pStmt = $pdo->prepare(
        'SELECT id, anrede, vorname, nachname, funktion FROM objekt_person
          WHERE objekt_id = ? ORDER BY sortierung, id'
    );
    $pStmt->execute([$objektId]);
    $personen = [];
    foreach ($pStmt->fetchAll(PDO::FETCH_ASSOC) as $p) {
        $personen[] = [
            'id'          => (int)$p['id'],
            'anrede'      => $p['anrede'],
            'vorname'     => $p['vorname'],
            'nachname'    => $p['nachname'],
            'funktion'    => $p['funktion'],
            'kontaktwege' => $wege[(string)(int)$p['id']] ?? [],
        ];
    }
    return ['personen' => $personen, 'kontaktwege' => $wege['objekt'] ?? []];
}

$objektId = (int)($_SERVER['REQUEST_METHOD'] === 'GET'
    ? ($_GET['objekt_id'] ?? 0)
    : 0);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if ($objektId <= 0) {
        json_response(['status' => 'error', 'message' => 'objekt_id erforderlich'], 422);
    }
    json_response(['status' => 'ok'] + op_lesen(db(), $objektId));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

$in = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$objektId = (int)($in['objekt_id'] ?? 0);
if ($objektId <= 0) {
    json_response(['status' => 'error', 'message' => 'objekt_id erforderlich'], 422);
}

$pdo = db();
if (!op_tabellen_da($pdo)) {
    json_response(['status' => 'error',
        'message' => 'Die Tabellen für Objekt-Ansprechpartner fehlen noch — bitte einmal „Einrichtung“ ausführen.'], 409);
}

// Das Objekt muss es geben: Sonst legte ein Tippfehler in der objekt_id
// Kontakte an, die niemand je wiedersieht (der Fremdschluessel faenge es
// zwar ab, aber mit einer Fehlermeldung, die nichts erklaert).
$chk = $pdo->prepare('SELECT COUNT(*) FROM objekte WHERE id = ?');
$chk->execute([$objektId]);
if ((int)$chk->fetchColumn() === 0) {
    json_response(['status' => 'error', 'message' => 'Dieses Objekt gibt es nicht (mehr)'], 404);
}

$pdo->beginTransaction();
try {
    // Wege zuerst loeschen: Sie haengen per Fremdschluessel an der Person und
    // verschwinden mit ihr -- aber die objektweiten (person_id NULL) nicht,
    // die muessen eigens weg.
    $pdo->prepare('DELETE FROM objekt_kontaktweg WHERE objekt_id = ?')->execute([$objektId]);
    $pdo->prepare('DELETE FROM objekt_person WHERE objekt_id = ?')->execute([$objektId]);

    $wegEin = $pdo->prepare(
        'INSERT INTO objekt_kontaktweg (objekt_id, person_id, art, wert, sortierung) VALUES (?, ?, ?, ?, ?)'
    );
    foreach (op_wege_saeubern($in['kontaktwege'] ?? []) as $i => $w) {
        $wegEin->execute([$objektId, null, $w['art'], $w['wert'], $i]);
    }

    $personEin = $pdo->prepare(
        'INSERT INTO objekt_person (objekt_id, anrede, vorname, nachname, funktion, sortierung)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $nr = 0;
    foreach (($in['personen'] ?? []) as $p) {
        $vorname  = trim((string)($p['vorname'] ?? ''));
        $nachname = trim((string)($p['nachname'] ?? ''));
        $funktion = trim((string)($p['funktion'] ?? ''));
        $wege     = op_wege_saeubern($p['kontaktwege'] ?? []);
        // Eine Person ohne jede Angabe ist die leere Zeile aus dem Formular,
        // keine Ansprechperson. Eine Person NUR mit Funktion und Nummer
        // ("Hauswart", ohne Namen) ist dagegen gueltig und brauchbar -- die
        // Nummer ist das, was zaehlt.
        if ($vorname === '' && $nachname === '' && $funktion === '' && !$wege) { continue; }
        $personEin->execute([$objektId,
            trim((string)($p['anrede'] ?? '')) ?: null,
            $vorname ?: null, $nachname ?: null, $funktion ?: null, $nr++]);
        $personId = (int)$pdo->lastInsertId();
        foreach ($wege as $j => $w) {
            $wegEin->execute([$objektId, $personId, $w['art'], $w['wert'], $j]);
        }
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

json_response(['status' => 'ok'] + op_lesen($pdo, $objektId));
