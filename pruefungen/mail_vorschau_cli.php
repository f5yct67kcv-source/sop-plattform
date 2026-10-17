<?php
declare(strict_types=1);
// Hilfsskript fuer test_mail_designer.mjs: rechnet die Vorschau mit der
// ECHTEN Funktion des Servers (mail_betrieb_bauen), ohne Datenbank. Liest
// {aktion, art, gestaltung, betrieb} von stdin, schreibt die Antwort, die
// api/mail_designer.php geben wuerde.
require_once __DIR__ . '/../backend/mailer.php';
require_once __DIR__ . '/../backend/mail_gestaltung.php';
$in = json_decode((string)stream_get_contents(STDIN), true) ?: [];
$b = array_merge(['firma' => 'Muster Sicherheit AG', 'strasse' => 'Beispielweg 1', 'ort' => '9999 Musterort',
    'telefon' => '000 000 00 00', 'email' => 'buero@beispiel.ch', 'logo' => null, 'logo_webp' => false], $in['betrieb'] ?? []);
if (!empty($b['logo_png'])) { $b['logo'] = ['mime' => 'image/png', 'inhalt' => base64_decode($b['logo_png'])]; }
$aktion = $in['aktion'] ?? 'get';
if ($aktion === 'get') {
    echo json_encode(['vorgabe' => mail_g_vorgabe(), 'arten' => array_map(fn($k) => ['art' => $k, 'name' => MAIL_ARTEN[$k]['name'],
        'knopf' => MAIL_ARTEN[$k]['knopf'], 'fest' => MAIL_ARTEN[$k]['fest'],
        'platzhalter' => array_merge(MAIL_G_ALLGEMEIN, MAIL_ARTEN[$k]['platzhalter'])], array_keys(MAIL_ARTEN))]);
    exit;
}
[$g, $fehler] = mail_g_pruefen($in['gestaltung'] ?? null);
if ($aktion === 'speichern') {
    echo json_encode($fehler ? ['status' => 'error', 'fehler' => $fehler, 'message' => 'Nicht gespeichert: ' . implode(' ', $fehler)]
                             : ['status' => 'ok', 'gestaltung' => $g]);
    exit;
}
$art = $in['art'] ?? 'offerte';
$m = mail_betrieb_bauen($g, $b, $art, mail_g_muster($art),
    ['link' => 'https://beispiel.guardops.ch/beleg?token=muster', 'code' => '483 920', 'fassung' => 1], true);
echo json_encode(['status' => 'ok', 'betreff' => $m['betreff'], 'html' => $m['html']]);
