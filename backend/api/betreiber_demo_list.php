<?php
// Die Demo-Zugänge und die Belegung des Vorrats (ENT-600).
//
// Liefert bewusst KEINE Daten aus den Demo-Instanzen selbst -- der
// Betreiber-Bereich sieht, WER einen Zugang hat und wie lange, nicht was
// dieser jemand darin erfasst hat. Dieselbe Grenze wie bei den Mandanten
// (betreiber_mandant_list.php).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

require_betreiber_voll();
$pdo = betreiber_db();

if (!hat_tabelle($pdo, 'demo_zugang')) {
    // "Nicht eingerichtet" ist etwas anderes als "keine Zugänge" (Hausregel).
    json_response(['status' => 'error',
        'message' => 'Das Register der Demo-Zugänge ist noch nicht eingerichtet.'], 503);
}

$jetzt = date('Y-m-d H:i:s');

$zeilen = $pdo->query(
    'SELECT id, platz, firma, person, email, telefon, login, status,
            freigegeben_am, freigegeben_von, laeuft_ab_am, beendet_am
       FROM demo_zugang ORDER BY id DESC'
)->fetchAll(PDO::FETCH_ASSOC);

$liste = array_map(static function (array $z) use ($jetzt): array {
    $z['id'] = (int)$z['id'];
    // Der Zustand wird HIER benannt und nicht in der Oberfläche gerechnet:
    // Ein Zugang, dessen Frist um ist, den der Zeitgeber aber noch nicht
    // angefasst hat, steht in der Datenbank auf "aktiv" und ist trotzdem
    // keiner. Wer das in der Oberfläche rechnet, rechnet es beim nächsten
    // Bildschirm wieder -- oder eben nicht.
    $z['abgelaufen'] = $z['status'] === 'aktiv'
        && demo_zugang_abgelaufen((string)$z['laeuft_ab_am'], $jetzt);
    $z['resttage']   = $z['status'] === 'aktiv'
        ? demo_zugang_resttage((string)$z['laeuft_ab_am'], $jetzt) : null;
    $z['adresse']    = demo_platz_adresse((string)$z['platz']);
    return $z;
}, $zeilen);

// Belegung des Vorrats. Ein Platz gilt als belegt, solange ein Zugang
// darauf im Register aktiv ist -- auch wenn dessen Frist schon um ist:
// Bis der Zeitgeber die Instanz geleert hat, liegen dort noch die Daten
// des Vorgängers, und ein zweiter Interessent hätte sie vor Augen.
$belegt = array_values(array_unique(array_map(
    static fn (array $z): string => (string)$z['platz'],
    array_filter($liste, static fn (array $z): bool => $z['status'] === 'aktiv')
)));

$plaetze = array_map(static function (string $platz) use ($belegt, $liste): array {
    $drauf = null;
    foreach ($liste as $z) {
        if ($z['platz'] === $platz && $z['status'] === 'aktiv') { $drauf = $z; break; }
    }
    return [
        'platz'   => $platz,
        'adresse' => demo_platz_adresse($platz),
        'frei'    => !in_array($platz, $belegt, true),
        'firma'   => $drauf['firma'] ?? null,
        'laeuft_ab_am' => $drauf['laeuft_ab_am'] ?? null,
    ];
}, DEMO_PLAETZE);

json_response([
    'status'   => 'ok',
    'zugaenge' => $liste,
    'plaetze'  => $plaetze,
    // Vier Aussagen, vier Zahlen -- "Plätze" zählt Instanzen, "Zugänge"
    // zählt Interessenten. Einheiten werden nicht vermischt (Hausregel).
    'plaetze_frei'  => count(array_filter($plaetze, static fn (array $p): bool => $p['frei'])),
    'plaetze_total' => count(DEMO_PLAETZE),
    'aktive'        => count(array_filter($liste, static fn (array $z): bool => $z['status'] === 'aktiv')),
    'laufzeit_tage' => DEMO_ZUGANG_TAGE,
]);
