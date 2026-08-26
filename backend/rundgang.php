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
