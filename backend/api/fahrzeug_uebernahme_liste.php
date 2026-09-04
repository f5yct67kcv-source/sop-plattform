<?php
// Fahrzeugübernahmen im Zeitraum, für die Auswertung "Arbeitsergebnisse"
// (ENT-346) -- gleiches Muster wie rundgang_scan_liste.php für die
// Kontrollpunktscans desselben Bereichs.
//
// WARUM HIER UND NICHT UNTER DIENSTFAHRZEUGE (ENT-313): Dort steht
// ausdrücklich "Hier wird nichts kontrolliert und nichts gerechnet" -- die
// Übernahmen sind Betriebsablauf, kein Stammdatenfeld, und gehören darum
// zu den übrigen Zeitraum-Auswertungen (Wachbuch, Scans, Ereignisse), nicht
// in die Fahrzeug-Einstellungen.
//
// SEIT ENT-356/ENT-361/ENT-377 KEINE REINE ANZEIGE MEHR: Vier Feststellungen
// ("auffaellig", "wiederholt", "abweichend", "unbelegt", siehe
// fz_uebernahme_feststellungen() in fahrzeug.php) werden hier berechnet --
// ENT-313s "Lücke" (kein Erwartungswert nötig) UND "Abweichung"
// (Erwartungswert aus weg_km, ENT-116) UND "unbelegt" (Bewegung nach einer
// erklärten Abgabe, ENT-377). Bewusst weiterhin keine Beanstandung mit
// Konsequenz -- das bleibt durch OP-314 blockiert, bis die
// Privatnutzungs-Regel schriftlich vorliegt und den Mitarbeitenden bekannt
// ist (Inhalt bereits entschieden, ENT-356).
//
// RECHT: 'betrieb', dasselbe wie fahrzeug_logbuch.php -- wer die Fahrzeuge
// pflegen darf, muss auch sehen können, wer sie zuletzt übernommen hat.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../fahrzeug.php';

$user = require_session();
require_recht($user, 'betrieb');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$pdo = db();
if (!hat_tabelle($pdo, 'fahrzeug_uebernahme')) {
    // Fehlende Einrichtung ist etwas anderes als "im Zeitraum nichts
    // passiert" -- die Oberfläche muss beides verschieden benennen können.
    json_response(['status' => 'ok', 'eingerichtet' => false, 'eintraege' => []]);
}

// Ohne Zeitraum: der heutige Tag -- dieselbe Regel wie rundgang_liste.php
// und rundgang_scan_liste.php.
$von = trim((string)($_GET['von'] ?? '')) ?: date('Y-m-d');
$bis = trim((string)($_GET['bis'] ?? '')) ?: $von;
$fahrzeugId = isset($_GET['fahrzeug_id']) && $_GET['fahrzeug_id'] !== '' ? (int)$_GET['fahrzeug_id'] : null;

// einsaetze.kunde_name steht direkt am Einsatz (wie in rundgang_scan_liste.php
// genutzt) -- kein zweiter Weg über die Kundentabelle nötig. LEFT JOIN, weil
// eine spontane Fahrt ohne Einsatz gültig ist (siehe meine_fahrzeug_uebernahme.php)
// und dann keinen Zusammenhang zu zeigen hat, statt einen zu erfinden.
//
// Abfrage und "voriger"-Bezug liegen in fahrzeug.php (FZ_UEBERNAHME_LISTE_SQL),
// nicht hier -- damit dieselbe Abfrage auch in pruef_fahrzeug_uebernahme.php
// echt gegen SQLite laufen kann (ENT-356).
$sql = FZ_UEBERNAHME_LISTE_SQL . ' WHERE DATE(u.zeitpunkt) BETWEEN ? AND ?';
$werte = [$von, $bis];
if ($fahrzeugId !== null) {
    $sql .= ' AND u.fahrzeug_id = ?';
    $werte[] = $fahrzeugId;
}
$sql .= ' ORDER BY u.zeitpunkt DESC, u.id DESC';

$stmt = $pdo->prepare($sql);
$stmt->execute($werte);
$zeilen = $stmt->fetchAll(PDO::FETCH_ASSOC);

// ── Zuordnungs-Vermerk und Vorschläge (ENT-381) ──────────────────────
//
// BEIDES IN EIGENEN ABFRAGEN, NICHT IN FZ_UEBERNAHME_LISTE_SQL: Der
// Vermerk steht in zwei Spalten, die erst mit dem nächsten
// Einrichtungslauf entstehen -- stünden sie in der gemeinsamen Abfrage,
// fiele die ganze Ansicht aus, solange die Einrichtung nicht gelaufen ist.
// Und die Vorschläge sind eine LISTE je Zeile, keine einzelne Zahl; als
// Unterabfrage liessen sie sich gar nicht ausdrücken.
$vermerke = [];
if ($zeilen && hat_spalte($pdo, 'fahrzeug_uebernahme', 'einsatz_zugeordnet_von')) {
    $ids = array_map(static fn(array $r): int => (int)$r['id'], $zeilen);
    $platz = implode(',', array_fill(0, count($ids), '?'));
    $q = $pdo->prepare(
        "SELECT u.id, u.einsatz_zugeordnet_am, zm.vorname, zm.nachname, zm.name
           FROM fahrzeug_uebernahme u
           LEFT JOIN mitarbeiter zm ON zm.id = u.einsatz_zugeordnet_von
          WHERE u.id IN ($platz) AND u.einsatz_zugeordnet_von IS NOT NULL"
    );
    $q->execute($ids);
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $z) {
        $zn = trim(($z['vorname'] ?? '') . ' ' . ($z['nachname'] ?? ''));
        if ($zn === '') { $zn = trim((string)($z['name'] ?? '')); }
        $vermerke[(int)$z['id']] = [
            'person' => $zn !== '' ? $zn : null,
            'am' => (string)$z['einsatz_zugeordnet_am'],
        ];
    }
}

// Vorschläge: alle eigenen, nicht abgesagten Einsätze DERSELBEN PERSON am
// Tag der Übernahme. EINE Abfrage für die ganze Seite statt einer je Zeile
// -- eine Monatsansicht hat schnell dutzende Zeilen. Gefiltert wird
// anschliessend in PHP nach (Person, Datum).
//
// Nur für echte Übernahmen mit Fahrzeug: Bei "kein Dienstfahrzeug" gibt es
// keine Fahrt zu erklären, und eine Abgabe trägt keinen Kilometerstand --
// dort wäre eine Einsatz-Zuordnung eine Behauptung ohne Gegenstand.
$hatFzPlan = hat_spalte($pdo, 'einsaetze', 'fahrzeug_id');
$hatFahrerPlan = hat_spalte($pdo, 'einsaetze', 'fahrer_id');
$kandidaten = [];
$bedarf = array_filter($zeilen, static fn(array $r): bool =>
    $r['art'] === 'uebernahme' && $r['fahrzeug_id'] !== null);
if ($bedarf) {
    $personen = array_values(array_unique(array_map(
        static fn(array $r): int => (int)$r['eigene_mitarbeiter_id'], $bedarf)));
    $tage = array_values(array_unique(array_map(
        static fn(array $r): string => substr((string)$r['zeitpunkt'], 0, 10), $bedarf)));
    $pP = implode(',', array_fill(0, count($personen), '?'));
    $pT = implode(',', array_fill(0, count($tage), '?'));
    $felder = 'e.id, e.datum, e.von, e.bis, e.kunde_name, e.titel, z.mitarbeiter_id'
        . ($hatFzPlan ? ', e.fahrzeug_id AS geplantes_fahrzeug' : ', NULL AS geplantes_fahrzeug')
        . ($hatFahrerPlan ? ', e.fahrer_id AS geplanter_fahrer' : ', NULL AS geplanter_fahrer');
    $q = $pdo->prepare(
        "SELECT $felder FROM einsaetze e
           JOIN einsatz_zuteilung z ON z.einsatz_id = e.id
          WHERE z.mitarbeiter_id IN ($pP) AND e.datum IN ($pT)
            AND z.zusage NOT IN ('entfallen', 'abgelehnt')
          ORDER BY e.von, e.id"
    );
    $q->execute(array_merge($personen, $tage));
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $e) {
        $kandidaten[(int)$e['mitarbeiter_id'] . '|' . substr((string)$e['datum'], 0, 10)][] = $e;
    }
}

$eintraege = array_map(function (array $r) use ($vermerke, $kandidaten): array {
    $r['id'] = (int)$r['id'];
    $r['fahrzeug_id'] = $r['fahrzeug_id'] !== null ? (int)$r['fahrzeug_id'] : null;
    $r['tacho_km'] = $r['tacho_km'] !== null ? (int)$r['tacho_km'] : null;
    $r['einsatz_id'] = $r['einsatz_id'] !== null ? (int)$r['einsatz_id'] : null;
    $r['hat_foto'] = (bool)$r['hat_foto'];
    $name = trim(($r['vorname'] ?? '') . ' ' . ($r['nachname'] ?? ''));
    $r['person'] = $name !== '' ? $name : (string)($r['name'] ?? '?');
    unset($r['vorname'], $r['nachname'], $r['name']);

    // Wer die Zuordnung gesetzt hat -- fehlt der Vermerk, stammt sie von
    // der fahrenden Person selbst (ENT-340). Zwei Wege, zwei Aussagen.
    $r['einsatz_zugeordnet'] = $vermerke[$r['id']] ?? null;

    // Die Vorschläge nur, wo auch zugeordnet werden kann, und ohne den
    // bereits verknüpften Einsatz -- er steht schon oben in der Karte.
    // Reihenfolge: Wo am Einsatz genau dieses Fahrzeug (oder diese Person
    // als Fahrer) geplant ist, ist die Übereinstimmung stärker als ein
    // blosses "am selben Tag" -- das gehört nach oben und wird benannt.
    $vor = [];
    if ($r['art'] === 'uebernahme' && $r['fahrzeug_id'] !== null) {
        $schluessel = (int)$r['eigene_mitarbeiter_id'] . '|' . substr((string)$r['zeitpunkt'], 0, 10);
        foreach ($kandidaten[$schluessel] ?? [] as $e) {
            if ($r['einsatz_id'] !== null && (int)$e['id'] === $r['einsatz_id']) { continue; }
            $passt = $e['geplantes_fahrzeug'] !== null
                && (int)$e['geplantes_fahrzeug'] === $r['fahrzeug_id'];
            $vor[] = [
                'id' => (int)$e['id'],
                'kunde_name' => $e['kunde_name'],
                'titel' => $e['titel'],
                'von' => substr((string)$e['von'], 0, 5),
                'bis' => substr((string)$e['bis'], 0, 5),
                'passt_fahrzeug' => $passt,
                'passt_fahrer' => $e['geplanter_fahrer'] !== null
                    && (int)$e['geplanter_fahrer'] === (int)$r['eigene_mitarbeiter_id'],
            ];
        }
        usort($vor, static fn(array $a, array $b): int =>
            ($b['passt_fahrzeug'] <=> $a['passt_fahrzeug'])
            ?: ($b['passt_fahrer'] <=> $a['passt_fahrer'])
            ?: strcmp((string)$a['von'], (string)$b['von']));
    }
    $r['einsatz_vorschlaege'] = $vor;

    // Vier Feststellungen aus dem Vorwert (ENT-356/ENT-361/ENT-377) --
    // Berechnung in fz_uebernahme_feststellungen() (fahrzeug.php), damit sie
    // isoliert (ohne Datenbank) geprüft werden kann.
    $vorigerKm = $r['voriger_km'] !== null ? (int)$r['voriger_km'] : null;
    $vorigerMa = $r['voriger_mitarbeiter_id'] !== null ? (int)$r['voriger_mitarbeiter_id'] : null;
    $eigeneMa = $r['eigene_mitarbeiter_id'] !== null ? (int)$r['eigene_mitarbeiter_id'] : null;
    $sollEinsaetze = (int)($r['soll_einsaetze'] ?? 0);
    $sollEinsaetzeMitWegKm = (int)($r['soll_einsaetze_mit_weg_km'] ?? 0);
    $sollKmSumme = $r['soll_km_summe'] !== null ? (float)$r['soll_km_summe'] : null;
    $abgabenDazwischen = (int)($r['abgaben_dazwischen'] ?? 0);
    $r += fz_uebernahme_feststellungen($r['tacho_km'], $vorigerKm, $vorigerMa, $eigeneMa,
        $sollEinsaetze, $sollEinsaetzeMitWegKm, $sollKmSumme, $abgabenDazwischen);
    unset($r['voriger_km'], $r['voriger_mitarbeiter_id'], $r['eigene_mitarbeiter_id'],
        $r['soll_einsaetze'], $r['soll_einsaetze_mit_weg_km'], $r['soll_km_summe'],
        $r['abgaben_dazwischen']);
    return $r;
}, $zeilen);

json_response(['status' => 'ok', 'eingerichtet' => true, 'eintraege' => $eintraege]);
