#!/usr/bin/env python3
"""Remove duplicate lines from a text file or a pasted list, keeping the first (or last) copy.

Does what the Remove Duplicate Lines tool at
https://parttoolhub.com/tools/remove-duplicate-lines does, with the same options:

    python remove_duplicate_lines.py emails.txt > unique.txt
    python remove_duplicate_lines.py --ignore-case --sort az < export.txt
    python remove_duplicate_lines.py --only-duplicates log.txt
    python remove_duplicate_lines.py --help

Or import it:  from remove_duplicate_lines import dedupe_lines

The count line ("N lines, M removed") goes to standard error, so a redirect keeps only the list.

Sorting reads digit runs as numbers and ignores case and accents (x2 before x10, A before b),
and orders punctuation the way a browser with an English locale does. Other languages' browsers
sort their own alphabets by their own rules; the order of the lines you keep never depends on it.

Python 3.9 or later, standard library only.
"""
import argparse
import re
import sys
import unicodedata
from collections import namedtuple

# What JavaScript's String.trim() removes. Python's str.strip() uses a different set (it drops
# U+001C to U+001F and U+0085, and keeps U+FEFF), so the set is spelled out here.
JS_WHITESPACE = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)
LINE_BREAK = re.compile(r"\r\n|\r|\n")
DIGITS = re.compile(r"[0-9]+")
# The order an English-locale browser sorts whitespace and ASCII punctuation in, all of it before
# digits and letters. Every kind of space (ordinary, no-break, ideographic ...) counts as the same
# one, and control and format characters (zero-width space, BOM) count for nothing.
SPACES = " \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000"
SORT_ORDER = ["\t", "\n", "\v", "\f", "\r", "\u0085", "\u2028", "\u2029", SPACES, *r"""_-,;:!?.'"()[]{}@*/\&#%`^+<=>|~$"""]
PLACE = {ch: place for place, group in enumerate(SORT_ORDER) for ch in group}

Result = namedtuple("Result", "output total unique removed")


def _sort_key(line):
    """One tuple per character, one per run of digits, so lines compare the way a person reads them."""
    key = []
    i = 0
    while i < len(line):
        digits = DIGITS.match(line, i)
        if digits:
            run = digits.group().lstrip("0")  # 007 and 7 are the same number
            key.append((1, len(run), run))
            i = digits.end()
            continue
        ch = line[i]
        i += 1
        category = unicodedata.category(ch)
        if category == "Cf" or (category == "Cc" and ch not in PLACE):
            continue
        if ch.isalpha():
            # Accents and case do not matter; a letter like ß counts as the two letters ss.
            folded = unicodedata.normalize("NFD", unicodedata.normalize("NFD", ch).casefold())
            key.extend((2, c, "") for c in folded if not unicodedata.combining(c))
        else:
            key.append((0, PLACE.get(ch, 1000 + ord(ch)), ""))
    return key


def dedupe_lines(text, ignore_case=False, trim=True, remove_blank=True, keep="first",
                 sort="none", only_duplicates=False):
    """Return Result(output, total, unique, removed). keep: "first" or "last". sort: "none", "az" or "za".

    total counts every line of the input, blank ones too. unique counts the distinct lines that
    were compared; removed is how many compared lines were repeats.
    """
    if not text:
        return Result("", 0, 0, 0)

    lines = LINE_BREAK.split(text)
    total = len(lines)
    if trim:
        lines = [line.strip(JS_WHITESPACE) for line in lines]
    if remove_blank:
        lines = [line for line in lines if line.strip(JS_WHITESPACE)]

    def key(line):
        return line.lower() if ignore_case else line

    counts = {}
    for line in lines:
        counts[key(line)] = counts.get(key(line), 0) + 1

    ordered = lines[::-1] if keep == "last" else lines
    seen = set()
    result = []
    for line in ordered:
        k = key(line)
        if k in seen:
            continue
        seen.add(k)
        if not only_duplicates or counts[k] > 1:
            result.append(line)
    if keep == "last":
        result.reverse()

    if sort == "az":
        result.sort(key=_sort_key)
    elif sort == "za":
        result.sort(key=_sort_key, reverse=True)

    unique = len(seen)
    return Result("\n".join(result), total, unique, len(lines) - unique)


def main():
    p = argparse.ArgumentParser(description="Remove duplicate lines, keeping one copy of each.")
    p.add_argument("file", nargs="?", help="file to read (default: standard input)")
    p.add_argument("--ignore-case", action="store_true", help="treat Apple and apple as the same line")
    p.add_argument("--no-trim", action="store_true", help="compare lines exactly, spaces included")
    p.add_argument("--keep-blank", action="store_true", help="keep blank lines (one survives)")
    p.add_argument("--keep", choices=["first", "last"], default="first", help="which copy survives")
    p.add_argument("--sort", choices=["none", "az", "za"], default="none", help="sort the result")
    p.add_argument("--only-duplicates", action="store_true", help="print one copy of each repeated line, nothing else")
    a = p.parse_args()

    if a.file:
        with open(a.file, encoding="utf-8", newline="") as f:
            text = f.read()
    else:
        sys.stdin.reconfigure(encoding="utf-8")
        text = sys.stdin.read()
    r = dedupe_lines(
        text,
        ignore_case=a.ignore_case,
        trim=not a.no_trim,
        remove_blank=not a.keep_blank,
        keep=a.keep,
        sort=a.sort,
        only_duplicates=a.only_duplicates,
    )
    sys.stdout.reconfigure(encoding="utf-8")
    if r.output:
        print(r.output)
    print(f"{r.unique} lines, {r.removed} removed", file=sys.stderr)


if __name__ == "__main__":
    main()
