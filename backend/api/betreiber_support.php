<?php
// Supportzugriff auf einen Mandanten -- nur auf dessen Freigabe, befristet,
// protokolliert (ENT-526).
//
// DIE DREI BEDINGUNGEN, und keine davon ist optional:
//
//   1. Der Mandant hat freigegeben. Die Freigabe liegt in SEINER Datenbank,
//      nicht hier -- läge sie hier, könnte der Betreiber sie sich selbst
//      ausstellen (siehe backend/support.php).
//   2. Die Freigabe gilt noch. Befristung und Widerruf prüft
//      support_freigabe_gueltig() in einer Abfrage; ein Widerruf wirkt in
//      derselben Sekunde.
//   3. Der Zugriff wird protokolliert, und zwar BEVOR Daten ausgeliefert
//      werden. Ein Abbruch mitten in der Auslieferung darf keine Lücke im
//      Protokoll hinterlassen.
//
// WAS AUSGELIEFERT WIRD -- abschliessend, und ausdrücklich ohne
// Personendaten:
//
//   - wie viele Datensätze je Kerntabelle vorhanden sind
//   - welche Kerntabellen fehlen (Schema-Stand)
//   - wie die Rechteprofile heissen und wie viele Personen sie tragen
//
// KEINE Namen, KEINE Löhne, KEINE Rapportinhalte, KEINE vertraulichen
// Personalangaben (ma_vertrauliche_felder). Das ist keine Bequemlichkeit,
// sondern die Grenze, die diesen Zugriff überhaupt vertretbar macht: Für
// eine Störungssuche braucht niemand die AHV-Nummer eines Wächters.
//
// Reicht das im Einzelfall nicht, ist die Antwort NICHT, diese Liste still
// zu erweitern -- sondern eine eigene Entscheidung darüber, was ein
// weitergehender Einblick sehen darf und unter welchen Bedingungen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../support.php';

$ich = require_betreiber_voll();
$stamm = betreiber_db();

$mandantId = (int)($_GET['id'] ?? 0);
if ($mandantId <= 0) {
    json_response(['status' => 'error', 'message' => 'Welcher Mandant?'], 400);
}
if (!hat_tabelle($stamm, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}

$s = $stamm->prepare('SELECT id, name, status, db_host, db_name, db_user, secret_name
                        FROM mandant WHERE id = ?');
$s->execute([$mandantId]);
$m = $s->fetch(PDO::FETCH_ASSOC);
if (!$m) {
    json_response(['status' => 'error', 'message' => 'Diesen Mandanten gibt es nicht.'], 404);
}

try {
    $pdo = mandant_db($m);
} catch (Throwable $e) {
    // Der Treibertext kann Host und Benutzer enthalten und geht nicht nach
    // aussen -- gemeldet wird die Lage.
    json_response(['status' => 'error', 'lage' => mandant_verbindung_bereit($m),
        'message' => 'Dieser Mandant ist nicht erreichbar.'], 502);
}

// ── Bedingung 1 und 2: die Freigabe ───────────────────────────────────
if (!support_tabellen_da($pdo)) {
    json_response(['status' => 'error', 'grund' => 'nicht_eingerichtet',
        'message' => 'Bei diesem Mandanten ist die Support-Freigabe noch nicht eingerichtet.'], 409);
}
$freigabe = support_freigabe_gueltig($pdo);
if ($freigabe === null) {
    // Eigener Grund statt eines allgemeinen "verboten": Der Betreiber soll
    // den Mandanten bitten können, statt zu raten, woran es liegt.
    json_response([
        'status'  => 'error',
        'grund'   => 'keine_freigabe',
        'lage'    => support_lage($pdo),
        'message' => 'Für diesen Mandanten liegt keine gültige Support-Freigabe vor. '
                   . 'Sie wird im Cockpit des Betriebs erteilt und ist befristet.',
    ], 403);
}

// ── Bedingung 3: protokollieren, BEVOR etwas ausgeliefert wird ────────
$wer = trim((string)$ich['name']) . ' <' . (string)$ich['email'] . '>';
support_zugriff_merken($pdo, (int)$freigabe['id'], $wer, 'Diagnose: Tabellenstände, Schema, Rechteprofile');

// ── Die Diagnose ──────────────────────────────────────────────────────
$staende = [];
$fehlend = [];
foreach (MANDANT_KERNTABELLEN as $t) {
    if (!hat_tabelle($pdo, $t)) { $fehlend[] = $t; continue; }
    // Nur COUNT(*) -- es wird keine einzige Zeile gelesen.
    $staende[] = ['tabelle' => $t,
                  'zeilen'  => (int)$pdo->query('SELECT COUNT(*) FROM `' . $t . '`')->fetchColumn()];
}

// Rechteprofile: wie sie heissen und wie viele sie tragen. Ohne Namen --
// für eine Störungssuche zählt die Struktur, nicht wer darin steht.
$profile = [];
if (hat_tabelle($pdo, 'rollen') && hat_tabelle($pdo, 'mitarbeiter_rollen')) {
    $profile = $pdo->query(
        'SELECT r.name,
                (SELECT COUNT(*) FROM mitarbeiter_rollen mr
                  JOIN mitarbeiter m ON m.id = mr.mitarbeiter_id
                 WHERE mr.rolle = r.name AND m.aktiv = 1) AS traeger
           FROM rollen r ORDER BY r.name'
    )->fetchAll(PDO::FETCH_ASSOC);
}

json_response([
    'status'   => 'ok',
    'mandant'  => ['id' => (int)$m['id'], 'name' => $m['name']],
    'freigabe' => [
        'von'      => $freigabe['freigegeben_von'],
        'am'       => $freigabe['freigegeben_am'],
        'gilt_bis' => $freigabe['gilt_bis'],
        'zweck'    => $freigabe['zweck'],
    ],
    'tabellen' => $staende,
    'fehlend'  => $fehlend,
    'profile'  => $profile,
    // Damit im Betreiber-Bereich sichtbar bleibt, was hier NICHT kommt --
    // und niemand den Eindruck bekommt, er sähe den ganzen Betrieb.
    'umfang'   => 'Diagnosedaten ohne Personenbezug. Keine Namen, Löhne, Rapportinhalte '
                . 'oder vertraulichen Personalangaben. Dieser Zugriff wurde im Protokoll '
                . 'des Betriebs festgehalten.',
]);
