<?php
// Ein stillgelegtes Betreiber-Konto archivieren oder zurueckholen (ENT-672).
//
// ARCHIVIEREN IST NICHT LOESCHEN, und das ist der ganze Punkt. ENT-519
// haelt fest: "Geloescht wird nicht -- ein stillgelegtes Konto bleibt
// sichtbar, damit nachvollziehbar ist, wer einmal Zugang hatte." Auf einer
// Ebene, auf der jedes Konto JEDEN Mandanten erreicht, ist diese Spur das
// Einzige, was rueckblickend Fragen beantwortet. Archivieren nimmt das
// Konto aus der taeglichen Liste und sonst nichts: Die Zeile bleibt, das
// Logbuch behaelt seinen Bezug, und ein Reiter zeigt die archivierten
// weiter.
//
// NUR EIN STILLGELEGTES KONTO. Ein aktives zu archivieren hiesse, einen
// bestehenden Zugang aus der Liste zu nehmen -- also genau die Sorte
// Unsichtbarkeit, gegen die die Liste da ist. Wer archivieren will, legt
// zuerst still; das ist derselbe Schritt, der den Zugang tatsaechlich
// beendet, und er hat seine eigene Wache (betreiber_konto_status.php,
// Aussperrschutz).
//
// DIE ADRESSE BLEIBT BELEGT. Der eindeutige Index auf `betreiber.email`
// gilt auch fuer archivierte Konten. Bewusst so entschieden (ENT-672
// Punkt 5), offen als OP-673 -- wer dieselbe Person spaeter erneut
// aufnehmen will, braucht heute eine andere Adresse.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../logbuch.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = betreiber_db();
if (!hat_spalte($pdo, 'betreiber', 'archiviert_am')) {
    // Nicht eingerichtet ist etwas anderes als nicht erlaubt (Hausregel).
    json_response(['status' => 'error',
        'message' => 'Das Archiv ist in dieser Anlage noch nicht nachgetragen. '
                   . 'Ein Lauf der Einrichtung holt das nach.'], 503);
}

$in  = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id  = (int)($in['id'] ?? 0);
// `archiv` statt `aktiv` wie bei den Belegen: Am Konto ist `aktiv` bereits
// vergeben (stillgelegt/aktiv), und zwei Bedeutungen unter einem Namen
// waeren genau die Verwechslung, die dieser Endpunkt vermeiden soll.
$archiv = !empty($in['archiv']);

if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'Welches Konto?'], 400);
}

$s = $pdo->prepare('SELECT id, name, aktiv, archiviert_am FROM betreiber WHERE id = ?');
$s->execute([$id]);
$konto = $s->fetch(PDO::FETCH_ASSOC);
if (!$konto) {
    json_response(['status' => 'error', 'message' => 'Dieses Konto gibt es nicht.'], 404);
}

// Die Wache, um die es geht. Sie steht VOR dem Schreiben und im Server,
// nicht nur in der Oberflaeche -- eine Sperre, die man am Browser vorbei
// umgehen kann, ist keine (CLAUDE.md).
if ($archiv && (int)$konto['aktiv'] === 1) {
    json_response(['status' => 'error',
        'message' => 'Ein aktives Konto lässt sich nicht archivieren. Zuerst stilllegen — '
                   . 'erst damit endet der Zugang, und das Archiv räumt nur die Liste auf.'], 409);
}

// Nichts zu tun ist kein Fehler, aber auch keine Logbuchzeile wert.
$warSchon = $konto['archiviert_am'] !== null;
if ($warSchon === $archiv) {
    json_response(['status' => 'ok', 'unveraendert' => true]);
}

$pdo->prepare('UPDATE betreiber SET archiviert_am = ' . ($archiv ? 'NOW()' : 'NULL') . ' WHERE id = ?')
    ->execute([$id]);

// Logbuch (ENT-614). In Worten statt als Zeitstempel: "archiviert" liest
// jemand in zwei Jahren noch.
be_log($pdo, $ich, 'konto', $id, 'archiv',
       $warSchon ? 'archiviert' : 'in der Liste',
       $archiv   ? 'archiviert' : 'in der Liste');

json_response(['status' => 'ok']);
