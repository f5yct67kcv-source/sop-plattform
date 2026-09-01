<?php
// Pruef-/Kodierfunktion fuer die Vieleck-Koordinaten eines Geofence-Bereichs
// (ENT-286). Eigene Datei statt Inline-Code in den Endpunkten -- Lesen und
// Schreiben nutzen dieselbe Pruefung, statt sie an zwei Stellen zu
// wiederholen (gleiches Prinzip wie layout_pruefen() in layout.php).
declare(strict_types=1);

// Mindestens drei Ecken -- ein "Vieleck" mit weniger ist keine Flaeche.
// Jeder Punkt braucht lat/lng als endliche Zahl im gueltigen Wertebereich.
// Gibt die bereinigte Punktliste zurueck, oder null bei ungueltiger Eingabe.
function geofence_koordinaten_pruefen($roh): ?array
{
    if (!is_array($roh) || count($roh) < 3) {
        return null;
    }
    $out = [];
    foreach ($roh as $p) {
        if (!is_array($p) || !isset($p['lat'], $p['lng'])) {
            return null;
        }
        $lat = is_numeric($p['lat']) ? (float)$p['lat'] : null;
        $lng = is_numeric($p['lng']) ? (float)$p['lng'] : null;
        if ($lat === null || $lng === null || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
            return null;
        }
        $out[] = ['lat' => $lat, 'lng' => $lng];
    }
    return $out;
}
