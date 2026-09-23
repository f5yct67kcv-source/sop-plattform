<?php
// Beleg archivieren oder zurueckholen (ENT-181).
//
// Es gibt bewusst KEIN Stornieren und kein Loeschen: Eine Offerte hat keine
// Buchhaltungswirkung, die storniert werden muesste -- fachlich deckt der
// Status 'abgelehnt' den Fall ab. Archivieren nimmt sie nur aus der Liste,
// jederzeit umkehrbar, gleiches Muster wie bei Kunden (ENT-040).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../logbuch.php';

$user = require_session();
require_recht($user, 'offerten_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);
$aktiv = !empty($in['aktiv']) ? 1 : 0;
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$pdo = db();
$chk = $pdo->prepare('SELECT id, aktiv FROM belege WHERE id = ?');
$chk->execute([$id]);
$vorher = $chk->fetch();
if (!$vorher) {
    json_response(['status' => 'error', 'message' => 'Beleg nicht gefunden'], 404);
}
$pdo->prepare('UPDATE belege SET aktiv = ? WHERE id = ?')->execute([$aktiv, $id]);

// Verlauf (ENT-697), gleiche Zeile wie im Betreiber-Bereich.
if ((int)$vorher['aktiv'] !== $aktiv) {
    logbuch_schreiben($pdo, $user, 'beleg', $id, 'zustand',
        (int)$vorher['aktiv'] === 1 ? 'aktiv' : 'archiviert', $aktiv ? 'aktiv' : 'archiviert');
}

json_response(['status' => 'ok', 'aktiv' => $aktiv]);
