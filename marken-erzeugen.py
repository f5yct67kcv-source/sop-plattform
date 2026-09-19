#!/usr/bin/env python3
"""Erzeugt die drei Kontrollpunkt-Marken fuer die NATIVE Karte (ENT-609).

WARUM UEBERHAUPT BILDER:

Auf der Browser-Karte ist eine Marke ein Vektorsymbol -- Farbe, Ring und
Zeichen entstehen zur Laufzeit aus rgPunktZustand(). Das native Maps-SDK
kann das nicht: Es nimmt fuer eine Marke ausschliesslich eine BILDDATEI.
Ohne Marken bleiben nur die Geofence-Kreise, und die haben den echten
Radius in Metern -- beim Herauszoomen werden sie kleiner als ein
Bildpunkt und sind schlicht nicht mehr zu sehen. Genau so vom
Projektinhaber gemeldet (2 Kontrollpunkte, Karte herausgezoomt, nichts zu
sehen). Eine Marke hat dagegen eine feste Groesse in Bildpunkten und
bleibt auf jeder Zoomstufe sichtbar.

OHNE NUMMERN (Entscheidung des Projektinhabers):

Die Browser-Fassung schreibt die Nummer des Punkts in die Marke. Das
hiesse hier: ein Bild je Nummer UND Zustand, also bei 40 Punkten 120
Dateien -- und bei Punkt 41 fehlte eines. Darum tragen die Marken nur den
ZUSTAND: offen, erledigt, abweichend. Drei Dateien, fertig. Die Nummer
steht in der Kontrollpunkt-Liste, und sie ist auf der Karte auch nicht
die Frage -- gefragt ist, wo der Punkt liegt und ob er erledigt ist.

WARUM VORERZEUGT UND MITVERSIONIERT:

Die Bilder entstehen hier einmal und liegen als gewoehnliche Dateien in
icons/. Sie beim Bauen zu erzeugen haette eine Bildbibliothek als
Voraussetzung fuer jeden Geraetelauf bedeutet -- fuer drei Dateien, die
sich nie von selbst aendern, ist das zu viel. icons/ wird vom Deploy und
von mobile-buendel-erstellen.py ohnehin vollstaendig mitkopiert.

Dass Skript und Ergebnis zusammenpassen, prueft test_rundgang_karte.mjs
-- dieselbe Bauart wie bei skizze.js/skizze-einbetten.py.

KEINE FREMDE BIBLIOTHEK: Pillow ist hier nicht vorausgesetzt. Ein PNG ist
zlib plus ein paar Bloecke, und die Formen sind Kreise und Balken. Die
Kanten entstehen durch vierfaches Ueberabtasten, nicht durch eine
Zeichenbibliothek.

Aufruf:  python3 marken-erzeugen.py
"""

import struct
import zlib
from pathlib import Path

# Dieselben Farben wie rgPunktZustand() in app.html -- die Marke auf der
# nativen Karte muss dasselbe sagen wie die auf der Browser-Karte.
OFFEN = (0x70, 0x98, 0xF7)
ERLEDIGT = (0x4F, 0xCE, 0x96)
ABWEICHEND = (0xE2, 0xB1, 0x56)
# Der dunkle Ring und das Zeichen darin: derselbe Ton wie der
# Kartenhintergrund der Nachtsicht, damit die Marke auf hellem wie auf
# dunklem Grund einen Rand hat.
DUNKEL = (0x0F, 0x11, 0x17)

# 96 x 96 bei dreifacher Aufloesung -- auf dem Schirm also 32 Punkte, etwa
# so gross wie die Marke der Browser-Fassung (Radius 13 plus Ring).
KANTE = 96
UEBER = 4  # vierfach ueberabgetastet, danach gemittelt


def _mischen(unten, oben, deckung):
    """Eine Farbe ueber eine andere legen. deckung von 0 bis 1."""
    return tuple(round(u + (o - u) * deckung) for u, o in zip(unten, oben))


class Bild:
    """Eine Flaeche in der vierfachen Aufloesung, die am Ende gemittelt wird.

    Gerechnet wird mit voller Deckung pro Unterpunkt; die weichen Kanten
    entstehen erst beim Mitteln. Das ist der ganze Trick und der Grund,
    warum hier keine Bibliothek noetig ist.
    """

    def __init__(self, kante, ueber):
        self.k = kante * ueber
        self.ueber = ueber
        self.kante = kante
        # RGBA je Unterpunkt, anfangs vollstaendig durchsichtig.
        self.punkte = [[(0, 0, 0, 0)] * self.k for _ in range(self.k)]

    def _setzen(self, x, y, farbe):
        self.punkte[y][x] = (*farbe, 255)

    def scheibe(self, cx, cy, r, farbe):
        """Gefuellter Kreis, in Punkten der GROBEN Aufloesung angegeben."""
        u = self.ueber
        cxu, cyu, ru = cx * u, cy * u, r * u
        von_y, bis_y = max(0, int(cyu - ru) - 1), min(self.k, int(cyu + ru) + 2)
        von_x, bis_x = max(0, int(cxu - ru) - 1), min(self.k, int(cxu + ru) + 2)
        for y in range(von_y, bis_y):
            for x in range(von_x, bis_x):
                if (x + 0.5 - cxu) ** 2 + (y + 0.5 - cyu) ** 2 <= ru * ru:
                    self._setzen(x, y, farbe)

    def balken(self, x1, y1, x2, y2, dicke, farbe):
        """Strecke mit runden Enden -- daraus bestehen Haken und Ausrufezeichen."""
        u = self.ueber
        ax, ay, bx, by = x1 * u, y1 * u, x2 * u, y2 * u
        r = dicke * u / 2
        laenge2 = (bx - ax) ** 2 + (by - ay) ** 2
        von_y = max(0, int(min(ay, by) - r) - 1)
        bis_y = min(self.k, int(max(ay, by) + r) + 2)
        von_x = max(0, int(min(ax, bx) - r) - 1)
        bis_x = min(self.k, int(max(ax, bx) + r) + 2)
        for y in range(von_y, bis_y):
            for x in range(von_x, bis_x):
                px, py = x + 0.5, y + 0.5
                if laenge2 == 0:
                    t = 0.0
                else:
                    t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / laenge2
                    t = 0.0 if t < 0 else 1.0 if t > 1 else t
                nx, ny = ax + t * (bx - ax), ay + t * (by - ay)
                if (px - nx) ** 2 + (py - ny) ** 2 <= r * r:
                    self._setzen(x, y, farbe)

    def mitteln(self):
        """Die Ueberabtastung zusammenfassen -- hier entstehen die weichen Kanten."""
        u = self.ueber
        felder = u * u
        zeilen = []
        for y in range(self.kante):
            zeile = bytearray()
            for x in range(self.kante):
                r = g = b = a = 0
                for dy in range(u):
                    for dx in range(u):
                        pr, pg, pb, pa = self.punkte[y * u + dy][x * u + dx]
                        # Mit der Deckung gewichtet, sonst zoege das
                        # Schwarz der durchsichtigen Punkte die Kante grau.
                        r += pr * pa
                        g += pg * pa
                        b += pb * pa
                        a += pa
                if a == 0:
                    zeile += bytes((0, 0, 0, 0))
                else:
                    zeile += bytes((round(r / a), round(g / a), round(b / a),
                                    round(a / felder)))
            zeilen.append(bytes(zeile))
        return zeilen


def png_schreiben(pfad, zeilen, kante):
    """Ein PNG von Hand: Kopf, Bilddaten, Ende. Mehr braucht es nicht."""
    roh = b''.join(b'\x00' + z for z in zeilen)  # Filtertyp 0 je Zeile

    def block(name, inhalt):
        return (struct.pack('>I', len(inhalt)) + name + inhalt
                + struct.pack('>I', zlib.crc32(name + inhalt) & 0xFFFFFFFF))

    kopf = struct.pack('>IIBBBBB', kante, kante, 8, 6, 0, 0, 0)  # 8 Bit, RGBA
    daten = (b'\x89PNG\r\n\x1a\n'
             + block(b'IHDR', kopf)
             + block(b'IDAT', zlib.compress(roh, 9))
             + block(b'IEND', b''))
    Path(pfad).write_bytes(daten)
    return len(daten)


def marke(farbe, zeichen):
    """Eine Marke: farbige Scheibe, dunkler Ring, dunkles Zeichen.

    Gebaut wie in der Browser-Fassung -- dort ist es ein Kreis mit
    2 Punkten dunklem Rand und dem Zeichen in #0F1117 darin.
    """
    b = Bild(KANTE, UEBER)
    mitte = KANTE / 2
    # Ring zuerst, Scheibe darueber: So bleibt aussen genau der Rand stehen.
    b.scheibe(mitte, mitte, mitte - 2, DUNKEL)
    b.scheibe(mitte, mitte, mitte - 8, farbe)
    if zeichen == 'haken':
        # Zwei Balken, die sich im unteren Drittel treffen.
        b.balken(30, 48, 42, 60, 9, DUNKEL)
        b.balken(42, 60, 66, 34, 9, DUNKEL)
    elif zeichen == 'ruf':
        b.balken(48, 28, 48, 54, 10, DUNKEL)
        b.scheibe(48, 66, 6, DUNKEL)
    # 'offen' traegt kein Zeichen -- die Nummer steht in der Liste, und
    # eine leere Scheibe sagt genau das Richtige: hier ist ein Punkt.
    return b.mitteln()


MARKEN = [
    ('icons/kp-offen.png', OFFEN, 'keins'),
    ('icons/kp-erledigt.png', ERLEDIGT, 'haken'),
    ('icons/kp-abweichend.png', ABWEICHEND, 'ruf'),
]

if __name__ == '__main__':
    import sys
    # Ein Zielordner laesst sich uebergeben. Die Pruefung erzeugt damit in
    # einen Wegwerf-Ordner und vergleicht -- ohne die echten Dateien
    # anzufassen. Dieselbe Bauart wie bei skizze-einbetten.py.
    wurzel = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent
    (wurzel / 'icons').mkdir(parents=True, exist_ok=True)
    for name, farbe, zeichen in MARKEN:
        ziel = wurzel / name
        groesse = png_schreiben(ziel, marke(farbe, zeichen), KANTE)
        print(f'{name}  {KANTE}x{KANTE}  {groesse} Bytes')
