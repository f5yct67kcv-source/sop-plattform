<?php
// Fachlogik fuer die Rundgang-Durchfuehrung (ENT-132/ENT-145/ENT-180).
//
// Getrennt von den API-Endpunkten (backend/api/mein_rundgang_*.php), damit
// sich der eigentliche Rechenkern echt gegen SQLite pruefen laesst --
// gleiches Prinzip wie planung.php/einsatz_sperre_pruefen().
declare(strict_types=1);

// Haversine-Distanz in Metern zwischen zwei Koordinaten.
function geo_distanz_meter(float $lat1, float $lng1, float $lat2, float $lng2): float
{
    $erdradius = 6371000.0;
    $dLat = deg2rad($lat2 - $lat1);
    $dLng = deg2rad($lng2 - $lng1);
    $a = sin($dLat / 2) ** 2
        + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
    $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
    return $erdradius * $c;
}

// Welche Kontrollpunkte eines Objekts sind in diesem Rundgang noch offen?
// "Offen" heisst: aktiv UND noch kein rundgang_scan-Eintrag dafuer (ENT-145:
// ein Punkt verschwindet aus der Restliste, sobald er bestaetigt ODER als
// nicht verfuegbar gemeldet wurde -- beides ist "erledigt", nicht nur die
// Bestaetigung).
function rundgang_kontrollpunkte_uebrig(PDO $pdo, int $rundgangId, int $objektId): array
{
    $s = $pdo->prepare(
        'SELECT k.* FROM kontrollpunkt k
          WHERE k.objekt_id = ? AND k.aktiv = 1
            AND NOT EXISTS (
              SELECT 1 FROM rundgang_scan s
               WHERE s.rundgang_id = ? AND s.kontrollpunkt_id = k.id
            )
          ORDER BY k.reihenfolge, k.id'
    );
    $s->execute([$objektId, $rundgangId]);
    return $s->fetchAll(PDO::FETCH_ASSOC);
}

// Ist eine "bestaetigt"-Meldung fuer diesen Kontrollpunkt plausibel? NFC
// verlangt die passende Chip-ID, Geofence verlangt eine Position innerhalb
// des Radius. Eine Sperre gehoert in den Server, nicht nur in die
// Oberflaeche (ENT-145: am echten System liess sich ein rein
// client-seitig kontrollierter Start sonst von jedem beliebigen Ort aus
// ausloesen).
// Gibt eine Fehlermeldung zurueck, oder null wenn plausibel.
function rundgang_scan_pruefen(array $kontrollpunkt, ?string $chipId, ?float $lat, ?float $lng): ?string
{
    if ($kontrollpunkt['typ'] === 'nfc') {
        if ($chipId === null || $chipId === '' || $chipId !== $kontrollpunkt['chip_id']) {
            return 'Chip-ID stimmt nicht mit diesem Kontrollpunkt ueberein.';
        }
        return null;
    }
    // geofence
    if ($lat === null || $lng === null) {
        return 'Standort fehlt.';
    }
    $distanz = geo_distanz_meter($lat, $lng, (float)$kontrollpunkt['lat'], (float)$kontrollpunkt['lng']);
    if ($distanz > (float)$kontrollpunkt['geofence_radius_m']) {
        return 'Ausserhalb des Kontrollpunkt-Bereichs (' . round($distanz) . 'm entfernt).';
    }
    return null;
}

// Pflichtgruende beim Abbruch (ENT-146 Punkt 2) -- die vier bei Coredinate
// beobachteten Kategorien, vom Projektinhaber am 2026-08-27 als ausreichend
// bestaetigt (keine eigenen CUPI24-Kategorien noetig). Eine Stelle fuer den
// Endpunkt UND jede Pruefung, damit sich die Liste nie an zwei Orten
// auseinanderentwickelt.
const RUNDGANG_ABBRUCH_GRUENDE = [
    'stelle_nicht_gefunden' => 'Stelle nicht gefunden',
    'nicht_genug_zeit'      => 'Nicht genug Zeit',
    'notfall_gebunden'      => 'Durch Notfall anderweitig gebunden',
    'sonstige'              => 'Sonstige Gruende',
];

// Fortschritt eines Rundgangs fuer die Uebersicht der Einsatzleitung
// (ENT-183): wie viele aktuell aktive Kontrollpunkte das Objekt hat, und wie
// viele davon in DIESEM Rundgang bestaetigt bzw. als nicht verfuegbar
// gemeldet wurden. "Aktuell aktive" heisst bewusst: wird ein Punkt spaeter
// aus der Vorlage entfernt, sinkt "gesamt" nachtraeglich fuer alte
// Rundgaenge -- das ist die gleiche Abwaegung wie bei kontrollpunkt_id
// ON DELETE SET NULL in rundgang_scan: die Vorlage von heute, nicht die von
// damals.
function rundgang_fortschritt(PDO $pdo, int $rundgangId, int $objektId): array
{
    $gesamtStmt = $pdo->prepare('SELECT COUNT(*) FROM kontrollpunkt WHERE objekt_id = ? AND aktiv = 1');
    $gesamtStmt->execute([$objektId]);
    $gesamt = (int)$gesamtStmt->fetchColumn();

    $s = $pdo->prepare('SELECT status, COUNT(*) AS n FROM rundgang_scan WHERE rundgang_id = ? GROUP BY status');
    $s->execute([$rundgangId]);
    $bestaetigt = 0; $nichtVerfuegbar = 0;
    foreach ($s->fetchAll(PDO::FETCH_ASSOC) as $z) {
        if ($z['status'] === 'bestaetigt') { $bestaetigt = (int)$z['n']; }
        if ($z['status'] === 'nicht_verfuegbar') { $nichtVerfuegbar = (int)$z['n']; }
    }
    return ['gesamt' => $gesamt, 'bestaetigt' => $bestaetigt, 'nicht_verfuegbar' => $nichtVerfuegbar];
}

// Ersetzt die komplette Punktzuordnung einer Kontrollrunden-Vorlage in einem
// Zug (ENT-204) -- der Aufrufer schickt die vollstaendige, geordnete Liste,
// kein einzelnes Hinzufuegen/Entfernen. Einfacher und weniger fehleranfaellig
// als inkrementelle Endpunkte, gleiches Vorgehen wie an anderen Stellen des
// Hauses (z.B. zuteilung_masse.php).
//
// Prueft serverseitig, dass jeder Punkt tatsaechlich zum Objekt der Vorlage
// gehoert -- sonst liesse sich ueber die API ein Punkt eines fremden Objekts
// in eine Runde mischen (Sperren gehoeren in den Server, nicht nur in die
// Oberflaeche). Gibt eine Fehlermeldung zurueck, oder null bei Erfolg.
function rundgang_vorlage_punkte_setzen(PDO $pdo, int $vorlageId, array $kontrollpunktIds): ?string
{
    $vorlageStmt = $pdo->prepare('SELECT objekt_id FROM rundgang_vorlage WHERE id = ?');
    $vorlageStmt->execute([$vorlageId]);
    $objektId = $vorlageStmt->fetchColumn();
    if ($objektId === false) {
        return 'Vorlage nicht gefunden.';
    }

    $ids = array_map('intval', $kontrollpunktIds);
    if (count(array_unique($ids)) !== count($ids)) {
        return 'Ein Kontrollpunkt wurde mehrfach angegeben.';
    }

    if ($ids) {
        $platzhalter = implode(',', array_fill(0, count($ids), '?'));
        $chk = $pdo->prepare("SELECT COUNT(*) FROM kontrollpunkt WHERE id IN ($platzhalter) AND objekt_id = ?");
        $chk->execute([...$ids, $objektId]);
        if ((int)$chk->fetchColumn() !== count($ids)) {
            return 'Mindestens ein Kontrollpunkt gehoert nicht zu diesem Objekt.';
        }
    }

    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM rundgang_vorlage_punkt WHERE vorlage_id = ?')->execute([$vorlageId]);
        $ins = $pdo->prepare(
            'INSERT INTO rundgang_vorlage_punkt (vorlage_id, kontrollpunkt_id, reihenfolge) VALUES (?, ?, ?)'
        );
        foreach ($ids as $i => $kpId) {
            $ins->execute([$vorlageId, $kpId, $i]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    return null;
}
