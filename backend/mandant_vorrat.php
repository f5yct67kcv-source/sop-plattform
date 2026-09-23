<?php
// Der Vorrat vorbereiteter Anlagen (ENT-686).
//
// WAS EIN VORRATSPLATZ IST: eine Mandantenzeile mit Status "vorrat" --
// Datenbank beim Hoster, eingerichtetes Schema, Secret im Deploy. Was er NOCH
// NICHT hat, sind Kunde und Adresse. Der Kunde bekommt seine eigene Domain
// (Festlegung des Projektinhabers, 2026-09-23), und die Adresse einer Anlage
// steht fest im Deploy-Buendel (ENT-501). Sie entsteht darum erst bei der
// Zuteilung; vorbereitet wird alles, was sich ohne Kundennamen vorbereiten
// laesst.
//
// WARUM EIN STATUS UND KEINE NAMENSLISTE WIE DEMO_PLAETZE: Die Demo-Plaetze
// heissen nach ihrer Adresse und behalten sie. Ein Vorratsplatz bekommt bei
// der Zuteilung eine neue -- eine Liste von Namen wuerde ihn in genau diesem
// Moment verlieren. Was die feste Liste bei der Demo leistet, den Blick auf
// alles, was zu einem Platz sonst noch gehoert, leistet hier die taegliche
// Pruefung: Sie sieht jede Vorratsanlage einzeln an.
//
// WARUM EIN EIGENES MODUL und nicht Funktionen in betreiber.php: Diese Datei
// VERBINDET zu Mandantendatenbanken. betreiber.php definiert mandant_db()
// und ist darum von der Wache in test_betreiber.mjs ausgenommen -- ein
// Endpunkt, der die Pruefung ueber betreiber.php bekaeme, waere fuer die
// Wache unsichtbar. Ueber ein eigenes Modul zaehlt jeder Endpunkt, der es
// laedt, als Verbinder und muss namentlich in DARF_VERBINDEN stehen.
//
// Setzt voraus: db.php, betreiber.php, planung_einrichten_kern.php
// (kern_schema_fehlend) -- der Aufrufer bindet sie ein.
declare(strict_types=1);

// Soll-Groesse und Meldeschwelle (ENT-686, Klaerung 5): drei Anlagen, und
// gemeldet wird, sobald weniger als zwei wirklich uebergabefaehig sind. Dann
// bleibt nach einem Vertragsabschluss Zeit fuer den Hoster-Schritt, bevor
// der naechste kommt.
const MANDANT_VORRAT_SOLL     = 3;
const MANDANT_VORRAT_SCHWELLE = 2;

// Wie es um EINE Vorratsanlage steht -- aus dem, was die Pruefung
// herausgefunden hat. Rein, damit sich jede Lage mit frei gewaehlten Werten
// pruefen laesst, ohne Datenbank.
//
// $verbindung: das Ergebnis von mandant_verbindung_bereit(), oder
//              'fehlgeschlagen', wenn die Verbindung trotz "bereit" nicht
//              zustande kam.
// $luecken:    die Liste aus kern_schema_fehlend(), oder null, wenn gar
//              nicht geprueft werden konnte.
//
// VIER AUSSAGEN, VIER TEXTE (Hausregel): nicht eingetragen, nicht
// erreichbar, halb eingerichtet und bereit sind verschiedene Dinge -- und
// verlangen verschiedene Handgriffe an verschiedenen Orten. Eine nicht
// erreichbare Anlage ist ausdruecklich NICHT uebergabefaehig: Ob sie es
// waere, wissen wir nicht, und "unbekannt" darf nie wie "bereit" aussehen.
function mandant_vorrat_befund(string $verbindung, ?array $luecken): array
{
    if ($verbindung === 'standardverbindung' || $verbindung === 'unvollstaendig') {
        return ['lage' => 'nicht_eingetragen', 'bereit' => false,
                'text' => 'Datenbankangaben fehlen im Mandantenstamm'];
    }
    if ($verbindung === 'secret_fehlt') {
        return ['lage' => 'secret_fehlt', 'bereit' => false,
                'text' => 'Zugangsdaten fehlen im Deploy (MANDANT_SECRETS)'];
    }
    if ($verbindung !== 'bereit' || $luecken === null) {
        return ['lage' => 'nicht_erreichbar', 'bereit' => false,
                'text' => 'Datenbank nicht erreichbar'];
    }
    if ($luecken !== []) {
        // Mit Zahl UND Beispielen, wie bei der Demo-Zuteilung: "unvollstaendig"
        // allein sagt niemandem, ob eine Spalte fehlt oder die halbe Anlage.
        return ['lage' => 'schema_unvollstaendig', 'bereit' => false,
                'text' => 'Schema unvollständig — ' . count($luecken) . ' fehlende Stellen, darunter: '
                        . implode(', ', array_slice($luecken, 0, 3))];
    }
    return ['lage' => 'bereit', 'bereit' => true, 'text' => 'übergabefähig'];
}

// Den ganzen Vorrat pruefen: jede Anlage mit Status "vorrat" einzeln.
//
// ALLE werden angesehen, nicht bis zur ersten brauchbaren -- dieselbe Lehre
// wie bei demo_zugang_einrichten(): Ein Vorrat, der lautlos schrumpft, faellt
// erst auf, wenn er leer ist. Jede untaugliche Anlage steht mit ihrem Grund
// im Ergebnis.
//
// GELESEN WIRD NUR DER BAUPLAN (kern_schema_fehlend, aus information_schema).
// Keine Verwaltungstabelle, kein Feld daraus. Ob in einer Vorratsanlage schon
// jemand steht, prueft diese Funktion bewusst NICHT: Das duerfte sie von der
// Betreiber-Ebene aus gar nicht (Trennung der Ebenen, test_betreiber.mjs),
// und die Sperre dagegen sitzt am einzigen Ort, an dem sie etwas ausrichtet
// -- im Einloeseweg, der das Erstkonto anlegt.
function mandant_vorrat_lage(PDO $stamm): array
{
    $zeilen = $stamm->prepare(
        'SELECT id, name, status, db_host, db_name, db_user, secret_name
           FROM mandant WHERE status = ? ORDER BY id'
    );
    $zeilen->execute([MANDANT_STATUS_VORRAT]);

    $plaetze = [];
    foreach ($zeilen->fetchAll(PDO::FETCH_ASSOC) ?: [] as $m) {
        $verbindung = mandant_verbindung_bereit($m);
        $luecken = null;
        if ($verbindung === 'bereit') {
            try {
                $luecken = kern_schema_fehlend(mandant_db($m));
            } catch (Throwable $e) {
                $verbindung = 'fehlgeschlagen';
            }
        }
        $plaetze[] = ['id' => (int)$m['id'], 'name' => (string)$m['name']]
                   + mandant_vorrat_befund($verbindung, $luecken);
    }
    return mandant_vorrat_zusammenfassen($plaetze);
}

// Zaehlt aus den Einzelbefunden zusammen. Rein, aus demselben Grund wie
// mandant_vorrat_befund().
//
// ZWEI ZAHLEN, NICHT EINE (Hausregel "Einheiten nie vermischen"):
// "eingetragen" zaehlt Mandantenzeilen mit Status vorrat, "bereit" die davon,
// die heute wirklich uebergeben werden koennten. Eine Anlage, die eingetragen
// ist und nicht antwortet, gehoert zur ersten Zahl und nicht zur zweiten.
function mandant_vorrat_zusammenfassen(array $plaetze): array
{
    $bereit = count(array_filter($plaetze, static fn(array $p): bool => $p['bereit']));
    return [
        'plaetze'     => $plaetze,
        'eingetragen' => count($plaetze),
        'bereit'      => $bereit,
        'soll'        => MANDANT_VORRAT_SOLL,
        'schwelle'    => MANDANT_VORRAT_SCHWELLE,
        'zu_wenig'    => $bereit < MANDANT_VORRAT_SCHWELLE,
    ];
}

// Die Nachricht an die Betreiber-Konten -- oder null, wenn nichts zu melden
// ist. Rein: Ob gemeldet wird und was drinsteht, laesst sich so ohne
// Mailserver pruefen.
//
// JEDEN TAG, SOLANGE ES SO BLEIBT (ENT-686, Festlegung vom 2026-09-23). Kein
// gespeicherter Vermerk "schon gemeldet": Er koennte verloren gehen oder vom
// tatsaechlichen Stand abweichen. Die Meldung hoert von selbst auf, sobald
// wieder genug Anlagen bereit sind.
function mandant_vorrat_meldung(array $lage): ?array
{
    if (!$lage['zu_wenig']) { return null; }

    $bereit = (int)$lage['bereit'];
    // "Keine Zahl ohne Bezug": "1" allein sagte nicht, ob von einer oder von
    // drei. Darum immer mit dem, worauf sie sich bezieht.
    $betreff = $bereit === 0
        ? 'GuardOpS: Kein Mandanten-Vorrat übergabefähig'
        : "GuardOpS: Nur noch $bereit Anlage im Vorrat übergabefähig";

    $zeilen = [];
    foreach ($lage['plaetze'] as $p) {
        $zeilen[] = '- ' . $p['name'] . ': ' . $p['text'];
    }
    $liste = $zeilen === []
        ? "Im Mandantenstamm ist keine Anlage mit Status „Vorrat\" eingetragen.\n"
        : implode("\n", $zeilen) . "\n";

    $text = "Übergabefähig: $bereit von {$lage['eingetragen']} eingetragenen Anlagen "
          . "(Soll: {$lage['soll']}, Meldung unter {$lage['schwelle']}).\n\n"
          . $liste . "\n"
          . "Solange das so bleibt, kommt diese Nachricht jeden Tag. Sie hört von selbst auf, "
          . "sobald wieder genug Anlagen übergabefähig sind.\n\n"
          . "Nachfüllen: Datenbank beim Hoster anlegen, Zugang in MANDANT_SECRETS eintragen, "
          . "Anlage im Betreiber-Bereich mit Status „Vorrat\" erfassen und die Einrichtung laufen lassen.";

    return ['betreff' => $betreff, 'text' => $text];
}

// Prueft den Zeitgeber-Schluessel. Dieselbe Bauart wie
// demo_ablauf_zeitgeber_lage(), mit eigenem Platzhalter: Ein unersetzter
// Platzhalter heisst "nicht eingerichtet", nicht "falscher Schluessel" --
// sonst waere der Endpunkt in jedem Buendel ohne Schluessel fuer jeden offen,
// der den Platzhaltertext kennt.
function mandant_vorrat_zeitgeber_lage(string $erwartet, string $mitgegeben): string
{
    if ($erwartet === '' || str_starts_with($erwartet, '__')) { return 'nicht_eingerichtet'; }
    if ($mitgegeben === '') { return 'kein_schluessel_in_der_adresse'; }
    return hash_equals($erwartet, $mitgegeben) ? 'ok' : 'falscher_schluessel';
}
