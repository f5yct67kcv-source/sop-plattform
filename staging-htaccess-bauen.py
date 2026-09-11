#!/usr/bin/env python3
"""Baut die fertige Staging-.htaccess zum Einfuegen bei Hostpoint.

WOZU: Die .htaccess auf Staging wird vom Deploy bewusst NICHT hochgeladen
(ENT-384) -- sonst entfernte jeder Deploy den Hostpoint-Passwortschutz. Sie
wird darum von Hand gepflegt, und das heisst bisher: im Web-Editor die Marke
suchen, alles darunter markieren, loeschen, den neuen Inhalt einfuegen. Genau
dort vertut man sich, und niemand merkt es -- eine .htaccess sagt nicht, dass
sie falsch ist, sie wirkt nur anders.

Dieses Skript nimmt die heruntergeladene Datei und gibt die vollstaendige
neue zurueck: oben der Passwortschutz unveraendert, darunter der aktuelle
Stand aus dem Repository. Einfuegen heisst dann: alles markieren, alles
ersetzen.

    python3 staging-htaccess-bauen.py <heruntergeladene .htaccess>

Ohne Argument wird nur der Teil UNTERHALB der Marke ausgegeben -- fuer den
Fall, dass jemand doch von Hand ersetzen will.

DIE AUSGABEDATEI GEHOERT NICHT INS REPOSITORY. Sie traegt den
Passwortschutz-Block von Hostpoint, und der geht niemanden etwas an. Der
Name steht darum in .gitignore.
"""
from pathlib import Path
import sys

# Die Marke setzt Hostpoint selbst. Oberhalb verwaltet der Passwortschutz
# sich selbst, unterhalb steht, was aus diesem Repository kommt.
#
# GESUCHT WIRD SIE ALS EIGENE ZEILE, nicht als Teilstring irgendwo im Text.
# Der Grund steht in htaccess-staging-zusatz Zeile 3: Dort wird die Marke in
# einem Kommentar ERWAEHNT. Eine Suche nach dem blossen Vorkommen faende sie
# darum in jeder echten Staging-.htaccess zweimal -- einmal als Trennmarke
# und einmal als Text in dem Block, den dieses Skript selbst geschrieben
# hat. Das Werkzeug haette sich damit ab dem zweiten Lauf selbst blockiert.
MARKE = '#@__HCP_END__@#'


def markenzeilen(text: str) -> list[int]:
    """Die Zeilennummern, in denen die Marke ALLEIN auf der Zeile steht."""
    return [i for i, z in enumerate(text.splitlines()) if z.strip() == MARKE]

# Die Reihenfolge ist nicht beliebig: htaccess-staging-zusatz gilt
# ausdruecklich "im Anschluss" an htaccess-hostpoint (ENT-387).
QUELLEN = ['htaccess-hostpoint', 'htaccess-staging-zusatz']
AUSGABE = Path('staging-htaccess-fertig.txt')


def unterer_teil() -> str:
    """Der Inhalt, der unterhalb der Marke stehen muss."""
    teile = []
    for name in QUELLEN:
        p = Path(name)
        if not p.exists():
            sys.exit(f'{name} fehlt -- im Repo-Wurzelverzeichnis ausfuehren.')
        teile.append(p.read_text(encoding='utf-8').rstrip('\n'))
    return '\n\n'.join(teile) + '\n'


def main() -> None:
    unten = unterer_teil()

    if len(sys.argv) < 2:
        # Kein Vorlagefile: nur den unteren Teil ausgeben. Das ist der Weg
        # fuer den, der doch von Hand ersetzen will -- er bekommt dasselbe,
        # was sonst unterhalb der Marke landet.
        AUSGABE.write_text(unten, encoding='utf-8')
        print(f'Nur der Teil UNTERHALB der Marke: {AUSGABE}')
        print('Fuer die vollstaendige Datei die heruntergeladene .htaccess '
              'als Argument mitgeben.')
        return

    vorlage = Path(sys.argv[1])
    if not vorlage.exists():
        sys.exit(f'{vorlage} gibt es nicht.')

    alt = vorlage.read_text(encoding='utf-8')

    # OHNE MARKE WIRD NICHTS GERATEN. Eine Datei ohne sie ist entweder nicht
    # die Staging-.htaccess oder eine, in der Hostpoint den Schutz anders
    # ablegt -- in beiden Faellen waere jede Annahme darueber, wo der eigene
    # Teil beginnt, eine Vermutung. Und eine falsch geratene Grenze nimmt
    # entweder den Passwortschutz weg oder laesst alte Regeln stehen.
    treffer = markenzeilen(alt)

    if not treffer:
        sys.exit(
            f'In {vorlage} steht die Marke {MARKE} nicht.\n\n'
            'Damit laesst sich nicht bestimmen, wo der Hostpoint-Passwortschutz\n'
            'endet und der eigene Teil beginnt -- und geraten wird das nicht.\n\n'
            'Pruefen: Ist das wirklich die .htaccess aus www/staging? Die von\n'
            'Production traegt die Marke nicht (dort laedt der Deploy die Datei\n'
            'selbst hoch, ein Nachtrag von Hand ist da gar nicht noetig).')

    if len(treffer) > 1:
        sys.exit(f'Die Marke {MARKE} steht {len(treffer)}-mal als eigene Zeile in '
                 f'{vorlage} (Zeilen {", ".join(str(i + 1) for i in treffer)}). '
                 'Das ist unerwartet -- bitte erst von Hand ansehen.')

    zeilen = alt.splitlines()
    kopf = '\n'.join(zeilen[:treffer[0] + 1])

    # DIREKT NACH DER MARKE KANN NOCH ETWAS VON HOSTPOINT STEHEN. In der
    # Praxis ist das die Zeile "# Anything after the comment above is left
    # alone" -- Hostpoints eigener Hinweis darauf, dass es ab hier nichts
    # mehr anfasst. Sie gehoert nicht uns, also ersetzen wir sie auch nicht.
    #
    # Erkannt wird sie daran, WO sie steht, nicht an ihrem Wortlaut -- ein
    # Wortlautvergleich verlöre sie stillschweigend, sobald Hostpoint sie
    # umformuliert.
    #
    # DIE GRENZE IST DIE ERSTE LEERZEILE, und das ist nicht willkuerlich:
    # Hostpoints Zeile klebt unmittelbar an der Marke, ohne Leerzeile
    # dazwischen. Alles, was WIR schreiben, setzt dieses Skript durch eine
    # Leerzeile ab. Ohne diese enge Grenze hielte die Schleife auch alte
    # Kommentare aus einem frueheren eigenen Block fuer fremd und liesse
    # sie stehen -- der alte Stand waere dann ergaenzt statt ersetzt.
    fremd = []
    for z in zeilen[treffer[0] + 1:]:
        if z.strip() == '' or not z.lstrip().startswith('#'):
            break
        fremd.append(z)
    if fremd:
        kopf = kopf + '\n' + '\n'.join(fremd)

    neu = kopf.rstrip('\n') + '\n\n' + unten
    AUSGABE.write_text(neu, encoding='utf-8')

    kopfZeilen = len(kopf.splitlines())
    untenZeilen = len(unten.splitlines())
    altUnten = len('\n'.join(zeilen[treffer[0] + 1:]).strip().splitlines())

    print(f'Geschrieben: {AUSGABE}')
    print(f'  Passwortschutz oben unveraendert uebernommen: {kopfZeilen} Zeilen')
    print(f'  Darunter ersetzt: {altUnten} Zeilen alt -> {untenZeilen} Zeilen neu')
    print()
    print('Bei Hostpoint: www/staging/.htaccess oeffnen, ALLES markieren,')
    print('durch den Inhalt dieser Datei ersetzen, speichern.')
    print()
    print('Danach die Gegenprobe -- eine gesperrte Datei gibt 403 zurueck,')
    print('eine ungesperrte 200 (und in beiden Faellen eine leere Seite):')
    print('  curl -sS -o /dev/null -w "%{http_code}\\n" \\')
    print('    -u \'<benutzer>:<passwort>\' https://<staging>/supportvorgang.php')


if __name__ == '__main__':
    main()
