<?php
// Der Arbeitsvorrat des Betreibers (ENT-538).
//
// Die Gegenseite von api/support_anfrage.php: Dort schildert ein Betrieb
// sein Anliegen, hier wird es abgearbeitet.
//
// LIEFERT KEINE BETRIEBSDATEN. Was hier steht, hat der Mandant selbst
// geschrieben -- Betreff, Schilderung und der Kontext, den die Oberfläche
// mitgeschickt hat (Bildschirm, Version, Rolle des Meldenden). Kein
// Personal, keine Einsätze, keine Löhne. Wer in die Anlage sehen will,
// braucht weiterhin die Support-Freigabe des Mandanten
// (api/betreiber_support.php, ENT-526) -- ein Vorgang regt sie an, er
// ersetzt sie nicht und erteilt sie nicht.
//
// ZWEI QUELLEN, EINE LISTE: Ein Mandant, der sich die Datenbank mit dem
// Stamm teilt, schreibt seine Anfrage direkt hierher. Ein Mandant mit
// EIGENER Datenbank -- heute jeder Demo-Platz -- schreibt sie in seine
// eigene, weil betreiber_db() dort auf db() zurückfällt. Seine Vorgänge
// holt dieser Endpunkt ab (backend/support_sammeln.php). Ohne das war eine
// Anfrage von einem Demo-Platz für den Betreiber unsichtbar, obwohl sie im
// Cockpit als eingegangen stand (Befund 2026-09-23).
//
// Ein ferner Vorgang wird über `mandant` angesprochen, nicht über die Id
// allein: Die Ids zweier Datenbanken sind unabhängig voneinander, und die 7
// des einen Platzes ist nicht die 7 des anderen.
//
// GET             -> Vorrat über alle Mandanten
// GET ?id=…       -> ein Vorgang mit Verlauf
// POST { id, text }    -> antworten (setzt Status auf 'wartet_auf_kunde')
// POST { id, status }  -> Status von Hand setzen
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../supportvorgang.php';
require_once __DIR__ . '/../support.php';
require_once __DIR__ . '/../support_sammeln.php';
require_once __DIR__ . '/../mailer.php';

$betreiber = require_betreiber_voll();
$pdo = betreiber_db();

if (!sv_tabellen_da($pdo)) {
    // 503 und nicht "keine Vorgänge": Nicht eingerichtet ist etwas anderes
    // als leer, und der Unterschied entscheidet, was zu tun ist.
    json_response(['status' => 'error', 'lage' => 'nicht_eingerichtet',
        'message' => 'Der Supportkanal ist noch nicht eingerichtet. '
                   . 'Einmal die Einrichtung des Betreiber-Bereichs ausführen.'], 503);
}

// Die Anlage, auf der ein ferner Vorgang liegt -- oder null für den Stamm.
// Eine Stelle, nicht drei: Lesen, Antworten und Statuswechsel brauchen
// dieselbe Entscheidung, und eine davon vergessen hiesse, auf der falschen
// Anlage zu schreiben.
function vorgang_verbindung(PDO $stamm, int $mandantId): PDO
{
    if ($mandantId <= 0) { return $stamm; }
    if (!hat_tabelle($stamm, 'mandant')) {
        json_response(['status' => 'error',
            'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
    }
    $s = $stamm->prepare('SELECT id, name, subdomain, status, db_host, db_name,
                                 db_user, secret_name FROM mandant WHERE id = ?');
    $s->execute([$mandantId]);
    $m = $s->fetch(PDO::FETCH_ASSOC);
    if (!$m) {
        json_response(['status' => 'error', 'message' => 'Diesen Mandanten gibt es nicht.'], 404);
    }
    if (!be_holt_ab(be_stamm_dbname($stamm), $m)) {
        // Kein stiller Rückfall auf den Stamm: Wer hier landet, hätte den
        // Vorgang ohne `mandant` geöffnet. Ein Rückfall träfe sonst einen
        // gleichnummerierten Vorgang eines anderen Betriebs.
        json_response(['status' => 'error',
            'message' => 'Dieser Mandant führt seinen Supportkanal nicht selbst.'], 409);
    }
    try {
        $fern = mandant_db($m);
    } catch (Throwable $e) {
        json_response(['status' => 'error', 'lage' => mandant_verbindung_bereit($m),
            'message' => 'Diese Anlage ist nicht erreichbar.'], 502);
    }
    if (!sv_tabellen_da($fern)) {
        json_response(['status' => 'error', 'lage' => 'kein_kanal',
            'message' => 'Auf dieser Anlage ist der Supportkanal nicht eingerichtet.'], 409);
    }
    return $fern;
}

if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    $id = (int)($_GET['id'] ?? 0);
    if ($id > 0) {
        $quelle = vorgang_verbindung($pdo, (int)($_GET['mandant'] ?? 0));
        $vorgang = sv_detail($quelle, $id);
        if ($vorgang === null) {
            json_response(['status' => 'error', 'message' => 'Diesen Vorgang gibt es nicht.'], 404);
        }
        json_response(['status' => 'ok', 'vorgang' => $vorgang,
                       'nachrichten' => sv_nachrichten($quelle, $id)]);
    }

    // Die Mandantennamen kommen aus EINER Abfrage dazu, nicht je Zeile --
    // und der Vorrat bleibt lesbar, wenn ein Mandant gelöscht wurde: Dann
    // steht dort "unbekannter Mandant" und nicht nichts.
    $namen = [];
    if (hat_tabelle($pdo, 'mandant')) {
        foreach ($pdo->query('SELECT id, name FROM mandant')->fetchAll(PDO::FETCH_ASSOC) ?: [] as $m) {
            $namen[(int)$m['id']] = (string)$m['name'];
        }
    }

    $eigene = array_map(static function (array $v) use ($namen): array {
        $v['id']        = (int)$v['id'];
        $v['mandant_id']= (int)$v['mandant_id'];
        $v['mandant']   = $namen[$v['mandant_id']] ?? 'Unbekannter Mandant';
        $v['fern']      = false;
        return $v;
    }, sv_liste($pdo));

    // ── Und was auf den eigenen Anlagen liegt ─────────────────────────
    //
    // Abgeholt, nicht geschickt (siehe Kopf und support_sammeln.php). Die
    // Mandantenzeilen werden EINMAL gelesen und weitergereicht, nicht je
    // Anlage neu -- der Stamm wird davon nicht schneller, aber die Abfrage
    // steht dann an einer Stelle.
    $fern = ['vorgaenge' => [], 'offen' => 0, 'anlagen' => []];
    if (hat_tabelle($pdo, 'mandant')) {
        $mandanten = $pdo->query(
            'SELECT id, name, subdomain, status, db_host, db_name, db_user, secret_name
               FROM mandant ORDER BY id'
        )->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $fern = be_fremde_vorgaenge($pdo, $mandanten);
    }

    // Erst zusammenlegen, dann beschriften: Die beiden Wortlisten gelten
    // für beide Quellen, und zweimal geschrieben liefen sie auseinander.
    $liste = array_merge($eigene, $fern['vorgaenge']);
    $liste = array_map(static function (array $v): array {
        $v['art_wort']    = sv_art_wort((string)$v['art']);
        $v['status_wort'] = sv_status_wort((string)$v['status']);
        return $v;
    }, $liste);

    // Sortiert wie sv_liste() innerhalb einer Datenbank: nach letzter
    // Bewegung. Über zwei Quellen hinweg muss das hier geschehen -- sonst
    // stünden erst alle eigenen und danach alle fernen, und die Reihenfolge
    // sagte nichts mehr darüber, wo gerade etwas passiert ist.
    usort($liste, static function (array $a, array $b): int {
        $za = (string)($a['geaendert_am'] ?: $a['eroeffnet_am']);
        $zb = (string)($b['geaendert_am'] ?: $b['eroeffnet_am']);
        return strcmp($zb, $za);
    });

    json_response([
        'status'    => 'ok',
        'lage'      => 'ok',
        'vorgaenge' => $liste,
        'offen'     => sv_zaehler_offen($pdo) + (int)$fern['offen'],
        // Welche Anlagen abgefragt wurden und was dabei herauskam. Eine
        // Anlage, die nicht antwortet, ist ein eigener Befund -- ohne diese
        // Liste sähe sie aus wie eine ohne Anfragen (Hausregel).
        'anlagen'   => $fern['anlagen'],
        'status_liste' => SV_STATUS,
    ]);
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id = (int)($daten['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'Kein Vorgang angegeben.'], 400);
}

// Auf WELCHER Anlage geschrieben wird, entscheidet dieselbe Funktion wie
// beim Lesen. Geantwortet wird dort, wo der Vorgang liegt -- eine Antwort
// im Stamm erreichte den Betrieb nie, der sie liest.
$ziel = vorgang_verbindung($pdo, (int)($daten['mandant'] ?? 0));

// Status von Hand setzen.
if (isset($daten['status'])) {
    $status = (string)$daten['status'];
    if (!sv_status_gueltig($status)) {
        json_response(['status' => 'error', 'message' => 'Diesen Status gibt es nicht.'], 400);
    }
    if (!sv_status_setzen($ziel, $id, $status)) {
        json_response(['status' => 'error', 'message' => 'Diesen Vorgang gibt es nicht.'], 404);
    }
    json_response(['status' => 'ok', 'id' => $id, 'neuer_status' => $status]);
}

// Antworten.
$text = trim((string)($daten['text'] ?? ''));
if ($text === '') {
    json_response(['status' => 'error', 'message' => 'Bitte etwas schreiben.'], 400);
}

// Wer antwortet, kommt aus der Sitzung -- nie aus der Anfrage.
$wer = trim((string)($betreiber['name'] ?? 'Support'));
$neu = sv_antwort($ziel, $id, 'betreiber', $wer, $text);
if ($neu === null) {
    json_response(['status' => 'error', 'message' => 'Diesen Vorgang gibt es nicht.'], 404);
}

// Der Betrieb erfährt von der Antwort (ENT-685). Bis hierher erfuhr er sie
// gar nicht -- er hätte von sich aus nachsehen müssen. Der Versand darf das
// Antworten nicht scheitern lassen: Sie steht im Vorgang, sobald sie
// geschrieben ist. Was mit der Post geschah, wird berichtet, nicht zur
// Bedingung gemacht.
$vorgang = sv_detail($ziel, $id);
// DIE ADRESSE DES BETRIEBS, nicht die eigene: basis_url() zeigt hier auf
// betreiber.guardops.ch -- ein Link dorthin führte den Kunden auf eine
// Anmeldung, die ihm nicht gehört. Die Adresse steht im Mandantenstamm
// (mandant_adresse); fehlt die Subdomain, geht die Mail ohne Link, statt
// auf gut Glück irgendwohin zu verweisen.
$ziffer = (int)($vorgang['mandant_id'] ?? 0);
$adresse = null;
if (hat_tabelle($pdo, 'mandant')) {
    $sm = $pdo->prepare('SELECT subdomain FROM mandant WHERE id = ?');
    $sm->execute([(int)($daten['mandant'] ?? 0) ?: $ziffer]);
    $adresse = mandant_adresse((string)($sm->fetchColumn() ?: ''));
}
$post = sv_kunde_benachrichtigen($vorgang ?? [], trim((string)($betreiber['name'] ?? 'Support')),
                                 $adresse);

json_response(['status' => 'ok', 'id' => $id, 'neuer_status' => $neu,
               'nachrichten' => sv_nachrichten($ziel, $id),
               'post' => $post['lage']]);
