<?php
// Gibt es fuer die angemeldete Person UEBERHAUPT noch einen offenen
// Rundgang? (ENT-628)
//
// Der Unterschied zu mein_rundgang_offen.php ist die fehlende einsatz_id:
// Jener Endpunkt beantwortet "laeuft fuer DIESEN Einsatz noch etwas" und
// setzt damit voraus, dass die App schon weiss, wo sie suchen soll. Nach
// einem App-Neustart weiss sie das nicht mehr -- rundgangAktiv lebt nur im
// Arbeitsspeicher der Sitzung, und mit ihm verschwand bis hierher auch der
// Hinweis-Chip aus ENT-234. Eine am Vorabend pausierte Runde war danach
// unsichtbar, obwohl sie in der Auswertung weiterlief.
//
// Die Arbeit macht rundgang_offener() in backend/rundgang.php -- dieselbe
// Funktion, die seit ENT-629 auch die beiden Startwege benutzen. Sie ist
// bewusst mager: Dieser Endpunkt laeuft bei jedem App-Start und bei jeder
// Rueckkehr aus dem Hintergrund und darf nichts kosten. Die vollstaendige
// Runde samt Kontrollpunkten holt erst "Fortsetzen".
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

// Ausschliesslich die eigenen Runden: mitarbeiter_id kommt aus der Sitzung,
// nie aus der Anfrage. Damit braucht es hier keine zusaetzliche Pruefung der
// Zuteilung -- wem die Runde gehoert, steht in der Zeile selbst.
$offen = rundgang_offener(db(), (int)$user['id']);

json_response(['status' => 'ok', 'rundgang' => $offen['rundgang'], 'weitere' => $offen['weitere']]);
