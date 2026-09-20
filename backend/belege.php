<?php
declare(strict_types=1);
// Belege: Offerten heute, Rechnungen spaeter (ENT-181).
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
const BELEG_ARTEN = [
    'offerte'  => ['praefix' => 'OF', 'titel' => 'Offerte',
                   'datum_label' => 'Offertendatum', 'nummer_label' => 'Offertennummer'],
    'rechnung' => ['praefix' => 'RE', 'titel' => 'Rechnung',
                   'datum_label' => 'Rechnungsdatum', 'nummer_label' => 'Rechnungsnummer'],
    // Dritte Art seit ENT-637. Sie erbt Versand, oeffentliche Ansicht und
    // Annahme unveraendert -- die unterscheiden die Art gar nicht. Was sie
    // zusaetzlich hat, ist eine Laufzeit und ein Preis je Periode.
    //
    // NUR AUF DER BETREIBER-SEITE: Die Tabelle `belege` des Mandanten kennt
    // den Wert in ihrem ENUM nicht, dort laesst sich also kein Vertrag
    // ablegen. Ob eine Sicherheitsfirma ihren eigenen Kunden Vertraege
    // schreiben soll, ist eine eigene Frage und nicht entschieden.
    'vertrag'  => ['praefix' => 'VE', 'titel' => 'Vertrag',
                   'datum_label' => 'Vertragsdatum', 'nummer_label' => 'Vertragsnummer'],
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
