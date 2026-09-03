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
// ENT-116. Die Kilometer stammen aus einer menschlichen Ablesung auf Google
// Maps (GAV-AUS-011 ist offen -- keine automatische Zonenzuordnung). Sie
// werden hier nur entgegengenommen und gespeichert, nicht ausgelegt.
$wegKm = ($input['weg_km'] ?? '') === '' ? null : round((float)$input['weg_km'], 2);
$wegMin = ($input['weg_minuten'] ?? '') === '' ? null : (int)$input['weg_minuten'];
$wegAdr = trim((string)($input['weg_adresse'] ?? '')) ?: null;
// ENT-119. Zugehoerigkeit zu einer zusammen angelegten Reihe.
//
// Die Kennung wird HIER vergeben und nicht im Browser: Eine im Browser
// gewuerfelte Zahl kann sich mit einer anderen Sitzung ueberschneiden, und
// zwei fremde Reihen sind danach nicht mehr auseinanderzuhalten. Der erste
// Tag setzt serie_neu, bekommt seine eigene id als Serienkennung zurueck und
// gibt sie den uebrigen Tagen mit.
//
// serie_id wird beim AENDERN bewusst nicht angefasst: Die UPDATE-Anweisung
// unten fuehrt die Spalte nicht. Wer einen Tag einer Reihe bearbeitet, loest
// ihn damit nicht heraus.
// ENT-325. Dienstfahrzeug und Fahrer -- nur angefasst, wenn die Anfrage die
// Schluessel WIRKLICH mitschickt. Die Bearbeiten-Schublade kennt die Felder
// nicht; wuerden sie hier unbesehen gelesen, leerte jedes Speichern aus der
// Schublade eine bestehende Fahrzeugzuteilung. Derselbe stille Datenverlust,
// vor dem ENT-115 schon einmal stand.
$fahrzeugGesendet = array_key_exists('fahrzeug_id', $input) || array_key_exists('fahrer_id', $input);
$fahrzeugId = ($input['fahrzeug_id'] ?? '') === '' ? null : (int)$input['fahrzeug_id'];
$fahrerId   = ($input['fahrer_id'] ?? '')   === '' ? null : (int)$input['fahrer_id'];

$serieId  = isset($input['serie_id']) && $input['serie_id'] !== '' ? (int)$input['serie_id'] : null;
$serieNeu = !empty($input['serie_neu']);
if ($serieId !== null && $serieId <= 0) { $serieId = null; }
if ($wegKm !== null && ($wegKm < 0 || $wegKm > 9999)) {
    json_response(['status' => 'error', 'message' => 'Wegstrecke zwischen 0 und 9999 km'], 400);
}
if ($wegMin !== null && ($wegMin < 0 || $wegMin > 1440)) {
    json_response(['status' => 'error', 'message' => 'Fahrzeit zwischen 0 und 1440 Minuten'], 400);
}
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
// als offene Stelle (ENT-021). 'abgeschlossen' steht hier nur, damit ein
// Speichern anderer Felder (Bemerkung, Zeitverschiebung) einen bereits
// abgeschlossenen Einsatz nicht ablehnt oder zurueckstuft -- der Wert selbst
// wird ausschliesslich vom Server gesetzt, sobald alle Rapporte vorliegen
// (ENT-128, rapport_create.php), nie ueber das Auswahlfeld in der Oberflaeche.
if (!in_array($status, ['geplant', 'bestaetigt', 'abgesagt', 'provisorisch', 'abgeschlossen'], true)) {
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
// Warnung, keine Sperre (ENT-284) -- der Planer bestaetigt einmal, dann
// gilt das fuer diese Anfrage.
$trotzFehlenderBerechtigung = !empty($input['trotz_fehlender_berechtigung']);

if ($zuteilung) {
    if (!$trotzFehlenderBerechtigung) {
        $unberechtigt = ohneRevierdienstBerechtigung($einsatzart, $zuteilung);
        if ($unberechtigt) {
            json_response([
                'status' => 'error',
                'unberechtigt' => true,
                'message' => 'Ohne Revierdienst-Berechtigung: '
                    . implode(', ', array_column($unberechtigt, 'name')),
                'personen' => $unberechtigt,
            ], 409);
        }
    }
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

// ENT-325. Geprueft wird gegen die Zuteilung, die NACH diesem Speichern gilt
// -- sonst liesse sich jemand zum Fahrer bestimmen, der im selben Zug aus der
// Schicht faellt. Die Pruefung selbst steht in planung.php, weil
// einsatz_fahrzeug.php sie ebenso braucht.
$bisherFahrzeugId = null;
$bisherFahrerId = null;
if ($fahrzeugGesendet && hat_spalte(db(), 'einsaetze', 'fahrzeug_id')) {
    if ($id > 0) {
        $alt = db()->prepare('SELECT fahrzeug_id, fahrer_id FROM einsaetze WHERE id = ?');
        $alt->execute([$id]);
        $altZeile = $alt->fetch(PDO::FETCH_ASSOC) ?: [];
        $bisherFahrzeugId = isset($altZeile['fahrzeug_id']) ? (int)$altZeile['fahrzeug_id'] : null;
        $bisherFahrerId   = isset($altZeile['fahrer_id']) ? (int)$altZeile['fahrer_id'] : null;
    }
    $geprueft = einsatz_fahrzeug_pruefen(db(), $fahrzeugId, $fahrerId, $zuteilung, $bisherFahrzeugId);
    $fahrzeugId = $geprueft['fahrzeug_id'];
    $fahrerId   = $geprueft['fahrer_id'];
} else {
    $fahrzeugGesendet = false;   // Spalte fehlt noch: nicht schreiben, nicht behaupten
}

$pdo = db();
$pdo->beginTransaction();
try {
    if ($id > 0) {
        $stmt = $pdo->prepare(
            'UPDATE einsaetze SET kunde_id = ?, kunde_name = ?, titel = ?, strasse = ?, ort = ?,
                    kanton = ?, einsatzart = ?, sparte = ?, datum = ?, von = ?, bis = ?, bedarf = ?,
                    status = ?, bemerkung = ?, veranstaltung = ?, treffpunkt = ?, taetigkeit = ?,
                    qualifikation = ?, kontakt_vorname = ?, kontakt_nachname = ?, kontakt_telefon = ?,
                    weg_km = ?, weg_minuten = ?, weg_adresse = ?
             WHERE id = ?'
        );
        $stmt->execute([$kundeId, $kundeName, $titel, $strasse, $ort, $kanton, $einsatzart, $sparte,
            $datum, $von, $bis, $bedarf, $status, $bemerkung, $veranst, $treffpunkt, $taetigkeit,
            $qualifik, $kVorname, $kNachname, $kTelefon, $wegKm, $wegMin, $wegAdr, $id]);
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
                                    kontakt_vorname, kontakt_nachname, kontakt_telefon,
                                    weg_km, weg_minuten, weg_adresse, serie_id, erstellt_von)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$kundeId, $kundeName, $titel, $strasse, $ort, $kanton, $einsatzart, $sparte,
            $datum, $von, $bis, $bedarf, $status, $bemerkung, $veranst, $treffpunkt, $taetigkeit,
            $qualifik, $kVorname, $kNachname, $kTelefon, $wegKm, $wegMin, $wegAdr, $serieId,
            (int)$user['id']]);
        $id = (int)$pdo->lastInsertId();
        // Der erste Tag einer Reihe wird zu ihrer Kennung. Innerhalb derselben
        // Transaktion, damit kein Einsatz einer Reihe ohne Zugehoerigkeit
        // liegen bleibt, wenn danach etwas schiefgeht.
        if ($serieNeu && $serieId === null) {
            $pdo->prepare('UPDATE einsaetze SET serie_id = id WHERE id = ?')->execute([$id]);
            $serieId = $id;
        }
    }

    if ($zuteilung) {
        $ins = $pdo->prepare('INSERT INTO einsatz_zuteilung (einsatz_id, mitarbeiter_id) VALUES (?, ?)');
        foreach ($zuteilung as $mid) {
            $ins->execute([$id, $mid]);
        }
    }

    // ENT-325. Eigene Anweisung statt zwei weiterer Spalten in der festen
    // Liste oben: Die laeuft auch fuer die Bearbeiten-Schublade, die die
    // Felder nicht kennt -- dort wuerden sie mit NULL ueberschrieben.
    if ($fahrzeugGesendet) {
        $pdo->prepare('UPDATE einsaetze SET fahrzeug_id = ?, fahrer_id = ? WHERE id = ?')
            ->execute([$fahrzeugId, $fahrerId, $id]);
        // In derselben Transaktion wie die Zuteilung: Ein Fahrer ohne die
        // zugehoerige Verkehrsmittel-Folge waere ein Datensatz, aus dem der
        // Abgleich einen Fahrkostenersatz fuer das eigene Auto errechnet.
        einsatz_fahrer_verkehrsmittel_setzen($pdo, $id, $fahrerId, $bisherFahrerId);
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    // Die einheitliche Fehlerbehandlung in db.php formuliert die Meldung --
    // so erfaehrt der Admin z.B., dass eine Tabelle noch fehlt.
    throw $e;
}

json_response(['status' => 'ok', 'id' => $id, 'zugeteilt' => count($zuteilung),
               'serie_id' => $serieId]);
