<?php
// Ein Betreiber-Konto aktivieren oder stilllegen (ENT-519).
//
// MIT AUSSPERRSCHUTZ. Dieselbe Falle wie OP-505 in der Verwaltung: Dort
// liess sich der letzte Verwalter deaktivieren, und danach konnte niemand
// mehr Rollen vergeben -- der Weg zurueck war phpMyAdmin. Hier waere es
// schlimmer, weil es ueber der Betreiber-Ebene keine weitere gibt, die
// jemanden wieder hereinliesse.
//
// Geloescht wird nicht: Ein stillgelegtes Konto bleibt sichtbar, damit
// nachvollziehbar ist, wer einmal Zugang hatte. `aktiv = 0` wirkt sofort,
// weil require_betreiber_voll() es in der Abfrage prueft -- eine laufende
// Sitzung muss nicht erst ablaufen.
//
// REAKTIVIEREN HEISST NEU EINLADEN (ENT-737). Ein stillgelegtes Konto kommt
// nicht mehr mit seinem alten Passwort zurueck: Altes Passwort und zweiter
// Faktor fallen weg, ein Link geht an die hinterlegte Adresse, und aktiv
// wird das Konto erst, wenn die Person ihr neues Passwort gesetzt hat. So
// kommt zurueck, wer seines verloren hat -- unter derselben Adresse und mit
// demselben Konto samt Verlauf --, ohne dass jemand ein fremdes Passwort
// setzt (ENT-615). Begruendung bei be_konto_wieder_einladen().
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../logbuch.php';
require_once __DIR__ . '/../mailer.php';

$ich = require_betreiber_voll();
$pdo = betreiber_db();

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id    = (int)($daten['id'] ?? 0);
$aktiv = $daten['aktiv'] ?? null;

if ($id <= 0 || !is_bool($aktiv)) {
    json_response(['status' => 'error',
        'message' => 'Welches Konto, und aktiv oder stillgelegt?'], 400);
}

$s = $pdo->prepare('SELECT id, name, aktiv FROM betreiber WHERE id = ?');
$s->execute([$id]);
$konto = $s->fetch(PDO::FETCH_ASSOC);
if (!$konto) {
    json_response(['status' => 'error', 'message' => 'Dieses Konto gibt es nicht.'], 404);
}

// EIN EINGELADENES KONTO LAESST SICH NICHT VON HAND FREISCHALTEN
// (ENT-667). Sonst entstuende ein aktives Konto ohne Passwort: Es kaeme
// zwar niemand hinein (betreiber_anmelden.php prueft den leeren Hash), aber
// die Kontenliste zeigte es als gewoehnliches Konto, und die offene
// Einladung bliebe unbemerkt gueltig. "Eingeladen" ist ein eigener Zustand
// und kein stillgelegtes Konto -- die Hausregel, dass Unbekanntes nie wie
// Keines aussehen darf, gilt auch in diese Richtung.
if ($aktiv && be_einladung_offen($pdo, $id)) {
    json_response(['status' => 'error',
        'message' => 'Dieses Konto ist eingeladen, aber noch nicht eingelöst. Es wird von '
                   . 'selbst aktiv, sobald die eingeladene Person ihr Passwort gesetzt hat.'], 409);
}

if (!$aktiv && be_konten_zahl($pdo, $id) === 0) {
    json_response(['status' => 'error',
        'message' => 'Das ist das letzte aktive Betreiber-Konto. Ohne es käme niemand mehr '
                   . 'in diesen Bereich, und es gibt keine Ebene darüber, die wieder '
                   . 'hereinlässt. Zuerst ein zweites Konto anlegen, dann dieses stilllegen.'], 409);
}

// ── Reaktivieren: neuer Link statt altes Passwort ─────────────────────
if ($aktiv && (int)$konto['aktiv'] === 0) {
    if (hat_spalte($pdo, 'betreiber', 'archiviert_am')) {
        $a = $pdo->prepare('SELECT archiviert_am FROM betreiber WHERE id = ?');
        $a->execute([$id]);
        if ($a->fetchColumn() !== null) {
            json_response(['status' => 'error',
                'message' => 'Dieses Konto ist archiviert. Erst aus dem Archiv holen, dann reaktivieren.'], 409);
        }
    }
    if (!be_einladung_tabelle_da($pdo)) {
        json_response(['status' => 'error',
            'message' => 'Die Einladungen sind in dieser Anlage noch nicht nachgetragen. '
                       . 'Ein Lauf der Einrichtung holt das nach.'], 503);
    }
    // Erst pruefen, ob sich verschicken laesst -- sonst stuende das Konto
    // ohne Passwort da und ohne Link, der es zurueckholt.
    if (!smtp_konfiguriert()) {
        json_response(['status' => 'error',
            'message' => 'Für diese Anlage ist kein E-Mail-Versand eingerichtet. '
                       . 'Ohne ihn lässt sich kein Konto reaktivieren.'], 503);
    }
    $basis = basis_url();
    if ($basis === null) {
        json_response(['status' => 'error',
            'message' => 'Die eigene Adresse der Anlage ist nicht gesetzt (APP_BASIS_URL). '
                       . 'Ohne sie liesse sich kein Link bauen, der zurückführt.'], 503);
    }
    $felder = hat_spalte($pdo, 'betreiber', 'vorname') ? 'name, vorname, email' : 'name, email';
    $k = $pdo->prepare('SELECT ' . $felder . ' FROM betreiber WHERE id = ?');
    $k->execute([$id]);
    $ziel = $k->fetch(PDO::FETCH_ASSOC) ?: [];

    // Passwort leeren, Einladung anlegen und versenden in EINER
    // Transaktion: Geht die Nachricht nicht hinaus, bleibt das Konto, wie
    // es war -- stillgelegt, mit seinem alten Passwort.
    $tokenRoh = bin2hex(random_bytes(32));
    $pdo->beginTransaction();
    try {
        if (!be_konto_wieder_einladen($pdo, $id, $tokenRoh, (int)$ich['id'])) {
            throw new LogicException('nicht wieder einladbar');
        }
        // Der Pfad zur Seite wird am Buendel gemessen -- Begruendung bei
        // be_einladung_versenden() in backend/betreiber.php.
        $seite = is_file(__DIR__ . '/../betreiber.html') ? '/betreiber.html' : '/';
        be_einladung_versenden($basis . $seite . '?einladung=' . urlencode($tokenRoh),
                               (string)$ziel['email'], (string)$ziel['name'],
                               (string)($ziel['vorname'] ?? ''), (string)$ich['name'], false, true);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        if ($e instanceof RuntimeException) {
            json_response(['status' => 'error',
                'message' => 'Der Link liess sich nicht verschicken. Das Konto bleibt stillgelegt, wie es war.'], 502);
        }
        json_response(['status' => 'error',
            'message' => 'Das Konto konnte nicht reaktiviert werden.'], 400);
    }

    // Logbuch (ENT-614): der neue Zustand in Worten, und an welche Adresse
    // der Link ging.
    be_log($pdo, $ich, 'konto', $id, 'zustand', 'stillgelegt', 'eingeladen');
    be_log($pdo, $ich, 'konto', $id, 'neu_eingeladen', null, (string)$ziel['email']);

    json_response([
        'status'          => 'ok',
        'id'              => $id,
        'aktiv'           => false,
        'eingeladen'      => true,
        'email'           => (string)$ziel['email'],
        'gueltig_stunden' => BE_EINLADUNG_STUNDEN,
        'selbst'          => false,
    ]);
}

$pdo->prepare('UPDATE betreiber SET aktiv = ? WHERE id = ?')->execute([$aktiv ? 1 : 0, $id]);

// Logbuch (ENT-614). In Worten statt als 0/1: "aktiv → stillgelegt" liest
// jemand in zwei Jahren noch, "1 → 0" nicht.
be_log($pdo, $ich, 'konto', $id, 'zustand',
       (int)$konto['aktiv'] === 1 ? 'aktiv' : 'stillgelegt',
       $aktiv ? 'aktiv' : 'stillgelegt');

// Wird ein Konto stillgelegt, verfallen seine Sitzungen sofort mit. Ohne
// das bliebe ein bereits ausgestellter Token bis zum Ablauf gueltig --
// require_betreiber_voll() prueft zwar aktiv = 1, aber der Aufraeumschritt hier
// macht aus "wirkt nicht mehr" auch "liegt nicht mehr herum".
if (!$aktiv) {
    $pdo->prepare('DELETE FROM betreiber_sessions WHERE betreiber_id = ?')->execute([$id]);
}

json_response([
    'status' => 'ok',
    'id'     => $id,
    'aktiv'  => $aktiv,
    'selbst' => $id === (int)$ich['id'],
]);
