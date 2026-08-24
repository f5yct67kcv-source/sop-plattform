<?php
// Legt einen Einsatz an oder aendert ihn (ENT-020). Ohne "id" wird angelegt,
// mit "id" geaendert -- die Zuteilung wird in beiden Faellen vollstaendig
// durch die uebergebene Liste ersetzt.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'plan');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];

$id         = isset($input['id']) ? (int)$input['id'] : 0;
$kundeName  = trim((string)($input['kunde_name'] ?? ''));
$kundeId    = isset($input['kunde_id']) && $input['kunde_id'] !== '' ? (int)$input['kunde_id'] : null;
$titel      = trim((string)($input['titel'] ?? '')) ?: null;
$strasse    = trim((string)($input['strasse'] ?? '')) ?: null;
$ort        = trim((string)($input['ort'] ?? ''));
$einsatzart = trim((string)($input['einsatzart'] ?? '')) ?: 'Verkehrsdienst';
// Hier ist die Sparte verbindlich -- danach wird gefiltert und getrennt (ENT-037).
$sparte     = sparte_pruefen($input['sparte'] ?? null);
$datum      = trim((string)($input['datum'] ?? ''));
$von        = trim((string)($input['von'] ?? ''));
$bis        = trim((string)($input['bis'] ?? ''));
$bedarf     = (int)($input['bedarf'] ?? 1);
$status     = trim((string)($input['status'] ?? 'geplant'));
$bemerkung  = trim((string)($input['bemerkung'] ?? '')) ?: null;
// ENT-115. Diese Felder gab es in der Datenbank laengst und die
// Einsatzplan-Ansicht zeigte sie an -- erfassen liess sich keines davon.
// Ein Anzeigepfad ohne Eingabepfad zeigt immer nur einen Strich.
$kanton     = strtoupper(trim((string)($input['kanton'] ?? ''))) ?: null;
$veranst    = trim((string)($input['veranstaltung'] ?? '')) ?: null;
$treffpunkt = trim((string)($input['treffpunkt'] ?? '')) ?: null;
$taetigkeit = trim((string)($input['taetigkeit'] ?? '')) ?: null;
$qualifik   = trim((string)($input['qualifikation'] ?? '')) ?: null;
$kVorname   = trim((string)($input['kontakt_vorname'] ?? '')) ?: null;
$kNachname  = trim((string)($input['kontakt_nachname'] ?? '')) ?: null;
$kTelefon   = trim((string)($input['kontakt_telefon'] ?? '')) ?: null;
if ($kanton !== null && !preg_match('/^[A-Z]{2}$/', $kanton)) {
    json_response(['status' => 'error', 'message' => 'Kanton als zweistelliges Kuerzel, z. B. SO'], 400);
}

// Eine abgeglichene Schicht ist festgeschrieben (ENT-045) -- der Plan darf
// die Grundlage einer bereits bestaetigten Feststellung nicht rueckwirkend
// verschieben.
if ($id > 0) { einsatz_sperre_pruefen(db(), $id); }

if ($kundeName === '' || $ort === '' || $datum === '' || $von === '' || $bis === '') {
    json_response(['status' => 'error', 'message' => 'Kunde, Arbeitsort, Datum, Von und Bis erforderlich'], 400);
}
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $datum)) {
    json_response(['status' => 'error', 'message' => 'Datum im Format JJJJ-MM-TT erforderlich'], 400);
}
if (!preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $von) || !preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $bis)) {
    json_response(['status' => 'error', 'message' => 'Zeiten im Format HH:MM erforderlich'], 400);
}
// provisorisch: aus einer Masterschicht "auf Abruf" entstanden, zaehlt nicht
// als offene Stelle (ENT-021).
if (!in_array($status, ['geplant', 'bestaetigt', 'abgesagt', 'provisorisch'], true)) {
    json_response(['status' => 'error', 'message' => 'unbekannter Status'], 400);
}
if ($bedarf < 0 || $bedarf > 99) {
    json_response(['status' => 'error', 'message' => 'Bedarf zwischen 0 und 99'], 400);
}

// Kunde nur verknuepfen, wenn er wirklich existiert -- sonst bleibt der Name
// als reine Textangabe stehen.
if ($kundeId !== null) {
    $chk = db()->prepare('SELECT id FROM kunden WHERE id = ?');
    $chk->execute([$kundeId]);
    if (!$chk->fetch()) {
        $kundeId = null;
    }
}

// Nur aktive Mitarbeitende lassen sich zuteilen.
$gewuenscht = array_values(array_unique(array_map('intval', (array)($input['mitarbeiter'] ?? []))));
$zuteilung = [];
if ($gewuenscht) {
    $platzhalter = implode(',', array_fill(0, count($gewuenscht), '?'));
    $stmt = db()->prepare("SELECT id FROM mitarbeiter WHERE aktiv = 1 AND id IN ($platzhalter)");
    $stmt->execute($gewuenscht);
    $zuteilung = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}

// Niemand darf zur selben Zeit an zwei Orten sein (ENT-022). Die Pruefung
// gehoert hierher und nicht nur in die Oberflaeche -- ein Aufruf am Browser
// vorbei wuerde sie sonst umgehen.
// Umplanung (ENT-060): Wer hier ausdruecklich genannt ist, wird aus den
// kollidierenden Schichten entfernt statt abgewiesen. Der Aufruf muss die
// Namen einzeln nennen -- ein pauschales "mach schon" gibt es nicht, damit
// niemand versehentlich eine ganze Mannschaft umdisponiert.
$umplanen = array_values(array_unique(array_map('intval', (array)($input['umplanen'] ?? []))));

if ($zuteilung) {
    $doppelt = doppelbelegungen($id, $datum, $von, $bis, $zuteilung);
    if ($doppelt && $umplanen) {
        $pdoU = db();
        $pdoU->beginTransaction();
        try {
            $blockiert = umplanen($pdoU, $doppelt, $umplanen);
            $pdoU->commit();
        } catch (Throwable $e) {
            $pdoU->rollBack();
            throw $e;
        }
        if ($blockiert) {
            $namen = [];
            foreach ($blockiert as $d) {
                $namen[$d['name']] = $d['name'] . ': ' . $d['was'] . ' ist bereits abgeglichen';
            }
            json_response([
                'status' => 'error',
                'gesperrt' => true,
                'message' => 'Umplanen nicht moeglich — ' . implode(' — ', $namen)
                    . '. Dort steht bereits geleistete Zeit; zuerst unter Abgleich die Sperre aufheben.',
                'doppelbelegung' => array_values($blockiert),
            ], 409);
        }
        // Nach dem Umplanen ist der Weg frei.
        $doppelt = doppelbelegungen($id, $datum, $von, $bis, $zuteilung);
    }
    if ($doppelt) {
        $namen = [];
        foreach ($doppelt as $d) {
            $namen[$d['name']] = $d['name'] . ' ist am ' . date('d.m.Y', strtotime($d['datum']))
                . ' bereits eingeteilt: ' . $d['was'];
        }
        json_response([
            'status' => 'error',
            'message' => 'Doppelbelegung: ' . implode(' — ', $namen),
            'doppelbelegung' => array_values($doppelt),
        ], 409);
    }
}

$pdo = db();
$pdo->beginTransaction();
try {
    if ($id > 0) {
        $stmt = $pdo->prepare(
            'UPDATE einsaetze SET kunde_id = ?, kunde_name = ?, titel = ?, strasse = ?, ort = ?,
                    kanton = ?, einsatzart = ?, sparte = ?, datum = ?, von = ?, bis = ?, bedarf = ?,
                    status = ?, bemerkung = ?, veranstaltung = ?, treffpunkt = ?, taetigkeit = ?,
                    qualifikation = ?, kontakt_vorname = ?, kontakt_nachname = ?, kontakt_telefon = ?
             WHERE id = ?'
        );
        $stmt->execute([$kundeId, $kundeName, $titel, $strasse, $ort, $kanton, $einsatzart, $sparte,
            $datum, $von, $bis, $bedarf, $status, $bemerkung, $veranst, $treffpunkt, $taetigkeit,
            $qualifik, $kVorname, $kNachname, $kTelefon, $id]);
        if ($stmt->rowCount() === 0) {
            // Kein Treffer heisst entweder "gibt es nicht" oder "nichts geaendert" --
            // die Existenz wird darum ausdruecklich geprueft.
            $chk = $pdo->prepare('SELECT id FROM einsaetze WHERE id = ?');
            $chk->execute([$id]);
            if (!$chk->fetch()) {
                $pdo->rollBack();
                json_response(['status' => 'error', 'message' => 'Einsatz nicht gefunden'], 404);
            }
        }
        $pdo->prepare('DELETE FROM einsatz_zuteilung WHERE einsatz_id = ?')->execute([$id]);
    } else {
        $stmt = $pdo->prepare(
            'INSERT INTO einsaetze (kunde_id, kunde_name, titel, strasse, ort, kanton, einsatzart, sparte,
                                    datum, von, bis, bedarf, status, bemerkung, veranstaltung,
                                    treffpunkt, taetigkeit, qualifikation,
                                    kontakt_vorname, kontakt_nachname, kontakt_telefon, erstellt_von)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$kundeId, $kundeName, $titel, $strasse, $ort, $kanton, $einsatzart, $sparte,
            $datum, $von, $bis, $bedarf, $status, $bemerkung, $veranst, $treffpunkt, $taetigkeit,
            $qualifik, $kVorname, $kNachname, $kTelefon, (int)$user['id']]);
        $id = (int)$pdo->lastInsertId();
    }

    if ($zuteilung) {
        $ins = $pdo->prepare('INSERT INTO einsatz_zuteilung (einsatz_id, mitarbeiter_id) VALUES (?, ?)');
        foreach ($zuteilung as $mid) {
            $ins->execute([$id, $mid]);
        }
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    // Die einheitliche Fehlerbehandlung in db.php formuliert die Meldung --
    // so erfaehrt der Admin z.B., dass eine Tabelle noch fehlt.
    throw $e;
}

json_response(['status' => 'ok', 'id' => $id, 'zugeteilt' => count($zuteilung)]);
