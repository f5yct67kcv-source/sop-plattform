<?php
// Das unterschriebene PDF einer Offerte oder eines Vertrags der Betreiberin am Link
// (ENT-688, Schritt 3).
//
// Bewusst OHNE Anmeldung -- derselbe Ausweis wie die Belegseite: der
// versand_token. Steht darum namentlich in OHNE_ANMELDUNG (test_php.mjs).
//
// Liefert NUR das gespeicherte PDF, nie ein neu erzeugtes: Was angenommen
// wurde, ist das Dokument aus dem Moment der Annahme. Stimmt seine
// Pruefsumme nicht, gibt es keines (beleg_pdf_gespeichert()).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';
require_once __DIR__ . '/../belegpdf.php';

function pdf_nicht_da(): void
{
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    echo 'Für diesen Link liegt kein unterschriebenes Dokument vor.';
    exit;
}

try {
    $token = (string)($_GET['token'] ?? '');
    if ($token === '') { pdf_nicht_da(); }
    $pdo = betreiber_db();
    $s = $pdo->prepare('SELECT id, art, nummer FROM be_belege WHERE versand_token = ?');
    $s->execute([$token]);
    $b = $s->fetch(PDO::FETCH_ASSOC);
    if (!$b) { pdf_nicht_da(); }
    $pdf = beleg_pdf_gespeichert($pdo, 'be_', (int)$b['id']);
    if ($pdf === null) { pdf_nicht_da(); }
    $titel = (string)(BELEG_ARTEN[(string)$b['art']]['titel'] ?? 'Beleg');
    $name = preg_replace('/[^A-Za-z0-9._-]/', '-', $titel . '-' . $b['nummer'] . '-angenommen') . '.pdf';
    header('Content-Type: application/pdf');
    header('Content-Disposition: inline; filename="' . $name . '"');
    header('Content-Length: ' . strlen($pdf));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');
    echo $pdf;
} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    echo 'Das Dokument lässt sich gerade nicht abrufen. Bitte versuchen Sie es später erneut.';
}
