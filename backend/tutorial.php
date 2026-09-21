<?php
declare(strict_types=1);
// Stand der Cockpit-Tour und des Demo-Hinweises fuer eine Person (siehe
// api/tutorial_gesehen.php und api/demo_hinweis_bestaetigen.php). Eigene,
// kleine Datei statt in db.php: Das dort sind Verbindungs- und
// Umgebungs-Helfer, hier geht es um eine konkrete Fachfrage.

// Ob diese Person eine bestimmte Tour schon gesehen hat -- steuert, ob sie
// beim Login automatisch wieder aufgeht.
function tutorial_gesehen(PDO $pdo, int $mitarbeiterId, string $tutorial): bool
{
    if (!hat_tabelle($pdo, 'tutorial_gesehen')) { return false; }
    $st = $pdo->prepare('SELECT 1 FROM tutorial_gesehen WHERE tutorial = ? AND mitarbeiter_id = ?');
    $st->execute([$tutorial, $mitarbeiterId]);
    return (bool)$st->fetchColumn();
}

// Ob DIESES Konto den Demo-Hinweis schon bestaetigt hat (siehe Kopfkommentar
// in api/demo_hinweis_bestaetigen.php -- eigene Sache, nicht dieselbe wie
// die Zustimmung zu den Nutzungsbedingungen bei der Demo-Anfrage).
function demo_hinweis_bestaetigt(PDO $pdo, int $mitarbeiterId): bool
{
    if (!hat_tabelle($pdo, 'demo_hinweis_bestaetigung')) { return false; }
    $st = $pdo->prepare('SELECT 1 FROM demo_hinweis_bestaetigung WHERE mitarbeiter_id = ?');
    $st->execute([$mitarbeiterId]);
    return (bool)$st->fetchColumn();
}
