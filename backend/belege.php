<?php
declare(strict_types=1);
// Belege: Offerten heute, Rechnungen spaeter (ENT-181).
//
// Bindet die gemeinsame Mailgestaltung ein (ENT-674): beleg_mail() weiter
// unten baut die Versandmail aus denselben Bausteinen wie die Demo-Mail.
// Jedes Buendel, das diese Datei bekommt, bekommt auch mail_vorlage.php --
// test_deploy.mjs haelt die beiden zusammen.
//
// Die EINZIGE Stelle, die aus Positionen einen Frankenbetrag macht --
// dieselbe Haltung wie auslagen.php (ENT-125): Was auf einem Dokument steht,
// das an einen Kunden geht, wird auf dem Server gerechnet. Der Browser
// rechnet dieselbe Formel ein zweites Mal, aber nur fuer die Live-Anzeige
// beim Erfassen; massgeblich ist immer diese Datei.
//
// ZWEI-SPRACHEN-RISIKO bewusst eingegangen, nicht uebersehen: belegSummen()
// in dashboard.html muss dieselben Zahlen liefern wie beleg_summen() hier.
// test_belege.mjs prueft beide gegen dieselben Faelle -- weicht eine der
// beiden ab, wird die Suite rot. Aendert jemand die Formel, gehoert sie an
// BEIDEN Stellen geaendert.
//
// ALLES IN RAPPEN, ganzzahlig. Franken mit Nachkommastellen summieren sich
// ueber viele Positionen zu Rundungsdrift; Rappen nicht. Prozentsaetze
// ebenfalls ganzzahlig, in Basispunkten (Hundertstel-Prozent): 8.10 % = 810,
// 7 % = 700, 0 % = 0. Damit ist auch der MWST-Satz exakt darstellbar, was
// er als Fliesskommazahl nicht waere.

// Wieviel Nachkommastellen die Menge fuehrt. Auch sie wird intern
// ganzzahlig gerechnet (70.00 -> 7000), damit 0.1 * 4200 nicht als
// 420.00000000000006 durch die Rechnung laeuft.
require_once __DIR__ . '/mail_vorlage.php';

const BELEG_MENGE_FAKTOR = 100;

// Die Belegarten. 'offerte' ist heute die einzige gebaute; 'rechnung' steht
// hier, weil die Nummernvergabe und die Summenrechnung von Anfang an fuer
// beide gelten sollen (ENT-181) -- nicht als Ankuendigung, dass es sie schon
// gaebe.
// datum_label steht hier und wird nicht aus dem Titel zusammengesetzt:
// "Offerte" + "datum" ergibt "Offertedatum", "Rechnung" + "datum" ergibt
// "Rechnungdatum" -- beides falsch, und beides stand so auf den
// oeffentlichen Seiten, die der Empfaenger am Link sieht. Das Fugen-n
// laesst sich nicht rechnen, also steht das Wort da.
// frist_feld/frist_label stehen aus demselben Grund hier wie datum_label:
// Eine Offerte ist "Gültig bis", eine Rechnung "Fällig bis" -- zwei Woerter,
// zwei Spalten, und beides laesst sich aus der Art nicht rechnen. Ein
// leeres frist_feld heisst: Diese Art fuehrt keine Frist (ENT-674).
const BELEG_ARTEN = [
    'offerte'  => ['praefix' => 'OF', 'titel' => 'Offerte',
                   'datum_label' => 'Offertendatum', 'nummer_label' => 'Offertennummer',
                   'frist_feld' => 'gueltig_bis', 'frist_label' => 'Gültig bis'],
    'rechnung' => ['praefix' => 'RE', 'titel' => 'Rechnung',
                   'datum_label' => 'Rechnungsdatum', 'nummer_label' => 'Rechnungsnummer',
                   'frist_feld' => 'faellig_bis', 'frist_label' => 'Fällig bis'],
    // Dritte Art seit ENT-637. Sie erbt Versand, oeffentliche Ansicht und
    // Annahme unveraendert -- die unterscheiden die Art gar nicht. Was sie
    // zusaetzlich hat, ist eine Laufzeit und ein Preis je Periode.
    //
    // NUR AUF DER BETREIBER-SEITE: Die Tabelle `belege` des Mandanten kennt
    // den Wert in ihrem ENUM nicht, dort laesst sich also kein Vertrag
    // ablegen. Ob eine Sicherheitsfirma ihren eigenen Kunden Vertraege
    // schreiben soll, ist eine eigene Frage und nicht entschieden.
    // Der Vertrag fuehrt bewusst KEINE Frist in der Mail: Seine Laufzeit ist
    // etwas anderes als eine Antwort- oder Zahlungsfrist und steht mit Beginn,
    // Ende und Kuendigungsfrist auf dem Dokument selbst (ENT-637). Ein
    // einzelnes Datum daraus waere im Postfach die halbe Auskunft.
    'vertrag'  => ['praefix' => 'VE', 'titel' => 'Vertrag',
                   'datum_label' => 'Vertragsdatum', 'nummer_label' => 'Vertragsnummer',
                   'frist_feld' => '', 'frist_label' => ''],
];

// Wie oft eine Position anfaellt (ENT-637). Eine Einrichtungsgebuehr faellt
// einmal an, eine Grundgebuehr jeden Monat -- das sind zwei Einheiten, und
// sie duerfen nie unter einer Summe stehen (Hausregel: Einheiten nie
// vermischen). Darum rechnet ein Vertrag je Periode eine eigene Summe.
//
// Offerte und Rechnung kennen nur 'einmalig'. Das ist auch der Vorgabewert
// der Spalte, darum aendert sich fuer sie nichts.
//
// KEINE UMRECHNUNG zwischen den Perioden. Zwoelf Monatsgebuehren sind nicht
// dasselbe wie eine Jahresgebuehr -- wer unterjaehrig aussteigt, zahlt
// anders. Was der Vertrag sagt, bleibt stehen, wie es dasteht.
const BELEG_PERIODEN = [
    'einmalig'  => ['titel' => 'einmalig',   'zusatz' => ''],
    'monatlich' => ['titel' => 'pro Monat',  'zusatz' => 'pro Monat'],
    'jaehrlich' => ['titel' => 'pro Jahr',   'zusatz' => 'pro Jahr'],
];

// Die Status einer Offerte. Bewusst von Hand gesetzt, auch 'angeschaut':
// Ohne Kundenportal kann das System nicht wissen, ob jemand die Offerte
// geoeffnet hat -- eine automatisch gesetzte Lesebestaetigung waere eine
// Behauptung. 'abgelehnt' und 'bestaetigt' sind die beiden Endpunkte.
const BELEG_STATUS = ['entwurf', 'versendet', 'angeschaut', 'bestaetigt', 'abgelehnt'];

// ── Zwei Tabellensaetze, EINE Rechnung (ENT-605) ──────────────────────────
//
// Der Mandant schreibt seine Offerten an `belege`/`beleg_positionen`, die
// Betreiberin ihre an `be_belege`/`be_beleg_positionen`. Getrennte Tabellen
// sind hier keine Vorsicht, sondern Pflicht: Solange die vier
// Betreiber-Secrets nicht gesetzt sind, zeigt betreiber_db() auf DIESELBE
// Datenbank wie db() (Kopf von betreiber.php, OP-518). Gleiche Tabellennamen
// hiessen dann: Die Offerten der Betreiberin stuenden in der Offertenliste
// des Mandanten, und beide teilten sich die Nummernreihe ab OF-0001.
//
// Warum trotzdem nur EINE Rechenstelle: Was auf einem Beleg steht, wird an
// genau einem Ort gerechnet. Eine zweite Kopie dieser Datei waere die Stelle,
// an der die beiden Seiten in einem Jahr um einen Rappen auseinanderliegen --
// und test_belege.mjs prueft eine Formel, nicht zwei.
//
// Der Praefix ist IMMER ein Literal aus dem aufrufenden Endpunkt, nie ein
// Wert aus einer Anfrage. Diese Liste ist die Wache dafuer: Ein Tabellenname
// laesst sich nicht als Platzhalter binden, er landet als Text in der
// Abfrage -- also darf er nur aus einer geschlossenen Menge stammen.
const BELEG_TABELLENSAETZE = ['', 'be_'];

function beleg_tabelle(string $praefix, string $name): string
{
    if (!in_array($praefix, BELEG_TABELLENSAETZE, true)) {
        throw new InvalidArgumentException('Unbekannter Tabellensatz');
    }
    return $praefix . $name;
}

function beleg_art_gueltig(string $art): bool
{
    return array_key_exists($art, BELEG_ARTEN);
}

function beleg_periode_gueltig(string $periode): bool
{
    return array_key_exists($periode, BELEG_PERIODEN);
}

// Der Zusatz hinter einem Betrag: "pro Monat", "pro Jahr" -- und bei
// 'einmalig' ABSICHTLICH nichts. Auf einer Offerte hiesse "Total einmalig"
// nichts; dort ist alles einmalig, und der Zusatz wuerde eine
// Unterscheidung behaupten, die es auf dem Blatt gar nicht gibt.
function beleg_periode_zusatz(string $periode): string
{
    return (string)(BELEG_PERIODEN[$periode]['zusatz'] ?? '');
}

function beleg_status_gueltig(string $status): bool
{
    return in_array($status, BELEG_STATUS, true);
}

// Naechste freie Belegnummer, Format OF-0001 aufwaerts. Aus dem bestehenden
// Hoechststand abgeleitet statt aus einem eigenen Zaehler -- gleiches Muster
// wie naechste_kundennummer() in kunden.php, aus demselben Grund: kein
// zweiter Zaehler, der aus dem Tritt geraten kann.
//
// Je Belegart ein eigener Zaehler: Offerten und Rechnungen zaehlen
// unabhaengig, sonst haette die erste Rechnung eine Nummer, die aussieht,
// als fehlten neunzig Rechnungen davor.
function beleg_naechste_nummer(PDO $pdo, string $art, string $tabPraefix = ''): string
{
    $praefix = BELEG_ARTEN[$art]['praefix'] ?? null;
    if ($praefix === null) { throw new InvalidArgumentException('Unbekannte Belegart'); }
    $tab = beleg_tabelle($tabPraefix, 'belege');
    $s = $pdo->prepare(
        "SELECT nummer FROM {$tab}
          WHERE art = ? AND nummer REGEXP ?
          ORDER BY CAST(SUBSTRING(nummer, 4) AS UNSIGNED) DESC LIMIT 1"
    );
    $s->execute([$art, '^' . $praefix . '-[0-9]{4}$']);
    $letzte = $s->fetchColumn();
    $n = $letzte ? ((int)substr((string)$letzte, 3)) + 1 : 1;
    return $praefix . '-' . str_pad((string)$n, 4, '0', STR_PAD_LEFT);
}

// Kaufmaennisch runden, halbe Rappen weg von der Null. PHP round() tut das
// bereits; die eigene Funktion existiert, damit die Absicht im Code steht
// und JS (Math.round rundet halbe Werte zur groesseren Zahl, nicht weg von
// der Null) sichtbar dieselbe Regel bekommt.
function beleg_runden(float $wert): int
{
    return (int)round($wert, 0, PHP_ROUND_HALF_UP);
}

// Schweizer Rappenrundung auf 5 Rappen. So rechnet das bisher verwendete
// Fremdsystem, und so steht es auf den bereits verschickten Offerten
// (Zeile "Rundungsdifferenz") -- uebernommen, nicht neu erfunden.
function beleg_rappen_runden(int $rappen): int
{
    return (int)(round($rappen / 5, 0, PHP_ROUND_HALF_UP) * 5);
}

// ── Der Rechenkern ────────────────────────────────────────────────────────
//
// Reihenfolge, abgeleitet aus einer bereits verschickten Offerte (OF-0093)
// und dort auf den Rappen genau nachgerechnet:
//
//   1. Je Position:  Menge x Einzelpreis            = Bruttobetrag
//   2. Je Position:  minus Positionsrabatt
//   3. Summe daraus                                 = Zwischensumme
//   4. Gesamtrabatt, ANTEILIG auf jede Position verteilt
//   5. MWST je Satz auf den so rabattierten Betraegen
//   6. Total, gerundet auf 5 Rappen, Differenz ausgewiesen
//
// WARUM DER GESAMTRABATT ANTEILIG VERTEILT WIRD und nicht einfach von der
// Zwischensumme abgezogen: Die Positionen tragen unterschiedliche
// MWST-Saetze (Verkehrsdienst 8.1 %, Auslagenersatz 0 %). Zoege man den
// Rabatt nur von der Summe ab, stuende nicht mehr fest, wieviel davon auf
// die steuerpflichtige und wieviel auf die steuerfreie Position entfaellt --
// und damit auch die MWST-Grundlage nicht.
//
// Der ausgewiesene Gesamtrabatt ist die SUMME der verteilten Anteile, nicht
// der gerundete Prozentsatz der Zwischensumme. Beides kann sich um einen
// Rappen unterscheiden; massgeblich ist die Summe der Anteile, sonst geht
// die Rechnung auf dem Papier nicht auf.
function beleg_summen(array $positionen, int $rabattBp = 0): array
{
    if ($rabattBp < 0) { $rabattBp = 0; }

    $zeilen = [];
    $zwischensumme = 0;

    foreach ($positionen as $p) {
        $mengeGanz  = beleg_runden((float)($p['menge'] ?? 0) * BELEG_MENGE_FAKTOR);
        $einzelpreis = (int)($p['einzelpreis_rappen'] ?? 0);
        $posRabattBp = max(0, (int)($p['rabatt_bp'] ?? 0));
        $satzBp      = max(0, (int)($p['mwst_satz_bp'] ?? 0));

        $brutto     = beleg_runden($mengeGanz * $einzelpreis / BELEG_MENGE_FAKTOR);
        $posRabatt  = beleg_runden($brutto * $posRabattBp / 10000);
        $netto      = $brutto - $posRabatt;

        $zeilen[] = [
            'brutto_rappen'      => $brutto,
            'pos_rabatt_rappen'  => $posRabatt,
            'zwischen_rappen'    => $netto,
            'mwst_satz_bp'       => $satzBp,
        ];
        $zwischensumme += $netto;
    }

    // Schritt 4: Gesamtrabatt anteilig -- je Position aus IHREM Betrag, nicht
    // aus der Summe (siehe Begruendung oben).
    $rabattTotal = 0;
    foreach ($zeilen as $i => $z) {
        $anteil = beleg_runden($z['zwischen_rappen'] * $rabattBp / 10000);
        $zeilen[$i]['gesamt_rabatt_rappen'] = $anteil;
        $zeilen[$i]['netto_rappen']         = $z['zwischen_rappen'] - $anteil;
        $rabattTotal += $anteil;
    }
    $netto = $zwischensumme - $rabattTotal;

    // Schritt 5: MWST je SATZ, nicht je Position -- sonst wuerde bei mehreren
    // Positionen desselben Satzes mehrfach gerundet, und die Summe stimmte
    // nicht mit dem ueberein, was auf einer MWST-Abrechnung stuende.
    $grundlagen = [];
    foreach ($zeilen as $z) {
        $satz = $z['mwst_satz_bp'];
        $grundlagen[$satz] = ($grundlagen[$satz] ?? 0) + $z['netto_rappen'];
    }
    krsort($grundlagen);   // hoechster Satz zuerst, stabile Reihenfolge

    $mwstZeilen = [];
    $mwstTotal  = 0;
    foreach ($grundlagen as $satz => $grundlage) {
        if ($satz === 0) { continue; }   // steuerfrei: keine Zeile, kein Betrag
        $betrag = beleg_runden($grundlage * $satz / 10000);
        $mwstZeilen[] = [
            'satz_bp'           => (int)$satz,
            'grundlage_rappen'  => $grundlage,
            'betrag_rappen'     => $betrag,
        ];
        $mwstTotal += $betrag;
    }

    // Schritt 6
    $vorRundung = $netto + $mwstTotal;
    $total      = beleg_rappen_runden($vorRundung);

    return [
        'zeilen'               => $zeilen,
        'zwischensumme_rappen' => $zwischensumme,
        'rabatt_bp'            => $rabattBp,
        'rabatt_rappen'        => $rabattTotal,
        'netto_rappen'         => $netto,
        'mwst'                 => $mwstZeilen,
        'mwst_rappen'          => $mwstTotal,
        'rundung_rappen'       => $total - $vorRundung,
        'total_rappen'         => $total,
    ];
}

// Ein Vertrag rechnet JE PERIODE eine eigene Summe (ENT-637) -- mit
// derselben Funktion oben, nur dreimal aufgerufen. Kein zweiter Rechenkern:
// Eine Gruppe gleichartiger Positionen rechnet sich genau so wie eine
// Offerte, und test_belege.mjs prueft weiterhin eine Formel.
//
// WARUM KEINE GESAMTSUMME herausfaellt: "Total CHF 4'800" ueber einer
// Mischung aus einmaliger Einrichtung und Monatsgebuehr ist eine Zahl, die
// niemand bezahlt. Leere Perioden stehen gar nicht erst in der Antwort --
// ein Block "einmalig CHF 0.00" saehe aus wie ein Preis, nicht wie eine
// fehlende Zeile.
//
// Der Gesamtrabatt gilt in jeder Periode. Zehn Prozent auf einen Vertrag
// heissen zehn Prozent auf die Einrichtung und zehn Prozent auf die
// Monatsgebuehr; alles andere muesste der Vertrag ausschreiben.
function beleg_summen_perioden(array $positionen, int $rabattBp = 0): array
{
    $gruppen = [];
    foreach ($positionen as $p) {
        $periode = (string)($p['periode'] ?? 'einmalig');
        if (!beleg_periode_gueltig($periode)) { $periode = 'einmalig'; }
        $gruppen[$periode][] = $p;
    }
    // Reihenfolge aus BELEG_PERIODEN, nicht aus der Eingabe: Auf dem
    // Dokument steht immer zuerst, was sofort faellig wird.
    $raus = [];
    foreach (array_keys(BELEG_PERIODEN) as $periode) {
        if (empty($gruppen[$periode])) { continue; }
        $raus[$periode] = beleg_summen($gruppen[$periode], $rabattBp);
    }
    return $raus;
}

// Traegt dieser Beleg wiederkehrende Positionen? Getrennt beantwortbar, weil
// die Oberflaeche daran entscheidet, ob sie ueberhaupt von "pro Monat"
// spricht.
function beleg_hat_wiederkehrend(array $perioden): bool
{
    foreach ($perioden as $periode => $s) {
        if ($periode !== 'einmalig') { return true; }
    }
    return false;
}

// ══════════════════════════════════════════════════════════════════════════
// Datenbankteil
// ══════════════════════════════════════════════════════════════════════════

// Eine Positionszeile aus fremder Eingabe in einen sauberen Datensatz.
// ALLES wird hier begrenzt und ganzzahlig gemacht -- was von aussen kommt,
// darf nirgends ungeprueft in die Rechnung.
//
// produkt_id ist nur ein Rueckverweis. Name, Preis, Einheit und Satz kommen
// als KOPIE mit: Sie sind der Stand zum Zeitpunkt des Erfassens, nicht der
// heutige Stand des Produkts (siehe Snapshot-Regel im Kopf dieser Datei).
function beleg_position_lesen(array $p): array
{
    $ganz = static function ($wert, int $min, int $max): int {
        $n = (int)round((float)$wert);
        return max($min, min($max, $n));
    };
    // Menge auf zwei Nachkommastellen, nie negativ. Die Obergrenze ist
    // grosszuegig, aber vorhanden -- eine Million Stunden auf einer Offerte
    // ist ein Tippfehler, kein Auftrag.
    $menge = max(0, min(99999999, (float)($p['menge'] ?? 1)));
    return [
        'produkt_id'         => ($p['produkt_id'] ?? null) ? (int)$p['produkt_id'] : null,
        'produkt_name'       => mb_substr(trim((string)($p['produkt_name'] ?? '')), 0, 200),
        'beschreibung'       => trim((string)($p['beschreibung'] ?? '')),
        'menge'              => round($menge, 2),
        'einheit'            => mb_substr(trim((string)($p['einheit'] ?? 'Std.')), 0, 20),
        'einzelpreis_rappen' => $ganz($p['einzelpreis_rappen'] ?? 0, -99999999, 99999999),
        // 10000 Basispunkte = 100 %. Mehr waere ein negativer Preis auf
        // Umwegen; weniger als 0 ein Zuschlag, der so nicht heissen darf.
        'rabatt_bp'          => $ganz($p['rabatt_bp'] ?? 0, 0, 10000),
        'mwst_satz_bp'       => $ganz($p['mwst_satz_bp'] ?? 0, 0, 10000),
        // Eine unbekannte Periode wird NICHT stillschweigend zu 'einmalig'
        // gebogen, wenn sie ueberhaupt genannt wurde -- sonst stuende auf dem
        // Vertrag eine Abmachung, die niemand getroffen hat. Nur das FEHLENDE
        // Feld gilt als 'einmalig', und das ist die Offerte.
        'periode'            => beleg_periode_gueltig((string)($p['periode'] ?? 'einmalig'))
                                ? (string)($p['periode'] ?? 'einmalig')
                                : 'einmalig',
    ];
}

// Gibt es die Periodenspalte schon? Sie kommt ueber die Einrichtung nach
// (ENT-637), und zwischen Deploy und Einrichtungslauf gibt es sie nicht.
// Eine Abfrage, die sie dann nennt, bricht mit einem SQL-Fehler ab -- und
// machte aus einer fehlenden Spalte eine unbenutzbare Offertenliste.
//
// Gemerkt je Tabellensatz: Der Aufruf kommt in jeder Belegzeile vor.
// EIGENE PRUEFUNG STATT DER AUS db.php: Diese Datei ist der Rechenkern und
// wird auch dort geladen, wo db.php nicht danebensteht --
// pruef_offerten_betreiber.php faehrt sie mit einer eigenen Verbindung. Eine
// Abhaengigkeit auf db.php waere genau die Art Kopplung, die den Rechenkern
// unpruefbar macht.
//
// Gemerkt je Tabelle und Spalte: Der Aufruf kommt in jeder Belegzeile vor.
function beleg_spalte_da(PDO $pdo, string $tabelle, string $spalte): bool
{
    static $gemerkt = [];
    $schluessel = $tabelle . '.' . $spalte;
    if (!array_key_exists($schluessel, $gemerkt)) {
        try {
            $s = $pdo->prepare("SHOW COLUMNS FROM {$tabelle} LIKE ?");
            $s->execute([$spalte]);
            $gemerkt[$schluessel] = $s->fetch() !== false;
        } catch (Throwable $e) {
            // Gibt es die Tabelle gar nicht, gibt es auch die Spalte nicht.
            $gemerkt[$schluessel] = false;
        }
    }
    return $gemerkt[$schluessel];
}

function beleg_periode_spalte_da(PDO $pdo, string $tabPraefix = ''): bool
{
    return beleg_spalte_da($pdo, beleg_tabelle($tabPraefix, 'beleg_positionen'), 'periode');
}

function beleg_positionen_lesen(PDO $pdo, int $belegId, string $tabPraefix = ''): array
{
    $tab = beleg_tabelle($tabPraefix, 'beleg_positionen');
    $periodeDa = beleg_periode_spalte_da($pdo, $tabPraefix);
    $s = $pdo->prepare(
        "SELECT id, sortierung, produkt_id, produkt_name, beschreibung, menge,
                einheit, einzelpreis_rappen, rabatt_bp, mwst_satz_bp"
        . ($periodeDa ? ', periode' : '') . "
           FROM {$tab} WHERE beleg_id = ? ORDER BY sortierung, id"
    );
    $s->execute([$belegId]);
    $zeilen = $s->fetchAll();
    // Fehlt die Spalte, traegt jede Zeile trotzdem eine Periode -- 'einmalig'
    // ist die Aussage der Anlage vor ENT-637 und keine Annahme.
    if (!$periodeDa) {
        foreach ($zeilen as $i => $z) { $zeilen[$i]['periode'] = 'einmalig'; }
    }
    return $zeilen;
}

// Positionen ersetzen: erst alle weg, dann neu schreiben. Ein Abgleich Zeile
// fuer Zeile waere aufwendiger und braechte nichts -- eine Position hat
// ausserhalb ihres Belegs keine Identitaet, auf die etwas verweist.
// Gehoert IMMER in dieselbe Transaktion wie beleg_summen_schreiben(), sonst
// stuenden Positionen und Summen fuer einen Moment im Widerspruch.
function beleg_positionen_schreiben(PDO $pdo, int $belegId, array $positionen,
                                    string $tabPraefix = ''): void
{
    $tab = beleg_tabelle($tabPraefix, 'beleg_positionen');
    $periodeDa = beleg_periode_spalte_da($pdo, $tabPraefix);
    $pdo->prepare("DELETE FROM {$tab} WHERE beleg_id = ?")->execute([$belegId]);
    $ein = $pdo->prepare(
        "INSERT INTO {$tab}
            (beleg_id, sortierung, produkt_id, produkt_name, beschreibung, menge,
             einheit, einzelpreis_rappen, rabatt_bp, mwst_satz_bp"
        . ($periodeDa ? ', periode' : '') . ")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?" . ($periodeDa ? ', ?' : '') . ")"
    );
    foreach (array_values($positionen) as $i => $p) {
        $werte = [$belegId, $i, $p['produkt_id'], $p['produkt_name'], $p['beschreibung'],
                  $p['menge'], $p['einheit'], $p['einzelpreis_rappen'],
                  $p['rabatt_bp'], $p['mwst_satz_bp']];
        if ($periodeDa) { $werte[] = $p['periode'] ?? 'einmalig'; }
        $ein->execute($werte);
    }
}

// Rechnet die Summen aus den GESPEICHERTEN Positionen neu und legt sie am
// Beleg ab.
//
// Bewusst aus der Datenbank gelesen statt aus der Eingabe gerechnet: Was der
// Browser mitschickt, ist eine Vorschau. Massgeblich ist, was tatsaechlich
// gespeichert wurde -- sonst koennte ein Beleg Summen tragen, die zu seinen
// eigenen Positionen nicht passen.
// WAS IN DEN BESTEHENDEN SUMMENSPALTEN STEHT, IST DIE EINMALIGE PERIODE --
// seit ENT-637 und aus Ueberzeugung. Fuer Offerte und Rechnung aendert das
// nichts: Ihre Positionen sind alle einmalig, also ist es dieselbe Zahl wie
// vorher. Fuer einen Vertrag ist es die einzige ehrliche Belegung: `total_rappen`
// heisst ueberall "das wird jetzt faellig", und eine Monatsgebuehr mit
// hineinzurechnen wuerde denselben Spaltennamen an zwei Orten verschieden
// bedeuten.
//
// Die wiederkehrenden Summen stehen daneben, in eigenen Spalten. Sie sind
// eine Bequemlichkeit fuer die Listen -- massgeblich bleiben die Positionen,
// aus denen beleg_lesen() und die oeffentliche Ansicht jedes Mal neu rechnen.
function beleg_summen_schreiben(PDO $pdo, int $belegId, int $rabattBp,
                                string $tabPraefix = ''): array
{
    $tab = beleg_tabelle($tabPraefix, 'belege');
    $positionen = beleg_positionen_lesen($pdo, $belegId, $tabPraefix);
    $perioden = beleg_summen_perioden($positionen, $rabattBp);

    // Keine einmalige Position heisst: null einmalig. Nicht "unbekannt" --
    // hier ist tatsaechlich nichts sofort faellig.
    $s = $perioden['einmalig'] ?? beleg_summen([], $rabattBp);

    $felder = "rabatt_bp = ?, zwischensumme_rappen = ?, rabatt_rappen = ?,
               mwst_rappen = ?, rundung_rappen = ?, total_rappen = ?";
    $werte  = [$rabattBp, $s['zwischensumme_rappen'], $s['rabatt_rappen'],
               $s['mwst_rappen'], $s['rundung_rappen'], $s['total_rappen']];

    if (beleg_spalte_da($pdo, $tab, 'total_monat_rappen')) {
        $felder .= ", total_monat_rappen = ?, total_jahr_rappen = ?";
        $werte[] = $perioden['monatlich']['total_rappen'] ?? 0;
        $werte[] = $perioden['jaehrlich']['total_rappen'] ?? 0;
    }
    $werte[] = $belegId;
    $pdo->prepare("UPDATE {$tab} SET {$felder} WHERE id = ?")->execute($werte);

    $s['perioden'] = $perioden;
    return $s;
}

// Ein Beleg mit allem, was das Formular und die Druckvorlage brauchen.
// Der Kunde kommt mit -- die Adresse wird LIVE gelesen, nicht als
// Schnappschuss gehalten (siehe OP-108).
function beleg_lesen(PDO $pdo, int $id, string $tabPraefix = ''): ?array
{
    $tab = beleg_tabelle($tabPraefix, 'belege');
    $s = $pdo->prepare("SELECT * FROM {$tab} WHERE id = ?");
    $s->execute([$id]);
    $b = $s->fetch();
    if (!$b) { return null; }
    $b['positionen'] = beleg_positionen_lesen($pdo, $id, $tabPraefix);
    $b['summen'] = beleg_summen($b['positionen'], (int)$b['rabatt_bp']);
    // Die Periodensummen kommen IMMER mit, auch bei einer Offerte. Dort
    // stehen sie auf genau einem Block, und das Formular braucht keine
    // Fallunterscheidung.
    $b['perioden'] = beleg_summen_perioden($b['positionen'], (int)$b['rabatt_bp']);
    return $b;
}

// ── Die Versandmail eines Belegs (ENT-674) ────────────────────────────
//
// WARUM HIER UND NICHT IM ENDPUNKT: Bis hierher baute
// betreiber_beleg_versenden.php sein HTML selbst -- ein <div> mit vier
// Absaetzen, ohne Rahmen, ohne Fuss, ohne Logo. Die gemeinsame Gestaltung
// aus mail_vorlage.php (ENT-624, ENT-651) gab es da laengst; der Versand
// hat sie nur nie geerbt. Genau die Sorte Regelbruch, die in CLAUDE.md
// steht. Als eigene Funktion laesst sie sich ausserdem pruefen, ohne einen
// Endpunkt samt Anmeldung, Datenbank und SMTP zu stellen.
//
// GIBT NICHTS AUS UND SCHICKT NICHTS: Sie liefert Betreff, Textfassung,
// HTML und die Bilder fuer smtp_senden() zurueck -- gleiche Bauart wie
// demo_zugang_mail().
//
// $signaturZeilen kommen aus dem Deploy (mail_signatur_zeilen()) und NICHT
// aus dieser Datei: Ein Personenname gehoert nicht ins Repository
// (Vertraulichkeitsregel in CLAUDE.md). Sind sie leer, zeichnet die Firma
// aus dem Briefkopf -- nie ein leerer Gruss und nie ein Platzhaltername.
//
// KEIN BETRAG IN DER MAIL (ENT-674, Punkt 4, Entscheid des
// Projektinhabers): Nummer, Datum und die Frist, sonst nichts. Eine
// weitergeleitete Mail traegt damit keine Preise; der Betrag steht auf der
// verlinkten Seite, die den Link kennt.
//
// $fassung (ENT-688): Ab der zweiten Fassung sagt die Mail, dass der Beleg
// ANGEPASST wurde, und nicht, er sei neu. Wer nach seinem Aenderungswunsch
// "eine neue Offerte" bekommt, sucht den Unterschied zu einer zweiten
// Offerte, die es nicht gibt -- es ist dieselbe, unter derselben Nummer und
// demselben Link.
function beleg_mail(array $beleg, string $firma, string $link, string $person,
                    array $signaturZeilen, int $fassung = 1): array
{
    $angepasst = $fassung > 1;
    $art    = (string)($beleg['art'] ?? 'offerte');
    $angabe = BELEG_ARTEN[$art] ?? BELEG_ARTEN['offerte'];
    $titel  = (string)$angabe['titel'];
    $nummer = (string)($beleg['nummer'] ?? '');

    $gruss = $signaturZeilen === [] ? [$firma] : $signaturZeilen;
    // Die Anrede traegt die Kontaktperson, wenn eine hinterlegt ist, und
    // sonst nichts weiter (ENT-674, Punkt 3). Ein leeres Feld darf nie als
    // halber Name in einer Mail an einen Kunden ankommen.
    $person   = trim($person);
    $anrede   = ($person === '' ? 'Guten Tag' : 'Guten Tag ' . $person) . ',';

    // Die Felder des Blocks. Beschriftungen aus BELEG_ARTEN, nicht
    // zusammengesetzt: "Offerte" + "nummer" ergaebe "Offertenummer".
    $felder = [[(string)$angabe['nummer_label'], $nummer]];
    $datum = beleg_mail_datum($beleg['datum'] ?? null);
    if ($datum !== '') { $felder[] = [(string)$angabe['datum_label'], $datum]; }
    $fristFeld = (string)($angabe['frist_feld'] ?? '');
    if ($fristFeld !== '') {
        $frist = beleg_mail_datum($beleg[$fristFeld] ?? null);
        // Eine nicht gesetzte Frist wird weggelassen und nicht als Strich
        // gezeigt: "keine Frist gesetzt" und "Frist unbekannt" sind zwei
        // Aussagen, und im Postfach laesst sich die zweite nicht aufloesen.
        if ($frist !== '') { $felder[] = [(string)$angabe['frist_label'], $frist]; }
    }

    // Nur die Offerte laesst sich am Link beantworten -- die Rechnung und
    // der Vertrag werden dort angesehen. Zwei Saetze, weil ein "direkt
    // beantworten" unter einer Rechnung eine Zusage verspricht, die die
    // Seite nicht einloest.
    $ansehen = $art === 'offerte'
        ? "Sie können die $titel hier ansehen und direkt beantworten:"
        : "Sie können die $titel hier ansehen:";

    $betreff = $angepasst ? "Angepasste $titel $nummer von $firma"
                          : "Neue $titel $nummer von $firma";
    $einleitung = $angepasst ? "wir haben die $titel $nummer für Sie angepasst."
                             : "wir haben für Sie eine neue $titel erstellt.";

    $zeilen = '';
    foreach ($felder as [$b, $w]) { $zeilen .= "$b: $w\n"; }
    $text = "$anrede\n\n"
          . "$einleitung\n\n"
          . $zeilen . "\n"
          . "$ansehen\n$link\n\n"
          . "Bei Fragen oder Unklarheiten melden Sie sich jederzeit bei uns.\n\n"
          . "Mit freundlichen Grüssen\n" . implode("\n", $gruss);

    // Die Kennung nur setzen, wenn es das Bild wirklich gibt -- ein
    // cid-Verweis ins Leere zeigt im Mailprogramm ein zerbrochenes Bild.
    $logo     = mail_logo();
    $logoHell = mail_logo_hell();
    $bilder   = array_values(array_filter([$logo, $logoHell]));

    $block = '';
    // Kompakt: drei kurze Angaben brauchen nicht die Flaeche eines
    // Zugangsdatenblocks (ENT-674, Nachtrag).
    foreach ($felder as [$b, $w]) { $block .= mail_feld($b, mail_e($w), false, true); }

    $inhalt = mail_absatz(mail_e($anrede))
        // IN DER ERSTEN PERSON (Befund des Projektinhabers, 2026-09-22):
        // "GuardOpS hat Ihnen eine neue Offerte erstellt" liest sich wie
        // eine Systemmeldung. Wer die Mail schickt, steht im Absender, im
        // Betreff und in der Signatur -- der Satz selbst darf sprechen wie
        // ein Mensch. Der Satz schliesst an die Anrede an und faengt darum
        // klein an.
        . mail_absatz(mail_e($einleitung))
        . mail_block($block, true)
        . mail_absatz(mail_e($ansehen))
        // "oeffnen" statt "anschauen": klarer und geschaeftlicher
        // (Befund des Projektinhabers, 2026-09-22).
        //
        // OHNE DIE ADRESSE IN KLARSCHRIFT DARUNTER: Der Knopf ist ein
        // gewoehnlicher Verweis, und die Textfassung dieser Mail traegt den
        // Link ohnehin (geprueft). Ein Geschaeftsbrief zeigt seine URL
        // nicht zweimal.
        . mail_knopf($titel . ' öffnen', $link, false)
        . mail_absatz('Bei Fragen oder Unklarheiten melden Sie sich jederzeit bei uns.')
        . mail_signatur($gruss,
            $logo === null ? '' : (string)$logo['cid'],
            $logoHell === null ? '' : (string)$logoHell['cid']);

    return ['betreff' => $betreff, 'text' => $text,
        'html' => mail_rahmen($inhalt), 'bilder' => $bilder];
}

// ── Die beiden Mails zum Faden (ENT-677) ──────────────────────────────
//
// Beide laufen ueber dieselbe Vorlage wie die Versandmail (ENT-674). Zwei
// eigene Gestaltungen fuer denselben Absender waeren genau der Zustand, den
// ENT-674 beendet hat.

// An die Betreiber-Konten: Am Beleg ist ein Aenderungswunsch eingegangen.
//
// OHNE DEN WORTLAUT DES KUNDEN? Nein -- er steht drin. Die Mail geht an die
// eigenen Konten, nicht nach aussen, und wer den Wunsch schon im Postfach
// liest, muss sich nicht erst anmelden, um zu wissen, worum es geht. Der
// Faden bleibt trotzdem die massgebliche Stelle; die Mail sagt das auch.
function beleg_nachricht_mail_betreiber(array $beleg, string $kundeName,
                                        string $absender, string $text,
                                        string $link): array
{
    $angabe = BELEG_ARTEN[(string)($beleg['art'] ?? 'offerte')] ?? BELEG_ARTEN['offerte'];
    $titel  = (string)$angabe['titel'];
    $nummer = (string)($beleg['nummer'] ?? '');

    $betreff = "Änderungswunsch zu $titel $nummer";

    $textFassung = "Guten Tag\n\n"
        . "Zur $titel $nummer ist ein Änderungswunsch eingegangen.\n\n"
        . "Von: $absender\n"
        . ($kundeName !== '' ? "Empfänger: $kundeName\n" : '')
        . "\n" . $text . "\n\n"
        . "Antworten im Betreiber-Bereich:\n$link\n";

    $inhalt = mail_absatz('Guten Tag')
        . mail_absatz('Zur <b>' . mail_e($titel . ' ' . $nummer) . '</b> ist ein '
            . 'Änderungswunsch eingegangen.')
        . mail_block(
            mail_feld('Von', mail_e($absender))
            . ($kundeName !== '' ? mail_feld('Empfänger', mail_e($kundeName)) : '')
            . mail_feld('Wunsch', nl2br(mail_e($text))), true)
        . mail_knopf('Im Betreiber-Bereich antworten', $link, false);

    return ['betreff' => $betreff, 'text' => $textFassung,
        'html' => mail_rahmen($inhalt), 'bilder' => []];
}

// An den Kunden: Antwort auf seinen Änderungswunsch, mit demselben Link.
//
// DERSELBE LINK, NICHT EIN NEUER: Der Versand-Token bleibt ueber
// Ueberarbeitungen hinweg derselbe (ENT-605). Der Empfaenger kehrt also an
// die Stelle zurueck, an der Beleg UND Gespraech stehen -- das ist der ganze
// Sinn der Sache.
function beleg_nachricht_mail_kunde(array $beleg, string $firma, string $person,
                                    string $text, string $link,
                                    array $signaturZeilen): array
{
    $angabe = BELEG_ARTEN[(string)($beleg['art'] ?? 'offerte')] ?? BELEG_ARTEN['offerte'];
    $titel  = (string)$angabe['titel'];
    $nummer = (string)($beleg['nummer'] ?? '');
    $gruss  = $signaturZeilen === [] ? [$firma] : $signaturZeilen;

    $person = trim($person);
    $anrede = ($person === '' ? 'Guten Tag' : 'Guten Tag ' . $person) . ',';
    $betreff = "Antwort zu $titel $nummer";

    $textFassung = "$anrede\n\n"
        . "vielen Dank für Ihre Rückmeldung zur $titel $nummer. Unsere Antwort:\n\n"
        . $text . "\n\n"
        . "Die $titel mit dem ganzen Verlauf:\n$link\n\n"
        . "Mit freundlichen Grüssen\n" . implode("\n", $gruss);

    $logo     = mail_logo();
    $logoHell = mail_logo_hell();
    $bilder   = array_values(array_filter([$logo, $logoHell]));

    $inhalt = mail_absatz(mail_e($anrede))
        . mail_absatz('vielen Dank für Ihre Rückmeldung zur <b>'
            . mail_e($titel . ' ' . $nummer) . '</b>. Unsere Antwort:')
        . mail_block(mail_feld('Antwort', nl2br(mail_e($text))), true)
        . mail_absatz('Die ' . mail_e($titel) . ' mit dem ganzen Verlauf:')
        . mail_knopf($titel . ' öffnen', $link, false)
        . mail_signatur($gruss,
            $logo === null ? '' : (string)$logo['cid'],
            $logoHell === null ? '' : (string)$logoHell['cid']);

    return ['betreff' => $betreff, 'text' => $textFassung,
        'html' => mail_rahmen($inhalt), 'bilder' => $bilder];
}

// Ein Datum aus der Datenbank als Tag.Monat.Jahr -- oder '' , wenn keines
// da ist. MySQL liefert ein nicht gesetztes DATE je nach Modus als NULL,
// als Leerzeichenkette oder als '0000-00-00'; alle drei heissen dasselbe
// und duerfen nie als "01.01.1970" oder "30.11.-0001" in einer Mail an
// einen Kunden landen.
function beleg_mail_datum($roh): string
{
    $roh = trim((string)($roh ?? ''));
    if ($roh === '' || str_starts_with($roh, '0000-00-00')) { return ''; }
    $zeit = strtotime($roh);
    return $zeit === false ? '' : date('d.m.Y', $zeit);
}

// ══════════════════════════════════════════════════════════════════════════
// Fassungen (ENT-688)
// ══════════════════════════════════════════════════════════════════════════
//
// WOZU: Bis hierher zeigte der Link immer den LEBENDEN Beleg. Wer nach dem
// Versand etwas aenderte, aenderte damit auch, was der Empfaenger sah -- und
// was er angenommen hatte. Eine Annahme auf einem Dokument, das sich danach
// noch aendern laesst, beweist nichts.
//
// JETZT: Jeder Versand, der etwas anderes zeigt als der vorige, legt eine
// neue Fassung an -- ein ABBILD dessen, was der Empfaenger sieht: Kopf,
// Positionen, gerechnete Summen, Empfaengeranschrift und Absender. Der Link
// zeigt die letzte Fassung, nie den Entwurf daneben. Die Summen stehen
// gerechnet im Abbild und werden beim Anzeigen NICHT neu gerechnet: Aendert
// sich die Formel eines Tages, darf eine versendete Offerte davon nichts
// merken (dieselbe Haltung wie bei der GAV-Rechnung: nie rueckwirkend).
//
// UNVERAENDERLICH: Eine Fassung wird angelegt und danach nie mehr
// geschrieben oder geloescht. pruef_beleg_fassung.php sucht im ganzen
// Backend nach einem UPDATE oder DELETE auf diese Tabellen und wird rot,
// sobald eines auftaucht.
//
// DIE PRUEFSUMME steht neben dem Abbild und wird beim Lesen nachgerechnet.
// Stimmt sie nicht, wird die Fassung nicht angezeigt -- eine veraenderte
// Fassung als echt auszugeben waere schlimmer als gar keine.

const BELEG_ABBILD_VERSION = 1;

// Die Kopffelder, die auf dem Dokument stehen. Eine FESTE Liste und nicht
// "alle Spalten der Zeile": Kaeme mit einem Einrichtungslauf eine Spalte
// dazu, aenderte sich sonst die Pruefsumme jedes Belegs, und alle
// versendeten Offerten stuenden auf einmal als "geaendert" da.
// Status, Token, Entscheidung und interne Bemerkung gehoeren NICHT dazu --
// sie stehen nicht auf dem Blatt.
const BELEG_ABBILD_FELDER = [
    'art', 'nummer', 'titel', 'referenz', 'datum', 'gueltig_bis', 'faellig_bis',
    'rabatt_bp', 'oeffentliche_notizen', 'bedingungen', 'fusszeile_text',
    'unterschriftsseite', 'vertrag_beginn', 'mindestlaufzeit_monate',
    'kuendigungsfrist_monate', 'verlaengerung_monate',
];
const BELEG_ABBILD_DATUMSFELDER = ['datum', 'gueltig_bis', 'faellig_bis', 'vertrag_beginn'];
const BELEG_ABBILD_ZAHLFELDER   = ['rabatt_bp', 'unterschriftsseite'];
// Diese duerfen NULL bleiben, und NULL heisst "nicht vereinbart" -- nicht 0.
const BELEG_ABBILD_ZAHL_ODER_NULL = ['mindestlaufzeit_monate', 'kuendigungsfrist_monate',
                                     'verlaengerung_monate'];
const BELEG_ABBILD_KUNDENFELDER = ['name', 'zusatzfeld', 'strasse', 'hausnummer',
                                   'adresszusatz', 'plz', 'ort'];
const BELEG_ABBILD_PERSONFELDER = ['anrede', 'vorname', 'nachname'];

// Ein Datum als JJJJ-MM-TT oder null. MySQL liefert ein leeres DATE je nach
// Modus als NULL, '' oder '0000-00-00' -- alle drei heissen dasselbe und
// muessen dieselbe Pruefsumme ergeben.
function beleg_abbild_datum($roh): ?string
{
    $d = substr(trim((string)($roh ?? '')), 0, 10);
    return ($d === '' || $d === '0000-00-00') ? null : $d;
}

// Der Inhaltsteil: Kopffelder und Positionen, jeder Wert in EINER Form.
// MySQL liefert Zahlen als Zeichenketten, SQLite als Zahlen, und "1.00" und
// 1 ergaeben zwei Pruefsummen fuer denselben Beleg.
function beleg_abbild_inhalt(array $b, array $positionen): array
{
    $kopf = [];
    foreach (BELEG_ABBILD_FELDER as $f) {
        $v = $b[$f] ?? null;
        if (in_array($f, BELEG_ABBILD_DATUMSFELDER, true)) {
            $kopf[$f] = beleg_abbild_datum($v);
        } elseif (in_array($f, BELEG_ABBILD_ZAHLFELDER, true)) {
            $kopf[$f] = (int)($v ?? 0);
        } elseif (in_array($f, BELEG_ABBILD_ZAHL_ODER_NULL, true)) {
            $kopf[$f] = ($v === null || $v === '') ? null : (int)$v;
        } else {
            $kopf[$f] = (string)($v ?? '');
        }
    }
    $kopf['positionen'] = [];
    foreach (array_values($positionen) as $p) {
        $kopf['positionen'][] = [
            'produkt_name'       => (string)($p['produkt_name'] ?? ''),
            'beschreibung'       => (string)($p['beschreibung'] ?? ''),
            'menge'              => sprintf('%.2f', (float)($p['menge'] ?? 0)),
            'einheit'            => (string)($p['einheit'] ?? ''),
            'einzelpreis_rappen' => (int)($p['einzelpreis_rappen'] ?? 0),
            'rabatt_bp'          => (int)($p['rabatt_bp'] ?? 0),
            'mwst_satz_bp'       => (int)($p['mwst_satz_bp'] ?? 0),
            'periode'            => (string)($p['periode'] ?? 'einmalig'),
        ];
    }
    return $kopf;
}

function beleg_abbild_zeile(?array $zeile, array $felder): ?array
{
    if (!$zeile) { return null; }
    $raus = [];
    foreach ($felder as $f) { $raus[$f] = (string)($zeile[$f] ?? ''); }
    return $raus;
}

// Das ganze Abbild. $absender kommt von der aufrufenden Seite, weil er auf
// beiden Seiten aus einer anderen Tabelle stammt (be_briefkopf bzw.
// betrieb); alles andere ist auf beiden Seiten gleich gebaut.
function beleg_abbild(array $b, array $positionen, ?array $kunde, ?array $person,
                      array $absender): array
{
    $inhalt = beleg_abbild_inhalt($b, $positionen);
    return [
        'version'  => BELEG_ABBILD_VERSION,
        'beleg'    => $inhalt,
        'summen'   => beleg_summen($inhalt['positionen'], (int)$inhalt['rabatt_bp']),
        'perioden' => beleg_summen_perioden($inhalt['positionen'], (int)$inhalt['rabatt_bp']),
        'kunde'    => beleg_abbild_zeile($kunde, BELEG_ABBILD_KUNDENFELDER),
        'person'   => beleg_abbild_zeile($person, BELEG_ABBILD_PERSONFELDER),
        'absender' => $absender,
    ];
}

// Das Abbild eines gespeicherten Belegs, mit dem Empfaenger, wie er JETZT im
// Adressbestand steht. Der Absender kommt von aussen (siehe oben).
function beleg_abbild_lesen(PDO $pdo, int $id, string $tabPraefix, array $absender): ?array
{
    $b = beleg_lesen($pdo, $id, $tabPraefix);
    if (!$b) { return null; }
    $kunde = null;
    if (!empty($b['kunde_id'])) {
        $s = $pdo->prepare('SELECT ' . implode(', ', BELEG_ABBILD_KUNDENFELDER)
            . ' FROM ' . beleg_tabelle($tabPraefix, 'kunden') . ' WHERE id = ?');
        $s->execute([(int)$b['kunde_id']]);
        $kunde = $s->fetch(PDO::FETCH_ASSOC) ?: null;
    }
    $person = null;
    if (!empty($b['person_id'])) {
        $s = $pdo->prepare('SELECT ' . implode(', ', BELEG_ABBILD_PERSONFELDER)
            . ' FROM ' . beleg_tabelle($tabPraefix, 'kunden_person') . ' WHERE id = ?');
        $s->execute([(int)$b['person_id']]);
        $person = $s->fetch(PDO::FETCH_ASSOC) ?: null;
    }
    return beleg_abbild($b, $b['positionen'], $kunde, $person, $absender);
}

// Der Absender der Mandantenseite aus `betrieb`. Das Logo liegt dort als
// Binaerwert; im Abbild steht es als data:-URL, weil JSON keine Binaerdaten
// traegt und die Seite es ohnehin so einbindet.
function beleg_absender_betrieb(PDO $pdo): array
{
    try {
        $z = $pdo->query(
            'SELECT firma, fusszeile, fusszeile2, logo_mime, logo, qr_iban, qr_strasse,
                    qr_hausnummer, qr_plz, qr_ort FROM betrieb WHERE id = 1'
        )->fetch(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $e) {
        $z = [];
    }
    $raus = [];
    foreach (['firma', 'fusszeile', 'fusszeile2', 'qr_iban', 'qr_strasse', 'qr_hausnummer',
              'qr_plz', 'qr_ort'] as $f) {
        $raus[$f] = (string)($z[$f] ?? '');
    }
    $raus['logo'] = (!empty($z['logo']) && !empty($z['logo_mime']))
        ? 'data:' . $z['logo_mime'] . ';base64,' . base64_encode((string)$z['logo'])
        : '';
    return $raus;
}

// Eine Form, eine Zeichenkette, eine Pruefsumme. Ohne Maskierungen, damit
// dasselbe Abbild in PHP und in einer spaeteren Nachpruefung dieselben Bytes
// ergibt.
function beleg_abbild_json(array $abbild): string
{
    return json_encode($abbild, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function beleg_pruefsumme(string $json): string
{
    return hash('sha256', $json);
}

// Die Pruefsumme NUR des Inhalts (Kopf und Positionen). Sie entscheidet, ob
// das Formular "geaendert, noch nicht versendet" zeigt. Die Anschrift des
// Empfaengers und der Briefkopf bleiben dabei aussen vor: Aendert jemand das
// Logo, stuende sonst jede versendete Offerte als geaendert da. Beim
// Versand zaehlt dagegen das GANZE Abbild -- eine neue Anschrift ergibt dort
// sehr wohl eine neue Fassung.
function beleg_inhalt_pruefsumme(array $abbild): string
{
    return beleg_pruefsumme(beleg_abbild_json($abbild['beleg'] ?? []));
}

// Gibt es die Tabelle? Zwischen Deploy und Einrichtungslauf fehlt sie; dann
// verhaelt sich alles wie vor ENT-688, statt mit einem SQL-Fehler abzubrechen.
//
// Eine Abfrage mit LIMIT 0 statt SHOW COLUMNS: Sie laeuft auf MySQL und auf
// SQLite gleich, und die Pruefung faehrt die Fassungen auf SQLite. Gemerkt
// wird nur ein JA -- ein Nein kann der Einrichtungslauf im selben Aufruf
// noch aendern.
function beleg_fassung_tabelle_da(PDO $pdo, string $tabPraefix = ''): bool
{
    static $da = [];
    $tab = beleg_tabelle($tabPraefix, 'beleg_fassung');
    if (!empty($da[spl_object_id($pdo) . $tab])) { return true; }
    try {
        $pdo->query("SELECT abbild FROM {$tab} LIMIT 0");
    } catch (Throwable $e) {
        return false;
    }
    return $da[spl_object_id($pdo) . $tab] = true;
}

// Alle Fassungen eines Belegs, ohne das Abbild selbst (das kann ein Logo
// tragen und ist fuer eine Liste zu schwer).
function beleg_fassungen(PDO $pdo, int $belegId, string $tabPraefix = ''): array
{
    if (!beleg_fassung_tabelle_da($pdo, $tabPraefix)) { return []; }
    $s = $pdo->prepare(
        'SELECT nummer, pruefsumme, anlass, versendet_am, versendet_von
           FROM ' . beleg_tabelle($tabPraefix, 'beleg_fassung') . '
          WHERE beleg_id = ? ORDER BY nummer'
    );
    $s->execute([$belegId]);
    return array_map(static function (array $z): array {
        $z['nummer'] = (int)$z['nummer'];
        return $z;
    }, $s->fetchAll(PDO::FETCH_ASSOC));
}

// Die letzte Fassung samt Abbild -- oder null, wenn es keine gibt.
// 'echt' sagt, ob die Pruefsumme noch zum gespeicherten Abbild passt.
function beleg_letzte_fassung(PDO $pdo, int $belegId, string $tabPraefix = ''): ?array
{
    if (!beleg_fassung_tabelle_da($pdo, $tabPraefix)) { return null; }
    $s = $pdo->prepare(
        'SELECT nummer, abbild, pruefsumme, anlass, versendet_am, versendet_von'
        . (beleg_fassung_freigabe_da($pdo, $tabPraefix) ? ', freigegeben' : '')
        . (beleg_spalte_da_portabel($pdo, beleg_tabelle($tabPraefix, 'beleg_fassung'), 'versendet_von_id')
           ? ', versendet_von_id' : '') . '
           FROM ' . beleg_tabelle($tabPraefix, 'beleg_fassung') . '
          WHERE beleg_id = ? ORDER BY nummer DESC LIMIT 1'
    );
    $s->execute([$belegId]);
    $z = $s->fetch(PDO::FETCH_ASSOC);
    if (!$z) { return null; }
    $json = (string)$z['abbild'];
    $z['nummer'] = (int)$z['nummer'];
    $z['echt']   = hash_equals((string)$z['pruefsumme'], beleg_pruefsumme($json));
    $z['freigegeben'] = (int)($z['freigegeben'] ?? 0) === 1;
    $z['abbild'] = json_decode($json, true) ?: [];
    return $z;
}

// Legt eine neue Fassung an -- aber nur, wenn sich gegenueber der letzten
// etwas geaendert hat. Ein zweiter Versand ohne Aenderung ist eine
// Erinnerung, keine neue Fassung.
//
// $anlass: 'versand' (der Normalfall) oder 'annahme' (ein Beleg, der vor
// ENT-688 versendet wurde und nie eine Fassung bekam: Festgehalten wird
// dann, was der Empfaenger im Moment seiner Entscheidung sah).
//
// Gibt ['nummer' => n, 'neu' => bool] zurueck.
function beleg_fassung_anlegen(PDO $pdo, int $belegId, array $abbild, string $anlass,
                               string $von, string $tabPraefix = '', bool $freigegeben = false,
                               ?int $vonId = null): array
{
    $json = beleg_abbild_json($abbild);
    $summe = beleg_pruefsumme($json);
    $letzte = beleg_letzte_fassung($pdo, $belegId, $tabPraefix);
    if ($letzte && beleg_fassung_gleich($letzte, $abbild)) {
        return ['nummer' => (int)$letzte['nummer'], 'neu' => false];
    }
    $nummer = $letzte ? (int)$letzte['nummer'] + 1 : 1;
    // Die Freigabe (ENT-688, Punkt 7) steht nur in der Zeile, wenn die
    // Spalte schon da ist -- zwischen Deploy und Einrichtungslauf fehlt sie.
    $mitFreigabe = beleg_fassung_freigabe_da($pdo, $tabPraefix);
    // Wer versendet hat, als Konto (Schritt 3) -- nur, wenn die Spalte da ist.
    $mitVonId = beleg_spalte_da_portabel($pdo, beleg_tabelle($tabPraefix, 'beleg_fassung'), 'versendet_von_id');
    $pdo->prepare(
        'INSERT INTO ' . beleg_tabelle($tabPraefix, 'beleg_fassung') . '
            (beleg_id, nummer, abbild, pruefsumme, anlass, versendet_am, versendet_von'
        . ($mitFreigabe ? ', freigegeben' : '') . ($mitVonId ? ', versendet_von_id' : '') . ')
         VALUES (?, ?, ?, ?, ?, NOW(), ?' . ($mitFreigabe ? ', ?' : '') . ($mitVonId ? ', ?' : '') . ')'
    )->execute(array_merge([$belegId, $nummer, $json, $summe, $anlass, mb_substr($von, 0, 120)],
        $mitFreigabe ? [$freigegeben ? 1 : 0] : [], $mitVonId ? [$vonId] : []));
    return ['nummer' => $nummer, 'neu' => true];
}

// Gibt es die Spalte fuer die Freigabe (ENT-688, Schritt 2)?
function beleg_fassung_freigabe_da(PDO $pdo, string $tabPraefix = ''): bool
{
    try {
        $pdo->query('SELECT freigegeben FROM ' . beleg_tabelle($tabPraefix, 'beleg_fassung') . ' LIMIT 0');
        return true;
    } catch (Throwable $e) {
        return false;
    }
}

// Unsere Unterschrift im Abbild (ENT-704). Beim Freigeben kopiert
// betreiber_beleg_versenden.php die Unterschrift dessen, der freigibt, unter
// diesem Schluessel ins Abbild -- NEBEN 'beleg', damit sie unter der
// Pruefsumme der Fassung steht, aber nicht zum Inhalt zaehlt.
const BELEG_FREIGABE_UNTERSCHRIFT = 'freigabe_unterschrift';

// Zeigt eine neue Fassung dasselbe wie die letzte? Verglichen wird das
// Abbild OHNE unsere Unterschrift: Sie kommt erst beim Freigeben dazu, das
// frisch gelesene Abbild traegt sie nie. Mit ihr im Vergleich waere jede
// Erinnerung eine neue Fassung (ENT-704). Ein altes Abbild ohne Schluessel
// vergleicht sich wie bisher.
function beleg_fassung_gleich(array $letzte, array $abbild): bool
{
    $ohne = static function (array $a): string {
        unset($a[BELEG_FREIGABE_UNTERSCHRIFT]);
        return beleg_pruefsumme(beleg_abbild_json($a));
    };
    return hash_equals($ohne((array)($letzte['abbild'] ?? [])), $ohne($abbild));
}

// Die Unterschrift aus der Freigabe, gepruefte PNG-Zeichnung oder null.
// Ein Abbild aus der Zeit davor hat keine -- dann gilt wie bisher der Name.
function beleg_freigabe_unterschrift(array $abbild): ?array
{
    $f = $abbild[BELEG_FREIGABE_UNTERSCHRIFT] ?? null;
    if (!is_array($f)) { return null; }
    $bild = beleg_zeichnung_pruefen((string)($f['bild'] ?? ''));
    if ($bild === null || $bild === '') { return null; }
    return ['name' => (string)($f['name'] ?? ''), 'bild' => $bild];
}

// Braucht der Versand eine neue Fassung? Dieselbe Frage wie in
// beleg_fassung_anlegen(), aber ohne zu schreiben -- die Mail muss vor dem
// Eintrag wissen, ob sie "neu" oder "angepasst" sagt.
function beleg_fassung_naechste(PDO $pdo, int $belegId, array $abbild, string $tabPraefix = ''): array
{
    $letzte = beleg_letzte_fassung($pdo, $belegId, $tabPraefix);
    if ($letzte && beleg_fassung_gleich($letzte, $abbild)) {
        return ['nummer' => (int)$letzte['nummer'], 'neu' => false];
    }
    return ['nummer' => $letzte ? (int)$letzte['nummer'] + 1 : 1, 'neu' => true];
}

// Ist der Beleg nach einer Annahme durch den Empfaenger gesperrt?
//
// NUR DIE ANNAHME AM LINK sperrt (entscheidung_am gesetzt). Ein Status
// "bestaetigt", den jemand im Formular von Hand setzt -- die Zusage kam per
// Telefon --, sperrt nicht: Da gibt es kein angenommenes Abbild, das es zu
// schuetzen gaelte. Eine Ablehnung sperrt ebenfalls nicht: Wer nach einem
// Nein nachbessert, verschickt eine neue Fassung.
function beleg_gesperrt(array $zeile): bool
{
    return !empty($zeile['entscheidung_am']) && (string)($zeile['status'] ?? '') === 'bestaetigt';
}

// Der Stand fuer das Formular: welche Fassungen es gibt und ob der Entwurf
// seit der letzten davon geaendert wurde.
function beleg_fassung_stand(PDO $pdo, array $beleg, string $tabPraefix, array $absender): array
{
    $fassungen = beleg_fassungen($pdo, (int)$beleg['id'], $tabPraefix);
    $geaendert = false;
    if ($fassungen) {
        $letzte = beleg_letzte_fassung($pdo, (int)$beleg['id'], $tabPraefix);
        $jetzt  = beleg_abbild_lesen($pdo, (int)$beleg['id'], $tabPraefix, $absender);
        if ($letzte && $jetzt) {
            $geaendert = !hash_equals(beleg_inhalt_pruefsumme($letzte['abbild']),
                                      beleg_inhalt_pruefsumme($jetzt));
        }
    }
    return [
        'fassung_da' => beleg_fassung_tabelle_da($pdo, $tabPraefix),
        'fassungen'  => array_map(static fn(array $f): array => [
            'nummer' => $f['nummer'], 'anlass' => $f['anlass'],
            'versendet_am' => $f['versendet_am'], 'versendet_von' => $f['versendet_von'],
        ], $fassungen),
        'fassung_geaendert' => $geaendert,
        'gesperrt' => beleg_gesperrt($beleg),
        // Wer entschieden hat (ENT-688, Schritt 2) -- ohne die Zeichnung,
        // die ist fuer die Anzeige im Formular zu schwer und steht auf dem
        // Dokument. 'abweichend' zeigt die Oberflaeche ausdruecklich an.
        'unterschrift' => beleg_unterschrift_kurz(beleg_unterschrift_letzte($pdo, $tabPraefix, (int)$beleg['id'])),
    ];
}

// ══════════════════════════════════════════════════════════════════════════
// Unterschrift am Link (ENT-688, Schritt 2)
// ══════════════════════════════════════════════════════════════════════════
//
// Eine EINFACHE elektronische Signatur: Sie aendert nichts daran, dass die
// Annahme formfrei gilt (Art. 1 und 11 OR), sie macht sie BEWEISBAR -- wer
// (Name, Funktion, Firma), wann, welche Fassung (Pruefsumme), und mit
// Zugriff auf welche Mailadresse (Bestaetigungscode). Einer eigenhaendigen
// Unterschrift gleichgestellt ist nur die qualifizierte Signatur nach
// ZertES; die ist hier bewusst nicht gebaut (OP-693).
//
// DER CODE GEHT AN DIE ADRESSE, DIE DER UNTERZEICHNENDE ANGIBT (ENT-688,
// Punkt 4): Die Offerte geht oft an die Kontaktperson, unterschreiben darf
// aber die Geschaeftsleitung. Ob die Adresse von der Empfaengeradresse des
// Belegs abweicht, steht ausdruecklich im Protokoll und beim Betreiber.
//
// GESPEICHERT WIRD NIE DER CODE, nur sein Abdruck -- dieselbe Haltung wie
// bei den Sitzungen (sitzung_abdruck()).

const BELEG_CODE_GUELTIG_MIN = 15;
const BELEG_CODE_VERSUCHE    = 5;
// Zeichen der data:-URL einer gezeichneten Unterschrift. unterschrift.js
// schneidet auf die Striche zu; ein echtes Bild liegt weit darunter.
const BELEG_ZEICHNUNG_MAX    = 400000;
// Welche Belegarten sich annehmen lassen. Eine Rechnung wird bezahlt, nicht
// unterschrieben.
const BELEG_UNTERSCHREIBBAR  = ['offerte', 'vertrag'];

function beleg_unterschreibbar(string $art): bool
{
    return in_array($art, BELEG_UNTERSCHREIBBAR, true);
}

function beleg_unterschrift_tabelle_da(PDO $pdo, string $tabPraefix = ''): bool
{
    static $da = [];
    $tab = beleg_tabelle($tabPraefix, 'beleg_unterschrift');
    if (!empty($da[spl_object_id($pdo) . $tab])) { return true; }
    try {
        $pdo->query("SELECT code_abdruck FROM {$tab} LIMIT 0");
    } catch (Throwable $e) {
        return false;
    }
    return $da[spl_object_id($pdo) . $tab] = true;
}

// Sechs Ziffern, fuehrende Nullen erhalten. random_int, nicht rand():
// Der Code ist ein Ausweis.
function beleg_code_neu(): string
{
    return str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
}

// Der Abdruck haengt an der Zeile: Derselbe Code an zwei Unterschriften
// ergibt zwei verschiedene Abdruecke.
function beleg_code_abdruck(int $zeile, string $code): string
{
    return hash('sha256', $zeile . ':' . $code);
}

// Eine gezeichnete Unterschrift: leer (dann steht der getippte Name auf der
// Linie) oder ein PNG als data:-URL. Was anders aussieht, wird abgewiesen
// (null) -- und nicht still weggelassen, sonst haelte der Unterzeichnende
// eine Zeichnung fuer abgegeben, die es nicht gibt.
function beleg_zeichnung_pruefen(string $roh): ?string
{
    $roh = trim($roh);
    if ($roh === '') { return ''; }
    if (strlen($roh) > BELEG_ZEICHNUNG_MAX) { return null; }
    if (!preg_match('~^data:image/png;base64,([A-Za-z0-9+/]+={0,2})$~', $roh, $m)) { return null; }
    $bin = base64_decode($m[1], true);
    // Magic Bytes statt einer Behauptung (gleiches Prinzip wie
    // rundgang_rapport_versenden.php).
    if ($bin === false || strncmp($bin, "\x89PNG\r\n\x1a\n", 8) !== 0) { return null; }
    return $roh;
}

// Eine hochgeladene Unterschrift aufbereiten (ENT-706): ein Bildschirmfoto
// aus Apple Vorschau oder ein Foto der Unterschrift auf Papier. Heraus kommt
// dasselbe wie aus dem Zeichenfeld -- eine PNG-Zeichnung mit durchsichtigem
// Grund, auf die Unterschrift zugeschnitten --, damit alles Weitere
// (Fassung, Pruefsumme, PDF) nichts von der Herkunft wissen muss.
//
// DER HINTERGRUND richtet sich nach dem Bild, nicht nach reinem Weiss: Papier
// auf einem Foto ist grau. Als Hintergrund gilt die Helligkeit, die 90 % der
// Bildpunkte erreichen; was deutlich dunkler ist, ist Tinte. Dazwischen ein
// weicher Uebergang, sonst franst der Strich aus.
//
// Gibt ['bild' => data-URL] oder ['fehler' => Text fuer den Menschen].
const BELEG_UPLOAD_MAX = 8000000;       // Zeichen der data-URL, rund 6 MB Bild
const BELEG_UPLOAD_BREITE = 900;        // Pixel, so breit wird hoechstens gespeichert

function beleg_unterschrift_aus_bild(string $roh): array
{
    if (!function_exists('imagecreatefromstring')) {
        return ['fehler' => 'Bilder lassen sich auf diesem Server nicht verarbeiten.'];
    }
    $roh = trim($roh);
    if ($roh === '' || strlen($roh) > BELEG_UPLOAD_MAX) {
        return ['fehler' => 'Das Bild ist zu gross. Bitte ein kleineres Bild oder einen engeren Ausschnitt wählen.'];
    }
    if (!preg_match('~^data:image/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$~', $roh, $m)) {
        return ['fehler' => 'Bitte ein PNG- oder JPG-Bild wählen.'];
    }
    $bin = base64_decode($m[2], true);
    $png = $bin !== false && strncmp($bin, "\x89PNG\r\n\x1a\n", 8) === 0;
    $jpg = $bin !== false && strncmp($bin, "\xFF\xD8\xFF", 3) === 0;
    if (!$png && !$jpg) {
        return ['fehler' => 'Bitte ein PNG- oder JPG-Bild wählen.'];
    }
    $quelle = @imagecreatefromstring($bin);
    if (!$quelle) {
        return ['fehler' => 'Das Bild liess sich nicht lesen.'];
    }
    // Erst verkleinern: Ein Handyfoto hat zwoelf Millionen Punkte, und die
    // Schleife unten laeuft ueber jeden.
    $b0 = imagesx($quelle); $h0 = imagesy($quelle);
    $f = min(1.0, 1400 / max(1, $b0));
    $b = max(1, (int)round($b0 * $f)); $h = max(1, (int)round($h0 * $f));
    $bild = imagecreatetruecolor($b, $h);
    imagealphablending($bild, false);
    imagesavealpha($bild, true);
    imagefill($bild, 0, 0, imagecolorallocatealpha($bild, 255, 255, 255, 127));
    imagealphablending($bild, true);
    imagecopyresampled($bild, $quelle, 0, 0, 0, 0, $b, $h, $b0, $h0);
    imagedestroy($quelle);
    imagealphablending($bild, false);

    // Helligkeit je Punkt; ein durchsichtiger Punkt zaehlt als Hintergrund.
    $hell = [];
    for ($y = 0; $y < $h; $y++) {
        for ($x = 0; $x < $b; $x++) {
            $c = imagecolorat($bild, $x, $y);
            $a = ($c >> 24) & 0x7F;
            $l = 0.299 * (($c >> 16) & 0xFF) + 0.587 * (($c >> 8) & 0xFF) + 0.114 * ($c & 0xFF);
            $hell[] = $a >= 120 ? 255.0 : $l + (255 - $l) * $a / 127;
        }
    }
    $sortiert = $hell; sort($sortiert);
    $grund = $sortiert[(int)floor(0.9 * (count($sortiert) - 1))];
    $oben = $grund - 25; $unten = max(0.0, $grund - 110);
    if ($oben <= $unten + 5) {
        return ['fehler' => 'Auf dem Bild ist keine Unterschrift zu erkennen. Bitte ein Bild mit dunkler Schrift auf hellem Grund wählen.'];
    }
    $x0 = $b; $y0 = $h; $x1 = -1; $y1 = -1;
    $i = 0;
    for ($y = 0; $y < $h; $y++) {
        for ($x = 0; $x < $b; $x++, $i++) {
            $l = $hell[$i];
            $deckung = $l >= $oben ? 0.0 : ($l <= $unten ? 1.0 : ($oben - $l) / ($oben - $unten));
            $c = imagecolorat($bild, $x, $y);
            // Die Farbe der Tinte bleibt (blauer Kugelschreiber bleibt blau),
            // abgedunkelt, damit sie auf dem Dokument traegt.
            $r = (int)((($c >> 16) & 0xFF) * 0.6); $g = (int)((($c >> 8) & 0xFF) * 0.6); $bl = (int)(($c & 0xFF) * 0.6);
            imagesetpixel($bild, $x, $y, imagecolorallocatealpha($bild, $r, $g, $bl, (int)round(127 * (1 - $deckung))));
            if ($deckung > 0.35) {
                if ($x < $x0) { $x0 = $x; } if ($x > $x1) { $x1 = $x; }
                if ($y < $y0) { $y0 = $y; } if ($y > $y1) { $y1 = $y; }
            }
        }
    }
    if ($x1 < 0 || ($x1 - $x0) < 10 || ($y1 - $y0) < 5) {
        imagedestroy($bild);
        return ['fehler' => 'Auf dem Bild ist keine Unterschrift zu erkennen. Bitte ein Bild mit dunkler Schrift auf hellem Grund wählen.'];
    }
    // Zuschneiden mit wenig Luft, dann auf hoechstens BELEG_UPLOAD_BREITE.
    $rand = 4;
    $x0 = max(0, $x0 - $rand); $y0 = max(0, $y0 - $rand);
    $x1 = min($b - 1, $x1 + $rand); $y1 = min($h - 1, $y1 + $rand);
    $bw = $x1 - $x0 + 1; $bh = $y1 - $y0 + 1;
    $g = min(1.0, BELEG_UPLOAD_BREITE / $bw, 300 / $bh);
    $zb = max(1, (int)round($bw * $g)); $zh = max(1, (int)round($bh * $g));
    $ziel = imagecreatetruecolor($zb, $zh);
    imagealphablending($ziel, false);
    imagesavealpha($ziel, true);
    imagefill($ziel, 0, 0, imagecolorallocatealpha($ziel, 0, 0, 0, 127));
    imagecopyresampled($ziel, $bild, 0, 0, $x0, $y0, $zb, $zh, $bw, $bh);
    imagedestroy($bild);
    ob_start(); imagepng($ziel, null, 9); $aus = (string)ob_get_clean();
    imagedestroy($ziel);
    $url = 'data:image/png;base64,' . base64_encode($aus);
    if (beleg_zeichnung_pruefen($url) === null) {
        return ['fehler' => 'Das Bild ist nach dem Zuschneiden noch zu gross. Bitte einen engeren Ausschnitt wählen.'];
    }
    return ['bild' => $url];
}

// Wie weit reicht die Unterschrift UNTER ihre Grundlinie? (ENT-706)
//
// Als Anteil der Bildhoehe, von unten gemessen. Die Grundlinie ist die
// Linie, auf der die Buchstaben stehen -- nicht der tiefste Punkt des
// Bildes: Eine Schlaufe nach unten (ein "b", ein Schwung) reicht weit
// darunter, ebenso die Luft am Rand. Ein fester Anteil passt deshalb nie fuer
// alle Unterschriften.
//
// ERKANNT, NICHT GERATEN: Je Spalte der tiefste Punkt der Tinte; der Median
// davon ist die Grundlinie. Eine Schlaufe betrifft nur wenige Spalten und
// verschiebt den Median kaum, die Buchstaben bestimmen ihn.
//
// Ohne GD oder bei einem unlesbaren Bild ein Fuenftel -- der Wert von vorher.
function beleg_unterschrift_grundlinie(string $url): float
{
    static $gemerkt = [];
    $schluessel = md5($url);
    if (isset($gemerkt[$schluessel])) { return $gemerkt[$schluessel]; }
    $ersatz = 0.2;
    if (!function_exists('imagecreatefromstring') || !preg_match('~^data:image/png;base64,(.+)$~s', $url, $m)) {
        return $gemerkt[$schluessel] = $ersatz;
    }
    $im = @imagecreatefromstring((string)base64_decode($m[1], true));
    if (!$im) { return $gemerkt[$schluessel] = $ersatz; }
    $b = imagesx($im); $h = imagesy($im);
    $boeden = [];
    for ($x = 0; $x < $b; $x++) {
        $tinte = 0;
        for ($y = $h - 1; $y >= 0; $y--) {
            if (((imagecolorat($im, $x, $y) >> 24) & 0x7F) < 64) {
                if ($tinte === 0) { $boden = $y; }
                if (++$tinte >= 2) { $boeden[] = $boden; break; }
            }
        }
    }
    imagedestroy($im);
    if (count($boeden) < 3 || $h < 4) { return $gemerkt[$schluessel] = $ersatz; }
    sort($boeden);
    $grund = $boeden[(int)floor(count($boeden) / 2)];
    $anteil = ($h - 1 - $grund) / $h;
    // Hoechstens 45 %: Eine stark steigende Unterschrift hat keine klare
    // Grundlinie; sie soll die Linie kreuzen, nicht darunter verschwinden.
    return $gemerkt[$schluessel] = max(0.02, min(0.45, $anteil));
}

// Die Angaben aus dem Unterschriftsdialog, geprueft. Gibt
// ['fehler' => '…'] oder ['werte' => [...]] zurueck.
function beleg_unterschrift_angaben(array $in): array
{
    $text = static fn(string $k, int $max): string =>
        mb_substr(trim(preg_replace('/\s+/u', ' ', (string)($in[$k] ?? ''))), 0, $max);
    $w = [
        'name'     => $text('name', 120),
        'funktion' => $text('funktion', 120),
        'firma'    => $text('firma', 200),
        'email'    => mb_substr(trim((string)($in['email'] ?? '')), 0, 200),
    ];
    if ($w['name'] === '')     { return ['fehler' => 'Bitte Ihren Namen angeben.']; }
    if ($w['funktion'] === '') { return ['fehler' => 'Bitte Ihre Funktion angeben.']; }
    if ($w['email'] === '' || !filter_var($w['email'], FILTER_VALIDATE_EMAIL)) {
        return ['fehler' => 'Bitte eine gültige E-Mail-Adresse angeben — dorthin geht der Bestätigungscode.'];
    }
    // Die Erklaerung ist Pflicht und wird ausdruecklich abgegeben, nicht
    // vorausgesetzt: Sie ist der Satz, auf den es im Streitfall ankommt.
    if (empty($in['zeichnungsberechtigt'])) {
        return ['fehler' => 'Bitte bestätigen Sie, dass Sie zeichnungsberechtigt sind.'];
    }
    $zeichnung = beleg_zeichnung_pruefen((string)($in['zeichnung'] ?? ''));
    if ($zeichnung === null) {
        return ['fehler' => 'Die gezeichnete Unterschrift liess sich nicht lesen. Bitte neu zeichnen oder weglassen.'];
    }
    $w['zeichnung'] = $zeichnung;
    return ['werte' => $w];
}

// Legt eine offene Unterschrift an und gibt Zeile und Code zurueck. Der
// Code verlaesst diese Funktion nur, damit der Aufrufer ihn verschicken
// kann; in der Datenbank steht er nie.
function beleg_unterschrift_anlegen(PDO $pdo, string $tabPraefix, int $belegId, int $fassung,
                                    array $werte, string $empfaengerEmail,
                                    string $ip, string $browser): array
{
    $tab = beleg_tabelle($tabPraefix, 'beleg_unterschrift');
    $pdo->prepare(
        "INSERT INTO {$tab} (beleg_id, fassung, art, name, funktion, firma, email,
            zeichnungsberechtigt, zeichnung, empfaenger_email, code_abdruck,
            code_gesendet_am, code_versuche, ip, browser, erstellt_am)
         VALUES (?, ?, 'annahme', ?, ?, ?, ?, 1, ?, ?, '', NOW(), 0, ?, ?, NOW())"
    )->execute([$belegId, $fassung, $werte['name'], $werte['funktion'], $werte['firma'],
                $werte['email'], $werte['zeichnung'] !== '' ? $werte['zeichnung'] : null,
                mb_substr($empfaengerEmail, 0, 200), mb_substr($ip, 0, 64), mb_substr($browser, 0, 255)]);
    $zeile = (int)$pdo->lastInsertId();
    $code = beleg_code_neu();
    $pdo->prepare("UPDATE {$tab} SET code_abdruck = ? WHERE id = ? AND bestaetigt_am IS NULL")
        ->execute([beleg_code_abdruck($zeile, $code), $zeile]);
    return ['id' => $zeile, 'code' => $code];
}

// Prueft den eingegebenen Code. Lagen:
//   'ok'         bestaetigt -- ab jetzt unveraenderlich
//   'falsch'     Code stimmt nicht; noch Versuche uebrig
//   'gesperrt'   zu viele Fehlversuche -- neuen Code anfordern
//   'abgelaufen' aelter als BELEG_CODE_GUELTIG_MIN
//   'fassung'    seit dem Anfordern ist eine neue Fassung versendet worden
//   'unbekannt'  keine offene Unterschrift dieser Nummer an diesem Beleg
//   'schon'      bereits bestaetigt
// Vier verschiedene Fehler, vier verschiedene Texte auf der Seite.
function beleg_unterschrift_pruefen(PDO $pdo, string $tabPraefix, int $belegId, int $zeile,
                                    string $code, int $aktuelleFassung): string
{
    $tab = beleg_tabelle($tabPraefix, 'beleg_unterschrift');
    $s = $pdo->prepare("SELECT id, fassung, code_abdruck, code_gesendet_am, code_versuche, bestaetigt_am
                          FROM {$tab} WHERE id = ? AND beleg_id = ? AND art = 'annahme'");
    $s->execute([$zeile, $belegId]);
    $z = $s->fetch(PDO::FETCH_ASSOC);
    if (!$z) { return 'unbekannt'; }
    if (!empty($z['bestaetigt_am'])) { return 'schon'; }
    if ((int)$z['code_versuche'] >= BELEG_CODE_VERSUCHE) { return 'gesperrt'; }
    // Unterschrieben wird, was beim Anfordern am Link stand. Ist inzwischen
    // eine neue Fassung versendet, gilt der Code nicht mehr fuer sie.
    if ((int)$z['fassung'] !== $aktuelleFassung) { return 'fassung'; }
    $alter = time() - (int)strtotime((string)$z['code_gesendet_am']);
    if ($alter > BELEG_CODE_GUELTIG_MIN * 60) { return 'abgelaufen'; }
    $code = preg_replace('/\D/', '', $code);
    if ($code === '' || !hash_equals((string)$z['code_abdruck'], beleg_code_abdruck($zeile, $code))) {
        $pdo->prepare("UPDATE {$tab} SET code_versuche = code_versuche + 1
                        WHERE id = ? AND bestaetigt_am IS NULL")->execute([$zeile]);
        return ((int)$z['code_versuche'] + 1 >= BELEG_CODE_VERSUCHE) ? 'gesperrt' : 'falsch';
    }
    $pdo->prepare("UPDATE {$tab} SET bestaetigt_am = NOW() WHERE id = ? AND bestaetigt_am IS NULL")
        ->execute([$zeile]);
    return 'ok';
}

// Eine Ablehnung: Name Pflicht, Grund freiwillig, kein Code (ENT-688,
// Punkt 6). Sie verpflichtet niemanden -- ein Code waere nur Huerde.
function beleg_ablehnung_anlegen(PDO $pdo, string $tabPraefix, int $belegId, int $fassung,
                                 string $name, string $grund, string $empfaengerEmail,
                                 string $ip, string $browser): int
{
    $tab = beleg_tabelle($tabPraefix, 'beleg_unterschrift');
    $pdo->prepare(
        "INSERT INTO {$tab} (beleg_id, fassung, art, name, grund, empfaenger_email,
            code_abdruck, code_versuche, bestaetigt_am, ip, browser, erstellt_am)
         VALUES (?, ?, 'ablehnung', ?, ?, ?, '', 0, NOW(), ?, ?, NOW())"
    )->execute([$belegId, $fassung, mb_substr($name, 0, 120),
                $grund !== '' ? mb_substr($grund, 0, 4000) : null, mb_substr($empfaengerEmail, 0, 200),
                mb_substr($ip, 0, 64), mb_substr($browser, 0, 255)]);
    return (int)$pdo->lastInsertId();
}

// Die zuletzt bestaetigte Entscheidung (Annahme oder Ablehnung) eines
// Belegs -- oder null. 'abweichend' sagt, ob der Code an eine andere
// Adresse ging als die, an die der Beleg versendet wurde.
function beleg_unterschrift_letzte(PDO $pdo, string $tabPraefix, int $belegId): ?array
{
    if (!beleg_unterschrift_tabelle_da($pdo, $tabPraefix)) { return null; }
    $s = $pdo->prepare(
        'SELECT id, fassung, art, name, funktion, firma, email, zeichnungsberechtigt, zeichnung,
                grund, empfaenger_email, code_gesendet_am, bestaetigt_am, ip, browser
           FROM ' . beleg_tabelle($tabPraefix, 'beleg_unterschrift') . '
          WHERE beleg_id = ? AND bestaetigt_am IS NOT NULL ORDER BY id DESC LIMIT 1'
    );
    $s->execute([$belegId]);
    $z = $s->fetch(PDO::FETCH_ASSOC);
    if (!$z) { return null; }
    $z['fassung'] = (int)$z['fassung'];
    // Liegt ein unterschriebenes PDF vor (Schritt 3)? Ohne es zu laden.
    $z['pdf_da'] = false;
    if (beleg_spalte_da_portabel($pdo, beleg_tabelle($tabPraefix, 'beleg_unterschrift'), 'pdf')) {
        $p = $pdo->prepare('SELECT pdf IS NOT NULL FROM ' . beleg_tabelle($tabPraefix, 'beleg_unterschrift') . ' WHERE id = ?');
        $p->execute([(int)$z['id']]);
        $z['pdf_da'] = (bool)$p->fetchColumn();
    }
    $z['abweichend'] = $z['art'] === 'annahme'
        && mb_strtolower(trim((string)$z['email'])) !== mb_strtolower(trim((string)$z['empfaenger_email']));
    // Ohne Code angenommen (ENT-708): ueber die Empfaengeradresse, es wurde
    // nie ein Code verschickt.
    $z['ohne_code'] = $z['art'] === 'annahme' && empty($z['code_gesendet_am']);
    return $z;
}

// Die Mail mit dem Code. BEWUSST OHNE eine Angabe des Unterzeichnenden:
// Der Weg nimmt Text von jemandem entgegen, der nicht angemeldet ist, und
// schickt eine Mail an eine Adresse, die er selbst nennt. Stuende sein Name
// in der Mail, liesse sich der Weg als Versandweg fuer fremde Texte
// missbrauchen. So traegt die Mail nur, was vom Absender stammt.
function beleg_code_mail(array $beleg, string $firma, string $code): array
{
    $angabe = BELEG_ARTEN[(string)($beleg['art'] ?? 'offerte')] ?? BELEG_ARTEN['offerte'];
    $titel  = (string)$angabe['titel'];
    $nummer = (string)($beleg['nummer'] ?? '');
    $von    = $firma !== '' ? $firma : 'dem Absender';
    $betreff = "Ihr Bestätigungscode: $code";
    $text = "Guten Tag\n\n"
        . "Sie möchten die $titel $nummer von $von annehmen. Ihr Bestätigungscode:\n\n"
        . "$code\n\n"
        . "Der Code gilt " . BELEG_CODE_GUELTIG_MIN . " Minuten. Geben Sie ihn auf der Seite der $titel ein.\n\n"
        . "Haben Sie nichts angefordert, können Sie diese Mail ignorieren — ohne den Code wird nichts angenommen.";
    $inhalt = mail_absatz('Guten Tag')
        . mail_absatz('Sie möchten die ' . mail_e("$titel $nummer") . ' von ' . mail_e($von)
            . ' annehmen. Ihr Bestätigungscode:')
        . mail_block(mail_feld('Bestätigungscode', mail_e($code), true), true)
        . mail_absatz('Der Code gilt ' . BELEG_CODE_GUELTIG_MIN . ' Minuten. Geben Sie ihn auf der Seite der '
            . mail_e($titel) . ' ein.')
        . mail_absatz('Haben Sie nichts angefordert, können Sie diese Mail ignorieren — ohne den Code '
            . 'wird nichts angenommen.');
    return ['betreff' => $betreff, 'text' => $text, 'html' => mail_rahmen($inhalt), 'bilder' => []];
}

// Laesst sich am Link noch entscheiden? Unterschreibbare Art, noch nicht
// entschieden, Frist nicht abgelaufen. Dieselbe Bedingung wie auf der Seite
// -- die Wache hier ist die, die traegt.
function beleg_link_offen(array $b): bool
{
    if (!beleg_unterschreibbar((string)($b['art'] ?? ''))) { return false; }
    if (!empty($b['entscheidung_am'])) { return false; }
    $frist = beleg_abbild_datum($b['gueltig_bis'] ?? null);
    return $frist === null || $frist >= date('Y-m-d');
}

// ── Der Ablauf hinter den beiden oeffentlichen Endpunkten ─────────────
//
// EINMAL HIER, fuer Betreiber und Cockpit: Die vier Endpunkte
// ({betreiber_}beleg_unterschrift_{anfordern,bestaetigen}.php) holen nur
// ihre Verbindung, ihren Absender und rufen dann diese Funktion. Zwei
// Kopien dieses Ablaufs waeren die Stelle, an der eine Seite in einem Jahr
// eine Wache weniger hat.
//
// Laeuft im Kontext eines Endpunkts: json_response(), anmeld_*() und
// smtp_*() stammen aus db.php, anmeldung.php und mailer.php.
//
// DIE BREMSE zaehlt je Beleg UND je Absenderadresse. Jede Codeanforderung
// und jeder falsche Code ist ein Versuch; nach fuenf je Beleg in fuenfzehn
// Minuten ist Pause. Damit taugt der Weg weder zum Durchprobieren des
// sechsstelligen Codes noch als Mailschleuder an beliebige Adressen.
// Die Adresse, an die der Beleg versendet wird (Haupt-E-Mail des Empfaengers).
function beleg_empfaenger_email(PDO $pdo, string $tabPraefix, $kundeId): string
{
    if (empty($kundeId)) { return ''; }
    // Unlesbar heisst hier: kein Weg ohne Code -- der Code-Weg bleibt offen.
    try {
        $k = $pdo->prepare('SELECT email FROM ' . beleg_tabelle($tabPraefix, 'kunden') . ' WHERE id = ?');
        $k->execute([(int)$kundeId]);
        return trim((string)$k->fetchColumn());
    } catch (Throwable $e) {
        return '';
    }
}

// OHNE CODE (ENT-708): Eine OFFERTE, die ueber die Empfaengeradresse
// angenommen wird, braucht keinen Code -- der Link kam an genau diese
// Adresse, wer ihn oeffnet, hat das Postfach. Der Code prueft nur eine
// FREMDE Adresse (weitergeleitete Offerte). Ein Vertrag braucht ihn immer.
function beleg_annahme_ohne_code(string $art, string $email, string $empfaenger): bool
{
    return $art === 'offerte' && $empfaenger !== ''
        && mb_strtolower(trim($email)) === mb_strtolower(trim($empfaenger));
}

function beleg_unterschrift_ablauf(string $was, PDO $pdo, string $tabPraefix, array $in,
                                   string $firma): void
{
    $token = (string)($in['token'] ?? '');
    if ($token === '') {
        json_response(['status' => 'error', 'lage' => 'link', 'message' => 'Der Link ist unvollständig.'], 400);
    }
    $tab = beleg_tabelle($tabPraefix, 'belege');
    $s = $pdo->prepare("SELECT id, art, nummer, status, kunde_id, gueltig_bis, entscheidung_am
                          FROM {$tab} WHERE versand_token = ?");
    $s->execute([$token]);
    $b = $s->fetch(PDO::FETCH_ASSOC);
    if (!$b) {
        json_response(['status' => 'error', 'lage' => 'link', 'message' => 'Dieser Link ist nicht (mehr) gültig.'], 404);
    }
    $id = (int)$b['id'];

    $name = 'beleg-code:' . $tabPraefix . $id;
    $adresse = anmeld_adresse();
    [$fName, $fAdresse] = anmeld_zaehlen(db(), $name, $adresse);
    if (anmeld_sperre($fName, $fAdresse) > 0) {
        json_response(['status' => 'error', 'lage' => 'bremse',
            'message' => 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.'], 429);
    }
    if (!beleg_unterschrift_tabelle_da($pdo, $tabPraefix) || !beleg_fassung_tabelle_da($pdo, $tabPraefix)) {
        json_response(['status' => 'error', 'lage' => 'nicht_eingerichtet',
            'message' => 'Die Annahme am Link ist hier noch nicht eingerichtet. Bitte antworten Sie auf die E-Mail.'], 503);
    }
    if (!beleg_link_offen($b)) {
        json_response(['status' => 'error', 'lage' => 'zu',
            'message' => 'Hier lässt sich nicht mehr entscheiden — der Beleg ist bereits entschieden oder abgelaufen.'], 409);
    }

    // Die Fassung, die jetzt am Link steht. Hat der Beleg noch keine
    // (versendet vor ENT-688), wird festgehalten, was er in diesem Moment
    // zeigt -- genau das wird unterschrieben.
    $fassung = beleg_letzte_fassung($pdo, $id, $tabPraefix);
    if (!$fassung) {
        $absender = $tabPraefix === 'be_' && function_exists('be_beleg_absender')
            ? be_beleg_absender($pdo) : beleg_absender_betrieb($pdo);
        $abbild = beleg_abbild_lesen($pdo, $id, $tabPraefix, $absender);
        $fassungNr = (int)beleg_fassung_anlegen($pdo, $id, $abbild, 'annahme', '', $tabPraefix)['nummer'];
    } else {
        if (!$fassung['echt']) {
            json_response(['status' => 'error', 'lage' => 'zu',
                'message' => 'Dieses Dokument lässt sich gerade nicht bestätigen. Bitte wenden Sie sich an den Absender.'], 409);
        }
        $fassungNr = (int)$fassung['nummer'];
    }

    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    $browser = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');

    // Annehmen: Status, Zeitpunkt, Fassung -- und nur, wenn nicht
    // zwischendurch jemand anders entschieden hat. Danach PDF und Mails
    // (Schritt 3); scheitert etwas davon, bleibt der Beleg angenommen.
    $annehmen = function () use ($pdo, $tab, $ip, $fassungNr, $id, $tabPraefix, $b, $firma) {
        $mitFassung = beleg_spalte_da_portabel($pdo, $tab, 'entscheidung_fassung');
        $pdo->prepare("UPDATE {$tab} SET status = 'bestaetigt', entscheidung_am = NOW(), entscheidung_ip = ?"
            . ($mitFassung ? ', entscheidung_fassung = ?' : '')
            . ' WHERE id = ? AND entscheidung_am IS NULL')
            ->execute($mitFassung ? [$ip, $fassungNr, $id] : [$ip, $id]);
        return function_exists('beleg_annahme_abschliessen')
            ? beleg_annahme_abschliessen($pdo, $tabPraefix, $id, $b, $firma,
                ($tabPraefix === 'be_' && function_exists('mail_signatur_zeilen')) ? mail_signatur_zeilen() : [])
            : null;
    };

    if ($was === 'anfordern') {
        $angaben = beleg_unterschrift_angaben($in);
        if (isset($angaben['fehler'])) {
            json_response(['status' => 'error', 'lage' => 'angaben', 'message' => $angaben['fehler']], 400);
        }
        $empfaenger = beleg_empfaenger_email($pdo, $tabPraefix, $b['kunde_id'] ?? null);

        // Offerte ueber die Empfaengeradresse: sofort angenommen (ENT-708).
        // Die Zeile traegt dann keinen Code -- code_gesendet_am bleibt leer,
        // daran erkennen Protokoll, Mails und Verlauf "ohne Code".
        if (beleg_annahme_ohne_code((string)$b['art'], $angaben['werte']['email'], $empfaenger)) {
            $u = beleg_unterschrift_anlegen($pdo, $tabPraefix, $id, $fassungNr, $angaben['werte'],
                                            $empfaenger, $ip, $browser);
            anmeld_fehlversuch(db(), $name, $adresse);
            $pdo->prepare('UPDATE ' . beleg_tabelle($tabPraefix, 'beleg_unterschrift')
                . " SET code_abdruck = '', code_gesendet_am = NULL, bestaetigt_am = NOW()"
                . ' WHERE id = ? AND bestaetigt_am IS NULL')->execute([$u['id']]);
            json_response(['status' => 'ok', 'lage' => 'angenommen', 'abschluss' => $annehmen()]);
        }

        if (!smtp_konfiguriert()) {
            json_response(['status' => 'error', 'lage' => 'mail',
                'message' => 'Der Code lässt sich gerade nicht verschicken. Bitte versuchen Sie es später erneut.'], 503);
        }
        $u = beleg_unterschrift_anlegen($pdo, $tabPraefix, $id, $fassungNr, $angaben['werte'],
                                        $empfaenger, $ip, $browser);
        anmeld_fehlversuch(db(), $name, $adresse);
        $mail = beleg_code_mail($b, $firma, $u['code']);
        try {
            smtp_senden($angaben['werte']['email'], $angaben['werte']['name'], $mail['betreff'],
                        $mail['html'], $mail['text'], [], $mail['bilder']);
        } catch (Throwable $e) {
            json_response(['status' => 'error', 'lage' => 'mail',
                'message' => 'Der Code liess sich nicht verschicken. Bitte prüfen Sie die Adresse oder versuchen Sie es später erneut.'], 502);
        }
        json_response(['status' => 'ok', 'id' => $u['id'], 'an' => $angaben['werte']['email'],
            'gueltig_min' => BELEG_CODE_GUELTIG_MIN]);
    }

    // bestaetigen
    $lage = beleg_unterschrift_pruefen($pdo, $tabPraefix, $id, (int)($in['id'] ?? 0),
                                       (string)($in['code'] ?? ''), $fassungNr);
    if ($lage !== 'ok') {
        if ($lage === 'falsch' || $lage === 'gesperrt') { anmeld_fehlversuch(db(), $name, $adresse); }
        $texte = [
            'falsch'     => 'Der Code stimmt nicht. Bitte prüfen Sie die Eingabe.',
            'gesperrt'   => 'Zu viele falsche Eingaben. Bitte fordern Sie einen neuen Code an.',
            'abgelaufen' => 'Der Code ist abgelaufen. Bitte fordern Sie einen neuen an.',
            'fassung'    => 'Inzwischen liegt eine neue Fassung vor. Bitte laden Sie die Seite neu und prüfen Sie sie.',
            'unbekannt'  => 'Diese Anfrage ist nicht mehr gültig. Bitte beginnen Sie neu.',
            'schon'      => 'Diese Annahme ist bereits bestätigt.',
        ];
        json_response(['status' => 'error', 'lage' => $lage, 'message' => $texte[$lage] ?? 'Nicht möglich.'],
            $lage === 'schon' ? 409 : 400);
    }
    // Erst mit dem richtigen Code wird der Beleg angenommen.
    json_response(['status' => 'ok', 'lage' => 'ok', 'abschluss' => $annehmen()]);
}

// Gibt es eine Spalte? Auf MySQL und SQLite gleich (LIMIT 0).
function beleg_spalte_da_portabel(PDO $pdo, string $tabelle, string $spalte): bool
{
    try {
        $pdo->query("SELECT {$spalte} FROM {$tabelle} LIMIT 0");
        return true;
    } catch (Throwable $e) {
        return false;
    }
}

// ── Was die oeffentliche Seite dazu zeigt ─────────────────────────────
//
// Beide oeffentlichen Seiten (Betreiber und Cockpit) zeigen denselben
// Dialog und dasselbe Protokoll -- darum hier und nicht zweimal.

function beleg_h(?string $s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

function beleg_zeitpunkt(?string $roh): string
{
    $t = strtotime((string)$roh);
    return ($roh && $t) ? date('d.m.Y, H:i', $t) . ' Uhr' : '–';
}

// Die Zeilen des Pruefprotokolls einer Annahme (ENT-688, Punkt 8), als
// [Beschriftung, Wert]. Getrennt vom HTML, damit Seite und spaeter das PDF
// (Schritt 3) dieselben Angaben in derselben Reihenfolge zeigen.
function beleg_pruefprotokoll_zeilen(array $beleg, array $fassung, array $u): array
{
    $titel = (string)(BELEG_ARTEN[(string)($beleg['art'] ?? 'offerte')]['titel'] ?? 'Beleg');
    $versendet = beleg_zeitpunkt($fassung['versendet_am'] ?? null);
    if (trim((string)($fassung['versendet_von'] ?? '')) !== '') {
        $versendet .= ' von ' . $fassung['versendet_von'];
    }
    if (!empty($fassung['freigegeben'])) { $versendet .= ', ausdrücklich freigegeben'; }
    $wer = implode(', ', array_filter([(string)$u['name'], (string)$u['funktion'], (string)$u['firma']],
        static fn($t) => trim($t) !== ''));
    $codeAn = (string)$u['email'];
    if (!empty($u['abweichend'])) {
        $codeAn .= ' — weicht von der Empfängeradresse des Belegs ab ('
            . ((string)$u['empfaenger_email'] !== '' ? $u['empfaenger_email'] : 'keine hinterlegt') . ')';
    }
    return [
        ['Dokument', $titel . ' ' . ($beleg['nummer'] ?? '') . ', Fassung ' . (int)($fassung['nummer'] ?? 0)],
        ['Prüfsumme (SHA-256)', (string)($fassung['pruefsumme'] ?? '')],
        ['Versendet', $versendet],
        ['Angenommen von', $wer],
        ['Erklärung', 'Zeichnungsberechtigung bestätigt'],
        ...(!empty($u['ohne_code'])
            // Ohne Code (ENT-708): Der Nachweis ist der Link an diese Adresse.
            ? [['Bestätigt über', 'Link in der E-Mail an ' . (string)$u['email'] . ' (Empfängeradresse, ohne Code)']]
            : [['Bestätigungscode an', $codeAn],
               ['Code angefordert', beleg_zeitpunkt($u['code_gesendet_am'] ?? null)]]),
        ['Bestätigt', beleg_zeitpunkt($u['bestaetigt_am'] ?? null)],
        ['IP-Adresse', (string)$u['ip'] !== '' ? (string)$u['ip'] : '–'],
        ['Browser', (string)$u['browser'] !== '' ? (string)$u['browser'] : '–'],
    ];
}

// Die Quittung fuer den Kunden (ENT-710). Das Pruefprotokoll mit
// Pruefsumme, IP-Adresse und Browser verwirrt den Kunden eher, als dass es
// ihm etwas nachweist -- er sieht darum nur diesen einen Satz, dezent am
// Ende des Dokuments. Das volle Protokoll bleibt intern (beleg_pdf() mit
// $mitProtokoll, die internen PDF-Endpunkte und die interne Mail).
//
// $firma ist die Absenderin: Sie bewahrt den Nachweis auf, und der Satz
// sagt das, damit "kein Protokoll" nicht wie "kein Nachweis" aussieht.
function beleg_annahme_quittung(array $u, string $firma): string
{
    $t = strtotime((string)($u['bestaetigt_am'] ?? ''));
    $am = $t ? date('d.m.Y', $t) . ' um ' . date('H:i', $t) . ' Uhr' : '';
    $wer = implode(', ', array_filter([(string)($u['name'] ?? ''), (string)($u['funktion'] ?? ''),
        (string)($u['firma'] ?? '')], static fn($x) => trim($x) !== ''));
    $satz = 'Elektronisch angenommen' . ($am !== '' ? ' am ' . $am : '') . ($wer !== '' ? ' von ' . $wer : '') . '.';
    return $satz . (trim($firma) !== ''
        ? ' Den vollständigen Nachweis der Annahme bewahrt ' . trim($firma) . ' auf.'
        : ' Der vollständige Nachweis der Annahme wird aufbewahrt.');
}

function beleg_annahme_quittung_html(array $u, string $firma): string
{
    return '<div id="annahmequittung" style="margin-top:14px;padding-top:10px;border-top:1px solid #E5E8EC;'
        . 'font-size:10.5px;line-height:1.5;color:#6B7280;page-break-inside:avoid;break-inside:avoid">'
        . beleg_h(beleg_annahme_quittung($u, $firma)) . '</div>';
}

// Der Satz unter dem internen Protokoll. Ohne Code (ENT-708) war der Weg
// der Link an die Empfaengeradresse -- dann darf dort nicht "mit
// Bestaetigungscode" stehen.
function beleg_pruefprotokoll_fussnote(array $u): string
{
    return (!empty($u['ohne_code'])
            ? 'Einfache elektronische Signatur über den persönlichen Link in der E-Mail an die Empfängeradresse. '
            : 'Einfache elektronische Signatur mit Bestätigungscode per E-Mail. ')
        . 'Die Prüfsumme weist nach, dass das angenommene Dokument seit der Annahme unverändert ist.';
}

// Der Unterschriftsdialog (ENT-688: Dialog ueber der Seite, zwei Schritte)
// und der Ablehnen-Dialog.
//
// $info: art, nummer, fassung, firma (des Empfaengers, zum Vorbelegen),
// endpunkt (JSON), entscheid (Formularziel fuers Ablehnen), token.
//
// OHNE JAVASCRIPT keine Annahme: Code anfordern, zeichnen und bestaetigen
// brauchen es. Das steht dann ausdruecklich da, statt dass ein Knopf nichts
// tut.
function beleg_unterschrift_dialog_html(array $info): string
{
    $titel = (string)(BELEG_ARTEN[(string)$info['art']]['titel'] ?? 'Beleg');
    $was   = $titel . ' ' . $info['nummer'] . ($info['fassung'] > 1 ? ', Fassung ' . (int)$info['fassung'] : '');
    $feld  = 'width:100%;box-sizing:border-box;font:inherit;font-size:16px;border:1px solid #D6DAE0;'
           . 'border-radius:8px;padding:10px;margin:4px 0 12px';
    $lab   = 'display:block;font-size:12px;font-weight:600;color:#374151';
    // Ohne Code (ENT-708): nur die Offerte, nur ueber die Empfaengeradresse.
    // Die Adresse steht vorbelegt im Feld; wer sie aendert, bekommt den Code.
    $empf = trim((string)($info['empfaenger'] ?? ''));
    $ohneCode = (string)$info['art'] === 'offerte' && $empf !== '';
    $js = [
        'endpunkt' => (string)$info['endpunkt'],
        'token'    => (string)$info['token'],
        'titel'    => $titel,
        'was'      => $was,
        'empfaenger' => $ohneCode ? mb_strtolower($empf) : '',
    ];
    return '<div class="uz-huelle keindruck" id="uzHuelle" role="dialog" aria-modal="true" aria-labelledby="uzTitel">'
        . '<div class="uz-karte">'
        // Schritt 1: Angaben
        . '<div id="uzSchritt1">'
        . '<h2 id="uzTitel" style="font-size:18px;margin:0 0 4px">' . beleg_h($titel) . ' annehmen</h2>'
        . '<p style="font-size:13px;color:#6B7280;margin:0 0 16px">' . beleg_h($was)
        . ($ohneCode
            ? '. Mit Ihrer Adresse, an die die Offerte ging, gilt die Annahme sofort. Tragen Sie eine andere Adresse ein, schicken wir dorthin einen Code.</p>'
            : '. Wir schicken Ihnen einen Code per E-Mail; erst mit ihm ist die Annahme gültig.</p>')
        . '<label style="' . $lab . '">Name *<input id="uzName" autocomplete="name" maxlength="120" style="' . $feld . '"></label>'
        . '<label style="' . $lab . '">Funktion *<input id="uzFunktion" autocomplete="organization-title" maxlength="120" placeholder="z. B. Geschäftsführer" style="' . $feld . '"></label>'
        . '<label style="' . $lab . '">Firma<input id="uzFirma" autocomplete="organization" maxlength="200" value="'
        . beleg_h((string)$info['firma']) . '" style="' . $feld . '"></label>'
        . '<label style="' . $lab . '">Ihre E-Mail-Adresse *<input id="uzEmail" type="email" autocomplete="email" maxlength="200" value="'
        . beleg_h($ohneCode ? $empf : '') . '" oninput="uzKnopf()" style="' . $feld . '"></label>'
        . '<div style="' . $lab . ';margin-bottom:6px">Unterschrift <span style="font-weight:400;color:#6B7280">(freiwillig)</span></div>'
        . '<div id="uzZeichnung" style="margin-bottom:14px"></div>'
        . '<label style="display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.45;margin-bottom:16px">'
        . '<input type="checkbox" id="uzBerechtigt" style="width:20px;height:20px;margin-top:1px;flex:0 0 auto">'
        . '<span>Ich bin berechtigt, für die genannte Firma zu unterzeichnen, und nehme die ' . beleg_h($was)
        . ' verbindlich an.</span></label>'
        . '<div id="uzFehler1" class="hinweis hinweis-ab" style="display:none;margin:0 0 12px"></div>'
        . '<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">'
        . '<button type="button" class="knopf knopf-plain" onclick="uzZu()">Abbrechen</button>'
        . '<button type="button" class="knopf knopf-an" id="uzAnfordern" onclick="uzAnfordern()">'
        . ($ohneCode ? 'Verbindlich annehmen' : 'Code anfordern') . '</button>'
        . '</div></div>'
        // Schritt 2: Code
        . '<div id="uzSchritt2" style="display:none">'
        . '<h2 style="font-size:18px;margin:0 0 4px">Code eingeben</h2>'
        . '<p style="font-size:13px;color:#6B7280;margin:0 0 16px" id="uzCodeText"></p>'
        . '<label style="' . $lab . '">Bestätigungscode<input id="uzCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" '
        . 'style="' . $feld . ';font-size:22px;letter-spacing:6px;text-align:center"></label>'
        . '<div id="uzFehler2" class="hinweis hinweis-ab" style="display:none;margin:0 0 12px"></div>'
        . '<div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;align-items:center">'
        . '<button type="button" class="knopf knopf-plain" onclick="uzSchritt(1)">Zurück</button>'
        . '<button type="button" class="knopf knopf-an" id="uzBestaetigen" onclick="uzBestaetigen()">Verbindlich annehmen</button>'
        . '</div></div>'
        . '</div></div>'
        // Ablehnen
        . '<div class="uz-huelle keindruck" id="uzAbHuelle" role="dialog" aria-modal="true" aria-labelledby="uzAbTitel">'
        . '<div class="uz-karte"><form method="post" action="' . beleg_h((string)$info['entscheid']) . '">'
        . '<input type="hidden" name="token" value="' . beleg_h((string)$info['token']) . '">'
        . '<input type="hidden" name="entscheidung" value="ablehnen">'
        . '<h2 id="uzAbTitel" style="font-size:18px;margin:0 0 4px">' . beleg_h($titel) . ' ablehnen</h2>'
        . '<p style="font-size:13px;color:#6B7280;margin:0 0 16px">' . beleg_h($was) . '</p>'
        . '<label style="' . $lab . '">Name *<input name="name" required maxlength="120" autocomplete="name" style="' . $feld . '"></label>'
        . '<label style="' . $lab . '">Grund <span style="font-weight:400;color:#6B7280">(freiwillig)</span>'
        . '<textarea name="grund" maxlength="4000" rows="4" placeholder="z. B. zu teuer, anderer Anbieter" style="' . $feld . '"></textarea></label>'
        . '<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">'
        . '<button type="button" class="knopf knopf-plain" onclick="uzAbZu()">Abbrechen</button>'
        . '<button type="submit" class="knopf knopf-ab">Ablehnen</button>'
        . '</div></form></div></div>'
        . '<noscript><div class="hinweis hinweis-versendet" style="margin-top:14px">Für die Annahme am Link wird '
        . 'JavaScript benötigt. Bitte aktivieren Sie es oder antworten Sie auf die E-Mail.</div></noscript>'
        . '<script src="/unterschrift.js"></script>'
        . '<script>(function(){var C=' . json_encode($js, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) . ';'
        . 'var $=function(i){return document.getElementById(i);};var zeile=0;'
        . 'function fehler(n,t){var e=$("uzFehler"+n);e.textContent=t||"";e.style.display=t?"":"none";}'
        . 'window.uzSchritt=function(n){$("uzSchritt1").style.display=n===1?"":"none";'
        . '$("uzSchritt2").style.display=n===2?"":"none";fehler(1,"");fehler(2,"");'
        . 'if(n===2){$("uzCode").focus();}};'
        . 'function direkt(){return !!C.empfaenger&&$("uzEmail").value.trim().toLowerCase()===C.empfaenger;}'
        . 'window.uzKnopf=function(){$("uzAnfordern").textContent=direkt()?"Verbindlich annehmen":"Code anfordern";};'
        . 'var eingerichtet=false;'
        . 'window.uzAnnehmen=function(){$("uzHuelle").classList.add("an");uzSchritt(1);'
        . 'if(!eingerichtet&&window.Unterschrift){eingerichtet=true;Unterschrift.einrichten({ziel:"uzZeichnung",kraeftig:true,'
        . 'kontext:function(){return{zeilen:[C.was,$("uzFirma").value],name:$("uzName").value};}});}'
        . 'setTimeout(function(){$("uzName").focus();},30);};'
        . 'window.uzZu=function(){$("uzHuelle").classList.remove("an");};'
        . 'window.uzAblehnen=function(){$("uzAbHuelle").classList.add("an");};'
        . 'window.uzAbZu=function(){$("uzAbHuelle").classList.remove("an");};'
        . 'function senden(daten){daten.token=C.token;return fetch(C.endpunkt,{method:"POST",'
        . 'headers:{"Content-Type":"application/json"},body:JSON.stringify(daten)})'
        . '.then(function(r){return r.json().catch(function(){return{status:"error",message:"Unerwartete Antwort."};});})'
        . '.catch(function(){return{status:"error",message:"Keine Verbindung. Bitte erneut versuchen."};});}'
        . 'window.uzAnfordern=function(){var k=$("uzAnfordern");k.disabled=true;fehler(1,"");'
        . 'senden({was:"anfordern",name:$("uzName").value,funktion:$("uzFunktion").value,firma:$("uzFirma").value,'
        . 'email:$("uzEmail").value,zeichnungsberechtigt:$("uzBerechtigt").checked?1:0,'
        . 'zeichnung:(window.Unterschrift&&Unterschrift.daten())||""}).then(function(a){k.disabled=false;'
        . 'if(a.status!=="ok"){fehler(1,a.message||"Das hat nicht geklappt.");return;}'
        . 'if(a.lage==="angenommen"){location.reload();return;}zeile=a.id;'
        . '$("uzCodeText").textContent="Wir haben einen Code an "+a.an+" geschickt. Er gilt "+a.gueltig_min+" Minuten.";'
        . '$("uzCode").value="";uzSchritt(2);});};'
        . 'window.uzBestaetigen=function(){var k=$("uzBestaetigen");k.disabled=true;fehler(2,"");'
        . 'senden({was:"bestaetigen",id:zeile,code:$("uzCode").value}).then(function(a){k.disabled=false;'
        . 'if(a.status==="ok"||a.lage==="schon"){location.reload();return;}'
        . 'fehler(2,a.message||"Das hat nicht geklappt.");'
        . 'if(a.lage==="gesperrt"||a.lage==="abgelaufen"||a.lage==="unbekannt"){zeile=0;}});};'
        . 'document.addEventListener("keydown",function(e){if(e.key==="Escape"){uzZu();uzAbZu();}});'
        . '})();</script>';
}

// Das CSS dazu. Eigene Funktion, weil es in den <style>-Block der Seite
// gehoert und nicht mitten ins Dokument.
function beleg_unterschrift_css(): string
{
    return '.uz-huelle{position:fixed;inset:0;background:rgba(20,22,26,.45);display:none;'
        . 'align-items:flex-start;justify-content:center;padding:40px 16px;z-index:50;overflow-y:auto}'
        . '.uz-huelle.an{display:flex}'
        // Jeder Knopf im Dialog mindestens 44 px, auch wenn er allein in
        // einer Zeile steht (am Handy bricht "Verbindlich annehmen" um).
        . '.uz-karte .knopf{min-height:44px}'
        . '.uz-karte{background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.2);'
        . 'width:100%;max-width:460px;padding:26px 24px;box-sizing:border-box}'
        . '.knopf:disabled{opacity:.6;cursor:default}'
        . '@media print{.uz-huelle{display:none!important}}';
}

// Was nach einer Annahme auf den Unterschriftslinien steht, als fertiges
// HTML: 'kunde', 'absender', 'ort'. Leer, solange nichts angenommen ist --
// dann bleiben die Linien zum Ausdrucken und Unterschreiben von Hand.
//
// Der getippte Name steht in einer Schreibschrift, damit er als
// Unterschrift lesbar ist und nicht wie eine Beschriftung. Es ist KEINE
// Nachbildung einer Handschrift: Die Beweiskraft kommt aus Code und
// Protokoll (ENT-688, Punkt 5).
function beleg_unterschrift_linien(?array $u, ?array $fassung, bool $angenommen): array
{
    // Unsere gezeichnete Unterschrift aus der Freigabe (ENT-704) steht schon
    // VOR der Annahme da: freigegeben ist, was der Link zeigt.
    $fu = ($fassung && !empty($fassung['freigegeben'])) ? beleg_freigabe_unterschrift((array)($fassung['abbild'] ?? [])) : null;
    // AUF DER LINIE (ENT-706): Das Bild ragt um ein Fuenftel ueber die Linie
    // hinaus. Sein unterer Rand ist Luft und Unterlaenge, nicht die
    // Grundlinie der Schrift -- ohne das schwebt die Unterschrift darueber.
    // Um den Anteil unter der Grundlinie nach unten geschoben (translateY in
    // Prozent bezieht sich auf die Hoehe des Bildes selbst).
    $aufLinie = static fn(string $url): string => 'max-height:64px;max-width:100%;position:relative;transform:translateY('
        . round(beleg_unterschrift_grundlinie($url) * 100, 1) . '%)';
    $bildAbsender = $fu ? '<img src="' . beleg_h($fu['bild']) . '" alt="Unterschrift ' . beleg_h($fu['name'])
        . '" style="' . $aufLinie($fu['bild']) . '">' : '';
    // Die Beschriftung unter der Linie rueckt so weit nach unten, wie eine
    // Unterschrift darunter reicht (hoechstens 64 px Bild).
    $abstand = static fn(array $urls): int => max(16, (int)round(64 * max(array_merge([0.0],
        array_map('beleg_unterschrift_grundlinie', array_filter($urls))))) + 8);
    $leer = ['kunde' => '', 'absender' => $bildAbsender, 'ort' => '',
             'abstand' => $abstand([$fu['bild'] ?? ''])];
    if (!$angenommen || !$u || $u['art'] !== 'annahme') { return $leer; }
    $schrift = 'font-family:\'Segoe Script\',\'Brush Script MT\',\'Snell Roundhand\',cursive;font-size:21px;line-height:1.1;padding-bottom:4px';
    $kunde = !empty($u['zeichnung'])
        ? '<img src="' . beleg_h((string)$u['zeichnung']) . '" alt="Unterschrift" style="' . $aufLinie((string)$u['zeichnung']) . '">'
        : '<span style="' . $schrift . '">' . beleg_h((string)$u['name']) . '</span>';
    $absender = $bildAbsender !== '' ? $bildAbsender
        : (($fassung && !empty($fassung['freigegeben']) && trim((string)$fassung['versendet_von']) !== '')
            ? '<span style="' . $schrift . '">' . beleg_h((string)$fassung['versendet_von']) . '</span>'
            : '');
    $t = strtotime((string)$u['bestaetigt_am']);
    return ['kunde' => $kunde, 'absender' => $absender,
            'ort' => 'Elektronisch angenommen am ' . ($t ? date('d.m.Y', $t) : '–'),
            'abstand' => $abstand([$fu['bild'] ?? '', (string)($u['zeichnung'] ?? '')])];
}

// Die Unterschrift fuer das Formular: alles ausser Zeichnung, IP und Browser.
function beleg_unterschrift_kurz(?array $u): ?array
{
    if (!$u) { return null; }
    return [
        'art' => (string)$u['art'], 'fassung' => (int)$u['fassung'], 'name' => (string)$u['name'],
        'funktion' => (string)$u['funktion'], 'firma' => (string)$u['firma'], 'email' => (string)$u['email'],
        'empfaenger_email' => (string)$u['empfaenger_email'], 'abweichend' => (bool)$u['abweichend'],
        'grund' => (string)($u['grund'] ?? ''), 'bestaetigt_am' => (string)$u['bestaetigt_am'],
        'pdf_da' => (bool)($u['pdf_da'] ?? false), 'ohne_code' => (bool)($u['ohne_code'] ?? false),
    ];
}

// ── Verlauf am Beleg (ENT-697) ────────────────────────────────────────────
//
// WER HAT WAS WANN GESENDET, WAS HAT DER EMPFAENGER GETAN. Der Stand eines
// Belegs steht an vier Stellen: im Logbuch (interne Schritte), in den
// Fassungen, in den Unterschriftszeilen und -- nur Betreiber -- im Faden.
// beleg_verlauf() liest sie zusammen, damit wer uebernimmt nicht nachfragen
// muss. Geschrieben wird hier nichts; jede Quelle bleibt, wie sie ist.
//
// DAS OEFFNEN DES LINKS STEHT BEWUSST NICHT DARIN (ENT-697, Punkt 4):
// Mailprogramme und Virenscanner oeffnen Links selbst. Ein angeforderter
// Code belegt das Oeffnen ohnehin.

// Die Felder aus $kopf der beiden Speicher-Endpunkte, wie sie im Formular
// heissen. Ein Feld, das hier fehlt, erscheint mit seinem Spaltennamen --
// sichtbar statt verschluckt.
const BELEG_VERLAUF_FELDER = [
    'kunde_id' => 'Empfänger', 'person_id' => 'Kontaktperson', 'titel' => 'Titel',
    'referenz' => 'Referenz', 'datum' => 'Datum', 'gueltig_bis' => 'Gültig bis',
    'faellig_bis' => 'Fällig am', 'status' => 'Status', 'bemerkung' => 'Interne Bemerkung',
    'ist_vorlage' => 'Vorlage', 'unterschriftsseite' => 'Unterschriftsfelder',
    'oeffentliche_notizen' => 'Öffentliche Notizen', 'bedingungen' => 'Bedingungen',
    'fusszeile_text' => 'Fusszeile', 'vertrag_beginn' => 'Vertragsbeginn',
    'mindestlaufzeit_monate' => 'Mindestlaufzeit (Monate)',
    'kuendigungsfrist_monate' => 'Kündigungsfrist (Monate)',
    'verlaengerung_monate' => 'Verlängerung (Monate)',
    'positionen' => 'Positionen', 'summe' => 'Total',
];
const BELEG_VERLAUF_STATUS = [
    'entwurf' => 'Entwurf', 'versendet' => 'Versendet', 'angeschaut' => 'Angeschaut',
    'aenderung' => 'Änderungswunsch', 'bestaetigt' => 'Bestätigt', 'abgelehnt' => 'Abgelehnt',
];
// Verweise auf andere Tabellen: Die Nummer allein sagt niemandem etwas.
const BELEG_VERLAUF_VERWEISE = ['kunde_id', 'person_id'];
// Ja/Nein-Felder.
const BELEG_VERLAUF_SCHALTER = ['ist_vorlage', 'unterschriftsseite'];

// Ein Abdruck von Positionen UND Gesamtrabatt. Die Positionen werden bei
// jedem Speichern neu geschrieben (beleg_positionen_schreiben), ein
// Zeilenvergleich ergaebe Rauschen (ENT-614). Der Abdruck sagt nur, OB sich
// etwas geaendert hat -- das genuegt fuer die Zeile "Positionen geaendert".
function beleg_positionen_abdruck(PDO $pdo, int $belegId, string $tabPraefix = ''): string
{
    $tab = beleg_tabelle($tabPraefix, 'beleg_positionen');
    $s = $pdo->prepare(
        "SELECT produkt_id, produkt_name, beschreibung, menge, einheit, einzelpreis_rappen,
                rabatt_bp, mwst_satz_bp" . (beleg_periode_spalte_da($pdo, $tabPraefix) ? ', periode' : '') . "
           FROM {$tab} WHERE beleg_id = ? ORDER BY sortierung, id"
    );
    $s->execute([$belegId]);
    $zeilen = array_map(fn($z) => array_map(fn($w) => $w === null ? null : (string)$w, $z),
                        $s->fetchAll(PDO::FETCH_ASSOC) ?: []);
    $k = $pdo->prepare('SELECT rabatt_bp, total_rappen FROM ' . beleg_tabelle($tabPraefix, 'belege') . ' WHERE id = ?');
    $k->execute([$belegId]);
    $kopf = $k->fetch(PDO::FETCH_ASSOC) ?: [];
    return hash('sha256', json_encode([$zeilen, (string)($kopf['rabatt_bp'] ?? '')]))
        . ':' . (int)($kopf['total_rappen'] ?? 0);
}

// Schreibt nach dem Speichern, was sich an Positionen und Total geaendert
// hat. Zwei Zeilen hoechstens: "Positionen: geaendert" (ohne Werte) und
// "Total: alt -> neu". Braucht logbuch.php.
function beleg_positionen_loggen(PDO $pdo, array $akteur, int $belegId, string $vorher,
                                 string $nachher, string $tabPraefix = ''): void
{
    if ($vorher === '' || $vorher === $nachher) { return; }
    [$abdAlt, $totAlt] = explode(':', $vorher) + [1 => '0'];
    [$abdNeu, $totNeu] = explode(':', $nachher) + [1 => '0'];
    if ($abdAlt !== $abdNeu) {
        logbuch_schreiben($pdo, $akteur, 'beleg', $belegId, 'positionen', null, null, true, $tabPraefix);
    }
    if ((int)$totAlt !== (int)$totNeu) {
        logbuch_schreiben($pdo, $akteur, 'beleg', $belegId, 'summe',
            'CHF ' . beleg_chf((int)$totAlt), 'CHF ' . beleg_chf((int)$totNeu), false, $tabPraefix);
    }
}

function beleg_chf(int $rappen): string
{
    $neg = $rappen < 0;
    $s = number_format(abs($rappen) / 100, 2, '.', "'");
    return ($neg ? '-' : '') . $s;
}

function beleg_verlauf_auszug(string $text, int $max = 160): string
{
    $t = trim((string)preg_replace('/\s+/u', ' ', $text));
    return mb_strlen($t) > $max ? rtrim(mb_substr($t, 0, $max - 1)) . '…' : $t;
}

// Eine Feldaenderung lesbar machen: Verweise ohne Nummer, Schalter als
// Ja/Nein, Status mit seinem Titel.
function beleg_verlauf_detail(array $e): array
{
    $feld = (string)$e['feld'];
    $alt = $e['wert_alt']; $neu = $e['wert_neu'];
    $verborgen = !empty($e['werte_verborgen']) || in_array($feld, BELEG_VERLAUF_VERWEISE, true);
    if (in_array($feld, BELEG_VERLAUF_SCHALTER, true)) {
        $alt = $alt === '1' ? 'ja' : 'nein';
        $neu = $neu === '1' ? 'ja' : 'nein';
    } elseif ($feld === 'status') {
        $alt = BELEG_VERLAUF_STATUS[(string)$alt] ?? $alt;
        $neu = BELEG_VERLAUF_STATUS[(string)$neu] ?? $neu;
    }
    return [
        'feld' => BELEG_VERLAUF_FELDER[$feld] ?? $feld,
        'alt' => $verborgen ? null : (($alt === null || $alt === '') ? '' : (string)$alt),
        'neu' => $verborgen ? null : (($neu === null || $neu === '') ? '' : (string)$neu),
        'verborgen' => $verborgen,
    ];
}

// Der ganze Verlauf eines Belegs, neueste zuoberst.
//
// $beleg: die Zeile aus belege/be_belege (id, status, entscheidung_am).
// $nachrichten: der Faden (nur Betreiber), null = es gibt keinen.
//
// Jeder Eintrag: zeit, wer, wer_art ('intern' | 'empfaenger' | 'auto'),
// was, ton ('' | 'pos' | 'neg'), details (aufklappbar, sonst leer).
//
// Dazu, was UNBEKANNT ist -- das darf nicht wie "nichts passiert" aussehen:
//   log_da:     gibt es das Logbuch auf diesem Server?
//   vor_log:    ist der Beleg aelter als die Erfassung (kein "angelegt")?
//   log_seit:   seit wann werden Belege erfasst (erster Eintrag), oder null.
function beleg_verlauf(PDO $pdo, array $beleg, string $tabPraefix = '', ?array $nachrichten = null): array
{
    $id = (int)$beleg['id'];
    $eintraege = [];
    $n = 0;
    $neu = function (string $zeit, string $wer, string $art, string $was, string $ton = '',
                     array $details = []) use (&$eintraege, &$n): void {
        $eintraege[] = ['zeit' => $zeit, 'wer' => $wer, 'wer_art' => $art, 'was' => $was,
                        'ton' => $ton, 'details' => $details, '_n' => $n++];
    };

    // ── Fassungen
    $fassungen = [];
    if (beleg_fassung_tabelle_da($pdo, $tabPraefix)) {
        $s = $pdo->prepare('SELECT nummer, anlass, versendet_am, versendet_von FROM '
            . beleg_tabelle($tabPraefix, 'beleg_fassung') . ' WHERE beleg_id = ? ORDER BY nummer');
        $s->execute([$id]);
        foreach ($s->fetchAll(PDO::FETCH_ASSOC) ?: [] as $f) {
            $fassungen[] = $f + ['_zeit' => strtotime((string)$f['versendet_am']) ?: 0, '_benutzt' => false];
        }
    }

    // ── Logbuch
    $logDa = logbuch_tabelle_da($pdo, $tabPraefix);
    $log = $logDa ? array_reverse(logbuch_lesen($pdo, 'beleg', $id, 1000, $tabPraefix)) : [];
    $angelegt = false;
    $gruppen = [];   // Feldaenderungen je Person und Sekunde
    foreach ($log as $e) {
        $feld = (string)$e['feld'];
        $zeit = (string)$e['zeitpunkt'];
        $wer  = (string)$e['akteur_name'];
        switch ($feld) {
            case 'angelegt':
                $angelegt = true;
                $neu($zeit, $wer, 'intern', 'Angelegt' . (str_contains((string)$e['wert_neu'], 'Doppel von')
                    ? ' als Doppel von ' . trim(explode('Doppel von', (string)$e['wert_neu'])[1]) : ''));
                break;
            case 'fassung':
                // Steht als Fassung da (siehe unten) -- sonst doppelt.
                break;
            case 'nachricht':
                // Steht im Faden mit Wortlaut -- ausser es gibt ihn nicht.
                if ($nachrichten === null) { $neu($zeit, $wer, 'intern', 'Antwort an den Empfänger gesendet'); }
                break;
            case 'versendet':
                // Gehoert zu einer Fassung, die in derselben Anfrage entstand?
                $t = strtotime($zeit) ?: 0;
                $treffer = null;
                foreach ($fassungen as $i => $f) {
                    if (!$f['_benutzt'] && abs($f['_zeit'] - $t) <= 10) { $treffer = $i; break; }
                }
                $an = trim((string)$e['wert_neu']);
                if ($treffer !== null) {
                    $fassungen[$treffer]['_benutzt'] = true;
                    $neu($zeit, $wer, 'intern', 'Fassung ' . (int)$fassungen[$treffer]['nummer']
                        . ' versendet' . ($an !== '' ? ' an ' . $an : ''));
                } else {
                    $stand = 0;
                    foreach ($fassungen as $f) { if ($f['_zeit'] <= $t + 10) { $stand = (int)$f['nummer']; } }
                    $neu($zeit, $wer, 'intern', 'Erneut versendet' . ($stand ? ' (Fassung ' . $stand . ')' : '')
                        . ($an !== '' ? ' an ' . $an : ''));
                }
                break;
            case 'bezahlt':
                $neu($zeit, $wer, 'intern', str_starts_with((string)$e['wert_neu'], 'bezahlt')
                    ? 'Als ' . (string)$e['wert_neu'] . ' markiert' : 'Wieder als offen markiert');
                break;
            case 'zustand':
                $neu($zeit, $wer, 'intern', (string)$e['wert_neu'] === 'archiviert' ? 'Archiviert' : 'Aus dem Archiv geholt');
                break;
            default:
                $schluessel = (int)$e['akteur_id'] . '|' . $zeit;
                if (!isset($gruppen[$schluessel])) {
                    $gruppen[$schluessel] = ['zeit' => $zeit, 'wer' => $wer, 'zeilen' => []];
                }
                $gruppen[$schluessel]['zeilen'][] = $e;
        }
    }
    foreach ($gruppen as $g) {
        $details = array_map('beleg_verlauf_detail', $g['zeilen']);
        if (count($details) === 1) {
            $d = $details[0];
            $was = $d['feld'] === 'Status' && !$d['verborgen']
                ? 'Status: ' . ($d['alt'] !== '' ? $d['alt'] : '–') . ' → ' . $d['neu']
                : $d['feld'] . ' geändert';
            // Eine einzelne Aenderung steht ausgeschrieben da, sofern sie
            // kurz ist; lange Texte bleiben zum Aufklappen.
            $kurz = !$d['verborgen'] && mb_strlen((string)$d['alt']) <= 40 && mb_strlen((string)$d['neu']) <= 40;
            if ($d['feld'] !== 'Status' && $kurz) {
                $was = $d['feld'] . ': ' . ($d['alt'] !== '' ? $d['alt'] : '–') . ' → ' . ($d['neu'] !== '' ? $d['neu'] : '–');
                $details = [];
            } elseif ($d['feld'] === 'Status') {
                $details = [];
            }
            $neu($g['zeit'], $g['wer'], 'intern', $was, '', $details);
        } else {
            $neu($g['zeit'], $g['wer'], 'intern', count($details) . ' Felder geändert', '', $details);
        }
    }

    // ── Fassungen, die keinem Versand-Eintrag zugeordnet sind: vor dem
    // Logbuch versendet, oder bei einer Entscheidung festgehalten.
    foreach ($fassungen as $f) {
        if ($f['_benutzt']) { continue; }
        if ((string)$f['anlass'] === 'annahme') {
            $neu((string)$f['versendet_am'], '', 'auto',
                'Fassung ' . (int)$f['nummer'] . ' festgehalten, so wie der Empfänger sie bei seiner Entscheidung sah');
        } else {
            $neu((string)$f['versendet_am'], (string)$f['versendet_von'], 'intern',
                'Fassung ' . (int)$f['nummer'] . ' versendet');
        }
    }

    // ── Was der Empfaenger getan hat
    $entschieden = false;
    if (beleg_unterschrift_tabelle_da($pdo, $tabPraefix)) {
        $s = $pdo->prepare('SELECT fassung, art, name, funktion, firma, email, zeichnungsberechtigt,
                                   grund, empfaenger_email, code_gesendet_am, code_versuche, bestaetigt_am, erstellt_am
                              FROM ' . beleg_tabelle($tabPraefix, 'beleg_unterschrift') . '
                             WHERE beleg_id = ? ORDER BY id');
        $s->execute([$id]);
        foreach ($s->fetchAll(PDO::FETCH_ASSOC) ?: [] as $u) {
            $name = (string)$u['name'];
            $fnr = (int)$u['fassung'];
            if ($u['art'] === 'ablehnung') {
                $entschieden = true;
                $grund = beleg_verlauf_auszug((string)($u['grund'] ?? ''));
                $neu((string)($u['bestaetigt_am'] ?: $u['erstellt_am']), $name, 'empfaenger',
                    'Abgelehnt (Fassung ' . $fnr . ')' . ($grund !== '' ? ' — Grund: «' . $grund . '»' : ''), 'neg');
                continue;
            }
            $email = trim((string)$u['email']);
            if (empty($u['code_gesendet_am']) && !empty($u['bestaetigt_am'])) {
                // Ohne Code angenommen (ENT-708): keine Zeile "Code angefordert".
                $entschieden = true;
                $als = trim(implode(', ', array_filter([(string)$u['funktion'], (string)$u['firma']])));
                $neu((string)$u['bestaetigt_am'], $name, 'empfaenger',
                    'Angenommen (Fassung ' . $fnr . ')' . ($als !== '' ? ' als ' . $als : '')
                    . (!empty($u['zeichnungsberechtigt']) ? ' · zeichnungsberechtigt' : '')
                    . ' · über den Link an ' . $email . ', ohne Code', 'pos');
                continue;
            }
            $abw = mb_strtolower($email) !== mb_strtolower(trim((string)$u['empfaenger_email']));
            $was = 'Code angefordert an ' . $email
                . ($abw ? ' — weicht von der Empfängeradresse ' . trim((string)$u['empfaenger_email']) . ' ab' : '');
            $fehl = (int)$u['code_versuche'];
            if ($fehl > 0 && empty($u['bestaetigt_am'])) {
                $was .= ' · ' . $fehl . '× falscher Code' . ($fehl >= BELEG_CODE_VERSUCHE ? ', gesperrt' : '');
            }
            $neu((string)($u['code_gesendet_am'] ?: $u['erstellt_am']), $name, 'empfaenger', $was);
            if (!empty($u['bestaetigt_am'])) {
                $entschieden = true;
                $als = trim(implode(', ', array_filter([(string)$u['funktion'], (string)$u['firma']])));
                $neu((string)$u['bestaetigt_am'], $name, 'empfaenger',
                    'Angenommen (Fassung ' . $fnr . ')' . ($als !== '' ? ' als ' . $als : '')
                    . (!empty($u['zeichnungsberechtigt']) ? ' · zeichnungsberechtigt' : ''), 'pos');
            }
        }
    }
    // Eine Entscheidung ohne Unterschriftszeile: der Klick von vor ENT-688.
    if (!$entschieden && !empty($beleg['entscheidung_am'])
        && in_array((string)$beleg['status'], ['bestaetigt', 'abgelehnt'], true)) {
        $ja = (string)$beleg['status'] === 'bestaetigt';
        $neu((string)$beleg['entscheidung_am'], '', 'empfaenger',
            ($ja ? 'Angenommen' : 'Abgelehnt') . ' per Klick, ohne Code und ohne Namen (vor ENT-688)',
            $ja ? 'pos' : 'neg');
    }

    foreach ($nachrichten ?? [] as $m) {
        $kunde = (string)$m['seite'] === 'kunde';
        $neu((string)$m['erstellt_am'], (string)$m['autor'], $kunde ? 'empfaenger' : 'intern',
            ($kunde ? 'Änderungswunsch: ' : 'Antwort an den Empfänger: ')
            . '«' . beleg_verlauf_auszug((string)$m['text']) . '»');
    }

    usort($eintraege, fn($a, $b) => [strtotime($b['zeit']) ?: 0, $b['_n']] <=> [strtotime($a['zeit']) ?: 0, $a['_n']]);
    foreach ($eintraege as &$e) { unset($e['_n']); }
    unset($e);

    $seit = null;
    if ($logDa) {
        $s = $pdo->query('SELECT MIN(zeitpunkt) FROM ' . logbuch_tabelle($tabPraefix) . " WHERE bereich = 'beleg'");
        $seit = $s ? ($s->fetchColumn() ?: null) : null;
    }
    return ['eintraege' => $eintraege, 'log_da' => $logDa, 'vor_log' => $logDa && !$angelegt,
            'log_seit' => $seit !== null ? (string)$seit : null];
}
