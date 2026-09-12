<?php
declare(strict_types=1);
// Musterbetrieb fuer die Demo-Umgebung erzeugen -- Rechenkern (ENT-523,
// Stufe 2a + 2b). Getrennt vom Endpunkt backend/api/demo_daten_erzeugen.php,
// damit sich die eigentliche Erzeugung echt gegen eine Datenbank pruefen
// laesst, ohne require_session()/require_demo_umgebung() im Weg zu haben
// -- gleiches Prinzip wie rundgang.php/planung.php.
//
// WAS DIESE DATEI TUT UND WAS NICHT
//
// Sie FUELLT eine bereits eingerichtete, aber inhaltlich leere Demo-
// Datenbank mit einem erfundenen, aber funktionsfaehigen Bewachungsbetrieb
// -- Mitarbeitende, Kunden, Objekte, die aktuelle Planung (inklusive eines
// bewusst unbesetzten Platzes heute Nacht), ein vollstaendig abgeglichener
// und ausbezahlter Lohnlauf fuer den Vormonat, ein abgeschlossener
// Rundgang von gestern mit Ereignismeldung und Fotobeleg, ein Kundenportal-
// Zugang. Einzelheiten und die vier Grundfestlegungen: demozugang-
// konzept.md im Projekt-Repository (ENT-523).
//
// Sie legt KEINE Tabellen an und seedet KEINE Systemrollen -- das leistet
// der bestehende Einrichtungslauf (backend/api/planung_einrichten.php),
// der nach jedem Deploy ohnehin einmal manuell laufen muss (ENT-523,
// Stufe 1). Diese Datei setzt darauf auf: Ohne vorherige Einrichtung
// bricht sie kontrolliert ab (siehe demo_daten_erzeugen_ausfuehren()
// unten), statt halb zu arbeiten.
//
// Sie LEERT NICHTS. Der naechtliche Reset (ENT-523, Stufe 4, noch nicht
// gebaut) ist ein eigener Schritt, der zuerst die vorhandenen Musterdaten
// entfernt und DANACH diese Erzeugung erneut aufruft -- Erzeugen und
// Leeren bleiben zwei getrennte, einzeln nachvollziehbare Schritte.
//
// DER LOHNLAUF (Fuehrungsstation 5, "was am Monatsende herauskommt", Stufe
// 2b) rechnet AUSSCHLIESSLICH ueber lohnlauf_person()/lohnlauf_nbu()/
// lohnlauf_abzuege() aus backend/lohnlauf.php -- siehe demo_lohnlauf_erzeugen()
// weiter unten. Das selbst per SQL nachzubilden waere genau die Art von
// eigenstaendiger GAV-Interpretation, die CLAUDE.md ausschliesst.
//
// WARUM DIREKTES SQL FUER STAMMDATEN, ABER NICHT FUER ZEITWERTE
//
// Mitarbeitende, Kunden, Objekte, Lohnansaetze und Abzugssaetze sind reine
// Stammdaten ohne Geschaeftsregel dahinter -- direktes Einfuegen ist hier
// so unproblematisch wie ein manuell erfasster Datensatz im Cockpit.
// Rohzeit, Nettozeit, Zeitbonus und jeder Lohnbetrag dagegen sind
// Rechtsgroessen (GAV private Sicherheitsdienstleistungen). Sie werden
// darum NIE erfunden, sondern ausschliesslich ueber die bestehenden,
// geprueften Funktionen aus gavzeit.php und lohnlauf.php berechnet --
// dieselbe einzige Quelle, die auch ein echter Lohnlauf nutzt.
//
// Erwartet, dass db.php und rechte.php bereits geladen sind (der Aufrufer
// -- Endpunkt oder Pruefung -- tut das), genau wie rundgang.php es
// erwartet. require_once, damit ein Aufrufer, der mitarbeiter.php ohnehin
// schon laedt (das bindet kunden.php mit ein), keine Doppel-Definition
// riskiert -- derselbe Fallstrick wie am 22.08.2026 in
// planung_einrichten.php.
require_once __DIR__ . '/mitarbeiter.php';   // ma_login_generieren()
require_once __DIR__ . '/planung.php';       // feiertage_solothurn()
require_once __DIR__ . '/gavzeit.php';       // gavzeit_netto(), gavzeit_bonus_min()
require_once __DIR__ . '/anmeldung.php';     // PASSWORT_KOSTEN
require_once __DIR__ . '/lohnlauf.php';      // lohnlauf_person(), lohnlauf_nbu(), lohnlauf_abzuege()

// Name des Musterbetriebs. Erfunden, kein Bezug zu einem realen Betrieb
// beabsichtigt -- die Handelsregister-Pruefung VOR der ersten
// Verwendung auf der echten Demo-Instanz steht noch aus (siehe OP in
// sop-projekt: In dieser Entwicklungsumgebung ist der Netzzugriff auf
// zefix.ch durch die Egress-Policy gesperrt, die Pruefung liess sich von
// hier aus nicht durchfuehren).
const DEMO_BETRIEB_NAME   = 'Aareblick Sicherheit AG';
const DEMO_BETRIEB_ZUSATZ = 'Sicherheit im Mittelland';
const DEMO_KANTON = 'SO';

// Datum relativ zu HEUTE, niemals fest -- dieselbe Regel wie in den
// Playwright-Pruefungen (test_datumsfest.mjs) und aus demselben Grund:
// ein festes Datum kippt beim naechsten Tageswechsel.
function demo_tag(int $versatz): string
{
    return (new DateTimeImmutable('today'))->modify("$versatz days")->format('Y-m-d');
}

// Erster Tag des Kalendermonats VOR heute, als Tage-Versatz zu heute
// (Stufe 2b) -- deckt damit einen vollen, tatsaechlich abgeschlossenen
// Monat ab, nicht nur "vier Wochen zurueck". Ueber Monats- UND Jahres-
// grenzen hinweg korrekt, weil relativ zu "heute" berechnet, nie fest
// (CLAUDE.md/test_datumsfest.mjs).
function demo_ruecklauf_versatz(): int
{
    $heute = new DateTimeImmutable('today');
    return (int)$heute->diff($heute->modify('first day of last month'))->format('%r%a');
}

// Anfang und Ende desselben Vormonats als Datum -- fuer den Lohnlauf-
// Zeitraum (demo_lohnlauf_erzeugen()), der einen Kalendermonat meint,
// keinen Tage-Versatz.
function demo_vormonat_bereich(): array
{
    $heute = new DateTimeImmutable('today');
    return [$heute->modify('first day of last month')->format('Y-m-d'),
            $heute->modify('last day of last month')->format('Y-m-d')];
}

function demo_daten_erzeugen_ausfuehren(PDO $pdo): void
{
    // Ohne vorherige Einrichtung kontrolliert abbrechen, statt mit halben
    // Tabellen weiterzuarbeiten. hat_tabelle() steht in db.php.
    foreach (['ma_funktion', 'ma_abteilung', 'objekte', 'rollen', 'einsaetze', 'rundgang', 'kontrollpunkt',
              'lohn_ansatz', 'lohn_abzug', 'lohnlauf'] as $t) {
        if (!hat_tabelle($pdo, $t)) {
            json_response(['status' => 'error',
                'message' => "Einrichtung fehlt noch (Tabelle $t) -- zuerst im Cockpit auf „Einrichten“ klicken."], 503);
        }
    }
    // Nie auf einen bereits gefuellten Betrieb schreiben (kein Loeschen
    // hier, siehe Kopf) -- ein zweiter Lauf ohne vorherigen Reset waere
    // sonst eine stille Verdoppelung aller Mitarbeitenden und Objekte.
    $bereitsDa = (int)$pdo->query('SELECT COUNT(*) FROM mitarbeiter')->fetchColumn();
    if ($bereitsDa > 0) {
        json_response(['status' => 'error',
            'message' => 'Es sind bereits Mitarbeitende vorhanden -- dieser Lauf ist nur fuer eine leere Datenbank gedacht.'], 409);
    }

    $pdo->beginTransaction();
    try {
        demo_betrieb_setzen($pdo);
        $funktionen = demo_funktionen_abteilungen($pdo);
        $mitarbeitende = demo_mitarbeitende_erzeugen($pdo, $funktionen);
        demo_feiertage_erzeugen($pdo);
        demo_lohn_ansatz_erzeugen($pdo, $mitarbeitende);
        demo_lohn_abzug_erzeugen($pdo);
        $kunden = demo_kunden_erzeugen($pdo);
        $objekte = demo_objekte_erzeugen($pdo, $kunden);

        // Wer als Verwaltung Abgleich und Lohnlauf "durchgefuehrt" hat --
        // dieselbe Person, die im gefuehrten Einstieg als Verwaltungsperson
        // dient (demo_mitarbeiterliste(), erste Zeile: 'administrator').
        $verwaltung = null;
        foreach ($mitarbeitende as $m) {
            if (in_array('administrator', $m['rollen'], true)) { $verwaltung = $m; break; }
        }
        if (!$verwaltung) {
            throw new RuntimeException('Keine Person mit der Rolle "administrator" in demo_mitarbeiterliste() gefunden.');
        }

        $einsaetze = demo_einsaetze_erzeugen($pdo, $objekte, $mitarbeitende, (int)$verwaltung['id']);
        [$vormonatVon, $vormonatBis] = demo_vormonat_bereich();
        $lohnlaufId = demo_lohnlauf_erzeugen($pdo, $vormonatVon, $vormonatBis, (int)$verwaltung['id']);
        $punkteJeObjekt = demo_rundgaenge_erzeugen($pdo, $objekte, $mitarbeitende);
        demo_rundgang_mit_ereignis_erzeugen($pdo, $objekte, $punkteJeObjekt);
        demo_kundenzugang_erzeugen($pdo, $kunden);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_response(['status' => 'error', 'message' => 'Musterbetrieb-Erzeugung abgebrochen: ' . $e->getMessage()], 500);
    }

    json_response(['status' => 'ok', 'mitarbeitende' => count($mitarbeitende),
        'kunden' => count($kunden), 'objekte' => count($objekte), 'einsaetze' => $einsaetze,
        'lohnlauf_id' => $lohnlaufId]);
}

// ── Betrieb ──────────────────────────────────────────────────────────
function demo_betrieb_setzen(PDO $pdo): void
{
    $pdo->prepare('INSERT INTO betrieb (id, firma, zusatz) VALUES (1, ?, ?)
                    ON DUPLICATE KEY UPDATE firma = VALUES(firma), zusatz = VALUES(zusatz)')
        ->execute([DEMO_BETRIEB_NAME, DEMO_BETRIEB_ZUSATZ]);
}

// ── Funktionen und Abteilungen ───────────────────────────────────────
// Beide Listen starten laut planung_einrichten.php LEER -- "erfundene
// Funktionsbezeichnungen waeren Inhalte, die niemand entschieden hat".
// Im Musterbetrieb gilt das nicht mehr: Hier SIND die Inhalte der
// Betrieb selbst, keine Vorwegnahme einer echten Entscheidung.
function demo_funktionen_abteilungen(PDO $pdo): array
{
    $funktionen = ['Wächter/in', 'Gruppenleiter/in', 'Einsatzleiter/in', 'Verwaltung'];
    $abteilungen = ['Revierdienst', 'Verkehrsdienst', 'Zentrale'];
    $ein = $pdo->prepare('INSERT INTO ma_funktion (bezeichnung, sortierung) VALUES (?, ?)');
    $ids = ['funktion' => [], 'abteilung' => []];
    foreach ($funktionen as $i => $f) { $ein->execute([$f, $i]); $ids['funktion'][$f] = (int)$pdo->lastInsertId(); }
    $ein = $pdo->prepare('INSERT INTO ma_abteilung (bezeichnung, sortierung) VALUES (?, ?)');
    foreach ($abteilungen as $i => $a) { $ein->execute([$a, $i]); $ids['abteilung'][$a] = (int)$pdo->lastInsertId(); }
    return $ids;
}

// ── Mitarbeitende ────────────────────────────────────────────────────
// 18 Personen (ENT-523, Entscheid des Projektinhabers). Erfundene Namen,
// KEIN Bezug zu realen Personen -- CLAUDE.md: "keine echten Personen-
// namen, nicht in Testdaten". Ein Demo-Passwort gilt fuer alle: Wer die
// Demo fuehrt, muss sich nicht 18 verschiedene Passwoerter merken, um
// als jede beliebige Rolle vorzufuehren.
const DEMO_PASSWORT = 'Demo-Rundgang-2026!';

function demo_mitarbeiterliste(): array
{
    // [Vorname, Nachname, Funktion, Abteilung, Rollen]
    // Erste Zeile traegt die Rollen "verwaltung" + "administrator" (fuer
    // den gefuehrten Einstieg als Verwaltungsperson, Fuehrungsstation
    // "Planung"). Zwei Personaladministration, zwei Einsatzleitung, der
    // Rest Waechter/innen -- verteilt auf Revierdienst und Verkehrsdienst,
    // wie es der Objekt-Mix unten verlangt (breiter Mix, ENT-523).
    return [
        ['Simone', 'Berger',    'Verwaltung',        'Zentrale',      ['verwaltung', 'administrator']],
        ['Thomas', 'Iseli',     'Verwaltung',         'Zentrale',      ['personal']],
        ['Nadja',  'Brunner',   'Einsatzleiter/in',   'Zentrale',      ['planung']],
        ['Marco',  'Frei',      'Einsatzleiter/in',   'Zentrale',      ['planung']],
        ['Elif',   'Yildiz',    'Gruppenleiter/in',   'Revierdienst',  ['mitarbeitend', 'waechter']],
        ['Pascal', 'Wenger',    'Gruppenleiter/in',   'Verkehrsdienst',['mitarbeitend', 'waechter']],
        ['Aylin',  'Demir',     'Wächter/in',         'Revierdienst',  ['mitarbeitend', 'waechter']],
        ['Beat',   'Zimmermann','Wächter/in',         'Revierdienst',  ['mitarbeitend', 'waechter']],
        ['Céline', 'Roos',      'Wächter/in',         'Revierdienst',  ['mitarbeitend', 'waechter']],
        ['Fabian', 'Kunz',      'Wächter/in',         'Revierdienst',  ['mitarbeitend', 'waechter']],
        ['Ivana',  'Petrović',  'Wächter/in',         'Revierdienst',  ['mitarbeitend', 'waechter']],
        ['Res',    'Amrein',    'Wächter/in',         'Verkehrsdienst',['mitarbeitend', 'waechter']],
        ['Selina', 'Gerber',    'Wächter/in',         'Verkehrsdienst',['mitarbeitend', 'waechter']],
        ['Yannick','Lüthi',     'Wächter/in',         'Verkehrsdienst',['mitarbeitend', 'waechter']],
        ['Priya',  'Nair',      'Wächter/in',         'Verkehrsdienst',['mitarbeitend', 'waechter']],
        ['Dominik','Steiner',   'Wächter/in',         'Verkehrsdienst',['mitarbeitend', 'waechter']],
        ['Manon',  'Perret',    'Wächter/in',         'Revierdienst',  ['mitarbeitend', 'waechter']],
        ['Jonas',  'Hodel',     'Wächter/in',         'Revierdienst',  ['mitarbeitend', 'waechter']],
    ];
}

function demo_mitarbeitende_erzeugen(PDO $pdo, array $ids): array
{
    $hash = password_hash(DEMO_PASSWORT, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN]);
    // Feste Orte im Kanton Solothurn (ENT-523: Kanton folgt aus dem
    // System-Default fuer Objekte, siehe objekte.kanton). Erfunden,
    // keine echten Adressen.
    $orte = ['4600 Olten', '4632 Trimbach', '4500 Solothurn', '4900 Langenthal', '4665 Oftringen'];
    $einsatz = $pdo->prepare(
        'INSERT INTO mitarbeiter (name, password_hash, ist_admin, vorname, nachname, ort, email,
             anstellungskategorie, pensum_stunden, eintritt, geburtsdatum)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $funktionZuweisen = $pdo->prepare('UPDATE mitarbeiter SET personalnummer = ? WHERE id = ?');
    $rolleZuweisen = $pdo->prepare('INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (?, ?)');

    $angelegt = [];
    $nr = 1;
    foreach (demo_mitarbeiterliste() as [$vor, $nach, $funktion, $abteilung, $rollen]) {
        $login = ma_login_generieren($vor, $nach, $pdo);
        $ort = $orte[($nr - 1) % count($orte)];
        // Kategorie C fuer ALLE (Stufe 2b, Entscheid des Projektinhabers):
        // Der Lohnlauf rechnet heute nur Kategorie C wirklich durch
        // (monatslohn_offen fuer A/B, Etappe 3 deckt nur den Stundenlohn
        // ab) -- ein Mix zeigte einzelnen Demo-Mitarbeitenden eine Sperre
        // statt eines Ergebnisses, was in einem Verkaufsgespraech wie eine
        // Luecke aussaehe statt wie Absicht.
        // Eintritt und Geburtsdatum deterministisch gestreut (kein Zufall
        // -- derselbe Lauf ergibt immer dieselben Werte, nachvollziehbar
        // wie jeder andere Wert hier): Dienstjahr wirkt auf die Mindest-
        // lohn-Stufe, Alter auf die Ferienentschaedigung (Art. 20) -- eine
        // einzige, immer gleiche Person haette das nie unterschiedlich
        // gezeigt. Relativ zu heute (demo_tag()), nie fest.
        $eintritt = demo_tag(-(400 + ($nr * 137) % 1500));
        $geburtsdatum = demo_tag(-(365 * 22) - (($nr * 733) % (365 * 35)));
        $pensum = 1800 + ($nr * 53) % 400;
        $einsatz->execute([$login, $hash, 0, $vor, $nach, $ort, "$login@beispiel.ch",
            'C', $pensum, $eintritt, $geburtsdatum]);
        $id = (int)$pdo->lastInsertId();
        $funktionZuweisen->execute([str_pad((string)$nr, 3, '0', STR_PAD_LEFT), $id]);
        foreach ($rollen as $rolle) { $rolleZuweisen->execute([$id, $rolle]); }
        $angelegt[] = ['id' => $id, 'login' => $login, 'vorname' => $vor, 'nachname' => $nach,
            'funktion' => $funktion, 'abteilung' => $abteilung, 'rollen' => $rollen];
        $nr++;
    }
    return $angelegt;
}

// ── Lohn-Stammdaten (Stufe 2b) ───────────────────────────────────────
// lohn_ansatz und lohn_abzug sind reine STAMMDATEN -- ein erfasster Satz,
// keine berechnete Rechtsgroesse -- und darum wie Mitarbeitende/Kunden/
// Objekte per direktem SQL vertretbar (siehe Kopfkommentar "WARUM
// DIREKTES SQL"). Was daraus an Lohn ENTSTEHT, rechnet ausschliesslich
// lohnlauf_person()/lohnlauf_abzuege() -- siehe demo_lohnlauf_erzeugen().
function demo_lohn_ansatz_erzeugen(PDO $pdo, array $mitarbeitende): void
{
    $ein = $pdo->prepare(
        'INSERT INTO lohn_ansatz (mitarbeiter_id, gueltig_ab, kategorie, ansatz_rappen, ferien_laufend, ml13_bp)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    // Vor JEDEM erfassten Eintritt gueltig (aelteste Eintritts-Streuung
    // reicht rund 1900 Tage zurueck, siehe demo_mitarbeitende_erzeugen()).
    $gueltigAb = demo_tag(-1950);
    foreach ($mitarbeitende as $i => $ma) {
        // CHF 29.00 bis 31.90/Stunde -- durchgehend UEBER dem GAV-
        // Mindestlohn 2026 fuer Kategorie C, Kantonsgruppe "uebrige"
        // (hoechster Tabellenwert CHF 24.95, siehe LOHN_MINDESTLOHN in
        // lohn.php): Kein Demo-Mitarbeitender soll die Mindestlohnwarnung
        // zeigen -- das saehe in einem Verkaufsgespraech wie ein Fehler
        // aus, nicht wie eine funktionierende Pruefung.
        $ansatz = 2900 + ($i * 53) % 300;
        $ein->execute([$ma['id'], $gueltigAb, 'C', $ansatz, 1, 833]);
    }
}

// Betriebsweite NBU-/KTG-/BVG-Saetze. OHNE diese Eintraege bleibt der
// Lohnlauf auf der Abzugsseite vollstaendig gesperrt -- kein Nettolohn,
// keine Auszahlung (lohnlauf_sperrgruende()['abzug_fehlt']). AUSDRUECKLICH
// ERFUNDEN, keine echte Police oder Kassenmeldung (Projektinhaber-
// Entscheid, Stufe 2b) -- 'quelle' nennt das offen, damit niemand sie mit
// einem echten Versicherer- oder Vorsorgewert verwechselt.
function demo_lohn_abzug_erzeugen(PDO $pdo): void
{
    $quelle = 'Demo-Richtwert, keine echte Police (Musterbetrieb, Stufe 2b)';
    $ein = $pdo->prepare(
        'INSERT INTO lohn_abzug (schluessel, bezeichnung, gueltig_ab, gueltig_bis, satz_bp, quelle)
         VALUES (?, ?, ?, NULL, ?, ?)'
    );
    $ab = demo_tag(-1950);
    $ein->execute(['nbu', 'Nichtberufsunfallversicherung (Arbeitnehmer-Anteil)', $ab, 130, $quelle]);
    $ein->execute(['ktg', 'Krankentaggeld (Arbeitnehmer-Anteil, Art. 17 Ziff. 3 GAV)', $ab, 75, $quelle]);
    $ein->execute(['bvg', 'BVG (Arbeitnehmer-Anteil, Art. 25 Ziff. 3 GAV)', $ab, 350, $quelle]);
}

// ── Feiertage ────────────────────────────────────────────────────────
// Ueber feiertage_solothurn() (backend/planung.php) -- dieselbe, einzige
// hinterlegte Quelle wie beim echten Endpunkt feiertage_generieren.php.
// Zwei Jahre, damit sowohl die Vergangenheit als auch die zwei Wochen
// Zukunft sicher abgedeckt sind, auch am Jahreswechsel.
function demo_feiertage_erzeugen(PDO $pdo): void
{
    $ein = $pdo->prepare(
        'INSERT IGNORE INTO feiertage (datum, kanton, name, halbtags, ab_zeit, quelle)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $heute = (int)(new DateTimeImmutable('today'))->format('Y');
    foreach ([$heute - 1, $heute, $heute + 1] as $jahr) {
        foreach (feiertage_solothurn($jahr) as $f) {
            $ein->execute([$f['datum'], DEMO_KANTON, $f['name'], $f['halbtags'], $f['ab_zeit'], 'Demo-Musterbetrieb']);
        }
    }
}

// ── Kunden ───────────────────────────────────────────────────────────
function demo_kundenliste(): array
{
    // [Name, Strasse, Ort, Telefon, Ansprechperson [Vorname, Nachname, Funktion]]
    return [
        ['Baugenossenschaft Mittelland', 'Industriestrasse 14', '4600 Olten', '062 123 45 01',
            ['Reto', 'Baumann', 'Bauleiter']],
        ['Gewerbepark Aarematte AG', 'Aarauerstrasse 8', '4600 Olten', '062 123 45 02',
            ['Karin', 'Flückiger', 'Liegenschaftsverwaltung']],
        ['Einwohnergemeinde Wangen b. Olten', 'Dorfplatz 2', '4612 Wangen b. Olten', '062 123 45 03',
            ['Urs', 'Habegger', 'Bauamt']],
        ['Logistik Nordwest AG', 'Verteilzentrum 3', '4665 Oftringen', '062 123 45 04',
            ['Meret', 'Christen', 'Standortleitung']],
    ];
}

function demo_kunden_erzeugen(PDO $pdo): array
{
    $einKunde = $pdo->prepare('INSERT INTO kunden (name, strasse, ort, telefon) VALUES (?, ?, ?, ?)');
    $einPerson = $pdo->prepare('INSERT INTO kunden_person (kunde_id, vorname, nachname, sortierung) VALUES (?, ?, ?, 0)');
    $einWeg = $pdo->prepare("INSERT INTO kunden_kontaktweg (kunde_id, person_id, art, wert, sortierung) VALUES (?, ?, 'telefon', ?, 0)");

    $angelegt = [];
    foreach (demo_kundenliste() as [$name, $strasse, $ort, $telefon, $ansprech]) {
        $einKunde->execute([$name, $strasse, $ort, $telefon]);
        $id = (int)$pdo->lastInsertId();
        $einPerson->execute([$id, $ansprech[0], $ansprech[1]]);
        $personId = (int)$pdo->lastInsertId();
        $einWeg->execute([$id, $personId, $telefon]);
        $angelegt[] = ['id' => $id, 'name' => $name];
    }
    return $angelegt;
}

// ── Objekte ──────────────────────────────────────────────────────────
// 12 Objekte (ENT-523), breiter Mix der Einsatzarten -- bewusst NICHT
// nach dem eigenen Kerngeschaeft von CUPI 24 gewichtet (n=1-Hinweis, im
// Interview mit dem Projektinhaber ausdruecklich so entschieden).
function demo_objektliste(): array
{
    // [Kunde-Index, Name, Strasse, Ort, Einsatzart]
    return [
        [0, 'Baustelle Kreisel Industriestrasse', 'Industriestrasse 14', '4600 Olten', 'Baustellenbewachung'],
        [0, 'Baustelle Wohnüberbauung Bornfeld', 'Bornfeldweg 6', '4600 Olten', 'Baustellenbewachung'],
        [1, 'Gewerbepark Aarematte, Halle A', 'Aarauerstrasse 8', '4600 Olten', 'Revierdienst'],
        [1, 'Gewerbepark Aarematte, Halle B', 'Aarauerstrasse 10', '4600 Olten', 'Revierdienst'],
        [1, 'Gewerbepark Aarematte, Empfang', 'Aarauerstrasse 8', '4600 Olten', 'Empfang'],
        [2, 'Gemeindehaus Wangen', 'Dorfplatz 2', '4612 Wangen b. Olten', 'Revierdienst'],
        [2, 'Verkehrsdienst Schulweg Wangen', 'Schulstrasse 1', '4612 Wangen b. Olten', 'Verkehrsdienst'],
        [2, 'Dorffest Wangen (Verkehrsdienst)', 'Dorfplatz 2', '4612 Wangen b. Olten', 'Verkehrsdienst'],
        [3, 'Verteilzentrum Oftringen, Tor 1', 'Verteilzentrum 3', '4665 Oftringen', 'Revierdienst'],
        [3, 'Verteilzentrum Oftringen, Empfang', 'Verteilzentrum 3', '4665 Oftringen', 'Empfang'],
        [3, 'Verteilzentrum Oftringen, Aussenring', 'Verteilzentrum 3', '4665 Oftringen', 'Revierdienst'],
        [3, 'Anlieferung Oftringen (Verkehrsdienst)', 'Verteilzentrum 3', '4665 Oftringen', 'Verkehrsdienst'],
    ];
}

function demo_objekte_erzeugen(PDO $pdo, array $kunden): array
{
    $ein = $pdo->prepare(
        'INSERT INTO objekte (kunde_id, kunde_name, name, strasse, ort, kanton, einsatzart, sparte)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $angelegt = [];
    foreach (demo_objektliste() as [$kIdx, $name, $strasse, $ort, $einsatzart]) {
        $kunde = $kunden[$kIdx];
        $ein->execute([$kunde['id'], $kunde['name'], $name, $strasse, $ort, DEMO_KANTON, $einsatzart, 'sicherheit']);
        $angelegt[] = ['id' => (int)$pdo->lastInsertId(), 'name' => $name, 'einsatzart' => $einsatzart,
            'kunde_id' => $kunde['id'], 'strasse' => $strasse, 'ort' => $ort];
    }
    return $angelegt;
}

// ── Einsätze ─────────────────────────────────────────────────────────
// Ein Schichtmuster je Einsatzart -- kein Zufall, sondern dieselbe
// Grundform, die auch ein echter Betrieb dieser Art zeigen würde.
// [von, bis, Wochentage (1=Mo..7=So, leer=täglich), bedarf, pause_min]
// pause_min (Stufe 2b): unbezahlte Pause bei der rückwirkenden Abgleich-
// Markierung vergangener Schichten (siehe demo_einsaetze_erzeugen()) --
// dieselbe Grössenordnung, die auch ein echter Abgleich einträgt.
function demo_schichtmuster(string $einsatzart): array
{
    return match ($einsatzart) {
        'Baustellenbewachung' => ['von' => '18:00', 'bis' => '06:00', 'tage' => [], 'bedarf' => 1, 'pause_min' => 60],
        'Revierdienst'        => ['von' => '22:00', 'bis' => '06:00', 'tage' => [], 'bedarf' => 1, 'pause_min' => 30],
        'Verkehrsdienst'      => ['von' => '07:00', 'bis' => '16:00', 'tage' => [1, 2, 3, 4, 5], 'bedarf' => 1, 'pause_min' => 30],
        'Empfang'             => ['von' => '08:00', 'bis' => '17:00', 'tage' => [1, 2, 3, 4, 5], 'bedarf' => 1, 'pause_min' => 30],
        default               => ['von' => '08:00', 'bis' => '17:00', 'tage' => [1, 2, 3, 4, 5], 'bedarf' => 1, 'pause_min' => 30],
    };
}

// Welches Objekt (nach Name) heute Nacht bewusst unterbesetzt bleibt --
// der Moment, den ein Interessent in der Führungsstation "Planung" selbst
// löst (ENT-523, demozugang-konzept.md Abschnitt 4.5, Station 2).
const DEMO_UNTERBESETZTES_OBJEKT = 'Gewerbepark Aarematte, Halle A';
// Das eine Objekt, das nicht regelmässig, sondern als einmaliger Anlass
// in der Zukunft auftritt -- ein Verkehrsdienst-Event, kein Dauerauftrag.
const DEMO_EVENT_OBJEKT = 'Dorffest Wangen (Verkehrsdienst)';
const DEMO_EVENT_TAGE_AB_HEUTE = 9; // liegt in den zwei Wochen Zukunft

// Feste Person je Objekt, aus dem zur Einsatzart passenden Team --
// bewusst KEINE Objekt-übergreifende Rotation in dieser ersten Fassung:
// eine Person ist für ihr Objekt zuständig, das schliesst
// Überlappungskonflikte beim Erzeugen strukturell aus, statt sie beim
// Prüfen erst zu finden.
// Weist jedem Objekt ein EXKLUSIVES Team von zwei Personen aus dem zur
// Einsatzart passenden Grundpool zu -- fortlaufend ueber alle Objekte
// derselben Kategorie hinweg, NIE zurueckgesetzt je Objekt. Das ist der
// Kern, der die untenstehende Erzeugung ueberhaupt erst korrekt macht:
// Eine Person taucht nur bei EINEM Objekt auf, darum kann sie an zwei
// Objekten nie gleichzeitig eingeteilt sein, unabhaengig davon, wie die
// Tage der beiden Objekte sich ueberschneiden. Wird der Pool zu klein
// (mehr Objekte als Personen reichen), bricht diese Funktion ab, statt
// still zwei Objekte auf dieselbe Person fallen zu lassen -- siehe
// Gegenprobe in pruefungen/pruef_demo_daten.php.
function demo_objekt_teams(array $mitarbeitende, array $objekte): array
{
    $revier = array_values(array_filter($mitarbeitende, fn($m) => $m['abteilung'] === 'Revierdienst' && in_array('waechter', $m['rollen'], true)));
    $verkehr = array_values(array_filter($mitarbeitende, fn($m) => $m['abteilung'] === 'Verkehrsdienst' && in_array('waechter', $m['rollen'], true)));
    $poolNach = ['Baustellenbewachung' => $revier, 'Revierdienst' => $revier,
                 'Verkehrsdienst' => $verkehr, 'Empfang' => $verkehr];
    $naechsterIndex = ['Baustellenbewachung' => 0, 'Revierdienst' => 0, 'Verkehrsdienst' => 0, 'Empfang' => 0];
    // Baustellenbewachung und Revierdienst teilen sich denselben
    // Personen-POOL (beides Nachtschicht-Charakter) -- darum auch
    // denselben, GEMEINSAM fortlaufenden Zeiger, sonst wuerden beide bei
    // Index 0 desselben Pools beginnen und sich doch wieder ueberschneiden.
    $gemeinsamerZeiger = ['Baustellenbewachung' => 'nacht', 'Revierdienst' => 'nacht',
                          'Verkehrsdienst' => 'tag', 'Empfang' => 'tag'];
    $zeigerWert = ['nacht' => 0, 'tag' => 0];

    $teams = [];
    foreach ($objekte as $objekt) {
        $pool = $poolNach[$objekt['einsatzart']] ?? [];
        if (!$pool) { continue; }
        $zeigerName = $gemeinsamerZeiger[$objekt['einsatzart']];
        // EINE Person je Objekt reicht -- die Luecke am unterbesetzten
        // Objekt braucht KEIN zweites Teammitglied, nur einen fuer den
        // heutigen Tag erhoehten bedarf-Wert (siehe demo_einsaetze_erzeugen()):
        // es wird niemand fuer den zweiten Platz gesucht, das IST die
        // Luecke. Nur das Event-Objekt braucht wirklich zwei, weil an
        // seinem einzigen Tag tatsaechlich zwei Personen gebraucht werden.
        $brauche = $objekt['name'] === DEMO_EVENT_OBJEKT ? 2 : 1;
        $team = [];
        for ($i = 0; $i < $brauche; $i++) {
            if ($zeigerWert[$zeigerName] >= count($pool)) {
                throw new RuntimeException(
                    "Zu wenige Mitarbeitende fuer exklusive Objektzuteilung (Pool '$zeigerName' erschoepft bei Objekt '{$objekt['name']}')."
                    . ' Musterbetrieb-Groesse und Objektzahl passen nicht mehr zusammen -- siehe demo_mitarbeiterliste()/demo_objektliste().'
                );
            }
            $team[] = $pool[$zeigerWert[$zeigerName]];
            $zeigerWert[$zeigerName]++;
        }
        $teams[$objekt['id']] = $team;
    }
    return $teams;
}

// Kein einsatz_sperre_pruefen() hier (ENT-045): Diese Funktion LEGT NUR NEUE
// Einsaetze AN (reines INSERT, nie UPDATE/DELETE), in eine Datenbank, deren
// Leere der Aufrufer schon geprueft hat (demo_daten_erzeugen_ausfuehren()).
// Eine neue Zeile kann nicht abgeglichen sein -- derselbe Grund, aus dem
// schichten_erzeugen.php/schichten_anlegen() in planung.php in der
// Ausnahmeliste OHNE_SPERRE von test_php.mjs steht und ebenfalls ohne
// diese Pruefung auskommt.
function demo_einsaetze_erzeugen(PDO $pdo, array $objekte, array $mitarbeitende, int $abgleichVon): int
{
    $teams = demo_objekt_teams($mitarbeitende, $objekte);

    $einEinsatz = $pdo->prepare(
        'INSERT INTO einsaetze (kunde_id, kunde_name, objekt_id, titel, strasse, ort, einsatzart, sparte, datum, von, bis, bedarf, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $kundenNamen = [];
    foreach ($pdo->query('SELECT id, name FROM kunden')->fetchAll() as $k) { $kundenNamen[(int)$k['id']] = $k['name']; }

    $einZuteilung = $pdo->prepare(
        'INSERT INTO einsatz_zuteilung (einsatz_id, mitarbeiter_id, zusage) VALUES (?, ?, ?)'
    );
    // Stufe 2b (Lohnlauf, ENT-523): JEDE VERGANGENE Schicht wird gleich
    // beim Anlegen als abgeglichen markiert -- "anwesend", mit den
    // Ist-Zeiten gleich den geplanten. Ein real gefuehrter Betrieb glicht
    // zeitnah ab; ein Monat offener Vergangenheit saehe nicht nach einem
    // gepflegten Betrieb aus. NUR die Vergangenheit: eine Schicht von
    // heute oder morgen kann nicht abgeglichen sein, bevor sie stattfand
    // -- und die bewusste Luecke heute Nacht (DEMO_UNTERBESETZTES_OBJEKT)
    // muss ohnehin unbesetzt und offen bleiben (siehe unten).
    // Dieselben Spalten wie einsatz_abgleich.php, gleiche Reihenfolge auf
    // beiden Tabellen (dort UPDATE einsaetze UND einsatz_zuteilung
    // zusammen) -- Auslagenersatz (ENT-125) bleibt bewusst aussen vor:
    // eine eigene, zonenbasierte Berechnung, die hier niemand verlangt hat
    // und die als Musterbetrieb-Erfindung genau die Art von geratener
    // Zahl waere, die dieses Skript sonst vermeidet.
    $einIstZuteilung = $pdo->prepare(
        "UPDATE einsatz_zuteilung SET ist_status = 'anwesend', ist_von = ?, ist_bis = ?,
             ist_pause_min = ?, ist_pause_bezahlt_ma = 0, abgeglichen_von = ?, abgeglichen_am = ?
         WHERE einsatz_id = ? AND mitarbeiter_id = ?"
    );
    $einIstSchicht = $pdo->prepare(
        "UPDATE einsaetze SET ist_status = 'anwesend', ist_von = ?, ist_bis = ?,
             ist_pause_min = ?, ist_pause_bezahlt_ma = 0, abgeglichen_von = ?, abgeglichen_am = ?
         WHERE id = ?"
    );

    $angelegt = 0;
    foreach ($objekte as $objekt) {
        $team = $teams[$objekt['id']] ?? [];
        if (!$team) { continue; }
        $muster = demo_schichtmuster($objekt['einsatzart']);
        $istUnterbesetztesObjekt = $objekt['name'] === DEMO_UNTERBESETZTES_OBJEKT;

        if ($objekt['name'] === DEMO_EVENT_OBJEKT) {
            // Einmaliger Anlass, kein Dauerauftrag: nur EIN Tag in der Zukunft.
            $tage = [DEMO_EVENT_TAGE_AB_HEUTE];
        } else {
            // Zurueck bis zum ersten Tag des Vormonats (Stufe 2b: der
            // Lohnlauf braucht einen vollen, abgeglichenen Kalendermonat),
            // vor bis in zwei Wochen -- wie bisher.
            $tage = range(demo_ruecklauf_versatz(), 14);
        }

        $drehscheibe = 0; // rotiert NUR innerhalb des eigenen, exklusiven Teams
        foreach ($tage as $versatz) {
            $datum = demo_tag($versatz);
            $wochentag = (int)(new DateTimeImmutable($datum))->format('N');
            if ($muster['tage'] && !in_array($wochentag, $muster['tage'], true)) { continue; }

            // Der eine dramaturgische Moment (ENT-523): GENAU an diesem
            // Objekt, GENAU heute, ist der Bedarf zwei, aber nur eine
            // Person zugeteilt -- "1 von 2", nicht "0 von 1". Der
            // Unterschied ist keine Nuance: CLAUDE.md verbietet
            // ausdruecklich, dass eine gefilterte/teilweise Zahl wie die
            // Gesamtzahl aussieht.
            $lueckeHeute = $versatz === 0 && $istUnterbesetztesObjekt;
            $bedarf = $lueckeHeute ? 2 : ($objekt['name'] === DEMO_EVENT_OBJEKT ? 2 : 1);

            $einEinsatz->execute([
                $objekt['kunde_id'], $kundenNamen[$objekt['kunde_id']], $objekt['id'], null,
                $objekt['strasse'], $objekt['ort'],
                $objekt['einsatzart'], 'sicherheit', $datum, $muster['von'], $muster['bis'], $bedarf, 'geplant',
            ]);
            $einsatzId = (int)$pdo->lastInsertId();
            $angelegt++;

            $brauchtPersonen = $lueckeHeute ? 1 : $bedarf;
            $zugeteilte = [];
            for ($p = 0; $p < $brauchtPersonen; $p++) {
                $person = $team[$drehscheibe % count($team)];
                $drehscheibe++;
                $einZuteilung->execute([$einsatzId, $person['id'], 'bestätigt']);
                $zugeteilte[] = $person['id'];
            }

            if ($versatz < 0) {
                $abgeglichenAm = (new DateTimeImmutable($datum))->modify('+1 day 8 hours')->format('Y-m-d H:i:s');
                $einIstSchicht->execute([$muster['von'], $muster['bis'], $muster['pause_min'],
                    $abgleichVon, $abgeglichenAm, $einsatzId]);
                foreach ($zugeteilte as $maId) {
                    $einIstZuteilung->execute([$muster['von'], $muster['bis'], $muster['pause_min'],
                        $abgleichVon, $abgeglichenAm, $einsatzId, $maId]);
                }
            }
        }
    }
    return $angelegt;
}

// ── Lohnlauf (Stufe 2b) ──────────────────────────────────────────────
// Baut GENAU EINEN abgeschlossenen Lohnlauf fuer den vollen Vormonat --
// entwurf -> freigegeben -> ausbezahlt --, damit Fuehrungsstation 5 ("was
// am Monatsende herauskommt") ein FERTIGES Ergebnis zeigt, nicht nur einen
// leeren Bildschirm mit einem Knopf.
//
// Rechnet AUSSCHLIESSLICH ueber die echten Funktionen aus lohnlauf.php --
// lohnlauf_person(), lohnlauf_nbu(), lohnlauf_abzuege() -- und speichert
// deren Ergebnis unveraendert. Auswahl der Personen und das Schreiben in
// lohnlauf/lohnlauf_person/lohnlauf_zeile bilden bewusst denselben Ablauf
// nach wie backend/api/lohnlaeufe.php (aktion 'erzeugen'): dieselben
// Spalten, dieselbe Reihenfolge, damit ein dort spaeter geaenderter Ablauf
// hier nicht unbemerkt auseinanderlaeuft. Die Endpunkt-Datei selbst liess
// sich nicht einbinden -- sie fuehrt beim Laden sofort require_session()
// aus (kein Request-Kontext hier), derselbe Grund, aus dem diese Datei
// von backend/api/demo_daten_erzeugen.php getrennt ist.
function demo_lohnlauf_erzeugen(PDO $pdo, string $von, string $bis, int $erstelltVon): ?int
{
    $personenStmt = $pdo->query(
        "SELECT id, vorname, nachname, name, personalnummer, anstellungskategorie,
                pensum_stunden, eintritt, austritt, geburtsdatum
         FROM mitarbeiter WHERE anstellungskategorie = 'C' ORDER BY nachname, vorname"
    );

    $vorschau = [];
    foreach ($personenStmt->fetchAll() as $ma) {
        $p = lohnlauf_person($pdo, $ma, $von, $bis);
        // Wie lauf_vorschau(): eine Person ganz ohne Zeit und ohne
        // Sperrgrund gehoert nicht in den Lauf -- eine Zeile mit lauter
        // Nullen sieht aus wie ein Ergebnis und ist keines.
        if ($p['roh_min'] === 0 && !$p['gesperrt_grund'] && !$p['gesperrt']
            && $p['nicht_abgeglichen'] === 0) { continue; }
        $p['mitarbeiter_id'] = (int)$ma['id'];

        if (!$p['gesperrt_grund']) {
            $p['nbu'] = lohnlauf_nbu($pdo, (int)$ma['id'], $bis);
            $ab = lohnlauf_abzuege($pdo, $p, $bis, $p['nbu']);
            $p['zeilen'] = array_merge($p['zeilen'], $ab['zeilen']);
            $p['netto_rappen']      = $ab['netto_rappen'];
            $p['auszahlung_rappen'] = $ab['auszahlung_rappen'];
        } else {
            $p['nbu'] = null;
            $p['netto_rappen'] = null; $p['auszahlung_rappen'] = null;
        }
        $vorschau[] = $p;
    }
    if (!$vorschau) { return null; }

    $einLauf = $pdo->prepare(
        'INSERT INTO lohnlauf (periode_von, periode_bis, status, erstellt_von, bemerkung)
         VALUES (?, ?, ?, ?, ?)'
    );
    $einLauf->execute([$von, $bis, 'entwurf', $erstelltVon, 'Musterbetrieb-Lohnlauf (ENT-523, Stufe 2b)']);
    $laufId = (int)$pdo->lastInsertId();

    $pIn = $pdo->prepare(
        'INSERT INTO lohnlauf_person
           (lauf_id, mitarbeiter_id, kategorie, lohnform, roh_min, netto_min, bonus_min,
            bewertet_min, brutto_rappen, gesperrt_grund, gesperrt_zaehler,
            nicht_abgeglichen, warnung, netto_rappen, auszahlung_rappen,
            nbu_stand, nbu_herleitung)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    $zIn = $pdo->prepare(
        'INSERT INTO lohnlauf_zeile
           (lauf_id, mitarbeiter_id, schluessel, bezeichnung, sortierung,
            basis_rappen, satz_bp, menge, betrag_rappen, gesperrt_grund, annahme, hinweis)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    foreach ($vorschau as $p) {
        $pIn->execute([$laufId, $p['mitarbeiter_id'], $p['kategorie'], $p['lohnform'],
            $p['roh_min'], $p['netto_min'], $p['bonus_min'], $p['bewertet_min'],
            $p['brutto_rappen'], $p['gesperrt_grund'],
            $p['gesperrt'] ? json_encode($p['gesperrt']) : null,
            $p['nicht_abgeglichen'],
            isset($p['warnung']) ? json_encode($p['warnung']) : null,
            $p['netto_rappen'], $p['auszahlung_rappen'],
            $p['nbu']['stand'] ?? null,
            isset($p['nbu']) ? json_encode($p['nbu']) : null]);
        foreach ($p['zeilen'] as $z) {
            $zIn->execute([$laufId, $p['mitarbeiter_id'], $z['schluessel'], $z['bezeichnung'],
                $z['sortierung'], $z['basis_rappen'], $z['satz_bp'], $z['menge'],
                $z['betrag_rappen'], $z['gesperrt_grund'] ?? null,
                $z['annahme'] ?? 0, $z['hinweis'] ?? null]);
        }
    }

    // Bis "ausbezahlt" durchgestellt -- Fuehrungsstation 5 zeigt einem
    // Interessenten ein ABGESCHLOSSENES Beispiel, nicht nur einen leeren
    // Entwurf. Direktes UPDATE, keine erfundene Berechnung: Auch der echte
    // Endpunkt (lohnlaeufe.php, 'freigeben'/'ausbezahlt') setzt an dieser
    // Stelle nur Status und Zeitstempel und rechnet nicht neu -- "EIN
    // FREIGEGEBENER LAUF WIRD NIE NEU GERECHNET".
    $freigegebenAm = (new DateTimeImmutable($bis))->modify('+3 days')->format('Y-m-d H:i:s');
    $ausbezahltAm  = (new DateTimeImmutable($bis))->modify('+5 days')->format('Y-m-d H:i:s');
    $pdo->prepare('UPDATE lohnlauf SET status = ?, freigegeben_am = ?, freigegeben_von = ? WHERE id = ?')
        ->execute(['freigegeben', $freigegebenAm, $erstelltVon, $laufId]);
    $pdo->prepare('UPDATE lohnlauf SET status = ?, ausbezahlt_am = ?, ausbezahlt_von = ? WHERE id = ?')
        ->execute(['ausbezahlt', $ausbezahltAm, $erstelltVon, $laufId]);

    return $laufId;
}

// ── Rundgang, Kontrollpunkte, Ereignismeldung ───────────────────────
// Kontrollpunkte je Revierdienst-Objekt -- ein typischer Rundweg.
function demo_kontrollpunkte(): array
{
    return ['Haupteingang', 'Tiefgarage', 'Dach', 'Hinterausgang'];
}

function demo_rundgaenge_erzeugen(PDO $pdo, array $objekte, array $mitarbeitende): array
{
    $revierObjekte = array_values(array_filter($objekte, fn($o) => $o['einsatzart'] === 'Revierdienst'));

    $einVorlage = $pdo->prepare("INSERT INTO rundgang_vorlage (objekt_id, name) VALUES (?, 'Standardrundgang')");
    $einPunkt = $pdo->prepare('INSERT INTO kontrollpunkt (objekt_id, bezeichnung, reihenfolge, typ) VALUES (?, ?, ?, ?)');
    $einVorlagePunkt = $pdo->prepare('INSERT INTO rundgang_vorlage_punkt (vorlage_id, kontrollpunkt_id, reihenfolge) VALUES (?, ?, ?)');

    $punkteJeObjekt = [];
    foreach ($revierObjekte as $objekt) {
        $einVorlage->execute([$objekt['id']]);
        $vorlageId = (int)$pdo->lastInsertId();
        $punkte = [];
        foreach (demo_kontrollpunkte() as $i => $bezeichnung) {
            // typ 'chip': am Gerät per NFC/Geofence bestätigt -- der
            // technische Regelfall, kein Ersatzscan. Chip-Kennung erfunden.
            $einPunkt->execute([$objekt['id'], $bezeichnung, $i, 'chip']);
            $punktId = (int)$pdo->lastInsertId();
            $einVorlagePunkt->execute([$vorlageId, $punktId, $i]);
            $punkte[] = ['id' => $punktId, 'bezeichnung' => $bezeichnung];
        }
        $punkteJeObjekt[$objekt['id']] = ['vorlage_id' => $vorlageId, 'punkte' => $punkte];
    }
    return $punkteJeObjekt;
}

// Ein einzelnes, winziges JPEG als Fotobeleg -- klar als Platzhalter
// erkennbar (Farbfläche mit Beschriftung), kein Bezug zu einem echten Ort.
function demo_platzhalterfoto(string $text): string
{
    $bild = imagecreatetruecolor(480, 320);
    imagefill($bild, 0, 0, imagecolorallocate($bild, 0x14, 0x53, 0x3f));
    $weiss = imagecolorallocate($bild, 255, 255, 255);
    imagestring($bild, 5, 20, 140, $text, $weiss);
    imagestring($bild, 3, 20, 170, 'Demo-Beispielfoto, kein echter Ort', $weiss);
    ob_start();
    imagejpeg($bild, null, 80);
    $inhalt = ob_get_clean();
    imagedestroy($bild);
    return $inhalt;
}

// Genau EIN abgeschlossener Rundgang von gestern Abend, mit Fotobeleg
// (ENT-523, Führungsstation "Revierdienst") -- am zweiten Revierdienst-
// Objekt, damit die Geschichte nicht auf dem ohnehin schon zentralen
// unterbesetzten Objekt lastet.
function demo_rundgang_mit_ereignis_erzeugen(PDO $pdo, array $objekte, array $punkteJeObjekt): void
{
    $revierObjekte = array_values(array_filter($objekte, fn($o) => $o['einsatzart'] === 'Revierdienst'));
    if (count($revierObjekte) < 2) { return; }
    $objekt = $revierObjekte[1];
    $vorlage = $punkteJeObjekt[$objekt['id']] ?? null;
    if (!$vorlage) { return; }

    $gestern = demo_tag(-1);
    $einsatzStmt = $pdo->prepare(
        'SELECT e.id, z.mitarbeiter_id FROM einsaetze e
         JOIN einsatz_zuteilung z ON z.einsatz_id = e.id
         WHERE e.objekt_id = ? AND e.datum = ? LIMIT 1'
    );
    $einsatzStmt->execute([$objekt['id'], $gestern]);
    $einsatz = $einsatzStmt->fetch();
    if (!$einsatz) { return; }

    $start = new DateTimeImmutable("$gestern 22:15:00");
    $ende = $start->modify('+35 minutes');

    $pdo->prepare(
        'INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, status, vorbereitet_am, rohzeit_start, rohzeit_ende)
         VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([$einsatz['id'], $einsatz['mitarbeiter_id'], $objekt['id'], 'abgeschlossen',
        $start->format('Y-m-d H:i:s'), $start->format('Y-m-d H:i:s'), $ende->format('Y-m-d H:i:s')]);
    $rundgangId = (int)$pdo->lastInsertId();

    $einScan = $pdo->prepare(
        'INSERT INTO rundgang_scan (rundgang_id, kontrollpunkt_id, status, erfasst_am) VALUES (?, ?, ?, ?)'
    );
    $zeit = $start;
    foreach ($vorlage['punkte'] as $punkt) {
        $zeit = $zeit->modify('+8 minutes');
        $einScan->execute([$rundgangId, $punkt['id'], 'bestaetigt', $zeit->format('Y-m-d H:i:s')]);
    }

    // Ereignisart braucht mindestens einen Eintrag -- startet laut
    // planung_einrichten.php absichtlich LEER (ENT-072-Muster), im
    // Musterbetrieb IST der Inhalt der Betrieb selbst (siehe
    // demo_funktionen_abteilungen()).
    $pdo->prepare("INSERT INTO ereignisart (bezeichnung, sortierung) VALUES ('Feststellung', 0)")->execute();
    $ereignisartId = (int)$pdo->lastInsertId();

    $vorfall = $zeit->modify('+3 minutes');
    $pdo->prepare(
        'INSERT INTO ereignis_meldung (objekt_id, rundgang_id, einsatz_id, mitarbeiter_id, ereignisart_id,
             erfasst_am, vorfall_am, bemerkung, foto, foto_mime)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $objekt['id'], $rundgangId, $einsatz['id'], $einsatz['mitarbeiter_id'], $ereignisartId,
        $vorfall->format('Y-m-d H:i:s'), $vorfall->format('Y-m-d H:i:s'),
        'Aussenlicht bei der Tiefgarageneinfahrt brennt durchgehend, obwohl niemand vor Ort ist. Kunde per Bericht informiert.',
        demo_platzhalterfoto('Tiefgarage'), 'image/jpeg',
    ]);
}

// ── Kundenportal-Zugang ──────────────────────────────────────────────
// Ein FUNKTIONIERENDER Zugang (Passwort gesetzt, nicht nur ein Einmal-
// Code-Weg) fuer "Gewerbepark Aarematte AG" -- denselben Kunden, dessen
// Objekte bereits die Geschichte tragen (die unterbesetzte Stelle UND der
// Rundgang mit Ereignismeldung liegen beide dort, siehe
// demo_objektliste()). Der Interessent sieht in Fuehrungsstation
// "Kundenportal" also genau das, was er im Cockpit vorher schon gesehen
// hat -- nicht einen beliebigen dritten Kunden ohne sichtbare Historie.
function demo_kundenzugang_erzeugen(PDO $pdo, array $kunden): void
{
    $ziel = null;
    foreach ($kunden as $k) { if ($k['name'] === 'Gewerbepark Aarematte AG') { $ziel = $k; break; } }
    if (!$ziel) { return; }

    $hash = password_hash(DEMO_PASSWORT, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN]);
    $pdo->prepare(
        'INSERT INTO kundenzugang (kunde_id, name, email, funktion, password_hash, aktiv)
         VALUES (?, ?, ?, ?, ?, 1)'
    )->execute([$ziel['id'], 'Karin Flückiger', 'demo-portal@beispiel.ch', 'Liegenschaftsverwaltung', $hash]);
}
