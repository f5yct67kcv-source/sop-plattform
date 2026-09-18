<?php
declare(strict_types=1);
// Welche freien Funktionen ruft eine Datei auf? Eine Definition, nicht
// zwei: pruef_ladepfad.php braucht das, und der Unterprozess, den es
// startet, braucht genau dasselbe (Nachtrag zu ENT-612, 2026-09-18).
//
// Ausgeklammert wird, was wie ein Aufruf aussieht, aber keiner ist:
// Methoden ($x->f(), C::f()), Definitionen (function f()), "new Klasse()"
// und die Sprachkonstrukte, die function_exists() nicht kennt.

const LADEPFAD_KONSTRUKTE = ['array', 'isset', 'unset', 'empty', 'list', 'echo',
    'print', 'include', 'include_once', 'require', 'require_once', 'exit',
    'die', 'eval', 'match', 'fn', 'function', 'static', 'return', 'throw',
    'yield', 'clone', 'new', 'catch', 'if', 'elseif', 'while', 'for',
    'foreach', 'switch', 'and', 'or', 'xor', 'int', 'float', 'string',
    'bool', 'object', 'declare', 'use', 'parent', 'self'];

function ladepfad_aufrufe(string $pfad): array
{
    if (!is_file($pfad)) { return []; }
    $tokens = token_get_all((string)file_get_contents($pfad));
    $namen = [];
    $anzahl = count($tokens);
    $leer = [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT];
    for ($i = 0; $i < $anzahl; $i++) {
        if (!is_array($tokens[$i]) || $tokens[$i][0] !== T_STRING) { continue; }
        $j = $i + 1;
        while ($j < $anzahl && is_array($tokens[$j]) && in_array($tokens[$j][0], $leer, true)) { $j++; }
        if ($j >= $anzahl || $tokens[$j] !== '(') { continue; }
        $k = $i - 1;
        while ($k >= 0 && is_array($tokens[$k]) && in_array($tokens[$k][0], $leer, true)) { $k--; }
        if ($k >= 0 && is_array($tokens[$k])
            && in_array($tokens[$k][0], [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR,
                T_DOUBLE_COLON, T_FUNCTION, T_NEW, T_ATTRIBUTE], true)) { continue; }
        $name = strtolower((string)$tokens[$i][1]);
        if (in_array($name, LADEPFAD_KONSTRUKTE, true)) { continue; }
        $namen[$name] = true;
    }
    return array_keys($namen);
}
