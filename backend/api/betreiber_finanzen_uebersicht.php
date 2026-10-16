<?php
// Die Zahlen der Finanz-Uebersicht, die NICHT aus der Rechnungsliste kommen
// (ENT-725): Ausgaben je Monat und der wiederkehrende Umsatz.
//
// Die Einnahmen rechnet der Browser aus derselben Rechnungsliste wie der
// Reiter Rechnungen (betreiber_beleg_list.php) -- eine zweite Definition von
// "offen" oder "ueberfaellig" hier im Server liefe irgendwann auseinander
// (dieselbe Ueberlegung wie bei ENT-618).
//
// Jeder Block sagt selbst, ob er eingerichtet ist. Ein fehlender Block ist
// nie eine 0.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';

require_betreiber_voll();
$pdo = betreiber_db();
$heute = date('Y-m-d');

$von = trim((string)($_GET['von'] ?? ''));
$bis = trim((string)($_GET['bis'] ?? ''));
if (!be_aus_monat_gueltig($von) || !be_aus_monat_gueltig($bis) || $von > $bis) {
    json_response(['status' => 'error', 'message' => 'von/bis als YYYY-MM angeben, von nicht nach bis'], 400);
}

// ── Ausgaben ──────────────────────────────────────────────────────────
$ausgaben = ['eingerichtet' => false, 'monate' => (object)[], 'kategorien' => [], 'erste_periode' => null];
if (be_aus_eingerichtet($pdo)) {
    be_aus_vorlagen_buchen($pdo, $heute);
    $zeilen = be_aus_zeilen($pdo);
    $aktive = array_filter($zeilen, fn($z) => $z['aktiv'] === 1);
    $ausgaben = [
        'eingerichtet'  => true,
        'monate'        => (object)be_aus_monate($zeilen, $von, $bis),
        'kategorien'    => array_values(be_aus_kategorien($pdo)),
        // Ab wann ueberhaupt erfasst wird. Ein Monat davor ist "noch nicht
        // erfasst", nicht "keine Ausgaben".
        'erste_periode' => $aktive ? min(array_column($aktive, 'periode')) : null,
    ];
}

// ── Wiederkehrender Umsatz ───────────────────────────────────────────
$mrr = ['eingerichtet' => false];
if (hat_tabelle($pdo, 'be_belege') && hat_tabelle($pdo, 'mandant') && hat_tabelle($pdo, 'be_kunden')
    && hat_spalte($pdo, 'be_belege', 'total_monat_rappen') && hat_spalte($pdo, 'be_kunden', 'mandant_id')) {
    $vertraege = $pdo->query(
        "SELECT b.id, b.nummer, b.status, b.datum, b.entscheidung_am, b.rabatt_bp, b.aktiv,
                b.ist_vorlage, k.mandant_id
           FROM be_belege b
           LEFT JOIN be_kunden k ON k.id = b.kunde_id
          WHERE b.art = 'vertrag'"
    )->fetchAll(PDO::FETCH_ASSOC);

    $LAUFZEIT = ['vertrag_beginn', 'mindestlaufzeit_monate', 'kuendigungsfrist_monate',
                 'verlaengerung_monate', 'gekuendigt_per'];
    $mitLaufzeit = array_filter($LAUFZEIT, fn($f) => hat_spalte($pdo, 'mandant', $f));
    $mandanten = [];
    foreach ($pdo->query('SELECT id, name, status' . ($mitLaufzeit ? ', ' . implode(', ', $mitLaufzeit) : '')
                         . ' FROM mandant')->fetchAll(PDO::FETCH_ASSOC) as $m) {
        $mandanten[(int)$m['id']] = $m;
    }

    $mrr = ['eingerichtet' => true] + be_aus_mrr(
        $vertraege, $mandanten, $heute,
        fn(int $id) => beleg_positionen_lesen($pdo, $id, 'be_'),
        fn(array $pos, int $rabatt) => beleg_summen_perioden($pos, $rabatt)
    );

    // Vertraege, die in den naechsten 90 Tagen enden: gekuendigt oder
    // ohne Verlaengerung auslaufend. Gerechnet mit be_vertrag_lage() wie
    // unter Mandanten -> Vertraege, keine zweite Fristrechnung.
    $grenze = date('Y-m-d', strtotime($heute . ' +90 days'));
    $auslaufend = [];
    foreach ($mrr['zeilen'] as $i => $z) {
        $lage = be_vertrag_lage($mandanten[$z['mandant_id']] ?? [], $heute);
        $mrr['zeilen'][$i]['lage'] = $lage['lage'];
        $mrr['zeilen'][$i]['ende'] = $lage['ende'];
        if (in_array($lage['lage'], ['gekuendigt', 'laeuft_aus'], true)
            && $lage['ende'] !== null && $lage['ende'] >= $heute && $lage['ende'] <= $grenze) {
            $auslaufend[] = $mrr['zeilen'][$i];
        }
    }
    $mrr['auslaufend'] = $auslaufend;
}

json_response(['status' => 'ok', 'heute' => $heute, 'ausgaben' => $ausgaben, 'mrr' => $mrr]);
