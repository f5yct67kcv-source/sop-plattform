<?php
declare(strict_types=1);
// Die Neuerungsliste (ENT-698).
//
// WARUM EINE GEPFLEGTE LISTE und nicht die Einrichtungsschritte: Ein
// Schritt wie "Spalte mitarbeiter.x angelegt" sagt niemandem etwas, und
// eine Fehlerbehebung im Code erzeugt gar keinen Schritt -- sie erschiene
// nie. Was hier steht, ist fuer Menschen geschrieben.
//
// PFLEGE: Jeder Push, den jemand in der Oberflaeche bemerkt, bekommt hier
// einen Eintrag. Oben anfuegen, die Nummer um eins hoeher als die bisher
// hoechste. Nummern werden NIE wiederverwendet oder umgeschrieben: Am Konto
// steht, bis zu welcher Nummer jemand gelesen hat, und eine verschobene
// Nummer zeigte Alten Neues oder verschluckte Neues.
//
// 'fuer' sagt, wo der Eintrag erscheint:
//   cockpit   -- Verwaltungsoberflaeche (Desktop und Handy)
//   app       -- App der Mitarbeitenden
//   betreiber -- Betreiberbereich
// Ohne Datenbank, damit sie sich fuer sich allein pruefen laesst.

const NEUERUNG_ARTEN = [
    'neu'            => 'Neu',
    'verbesserung'   => 'Verbesserung',
    'fehlerbehebung' => 'Fehlerbehebung',
];
const NEUERUNG_ZIELE = ['cockpit', 'app', 'betreiber'];

function neuerungen_katalog(): array
{
    return [
        [
            'nr'    => 43,
            'datum' => '2026-10-17',
            'art'   => 'verbesserung',
            'fuer'  => ['cockpit'],
            'titel' => 'Einstellungen: Reiter „System“ entfällt',
            'text'  => 'Der Reiter „System“ in den Einstellungen ist weg. Was für den ganzen Betrieb gilt, findest du wie bisher unter Administration › Betrieb.',
        ],
        [
            'nr'    => 42,
            'datum' => '2026-10-16',
            'art'   => 'neu',
            'fuer'  => ['cockpit'],
            'titel' => 'Farbthemen: Graphit, Marine oder Hell',
            'text'  => 'Unter Einstellungen › Farben wählst du das Farbthema deiner Oberfläche: Graphit wie bisher, Marine mit nachtblauer Kopfleiste oder Hell mit heller Kopfleiste. Jedes Thema gibt es hell und dunkel, das stellst du wie gewohnt unter Darstellung ein. Die Farben für zugesagt, Warnung oder gesperrt bleiben in jedem Thema gleich. Die Wahl gilt für dein Konto und vorerst nur am Computer, am Handy bleibt die Oberfläche wie bisher.',
        ],
        [
            'nr'    => 41,
            'datum' => '2026-10-16',
            'art'   => 'fehlerbehebung',
            'fuer'  => ['cockpit'],
            'titel' => 'Kompakte Darstellung: Texte wieder sauber, Tagesplan weiter vorn',
            'text'  => 'In der kompakten Darstellung lief der Text in Suchfeldern unter die Lupe und in Auswahlfeldern unter den Pfeil. Das ist behoben, auf allen Seiten. Tabellen stehen wieder bündig im Rahmen. In der Planung folgt der Tagesplan jetzt direkt auf die Übersicht.',
        ],
        [
            'nr'    => 40,
            'datum' => '2026-10-16',
            'art'   => 'neu',
            'fuer'  => ['betreiber'],
            'titel' => 'Neuer Bereich „Finanzen“',
            'text'  => 'Finanzen ersetzt in der Kopfleiste den Bereich „Rechnungen“ und hat drei Reiter: Übersicht, Rechnungen und Ausgaben. Die Übersicht zeigt den offenen und den überfälligen Betrag, was im Monat bezahlt wurde, die Ausgaben im Monat und den wiederkehrenden Umsatz aus den laufenden Verträgen. Dazu eine Grafik mit Einnahmen und Ausgaben über die letzten Monate. Ausgaben erfasst du von Hand, mit Kategorie, MWST-Satz und auf Wunsch mit einem Beleg als PDF oder Bild. Wiederkehrende Kosten wie Hosting oder Abos legst du einmal an, dann wird jeder Monat gebucht. Bei Ausgaben in Fremdwährung trägst du den CHF-Betrag von der Kreditkartenabrechnung nach; bis dahin steht die Ausgabe als „CHF-Betrag fehlt“ da. Rechnungsentwürfe zählen nicht als offen, auch nicht auf der Startseite. Einnahmen minus Ausgaben ist kein Gewinn: Abschreibungen und Steuern fehlen.',
        ],
        [
            'nr'    => 38,
            'datum' => '2026-10-16',
            'art'   => 'neu',
            'fuer'  => ['cockpit'],
            'titel' => 'Glocke: selbst wählen, worüber sie dich informiert',
            'text'  => 'Unter Einstellungen › Benachrichtigungen schaltest du für deine Glocke einzeln ein oder aus: eingegangene Rapporte, gesperrte Tage, Antworten auf Schichten, entschiedene Offerten und spontane Rundgänge. Was du ausschaltest, erscheint nicht mehr in deiner Glocke und zählt nicht zur Zahl daran. In der Übersicht steht es weiterhin, und für andere Konten ändert sich nichts. Gemeldete Vorfälle und Antworten vom Support erscheinen immer.',
        ],
        [
            'nr'    => 37,
            'datum' => '2026-10-16',
            'art'   => 'verbesserung',
            'fuer'  => ['app', 'betreiber'],
            'titel' => 'Darstellung folgt deinem Konto',
            'text'  => 'Hell oder dunkel gilt jetzt für dein Konto, auf jedem Gerät, an dem du dich anmeldest. In der App bleibt die Wahl eine eigene, getrennt vom Cockpit. Im Betreiberbereich stehen hell/dunkel und die durchscheinende Oberfläche neu im Kontomenü unter „Einstellungen“, nicht mehr in der Kopfleiste.',
        ],
        [
            'nr'    => 36,
            'datum' => '2026-10-16',
            'art'   => 'neu',
            'fuer'  => ['cockpit'],
            'titel' => 'Einstellungen im Kontomenü',
            'text'  => 'Oben rechts im Kontomenü gibt es neu „Einstellungen“. Hell oder dunkel, die durchscheinende Oberfläche und die kompakte Darstellung findest du jetzt dort, nicht mehr in der Kopfleiste. Deine Wahl gilt neu für dein Konto, also auf jedem Gerät, an dem du dich anmeldest. Beim ersten Öffnen wird übernommen, was du bisher eingestellt hattest. Farben, Benachrichtigungen und der E-Mail-Designer sind schon als Reiter da und folgen.',
        ],
        [
            'nr'    => 35,
            'datum' => '2026-10-16',
            'art'   => 'verbesserung',
            'fuer'  => ['cockpit'],
            'titel' => 'Planung: übersichtlicher Monatsplan',
            'text'  => 'Die Übersicht der Planung beginnt weiter oben: Die Zeile mit „Feiertage“ ist weg, die Feiertage erreichst du jetzt über das Kalender-Icon links neben der Suche, in allen vier Planungsreitern. Die Objektspalte ist schmaler. Eine Woche oder ein einzelner Tag steht direkt neben den Objekten statt am rechten Rand. Wochenenden und Feiertage sind auch in besetzten Zeilen deutlich zu erkennen. Der Hinweis über dem Monatsplan erscheint nur noch, wenn ein Filter oder die Suche greift.',
        ],
        [
            'nr'    => 34,
            'datum' => '2026-10-16',
            'art'   => 'neu',
            'fuer'  => ['cockpit'],
            'titel' => 'Kompakte Darstellung',
            'text'  => 'Oben rechts gibt es einen neuen Schalter für eine kompakte Darstellung. Sie rückt Felder enger zusammen und blendet Erklärtexte aus; ein ⓘ an der Überschrift zeigt sie bei Bedarf wieder an. Das Formular „Neuer Einsatz“ ist darin so angeordnet, dass zusammengehörige Felder in einer Zeile stehen. Die Wahl merkt sich dein Browser. Am Handy gibt es den Schalter nicht.',
        ],
        [
            'nr'    => 28,
            'datum' => '2026-10-14',
            'art'   => 'fehlerbehebung',
            'fuer'  => ['cockpit'],
            'titel' => 'Neuer Einsatz: ruhigere Schrift',
            'text'  => 'Im Formular „Neuer Einsatz“ standen die Hinweise in fetten Grossbuchstaben, und alles, was du eingetippt hast, erschien fett. Jetzt sind beide in normaler Schrift. Der Hinweis zur Zone unter „Weg und Auslagenersatz“ läuft wieder über die ganze Breite, statt nach drei Wörtern umzubrechen.',
        ],
        [
            'nr'    => 26,
            'datum' => '2026-10-14',
            'art'   => 'verbesserung',
            'fuer'  => ['cockpit', 'app'],
            'titel' => 'Anmeldung lädt schneller',
            'text'  => 'Das Hintergrundvideo der Anmeldung kommt erst, wenn die Seite fertig geladen ist, und am Handy gar nicht mehr. Dort war es ohnehin nie zu sehen. Das CUPI-24-Siegel ist jetzt ein Zwanzigstel so gross, es sieht gleich aus.',
        ],
        [
            'nr'    => 25,
            'datum' => '2026-10-14',
            'art'   => 'verbesserung',
            'fuer'  => ['cockpit', 'app', 'betreiber'],
            'titel' => 'Seiten laden schneller',
            'text'  => 'Cockpit, App und Betreiberbereich sind beim ersten Öffnen nach einem Update nur noch etwa halb so gross. Bei langsamer Verbindung merkst du das am deutlichsten.',
        ],
        [
            'nr'    => 24,
            'datum' => '2026-10-14',
            'art'   => 'fehlerbehebung',
            'fuer'  => ['cockpit'],
            'titel' => 'Glocke: Zahl stimmt, alles auf einmal als gelesen markieren',
            'text'  => 'Die Zahl an der Glocke zeigt jetzt, wie viele Ereignisse wirklich offen sind. Bisher blieb sie bei 20 stehen, auch wenn mehr offen waren, und nach dem Abhaken stand dieselbe Zahl wieder da. Hast du alle sichtbaren Einträge abgehakt und es sind noch weitere offen, erscheinen die nächsten gleich in der Liste, statt dass eine Zahl über „Nichts Neues“ steht. Gemeldete Vorfälle lassen sich jetzt auch in der Glocke abhaken. Klappt ein Haken nicht, kommt der Eintrag sofort zurück. Neu steht oben in der Glocke „Alle als gelesen markieren“: Damit hakst du alles auf einmal ab, was bis zum Öffnen eingegangen ist. Abwesenheitsanträge und Antworten vom Support bleiben stehen, bis du sie entschieden oder geöffnet hast.',
        ],
        [
            'nr'    => 23,
            'datum' => '2026-10-13',
            'art'   => 'neu',
            'fuer'  => ['cockpit'],
            'titel' => 'Neuer Bereich „Finanzen“',
            'text'  => 'Rechnungen, Lohn und eine Geldübersicht liegen jetzt an einem Ort. „Finanzen“ ersetzt in der Kopfleiste den Bereich „Lohn“ und hat drei Reiter: Übersicht, Rechnungen und Lohn. Die Übersicht zeigt den offenen und den überfälligen Betrag, was im Monat bezahlt wurde, die Lohnkosten und eine Grafik mit verrechnet, bezahlt und Lohnkosten über die letzten Monate. Rechnungen findest du nicht mehr unter Kunden, sondern unter Finanzen. Offerten bleiben bei Kunden. Rechnungsentwürfe zählen in der Übersicht nicht mit. Die Lohnkosten sind ohne Arbeitgeberbeiträge gerechnet. Finanzen gibt es nur am Computer, nicht am Handy.',
        ],
        [
            'nr'    => 22,
            'datum' => '2026-10-10',
            'art'   => 'fehlerbehebung',
            'fuer'  => ['betreiber'],
            'titel' => 'Kündigungstermin bei Mandantenverträgen korrigiert',
            'text'  => 'Der Tag, bis zu dem eine Kündigung spätestens eintreffen muss, landete auf manchen Servern um die Kündigungsfrist NACH dem Vertragsende statt davor. Das betraf auch die Anzeige „Kündigung in den nächsten 90 Tagen“. Die Termine stimmen jetzt.',
        ],
        [
            'nr'    => 21,
            'datum' => '2026-10-10',
            'art'   => 'neu',
            'fuer'  => ['betreiber'],
            'titel' => 'Abgelaufene Einladungen neu verschicken',
            'text'  => 'Hat jemand den Einladungslink verstreichen lassen, schickt „Neu einladen“ im Reiter „Zugang“ des Kontos einen frischen Link an die hinterlegte Adresse. Der alte Link gilt danach nicht mehr. Ausserdem zeigt das Konto jetzt, ob der Link noch gilt oder abgelaufen ist, statt einfach „eingeladen“.',
        ],
        [
            'nr'    => 20,
            'datum' => '2026-09-26',
            'art'   => 'verbesserung',
            'fuer'  => ['betreiber'],
            'titel' => 'Betreiberbereich startet schneller',
            'text'  => 'Mandanten, Konten, Offerten, Rechnungen und die übrigen Listen laden beim Öffnen jetzt gleichzeitig statt nacheinander. Klemmt eine davon, erscheinen die anderen trotzdem.',
        ],
        [
            'nr'    => 19,
            'datum' => '2026-09-24',
            'art'   => 'neu',
            'fuer'  => ['cockpit'],
            'titel' => 'Persönliche Zulagen und Abzüge',
            'text'  => 'Im Reiter „Lohn“ der Personalakte gibt es die neue Karte „Zulagen und Abzüge“. Dort erfasst du pro Person Beträge aus deinen eigenen Lohnarten: pro Stunde, pro Monat oder einmalig, jeweils ab einem Monat und auf Wunsch bis zu einem Monat. Der Lohnlauf rechnet sie mit. Änderst du einen Betrag, endet die alte Position und eine neue beginnt, so bleibt jeder Monat nachvollziehbar.',
        ],
        [
            'nr'    => 18,
            'datum' => '2026-09-24',
            'art'   => 'fehlerbehebung',
            'fuer'  => ['cockpit'],
            'titel' => 'Kein falscher Konflikt nach einer Absage',
            'text'  => 'Hat jemand eine Schicht abgelehnt oder ist sie für die Person entfallen, zeigt die Planung sie zur selben Zeit nicht mehr als „bereits eingeteilt“. Speichern ging schon vorher, jetzt stimmt auch die Anzeige.',
        ],
        [
            'nr'    => 17,
            'datum' => '2026-09-24',
            'art'   => 'verbesserung',
            'fuer'  => ['cockpit'],
            'titel' => 'Cockpit startet schneller',
            'text'  => 'Seiten und Daten kommen jetzt komprimiert, und was sich nicht geändert hat, lädt dein Browser nicht noch einmal. Die Unterschriften der Rapporte kommen erst, wenn du einen Rapport öffnest, druckst oder teilst.',
        ],
        [
            'nr'    => 16,
            'datum' => '2026-09-24',
            'art'   => 'verbesserung',
            'fuer'  => ['cockpit', 'betreiber'],
            'titel' => 'Quittung statt Prüfprotokoll beim Kunden',
            'text'  => 'Nach der Annahme sieht dein Kunde am Ende des Dokuments nur noch einen kurzen Satz: wer wann angenommen hat. Prüfsumme, IP-Adresse und Browser stehen nur noch in deiner Fassung. Du öffnest sie bei der Offerte über „PDF mit Prüfprotokoll öffnen“, und sie liegt deiner Bestätigungsmail bei.',
        ],
        [
            'nr'    => 15,
            'datum' => '2026-09-24',
            'art'   => 'verbesserung',
            'fuer'  => ['cockpit', 'betreiber'],
            'titel' => 'Offerten ohne Code annehmen',
            'text'  => 'Nimmt der Kunde eine Offerte über die Adresse an, an die du sie geschickt hast, gilt die Annahme sofort, ohne Code per E-Mail. Den Code braucht es nur noch bei einer anderen Adresse und bei Verträgen.',
        ],
        [
            'nr'    => 14,
            'datum' => '2026-09-24',
            'art'   => 'fehlerbehebung',
            'fuer'  => ['betreiber'],
            'titel' => 'Einrichtung auf neuen, leeren Anlagen',
            'text'  => 'Auf einer frischen Datenbank, etwa einem neuen Vorratsplatz, brach die Einrichtung bei den Ereignismeldungen ab. Sie läuft jetzt vollständig durch. Ein Klick auf „Erneut versuchen“ holt nach, was fehlte.',
        ],
        [
            'nr'    => 13,
            'datum' => '2026-09-24',
            'art'   => 'fehlerbehebung',
            'fuer'  => ['cockpit', 'betreiber'],
            'titel' => 'Unterschriften stehen auf ihrer Grundlinie',
            'text'  => 'Die Buchstaben einer Unterschrift stehen jetzt auf der Linie, auch wenn eine Schlaufe weit nach unten reicht. Die Beschriftung darunter rückt entsprechend.',
        ],
        [
            'nr'    => 12,
            'datum' => '2026-09-24',
            'art'   => 'neu',
            'fuer'  => ['betreiber'],
            'titel' => 'Eigener Reiter für den Vorrat',
            'text'  => 'Unter Mandanten → Vorrat legst du vorbereitete Anlagen an, siehst je Platz, ob er bereit ist, und teilst ihn in einem Schritt einem neuen Kunden zu. Ein oranger Punkt am Reiter zeigt, wenn weniger als zwei Plätze bereit sind. Vorratsplätze stehen nicht mehr in der Mandantenliste.',
        ],
        [
            'nr'    => 11,
            'datum' => '2026-09-24',
            'art'   => 'verbesserung',
            'fuer'  => ['betreiber'],
            'titel' => 'Unterschrift als Bild hochladen',
            'text'  => 'Statt zu zeichnen kannst du in deinem Konto auch ein Bild deiner Unterschrift hochladen, etwa ein Bildschirmfoto aus Apple Vorschau. Der Hintergrund wird entfernt. Unterschriften stehen jetzt sauber auf der Linie.',
        ],
        [
            'nr'    => 10,
            'datum' => '2026-09-24',
            'art'   => 'neu',
            'fuer'  => ['betreiber'],
            'titel' => 'Deine Unterschrift auf Offerten und Verträgen',
            'text'  => 'Zeichne deine Unterschrift einmal unter Konten → dein Konto. Sie steht danach auf jeder Offerte und jedem Vertrag, die du freigibst. Ohne sie lässt sich nichts freigeben. Die Unterschrift des Kunden erscheint im PDF grösser und kräftiger.',
        ],
        [
            'nr'    => 9,
            'datum' => '2026-09-24',
            'art'   => 'fehlerbehebung',
            'fuer'  => ['betreiber'],
            'titel' => 'Updates erscheinen sofort und vollständig',
            'text'  => 'Das Update-Fenster kommt jetzt gleich beim Öffnen, auch wenn die Prüfung aller Mandanten noch läuft. Es zeigt jede Neuerung, auch die fürs Cockpit oder die App, mit dem Vermerk, wo sie gilt.',
        ],
        [
            'nr'    => 8,
            'datum' => '2026-09-23',
            'art'   => 'neu',
            'fuer'  => ['betreiber'],
            'titel' => 'Zugang per Einladung, Zeilen zum Ausklappen',
            'text'  => 'Den ersten Zugang eines Betriebs gibt es jetzt per Einladungslink an eine benannte Person, sieben Tage gültig. Unter „Einrichtung“ steht, ob die Einladung offen, eingelöst oder abgelaufen ist. Die Knöpfe in den Tabellen liegen neu in der ausgeklappten Zeile – ein Klick auf die Zeile öffnet sie.',
        ],
        [
            'nr'    => 7,
            'datum' => '2026-09-23',
            'art'   => 'neu',
            'fuer'  => ['cockpit', 'betreiber'],
            'titel' => 'Verlauf an jeder Offerte',
            'text'  => 'Unter dem Formular steht jetzt, wer die Offerte wann gesendet oder geändert hat und was der Empfänger getan hat: Code angefordert, angenommen, abgelehnt, Änderungswunsch.',
        ],
        [
            'nr'    => 6,
            'datum' => '2026-09-23',
            'art'   => 'fehlerbehebung',
            'fuer'  => ['cockpit'],
            'titel' => '„Neuer Einsatz“ fragt beim Revierdienst nach',
            'text'  => 'Fehlt einer eingeteilten Person die Revierdienst-Berechtigung, fragt die Maske jetzt nach, wie beim Bearbeiten eines Einsatzes. Mit „Trotzdem zuteilen“ wird der Einsatz angelegt.',
        ],
        [
            'nr'    => 5,
            'datum' => '2026-09-23',
            'art'   => 'verbesserung',
            'fuer'  => ['cockpit', 'betreiber'],
            'titel' => 'Updates mit Fortschrittsbalken',
            'text'  => '„Jetzt einspielen“ zeigt Schritt für Schritt, wie weit das Update ist. Danach steht nur noch da, was nicht geklappt hat.',
        ],
        [
            'nr'    => 4,
            'datum' => '2026-09-23',
            'art'   => 'verbesserung',
            'fuer'  => ['betreiber'],
            'titel' => 'Demo-Zugänge bekommen alle Rollen',
            'text'  => 'Ein neuer Demo-Zugang erhält jede Rolle. Bestehende Zugänge bekommen die fehlenden Rollen mit dem nächsten Einspielen des Updates.',
        ],
        [
            'nr'    => 3,
            'datum' => '2026-09-23',
            'art'   => 'fehlerbehebung',
            'fuer'  => ['cockpit'],
            'titel' => '„Neuer Einsatz“ nennt den Grund',
            'text'  => 'Lässt sich ein Einsatz nicht anlegen, steht jetzt der Grund da statt nur „Anlegen fehlgeschlagen“.',
        ],
        [
            'nr'    => 2,
            'datum' => '2026-09-23',
            'art'   => 'verbesserung',
            'fuer'  => ['cockpit', 'betreiber'],
            'titel' => 'Fehlende Rechte werden benannt',
            'text'  => 'Fehlt deiner Rolle ein Recht, steht jetzt da, welches, und welche Rolle es mitbringt.',
        ],
        [
            'nr'    => 1,
            'datum' => '2026-09-23',
            'art'   => 'neu',
            'fuer'  => ['cockpit', 'app', 'betreiber'],
            'titel' => 'Neuerungen erscheinen hier',
            'text'  => 'Was sich an GuardOpS ändert, siehst du ab jetzt in diesem Fenster, einmal pro Neuerung.',
        ],
    ];
}

function neuerungen_neueste(): int
{
    $hoechste = 0;
    foreach (neuerungen_katalog() as $n) { $hoechste = max($hoechste, (int)$n['nr']); }
    return $hoechste;
}

// Alles Ungelesene, gleich fuer welche Oberflaeche -- fuer den Betreiber
// (2026-09-24, Anordnung des Projektinhabers): Als Betreiberin der
// Plattform muss die pzu jedes ausgerollte Update sehen, auch eines, das
// nur im Cockpit oder in der App gilt. 'fuer' bleibt am Eintrag, damit das
// Fenster sagen kann, wo es gilt.
function neuerungen_alle(int $gesehenBis): array
{
    $aus = [];
    foreach (neuerungen_katalog() as $n) {
        if ((int)$n['nr'] <= $gesehenBis) { continue; }
        $aus[] = $n + ['art_titel' => NEUERUNG_ARTEN[$n['art']] ?? $n['art']];
    }
    usort($aus, static fn($a, $b) => (int)$b['nr'] <=> (int)$a['nr']);
    return $aus;
}

// Was diese Person noch nicht gesehen hat, fuer diese Oberflaeche, das
// Neueste zuerst. Mit dem Anzeigenamen der Art, damit keine Oberflaeche
// ihn ein zweites Mal fuehren muss.
function neuerungen_fuer(string $ziel, int $gesehenBis): array
{
    $aus = [];
    foreach (neuerungen_katalog() as $n) {
        if ((int)$n['nr'] <= $gesehenBis) { continue; }
        if (!in_array($ziel, $n['fuer'], true)) { continue; }
        $aus[] = $n + ['art_titel' => NEUERUNG_ARTEN[$n['art']] ?? $n['art']];
    }
    usort($aus, static fn($a, $b) => (int)$b['nr'] <=> (int)$a['nr']);
    return $aus;
}
