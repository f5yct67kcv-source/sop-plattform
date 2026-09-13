<?php
declare(strict_types=1);
// Rechenknecht fuer die Kreuzpruefung pruef_gavzeit.mjs (ENT-451).
//
// Liest Faelle als JSON von der Standardeingabe, rechnet sie mit der
// PHP-Fassung des GAV-Zeitkerns und schreibt die Ergebnisse als JSON
// zurueck. Kein Zweck ausserhalb der Pruefung -- er wird darum auch nicht
// deployt.
require_once __DIR__ . '/../backend/gavzeit.php';

$faelle = json_decode(stream_get_contents(STDIN), true);
if (!is_array($faelle)) {
    fwrite(STDERR, "Keine Faelle empfangen\n");
    exit(2);
}
$out = [];
foreach ($faelle as $f) {
    $out[] = [
        'roh'   => gavzeit_roh_min($f['von'] ?? null, $f['bis'] ?? null),
        'netto' => gavzeit_netto($f['von'] ?? null, $f['bis'] ?? null,
                                 $f['pause'] ?? 0, $f['bezahlt'] ?? 0),
        'bonus' => gavzeit_bonus_min((string)($f['datum'] ?? ''), $f['von'] ?? null, $f['bis'] ?? null),
        'pause' => gavzeit_pause_soll($f['von'] ?? null, $f['bis'] ?? null),
        'gilt'  => gavzeit_gilt($f['sparte'] ?? null),
        'std'   => gavzeit_std($f['stdMin'] ?? 0),
    ];
}
echo json_encode($out);
