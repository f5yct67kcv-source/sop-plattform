<?php
// Briefkopf des eigenen Betriebs fuer den Rapport-Ausdruck (ENT-155).
//
// GET  -> { status, betrieb: {firma, zusatz, fusszeile, logo_mime,
//           logo_groesse, logo(dataURL|null)} }
// POST -> speichern {firma, zusatz, fusszeile}
//         Logo setzen  {logo: base64, logo_mime, logo_dateiname?}
//         Logo weg     {logo_weg: true}
//
// Warum das Logo in der Datenbank und nicht im Dateisystem liegt: dieselbe
// Entscheidung wie bei den Einsatz-Dokumenten (ENT-117). Ein Verzeichnis mit
// hochgeladenen Dateien braucht eine .htaccess, die greifen muss; die
// Datenbank braucht das nicht. Ein Firmenlogo ist zwar nicht vertraulich --
// aber zwei verschiedene Wege fuer hochgeladene Dateien waeren zwei Wege, die
// beide richtig sein muessen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();

// Lesen darf jeder angemeldete Zugang: Der Briefkopf erscheint auf jedem
// Rapport-Ausdruck, und wer einen Rapport drucken darf, braucht ihn. Aendern
// ist eine Betriebseinstellung -- dafuer weiter unten das Recht "betrieb"
// (dasselbe Muster wie in anstellungsorte.php, ENT-077).

// 512 KB, nicht mehr: Das Logo steht im Briefkopf und wird dort hoechstens
// ein paar hundert Pixel breit gezeigt. Alles darueber ist Ballast, der bei
// jedem Ausdruck durch die Leitung geht -- und base64 waechst beim Transport
// ohnehin um rund ein Drittel.
const LOGO_MAX = 512 * 1024;
const LOGO_MIME_ERLAUBT = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

function betrieb_lesen(bool $mitLogo): array {
    $r = db()->query(
        'SELECT firma, zusatz, fusszeile, logo_mime, logo_groesse, logo
         FROM betrieb WHERE id = 1'
    )->fetch();
    if (!$r) {
        return ['firma' => '', 'zusatz' => '', 'fusszeile' => null,
                'logo_mime' => null, 'logo_groesse' => null, 'logo' => null];
    }
    $roh = $r['logo'];
    return [
        'firma'        => (string)$r['firma'],
        'zusatz'       => (string)$r['zusatz'],
        'fusszeile'    => $r['fusszeile'],
        'logo_mime'    => $r['logo_mime'],
        'logo_groesse' => $r['logo_groesse'] === null ? null : (int)$r['logo_groesse'],
        // Als Daten-URL, damit der Ausdruck es ohne zweiten Abruf einbauen
        // kann. Ein <img src="…"> auf einen eigenen Endpunkt waere beim
        // Drucken ein Rennen: window.print() wartet nicht zuverlaessig auf
        // ein noch ladendes Bild, und dann fehlt das Logo genau auf dem Blatt.
        'logo' => ($mitLogo && $roh !== null && $r['logo_mime'])
            ? 'data:' . $r['logo_mime'] . ';base64,' . base64_encode($roh)
            : null,
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    json_response(['status' => 'ok', 'betrieb' => betrieb_lesen(true)]);
}

require_recht($user, 'betrieb');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$pdo = db();
// Die Zeile kann fehlen, wenn die Einrichtung nach dem Anlegen der Tabelle
// nicht durchlief. Ohne sie liefe jedes UPDATE ins Leere und meldete
// trotzdem Erfolg -- der stillste aller Fehler.
$pdo->exec("INSERT IGNORE INTO betrieb (id, firma, zusatz) VALUES (1, '', '')");

if (!empty($in['logo_weg'])) {
    $pdo->prepare('UPDATE betrieb SET logo = NULL, logo_mime = NULL, logo_groesse = NULL,
                   geaendert_am = NOW(), geaendert_von = ? WHERE id = 1')
        ->execute([(int)$user['id']]);
    json_response(['status' => 'ok', 'betrieb' => betrieb_lesen(true)]);
}

if (isset($in['logo'])) {
    $mime = (string)($in['logo_mime'] ?? '');
    if (!in_array($mime, LOGO_MIME_ERLAUBT, true)) {
        json_response(['status' => 'error',
            'message' => 'Nur PNG, JPEG, SVG oder WebP.'], 400);
    }
    $roh = base64_decode((string)$in['logo'], true);
    if ($roh === false || $roh === '') {
        json_response(['status' => 'error', 'message' => 'Das Bild liess sich nicht lesen.'], 400);
    }
    if (strlen($roh) > LOGO_MAX) {
        json_response(['status' => 'error',
            'message' => 'Das Logo ist zu gross — höchstens 512 KB.'], 400);
    }
    $st = $pdo->prepare('UPDATE betrieb SET logo = ?, logo_mime = ?, logo_groesse = ?,
                         geaendert_am = NOW(), geaendert_von = ? WHERE id = 1');
    $st->bindValue(1, $roh, PDO::PARAM_LOB);
    $st->bindValue(2, $mime);
    $st->bindValue(3, strlen($roh), PDO::PARAM_INT);
    $st->bindValue(4, (int)$user['id'], PDO::PARAM_INT);
    $st->execute();
    json_response(['status' => 'ok', 'betrieb' => betrieb_lesen(true)]);
}

// Textfelder. Getrimmt, damit ein versehentliches Leerzeichen nicht als
// gepflegter Briefkopf durchgeht.
$firma  = trim((string)($in['firma'] ?? ''));
$zusatz = trim((string)($in['zusatz'] ?? ''));
$fuss   = trim((string)($in['fusszeile'] ?? ''));
if (mb_strlen($firma) > 200 || mb_strlen($zusatz) > 200) {
    json_response(['status' => 'error',
        'message' => 'Firma und Zusatz dürfen höchstens 200 Zeichen haben.'], 400);
}
$pdo->prepare('UPDATE betrieb SET firma = ?, zusatz = ?, fusszeile = ?,
               geaendert_am = NOW(), geaendert_von = ? WHERE id = 1')
    ->execute([$firma, $zusatz, $fuss === '' ? null : $fuss, (int)$user['id']]);

json_response(['status' => 'ok', 'betrieb' => betrieb_lesen(true)]);
