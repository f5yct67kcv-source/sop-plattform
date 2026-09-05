<?php
declare(strict_types=1);
// Der Kern der Spesen-Belegannahme wird AUSGEFUEHRT, nicht im Quelltext
// gelesen (ENT-413). Zwei Regeln stehen hier auf dem Spiel, und beide sind
// sicherheitsrelevant:
//
// 1. Der Mimetyp entsteht aus den ERSTEN BYTES, nie aus der Angabe des
//    Absenders. Wer eine HTML-Datei als "image/png" schickt, darf sie nicht
//    gespeichert bekommen -- sonst laege im Belegarchiv ausfuehrbarer
//    Inhalt, den ein spaeterer Abruf im Ursprung dieser Anwendung oeffnet.
//
// 2. Ein PDF geht ausschliesslich als Download hinaus. Ein PDF kann
//    Skripte tragen; im Dokument eingebettet liefen sie im Ursprung dieser
//    Anwendung.
require_once __DIR__ . '/../backend/spesen.php';

$ok = 0; $bad = [];
function check(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

// ── Mimetyp aus den ersten Bytes ──────────────────────────────────────
// Echte Dateikoepfe, keine erfundenen: JPEG beginnt mit FF D8 FF, PNG mit
// der achtstelligen Signatur, PDF mit "%PDF-".
$jpeg = "\xFF\xD8\xFF\xE0" . str_repeat("\x00", 32);
$png  = "\x89PNG\r\n\x1a\n" . str_repeat("\x00", 32);
$pdf  = "%PDF-1.7\n" . str_repeat("a", 32);

check('JPEG wird an seinen ersten Bytes erkannt', spesen_beleg_mime($jpeg) === 'image/jpeg');
check('PNG wird an seinen ersten Bytes erkannt', spesen_beleg_mime($png) === 'image/png');
check('PDF wird an seinen ersten Bytes erkannt', spesen_beleg_mime($pdf) === 'application/pdf');

// Das ist der Kern: Was nicht erkannt wird, wird NICHT angenommen. null
// heisst "abgewiesen", nicht "unbekannt, nehmen wir mal".
check('KRITISCH: HTML wird abgewiesen, auch wenn es sich als Bild ausgibt',
    spesen_beleg_mime('<!DOCTYPE html><script>alert(1)</script>') === null);
check('KRITISCH: ein PHP-Schnipsel wird abgewiesen',
    spesen_beleg_mime("<?php system(\$_GET['c']); ?>") === null);
check('KRITISCH: SVG wird abgewiesen -- es kann Skripte tragen',
    spesen_beleg_mime('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') === null);
check('Reiner Text wird abgewiesen', spesen_beleg_mime('einfach nur Text') === null);
check('Eine leere Datei wird abgewiesen', spesen_beleg_mime('') === null);
// Der Kopf muss am ANFANG stehen. Eine Datei, die die PDF-Kennung erst
// spaeter enthaelt, ist kein PDF -- sonst genuegte es, "%PDF-" irgendwo in
// eine HTML-Datei zu schreiben.
check('KRITISCH: eine Kennung mitten in der Datei zaehlt nicht',
    spesen_beleg_mime('<html>%PDF-1.4</html>') === null);

// ── Auslieferung ──────────────────────────────────────────────────────
$kopfPdf = spesen_beleg_kopfzeilen_liste('application/pdf', 1234, 'Beleg-7');
$kopfBild = spesen_beleg_kopfzeilen_liste('image/jpeg', 1234, 'Beleg-7');

check('KRITISCH: ein PDF geht als Download hinaus, nicht zur Anzeige',
    isset($kopfPdf['Content-Disposition'])
    && str_starts_with($kopfPdf['Content-Disposition'], 'attachment'));
check('Ein Bild darf angezeigt werden (kein erzwungener Download)',
    !isset($kopfBild['Content-Disposition']));
check('KRITISCH: Belege werden nicht zwischengespeichert',
    ($kopfPdf['Cache-Control'] ?? '') === 'private, no-store'
    && ($kopfBild['Cache-Control'] ?? '') === 'private, no-store');
check('Der Mimetyp wird nicht vom Browser erraten (nosniff)',
    ($kopfBild['X-Content-Type-Options'] ?? '') === 'nosniff');
check('Die Laenge wird mitgegeben', ($kopfBild['Content-Length'] ?? '') === '1234');

// Ein Dateiname mit Anfuehrungszeichen oder Zeilenumbruch waere eine
// Kopfzeilen-Einschleusung. Er kommt zwar heute nur aus einer eigenen id,
// aber die Funktion darf das nicht voraussetzen.
$boes = spesen_beleg_kopfzeilen_liste('application/pdf', 1, "x\"\r\nSet-Cookie: a=b");
check('KRITISCH: der Dateiname kann keine zweite Kopfzeile einschleusen',
    !str_contains($boes['Content-Disposition'], "\n")
    && !str_contains($boes['Content-Disposition'], "\r")
    && substr_count($boes['Content-Disposition'], '"') === 2);

// ── Kategorien und Grenzen ────────────────────────────────────────────
check('Die Kategorien sind eine feste Liste, kein Freitext',
    spesen_kategorie_gueltig('tanken') && spesen_kategorie_gueltig('sonstiges'));
check('KRITISCH: eine erfundene Kategorie wird abgewiesen',
    !spesen_kategorie_gueltig('phantasie') && !spesen_kategorie_gueltig(''));
// Die Abgrenzung aus OP-392 als Pruefung: Der Auslagenersatz nach Art. 18
// GAV ist KEINE Spesenkategorie. Taucht hier je eine auf, die danach
// klingt, ist die Grenze zwischen Quittungsablage und GAV-Abrechnung
// verwischt -- genau der Fehler, den OP-392 benennt.
$verboten = ['fahrzeit', 'fahrkosten', 'auslagen', 'auslagenersatz', 'wegzeit', 'zone'];
$treffer = array_filter(array_keys(SPESEN_KATEGORIEN),
    static fn($k) => in_array($k, $verboten, true));
check('KRITISCH: keine Kategorie vermengt Quittungsbelege mit dem Auslagenersatz (OP-392)',
    $treffer === []);

check('Die vier Zustaende sind vollstaendig und in der Reihenfolge des Ablaufs',
    SPESEN_STATUS === ['erfasst', 'eingereicht', 'freigegeben', 'abgelehnt']);
check('Die Beleggrenze ist gesetzt und nicht unbegrenzt',
    SPESEN_BELEG_MAX > 0 && SPESEN_BELEG_MAX <= 8 * 1024 * 1024);

echo ($ok + count($bad)) . " Pruefungen ausgefuehrt, $ok bestanden\n";
foreach ($bad as $b) { echo "X $b\n"; }
exit(count($bad) ? 1 : 0);
