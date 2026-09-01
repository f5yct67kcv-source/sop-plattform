<?php
declare(strict_types=1);
// Die beiden Weichen von ohneRevierdienstBerechtigung() (ENT-284), ohne
// Datenbank: nur diese zwei Faelle verlassen die Funktion, BEVOR sie db()
// ueberhaupt anfragt -- ein vertauschtes "!==" oder eine vergessene
// Leer-Pruefung waere sonst erst am ersten echten Zuteilen aufgefallen.
// Die WHERE-Spalte selbst (revierdienst_berechtigt) prueft pruef_sql.php
// bereits statisch (einfache Tabelle, kein JOIN, keine Klammer im WHERE).
require __DIR__ . '/../backend/planung.php';
require_once __DIR__ . '/../backend/mitarbeiter.php';

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

pruef('KRITISCH: eine andere Einsatzart als Revierdienst wird gar nicht erst geprueft',
    ohneRevierdienstBerechtigung('Verkehrsdienst', [1, 2, 3]) === []);
pruef('Auch eine leere Einsatzart liefert leer, nicht alle',
    ohneRevierdienstBerechtigung('', [1, 2, 3]) === []);
pruef('KRITISCH: eine leere Mitarbeiterliste wird nicht angefragt',
    ohneRevierdienstBerechtigung('Revierdienst', []) === []);

// ══════════════ DIE ECHTE FELDLISTE, NICHT DAS PLAYWRIGHT-FIXTURE
//
// Die Playwright-Suiten bilden jede Serverantwort mit einer eigenen
// Fixture nach -- eine Pruefung, die dort 'revierdienst_berechtigt in q'
// liest, bestaetigt nur, dass die Oberflaeche eine Fixture durchreicht, NIE
// dass ma_listenfelder() das Feld wirklich enthaelt (gleicher Befund wie
// pruef_sql.php ganz oben in seinem eigenen Kopfkommentar: "PHP laeuft dabei
// nie"). Hier laeuft die echte Funktion.
pruef('KRITISCH: die Sammelliste (Planung) enthaelt die Revierdienst-Berechtigung -- '
    . 'wer einteilt, muss sehen, wer darf',
    in_array('revierdienst_berechtigt', ma_listenfelder(), true));
pruef('KRITISCH: das Feld ist NICHT in der vertraulichen Liste -- Planung darf es sehen',
    !in_array('revierdienst_berechtigt', ma_vertrauliche_felder(), true));
pruef('Das Feld ist als janein typisiert, wie die beiden anderen Berechtigungen',
    (ma_felder()['revierdienst_berechtigt'] ?? null) === 'janein');

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
