<?php
// Ausgaben der Betreiberin lesen (ENT-725).
//
// Bucht vorher die faelligen Monate der Vorlagen (be_aus_vorlagen_buchen).
// Ein Lesen, das schreibt, ist hier Absicht und kein Versehen: Die Liste
// soll den laufenden Monat zeigen, ohne dass jemand einen Knopf "Vorlagen
// buchen" kennen muss. Der Vorgang ist gefahrlos wiederholbar.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

require_betreiber_voll();
$pdo = betreiber_db();

// Nicht eingerichtet ist etwas anderes als "keine Ausgaben" (Hausregel).
if (!be_aus_eingerichtet($pdo)) {
    json_response(['status' => 'ok', 'eingerichtet' => false,
                   'ausgaben' => [], 'kategorien' => [], 'vorlagen' => []]);
}

be_aus_vorlagen_buchen($pdo, date('Y-m-d'));

$vorlagen = $pdo->query(
    'SELECT v.id, v.kategorie_id, v.text, v.lieferant, v.intervall, v.waehrung,
            v.betrag_rappen, v.betrag_fremd_rappen, v.mwst_satz_bp, v.gueltig_ab,
            v.gueltig_bis, v.aktiv, k.name AS kategorie_name
       FROM be_ausgabe_vorlage v
       LEFT JOIN be_ausgabe_kategorie k ON k.id = v.kategorie_id
      ORDER BY v.aktiv DESC, v.text'
)->fetchAll(PDO::FETCH_ASSOC);
foreach ($vorlagen as &$v) {
    foreach (['id', 'kategorie_id', 'mwst_satz_bp', 'aktiv'] as $f) { $v[$f] = (int)$v[$f]; }
    foreach (['betrag_rappen', 'betrag_fremd_rappen'] as $f) { $v[$f] = $v[$f] === null ? null : (int)$v[$f]; }
}
unset($v);

json_response([
    'status'       => 'ok',
    'eingerichtet' => true,
    'heute'        => date('Y-m-d'),
    'ausgaben'     => be_aus_zeilen($pdo),
    'kategorien'   => array_values(be_aus_kategorien($pdo)),
    'vorlagen'     => $vorlagen,
    'mwst_saetze'  => BE_AUS_MWST_SAETZE,
]);
