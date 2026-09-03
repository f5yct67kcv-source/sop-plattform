<?php
// Logbuch der Aenderungen (ENT-077).
//
// Vom Projektinhaber ausdruecklich bestellt: *"ebenso wichtiges thema auch
// bei anderen änderung ein log buch erfassen. Z.b bei ändern von
// vertragsdaten, wichtigen änderung an den personalien. Mit zeit und datum"*
// und *"voralllem welcher admin die änderung gemacht hat"*.
//
// Drei Festlegungen, die den Aufbau erklaeren:
//
//  1. JEDE Feldaenderung wird erfasst, nicht eine Auswahl "wichtiger"
//     Felder. Eine solche Auswahl muesste man heute raten; stellt sich in
//     zwei Jahren heraus, dass ein Feld doch wichtig war, ist sein Verlauf
//     unwiederbringlich weg. Alles zu erfassen ist ausserdem WENIGER Code:
//     keine Liste zu pflegen, keine Ausnahme zu vergessen.
//
//  2. BEI VERTRAULICHEN FELDERN OHNE WERTE. Bei AHV-Nummer, Zemis-Nummer,
//     Bewilligungen, Register-, Herkunfts- und Familienangaben steht nur,
//     DASS geaendert wurde -- nicht womit. Sonst laege die AHV-Nummer ein
//     zweites Mal in der Datenbank, und das Logbuch braeuchte denselben
//     Schutz und dieselben Loeschfristen wie die Akte selbst.
//     Welche Felder das sind, entscheidet ma_vertrauliche_felder() in
//     mitarbeiter.php -- dieselbe Liste wie beim Ausliefern der Daten, nicht
//     eine zweite danebengelegte.
//
//  3. DER NAME DES AKTEURS WIRD MITGESCHRIEBEN, nicht nur seine ID. Wird ein
//     Konto spaeter geloescht oder umbenannt, steht im Logbuch sonst eine
//     Nummer ohne Bedeutung -- und ein Verlauf, den niemand mehr lesen kann,
//     ist kein Verlauf. Die ID bleibt zusaetzlich stehen, fuer den Fall,
//     dass zwei Personen denselben Namen tragen.
//
// Die Tabelle ist allgemein gebaut (Bereich + Objekt-ID), angeschlossen aber
// nur an die Personalakte. Kunden oder Objekte spaeter mitzuschreiben ist
// damit ein Einzeiler -- ohne dass heute etwas protokolliert wird, das
// niemand bestellt hat.
declare(strict_types=1);

// 'fahrzeug' seit ENT-330: genau der Fall, fuer den die Tabelle allgemein
// gebaut wurde (siehe letzter Absatz oben). Der Projektinhaber: *"Wichtig ist
// beim Erfassen und Erstellen des Dienstfahrzeugs und beim Eintragen der
// Kilometerstand, dass dies mit einem Logeintrag registriert wird."* Am
// Kilometerstand haengt spaeter die Kontrolle gefahrener Strecken -- eine
// Zahl, die sich spurlos aendern laesst, traegt keine Kontrolle.
const LOGBUCH_BEREICHE = ['mitarbeiter', 'fahrzeug'];

function logbuch_tabelle_da(PDO $pdo): bool
{
    return hat_tabelle($pdo, 'aenderungslog');
}

// Ein einzelner Eintrag. Schreibt NIE einen Fehler nach aussen: Ein
// misslungener Protokolleintrag darf das Speichern der Personalakte nicht
// verhindern -- sonst waere das Logbuch eine neue Ausfallquelle fuer die
// taegliche Arbeit. Er darf aber auch nicht still verschwinden, darum der
// Rueckgabewert.
function logbuch_schreiben(PDO $pdo, array $akteur, string $bereich, int $objektId,
                           string $feld, ?string $alt, ?string $neu,
                           bool $ohneWerte = false): bool
{
    if (!in_array($bereich, LOGBUCH_BEREICHE, true)) { return false; }
    if (!logbuch_tabelle_da($pdo)) { return false; }
    try {
        $s = $pdo->prepare(
            'INSERT INTO aenderungslog
               (akteur_id, akteur_name, bereich, objekt_id, feld, wert_alt, wert_neu, werte_verborgen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $s->execute([
            (int)($akteur['id'] ?? 0),
            (string)($akteur['name'] ?? '?'),
            $bereich,
            $objektId,
            $feld,
            $ohneWerte ? null : logbuch_kuerzen($alt),
            $ohneWerte ? null : logbuch_kuerzen($neu),
            $ohneWerte ? 1 : 0,
        ]);
        return true;
    } catch (Throwable $e) {
        return false;
    }
}

// Lange Freitexte (Bemerkungen) wuerden das Logbuch sonst sprengen. 500
// Zeichen reichen, um zu erkennen, was sich geaendert hat.
function logbuch_kuerzen(?string $wert): ?string
{
    if ($wert === null) { return null; }
    $wert = trim($wert);
    if ($wert === '') { return ''; }
    return mb_strlen($wert) > 500 ? mb_substr($wert, 0, 497) . '...' : $wert;
}

// Vergleicht zwei Datensaetze und schreibt je Unterschied eine Zeile.
// Gibt die Zahl der geschriebenen Zeilen zurueck.
//
// Wichtig: Es wird als Text verglichen, nachdem beide Seiten vereinheitlicht
// wurden. Ohne das erzeugt jedes Speichern Eintraege, weil die Datenbank
// eine Zahl als "5" und das Formular sie als "5.0" liefert -- ein Logbuch
// voller Scheinaenderungen ist so unbrauchbar wie gar keines.
function logbuch_vergleichen(PDO $pdo, array $akteur, string $bereich, int $objektId,
                             array $vorher, array $nachher, array $ohneWerte = []): int
{
    $anzahl = 0;
    foreach ($nachher as $feld => $neu) {
        if (!array_key_exists($feld, $vorher)) { continue; }
        $a = logbuch_normal($vorher[$feld]);
        $b = logbuch_normal($neu);
        if ($a === $b) { continue; }
        if (logbuch_schreiben($pdo, $akteur, $bereich, $objektId, (string)$feld,
                              $a, $b, in_array($feld, $ohneWerte, true))) {
            $anzahl++;
        }
    }
    return $anzahl;
}

// Beide Seiten auf denselben Nenner bringen, bevor verglichen wird.
function logbuch_normal($wert): string
{
    if ($wert === null) { return ''; }
    if (is_bool($wert)) { return $wert ? '1' : '0'; }
    $t = trim((string)$wert);
    // Ein leeres Datum steht je nach Weg als '', '0000-00-00' oder mit
    // angehaengter Uhrzeit da -- alles dasselbe: nichts eingetragen.
    if ($t === '0000-00-00' || $t === '0000-00-00 00:00:00') { return ''; }
    if (preg_match('/^(\d{4}-\d{2}-\d{2}) 00:00:00$/', $t, $m)) { return $m[1]; }
    // Zahlen mit und ohne Nachkommastellen sind derselbe Wert.
    if (is_numeric($t)) {
        $z = (float)$t;
        return (string)(floor($z) === $z && abs($z) < 1e15 ? (int)$z : $z);
    }
    return $t;
}

// Liest den Verlauf. Ohne Objekt-ID der ganze Bereich (fuer eine spaetere
// Gesamtsicht), mit Objekt-ID die Akte einer Person.
function logbuch_lesen(PDO $pdo, string $bereich, int $objektId = 0, int $grenze = 200): array
{
    if (!logbuch_tabelle_da($pdo)) { return []; }
    if (!in_array($bereich, LOGBUCH_BEREICHE, true)) { return []; }
    $grenze = max(1, min(1000, $grenze));
    $sql = 'SELECT id, zeitpunkt, akteur_id, akteur_name, bereich, objekt_id,
                   feld, wert_alt, wert_neu, werte_verborgen
              FROM aenderungslog
             WHERE bereich = ?';
    $werte = [$bereich];
    if ($objektId > 0) { $sql .= ' AND objekt_id = ?'; $werte[] = $objektId; }
    $sql .= ' ORDER BY zeitpunkt DESC, id DESC LIMIT ' . $grenze;
    $s = $pdo->prepare($sql);
    $s->execute($werte);
    $rows = $s->fetchAll();
    foreach ($rows as &$r) {
        $r['werte_verborgen'] = (bool)$r['werte_verborgen'];
        $r['objekt_id']       = (int)$r['objekt_id'];
        $r['akteur_id']       = (int)$r['akteur_id'];
    }
    return $rows;
}
