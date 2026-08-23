<?php
declare(strict_types=1);
// Anordnung der Container je Benutzer (ENT-073).
//
// Bis hierher lag die Anordnung des Uebersichts-Dashboards im Browser
// (localStorage). Das genuegte, solange es eine Ansicht war. Mit den
// Mitarbeitendendetails ist es die zweite -- und eine Einstellung, die beim
// Wechsel vom Buerorechner auf den Laptop wieder auf Standard steht, wirkt
// wie ein Fehler. Entscheid des Projektinhabers am 2026-08-21: am Server,
// pro Benutzer.
//
// Was hier NICHT passiert: eine Bewertung des Inhalts. Welche Container es
// gibt, weiss die Oberflaeche; der Server prueft nur die FORM und die
// Groesse. Wuerde er die Container-Namen kennen, muesste jede neue Kachel
// an zwei Orten nachgetragen werden.

// Bereiche, fuer die eine Anordnung gespeichert werden darf. Feste Liste
// statt freier Text: Sonst legt ein beliebiger Aufruf beliebig viele Zeilen
// an, und die Tabelle waere ein offener Speicher.
const LAYOUT_BEREICHE = ['uebersicht', 'ma_detail'];

// Obergrenzen. Ein Layout ist eine Handvoll Eintraege; alles darueber ist
// kein Bedienvorgang mehr.
const LAYOUT_MAX_EINTRAEGE = 60;
const LAYOUT_MAX_ID = 40;
// Grenzen der Container-Hoehe in Pixeln (ENT-098). Dieselben Werte wie in der
// Oberflaeche; sie stehen hier noch einmal, weil der Server einem Wert aus dem
// Browser nicht glaubt.
const LAYOUT_H_MIN = 140;
const LAYOUT_H_MAX = 1600;

function layout_bereich_gueltig(string $bereich): bool
{
    return in_array($bereich, LAYOUT_BEREICHE, true);
}

// Nimmt an, was wie ein Layout aussieht, und wirft den Rest weg. Gibt die
// bereinigte Liste zurueck -- oder null, wenn nichts Brauchbares drin steht.
function layout_pruefen($roh): ?array
{
    if (!is_array($roh)) { return null; }
    if (count($roh) > LAYOUT_MAX_EINTRAEGE) { return null; }
    $sauber = [];
    $gesehen = [];
    foreach ($roh as $eintrag) {
        if (!is_array($eintrag) || !isset($eintrag['id'])) { return null; }
        $id = (string)$eintrag['id'];
        // Nur das Zeichenrepertoire, das die Oberflaeche selbst vergibt.
        if ($id === '' || strlen($id) > LAYOUT_MAX_ID || !preg_match('/^[a-z0-9_]+$/', $id)) {
            return null;
        }
        // Ein Container zweimal in einer Anordnung ergibt keinen Sinn.
        if (isset($gesehen[$id])) { return null; }
        $gesehen[$id] = true;
        $satz = ['id' => $id, 'sichtbar' => ($eintrag['sichtbar'] ?? true) !== false];
        // Groesse je Container (ENT-098). Eng geprueft und begrenzt: Der Wert
        // kommt aus dem Browser. Fehlt er, bleibt er weg -- das heisst
        // "automatisch" und ist etwas anderes als ein gesetzter Wert.
        $h = $eintrag['hoehe'] ?? null;
        if (is_numeric($h) && (int)$h >= LAYOUT_H_MIN && (int)$h <= LAYOUT_H_MAX) {
            $satz['hoehe'] = (int)$h;
        }
        $br = $eintrag['breite'] ?? null;
        if ($br === 'halb' || $br === 'voll') { $satz['breite'] = $br; }
        $sauber[] = $satz;
    }
    return $sauber ?: null;
}

// Gespeicherte Anordnung EINES Benutzers fuer EINEN Bereich.
// Nichts gespeichert heisst null -- die Oberflaeche nimmt dann ihren
// Standard. Das ist etwas anderes als eine leere Anordnung, bei der jemand
// bewusst alles ausgeblendet hat.
function layout_lesen(PDO $pdo, int $mitarbeiterId, string $bereich): ?array
{
    if (!hat_tabelle_layout($pdo)) { return null; }
    $s = $pdo->prepare('SELECT layout FROM benutzer_layout WHERE mitarbeiter_id = ? AND bereich = ?');
    $s->execute([$mitarbeiterId, $bereich]);
    $roh = $s->fetchColumn();
    if ($roh === false || $roh === null) { return null; }
    $daten = json_decode((string)$roh, true);
    return layout_pruefen($daten);
}

function layout_schreiben(PDO $pdo, int $mitarbeiterId, string $bereich, array $layout): void
{
    $s = $pdo->prepare(
        'INSERT INTO benutzer_layout (mitarbeiter_id, bereich, layout) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE layout = VALUES(layout)'
    );
    $s->execute([$mitarbeiterId, $bereich, json_encode($layout, JSON_UNESCAPED_UNICODE)]);
}

// Eigene Pruefung statt hat_tabelle() aus planung_einrichten.php: Die steht
// dort in einer Datei, die eine Migration ausfuehrt -- die will man nicht
// bei jedem Seitenaufruf einbinden.
function hat_tabelle_layout(PDO $pdo): bool
{
    static $da = null;
    if ($da === null) {
        $da = (bool)$pdo->query("SHOW TABLES LIKE 'benutzer_layout'")->fetchColumn();
    }
    return $da;
}
