<?php
declare(strict_types=1);
// KI-Erkennung: WARUM sie nicht ging, nicht nur DASS (ENT-530 -- zunaechst
// als ENT-529 angelegt, wegen einer Nummernkollision umgehaengt).
//
// Geprueft wird die Aussage, nicht der Wortlaut: Es steht nirgends, wie ein
// Satz zu lauten hat. Geprueft wird, dass verschiedene Sachverhalte
// verschiedene Saetze bekommen, dass jeder erreichbare Grund einen eigenen
// hat, und dass der Schluessel in keinem davon vorkommt.
//
// Der Rechenkern wird WIRKLICH ausgefuehrt -- ki_schluessel_fehlt(),
// ki_fehler_einordnen() und ki_fehler_text() sind reine Funktionen und
// brauchen weder Netz noch Datenbank. Genau dafuer sind sie herausgezogen:
// Sonst liesse sich nur der eine Zustand pruefen, den diese Umgebung
// gerade herstellt (kein Schluessel), und alle uebrigen nie.
// Diese Pruefung loest absichtlich einen error_log-Eintrag aus (der
// json_encode-Fall weiter unten). Ohne die naechste Zeile landete er im
// Fehlerkanal des Pruefwerkzeugs und saehe dort aus wie ein echter Fehler.
ini_set('error_log', tempnam(sys_get_temp_dir(), 'pruef_ki_'));

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

require __DIR__ . '/../backend/ai.php';

// ══════════ IST EIN SCHLUESSEL HINTERLEGT? ════════════════════════════
pruef('KRITISCH: ein leerer Wert gilt als nicht hinterlegt (Secret ungesetzt -> sed setzt nichts ein)',
    ki_schluessel_fehlt(''));
pruef('KRITISCH: der unersetzte Platzhalter gilt als nicht hinterlegt (sed-Zeile fehlt)',
    ki_schluessel_fehlt('__ANTHROPIC' . '_API_KEY__'));
pruef('KRITISCH: ein echter Wert gilt als hinterlegt -- sonst waere die Erkennung IMMER aus',
    !ki_schluessel_fehlt('sk-ant-pruefwert-ohne-bedeutung'));

// Der Platzhalter darf in ai.php GENAU EINMAL stehen. Der Deploy-sed ersetzt
// jedes Vorkommen; ein zweites -- etwa als Vergleichstext oder in einem
// Kommentar -- traegt den Schluessel an eine Stelle, an die er nicht gehoert,
// und macht den Vergleich zugleich sinnlos. Genau dieser Fehler ist in
// mailer.php schon passiert (ENT-192).
$quelle = (string)file_get_contents(__DIR__ . '/../backend/ai.php');
pruef('KRITISCH: der Platzhalter steht genau einmal in ai.php (sonst ersetzt der Deploy ihn mehrfach)',
    substr_count($quelle, '__ANTHROPIC' . '_API_KEY__') === 1);

// ══════════ WARUM GING ES NICHT? ══════════════════════════════════════
// Erstes Argument ist curl_errno(), zweites der HTTP-Code, drittes der Rumpf.
pruef('KRITISCH: kein Schluessel ist ein eigener Grund, kein Ausfall',
    ki_fehlergrund() !== null && ki_fehler_text('nicht_eingerichtet')['grund'] === 'nicht_eingerichtet');
pruef('KRITISCH: 401 heisst "Schluessel wird nicht akzeptiert"',
    ki_fehler_einordnen(0, 401, '') === 'schluessel_abgelehnt');
pruef('KRITISCH: 403 heisst dasselbe wie 401',
    ki_fehler_einordnen(0, 403, '') === 'schluessel_abgelehnt');
pruef('KRITISCH: ein leeres Guthaben (400 mit "credit balance") ist NICHT dasselbe wie ein falscher Schluessel',
    ki_fehler_einordnen(0, 400, '{"error":{"message":"Your credit balance is too low"}}') === 'guthaben_leer'
    && ki_fehler_einordnen(0, 402, '') === 'guthaben_leer');
pruef('Ein 400 ohne Guthabenhinweis bleibt ein Programmfehler, keine Abrechnungsfrage',
    ki_fehler_einordnen(0, 400, '{"error":{"message":"messages: unexpected role"}}') === 'anfrage_abgelehnt');
pruef('KRITISCH: 429 ist eine Bremse, keine Stoerung',
    ki_fehler_einordnen(0, 429, '') === 'zu_viele_anfragen');
pruef('KRITISCH: 500/529 ist eine Stoerung beim Anbieter',
    ki_fehler_einordnen(0, 500, '') === 'dienst_gestoert'
    && ki_fehler_einordnen(0, 529, '') === 'dienst_gestoert');
pruef('KRITISCH: eine abgelaufene Zeit ist etwas anderes als ein nicht erreichter Dienst',
    ki_fehler_einordnen(28, 0, '') === 'zeit_abgelaufen'
    && ki_fehler_einordnen(6, 0, '') === 'nicht_erreichbar');
pruef('Ein Netzfehler schlaegt den HTTP-Code -- ohne Antwort gibt es keinen Code',
    ki_fehler_einordnen(28, 200, '') === 'zeit_abgelaufen');
pruef('KRITISCH: gar kein HTTP-Code heisst "nicht erreicht", nicht "Anfrage zurueckgewiesen"',
    ki_fehler_einordnen(0, 0, '') === 'nicht_erreichbar');
// 404 heisst bei dieser Schnittstelle "Modell gibt es nicht ODER dieser Zugang
// darf es nicht" -- eine Frage an den Zugang, nicht an den Quelltext. Als
// "Programmfehler" gemeldet, suchte man tagelang an der falschen Stelle.
pruef('KRITISCH: 404 ist eine Frage an den Zugang, kein Programmfehler',
    ki_fehler_einordnen(0, 404, '{"error":{"message":"model: claude-irgendwas"}}') === 'modell_nicht_verfuegbar');
pruef('KRITISCH: 413 ist eine Groessenfrage, kein Programmfehler',
    ki_fehler_einordnen(0, 413, '') === 'anfrage_zu_gross');

// ══════════ VIER SACHVERHALTE, VIER SAETZE ════════════════════════════
// Die Regel aus CLAUDE.md: "Unbekannt" darf nie wie "keine" aussehen.
$gruende = ['nicht_eingerichtet', 'schluessel_abgelehnt', 'guthaben_leer', 'zu_viele_anfragen',
    'dienst_gestoert', 'zeit_abgelaufen', 'nicht_erreichbar', 'anfrage_abgelehnt',
    'inhalt_abgelehnt', 'kein_ergebnis', 'modell_nicht_verfuegbar', 'anfrage_zu_gross'];

// Jeder Grund, den die Einordnung ueberhaupt herstellen kann, muss auch einen
// eigenen Satz haben. Ohne diese Pruefung koennte jemand einen neuen Grund
// einfuehren und ihn still auf den Sammeltext fallen lassen -- genau der
// Fehler, den dieser ganze Vorgang behebt.
$hergestellt = [];
foreach ([[0,401],[0,403],[0,429],[0,500],[0,529],[0,402],[0,400],[0,404],[0,413],[0,418],[0,0],[28,0],[6,0]] as [$cf, $hc]) {
    $hergestellt[ki_fehler_einordnen($cf, $hc, '')] = true;
}
$hergestellt[ki_fehler_einordnen(0, 400, 'your credit balance is too low')] = true;
$fehlend = array_diff(array_keys($hergestellt), $gruende);
pruef('KRITISCH: jeder herstellbare Grund steht in der Satzliste -- keiner faellt still durch',
    $fehlend === []);
$saetze = array_map(fn($g) => ki_fehler_text($g)['message'], $gruende);
pruef('KRITISCH: jeder Grund bekommt einen EIGENEN Satz -- kein Satz zweimal',
    count(array_unique($saetze)) === count($gruende));
pruef('KRITISCH: kein Grund faellt auf den Sammeltext zurueck',
    !in_array(ki_fehler_text('gibt-es-nicht')['message'], $saetze, true));
pruef('Ein unbekannter Grund bleibt trotzdem beantwortbar (kein leerer Satz, kein Absturz)',
    ki_fehler_text('gibt-es-nicht')['message'] !== '' && ki_fehler_text('gibt-es-nicht')['code'] >= 400);
pruef('KRITISCH: kein Satz ist leer',
    count(array_filter($saetze, fn($s) => trim($s) === '')) === 0);

// Der haeufigste Betriebsfall muss sich vom haeufigsten Einrichtungsfall
// unterscheiden lassen -- das war die eigentliche Luecke: Von aussen war
// nicht feststellbar, ob ueberhaupt ein Schluessel hinterlegt ist.
pruef('KRITISCH: "kein Schluessel hinterlegt" und "Schluessel abgelehnt" sind verschiedene Aussagen',
    ki_fehler_text('nicht_eingerichtet')['message'] !== ki_fehler_text('schluessel_abgelehnt')['message']);
pruef('KRITISCH: "nicht eingerichtet" traegt einen eigenen Statuscode (503), nicht den Sammelcode 502',
    ki_fehler_text('nicht_eingerichtet')['code'] === 503);

// Der Schluessel selbst darf nie hinausgehen -- auch nicht in Teilen.
$schluessel = 'sk-ant-api03-geheimwert-pruefung';
pruef('KRITISCH: in keinem Satz steht der Schluessel',
    count(array_filter($saetze, fn($s) => str_contains($s, 'sk-ant') || str_contains($s, $schluessel))) === 0);

// ══════════ EIN RUMPF, DER NICHT ENTSTEHT ═════════════════════════════
// json_encode gibt bei ungueltigem UTF-8 false zurueck. curl macht daraus
// einen LEEREN Rumpf -- die Schnittstelle antwortet dann mit 400, und die
// Ursache steht in einem Kundennamen, nicht in der Anfrage.
pruef('Ein gueltiger Rumpf entsteht',
    ki_koerper(['a' => 'Beispiel AG']) === '{"a":"Beispiel AG"}');
ki_fehlergrund('kein_ergebnis');
pruef('KRITISCH: ungueltiges UTF-8 wird erkannt, nicht als leerer Rumpf verschickt',
    ki_koerper(['name' => "Beispiel \xFF AG"]) === null
    && ki_fehlergrund() === 'anfrage_abgelehnt');
pruef('KRITISCH: und die Begruendung nennt die Kodierung, nicht das Bild',
    str_contains(strtolower(ki_fehler_einzelheit()), 'json'));
ki_fehler_einzelheit('');

// ══════════ DIE BEGRUENDUNG DER GEGENSEITE ════════════════════════════
// Zwei Saetze fordern zum Handeln auf ("gehoert gemeldet", "Zugang pruefen").
// Ohne die Begruendung der Schnittstelle waere das eine Aufforderung ohne
// Inhalt -- der Bediener haette nichts in der Hand.
pruef('Aus einer Fehlerantwort wird der erklaerende Satz gelesen',
    ki_fehler_einzelheit_lesen('{"type":"error","error":{"type":"not_found_error","message":"model: claude-beispiel"}}')
        === 'model: claude-beispiel');
pruef('Aus einer Antwort ohne Fehlerfeld wird nichts erfunden',
    ki_fehler_einzelheit_lesen('{"content":[]}') === '' && ki_fehler_einzelheit_lesen('kein JSON') === '');
pruef('KRITISCH: Steuerzeichen zerlegen die Anzeige nicht',
    !str_contains(ki_fehler_einzelheit_lesen('{"error":{"message":"a\nb\tc"}}'), "\n"));
pruef('Eine sehr lange Begruendung wird gekappt',
    mb_strlen(ki_fehler_einzelheit_lesen('{"error":{"message":"' . str_repeat('x', 900) . '"}}')) === 200);

ki_fehler_einzelheit('model: claude-beispiel');
pruef('KRITISCH: bei "Modell nicht verfuegbar" steht die Begruendung im Satz',
    str_contains(ki_fehler_text('modell_nicht_verfuegbar')['message'], 'model: claude-beispiel'));
pruef('KRITISCH: bei "zurueckgewiesen" ebenso -- sonst ist "gehoert gemeldet" eine Aufforderung ohne Inhalt',
    str_contains(ki_fehler_text('anfrage_abgelehnt')['message'], 'model: claude-beispiel'));
pruef('Bei den selbsterklaerenden Gruenden haengt sie NICHT an',
    !str_contains(ki_fehler_text('nicht_eingerichtet')['message'], 'model: claude-beispiel')
    && !str_contains(ki_fehler_text('guthaben_leer')['message'], 'model: claude-beispiel'));
ki_fehler_einzelheit('');

// ══════════ DER GRUND UEBERLEBT DEN RUECKWEG ══════════════════════════
// Die Funktionen geben weiterhin null zurueck; der Grund steht daneben.
ki_fehlergrund('dienst_gestoert');
pruef('KRITISCH: der zuletzt gesetzte Grund laesst sich wieder lesen',
    ki_fehlergrund() === 'dienst_gestoert' && ki_fehler_text()['grund'] === 'dienst_gestoert');
ki_fehlergrund('nicht_eingerichtet');
pruef('Ohne Argument gelesen wird nichts ueberschrieben',
    ki_fehlergrund() === 'nicht_eingerichtet');

// Ohne Schluessel gehen die vier Einstiegsfunktionen gar nicht erst ins Netz
// und melden genau das. In dieser Umgebung steht der Platzhalter noch, also
// ist der Fall echt herstellbar -- ohne Netz, ohne Schluessel, ohne Kosten.
if (ki_schluessel_fehlt(ki_schluessel())) {
    ki_fehlergrund('kein_ergebnis');   // absichtlich falsch vorbelegen
    $r = anthropic_extract_einsatz_bild('AAAA', 'image/jpeg', [], [], '2000-01-01');
    pruef('KRITISCH: ohne Schluessel wird nichts gesendet und der Grund lautet "nicht eingerichtet"',
        $r === null && ki_fehlergrund() === 'nicht_eingerichtet');

    ki_fehlergrund('kein_ergebnis');
    $r2 = anthropic_recherche_kunde('Beispiel AG');
    pruef('KRITISCH: das gilt auch fuer die Kundenrecherche (eigener Aufrufweg, gleiche Aussage)',
        $r2 === null && ki_fehlergrund() === 'nicht_eingerichtet');

    ki_fehlergrund('kein_ergebnis');
    $r3 = anthropic_route_diktat('Beispieltext', [], [], '2000-01-01');
    pruef('KRITISCH: und fuer das Diktat',
        $r3 === null && ki_fehlergrund() === 'nicht_eingerichtet');
} else {
    // Hier steht ein echter Wert -- dann laeuft diese Pruefung auf einem
    // Deploy-Stand und nicht im Repository. Nicht stillschweigend
    // ueberspringen: "nicht geprueft" ist etwas anderes als "gruen".
    $bad[] = 'ai.php traegt einen ersetzten Schluessel -- diese Pruefung gehoert ins Repository, nicht auf einen Deploy-Stand';
}

echo "ok: $ok\n";
foreach ($bad as $b) { echo "- $b\n"; }
exit($bad ? 1 : 0);
