<?php
declare(strict_types=1);

// KI-Sprachbefehl-Pilot (ENT-015). Nimmt bereits transkribierten Text
// entgegen (Sprach-zu-Text laeuft ueber die native Tastaturdiktierfunktion
// des Geraets, nicht hier) und zerlegt ihn per Anthropic-API in
// strukturierte Mitarbeiter-Felder. Schreibt nie selbst in die Datenbank --
// nur Extraktion, das Speichern bleibt beim Admin.

// ══════════════════════════════════════════ WARUM ES NICHT GING (ENT-530)
//
// Die Nummer: Dieser Vorgang trug zunaechst ENT-529. Eine parallel laufende
// Sitzung hatte dieselbe Nummer elf Minuten frueher vergeben (dort: die
// Betreiber-Tabellen am Einrichtungsknopf), also wurde dieser Eintrag nach
// der Regel in CLAUDE.md auf ENT-530 umgehaengt. Die Commit-Nachricht im
// Verlauf nennt noch ENT-529 -- sie steht auf main und wird nicht
// nachtraeglich umgeschrieben.
//
// Bis hierher gab jede Funktion dieser Datei bei JEDEM Fehlschlag dasselbe
// zurueck: null. Die vier Endpunkte machten daraus denselben einen Satz
// ("Erkennung nicht verfuegbar") -- gleichgueltig, ob gar kein Schluessel
// hinterlegt war, ob er abgelehnt wurde, ob das Guthaben aufgebraucht war
// oder ob der Anbieter gerade stoerte.
//
// Das ist genau der Fall, den CLAUDE.md als wichtigsten seiner Liste fuehrt:
// „Unbekannt" darf nie wie „keine" aussehen. Praktisch hiess es, dass sich
// nicht einmal mehr feststellen liess, OB ueberhaupt noch ein Schluessel
// hinterlegt ist -- weder am Bildschirm noch beim Nachsehen im Quelltext.
//
// Der Rueckgabewert bleibt null, jeder Aufrufer prueft weiterhin darauf. Der
// Grund steht daneben bereit und wird von den Endpunkten in einen eigenen
// Satz uebersetzt.

// Der Schluessel. EINE Stelle statt bisher drei -- der Deploy ersetzt den
// Platzhalter hier (.github/workflows/deploy-hostpoint.yml, Schritt
// „Platzhalter durch echte Werte ersetzen"). Ist das Secret
// ANTHROPIC_API_KEY nicht gesetzt, bricht der Deploy bewusst NICHT ab: Er
// setzt einen leeren Wert ein, und diese Datei erkennt das selbst.
function ki_schluessel(): string
{
    $wert = '__ANTHROPIC_API_KEY__';
    // Messlauf der Spracheingabe (ENT-695, pruefungen/ki_saetze.php): Nur
    // dort, nur auf der Kommandozeile und nur, solange der Deploy hier
    // nichts eingesetzt hat, darf ein Schluessel von aussen kommen. Der
    // Webserver kommt an diesen Zweig nicht heran (PHP_SAPI), und die
    // normale Regression auch nicht (die Konstante setzt nur der Messlauf).
    if (ki_schluessel_fehlt($wert) && PHP_SAPI === 'cli' && defined('KI_MESSLAUF_SCHLUESSEL')) {
        return (string)KI_MESSLAUF_SCHLUESSEL;
    }
    return $wert;
}

// Ist gar kein Schluessel hinterlegt? Eigene, reine Funktion, damit sich auch
// der Fall „ist hinterlegt" mit einem frei gewaehlten Testwert pruefen laesst
// -- nicht nur der eine Zustand, den diese Umgebung herstellt.
//
// Der Vergleichstext steht bewusst OHNE den abschliessenden doppelten
// Unterstrich da: Der Deploy-sed ersetzt in dieser Datei JEDES Vorkommen des
// vollstaendigen Platzhalters (also mit beiden Schlussstrichen) -- auch eines,
// das nur als Vergleich dienen soll, und auch eines in einem Kommentar. Dann
// verglichen sich echter Wert und Vergleichstext miteinander, und die Stelle
// loeste immer aus, egal was im Secret stand. Genau dieser Fehler ist in
// mailer.php schon passiert (ENT-192, dort platzhalter_offen()).
function ki_schluessel_fehlt(string $schluessel): bool
{
    return $schluessel === '' || str_contains($schluessel, '__ANTHROPIC_API_KEY');
}

// Grund des letzten Fehlschlags. Ohne Argument nur lesen.
function ki_fehlergrund(?string $neu = null): string
{
    static $grund = 'kein_ergebnis';
    if ($neu !== null) { $grund = $neu; }
    return $grund;
}

// Aus Netz- und HTTP-Ergebnis einen Grund machen. Reine Funktion mit
// uebergebenen Werten statt einer Auswertung mitten im Aufruf -- so laesst
// sich JEDER Fall pruefen, nicht nur der, den diese Umgebung gerade herstellt.
//
// $curlFehler ist curl_errno(): 0 heisst „Antwort erhalten", 28 heisst „Zeit
// abgelaufen" (CURLE_OPERATION_TIMEDOUT). Als Zahl und nicht als Konstante,
// damit die Pruefung auch ohne geladene curl-Erweiterung laeuft.
function ki_fehler_einordnen(int $curlFehler, int $httpCode, string $rumpf): string
{
    if ($curlFehler !== 0) {
        return $curlFehler === 28 ? 'zeit_abgelaufen' : 'nicht_erreichbar';
    }
    // Gar kein HTTP-Code heisst: Es kam keine Antwort. Ohne diese Zeile fiele
    // der Fall ans Ende durch und saehe aus wie eine zurueckgewiesene Anfrage
    // -- also wie ein Programmfehler statt wie ein Netzproblem.
    if ($httpCode === 0) { return 'nicht_erreichbar'; }
    if ($httpCode === 401 || $httpCode === 403) { return 'schluessel_abgelehnt'; }
    if ($httpCode === 429)                      { return 'zu_viele_anfragen'; }
    if ($httpCode >= 500)                       { return 'dienst_gestoert'; }
    // Ein aufgebrauchtes Guthaben meldet die Schnittstelle als 400 mit dem
    // Hinweis „credit balance is too low". Ohne diese Unterscheidung saehe der
    // haeufigste Betriebsfall aus wie ein Programmfehler, und man suchte im
    // Quelltext statt in der Abrechnung.
    if ($httpCode === 402) { return 'guthaben_leer'; }
    // 404 heisst bei dieser Schnittstelle NICHT "Endpunkt vertippt", sondern
    // "Modell gibt es nicht ODER dieser Zugang darf es nicht" -- die API
    // unterscheidet die beiden bewusst nicht, um Aussenstehenden nicht zu
    // verraten, welche Modelle existieren. Das ist keine Frage an den
    // Quelltext, sondern an den Zugang, und braucht darum einen eigenen Satz.
    if ($httpCode === 404) { return 'modell_nicht_verfuegbar'; }
    // 413 ist eine Groessenfrage und damit etwas, das der Bediener selbst
    // loesen kann -- als "Programmfehler" waere sie an ihm vorbeigemeldet.
    if ($httpCode === 413) { return 'anfrage_zu_gross'; }
    if ($httpCode === 400) {
        $r = strtolower($rumpf);
        if (str_contains($r, 'credit balance') || str_contains($r, 'billing')) {
            return 'guthaben_leer';
        }
        // Ein Schluessel, der fuer die ganze Organisation gilt statt fuer einen
        // Workspace, muss bei JEDER Anfrage zusaetzlich sagen, welcher
        // Workspace gemeint ist. Fehlt das, kommt ein 400 -- und der saehe
        // ohne diese Zeile aus wie ein Programmfehler im Rumpf. Genau das ist
        // am 11.09.2026 passiert und hat einen halben Vormittag gekostet: Der
        // Rumpf war in Ordnung, der Schluessel war es nicht.
        //
        // Erkannt am Namen des verlangten Kopfes, nicht am ganzen Satz -- der
        // Wortlaut der Meldung darf sich aendern, der Kopfname nicht.
        if (str_contains($r, 'anthropic-workspace-id') || str_contains($r, 'scoped to a workspace')) {
            return 'schluessel_ohne_workspace';
        }
        return 'anfrage_abgelehnt';
    }
    if ($httpCode !== 200) { return 'anfrage_abgelehnt'; }
    return 'kein_ergebnis';
}

// Die Einzelheit zum letzten Fehlschlag -- ein Satz der Schnittstelle selbst,
// kein Rumpf. Ohne Argument nur lesen.
//
// Wozu: Zwei der Gruende unten sagen "das gehoert gemeldet" bzw. "der Zugang
// darf dieses Modell nicht". Ohne die Begruendung der Gegenseite hat der
// Bediener nichts in der Hand, was er melden oder nachsehen koennte -- der
// Satz waere eine Aufforderung ohne Inhalt.
function ki_fehler_einzelheit(?string $neu = null): string
{
    static $text = '';
    if ($neu !== null) { $text = $neu; }
    return $text;
}

// Den erklaerenden Satz aus einer Fehlerantwort holen. Bewusst NUR das Feld
// error.message und nichts sonst: Es beschreibt die Zurueckweisung (etwa
// "model: ..." oder "max_tokens: ..."), nennt keine uebermittelten Werte und
// enthaelt den Schluessel nicht -- der geht im Kopf hinaus, nicht im Rumpf
// zurueck. Gekappt und von Steuerzeichen befreit, damit nichts die Anzeige
// zerlegt.
function ki_fehler_einzelheit_lesen(string $rumpf): string
{
    $data = json_decode($rumpf, true);
    $satz = is_array($data) ? (string)($data['error']['message'] ?? '') : '';
    $satz = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $satz) ?? '');
    return mb_substr($satz, 0, 200);
}

// Was der Bediener liest, und mit welchem Statuscode. Verschiedene
// Sachverhalte bekommen verschiedene Saetze -- nicht einer fuer alles. Der
// Schluessel selbst kommt in keinem dieser Texte vor, auch nicht in Teilen.
function ki_fehler_text(?string $grund = null): array
{
    $grund = $grund ?? ki_fehlergrund();
    $texte = [
        'nicht_eingerichtet' => [503,
            'Die KI-Erkennung ist nicht eingerichtet: Auf diesem Server ist kein Anthropic-Schlüssel hinterlegt.'],
        'schluessel_ohne_workspace' => [503,
            'Der hinterlegte Anthropic-Schlüssel gilt für die ganze Organisation und nicht für einen Workspace — dann verlangt die Schnittstelle bei jeder Anfrage zusätzlich die Angabe des Workspace. Abhilfe: in der Anthropic Console einen Schlüssel MIT Workspace anlegen und als Secret hinterlegen.'],
        'schluessel_abgelehnt' => [502,
            'Der hinterlegte Anthropic-Schlüssel wird nicht akzeptiert — abgelaufen, widerrufen oder falsch eingetragen.'],
        'guthaben_leer' => [502,
            'Das Anthropic-Guthaben ist aufgebraucht. Die Erkennung läuft erst wieder, wenn es aufgeladen ist.'],
        'zu_viele_anfragen' => [502,
            'Zu viele Anfragen in kurzer Zeit. In ein bis zwei Minuten nochmals versuchen.'],
        'dienst_gestoert' => [502,
            'Die Erkennung antwortet gerade nicht — eine Störung beim Anbieter. Später nochmals versuchen.'],
        'zeit_abgelaufen' => [504,
            'Die Erkennung hat zu lange gebraucht und wurde abgebrochen. Nochmals versuchen, bei einem Bild mit einem kleineren Ausschnitt.'],
        'nicht_erreichbar' => [502,
            'Der Server hat die Erkennung nicht erreicht. Das liegt am Server, nicht an Ihrem Gerät.'],
        'modell_nicht_verfuegbar' => [502,
            'Das angeforderte KI-Modell ist über diesen Zugang nicht erreichbar — entweder stimmt die Modellkennung nicht, oder der hinterlegte Schlüssel darf dieses Modell nicht verwenden.'],
        'anfrage_zu_gross' => [413,
            'Die Anfrage ist zu gross. Bei einem Bild einen kleineren Ausschnitt wählen oder es vorher verkleinern.'],
        'anfrage_abgelehnt' => [502,
            'Die Erkennung hat die Anfrage zurückgewiesen. Das ist ein Programmfehler und gehört gemeldet.'],
        'inhalt_abgelehnt' => [422,
            'Die Erkennung hat die Verarbeitung dieses Inhalts abgelehnt.'],
        'kein_ergebnis' => [422,
            'Die Erkennung hat kein verwertbares Ergebnis geliefert.'],
    ];
    [$code, $satz] = $texte[$grund] ?? [502, 'Die Erkennung ist fehlgeschlagen.'];
    // Nur bei den beiden Gruenden, die ohne die Begruendung der Gegenseite
    // nicht handhabbar sind. Bei allen uebrigen sagt der Satz schon alles,
    // und ein englischer Anhang waere nur Laerm.
    $einzelheit = ki_fehler_einzelheit();
    if ($einzelheit !== '' && in_array($grund, ['anfrage_abgelehnt', 'modell_nicht_verfuegbar'], true)) {
        $satz .= ' Die Schnittstelle sagt dazu: „' . $einzelheit . '"';
    }
    return ['grund' => $grund, 'code' => $code, 'message' => $satz];
}

// Den Fehlschlag an die Oberflaeche geben und den Ablauf beenden. Viermal
// derselbe Rumpf in den Endpunkten waeren vier Stellen, an denen ein
// kuenftiger fuenfter Endpunkt wieder beim einen Satz fuer alles landet.
// $eigenerText nur dort, wo ein Grund im jeweiligen Bereich wirklich etwas
// anderes bedeutet (siehe ki_kunden_recherche.php).
function ki_fehler_melden(?string $eigenerText = null): void
{
    $f = ki_fehler_text();
    json_response([
        'status'  => 'error',
        'message' => $eigenerText ?? $f['message'],
        'grund'   => $f['grund'],
    ], $f['code']);
}

// Den Rumpf bauen. Eigene Funktion, damit der Fehlerfall ohne Netz und ohne
// Schluessel pruefbar ist -- in ki_aufruf greift die Schluesselpruefung
// vorher, und der Fall waere dort nie erreichbar.
//
// Wozu ueberhaupt: json_encode scheitert stillschweigend an ungueltigem UTF-8
// und gibt dann false zurueck. In diese Anfrage gehen Kunden- und
// Mitarbeitendennamen aus der Datenbank ein. Ohne die Pruefung setzte curl
// das false in einen LEEREN Rumpf um, die Schnittstelle antwortete mit 400,
// und die Suche begaenne beim Bild statt bei einem Namen.
function ki_koerper(array $payload): ?string
{
    $koerper = json_encode($payload);
    if ($koerper === false) {
        ki_fehlergrund('anfrage_abgelehnt');
        ki_fehler_einzelheit('Die Anfrage liess sich nicht als JSON kodieren: ' . json_last_error_msg());
        error_log('KI-Aufruf: json_encode fehlgeschlagen -- ' . json_last_error_msg());
        return null;
    }
    return $koerper;
}

// Ein Aufruf an die Nachrichten-Schnittstelle. Alle Funktionen dieser Datei
// gehen hier durch: EINE Stelle, die den Schluessel setzt, EINE, die einen
// Fehlschlag einordnet.
function ki_aufruf(array $payload, int $timeout): ?array
{
    // Zuruecksetzen, bevor irgendetwas passiert: Sonst haengt die Begruendung
    // des VORIGEN Aufrufs an einem neuen Fehlschlag und erklaert das Falsche.
    ki_fehler_einzelheit('');

    $schluessel = ki_schluessel();
    if (ki_schluessel_fehlt($schluessel)) {
        ki_fehlergrund('nicht_eingerichtet');
        return null;
    }

    $koerper = ki_koerper($payload);
    if ($koerper === null) {
        return null;
    }

    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'content-type: application/json',
            'x-api-key: ' . $schluessel,
            'anthropic-version: 2023-06-01',
        ],
        CURLOPT_POSTFIELDS => $koerper,
        CURLOPT_TIMEOUT => $timeout,
    ]);
    $antwort    = curl_exec($ch);
    $httpCode   = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlFehler = curl_errno($ch);
    curl_close($ch);

    if ($antwort === false || $httpCode !== 200) {
        ki_fehlergrund(ki_fehler_einordnen($curlFehler, $httpCode, (string)$antwort));
        ki_fehler_einzelheit(ki_fehler_einzelheit_lesen((string)$antwort));
        // Der Rumpf der Fehlerantwort gehoert ins Serverprotokoll, nicht auf
        // den Bildschirm: Er hilft beim Nachsehen, und der Bediener kann
        // damit nichts anfangen. Der Schluessel steht nicht darin -- er geht
        // im Kopf hinaus, nicht im Rumpf zurueck.
        error_log('KI-Aufruf fehlgeschlagen (' . ki_fehlergrund() . ', HTTP ' . $httpCode
            . ', curl ' . $curlFehler . '): ' . substr((string)$antwort, 0, 500));
        return null;
    }

    $data = json_decode((string)$antwort, true);
    if (!is_array($data)) {
        ki_fehlergrund('kein_ergebnis');
        return null;
    }
    // Sicherheitsklassifikatoren koennen ablehnen -- das kommt als HTTP 200
    // zurueck, nicht als Fehler.
    if (($data['stop_reason'] ?? '') === 'refusal') {
        ki_fehlergrund('inhalt_abgelehnt');
        return null;
    }
    return $data;
}

// Die Eingabe des erwarteten Werkzeugs aus einer Antwort holen. Fehlt sie,
// hat das Modell geantwortet, aber nichts Brauchbares geliefert -- das ist
// etwas anderes als ein Fehlschlag des Aufrufs und bekommt seinen eigenen
// Grund.
function ki_werkzeug_eingabe(array $data, string $werkzeug): ?array
{
    foreach (($data['content'] ?? []) as $block) {
        if (($block['type'] ?? '') === 'tool_use' && ($block['name'] ?? '') === $werkzeug) {
            return $block['input'] ?? [];
        }
    }
    ki_fehlergrund('kein_ergebnis');
    return null;
}

function anthropic_tool_call(array $tool, string $userContent, int $maxTokens = 512): ?array {
    $data = ki_aufruf([
        'model' => 'claude-haiku-4-5-20251001',
        'max_tokens' => $maxTokens,
        'tools' => [$tool],
        'tool_choice' => ['type' => 'tool', 'name' => $tool['name']],
        'messages' => [
            ['role' => 'user', 'content' => $userContent],
        ],
    ], 20);
    if ($data === null) {
        return null;
    }
    return ki_werkzeug_eingabe($data, $tool['name']);
}

// Kunden-Recherche (ENT-019). Anders als die Funktionen oben: hier darf das
// Modell zuerst im Internet suchen und uebergibt erst danach die Felder.
// Deshalb kein erzwungenes tool_choice (das wuerde die Suche blockieren) und
// eine Schleife statt eines Einzelaufrufs.
//
// Gesucht wird der statutarische Sitz aus dem Handelsregister -- das ist die
// Rechnungsadresse. Der Arbeitsort eines Einsatzes ist etwas anderes und wird
// hier bewusst nicht ermittelt.
function anthropic_recherche_kunde(string $text): ?array
{
    // Seit ENT-044 fuehrt der Kundenstamm PLZ, Ort und Hausnummer getrennt und
    // kennt UID und Webseite. Genau diese Angaben stehen im Handelsregister --
    // die Recherche liefert sie darum gleich mit, statt dass sie hinterher von
    // Hand nachgetragen werden (KI-Effizienz nach ENT-012).
    $felder = ['name', 'strasse', 'hausnummer', 'plz', 'ort', 'telefon', 'email', 'webseite', 'uid'];

    $uebernehmen = [
        'name' => 'kunde_uebernehmen',
        'description' => 'Uebergibt die ermittelten Kundendaten an die Eingabemaske. Genau einmal aufrufen, am Ende.',
        'input_schema' => [
            'type' => 'object',
            'properties' => [
                'name'     => ['type' => 'string', 'description' => 'Offizieller Firmenname inkl. Rechtsform, z.B. "Beispiel AG"'],
                'strasse'  => ['type' => 'string', 'description' => 'Nur der Strassenname des Firmensitzes, OHNE Hausnummer und ohne Ort'],
                'hausnummer' => ['type' => 'string', 'description' => 'Nur die Hausnummer, z.B. "4" oder "12a"'],
                'plz'      => ['type' => 'string', 'description' => 'Nur die vierstellige Postleitzahl, z.B. "4600"'],
                'ort'      => ['type' => 'string', 'description' => 'Nur der Ortsname ohne Postleitzahl, z.B. "Musterdorf"'],
                'telefon'  => ['type' => 'string', 'description' => 'Allgemeine Telefonnummer der Firma'],
                'email'    => ['type' => 'string', 'description' => 'Allgemeine E-Mail-Adresse der Firma'],
                'webseite' => ['type' => 'string', 'description' => 'Adresse der Firmenwebseite, z.B. "https://www.beispiel.ch"'],
                'uid'      => ['type' => 'string', 'description' => 'Schweizer Unternehmens-Identifikationsnummer in der Form CHE-123.456.789. Nur uebernehmen, wenn sie belegt im Handelsregister steht.'],
                'recherchiert' => [
                    'type' => 'array',
                    'items' => ['type' => 'string', 'enum' => $felder],
                    'description' => 'Feldnamen, deren Wert aus dem Internet stammt und nicht vom Benutzer genannt wurde.',
                ],
                'quellen' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                    'description' => 'Die URLs, auf die sich die recherchierten Werte stuetzen. Hoechstens drei.',
                ],
            ],
            'required' => ['name'],
        ],
    ];

    $system =
        "Du ermittelst Stammdaten Schweizer Firmen fuer eine Kundendatei. Die Adresse ist immer der "
        . "statutarische Sitz aus dem Handelsregister (Zefix) -- das ist die Rechnungsadresse.\n\n"
        . "Regeln:\n"
        . "- Erfinde nichts. Ein Feld, das du nicht belegen kannst, laesst du weg. Eine Luecke ist "
        . "richtig, eine plausible Erfindung ist ein Schaden.\n"
        . "- Suche zuerst im Internet, rufe danach kunde_uebernehmen genau einmal auf.\n"
        . "- Uebernimm Angaben, die der Benutzer bereits genannt hat, unveraendert und fuehre sie "
        . "NICHT in 'recherchiert'.\n"
        . "- Findest du mehrere Firmen mit aehnlichem Namen, nimm die, die zum genannten Ort passt. "
        . "Passt keine eindeutig, uebergib nur den Namen und lass den Rest leer.";

    $messages = [['role' => 'user', 'content' => $text]];

    // Hoechstens vier Runden: die Suche laeuft serverseitig, aber lange Laeufe
    // brechen mit stop_reason "pause_turn" ab und muessen erneut angestossen
    // werden.
    for ($runde = 0; $runde < 4; $runde++) {
        $data = ki_aufruf([
            'model' => 'claude-sonnet-5',
            'max_tokens' => 8000,
            'system' => $system,
            'tools' => [
                ['type' => 'web_search_20260209', 'name' => 'web_search', 'max_uses' => 6],
                $uebernehmen,
            ],
            'messages' => $messages,
        ], 120);
        if ($data === null) {
            return null;
        }

        foreach (($data['content'] ?? []) as $block) {
            if (($block['type'] ?? '') === 'tool_use' && ($block['name'] ?? '') === 'kunde_uebernehmen') {
                return $block['input'] ?? [];
            }
        }

        // Lange Suchlaeufe pausieren -- unveraendert erneut anstossen.
        if (($data['stop_reason'] ?? '') === 'pause_turn') {
            $messages[] = ['role' => 'assistant', 'content' => $data['content'] ?? []];
            continue;
        }

        break;
    }

    // Vier Runden ohne Uebergabe: Der Aufruf lief, aber es kam nichts heraus.
    ki_fehlergrund('kein_ergebnis');
    return null;
}

// Zerlegt einen Planungsbefehl der Art "setze die Schliessrunde jeden Tag auf
// den August" (ENT-026). Objekt und Zeitraum kommen aus dem Bildschirm, der
// Satz muss sie nicht nennen -- was gesagt wird, hat aber Vorrang.
function anthropic_extract_masterplan(string $text, array $vorlagen, string $heute, string $monat): ?array
{
    $tool = [
        'name' => 'extract_masterplan',
        'description' => 'Ordnet einem Planungsbefehl Schichtvorlagen und einen Bedarf je Wochentag zu.',
        'input_schema' => [
            'type' => 'object',
            'properties' => [
                'von' => ['type' => 'string', 'description' => 'Beginn des Zeitraums, Format JJJJ-MM-TT. Nur wenn genannt.'],
                'bis' => ['type' => 'string', 'description' => 'Ende des Zeitraums, Format JJJJ-MM-TT. Nur wenn genannt.'],
                'vorlagen' => [
                    'type' => 'array',
                    'description' => 'Die angesprochenen Schichtvorlagen mit dem Bedarf je Wochentag. '
                        . 'Nur Vorlagen aus der Liste. Wird keine bestimmte genannt (z.B. "alle Schichten"), '
                        . 'alle aufnehmen.',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'id' => ['type' => 'integer', 'description' => 'ID aus der Liste der Vorlagen.'],
                            'bedarf_mo' => ['type' => 'integer'],
                            'bedarf_di' => ['type' => 'integer'],
                            'bedarf_mi' => ['type' => 'integer'],
                            'bedarf_do' => ['type' => 'integer'],
                            'bedarf_fr' => ['type' => 'integer'],
                            'bedarf_sa' => ['type' => 'integer'],
                            'bedarf_so' => ['type' => 'integer'],
                            'bedarf_feiertag' => ['type' => 'integer'],
                        ],
                        'required' => ['id'],
                    ],
                ],
            ],
            'required' => ['vorlagen'],
        ],
    ];

    $liste = $vorlagen
        ? implode("\n", array_map(
            fn($v) => "- id {$v['id']}: " . trim(($v['kuerzel'] ? $v['kuerzel'] . ' · ' : '') . $v['name'])
                . ' (' . substr((string)$v['von'], 0, 5) . '–' . substr((string)$v['bis'], 0, 5) . ')',
            $vorlagen))
        : '(keine Vorlagen vorhanden)';

    $userContent =
        "Heutiges Datum: {$heute}. Auf dem Bildschirm steht gerade der Monat {$monat}.\n\n"
        . "Schichtvorlagen dieses Objekts:\n{$liste}\n\n"
        . "Regeln:\n"
        . "- Nur IDs aus der Liste verwenden. Erfinde keine.\n"
        . "- \"jeden Tag\" heisst Bedarf 1 an allen sieben Wochentagen und am Feiertag.\n"
        . "- \"unter der Woche\" heisst Mo bis Fr, Sa und So bleiben 0.\n"
        . "- \"am Wochenende\" heisst Sa und So, Mo bis Fr bleiben 0.\n"
        . "- Wird eine Anzahl genannt (\"mit zwei Leuten\"), gilt sie fuer die genannten Tage.\n"
        . "- Wird kein Zeitraum genannt, von und bis weglassen.\n"
        . "- Ein Wochentag ohne Angabe bekommt 0.\n\n"
        . "Befehl:\n{$text}";

    return anthropic_tool_call($tool, $userContent);
}

// Zerlegt "setze Vito vom 1. bis 15. August auf die Schliessrunde" (ENT-026).
function anthropic_extract_zuteilung(string $text, array $vorlagen, array $mitarbeiter, string $heute, string $monat): ?array
{
    $tool = [
        'name' => 'extract_zuteilung',
        'description' => 'Ordnet einem Befehl Personen, eine Schichtvorlage und einen Zeitraum zu.',
        'input_schema' => [
            'type' => 'object',
            'properties' => [
                'masterschicht_id' => [
                    'type' => 'integer',
                    'description' => 'ID der gemeinten Schichtvorlage aus der Liste. Eine Tageszeit wie '
                        . '"Vormittag" oder "Nachtschicht" ueber die Uhrzeiten zuordnen.',
                ],
                'mitarbeiter_login_namen' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                    'description' => 'Login-Namen der genannten Personen, exakt wie in der Liste.',
                ],
                'von' => ['type' => 'string', 'description' => 'Beginn, Format JJJJ-MM-TT. Nur wenn genannt.'],
                'bis' => ['type' => 'string', 'description' => 'Ende, Format JJJJ-MM-TT. Nur wenn genannt.'],
            ],
            'required' => ['masterschicht_id', 'mitarbeiter_login_namen'],
        ],
    ];

    $liste = $vorlagen
        ? implode("\n", array_map(
            fn($v) => "- id {$v['id']}: " . trim(($v['kuerzel'] ? $v['kuerzel'] . ' · ' : '') . $v['name'])
                . ' (' . substr((string)$v['von'], 0, 5) . '–' . substr((string)$v['bis'], 0, 5) . ')',
            $vorlagen))
        : '(keine Vorlagen vorhanden)';
    $maText = $mitarbeiter
        ? implode("\n", array_map(
            fn($m) => "- {$m['name']}: " . trim(($m['vorname'] ?? '') . ' ' . ($m['nachname'] ?? '')),
            $mitarbeiter))
        : '(keine Mitarbeitenden erfasst)';

    $userContent =
        "Heutiges Datum: {$heute}. Auf dem Bildschirm steht gerade der Monat {$monat}.\n\n"
        . "Schichtvorlagen dieses Objekts:\n{$liste}\n\n"
        . "Bekannte Mitarbeitende (Login-Name: Vorname Nachname):\n{$maText}\n\n"
        . "Regeln:\n"
        . "- Nur IDs und Login-Namen aus den Listen. Erfinde nichts.\n"
        . "- Ein Datum ohne Monat gehoert in den Monat auf dem Bildschirm.\n"
        . "- Wird kein Zeitraum genannt, von und bis weglassen.\n\n"
        . "Befehl:\n{$text}";

    return anthropic_tool_call($tool, $userContent);
}

// ══════════════════════════════════════════ SPRACHEINGABE: KATALOG (ENT-695)
//
// Bis ENT-692 ordnete EIN Werkzeug (route_diktat) den Text einem von drei
// Bereichen zu und fuellte im selben Zug deren Felder. Das Modell musste bei
// jedem Satz alle Felder aller Bereiche kennen, und jeder neue Bereich
// verlaengerte dieselbe Aufzaehlung. Eine diktierte Offerte oeffnete darum
// "Neuer Einsatz": Es gab schlicht keinen passenderen Wert.
//
// Seit ENT-695 zwei Stufen:
//   1. ki_absicht: nur das Anliegen bestimmen (kurz, alle Faehigkeiten).
//   2. ki_felder:  nur die Felder DIESER einen Faehigkeit, mit nur den
//                  Listen, die sie braucht.
// Eine neue Faehigkeit ist ein neuer Eintrag in ki_faehigkeiten() plus ein
// Zweig in ki_felder_auswerten() und in rtDialogOeffnen() -- kein Umbau.
//
// Der Preis: ein zweiter Modellaufruf, spuerbar etwa eine Sekunde. Bewusst
// in Kauf genommen (Entscheid des Projektinhabers, ENT-695); der fruehere
// Kommentar hier ("ein Aufruf statt zwei, damit der Router nicht langsamer
// ist") ist damit ueberholt.
//
// Was sich NICHT aendert: Die Spracheingabe schreibt nichts. Sie oeffnet den
// passenden Dialog vorbefuellt, gespeichert wird per Klick (ENT-015, in
// ENT-695 ausdruecklich bestaetigt).

// Jede Faehigkeit traegt ihr eigenes Recht, geprueft ueber darf(). Vorher
// verlangte der Endpunkt fuer alles einsaetze_schreiben -- wer nur Kunden
// pflegen durfte, kam an die Spracheingabe gar nicht heran.
//
// 'listen' sagt, was Stufe 2 zu sehen bekommt. Nicht mehr als noetig: Jede
// Liste geht an den Anbieter (OP-28).
function ki_faehigkeiten(): array
{
    return [
        'mitarbeiter_neu' => [
            'bereich' => 'mitarbeiter', 'aktion' => 'neu', 'recht' => 'personal_schreiben',
            'titel' => 'Mitarbeitende anlegen',
            'beschreibung' => 'Eine neue Person fuer das Personal erfassen.',
            'listen' => [],
        ],
        'mitarbeiter_aendern' => [
            'bereich' => 'mitarbeiter', 'aktion' => 'aendern', 'recht' => 'personal_schreiben',
            'titel' => 'Mitarbeitende ändern',
            'beschreibung' => 'Angaben einer bereits bekannten Person aendern (Adresse, Telefon ...).',
            'listen' => ['mitarbeiter'],
        ],
        'kunde_neu' => [
            'bereich' => 'kunde', 'aktion' => 'neu', 'recht' => 'kunden_schreiben',
            'titel' => 'Kunden anlegen',
            'beschreibung' => 'Eine neue Firma oder Person fuer die Kundendatei erfassen.',
            'listen' => [],
        ],
        'einsatz_neu' => [
            'bereich' => 'einsatz', 'aktion' => 'neu', 'recht' => 'einsaetze_schreiben',
            'titel' => 'Einsätze anlegen',
            'beschreibung' => 'Einen geplanten Auftrag mit Datum und Zeit, zu dem Personal ausrueckt.',
            'listen' => ['kunden', 'mitarbeiter'],
        ],
        'beleg_neu' => [
            'bereich' => 'beleg', 'aktion' => 'neu', 'recht' => 'offerten_schreiben',
            'titel' => 'Offerten und Rechnungen anlegen',
            'beschreibung' => 'Eine Offerte (Angebot, Kostenvoranschlag) oder eine Rechnung an einen Kunden, '
                . 'mit Leistungen und Mengen. Auch wenn ein Datum genannt wird: eine Offerte ist KEIN Einsatz.',
            'listen' => ['kunden', 'produkte'],
        ],
    ];
}

// ── Stufe 1: das Anliegen
function anthropic_ki_absicht(string $text): ?array
{
    $f = ki_faehigkeiten();
    $katalog = implode("\n", array_map(fn($k, $v) => "- {$k}: {$v['beschreibung']}", array_keys($f), $f));
    $tool = [
        'name' => 'absicht_erkennen',
        'description' => 'Bestimmt, welches Anliegen ein diktierter oder getippter Text hat.',
        'input_schema' => [
            'type' => 'object',
            'properties' => [
                // "anderes" und "unklar" sind zwei Aussagen (ENT-692):
                // verstanden, aber nicht abgedeckt -- und nicht verstanden.
                'absicht' => ['type' => 'string', 'enum' => array_merge(array_keys($f), ['anderes', 'unklar'])],
                'anliegen' => [
                    'type' => 'string',
                    'description' => 'Was der Text verlangt, in zwei bis vier Worten, z.B. "Offerte erstellen" '
                        . 'oder "Planung oeffnen". Immer ausfuellen, ausser bei unklar.',
                ],
            ],
            'required' => ['absicht'],
        ],
    ];
    $userContent = "Moegliche Anliegen:\n{$katalog}\n"
        . "- anderes: verstaendlich, aber keines der obigen (z.B. eine Seite oeffnen, eine Auswertung).\n"
        . "- unklar: der Text laesst sich keinem Anliegen zuordnen.\n\n"
        . "Waehle genau ein Anliegen. Im Zweifel anderes oder unklar statt einer erzwungenen Zuordnung.\n\n"
        . "Text:\n{$text}";
    return anthropic_tool_call($tool, $userContent);
}

// ── Stufe 2: die Felder einer Faehigkeit
function ki_felder_schema(string $key): array
{
    $person = [
        'anrede' => ['type' => 'string', 'enum' => ['Herr', 'Frau', 'Divers']],
        'vorname' => ['type' => 'string'], 'nachname' => ['type' => 'string'],
        'geburtsdatum' => ['type' => 'string', 'description' => 'Format JJJJ-MM-TT'],
        'strasse' => ['type' => 'string'], 'ort' => ['type' => 'string'],
        'telefon' => ['type' => 'string'], 'mobil' => ['type' => 'string'],
        'email' => ['type' => 'string'],
    ];
    // Keine personalnummer: seit ENT-387 automatisch vergeben und nicht
    // aenderbar -- die Angabe weckte nur eine Erwartung.
    switch ($key) {
        case 'mitarbeiter_neu':
            return $person;
        case 'mitarbeiter_aendern':
            return [
                'mitarbeiter_login_name' => [
                    'type' => 'string',
                    'description' => 'Login-Name der gemeinten Person, exakt wie in der Liste, auch wenn der Text '
                        . 'einen Tippfehler oder eine Umschreibung enthaelt.',
                ],
                'aenderungen' => [
                    'type' => 'object',
                    'description' => 'Nur die tatsaechlich im Text genannten Felder.',
                    'properties' => $person,
                ],
            ];
        case 'kunde_neu':
            // PLZ und Ort getrennt seit ENT-044.
            return [
                'name' => ['type' => 'string'], 'strasse' => ['type' => 'string'],
                'hausnummer' => ['type' => 'string'],
                'plz' => ['type' => 'string', 'description' => 'Nur die vierstellige Postleitzahl.'],
                'ort' => ['type' => 'string', 'description' => 'Nur der Ortsname, ohne Postleitzahl.'],
                'telefon' => ['type' => 'string'], 'email' => ['type' => 'string'],
            ];
        case 'einsatz_neu':
            return [
                'kunde_name' => ['type' => 'string', 'description' => 'Steht er in der Kundenliste, exakt so schreiben wie dort.'],
                'titel' => ['type' => 'string'], 'strasse' => ['type' => 'string'],
                'ort' => ['type' => 'string', 'description' => 'PLZ und Ort des Arbeitsortes.'],
                'datum' => ['type' => 'string', 'description' => 'Format JJJJ-MM-TT'],
                'von' => ['type' => 'string', 'description' => 'Format HH:MM'],
                'bis' => ['type' => 'string', 'description' => 'Format HH:MM'],
                'bedarf' => ['type' => 'integer'],
                'einsatzart' => ['type' => 'string'],
                'mitarbeiter_login_namen' => ['type' => 'array', 'items' => ['type' => 'string']],
                'bemerkung' => ['type' => 'string'],
            ];
        case 'beleg_neu':
            // Keine Preise: Ein Preis kommt aus dem Leistungskatalog oder von
            // Hand, nie aus einem Diktat. Ein verhoerter Betrag auf einer
            // Offerte ist teurer als ein leeres Feld.
            return [
                'art' => ['type' => 'string', 'enum' => ['offerte', 'rechnung'],
                    'description' => 'rechnung nur, wenn ausdruecklich eine Rechnung verlangt ist.'],
                'kunde_name' => ['type' => 'string', 'description' => 'Steht er in der Kundenliste, exakt so schreiben wie dort.'],
                'titel' => ['type' => 'string', 'description' => 'Kurzer Betreff, nur wenn im Text erkennbar.'],
                'bemerkung' => ['type' => 'string', 'description' => 'Weitere Angaben wie Einsatzdatum oder -ort, nur wenn genannt.'],
                'positionen' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'produkt_id' => ['type' => 'integer',
                                'description' => 'ID aus dem Leistungskatalog, nur wenn die Leistung eindeutig passt. Sonst weglassen.'],
                            'leistung' => ['type' => 'string', 'description' => 'Die Leistung, wie sie gesagt wurde.'],
                            'menge' => ['type' => 'number'],
                            'einheit' => ['type' => 'string', 'description' => 'z.B. Std., Stk., Tag -- nur wenn genannt.'],
                        ],
                        'required' => ['leistung'],
                    ],
                ],
            ];
    }
    return [];
}

// $listen: ['kunden' => [['id','name'],...], 'mitarbeiter' => [['name','vorname','nachname'],...],
//           'produkte' => [['id','name','einheit'],...]] -- nur, was die Faehigkeit braucht.
function anthropic_ki_felder(string $key, string $text, array $listen, string $heute): ?array
{
    $teile = ["Heutiges Datum: {$heute}."];
    if (isset($listen['kunden'])) {
        $teile[] = "Bekannte Kunden:\n" . ($listen['kunden']
            ? implode("\n", array_map(fn($k) => '- ' . $k['name'], $listen['kunden'])) : '(keine Kunden erfasst)');
    }
    if (isset($listen['mitarbeiter'])) {
        $teile[] = "Bekannte Mitarbeitende (Login-Name: Vorname Nachname):\n" . ($listen['mitarbeiter']
            ? implode("\n", array_map(fn($m) => "- {$m['name']}: " . trim(($m['vorname'] ?? '') . ' ' . ($m['nachname'] ?? '')), $listen['mitarbeiter']))
            : '(keine Mitarbeitenden erfasst)');
    }
    if (isset($listen['produkte'])) {
        $teile[] = "Leistungskatalog (ID: Name, Einheit):\n" . ($listen['produkte']
            ? implode("\n", array_map(fn($p) => "- {$p['id']}: {$p['name']}, " . ($p['einheit'] ?? ''), $listen['produkte']))
            : '(kein Katalog verfuegbar -- produkt_id immer weglassen)');
    }
    $teile[] = "Fuelle nur die Felder, die im Text vorkommen. Erfinde nichts. Schreibe nie einen Platzhalter "
        . "wie <UNKNOWN>, unbekannt oder n/a in ein Feld -- lass es weg.";
    $teile[] = "Text:\n{$text}";

    $tool = [
        'name' => 'felder_' . $key,
        'description' => 'Extrahiert die Felder fuer: ' . (ki_faehigkeiten()[$key]['titel'] ?? $key) . '.',
        'input_schema' => ['type' => 'object', 'properties' => ki_felder_schema($key)],
    ];
    return anthropic_tool_call($tool, implode("\n\n", $teile), $key === 'beleg_neu' ? 1024 : 512);
}

// ══════════════════════════════════════════ AUSWERTEN (ENT-692/693)
//
// Rein, ohne Netz und Datenbank -- damit pruef_ki.php jeden Zweig pruefen
// kann, nicht nur den einen, den eine Umgebung ohne Schluessel herstellt.

// Ein Wert, der "weiss ich nicht" sagt, ist kein Wert. Das Modell hat
// "<UNKNOWN>" als Kundennamen geliefert (Bildschirmfoto vom 2026-09-23); die
// Oberflaeche markierte es blau als erkannt. Unbekannt sah damit aus wie ein
// Kunde -- die Umkehrung der Regel "unbekannt darf nie wie keine aussehen".
function ki_platzhalter(string $wert): bool
{
    $w = mb_strtolower(trim($wert));
    if ($w === '') {
        return true;
    }
    if (preg_match('/^[<\[{(].*[>\]})]$/u', $w)) {
        return true;   // <UNKNOWN>, [unbekannt], {name} ...
    }
    return in_array($w, [
        'unknown', 'unbekannt', 'n/a', 'na', 'n.a.', 'null', 'none', 'undefined', 'tbd', 'k.a.',
        'keine angabe', 'nicht angegeben', 'nicht bekannt', 'nicht genannt', '-', '--', '—', '?', '??', '...', '…',
    ], true);
}

// Leere und Platzhalter-Werte weg. Alle Felder sind flach, ausser
// Login-Namen und Positionen (je eigene Pruefung).
function ki_felder_saeubern(array $roh, array $erlaubt): array
{
    $felder = [];
    foreach ($erlaubt as $f) {
        if (!array_key_exists($f, $roh) || is_array($roh[$f])) {
            continue;
        }
        $wert = trim((string)$roh[$f]);
        if (!ki_platzhalter($wert)) {
            $felder[$f] = $wert;
        }
    }
    return $felder;
}

// Stufe 1 auswerten. Gibt [Code, Antwort, null] zurueck, wenn es hier endet,
// oder [200, null, Faehigkeit], wenn Stufe 2 folgt.
//
// Drei Arten, nicht weiterzukommen, und drei Saetze dafuer: nicht verstanden,
// verstanden aber nicht abgedeckt, abgedeckt aber keine Berechtigung. Die
// dritte Art pruefen wir NACH der Erkennung und nicht, indem wir dem Modell
// nur die erlaubten Faehigkeiten zeigen -- sonst saehe "kein Recht" aus wie
// "kann die Spracheingabe nicht", und jemand suchte den Fehler am falschen
// Ort.
function ki_absicht_pruefen(array $a, callable $darf): array
{
    $katalog = ki_faehigkeiten();
    $absicht = (string)($a['absicht'] ?? '');
    $anliegen = trim((string)($a['anliegen'] ?? ''));
    $anliegen = ki_platzhalter($anliegen) ? '' : mb_substr($anliegen, 0, 60);
    $verstanden = $anliegen !== '' ? "Verstanden: „{$anliegen}“. " : '';

    if ($absicht === 'anderes') {
        $koennen = implode(', ', array_map(fn($f) => $f['titel'], $katalog));
        return [422, [
            'status' => 'error', 'grund' => 'nicht_abgedeckt', 'anliegen' => $anliegen,
            'message' => ($verstanden ?: 'Verstanden, aber: ')
                . "Das kann die Spracheingabe noch nicht. Möglich sind heute: {$koennen}. Es wurde nichts geöffnet.",
        ], null];
    }
    if (!isset($katalog[$absicht])) {
        return [422, [
            'status' => 'error', 'grund' => 'unklar',
            'message' => 'Der Text liess sich keinem Anliegen zuordnen. Bitte etwas genauer sagen, '
                . 'z. B. „Neuer Kunde …“, „Offerte für … über …“ oder „Neuer Einsatz für … am …“.',
        ], null];
    }
    $f = $katalog[$absicht];
    if (!$darf($f['recht'])) {
        return [403, [
            'status' => 'error', 'grund' => 'kein_recht', 'recht' => $f['recht'], 'anliegen' => $anliegen,
            'message' => $verstanden . "Für „{$f['titel']}“ fehlt dir die Berechtigung. Es wurde nichts geöffnet.",
        ], null];
    }
    return [200, null, $absicht];
}

// Stufe 2 auswerten. $listen wie bei anthropic_ki_felder(), aber mit IDs.
function ki_felder_auswerten(string $key, array $e, array $listen): array
{
    $katalog = ki_faehigkeiten();
    $mitFelder = ['anrede', 'vorname', 'nachname', 'geburtsdatum', 'strasse', 'ort', 'telefon', 'mobil', 'email'];
    $maLogin = array_map('strval', array_column($listen['mitarbeiter'] ?? [], 'name'));
    $basis = ['status' => 'ok', 'faehigkeit' => $key,
        'bereich' => $katalog[$key]['bereich'] ?? '', 'aktion' => $katalog[$key]['aktion'] ?? 'neu'];

    switch ($key) {
        case 'mitarbeiter_aendern':
            $loginName = trim((string)($e['mitarbeiter_login_name'] ?? ''));
            // Die KI soll nur zuordnen, nie einen Namen erfinden.
            if ($loginName === '' || !in_array($loginName, $maLogin, true)) {
                return [422, ['status' => 'error', 'grund' => 'person_unklar',
                    'message' => 'Die gemeinte Person liess sich nicht eindeutig zuordnen -- bitte im Mitarbeitenden-Bereich direkt diktieren.']];
            }
            return [200, $basis + ['mitarbeiter_login_name' => $loginName,
                'aenderungen' => ki_felder_saeubern(is_array($e['aenderungen'] ?? null) ? $e['aenderungen'] : [], $mitFelder)]];

        case 'mitarbeiter_neu':
            return [200, $basis + ['felder' => ki_felder_saeubern($e, $mitFelder)]];

        case 'kunde_neu':
            return [200, $basis + ['felder' => ki_felder_saeubern($e,
                ['name', 'strasse', 'hausnummer', 'plz', 'ort', 'telefon', 'email'])]];

        case 'einsatz_neu':
            $felder = ki_felder_saeubern($e,
                ['kunde_name', 'titel', 'strasse', 'ort', 'datum', 'von', 'bis', 'einsatzart', 'bemerkung']);
            if (isset($e['bedarf']) && is_numeric($e['bedarf']) && (int)$e['bedarf'] > 0) {
                $felder['bedarf'] = min(99, (int)$e['bedarf']);
            }
            // Nur bekannte Login-Namen duerfen als Zuteilung in die Oberflaeche.
            $namen = is_array($e['mitarbeiter_login_namen'] ?? null) ? $e['mitarbeiter_login_namen'] : [];
            $maNamen = array_values(array_intersect(array_map('strval', array_filter($namen, 'is_scalar')), $maLogin));
            return [200, $basis + ['felder' => $felder, 'mitarbeiter_login_namen' => $maNamen]];

        case 'beleg_neu':
            $art = ($e['art'] ?? '') === 'rechnung' ? 'rechnung' : 'offerte';
            $felder = ki_felder_saeubern($e, ['titel', 'bemerkung']);

            // Kunde gegen die echte Liste. Nicht gefunden heisst: Name
            // zurueckgeben, id null -- die Oberflaeche markiert ihn orange
            // und bietet "Neue Adresse erstellen" an. Nichts wird still
            // angelegt (ENT-695).
            $kunde = null;
            $kName = trim((string)($e['kunde_name'] ?? ''));
            if (!ki_platzhalter($kName)) {
                $kunde = ['id' => null, 'name' => $kName];
                foreach ($listen['kunden'] ?? [] as $k) {
                    if (mb_strtolower(trim((string)$k['name'])) === mb_strtolower($kName)) {
                        $kunde = ['id' => (int)$k['id'], 'name' => (string)$k['name']];
                        break;
                    }
                }
            }

            // Positionen: eine produkt_id zaehlt nur, wenn es sie im Katalog
            // gibt. Alles andere wird eine Freitextzeile mit dem gesagten
            // Text -- nie ein erfundenes Produkt, nie ein Preis.
            $produkte = [];
            foreach ($listen['produkte'] ?? [] as $p) {
                $produkte[(int)$p['id']] = $p;
            }
            $positionen = [];
            foreach ((is_array($e['positionen'] ?? null) ? $e['positionen'] : []) as $roh) {
                if (!is_array($roh) || count($positionen) >= 30) {
                    continue;
                }
                $leistung = trim((string)($roh['leistung'] ?? ''));
                $pid = isset($roh['produkt_id']) && is_numeric($roh['produkt_id']) ? (int)$roh['produkt_id'] : 0;
                $treffer = $produkte[$pid] ?? null;
                if ($treffer === null && ki_platzhalter($leistung)) {
                    continue;   // weder Katalog noch Text: nichts, was man pruefen koennte
                }
                $menge = isset($roh['menge']) && is_numeric($roh['menge']) ? (float)$roh['menge'] : 1.0;
                $menge = ($menge > 0 && $menge <= 100000) ? round($menge, 2) : 1.0;
                $einheit = trim((string)($roh['einheit'] ?? ''));
                $positionen[] = [
                    'produkt_id' => $treffer ? (int)$treffer['id'] : null,
                    'produkt_name' => $treffer ? (string)$treffer['name'] : mb_substr($leistung, 0, 200),
                    'gesagt' => ki_platzhalter($leistung) ? '' : mb_substr($leistung, 0, 200),
                    'menge' => $menge,
                    'einheit' => ki_platzhalter($einheit) ? '' : mb_substr($einheit, 0, 20),
                ];
            }
            return [200, $basis + ['art' => $art, 'felder' => $felder, 'kunde' => $kunde, 'positionen' => $positionen]];
    }
    return [422, ['status' => 'error', 'grund' => 'unklar', 'message' => 'Unbekannte Fähigkeit.']];
}

// Liest einen Einsatz aus einem Bild (Screenshot einer E-Mail, eines Auftrags-
// zettels o.ae.) heraus (ENT-032). Fuer Bilder wird das staerkere Modell
// verwendet -- Text in einem Foto zuverlaessig zu lesen ist schwerer als
// einen bereits sauberen Satz zu zerlegen.
function anthropic_extract_einsatz_bild(string $bildBase64, string $mimeType, array $kunden, array $mitarbeiter, string $heute): ?array
{
    $tool = [
        'name' => 'extract_einsatz_bild',
        'description' => 'Extrahiert einen geplanten Einsatz aus einem Bild.',
        'input_schema' => [
            'type' => 'object',
            'properties' => [
                'kunde_name' => ['type' => 'string', 'description' => 'Steht er in der Kundenliste, exakt so schreiben wie dort.'],
                'titel' => ['type' => 'string'],
                'strasse' => ['type' => 'string', 'description' => 'Strasse des ARBEITSORTES, nicht der Firmensitz.'],
                'ort' => ['type' => 'string', 'description' => 'PLZ und Ort des ARBEITSORTES.'],
                'datum' => ['type' => 'string', 'description' => 'Format JJJJ-MM-TT'],
                'von' => ['type' => 'string', 'description' => 'Format HH:MM'],
                'bis' => ['type' => 'string', 'description' => 'Format HH:MM'],
                'bedarf' => ['type' => 'integer'],
                'einsatzart' => ['type' => 'string'],
                'mitarbeiter_login_namen' => ['type' => 'array', 'items' => ['type' => 'string']],
                'bemerkung' => ['type' => 'string', 'description' => 'Zusatzangaben, die in kein anderes Feld passen.'],
                'unsicher' => [
                    'type' => 'boolean',
                    'description' => 'true, wenn das Bild keinen erkennbaren Auftrag zeigt oder wesentliche Angaben fehlen.',
                ],
            ],
        ],
    ];

    $kundenText = $kunden ? implode("\n", array_map(fn($k) => '- ' . $k, $kunden)) : '(keine Kunden erfasst)';
    $maText = $mitarbeiter
        ? implode("\n", array_map(fn($m) => "- {$m['name']}: " . trim(($m['vorname'] ?? '') . ' ' . ($m['nachname'] ?? '')), $mitarbeiter))
        : '(keine Mitarbeitenden erfasst)';
    $system =
        "Heutiges Datum: {$heute}. Relative Angaben (\"morgen\", \"naechsten Montag\") darauf beziehen.\n\n"
        . "Bekannte Kunden:\n{$kundenText}\n\nBekannte Mitarbeitende (Login-Name: Vorname Nachname):\n{$maText}\n\n"
        . "Das Bild zeigt vermutlich eine E-Mail, eine Nachricht oder einen Auftragszettel eines Kunden. "
        . "Lies daraus einen geplanten Einsatz heraus. Erfinde nichts -- ein Feld, das nicht eindeutig "
        . "aus dem Bild hervorgeht, laesst du weg. Ist kein Auftrag erkennbar, setze unsicher auf true "
        . "und fuelle so viel wie moeglich trotzdem aus.";

    // max_tokens deckt bei diesem Modell auch das Nachdenken ab: Sonnet 5
    // denkt standardmaessig adaptiv, und diese Token zaehlen mit. Mit den
    // frueheren 1024 konnte die Antwort mitten in der Feldliste abbrechen --
    // das Ergebnis waere dann nicht "Fehler", sondern eine STILL unvollstaendig
    // ausgefuellte Maske gewesen, und das faellt erst beim Speichern auf.
    $data = ki_aufruf([
        'model' => 'claude-sonnet-5',
        'max_tokens' => 4096,
        'system' => $system,
        'tools' => [$tool],
        'tool_choice' => ['type' => 'tool', 'name' => 'extract_einsatz_bild'],
        'messages' => [[
            'role' => 'user',
            'content' => [
                ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $mimeType, 'data' => $bildBase64]],
                ['type' => 'text', 'text' => 'Lies den Auftrag aus diesem Bild.'],
            ],
        ]],
    ], 45);
    if ($data === null) {
        return null;
    }
    return ki_werkzeug_eingabe($data, 'extract_einsatz_bild');
}

// ══════════════════════════════════════════ ASSISTENT (ENT-699, nur Testumgebung)
//
// Die Spracheingabe (ENT-695) fuellt Formulare vor. Der Assistent sieht nach
// und antwortet: "Was haben Kunden seit gestern angenommen?", "Wo fehlen
// diese Woche noch Leute?", "Wer kann Samstag 18 bis 23 Uhr?", "Welche
// Rechnungen sind ueberfaellig?".
//
// WO DIE WERKZEUGE LAUFEN: im Browser, nicht hier. Belegung (zaehltAlsBesetzt),
// Konflikte (konflikte), Ruhezeit (ruheLuecken), Sperren (gesperrtAm) und
// Faelligkeit (reFaelligTage) rechnet das Cockpit heute ausschliesslich im
// Browser. Eine zweite Fassung hier liefe frueher oder spaeter auseinander,
// und der Assistent sagte dann etwas anderes als der Bildschirm daneben. Die
// Werkzeuge rufen darum dieselben Funktionen auf, auf Daten, die ueber die
// bestehenden, rechtegeprueften Endpunkte geladen sind. Das Modell sieht
// damit nie mehr, als die Person selbst sehen darf.
//
// Dieser Server reicht das Gespraech nur weiter: Er prueft Form und Umfang
// der Nachrichten, haengt Systemtext und Werkzeugliste an und gibt die
// Antwort des Modells zurueck. Gefaelschte Werkzeugergebnisse aus dem
// Browser koennen nur die eigene Antwort verfaelschen -- der Assistent
// schreibt nichts.
//
// Nur ausserhalb von Produktion und Demo (Entscheid des Projektinhabers:
// zuerst auf test.guardops.ch). Die Sperre steht hier im Server; dass die
// Figur in Produktion gar nicht erscheint, erspart nur den Umweg.

// Derselbe exakte Vergleich wie umgebung_ist_produktion() in db.php, hier
// eigenstaendig, weil ai.php db.php nicht einbindet (pruef_ki.php laedt nur
// diese Datei). Fail-safe in dieselbe Richtung wie dort: Nur das exakte
// "production" gilt als Produktion -- ein unersetzter Platzhalter oeffnet
// den Assistenten also, statt ihn in einer Testumgebung zu verstecken. Das
// ist hier vertretbar, weil Produktion den Wert beim Deploy zwingend bekommt.
function ki_assistent_erlaubt(string $umgebung): bool
{
    return $umgebung !== 'production' && $umgebung !== 'demo';
}

// Name => Beschreibung und Eingaben. Das Recht steht dabei, damit Systemtext,
// Oberflaeche und Pruefung dieselbe Liste lesen; geprueft wird es von den
// Endpunkten, die das Werkzeug im Browser aufruft.
function ki_assistent_werkzeuge(): array
{
    $datum = ['type' => 'string', 'description' => 'Format JJJJ-MM-TT'];
    $zeit = ['type' => 'string', 'description' => 'Format HH:MM'];
    return [
        'offerten_entscheide' => [
            'recht' => 'offerten_lesen',
            'titel' => 'Offertenentscheide der Kunden',
            'description' => 'Offerten, ueber die ein Kunde am Link entschieden hat (angenommen oder abgelehnt), mit '
                . 'Zeitpunkt und ob der Entscheid im Cockpit schon angesehen wurde. Interne Statuswechsel '
                . 'beantwortet dieses Werkzeug nicht.',
            'input_schema' => ['type' => 'object', 'properties' => [
                'seit' => $datum + ['description' => 'Nur Entscheide ab diesem Tag, Format JJJJ-MM-TT. Weglassen = alle.'],
                'nur_ungesehen' => ['type' => 'boolean', 'description' => 'Nur Entscheide, die im Cockpit noch nicht angesehen wurden.'],
            ]],
        ],
        'offene_plaetze' => [
            'recht' => 'einsaetze_lesen',
            'titel' => 'Einsätze mit offenen Plätzen',
            'description' => 'Einsaetze in einem Zeitraum, bei denen weniger Personen zugesagt oder zugeteilt sind als '
                . 'benoetigt. Abgesagte Einsaetze zaehlen nicht, abgelehnte Zusagen besetzen keinen Platz.',
            'input_schema' => ['type' => 'object', 'properties' => ['von' => $datum, 'bis' => $datum], 'required' => ['von', 'bis']],
        ],
        'verfuegbare_mitarbeitende' => [
            'recht' => 'einsaetze_lesen',
            'titel' => 'Wer ist verfügbar',
            'description' => 'Aktive Mitarbeitende fuer ein Zeitfenster, eingeteilt in verfuegbar, mit Einschraenkung '
                . '(Ruhezeit-Hinweis, selbst gesperrter Tag, beantragte Abwesenheit) und nicht verfuegbar (schon '
                . 'eingeteilt, bewilligte Abwesenheit).',
            'input_schema' => ['type' => 'object', 'properties' => ['datum' => $datum, 'von' => $zeit, 'bis' => $zeit],
                'required' => ['datum', 'von', 'bis']],
        ],
        // Die beiden Formular-Werkzeuge (ENT-700) schreiben nichts: Sie oeffnen
        // ein vorbefuelltes Formular bzw. aendern ein offenes, gespeichert
        // wird per Klick (ENT-015). Ihr Recht haengt an der Faehigkeit, die
        // die Spracheingabe erkennt (ki_faehigkeiten(), ENT-695) -- darum
        // hier kein festes Recht, geprueft wird in ki_router_parse.php.
        'formular_vorbereiten' => [
            'recht' => null,
            'titel' => 'Offerten, Rechnungen, Einsätze, Kunden und Mitarbeitende vorbereiten',
            'description' => 'Oeffnet ein vorbefuelltes Formular zum Anlegen einer Offerte, Rechnung, eines Einsatzes, '
                . 'Kunden oder Mitarbeitenden, oder zum Aendern von Angaben einer bekannten Person. Nichts wird '
                . 'gespeichert; die Person prueft und speichert selbst. auftrag ist der vollstaendige Auftrag in einem '
                . 'Satz, mit allen genannten Angaben (Kunde, Leistungen, Mengen, Datum, Zeit ...).',
            'input_schema' => ['type' => 'object', 'properties' => [
                'auftrag' => ['type' => 'string', 'description' => 'z.B. "Offerte fuer die Beispiel AG ueber 16 Stunden Verkehrsdienst"'],
            ], 'required' => ['auftrag']],
        ],
        'formular_ergaenzen' => [
            'recht' => null,
            'titel' => 'Ein vorbereitetes Formular ergänzen',
            'description' => 'Aendert das Formular, das formular_vorbereiten gerade geoeffnet hat: bei Offerte oder '
                . 'Rechnung Empfaenger, Titel, Bemerkung und Positionen (hinzufuegen, Menge aendern, entfernen), '
                . 'beim Einsatz Datum, Zeiten, Anzahl, Ort, Strasse, Bezeichnung und Bemerkung. Nie Preise. Nur '
                . 'nennen, was sich aendern soll.',
            'input_schema' => ['type' => 'object', 'properties' => [
                'kunde_name' => ['type' => 'string'], 'titel' => ['type' => 'string'], 'bemerkung' => ['type' => 'string'],
                'positionen_hinzu' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                    'leistung' => ['type' => 'string', 'description' => 'Name wie im Leistungskatalog, falls bekannt.'],
                    'menge' => ['type' => 'number'], 'einheit' => ['type' => 'string']], 'required' => ['leistung']]],
                'positionen_menge' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                    'nr' => ['type' => 'integer', 'description' => 'Positionsnummer, ab 1'], 'menge' => ['type' => 'number']],
                    'required' => ['nr', 'menge']]],
                'positionen_entfernen' => ['type' => 'array', 'items' => ['type' => 'integer'], 'description' => 'Positionsnummern, ab 1'],
                'datum' => $datum, 'von' => $zeit, 'bis' => $zeit, 'bedarf' => ['type' => 'integer'],
                'ort' => ['type' => 'string'], 'strasse' => ['type' => 'string'],
            ]],
        ],
        'offene_rechnungen' => [
            'recht' => 'offerten_lesen',
            'titel' => 'Offene Rechnungen',
            'description' => 'Versendete, noch nicht bezahlte Rechnungen mit Faelligkeit. Entwuerfe zaehlen nicht als offen, '
                . 'werden aber gezaehlt.',
            'input_schema' => ['type' => 'object', 'properties' => [
                'nur_ueberfaellig' => ['type' => 'boolean', 'description' => 'Nur Rechnungen, deren Frist abgelaufen ist.'],
            ]],
        ],
    ];
}

function ki_assistent_system(string $heute): string
{
    $tage = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    $ts = strtotime($heute . ' 12:00:00');
    $wochentag = $ts ? $tage[(int)date('w', $ts)] : '';
    $koennen = implode(', ', array_map(fn($w) => $w['titel'], ki_assistent_werkzeuge()));
    return "Du bist der Assistent von GuardOpS, einer Software fuer Sicherheitsdienste, und sprichst mit einer "
        . "Person aus der Einsatzplanung. Heute ist {$wochentag}, {$heute}.\n\n"
        . "Antworte auf Deutsch in Schweizer Rechtschreibung (kein scharfes S), in du-Form, kurz und zum Vorlesen "
        . "geeignet: hoechstens drei Saetze, keine Aufzaehlungszeichen, keine Tabellen, kein Markdown. Die Einzelheiten "
        . "zeigt die Oberflaeche als Trefferliste unter deiner Antwort; wiederhole sie nicht vollstaendig.\n\n"
        . "Regeln, ohne Ausnahme:\n"
        . "- Zahlen, Namen, Daten und Betraege nur aus Werkzeugergebnissen. Nie schaetzen, nie ergaenzen.\n"
        . "- Meldet ein Werkzeug kein_recht, sag, dass dafuer die Berechtigung fehlt. Meldet es fehler, sag, dass die "
        . "Auskunft gerade nicht verfuegbar ist. Beides ist etwas anderes als 'keine'.\n"
        . "- Steht in einem Ergebnis ein hinweis (zum Beispiel, dass etwas nicht beruecksichtigt ist), gib ihn weiter.\n"
        . "- Offene Plaetze und Einsaetze sind verschiedene Einheiten: nenne beide getrennt, nie das eine als das andere.\n"
        . "- Ruhezeit-Hinweise gibst du so weiter, wie sie im Ergebnis stehen. Du legst den GAV nicht aus.\n"
        . "- Soll etwas angelegt oder eine Person geaendert werden, rufe formular_vorbereiten mit dem ganzen Auftrag "
        . "auf. Danach sagst du kurz, was uebernommen wurde und was noch offen ist, und dass die Person pruefen und "
        . "speichern muss. Weitere Angaben dazu gehen mit formular_ergaenzen ins offene Formular.\n"
        . "- Du selbst speicherst, versendest und loeschst nie etwas, und du setzt nie Preise. Wirst du darum gebeten, "
        . "sag das.\n"
        . "- Rechne relative Angaben (morgen, Samstag, diese Woche) selbst in Daten um.\n"
        . "- Passt keine Frage zu deinen Werkzeugen, sag, was du heute beantworten kannst: {$koennen}.";
}

// Form und Umfang der Nachrichten aus dem Browser. Gibt die bereinigte
// Liste zurueck, oder [] wenn sie nicht taugt. Rein, ohne Netz.
function ki_assistent_nachrichten_pruefen($roh): array
{
    if (!is_array($roh) || $roh === [] || count($roh) > 40) {
        return [];
    }
    $werkzeuge = ki_assistent_werkzeuge();
    $aus = [];
    foreach (array_values($roh) as $i => $n) {
        $rolle = is_array($n) ? ($n['role'] ?? '') : '';
        if (!in_array($rolle, ['user', 'assistant'], true) || ($i === 0 && $rolle !== 'user')) {
            return [];
        }
        $inhalt = $n['content'] ?? null;
        if (is_string($inhalt)) {
            $t = trim($inhalt);
            if ($t === '' || mb_strlen($t) > 2000) { return []; }
            $aus[] = ['role' => $rolle, 'content' => $t];
            continue;
        }
        if (!is_array($inhalt) || $inhalt === [] || count($inhalt) > 10) {
            return [];
        }
        $bloecke = [];
        foreach ($inhalt as $b) {
            $typ = is_array($b) ? ($b['type'] ?? '') : '';
            if ($typ === 'text' && is_string($b['text'] ?? null) && mb_strlen($b['text']) <= 4000) {
                $bloecke[] = ['type' => 'text', 'text' => $b['text']];
            } elseif ($typ === 'tool_use' && $rolle === 'assistant' && isset($werkzeuge[$b['name'] ?? ''])
                && is_string($b['id'] ?? null) && preg_match('/^[A-Za-z0-9_-]{1,100}$/', $b['id'])) {
                $bloecke[] = ['type' => 'tool_use', 'id' => $b['id'], 'name' => $b['name'],
                    'input' => (object)(is_array($b['input'] ?? null) ? $b['input'] : [])];
            } elseif ($typ === 'tool_result' && $rolle === 'user' && is_string($b['tool_use_id'] ?? null)
                && preg_match('/^[A-Za-z0-9_-]{1,100}$/', $b['tool_use_id'])
                && is_string($b['content'] ?? null) && strlen($b['content']) <= 30000) {
                $bloecke[] = ['type' => 'tool_result', 'tool_use_id' => $b['tool_use_id'], 'content' => $b['content']];
            } else {
                return [];
            }
        }
        $aus[] = ['role' => $rolle, 'content' => $bloecke];
    }
    // Das Modell antwortet nur auf eine Nachricht der Person (Text oder
    // Werkzeugergebnis), nie auf seine eigene.
    if (end($aus)['role'] !== 'user' || strlen((string)json_encode($aus)) > 150000) {
        return [];
    }
    return $aus;
}

// Nur Text und Werkzeugaufrufe gehen zurueck in den Browser.
function ki_assistent_antwort_filtern(array $data): array
{
    $werkzeuge = ki_assistent_werkzeuge();
    $bloecke = [];
    foreach (($data['content'] ?? []) as $b) {
        if (($b['type'] ?? '') === 'text') {
            $bloecke[] = ['type' => 'text', 'text' => (string)($b['text'] ?? '')];
        } elseif (($b['type'] ?? '') === 'tool_use' && isset($werkzeuge[$b['name'] ?? ''])) {
            $bloecke[] = ['type' => 'tool_use', 'id' => (string)$b['id'], 'name' => (string)$b['name'],
                'input' => $b['input'] ?? new stdClass()];
        }
    }
    return ['content' => $bloecke, 'stop_reason' => (string)($data['stop_reason'] ?? '')];
}

function anthropic_assistent(array $nachrichten, string $heute): ?array
{
    $tools = [];
    foreach (ki_assistent_werkzeuge() as $name => $w) {
        $tools[] = ['name' => $name, 'description' => $w['description'], 'input_schema' => $w['input_schema']];
    }
    // Sonnet statt Haiku (Entscheid des Projektinhabers, ENT-699): Hier waehlt
    // das Modell Werkzeuge selbst und fasst zusammen; das kleine Modell tut
    // das bei zusammengesetzten Fragen weniger verlaesslich.
    $data = ki_aufruf([
        'model' => 'claude-sonnet-5',
        'max_tokens' => 800,
        'system' => ki_assistent_system($heute),
        'tools' => $tools,
        'messages' => $nachrichten,
    ], 40);
    if ($data === null) {
        return null;
    }
    return ki_assistent_antwort_filtern($data);
}

// ══════════════════════════════════════════ WECKWORT (ENT-702, nur Testumgebung)
//
// Weckwort "Hallo Waechter" fuer den Assistenten.
//
// Erkannt wird das Wort im BROWSER, mit Vosk (quelloffen, Apache-2.0) und
// einem kleinen deutschen Modell. Kein Ton verlaesst das Geraet, bevor das
// Wort gefallen ist; erst danach startet die gewohnte Spracheingabe.
//
// Diese Datei besorgt nur das Modell: Der Server holt es EINMAL von der
// Projektseite, prueft, dass es ein Vosk-Modell ist, packt es in das Format,
// das vosk-browser erwartet (tar.gz mit einem Ordner "model/"), und legt es
// im Temp-Bereich des Kontos ab -- nie im ausgelieferten Verzeichnis. Wird
// der Temp-Bereich geleert, holt er es beim naechsten Mal neu.
//
// Warum nicht beim Deploy: Der Deploy ist querliegend und wird von mehreren
// Sitzungen angefasst; ein 45-MB-Schritt dort betraefe jeden Lauf. Und warum
// hier in ai.php statt in einer eigenen Datei: Der Deploy kopiert die Module
// einzeln und namentlich -- eine neue Datei verlangte eine Deploy-Aenderung.

const WECKWORT_MODELL_QUELLE = 'https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip';
const WECKWORT_MODELL_MAX_BYTES = 120 * 1024 * 1024;   // Obergrenze beim Herunterladen
// Diese Dateien muss ein Vosk-Modell enthalten (README von vosk-browser,
// Abschnitt "Model format"). Fehlt eine, ist es kein Modell -- dann wird
// nichts ausgeliefert, statt etwas Fremdes an den Browser zu geben.
const WECKWORT_PFLICHT = ['am/final.mdl', 'conf/mfcc.conf', 'conf/model.conf', 'graph/phones/word_boundary.int'];

function weckwort_verzeichnis(): string
{
    return sys_get_temp_dir() . '/guardops-weckwort';
}

function weckwort_modell_datei(): string
{
    return weckwort_verzeichnis() . '/model-de-0.15.tar.gz';
}

// Stand der Vorbereitung (ENT-703, Nachtrag): Der Browser fragt ihn ab,
// statt minutenlang an einer einzigen Anfrage zu haengen, die Hostpoint
// womoeglich abbricht. phase: '' (nie begonnen), laedt, packt, fertig, fehler.
function weckwort_stand_setzen(string $phase, string $grund = ''): void
{
    $dir = weckwort_verzeichnis();
    if (!is_dir($dir)) { @mkdir($dir, 0700, true); }
    @file_put_contents($dir . '/stand.json', json_encode(['phase' => $phase, 'grund' => $grund, 'zeit' => time()]));
}

function weckwort_stand(): array
{
    $datei = weckwort_modell_datei();
    if (is_file($datei) && filesize($datei) > 1000000) {
        return ['phase' => 'fertig', 'grund' => '', 'groesse' => filesize($datei)];
    }
    $roh = @file_get_contents(weckwort_verzeichnis() . '/stand.json');
    $s = $roh ? (json_decode($roh, true) ?: []) : [];
    $phase = (string)($s['phase'] ?? '');
    // Ein Stand "laedt/packt", der seit ueber 15 Minuten nicht weiterkam, ist
    // ein abgebrochener Lauf -- dann darf ein neuer beginnen.
    if (in_array($phase, ['laedt', 'packt'], true) && time() - (int)($s['zeit'] ?? 0) > 900) {
        return ['phase' => 'fehler', 'grund' => 'Die Vorbereitung auf dem Server wurde abgebrochen (vermutlich Zeitlimit).', 'groesse' => 0];
    }
    return ['phase' => $phase === 'fertig' ? '' : $phase, 'grund' => (string)($s['grund'] ?? ''), 'groesse' => 0];
}

// Welche Pflichtdateien fehlen in einer Liste von Pfaden im Archiv? Die Pfade
// liegen unter einem Ordner beliebigen Namens (im Original
// "vosk-model-small-de-0.15/"). Rein, ohne Dateizugriff.
function weckwort_fehlende(array $pfade): array
{
    $relativ = [];
    foreach ($pfade as $p) {
        $p = str_replace('\\', '/', (string)$p);
        $teile = explode('/', $p, 2);
        if (count($teile) === 2 && $teile[1] !== '') {
            $relativ[$teile[1]] = true;
        }
    }
    return array_values(array_filter(WECKWORT_PFLICHT, fn($f) => !isset($relativ[$f])));
}

// Ein Pfad aus dem Archiv, der aus dem Zielordner hinauszeigt ("../", absolut),
// wird nie entpackt (Zip-Slip). Rein.
function weckwort_pfad_sicher(string $pfad): bool
{
    $p = str_replace('\\', '/', $pfad);
    return $p !== '' && $p[0] !== '/' && !preg_match('#(^|/)\.\.(/|$)#', $p) && !preg_match('/^[A-Za-z]:/', $p);
}

// Zip -> tar.gz mit Ordner "model/". Gibt '' zurueck oder den Grund.
function weckwort_umpacken(string $zipDatei, string $zielTarGz): string
{
    if (!class_exists('ZipArchive') || !class_exists('PharData')) {
        return 'Auf dem Server fehlt ZipArchive oder PharData.';
    }
    $zip = new ZipArchive();
    if ($zip->open($zipDatei) !== true) {
        return 'Das heruntergeladene Archiv ist kein gültiges Zip.';
    }
    $pfade = [];
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $pfade[] = (string)$zip->getNameIndex($i);
    }
    $fehlt = weckwort_fehlende($pfade);
    if ($fehlt) {
        $zip->close();
        return 'Das Archiv ist kein Vosk-Modell (es fehlt: ' . implode(', ', $fehlt) . ').';
    }
    $arbeit = weckwort_verzeichnis() . '/arbeit-' . bin2hex(random_bytes(4));
    @mkdir($arbeit . '/model', 0700, true);
    foreach ($pfade as $p) {
        if (!weckwort_pfad_sicher($p)) {
            $zip->close();
            weckwort_aufraeumen($arbeit);
            return 'Das Archiv enthält einen unzulässigen Pfad.';
        }
        $teile = explode('/', str_replace('\\', '/', $p), 2);
        if (count($teile) < 2 || $teile[1] === '' || substr($p, -1) === '/') {
            continue;
        }
        $ziel = $arbeit . '/model/' . $teile[1];
        @mkdir(dirname($ziel), 0700, true);
        $inhalt = $zip->getFromName($p);
        if ($inhalt === false || file_put_contents($ziel, $inhalt) === false) {
            $zip->close();
            weckwort_aufraeumen($arbeit);
            return 'Das Modell liess sich nicht entpacken.';
        }
    }
    $zip->close();
    try {
        $tar = $arbeit . '/model.tar';
        $phar = new PharData($tar);
        $phar->buildFromDirectory($arbeit, '#^' . preg_quote($arbeit . '/model/', '#') . '#');
        $phar->compress(Phar::GZ);
        unset($phar);
        if (!rename($tar . '.gz', $zielTarGz)) {
            throw new RuntimeException('verschieben');
        }
    } catch (Throwable $e) {
        weckwort_aufraeumen($arbeit);
        return 'Das Modell liess sich nicht neu verpacken.';
    }
    weckwort_aufraeumen($arbeit);
    return '';
}

function weckwort_aufraeumen(string $pfad): void
{
    if (is_dir($pfad)) {
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($pfad, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST) as $f) {
            $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
        }
        @rmdir($pfad);
    } elseif (is_file($pfad)) {
        @unlink($pfad);
    }
}

// Sorgt dafuer, dass das Modell bereitliegt. Gibt '' oder den Grund zurueck.
// Nur eine Anfrage laedt; weitere warten auf die Sperre und finden danach die
// fertige Datei.
function weckwort_bereitstellen(): string
{
    $ziel = weckwort_modell_datei();
    if (is_file($ziel) && filesize($ziel) > 1000000) {
        return '';
    }
    $dir = weckwort_verzeichnis();
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
        return 'Kein Ablageort für das Modell auf dem Server.';
    }
    $sperre = fopen($dir . '/.sperre', 'c');
    if (!$sperre || !flock($sperre, LOCK_EX)) {
        return 'Das Modell wird gerade von einer anderen Anfrage bereitgestellt.';
    }
    try {
        if (is_file($ziel) && filesize($ziel) > 1000000) {
            return '';
        }
        @set_time_limit(900);
        @ignore_user_abort(true);   // bricht die Anfrage ab, laeuft die Vorbereitung weiter
        weckwort_stand_setzen('laedt');
        $zip = $dir . '/download.zip';
        $f = fopen($zip, 'w');
        $ch = curl_init(WECKWORT_MODELL_QUELLE);
        curl_setopt_array($ch, [
            CURLOPT_FILE => $f, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
            CURLOPT_CONNECTTIMEOUT => 20, CURLOPT_TIMEOUT => 480, CURLOPT_FAILONERROR => true,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_NOPROGRESS => false,
            CURLOPT_PROGRESSFUNCTION => fn($c, $gesamt, $geladen) => $geladen > WECKWORT_MODELL_MAX_BYTES ? 1 : 0,
        ]);
        $ok = curl_exec($ch);
        $fehler = curl_error($ch);
        curl_close($ch);
        fclose($f);
        if (!$ok) {
            @unlink($zip);
            $grund = 'Das Modell liess sich nicht herunterladen' . ($fehler !== '' ? " ({$fehler})" : '') . '.';
            weckwort_stand_setzen('fehler', $grund);
            return $grund;
        }
        weckwort_stand_setzen('packt');
        $grund = weckwort_umpacken($zip, $ziel);
        @unlink($zip);
        weckwort_stand_setzen($grund === '' ? 'fertig' : 'fehler', $grund);
        return $grund;
    } finally {
        flock($sperre, LOCK_UN);
        fclose($sperre);
    }
}
