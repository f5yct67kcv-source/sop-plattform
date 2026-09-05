<?php
declare(strict_types=1);
// Die eingereichten Spesenbelege fuer die Verwaltung (ENT-413).
//
// require_recht('personal_schreiben') und KEIN neuntes Recht: Eine
// Spesenfreigabe ist dieselbe Art Vorgang wie ein Abwesenheitsentscheid
// (abwesenheit_entscheiden.php begruendet es dort gleich) -- sie betrifft
// den Anspruch einer einzelnen Person. Der Rechtekatalog ist bewusst grob
// geschnitten ("acht Rechte, nicht sechzig", rechte.php); ein eigenes
// Spesenrecht waere eine weitere Kombination, die jemand pruefen muesste.
//
// Belege im Zustand 'erfasst' erscheinen hier NICHT: Sie liegen noch in der
// Mappe der Person und sind kein Antrag. Das ist der ganze Zweck der
// Trennung zwischen erfasst und eingereicht.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../spesen.php';

$user = require_session();
require_recht($user, 'personal_schreiben');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$pdo = db();
// "Nicht eingerichtet" ist etwas anderes als "keine Belege" -- die Ansicht
// muss beides unterscheiden koennen (CLAUDE.md).
if (!hat_tabelle($pdo, 'spesen')) {
    json_response(['status' => 'ok', 'eingerichtet' => false, 'spesen' => []]);
}

// Voreinstellung sind die offenen Faelle: Wer die Ansicht oeffnet, will
// wissen, was zu entscheiden ist. Die entschiedenen bleiben ueber den
// Filter erreichbar, damit eine Freigabe nachvollziehbar bleibt.
$status = (string)($_GET['status'] ?? 'eingereicht');
$erlaubt = ['eingereicht', 'freigegeben', 'abgelehnt'];
$wo = 'WHERE s.status <> \'erfasst\'';
$werte = [];
if ($status !== 'alle') {
    if (!in_array($status, $erlaubt, true)) {
        json_response(['status' => 'error', 'message' => 'Unbekannter Status'], 400);
    }
    $wo = 'WHERE s.status = ?';
    $werte[] = $status;
}

// Der Name kommt aus dem Mitarbeiterstamm, nicht aus dem Beleg -- die
// Liste zeigt damit den heutigen Namen. Vertrauliche Personalfelder werden
// hier nicht angefasst (ma_vertrauliche_felder, CLAUDE.md): Fuer eine
// Spesenfreigabe braucht es den Namen, sonst nichts.
$s = $pdo->prepare(
    'SELECT s.id, s.mitarbeiter_id, s.datum, s.kategorie, s.betrag_rappen, s.notiz,
            s.status, s.erfasst_am, s.eingereicht_am, s.ablehnung_grund,
            s.entschieden_am, s.entschieden_von, s.beleg_mime,
            m.name, m.vorname, m.nachname
     FROM spesen s
     JOIN mitarbeiter m ON m.id = s.mitarbeiter_id
     ' . $wo . '
     ORDER BY s.datum DESC, s.id DESC'
);
$s->execute($werte);

$zeilen = array_map(static function (array $r): array {
    $r['betrag_rappen'] = (int)$r['betrag_rappen'];
    $r['hat_beleg'] = $r['beleg_mime'] !== null;
    $r['beleg_ist_pdf'] = $r['beleg_mime'] === 'application/pdf';
    // Ein fertiger Anzeigename statt dreier Felder: vorname/nachname sind
    // im Stamm optional (schema.sql), name ist es nicht -- die Ansicht
    // haette sonst dieselbe Rueckfallkette noch einmal zu bauen.
    $voll = trim(((string)$r['vorname']) . ' ' . ((string)$r['nachname']));
    $r['person'] = $voll !== '' ? $voll : (string)$r['name'];
    unset($r['beleg_mime'], $r['vorname'], $r['nachname'], $r['name']);
    return $r;
}, $s->fetchAll());

json_response([
    'status' => 'ok',
    'eingerichtet' => true,
    'kategorien' => SPESEN_KATEGORIEN,
    'spesen' => $zeilen,
]);
