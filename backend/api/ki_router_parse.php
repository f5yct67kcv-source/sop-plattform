<?php
// Spracheingabe: ordnet einen diktierten oder getippten Text einer Faehigkeit
// zu und liefert deren Felder (ENT-032, seit ENT-695 in zwei Stufen ueber
// den Katalog ki_faehigkeiten() in ai.php).
//
// Schreibt nichts -- das Ergebnis oeffnet nur den passenden bestehenden
// Dialog vorbefuellt; gespeichert wird per Klick (ENT-015).
//
// Rechte: Zugang hat, wer in die Verwaltung darf. Ob die erkannte Faehigkeit
// erlaubt ist, entscheidet danach darf() mit deren eigenem Recht -- vorher
// galt fuer alles einsaetze_schreiben (ENT-695).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../ai.php';

$user = require_session();
require_verwaltung($user);
require_once __DIR__ . '/../mitarbeiter.php';   // ma_nur_menschen() (ENT-631)
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$text = trim((string)($input['text'] ?? ''));
if ($text === '') {
    json_response(['status' => 'error', 'message' => 'Text erforderlich'], 400);
}
$heute = trim((string)($input['heute'] ?? ''));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $heute)) {
    $heute = date('Y-m-d');
}

// ── Stufe 1: das Anliegen
$a = anthropic_ki_absicht($text);
if ($a === null) {
    ki_fehler_melden();
}
[$code, $antwort, $key] = ki_absicht_pruefen($a, fn(string $recht) => darf($user, $recht));
// Endet es hier (nicht verstanden, nicht abgedeckt, kein Recht), steht die
// fertige Antwort schon da.
if ($antwort !== null) {
    json_response($antwort, $code);
}

// ── Stufe 2: nur die Listen, die diese Faehigkeit braucht
$listen = [];
foreach (ki_faehigkeiten()[$key]['listen'] as $liste) {
    if ($liste === 'kunden') {
        $listen['kunden'] = db()->query('SELECT id, name FROM kunden ORDER BY name')->fetchAll();
    } elseif ($liste === 'mitarbeiter') {
        $listen['mitarbeiter'] = db()->query(
            'SELECT name, vorname, nachname FROM mitarbeiter WHERE aktiv = 1 AND ' . ma_nur_menschen(db()) . ' ORDER BY name'
        )->fetchAll();
    } elseif ($liste === 'produkte') {
        // Der Katalog nur fuer wen er ohnehin lesbar ist. Ohne ihn werden
        // alle Positionen Freitextzeilen -- dasselbe, was das Formular dieser
        // Person auch von Hand bietet.
        $listen['produkte'] = darf($user, 'leistungen_lesen') && hat_tabelle(db(), 'produkte')
            ? db()->query('SELECT id, name, einheit FROM produkte WHERE aktiv = 1 ORDER BY sortierung, name')->fetchAll()
            : [];
    }
}

$e = anthropic_ki_felder($key, $text, $listen, $heute);
if ($e === null) {
    ki_fehler_melden();
}
[$code, $antwort] = ki_felder_auswerten($key, $e, $listen);
json_response($antwort, $code);
