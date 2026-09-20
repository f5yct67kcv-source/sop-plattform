<?php
// Wer hat wann was im Supportfall gesehen (ENT-526).
//
// Das Protokoll gehört dem Betrieb, der eingesehen wurde -- es liegt in
// seiner Datenbank und ist hier einsehbar, ohne dass er dafür den
// Plattform-Betreiber fragen muss. Ein Protokoll, das nur der Einsehende
// führt, ist keines.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../support.php';

$user = require_session();
require_recht($user, 'rechte_' . STUFE_LESEN);

$pdo = db();
if (!support_tabellen_da($pdo)) {
    // Die Spur trotzdem ausliefern (ENT-631): Sie haengt nicht an der
    // Freigabe. Auf einem Demo-Platz gibt es keine Freigabe-Tabellen und
    // trotzdem Supportzugaenge -- hier abzubrechen hiesse, dem Betrieb
    // genau die Eintraege vorzuenthalten, die ihn betreffen.
    json_response(['status' => 'ok', 'lage' => 'nicht_eingerichtet',
        'zugriffe' => [], 'anzahl' => 0,
        'spur' => support_spur_lesen($pdo), 'freigaben' => []]);
}

$zeilen = $pdo->query(
    'SELECT z.id, z.zeitpunkt, z.wer, z.was,
            f.freigegeben_von, f.freigegeben_am, f.zweck, f.gilt_bis, f.widerrufen_am
       FROM support_zugriff z
       LEFT JOIN support_freigabe f ON f.id = z.freigabe_id
      ORDER BY z.id DESC LIMIT 200'
)->fetchAll(PDO::FETCH_ASSOC);

// Auch die Freigaben selbst, nicht nur die Zugriffe: Eine erteilte Freigabe,
// die niemand genutzt hat, ist eine eigene Aussage -- und gehört sichtbar zu
// sein, sonst sähe "nie jemand drin gewesen" aus wie "nie freigegeben".
$freigaben = $pdo->query(
    'SELECT id, freigegeben_von, freigegeben_am, gilt_bis, zweck, widerrufen_am,
            (SELECT COUNT(*) FROM support_zugriff z WHERE z.freigabe_id = support_freigabe.id) AS zugriffe
       FROM support_freigabe ORDER BY id DESC LIMIT 50'
)->fetchAll(PDO::FETCH_ASSOC);

json_response([
    'status'    => 'ok',
    'lage'      => support_lage($pdo),
    'zugriffe'  => $zeilen,
    'anzahl'    => count($zeilen),
    'freigaben' => $freigaben,
    // Was der Betreiber im Cockpit TAT (ENT-631) -- eine andere Aussage
    // als "hat von aussen hineingesehen" und darum eine eigene Liste.
    'spur'      => support_spur_lesen($pdo),
]);
