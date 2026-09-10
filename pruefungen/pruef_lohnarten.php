<?php
declare(strict_types=1);
// Die Lohnart-Kennzeichen kommen wirklich in der Datenbank an -- geprueft
// gegen das ECHTE Schema aus dem Einrichtungslauf und die ECHTEN Anweisungen
// aus lohnarten.php, nicht gegen eine nachgetippte Fassung.
//
// Warum diese Pruefung besteht: Das Feld `bemessung` wurde weder gelesen
// noch geschrieben. Jede selbst angelegte Lohnart bekam damit den
// Schemawert 0 -- und lohnlauf_grundlagen() ueberspringt jede Zeile ohne
// Bemessung ganz. Eine betriebliche Zulage war also erfasst, sichtbar, mit
// gesetzten Kennzeichen -- und zaehlte in KEINE Bemessungsgrundlage: nicht
// in die AHV, nicht ins BVG, nicht ins UVG, nicht in die Quellensteuer.
// Nichts ging kaputt, nichts meldete sich; die Beitraege waren zu tief.
//
// Geprueft wird darum das ERGEBNIS in der Tabelle, nicht die Form der
// Anweisung: Was nuetzt eine Spalte im INSERT, wenn der Wert daneben fehlt.
// Dieselbe Fehlerfamilie hat hier schon einmal zugeschlagen ("14 Felder, 13
// Platzhalter", ENT-451) -- eine falsche Zahl faellt hier sofort auf, weil
// die echte Anweisung sonst gar nicht laeuft.

require __DIR__ . '/schema_echt.php';

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

pruef('Das Schema fuer lohnart ist im Einrichtungslauf auffindbar', schema_create('lohnart') !== null);

$quelle = file_get_contents(__DIR__ . '/../backend/api/lohnarten.php');
preg_match("/'(INSERT INTO lohnart\s.*?)'/s", $quelle, $mIns);
preg_match("/'(UPDATE lohnart SET.*?)'/s", $quelle, $mUpd);
pruef('Beide Schreibwege sind in lohnarten.php auffindbar',
    !empty($mIns[1]) && !empty($mUpd[1]));

if (schema_create('lohnart') !== null && !empty($mIns[1]) && !empty($mUpd[1])) {

    $q = new PDO('sqlite::memory:', null, null,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
         PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    // Anlegen ueber schema_echt.php: CREATE plus die Nachtraege des
    // Einrichtungslaufs, an einer Stelle gepflegt statt je Datei kopiert.
    $fehler = schema_anlegen($q, 'lohnart');
    pruef('KRITISCH: das echte Schema laesst sich anlegen', $fehler === null);

    if ($fehler === null) {
        // Werte in der Reihenfolge des Endpunkts: Stammangaben, die sechs
        // Kennzeichen, dann bemessung und der Rest.
        $ins = str_replace('NOW()', "datetime('now')", $mIns[1]);
        $kz = [1, 0, 0, 1, 1, 0];   // ahv, ferien, ml13, bvg, uvg, qst
        // Abgefangen statt abgestuerzt: Passt die Anweisung nicht mehr zu den
        // Werten, die der Endpunkt schickt, soll das eine BENANNTE Zusage rot
        // machen. Genau diese Unstimmigkeit war der Livefehler vom 2026-09-09.
        $fehlerIns = null;
        try {
            $q->prepare($ins)->execute(array_merge(
                ['pikettzulage', 'Pikettzulage', 'fixbetrag', null, null], $kz,
                [1, null, 100, 1, null, 7]));
        } catch (Throwable $e) { $fehlerIns = $e->getMessage(); }
        pruef('KRITISCH: die Anweisung nimmt genau die Werte, die der Endpunkt schickt',
            $fehlerIns === null);

        $r = $q->query("SELECT * FROM lohnart WHERE schluessel = 'pikettzulage'")->fetch();
        pruef('KRITISCH: eine neu angelegte Lohnart traegt die Bemessung, die geschickt wurde',
            $r !== false && (int)$r['bemessung'] === 1);
        pruef('KRITISCH: und die sechs Kennzeichen landen in der richtigen Spalte',
            $r !== false && (int)$r['ahv_pflichtig'] === 1 && (int)$r['ferien_pflichtig'] === 0
            && (int)$r['ml13_pflichtig'] === 0 && (int)$r['bvg_pflichtig'] === 1
            && (int)$r['uvg_pflichtig'] === 1 && (int)$r['qst_pflichtig'] === 0);
        pruef('Die Stammangaben stehen ebenfalls richtig -- kein Versatz um eine Spalte',
            $r !== false && $r['bezeichnung'] === 'Pikettzulage' && $r['art'] === 'fixbetrag'
            && (int)$r['system'] === 0 && (int)$r['aktiv'] === 1);

        // Und die Bemessung laesst sich auch wieder WEGnehmen -- sonst waere
        // der Fehler nur in die andere Richtung gewandert.
        $upd = str_replace('NOW()', "datetime('now')", $mUpd[1]);
        $fehlerUpd = null;
        try {
            $q->prepare($upd)->execute(array_merge(
                ['Pikettzulage', 'fixbetrag', null, null], $kz,
                [0, null, 100, 1, null, 7, (int)($r['id'] ?? 0)]));
        } catch (Throwable $e) { $fehlerUpd = $e->getMessage(); }
        pruef('Dasselbe fuer den Aenderungsweg', $fehlerUpd === null);
        $r2 = $q->query("SELECT * FROM lohnart WHERE schluessel = 'pikettzulage'")->fetch();
        pruef('KRITISCH: das Aendern schreibt die Bemessung ebenfalls, in beide Richtungen',
            $r2 !== false && (int)$r2['bemessung'] === 0);
        pruef('Und der Schluessel bleibt beim Aendern unangetastet',
            $r2 !== false && $r2['schluessel'] === 'pikettzulage');
    }
}

echo "$ok Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
