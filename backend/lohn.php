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
// ── In welcher Form ein Abzug erfasst wird ───────────────────────────────
//
// Der NBU kennt nur den SATZ. Ein UVG-Versicherer legt die Praemie als Satz
// des versicherten Verdienstes fest -- ein fester Frankenbetrag ist dort
// systemfremd, und lohnlauf.php rechnet folgerichtig nur mit dem Satz. Bis
// diese Regel benannt war, liess sich fuer den NBU trotzdem ein Fixbetrag
// speichern: Die Abrechnung sperrte dann mit "Praemiensatz ist nicht
// erfasst", obwohl etwas erfasst WAR -- und zwar fuer jede NBU-versicherte
// Person im Lauf.
//
// KTG und BVG kennen beide Formen. Beim BVG ist der Frankenbetrag sogar der
// Normalfall: Er kommt aus der Meldung der Pensionskasse, nicht aus einem
// Satz, den der Betrieb selbst rechnen duerfte.
//
// Benannt statt in zwei if-Bedingungen versteckt, weil zwei Stellen sie
// brauchen -- das Speichern und das Rechnen -- und zwei Kopien irgendwann
// zwei verschiedene Antworten geben.
function lohn_abzug_nur_satz(string $schluessel): bool
{
    return $schluessel === 'nbu';
}

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
        'gilt_fuer' => [2026],
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
// Nachschlagen im Regelwerk -- fuer alle drei Sozialversicherungen gleich.
//
// EIN MERKBLATT KANN FUER MEHRERE JAHRE GELTEN. Die Informationsstelle
// AHV/IV legt ein Merkblatt nur neu auf, wenn sich etwas geaendert hat: Fuer
// AHV/IV/EO gibt es eine Ausgabe mit Stand 1. Januar 2026, fuer die ALV und
// die Unfallversicherung ist die Ausgabe mit Stand 1. Januar 2025 die
// aktuellste (vom Projektinhaber am 2026-09-08 bestaetigt).
//
// Deshalb traegt jeder Jahrgang eine AUSDRUECKLICHE Liste der Jahre, fuer
// die er gilt -- und keinen stillen Rueckfall auf das juengste vorhandene
// Jahr. Der Unterschied ist der ganze Zweck: Ein Rueckfall wuerde 2027
// klaglos mit den Saetzen von 2026 weiterrechnen, wenn niemand nachtraegt.
// Eine Jahresliste laeuft aus, und dann sperrt der Lauf und sagt es.
function lohn_regelwerk(array $werk, string $stichtag): ?array
{
    if (strlen($stichtag) < 4) { return null; }
    $jahr = (int)substr($stichtag, 0, 4);
    foreach ($werk as $eintrag) {
        if (in_array($jahr, $eintrag['gilt_fuer'] ?? [], true)) { return $eintrag; }
    }
    return null;
}

function lohn_sv(string $stichtag): ?array
{
    return lohn_regelwerk(LOHN_SV, $stichtag);
}

// ══════════════════════════════════════════════════════════════════════════
// BUNDESRECHT: die Arbeitslosenversicherung (ENT-451, Etappe 4).
//
// EIGENES Regelwerk statt zusaetzlicher Felder in LOHN_SV, aus einem
// nachpruefbaren Grund: Die beiden Merkblaetter haben VERSCHIEDENE STAENDE.
// AHV, IV und EO liegen als "Stand am 1. Januar 2026" vor, die ALV nur als
// "Stand am 1. Januar 2025". Beide in denselben Jahrgang zu schreiben hiesse,
// den aelteren Wert stillschweigend als den neueren auszugeben.
//
// Darum ist LOHN_ALV nach dem Jahr gekeyt, fuer das das Merkblatt GILT.
// Fehlt ein Jahr, liefert lohn_alv() null und der Aufrufer sperrt mit Namen
// und Fundstelle -- er rechnet NICHT mit dem Vorjahressatz weiter. Eine
// veraltete ALV-Grenze faellt sonst nirgends auf: Sie produziert weiterhin
// plausible Betraege, nur die falschen.
const LOHN_ALV = [
    2025 => [
        'quelle' => 'Merkblatt 2.08 "Beitraege an die Arbeitslosenversicherung", '
                  . 'Stand am 1. Januar 2025 (Ausgabe November 2024), Ziffern 1 bis 5. '
                  . 'Vom Projektinhaber am 2026-09-08 als AKTUELLSTE Ausgabe bestaetigt -- '
                  . 'das Merkblatt wurde fuer 2026 nicht neu aufgelegt und gilt darum auch '
                  . 'fuer dieses Jahr.',
        'gilt_fuer' => [2025, 2026],
        // Ziff. 1: "Bis zu einem jaehrlichen Hoechstbetrag von 148 200 Franken
        // betraegt der Beitragssatz an die ALV 2,2 % des massgebenden
        // Jahreslohnes." Arbeitgebende und Arbeitnehmende tragen je die Haelfte.
        'total_bp' => 220,
        'an_bp'    => 110,
        'hoechstbetrag_jahr_rappen' => 14820000,
        // Ziff. 1: "Seit dem 1. Januar 2023 sind auf Lohnanteile, die diesen
        // Betrag uebersteigen, keine ALV-Beitraege mehr zu entrichten."
        // Oberhalb der Grenze gibt es KEINEN zweiten Satz -- der frueher
        // erhobene Solidaritaetsbeitrag ist weg. Das war eine der offenen
        // Fragen aus OP-465 und ist damit beantwortet.
        'ueber_grenze_bp' => 0,
        // Ziff. 3: Der unterjaehrige Hoechstbetrag entsteht ueber einen
        // TAGESSATZ von Jahresbetrag geteilt durch 360, mit 30 angerechneten
        // Tagen je Monat -- Samstage und Sonntage eingeschlossen. Nicht ueber
        // Kalendertage: Wer durch 365 teilt, bekommt eine andere Grenze.
        'tage_jahr'  => 360,
        'tage_monat' => 30,
    ],
];

// Welches ALV-Regelwerk gilt am Stichtag? Siehe den Kommentar oben: null
// heisst "fuer dieses Jahr nicht erfasst", nicht "beitragsfrei".
function lohn_alv(string $stichtag): ?array
{
    return lohn_regelwerk(LOHN_ALV, $stichtag);
}

// Merkblatt 2.08 Ziff. 1, woertlich: "Dieser Hoechstbetrag gilt fuer jedes
// einzelne Arbeitsverhaeltnis."
//
// DAS ENTLASTET DAS DATENMODELL, und zwar an der Stelle, an der ich einen
// Umbau befuerchtet hatte: Der Hoechstbetrag ist KEINE personenbezogene
// Jahresgrenze ueber alle Arbeitgeber hinweg. Wer im selben Jahr anderswo
// gearbeitet hat, bringt dort bezahlte Loehne NICHT mit -- das Werkzeug muss
// sie also weder erfragen noch fuehren. Zu summieren ist ausschliesslich,
// was in DIESEM Arbeitsverhaeltnis gezahlt wurde.
const LOHN_ALV_JE_ARBEITSVERHAELTNIS = true;

// Angerechnete Beschaeftigungstage nach Merkblatt 2.08 Ziff. 3 und 4.
//
// Die Regel ist nicht "Kalendertage", sondern 30 Tage je Monat. Das Beispiel
// in Ziff. 4 rechnet den 15. April bis 29. Dezember als 255 Tage: 16 Tage im
// April, sieben volle Monate zu 30 Tagen, 29 Tage im Dezember. Taggenau
// waeren es 259 -- und der Hoechstbetrag entsprechend hoeher.
//
// Ein Eintritt am 31. wird wie der 30. gerechnet; ein Monat hat in dieser
// Zaehlung nie mehr als 30 angerechnete Tage.
function lohn_alv_tage(string $von, string $bis): ?int
{
    if (strlen($von) < 10 || strlen($bis) < 10 || $bis < $von) { return null; }
    $vj = (int)substr($von, 0, 4); $vm = (int)substr($von, 5, 2); $vt = (int)substr($von, 8, 2);
    $bj = (int)substr($bis, 0, 4); $bm = (int)substr($bis, 5, 2); $bt = (int)substr($bis, 8, 2);
    if ($vt > 30) { $vt = 30; }
    if ($bt > 30) { $bt = 30; }
    $monate = ($bj - $vj) * 12 + ($bm - $vm);
    if ($monate === 0) { return max(0, $bt - $vt + 1); }
    return (30 - $vt + 1) + ($monate - 1) * 30 + $bt;
}

// Unterjaehriger Hoechstbetrag nach Ziff. 3: Jahresbetrag geteilt durch 360,
// mal die angerechneten Tage. Nie mehr als der Jahresbetrag -- ein Zeitraum
// ueber zwoelf Monate hinaus hebt die Jahresgrenze nicht an (Ziff. 2).
function lohn_alv_hoechstbetrag(string $von, string $bis, array $alv): ?int
{
    $tage = lohn_alv_tage($von, $bis);
    if ($tage === null) { return null; }
    $jahr = (int)$alv['hoechstbetrag_jahr_rappen'];
    return min($jahr, lohn_rappen($jahr * $tage / (int)$alv['tage_jahr']));
}

// Merkblatt 2.08 Ziff. 5: "Der provisorische monatliche Hoechstbetrag wird
// bei der monatlichen Abrechnung als ein Zwoelftel des jaehrlichen
// Hoechstbetrags festgelegt."
//
// Das beantwortet die Frage, die ich fuer datenmodell-relevant gehalten
// hatte: Die MONATLICHE Abrechnung braucht KEINEN mitlaufenden Jahresstand.
// Sie wendet die Zwoelftelgrenze an; der Ausgleich geschieht nach Ziff. 6
// "spaetestens am Jahresende oder bei Dienstaustritt" in einer eigenen
// Schlussabrechnung. Der Jahresstand wird also erst dort gebraucht, nicht
// in jedem Lauf.
function lohn_alv_monatsgrenze(array $alv): int
{
    return lohn_rappen((int)$alv['hoechstbetrag_jahr_rappen'] / 12);
}

// Rundung auf 5 Rappen -- BELEGT, nicht angenommen.
//
// Merkblatt 2.08 Ziff. 4 weist die Haelfte von 14 626.65 als 7 313.35 aus.
// Exakt sind es 7 313.325; auf Rappen gerundet ergaebe das 7 313.33. Nur die
// Rundung auf 5 Rappen trifft den Wert des Merkblatts.
//
// WO sie angewandt wird, ist damit ausdruecklich NICHT entschieden. Die Frage
// nach der Rundung des Auszahlungsbetrags steht als OP-465 beim
// Projektinhaber. Diese Funktion stellt die Rundung bereit; sie wendet sie
// von sich aus an keiner Stelle an.
function lohn_fuenfrappen(float $rappen): int
{
    return lohn_rappen($rappen / 5) * 5;
}

// ══════════════════════════════════════════════════════════════════════════
// BUNDESRECHT: die obligatorische Unfallversicherung (ENT-451, Etappe 4).
//
// Wieder ein eigenes Regelwerk, wieder aus demselben Grund: eigenes Gesetz,
// eigener Stand, eigene Zaehlweise. Merkblatt 6.05 traegt Stand
// 1. Januar 2025 -- wie die ALV, aber anders als AHV/IV/EO (2026).
const LOHN_UVG = [
    2025 => [
        'quelle' => 'Merkblatt 6.05 "Obligatorische Unfallversicherung UVG", '
                  . 'Stand am 1. Januar 2025 (Ausgabe November 2024), Ziffern 4 und 5. '
                  . 'Vom Projektinhaber am 2026-09-08 als AKTUELLSTE Ausgabe bestaetigt -- '
                  . 'das Merkblatt wurde fuer 2026 nicht neu aufgelegt und gilt darum auch '
                  . 'fuer dieses Jahr.',
        'gilt_fuer' => [2025, 2026],
        // Ziff. 5, woertlich: "Der Hoechstbetrag des versicherten Verdienstes
        // in der Unfallversicherung betraegt 148 200 Franken pro Jahr oder
        // 406 Franken pro Tag."
        //
        // BEIDE Betraege stehen so im Merkblatt, und der Tagesbetrag ist
        // NICHT aus dem Jahresbetrag abgeleitet: 148 200 / 360 waeren 411.67,
        // / 365 waeren 406.03, und 406 x 365 ergibt 148 190, nicht 148 200.
        // Wer den einen aus dem anderen rechnet, bekommt einen anderen Wert
        // als den, der im Merkblatt steht. Darum stehen beide einzeln da.
        'hoechstbetrag_jahr_rappen' => 14820000,
        'hoechstbetrag_tag_rappen'  =>    40600,
        // Ziff. 4: die Schwelle, unterhalb derer KEINE NBU-Deckung besteht.
        'nbu_schwelle_std_woche' => 8,
    ],
];

// ACHTUNG, eine Falle mit gleichem Betrag: Der UVG-Hoechstbetrag und die
// ALV-Obergrenze lauten beide auf 148 200 Franken. Das ist nachgewiesen aus
// ZWEI Merkblaettern und keine Ableitung -- die Gleichheit darf nicht als
// Regel behandelt werden. Auch die unterjaehrige Zaehlung der ALV (30 Tage
// je Monat, 360 im Jahr, Merkblatt 2.08 Ziff. 3) gilt hier NICHT mit: Das
// UVG nennt einen eigenen Tagesbetrag.
function lohn_uvg(string $stichtag): ?array
{
    return lohn_regelwerk(LOHN_UVG, $stichtag);
}

// ══════════════════════════════════════════════════════════════════════════
// WAS IST FEST, WAS IST VARIABEL? (ENT-451, Etappe 4)
//
// Diese Funktion beantwortet genau eine Frage, und zwar fuer die Anzeige:
// Welche Rechengrundlagen stehen fest, weil sie aus einem Merkblatt des
// Bundes stammen -- und fuer welche Jahre sind sie erfasst?
//
// SIE RECHNET NICHTS. Der Lauf fragt weiter lohn_sv(), lohn_alv() und
// lohn_uvg() einzeln; wuerde hier gerechnet, gaebe es zwei Wege zu
// derselben Zahl und einer davon liefe irgendwann auseinander.
//
// WARUM DAS GEBRAUCHT WIRD: Bis hierher stand nirgends auf dem Bildschirm,
// welche Zahl woher kommt. Der Betrieb sah eine Liste erfasster Saetze und
// musste raten, ob die AHV dazugehoert. Sie gehoert nicht dazu -- sie steht
// im Code, weil sie fuer alle gleich ist. Umgekehrt kann der NBU-Satz
// nirgends im Code stehen: Ihn setzt der Versicherer je Betrieb.
//
// Der 'fehlt_ab'-Wert ist der eigentliche Zweck. Ein Merkblatt gilt fuer
// eine ABGESCHLOSSENE Liste von Jahren; laeuft sie aus, sperrt der Lauf ab
// dem 1. Januar. Das soll man im September vorher sehen und nicht am
// Neujahrsmorgen.
function lohn_bundesgrundlagen(string $stichtag): array
{
    $jahr = strlen($stichtag) >= 4 ? (int)substr($stichtag, 0, 4) : 0;

    $bau = function (string $sl, string $bez, array $werk, string $traegt,
                     callable $satzText) use ($jahr, $stichtag): array {
        $gilt = lohn_regelwerk($werk, $stichtag);
        // Alle Jahre, die irgendein Jahrgang dieses Werks abdeckt.
        $jahre = [];
        foreach ($werk as $eintrag) {
            foreach (($eintrag['gilt_fuer'] ?? []) as $j) { $jahre[] = (int)$j; }
        }
        sort($jahre);
        $jahre = array_values(array_unique($jahre));
        // Ab welchem Jahr ist nichts mehr erfasst? Nur vorwaerts gesucht --
        // ein Loch in der Vergangenheit ist eine andere Aussage und wuerde
        // hier faelschlich wie das Auslaufen aussehen.
        $fehltAb = null;
        if ($jahre) {
            $j = max($jahr, $jahre[0]);
            while (in_array($j, $jahre, true)) { $j++; }
            $fehltAb = $j;
        }
        return [
            'schluessel' => $sl,
            'bezeichnung' => $bez,
            'traegt' => $traegt,
            'erfasst' => $gilt !== null,
            'satz_text' => $gilt !== null ? $satzText($gilt) : null,
            'quelle' => $gilt['quelle'] ?? null,
            'jahre' => $jahre,
            'fehlt_ab' => $fehltAb,
        ];
    };

    return [
        $bau('ahv', 'AHV-, IV- und EO-Beitrag', LOHN_SV, 'je zur Haelfte',
            fn (array $r) => lohn_bp_text((int)$r['an_bp']) . ' vom AHV-pflichtigen Lohn'),
        $bau('alv', 'ALV-Beitrag', LOHN_ALV, 'je zur Haelfte',
            fn (array $r) => lohn_bp_text((int)$r['an_bp']) . ' bis '
                . number_format($r['hoechstbetrag_jahr_rappen'] / 100, 0, '.', "'")
                . ' Franken im Jahr; darueber kein Beitrag'),
        $bau('uvg', 'Unfallversicherung — Hoechstbetrag und NBU-Schwelle', LOHN_UVG,
            'Berufsunfall Arbeitgeber, Nichtberufsunfall Arbeitnehmer',
            fn (array $r) => number_format($r['hoechstbetrag_jahr_rappen'] / 100, 0, '.', "'")
                . ' Franken im Jahr, '
                . number_format($r['hoechstbetrag_tag_rappen'] / 100, 0, '.', "'")
                . ' Franken im Tag; NBU erst ab '
                . (int)$r['nbu_schwelle_std_woche'] . ' Wochenstunden'),
    ];
}

// Basispunkte als Prozenttext. Eine Stelle, damit 530 nicht an drei Orten
// verschieden formatiert wird.
function lohn_bp_text(int $bp): string
{
    return rtrim(rtrim(number_format($bp / 100, 2, '.', ''), '0'), '.') . ' %';
}

// Wer traegt welche Praemie -- Merkblatt 6.05 Ziff. 5.
//
//   "Sie tragen als Arbeitgeberin oder Arbeitgeber die Praemien fuer die
//    obligatorische Versicherung der Berufsunfaelle und Berufskrankheiten.
//    Die Arbeitnehmenden tragen die Praemien fuer die obligatorische
//    Versicherung der Nichtberufsunfaelle. Abweichende Abreden zugunsten
//    der Arbeitnehmenden bleiben vorbehalten."
//
// Der Berufsunfall erscheint darum NIE als Lohnabzug. Steht er je auf einer
// Abrechnung, ist das ein Fehler und keine Einstellungssache.
const LOHN_BU_TRAEGT  = 'arbeitgeber';
const LOHN_NBU_TRAEGT = 'arbeitnehmer';

// Ziff. 4: "Arbeitnehmende, deren woechentliche Arbeitszeit bei einem
// Arbeitgeber nicht mindestens acht Stunden betraegt, sind jedoch nur gegen
// Berufsunfaelle und Berufskrankheiten, nicht aber gegen Nichtberufsunfaelle
// versichert. [...] In diesem Fall gelten Unfaelle auf dem Arbeitsweg als
// Berufsunfaelle."
//
// WARUM DAS EINE EIGENE FUNKTION IST UND NICHT EIN BOOLEAN IRGENDWO:
// Der NBU-Abzug ist damit KEINE Konstante je Person. Wer in einer Woche
// sechs Stunden arbeitet, ist nicht gegen Nichtberufsunfaelle versichert --
// ein Abzug waere Geld, das dem Mitarbeitenden zusteht. Umgekehrt faellt ein
// fehlender Abzug dem Betrieb zur Last, denn die Praemie schuldet er nach
// Ziff. 5 ohnehin ganz.
//
// WAS HIER BEWUSST NICHT PASSIERT: aus 'pensum_stunden' rechnen. Dieses Feld
// ist ein JAHRESpensum (ENT-065, 1 bis 3000 Stunden). Es durch 52 zu teilen
// waere eine Auslegung -- bei unregelmaessigem Einsatz hat dieselbe Person
// Wochen mit zwanzig und Wochen mit null Stunden, und welche Zahl die
// "woechentliche Arbeitszeit" im Sinne des UVG ist, sagt das Merkblatt
// nicht. Ist sie nicht bekannt, wird GESPERRT statt geraten.
const LOHN_NBU_VERSICHERT = 'versichert';
const LOHN_NBU_NICHT      = 'nicht_versichert';
const LOHN_NBU_UNBEKANNT  = 'unbekannt';

function lohn_nbu_deckung(?float $stundenProWoche, array $uvg): array
{
    $schwelle = (int)$uvg['nbu_schwelle_std_woche'];
    // Eine Woche hat 168 Stunden. Ein hoeherer Wert ist keine Wochenarbeits-
    // zeit, sondern mit grosser Wahrscheinlichkeit ein JAHRESpensum, das an
    // der falschen Stelle hereingereicht wurde -- 'pensum_stunden' laeuft
    // nach ENT-065 von 1 bis 3000. Waere das nicht abgefangen, antwortete die
    // Funktion bei jedem Jahrespensum brav "versichert", und der NBU-Abzug
    // liefe auch fuer die Aushilfe mit vier Wochenstunden weiter. Darum:
    // unbekannt, mit Benennung des vermuteten Fehlers.
    if ($stundenProWoche !== null && $stundenProWoche > 168) {
        return ['stand' => LOHN_NBU_UNBEKANNT, 'schwelle' => $schwelle,
            'text' => 'Der uebergebene Wert ist keine woechentliche Arbeitszeit -- eine Woche '
                . 'hat 168 Stunden. Vermutlich wurde ein Jahrespensum uebergeben. '
                . 'Es wird keine Deckung gegen Nichtberufsunfaelle angenommen '
                . '(Merkblatt 6.05 Ziff. 4).'];
    }
    if ($stundenProWoche === null || $stundenProWoche < 0) {
        return ['stand' => LOHN_NBU_UNBEKANNT, 'schwelle' => $schwelle,
            'text' => 'Die woechentliche Arbeitszeit ist nicht bekannt. Ohne sie steht '
                . 'nicht fest, ob eine Deckung gegen Nichtberufsunfaelle besteht '
                . '(Merkblatt 6.05 Ziff. 4: mindestens ' . $schwelle . ' Stunden). '
                . 'Es wird kein NBU-Beitrag abgezogen und keine Deckung angenommen.'];
    }
    if ($stundenProWoche < $schwelle) {
        return ['stand' => LOHN_NBU_NICHT, 'schwelle' => $schwelle,
            'text' => 'Unter ' . $schwelle . ' Wochenstunden besteht keine Deckung gegen '
                . 'Nichtberufsunfaelle (Merkblatt 6.05 Ziff. 4). Es darf kein NBU-Beitrag '
                . 'abgezogen werden; Unfaelle auf dem Arbeitsweg gelten als Berufsunfaelle.'];
    }
    return ['stand' => LOHN_NBU_VERSICHERT, 'schwelle' => $schwelle,
        'text' => 'Ab ' . $schwelle . ' Wochenstunden besteht Deckung gegen '
            . 'Nichtberufsunfaelle (Merkblatt 6.05 Ziff. 4).'];
}

// ══════════════════════════════════════════════════════════════════════════
// NBU-UNTERSTELLUNG BEI UNREGELMAESSIGEM EINSATZ (ENT-451, Etappe 4).
//
// GRUNDLAGE, vom Projektinhaber am 2026-09-08 eingebracht: Bundesgericht
// 8C_644/2025 vom 25. Maerz 2026 und Empfehlung 7/87 der Ad-hoc-Kommission
// Schaden UVG. Danach ist das VERTRAGLICHE Pensum fuer die Acht-Stunden-
// Grenze nicht massgebend; es zaehlen die effektiv geleisteten Stunden im
// Durchschnitt ueber die letzten drei oder zwoelf Monate, und es gilt die
// fuer den Mitarbeitenden guenstigere Variante.
//
// NICHT VON MIR NACHGEPRUEFT: Beide Fundstellen waren aus der
// Arbeitsumgebung nicht erreichbar. Sie stehen hier als vom Projektinhaber
// belegte Grundlage, wie ein Eintrag im Auslegungsregister -- nicht als von
// mir verifiziertes Recht.
//
// Das Verfahren nach Empfehlung 7/87:
//   1. Durchschnittlich mindestens acht Stunden je Woche -> versichert.
//   2. ODER: die Wochen mit mindestens acht Stunden ueberwiegen gegenueber
//      den Wochen darunter -> ebenfalls versichert.
//   3. Ueberwiegen im Zeitraum die Wochen MIT Einsatz, fallen die
//      Nullstundenwochen aus der Durchschnittsrechnung.
//   4. Ueberwiegen sie nicht, zaehlen alle Kalenderwochen mit.
const LOHN_NBU_FENSTER_MONATE = [3, 12];

// Welche Variante ist "die guenstigere"? Die MIT Deckung -- aber NUR bei der
// Wahl zwischen drei und zwoelf Monaten.
//
// Grundlage ist Ziff. 1 der Empfehlung 7/87, vom Bundesgericht in
// 8C_644/2025 E. 3.3 wiedergegeben: "Die Berechnung erstreckt sich ueber die
// letzten drei oder zwoelf Monate vor dem Unfall, wobei die fuer den
// Versicherten guenstigere Variante zaehlt."
//
// ENGE GRENZE, ausdruecklich vom Bundesgericht gezogen (E. 5.5): Aus den
// Berechnungsregeln laesst sich NICHT der allgemeine Grundsatz ableiten,
// "es habe stets die fuer die versicherte Person guenstige Berechnungsweise
// zur Anwendung zu gelangen". Das liefe auf eine Aushebelung des Grundsatzes
// hinaus, dass bei Teilzeitbeschaeftigten nur unter Voraussetzungen Deckung
// besteht.
//
// Diese Konstante gilt darum AUSSCHLIESSLICH fuer die Fensterwahl. Wer sie
// je zu einem allgemeinen "im Zweifel fuer die Deckung" ausweitet, baut
// genau das ein, was das Urteil verwirft. Eine frueher hier stehende
// Begruendung ueber die Krankenkassen-Warnung in Merkblatt 6.05 war eine
// eigene Herleitung und ist entfernt -- die Empfehlung sagt es selbst.
const LOHN_NBU_GUENSTIGER = LOHN_NBU_VERSICHERT;

// Ziff. 4 der Empfehlung, vom Bundesgericht wiedergegeben: "Vorab zaehlen die
// effektiven Arbeitsstunden. Laesst sich damit keine Deckung fuer
// Nichtberufsunfaelle bewerkstelligen, werden tageweise Ausfallstunden wegen
// Unfall oder Krankheit durch die durchschnittliche taegliche Arbeitszeit --
// aufgerundet auf die naechste volle Stunde -- ergaenzt. Weitere
// Ergaenzungen, z.B. wegen Militaer, Feier- oder Urlaubstagen, sind nicht
// zulaessig."
//
// DIESE ZWEITE STUFE IST NICHT GERECHNET, und das ist eine bewusste Grenze:
// Woraus sich die "durchschnittliche taegliche Arbeitszeit" bemisst, sagt
// weder das Urteil noch Merkblatt 6.05. Sie zu erfinden waere eigenstaendige
// Auslegung an einer Stelle, die Deckung begruendet.
//
// WAS STATTDESSEN GESCHIEHT: Ergibt Stufe 1 keine Deckung UND liegen im
// Zeitraum Ausfalltage wegen Unfall oder Krankheit, lautet die Antwort
// 'pruefen' statt 'nicht_versichert'. Ohne das wuerde das Werkzeug eine
// Deckung verneinen, die nach Ziff. 4 bestehen koennte -- ein Fehler, der
// nirgends auffiele, weil ein fehlender Abzug keine Beschwerde ausloest.
const LOHN_NBU_PRUEFEN = 'pruefen';

// Ermittlung fuer EINEN Beobachtungszeitraum.
//
// $wochenStunden ist eine Liste geleisteter Stunden je Kalenderwoche,
// Nullwochen ausdruecklich eingeschlossen -- ohne sie waeren die Regeln 3
// und 4 nicht anwendbar.
//
// Eine leere Liste ergibt "unbekannt", nicht "nicht versichert". Das ist der
// Fall des Neueintritts ohne Stundenhistorie, und er ist offen (OP-473).
function lohn_nbu_ermittlung(array $wochenStunden, array $uvg, int $ausfalltage = 0): array
{
    $schwelle = (float)$uvg['nbu_schwelle_std_woche'];
    $total    = count($wochenStunden);
    if ($total === 0) {
        return ['stand' => LOHN_NBU_UNBEKANNT, 'schwelle' => $schwelle,
            'ausfalltage' => $ausfalltage,
            'wochen_total' => 0, 'arbeitswochen' => 0, 'nullwochen' => 0,
            'basis' => null, 'schnitt_std' => null,
            'wochen_ueber' => 0, 'wochen_unter' => 0,
            'ueber_schnitt' => false, 'ueber_mehrheit' => false,
            'text' => 'Keine Stundenhistorie im Beobachtungszeitraum. Ohne sie laesst sich '
                . 'die Unterstellung nach Empfehlung 7/87 nicht ermitteln.'];
    }

    $arbeitswochen = array_values(array_filter($wochenStunden, fn($h) => $h > 0));
    $nullwochen    = $total - count($arbeitswochen);

    // Regel 3 und 4: Nur wenn die Arbeitswochen ueberwiegen, fallen die
    // Nullwochen aus der Durchschnittsrechnung. Bei Gleichstand zaehlen alle
    // Wochen -- "ueberwiegen" heisst mehr, nicht gleich viel.
    $nurArbeitswochen = count($arbeitswochen) > $nullwochen;
    $basisWerte = $nurArbeitswochen ? $arbeitswochen : $wochenStunden;
    $schnitt    = array_sum($basisWerte) / count($basisWerte);

    // Regel 2 zaehlt IMMER ueber alle Kalenderwochen des Zeitraums -- sie ist
    // ein eigener Weg zur Deckung, keine Variante des Durchschnitts.
    $ueber = count(array_filter($wochenStunden, fn($h) => $h >= $schwelle));
    $unter = $total - $ueber;

    $ueberSchnitt   = $schnitt >= $schwelle;
    $ueberMehrheit  = $ueber > $unter;
    $versichert     = $ueberSchnitt || $ueberMehrheit;

    $wege = [];
    if ($ueberSchnitt)  { $wege[] = 'Durchschnitt ' . number_format($schnitt, 2, '.', "'") . ' Std.'; }
    if ($ueberMehrheit) { $wege[] = $ueber . ' von ' . $total . ' Wochen ab der Schwelle'; }

    // Stufe 2 nach Ziff. 4: nur wenn Stufe 1 keine Deckung ergibt UND es
    // ueberhaupt Ausfalltage wegen Unfall oder Krankheit gibt.
    $stand = $versichert ? LOHN_NBU_VERSICHERT
           : ($ausfalltage > 0 ? LOHN_NBU_PRUEFEN : LOHN_NBU_NICHT);

    return ['stand' => $stand,
        'ausfalltage' => $ausfalltage,
        'schwelle' => $schwelle,
        'wochen_total' => $total,
        'arbeitswochen' => count($arbeitswochen),
        'nullwochen' => $nullwochen,
        'basis' => $nurArbeitswochen ? 'nur_arbeitswochen' : 'alle_wochen',
        'schnitt_std' => round($schnitt, 4),
        'wochen_ueber' => $ueber, 'wochen_unter' => $unter,
        'ueber_schnitt' => $ueberSchnitt, 'ueber_mehrheit' => $ueberMehrheit,
        'text' => $versichert
            ? 'Versichert nach Empfehlung 7/87 (' . implode(', ', $wege) . ').'
            : ($stand === LOHN_NBU_PRUEFEN
            ? 'Die effektiven Stunden ergeben keine Deckung (Durchschnitt '
              . number_format($schnitt, 2, '.', "'") . ' Std.), aber im Zeitraum liegen '
              . $ausfalltage . ' Ausfalltage wegen Unfall oder Krankheit. Nach Ziff. 4 der '
              . 'Empfehlung 7/87 koennen sie ergaenzt werden; wie die durchschnittliche '
              . 'taegliche Arbeitszeit dafuer zu bemessen ist, ist nicht geklaert. '
              . 'Von Hand pruefen statt die Deckung zu verneinen.'
            : 'Nicht versichert: Durchschnitt ' . number_format($schnitt, 2, '.', "'")
              . ' Std. je Woche ueber ' . count($basisWerte) . ' Wochen'
              . ($nurArbeitswochen ? ' (Nullwochen ausgenommen, weil die Arbeitswochen ueberwiegen)'
                                   : ' (alle Kalenderwochen)')
              . ', und ' . $ueber . ' von ' . $total . ' Wochen erreichen die Schwelle.')];
}

// Die guenstigere der beiden Varianten (drei oder zwoelf Monate).
//
// $fenster ist eine Abbildung Monatszahl -> Ergebnis von
// lohn_nbu_ermittlung(). Reicht EINE Variante zur Deckung, gilt Deckung.
// Nur wenn KEINE reicht und mindestens eine ein belastbares Ergebnis hat,
// steht "nicht versichert" fest. Sind alle unbekannt, bleibt es unbekannt.
function lohn_nbu_unterstellung(array $fenster, array $uvg): array
{
    $guenstig = null; $belastbar = false;
    foreach ($fenster as $monate => $e) {
        if ($e['stand'] === LOHN_NBU_UNBEKANNT) { continue; }
        $belastbar = true;
        if ($e['stand'] === LOHN_NBU_GUENSTIGER) { $guenstig = $monate; break; }
    }
    if ($guenstig !== null) {
        return ['stand' => LOHN_NBU_VERSICHERT, 'entschieden_durch' => (int)$guenstig,
            'fenster' => $fenster,
            'text' => 'Versichert aufgrund der guenstigeren Variante ueber ' . $guenstig
                . ' Monate. ' . $fenster[$guenstig]['text']];
    }
    if (!$belastbar) {
        return ['stand' => LOHN_NBU_UNBEKANNT, 'entschieden_durch' => null,
            'fenster' => $fenster,
            'text' => 'Keine der Varianten liefert ein Ergebnis -- keine Stundenhistorie. '
                . 'Der Fall des Neueintritts ist nicht entschieden (OP-473).'];
    }
    // Sagt eine Variante 'pruefen', darf die andere sie nicht ueberstimmen:
    // 'nicht versichert' waere dann eine Antwort, die Ziff. 4 noch offen hat.
    foreach ($fenster as $monate => $e) {
        if ($e['stand'] === LOHN_NBU_PRUEFEN) {
            return ['stand' => LOHN_NBU_PRUEFEN, 'entschieden_durch' => (int)$monate,
                'fenster' => $fenster, 'text' => $e['text']];
        }
    }
    $erste = null;
    foreach ($fenster as $monate => $e) {
        if ($e['stand'] !== LOHN_NBU_UNBEKANNT) { $erste = $monate; break; }
    }
    return ['stand' => LOHN_NBU_NICHT, 'entschieden_durch' => (int)$erste,
        'fenster' => $fenster,
        'text' => 'Keine der geprueften Varianten ergibt eine Deckung. '
            . $fenster[$erste]['text']];
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
// Traegt diese Lohnart einen Betrag der Abrechnungsperiode? Eigene Funktion
// statt einer Spaltennummer im Aufrufer -- wer [13] schreibt, merkt beim
// naechsten Feld nichts davon.
function lohnart_ist_bemessung(array $zeile): bool
{
    return (int)($zeile[13] ?? 0) === 1;
}

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
    //  ahv, ferien, ml13, bvg, uvg, qst, gav_grundlage, sortierung, bemessung]
    //
    // BEMESSUNG ist die letzte Spalte und beantwortet eine andere Frage als
    // die sechs Kennzeichen davor. Die sechs sagen, in WELCHE Grundlage ein
    // Betrag zaehlt. 'bemessung' sagt, OB die Zeile ueberhaupt einen Betrag
    // der Abrechnungsperiode traegt.
    //
    // WARUM DAS NOETIG WURDE -- ein Fehler, der beim Bauen der Abzugsseite
    // auffiel und sonst live gegangen waere: Grundlohn, Ferienentschaedigung
    // und 13.-Anteil sind STUNDENSAETZE, ihre Betraege sind Bestandteile
    // eines Stundenlohns. Sie tragen alle das Kennzeichen ahv_pflichtig --
    // richtig, denn der daraus gebildete Stundenlohn IST AHV-pflichtig.
    // Summiert man aber alle Zeilen mit diesem Kennzeichen, zaehlt man den
    // Stundenlohn ZWEIMAL: einmal als Bestandteile und einmal in
    // 'geleistete_stunden', wo er mit den Stunden multipliziert steht.
    // Am Referenzbeispiel: 32 076 statt 29 160 Rappen -- zehn Prozent zu
    // hoch, und jeder Abzug entsprechend zu gross, zulasten des
    // Mitarbeitenden. Das Feld 'art' half nicht: 'grundlohn_stunde' und
    // 'geleistete_stunden' sind BEIDE 'stundensatz'.
    return [
        ['grundlohn_stunde', 'Grundlohn pro Stunde', 'stundensatz', null, null,
         1,1,1,1,1,1, 'Art. 16 i.V.m. Anhang 1 GAV', 10, 0],
        ['grundlohn_monat', 'Monatslohn', 'monatslohn', null, null,
         1,0,1,1,1,1, 'Art. 16 i.V.m. Anhang 1 GAV', 11, 1],
        // Traegt selbst keine Ferienentschaedigung und keinen 13.
        // Monatslohn -- sonst rechnete sich ein Zuschlag auf einen
        // Zuschlag. Der Satz steht bewusst nicht hier: Er wird nach
        // Art. 20 Ziff. 2 aus dem Alter abgeleitet.
        ['ferienentschaedigung', 'Ferienentschädigung', 'prozent', 'grundlohn', null,
         1,0,0,1,1,1, 'Art. 20 Ziff. 2 GAV', 20, 0],
        // KEINE GAV-Pflicht -- der Vertrag kennt den 13. Monatslohn nur in
        // Art. 25 Ziff. 2 als Bestandteil der BVG-Bemessung. Darum steht
        // bei der Grundlage nichts, und das ist eine Aussage.
        ['anteil_13ml', 'Anteil 13. Monatslohn', 'prozent', 'grundlohn', null,
         1,0,0,1,1,1, null, 21, 0],
        // Eine ZWISCHENSUMME, kein Lohnbestandteil: Sie fasst Grundlohn,
        // Ferienentschaedigung und 13.-Anteil zusammen und wird danach mit
        // den Stunden multipliziert. Zaehlt in KEINE Bemessungsgrundlage --
        // sonst staende derselbe Lohn zweimal darin.
        ['brutto_stundenlohn', 'Brutto Stundenlohn', 'zwischensumme', null, null,
         0,0,0,0,0,0, 'Art. 16 i.V.m. Art. 20 Ziff. 2 GAV', 25, 0],
        // DIE Zeile mit dem tatsaechlichen Lohnbetrag. Nicht ferien- und
        // nicht 13.-ML-pflichtig: Beide stecken bereits im
        // Bruttostundenlohn. Waeren sie hier gesetzt, gaebe es
        // Ferienentschaedigung auf die Ferienentschaedigung.
        ['geleistete_stunden', 'Total geleistete Stunden', 'stundensatz', null, null,
         1,0,0,1,1,1, 'Art. 12 Ziff. 2 GAV', 30, 1],
        ['zuschlag_fachausweis', 'Zuschlag Fachausweis', 'stundensatz', null, null,
         1,1,1,1,1,1, 'Art. 19 Ziff. 1 GAV', 31, 1],
        ['zuschlag_hund', 'Zuschlag Diensthund', 'stundensatz', null, null,
         1,1,1,1,1,1, 'Art. 19 Ziff. 2 GAV', 32, 1],
        ['zuschlag_waffe', 'Zuschlag Schusswaffe', 'stundensatz', null, null,
         1,1,1,1,1,1, 'Art. 19 Ziff. 3 GAV', 33, 1],
        ['zeitzuschlag', 'Zeitzuschlag über 210 Stunden', 'prozent', 'grundlohn', 2500,
         1,1,1,1,1,1, 'Art. 14 Ziff. 3 GAV', 35, 1],
        // Auslagenersatz ist KEIN Lohn: nicht AHV-pflichtig, in keiner
        // Bemessungsgrundlage. Nach GAV-AUS-009 gehoert er in eine
        // getrennte Spesenabrechnung nach Art. 18 Ziff. 10 -- nicht in die
        // Arbeitszeitabrechnung nach Art. 12 Ziff. 5.
        ['auslagenersatz', 'Auslagenersatz', 'netto', null, null,
         0,0,0,0,0,0, 'Art. 18 GAV', 40, 0],
        // Abzuege. Ihre SAETZE stehen in lohn_abzug mit
        // Gueltigkeitszeitraum -- hier steht nur, dass es die Zeile gibt.
        ['ahv', 'AHV-, IV-, EO-Beitrag', 'abzug', 'ahv_brutto', null,
         0,0,0,0,0,0, null, 50, 0],
        ['alv', 'ALV-Beitrag', 'abzug', 'ahv_brutto', null,
         0,0,0,0,0,0, null, 51, 0],
        ['nbu', 'NBU-Beitrag', 'abzug', 'uvg_brutto', null,
         0,0,0,0,0,0, null, 52, 0],
        ['ktg', 'Krankentaggeld-Beitrag', 'abzug', 'ahv_brutto', null,
         0,0,0,0,0,0, 'Art. 17 Ziff. 3 GAV', 53, 0],
        ['bvg', 'BVG-Beitrag', 'abzug', null, null,
         0,0,0,0,0,0, 'Art. 25 GAV', 54, 0],
        // Art. 6 Ziff. 2 verlangt ausdruecklich, dass dieser Abzug "bei der
        // Lohnabrechnung aufzufuehren" ist -- er darf nie stillschweigend
        // im Nettolohn verschwinden.
        ['pako', 'Vollzugskostenbeitrag PaKo', 'abzug', null, null,
         0,0,0,0,0,0, 'Art. 6 Ziff. 2 GAV', 55, 0],
        ['quellensteuer', 'Quellensteuer', 'abzug', 'qst_brutto', null,
         0,0,0,0,0,0, null, 56, 0],
        // ── Abschlusszeilen ──────────────────────────────────────────────
        // Sie ENTSTEHEN im Lauf und standen bis 2026-09-08 nicht im Katalog.
        // Die Kreuzpruefung, die genau das verhindern soll, sah nur die
        // Bruttozeilen -- das Sicherheitsnetz war nicht auf den neuen Teil
        // mitgezogen worden. Dieselbe Fehlerfamilie wie beim ersten Mal.
        //
        // Alle drei zaehlen in KEINE Bemessungsgrundlage und tragen keinen
        // Periodenbetrag: Sie fassen zusammen, was schon gezaehlt ist.
        ['nettolohn', 'Nettolohn', 'zwischensumme', null, null,
         0,0,0,0,0,0, null, 60, 0],
        // Entsteht nur, wenn die Rundung des Auszahlungsbetrags auf 5 Rappen
        // ueberhaupt eine Differenz ergibt. Der Projektinhaber am
        // 2026-09-08: eigene Zeile statt stillschweigend im Betrag.
        // Art. 12 Ziff. 5 verlangt eine nachvollziehbare Abrechnung -- ohne
        // diese Zeile ginge "Nettolohn minus PaKo = Auszahlung" auf dem
        // Papier um bis zu zwei Rappen nicht auf, und niemand koennte sagen
        // warum.
        ['rundungsdifferenz', 'Rundung auf 5 Rappen', 'fixbetrag', null, null,
         0,0,0,0,0,0, null, 65, 0],
        ['auszahlung', 'Auszahlungsbetrag', 'zwischensumme', null, null,
         0,0,0,0,0,0, null, 70, 0],
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
