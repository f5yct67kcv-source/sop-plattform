<?php
// Lohnartenkatalog (ENT-451).
//
// GET  -> alle Lohnarten samt Kennzeichen-Erklaerung
// POST -> anlegen/aendern, mit {id, loeschen:true} entfernen
//
// Der Katalog ist eine TABELLE und kein Quelltext: Jede neue Zulage waere
// sonst ein Deploy. Die sechs *_pflichtig-Kennzeichen sind der Kern -- sie
// erklaeren, warum eine Position in einer Bemessungsgrundlage auftaucht und
// in einer anderen nicht, und machen die Abrechnung damit nachvollziehbar
// statt zur Blackbox (Art. 12 Ziff. 5).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../planung.php';
require_once __DIR__ . '/../lohn.php';

$user = require_session();
require_recht($user, 'lohn_lesen');

function lohnarten_lesen(): array
{
    $rows = db()->query(
        'SELECT * FROM lohnart ORDER BY sortierung, bezeichnung'
    )->fetchAll();
    return array_map(function ($r) {
        foreach (['id','satz_bp','system','sortierung','aktiv','ahv_pflichtig',
                  'ferien_pflichtig','ml13_pflichtig','bvg_pflichtig',
                  'uvg_pflichtig','qst_pflichtig','bemessung'] as $f) {
            if (isset($r[$f]) && $r[$f] !== null) { $r[$f] = (int)$r[$f]; }
        }
        return $r;
    }, $rows);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    json_response([
        'status' => 'ok',
        'lohnarten' => lohnarten_lesen(),
        // Mitgeliefert statt in der Oberflaeche ein zweites Mal getippt:
        // Eine zweite Wortliste laeuft frueher oder spaeter auseinander.
        'kennzeichen' => lohnart_kennzeichen(),
        'arten' => lohnart_arten(),
    ]);
}

require_recht($user, 'lohn_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($input['id'] ?? 0);
$pdo = db();

if (!empty($input['loeschen'])) {
    if ($id <= 0) { json_response(['status' => 'error', 'message' => 'id fehlt'], 400); }
    // Systemlohnarten bleiben. Wer den Grundlohn loescht, haette eine
    // Abrechnung ohne Lohn -- und die Zeile faende sich in alten
    // Abrechnungen als blosse Nummer wieder. Deaktivieren geht.
    $st = $pdo->prepare('SELECT system, bezeichnung FROM lohnart WHERE id = ?');
    $st->execute([$id]);
    $vorhanden = $st->fetch();
    if (!$vorhanden) { json_response(['status' => 'error', 'message' => 'Lohnart nicht gefunden'], 404); }
    if ((int)$vorhanden['system'] === 1) {
        json_response(['status' => 'error',
            'message' => '„' . $vorhanden['bezeichnung'] . '" ist eine Systemlohnart und lässt '
                       . 'sich nicht löschen. Sie kann deaktiviert werden.'], 400);
    }
    $pdo->prepare('DELETE FROM lohnart WHERE id = ?')->execute([$id]);
    json_response(['status' => 'ok', 'lohnarten' => lohnarten_lesen()]);
}

$schluessel  = strtolower(trim((string)($input['schluessel'] ?? '')));
$bezeichnung = trim((string)($input['bezeichnung'] ?? ''));
$art         = strtolower(trim((string)($input['art'] ?? '')));
if ($bezeichnung === '') {
    json_response(['status' => 'error', 'message' => 'Bezeichnung erforderlich'], 400);
}
if (!array_key_exists($art, lohnart_arten())) {
    json_response(['status' => 'error',
        'message' => 'Art: ' . implode(', ', array_keys(lohnart_arten()))], 400);
}
// Der Schluessel ist die stabile Kennung, unter der eine Abrechnungszeile
// spaeter wiedergefunden wird. Er darf nur aus Kleinbuchstaben, Ziffern und
// Unterstrichen bestehen -- und sich, einmal vergeben, nicht mehr aendern.
if ($schluessel === '') {
    $schluessel = strtolower(preg_replace('/[^a-z0-9]+/i', '_', $bezeichnung));
}
if (!preg_match('/^[a-z][a-z0-9_]{1,39}$/', $schluessel)) {
    json_response(['status' => 'error',
        'message' => 'Schlüssel: Kleinbuchstaben, Ziffern und Unterstrich, Beginn mit einem Buchstaben'], 400);
}

$kz = [];
foreach (array_keys(lohnart_kennzeichen()) as $f) { $kz[] = !empty($input[$f]) ? 1 : 0; }
// Traegt die Zeile einen Betrag DIESER Abrechnungsperiode? Kein siebtes
// Kennzeichen, sondern die Frage DAVOR: Ist sie aus, bleiben die sechs
// wirkungslos, denn lohnlauf_grundlagen() ueberspringt die Zeile ganz.
//
// Sie wurde bisher weder gelesen noch geschrieben. Jede selbst angelegte
// Lohnart bekam damit den Schemawert 0 und fiel still aus AHV-, BVG-, UVG-
// und Quellensteuergrundlage -- eine Zulage war erfasst, sichtbar, und in
// keiner Bemessungsgrundlage. Genau die Fehlerfamilie, die die Kommentare
// dieses Bausteins als "erfasst sieht aus wie wirksam" beschreiben.
$bemessung = !empty($input['bemessung']) ? 1 : 0;
$satzBp = isset($input['satz_bp']) && $input['satz_bp'] !== '' ? (int)$input['satz_bp'] : null;
$basis  = trim((string)($input['basis_schluessel'] ?? '')) ?: null;
$gav    = trim((string)($input['gav_grundlage'] ?? '')) ?: null;
$sortierung = (int)($input['sortierung'] ?? 100);
$aktiv  = isset($input['aktiv']) && !$input['aktiv'] ? 0 : 1;
$bem    = trim((string)($input['bemerkung'] ?? '')) ?: null;

if ($id > 0) {
    // Der Schluessel bleibt, was er war -- eine Umbenennung wuerde alte
    // Abrechnungszeilen von ihrer Lohnart trennen.
    $pdo->prepare(
        'UPDATE lohnart SET bezeichnung = ?, art = ?, basis_schluessel = ?, satz_bp = ?,
             ahv_pflichtig = ?, ferien_pflichtig = ?, ml13_pflichtig = ?,
             bvg_pflichtig = ?, uvg_pflichtig = ?, qst_pflichtig = ?, bemessung = ?,
             gav_grundlage = ?, sortierung = ?, aktiv = ?, bemerkung = ?,
             geaendert_von = ?, geaendert_am = NOW()
         WHERE id = ?'
    )->execute(array_merge([$bezeichnung, $art, $basis, $satzBp], $kz,
        [$bemessung, $gav, $sortierung, $aktiv, $bem, (int)$user['id'], $id]));
} else {
    try {
        $pdo->prepare(
            'INSERT INTO lohnart
               (schluessel, bezeichnung, art, basis_schluessel, satz_bp,
                ahv_pflichtig, ferien_pflichtig, ml13_pflichtig,
                bvg_pflichtig, uvg_pflichtig, qst_pflichtig, bemessung,
                gav_grundlage, system, sortierung, aktiv, bemerkung,
                geaendert_von, geaendert_am)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,NOW())'
        )->execute(array_merge([$schluessel, $bezeichnung, $art, $basis, $satzBp], $kz,
            [$bemessung, $gav, $sortierung, $aktiv, $bem, (int)$user['id']]));
    } catch (Throwable $e) {
        json_response(['status' => 'error',
            'message' => 'Den Schlüssel „' . $schluessel . '" gibt es bereits'], 400);
    }
}
json_response(['status' => 'ok', 'lohnarten' => lohnarten_lesen()]);
