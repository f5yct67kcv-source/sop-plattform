<?php
// Supportanfrage stellen und verfolgen (ENT-538).
// Dies ist die Seite des BETRIEBS -- sie läuft im Cockpit, nicht beim
// Plattform-Betreiber. Die Gegenseite ist api/betreiber_support_vorgang.php.
//
// WARUM require_verwaltung() UND NICHT EIN EIGENES RECHT: Eine Anfrage
// stellen ist kein Eingriff -- sie ändert nichts am Betrieb, sie schreibt
// einen Satz an den Hersteller. Ein eigenes Recht müsste in jeder Rolle
// gepflegt werden und wäre in dem Moment vergessen, in dem jemand Hilfe
// braucht. Zugleich soll es NICHT jede angemeldete Person können: Sonst
// erreichen den Betreiber Meldungen, die an den eigenen Vorgesetzten
// gehören, und der Betrieb verliert die Kontrolle darüber, was in seinem
// Namen beim Hersteller ankommt. Wer irgendein Verwaltungsrecht hat, ist
// genau die Grenze -- dieselbe wie beim Zugang zur Administration.
//
// Bewusst SCHWÄCHER als die Support-Freigabe (api/support_freigabe.php,
// Recht 'rechte'): Die Freigabe öffnet Aussenstehenden die Tür, die Anfrage
// stellt eine Frage. Wer fragen darf, darf darum noch lange nicht
// freigeben.
//
// GET                  -> eigene Vorgänge
// GET  ?id=…           -> ein Vorgang mit Verlauf
// POST { betreff, text, art?, bildschirm?, version? }  -> neuer Vorgang
// POST { id, text }                                    -> Antwort anhängen
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../mailer.php';
require_once __DIR__ . '/../supportvorgang.php';

$user = require_session();
require_verwaltung($user);

$betrieb = db();
$stamm   = betreiber_db();

// Nicht eingerichtet ist etwas anderes als "keine Vorgänge" und bekommt
// eine eigene Aussage -- dieselbe Hausregel wie in support_freigabe.php.
if (!sv_tabellen_da($stamm)) {
    json_response([
        'status'   => 'ok',
        'lage'     => 'nicht_eingerichtet',
        'message'  => 'Der Supportkanal ist auf dieser Anlage noch nicht eingerichtet. '
                    . 'Einmal die Einrichtung ausführen.',
        'vorgaenge' => [],
    ]);
}

$mandant = sv_mandant_bestimmen($stamm, $betrieb);

// Ohne Zuordnung wird NICHT geraten. Eine Anfrage unter dem Namen eines
// fremden Betriebs wäre schlimmer als gar keine.
if ($mandant['id'] === null) {
    json_response([
        'status'  => 'error',
        'lage'    => $mandant['lage'],
        'message' => $mandant['lage'] === 'kein_stamm'
            ? 'Der Mandantenstamm ist noch nicht eingerichtet — ohne ihn lässt sich '
            . 'die Anfrage keinem Betrieb zuordnen.'
            : 'Diese Anlage lässt sich keinem Mandanten zuordnen. Bitte den Betreiber '
            . 'verständigen, bevor eine Anfrage gestellt wird.',
        'vorgaenge' => [],
    ], 409);
}

$mandantId = (int)$mandant['id'];

// ── Lesen ─────────────────────────────────────────────────────────────
if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    $id = (int)($_GET['id'] ?? 0);
    if ($id > 0) {
        // Die Eingrenzung auf den eigenen Mandanten steht in der Abfrage,
        // nicht in einer Prüfung danach -- ein fremder Vorgang wird nicht
        // gefunden, statt gefunden und verworfen zu werden.
        $vorgang = sv_detail($stamm, $id, $mandantId);
        if ($vorgang === null) {
            json_response(['status' => 'error', 'message' => 'Diesen Vorgang gibt es nicht.'], 404);
        }
        json_response([
            'status'       => 'ok',
            'lage'         => 'ok',
            'vorgang'      => $vorgang,
            'nachrichten'  => sv_nachrichten($stamm, $id),
        ]);
    }

    json_response([
        'status'    => 'ok',
        'lage'      => 'ok',
        'vorgaenge' => sv_liste($stamm, $mandantId),
        'offen'     => sv_zaehler_offen($stamm, $mandantId),
        'arten'     => SV_ARTEN,
        // Der Wortlaut steht hier und nicht im Browser, damit es EINEN gibt
        // -- und weil er eine Zusage ist, keine Beschriftung.
        'hinweis'   => 'Bitte keine Namen, Löhne oder Rapportinhalte in die Schilderung '
                     . 'schreiben. Soll der Betreiber in die Anlage sehen, erteilen Sie '
                     . 'dafür eine befristete Support-Freigabe — sie zeigt ihm '
                     . 'ausschliesslich Diagnosedaten und wird protokolliert.',
    ]);
}

// ── Schreiben ─────────────────────────────────────────────────────────
$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];

// Wer schreibt, kommt aus der SITZUNG -- nie aus der Anfrage. Derselbe
// Grundsatz wie in support_freigabe.php.
$wer   = trim((string)$user['name']);
$rolle = implode(', ', array_map('strval', (array)($user['rollen'] ?? [])));

// Antwort auf einen bestehenden Vorgang.
$id = (int)($daten['id'] ?? 0);
if ($id > 0) {
    $text = trim((string)($daten['text'] ?? ''));
    if ($text === '') {
        json_response(['status' => 'error', 'message' => 'Bitte etwas schreiben.'], 400);
    }
    $neu = sv_antwort($stamm, $id, 'kunde', $wer, $text, $mandantId);
    if ($neu === null) {
        json_response(['status' => 'error', 'message' => 'Diesen Vorgang gibt es nicht.'], 404);
    }
    json_response(['status' => 'ok', 'id' => $id, 'neuer_status' => $neu,
                   'nachrichten' => sv_nachrichten($stamm, $id)]);
}

// Neuer Vorgang.
$geprueft = sv_anfrage_pruefen($daten);
if ($geprueft['fehler'] !== []) {
    json_response(['status' => 'error', 'felder' => $geprueft['fehler'],
        'message' => reset($geprueft['fehler'])], 400);
}

$neueId  = sv_einreichen($stamm, $mandantId, $geprueft['werte'], $wer, $rolle);
$vorgang = sv_detail($stamm, $neueId, $mandantId);

// Der Versand darf die Anfrage nicht scheitern lassen -- sie ist eingegangen,
// sobald sie im Vorrat steht. Was mit der Post geschah, wird berichtet, nicht
// zur Bedingung gemacht.
$post = sv_benachrichtigen($stamm, $vorgang ?? [], (string)$mandant['name'], false, basis_url());

json_response([
    'status'  => 'ok',
    'id'      => $neueId,
    'vorgang' => $vorgang,
    'post'    => $post['lage'],
    'message' => 'Ihre Anfrage ist eingegangen.',
]);
