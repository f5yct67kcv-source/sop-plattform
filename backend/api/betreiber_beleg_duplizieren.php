<?php
// Beleg duplizieren, oder aus einem Beleg eine Vorlage machen (ENT-605).
//
// Der Doppelgaenger bekommt eine EIGENE, neue Nummer und faengt wieder als
// Entwurf an -- eine Kopie, die die Nummer des Originals traegt, waere ein
// zweiter Beleg mit derselben Kennung, und beim Empfaenger laege dann
// zweimal "OF-0007" mit verschiedenem Inhalt.
//
// Datum wird auf heute gesetzt, "gueltig bis" um denselben Abstand
// verschoben wie beim Original: Wer eine Offerte von vor drei Monaten
// dupliziert, will sie neu stellen, nicht ihr altes Ablaufdatum erben.
//
// versand_token und Entscheidung wandern ausdruecklich NICHT mit: Der Link
// des Originals gehoert zum Original, und eine Zusage gilt fuer den Beleg,
// auf dem sie gegeben wurde.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in         = json_decode(file_get_contents('php://input'), true) ?? [];
$id         = (int)($in['id'] ?? 0);
$alsVorlage = !empty($in['als_vorlage']) ? 1 : 0;
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$pdo    = betreiber_db();
$quelle = beleg_lesen($pdo, $id, 'be_');
if (!$quelle) {
    json_response(['status' => 'error', 'message' => 'Beleg nicht gefunden'], 404);
}

$heute = date('Y-m-d');
$abstand = static function (?string $ziel, ?string $datum) use ($heute): ?string {
    if (!$ziel || !$datum) { return null; }
    $tage = (int)((strtotime($ziel) - strtotime($datum)) / 86400);
    return $tage > 0 ? date('Y-m-d', strtotime("$heute +$tage days")) : null;
};
$gueltigBis = $abstand($quelle['gueltig_bis'] ?? null, $quelle['datum'] ?? null);
$faelligBis = $abstand($quelle['faellig_bis'] ?? null, $quelle['datum'] ?? null);

$pdo->beginTransaction();
try {
    $nummer = beleg_naechste_nummer($pdo, (string)$quelle['art'], 'be_');
    $pdo->prepare(
        'INSERT INTO be_belege (art, nummer, kunde_id, person_id, titel, referenz,
                                datum, gueltig_bis, faellig_bis, status, rabatt_bp,
                                bemerkung, ist_vorlage, unterschriftsseite,
                                oeffentliche_notizen, bedingungen, fusszeile_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $quelle['art'], $nummer, $quelle['kunde_id'], $quelle['person_id'],
        $quelle['titel'], $quelle['referenz'], $heute, $gueltigBis, $faelligBis,
        'entwurf', $quelle['rabatt_bp'], $quelle['bemerkung'], $alsVorlage,
        $quelle['unterschriftsseite'], $quelle['oeffentliche_notizen'],
        $quelle['bedingungen'], $quelle['fusszeile_text'],
    ]);
    $neuId = (int)$pdo->lastInsertId();

    // Positionen 1:1 mit -- einschliesslich der Preis-Schnappschuesse. Der
    // Doppelgaenger soll zeigen, was das Original zeigte, nicht die heutigen
    // Stammdatenpreise; wer neu kalkulieren will, aendert sie im Formular.
    beleg_positionen_schreiben($pdo, $neuId,
        array_map('beleg_position_lesen', $quelle['positionen']), 'be_');
    beleg_summen_schreiben($pdo, $neuId, (int)$quelle['rabatt_bp'], 'be_');
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

be_log($pdo, $ich, 'beleg', $neuId, 'angelegt', null,
       $nummer . ' · Doppel von ' . (string)($quelle['nummer'] ?? ''));

json_response(['status' => 'ok', 'id' => $neuId, 'nummer' => $nummer]);
