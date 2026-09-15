<?php
declare(strict_types=1);
// Zugangspruefung fuer jede Seite unter handbuch/ -- per require ganz am
// Kopf jeder Seite eingebunden, VOR jeder HTML-Ausgabe (Sperren gehoeren in
// den Server, nicht in die Oberflaeche, CLAUDE.md).
//
// Pfad-Hinweis: handbuch/ wird unveraendert als Unterordner ausgeliefert
// (dist/handbuch/...), waehrend backend/ beim Deploy abgeflacht wird
// (backend/db.php -> dist/db.php, siehe deploy-hostpoint.yml). '../db.php'
// ist darum die richtige Adresse fuer die AUSGELIEFERTE Seite -- im rohen
// Repository liegt db.php dagegen unter backend/db.php. Ein lokaler
// Test-Aufbau muss diese Auslieferungsstruktur nachbilden, sonst laeuft
// dieser Require ins Leere.
require __DIR__ . '/../db.php';

$rohTicket = $_COOKIE['hb_ticket'] ?? '';
$gueltig = false;

if ($rohTicket !== '') {
    $pdo = db();
    if (hat_tabelle($pdo, 'handbuch_ticket')) {
        $stmt = $pdo->prepare(
            'SELECT 1 FROM handbuch_ticket WHERE token_hash = ? AND laeuft_ab > NOW()'
        );
        $stmt->execute([hash('sha256', $rohTicket)]);
        $gueltig = (bool)$stmt->fetchColumn();
    }
}

if ($gueltig) {
    return;
}

// "Kein gueltiges Ticket" ist eine von mehreren moeglichen Aussagen (nie
// abgelaufen / abgelaufen / falsch / Handbuch noch nicht eingerichtet) --
// nach aussen bewusst EINE gemeinsame, freundliche Meldung: Die genaue
// Unterscheidung waere fuer die aufrufende Person ohnehin nicht
// handlungsrelevant, der naechste Schritt ist in jedem Fall derselbe.
http_response_code(403);
$rueck = basis_url();
$rueckLink = $rueck !== null ? htmlspecialchars($rueck, ENT_QUOTES, 'UTF-8') . '/dashboard.html' : null;
?><!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Handbuch – Zugang abgelaufen</title>
<link rel="stylesheet" href="handbuch.css">
</head>
<body>
<div style="max-width:520px;margin:15vh auto 0;padding:0 20px">
  <div class="hb-kasten hb-hinweis">
    <p class="hb-kasten-titel">Dieser Zugang ist abgelaufen oder ungültig</p>
    <p>Das Handbuch lässt sich nur über einen frischen Link aus dem Cockpit
    öffnen. Bitte im Cockpit erneut auf „Handbuch" klicken<?= $rueckLink
      ? ' oder <a href="' . $rueckLink . '">zurück zum Cockpit</a>' : '' ?>.</p>
  </div>
</div>
</body>
</html>
<?php
exit;
