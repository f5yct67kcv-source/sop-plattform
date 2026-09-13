<?php
declare(strict_types=1);
// Supportvorgaenge (ENT-538). Der Rechenkern wird WIRKLICH ausgefuehrt --
// backend/supportvorgang.php laesst sich ohne Datenbank laden, weil jede
// Funktion ihr PDO uebergeben bekommt.
//
// Was sich nicht echt ausfuehren laesst (die SQL-Wege), wird am Quelltext
// geprueft -- aber nicht als Wortlaut, sondern als AUSSAGE: nicht "steht
// das Wort mandant_id drin", sondern "grenzt die Abfrage auf den eigenen
// Mandanten ein". Eine Pruefung, die nachsieht, ob ein Wort im Code steht,
// bleibt gruen, wenn die Formulierung sich aendert und die Sache
// verschwindet (CLAUDE.md).
$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

require __DIR__ . '/../backend/supportvorgang.php';

// ══════════ EINGABE, ECHT GEPRUEFT ═══════════════════════════════════
$gut = ['betreff' => '  Rundgang bricht ab  ', 'text' => "Zeile 1\r\nZeile 2",
        'art' => 'stoerung', 'bildschirm' => 'Einstellungen', 'umgebung' => 'Chrome · 1920×1080'];
$p = sv_anfrage_pruefen($gut);
pruef('Eine vollstaendige Anfrage wird angenommen', $p['fehler'] === []);
pruef('Randleerzeichen im Betreff werden entfernt', $p['werte']['betreff'] === 'Rundgang bricht ab');
pruef('Die Schilderung behaelt ihre Umbrueche', str_contains($p['werte']['text'], "\n"));

pruef('KRITISCH: ohne Betreff wird abgewiesen',
    isset(sv_anfrage_pruefen(['text' => 'da'])['fehler']['betreff']));
pruef('KRITISCH: ohne Schilderung wird abgewiesen',
    isset(sv_anfrage_pruefen(['betreff' => 'da'])['fehler']['text']));

// Eine unbekannte Art wird NICHT abgewiesen: Die Art sortiert nur, sie ist
// keine Bedingung dafuer, dass jemand ein Anliegen loswerden darf.
$fremdeArt = sv_anfrage_pruefen(array_merge($gut, ['art' => 'katastrophe']));
pruef('Eine unbekannte Art wird zu "frage" statt abgewiesen',
    $fremdeArt['fehler'] === [] && $fremdeArt['werte']['art'] === 'frage');

// Header-Injection: Der Betreff landet im Betreff einer E-Mail. Ein
// eingeschmuggeltes "\r\n" waere dort eine zusaetzliche Kopfzeile.
$inj = sv_anfrage_pruefen(array_merge($gut,
    ['betreff' => "Betreff\r\nBcc: fremd@example.invalid"]));
pruef('KRITISCH: Umbrueche im Betreff werden entfernt (keine zusaetzliche Kopfzeile)',
    !str_contains($inj['werte']['betreff'], "\n")
    && !str_contains(sv_mail_betreff('Betrieb', $inj['werte']['betreff'], false), "\n"));
pruef('KRITISCH: auch der Mandantenname kann keine Kopfzeile anhaengen',
    !str_contains(sv_mail_betreff("Firma\r\nBcc: x@example.invalid", 'Betreff', false), "\n"));

// Ein sehr langer Text wird gekuerzt und nicht abgewiesen -- wer viel
// schreibt, hat viel zu sagen, nicht zu viel.
$lang = sv_anfrage_pruefen(array_merge($gut, ['text' => str_repeat('x', SV_MAX_TEXT + 500)]));
pruef('Ein zu langer Text wird gekuerzt statt abgewiesen',
    $lang['fehler'] === [] && mb_strlen($lang['werte']['text']) === SV_MAX_TEXT);

// ══════════ KEIN ANFRAGETEXT IN DER MAIL (ENT-538, Entscheidung 6) ═══
$text = sv_mail_text('Betrieb A', 'Rundgang bricht ab', 'stoerung', false, 'https://example.invalid/');
pruef('KRITISCH: die Mail traegt Betrieb und Betreff', str_contains($text, 'Betrieb A')
    && str_contains($text, 'Rundgang bricht ab'));
pruef('KRITISCH: die Mail sagt selbst, dass der Anfragetext fehlt',
    str_contains(mb_strtolower($text), 'nicht in dieser e-mail'));
pruef('Die Erinnerung sagt, dass der Vorgang steht, die Eingangsmail nicht',
    str_contains(sv_mail_text('B', 'X', 'frage', true, null), 'unbearbeitet')
    && !str_contains($text, 'unbearbeitet'));
pruef('Ohne Adresse aus dem Deploy wird auf den Bereich verwiesen statt eine halbe Adresse gebaut',
    !str_contains(sv_mail_text('B', 'X', 'frage', false, null), 'http'));

// ══════════ WELCHER MANDANT FRAGT ════════════════════════════════════
$mandanten = [
    ['id' => 1, 'name' => 'Bestand', 'db_name' => ''],
    ['id' => 2, 'name' => 'Zweiter', 'db_name' => 'db_zwei'],
];
pruef('Ein Mandant mit passender Datenbank wird zugeordnet',
    sv_mandant_waehlen($mandanten, 'db_zwei') === ['id' => 2, 'lage' => 'zugeordnet']);
pruef('Der Bestandsmandant (leeres db_name) faengt die Standardverbindung',
    sv_mandant_waehlen($mandanten, 'irgendwas') === ['id' => 1, 'lage' => 'bestand']);

// DAS IST DIE WICHTIGSTE PRUEFUNG DIESER DATEI: Wer im Zweifel auf den
// ersten Mandanten raet, schreibt die Anfrage eines Betriebs unter dem
// Namen eines anderen in den Vorrat.
$zweiBestand = [
    ['id' => 1, 'name' => 'A', 'db_name' => ''],
    ['id' => 2, 'name' => 'B', 'db_name' => ''],
];
$unklar = sv_mandant_waehlen($zweiBestand, 'fremd');
pruef('KRITISCH: bei zwei Bestandsmandanten wird NICHT geraten',
    $unklar['id'] === null && $unklar['lage'] === 'nicht_zuordenbar');
pruef('KRITISCH: ohne jeden Mandanten wird NICHT geraten',
    sv_mandant_waehlen([], 'egal')['id'] === null);
pruef('"nicht zuordenbar" ist eine eigene Lage, nicht einfach Mandant 1',
    $unklar['lage'] !== 'bestand' && $unklar['lage'] !== 'zugeordnet');

// ══════════ DER STATUS FOLGT DER NACHRICHT ═══════════════════════════
pruef('Antwortet der Betreiber, wartet der Vorgang auf den Kunden',
    sv_status_nach_antwort('neu', 'betreiber') === 'wartet_auf_kunde');
pruef('KRITISCH: der Betreiber erklaert einen Vorgang nicht durch Antworten fuer erledigt',
    sv_status_nach_antwort('in_arbeit', 'betreiber') !== 'erledigt');
pruef('Antwortet der Kunde auf einen erledigten Vorgang, ist er wieder in Arbeit',
    sv_status_nach_antwort('erledigt', 'kunde') === 'in_arbeit');
pruef('Schiebt der Kunde auf einem neuen Vorgang nach, bleibt er neu (die Erinnerung laeuft weiter)',
    sv_status_nach_antwort('neu', 'kunde') === 'neu');

// ══════════ WANN WIRD ERINNERT ═══════════════════════════════════════
$jetzt = 1800000000;               // fester Zeitpunkt, kein "heute"
$alt   = date('Y-m-d H:i:s', $jetzt - 30 * 3600);
$frisch= date('Y-m-d H:i:s', $jetzt - 2 * 3600);

pruef('Ein alter, unangetasteter Vorgang wird erinnert',
    sv_erinnerung_faellig(['status' => 'neu', 'erinnert_am' => null, 'eroeffnet_am' => $alt], $jetzt));
pruef('Ein frischer Vorgang wird nicht erinnert',
    !sv_erinnerung_faellig(['status' => 'neu', 'erinnert_am' => null, 'eroeffnet_am' => $frisch], $jetzt));
pruef('KRITISCH: es wird nur EINMAL erinnert',
    !sv_erinnerung_faellig(['status' => 'neu', 'erinnert_am' => $alt, 'eroeffnet_am' => $alt], $jetzt));
pruef('KRITISCH: ein angefasster Vorgang wird nicht erinnert',
    !sv_erinnerung_faellig(['status' => 'in_arbeit', 'erinnert_am' => null, 'eroeffnet_am' => $alt], $jetzt));
pruef('Ein unlesbares Datum fuehrt nicht zu einer Erinnerung',
    !sv_erinnerung_faellig(['status' => 'neu', 'erinnert_am' => null, 'eroeffnet_am' => 'kaputt'], $jetzt));

// ══════════ VIER STATUS, VIER AUSSAGEN ═══════════════════════════════
pruef('Es gibt genau vier Status', count(SV_STATUS) === 4);
pruef('KRITISCH: "wartet auf Kunde" zaehlt NICHT als offen',
    !in_array('wartet_auf_kunde', SV_STATUS_OFFEN, true)
    && !in_array('erledigt', SV_STATUS_OFFEN, true));
pruef('Offen sind genau "neu" und "in Arbeit"',
    in_array('neu', SV_STATUS_OFFEN, true) && in_array('in_arbeit', SV_STATUS_OFFEN, true));
$worte = array_map('sv_status_wort', SV_STATUS);
pruef('KRITISCH: jeder Status hat ein eigenes Wort (unbekannt darf nie wie keine aussehen)',
    count(array_unique($worte)) === count(SV_STATUS));
pruef('Ein unbekannter Status wird als unbekannt benannt, nicht als leer',
    sv_status_wort('gibtsnicht') === 'Unbekannt');
pruef('Jede Art hat ein eigenes Wort',
    count(array_unique(array_map('sv_art_wort', SV_ARTEN))) === count(SV_ARTEN));

// ══════════ DIE SQL-WEGE, AM QUELLTEXT ALS AUSSAGE GEPRUEFT ══════════
$q = file_get_contents(__DIR__ . '/../backend/supportvorgang.php');
$ohneKommentar = preg_replace('!//[^\n]*|/\*[\s\S]*?\*/!', '', $q);

// Die Eingrenzung auf den eigenen Betrieb muss in der ABFRAGE stehen, nicht
// in einer Pruefung danach: Ein fremder Vorgang darf nicht gefunden und
// dann verworfen werden, er darf gar nicht erst gefunden werden.
pruef('KRITISCH: die Einzelabfrage grenzt auf den eigenen Mandanten in der WHERE-Bedingung ein',
    (bool)preg_match('/\$wo\s*\.=\s*\'\s*AND\s+v\.mandant_id\s*=\s*\?/i', $ohneKommentar));

// Die Sperre gegen doppelten Versand: Der Vermerk wird nur gesetzt, wenn er
// noch frei war -- sonst schickten mehrere Zeitgeber dieselbe Mail.
pruef('KRITISCH: der Erinnerungsvermerk wird nur gesetzt, wenn er noch frei war',
    (bool)preg_match('/UPDATE\s+support_vorgang\s+SET\s+erinnert_am[\s\S]{0,120}WHERE[\s\S]{0,60}erinnert_am\s+IS\s+NULL/i',
        $ohneKommentar));
pruef('KRITISCH: die Sperre entscheidet an der Zahl der geaenderten Zeilen',
    (bool)preg_match('/sv_erinnerung_merken[\s\S]{0,400}rowCount\(\)\s*===\s*1/', $ohneKommentar));

// Erst vermerken, dann versenden: Bricht es dazwischen ab, fehlt eine
// Erinnerung -- umgekehrt kaeme sie beim naechsten Lauf ein zweites Mal.
//
// ACHTUNG, HIER LAG EIN FEHLER IN DER PRUEFUNG SELBST: Ein blosser
// strpos-Vergleich blieb gruen, als die Gegenprobe den Vermerk ENTFERNTE --
// strpos gibt dann false zurueck, und false < 300 ist in PHP wahr. Beide
// Stellen muessen darum erst als vorhanden nachgewiesen werden.
$posMerken = strpos($ohneKommentar, 'sv_erinnerung_merken($stamm');
$posSenden = strpos($ohneKommentar, 'sv_benachrichtigen($stamm, $v,');
pruef('KRITISCH: der Vermerk steht VOR dem Versand',
    $posMerken !== false && $posSenden !== false && $posMerken < $posSenden);

// Ein fehlgeschlagener Versand darf die Anfrage nie scheitern lassen.
pruef('KRITISCH: ein Empfaenger, der nicht erreichbar ist, haelt die uebrigen nicht auf',
    (bool)preg_match('/foreach\s*\(\s*\$empfaenger[\s\S]{0,300}try\s*\{[\s\S]{0,200}smtp_senden[\s\S]{0,200}catch/',
        $ohneKommentar));
$posKonf = strpos($ohneKommentar, 'smtp_konfiguriert()');
$posMail = strpos($ohneKommentar, 'smtp_senden(');
pruef('Der Versand wird nur versucht, wenn SMTP eingerichtet ist',
    $posKonf !== false && $posMail !== false && $posKonf < $posMail);

// Vorgang und erste Nachricht entstehen zusammen -- ein Vorgang ohne
// Schilderung waere ein leerer Eintrag, den niemand einordnen kann.
pruef('KRITISCH: Vorgang und erste Nachricht entstehen in EINER Transaktion',
    (bool)preg_match('/function sv_einreichen[\s\S]{0,1200}beginTransaction[\s\S]{0,900}support_nachricht[\s\S]{0,300}commit/',
        $ohneKommentar));
pruef('KRITISCH: bricht das Einreichen ab, bleibt kein halber Vorgang stehen',
    (bool)preg_match('/function sv_einreichen[\s\S]{0,1600}rollBack/', $ohneKommentar));

// Die Empfaenger kommen aus den Betreiber-Konten, nicht aus einer zweiten
// Liste, die auseinanderlaufen koennte -- und nur die aktiven.
pruef('KRITISCH: benachrichtigt werden nur aktive Betreiber-Konten',
    (bool)preg_match('/FROM\s+betreiber\s+WHERE\s+aktiv\s*=\s*1/i', $ohneKommentar));

// ══════════ DIE BENANNTE AUSNAHME BLEIBT EINE ════════════════════════
//
// Mandanten-Code darf die Betreiber-Ebene nur ueber sv_mandant_bestimmen()
// erreichen. Die Gegenprobe dazu steht in test_php.mjs -- hier wird
// geprueft, dass die Zuordnung nicht doch heimlich raet.
pruef('KRITISCH: schlaegt die Zuordnung fehl, wird kein Mandant zurueckgegeben',
    (bool)preg_match('/function sv_mandant_bestimmen[\s\S]{0,900}\[\s*\'id\'\s*=>\s*\$treffer\[\'id\'\]/',
        $ohneKommentar));
pruef('Ohne Mandantenstamm wird die Zuordnung abgebrochen, nicht geraten',
    (bool)preg_match('/function sv_mandant_bestimmen[\s\S]{0,300}hat_tabelle\(\$stamm,\s*\'mandant\'\)[\s\S]{0,200}kein_stamm/',
        $ohneKommentar));

// ══════════ AUSGABE ══════════════════════════════════════════════════
echo "\n$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $b) { echo "  ✗ $b\n"; }
exit($bad ? 1 : 0);
