#!/usr/bin/env python3
"""Entfernt die HTML-Kommentare aus ausgelieferten Rechtsseiten.

WARUM: Die Kommentarkoepfe dieser Seiten sind Arbeitsnotizen -- sie nennen
Entscheidungsnummern, interne Dateipfade, offene Pruefpunkte und, bei
nutzungsbedingungen.html, den Satz

    ENTWURF. NICHT RECHTLICH GEPRUEFT. NICHT OHNE FREIGABE LIVE NEHMEN.

Dargestellt wird davon nichts. Im Quelltext der ausgelieferten Seite steht
es trotzdem, und seit die Rechtstexte auch auf den Demo-Plaetzen liegen,
faende ein Interessent diesen Satz unter derselben Adresse, unter der wir
ihn eben noch zum Durchlesen gezwungen haben. Ansage des Projektinhabers
(2026-09-22): aus der ausgelieferten Datei nehmen.

NICHT AUS DEM REPOSITORY: Dort bleibt der Vermerk stehen, wo ihn sieht, wer
die Datei aendert -- genau dafuer ist er da. Entfernt wird er erst im
Buendel, also an der Kopie, die niemand mehr bearbeitet.

ALLE Kommentare, nicht nur der Entwurfsvermerk: Die uebrigen Koepfe tragen
dieselbe Sorte Inhalt, und eine Regel, die einen einzelnen Satz sucht,
haelt bis zur naechsten Umformulierung.

Aufruf (im Deploy, nach dem Kopieren -- die Vorlage im Repository bleibt
unberuehrt):

    python3 rechtstexte-ausliefern.py dist-guardops/nutzungsbedingungen.html ...
"""
import re
import sys

KOMMENTAR = re.compile(r'<!--.*?-->', re.S)


def saeubern(pfad: str) -> int:
    """Entfernt die Kommentare in der Datei. Gibt die Anzahl zurueck."""
    with open(pfad, encoding='utf-8') as f:
        vorher = f.read()
    anzahl = len(KOMMENTAR.findall(vorher))
    if anzahl == 0:
        return 0
    nachher = KOMMENTAR.sub('', vorher)
    # Die Leerzeile, die ein entfernter Kopf hinterlaesst, wegraeumen --
    # nicht aus Ordnungsliebe, sondern damit die Datei nach dem Saeubern
    # aussieht wie eine geschriebene und nicht wie eine beschnittene.
    nachher = re.sub(r'\n{3,}', '\n\n', nachher)
    with open(pfad, 'w', encoding='utf-8') as f:
        f.write(nachher)
    return anzahl


def main(argv: list) -> int:
    if len(argv) < 2:
        print('Aufruf: rechtstexte-ausliefern.py <datei> [<datei> ...]',
              file=sys.stderr)
        return 2
    fehler = 0
    for pfad in argv[1:]:
        try:
            anzahl = saeubern(pfad)
        except OSError as e:
            # Kein stilles Uebergehen: Eine Datei, die nicht gesaeubert
            # werden konnte, geht sonst mit ihrem Kommentarkopf hinaus, und
            # der Lauf bliebe gruen.
            print(f'FEHLER: {pfad} -- {e}', file=sys.stderr)
            fehler += 1
            continue
        print(f'{pfad}: {anzahl} Kommentar(e) entfernt')
    return 1 if fehler else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
