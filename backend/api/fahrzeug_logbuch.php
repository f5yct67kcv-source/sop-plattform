<?php
// Aenderungsverlauf eines Dienstfahrzeugs (ENT-330).
//
// GET ?fahrzeug_id=…  -> alle Eintraege zu diesem Fahrzeug, neuste zuerst
//
// Bewusst nur lesend, wie logbuch_list.php: Ein Logbuch, aus dem sich
// Eintraege entfernen lassen, waere keines.
//
// WARUM EIN EIGENER ENDPUNKT: logbuch_list.php sucht sein Objekt ueber den
// Anmeldenamen einer Person -- ein Weg, der fuer ein Fahrzeug nicht passt.
// Gelesen wird aber aus derselben Tabelle, mit derselben Funktion
// (logbuch_lesen) und demselben Bereichsschluessel.
//
// RECHT: 'betrieb', nicht 'rechte'. Beim Personal sagt das Logbuch, wer
// welche PERSONENDATEN angefasst hat -- darum dort das strengere Recht.
// Hier sagt es, wer ein Betriebsmittel geaendert hat; wer die Fahrzeuge
// pflegen darf, muss auch sehen koennen, wer zuletzt am Kilometerstand war.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../logbuch.php';

$user = require_session();
require_recht($user, 'betrieb');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$fahrzeugId = (int)($_GET['fahrzeug_id'] ?? 0);
if ($fahrzeugId <= 0) {
    json_response(['status' => 'error', 'message' => 'fahrzeug_id erforderlich'], 422);
}

$pdo = db();
$eintraege = logbuch_lesen($pdo, 'fahrzeug', $fahrzeugId, 500);

// Der ausgeschriebene Name des Akteurs wird beim LESEN aufgeloest, nicht
// beim Schreiben mitgespeichert. Gruende: Der gespeicherte akteur_name ist
// im ganzen Logbuch der Anmeldename (so haelt es die Personalakte seit
// ENT-077) -- zwei verschiedene Schreibweisen in derselben Tabelle waeren
// zwei Konventionen. Und wer heiratet oder umbenannt wird, erscheint im
// Verlauf trotzdem mit dem heutigen Namen.
//
// Faellt die Aufloesung aus (Konto geloescht), bleibt der gespeicherte Name
// stehen -- genau dafuer wird er mitgeschrieben.
$ids = array_values(array_unique(array_map(fn($e) => (int)$e['akteur_id'], $eintraege)));
$namen = [];
if ($ids) {
    $platz = implode(',', array_fill(0, count($ids), '?'));
    $ns = $pdo->prepare("SELECT id, vorname, nachname FROM mitarbeiter WHERE id IN ($platz)");
    $ns->execute($ids);
    foreach ($ns->fetchAll(PDO::FETCH_ASSOC) as $m) {
        $voll = trim(($m['vorname'] ?? '') . ' ' . ($m['nachname'] ?? ''));
        if ($voll !== '') { $namen[(int)$m['id']] = $voll; }
    }
}
foreach ($eintraege as &$e) {
    $e['akteur_id'] = (int)$e['akteur_id'];
    $e['akteur_anzeige'] = $namen[$e['akteur_id']] ?? $e['akteur_name'];
}
unset($e);

json_response([
    'status' => 'ok',
    // Ohne die Tabelle gibt es keine Eintraege -- das ist etwas anderes als
    // "es wurde nichts geaendert". Die Oberflaeche muss den Unterschied
    // hinschreiben koennen, sonst sieht eine fehlende Einrichtung aus wie
    // ein unberuehrtes Fahrzeug.
    'eingerichtet' => logbuch_tabelle_da($pdo),
    'eintraege'    => $eintraege,
]);
