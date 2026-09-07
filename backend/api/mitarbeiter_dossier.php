<?php
declare(strict_types=1);
// Der vollstaendige Datensatz EINER Person (ENT-072).
//
// Gegenstueck zu mitarbeiter_list.php: Die Sammelabfrage traegt nur, was die
// Liste anzeigt; alles Weitere -- Personenstand, Bewilligungen, Register-
// daten -- kommt hier, und nur fuer eine einzelne Person, die jemand
// tatsaechlich geoeffnet hat. Dadurch liegt nicht bei jedem Laden des
// Dashboards die Personalakte aller Mitarbeitenden im Browser.
//
// Was hier NICHT gebaut ist und offen bleibt: ein Rollenmodell. Das Werkzeug
// kennt bis heute nur "Admin ja/nein". Wer Zugriff auf diesen Endpunkt hat,
// sieht alle Felder. Solange das so ist, ist die Trennung eine Frage der
// Sparsamkeit, nicht der Berechtigung -- festgehalten im Entscheidungs-
// protokoll, damit es niemand fuer geloest haelt.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../mitarbeiter.php';

$user = require_session();
require_recht($user, 'personal_lesen');

$name = trim((string)($_GET['name'] ?? ''));
if ($name === '') {
    json_response(['status' => 'error', 'message' => 'Name erforderlich'], 400);
}

$pdo = db();
$felder = array_keys(ma_vorhandene_felder($pdo));
$fest = ['id', 'name', 'ist_admin', 'aktiv', 'erstellt_am'];
foreach (['letzter_zugriff', 'passwort_geaendert_am'] as $z) {
    if (ma_spalte_da($pdo, $z)) { $fest[] = $z; }
}

$s = $pdo->prepare('SELECT ' . implode(', ', array_merge($fest, $felder)) . '
                    FROM mitarbeiter WHERE name = ?');
$s->execute([$name]);
$row = $s->fetch(PDO::FETCH_ASSOC);
if (!$row) {
    json_response(['status' => 'error', 'message' => 'Mitarbeitende(r) nicht gefunden'], 404);
}

$row['id'] = (int)$row['id'];
$row['ist_admin'] = (bool)$row['ist_admin'];
$row['aktiv'] = (bool)$row['aktiv'];
foreach (['funktion_id', 'abteilung_id', 'anstellungsort_id', 'pensum_stunden'] as $z) {
    if (array_key_exists($z, $row)) { $row[$z] = $row[$z] === null ? null : (int)$row[$z]; }
}
// Das Passwort verlaesst die Datenbank nie -- auch nicht als Hash.
unset($row['password_hash']);

// Die vertraulichen Angaben verlassen den Server nur, wenn die Rolle sie
// sehen darf (ENT-077). Sie werden ENTFERNT, nicht leer geschickt: ein
// leeres Feld sieht aus wie "nicht erfasst", und "unbekannt" darf nie
// aussehen wie "keine". Die Oberflaeche erfaehrt ueber "vertraulich",
// woran sie ist, und schreibt hin, dass etwas ausgeblendet wurde.
$darfVertraulich = darf($user, 'personal_vertraulich_lesen');
if (!$darfVertraulich) {
    foreach (ma_vertrauliche_felder() as $feld) { unset($row[$feld]); }
}

// Die Rollen der Person -- die Oberflaeche zeigt sie im Abschnitt Zugang.
$row['rollen'] = rechte_rollen($pdo, (int)$row['id'], (bool)$row['ist_admin']);

json_response(['status' => 'ok', 'mitarbeiter' => $row,
    'vertraulich' => $darfVertraulich,
    'darf_aendern' => darf($user, 'personal_schreiben'),
    'darf_rollen'  => darf($user, 'rechte_schreiben'),
    // Die Profile mit Namen (ENT-440). Ohne sie muesste die Oberflaeche die
    // Titel aus einer eigenen Liste holen -- die kennt aber nur die fuenf
    // Systemrollen und wuerde jedes eigene Profil als rohen Schluessel
    // anzeigen ("disposition_2" statt "Disposition ohne Kundenpflege").
    'profile' => rollen_kurzliste($pdo),
    'eingerichtet' => in_array('ahv_nr', $felder, true)]);
