<?php
// Die Mandanten, die dieser Betreiber verwaltet (ENT-519).
//
// Liefert bewusst KEINE Betriebsdaten -- kein Personal, keine Einsaetze,
// keine Loehne. Der Betreiber-Bereich sieht Vertrag und Zustand eines
// Betriebs, nicht seinen Inhalt. Der Support-Zugriff auf Betriebsdaten ist
// eine eigene, noch nicht gebaute Sache und haengt an der Freigabe des
// Mandanten.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

require_betreiber_voll();
$pdo = betreiber_db();

if (!hat_tabelle($pdo, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}

// Die Vertragsspalten (ENT-617) kommen ueber be_spalten_anlegen() nach.
// Zwischen Deploy und Einrichtungslauf gibt es sie noch nicht -- eine
// Abfrage, die sie dann nennt, bricht mit einem SQL-Fehler ab und macht aus
// einer fehlenden Spalte einen unbenutzbaren Mandantenstamm.
$VERTRAG = ['vertrag_beginn', 'mindestlaufzeit_monate', 'kuendigungsfrist_monate',
            'verlaengerung_monate', 'gekuendigt_per'];
$vertragDa = array_values(array_filter($VERTRAG, fn($f) => hat_spalte($pdo, 'mandant', $f)));

$zeilen = $pdo->query(
    'SELECT id, name, subdomain, status, kanton, gav_unterstellt, gav_bestaetigt_am,
            gav_bestaetigt_von, db_host, db_name, db_user, secret_name,
            angelegt_am, geaendert_am'
    . ($vertragDa ? ', ' . implode(', ', $vertragDa) : '') . '
       FROM mandant ORDER BY id'
)->fetchAll(PDO::FETCH_ASSOC);

// Der Uebergabestand (ENT-686): EINE Abfrage fuer alle, nicht eine je Zeile.
// Die Einladungen liegen in der Betreiber-Datenbank -- darum ist diese
// Auskunft auch fuer eine Anlage da, die gerade nicht antwortet.
//
// Fehlt die Tabelle (zwischen Deploy und Einrichtungslauf), ist das "nicht
// eingerichtet" und nicht "keine Einladung" -- zwei Aussagen (Hausregel).
$uebergaben = null;
if (mandant_einladung_tabelle_da($pdo)) {
    $uebergaben = [];
    foreach ($pdo->query(
        'SELECT mandant_id, gueltig_bis, eingeloest_am, anrede, vorname, nachname, email,
                CASE WHEN gueltig_bis > NOW() THEN 1 ELSE 0 END AS noch_gueltig
           FROM mandant_einladung'
    )->fetchAll(PDO::FETCH_ASSOC) ?: [] as $z) {
        $uebergaben[(int)$z['mandant_id']] = $z;
    }
}

$heute = date('Y-m-d');
$liste = array_map(static function (array $m) use ($VERTRAG, $vertragDa, $heute, $uebergaben): array {
    $m['id'] = (int)$m['id'];
    // Die drei Lagen werden vom Server benannt, nicht von der Oberflaeche
    // erraten -- "nicht eingerichtet", "kein Zugriff", "nichts vorhanden"
    // und "kein Treffer" sind verschiedene Aussagen (Hausregel).
    $m['gav_lage']        = be_gav_lage(
        $m['gav_unterstellt'] === null ? null : (int)$m['gav_unterstellt'],
        $m['gav_bestaetigt_am']
    );
    $m['verbindung_lage'] = be_verbindung_lage($m);
    // Ein Demo-Platz ist eine Mandanten-Zeile wie jede andere -- die
    // Datenbankverbindung des Platzes steht nirgends sonst. Er ist aber
    // kein Betrieb, der diese Plattform nutzt, und gehoert darum nicht in
    // dieselbe Liste (ENT-627).
    //
    // BENANNT, NICHT ERRATEN: Geprueft wird gegen DEMO_PLAETZE aus
    // backend/demo_zugang.php -- dieselbe feste Liste, aus der die
    // Zuteilung schoepft. Ein Namensmuster ("faengt mit demo an") wuerde
    // einen Mandanten namens "Demolition AG" mit ausblenden.
    $m['ist_demo'] = in_array((string)$m['subdomain'], DEMO_PLAETZE, true);
    // gav_unterstellt bleibt dreiwertig auch in der Antwort: null heisst
    // "nicht bestaetigt" und darf nicht zu false werden.
    $m['gav_unterstellt'] = $m['gav_unterstellt'] === null ? null : (int)$m['gav_unterstellt'] === 1;

    // Fehlt die Spalte, steht das Feld trotzdem in der Antwort -- als null.
    // Die Oberflaeche unterscheidet "nichts eingetragen" von "gibt es hier
    // noch nicht" am Feld `vertrag_felder_da`, nicht am fehlenden Schluessel.
    foreach ($VERTRAG as $f) {
        if (!array_key_exists($f, $m)) { $m[$f] = null; }
    }
    $m['vertrag_felder_da'] = count($vertragDa) === count($VERTRAG);

    // GERECHNET, nicht gespeichert (ENT-617): Der naechste moegliche
    // Kuendigungstermin folgt aus Beginn, Mindestlaufzeit, Verlaengerung und
    // Frist. Ein abgelegter Wert stuende ab dem Tag falsch da, an dem der
    // Termin verstreicht.
    $m['uebergabe'] = $uebergaben === null
        ? ['lage' => 'nicht_eingerichtet', 'datum' => null]
        : mandant_uebergabe_lage($uebergaben[$m['id']] ?? null);
    // AN WEN (aufgeklappte Zeile, 2026-09-23): Wer eingeladen ist, gehoert
    // neben den Knopf "Neu einladen" -- sonst laedt man blind jemanden ein,
    // ohne zu sehen, an wen der letzte Link ging. Die Liste ist nur fuer
    // angemeldete Betreiber mit zweitem Faktor zugaenglich.
    $e = $uebergaben[$m['id']] ?? null;
    if ($e !== null) {
        $m['uebergabe']['person'] = be_name_bauen((string)$e['vorname'], (string)$e['nachname']);
        $m['uebergabe']['email']  = (string)$e['email'];
        // Einzeln dazu, damit "Neu einladen" den Dialog vorbelegen kann: Der
        // haeufigste Fall ist dieselbe Person mit abgelaufenem Link, und wer
        // die Adresse neu abtippt, tippt sie womoeglich anders.
        $m['uebergabe']['anrede']   = (string)$e['anrede'];
        $m['uebergabe']['vorname']  = (string)$e['vorname'];
        $m['uebergabe']['nachname'] = (string)$e['nachname'];
    }
    $m['vertrag'] = be_vertrag_lage($m, $heute);
    $m['vertrag']['faellig_90'] = be_vertrag_faellig($m['vertrag'], 90, $heute);
    return $m;
}, $zeilen);

json_response([
    'status'   => 'ok',
    'mandanten' => $liste,
    'anzahl'    => count($liste),
]);
