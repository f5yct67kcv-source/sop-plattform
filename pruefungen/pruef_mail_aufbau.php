<?php
declare(strict_types=1);
// Der MIME-Aufbau der Mails, wirklich ausgefuehrt (ENT-651).
//
// WARUM ECHT UND NICHT ALS TEXTVERGLEICH: Der Zusammenbau einer Nachricht
// aus Klartext, HTML, eingebettetem Bild und Anhang ist die
// fehleranfaelligste Stelle des Mailers -- eine falsch verschachtelte
// Grenze macht aus dem Logo einen Anhang, aus dem Anhang eine dritte
// Textvariante oder aus der ganzen Nachricht eine unlesbare Wand. Im
// Postfach des Empfaengers faellt so etwas auf, in einer Pruefung, die nur
// nachsieht ob ein Wort im Quelltext steht, nicht.
//
// Darum ist smtp_nachricht_bauen() eine reine Funktion: Sie laesst sich
// hier mit festen Werten ausfuehren und die erzeugte Nachricht laesst sich
// Stueck fuer Stueck nachmessen, ohne Mailserver.

require_once __DIR__ . '/../backend/mailer.php';

$ok = 0;
$fehler = [];
$pruef = function (string $was, bool $bedingung) use (&$ok, &$fehler): void {
    if ($bedingung) { $ok++; } else { $fehler[] = $was; }
};

$html = '<p>Guten Tag</p><img src="cid:guardops-logo">';
$bild = ['cid' => 'guardops-logo', 'mime' => 'image/png', 'inhalt' => "\x89PNG-Rohbytes"];
$anhang = ['name' => 'rapport.pdf', 'mime' => 'application/pdf', 'inhalt' => '%PDF-Rohbytes'];

// ── 1. Ohne Bild und ohne Anhang: unveraendert wie vor ENT-651 ───────
// Der Offert-Versand (ENT-192) laeuft produktiv und darf von der
// Erweiterung nichts merken.
$schlicht = smtp_nachricht_bauen('a@bsp.ch', 'b@bsp.ch', 'Betreff', $html, 'Klartext');
$pruef('KRITISCH: ohne Bild bleibt die Nachricht eine blosse Alternative aus Text und HTML',
    str_contains($schlicht, 'Content-Type: multipart/alternative')
    && !str_contains($schlicht, 'multipart/related')
    && !str_contains($schlicht, 'multipart/mixed'));
$pruef('beide Darstellungen sind da',
    str_contains($schlicht, 'Content-Type: text/plain; charset=UTF-8')
    && str_contains($schlicht, 'Content-Type: text/html; charset=UTF-8'));

// ── 2. Mit eingebettetem Bild ────────────────────────────────────────
$mitBild = smtp_nachricht_bauen('a@bsp.ch', 'b@bsp.ch', 'Betreff', $html, 'Klartext', [], [$bild]);
$pruef('KRITISCH: ein eingebettetes Bild macht die Nachricht zu multipart/related',
    str_contains($mitBild, 'Content-Type: multipart/related'));
// Das ist der Kern: Das Bild gehoert ZUM HTML, nicht daneben. Steht die
// Alternative nicht INNERHALB des related-Teils, findet das Mailprogramm
// den cid-Verweis nicht und zeigt ein zerbrochenes Bild.
$pruef('KRITISCH: die Alternative steht innerhalb des related-Teils, nicht daneben',
    strpos($mitBild, 'multipart/related') < strpos($mitBild, 'multipart/alternative'));
$pruef('KRITISCH: das Bild traegt genau die Kennung, die das HTML anspricht',
    str_contains($mitBild, 'Content-ID: <guardops-logo>')
    && str_contains($html, 'cid:guardops-logo'));
// "inline" statt "attachment": Sonst zeigen Mailprogramme das Logo als
// Dokument zum Herunterladen statt es im Text darzustellen.
$pruef('KRITISCH: das Bild ist inline, kein Anhang',
    str_contains($mitBild, 'Content-Disposition: inline')
    && !str_contains($mitBild, 'Content-Disposition: attachment'));
$pruef('das Bild geht base64-kodiert mit',
    str_contains($mitBild, base64_encode((string)$bild['inhalt'])));

// Eine Kennung mit Zeilenumbruch oder spitzer Klammer waere dieselbe
// Einschleusung, gegen die ENT-501 Adressen und Betreff absichert.
$boes = smtp_nachricht_bauen('a@bsp.ch', 'b@bsp.ch', 'Betreff', $html, 'Klartext', [],
    [['cid' => "logo>\r\nX-Eingeschleust: ja", 'mime' => 'image/png', 'inhalt' => 'x']]);
// Geprueft wird, dass keine eigene KOPFZEILE entsteht -- nicht, dass der
// Text verschwindet: Die Sonderzeichen fallen weg, die harmlosen Buchstaben
// bleiben als Teil der Kennung stehen, und das ist richtig so.
$pruef('KRITISCH: eine Kennung kann keine zusaetzliche Kopfzeile einschleusen',
    !preg_match('/^X-Eingeschleust:/m', $boes) && !str_contains($boes, "\r\nX-Eingeschleust"));

// ── 3. Mit Anhang ────────────────────────────────────────────────────
$mitAnhang = smtp_nachricht_bauen('a@bsp.ch', 'b@bsp.ch', 'Betreff', $html, 'Klartext', [$anhang]);
$pruef('KRITISCH: ein Anhang steht neben der Nachricht (mixed), nicht als dritte Textvariante',
    str_contains($mitAnhang, 'Content-Type: multipart/mixed')
    && str_contains($mitAnhang, 'Content-Disposition: attachment; filename="rapport.pdf"'));

// ── 4. Bild UND Anhang gleichzeitig ──────────────────────────────────
// Der Fall, den es heute noch nicht gibt, aber geben wird, sobald eine
// Rechnung mit PDF unter derselben Signatur hinausgeht.
$beides = smtp_nachricht_bauen('a@bsp.ch', 'b@bsp.ch', 'Betreff', $html, 'Klartext',
    [$anhang], [$bild]);
$pruef('KRITISCH: Bild und Anhang zusammen -- aussen mixed, darin related, darin die Alternative',
    strpos($beides, 'multipart/mixed') < strpos($beides, 'multipart/related')
    && strpos($beides, 'multipart/related') < strpos($beides, 'multipart/alternative'));
$pruef('das Logo bleibt inline, der Anhang bleibt Anhang',
    str_contains($beides, 'Content-Disposition: inline')
    && str_contains($beides, 'Content-Disposition: attachment'));

// ── 5. Jede Grenze wird auch geschlossen ─────────────────────────────
// Eine nicht geschlossene Grenze laesst das Mailprogramm den Rest der
// Nachricht verschlucken -- sichtbar wird das erst beim Empfaenger.
foreach (['schlicht' => $schlicht, 'mit Bild' => $mitBild,
          'mit Anhang' => $mitAnhang, 'beides' => $beides] as $name => $n) {
    preg_match_all('/boundary="([^"]+)"/', $n, $t);
    $offen = [];
    foreach (array_unique($t[1]) as $g) {
        if (!str_contains($n, '--' . $g . "--\r\n")) { $offen[] = $g; }
    }
    $pruef("KRITISCH: in der Nachricht ($name) wird jede Grenze wieder geschlossen", $offen === []);
}

echo $ok . " bestanden, " . count($fehler) . " nicht bestanden\n";
foreach ($fehler as $f) { echo "x $f\n"; }
exit($fehler ? 1 : 0);
