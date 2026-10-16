<?php
// Testdaten der Testseite leeren und neu befuellen (ENT-714).
//
// NUR AUF STAGING. ist_staging() haengt am exakten Wert "staging" aus dem
// Deploy (fail-safe, siehe db.php) -- auf Produktion, Mandanten, Demo und
// beim Betreiber antwortet dieser Weg mit "nicht gefunden", wie es
// require_demo_umgebung() fuer die Demo tut. Die Kachel in der Oberflaeche
// erspart nur den Umweg; die Sperre sitzt hier.
//
// RECHT: rechte_schreiben. Das Leeren entfernt alle Personen ohne Cockpit-
// Zugang -- das darf nur, wer Rollen vergeben darf.
//
// IN SCHRITTEN (POST {schritt}):
//   start      Bestaetigungswort pruefen, leeren, Stammdaten anlegen.
//              Antwort: die Monate, die danach einzeln folgen.
//   monat      {monat: 'YYYY-MM'} Einsaetze, Abgleich, Auslagenersatz,
//              Rechnungen und Lohnlauf dieses Monats.
//   abschluss  Planung ueber das Monatsende, Offerten, Sonderfaelle,
//              Zusammenfassung.
// Jeder Schritt ist eine eigene Transaktion. Bricht es mittendrin ab,
// beginnt ein neuer Klick wieder bei "start", und das leert zuerst.
declare(strict_types=1);
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../demo_daten.php';   // Bausteine des Demo-Musterbetriebs, Lohnlauf
require_once __DIR__ . '/../auslagen.php';     // auslagen_zeile()
require_once __DIR__ . '/../belege.php';       // beleg_*()

// ══════════════════════════════════════════════════════════════════════
// TESTDATEN DER TESTSEITE (ENT-714)
// ══════════════════════════════════════════════════════════════════════
//
// Ein erfundener Betrieb mit 15 Monaten Geschichte, damit sich die
// Finanz-Uebersicht (ENT-712) und alles andere an einem gefuellten Stand
// beurteilen laesst. Laeuft NUR auf der Testseite (ist_staging(), vom
// Endpunkt api/testdaten.php geprueft) und ueber den Knopf unter
// Administration -> Betrieb -> Testdaten.
//
// WARUM IM ENDPUNKT SELBST: Eine neue Hilfsdatei muesste in die Staging-
// .htaccess, die von Hand gepflegt wird (Drift-Guard, ENT-384/387). In
// demo_daten.php kann er nicht stehen: Diese Datei laden auch die
// oeffentlichen Demo-Endpunkte im Betreiber-Buendel, und dort liegen
// auslagen.php und belege.php nicht (test_ladepfad.mjs, test_deploy.mjs).
// Die Funktionen stehen darum oben in dieser Datei, die Anfrage wird nur
// bearbeitet, wenn die Datei selbst aufgerufen ist -- so kann
// pruef_testdaten.php sie einbinden, ohne eine Anfrage auszuloesen.
//
// DIESELBE GRUNDREGEL WIE BEIM DEMO-BETRIEB: Rechtsgroessen werden nie
// erfunden. Arbeitszeit und Lohn rechnen lohnlauf.php/gavzeit.php, der
// Auslagenersatz auslagen_zeile() (dieselbe Funktion wie im Abgleich),
// Rechnungssummen beleg_summen_schreiben() (dieselbe wie im Formular).
// Erfunden sind nur Stammdaten, geplante Zeiten und Zahlungsdaten.
//
// IN SCHRITTEN, weil 15 Monate eine einzelne Anfrage auf dem Hosting
// sprengen koennten: "start" (leeren, Stammdaten), je Monat "monat",
// "abschluss" (Zukunft, Offerten, Sonderfaelle). Bricht es ab, beginnt
// ein neuer Klick wieder bei "start" -- das leert zuerst, der Zustand
// heilt sich damit selbst.

const TD_MONATE = 15;          // Monate Geschichte einschliesslich des laufenden
const TD_ZUKUNFT_TAGE = 21;    // Planung nach vorne
const TD_OFFEN_TAGE = 3;       // die letzten Tage bleiben unabgeglichen
const TD_BESTAETIGUNG = 'TESTDATEN';

class TestdatenFehler extends RuntimeException {}

// Die Monate der Geschichte, aeltester zuerst, bis zum laufenden.
function td_monate(?string $heute = null): array
{
    $h = new DateTimeImmutable($heute ?? 'today');
    $erster = $h->modify('first day of this month');
    $m = [];
    for ($i = TD_MONATE - 1; $i >= 0; $i--) { $m[] = $erster->modify("-{$i} months")->format('Y-m'); }
    return $m;
}

// ── Leeren ───────────────────────────────────────────────────────────
// Was stehen bleibt (ENT-714, Punkt 2): Konten mit Cockpit-Zugang samt
// allem, was an ihrer Anmeldung haengt, die Einstellungen des Betriebs,
// die Kataloge aus der Einrichtung und alles, was dem Betreiber gehoert.
// Alles UEBRIGE wird geleert -- auch eine Tabelle, die erst ein spaeteres
// Feature anlegt. Eine Liste dessen, was zu leeren ist, wuerde genau diese
// vergessen (gleiche Ueberlegung wie demo_reset_alle_tabellen_leeren()).
const TD_BEHALTEN = [
    'sessions', 'kunden_sessions', 'zwei_faktor', 'zwei_faktor_codes', 'zwei_faktor_geraete',
    'anmeldeversuche', 'passwort_reset', 'rollen', 'rollen_rechte', 'betrieb', 'benutzer_layout',
    'tutorial_gesehen', 'lohnart', 'ereignisart', 'anstellungsorte', 'aenderungslog',
    'push_abo', 'handbuch_ticket',
];
const TD_BEHALTEN_PRAEFIXE = ['support_', 'betreiber', 'be_', 'mandant', 'demo_'];
// Zwei Tabellen werden nicht geleert, sondern bereinigt.
const TD_TEILWEISE = ['mitarbeiter', 'mitarbeiter_rollen'];

function td_tabelle_behalten(string $t): bool
{
    if (in_array($t, TD_BEHALTEN, true) || in_array($t, TD_TEILWEISE, true)) { return true; }
    foreach (TD_BEHALTEN_PRAEFIXE as $p) { if (str_starts_with($t, $p)) { return true; } }
    return false;
}

function td_tabellen(PDO $pdo): array
{
    if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') {
        return $pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
                   ->fetchAll(PDO::FETCH_COLUMN);
    }
    return $pdo->query("SELECT TABLE_NAME FROM information_schema.TABLES
                         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'")
               ->fetchAll(PDO::FETCH_COLUMN);
}

// Wer bleibt: jedes Konto mit Cockpit-Zugang (mindestens ein Recht, wie
// darf_verwaltung()) und jedes Support-Konto. Alle uebrigen Personen sind
// Inhalt der Testseite und werden ersetzt.
function td_konten_behalten(PDO $pdo): array
{
    $support = function_exists('hat_spalte') && hat_spalte($pdo, 'mitarbeiter', 'support_konto');
    $def = rollen_tabellen_da($pdo) ? rollen_definitionen($pdo) : null;
    $ids = [];
    foreach ($pdo->query('SELECT id, ist_admin' . ($support ? ', support_konto' : '') . ' FROM mitarbeiter')->fetchAll() as $m) {
        if ($support && (int)$m['support_konto'] === 1) { $ids[] = (int)$m['id']; continue; }
        $rollen = rechte_rollen($pdo, (int)$m['id'], !empty($m['ist_admin']));
        if (rechte_aus_rollen($rollen, $def) !== []) { $ids[] = (int)$m['id']; }
    }
    return $ids;
}

function td_leeren(PDO $pdo): array
{
    $behalten = td_konten_behalten($pdo);
    if (!$behalten) {
        // Ohne ein einziges Konto mit Cockpit-Zugang waere nach dem Leeren
        // niemand mehr da, der sich anmelden kann.
        throw new TestdatenFehler('Kein Konto mit Cockpit-Zugang gefunden -- abgebrochen, bevor etwas geleert wurde.');
    }
    $sqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
    $pdo->exec($sqlite ? 'PRAGMA foreign_keys = OFF' : 'SET FOREIGN_KEY_CHECKS = 0');
    $geleert = 0;
    foreach (td_tabellen($pdo) as $t) {
        $t = (string)$t;
        if (td_tabelle_behalten($t)) { continue; }
        $pdo->exec(($sqlite ? 'DELETE FROM `' : 'TRUNCATE TABLE `') . str_replace('`', '', $t) . '`');
        $geleert++;
    }
    $platz = implode(',', array_fill(0, count($behalten), '?'));
    $pdo->prepare("DELETE FROM mitarbeiter WHERE id NOT IN ($platz)")->execute($behalten);
    $pdo->exec('DELETE FROM mitarbeiter_rollen WHERE mitarbeiter_id NOT IN (SELECT id FROM mitarbeiter)');
    $pdo->exec($sqlite ? 'PRAGMA foreign_keys = ON' : 'SET FOREIGN_KEY_CHECKS = 1');
    return ['tabellen' => $geleert, 'konten_behalten' => count($behalten)];
}

// ── Stammdaten ───────────────────────────────────────────────────────
// Erfundene Namen, kein Bezug zu realen Personen oder Betrieben.
// [Vorname, Nachname, Funktion, Abteilung, Rollen, Verkehrsmittel]
// Verkehrsmittel NULL bei EINER Person: Ihr Auslagenersatz bleibt ohne
// Betrag gesperrt ("verkehrsmittel_unbekannt") -- ein Sonderfall, den die
// Uebersicht zeigen soll (ENT-714, Punkt 7).
function td_mitarbeiterliste(): array
{
    $pv = 'Privatfahrzeug'; $ov = 'Oeffentlicher Verkehr'; $mf = 'Mitfahrer';
    $w = ['mitarbeitend', 'waechter'];
    return [
        ['Lea',     'Aebischer', 'Verwaltung',       'Zentrale',       ['personal'], $pv],
        ['Jonas',   'Marti',     'Einsatzleiter/in', 'Zentrale',       ['planung'], $pv],
        ['Sara',    'Lüthi',     'Einsatzleiter/in', 'Zentrale',       ['planung'], $ov],
        ['Nico',    'Gerber',    'Gruppenleiter/in', 'Revierdienst',   $w, $pv],
        ['Mira',    'Stalder',   'Gruppenleiter/in', 'Verkehrsdienst', $w, $pv],
        ['Luca',    'Bühler',    'Wächter/in',       'Revierdienst',   $w, $pv],
        ['Nina',    'Wyss',      'Wächter/in',       'Revierdienst',   $w, $ov],
        ['Timo',    'Kessler',   'Wächter/in',       'Revierdienst',   $w, $pv],
        ['Alina',   'Schmid',    'Wächter/in',       'Revierdienst',   $w, $mf],
        ['David',   'Hofer',     'Wächter/in',       'Revierdienst',   $w, $pv],
        ['Leonie',  'Moser',     'Wächter/in',       'Revierdienst',   $w, $ov],
        ['Samuel',  'Graf',      'Wächter/in',       'Revierdienst',   $w, $pv],
        ['Jana',    'Rüegg',     'Wächter/in',       'Revierdienst',   $w, $pv],
        ['Elias',   'Baumgartner','Wächter/in',      'Revierdienst',   $w, $mf],
        ['Selina',  'Käser',     'Wächter/in',       'Revierdienst',   $w, $pv],
        ['Robin',   'Imhof',     'Wächter/in',       'Revierdienst',   $w, null],
        ['Carla',   'Zbinden',   'Wächter/in',       'Revierdienst',   $w, $pv],
        ['Yannick', 'Studer',    'Wächter/in',       'Revierdienst',   $w, $ov],
        ['Melina',  'Burri',     'Wächter/in',       'Revierdienst',   $w, $pv],
        ['Kevin',   'Egli',      'Wächter/in',       'Verkehrsdienst', $w, $pv],
        ['Aline',   'Jost',      'Wächter/in',       'Verkehrsdienst', $w, $ov],
        ['Dario',   'Bieri',     'Wächter/in',       'Verkehrsdienst', $w, $pv],
        ['Fiona',   'Siegrist',  'Wächter/in',       'Verkehrsdienst', $w, $mf],
        ['Cédric',  'Vogt',      'Wächter/in',       'Verkehrsdienst', $w, $pv],
        ['Tamara',  'Blaser',    'Wächter/in',       'Verkehrsdienst', $w, $pv],
        ['Adrian',  'Flury',     'Wächter/in',       'Verkehrsdienst', $w, $ov],
        ['Laura',   'Suter',     'Wächter/in',       'Verkehrsdienst', $w, $pv],
        ['Mattia',  'Rossi',     'Wächter/in',       'Verkehrsdienst', $w, $pv],
        ['Zoe',     'Leuenberger','Wächter/in',      'Verkehrsdienst', $w, $pv],
        ['Ramon',   'Tanner',    'Wächter/in',       'Verkehrsdienst', $w, $mf],
    ];
}

function td_mitarbeitende_erzeugen(PDO $pdo, array $ids): array
{
    // Kein Anmeldepasswort: Ein zufaelliger Wert, den niemand kennt. Die
    // Personen sind Inhalt der Testseite, keine Zugaenge.
    $hash = password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN]);
    $orte = ['4600 Olten', '4632 Trimbach', '4702 Oensingen', '4900 Langenthal', '4665 Oftringen', '4614 Hägendorf'];
    $vmSpalte = hat_spalte($pdo, 'mitarbeiter', 'verkehrsmittel');
    $ein = $pdo->prepare(
        'INSERT INTO mitarbeiter (name, password_hash, ist_admin, vorname, nachname, ort, email,
             anstellungskategorie, pensum_stunden, eintritt, geburtsdatum, personalnummer)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $vmSetzen = $vmSpalte ? $pdo->prepare('UPDATE mitarbeiter SET verkehrsmittel = ? WHERE id = ?') : null;
    $rolle = $pdo->prepare('INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (?, ?)');
    $revier = hat_spalte($pdo, 'mitarbeiter', 'revierdienst_berechtigt')
        ? $pdo->prepare('UPDATE mitarbeiter SET revierdienst_berechtigt = 1 WHERE id = ?') : null;

    $angelegt = [];
    foreach (td_mitarbeiterliste() as $i => $zeile) {
        [$vor, $nach, , $abteilung, $rollen, $vm] = $zeile;
        $nr = $i + 1;
        $login = ma_login_generieren($vor, $nach, $pdo);
        // Eintritt vor der ganzen Geschichte: Eine Person, die mittendrin
        // anfaengt, haette davor entweder gearbeitet, ohne angestellt zu
        // sein, oder ihr Partner haette ueber 210 Stunden im Monat geleistet.
        $eintritt = demo_tag(-(520 + ($nr * 137) % 1400));
        $geburt = demo_tag(-(365 * 21) - (($nr * 733) % (365 * 38)));
        $ein->execute([$login, $hash, $vor, $nach, $orte[$i % count($orte)], "$login@beispiel.ch",
                       'C', 1800 + ($nr * 53) % 400, $eintritt, $geburt, str_pad((string)(100 + $nr), 3, '0', STR_PAD_LEFT)]);
        $id = (int)$pdo->lastInsertId();
        if ($vmSetzen) { $vmSetzen->execute([$vm, $id]); }
        foreach ($rollen as $r) { $rolle->execute([$id, $r]); }
        if ($revier && $abteilung === 'Revierdienst') { $revier->execute([$id]); }
        $angelegt[] = ['id' => $id, 'vorname' => $vor, 'nachname' => $nach, 'abteilung' => $abteilung,
                       'rollen' => $rollen, 'verkehrsmittel' => $vm, 'eintritt' => $eintritt];
    }
    return $angelegt;
}

// [Name, Strasse, Ort, Ansprechperson, Zahlungsverhalten in Tagen nach Rechnungsdatum]
// Das Zahlungsverhalten erzeugt die Altersbaender von selbst: Wer nach 12
// Tagen zahlt, ist nie offen; wer nach 75 Tagen zahlt, steht regelmaessig
// in "31-60 Tage"; einer zahlt die letzten Rechnungen gar nicht (null).
function td_kundenliste(): array
{
    return [
        ['Wohnbau Dünnernpark AG',        'Dünnernstrasse 21', '4702 Oensingen',  ['Petra', 'Kunz', 'Liegenschaften'], 14],
        ['Gewerbezentrum Aarewinkel AG',  'Aarauerstrasse 55', '4600 Olten',      ['Martin', 'Hänni', 'Facility Management'], 21],
        ['Einwohnergemeinde Hägendorf',   'Dorfstrasse 1',     '4614 Hägendorf',  ['Brigitte', 'Frey', 'Bauverwaltung'], 28],
        ['Logistikpark Gäu AG',           'Industriering 8',   '4622 Egerkingen', ['Stefan', 'Ammann', 'Standortleitung'], 12],
        ['Spital Mittelland Beispiel AG', 'Spitalweg 3',       '4600 Olten',      ['Claudia', 'Roth', 'Sicherheit'], 35],
        ['Stadion Kleinholz Betriebs AG', 'Kleinholzweg 2',    '4600 Olten',      ['Reto', 'Wälti', 'Eventleitung'], 45],
        ['Baukonsortium Tunnel Nord',     'Baustelle Nord',    '4632 Trimbach',   ['Urs', 'Spring', 'Bauleitung'], 75],
        ['Messe Olten Beispiel GmbH',     'Messeplatz 1',      '4600 Olten',      ['Andrea', 'Bolliger', 'Projektleitung'], 18],
        ['Einkaufszentrum Sälipark AG',   'Sälistrasse 4',     '4600 Olten',      ['Thomas', 'Meyer', 'Center Management'], 24],
        ['Kantonsschule Beispiel',        'Hardwald 10',       '4600 Olten',      ['Monika', 'Schenk', 'Rektorat'], 30],
        ['Datacenter Jurafuss AG',        'Technoweg 5',       '4900 Langenthal', ['Pascal', 'Jäggi', 'Betrieb'], 10],
        ['Musikfestival Beispiel Verein', 'Festplatz',         '4614 Hägendorf',  ['Nadine', 'Kohler', 'Organisation'], null],
    ];
}

// [Kunde-Index, Objektname, Einsatzart, Weg in km ab Anstellungsort, Leistung, Tage-Muster]
// Die Wege verteilen sich absichtlich ueber alle Zonen des Auslagenersatzes
// (Anstellungsgebiet, Pauschalzone 1 und 2, Regiezone).
function td_objektliste(): array
{
    return [
        [0, 'Überbauung Dünnernpark',        'Baustellenbewachung', 14.0, 'baustelle', 'taeglich'],
        [1, 'Gewerbezentrum Aarewinkel',     'Revierdienst',         6.0, 'revier',    'taeglich'],
        [2, 'Gemeindeverwaltung Hägendorf',  'Revierdienst',        12.0, 'revier',    'taeglich'],
        [3, 'Logistikpark Gäu, Tor Ost',     'Revierdienst',        22.0, 'revier',    'taeglich'],
        [4, 'Spital Mittelland, Notfall',    'Revierdienst',         4.0, 'revier',    'taeglich'],
        [6, 'Tunnelbaustelle Nord',          'Baustellenbewachung', 18.0, 'baustelle', 'taeglich'],
        [10,'Datacenter Jurafuss',           'Revierdienst',        42.0, 'revier',    'taeglich'],
        [1, 'Gewerbezentrum Aarewinkel, Empfang', 'Empfang',         6.0, 'empfang',   'werktags'],
        [3, 'Logistikpark Gäu, Einfahrt',    'Verkehrsdienst',      22.0, 'verkehr',   'werktags'],
        [4, 'Spital Mittelland, Empfang',    'Empfang',              4.0, 'empfang',   'werktags'],
        [8, 'Sälipark, Parkhaus',            'Verkehrsdienst',       3.0, 'verkehr',   'werktags'],
        [9, 'Kantonsschule, Schulweg',       'Verkehrsdienst',       5.0, 'verkehr',   'werktags'],
        [2, 'Schulweg Hägendorf',            'Verkehrsdienst',      12.0, 'verkehr',   'werktags'],
        [5, 'Stadion Kleinholz, Heimspiele', 'Verkehrsdienst',       2.0, 'anlass',    'anlass_14'],
        [7, 'Messe Olten',                   'Verkehrsdienst',       1.0, 'anlass',    'anlass_30'],
        [11,'Musikfestival Hägendorf',       'Verkehrsdienst',      12.0, 'anlass',    'anlass_365'],
        [5, 'Stadion Kleinholz, Konzerte',   'Revierdienst',         2.0, 'anlass',    'anlass_45'],
        [0, 'Musterwohnung Dünnernpark',     'Empfang',             14.0, 'empfang',   'wochenende'],
    ];
}

// Leistungen mit Stundensatz exkl. MWST -- erfundene, marktuebliche
// Groessenordnung, keine Preisliste eines echten Betriebs.
function td_leistungen(): array
{
    return [
        'baustelle' => ['Baustellenbewachung',     5450],
        'revier'    => ['Revier- und Objektschutz', 5980],
        'empfang'   => ['Empfangsdienst',           5200],
        'verkehr'   => ['Verkehrsdienst',           5550],
        'anlass'    => ['Anlassdienst',             6400],
    ];
}

function td_stammdaten(PDO $pdo): array
{
    $funktionen = demo_funktionen_abteilungen($pdo);
    $ma = td_mitarbeitende_erzeugen($pdo, $funktionen);

    // Lohnansaetze und Abzuege wie beim Demo-Betrieb (Stammdaten, keine
    // Rechtsgroesse). Der Ansatz liegt ueber dem GAV-Mindestlohn.
    $einAnsatz = $pdo->prepare('INSERT INTO lohn_ansatz (mitarbeiter_id, gueltig_ab, kategorie, ansatz_rappen, ferien_laufend, ml13_bp)
                                VALUES (?, ?, ?, ?, ?, ?)');
    foreach ($ma as $i => $m) { $einAnsatz->execute([$m['id'], demo_tag(-1950), 'C', 2900 + ($i * 53) % 300, 1, 833]); }
    demo_lohn_abzug_erzeugen($pdo);

    // Feiertage fuer die ganze Geschichte (bis zu drei Kalenderjahre).
    $einF = $pdo->prepare('INSERT INTO feiertage (datum, kanton, name, halbtags, ab_zeit, quelle) VALUES (?, ?, ?, ?, ?, ?)');
    $jahr = (int)date('Y');
    foreach ([$jahr - 2, $jahr - 1, $jahr, $jahr + 1] as $j) {
        foreach (feiertage_solothurn($j) as $f) {
            $einF->execute([$f['datum'], DEMO_KANTON, $f['name'], $f['halbtags'], $f['ab_zeit'], 'Testdaten']);
        }
    }

    // Leistungen
    $einP = $pdo->prepare('INSERT INTO produkte (nummer, name, einzelpreis_rappen, einheit, mwst_satz_bp, sortierung) VALUES (?, ?, ?, ?, 810, ?)');
    $i = 0;
    foreach (td_leistungen() as [$name, $preis]) { $i++; $einP->execute(['P' . str_pad((string)$i, 4, '0', STR_PAD_LEFT), $name, $preis, 'Std.', $i]); }

    // Kunden
    $knr = hat_spalte($pdo, 'kunden', 'kundennummer');
    $einK = $pdo->prepare('INSERT INTO kunden (name, strasse, ort, telefon) VALUES (?, ?, ?, ?)');
    $setzeNr = $knr ? $pdo->prepare('UPDATE kunden SET kundennummer = ? WHERE id = ?') : null;
    $einKp = $pdo->prepare('INSERT INTO kunden_person (kunde_id, vorname, nachname, sortierung) VALUES (?, ?, ?, 0)');
    $kunden = [];
    foreach (td_kundenliste() as $i => $zeile) {
        [$name, $strasse, $ort, $ap] = $zeile;
        $einK->execute([$name, $strasse, $ort, '062 555 ' . str_pad((string)(10 + $i), 2, '0', STR_PAD_LEFT) . ' ' . str_pad((string)(20 + $i), 2, '0', STR_PAD_LEFT)]);
        $id = (int)$pdo->lastInsertId();
        if ($setzeNr) { $setzeNr->execute(['A' . str_pad((string)(1 + $i), 4, '0', STR_PAD_LEFT), $id]); }
        $einKp->execute([$id, $ap[0], $ap[1]]);
        $kunden[] = ['id' => $id, 'name' => $name];
    }

    // Objekte
    $einO = $pdo->prepare('INSERT INTO objekte (kunde_id, kunde_name, name, strasse, ort, kanton, einsatzart, sparte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    foreach (td_objektliste() as [$kIdx, $name, $art]) {
        $k = $kunden[$kIdx];
        $roh = td_kundenliste()[$kIdx];
        $einO->execute([$k['id'], $k['name'], $name, $roh[1], $roh[2], DEMO_KANTON, $art, 'sicherheit']);
    }
    return ['mitarbeitende' => count($ma), 'kunden' => count($kunden), 'objekte' => count(td_objektliste())];
}

// ── Zustand, der in jedem Schritt aus der Datenbank gelesen wird ─────
// Kein Zustand zwischen zwei Anfragen im Speicher: Jeder Schritt findet
// Personen, Objekte und Kunden in derselben, festen Reihenfolge wieder.
function td_zustand(PDO $pdo): array
{
    // Die erfundenen Personen werden an ihrem Namen erkannt, nicht an der
    // Personalnummer: Seit ENT-684 traegt JEDES Konto eine, auch die
    // stehengebliebenen Cockpit-Konten -- die gehoeren nicht in die Planung.
    $vm = hat_spalte($pdo, 'mitarbeiter', 'verkehrsmittel') ? 'verkehrsmittel' : 'NULL AS verkehrsmittel';
    $nachName = [];
    foreach ($pdo->query("SELECT id, vorname, nachname, eintritt, $vm FROM mitarbeiter ORDER BY id")->fetchAll() as $m) {
        $nachName[$m['vorname'] . '|' . $m['nachname']] ??= $m;
    }
    $personen = [];
    foreach (td_mitarbeiterliste() as $zeile) {
        $m = $nachName[$zeile[0] . '|' . $zeile[1]] ?? null;
        if (!$m) { throw new TestdatenFehler('Personen fehlen -- zuerst "start" ausfuehren.'); }
        $personen[] = $m + ['abteilung' => $zeile[3], 'rollen' => $zeile[4]];
    }
    $eigene = array_map(fn($p) => (int)$p['id'], $personen);
    $objekte = $pdo->query('SELECT id, kunde_id, kunde_name, name, strasse, ort, einsatzart FROM objekte ORDER BY id')->fetchAll();
    foreach (td_objektliste() as $i => $o) {
        if (!isset($objekte[$i])) { throw new TestdatenFehler('Objekte fehlen -- zuerst "start" ausfuehren.'); }
        $objekte[$i] += ['km' => $o[3], 'leistung' => $o[4], 'muster' => $o[5]];
    }
    $produkte = [];
    foreach ($pdo->query('SELECT id, name, einzelpreis_rappen FROM produkte ORDER BY sortierung')->fetchAll() as $i => $p) {
        $produkte[array_keys(td_leistungen())[$i] ?? 'x'] = $p;
    }
    // Wer Abgleich und Lohnlauf "durchgefuehrt" hat: das aelteste stehen-
    // gebliebene Cockpit-Konto, sonst die erste erfundene Person.
    $verwaltung = $personen[0]['id'];
    foreach (array_keys($nachName) as $k) {
        $id = (int)$nachName[$k]['id'];
        if (!in_array($id, $eigene, true)) { $verwaltung = $id; break; }
    }
    return ['personen' => $personen, 'objekte' => $objekte, 'produkte' => $produkte, 'verwaltung' => $verwaltung];
}

// Feste Teams: Jedes Objekt hat eigene Leute, niemand steht an zwei Orten.
// Taegliche Objekte (Nacht) zwei Personen im Wechsel, werktags eine,
// Anlaesse und Wochenende je eine eigene Person.
function td_teams(array $personen, array $objekte): array
{
    $revier = array_values(array_filter($personen, fn($p) => $p['abteilung'] === 'Revierdienst'));
    $verkehr = array_values(array_filter($personen, fn($p) => $p['abteilung'] === 'Verkehrsdienst'));
    $iR = 0; $iV = 0; $teams = [];
    foreach ($objekte as $o) {
        if ($o['muster'] === 'taeglich') {
            $teams[$o['id']] = [$revier[$iR % count($revier)], $revier[($iR + 1) % count($revier)]];
            $iR += 2;
        } else {
            $teams[$o['id']] = [$verkehr[$iV % count($verkehr)]];
            $iV++;
        }
    }
    return $teams;
}

function td_schicht(string $leistung, string $muster): array
{
    return match (true) {
        $leistung === 'baustelle' => ['18:00', '06:00', 60],
        $leistung === 'revier' && $muster !== 'taeglich' => ['17:00', '01:00', 30],
        $leistung === 'revier'    => ['22:00', '06:00', 30],
        $leistung === 'empfang'   => ['08:00', '17:00', 45],
        $leistung === 'anlass'    => ['15:00', '23:30', 30],
        default                   => ['06:30', '15:30', 45],
    };
}

// Findet an diesem Tag ein Einsatz statt?
function td_tag_aktiv(string $muster, string $datum, int $objektIndex): bool
{
    $d = new DateTimeImmutable($datum);
    $wt = (int)$d->format('N');
    $tagNr = (int)$d->format('z');
    return match ($muster) {
        'taeglich'   => true,
        'werktags'   => $wt <= 5,
        'wochenende' => $wt >= 6,
        'anlass_14'  => $wt === 6 && (int)$d->format('W') % 2 === 0,
        'anlass_30'  => $wt === 5 && (int)$d->format('j') <= 7,
        'anlass_45'  => $wt === 6 && ((int)$d->format('j') >= 15 && (int)$d->format('j') <= 21) && (int)$d->format('n') % 2 === 1,
        'anlass_365' => in_array($d->format('m-d'), ['07-12', '07-13', '07-14'], true)
                        || ($tagNr + $objektIndex) % 97 === 0,
        default      => false,
    };
}

// ── Ein Monat: Einsaetze, Abgleich, Auslagenersatz, Rechnungen, Lohn ──
// Kein einsatz_sperre_pruefen(): Der Schritt legt nur NEUE Einsaetze an
// (wie demo_einsaetze_erzeugen()), eine neue Schicht kann nicht
// abgeglichen sein.
function td_monat(PDO $pdo, string $monat, ?string $heute = null): array
{
    $heute = $heute ?? date('Y-m-d');
    $z = td_zustand($pdo);
    $teams = td_teams($z['personen'], $z['objekte']);
    $von = $monat . '-01';
    $bis = (new DateTimeImmutable($von))->modify('last day of this month')->format('Y-m-d');
    $abgleichBis = (new DateTimeImmutable($heute))->modify('-' . TD_OFFEN_TAGE . ' days')->format('Y-m-d');
    $letzterTag = min($bis, (new DateTimeImmutable($heute))->modify('+' . TD_ZUKUNFT_TAGE . ' days')->format('Y-m-d'));

    $wegSpalte = hat_spalte($pdo, 'einsaetze', 'weg_km');
    $einE = $pdo->prepare('INSERT INTO einsaetze (kunde_id, kunde_name, objekt_id, titel, strasse, ort, einsatzart, sparte, datum, von, bis, bedarf, status'
        . ($wegSpalte ? ', weg_km' : '') . ') VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?' . ($wegSpalte ? ', ?' : '') . ')');
    $oevSpalte = hat_spalte($pdo, 'einsatz_zuteilung', 'oev_rappen');
    $einZ = $pdo->prepare('INSERT INTO einsatz_zuteilung (einsatz_id, mitarbeiter_id, zusage' . ($oevSpalte ? ', oev_rappen' : '') . ') VALUES (?, ?, ?' . ($oevSpalte ? ', ?' : '') . ')');
    $istE = $pdo->prepare("UPDATE einsaetze SET ist_status = 'anwesend', ist_von = ?, ist_bis = ?, ist_pause_min = ?, ist_pause_bezahlt_ma = 0, abgeglichen_von = ?, abgeglichen_am = ? WHERE id = ?");
    $istZ = $pdo->prepare("UPDATE einsatz_zuteilung SET ist_status = 'anwesend', ist_von = ?, ist_bis = ?, ist_pause_min = ?, ist_pause_bezahlt_ma = 0, abgeglichen_von = ?, abgeglichen_am = ? WHERE einsatz_id = ? AND mitarbeiter_id = ?");
    $einA = $pdo->prepare('INSERT INTO einsatz_auslagen (einsatz_id, mitarbeiter_id, zone_schluessel, zone_name, zone_quelle, weg_km, verkehrsmittel,
            fahrzeitersatz_rappen, fahrkostenersatz_rappen, gesperrt_grund, regelwerk, erzeugt_am) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

    $stundenJeObjekt = [];   // abgeglichene Stunden je Objekt fuer die Rechnung
    $anlaesse = [];          // einzeln verrechnete Anlaesse
    $zaehler = ['einsaetze' => 0, 'abgeglichen' => 0, 'auslagen' => 0];
    $tag = new DateTimeImmutable($von);
    $ende = new DateTimeImmutable($letzterTag);
    while ($tag <= $ende) {
        $datum = $tag->format('Y-m-d');
        foreach ($z['objekte'] as $oi => $o) {
            if (!td_tag_aktiv($o['muster'], $datum, $oi)) { continue; }
            $team = $teams[$o['id']];
            $p = $team[((int)$tag->format('z')) % count($team)];
            [$sv, $sb, $pause] = td_schicht($o['leistung'], $o['muster']);
            $einE->execute(array_merge([$o['kunde_id'], $o['kunde_name'], $o['id'], $o['strasse'], $o['ort'], $o['einsatzart'],
                'sicherheit', $datum, $sv, $sb, 'geplant'], $wegSpalte ? [$o['km']] : []));
            $eid = (int)$pdo->lastInsertId();
            $oev = $p['verkehrsmittel'] === 'Oeffentlicher Verkehr' ? 640 + (int)round($o['km'] * 42) : null;
            $einZ->execute(array_merge([$eid, $p['id'], 'bestätigt'], $oevSpalte ? [$oev] : []));
            $zaehler['einsaetze']++;
            if ($datum > $abgleichBis) { continue; }

            $am = (new DateTimeImmutable($datum))->modify('+1 day 8 hours')->format('Y-m-d H:i:s');
            $istE->execute([$sv, $sb, $pause, $z['verwaltung'], $am, $eid]);
            $istZ->execute([$sv, $sb, $pause, $z['verwaltung'], $am, $eid, $p['id']]);
            $zaehler['abgeglichen']++;
            // Auslagenersatz ueber dieselbe Funktion wie der Abgleich.
            $zeile = auslagen_zeile('sicherheit', $datum, (float)$o['km'], $p['verkehrsmittel'], $oev, false);
            $einA->execute([$eid, $p['id'], $zeile['zone_schluessel'], $zeile['zone_name'], $zeile['zone_quelle'],
                $zeile['weg_km'], $zeile['verkehrsmittel'], $zeile['fahrzeitersatz_rappen'], $zeile['fahrkostenersatz_rappen'],
                $zeile['gesperrt_grund'], $zeile['regelwerk'], $am]);
            $zaehler['auslagen']++;
            // Verrechnete Stunden: Anwesenheit abzueglich unbezahlter Pause.
            $min = gavzeit_roh_min($sv, $sb) - $pause;
            if ($o['leistung'] === 'anlass') {
                $anlaesse[] = ['objekt' => $o, 'datum' => $datum, 'min' => $min];
            } else {
                $stundenJeObjekt[$oi] = ($stundenJeObjekt[$oi] ?? 0) + $min;
            }
        }
        $tag = $tag->modify('+1 day');
    }

    $rechnungen = 0;
    // Monatsrechnung je Kunde fuer Daueraufträge -- nur fuer abgeschlossene
    // Monate, am 3. des Folgemonats gestellt.
    if ($bis < $heute) {
        $jeKunde = [];
        foreach ($stundenJeObjekt as $oi => $min) { $jeKunde[$z['objekte'][$oi]['kunde_id']][] = [$z['objekte'][$oi], $min]; }
        $datum = (new DateTimeImmutable($bis))->modify('+3 days')->format('Y-m-d');
        foreach ($jeKunde as $kundeId => $posten) {
            if ($datum > $heute) { continue; }
            $pos = [];
            foreach ($posten as [$o, $min]) {
                $pr = $z['produkte'][$o['leistung']];
                $pos[] = td_position($pr, $o['name'] . ', ' . td_monat_text($monat), $min);
            }
            td_rechnung($pdo, (int)$kundeId, 'Sicherheitsdienstleistungen ' . td_monat_text($monat), $datum, $pos, $heute);
            $rechnungen++;
        }
    }
    // Anlaesse einzeln, zwei Tage danach verrechnet.
    foreach ($anlaesse as $a) {
        $datum = (new DateTimeImmutable($a['datum']))->modify('+2 days')->format('Y-m-d');
        if ($datum > $heute) { continue; }
        $pr = $z['produkte']['anlass'];
        td_rechnung($pdo, (int)$a['objekt']['kunde_id'], $a['objekt']['name'] . ' vom ' . date('d.m.Y', strtotime($a['datum'])),
            $datum, [td_position($pr, $a['objekt']['name'], $a['min'])], $heute);
        $rechnungen++;
    }

    // Lohnlauf fuer abgeschlossene Monate, ueber den echten Lohnlauf -- aber
    // nur, wo es ein GAV-Regelwerk gibt. Fuer einen Monat davor rechnet der
    // Lohnlauf richtigerweise nichts (kein_regelwerk); ein Lauf voller
    // gesperrter Personen waere kein Lohn, sondern ein Loch mit Datum.
    $lauf = null;
    if ($bis < $heute && gavzeit_regel($von) !== null && gavzeit_regel($bis) !== null) {
        $vormonat = (new DateTimeImmutable($heute))->modify('first day of last month')->format('Y-m');
        $vorvorvor = (new DateTimeImmutable($heute))->modify('first day of this month')->modify('-3 months')->format('Y-m');
        if ($monat === $vorvorvor) {
            // Sonderfall: ein stornierter und ersetzter Lauf.
            $alt = demo_lohnlauf_erzeugen($pdo, $von, $bis, $z['verwaltung'], 'freigegeben', 'Testdaten (ENT-714)');
            if ($alt) {
                $pdo->prepare("UPDATE lohnlauf SET status = 'storniert', storniert_am = ?, storniert_von = ?, storno_grund = ? WHERE id = ?")
                    ->execute([(new DateTimeImmutable($bis))->modify('+4 days')->format('Y-m-d H:i:s'), $z['verwaltung'],
                        'Testdaten: Ansatz einer Person nachträglich korrigiert', $alt]);
            }
            $lauf = demo_lohnlauf_erzeugen($pdo, $von, $bis, $z['verwaltung'], 'ausbezahlt', 'Testdaten (ENT-714), Ersatz', $alt);
        } else {
            $lauf = demo_lohnlauf_erzeugen($pdo, $von, $bis, $z['verwaltung'],
                $monat === $vormonat ? 'freigegeben' : 'ausbezahlt', 'Testdaten (ENT-714)');
        }
    }
    return $zaehler + ['rechnungen' => $rechnungen, 'lohnlauf' => $lauf];
}

function td_monat_text(string $monat): string
{
    $n = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    return $n[(int)substr($monat, 5, 2) - 1] . ' ' . substr($monat, 0, 4);
}

function td_position(array $produkt, string $text, int $minuten): array
{
    return ['produkt_id' => (int)$produkt['id'], 'produkt_name' => $produkt['name'], 'beschreibung' => $text,
            'menge' => round($minuten / 60, 2), 'einheit' => 'Std.', 'einzelpreis_rappen' => (int)$produkt['einzelpreis_rappen'],
            'rabatt_bp' => 0, 'mwst_satz_bp' => 810];
}

// Eine versendete Rechnung. Ob und wann sie bezahlt ist, folgt aus dem
// Zahlungsverhalten des Kunden: Liegt der Zahltag nach heute, ist sie offen.
function td_rechnung(PDO $pdo, int $kundeId, string $titel, string $datum, array $positionen, string $heute,
                     array $zusatz = []): int
{
    static $zahlt = null;
    if ($zahlt === null) {
        $zahlt = [];
        foreach ($pdo->query('SELECT id, name FROM kunden ORDER BY id')->fetchAll() as $i => $k) {
            $zahlt[(int)$k['id']] = td_kundenliste()[$i][4] ?? 20;
        }
    }
    $faellig = $zusatz['faellig_bis'] ?? (new DateTimeImmutable($datum))->modify('+30 days')->format('Y-m-d');
    $tage = $zahlt[$kundeId] ?? 20;
    $bezahltAm = $tage === null ? null : (new DateTimeImmutable($datum))->modify("+{$tage} days")->format('Y-m-d');
    $bezahlt = $bezahltAm !== null && $bezahltAm <= $heute;
    if (array_key_exists('bezahlt', $zusatz)) { $bezahlt = $zusatz['bezahlt']; $bezahltAm = $zusatz['bezahlt_am'] ?? null; }
    $nummer = beleg_naechste_nummer($pdo, 'rechnung');
    $pdo->prepare('INSERT INTO belege (art, nummer, kunde_id, titel, datum, faellig_bis, status, bezahlt, bezahlt_am, aktiv)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute(['rechnung', $nummer, $kundeId, $titel, $datum, $faellig, $zusatz['status'] ?? 'versendet',
                   $bezahlt ? 1 : 0, $bezahlt ? $bezahltAm : null, $zusatz['aktiv'] ?? 1]);
    $id = (int)$pdo->lastInsertId();
    beleg_positionen_schreiben($pdo, $id, $positionen);
    beleg_summen_schreiben($pdo, $id, 0);
    return $id;
}

// ── Abschluss: Planung nach vorne ist schon in td_monat() (bis +21 Tage);
// hier die Offerten und die gezielten Sonderfaelle (ENT-714, Punkt 7).
function td_abschluss(PDO $pdo, ?string $heute = null): array
{
    $heute = $heute ?? date('Y-m-d');
    $z = td_zustand($pdo);
    // Der Monat nach dem laufenden, falls die Planung ueber das Monatsende reicht.
    $naechster = (new DateTimeImmutable($heute))->modify('first day of next month')->format('Y-m');
    $zukunftBis = (new DateTimeImmutable($heute))->modify('+' . TD_ZUKUNFT_TAGE . ' days')->format('Y-m');
    if ($zukunftBis >= $naechster) { td_monat($pdo, $naechster, $heute); }

    $k = $pdo->query('SELECT id FROM kunden ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
    $pr = $z['produkte'];
    $tag = fn(int $v) => (new DateTimeImmutable($heute))->modify(($v >= 0 ? '+' : '') . $v . ' days')->format('Y-m-d');
    $sonder = 0;
    // Offen ohne Faelligkeitsdatum (Zusatzleistung, Frist vergessen).
    $id = td_rechnung($pdo, (int)$k[2], 'Zusatzbewachung Gemeindeversammlung', $tag(-20),
        [td_position($pr['anlass'], 'Gemeindeversammlung, Saalschutz', 300)], $heute,
        ['bezahlt' => false]);
    $pdo->prepare('UPDATE belege SET faellig_bis = NULL WHERE id = ?')->execute([$id]); $sonder++;
    // Bezahlt, aber ohne Zahldatum.
    td_rechnung($pdo, (int)$k[3], 'Nachtrag Schlüsselrunde', $tag(-50),
        [td_position($pr['revier'], 'Schlüsselrunde ausserhalb Vertrag', 180)], $heute,
        ['bezahlt' => true, 'bezahlt_am' => null]); $sonder++;
    // Zwei Entwuerfe -- zaehlen nicht als verrechnet.
    foreach ([[0, 'Baustellenbewachung Zusatzwoche', 'baustelle', 2400], [8, 'Parkhausdienst Adventssonntage', 'verkehr', 960]] as [$ki, $t, $l, $min]) {
        td_rechnung($pdo, (int)$k[$ki], $t, $tag(-2), [td_position($pr[$l], $t, $min)], $heute,
            ['status' => 'entwurf', 'bezahlt' => false]); $sonder++;
    }
    // Archiviert (Fehlbuchung).
    td_rechnung($pdo, (int)$k[1], 'Fehlbuchung, ersetzt', $tag(-70),
        [td_position($pr['empfang'], 'Doppelt erfasst', 900)], $heute, ['aktiv' => 0, 'bezahlt' => false]); $sonder++;
    // Ueberfaellig in jedem Band, falls das Zahlungsverhalten eines nicht
    // schon belegt: je eine Rechnung 5, 45 und 95 Tage ueber der Frist.
    foreach ([[6, 35], [6, 75], [11, 125]] as [$ki, $alter]) {
        td_rechnung($pdo, (int)$k[$ki], 'Zusatzeinsatz', $tag(-$alter),
            [td_position($pr['anlass'], 'Zusatzeinsatz auf Abruf', 480)], $heute, ['bezahlt' => false]); $sonder++;
    }

    // Offerten: bald ablaufend, abgelaufen, ohne Datum, bestaetigt, abgelehnt, Entwurf.
    $offerten = [
        [9,  'Verkehrsdienst Schulanlass',   'verkehr', 1200, 'versendet',  $tag(10)],
        [5,  'Saisonvertrag Heimspiele',     'anlass',  9600, 'angeschaut', $tag(-5)],
        [7,  'Messebewachung Herbstmesse',   'anlass',  4800, 'versendet',  null],
        [10, 'Zutrittskontrolle Rechenzentrum', 'revier', 21000, 'bestaetigt', $tag(40)],
        [4,  'Empfang Wochenende',           'empfang', 5200, 'abgelehnt',  $tag(-20)],
        [3,  'Revierdienst Erweiterung Halle 3', 'revier', 7800, 'entwurf', $tag(30)],
        [1,  'Parkplatzkontrolle Abendverkauf', 'verkehr', 1800, 'versendet', $tag(25)],
    ];
    foreach ($offerten as [$ki, $titel, $l, $min, $status, $gueltig]) {
        $nummer = beleg_naechste_nummer($pdo, 'offerte');
        $pdo->prepare('INSERT INTO belege (art, nummer, kunde_id, titel, datum, gueltig_bis, status, aktiv) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
            ->execute(['offerte', $nummer, (int)$k[$ki], $titel, $tag(-14), $gueltig, $status]);
        $oid = (int)$pdo->lastInsertId();
        beleg_positionen_schreiben($pdo, $oid, [td_position($pr[$l], $titel, $min)]);
        beleg_summen_schreiben($pdo, $oid, 0);
    }
    return ['sonderfaelle' => $sonder, 'offerten' => count($offerten)];
}

// Zusammenfassung fuer die Oberflaeche.
function td_zusammenfassung(PDO $pdo): array
{
    $n = fn(string $sql) => (int)$pdo->query($sql)->fetchColumn();
    return [
        'mitarbeitende' => count(td_zustand($pdo)['personen']),
        'kunden'        => $n('SELECT COUNT(*) FROM kunden'),
        'objekte'       => $n('SELECT COUNT(*) FROM objekte'),
        'einsaetze'     => $n('SELECT COUNT(*) FROM einsaetze'),
        'rechnungen'    => $n("SELECT COUNT(*) FROM belege WHERE art = 'rechnung'"),
        'offerten'      => $n("SELECT COUNT(*) FROM belege WHERE art = 'offerte'"),
        'lohnlaeufe'    => $n('SELECT COUNT(*) FROM lohnlauf'),
    ];
}

// ── Die Anfrage ──────────────────────────────────────────────────────
if (realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    if (!ist_staging()) {
        json_response(['status' => 'error', 'message' => 'Nicht gefunden.'], 404);
    }
    $user = require_session();
    require_recht($user, 'rechte_schreiben');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        json_response(['status' => 'error', 'message' => 'Nur POST.'], 405);
    }

    $eingabe = json_decode((string)file_get_contents('php://input'), true) ?: [];
    $schritt = (string)($eingabe['schritt'] ?? '');
    $pdo = db();
    @set_time_limit(120);

    try {
        if ($schritt === 'start') {
            if (trim((string)($eingabe['bestaetigung'] ?? '')) !== TD_BESTAETIGUNG) {
                json_response(['status' => 'error', 'message' => 'Zum Bestätigen „' . TD_BESTAETIGUNG . '“ eintippen.'], 400);
            }
            foreach (['mitarbeiter', 'einsaetze', 'belege', 'lohnlauf', 'einsatz_auslagen', 'produkte'] as $t) {
                if (!hat_tabelle($pdo, $t)) {
                    json_response(['status' => 'error', 'message' => "Einrichtung fehlt noch (Tabelle $t). Zuerst die Einrichtung ausführen."], 503);
                }
            }
            // TRUNCATE schliesst in MySQL eine Transaktion implizit ab -- darum
            // das Leeren VOR der Transaktion der Stammdaten.
            $geleert = td_leeren($pdo);
            $pdo->beginTransaction();
            $stamm = td_stammdaten($pdo);
            $pdo->commit();
            json_response(['status' => 'ok', 'geleert' => $geleert, 'stamm' => $stamm, 'monate' => td_monate()]);
        }
        if ($schritt === 'monat') {
            $monat = (string)($eingabe['monat'] ?? '');
            if (!in_array($monat, td_monate(), true)) {
                json_response(['status' => 'error', 'message' => 'Unbekannter Monat.'], 400);
            }
            $pdo->beginTransaction();
            $erg = td_monat($pdo, $monat);
            $pdo->commit();
            json_response(['status' => 'ok', 'monat' => $monat, 'ergebnis' => $erg]);
        }
        if ($schritt === 'abschluss') {
            $pdo->beginTransaction();
            $erg = td_abschluss($pdo);
            $pdo->commit();
            json_response(['status' => 'ok', 'ergebnis' => $erg, 'zusammenfassung' => td_zusammenfassung($pdo)]);
        }
        json_response(['status' => 'error', 'message' => 'Unbekannter Schritt.'], 400);
    } catch (TestdatenFehler $e) {
        if ($pdo->inTransaction()) { $pdo->rollBack(); }
        json_response(['status' => 'error', 'message' => $e->getMessage()], 409);
    }
}
