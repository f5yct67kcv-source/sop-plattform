<?php
declare(strict_types=1);
// Spesen = Quittungsbelege der Mitarbeitenden (ENT-413).
//
// ABGRENZUNG, DIE NICHT VERLORENGEHEN DARF (OP-392): "Spesen" heisst hier
// ausschliesslich der QUITTUNGSBELEG -- Tanken, geschaeftlicher Einkauf,
// Parkgebuehr. Ausdruecklich NICHT der Auslagenersatz nach Art. 18 GAV
// (Fahrzeit-/Fahrkostenersatz); der wird in auslagen.php aus Zone und
// Wegstrecke berechnet, entsteht beim Abgleich und ist aus eigenen Gruenden
// zurueckgestellt (ENT-123, GAV-AUS-010). Wer beides vermengt, baut eine
// GAV-Abrechnung, wo eine Quittungsablage gemeint war.
//
// Daraus folgt fuer diese Datei: Hier wird NICHTS berechnet und nichts
// ausgelegt. Der Betrag steht auf der Quittung, die Person tippt ihn ab,
// die Verwaltung entscheidet. Es gibt keine Regel, die aus einem Beleg
// einen Anspruch macht -- das waere GAV-Auslegung und gehoert nicht hierher.

// Die Kategorien. Als feste Liste und nicht als Freitext: derselbe Beleg
// hiesse sonst bei drei Personen "Tanken", "tanken" und "Benzin", und eine
// Auswertung nach Art waere danach nur noch Textvergleich. Kommt eine
// Kategorie dazu, wird sie hier ANGEHAENGT -- bestehende Belege tragen
// ihren Schluessel weiter.
const SPESEN_KATEGORIEN = [
    'tanken'      => 'Tanken',
    'einkauf'     => 'Geschäftlicher Einkauf',
    'parkgebuehr' => 'Parkgebühr',
    'sonstiges'   => 'Sonstiges',
];

// Die vier Zustaende eines Belegs. "erfasst" ist die Mappe der Person, erst
// "eingereicht" macht ihn fuer die Verwaltung sichtbar -- dieselbe Trennung
// wie beim Abwesenheitsantrag (ENT-255).
const SPESEN_STATUS = ['erfasst', 'eingereicht', 'freigegeben', 'abgelehnt'];

// 4 MB statt der 2 MB von ERSATZSCAN_FOTO_MAX: Ein Kamerafoto wird im
// Browser auf 1280 px heruntergerechnet (rdEsKomprimieren) und liegt danach
// bei 100-400 KB. Ein PDF laesst sich so nicht verkleinern -- eine
// gescannte, mehrseitige Rechnung kommt an, wie sie ist. Base64 blaeht die
// Uebertragung um rund ein Drittel auf; 4 MB Nutzlast sind damit gut 5,3 MB
// Rumpf und bleiben unter dem ueblichen post_max_size von 8 MB.
const SPESEN_BELEG_MAX = 4 * 1024 * 1024;

// Ein Betrag, der ueber dieser Grenze liegt, ist mit hoher Wahrscheinlichkeit
// ein Zahlendreher (CHF 5'000.- als Tankquittung). Abgewiesen wird er
// trotzdem nicht wortlos, sondern mit einer Meldung, die die Grenze nennt --
// eine stillschweigend gekappte Zahl waere schlimmer als eine falsche.
const SPESEN_BETRAG_MAX_RAPPEN = 500000;   // CHF 5'000.00

/**
 * Der Mimetyp eines Belegs aus den ERSTEN BYTES -- nie aus der Angabe des
 * Absenders. Gleiche Regel wie bei ersatzscan_foto_mime() in rundgang.php;
 * neu ist allein PDF.
 *
 * null heisst "nicht angenommen", nicht "unbekannt": Was hier nicht
 * erkannt wird, wird nicht gespeichert.
 */
function spesen_beleg_mime(string $roh): ?string
{
    if (str_starts_with($roh, "\xFF\xD8\xFF"))        { return 'image/jpeg'; }
    if (str_starts_with($roh, "\x89PNG\r\n\x1a\n"))   { return 'image/png'; }
    // %PDF- ist die Kennung nach ISO 32000; die Versionsziffer dahinter
    // (%PDF-1.4, %PDF-2.0) wird bewusst nicht geprueft.
    if (str_starts_with($roh, '%PDF-'))               { return 'application/pdf'; }
    return null;
}

function spesen_kategorie_gueltig(string $kategorie): bool
{
    return array_key_exists($kategorie, SPESEN_KATEGORIEN);
}

/**
 * Die Kopfzeilen fuer die Auslieferung eines Belegs -- als LISTE, ohne sie
 * zu setzen.
 *
 * Eigene Funktion und nicht direkt header(): So laesst sich die Regel
 * darunter wirklich AUSFUEHREN und pruefen (pruef_spesen.php). Eine
 * Sicherheitsregel, die nur im Quelltext steht, ist eine Behauptung --
 * und header() ist in der Kommandozeile wirkungslos.
 *
 * Der Unterschied zwischen Bild und PDF ist kein Detail: Ein PDF kann
 * Skripte und eingebettete Verweise tragen. Im Browser geoeffnet liefe das
 * im Ursprung dieser Anwendung -- darum geht ein PDF ausschliesslich als
 * Download hinaus (Content-Disposition: attachment) und wird nie im
 * Dokument eingebettet. Bilder duerfen angezeigt werden.
 */
function spesen_beleg_kopfzeilen_liste(string $mime, int $laenge, string $dateiname): array
{
    $kopf = [
        'Content-Type' => $mime,
        'Content-Length' => (string)$laenge,
        // Nicht zwischenspeichern: Der Beleg haengt an einer Sitzung mit
        // Rechtepruefung; ein zwischengespeicherter Beleg waere nach einem
        // Rechteentzug weiterhin abrufbar (gleiche Begruendung wie in
        // ereignis_foto.php).
        'Cache-Control' => 'private, no-store',
        'X-Content-Type-Options' => 'nosniff',
    ];
    if ($mime === 'application/pdf') {
        // Der Dateiname wird auf Unbedenkliches beschnitten: Anfuehrungs-
        // zeichen oder Zeilenumbrueche darin waeren eine Kopfzeilen-
        // Einschleusung.
        $sauber = preg_replace('/[^A-Za-z0-9_-]/', '', $dateiname);
        $kopf['Content-Disposition'] = 'attachment; filename="' . $sauber . '.pdf"';
    }
    return $kopf;
}

function spesen_beleg_kopfzeilen(string $mime, int $laenge, string $dateiname): void
{
    foreach (spesen_beleg_kopfzeilen_liste($mime, $laenge, $dateiname) as $name => $wert) {
        header($name . ': ' . $wert);
    }
}

// ══════════════════════════════════════════════════════════════════════════
// DIE ZUSTANDSREGELN (ENT-413, herausgezogen nach der ersten Fassung)
// ══════════════════════════════════════════════════════════════════════════
//
// WARUM HIER UND NICHT IN DEN ENDPUNKTEN: In der ersten Fassung stand dieses
// SQL direkt in backend/api/meine_spesen.php und spesen_entscheiden.php. Die
// Regeln liessen sich damit nur PRUEFEN, INDEM MAN DEN QUELLTEXT LIEST -- und
// genau davor warnt CLAUDE.md: "Eine Pruefung, die nachsieht, ob ein Wort im
// Code steht, bleibt gruen, wenn die Formulierung sich aendert und die Sache
// verschwindet." Als Funktionen mit einem uebergebenen PDO laufen sie in
// pruef_spesen.php gegen eine echte Datenbank (SQLite im Arbeitsspeicher),
// gleiches Muster wie pruef_dienstfahrzeug.php und pruef_rechte.php.
//
// Deshalb auch KEIN require von db.php in dieser Datei: Wer $pdo mitgibt,
// kann sie ohne Serverumgebung ausfuehren.
//
// CURRENT_TIMESTAMP statt NOW(): NOW() gibt es in SQLite nicht, und eine
// Regel, die sich nur auf dem Produktionsserver ausfuehren laesst, ist wieder
// eine Behauptung. Beide Datenbanken kennen CURRENT_TIMESTAMP.
//
// Rueckgabe ist ein SCHLUESSEL, keine fertige Meldung: Der Endpunkt entscheidet
// ueber HTTP-Status und Wortlaut, die Regel entscheidet ueber das Duerfen.
// Die Schluessel sind bewusst sprechend -- 'nicht_mehr_erfasst' sagt etwas
// anderes als 'nicht_gefunden', und die Oberflaeche soll das unterscheiden
// koennen ("unbekannt" darf nie wie "keine" aussehen).

// Die Felder, die eine Liste braucht. Der Beleg selbst ist NICHT dabei --
// eine Liste mit eingebetteten Belegen waere bei zwoelf Monaten Historie ein
// Vielfaches an Uebertragung fuer etwas, das man einzeln ansieht.
const SPESEN_LISTENFELDER = 'id, datum, kategorie, betrag_rappen, notiz, status,
     erfasst_am, eingereicht_am, ablehnung_grund, entschieden_am, beleg_mime';

/** Die eigenen Belege, neueste zuerst. */
function spesen_eigene(PDO $pdo, int $ich): array
{
    $s = $pdo->prepare('SELECT ' . SPESEN_LISTENFELDER . '
         FROM spesen WHERE mitarbeiter_id = ? ORDER BY datum DESC, id DESC');
    $s->execute([$ich]);
    return array_map('spesen_zeile_ausgeben', $s->fetchAll(PDO::FETCH_ASSOC));
}

/**
 * Der Datensatz, wie ihn die Oberflaeche braucht: hat_beleg statt des Belegs
 * selbst, und die Art dazu -- ein PDF laesst sich nicht als Vorschaubild
 * zeigen, die Oberflaeche muss das vorher wissen.
 */
function spesen_zeile_ausgeben(array $r): array
{
    $r['betrag_rappen'] = (int)$r['betrag_rappen'];
    $r['hat_beleg'] = $r['beleg_mime'] !== null;
    $r['beleg_ist_pdf'] = $r['beleg_mime'] === 'application/pdf';
    unset($r['beleg_mime']);
    return $r;
}

/** Legt einen Beleg an. Er beginnt IMMER im Zustand 'erfasst'. */
function spesen_anlegen(PDO $pdo, int $ich, array $f): int
{
    $pdo->prepare(
        "INSERT INTO spesen (mitarbeiter_id, datum, kategorie, betrag_rappen, notiz,
             beleg, beleg_mime, status, erfasst_am)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'erfasst', CURRENT_TIMESTAMP)"
    )->execute([$ich, $f['datum'], $f['kategorie'], $f['betrag_rappen'],
                $f['notiz'] !== '' ? $f['notiz'] : null, $f['beleg'] ?? null, $f['beleg_mime'] ?? null]);
    return (int)$pdo->lastInsertId();
}

/**
 * Aendert einen eigenen Beleg -- nur solange er in der eigenen Mappe liegt.
 *
 * Ein eingereichter oder entschiedener Beleg ist fuer die Verwaltung eine
 * feste Groesse: Liesse er sich nachtraeglich umschreiben, waere die Freigabe
 * auf einen anderen Betrag erteilt worden als den, der danach dasteht.
 *
 * $belegAendern trennt "Beleg unangetastet lassen" von "Beleg entfernen" --
 * beim Aendern von Betrag oder Notiz soll das Bild nicht wegfallen.
 */
function spesen_aendern(PDO $pdo, int $ich, int $id, array $f,
                        bool $belegAendern, ?string $beleg, ?string $mime): string
{
    $status = spesen_status_von($pdo, $id, $ich);
    if ($status === null) { return 'nicht_gefunden'; }
    if ($status !== 'erfasst') { return 'nicht_mehr_erfasst'; }

    $sql = 'UPDATE spesen SET datum = ?, kategorie = ?, betrag_rappen = ?, notiz = ?'
        . ($belegAendern ? ', beleg = ?, beleg_mime = ?' : '')
        . " WHERE id = ? AND mitarbeiter_id = ? AND status = 'erfasst'";
    $werte = [$f['datum'], $f['kategorie'], $f['betrag_rappen'], $f['notiz'] !== '' ? $f['notiz'] : null];
    if ($belegAendern) { $werte[] = $beleg; $werte[] = $mime; }
    $werte[] = $id; $werte[] = $ich;
    $pdo->prepare($sql)->execute($werte);
    return 'ok';
}

/**
 * Einreichen: erst hier wird der Beleg fuer die Verwaltung sichtbar.
 *
 * Ein Beleg OHNE Bild darf eingereicht werden -- die Quittung kann
 * nachgereicht sein, und eine Sperre dagegen haette nur bedeutet, dass
 * jemand ein leeres Blatt fotografiert.
 */
function spesen_einreichen(PDO $pdo, int $ich, int $id): string
{
    $status = spesen_status_von($pdo, $id, $ich);
    if ($status === null) { return 'nicht_gefunden'; }
    if ($status !== 'erfasst') { return 'nicht_mehr_erfasst'; }
    $pdo->prepare("UPDATE spesen SET status = 'eingereicht', eingereicht_am = CURRENT_TIMESTAMP
         WHERE id = ? AND mitarbeiter_id = ?")->execute([$id, $ich]);
    return 'ok';
}

/**
 * Zurueckziehen, solange die Verwaltung nicht entschieden hat -- etwa, weil
 * der Betrag falsch abgetippt war. Nach einem Entscheid nicht mehr: Der
 * Entscheid ist ein Beleg, keine Notiz, die man verschwinden laesst.
 */
function spesen_zurueckziehen(PDO $pdo, int $ich, int $id): string
{
    $status = spesen_status_von($pdo, $id, $ich);
    if ($status === null) { return 'nicht_gefunden'; }
    if ($status !== 'eingereicht') { return 'nicht_eingereicht'; }
    $pdo->prepare("UPDATE spesen SET status = 'erfasst', eingereicht_am = NULL
         WHERE id = ? AND mitarbeiter_id = ?")->execute([$id, $ich]);
    return 'ok';
}

/**
 * Loeschen -- nur, solange der Beleg noch in der eigenen Mappe liegt. Ein
 * eingereichter Beleg ist bei der Verwaltung angekommen; ihn dort
 * verschwinden zu lassen, waere dieselbe Luecke wie ein nachtraeglich
 * geloeschter Entscheid. Zurueckziehen geht, loeschen nicht.
 */
function spesen_loeschen(PDO $pdo, int $ich, int $id): string
{
    $status = spesen_status_von($pdo, $id, $ich);
    if ($status === null) { return 'nicht_gefunden'; }
    if ($status !== 'erfasst') { return 'nicht_mehr_erfasst'; }
    $pdo->prepare('DELETE FROM spesen WHERE id = ? AND mitarbeiter_id = ?')->execute([$id, $ich]);
    return 'ok';
}

/**
 * Freigeben oder ablehnen.
 *
 * Ein Beleg im Zustand 'erfasst' liegt noch in der Mappe der Person und ist
 * kein Antrag -- er laesst sich darum auch mit Recht nicht entscheiden. Ein
 * bereits entschiedener dagegen schon: Erneutes Entscheiden ueberschreibt
 * bewusst, statt eine eigene Korrektur-Historie zu verlangen (gleiche
 * Handhabung wie abwesenheit_entscheiden.php, keine neue Ausnahme).
 *
 * Der Ablehnungsgrund wird bei einer Freigabe ausdruecklich GELEERT: Bliebe
 * die Begruendung einer frueheren Ablehnung stehen, staende bei einem
 * freigegebenen Beleg ein Text, der ihn ablehnt.
 */
function spesen_entscheiden(PDO $pdo, int $wer, int $id, string $status, ?string $grund): string
{
    if (!in_array($status, ['freigegeben', 'abgelehnt'], true)) { return 'status_unbekannt'; }
    if ($status === 'abgelehnt' && trim((string)$grund) === '') { return 'grund_fehlt'; }

    $s = $pdo->prepare('SELECT status FROM spesen WHERE id = ?');
    $s->execute([$id]);
    $vorher = $s->fetchColumn();
    if ($vorher === false) { return 'nicht_gefunden'; }
    if ($vorher === 'erfasst') { return 'nicht_eingereicht'; }

    $pdo->prepare('UPDATE spesen SET status = ?, ablehnung_grund = ?,
         entschieden_von = ?, entschieden_am = CURRENT_TIMESTAMP WHERE id = ?')
        ->execute([$status, $status === 'abgelehnt' ? $grund : null, $wer, $id]);
    return 'ok';
}

/** Der Status EINES EIGENEN Belegs, oder null. Die mitarbeiter_id steht in
 *  der WHERE-Bedingung, nicht erst im Vergleich danach -- ein fremder Beleg
 *  wird gar nicht erst gelesen. */
function spesen_status_von(PDO $pdo, int $id, int $ich): ?string
{
    $s = $pdo->prepare('SELECT status FROM spesen WHERE id = ? AND mitarbeiter_id = ?');
    $s->execute([$id, $ich]);
    $wert = $s->fetchColumn();
    return $wert === false ? null : (string)$wert;
}

/**
 * Die Liste fuer die Verwaltung. Belege im Zustand 'erfasst' erscheinen NIE
 * -- sie liegen noch in der Mappe der Person. Das ist der ganze Zweck der
 * Trennung zwischen erfasst und eingereicht, und es gilt unabhaengig vom
 * Recht des Abfragenden.
 */
function spesen_liste_verwaltung(PDO $pdo, string $filter): array
{
    $wo = "WHERE s.status <> 'erfasst'";
    $werte = [];
    if ($filter !== 'alle') {
        if (!in_array($filter, ['eingereicht', 'freigegeben', 'abgelehnt'], true)) { return []; }
        $wo = 'WHERE s.status = ?';
        $werte[] = $filter;
    }
    // Der Name kommt aus dem Mitarbeiterstamm, nicht aus dem Beleg -- die
    // Liste zeigt damit den heutigen Namen. Vertrauliche Personalfelder
    // werden nicht angefasst: Fuer eine Spesenfreigabe braucht es den Namen.
    $s = $pdo->prepare(
        'SELECT s.id, s.mitarbeiter_id, s.datum, s.kategorie, s.betrag_rappen, s.notiz,
                s.status, s.erfasst_am, s.eingereicht_am, s.ablehnung_grund,
                s.entschieden_am, s.entschieden_von, s.beleg_mime,
                m.name, m.vorname, m.nachname
         FROM spesen s JOIN mitarbeiter m ON m.id = s.mitarbeiter_id
         ' . $wo . ' ORDER BY s.datum DESC, s.id DESC');
    $s->execute($werte);
    return array_map(static function (array $r): array {
        $r = spesen_zeile_ausgeben($r);
        // Ein fertiger Anzeigename statt dreier Felder: vorname/nachname sind
        // im Stamm optional (schema.sql), name ist es nicht -- die Ansicht
        // haette sonst dieselbe Rueckfallkette noch einmal zu bauen.
        $voll = trim(((string)$r['vorname']) . ' ' . ((string)$r['nachname']));
        $r['person'] = $voll !== '' ? $voll : (string)$r['name'];
        unset($r['vorname'], $r['nachname'], $r['name']);
        return $r;
    }, $s->fetchAll(PDO::FETCH_ASSOC));
}

/** Der eigene Beleg als Rohdaten, oder null. */
function spesen_beleg_eigen(PDO $pdo, int $ich, int $id): ?array
{
    $s = $pdo->prepare('SELECT beleg, beleg_mime FROM spesen WHERE id = ? AND mitarbeiter_id = ?');
    $s->execute([$id, $ich]);
    $r = $s->fetch(PDO::FETCH_ASSOC);
    if (!$r || $r['beleg'] === null || $r['beleg_mime'] === null) { return null; }
    return $r;
}

/** Derselbe Beleg fuer die Verwaltung -- aber nur, wenn er eingereicht ist. */
function spesen_beleg_verwaltung(PDO $pdo, int $id): ?array
{
    $s = $pdo->prepare("SELECT beleg, beleg_mime FROM spesen WHERE id = ? AND status <> 'erfasst'");
    $s->execute([$id]);
    $r = $s->fetch(PDO::FETCH_ASSOC);
    if (!$r || $r['beleg'] === null || $r['beleg_mime'] === null) { return null; }
    return $r;
}
