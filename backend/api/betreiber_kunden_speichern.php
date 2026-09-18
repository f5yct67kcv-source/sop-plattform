<?php
// Empfaenger anlegen oder aendern (ENT-605).
//
// EIN Endpunkt fuer beides, anders als im Cockpit (kunden_create.php und
// kunden_update.php). Die Begruendung steht schon in produkt_speichern.php
// und gilt hier genauso: Zwei fast gleiche Endpunkte waeren zwei Stellen,
// an denen dieselbe Pruefung stehen muesste -- und irgendwann steht sie nur
// noch an einer. Ohne id wird angelegt, mit id geaendert.
//
// Gelesen und geprueft wird mit kunden_eingabe_lesen() aus kunden.php, also
// mit derselben Logik wie im Cockpit: gleiche Felder, gleiche Bereinigung,
// gleiche Regel fuer Anzeigename und PLZ/Ort. Nur die Tabellen sind andere.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../kunden.php';

require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'be_kunden')) {
    json_response(['status' => 'error',
        'message' => 'Der Offertenteil ist noch nicht eingerichtet.'], 503);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);

$bestand = [];
if ($id > 0) {
    $s = $pdo->prepare('SELECT * FROM be_kunden WHERE id = ?');
    $s->execute([$id]);
    $bestand = $s->fetch() ?: [];
    if (!$bestand) {
        json_response(['status' => 'error', 'message' => 'Adresse nicht gefunden'], 404);
    }
}

$gelesen = kunden_eingabe_lesen($in, $bestand);
$spalten = $gelesen['spalten'];

if ($spalten['name'] === '') {
    json_response(['status' => 'error', 'message' => $spalten['art'] === 'privat'
        ? 'Vor- und Nachname erforderlich' : 'Name erforderlich'], 400);
}
if ($spalten['plz'] === '' || $spalten['ort'] === '') {
    json_response(['status' => 'error', 'message' => 'PLZ und Ort erforderlich'], 400);
}

// Die Verknuepfung auf den Mandantenstamm ist KEIN Pflichtfeld und im
// Normalfall leer: Ein Empfaenger ist ein Betrieb, der noch kein Mandant
// ist. Gesetzt wird sie erst, wenn aus ihm einer geworden ist.
$mandantId = ($in['mandant_id'] ?? null) ? (int)$in['mandant_id'] : null;
if ($mandantId !== null && hat_tabelle($pdo, 'mandant')) {
    $chk = $pdo->prepare('SELECT id FROM mandant WHERE id = ?');
    $chk->execute([$mandantId]);
    if (!$chk->fetch()) {
        json_response(['status' => 'error', 'message' => 'Mandant nicht gefunden'], 400);
    }
}
if (array_key_exists('mandant_id', $in)) { $spalten['mandant_id'] = $mandantId; }

$pdo->beginTransaction();
try {
    if ($id > 0) {
        $satz = implode(', ', array_map(fn($f) => "$f = ?", array_keys($spalten)));
        $pdo->prepare("UPDATE be_kunden SET $satz WHERE id = ?")
            ->execute(array_merge(array_values($spalten), [$id]));
        $nummer = (string)($bestand['kundennummer'] ?? '');
    } else {
        // Die Nummer vergibt ausschliesslich der Server, fortlaufend und
        // danach unveraenderlich (ENT-040) -- ein mitgeschicktes Feld wird
        // bewusst nicht gelesen.
        $nummer  = naechste_kundennummer($pdo, 'be_');
        $felder  = array_keys($spalten);
        $pdo->prepare(
            'INSERT INTO be_kunden (kundennummer, ' . implode(', ', $felder) . ', aktiv) VALUES (?'
            . str_repeat(', ?', count($felder)) . ', 1)'
        )->execute(array_merge([$nummer], array_values($spalten)));
        $id = (int)$pdo->lastInsertId();
    }

    if ($gelesen['kinder'] !== null) {
        kunden_kinder_speichern($pdo, $id, $gelesen['kinder']['kontaktwege'],
                                $gelesen['kinder']['personen'], 'be_');
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

json_response(['status' => 'ok', 'id' => $id, 'kundennummer' => $nummer]);
