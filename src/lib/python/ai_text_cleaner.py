#!/usr/bin/env python3
"""Clean up text copied from ChatGPT, Claude, Gemini and other AI assistants.

Runs the same steps, in the same order and with the same defaults, as the
AI Text Cleaner at https://parttoolhub.com/tools/ai-text-cleaner

    python ai_text_cleaner.py answer.md > clean.txt
    python ai_text_cleaner.py --em-dash hyphen --keep-citations < answer.md
    python ai_text_cleaner.py --help

Or import it:  from ai_text_cleaner import clean_text

Python 3.9 or later, standard library only. The optional --remove-emoji step also needs
`pip install regex`, because the built-in re module has no emoji classes.
"""
import argparse
import re
import sys

# The web tool runs on JavaScript, whose idea of whitespace differs from
# Python's \s (JavaScript counts the BOM, Python counts \x1c-\x1f), so it is
# spelled out here and used wherever the tool's patterns say \s or \S.
JS_SPACE = (
    "\t\n\v\f\r \u00a0\u1680"
    + "".join(chr(c) for c in range(0x2000, 0x200B))
    + "\u2028\u2029\u202f\u205f\u3000\ufeff"
)
SPACE = "[" + JS_SPACE + "]"
NOT_SPACE = "[^" + JS_SPACE + "]"

# Zero-width joins, marks and BOM: removed (they have no width).
ZERO_WIDTH = r"[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u00ad\u180e]"
# Non-breaking and typographic spaces: they do have width, so they become " ".
UNICODE_SPACE = r"[\u00a0\u2000-\u200a\u202f\u205f\u3000]"
# C0/C1 control characters other than tab and newline.
CONTROL = r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]"

EMOJI = (
    r"(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})[\ufe0e\ufe0f]?"
    r"(?:\u200d(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})[\ufe0e\ufe0f]?)*"
    r"|[\U0001f1e6-\U0001f1ff]{2}"  # flag pairs
    r"|[#*0-9]\ufe0f?\u20e3"  # keycaps
)

DASHES = {"comma": ", ", "hyphen": "-", "spaced-hyphen": " - ", "space": " ", "keep": None}
# Curly, low, angle and prime quotation marks, by code point, to straight ones.
QUOTES = str.maketrans(
    dict.fromkeys(map(chr, [0x201C, 0x201D, 0x201E, 0x201F, 0x00AB, 0x00BB, 0x2033]), '"')
    | dict.fromkeys(map(chr, [0x2018, 0x2019, 0x201A, 0x201B, 0x2032]), "'")
)
M = re.MULTILINE


def remove_invisible(t):
    t = re.sub(ZERO_WIDTH, "", t)
    t = re.sub(UNICODE_SPACE, " ", t)
    return re.sub(CONTROL, "", t)


def strip_markdown(t, normalize_bullets=True):
    t = re.sub(r"^[ \t]*```[^\n]*\n?", "", t, flags=M)  # fence lines (code kept)
    t = re.sub(r"^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$", r"\1", t, flags=M)  # headings
    # Table separator rows (|---|:--:|) go with their newline.
    t = re.sub(r"^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*\n?", "", t, flags=M)
    t = re.sub(r"^[ \t]*(?:[-=*_][ \t]*){3,}$", "", t, flags=M)  # rules, setext underlines
    t = re.sub(r"!\[([^\[\]]*)\]\([^)]*\)", r"\1", t)  # images: keep the alt text
    t = re.sub(r"\[([^\[\]]+)\]\([^)]*\)", r"\1", t)  # links: keep the label
    # Bold, italic, strikethrough: the marker must touch the text on the inside.
    t = re.sub(r"(\*\*\*|___)(?=" + NOT_SPACE + r")([\s\S]*?" + NOT_SPACE + r")\1", r"\2", t)
    t = re.sub(r"(\*\*|__)(?=" + NOT_SPACE + r")([\s\S]*?" + NOT_SPACE + r")\1", r"\2", t)
    t = re.sub(r"(?<![A-Za-z0-9_*])\*(?=" + NOT_SPACE + r")([^*\n]*?" + NOT_SPACE + r")\*(?![A-Za-z0-9_*])", r"\1", t)
    t = re.sub(r"(?<![A-Za-z0-9_])_(?=" + NOT_SPACE + r")([^_\n]*?" + NOT_SPACE + r")_(?![A-Za-z0-9_])", r"\1", t)
    t = re.sub(r"~~(?=" + NOT_SPACE + r")([\s\S]*?" + NOT_SPACE + r")~~", r"\1", t)
    t = re.sub(r"`([^`\n]+)`", r"\1", t)  # inline code
    t = re.sub(r"^[ \t]*>[ \t]?", "", t, flags=M)  # blockquotes
    t = re.sub(r"^[ \t]*\|[ \t]*|[ \t]*\|[ \t]*$", "", t, flags=M)  # outer table pipes
    t = re.sub(r"[ \t]*\|[ \t]*", " ", t)  # inner table pipes
    if normalize_bullets:
        t = re.sub(r"^([ \t]*)[*+][ \t]+", r"\1- ", t, flags=M)
    return re.sub(r"^([ \t]*[-*+][ \t]+)\[[ xX]\][ \t]+", r"\1", t, flags=M)  # task boxes


def remove_citations(t):
    t = re.sub(r"\[\^?[0-9]+(?:" + SPACE + r"*[,\N{EN DASH}-]" + SPACE + r"*[0-9]+)*\]", "", t)  # [1] [2, 3] [^4]
    t = re.sub(r"\u3010[^\u3011\n]*\u3011", "", t)  # ChatGPT's lenticular-bracket sources
    return re.sub(r"\[(?:citation needed|source|ref)\]", "", t, flags=re.I | re.A)


def replace_dashes(t, mode):
    rep = DASHES[mode]
    t = re.sub(r"([0-9])[ \t]*[\N{EN DASH}\N{EM DASH}][ \t]*([0-9])", r"\1-\2", t)  # number ranges: 2010-2020
    t = re.sub(r"[ \t]*\N{EM DASH}[ \t]*", rep, t)
    en = " - " if mode == "comma" else rep
    t = re.sub(r"(?<=" + NOT_SPACE + r")[ \t]*\N{EN DASH}[ \t]*(?=" + NOT_SPACE + r")", en, t)  # en dash between words
    if mode == "comma":
        t = re.sub(r", ([,.;:!?])", r"\1", t)  # no ", ." when a dash ended the sentence
    return t


def remove_emoji(t):
    try:
        import regex
    except ImportError:
        sys.exit("Removing emoji needs the regex module: pip install regex")
    return regex.sub(EMOJI, "", t)


def tidy_whitespace(t):
    t = re.sub(r"[ \t]+$", "", t, flags=M)
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r" +([,.;:!?])", r"\1", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip(JS_SPACE)


def clean_text(text, *, markdown=True, normalize_bullets=True, em_dash="comma",
               straighten_quotes=True, invisible=True, emoji=False, citations=True,
               ellipsis=True, whitespace=True):
    """Return the cleaned text. The defaults match the web tool's."""
    if em_dash not in DASHES:
        raise ValueError("em_dash must be one of: " + ", ".join(DASHES))
    t = re.sub(r"\r\n?", "\n", text)
    if invisible:
        t = remove_invisible(t)
    if markdown:
        t = strip_markdown(t, normalize_bullets)
    if citations:
        t = remove_citations(t)
    if straighten_quotes:
        t = t.translate(QUOTES)
    if em_dash != "keep":
        t = replace_dashes(t, em_dash)
    if ellipsis:
        t = t.replace("\u2026", "...")
    if emoji:
        t = remove_emoji(t)
    if whitespace:
        t = tidy_whitespace(t)
    return t


def main():
    p = argparse.ArgumentParser(description="Clean up text copied from an AI assistant.")
    p.add_argument("file", nargs="?", help="file to clean (default: standard input)")
    p.add_argument("--em-dash", choices=list(DASHES), default="comma", help="what an em dash becomes")
    p.add_argument("--keep-markdown", action="store_true", help="leave Markdown symbols in")
    p.add_argument("--keep-bullets", action="store_true", help="leave * and + bullets as they are")
    p.add_argument("--keep-quotes", action="store_true", help="leave curly quotes curly")
    p.add_argument("--keep-ellipsis", action="store_true", help="leave the ellipsis character")
    p.add_argument("--keep-invisible", action="store_true", help="leave zero-width and other invisible characters")
    p.add_argument("--keep-citations", action="store_true", help="leave [1]-style citation markers")
    p.add_argument("--keep-whitespace", action="store_true", help="leave extra spaces and blank lines")
    p.add_argument("--remove-emoji", action="store_true", help="remove emoji (needs: pip install regex)")
    a = p.parse_args()

    if a.file:
        with open(a.file, encoding="utf-8", newline="") as f:
            text = f.read()
    else:
        sys.stdin.reconfigure(encoding="utf-8")
        text = sys.stdin.read()
    sys.stdout.reconfigure(encoding="utf-8")
    print(clean_text(
        text,
        markdown=not a.keep_markdown,
        normalize_bullets=not a.keep_bullets,
        em_dash=a.em_dash,
        straighten_quotes=not a.keep_quotes,
        invisible=not a.keep_invisible,
        emoji=a.remove_emoji,
        citations=not a.keep_citations,
        ellipsis=not a.keep_ellipsis,
        whitespace=not a.keep_whitespace,
    ))


if __name__ == "__main__":
    main()
