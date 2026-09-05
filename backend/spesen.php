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
