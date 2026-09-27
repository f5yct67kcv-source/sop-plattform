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
// Sie LEERT KEINE MUSTERDATEN. Der naechtliche Reset (ENT-523, Stufe 4,
// noch nicht gebaut) ist ein eigener Schritt, der zuerst die vorhandenen
// Musterdaten entfernt und DANACH diese Erzeugung erneut aufruft --
// Erzeugen und Leeren bleiben zwei getrennte, einzeln nachvollziehbare
// Schritte. Einzige Ausnahme, siehe demo_daten_erzeugen_ausfuehren(): das
// EINE Bootstrap-Konto aus setup.php wird geraeumt. Das ist kein
// Musterdaten-Leeren, sondern das Aufraeumen eines Einweg-Zugangs, der
// seinen einzigen Zweck -- die Einrichtung ueberhaupt erst ausloesen --
// bereits erfuellt hat, bevor dieser Endpunkt ueberhaupt erreichbar war.
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

// Zuverlaessiges Signal "Musterbetrieb wurde bereits erzeugt". Geprueft
// wird ueber kunden/objekte, NICHT ueber mitarbeiter: Nur diese beiden
// Tabellen fuellt ausschliesslich diese Datei selbst, darum bedeutet
// "leer" hier wirklich "noch nie gelaufen". mitarbeiter dagegen enthaelt
// an der Stelle, an der demo_daten_erzeugen_ausfuehren() diese Frage
// stellt, STRUKTURELL IMMER schon einen Eintrag: das Bootstrap-Konto aus
// setup.php, ueber dessen Sitzung der Endpunkt (api/demo_daten_erzeugen.php,
// require_session()) ueberhaupt erst aufgerufen werden konnte. Eine
// Pruefung auf "mitarbeiter leer" waere als Vorbedingung nie erreichbar
// gewesen -- genau der Fehler, an dem der erste echte Aufruf gegen die
// Demo-Datenbank gescheitert ist, bevor diese Funktion hier stand.
function demo_musterbetrieb_bereits_da(PDO $pdo): bool
{
    $kunden = (int)$pdo->query('SELECT COUNT(*) FROM kunden')->fetchColumn();
    $objekte = (int)$pdo->query('SELECT COUNT(*) FROM objekte')->fetchColumn();
    return $kunden > 0 || $objekte > 0;
}

// Traegt den HTTP-Status mit, den die beiden selbst-antwortenden Aufrufer
// (api/demo_daten_erzeugen.php, api/demo_reset_ausfuehren.php) schon immer
// verwendet haben -- die Aufteilung unten aendert an IHREM Verhalten nichts.
class DemoDatenFehler extends RuntimeException
{
    public function __construct(string $message, public readonly int $status)
    {
        parent::__construct($message);
    }
}

// Reine Fassung (seit ENT-612-Nachtrag, 2026-09-18): gibt das Ergebnis
// zurueck oder wirft, antwortet nie selbst. NOETIG geworden, weil
// demo_anfordern.php diese Erzeugung nur als EINEN Schritt unter mehreren
// braucht (danach folgen noch das Anlegen des angeforderten Kontos, der
// Registereintrag und der Mailversand) -- die alte, selbst-antwortende
// Fassung (demo_daten_erzeugen_ausfuehren() unten) haette den Rest der
// Anfrage beim ersten erfolgreichen Demo-Zugang STILLSCHWEIGEND
// abgeschnitten (json_response() beendet den Prozess). BESTANDSFEHLER:
// Erst sichtbar geworden, als am 2026-09-18 die Einrichtung eines Demo-
// Platzes zum ersten Mal ueberhaupt erfolgreich durchlief -- bis dahin
// schlug jede Anfrage schon vorher fehl (siehe ENT-612).
function demo_daten_erzeugen(PDO $pdo): array
{
    // Ohne vorherige Einrichtung kontrolliert abbrechen, statt mit halben
    // Tabellen weiterzuarbeiten. hat_tabelle() steht in db.php.
    foreach (['ma_funktion', 'ma_abteilung', 'objekte', 'rollen', 'einsaetze', 'rundgang', 'kontrollpunkt',
              'lohn_ansatz', 'lohn_abzug', 'lohnlauf'] as $t) {
        if (!hat_tabelle($pdo, $t)) {
            throw new DemoDatenFehler(
                "Einrichtung fehlt noch (Tabelle $t) -- zuerst im Cockpit auf „Einrichten“ klicken.", 503);
        }
    }
    // Nie auf einen bereits gefuellten Betrieb schreiben (kein Leeren von
    // Musterdaten hier, siehe Kopf) -- ein zweiter Lauf ohne vorherigen
    // Reset waere sonst eine stille Verdoppelung aller Mitarbeitenden und
    // Objekte.
    if (demo_musterbetrieb_bereits_da($pdo)) {
        throw new DemoDatenFehler(
            'Es sind bereits Kunden oder Objekte vorhanden -- dieser Lauf ist nur fuer einen noch nicht erzeugten Musterbetrieb gedacht.', 409);
    }

    $pdo->beginTransaction();
    try {
        // Das Bootstrap-Konto aus setup.php raeumen: Es hatte genau einen
        // Zweck -- die Einrichtung ueberhaupt erst ausloesen -- und ist
        // danach ueberfluessig. ENT-523 Punkt 4 sieht die Anmeldung als
        // "eine erfundene Mitarbeiterin" vor, nie als das Bootstrap-Konto
        // selbst. Mit ON DELETE CASCADE (schema.sql) faellt seine Sitzung
        // gleich mit -- schlaegt der Rest dieser Transaktion fehl, kommt
        // mit dem ROLLBACK auch die Sitzung zurueck, niemand bleibt ohne
        // Zugang stranden.
        // Das Support-Konto bleibt stehen (ENT-631). Ohne die Bedingung
        // fiele es mit -- und per ON DELETE CASCADE gleich die Sitzung
        // dessen, der womoeglich GERADE per Supportzugang zusieht, wie
        // die Demo neu befuellt wird.
        $pdo->exec('DELETE FROM mitarbeiter WHERE ' . ma_nur_menschen($pdo));
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
        throw new DemoDatenFehler('Musterbetrieb-Erzeugung abgebrochen: ' . $e->getMessage(), 500);
    }

    return ['mitarbeitende' => count($mitarbeitende), 'kunden' => count($kunden),
        'objekte' => count($objekte), 'einsaetze' => $einsaetze, 'lohnlauf_id' => $lohnlaufId];
}

// Selbst-antwortende Huelle fuer die beiden Aufrufer, die diesen Aufruf
// bewusst als LETZTEN Schritt einer Anfrage einsetzen (siehe deren eigene
// Kopfkommentare: "Ruft json_response() selbst auf und beendet damit
// diesen Aufruf"). demo_anfordern.php gehoert NICHT dazu -- es ruft
// stattdessen demo_daten_erzeugen() oben direkt auf.
function demo_daten_erzeugen_ausfuehren(PDO $pdo): void
{
    try {
        $ergebnis = demo_daten_erzeugen($pdo);
    } catch (DemoDatenFehler $e) {
        json_response(['status' => 'error', 'message' => $e->getMessage()], $e->status);
    }
    json_response(['status' => 'ok', ...$ergebnis]);
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

// Wer in der Demo die Revierdienst-Berechtigung (ENT-284) bekommt: die
// Abteilung Revierdienst, sonst niemand (2026-09-23, Anordnung des
// Projektinhabers). Bis dahin hatte sie keiner -- jeder Revierdienst mit
// Zuteilung lief in die Warnung, und ein Interessent hielt das fuer einen
// Fehler. Der Verkehrsdienst bleibt ohne, damit die Warnung in der Demo
// weiterhin zu sehen ist, wenn man jemanden von dort einteilt.
function demo_revierdienst_berechtigt(string $abteilung): bool
{
    return $abteilung === 'Revierdienst';
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
    $revierSpalte = function_exists('hat_spalte') && hat_spalte($pdo, 'mitarbeiter', 'revierdienst_berechtigt');
    $revierSetzen = $revierSpalte
        ? $pdo->prepare('UPDATE mitarbeiter SET revierdienst_berechtigt = 1 WHERE id = ?') : null;

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
        if ($revierSetzen && demo_revierdienst_berechtigt($abteilung)) { $revierSetzen->execute([$id]); }
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
// Die drei letzten Parameter (ENT-714) braucht der Testdaten-Erzeuger der
// Testseite: Er stellt nicht jeden Lauf bis "ausbezahlt" durch (der
// Vormonat bleibt "freigegeben"), traegt eine eigene Bemerkung und haengt
// einen Ersatzlauf an einen stornierten. Der Demo-Aufruf bleibt unveraendert.
function demo_lohnlauf_erzeugen(PDO $pdo, string $von, string $bis, int $erstelltVon,
                                string $endStatus = 'ausbezahlt', ?string $bemerkung = null,
                                ?int $ersetztLaufId = null): ?int
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
    $einLauf->execute([$von, $bis, 'entwurf', $erstelltVon, $bemerkung ?? 'Musterbetrieb-Lohnlauf (ENT-523, Stufe 2b)']);
    $laufId = (int)$pdo->lastInsertId();
    if ($ersetztLaufId !== null) {
        $pdo->prepare('UPDATE lohnlauf SET ersetzt_lauf_id = ? WHERE id = ?')->execute([$ersetztLaufId, $laufId]);
    }

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
    if ($endStatus === 'entwurf') { return $laufId; }
    $pdo->prepare('UPDATE lohnlauf SET status = ?, freigegeben_am = ?, freigegeben_von = ? WHERE id = ?')
        ->execute(['freigegeben', $freigegebenAm, $erstelltVon, $laufId]);
    if ($endStatus === 'freigegeben') { return $laufId; }
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
// WARUM IN DIESER DATEI: Er benutzt die Bausteine des Demo-Musterbetriebs
// (Funktionen, Abteilungen, Lohnabzuege, Lohnlauf) -- und eine neue
// Hilfsdatei muesste in die Staging-.htaccess, die von Hand gepflegt wird
// (Drift-Guard, ENT-384/387).
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
             anstellungskategorie, pensum_stunden, eintritt, geburtsdatum)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $nrSetzen = $pdo->prepare('UPDATE mitarbeiter SET personalnummer = ? WHERE id = ?');
    $vmSetzen = $vmSpalte ? $pdo->prepare('UPDATE mitarbeiter SET verkehrsmittel = ? WHERE id = ?') : null;
    $rolle = $pdo->prepare('INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (?, ?)');
    $revier = hat_spalte($pdo, 'mitarbeiter', 'revierdienst_berechtigt')
        ? $pdo->prepare('UPDATE mitarbeiter SET revierdienst_berechtigt = 1 WHERE id = ?') : null;

    $angelegt = [];
    foreach (td_mitarbeiterliste() as $i => [$vor, $nach, $funktion, $abteilung, $rollen, $vm]) {
        $nr = $i + 1;
        $login = ma_login_generieren($vor, $nach, $pdo);
        // Eintritt vor der ganzen Geschichte: Eine Person, die mittendrin
        // anfaengt, haette davor entweder gearbeitet, ohne angestellt zu
        // sein, oder ihr Partner haette ueber 210 Stunden im Monat geleistet.
        $eintritt = demo_tag(-(520 + ($nr * 137) % 1400));
        $geburt = demo_tag(-(365 * 21) - (($nr * 733) % (365 * 38)));
        $ein->execute([$login, $hash, $vor, $nach, $orte[$i % count($orte)], "$login@beispiel.ch",
                       'C', 1800 + ($nr * 53) % 400, $eintritt, $geburt]);
        $id = (int)$pdo->lastInsertId();
        $nrSetzen->execute([str_pad((string)(100 + $nr), 3, '0', STR_PAD_LEFT), $id]);
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
    foreach (td_kundenliste() as $i => [$name, $strasse, $ort, $ap, $zahlt]) {
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
    $ma = $pdo->query("SELECT id, vorname, nachname, eintritt, " .
        (hat_spalte($pdo, 'mitarbeiter', 'verkehrsmittel') ? 'verkehrsmittel' : 'NULL AS verkehrsmittel') .
        " FROM mitarbeiter WHERE personalnummer IS NOT NULL AND personalnummer <> '' ORDER BY personalnummer")->fetchAll();
    $liste = td_mitarbeiterliste();
    $personen = [];
    foreach ($ma as $i => $m) {
        if (!isset($liste[$i])) { break; }
        $personen[] = $m + ['abteilung' => $liste[$i][3], 'rollen' => $liste[$i][4]];
    }
    $objekte = $pdo->query('SELECT id, kunde_id, kunde_name, name, strasse, ort, einsatzart FROM objekte ORDER BY id')->fetchAll();
    foreach (td_objektliste() as $i => $o) {
        if (!isset($objekte[$i])) { throw new TestdatenFehler('Objekte fehlen -- zuerst "start" ausfuehren.'); }
        $objekte[$i] += ['km' => $o[3], 'leistung' => $o[4], 'muster' => $o[5]];
    }
    $produkte = [];
    foreach ($pdo->query('SELECT id, name, einzelpreis_rappen FROM produkte ORDER BY sortierung')->fetchAll() as $i => $p) {
        $produkte[array_keys(td_leistungen())[$i] ?? 'x'] = $p;
    }
    $verwaltung = (int)($pdo->query('SELECT MIN(id) FROM mitarbeiter WHERE personalnummer IS NULL OR personalnummer = ""')->fetchColumn()
        ?: $personen[0]['id']);
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
    // Erst hier geladen, nicht oben in der Datei: Der Demo-Weg (auch im
    // Betreiber-Buendel) braucht beide Module nicht, und dort liegt
    // auslagen.php gar nicht.
    require_once __DIR__ . '/auslagen.php';
    require_once __DIR__ . '/belege.php';
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
    require_once __DIR__ . '/belege.php';
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
        'mitarbeitende' => $n("SELECT COUNT(*) FROM mitarbeiter WHERE personalnummer IS NOT NULL AND personalnummer <> ''"),
        'kunden'        => $n('SELECT COUNT(*) FROM kunden'),
        'objekte'       => $n('SELECT COUNT(*) FROM objekte'),
        'einsaetze'     => $n('SELECT COUNT(*) FROM einsaetze'),
        'rechnungen'    => $n("SELECT COUNT(*) FROM belege WHERE art = 'rechnung'"),
        'offerten'      => $n("SELECT COUNT(*) FROM belege WHERE art = 'offerte'"),
        'lohnlaeufe'    => $n('SELECT COUNT(*) FROM lohnlauf'),
    ];
}
