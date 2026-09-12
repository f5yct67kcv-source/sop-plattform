<?php
declare(strict_types=1);
// Musterbetrieb fuer die Demo-Umgebung erzeugen -- Rechenkern (ENT-523,
// Stufe 2a). Getrennt vom Endpunkt backend/api/demo_daten_erzeugen.php,
// damit sich die eigentliche Erzeugung echt gegen eine Datenbank pruefen
// laesst, ohne require_session()/require_demo_umgebung() im Weg zu haben
// -- gleiches Prinzip wie rundgang.php/planung.php.
//
// WAS DIESE DATEI TUT UND WAS NICHT
//
// Sie FUELLT eine bereits eingerichtete, aber inhaltlich leere Demo-
// Datenbank mit einem erfundenen, aber funktionsfaehigen Bewachungsbetrieb
// -- Mitarbeitende, Kunden, Objekte, die aktuelle Planung (inklusive eines
// bewusst unbesetzten Platzes heute Nacht), ein abgeschlossener Rundgang
// von gestern mit Ereignismeldung und Fotobeleg, ein Kundenportal-Zugang.
// Einzelheiten und die vier Grundfestlegungen: demozugang-konzept.md im
// Projekt-Repository (ENT-523).
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
// Der Lohnlauf (Fuehrungsstation 5, "was am Monatsende herauskommt") ist
// NICHT Teil dieser Fassung. Ein Lohnlauf durchlaeuft NBU-/BVG-/QST-
// Herleitung und einen mehrstufigen Freigabeprozess (lohnlauf.php) -- das
// selbst per SQL nachzubilden waere genau die Art von eigenstaendiger
// GAV-Interpretation, die CLAUDE.md ausschliesst. Ein Nachtrag baut
// diesen Teil ueber die echten Lohnlauf-Funktionen, nicht ueber geratene
// Werte.
//
// WARUM DIREKTES SQL FUER STAMMDATEN, ABER NICHT FUER ZEITWERTE
//
// Mitarbeitende, Kunden, Objekte sind reine Stammdaten ohne Geschaefts-
// regel dahinter -- direktes Einfuegen ist hier so unproblematisch wie ein
// manuell erfasster Datensatz im Cockpit. Rohzeit, Nettozeit und
// Zeitbonus dagegen sind Rechtsgroessen (GAV private Sicherheits-
// dienstleistungen). Sie werden darum NIE erfunden, sondern ausschliess-
// lich ueber die bestehenden, geprueften Funktionen aus gavzeit.php
// berechnet -- dieselbe einzige Quelle, die auch ein echter Lohnlauf
// nutzt.
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

function demo_daten_erzeugen_ausfuehren(PDO $pdo): void
{
    // Ohne vorherige Einrichtung kontrolliert abbrechen, statt mit halben
    // Tabellen weiterzuarbeiten. hat_tabelle() steht in db.php.
    foreach (['ma_funktion', 'ma_abteilung', 'objekte', 'rollen', 'einsaetze', 'rundgang', 'kontrollpunkt'] as $t) {
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
        $kunden = demo_kunden_erzeugen($pdo);
        $objekte = demo_objekte_erzeugen($pdo, $kunden);
        $einsaetze = demo_einsaetze_erzeugen($pdo, $objekte, $mitarbeitende);
        $punkteJeObjekt = demo_rundgaenge_erzeugen($pdo, $objekte, $mitarbeitende);
        demo_rundgang_mit_ereignis_erzeugen($pdo, $objekte, $punkteJeObjekt);
        demo_kundenzugang_erzeugen($pdo, $kunden);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_response(['status' => 'error', 'message' => 'Musterbetrieb-Erzeugung abgebrochen: ' . $e->getMessage()], 500);
    }

    json_response(['status' => 'ok', 'mitarbeitende' => count($mitarbeitende),
        'kunden' => count($kunden), 'objekte' => count($objekte), 'einsaetze' => $einsaetze]);
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
        'INSERT INTO mitarbeiter (name, password_hash, ist_admin, vorname, nachname, ort, email)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $funktionZuweisen = $pdo->prepare('UPDATE mitarbeiter SET personalnummer = ? WHERE id = ?');
    $rolleZuweisen = $pdo->prepare('INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (?, ?)');

    $angelegt = [];
    $nr = 1;
    foreach (demo_mitarbeiterliste() as [$vor, $nach, $funktion, $abteilung, $rollen]) {
        $login = ma_login_generieren($vor, $nach, $pdo);
        $ort = $orte[($nr - 1) % count($orte)];
        $einsatz->execute([$login, $hash, 0, $vor, $nach, $ort, "$login@beispiel.ch"]);
        $id = (int)$pdo->lastInsertId();
        $funktionZuweisen->execute([str_pad((string)$nr, 3, '0', STR_PAD_LEFT), $id]);
        foreach ($rollen as $rolle) { $rolleZuweisen->execute([$id, $rolle]); }
        $angelegt[] = ['id' => $id, 'login' => $login, 'vorname' => $vor, 'nachname' => $nach,
            'funktion' => $funktion, 'abteilung' => $abteilung, 'rollen' => $rollen];
        $nr++;
    }
    return $angelegt;
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
// [von, bis, Wochentage (1=Mo..7=So, leer=täglich), bedarf]
function demo_schichtmuster(string $einsatzart): array
{
    return match ($einsatzart) {
        'Baustellenbewachung' => ['von' => '18:00', 'bis' => '06:00', 'tage' => [], 'bedarf' => 1],
        'Revierdienst'        => ['von' => '22:00', 'bis' => '06:00', 'tage' => [], 'bedarf' => 1],
        'Verkehrsdienst'      => ['von' => '07:00', 'bis' => '16:00', 'tage' => [1, 2, 3, 4, 5], 'bedarf' => 1],
        'Empfang'             => ['von' => '08:00', 'bis' => '17:00', 'tage' => [1, 2, 3, 4, 5], 'bedarf' => 1],
        default               => ['von' => '08:00', 'bis' => '17:00', 'tage' => [1, 2, 3, 4, 5], 'bedarf' => 1],
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
function demo_einsaetze_erzeugen(PDO $pdo, array $objekte, array $mitarbeitende): int
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
            $tage = range(-28, 14);
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
            for ($p = 0; $p < $brauchtPersonen; $p++) {
                $person = $team[$drehscheibe % count($team)];
                $drehscheibe++;
                $einZuteilung->execute([$einsatzId, $person['id'], 'bestätigt']);
            }
        }
    }
    return $angelegt;
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
