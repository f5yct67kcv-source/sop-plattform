<?php
// Die Versandmail eines Belegs (ENT-674) wirklich BAUEN -- nicht ihren
// Quelltext lesen.
//
// Warum diese Datei: Vier Aussagen der Mail sind Entscheidungen und keine
// Formulierungen. Eine Textsuche im Quelltext wuerde jede davon uebersehen,
// sobald sich die Schreibweise aendert und die Sache verschwindet:
//
//   1. SIE TRAEGT DIE GEMEINSAME GESTALTUNG. Nicht "irgendwo steht
//      mail_rahmen", sondern: Was herauskommt, ist ein vollstaendiges
//      Dokument mit Fuss, Signatur, eingebettetem Logo und den Regeln fuer
//      den Dunkelmodus. Genau das fehlte vor ENT-674.
//   2. KEIN BETRAG. Entscheid des Projektinhabers -- eine weitergeleitete
//      Mail soll keine Preise tragen. Geprueft wird an einem Beleg, der
//      eine Summe FUEHRT: Taucht sie in der Mail auf, ist die Pruefung rot.
//   3. EIN LEERES FELD WIRD WEGGELASSEN, nicht halb gezeigt. Weder eine
//      Anrede ohne Namen mit Leerzeichen dahinter noch eine Frist, die als
//      "01.01.1970" ankommt -- beides waere im Postfach nicht mehr zu
//      berichtigen.
//   4. DER LINK STEHT AUCH ALS TEXT. Die reine Textfassung hat nie einen
//      Knopf, und ein Mailprogramm, das Knoepfe verschluckt, liesse den
//      Empfaenger sonst ohne Weiterweg sitzen.
//
// Gegenproben stehen jeweils direkt bei der Pruefung.
declare(strict_types=1);

require_once __DIR__ . '/../backend/belege.php';

$ok = 0; $bad = [];
$pruef = function (string $name, bool $wahr) use (&$ok, &$bad) {
    if ($wahr) { $ok++; } else { $bad[] = $name; }
};

$LINK = 'https://betreiber.guardops.ch/api/betreiber_beleg_oeffentlich.php?token=' . str_repeat('a', 64);
$SIG  = ['Vorname Name', 'Geschäftsführer', '+41 00 000 00 00'];

// Ein Beleg, der eine Summe FUEHRT -- sonst koennte Punkt 2 nicht
// durchfallen und waere eine Behauptung.
$offerte = ['art' => 'offerte', 'nummer' => 'OF-0001', 'datum' => '2026-03-04',
            'gueltig_bis' => '2026-04-03',
            'total_rappen' => 123456, 'zwischensumme_rappen' => 114600,
            'summen' => ['total_rappen' => 123456]];

$m = beleg_mail($offerte, 'Musterfirma', $LINK, 'Muster Kontakt', $SIG);

// ── 1. Die gemeinsame Gestaltung ──────────────────────────────────────
//
// Am Ergebnis geprueft, nicht am Aufruf: Ein handgebautes <div> wie vor
// ENT-674 hat weder Dokumentkopf noch Fuss noch Logo.
$pruef('KRITISCH: die Mail ist ein vollstaendiges Dokument, kein <div>',
    str_starts_with($m['html'], '<!DOCTYPE html>'));
$pruef('KRITISCH: sie traegt den Fuss der Betreiberin',
    str_contains($m['html'], 'pzu consulting gmbh')
    && str_contains($m['html'], 'info@guardops.ch'));
$pruef('KRITISCH: das Logo haengt eingebettet daran, nicht an einer fremden Adresse',
    count($m['bilder']) >= 1
    && str_contains($m['html'], 'cid:' . MAIL_LOGO_KENNUNG)
    && !str_contains($m['html'], 'src="http'));
$pruef('KRITISCH: die Regeln fuer den Dunkelmodus kommen mit',
    str_contains($m['html'], 'prefers-color-scheme: dark'));
$pruef('KRITISCH: die persoenliche Signatur steht darunter',
    str_contains($m['html'], 'Mit freundlichen Grüssen')
    && str_contains($m['html'], 'Vorname Name')
    && str_contains($m['text'], 'Geschäftsführer'));

// ── 2. Kein Betrag ────────────────────────────────────────────────────
//
// Gegen mehrere Schreibweisen desselben Betrags geprueft, nicht nur gegen
// eine: 1234.56, 1'234.56, 1’234.56 und der rohe Rappenwert. Wer die Summe
// spaeter einbaut, wird eine davon treffen.
$betragFormen = ['1234.56', "1'234.56", '1’234.56', '123456', '1234,56'];
$gefunden = [];
foreach ($betragFormen as $f) {
    if (str_contains($m['html'], $f) || str_contains($m['text'], $f)) { $gefunden[] = $f; }
}
$pruef('KRITISCH: kein Betrag in der Mail (ENT-674) — gefunden: ' . implode(', ', $gefunden),
    $gefunden === []);
// GEGENPROBE zur Pruefung selbst: Die Suche muss den Betrag finden, wenn er
// da steht. Ohne diesen Schritt bliebe oben auch eine kaputte Suche gruen.
$pruef('GEGENPROBE — die Suche findet einen Betrag, wenn einer dasteht',
    str_contains('Total: 1234.56', $betragFormen[0]));

// ── 3. Leere Felder werden weggelassen ────────────────────────────────
$ohne = beleg_mail(['art' => 'offerte', 'nummer' => 'OF-0002', 'datum' => '2026-03-04',
                    'gueltig_bis' => null],
                   'Musterfirma', $LINK, '', $SIG);
// Die Anrede endet mit Komma, weil der Folgesatz sie fortsetzt ("wir haben
// für Sie ..."). Ohne Kontaktperson darf danach kein Leerzeichen und kein
// Rest stehen -- "Guten Tag ," waere die halbe Anrede aus einem leeren Feld.
$pruef('KRITISCH: ohne Kontaktperson gruesst die Mail ohne Namen',
    str_starts_with($ohne['text'], "Guten Tag,\n"));
$pruef('… und mit Kontaktperson steht sie da',
    str_contains($m['text'], 'Guten Tag Muster Kontakt'));
$pruef('KRITISCH: eine nicht gesetzte Frist wird weggelassen, nicht geraten',
    !str_contains($ohne['text'], 'Gültig bis')
    && !str_contains($ohne['text'], '1970') && !str_contains($ohne['text'], '-0001'));
$pruef('… und eine gesetzte steht mit ihrem eigenen Wort da',
    str_contains($m['text'], 'Gültig bis: 03.04.2026'));
// Das leere MySQL-Datum ist eine dritte Schreibweise desselben "nicht
// gesetzt" -- sie hat hier schon einmal als 30.11.-0001 ausgesehen.
// Nummer bewusst NICHT "RE-0001": Die Suche unten sucht nach "-0001" als
// Spur eines falsch gerechneten Datums (30.11.-0001), und die Belegnummer
// enthielte dieselbe Zeichenfolge -- die Pruefung waere dann immer rot,
// ohne dass etwas fehlt. Beim Schreiben genau so passiert.
$null = beleg_mail(['art' => 'rechnung', 'nummer' => 'RE-0815',
                    'datum' => '0000-00-00', 'faellig_bis' => '0000-00-00'],
                   'Musterfirma', $LINK, '', $SIG);
$pruef('KRITISCH: 0000-00-00 heisst "nicht gesetzt" und nicht "30.11.-0001"',
    !str_contains($null['text'], '-0001') && !str_contains($null['text'], '1970')
    && !str_contains($null['text'], 'Rechnungsdatum') && !str_contains($null['text'], 'Fällig bis'));
// GEGENPROBE: Die Rechnung fuehrt ihre Frist sehr wohl, wenn eine da ist --
// und unter IHREM Wort, nicht unter dem der Offerte.
$re = beleg_mail(['art' => 'rechnung', 'nummer' => 'RE-0002', 'datum' => '2026-03-04',
                  'faellig_bis' => '2026-04-03'], 'Musterfirma', $LINK, '', $SIG);
$pruef('GEGENPROBE — die Rechnung zeigt ihre Frist als "Fällig bis"',
    str_contains($re['text'], 'Fällig bis: 03.04.2026')
    && !str_contains($re['text'], 'Gültig bis'));
$pruef('… und ihre Beschriftungen heissen Rechnungsnummer und Rechnungsdatum',
    str_contains($re['text'], 'Rechnungsnummer: RE-0002')
    && str_contains($re['text'], 'Rechnungsdatum: 04.03.2026'));
// Der Vertrag fuehrt bewusst keine Frist -- auch dann nicht, wenn in der
// Zeile ein gueltig_bis steht.
$ve = beleg_mail(['art' => 'vertrag', 'nummer' => 'VE-0001', 'datum' => '2026-03-04',
                  'gueltig_bis' => '2026-04-03', 'faellig_bis' => '2026-04-03'],
                 'Musterfirma', $LINK, '', $SIG);
$pruef('KRITISCH: der Vertrag traegt keine Frist in der Mail (ENT-674)',
    !str_contains($ve['text'], 'Gültig bis') && !str_contains($ve['text'], 'Fällig bis'));
$pruef('… und nur die Offerte wird am Link beantwortet',
    str_contains($m['text'], 'beantworten')
    && !str_contains($re['text'], 'beantworten') && !str_contains($ve['text'], 'beantworten'));

// ── 4. Der Link steht auch als Text ───────────────────────────────────
$pruef('KRITISCH: die Textfassung traegt den Link',
    str_contains($m['text'], $LINK));
// Im HTML steht er GENAU EINMAL, im Knopf (2026-09-22). Die Adresse in
// Klarschrift darunter ist hier weggelassen -- ein Geschaeftsbrief zeigt
// seine URL nicht zweimal, und die Textfassung oben traegt sie ohnehin.
// Die Pruefung haelt beide Seiten fest: der Knopf verweist wirklich auf
// den Link, und darunter steht er nicht noch einmal.
$html = $m['html'];
$ziel = htmlspecialchars($LINK, ENT_QUOTES, 'UTF-8');
$pruef('KRITISCH: der Knopf verweist auf den Link',
    str_contains($html, 'href="' . $ziel . '"'));
$pruef('… und die Adresse steht im HTML nicht ein zweites Mal',
    substr_count($html, $ziel) === 1
    && !str_contains($html, 'Falls der Knopf nicht funktioniert'));

// ── 5. Betreff und Ueberschriften ─────────────────────────────────────
$pruef('der Betreff nennt Art, Nummer und Absender',
    $m['betreff'] === 'Neue Offerte OF-0001 von Musterfirma');
// Der Satz spricht in der ersten Person und nennt die Firma nicht noch
// einmal -- sie steht im Absender, im Betreff und in der Signatur. Eine
// "Musterfirma hat Ihnen ..."-Meldung waere der Rueckfall (2026-09-22).
$pruef('KRITISCH: der Satz spricht in der ersten Person',
    str_contains($m['text'], 'wir haben für Sie eine neue Offerte erstellt')
    && !str_contains($m['text'], 'Musterfirma hat Ihnen'));
$pruef('KRITISCH: das Substantiv ist gross geschrieben',
    str_contains($m['text'], 'eine neue Offerte erstellt')
    && !str_contains($m['text'], 'eine neue offerte'));

// ── 6. Ohne hinterlegte Signatur zeichnet die Firma ───────────────────
//
// Nie ein leerer Gruss und nie ein Platzhaltername -- dieselbe Zusage wie
// bei der Demo-Mail.
$leer = beleg_mail($offerte, 'Musterfirma', $LINK, '', []);
$pruef('KRITISCH: ohne hinterlegte Signatur zeichnet die Firma',
    str_contains($leer['text'], "Mit freundlichen Grüssen\nMusterfirma")
    && str_contains($leer['html'], 'Musterfirma'));
$pruef('… und nirgends steht ein Platzhalter',
    !str_contains($leer['html'], '__') && !str_contains($leer['text'], '__'));

// ── 7. Fremder Text wird entschaerft ──────────────────────────────────
//
// Firma und Kontaktperson kommen aus der Datenbank. Ein Winkel darin darf
// die Mail nicht zerlegen.
// Ohne hinterlegte Signatur zeichnet die Firma -- so steht ihr Name im
// HTML und laesst sich hier pruefen. Die Kontaktperson steht in der Anrede.
$boese = beleg_mail($offerte, 'Muster <b>& Co', $LINK, 'Kontakt <script>', []);
$pruef('KRITISCH: Firma und Person werden im HTML entschaerft',
    str_contains($boese['html'], 'Muster &lt;b&gt;')
    && str_contains($boese['html'], 'Kontakt &lt;script&gt;')
    && !str_contains($boese['html'], '<script>'));

echo count($bad) === 0
    ? "$ok bestanden, 0 nicht bestanden\n"
    : "$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $b) { echo "x $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
