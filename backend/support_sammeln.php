<?php
// Was auf der Anlage eines Mandanten liegt, HOLT der Betreiber ab.
//
// ANLASS, live gemessen am 2026-09-23: Auf einem Demo-Platz stellte der
// Interessent eine Supportanfrage. Im Cockpit stand sie als "eingegangen",
// beim Betreiber kam sie nie an.
//
// GRUND: betreiber_db() faellt bei leerem Datenbanknamen bewusst auf db()
// zurueck (Kopf von backend/betreiber.php). Im Buendel eines Demo-Platzes
// bleiben die vier Platzhalter unersetzt -- der Platz ist sich also selbst
// "Stamm". Seine Anfrage landet in seiner eigenen support_vorgang, die
// Einrichtung traegt ihn ausserdem als Mandant 1 in seine eigene
// mandant-Tabelle ein. Alles in sich stimmig, nur eben in einem anderen
// Haus.
//
// WARUM NICHT DIE ZUGANGSDATEN DES STAMMS IN DIE PLAETZE:
// In der Stamm-Datenbank steht die Tabelle `mandant` -- mit den
// Zugangsdaten ALLER Mandanten. Zehn oeffentlich erreichbare Demo-Plaetze,
// die jeder Interessent bekommt, waeren dann zehn Wege dorthin. Der
// Betreiber holt darum ab, statt dass der Platz schickt: Er hat die
// Verbindung ohnehin (mandant_db, schon fuer Diagnose und Nutzung), und
// auf den Plaetzen liegt kein einziges neues Geheimnis.
//
// DER ABHOLWEG IST KEIN SUPPORT-ZUGRIFF. Geholt werden ausschliesslich
// Dinge, die dem Betreiber gelten: Anfragen, die ausdruecklich an ihn
// gerichtet sind, und der Stand der Freigabe, die ihm erteilt wurde. Keine
// Betriebsdaten. Der Einblick in die Anlage bleibt an der Freigabe
// (ENT-526, api/betreiber_support.php).
declare(strict_types=1);

// In welcher Datenbank steht der Stamm selbst?
//
// Gefragt wird die Verbindung, nicht ein abgelegter Name: Welche Datenbank
// offen ist, weiss sie selbst, und eine zweite Buchhaltung darueber koennte
// von ihr abweichen.
function be_stamm_dbname(PDO $stamm): string
{
    try {
        return (string)($stamm->query('SELECT DATABASE()')->fetchColumn() ?: '');
    } catch (Throwable $e) {
        return '';
    }
}

// Fuehrt dieser Mandant seinen Supportkanal in einer EIGENEN Datenbank --
// muss also abgeholt werden?
//
// REIN, ohne Verbindung: So laesst sich die Entscheidung fuer sich pruefen
// (pruefungen/pruef_support_sammeln.php), ohne einen Server zu brauchen.
//
// Drei Faelle, drei Antworten, und keiner davon heisst "abholen":
//   - standardverbindung : der Mandant teilt sich die Datenbank mit dem
//     Stamm. Seine Anfrage steht schon hier. (Heutiger Fall der Mandantin.)
//   - derselbe Datenbankname : dasselbe, nur ausdruecklich eingetragen.
//   - nicht bereit : ohne Zugangsdaten oder Secret gibt es nichts zu holen.
//     Das ist ein eigener Befund und wird vom Aufrufer benannt, nicht als
//     "keine Anfragen" ausgegeben.
function be_holt_ab(string $stammDb, array $m): bool
{
    if (mandant_verbindung_bereit($m) !== 'bereit') { return false; }
    $eigen = trim((string)($m['db_name'] ?? ''));
    if ($eigen === '') { return false; }
    return strcasecmp($eigen, $stammDb) !== 0;
}

// Die Vorgaenge aller Mandanten mit eigener Anlage.
//
// Je Mandant eine eigene Verbindung, jede fuer sich abgesichert: Ein Platz,
// der gerade nicht antwortet, darf die Liste der uebrigen nicht mitreissen.
// Was nicht erreichbar war, steht in 'anlagen' -- "nicht feststellbar" ist
// etwas anderes als "keine Anfragen" (Hausregel).
function be_fremde_vorgaenge(PDO $stamm, array $mandanten, bool $nurOffen = false): array
{
    $stammDb   = be_stamm_dbname($stamm);
    $vorgaenge = [];
    $anlagen   = [];
    $offen     = 0;

    foreach ($mandanten as $m) {
        if (!be_holt_ab($stammDb, $m)) { continue; }
        $id   = (int)$m['id'];
        $name = (string)$m['name'];
        try {
            $fern = mandant_db($m);
        } catch (Throwable $e) {
            // Der Treibertext traegt Host und Benutzer und geht nicht nach
            // aussen -- gemeldet wird die Lage.
            $anlagen[] = ['mandant_id' => $id, 'mandant' => $name,
                          'lage' => 'nicht_erreichbar'];
            continue;
        }
        if (!sv_tabellen_da($fern)) {
            // Kein Supportkanal auf dieser Anlage ist NICHT dasselbe wie
            // keine Anfrage: Dort kann noch gar keine entstanden sein.
            $anlagen[] = ['mandant_id' => $id, 'mandant' => $name,
                          'lage' => 'kein_kanal'];
            continue;
        }
        try {
            foreach (sv_liste($fern, null, $nurOffen) as $v) {
                $v['id']         = (int)$v['id'];
                // Die mandant_id der fernen Anlage zaehlt dort und nur dort
                // (sie traegt sich selbst als Mandant 1). Massgeblich ist,
                // WELCHE ANLAGE es war -- darum wird sie hier ueberschrieben.
                $v['mandant_id'] = $id;
                $v['mandant']    = $name;
                $v['fern']       = true;
                $vorgaenge[]     = $v;
            }
            $offen += sv_zaehler_offen($fern);
            $anlagen[] = ['mandant_id' => $id, 'mandant' => $name, 'lage' => 'ok'];
        } catch (Throwable $e) {
            $anlagen[] = ['mandant_id' => $id, 'mandant' => $name,
                          'lage' => 'nicht_erreichbar'];
        }
    }

    return ['vorgaenge' => $vorgaenge, 'offen' => $offen, 'anlagen' => $anlagen];
}

// Der Stand der Support-Freigabe je Mandant.
//
// SECHS AUSSAGEN, SECHS TEXTE (Hausregel). Fuenf kommen aus support_lage()
// -- offen, nie_freigegeben, abgelaufen, widerrufen, nicht_eingerichtet --
// und die sechste ist die, die man am leichtesten verschluckt:
// nicht_feststellbar. Eine Anlage, die nicht antwortet, hat nicht "keine
// Freigabe erteilt"; wir wissen es bloss nicht.
function be_freigabe_lagen(PDO $stamm, array $mandanten): array
{
    $stammDb = be_stamm_dbname($stamm);
    $lagen   = [];

    foreach ($mandanten as $m) {
        $id   = (int)$m['id'];
        $eintrag = [
            'mandant_id' => $id,
            'mandant'    => (string)$m['name'],
            'subdomain'  => (string)($m['subdomain'] ?? ''),
            'lage'       => 'nicht_feststellbar',
            'freigabe'   => null,
            // Immer vorhanden, auch wenn die Anlage stumm blieb: Ein
            // fehlender Schluessel saehe in der Oberflaeche aus wie "nicht
            // gebeten", und das waere eine Behauptung.
            'bitte'      => null,
        ];

        $verbindung = mandant_verbindung_bereit($m);
        if ($verbindung !== 'bereit' && $verbindung !== 'standardverbindung') {
            $eintrag['grund'] = $verbindung;
            $lagen[] = $eintrag;
            continue;
        }

        try {
            $pdo = mandant_db($m);
            $eintrag['lage'] = support_lage($pdo);
            // Ob dort eine Bitte offen steht (ENT-683). Der Betreiber soll
            // in der Liste sehen, wen er schon gefragt hat -- sonst fragt er
            // denselben Betrieb ein zweites Mal, und das sieht von dort aus
            // aus wie Draengen.
            $bitte = support_bitte_offen($pdo);
            $eintrag['bitte'] = $bitte === null ? null : [
                'von' => (string)$bitte['gebeten_von'],
                'am'  => (string)$bitte['gebeten_am'],
                'zweck' => (string)$bitte['zweck'],
            ];
            $offen = support_freigabe_gueltig($pdo);
            if ($offen !== null) {
                // Der Zweck steht mit dabei: Er sagt, WOFUER geoeffnet
                // wurde, und ohne ihn ist eine Freigabe nicht einzuordnen.
                $eintrag['freigabe'] = [
                    'von'      => (string)$offen['freigegeben_von'],
                    'am'       => (string)$offen['freigegeben_am'],
                    'gilt_bis' => (string)$offen['gilt_bis'],
                    'zweck'    => (string)$offen['zweck'],
                ];
            }
        } catch (Throwable $e) {
            $eintrag['grund'] = 'nicht_erreichbar';
        }

        $lagen[] = $eintrag;
    }

    return $lagen;
}

// Wie viele Anlagen gerade eine offene Freigabe haben. Fuer das Abzeichen
// -- gezaehlt wird beim Server, damit Liste und Zahl dasselbe sagen.
function be_freigaben_offen(array $lagen): int
{
    return count(array_filter($lagen, fn($l) => ($l['lage'] ?? '') === 'offen'));
}
