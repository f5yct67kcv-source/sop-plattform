<?php
// Den zweiten Faktor eines ANDEREN Betreiber-Kontos zuruecksetzen (OP-517).
//
// Der Weg zurueck, wenn jemand Telefon und Notfallcodes verloren hat. Er
// fuehrt ueber ein zweites Konto und nicht ueber eine Hintertuer -- genau
// darum ist ein zweites Betreiber-Konto keine Bequemlichkeit, sondern
// Voraussetzung fuer den Betrieb.
//
// AUGENHOEHE (ENT-501): Zuruecksetzen darf nur, wer den zweiten Faktor
// selbst bestaetigt hat -- darum require_betreiber_voll(). Sonst koennte
// ein frisch angelegtes Konto ohne eigenen Faktor den eines anderen
// abraeumen und haette den Schutz der ganzen Ebene ausgehebelt.
//
// NICHT AM EIGENEN KONTO: Wer seinen eigenen Faktor erneuern will, nimmt
// betreiber_zf_einrichten.php und weist sich dabei mit einem Code aus. Ohne
// diese Trennung waere das Zuruecksetzen die Hintertuer, die es nicht geben
// soll.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber_voll();
$pdo = betreiber_db();

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$ziel  = (int)($daten['id'] ?? 0);

if ($ziel <= 0) {
    json_response(['status' => 'error', 'message' => 'Welches Konto?'], 400);
}
if ($ziel === (int)$ich['id']) {
    json_response(['status' => 'error',
        'message' => 'Den eigenen zweiten Faktor erneuert man über „Zwei-Faktor einrichten" — '
                   . 'mit dem aktuellen Code. Zurücksetzen ist für fremde Konten gedacht.'], 400);
}

$s = $pdo->prepare('SELECT id, name FROM betreiber WHERE id = ?');
$s->execute([$ziel]);
$konto = $s->fetch(PDO::FETCH_ASSOC);
if (!$konto) {
    json_response(['status' => 'error', 'message' => 'Dieses Konto gibt es nicht.'], 404);
}

$pdo->prepare('DELETE FROM betreiber_zwei_faktor WHERE betreiber_id = ?')->execute([$ziel]);
// Laufende Sitzungen des Ziels enden mit: Wer bis eben ohne bestaetigten
// Faktor unterwegs war, soll nicht weiterlaufen, und wer einen hatte, muss
// den neuen einrichten.
$pdo->prepare('DELETE FROM betreiber_sessions WHERE betreiber_id = ?')->execute([$ziel]);

json_response(['status' => 'ok', 'id' => $ziel,
    'hinweis' => 'Das Konto muss den zweiten Faktor bei der nächsten Anmeldung neu einrichten.']);
