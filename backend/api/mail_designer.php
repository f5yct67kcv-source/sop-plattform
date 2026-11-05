<?php
declare(strict_types=1);
// E-Mail-Designer des Betriebs (ENT-729).
//
// GET  -> { status, gestaltung, vorgabe, arten, betrieb, stand_unbekannt }
// POST {aktion: 'vorschau', gestaltung, art}  -> { status, betreff, html }
// POST {aktion: 'speichern', gestaltung}      -> { status, gestaltung } | 400 { fehler: [...] }
// POST {aktion: 'testmail', gestaltung, art}  -> { status, an }
//
// Rechte: Ansehen und Vorschau mit "betrieb" lesen, Speichern und Testmail
// mit "betrieb" schreiben. Die Gestaltung gilt fuer alle Konten des
// Betriebs und fuer jede Kundin -- dasselbe Recht wie der Briefkopf.
//
// Die Vorschau rechnet der Server mit derselben Funktion, die auch die
// echte Mail baut (mail_betrieb_bauen). So sieht man, was ankommt.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../mailer.php';
require_once __DIR__ . '/../mail_gestaltung.php';

$user = require_session();
$pdo = db();
$spalteDa = hat_spalte($pdo, 'betrieb', 'mail_gestaltung');

function mg_arten(): array
{
    $raus = [];
    foreach (MAIL_ARTEN as $k => $a) {
        $raus[] = ['art' => $k, 'name' => $a['name'], 'knopf' => $a['knopf'], 'fest' => $a['fest'],
                   'platzhalter' => array_merge(MAIL_G_ALLGEMEIN, $a['platzhalter'])];
    }
    return $raus;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    require_recht($user, 'betrieb_lesen');
    $b = mail_g_betrieb($pdo);
    json_response([
        'status' => 'ok',
        'gestaltung' => mail_g_laden($pdo),
        'vorgabe' => mail_g_vorgabe(),
        'arten' => mg_arten(),
        'betrieb' => ['firma' => $b['firma'], 'hat_logo' => $b['logo'] !== null, 'logo_webp' => $b['logo_webp'],
                      'email' => $b['email']],
        'stand_unbekannt' => !$spalteDa,
        'darf_aendern' => darf($user, 'betrieb_schreiben'),
    ]);
}

$in = json_decode((string)file_get_contents('php://input'), true);
$in = is_array($in) ? $in : [];
$aktion = (string)($in['aktion'] ?? '');
$art = array_key_exists((string)($in['art'] ?? ''), MAIL_ARTEN) ? (string)$in['art'] : 'offerte';

if ($aktion === 'vorschau') {
    require_recht($user, 'betrieb_lesen');
    [$g] = mail_g_pruefen($in['gestaltung'] ?? null);
    $m = mail_betrieb_bauen($g, mail_g_betrieb($pdo), $art, mail_g_muster($art),
        ['link' => 'https://beispiel.guardops.ch/beleg?token=muster', 'code' => '483 920', 'fassung' => 1], true);
    json_response(['status' => 'ok', 'betreff' => $m['betreff'], 'html' => $m['html']]);
}

if ($aktion === 'speichern') {
    require_recht($user, 'betrieb_schreiben');
    if (!$spalteDa) {
        json_response(['status' => 'error', 'stand_unbekannt' => true,
            'message' => 'Die Einrichtung ist noch nicht auf dem neusten Stand. Die Gestaltung lässt sich danach speichern.'], 409);
    }
    [$g, $fehler] = mail_g_pruefen($in['gestaltung'] ?? null);
    if ($fehler) {
        json_response(['status' => 'error', 'fehler' => $fehler,
            'message' => 'Nicht gespeichert: ' . implode(' ', $fehler)], 400);
    }
    $pdo->prepare('UPDATE betrieb SET mail_gestaltung = ? WHERE id = 1')
        ->execute([json_encode($g, JSON_UNESCAPED_UNICODE)]);
    json_response(['status' => 'ok', 'gestaltung' => $g]);
}

if ($aktion === 'testmail') {
    require_recht($user, 'betrieb_schreiben');
    [$g, $fehler] = mail_g_pruefen($in['gestaltung'] ?? null);
    if ($fehler) {
        json_response(['status' => 'error', 'fehler' => $fehler, 'message' => implode(' ', $fehler)], 400);
    }
    $s = $pdo->prepare('SELECT name, email FROM mitarbeiter WHERE id = ?');
    $s->execute([(int)$user['id']]);
    $ich = $s->fetch(PDO::FETCH_ASSOC) ?: [];
    $an = trim((string)($ich['email'] ?? ''));
    if (!filter_var($an, FILTER_VALIDATE_EMAIL)) {
        json_response(['status' => 'error', 'ohne_adresse' => true,
            'message' => 'An deinem Konto ist keine E-Mail-Adresse hinterlegt. Trage sie unter „Mein Profil“ ein.'], 400);
    }
    if (!smtp_konfiguriert()) {
        json_response(['status' => 'error', 'message' => 'Der E-Mail-Versand ist noch nicht eingerichtet.'], 503);
    }
    $m = mail_betrieb_bauen($g, mail_g_betrieb($pdo), $art, mail_g_muster($art),
        ['link' => (basis_url() ?? 'https://guardops.ch'), 'code' => '483 920', 'fassung' => 1]);
    try {
        smtp_senden($an, (string)($ich['name'] ?? ''), '[Testmail] ' . $m['betreff'], $m['html'], $m['text'],
            [], $m['bilder'], $m['antwort_an']);
    } catch (Throwable $e) {
        json_response(['status' => 'error', 'message' => 'Versand fehlgeschlagen: ' . $e->getMessage()], 502);
    }
    json_response(['status' => 'ok', 'an' => $an]);
}

json_response(['status' => 'error', 'message' => 'Unbekannte Aktion.'], 400);
