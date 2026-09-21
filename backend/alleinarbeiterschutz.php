<?php
declare(strict_types=1);
// Alleinarbeiterschutz, Mechanismus B, STUFE 1 (ENT-153, ENT-644):
// Überfälligkeitserkennung + Push an die Alarmempfänger, wenn eine laufende
// Kontrollrunde ihre erwartete Dauer um die Karenzzeit überschreitet.
//
// NICHT hier: der automatische Telefonanruf (Stufe 2, ENT-644 Punkt 6/
// offene Frage "welcher EU-Anbieter") und der stille Alarm (manueller
// Knopf, UI-Arbeit in app.html) -- beides eigene Bauabschnitte.
//
// EIGENSTÄNDIGE DATEI, KEIN ZWEITER VERGABEWEG (Architektur-Vorgabe):
// Es gibt kein Recht "ist Alarmempfänger" in rechte.php -- 'alarmempfaenger'
// ist ein BEREICH in der Rechtematrix (siehe bereiche_katalog()), keine
// eigene Zugriffsart. Diese Datei LIEST NUR die bestehende Rollen-Definition
// (rollen_definitionen() in rechte.php) und leitet daraus ab, welche
// Mitarbeitenden ihn tragen. Keine Zeile in rechte.php wird angefasst.
//
// DIESE DATEI HAT KEINEN EIGENEN require: genau wie push.php und rechte.php
// ist sie eine reine Funktionsbibliothek, die voraussetzt, dass der Aufrufer
// bereits db.php (hat_tabelle/hat_spalte), rechte.php (rollen_definitionen/
// stufe_gueltig) und push.php (push_abos_fuer/push_zustellen/push_abo_*)
// geladen hat -- "Endpunkte binden einander nie ein" (gleiches Prinzip wie
// in rundgang.php).
//
// ══════════════════════════════════════════════════════════════════════
// EIN DATENMODELL-FUND, DER DIESE ÄNDERUNG BRAUCHT UND DARUM MITBRINGT:
//
// Im gesamten Rundgang-Datenmodell (rundgang, rundgang_vorlage,
// kontrollpunkt, einsaetze) gibt es KEIN Feld für die erwartete Dauer/
// Sollzeit einer laufenden Kontrollrunde -- nachgesehen, nicht angenommen.
// Es gibt zwei Felder, die man dafür verwechseln könnte, und beide sind es
// NICHT:
//   - rundgang_vorlage.fenster_von/fenster_bis (ENT-279) ist das
//     AUSFÜHRUNGSFENSTER, also WANN eine Runde STARTEN darf -- nicht wie
//     lange sie dauern soll.
//   - einsaetze.von/bis ist die Schichtzeit. Eine Schicht kann mehrere,
//     unterschiedlich lange Kontrollrunden enthalten (siehe Beispiel
//     "Oeffnungsrunde, 1 Punkt" in rundgang.php) -- das Schichtende taugt
//     darum nicht als erwartetes Ende EINER Runde.
// ENT-153 selbst spricht von einer "Zweistundenrunde" als Beispiel -- die
// erwartete Dauer ist also ein reales Domänenkonzept, nur bisher nirgends
// gespeichert.
//
// Diese Änderung bringt darum eine NEUE, nullable Spalte mit:
// rundgang_vorlage.erwartete_dauer_min (Migration in
// planung_einrichten_kern.php, gleiches Muster wie fenster_von/fenster_bis
// an derselben Tabelle). NULL heisst ausdrücklich "keine Sollzeit
// hinterlegt" -- eine solche Runde wird NICHT auf Überfälligkeit geprüft
// (kein stiller Rückfall auf einen geratenen Wert, kein Fehlalarm aus einer
// erfundenen Zahl). Dasselbe gilt für Runden ohne jede Vorlage (spontaner
// Start, ENT-283): auch sie werden nicht geprüft. Die Bilanz von
// alleinarbeiterschutz_stufe1_pruefen() zählt diesen Fall EIGENS
// ('ohne_sollzeit'), damit "nicht geprüft" nie wie "in Ordnung" aussieht
// (CLAUDE.md, "Unbekannt darf nie wie keine aussehen").
//
// DIES IST EINE NEUE DATENMODELL-ENTSCHEIDUNG, die dieser Auftrag nicht
// ausdrücklich vorgesehen hatte (er ging davon aus, das Feld liesse sich
// nur "nachschlagen"). Sie ist bewusst minimal und additiv gehalten, folgt
// exakt dem bestehenden Muster derselben Tabelle und wird hier so
// dokumentiert, DAMIT SIE VOR EINEM MERGE NACH sop-projekt/00-projekt/
// entscheidungsprotokoll.md NACHGETRAGEN WERDEN KANN -- nicht, weil sie
// heimlich bleiben soll. Siehe Abschlussbericht der Sitzung, die diese
// Datei angelegt hat.
// ══════════════════════════════════════════════════════════════════════
//
// PAUSE (ENT-298/ENT-244): Eine PAUSIERTE Runde (status 'pausiert') läuft
// nicht "über" -- wer pausiert, hat sich aktiv gemeldet, das ist kein
// Verstummen. Geprüft werden darum ausschliesslich Runden im Status
// 'laeuft'. Für sie zählt rundgang.pause_minuten (die Summe bereits
// ABGESCHLOSSENER Pausen dieser Runde) von der verstrichenen Zeit ab --
// exakt dieselbe Rausrechnung wie in rundgang_dauer() (ENT-322,
// rundgang.php), nur für eine noch laufende statt einer beendeten Runde,
// darum eine eigene, kleine Funktion statt eines Aufrufs dorthin.
//
// KEIN DOPPEL-PUSH: rundgang.stufe1_gemeldet_um (neue Spalte, Migration wie
// oben) wird gesetzt, SOBALD eine Runde als überfällig erkannt und ein
// Versand versucht wurde -- unabhängig davon, ob ein Gerät tatsächlich
// erreicht wurde. Gleiche Haltung wie push_gesendet_am bei Mitteilungen
// (push.php): die Spalte hält die ERKENNUNG fest, nicht den Erfolg der
// Zustellung. Fehlt die Spalte (Einrichtung nicht gelaufen), wird
// GAR NICHT geprüft, statt bei jedem Lauf erneut zu melden -- dieselbe
// Härte wie ENT-299 (betrieb.pikett_telefon): lieber gar nicht prüfen als
// falsch.
//
// WICHTIGE EINSCHRÄNKUNG DES PUSH-KANALS, die diese Datei NICHT beheben
// kann (Architektur-Vorgabe: push.php nicht ändern): push_zustellen() in
// push.php verschickt bewusst KEINE Nutzlast (siehe dortiger Kommentar,
// ENT-424) -- der Server verschickt auf dem Sperrbildschirm nie den
// Mitteilungstext, aus Datenschutzgründen (kein Klartext über Apples/
// Googles Server). Ein Stufe-1-Push weckt das Gerät der Zentrale also nur;
// WAS überfällig ist (Objekt, Vorlage, seit wann), steht erst in der App
// -- die hier gebaute Funktion kann diesen Inhalt nicht mitschicken, weil
// der Kanal es architektonisch nicht vorsieht. Das ist kein Fehler dieser
// Änderung, sondern eine bestehende, bewusste Grenze.

// Feste Karenzzeit (ENT-644 Punkt 3, ausdrücklich NICHT konfigurierbar --
// CLAUDE.md: "Konfigurierbarkeit ist kein Qualitätsmerkmal").
const ALLEINARBEITERSCHUTZ_KARENZ_MIN = 10;

/**
 * Rollen-Schlüssel, die den Bereich 'alarmempfaenger' gewähren -- egal in
 * welcher Stufe (heute nur STUFE_LESEN gültig, siehe bereiche_katalog()).
 *
 * Liest AUSSCHLIESSLICH rollen_definitionen($pdo) (rechte.php) -- dieselbe
 * Quelle, die auch das Cockpit für die Rollenverwaltung nutzt. Kein zweiter
 * Vergabeweg: Wird 'alarmempfaenger' künftig einer weiteren System- oder
 * eigenen Profilrolle zugeteilt, greift diese Funktion es automatisch auf,
 * ohne dass hier etwas geändert werden müsste.
 */
function alleinarbeiterschutz_alarmempfaenger_rollen(PDO $pdo): array
{
    $rollen = [];
    foreach (rollen_definitionen($pdo) as $schluessel => $definition) {
        $stufe = $definition['stufen']['alarmempfaenger'] ?? null;
        if ($stufe !== null && stufe_gueltig('alarmempfaenger', (string)$stufe)) {
            $rollen[] = $schluessel;
        }
    }
    return $rollen;
}

/**
 * mitarbeiter_id der aktiven Alarmempfänger -- Ableitung aus
 * mitarbeiter_rollen für genau die Rollen aus obiger Funktion.
 *
 * "Aktiv" (mitarbeiter.aktiv = 1): eine ausgetretene Person mit stehen
 * gebliebener Rolle darf nicht mehr angerufen werden -- ihr Gerät ist
 * womöglich nicht einmal mehr im Betrieb.
 */
function alleinarbeiterschutz_empfaenger_ids(PDO $pdo): array
{
    $rollen = alleinarbeiterschutz_alarmempfaenger_rollen($pdo);
    if (!$rollen || !hat_tabelle($pdo, 'mitarbeiter_rollen') || !hat_tabelle($pdo, 'mitarbeiter')) {
        return [];
    }
    $marken = implode(',', array_fill(0, count($rollen), '?'));
    $stmt = $pdo->prepare(
        "SELECT DISTINCT r.mitarbeiter_id
           FROM mitarbeiter_rollen r
           JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
          WHERE m.aktiv = 1 AND r.rolle IN ($marken)"
    );
    $stmt->execute($rollen);
    return array_map('intval', array_column($stmt->fetchAll(PDO::FETCH_ASSOC), 'mitarbeiter_id'));
}

/**
 * Effektiv verstrichene Laufzeit einer Runde in Minuten, Pausen
 * herausgerechnet -- NUR für status 'laeuft' definiert (siehe Kommentar am
 * Dateikopf: eine pausierte Runde läuft nicht über).
 *
 * Reine Funktion, kein PDO -- genau wie rundgang_dauer() in rundgang.php
 * darum ohne Datenbank prüfbar. $jetzt wird mitgegeben statt aus der Uhr
 * gelesen, aus demselben Grund.
 *
 * null bedeutet "keine Aussage möglich" (falscher Status, kein Start, ein
 * kaputtes Datum) -- eine solche Runde gilt NICHT als überfällig, aber auch
 * nicht ausdrücklich als unauffällig. Der Aufrufer behandelt sie wie eine
 * ohne Sollzeit: nicht geprüft, nicht stillschweigend "in Ordnung".
 */
function alleinarbeiterschutz_laufzeit_min(?string $rohzeitStart, int $pauseMinuten,
                                            string $status, string $jetzt): ?float
{
    if ($status !== 'laeuft') {
        return null;
    }
    $start = trim((string)$rohzeitStart);
    if ($start === '') {
        return null;
    }
    $von = strtotime($start);
    $bis = strtotime($jetzt);
    if ($von === false || $bis === false) {
        return null;
    }
    $minuten = ($bis - $von) / 60 - max(0, $pauseMinuten);
    // Ein negativer Wert (kaputte Daten, Uhr rückwärts) ist keine Aussage
    // über eine überfällige Runde -- geklemmt wie in rundgang_dauer().
    return max(0.0, $minuten);
}

/**
 * Der Rechenkern: welche laufenden Runden sind gerade (Stand $jetzt) um
 * mehr als $karenzMin über ihrer konfigurierten Sollzeit, und wurden noch
 * nicht gemeldet? Reine Lese-Funktion, kein Versand, kein Schreiben --
 * eigens herausgezogen, damit sich die Erkennung ohne Push-Infrastruktur
 * prüfen lässt (gleiches Prinzip wie push_abos_fuer_mitteilung() in
 * push.php).
 *
 * Fehlen die nötigen Spalten (Einrichtung nicht gelaufen), liefert die
 * Funktion eine LEERE Liste UND signalisiert das über den dritten
 * Rückgabewert nicht -- siehe alleinarbeiterschutz_stufe1_pruefen(), die
 * diesen Fall VOR dem Aufruf hier bereits behandelt und dort meldet. Diese
 * Funktion selbst bleibt darum bewusst schlicht: keine Spalte, keine Zeile.
 */
function alleinarbeiterschutz_ueberfaellige_runden(PDO $pdo, string $jetzt,
    int $karenzMin = ALLEINARBEITERSCHUTZ_KARENZ_MIN): array
{
    $stmt = $pdo->query(
        "SELECT r.id, r.einsatz_id, r.mitarbeiter_id, r.objekt_id, r.rohzeit_start,
                r.pause_minuten, r.status, o.name AS objekt_name,
                v.name AS vorlage_name, v.erwartete_dauer_min
           FROM rundgang r
           JOIN objekte o ON o.id = r.objekt_id
      LEFT JOIN rundgang_vorlage v ON v.id = r.rundgang_vorlage_id
          WHERE r.status = 'laeuft' AND r.stufe1_gemeldet_um IS NULL"
    );
    $laufende = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $ueberfaellig = [];
    $ohneSollzeit = 0;
    foreach ($laufende as $z) {
        if ($z['erwartete_dauer_min'] === null) {
            $ohneSollzeit++;
            continue;
        }
        $laufzeit = alleinarbeiterschutz_laufzeit_min(
            $z['rohzeit_start'], (int)$z['pause_minuten'], (string)$z['status'], $jetzt);
        if ($laufzeit === null) {
            continue;
        }
        if ($laufzeit >= (float)$z['erwartete_dauer_min'] + $karenzMin) {
            $ueberfaellig[] = $z;
        }
    }
    return ['geprueft' => count($laufende), 'ohne_sollzeit' => $ohneSollzeit, 'ueberfaellig' => $ueberfaellig];
}

/**
 * DER EINSTIEG für den Zeitgeber (backend/api/push_versand.php, ENT-424,
 * additiv eingehängt): erkennt überfällige Runden, ermittelt die
 * Alarmempfänger, verschickt Stufe-1-Push je überfälliger Runde und Gerät,
 * und vermerkt die Erkennung -- kein Schreiben an rundgang ausser dieser
 * einen Spalte.
 *
 * Gibt IMMER eine Bilanz zurück, auch wenn nichts zu tun war -- der Aufrufer
 * kann sie unverändert in seine JSON-Antwort einhängen, analog zum
 * bestehenden 'support'-Feld dort.
 */
function alleinarbeiterschutz_stufe1_pruefen(PDO $pdo, string $jetzt,
    int $karenzMin = ALLEINARBEITERSCHUTZ_KARENZ_MIN): array
{
    $bilanz = [
        'eingerichtet'  => false,
        'geprueft'      => 0,
        'ohne_sollzeit' => 0,
        'ueberfaellig'  => 0,
        'gemeldet'      => 0,
        'empfaenger'    => 0,
        'geraete'       => 0,
        'zugestellt'    => 0,
        'entfernt'      => 0,
        'fehler'        => 0,
    ];

    // Kein stiller Rückfall (dieselbe Härte wie ENT-299/ENT-644): Fehlt eine
    // der beiden neuen Spalten oder eine der beteiligten Tabellen, wird GAR
    // NICHT geprüft -- statt fälschlich "0 überfällig" zu melden, was wie
    // "alles in Ordnung" aussähe.
    if (!hat_tabelle($pdo, 'rundgang') || !hat_tabelle($pdo, 'rundgang_vorlage')
        || !hat_tabelle($pdo, 'objekte')
        || !hat_spalte($pdo, 'rundgang', 'stufe1_gemeldet_um')
        || !hat_spalte($pdo, 'rundgang_vorlage', 'erwartete_dauer_min')) {
        $bilanz['meldung'] = 'Alleinarbeiterschutz Stufe 1 ist nicht eingerichtet — '
            . 'einmal „Einrichtung" ausführen.';
        return $bilanz;
    }
    $bilanz['eingerichtet'] = true;

    $fund = alleinarbeiterschutz_ueberfaellige_runden($pdo, $jetzt, $karenzMin);
    $bilanz['geprueft'] = $fund['geprueft'];
    $bilanz['ohne_sollzeit'] = $fund['ohne_sollzeit'];
    $ueberfaellig = $fund['ueberfaellig'];
    $bilanz['ueberfaellig'] = count($ueberfaellig);
    if (!$ueberfaellig) {
        return $bilanz;
    }

    $empfaengerIds = alleinarbeiterschutz_empfaenger_ids($pdo);
    $bilanz['empfaenger'] = count($empfaengerIds);

    // Gleiches Muster wie push_fuer_mitteilung(): ohne eingerichteten Push
    // oder ohne die Abo-Tabelle wird nichts verschickt -- aber die
    // ERKENNUNG unten wird trotzdem vermerkt, exakt wie push_gesendet_am
    // bei einer Mitteilung ohne konfigurierten Push auch gesetzt wird
    // (siehe push_versand.php: push_mitteilung_vermerken() läuft
    // unbedingt). Ein Doppel-Push beim späteren Nachrüsten des
    // Push-Schlüssels wird damit bewusst in Kauf genommen -- die Alternative
    // (ewig neu versuchen) wäre schlechter: Jeder Lauf meldete dieselbe,
    // längst überfällige Runde erneut.
    $abos = [];
    if ($empfaengerIds && push_konfiguriert() && hat_tabelle($pdo, 'push_abo')) {
        $abos = push_abos_fuer($pdo, $empfaengerIds);
    }

    foreach ($ueberfaellig as $runde) {
        foreach ($abos as $abo) {
            $bilanz['geraete']++;
            $ergebnis = push_zustellen($abo);
            if ($ergebnis['ausgang'] === 'ok') {
                $bilanz['zugestellt']++;
                push_abo_erfolg($pdo, (int)$abo['id'], $jetzt);
            } elseif ($ergebnis['ausgang'] === 'entfernen') {
                $bilanz['entfernt']++;
                push_abo_abmelden($pdo, (int)$abo['id'], 'Push-Dienst: ' . $ergebnis['code'], $jetzt);
            } else {
                $bilanz['fehler']++;
                push_abo_fehler($pdo, (int)$abo['id'], $ergebnis['meldung'] ?: ('HTTP ' . $ergebnis['code']), $jetzt);
            }
        }
        $pdo->prepare('UPDATE rundgang SET stufe1_gemeldet_um = ? WHERE id = ?')
            ->execute([$jetzt, (int)$runde['id']]);
        $bilanz['gemeldet']++;
    }

    return $bilanz;
}

/**
 * LESEN statt ERKENNEN: die aktuell offenen Stufe-1-Alarme, fuer die
 * Cockpit-Anzeige (Kachel "Alarme" in der Revierdienst-Uebersicht,
 * dashboard.html). Anders als alleinarbeiterschutz_ueberfaellige_runden()
 * oben (Rechenkern, entscheidet NEU, was ueberfaellig ist) liest diese
 * Funktion nur das bereits VERMERKTE Ergebnis: eine laufende Runde mit
 * gesetztem stufe1_gemeldet_um. Kein Versand, kein Schreiben, kein
 * doppelter Berechnungsweg -- exakt dieselbe Zurueckhaltung wie
 * alleinarbeiterschutz_ueberfaellige_runden() (reine Lese-Funktion, damit
 * sie sich ohne Push-Infrastruktur prüfen laesst).
 *
 * Eine Runde verlaesst diese Liste von selbst, sobald ihr status nicht
 * mehr 'laeuft' ist (beendet/abgebrochen) -- die WHERE-Klausel prueft das
 * bei jedem Aufruf neu, es gibt keinen eigenen "aufgeloest"-Zustand im
 * Datenmodell.
 *
 * "faellig_seit" ist NICHT der Meldezeitpunkt (stufe1_gemeldet_um),
 * sondern der Moment, an dem die Sollzeit selbst ueberschritten wurde --
 * VOR der Karenz. Aussagekraeftiger fuer die Einsatzleitung, weil er die
 * tatsaechliche Ueberschreitung zeigt, nicht nur, wann der Server sie
 * erkannt hat (Auftragsvorgabe: "nachschauen, was aussagekraeftiger ist").
 * Rechnung spiegelbildlich zu alleinarbeiterschutz_laufzeit_min(): Start
 * plus Sollzeit plus bereits abgeschlossene Pausenminuten (dieselbe
 * Rausrechnung wie dort, nur vorwaerts statt rueckwaerts angewandt).
 * "ueberfaellig_min" wird HIER, gegen $jetzt, fertig ausgerechnet -- nicht
 * im Frontend gegen die Uhr des Browsers, die von der des Servers
 * abweichen kann.
 *
 * Kein stiller Ruckfall (dieselbe Haltung wie
 * alleinarbeiterschutz_stufe1_pruefen()): Fehlt die Spalte oder eine der
 * beteiligten Tabellen, meldet der erste Rueckgabewert das ausdruecklich,
 * statt eine leere Liste zurueckzugeben, die wie "keine Alarme" aussaehe.
 */
function alleinarbeiterschutz_offene_alarme(PDO $pdo, string $jetzt): array
{
    if (!hat_tabelle($pdo, 'rundgang') || !hat_tabelle($pdo, 'objekte')
        || !hat_tabelle($pdo, 'mitarbeiter')
        || !hat_spalte($pdo, 'rundgang', 'stufe1_gemeldet_um')) {
        return ['eingerichtet' => false, 'alarme' => []];
    }
    $stmt = $pdo->query(
        "SELECT r.id, r.objekt_id, r.rohzeit_start, r.pause_minuten, r.stufe1_gemeldet_um,
                o.name AS objekt_name, v.name AS vorlage_name, v.erwartete_dauer_min,
                m.id AS mitarbeiter_id, m.vorname, m.nachname
           FROM rundgang r
           JOIN objekte o ON o.id = r.objekt_id
           JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
      LEFT JOIN rundgang_vorlage v ON v.id = r.rundgang_vorlage_id
          WHERE r.status = 'laeuft' AND r.stufe1_gemeldet_um IS NOT NULL
       ORDER BY r.stufe1_gemeldet_um ASC"
    );
    $jetztTs = strtotime($jetzt);
    $alarme = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $z) {
        $start = trim((string)$z['rohzeit_start']);
        $vonTs = $start !== '' ? strtotime($start) : false;
        $faelligSeit = null;
        $ueberfaelligMin = null;
        // erwartete_dauer_min kann fehlen, wenn die Vorlage NACH dem Alarm
        // geaendert wurde (die Sollzeit selbst ist nicht rueckwirkend) --
        // "faellig_seit" bleibt dann null statt eines geratenen Werts,
        // "gemeldet_um" traegt die Aussage in diesem Fall allein.
        if ($vonTs !== false && $z['erwartete_dauer_min'] !== null) {
            $faelligTs = $vonTs + ((float)$z['erwartete_dauer_min'] + max(0, (int)$z['pause_minuten'])) * 60;
            $faelligSeit = date('Y-m-d H:i:s', (int)round($faelligTs));
            if ($jetztTs !== false) {
                $ueberfaelligMin = (int)max(0, round(($jetztTs - $faelligTs) / 60));
            }
        }
        $alarme[] = [
            'rundgang_id'      => (int)$z['id'],
            'objekt_id'        => (int)$z['objekt_id'],
            'objekt_name'      => $z['objekt_name'],
            // null bei einer spontan gestarteten Runde ohne Vorlage
            // (ENT-283) -- die Oberflaeche sagt "Ohne Vorlage", nicht "".
            'vorlage_name'     => $z['vorlage_name'],
            'mitarbeiter_id'   => (int)$z['mitarbeiter_id'],
            'name'             => trim(($z['vorname'] ?? '') . ' ' . ($z['nachname'] ?? '')),
            'gemeldet_um'      => $z['stufe1_gemeldet_um'],
            'faellig_seit'     => $faelligSeit,
            'ueberfaellig_min' => $ueberfaelligMin,
        ];
    }
    return ['eingerichtet' => true, 'alarme' => $alarme];
}
