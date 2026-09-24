<?php
// Die eigene Unterschrift hinterlegen (ENT-704).
//
// NUR AM EIGENEN KONTO. Welches Konto, sagt die Sitzung, nie die Anfrage:
// Eine Unterschrift, die jemand anderes fuer mich zeichnen koennte, steht
// danach unter Offerten, die ich freigebe. Darum gibt es hier keine id.
//
// GEPRUEFT WIE BEIM KUNDEN: nur eine PNG-Zeichnung als data-URL, mit echter
// PNG-Kennung, hoechstens BELEG_ZEICHNUNG_MAX gross (beleg_zeichnung_pruefen
// in belege.php). Leer ist kein Loeschen: Wer freigibt, braucht eine
// Unterschrift (ENT-704, Punkt 4), also wird eine vorhandene nur ersetzt.
//
// Alte Fassungen aendert eine neue Unterschrift nicht -- sie tragen die
// Kopie aus dem Moment ihrer Freigabe.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = betreiber_db();
if (be_unterschrift_von($pdo, (int)$ich['id']) === null) {
    json_response(['status' => 'error', 'lage' => 'nicht_eingerichtet',
        'message' => 'Die Unterschrift ist auf diesem Server noch nicht eingerichtet. '
                   . 'Bitte zuerst einen Einrichtungslauf machen.'], 503);
}

$in = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$bild = beleg_zeichnung_pruefen((string)($in['zeichnung'] ?? ''));
if ($bild === null || $bild === '') {
    json_response(['status' => 'error',
        'message' => 'Die Unterschrift liess sich nicht lesen. Bitte neu zeichnen.'], 400);
}

$pdo->prepare('UPDATE betreiber SET unterschrift = ?, unterschrift_am = NOW() WHERE id = ?')
    ->execute([$bild, (int)$ich['id']]);

// Im Logbuch steht, DASS neu gezeichnet wurde, nicht das Bild.
be_log($pdo, $ich, 'konto', (int)$ich['id'], 'unterschrift', null, null, true);

json_response(['status' => 'ok']);
