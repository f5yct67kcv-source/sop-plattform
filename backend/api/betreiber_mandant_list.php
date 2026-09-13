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

$zeilen = $pdo->query(
    'SELECT id, name, status, kanton, gav_unterstellt, gav_bestaetigt_am,
            gav_bestaetigt_von, db_host, db_name, db_user, secret_name,
            angelegt_am, geaendert_am
       FROM mandant ORDER BY id'
)->fetchAll(PDO::FETCH_ASSOC);

$liste = array_map(static function (array $m): array {
    $m['id'] = (int)$m['id'];
    // Die drei Lagen werden vom Server benannt, nicht von der Oberflaeche
    // erraten -- "nicht eingerichtet", "kein Zugriff", "nichts vorhanden"
    // und "kein Treffer" sind verschiedene Aussagen (Hausregel).
    $m['gav_lage']        = be_gav_lage(
        $m['gav_unterstellt'] === null ? null : (int)$m['gav_unterstellt'],
        $m['gav_bestaetigt_am']
    );
    $m['verbindung_lage'] = be_verbindung_lage($m);
    // gav_unterstellt bleibt dreiwertig auch in der Antwort: null heisst
    // "nicht bestaetigt" und darf nicht zu false werden.
    $m['gav_unterstellt'] = $m['gav_unterstellt'] === null ? null : (int)$m['gav_unterstellt'] === 1;
    return $m;
}, $zeilen);

json_response([
    'status'   => 'ok',
    'mandanten' => $liste,
    'anzahl'    => count($liste),
]);
