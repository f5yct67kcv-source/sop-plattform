<?php
declare(strict_types=1);
// ══════════════════════════════════════════════════════════════════════════
// LOHNGRUNDLAGEN nach GAV Ausgabe 2026 (ENT-451).
//
// Reiner Rechenkern, keine Datenbankzugriffe -- gleicher Grund wie bei
// ferien.php: leichter fuer sich allein zu pruefen, und die Aufrufer
// entscheiden, welche Stammdaten sie hereingeben.
//
// WAS HIER NICHT PASSIERT: Es entsteht keine fertige Lohnabrechnung. Diese
// Datei liefert die Groessen, aus denen eine Abrechnung gebaut wird --
// Lohnform, Dienstjahr, Mindestlohn, Ferienentschaedigungssatz,
// PaKo-Beitrag. Der Lohnlauf selbst kommt in einer spaeteren Etappe.
//
// KEINE ZWEITE ZEITRECHNUNG: Rohzeit, Nettozeit und Zeitbonus stehen in
// gav.js und werden hier NICHT nachgebaut (ENT-049). Wer Stunden braucht,
// bekommt sie als Parameter hereingereicht.
//
// Der volle Wortlaut steht erfasst in sop-projekt/90-gav/regelmatrix.md,
// Abschnitt "Lohnrelevante Artikel". Was dort UNVOLLSTAENDIG bleibt, steht
// im Auslegungsregister -- GAV-AUS-013 bis GAV-AUS-018 laufen mit
// ausdruecklich als ANNAHME markierten Auslegungen, nicht als Tatsache.
// ══════════════════════════════════════════════════════════════════════════

require_once __DIR__ . '/planung.php'; // kategorie_pruefen()

// ── Geldeinheit ──────────────────────────────────────────────────────────
// Gerechnet wird in RAPPEN als Ganzzahl, nie in Fliesskomma. Ein
// Frankenbetrag als float sammelt ueber viele Zeilen Rundungsdrift, und die
// faellt ausgerechnet bei der Summe auf, die jemand ausbezahlt bekommt.
// Dieselbe Wahl wie bei einsatz_auslagen (fahrzeitersatz_rappen).
//
// Prozentsaetze stehen als BASISPUNKTE (Hundertstelprozent): 833 = 8,33 %.
// Der GAV nennt in Art. 20 Ziff. 2 ausdruecklich "8,33 %" und "10,64 %" --
// nicht 1/12 und nicht 5/47. Wer hier bruchrechnet, weicht vom Wortlaut ab.
const LOHN_BP_TEILER = 10000; // 100 % = 10'000 Basispunkte

// Kaufmaennisches Runden auf ganze Rappen, von der Null weg. Bewusst EINE
// Funktion und nicht an jeder Stelle ein eigenes round(): Die
// Rundungsrichtung ist eine Festlegung mit Geldfolge und gehoert an genau
// eine Stelle, wo man sie findet.
function lohn_rappen(float $wert): int
{
    return (int)($wert >= 0 ? floor($wert + 0.5) : ceil($wert - 0.5));
}

// Betrag mal Satz in Basispunkten, gerundet auf Rappen.
function lohn_anteil(int $basisRappen, int $satzBp): int
{
    return lohn_rappen($basisRappen * $satzBp / LOHN_BP_TEILER);
}

// ── Lohnform ─────────────────────────────────────────────────────────────
// Art. 8 Ziff. 1a bindet Kategorie und Lohnform aneinander:
//   A  Monatslohn, 1'801-2'300 Stunden pro Kalenderjahr
//   B  Monatslohn,   901-1'800 Stunden
//   C  Stundenlohn,       bis 900 Stunden
//
// Darum wird die Lohnform ABGELEITET und nicht als zweites Feld erfasst.
// Zwei frei setzbare Felder koennten einander widersprechen, und dann gaebe
// es zwei Wahrheiten ueber dieselbe Person.
//
// null heisst "unbekannt", nicht "Stundenlohn". Wer keine Kategorie hat,
// wird nicht abgerechnet -- eine geratene Lohnform waere schlimmer als gar
// keine. Fuer Personen ausserhalb des GAV-Geltungsbereichs siehe OP-452.
const LOHN_FORM_MONAT  = 'monat';
const LOHN_FORM_STUNDE = 'stunde';

function lohn_form(?string $kategorie): ?string
{
    $k = kategorie_pruefen($kategorie);
    if ($k === 'A' || $k === 'B') { return LOHN_FORM_MONAT; }
    if ($k === 'C')               { return LOHN_FORM_STUNDE; }
    return null;
}

// ── Dienstjahr nach Art. 16 Ziff. 2 ──────────────────────────────────────
// "Bei Arbeitsaufnahme vor dem 1. Juli wird das Eintrittsjahr als erstes
// Dienstjahr angerechnet." Wortgleich mit der Ferienregel in Art. 20
// Ziff. 3, die ferien.php bereits umsetzt -- die Bedeutung ist dieselbe,
// die Rechnung darum auch.
//
// Der Wortlaut nennt nur den Vor-Fall. Der Nach-Fall (Eintritt ab dem
// 1. Juli) ergibt sich zwingend: Dann zaehlt das Eintrittsjahr NICHT als
// erstes Dienstjahr, das erste beginnt im Folgejahr. Das ist keine
// Auslegung, sondern die einzige Lesart, bei der der Satz ueberhaupt etwas
// bewirkt.
//
// Rueckgabe ab 1. Ein Datum vor dem Eintritt ergibt null -- da gab es das
// Arbeitsverhaeltnis noch nicht, und 0 saehe aus wie ein Ergebnis.
function lohn_dienstjahr(?string $eintritt, string $stichtag): ?int
{
    if (!$eintritt || strlen($eintritt) < 10 || strlen($stichtag) < 10) { return null; }
    if ($stichtag < $eintritt) { return null; }
    $jahrEin  = (int)substr($eintritt, 0, 4);
    $jahrStich = (int)substr($stichtag, 0, 4);
    $vorJuli  = substr($eintritt, 5, 5) < '07-01';
    // Eintritt vor dem 1. Juli: Eintrittsjahr ist Dienstjahr 1.
    // Sonst: Eintrittsjahr zaehlt nicht, das Folgejahr ist Dienstjahr 1.
    $dj = $jahrStich - $jahrEin + ($vorJuli ? 1 : 0);
    return $dj >= 1 ? $dj : 1;
}

// ── Anhang 1: Mindestloehne, versioniert ─────────────────────────────────
// Gleiche Bauart wie GAV_REGELWERK in gav.js: Eintraege mit
// Gueltigkeitszeitraum, beim Fortschreiben wird ANGEHAENGT und der alte
// Eintrag stehen gelassen. Faellt ein Datum in keinen Zeitraum, wird NICHT
// gerechnet -- lieber keine Zahl als eine auf abgelaufener Grundlage.
//
// ZWEI TABELLENWERKE: Der Anhang fuehrt die Ansaetze einmal allgemein und
// einmal fuer Geld-(CIT)/Werttransport. Wer nur eines erfasst, prueft gegen
// den falschen Mindestlohn. Der eigene Betrieb faehrt keinen Geldtransport;
// die Tabelle steht trotzdem hier, weil sie im GAV steht und ein spaeterer
// Bereich sie sonst nicht faende.
//
// Alle Betraege in RAPPEN. Kategorie A und B: Jahresbetraege bei der
// jeweiligen Bezugsarbeitszeit. Kategorie C: Stundenansaetze OHNE
// Ferienentschaedigung -- der Zuschlag nach Art. 20 Ziff. 2 kommt obendrauf
// und ist NICHT enthalten.
const LOHN_MINDESTLOHN = [
    [
        'quelle' => 'GAV private Sicherheitsdienstleistungen, Ausgabe 2026, Anhang 1 (AVE vom 11.12.2025)',
        'ab' => '2026-01-01', 'bis' => '2026-12-31',
        'bereiche' => [
            'allgemein' => [
                // Jahresbetraege; Index = Dienstjahr, letzter Wert gilt "ab".
                'A' => ['bezug_stunden' => 2000, 'jahr_rappen' => [
                    5427000, 5526000, 5688500, 5826500, 5941000, 6000000, 6038000,
                    6077000, 6117000, 6153500, 6193000, 6231500, 6275500]],
                'B' => ['bezug_stunden' => 1400, 'jahr_rappen' => [
                    3556000, 3614000, 3689500, 3784000, 3826500, 3863000]],
                // Stundenansaetze je Kantonsgruppe; Index = Dienstjahr.
                'C' => ['stunde_rappen' => [
                    'ZH'         => [2520, 2545, 2570, 2610],
                    'BS_BL_GE'   => [2470, 2495, 2515, 2550],
                    'uebrige'    => [2415, 2440, 2460, 2495],
                ]],
            ],
            'cit' => [
                'A' => ['bezug_stunden' => 2000, 'jahr_rappen' => [
                    5427000, 5540000, 5687000, 5802000, 5907000, 5945500, 5960000,
                    5997500, 6035500, 6073000, 6110500, 6148000, 6191500]],
                'B' => ['bezug_stunden' => 1400, 'jahr_rappen' => [
                    3519000, 3577500, 3653500, 3747500]],
                'C' => ['stunde_rappen' => [
                    'ZH'       => [2510, 2530],
                    'BS_BL_GE' => [2460, 2480],
                    'uebrige'  => [2405, 2420],
                ]],
            ],
        ],
        // Ziff. 2 der Anmerkungen zu Kategorie A: "Die Loehne fuer
        // Mitarbeitende unter 25 Jahren koennen um maximal CHF 150.- pro
        // Monat tiefer liegen als die aufgefuehrten Mindestansaetze."
        // Eine KANN-Bestimmung -- sie wird hier festgehalten, aber nie
        // automatisch angewendet. Wer sie nutzen will, entscheidet das je
        // Vertrag; das Werkzeug rechnet sonst gegen den vollen Ansatz.
        'jugendabzug_a_monat_rappen' => 15000,
        // Ziff. 1: Die Jahresmindestansaetze werden im Verhaeltnis zur
        // Arbeitszeit angepasst. Bandbreiten je Kategorie.
        'bandbreite' => ['A' => [1801, 2300], 'B' => [901, 1800], 'C' => [0, 900]],
    ],
];

function lohn_mindestlohn_regel(string $datum): ?array
{
    foreach (LOHN_MINDESTLOHN as $r) {
        if ($datum >= $r['ab'] && $datum <= $r['bis']) { return $r; }
    }
    return null;
}

// Kantonsgruppe der Kategorie-C-Tabelle. WELCHER Kanton massgeblich ist --
// Wohnort, Anstellungsort oder Einsatzort -- sagt der Anhang nicht; das
// laeuft als GAV-AUS-018. Diese Funktion beantwortet nur, in welche Gruppe
// ein gegebener Kanton faellt.
function lohn_kantonsgruppe(?string $kanton): string
{
    $k = strtoupper(trim((string)$kanton));
    if ($k === 'ZH') { return 'ZH'; }
    if ($k === 'BS' || $k === 'BL' || $k === 'GE') { return 'BS_BL_GE'; }
    return 'uebrige';
}

// Mindestlohn fuer eine Person zu einem Stichtag.
//
// Rueckgabe: ['stunde_rappen'|'jahr_rappen' => int, 'grundlage' => string]
// oder null, wenn nicht gerechnet werden kann. null heisst "unbekannt" und
// darf in der Oberflaeche NIE wie "kein Mindestlohn" aussehen -- der Grund
// steht darum in 'grund'.
function lohn_mindestlohn(
    ?string $kategorie,
    ?string $eintritt,
    string $stichtag,
    ?string $kanton = null,
    string $bereich = 'allgemein'
): array {
    $regel = lohn_mindestlohn_regel($stichtag);
    if (!$regel) {
        return ['wert' => null, 'grund' => 'kein_regelwerk',
                'text' => 'Fuer ' . $stichtag . ' ist kein Mindestlohn-Regelwerk hinterlegt'];
    }
    $kat = kategorie_pruefen($kategorie);
    if ($kat === null) {
        return ['wert' => null, 'grund' => 'keine_kategorie',
                'text' => 'Ohne Anstellungskategorie nach Art. 8 kein Mindestlohn'];
    }
    $dj = lohn_dienstjahr($eintritt, $stichtag);
    if ($dj === null) {
        return ['wert' => null, 'grund' => 'kein_eintritt',
                'text' => 'Ohne Eintrittsdatum kein Dienstjahr und damit kein Mindestlohn'];
    }
    $tab = $regel['bereiche'][$bereich][$kat] ?? null;
    if (!$tab) {
        return ['wert' => null, 'grund' => 'kein_bereich',
                'text' => 'Kein Mindestlohn-Tabellenwerk fuer Bereich ' . $bereich];
    }

    if ($kat === 'C') {
        $gruppe = lohn_kantonsgruppe($kanton);
        $reihe = $tab['stunde_rappen'][$gruppe];
        $wert = $reihe[min($dj, count($reihe)) - 1];
        return [
            'wert' => $wert, 'einheit' => 'stunde', 'dienstjahr' => $dj,
            'kantonsgruppe' => $gruppe, 'grund' => null,
            'text' => 'Art. 16 i.V.m. Anhang 1, Kat. C, Dienstjahr ' . $dj
                    . ', Gruppe ' . $gruppe . ' — ohne Ferienentschaedigung',
            'quelle' => $regel['quelle'],
        ];
    }
    $reihe = $tab['jahr_rappen'];
    $wert = $reihe[min($dj, count($reihe)) - 1];
    return [
        'wert' => $wert, 'einheit' => 'jahr', 'dienstjahr' => $dj,
        'bezug_stunden' => $tab['bezug_stunden'], 'grund' => null,
        'text' => 'Art. 16 i.V.m. Anhang 1, Kat. ' . $kat . ', Dienstjahr ' . $dj
                . ', bei ' . $tab['bezug_stunden'] . ' Jahresstunden',
        'quelle' => $regel['quelle'],
    ];
}

// Anhang 1, Anmerkung 1 zu Kategorie A und B: "Die Jahresmindestansaetze
// werden im Verhaeltnis zur Arbeitszeit angepasst." Ein Pensum von 1'000
// Stunden in Kategorie B misst sich also nicht am 1'400-Stunden-Betrag,
// sondern an dessen Anteil.
//
// Ohne Pensum wird NICHT hochgerechnet: Dann gilt der Tabellenwert
// unveraendert, und die Oberflaeche sagt, dass das Pensum fehlt.
function lohn_mindestlohn_pensum(array $mindestlohn, ?int $pensumStunden): array
{
    if ($mindestlohn['wert'] === null || ($mindestlohn['einheit'] ?? '') !== 'jahr') {
        return $mindestlohn;
    }
    $bezug = (int)($mindestlohn['bezug_stunden'] ?? 0);
    if ($bezug <= 0 || !$pensumStunden || $pensumStunden <= 0) {
        return $mindestlohn + ['pensum_angewendet' => false];
    }
    $mindestlohn['wert'] = lohn_rappen($mindestlohn['wert'] * $pensumStunden / $bezug);
    $mindestlohn['text'] .= ' — angepasst auf ' . $pensumStunden . ' Stunden';
    $mindestlohn['pensum_angewendet'] = true;
    return $mindestlohn;
}

// ── Art. 20 Ziff. 2: Ferienentschaedigung der Kategorie C ────────────────
// "5 Wochen bis zum zurueckgelegten 20. Altersjahr resp. 4 Wochen ab dem
// Kalenderjahr, in dem das 21. Altersjahr vollendet wird. Entsprechend wird
// ein Zuschlag zum Basisstundenlohn von 10,64 % (5 Wochen) respektive
// 8,33 % (4 Wochen) berechnet."
//
// Der Satz wird ABGELEITET und nicht je Person eingetippt (ENT-451): Ein
// frei erfasster Prozentsatz driftet vom Anspruch weg, und dann stimmt der
// Feriensaldo nicht mehr mit dem ausbezahlten Betrag ueberein.
//
// GAV-AUS-016: Die beiden Haelften des Satzes sind unterschiedlich
// formuliert -- die eine altersbezogen, die andere kalenderjahrbezogen.
// Dazwischen liegt ein Zeitraum, den der Wortlaut nicht eindeutig zuordnet.
// Bis zur Klaerung gilt die fuer die betroffene Person guenstigere Lesart:
// 10,64 %, solange nicht eindeutig feststeht, dass 8,33 % greifen
// (Betriebsentscheid nach ENT-451).
const LOHN_FERIEN_BP_5W = 1064; // 10,64 %
const LOHN_FERIEN_BP_4W = 833;  //  8,33 %

function lohn_ferienentschaedigung_bp(?string $geburtsdatum, string $stichtag): array
{
    if (!$geburtsdatum || strlen($geburtsdatum) < 10) {
        return ['bp' => LOHN_FERIEN_BP_5W, 'annahme' => true, 'grund' => 'kein_geburtsdatum',
                'text' => 'Ohne Geburtsdatum der hoehere Satz (10,64 %) — zugunsten der '
                        . 'mitarbeitenden Person, ENT-451/GAV-AUS-016'];
    }
    // "ab dem Kalenderjahr, in dem das 21. Altersjahr vollendet wird":
    // Das 21. Altersjahr vollendet, wer 21 wird. Das Kalenderjahr dieses
    // Geburtstags ist das erste mit 4 Wochen.
    $jahr21 = (int)substr($geburtsdatum, 0, 4) + 21;
    $jahrStich = (int)substr($stichtag, 0, 4);
    if ($jahrStich >= $jahr21) {
        return ['bp' => LOHN_FERIEN_BP_4W, 'annahme' => false, 'grund' => null,
                'text' => 'Art. 20 Ziff. 2: 4 Wochen, Zuschlag 8,33 %'];
    }
    return ['bp' => LOHN_FERIEN_BP_5W, 'annahme' => false, 'grund' => null,
            'text' => 'Art. 20 Ziff. 2: 5 Wochen, Zuschlag 10,64 %'];
}

// ── Art. 6 Ziff. 2: Vollzugs- und Weiterbildungskostenbeitrag (PaKo) ─────
// Kategorie A:      CHF 30.- pro Jahr bzw. CHF 2.50 pro Monat
// Kategorie B und C: CHF 0.015 pro geleistete Arbeitsstunde
//
// "Der Abzug erfolgt direkt vom Lohn des Mitarbeitenden und IST BEI DER
// LOHNABRECHNUNG AUFZUFUEHREN." Er darf also nie stillschweigend im
// Nettolohn verschwinden -- er ist eine eigene Zeile.
//
// 1,5 Rappen je Stunde sind kein ganzer Rappen. Der Betrag entsteht darum
// erst aus der MONATSSUMME der Stunden und wird einmal gerundet, nicht je
// Schicht -- sonst zahlte jede angebrochene Stunde einen halben Rappen zu
// viel oder zu wenig.
//
// GAV-AUS-013: Was "geleistete Arbeitsstunde" bemisst -- Rohzeit, Nettozeit
// oder bewertete Zeit inkl. Zeitbonus -- sagt der Wortlaut nicht. Der
// Aufrufer reicht die Groesse herein, die er nach dem Betriebsentscheid
// verwendet; diese Funktion rechnet nur.
const LOHN_PAKO_A_MONAT_RAPPEN = 250;   // CHF 2.50
const LOHN_PAKO_BC_PRO_STUNDE  = 1.5;   // 1,5 Rappen je Stunde

function lohn_pako_beitrag_rappen(?string $kategorie, float $stunden): array
{
    $kat = kategorie_pruefen($kategorie);
    if ($kat === null) {
        return ['rappen' => null, 'grund' => 'keine_kategorie',
                'text' => 'Ohne Anstellungskategorie kein PaKo-Beitrag berechenbar'];
    }
    if ($kat === 'A') {
        return ['rappen' => LOHN_PAKO_A_MONAT_RAPPEN, 'grund' => null,
                'text' => 'Art. 6 Ziff. 2: CHF 2.50 pro Monat (Kat. A)'];
    }
    return ['rappen' => lohn_rappen($stunden * LOHN_PAKO_BC_PRO_STUNDE), 'grund' => null,
            'text' => 'Art. 6 Ziff. 2: CHF 0.015 je Stunde × '
                    . rtrim(rtrim(number_format($stunden, 2, '.', ''), '0'), '.')
                    . ' (Kat. ' . $kat . ')'];
}

// ── Art. 25: Berufliche Vorsorge ─────────────────────────────────────────
// "Ab 1. Januar nach Vollendung des 24. Altersjahres wird ein Beitrag von
// mindestens 9 % des koordinierten Lohnes erhoben. Maximal die Haelfte der
// Beitraege kann der Arbeitgeber dem Mitarbeitenden vom Lohn abziehen."
//
// Diese Funktion beantwortet nur die Eintrittsfrage. Der BETRAG kommt nicht
// von hier: Die Skala der Pensionskasse ist deren Vertragswerk, nicht der
// GAV. Er wird je Person aus der PK-Meldung erfasst (ENT-451) und NICHT
// hergeleitet -- eine selbst gerechnete Altersgutschrift waere eine
// Behauptung ueber einen fremden Vertrag.
function lohn_bvg_pflichtig_ab(?string $geburtsdatum): ?string
{
    if (!$geburtsdatum || strlen($geburtsdatum) < 10) { return null; }
    return ((int)substr($geburtsdatum, 0, 4) + 25) . '-01-01';
}

// ══════════════════════════════════════════════════════════════════════════
// BUNDESRECHT: AHV, IV und EO (ENT-451, Etappe 4).
//
// Diese Saetze sind KEIN Betriebswert. Sie gelten fuer jeden Arbeitgeber in
// der Schweiz gleich und werden haelftig zwischen Arbeitgeber und
// Mitarbeitendem getragen. Darum stehen sie hier als versioniertes
// Regelwerk mit Gueltigkeitsjahr -- gleiche Bauform wie LOHN_MINDESTLOHN
// fuer Anhang 1 -- und NICHT in der Tabelle lohn_abzug, wo die
// betriebseigenen Saetze liegen (NBU, KTG, BVG, Quellensteuer). Wer einen
// Bundeswert von Hand eintippt, kann ihn falsch eintippen; das ist eine
// Fehlerquelle ohne Gegenwert.
//
// WARUM DIE QUELLE MITLAEUFT: Fuer dieselbe Frage lieferte eine Websuche
// 5,05 Prozent und eine ALV-Obergrenze von 126 000 Franken -- Werte aus der
// Zeit vor 2016. Ungeprueft uebernommen haette das jede Abrechnung falsch
// gemacht, ohne dass irgendetwas kaputtgeht. An diesen Zahlen haengt Geld:
// Da darf spaeter niemand raten muessen, woher sie stammen.
const LOHN_SV = [
    2026 => [
        'quelle' => 'Merkblatt 2.01 "Lohnbeitraege an die AHV, die IV und die EO", '
                  . 'Stand am 1. Januar 2026, Ziffern 1, 3, 15 und 17',
        // Ziff. 3, Gesamtsaetze (Arbeitgeber und Arbeitnehmer zusammen).
        'ahv_bp' => 870, 'iv_bp' => 140, 'eo_bp' => 50, 'total_bp' => 1060,
        // Ziff. 3: "ziehen Sie 5,3 % des Lohns Ihrer Arbeitnehmenden fuer
        // deren Anteil an den Beitraegen ab".
        'an_bp' => 530,
        // Ziff. 15 und 17: Freibetrag fuer Erwerbstaetige ueber dem
        // Referenzalter.
        'freibetrag_jahr_rappen'  => 1680000,
        'freibetrag_monat_rappen' =>  140000,
    ],
];

// Welches Regelwerk gilt am Stichtag? NULL heisst "fuer dieses Jahr ist
// nichts erfasst" -- und das ist etwas anderes als "null Prozent". Der
// Aufrufer sperrt dann, statt beitragsfrei zu rechnen. Dieselbe Regel wie
// beim fehlenden Abzugssatz: eine fehlende Grundlage ist kein Nullwert.
function lohn_sv(string $stichtag): ?array
{
    if (strlen($stichtag) < 4) { return null; }
    return LOHN_SV[(int)substr($stichtag, 0, 4)] ?? null;
}

// Merkblatt 2.01 Ziff. 1: "Erwerbstaetige Personen sind ab dem 1. Januar
// nach dem 17. Geburtstag beitragspflichtig."
//
// Das Merkblatt fuehrt dazu eine Jahrgangstabelle: Jahrgang 2007 ist 2025
// pflichtig, Jahrgang 2008 erst 2026. Beides ist Geburtsjahr + 18 -- das
// Tagesdatum spielt keine Rolle, nur das Jahr. Wer taggenau rechnet, macht
// jemanden ein halbes Jahr zu frueh beitragspflichtig.
function lohn_ahv_pflichtig_ab(?string $geburtsdatum): ?string
{
    if (!$geburtsdatum || strlen($geburtsdatum) < 10) { return null; }
    return ((int)substr($geburtsdatum, 0, 4) + 18) . '-01-01';
}

// Merkblatt 2.01 Ziff. 2: Das Referenzalter liegt bei 65 Jahren; fuer Frauen
// mit Jahrgang vor 1964 gelten Uebergangsregelungen (Zuschlag in Monaten).
const LOHN_REFERENZALTER_UEBERGANG = [1960 => 0, 1961 => 3, 1962 => 6, 1963 => 9];

// Wann erreicht diese Person das Referenzalter?
//
// WARUM DAS MEHR IST ALS EINE ZAHL: Ab dem Referenzalter faellt nach
// Ziff. 14 KEIN ALV-Beitrag mehr an, und es entsteht ein Freibetrag auf
// AHV, IV und EO. Beides bewegt Geld, und zwar in beide Richtungen.
//
// Die Uebergangsjahrgaenge brauchen das Geschlecht. Fehlt es, oder steht es
// auf "unbestimmt", wird NICHT geraten: Die Funktion meldet 'unbekannt',
// und der Aufrufer sperrt. Einfach 65 anzunehmen waere fuer eine Frau des
// Jahrgangs 1960 ein Jahr zu spaet -- ein Jahr ALV-Abzug zuviel und ein
// Jahr Freibetrag zuwenig, und es faellt niemandem auf. Genau die Sorte
// Fehler, gegen die die Hausregel "unbekannt darf nie wie keine aussehen"
// geschrieben wurde.
function lohn_referenzalter(?string $geburtsdatum, ?string $geschlecht): array
{
    $leer = ['erreicht_am' => null, 'monate' => null, 'unbekannt' => true, 'text' => null];
    if (!$geburtsdatum || strlen($geburtsdatum) < 10) {
        return $leer + ['grund' => 'kein_geburtsdatum'];
    }
    $jahrgang  = (int)substr($geburtsdatum, 0, 4);
    $uebergang = LOHN_REFERENZALTER_UEBERGANG[$jahrgang] ?? null;
    $monate    = 65 * 12;
    if ($uebergang !== null) {
        // Nur Frauen dieser Jahrgaenge haben ein tieferes Referenzalter.
        // Ohne gesichertes Geschlecht ist die Frage nicht beantwortbar.
        if ($geschlecht === 'weiblich') {
            $monate = 64 * 12 + $uebergang;
        } elseif ($geschlecht !== 'maennlich') {
            return $leer + ['grund' => 'geschlecht_unbestimmt'];
        }
    }
    $d = new DateTimeImmutable($geburtsdatum);
    $erreicht = $d->add(new DateInterval('P' . $monate . 'M'));
    $jahre = intdiv($monate, 12);
    $rest  = $monate % 12;
    return [
        'erreicht_am' => $erreicht->format('Y-m-d'),
        'monate' => $monate,
        'unbekannt' => false,
        'grund' => null,
        'text' => 'Referenzalter ' . $jahre . ($rest ? ' Jahre und ' . $rest . ' Monate' : ' Jahre')
                . ' (Merkblatt 2.01 Ziff. 2)',
    ];
}

// Merkblatt 2.01 Ziff. 15 und 17: 16 800 Franken im Jahr; bei unterjaehriger
// Taetigkeit "1 400 Franken pro vollem ODER ANGEBROCHENEM Kalendermonat".
//
// Das Wort "angebrochen" ist der ganze Punkt. Das Merkblatt rechnet im
// eigenen Beispiel den 30. Maerz bis 6. Juni als VIER Monate -- Maerz und
// Juni zaehlen je ganz. Wer hier taggenau rechnet, zieht zu wenig ab und
// belastet den Mitarbeitenden mit Beitraegen, die er nicht schuldet.
//
// Der Freibetrag gilt "fuer jedes einzelne Arbeitsverhaeltnis separat"
// (Ziff. 12) -- fuer dieses Werkzeug also je Person und Betrieb, nicht
// aufgeteilt auf mehrere Arbeitgeber. Und er ist nach Ziff. 16 verzichtbar;
// der Verzicht gilt fuer das ganze Kalenderjahr. Ob er vorliegt, ist eine
// Angabe je Person und Jahr, keine Rechengroesse -- sie kommt nicht von
// hier.
function lohn_ahv_freibetrag_rappen(int $monate, string $stichtag): ?int
{
    $sv = lohn_sv($stichtag);
    if ($sv === null || $monate <= 0) { return null; }
    $betrag = $monate * $sv['freibetrag_monat_rappen'];
    return min($betrag, $sv['freibetrag_jahr_rappen']);
}

// Angebrochene Kalendermonate zwischen zwei Daten -- die Zaehlweise aus
// Ziff. 17, nicht die kaufmaennische. Anfangs- und Endmonat zaehlen je ganz.
function lohn_angebrochene_monate(string $von, string $bis): int
{
    if (strlen($von) < 7 || strlen($bis) < 7) { return 0; }
    $a = (int)substr($von, 0, 4) * 12 + (int)substr($von, 5, 2);
    $b = (int)substr($bis, 0, 4) * 12 + (int)substr($bis, 5, 2);
    return $b < $a ? 0 : $b - $a + 1;
}

// ── Lohnart-Kennzeichen ──────────────────────────────────────────────────
// Die sechs Kennzeichen sind der Unterschied zwischen einer
// nachvollziehbaren Abrechnung und einer Blackbox: Sie erklaeren, warum
// eine Position in einer Bemessungsgrundlage auftaucht und in einer anderen
// nicht. Ausdruecklich benannt statt "alles ausser" -- wer eine Lohnart
// anlegt, entscheidet jedes einzelne bewusst.
function lohnart_kennzeichen(): array
{
    return [
        'ahv_pflichtig'    => 'Zaehlt zum AHV-pflichtigen Lohn (Grundlage fuer AHV/IV/EO, ALV, NBU)',
        'ferien_pflichtig' => 'Traegt die Ferienentschaedigung nach Art. 20 Ziff. 2',
        'ml13_pflichtig'   => 'Traegt den Anteil 13. Monatslohn (betrieblich, keine GAV-Pflicht)',
        'bvg_pflichtig'    => 'Zaehlt zum BVG-pflichtigen Lohn nach Art. 25 Ziff. 2',
        'uvg_pflichtig'    => 'Zaehlt zum UVG-pflichtigen Lohn (bis Hoechstlohn)',
        'qst_pflichtig'    => 'Zaehlt zum quellensteuerpflichtigen Bruttolohn',
    ];
}

// ── Startbestand des Lohnartenkatalogs ───────────────────────────────────
// Steht HIER und nicht im Einrichtungs-Endpunkt, damit Pruefungen ihn
// erreichen. Genau daran ist ein Fehler unbemerkt geblieben: Der Lohnlauf
// erzeugte zwei Schluessel, die im Katalog fehlten -- und einer davon
// (`geleistete_stunden`) traegt den gesamten AHV-pflichtigen Lohn. In der
// Abzugsetappe waere die AHV auf null gerechnet worden, ohne dass etwas
// kaputtgegangen waere. `pruef_lohnlauf.php` vergleicht seither beide
// Seiten.
//
// Angelegt werden ausschliesslich Lohnarten, die auf einem erfassten
// GAV-Artikel beruhen oder strukturell noetig sind; sie tragen system=1
// und lassen sich nicht loeschen. Betriebliche Zulagen legt die Verwaltung
// selbst an.
//
// Die sechs *_pflichtig-Kennzeichen sind je Zeile einzeln gesetzt, nicht
// ueber eine Voreinstellung: Wer eine Lohnart anlegt, entscheidet jedes
// bewusst.
function lohnart_startbestand(): array
{
    // [schluessel, bezeichnung, art, basis, satz_bp,
    //  ahv, ferien, ml13, bvg, uvg, qst, gav_grundlage, sortierung]
    return [
        ['grundlohn_stunde', 'Grundlohn pro Stunde', 'stundensatz', null, null,
         1,1,1,1,1,1, 'Art. 16 i.V.m. Anhang 1 GAV', 10],
        ['grundlohn_monat', 'Monatslohn', 'monatslohn', null, null,
         1,0,1,1,1,1, 'Art. 16 i.V.m. Anhang 1 GAV', 11],
        // Traegt selbst keine Ferienentschaedigung und keinen 13.
        // Monatslohn -- sonst rechnete sich ein Zuschlag auf einen
        // Zuschlag. Der Satz steht bewusst nicht hier: Er wird nach
        // Art. 20 Ziff. 2 aus dem Alter abgeleitet.
        ['ferienentschaedigung', 'Ferienentschädigung', 'prozent', 'grundlohn', null,
         1,0,0,1,1,1, 'Art. 20 Ziff. 2 GAV', 20],
        // KEINE GAV-Pflicht -- der Vertrag kennt den 13. Monatslohn nur in
        // Art. 25 Ziff. 2 als Bestandteil der BVG-Bemessung. Darum steht
        // bei der Grundlage nichts, und das ist eine Aussage.
        ['anteil_13ml', 'Anteil 13. Monatslohn', 'prozent', 'grundlohn', null,
         1,0,0,1,1,1, null, 21],
        // Eine ZWISCHENSUMME, kein Lohnbestandteil: Sie fasst Grundlohn,
        // Ferienentschaedigung und 13.-Anteil zusammen und wird danach mit
        // den Stunden multipliziert. Zaehlt in KEINE Bemessungsgrundlage --
        // sonst staende derselbe Lohn zweimal darin.
        ['brutto_stundenlohn', 'Brutto Stundenlohn', 'zwischensumme', null, null,
         0,0,0,0,0,0, 'Art. 16 i.V.m. Art. 20 Ziff. 2 GAV', 25],
        // DIE Zeile mit dem tatsaechlichen Lohnbetrag. Nicht ferien- und
        // nicht 13.-ML-pflichtig: Beide stecken bereits im
        // Bruttostundenlohn. Waeren sie hier gesetzt, gaebe es
        // Ferienentschaedigung auf die Ferienentschaedigung.
        ['geleistete_stunden', 'Total geleistete Stunden', 'stundensatz', null, null,
         1,0,0,1,1,1, 'Art. 12 Ziff. 2 GAV', 30],
        ['zuschlag_fachausweis', 'Zuschlag Fachausweis', 'stundensatz', null, null,
         1,1,1,1,1,1, 'Art. 19 Ziff. 1 GAV', 31],
        ['zuschlag_hund', 'Zuschlag Diensthund', 'stundensatz', null, null,
         1,1,1,1,1,1, 'Art. 19 Ziff. 2 GAV', 32],
        ['zuschlag_waffe', 'Zuschlag Schusswaffe', 'stundensatz', null, null,
         1,1,1,1,1,1, 'Art. 19 Ziff. 3 GAV', 33],
        ['zeitzuschlag', 'Zeitzuschlag über 210 Stunden', 'prozent', 'grundlohn', 2500,
         1,1,1,1,1,1, 'Art. 14 Ziff. 3 GAV', 35],
        // Auslagenersatz ist KEIN Lohn: nicht AHV-pflichtig, in keiner
        // Bemessungsgrundlage. Nach GAV-AUS-009 gehoert er in eine
        // getrennte Spesenabrechnung nach Art. 18 Ziff. 10 -- nicht in die
        // Arbeitszeitabrechnung nach Art. 12 Ziff. 5.
        ['auslagenersatz', 'Auslagenersatz', 'netto', null, null,
         0,0,0,0,0,0, 'Art. 18 GAV', 40],
        // Abzuege. Ihre SAETZE stehen in lohn_abzug mit
        // Gueltigkeitszeitraum -- hier steht nur, dass es die Zeile gibt.
        ['ahv', 'AHV-, IV-, EO-Beitrag', 'abzug', 'ahv_brutto', null,
         0,0,0,0,0,0, null, 50],
        ['alv', 'ALV-Beitrag', 'abzug', 'ahv_brutto', null,
         0,0,0,0,0,0, null, 51],
        ['nbu', 'NBU-Beitrag', 'abzug', 'uvg_brutto', null,
         0,0,0,0,0,0, null, 52],
        ['ktg', 'Krankentaggeld-Beitrag', 'abzug', 'ahv_brutto', null,
         0,0,0,0,0,0, 'Art. 17 Ziff. 3 GAV', 53],
        ['bvg', 'BVG-Beitrag', 'abzug', null, null,
         0,0,0,0,0,0, 'Art. 25 GAV', 54],
        // Art. 6 Ziff. 2 verlangt ausdruecklich, dass dieser Abzug "bei der
        // Lohnabrechnung aufzufuehren" ist -- er darf nie stillschweigend
        // im Nettolohn verschwinden.
        ['pako', 'Vollzugskostenbeitrag PaKo', 'abzug', null, null,
         0,0,0,0,0,0, 'Art. 6 Ziff. 2 GAV', 55],
        ['quellensteuer', 'Quellensteuer', 'abzug', 'qst_brutto', null,
         0,0,0,0,0,0, null, 56],
    ];
}

// Wie eine Lohnart rechnet. VARCHAR statt ENUM, gleiche Wahl wie bei
// objekte.sparte -- eine siebte Art soll keine Tabellenaenderung brauchen.
function lohnart_arten(): array
{
    return [
        'stundensatz' => 'Betrag je Stunde (Basis × Stunden)',
        'prozent'     => 'Prozentsatz auf einer Bemessungsgrundlage',
        'fixbetrag'   => 'Fester Betrag je Abrechnung',
        'monatslohn'  => 'Monatslohn nach Pensum',
        'zwischensumme' => 'Zwischensumme — fasst andere Zeilen zusammen und zählt selbst in keine Bemessungsgrundlage',
        'abzug'       => 'Abzug vom Bruttolohn',
        'netto'       => 'Weder AHV-pflichtig noch Abzug — z.B. Auslagenersatz nach Art. 18',
    ];
}
