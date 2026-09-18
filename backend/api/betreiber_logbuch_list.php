<?php
// Das Logbuch der Betreiber-Ebene lesen (ENT-614).
//
// Vom Projektinhaber bestellt: ein Verlauf, der sagt, wer was geaendert hat
// -- und zwar ueber den ganzen Bereich, nicht nur an den Konten. Auf dieser
// Ebene gibt es keine Instanz darueber, die etwas nachvollziehen koennte;
// was hier nicht mitgeschrieben wird, ist nirgends.
//
// NUR LESEN, KEIN LOESCHEN. Es gibt bewusst keinen Weg, Eintraege zu
// entfernen: Ein Verlauf, den der Beobachtete aufraeumen kann, beantwortet
// die Frage nicht mehr, fuer die er da ist.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../logbuch.php';

require_betreiber_voll();
$pdo = betreiber_db();

// Nicht eingerichtet und nichts passiert sind zwei verschiedene Aussagen
// (Hausregel). Die Oberflaeche unterscheidet sie an diesem Feld.
$da = logbuch_tabelle_da($pdo, 'be_');

$bereich  = (string)($_GET['bereich'] ?? '');
$objektId = (int)($_GET['objekt'] ?? 0);
$akteurId = (int)($_GET['akteur'] ?? 0);
$grenze   = (int)($_GET['grenze'] ?? 300);

$eintraege = $da
    ? logbuch_lesen($pdo, $bereich, $objektId, $grenze, 'be_', $akteurId)
    : [];

json_response([
    'status'     => 'ok',
    'tabelle_da' => $da,
    'bereiche'   => logbuch_bereiche('be_'),
    'eintraege'  => $eintraege,
    'anzahl'     => count($eintraege),
    // Damit die Oberflaeche "300 von mehr" sagen kann statt einer Zahl ohne
    // Bezug: Steht die Liste genau auf der Grenze, ist sie abgeschnitten.
    'grenze'     => max(1, min(1000, $grenze)),
]);
