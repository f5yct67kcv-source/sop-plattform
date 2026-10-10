<?php
// Ein neues Konto der Betreiber-Ebene einladen (ENT-667).
//
// WAS SICH GEGENUEBER betreiber_konto_anlegen.php AENDERT: Dort tippte der
// Anlegende das Passwort des neuen Kontos und gab es weiter. Hier setzt er
// nur Name und E-Mail; das Geheimnis waehlt die eingeladene Person selbst,
// ueber einen einmaligen Link an ihre Adresse. Begruendung ausfuehrlich bei
// der Tabelle `betreiber_einladung` in backend/betreiber.php.
//
// DER BOOTSTRAP BLEIBT, WO ER WAR. Das allererste Konto entsteht weiterhin
// ueber betreiber_konto_anlegen.php aus dem Cockpit, mit Passwort. Nicht aus
// Bequemlichkeit: In diesem Moment gibt es weder ein Betreiber-Konto noch
// eine erprobte Versandstrecke, und ein Einladungsweg wuerde den Bereich
// gar nicht erst in Betrieb nehmen lassen, wenn SMTP klemmt. Ab dem zweiten
// Konto ist der Versand erprobt -- und ab da fuehrt nur noch dieser Weg.
//
// WER DARF DAS: require_betreiber_voll(). Wer selbst auf dieser Ebene
// angemeldet ist und seinen zweiten Faktor bestaetigt hat. Dieselbe Wache
// wie beim Anlegen -- ein Einladungslink ist ein Konto in spe und darf
// nicht billiger zu haben sein als das Konto selbst.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../anmeldung.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../logbuch.php';
require_once __DIR__ . '/../mailer.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = betreiber_db();
if (!be_einladung_tabelle_da($pdo)) {
    // Nicht eingerichtet ist etwas anderes als nicht erlaubt (Hausregel).
    json_response(['status' => 'error',
        'message' => 'Die Einladungen sind in dieser Anlage noch nicht nachgetragen. '
                   . 'Ein Lauf der Einrichtung holt das nach.'], 503);
}

$in       = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$email    = mb_strtolower(trim((string)($in['email'] ?? '')));
$anrede   = mb_substr(trim((string)($in['anrede']   ?? '')), 0, 20);
$vorname  = mb_substr(trim((string)($in['vorname']  ?? '')), 0, 100);
$nachname = mb_substr(trim((string)($in['nachname'] ?? '')), 0, 100);

if ($nachname === '') {
    json_response(['status' => 'error', 'message' => 'Ein Nachname wird gebraucht.'], 400);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_response(['status' => 'error', 'message' => 'Diese E-Mail-Adresse ist nicht gültig.'], 400);
}
$name = be_name_bauen($vorname, $nachname);

// ── Erst pruefen, ob sich ueberhaupt verschicken laesst ───────────────
//
// VOR dem Anlegen, nicht danach. Ein Konto, dessen Einladung nie
// hinausgeht, ist eine Karteileiche, die jemand spaeter stilllegen muss --
// und bis dahin belegt es die Adresse, unter der die Person eigentlich
// eingeladen werden sollte.
//
// Anders als bei passwort_vergessen.php wird der Fehlfall hier ausdruecklich
// GEMELDET: Dort ist der Aufrufer anonym und jede Unterscheidung verriete,
// welche Konten es gibt. Hier ist er ein angemeldeter Betreiber, und ein
// stilles "ok" waere die Auskunft, die er gerade nicht brauchen kann.
if (!smtp_konfiguriert()) {
    json_response(['status' => 'error',
        'message' => 'Für diese Anlage ist kein E-Mail-Versand eingerichtet. '
                   . 'Ohne ihn lässt sich niemand einladen.'], 503);
}
$basis = basis_url();
if ($basis === null) {
    json_response(['status' => 'error',
        'message' => 'Die eigene Adresse der Anlage ist nicht gesetzt (APP_BASIS_URL). '
                   . 'Ohne sie liesse sich kein Link bauen, der zurückführt.'], 503);
}

// ── Anlegen und einladen, oder gar nicht ──────────────────────────────
//
// Beides in EINER Transaktion, und der Versand entscheidet mit: Geht die
// Nachricht nicht hinaus, bleibt auch kein Konto zurueck. Der Versand liegt
// damit innerhalb der Transaktion -- unschoen, aber diese beiden Tabellen
// sind winzig und der Vorgang laeuft ein paar Mal im Leben der Anlage.
$tokenRoh = bin2hex(random_bytes(32));
$pdo->beginTransaction();
try {
    $stmt = $pdo->prepare(
        'INSERT INTO betreiber (name, anrede, vorname, nachname, email, passwort_hash, aktiv)
         VALUES (?, ?, ?, ?, ?, ?, 0)'
    );
    // LEERER HASH, nicht irgendein Platzhalter: password_verify() gibt
    // gegen einen leeren Hash immer false -- auch fuer ein leeres Passwort.
    // Zusammen mit aktiv = 0 sind das zwei unabhaengige Riegel, und
    // betreiber_anmelden.php prueft beide ausdruecklich.
    $stmt->execute([$name, $anrede, $vorname, $nachname, $email, '']);
    $neueId = (int)$pdo->lastInsertId();

    $pdo->prepare(
        'INSERT INTO betreiber_einladung (betreiber_id, token, gueltig_bis, erstellt_von)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ' . BE_EINLADUNG_STUNDEN . ' HOUR), ?)'
    )->execute([$neueId, hash('sha256', $tokenRoh), (int)$ich['id']]);

    // Der Pfad zur Seite wird am Buendel gemessen -- Begruendung bei
    // be_einladung_versenden() in backend/betreiber.php.
    $seite = is_file(__DIR__ . '/../betreiber.html') ? '/betreiber.html' : '/';
    be_einladung_versenden($basis . $seite . '?einladung=' . urlencode($tokenRoh),
                           $email, $name, $vorname, (string)$ich['name'], false);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    // Doppelte Adresse ist der einzige erwartbare Fall und bekommt eine
    // eigene Aussage. Dass ein Konto zu dieser Adresse schon besteht, ist
    // hier keine Auskunft an einen Fremden -- der Aufrufer sieht die ganze
    // Kontenliste ohnehin.
    if (str_contains($e->getMessage(), 'uq_betreiber_email')) {
        json_response(['status' => 'error',
            'message' => 'Für diese E-Mail-Adresse gibt es bereits ein Konto.'], 400);
    }
    if ($e instanceof RuntimeException) {
        json_response(['status' => 'error',
            'message' => 'Die Einladung liess sich nicht verschicken. Das Konto wurde darum nicht angelegt.'], 502);
    }
    json_response(['status' => 'error',
        'message' => 'Die Einladung konnte nicht verschickt werden.'], 400);
}

// Logbuch (ENT-614): Wer wen eingeladen hat. Die Einloesung schreibt einen
// zweiten Eintrag -- zusammen ergeben sie, wie dieses Konto entstanden ist.
be_log($pdo, $ich, 'konto', $neueId, 'eingeladen', null, $name . ' (' . $email . ')');

json_response(['status' => 'ok', 'id' => $neueId,
               'gueltig_stunden' => BE_EINLADUNG_STUNDEN]);
