<?php
// Positionen eines Einsatzes (ENT-076).
//
// Bis hierher hatte ein Einsatz eine Zeit und eine Anzahl. Damit laesst sich
// nicht abbilden, dass vier Leute gestaffelt arbeiten -- einer 21:00-01:00,
// zwei bis 02:00, einer ab 02:00 bis zum Schluss. Jede Position traegt darum
// ihre eigene Zeit, Funktion und Verrechnung; die Person haengt an der
// Position statt am Einsatz.
//
// Ein Einsatz ohne Positionen bleibt gueltig: dann gilt seine eigene Zeit fuer
// alle und "bedarf" sagt, wie viele gebraucht werden.
//
// GET  ?einsatz_id=X   liefert die Positionen samt zugeteilter Person
// POST aktion=speichern|entfernen|zuteilen|loesen|sperren
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
// einsatz_sperre_pruefen() -- eine abgeglichene Schicht ist festgeschrieben
// (ENT-045). Ohne diese Einbindung liesse sich der Plan einer Schicht
// nachtraeglich umbauen, deren Ist-Zeiten jemand bereits geprueft und
// bestaetigt hat.
require_once __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'plan');

$pdo = db();

/** Positionen eines Einsatzes, jeweils mit der zugeteilten Person. */
function positionen(PDO $pdo, int $einsatzId): array {
    $s = $pdo->prepare(
        'SELECT p.*, z.mitarbeiter_id, z.zusage, z.gesehen_am, m.name AS ma_name, m.vorname, m.nachname
         FROM einsatz_position p
         LEFT JOIN einsatz_zuteilung z ON z.position_id = p.id
         LEFT JOIN mitarbeiter m ON m.id = z.mitarbeiter_id
         WHERE p.einsatz_id = ?
         ORDER BY p.nr, p.von, p.id'
    );
    $s->execute([$einsatzId]);
    return array_map(function ($p) {
        return [
            'id' => (int)$p['id'],
            'nr' => (int)$p['nr'],
            'funktion' => $p['funktion'],
            // Keine Arbeitszeit (Art. 18 Ziff. 2). Die Oberflaeche nimmt sie
            // darum aus Soll und Ist heraus.
            'ist_fahrzeit' => (int)$p['ist_fahrzeit'],
            'position' => $p['position'],
            'von' => $p['von'],
            'bis' => $p['bis'],
            // NULL bleibt NULL: 'noch nicht entschieden' ist nicht dasselbe
            // wie 0.00 CHF.
            'std_verrechnung' => $p['std_verrechnung'] === null ? null : (float)$p['std_verrechnung'],
            'pauschal' => $p['pauschal'] === null ? null : (float)$p['pauschal'],
            'qualifikation' => $p['qualifikation'],
            'gesperrt' => (int)$p['gesperrt'],
            'bemerkung' => $p['bemerkung'],
            'mitarbeiter_id' => $p['mitarbeiter_id'] === null ? null : (int)$p['mitarbeiter_id'],
            'mitarbeiter' => $p['ma_name'],
            'vorname' => $p['vorname'],
            'nachname' => $p['nachname'],
            'zusage' => $p['zusage'],
            // Wann die Person die Schicht in der App geoeffnet hat (ENT-113).
            'gesehen_am' => $p['gesehen_am'],
        ];
    }, $s->fetchAll());
}

function einsatz_oder_ende(PDO $pdo, int $id): array {
    $s = $pdo->prepare('SELECT id, datum, von, bis, bedarf, einsatzart FROM einsaetze WHERE id = ?');
    $s->execute([$id]);
    $e = $s->fetch();
    if (!$e) {
        json_response(['status' => 'error', 'message' => 'Einsatz nicht gefunden.'], 404);
    }
    return $e;
}

/**
 * Sobald ein Einsatz Positionen hat, ist ihre Anzahl die Wahrheit -- 'bedarf'
 * wird mitgeschrieben statt danebengehalten.
 *
 * Grund: Beide Zahlen beantworten dieselbe Frage ("wie viele Leute braucht
 * dieser Einsatz"), und sie stehen an verschiedenen Stellen der Oberflaeche --
 * die Liste und die Kacheln lesen 'bedarf', das Raster zaehlt Positionen.
 * Zwei Quellen fuer dieselbe Aussage laufen frueher oder spaeter auseinander,
 * und dann zeigt die Liste "1/2", waehrend im Raster drei Zeilen stehen.
 * Darum genau eine Stelle, an der nachgefuehrt wird: hier.
 */
function bedarf_nachfuehren(PDO $pdo, int $einsatzId): void {
    $pdo->prepare(
        'UPDATE einsaetze SET bedarf = (SELECT COUNT(*) FROM einsatz_position WHERE einsatz_id = ?) WHERE id = ?'
    )->execute([$einsatzId, $einsatzId]);
}

/**
 * Minuten seit Einsatzbeginn. Dieselbe Rechnung wie in der Oberflaeche:
 * Endet die Schicht am Folgetag, laeuft die Achse ueber Mitternacht weiter --
 * 22:00 bis 06:00 sind acht Stunden, nicht minus sechzehn.
 */
function minuten_ab(string $zeit, int $start): int {
    [$h, $m] = array_map('intval', explode(':', substr($zeit, 0, 5)));
    $min = $h * 60 + $m - $start;
    return $min < 0 ? $min + 1440 : $min;
}

/**
 * Eine Position liegt innerhalb ihres Einsatzes -- ihr Beginn jedenfalls;
 * ihr Ende darf darueber hinausgehen (die Achse waechst mit).
 *
 * Warum nicht einfach "von >= Einsatzbeginn" im Uhrzeitvergleich: Bei einer
 * Schicht ueber Mitternacht (22:00-06:00) ist 00:30 spaeter als 22:00, obwohl
 * die Zahl kleiner ist. Gerechnet wird darum in Minuten ab Einsatzbeginn.
 *
 * Ohne diese Pruefung liesse sich eine Position auf 07:00 setzen, wo der
 * Einsatz um 07:30 beginnt -- die Oberflaeche zeichnete den Balken dann bei
 * 23,5 Stunden statt eine halbe Stunde davor, weil sie den negativen Wert als
 * "am Folgetag" deutet.
 */
function zeitfenster_pruefen(array $einsatz, string $von, string $bis): void {
    [$sh, $sm] = array_map('intval', explode(':', substr((string)$einsatz['von'], 0, 5)));
    $start = $sh * 60 + $sm;
    $dauer = minuten_ab((string)$einsatz['bis'], $start) ?: 1440;
    $a = minuten_ab($von, $start);
    $b = minuten_ab($bis, $start) ?: 1440;
    if ($a >= $dauer) {
        json_response(['status' => 'error',
            'message' => 'Die Schicht beginnt ausserhalb des Einsatzes. Zuerst die Zeit des Einsatzes anpassen.'], 422);
    }
    if ($b <= $a) {
        json_response(['status' => 'error', 'message' => 'Das Ende muss nach dem Beginn liegen.'], 422);
    }
}

function zeit_oder_ende(string $wert, string $feld): string {
    if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/', $wert)) {
        json_response(['status' => 'error', 'message' => "$feld ist keine gültige Uhrzeit."], 422);
    }
    return substr($wert, 0, 5) . ':00';
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $einsatzId = (int)($_GET['einsatz_id'] ?? 0);
    if (!$einsatzId) {
        json_response(['status' => 'error', 'message' => 'einsatz_id fehlt.'], 422);
    }
    $einsatz = einsatz_oder_ende($pdo, $einsatzId);
    json_response([
        'status' => 'ok',
        'einsatz' => ['id' => (int)$einsatz['id'], 'datum' => $einsatz['datum'],
                      'von' => $einsatz['von'], 'bis' => $einsatz['bis'],
                      'bedarf' => (int)$einsatz['bedarf']],
        'positionen' => positionen($pdo, $einsatzId),
    ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

$in = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$aktion = (string)($in['aktion'] ?? '');
$einsatzId = (int)($in['einsatz_id'] ?? 0);
if (!$einsatzId) {
    json_response(['status' => 'error', 'message' => 'einsatz_id fehlt.'], 422);
}
$einsatz = einsatz_oder_ende($pdo, $einsatzId);

// ── Festgeschriebene Schichten sind unveraenderlich (ENT-045) ──────────
//
// EINE Stelle fuer alle fuenf schreibenden Aktionen -- speichern, entfernen,
// sperren, zuteilen, loesen. Vor der neuen Einsatzplan-Ansicht lief jede
// Aenderung ueber einsatz_save.php oder einsatz_zuteilen.php, und beide
// pruefen das seit ENT-045. Ueber die Positionen gab es diesen Weg noch
// nicht: Damit liess sich der Plan einer bereits abgeglichenen Schicht
// nachtraeglich umbauen -- Positionen verschieben, Personen zuteilen oder
// loesen -- obwohl genau das die Grundlage einer Feststellung veraendert,
// die jemand geprueft und bestaetigt hat.
//
// Die Pruefung gehoert hierher und nicht in die Oberflaeche: Eine Sperre,
// die man am Browser vorbei umgehen kann, ist keine (planung.php, ENT-045).
//
// Das Lesen bleibt erlaubt -- eine festgeschriebene Schicht darf man
// ansehen, nur nicht mehr aendern.
einsatz_sperre_pruefen($pdo, $einsatzId);

// ── Positionen aus dem Bedarf anlegen ────────────────────────────────────
//
// Ein Einsatz sagt mit 'bedarf', wie viele Leute er braucht. Bis hierher war
// das nur eine Zahl: Wer die Planungsansicht oeffnete, fand ein leeres Raster
// und musste jede Zeile einzeln anlegen -- obwohl die Anzahl laengst feststand.
//
// Diese Aktion legt darum beim ersten Oeffnen so viele Positionen an, wie der
// Einsatz braucht, jede mit seiner eigenen Zeit. Verschoben, gestaffelt und
// umbenannt wird danach.
//
// Sie legt NUR an, wo noch gar keine Position steht. Ein Einsatz, an dem
// schon geplant wurde, wird nicht angefasst -- sonst kaeme bei jedem Oeffnen
// eine Zeile dazu.
if ($aktion === 'aus_bedarf') {
    $vorhanden = $pdo->prepare('SELECT COUNT(*) FROM einsatz_position WHERE einsatz_id = ?');
    $vorhanden->execute([$einsatzId]);
    if ((int)$vorhanden->fetchColumn() > 0) {
        json_response(['status' => 'ok', 'positionen' => positionen($pdo, $einsatzId)]);
    }

    // Wer bereits am Einsatz steht, bekommt einen Platz. Zuteilungen aus der
    // Zeit vor den Positionen tragen position_id = NULL; ohne diesen Schritt
    // waeren sie im Raster unsichtbar, obwohl die Person eingeteilt ist.
    $z = $pdo->prepare('SELECT id FROM einsatz_zuteilung WHERE einsatz_id = ? ORDER BY id');
    $z->execute([$einsatzId]);
    $zuteilungen = $z->fetchAll(PDO::FETCH_COLUMN);

    // Mindestens so viele Plaetze wie zugeteilte Personen -- eine eingeteilte
    // Person darf nie herausfallen, auch wenn 'bedarf' kleiner ist.
    $anzahl = max((int)$einsatz['bedarf'], count($zuteilungen));
    if ($anzahl < 1) {
        json_response(['status' => 'ok', 'positionen' => []]);
    }

    // Die Funktion kommt aus der Einsatzart: ein Verkehrsdienst-Einsatz
    // erzeugt Verkehrsdienst-Positionen, nicht irgendeine Vorgabe.
    $funktion = trim((string)($einsatz['einsatzart'] ?? '')) ?: null;

    $ins = $pdo->prepare('INSERT INTO einsatz_position (einsatz_id, nr, funktion, von, bis) VALUES (?, ?, ?, ?, ?)');
    $setz = $pdo->prepare('UPDATE einsatz_zuteilung SET position_id = ? WHERE id = ?');
    $pdo->beginTransaction();
    for ($i = 0; $i < $anzahl; $i++) {
        $ins->execute([$einsatzId, $i + 1, $funktion, $einsatz['von'], $einsatz['bis']]);
        if (isset($zuteilungen[$i])) {
            $setz->execute([(int)$pdo->lastInsertId(), (int)$zuteilungen[$i]]);
        }
    }
    $pdo->commit();
    bedarf_nachfuehren($pdo, $einsatzId);
    json_response(['status' => 'ok', 'positionen' => positionen($pdo, $einsatzId)]);
}

if ($aktion === 'speichern') {
    $id = (int)($in['id'] ?? 0);
    // Ohne eigene Zeit gilt die des Einsatzes -- so entsteht aus einem Klick
    // eine brauchbare Position, die man danach verschiebt.
    $von = zeit_oder_ende((string)($in['von'] ?? $einsatz['von']), 'Von');
    $bis = zeit_oder_ende((string)($in['bis'] ?? $einsatz['bis']), 'Bis');
    // Zweite Verteidigung, nicht die einzige: Die Oberflaeche prueft dasselbe,
    // damit die Begruendung sofort dasteht. Eine Regel, die man am Browser
    // vorbei umgehen kann, ist keine.
    // Eine Fahrzeit-Position liegt naturgemaess VOR dem Einsatz (Hinfahrt)
    // oder danach (Rueckfahrt) -- sie ist von der Fensterpruefung ausgenommen.
    // Die Zeitachse traegt das, weil sie den Vorlauf aus weg_minuten kennt.
    if (empty($in['ist_fahrzeit'])) {
        zeitfenster_pruefen($einsatz, $von, $bis);
    }

    $zahl = function ($w) {
        if ($w === null || $w === '') return null;
        return round((float)$w, 2);
    };
    $felder = [
        'funktion' => trim((string)($in['funktion'] ?? '')) ?: null,
        'ist_fahrzeit' => !empty($in['ist_fahrzeit']) ? 1 : 0,
        'position' => trim((string)($in['position'] ?? '')) ?: null,
        'von' => $von,
        'bis' => $bis,
        'std_verrechnung' => $zahl($in['std_verrechnung'] ?? null),
        'pauschal' => $zahl($in['pauschal'] ?? null),
        'qualifikation' => trim((string)($in['qualifikation'] ?? '')) ?: null,
        'bemerkung' => trim((string)($in['bemerkung'] ?? '')) ?: null,
    ];

    if ($id) {
        $sql = 'UPDATE einsatz_position SET ' .
               implode(', ', array_map(fn($f) => "$f = ?", array_keys($felder))) .
               ' WHERE id = ? AND einsatz_id = ?';
        $s = $pdo->prepare($sql);
        $s->execute([...array_values($felder), $id, $einsatzId]);
    } else {
        // Neue Position hinten anstellen.
        $n = $pdo->prepare('SELECT COALESCE(MAX(nr), 0) + 1 FROM einsatz_position WHERE einsatz_id = ?');
        $n->execute([$einsatzId]);
        $felder['nr'] = (int)$n->fetchColumn();
        $felder['einsatz_id'] = $einsatzId;
        $sql = 'INSERT INTO einsatz_position (' . implode(', ', array_keys($felder)) . ') VALUES (' .
               implode(', ', array_fill(0, count($felder), '?')) . ')';
        $s = $pdo->prepare($sql);
        $s->execute(array_values($felder));
        $id = (int)$pdo->lastInsertId();
        bedarf_nachfuehren($pdo, $einsatzId);
    }
    json_response(['status' => 'ok', 'id' => $id, 'positionen' => positionen($pdo, $einsatzId)]);
}

// Eine Schicht verdoppeln: gleiche Zeit, gleiche Funktion, gleiche
// Verrechnung -- nur ohne die Person. Wer vier gleiche Plaetze braucht,
// stellt einen davon ein und klont ihn, statt viermal dasselbe zu tippen.
if ($aktion === 'klonen') {
    $id = (int)($in['id'] ?? 0);
    $q = $pdo->prepare('SELECT * FROM einsatz_position WHERE id = ? AND einsatz_id = ?');
    $q->execute([$id, $einsatzId]);
    $p = $q->fetch();
    if (!$p) {
        json_response(['status' => 'error', 'message' => 'Schicht nicht gefunden.'], 404);
    }
    $n = $pdo->prepare('SELECT COALESCE(MAX(nr), 0) + 1 FROM einsatz_position WHERE einsatz_id = ?');
    $n->execute([$einsatzId]);
    $pdo->prepare(
        'INSERT INTO einsatz_position (einsatz_id, nr, funktion, position, von, bis,
                                       std_verrechnung, pauschal, qualifikation, bemerkung)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([$einsatzId, (int)$n->fetchColumn(), $p['funktion'], $p['position'], $p['von'], $p['bis'],
                $p['std_verrechnung'], $p['pauschal'], $p['qualifikation'], $p['bemerkung']]);
    bedarf_nachfuehren($pdo, $einsatzId);
    json_response(['status' => 'ok', 'positionen' => positionen($pdo, $einsatzId)]);
}

if ($aktion === 'entfernen') {
    $id = (int)($in['id'] ?? 0);
    // Die Zuteilung wird nicht mitgeloescht, sondern nur von der Position
    // geloest: die Person bleibt am Einsatz, bis jemand sie bewusst entfernt.
    $pdo->prepare('UPDATE einsatz_zuteilung SET position_id = NULL WHERE position_id = ?')->execute([$id]);
    $pdo->prepare('DELETE FROM einsatz_position WHERE id = ? AND einsatz_id = ?')->execute([$id, $einsatzId]);
    bedarf_nachfuehren($pdo, $einsatzId);
    json_response(['status' => 'ok', 'positionen' => positionen($pdo, $einsatzId)]);
}

if ($aktion === 'sperren') {
    $id = (int)($in['id'] ?? 0);
    $wert = !empty($in['gesperrt']) ? 1 : 0;
    $pdo->prepare('UPDATE einsatz_position SET gesperrt = ? WHERE id = ? AND einsatz_id = ?')
        ->execute([$wert, $id, $einsatzId]);
    json_response(['status' => 'ok', 'positionen' => positionen($pdo, $einsatzId)]);
}

if ($aktion === 'zuteilen') {
    $positionId = (int)($in['position_id'] ?? 0);
    $maId = (int)($in['mitarbeiter_id'] ?? 0);
    if (!$positionId || !$maId) {
        json_response(['status' => 'error', 'message' => 'Position und Person nötig.'], 422);
    }
    $p = $pdo->prepare('SELECT id FROM einsatz_position WHERE id = ? AND einsatz_id = ?');
    $p->execute([$positionId, $einsatzId]);
    if (!$p->fetchColumn()) {
        json_response(['status' => 'error', 'message' => 'Position gehört nicht zu diesem Einsatz.'], 422);
    }
    // Eine Position traegt eine Person. Wer vorher darauf stand, wird geloest
    // und bleibt ohne Position am Einsatz -- nicht stillschweigend geloescht.
    $pdo->prepare('UPDATE einsatz_zuteilung SET position_id = NULL WHERE position_id = ?')->execute([$positionId]);
    // Der Primaerschluessel ist (einsatz_id, mitarbeiter_id): dieselbe Person
    // steht also hoechstens einmal am Einsatz und wechselt nur die Position.
    $pdo->prepare(
        'INSERT INTO einsatz_zuteilung (einsatz_id, mitarbeiter_id, position_id)
         VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE position_id = VALUES(position_id)'
    )->execute([$einsatzId, $maId, $positionId]);
    json_response(['status' => 'ok', 'positionen' => positionen($pdo, $einsatzId)]);
}

if ($aktion === 'loesen') {
    $positionId = (int)($in['position_id'] ?? 0);
    // Ganz vom Einsatz weg, nicht nur von der Position: das rote Kreuz im
    // Raster meint "diese Person arbeitet hier nicht".
    $pdo->prepare('DELETE FROM einsatz_zuteilung WHERE einsatz_id = ? AND position_id = ?')
        ->execute([$einsatzId, $positionId]);
    json_response(['status' => 'ok', 'positionen' => positionen($pdo, $einsatzId)]);
}

json_response(['status' => 'error', 'message' => 'Unbekannte Aktion.'], 422);
