<?php
// Abgelaufene Demo-Zugänge schliessen (ENT-600).
//
// Der Zeitgeber, der die 14 Tage durchsetzt. Ohne ihn liefe nichts ab, und
// die Daten der Interessenten lägen weiter in den Instanzen -- der Ablauf
// ist keine Anzeige, er ist die Löschung.
//
// ZWEI WEGE HEREIN, EIN RECHENKERN:
//   - Der Zeitgeber ruft mit dem Schlüssel aus dem Deploy auf, ohne
//     Anmeldung (wie api/demo_reset_ausfuehren.php).
//   - Der Betreiber kann von Hand anstossen; dann zählt seine Sitzung.
// Beides ist derselbe Lauf, nur der Nachweis ist ein anderer.
//
// GET liefert nur den Stand, POST räumt auf. Ein Aufräumen per GET wäre
// von jedem Vorschau-Dienst auslösbar, der Links aufruft.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../demo_instanz.php';

$schluessel = (string)($_GET['schluessel'] ?? '');
// Der Platzhalter wird hier zusammengesetzt und steht NICHT am Stueck im
// Quelltext -- sonst ersetzte ihn der Deploy auch in diesem Kommentar und
// die Pruefung auf unersetzte Platzhalter liefe ins Leere.
$erwartet   = '__DEMO_ABLAUF' . '_TOKEN__';
$lage = demo_ablauf_zeitgeber_lage($erwartet, $schluessel);
$perZeitgeber = $lage === 'ok';

if (!$perZeitgeber) {
    // Keine gültige Zeitgeber-Kennung: Dann muss eine Betreiber-Sitzung
    // dahinterstehen. Die Wache antwortet selbst, wenn sie fehlt.
    //
    // Ein FALSCHER Schlüssel ist etwas anderes als gar keiner und wird
    // abgewiesen, statt in die Sitzungsprüfung zu rutschen: Wer es mit
    // einem Schlüssel versucht, ist kein Mensch am Bildschirm.
    if ($lage === 'falscher_schluessel') {
        json_response(['status' => 'error', 'message' => 'kein Zugang'], 403);
    }
    require_betreiber_voll();
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'demo_zugang')) {
    json_response(['status' => 'error',
        'message' => 'Das Register der Demo-Zugänge ist noch nicht eingerichtet.'], 503);
}

$jetzt = date('Y-m-d H:i:s');
$offen = $pdo->prepare(
    "SELECT id, platz, firma, laeuft_ab_am FROM demo_zugang
      WHERE status = 'aktiv' AND laeuft_ab_am < ? ORDER BY id"
);
$offen->execute([$jetzt]);
$faellig = $offen->fetchAll(PDO::FETCH_ASSOC);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response([
        'status'  => 'ok',
        'faellig' => count($faellig),
        'zeitpunkt' => $jetzt,
        'liste'   => array_map(static fn (array $z): array => [
            'id' => (int)$z['id'], 'platz' => $z['platz'],
            'firma' => $z['firma'], 'laeuft_ab_am' => $z['laeuft_ab_am']], $faellig),
    ]);
}

$geschlossen = [];
$gescheitert = [];
foreach ($faellig as $z) {
    $fehler = demo_instanz_leeren($pdo, (string)$z['platz']);
    if ($fehler !== null) {
        // Weitermachen statt abbrechen: Ein Platz, der nicht erreichbar
        // ist, darf die anderen nicht mit blockieren. Der Zugang bleibt
        // aktiv, und der nächste Lauf versucht es erneut -- ein Zugang, der
        // im Register als beendet stünde, während seine Daten noch liegen,
        // wäre das Schlimmere.
        $gescheitert[] = ['platz' => $z['platz'], 'grund' => $fehler];
        continue;
    }
    $pdo->prepare("UPDATE demo_zugang SET status = 'abgelaufen', beendet_am = NOW() WHERE id = ?")
        ->execute([(int)$z['id']]);
    $geschlossen[] = (int)$z['id'];
}

json_response([
    'status'      => 'ok',
    'geschlossen' => count($geschlossen),
    'gescheitert' => $gescheitert,
    'zeitpunkt'   => $jetzt,
]);
