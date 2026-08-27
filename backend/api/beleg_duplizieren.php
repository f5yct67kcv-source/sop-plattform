<?php
// Beleg duplizieren, oder aus einem Beleg eine Vorlage machen (ENT-181).
//
// Der Doppelgaenger bekommt eine EIGENE, neue Nummer und faengt wieder als
// Entwurf an -- eine Kopie, die die Nummer des Originals traegt, waere ein
// zweiter Beleg mit derselben Kennung, und beim Kunden laege dann zweimal
// "OF-0093" mit verschiedenem Inhalt.
//
// Datum wird auf heute gesetzt, "gueltig bis" um denselben Abstand
// verschoben wie beim Original: Wer eine Offerte von vor drei Monaten
// dupliziert, will sie neu stellen, nicht ihr altes Ablaufdatum erben.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../belege.php';

$user = require_session();
require_recht($user, 'offerten');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);
$alsVorlage = !empty($in['als_vorlage']) ? 1 : 0;
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$pdo = db();
$quelle = beleg_lesen($pdo, $id);
if (!$quelle) {
    json_response(['status' => 'error', 'message' => 'Beleg nicht gefunden'], 404);
}

$heute = date('Y-m-d');
$gueltigBis = null;
if (!empty($quelle['gueltig_bis']) && !empty($quelle['datum'])) {
    $tage = (int)((strtotime((string)$quelle['gueltig_bis'])
                 - strtotime((string)$quelle['datum'])) / 86400);
    if ($tage > 0) { $gueltigBis = date('Y-m-d', strtotime("$heute +$tage days")); }
}

$pdo->beginTransaction();
try {
    $nummer = beleg_naechste_nummer($pdo, (string)$quelle['art']);
    // Unterschriftsseite, oeffentliche Notizen, Bedingungen und Fusszeile
    // wandern 1:1 mit -- gleiche Begruendung wie bei den Positionen: der
    // Doppelgaenger soll zeigen, was das Original zeigte (ENT-186).
    $pdo->prepare(
        'INSERT INTO belege (art, nummer, kunde_id, person_id, titel, referenz,
                             datum, gueltig_bis, status, rabatt_bp, bemerkung, ist_vorlage,
                             unterschriftsseite, oeffentliche_notizen, bedingungen, fusszeile_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $quelle['art'], $nummer, $quelle['kunde_id'], $quelle['person_id'],
        $quelle['titel'], $quelle['referenz'], $heute, $gueltigBis,
        'entwurf', $quelle['rabatt_bp'], $quelle['bemerkung'], $alsVorlage,
        $quelle['unterschriftsseite'], $quelle['oeffentliche_notizen'],
        $quelle['bedingungen'], $quelle['fusszeile_text'],
    ]);
    $neuId = (int)$pdo->lastInsertId();

    // Positionen 1:1 mit -- einschliesslich der Preis-Schnappschuesse. Der
    // Doppelgaenger soll zeigen, was das Original zeigte, nicht die heutigen
    // Stammdatenpreise; wer neu kalkulieren will, aendert sie im Formular.
    beleg_positionen_schreiben($pdo, $neuId,
        array_map('beleg_position_lesen', $quelle['positionen']));
    beleg_summen_schreiben($pdo, $neuId, (int)$quelle['rabatt_bp']);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

json_response(['status' => 'ok', 'id' => $neuId, 'nummer' => $nummer]);
