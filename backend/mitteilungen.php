<?php
// Mitteilungen (ENT-421).
//
// Vom Projektinhaber bestellt, nachdem die Funktion "schon das eine oder
// andere mal diskutiert" worden war: *"um sehr wichtige mitteilung
// einzugeben ausserhalb von Gruppenchats. Z.b Ferien eintragen,
// Mitarbeitersitzung"*. Loest die schlanke Fassung aus ENT-176 ein --
// Titel + kurzer Text, kein Rich-Text, keine Anhaenge, keine Kommentare.
//
// Diese Datei ist die EINE Stelle, die entscheidet, wer welche Mitteilung
// sieht. Endpunkte fragen sie, statt die Bedingung nachzubauen: eine
// Sichtbarkeitsregel an vier Stellen ist vier Regeln, die auseinanderlaufen
// koennen.
//
// Vier Festlegungen tragen den Aufbau:
//
//  1. ZIELGRUPPE STATT EMPFAENGERLISTE. Eine Mitteilung geht an "alle" oder
//     an "revier" -- ein Feld am Datensatz, keine Zuteilungstabelle. Vom
//     Projektinhaber so entschieden: Die beiden benannten Faelle
//     (Betriebsmitteilung / "Diese Infos tangieren nur die Revier MA") sind
//     damit gedeckt. Einzelne Personen auszuwaehlen ginge nur mit einer
//     zusaetzlichen Tabelle -- die kaeme spaeter dazu, ohne das Bestehende
//     umzubauen.
//
//  2. ZWEI STUFEN, UND NUR DIE OBERE UNTERBRICHT. "wichtig" zeigt beim
//     naechsten Oeffnen der App ein Fenster, das weggeklickt werden muss;
//     "normal" zaehlt nur an der Glocke. Bewusst nicht jede Mitteilung:
//     Ein Riegel, der jeden Tag kommt, wird gewohnheitsmaessig
//     weggeklickt -- und dann trifft es genau die eine Meldung, auf die es
//     ankommt.
//
//  3. GELESEN STEHT JE PERSON, nicht am Datensatz. Anders als beim
//     Ereignis-Feed (ereignisse.php, "gesehen gilt fuer alle"): Dort
//     arbeitet die Verwaltung eine gemeinsame Liste ab, hier soll
//     nachweisbar sein, WER eine Mitteilung gesehen hat. Darum eine eigene
//     Tabelle mit einer Zeile je Person und Mitteilung.
//
//  4. SICHTBARKEIT IST EINE ZEITFRAGE, KEIN STATUS. sichtbar_ab und
//     sichtbar_bis stehen am Datensatz; ob eine Mitteilung gerade laeuft,
//     wird bei jeder Abfrage aus der Uhr abgeleitet. Ein gepflegter
//     Status-Wert muesste von einem Zeitgeber umgesetzt werden -- den gibt
//     es hier nicht, und ein nie gelaufener Zeitgeber waere eine
//     Mitteilung, die ewig steht.
declare(strict_types=1);

// Die beiden Zielgruppen. EINE Liste -- Speichern und Lesen befragen sie,
// statt je eine eigene zu fuehren.
const MITTEILUNG_ZIELGRUPPEN = ['alle', 'revier'];

// Die beiden Stufen. 'wichtig' ist die einzige, die unterbricht.
const MITTEILUNG_STUFEN = ['normal', 'wichtig'];

// Die beiden Arten (ENT-436). Eine Mitteilung teilt etwas mit; ein Termin
// verlangt zusaetzlich eine Antwort. Alles andere ist gleich -- Zielgruppe,
// Zeitfenster, Glocke, Benachrichtigung, Lesestand. Darum EINE Tabelle mit
// einem Merkmal, nicht zwei Tabellen mit denselben Spalten.
const MITTEILUNG_ARTEN = ['info', 'termin'];

// Die Antwort auf einen Termin. 'offen' ist die Voreinstellung und heisst
// "hat noch nicht geantwortet" -- ausdruecklich NICHT dasselbe wie
// 'abgesagt' (CLAUDE.md: "unbekannt" darf nie wie "keine" aussehen). Wer
// nicht antwortet, hat nicht abgesagt; er hat nicht geantwortet.
//
// Die Woerter sind an einsatz_zuteilung.zusage angelehnt ('offen',
// 'zugesagt'), nur heisst die Ablehnung hier 'abgesagt' statt 'abgelehnt':
// Bei einer Schicht lehnt man eine Zuteilung ab, bei einer Sitzung sagt man
// ab.
const TERMIN_ANTWORTEN = ['offen', 'zugesagt', 'abgesagt'];

function mitteilung_art_gueltig(string $wert): bool
{
    return in_array($wert, MITTEILUNG_ARTEN, true);
}

// Ohne 'offen': Das ist der Ausgangszustand, nicht etwas, das jemand
// anklicken kann. Ein Endpunkt, der 'offen' entgegennaehme, liesse eine
// abgegebene Antwort zuruecknehmen, ohne dass es jemand sieht.
function termin_antwort_gueltig(string $wert): bool
{
    return $wert === 'zugesagt' || $wert === 'abgesagt';
}

function mitteilung_ist_termin(array $m): bool
{
    return (string)($m['art'] ?? 'info') === 'termin';
}

/**
 * Die Antwort dieser Person auf diesen Termin -- 'offen', wenn keine
 * vorliegt.
 *
 * Eine fehlende Zeile in mitteilung_gelesen (nie geoeffnet) und eine Zeile
 * ohne Antwort (geoeffnet, nicht geantwortet) bedeuten dasselbe: offen. Der
 * Unterschied steht in gelesen_am, nicht hier.
 */
function termin_antwort(array $m): string
{
    $a = (string)($m['antwort'] ?? '');
    return termin_antwort_gueltig($a) ? $a : 'offen';
}

function mitteilung_zielgruppe_gueltig(string $wert): bool
{
    return in_array($wert, MITTEILUNG_ZIELGRUPPEN, true);
}

function mitteilung_stufe_gueltig(string $wert): bool
{
    return in_array($wert, MITTEILUNG_STUFEN, true);
}

/**
 * Darf diese Person diese Mitteilung sehen?
 *
 * Reine Funktion ohne Datenbank, damit sie sich fuer sich allein pruefen
 * laesst -- dieselbe Bauweise wie darf() in rechte.php. Die drei Bedingungen
 * sind bewusst getrennt: Zielgruppe (wen es angeht), Zeitfenster (ab wann
 * und bis wann) und Archiv (zurueckgezogen).
 *
 * $jetzt wird MITGEGEBEN und nicht hier geholt: Eine Funktion, die selbst
 * auf die Uhr sieht, laesst sich nicht mit einem Zeitpunkt pruefen, den es
 * gerade nicht ist -- und genau das braucht eine Pruefung des
 * Zeitfensters (Projektregel: kein festes Datum nahe beim heutigen Tag).
 */
function mitteilung_sichtbar_fuer(array $m, bool $revierBerechtigt, string $jetzt): bool
{
    if (!empty($m['archiviert_am'])) { return false; }

    $zielgruppe = (string)($m['zielgruppe'] ?? 'alle');
    if ($zielgruppe === 'revier' && !$revierBerechtigt) { return false; }
    // Eine unbekannte Zielgruppe zeigt NICHTS an. Der andere Weg -- im
    // Zweifel anzeigen -- machte aus einem Tippfehler in der Datenbank eine
    // Mitteilung, die alle sehen, obwohl sie fuer wenige gedacht war.
    if (!mitteilung_zielgruppe_gueltig($zielgruppe)) { return false; }

    $ab  = trim((string)($m['sichtbar_ab'] ?? ''));
    $bis = trim((string)($m['sichtbar_bis'] ?? ''));
    if ($ab !== '' && $ab > $jetzt) { return false; }
    if ($bis !== '' && $bis < $jetzt) { return false; }

    return true;
}

/**
 * Steht diese Mitteilung im Archiv?
 *
 * Zwei Wege fuehren hinein, und beide bedeuten dasselbe: nicht mehr in der
 * App. Zurueckgezogen (archiviert_am gesetzt) oder abgelaufen
 * (sichtbar_bis vorbei). Eine GEPLANTE Mitteilung gehoert nicht dazu --
 * sie war noch gar nicht draussen; sie ist unterwegs, nicht erledigt.
 *
 * Diese Funktion ist zugleich die Loeschsperre (ENT-433): Endgueltig
 * geloescht werden darf nur, was hier steht. Sie liegt darum in dieser
 * Datei und nicht im Endpunkt -- Cockpit und Server ziehen dieselbe
 * Grenze, wirksam ist die im Server (api/mitteilung_loeschen.php), das
 * Cockpit erspart nur den Umweg.
 *
 * $jetzt wird mitgegeben, aus demselben Grund wie bei
 * mitteilung_sichtbar_fuer(): sonst liesse sich der Ablauf nicht mit einem
 * Zeitpunkt pruefen, den es gerade nicht ist.
 */
function mitteilung_im_archiv(array $m, string $jetzt): bool
{
    if (!empty($m['archiviert_am'])) { return true; }
    $bis = trim((string)($m['sichtbar_bis'] ?? ''));
    return $bis !== '' && $bis < $jetzt;
}

/**
 * Unterbricht diese Mitteilung beim Oeffnen der App?
 *
 * Nur die Stufe "wichtig", und nur solange diese Person sie nicht
 * bestaetigt hat. Sichtbarkeit wird hier NICHT noch einmal geprueft --
 * dafuer gibt es mitteilung_sichtbar_fuer(); zwei Pruefstellen fuer
 * dieselbe Frage waeren zwei Wahrheiten.
 */
function mitteilung_unterbricht(array $m): bool
{
    // Ein Termin fragt, solange keine Antwort vorliegt (ENT-436) --
    // unabhaengig von der Stufe. "Spaeter" im Fenster ist keine Antwort und
    // wird darum auch nicht gespeichert: Der Termin steht danach weiter
    // offen und fragt beim naechsten Oeffnen wieder.
    if (mitteilung_ist_termin($m)) { return termin_antwort($m) === 'offen'; }

    return (string)($m['stufe'] ?? 'normal') === 'wichtig' && empty($m['bestaetigt_am']);
}

/**
 * Die SQL-Bedingung fuer die Sichtbarkeit, passend zu
 * mitteilung_sichtbar_fuer(). Beide beschreiben dieselbe Regel -- die
 * Funktion fuer einen einzelnen Datensatz, diese Zeichenkette fuer die
 * Datenbank.
 *
 * Sie gehoeren zusammen und werden zusammen geprueft: pruef_mitteilungen.php
 * laesst dieselben Faelle durch beide laufen und vergleicht das Ergebnis.
 * Ohne diese Gegenprobe waere die Doppelung genau die Art Fehler, die still
 * bleibt -- die Liste zeigte etwas anderes als die Einzelabfrage.
 *
 * Die Berechtigung wird als ZIELGRUPPENNAME uebergeben ('revier' oder ein
 * leerer Text), nicht als 0/1 gegen eine Zahl verglichen. Grund, in der
 * Gegenprobe aufgefallen: PDO bindet ohne ausdruecklichen Typ als
 * Zeichenkette. MySQL wandelt '1' = 1 stillschweigend um, SQLite nicht --
 * dieselbe Bedingung haette also je nach Datenbank verschieden entschieden.
 * Ein Vergleich zweier Zeichenketten entscheidet ueberall gleich.
 *
 * Die Platzhalter fuellt mitteilung_sql_werte() -- damit niemand die
 * Reihenfolge selbst zusammensetzt.
 */
function mitteilung_sql_sichtbar(): string
{
    return "(m.archiviert_am IS NULL
             AND (m.zielgruppe = 'alle' OR m.zielgruppe = ?)
             AND (m.sichtbar_ab IS NULL OR m.sichtbar_ab <= ?)
             AND (m.sichtbar_bis IS NULL OR m.sichtbar_bis >= ?))";
}

/**
 * Die Werte zu mitteilung_sql_sichtbar(), in der richtigen Reihenfolge.
 *
 * Ohne Revierdienst wird ein leerer Text uebergeben -- er trifft auf keine
 * gueltige Zielgruppe zu und schliesst die Revier-Mitteilungen damit
 * genauso aus, wie mitteilung_sichtbar_fuer() es tut.
 */
function mitteilung_sql_werte(bool $revierBerechtigt, string $jetzt): array
{
    return [$revierBerechtigt ? 'revier' : '', $jetzt, $jetzt];
}

/**
 * Die Mitteilungen, die diese Person gerade sehen darf -- samt eigenem
 * Lesestand.
 *
 * Sortierung: zuerst die Termine, auf die diese Person noch nicht
 * geantwortet hat (ENT-436) -- sie sind das Einzige, was von ihr etwas
 * verlangt --, dann die wichtigen, dann die neuesten. Wer die App oeffnet,
 * soll oben das finden, was draengt, nicht das, was zufaellig zuletzt
 * getippt wurde. Ein beantworteter Termin draengt nicht mehr und reiht sich
 * wieder nach Datum ein.
 */
function mitteilungen_fuer_person(PDO $pdo, int $mitarbeiterId, bool $revierBerechtigt, string $jetzt): array
{
    $sql = 'SELECT m.id, m.titel, m.text, m.zielgruppe, m.stufe,
                   m.art, m.beginn, m.ende, m.ort,
                   m.sichtbar_ab, m.sichtbar_bis, m.erstellt_am,
                   m.verfasser_name,
                   g.gelesen_am, g.bestaetigt_am, g.antwort, g.antwort_am
              FROM mitteilungen m
              LEFT JOIN mitteilung_gelesen g
                     ON g.mitteilung_id = m.id AND g.mitarbeiter_id = ?
             WHERE ' . mitteilung_sql_sichtbar() . "
             ORDER BY (m.art = 'termin' AND (g.antwort IS NULL OR g.antwort = 'offen')) DESC,
                      (m.stufe = 'wichtig') DESC, m.erstellt_am DESC, m.id DESC";
    $st = $pdo->prepare($sql);
    $st->execute(array_merge([$mitarbeiterId], mitteilung_sql_werte($revierBerechtigt, $jetzt)));
    return $st->fetchAll();
}

/**
 * Vermerkt "gelesen" -- und, wenn ausdruecklich bestaetigt wurde,
 * zusaetzlich "bestaetigt".
 *
 * Einmal gesetzte Zeitpunkte bleiben stehen: gelesen_am ist der ERSTE
 * Kontakt, nicht der letzte. Ein Feld, das bei jedem Oeffnen neu gesetzt
 * wird, beantwortet die Frage "seit wann weiss diese Person davon?" nicht
 * mehr.
 */
function mitteilung_gelesen_merken(PDO $pdo, int $mitteilungId, int $mitarbeiterId, bool $bestaetigt, string $jetzt): void
{
    $st = $pdo->prepare(
        'INSERT INTO mitteilung_gelesen (mitteilung_id, mitarbeiter_id, gelesen_am, bestaetigt_am)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             gelesen_am   = COALESCE(gelesen_am, VALUES(gelesen_am)),
             bestaetigt_am = COALESCE(bestaetigt_am, VALUES(bestaetigt_am))'
    );
    $st->execute([$mitteilungId, $mitarbeiterId, $jetzt, $bestaetigt ? $jetzt : null]);
}

/**
 * Die Antwort auf einen Termin festhalten (ENT-436).
 *
 * ZWEI SCHRITTE STATT "ON DUPLICATE KEY UPDATE": Anders als
 * mitteilung_gelesen_merken() laeuft diese Funktion damit auch gegen
 * SQLite -- und die Pruefung prueft dann sie selbst statt einer Abschrift,
 * die auseinanderlaufen kann. Ein zweites Antworten (Meinung geaendert)
 * darf ausserdem nicht am Primaerschluessel scheitern.
 *
 * Die Antwort ist zugleich ein Lesenachweis: Wer aus dem Fenster heraus
 * antwortet, hat die Liste nie geoeffnet. gelesen_am bleibt dabei der ERSTE
 * Kontakt und wird von einer spaeteren Antwort nicht verschoben.
 */
function termin_antwort_merken(PDO $pdo, int $mitteilungId, int $mitarbeiterId, string $antwort, string $jetzt): void
{
    $da = $pdo->prepare('SELECT gelesen_am FROM mitteilung_gelesen
                          WHERE mitteilung_id = ? AND mitarbeiter_id = ?');
    $da->execute([$mitteilungId, $mitarbeiterId]);
    $alt = $da->fetch();

    if (!$alt) {
        $pdo->prepare('INSERT INTO mitteilung_gelesen
                         (mitteilung_id, mitarbeiter_id, gelesen_am, antwort, antwort_am)
                       VALUES (?, ?, ?, ?, ?)')
            ->execute([$mitteilungId, $mitarbeiterId, $jetzt, $antwort, $jetzt]);
        return;
    }
    // antwort_am wird bei jeder Antwort neu gesetzt -- anders als
    // gelesen_am. Es beantwortet "wann hat diese Person zuletzt
    // entschieden?", und genau das aendert sich, wenn jemand seine Meinung
    // aendert.
    $pdo->prepare('UPDATE mitteilung_gelesen SET antwort = ?, antwort_am = ?
                    WHERE mitteilung_id = ? AND mitarbeiter_id = ?')
        ->execute([$antwort, $jetzt, $mitteilungId, $mitarbeiterId]);
}

/**
 * Wie viele Personen eine Mitteilung sehen duerfen -- der Nenner zu
 * "12 von 18 gelesen".
 *
 * Ohne diesen Nenner waere "12 gelesen" eine Zahl ohne Bezug; die
 * Projektregel verlangt bei jeder gefilterten Zahl das "von".
 * Gezaehlt werden nur aktive Konten: Wer den Betrieb verlassen hat, kann
 * nichts mehr lesen und wuerde den Nenner dauerhaft unerreichbar machen.
 */
/**
 * Die Bedingung, die den Empfaengerkreis beschreibt -- oder null, wenn er
 * nicht feststellbar ist.
 *
 * EINE Stelle fuer zwei Fragen: wie viele es sind (der Nenner zu "12 von
 * 18") und wer es ist (die Antwortliste eines Termins, ENT-436). Zwei
 * getrennte Bedingungen liefen auseinander, sobald sich eine aendert -- und
 * dann zaehlte die Zahl andere Personen, als die Liste zeigt.
 *
 * null heisst UNBEKANNT, nicht "niemand": Ohne die Spalte
 * revierdienst_berechtigt (Einrichtung noch nicht gelaufen) laesst sich der
 * Revier-Kreis nicht bestimmen. Die Oberflaeche muss das als solches
 * ausweisen und nicht als 0.
 */
function mitteilung_empfaenger_wo(PDO $pdo, string $zielgruppe): ?string
{
    if ($zielgruppe !== 'revier') { return 'aktiv = 1'; }
    if (!hat_spalte($pdo, 'mitarbeiter', 'revierdienst_berechtigt')) { return null; }
    return 'aktiv = 1 AND revierdienst_berechtigt = 1';
}

function mitteilung_empfaengerzahl(PDO $pdo, string $zielgruppe): int
{
    // Gezaehlt werden nur aktive Konten: Wer den Betrieb verlassen hat,
    // kann nichts mehr lesen und wuerde den Nenner dauerhaft unerreichbar
    // machen.
    $wo = mitteilung_empfaenger_wo($pdo, $zielgruppe);
    if ($wo === null) { return -1; }
    return (int)$pdo->query("SELECT COUNT(*) FROM mitarbeiter WHERE $wo")->fetchColumn();
}
