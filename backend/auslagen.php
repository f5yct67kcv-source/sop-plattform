<?php
declare(strict_types=1);
// Auslagenersatz nach Art. 18 GAV -- die EINZIGE Stelle, die daraus einen
// Frankenbetrag macht (ENT-125).
//
// WARUM HIER UND NICHT IN gav.js: gav.js liefert bislang nur eine
// Live-VORSCHAU beim Erfassen der Wegstrecke (Zone, "Auslagenersatz
// geschuldet ja/nein") -- nie einen persistierten Betrag. Der Snapshot in
// einsatz_auslagen entsteht beim Abgleich, serverseitig, in derselben
// Transaktion wie das Festschreiben der Ist-Zeiten (ENT-045). Eine im
// Browser berechnete Zahl waere fuer einen Datensatz, der spaeter in eine
// Spesenabrechnung nach Art. 18 Ziff. 10 einfliesst, nicht vertrauenswuerdig
// genug -- der Browser gehoert der Gegenseite des Vertrauens.
//
// ZWEI-SPRACHEN-RISIKO bewusst eingegangen, nicht uebersehen: Die
// Zonenschwellen (10/20/30 km, Quelle-Zitate) MUESSEN mit GAV_ZONEN in
// gav.js uebereinstimmen. Aendert sich eine Schwelle im GAV, muss sie an
// BEIDEN Stellen geaendert werden -- dort fuer die Vorschau, hier fuer die
// massgebliche Berechnung. test_auslagenersatz.mjs prueft das.
//
// SCOPE (bewusste Einschraenkung): Nur Art. 18 Ziff. 3.1 (Anstellungsgebiet,
// Pauschalzone 1/2, Regiezone), abhaengig von einsaetze.weg_km. Das
// Nebenanstellungsgebiet (Ziff. 3.2/3.3) wird NICHT ausgewertet -- ein
// einzelner Einsatz speichert nur eine Wegstrecke, die zum Hauptanstellungs-
// ort (ENT-116). Dieselbe Einschraenkung gilt bereits fuer die Warnung aus
// ENT-124 (enWegZone() ruft gavZone() ebenfalls mit kmNao = null auf).
require_once __DIR__ . '/planung.php';   // gavGilt()

// Versioniertes Regelwerk mit Gueltigkeitszeitraum (CLAUDE.md Teil B: "Eine
// spaetere GAV- oder Lohnrevision darf alte Abrechnungen nie rueckwirkend
// veraendern"). Massgeblich ist das EINSATZDATUM, nicht der Tag des
// Abgleichs -- der Anspruch entsteht am Tag der Arbeit.
// Betraege in RAPPEN (ganzzahlig): Franken mit Nachkommastellen summieren
// sich ueber viele Einsaetze zu Rundungsdrift; Rappen nicht.
// Beim Fortschreiben: neuen Eintrag ANHAENGEN, den alten stehen lassen.
const AUSLAGEN_REGELWERK = [
    [
        'quelle' => 'GAV private Sicherheitsdienstleistungen, Ausgabe 2026 (AVE vom 11.12.2025)',
        'ab' => '2026-01-01', 'bis' => '2026-12-31',
        'pauschal1_fahrkosten_rp'   => 700,   // CHF 7.00, Ziff. 3.1.2
        'pauschal1_fahrzeit_rp'     => 560,   // CHF 5.60
        'pauschal2_fahrkosten_rp'   => 2100,  // CHF 21.00, Ziff. 3.1.3
        'pauschal2_fahrzeit_rp'     => 1680,  // CHF 16.80
        'regie_fahrkosten_je_km_rp' => 70,    // CHF 0.70, Ziff. 3.1.4
        'regie_fahrzeit_je_km_rp'   => 32,    // CHF 0.32
        'regie_abzug_km'            => 10.0,  // die "10 km" in der Formel
    ],
];

function auslagen_regelwerk(string $datum): ?array {
    foreach (AUSLAGEN_REGELWERK as $r) {
        if ($datum >= $r['ab'] && $datum <= $r['bis']) { return $r; }
    }
    return null;   // ausserhalb jeder Gueltigkeit -- lieber keine Zahl als eine falsche
}

// Schwellen wie GAV_ZONEN in gav.js -- siehe Hinweis oben zum
// Zwei-Sprachen-Risiko.
const AUSLAGEN_ZONEN = [
    ['schluessel' => 'anstellungsgebiet', 'name' => 'Anstellungsgebiet',
        'bis' => 10.0, 'entschaedigung' => false, 'quelle' => 'Art. 18 Ziff. 3.1.1'],
    ['schluessel' => 'pauschalzone1', 'name' => 'Pauschalzone 1',
        'bis' => 20.0, 'entschaedigung' => true, 'quelle' => 'Art. 18 Ziff. 3.1.2'],
    ['schluessel' => 'pauschalzone2', 'name' => 'Pauschalzone 2',
        'bis' => 30.0, 'entschaedigung' => true, 'quelle' => 'Art. 18 Ziff. 3.1.3'],
    ['schluessel' => 'regiezone', 'name' => 'Regiezone',
        'bis' => INF, 'entschaedigung' => true, 'quelle' => 'Art. 18 Ziff. 3.1.4'],
];

function auslagen_zone(?float $kmHao): ?array {
    if ($kmHao === null || $kmHao < 0) { return null; }
    foreach (AUSLAGEN_ZONEN as $z) {
        if ($kmHao <= $z['bis']) { return $z; }
    }
    return null;
}

/**
 * Eine Zeile fuer einsatz_auslagen -- OHNE zu speichern. Der Aufrufer
 * entscheidet, ob und wie er das Ergebnis in seiner eigenen Transaktion
 * ablegt (siehe einsatz_abgleich.php).
 *
 * NULL bei einem der beiden *_rappen-Werte heisst "nicht bestimmbar", nie
 * "0 geschuldet" (GAV-AUS-004-Muster). gesperrt_grund nennt, warum --
 * bezogen auf den ZUERST nicht bestimmbaren Wert; steht der Fahrzeitersatz
 * schon fest und nur der Fahrkostenersatz nicht (z. B. Verkehrsmittel
 * unbekannt), sagt der Grund das, waehrend fahrzeitersatz_rappen trotzdem
 * eine Zahl traegt.
 *
 *   sparte              'sicherheit' | 'reinigung' | irgendetwas anderes
 *   datum               Einsatzdatum (YYYY-MM-DD) -- massgeblich fuer das Regelwerk
 *   kmHao               einsaetze.weg_km, oder null
 *   verkehrsmittel      aufgeloester Wert (Ausnahme an der Zuteilung ?? Vorgabe der Person), oder null
 *   oevRappen           nur relevant bei Verkehrsmittel 'Oeffentlicher Verkehr'
 *   gavAus010Blockiert  true, wenn die Person am selben Kalendertag bereits
 *                       einen anderen, nicht abgesagten Einsatz hat
 */
function auslagen_zeile(
    string $sparte,
    string $datum,
    ?float $kmHao,
    ?string $verkehrsmittel,
    ?int $oevRappen,
    bool $gavAus010Blockiert
): array {
    $regel = auslagen_regelwerk($datum);
    $zeile = [
        'zone_schluessel' => null, 'zone_name' => null, 'zone_quelle' => null,
        'weg_km' => $kmHao, 'verkehrsmittel' => $verkehrsmittel,
        'fahrzeitersatz_rappen' => null, 'fahrkostenersatz_rappen' => null,
        'gesperrt_grund' => null,
        'regelwerk' => $regel['quelle'] ?? ('kein gueltiges Regelwerk fuer ' . $datum),
    ];

    // Sparte Reinigung: Der GAV Sicherheit gilt hier nicht (ENT-061) -- und
    // welcher GAV stattdessen gilt, ist ueberhaupt nicht geprueft (OP-32).
    // Es wird nichts berechnet, nicht einmal "0".
    if ($sparte !== 'sicherheit') {
        $zeile['gesperrt_grund'] = 'sparte_reinigung';
        return $zeile;
    }
    if (!$regel) {
        $zeile['gesperrt_grund'] = 'regelwerk_unbekannt';
        return $zeile;
    }
    $zone = auslagen_zone($kmHao);
    if (!$zone) {
        $zeile['gesperrt_grund'] = 'wegstrecke_unbekannt';
        return $zeile;
    }
    $zeile['zone_schluessel'] = $zone['schluessel'];
    $zeile['zone_name'] = $zone['name'];
    $zeile['zone_quelle'] = $zone['quelle'];

    if (!$zone['entschaedigung']) {
        // Anstellungsgebiet: das ist der tatsaechliche Anspruch, keine Luecke.
        $zeile['fahrzeitersatz_rappen'] = 0;
        $zeile['fahrkostenersatz_rappen'] = 0;
        return $zeile;
    }

    // GAV-AUS-010 (offen): Pro Tag nur ein Hin- und Rueckweg abrechenbar,
    // und es ist ungeklaert, welcher von mehreren Einsaetzen das ist.
    // Rohdaten (Zone, km) bleiben stehen; kein Betrag entsteht, weder als
    // Vorschlag noch als Anzeige (Sperrwirkung, Auslegungsregister).
    if ($gavAus010Blockiert) {
        $zeile['gesperrt_grund'] = 'gav_aus_010';
        return $zeile;
    }

    // Fahrzeitersatz: haengt nur an der Zone, nicht am Verkehrsmittel
    // (Ziff. 2/3 -- Ziff. 4 aendert ausschliesslich die Fahrkosten).
    if ($zone['schluessel'] === 'pauschalzone1') {
        $zeile['fahrzeitersatz_rappen'] = $regel['pauschal1_fahrzeit_rp'];
        $fahrkostenBasis = $regel['pauschal1_fahrkosten_rp'];
    } elseif ($zone['schluessel'] === 'pauschalzone2') {
        $zeile['fahrzeitersatz_rappen'] = $regel['pauschal2_fahrzeit_rp'];
        $fahrkostenBasis = $regel['pauschal2_fahrkosten_rp'];
    } else { // regiezone: "[(2 x Distanz HAO->Einsatzort) - (2 x 10 km)] x Satz"
        $faktor = max(0.0, 2 * $kmHao - 2 * $regel['regie_abzug_km']);
        $zeile['fahrzeitersatz_rappen'] = (int) round($faktor * $regel['regie_fahrzeit_je_km_rp']);
        $fahrkostenBasis = (int) round($faktor * $regel['regie_fahrkosten_je_km_rp']);
    }

    // Fahrkostenersatz: haengt am Verkehrsmittel (Ziff. 4 und 5).
    if ($verkehrsmittel === 'Privatfahrzeug') {
        $zeile['fahrkostenersatz_rappen'] = $fahrkostenBasis;
    } elseif ($verkehrsmittel === 'Oeffentlicher Verkehr') {
        // Ziff. 4 woertlich: "der Preis des notwendigen Billettes, 2.
        // Klasse" -- der TATSAECHLICHE Fahrpreis, keine aus der Zone
        // hergeleitete Pauschale.
        if ($oevRappen === null || $oevRappen < 0) {
            $zeile['gesperrt_grund'] = 'oev_preis_unbekannt';
        } else {
            $zeile['fahrkostenersatz_rappen'] = $oevRappen;
        }
    } elseif ($verkehrsmittel === 'Mitfahrer' || $verkehrsmittel === 'Geschaeftsfahrzeug') {
        // Ziff. 4/5: einzig der Fahrzeitersatz -- der steht oben bereits.
        $zeile['fahrkostenersatz_rappen'] = 0;
    } else {
        $zeile['gesperrt_grund'] = 'verkehrsmittel_unbekannt';
    }

    return $zeile;
}
