<?php
// Schichtabgleich (ENT-045): haelt fest, was tatsaechlich stattgefunden hat.
//
// Bis hierher kannte das System nur den Plan -- Bedarf, Zuteilung, Zusage.
// Abgerechnet und ausgewertet wird aber die Leistung. Dieser Endpunkt
// schreibt das Ist neben den Plan, ohne den Plan zu veraendern: geplante
// Zeiten, Bedarf und Zuteilung bleiben stehen, damit sich Soll und Ist
// spaeter gegenueberstellen lassen.
//
// Abgeglichen wird JE PERSON, nicht je Schicht: dieselbe Person kann am
// selben Tag auf zwei Objekten unterschiedlich lang gearbeitet haben. Eine
// Schicht, der niemand zugeteilt war, wird als Ganzes abgeglichen -- sonst
// verschwaende sie stillschweigend aus der Rueckschau.
//
// Nimmt eine oder viele Zeilen entgegen; der Sammelabgleich ist derselbe
// Aufruf mit mehreren Eintraegen, kein zweiter Weg.
//
// Bewusst KEINE Berechnung der ARBEITSZEIT: Stunden und Zuschlaege werden
// weiterhin nicht aus dem Abgleich abgeleitet. Das waere GAV-Auslegung und
// ist bis zu den Eintraegen im Auslegungsregister gesperrt (CLAUDE.md
// Teil B, OP-20, OP-32).
//
// SEIT ENT-125 ANDERS: der AUSLAGENERSATZ nach Art. 18 wird hier sehr wohl
// berechnet -- als unveraenderlicher Schnappschuss in einsatz_auslagen, im
// selben Moment, in dem die Ist-Zeiten fest werden. Der Wortlaut von Art. 18
// Ziff. 3/4/5 ist eindeutig, keine Auslegungsfrage (anders als Ziff. 8,
// GAV-AUS-010 -- die Sperre dafuer bleibt und wird HIER durchgesetzt, nicht
// nur als Hinweis wie in ENT-124). Die ganze Rechnung liegt in
// backend/auslagen.php, nicht in dieser Datei.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../auslagen.php';

$user = require_session();
require_recht($user, 'abgleich');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

// offen      = noch nicht geprueft
// anwesend   = war da, so wie in den Ist-Zeiten festgehalten
// abwesend   = war nicht da, die Schicht fand aber statt
// ausgefallen= die Schicht fand gar nicht statt
const IST_STATUS = ['offen', 'anwesend', 'abwesend', 'ausgefallen'];

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$zeilen = $input['zeilen'] ?? null;
if (!is_array($zeilen) || !$zeilen) {
    json_response(['status' => 'error', 'message' => 'Keine Zeilen uebergeben'], 400);
}
if (count($zeilen) > 500) {
    json_response(['status' => 'error', 'message' => 'Zu viele Zeilen auf einmal (hoechstens 500)'], 400);
}

$zeit = function ($wert): ?string {
    $wert = trim((string)$wert);
    return preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $wert) ? substr($wert, 0, 5) : null;
};

$pdo = db();
$pdo->beginTransaction();
try {
    $jetzt = date('Y-m-d H:i:s');
    $wer = (int)$user['id'];

    $person = $pdo->prepare(
        'UPDATE einsatz_zuteilung
         SET ist_status = ?, ist_von = ?, ist_bis = ?,
             ist_pause_von = ?, ist_pause_min = ?,
             ist_pause_bezahlt_ma = ?, ist_pause_bezahlt_kunde = ?, ist_bemerkung = ?,
             abgeglichen_von = ?, abgeglichen_am = ?
         WHERE einsatz_id = ? AND mitarbeiter_id = ?'
    );
    $schicht = $pdo->prepare(
        'UPDATE einsaetze
         SET ist_status = ?, ist_von = ?, ist_bis = ?,
             ist_pause_von = ?, ist_pause_min = ?,
             ist_pause_bezahlt_ma = ?, ist_pause_bezahlt_kunde = ?, ist_bemerkung = ?,
             abgeglichen_von = ?, abgeglichen_am = ?
         WHERE id = ?'
    );

    // ── Auslagenersatz (ENT-125) ────────────────────────────────────────
    // Kleine Abfragen je Zeile statt einer grossen vorab: Ein Abgleich
    // betrifft ueblicherweise eine Handvoll bis einige Dutzend Zeilen, keine
    // Stapelverarbeitung, fuer die sich eine Sammelabfrage lohnen wuerde.
    $einsatzInfo = $pdo->prepare('SELECT sparte, datum, weg_km FROM einsaetze WHERE id = ?');
    $vorgabe = $pdo->prepare('SELECT verkehrsmittel FROM mitarbeiter WHERE id = ?');
    $ausnahme = $pdo->prepare(
        'SELECT verkehrsmittel, oev_rappen FROM einsatz_zuteilung WHERE einsatz_id = ? AND mitarbeiter_id = ?'
    );
    // Derselbe Massstab wie die Warnung aus ENT-124 (gavAus010SelbeTag in
    // dashboard.html): irgendein anderer, nicht abgesagter Einsatz derselben
    // Person am selben Kalendertag. Warnung und tatsaechliche Sperre muessen
    // denselben Fall meinen, sonst waere die Warnung irrefuehrend.
    $tagKonflikt = $pdo->prepare(
        "SELECT COUNT(*) FROM einsatz_zuteilung z
         JOIN einsaetze e ON e.id = z.einsatz_id
         WHERE z.mitarbeiter_id = ? AND e.datum = ? AND e.status != 'abgesagt' AND e.id != ?"
    );
    $auslagenSchreiben = $pdo->prepare(
        'INSERT INTO einsatz_auslagen
           (einsatz_id, mitarbeiter_id, zone_schluessel, zone_name, zone_quelle, weg_km,
            verkehrsmittel, fahrzeitersatz_rappen, fahrkostenersatz_rappen, gesperrt_grund,
            regelwerk, erzeugt_am)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           zone_schluessel = VALUES(zone_schluessel), zone_name = VALUES(zone_name),
           zone_quelle = VALUES(zone_quelle), weg_km = VALUES(weg_km),
           verkehrsmittel = VALUES(verkehrsmittel),
           fahrzeitersatz_rappen = VALUES(fahrzeitersatz_rappen),
           fahrkostenersatz_rappen = VALUES(fahrkostenersatz_rappen),
           gesperrt_grund = VALUES(gesperrt_grund), regelwerk = VALUES(regelwerk),
           erzeugt_am = VALUES(erzeugt_am)'
    );
    // Ein Zurueckgenommener Abgleich (offen/abwesend/ausgefallen) darf keinen
    // Auslagenersatz-Schnappschuss stehen lassen -- sonst zeigt die
    // Spesenabrechnung Geld fuer eine Schicht, die laut Ist-Status gar nicht
    // stattfand oder bei der die Person nicht da war.
    $auslagenLoeschen = $pdo->prepare(
        'DELETE FROM einsatz_auslagen WHERE einsatz_id = ? AND mitarbeiter_id = ?'
    );

    // Auslagenersatz-Zeile fuer GENAU eine Person auf GENAU einem Einsatz
    // berechnen und schreiben. Ausserhalb des foreach() benannt, damit der
    // Kontrollfluss dort lesbar bleibt.
    $auslagenSpeichern = function (int $einsatzId, int $maId) use (
        $pdo, $einsatzInfo, $vorgabe, $ausnahme, $tagKonflikt, $auslagenSchreiben
    ): void {
        $einsatzInfo->execute([$einsatzId]);
        $e = $einsatzInfo->fetch();
        if (!$e) { return; }   // Einsatz zwischenzeitlich geloescht -- nichts zu schreiben

        $vorgabe->execute([$maId]);
        $vorgabeWert = $vorgabe->fetchColumn();
        $ausnahme->execute([$einsatzId, $maId]);
        $ausn = $ausnahme->fetch();
        // Die Ausnahme an der Zuteilung schlaegt die Vorgabe der Person --
        // fuer die Fahrgemeinschaft, die es nur diesmal gibt (ENT-123).
        $verkehrsmittel = ($ausn && $ausn['verkehrsmittel'] !== null && $ausn['verkehrsmittel'] !== '')
            ? $ausn['verkehrsmittel'] : ($vorgabeWert !== false ? $vorgabeWert : null);
        $verkehrsmittel = ($verkehrsmittel === '' ? null : $verkehrsmittel);
        $oevRappen = ($ausn && $ausn['oev_rappen'] !== null) ? (int)$ausn['oev_rappen'] : null;

        $tagKonflikt->execute([$maId, $e['datum'], $einsatzId]);
        $blockiert = (int)$tagKonflikt->fetchColumn() > 0;

        $zeile = auslagen_zeile(
            (string)$e['sparte'], (string)$e['datum'],
            $e['weg_km'] === null ? null : (float)$e['weg_km'],
            $verkehrsmittel, $oevRappen, $blockiert
        );
        $auslagenSchreiben->execute([
            $einsatzId, $maId, $zeile['zone_schluessel'], $zeile['zone_name'], $zeile['zone_quelle'],
            $zeile['weg_km'], $zeile['verkehrsmittel'],
            $zeile['fahrzeitersatz_rappen'], $zeile['fahrkostenersatz_rappen'],
            $zeile['gesperrt_grund'], $zeile['regelwerk'], date('Y-m-d H:i:s'),
        ]);
    };

    $geschrieben = 0;
    foreach ($zeilen as $z) {
        if (!is_array($z)) { continue; }
        $einsatzId = (int)($z['einsatz_id'] ?? 0);
        if ($einsatzId <= 0) { continue; }

        $status = trim((string)($z['ist_status'] ?? ''));
        if (!in_array($status, IST_STATUS, true)) { continue; }

        // Zuruecknehmen loescht auch die Spur, wer wann geprueft hat -- ein
        // offener Abgleich darf nicht so aussehen, als sei er schon einmal
        // bestaetigt worden.
        $offen = $status === 'offen';
        // Wer nicht da war oder wessen Schicht ausfiel, hat keine Ist-Zeiten.
        $ohneZeit = $offen || $status === 'abwesend' || $status === 'ausgefallen';

        $von = $ohneZeit ? null : $zeit($z['ist_von'] ?? '');
        $bis = $ohneZeit ? null : $zeit($z['ist_bis'] ?? '');
        $pause = null;
        if (!$ohneZeit && isset($z['ist_pause_min']) && $z['ist_pause_min'] !== '') {
            $pause = max(0, min(1440, (int)$z['ist_pause_min']));
        }
        // Pausenbeginn plus Dauer (ENT-046) -- das Ende ergibt sich daraus und
        // wird bewusst nicht gespeichert, damit es nur eine Wahrheit gibt.
        $pauseVon = $ohneZeit ? null : $zeit($z['ist_pause_von'] ?? '');
        // Drei Zustaende, nicht zwei: null = noch nicht entschieden, 0 = nein,
        // 1 = ja. Das Zusammenfallen von 'nicht gefragt' und 'nein' waere bei
        // GAV-AUS-004 genau der Fehler, den das Register verhindern soll.
        $jaNein = function ($wert): ?int {
            if ($wert === null || $wert === '' || $wert === 'offen') { return null; }
            return in_array($wert, [1, '1', true, 'ja', 'true'], true) ? 1 : 0;
        };
        $bezahltMa    = $ohneZeit ? null : $jaNein($z['ist_pause_bezahlt_ma'] ?? null);
        $bezahltKunde = $ohneZeit ? null : $jaNein($z['ist_pause_bezahlt_kunde'] ?? null);
        $bemerkung = trim((string)($z['ist_bemerkung'] ?? ''));
        $bemerkung = $bemerkung !== '' ? $bemerkung : null;

        $maId = (int)($z['mitarbeiter_id'] ?? 0);
        if ($maId > 0) {
            $person->execute([$status, $von, $bis, $pauseVon, $pause,
                $bezahltMa, $bezahltKunde, $bemerkung,
                $offen ? null : $wer, $offen ? null : $jetzt, $einsatzId, $maId]);
            $geschrieben += $person->rowCount() > 0 ? 1 : 0;
            // Auslagenersatz folgt dem Ist-Status (ENT-125): "anwesend" ist
            // der einzige Status, bei dem tatsaechlich eine Fahrt stattfand.
            if ($status === 'anwesend') {
                $auslagenSpeichern($einsatzId, $maId);
            } else {
                $auslagenLoeschen->execute([$einsatzId, $maId]);
            }
            continue;
        }
        // Ohne Mitarbeitenden ist die Zeile die unbesetzte Schicht selbst.
        $schicht->execute([$status, $von, $bis, $pauseVon, $pause,
            $bezahltMa, $bezahltKunde, $bemerkung,
            $offen ? null : $wer, $offen ? null : $jetzt, $einsatzId]);
        $geschrieben += $schicht->rowCount() > 0 ? 1 : 0;
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

json_response(['status' => 'ok', 'geschrieben' => $geschrieben]);
