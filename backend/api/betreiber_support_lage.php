<?php
// Wo liegt gerade eine Support-Freigabe vor? (Befund des Projektinhabers,
// 2026-09-22/23.)
//
// ANLASS: Ein Betrieb erteilte die Freigabe, und im Betreiber-Bereich stand
// davon nirgends etwas. Man musste je Mandant auf "Support" klicken, um es
// zu erfahren -- also raten, bei wem es sich lohnt.
//
// DIE FREIGABE BLEIBT, WO SIE IST. Sie liegt in der Datenbank des Betriebs,
// damit der Betreiber sie sich nicht selbst ausstellen kann (ENT-526,
// Kopf von backend/support.php). Dieser Endpunkt liest sie dort nur ab. Er
// oeffnet nichts: Der Einblick in die Anlage haengt weiterhin an
// api/betreiber_support.php, das die Freigabe erneut prueft und jeden
// Zugriff im Protokoll des Betriebs festhaelt. Was hier zurueckkommt, ist
// KEIN Zugriff und wird darum auch nicht als solcher protokolliert -- es
// ist die Frage "steht die Tuer offen", nicht das Hindurchgehen.
//
// KEINE BETRIEBSDATEN: Lage, wer freigegeben hat, bis wann und wofuer.
// Das sind Angaben ueber die Freigabe selbst, die der Betrieb dem Betreiber
// ausdruecklich erteilt hat.
//
// EIGENER ENDPUNKT und nicht in betreiber_mandant_list.php: Diese Abfrage
// oeffnet eine Verbindung je Mandant. In der Liste haette eine langsame
// oder nicht erreichbare Anlage das Laden aller uebrigen aufgehalten. So
// steht die Liste zuerst, und der Stand kommt nach.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../support.php';
require_once __DIR__ . '/../support_sammeln.php';

require_betreiber_voll();
$stamm = betreiber_db();

if (!hat_tabelle($stamm, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}

$mandanten = $stamm->query(
    'SELECT id, name, subdomain, status, db_host, db_name, db_user, secret_name
       FROM mandant ORDER BY id'
)->fetchAll(PDO::FETCH_ASSOC) ?: [];

// Der Vorrat faellt heraus (ENT-686): Eine Anlage, die noch keinem Kunden
// gehoert, hat niemanden, der eine Freigabe erteilen koennte. "Nie
// freigegeben" waere fuer sie eine falsche Aussage -- und jede Zeile hier
// kostet eine Verbindung zu ihrer Datenbank.
$mandanten = array_values(array_filter($mandanten,
    static fn(array $m): bool => !mandant_ist_vorrat($m)));

$lagen = be_freigabe_lagen($stamm, $mandanten);

json_response([
    'status' => 'ok',
    'lagen'  => $lagen,
    'offen'  => be_freigaben_offen($lagen),
]);
