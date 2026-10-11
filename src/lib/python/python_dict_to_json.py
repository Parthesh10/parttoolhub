#!/usr/bin/env python3
"""Convert a printed Python dict (or list, tuple, set) into JSON.

Reads the same text the Python Dict to JSON converter at
https://parttoolhub.com/tools/python-dict-to-json reads, and writes the same JSON:

    python python_dict_to_json.py debug_output.txt > data.json
    python python_dict_to_json.py --indent 4 --sort-keys < pasted.txt
    python python_dict_to_json.py --help

Or import it:  from python_dict_to_json import python_to_json

Why not just json.dumps(ast.literal_eval(text))? That is the right call when the text is
plain literals, and this script gives the same JSON for those. It stops on what a debugger or
a log line often prints instead: OrderedDict([...]), Counter({...}), defaultdict(...),
nan, inf and float('nan'). This reads those too, never runs any code, keeps sets in the
order they were written (Python's set order changes between runs), and writes NaN and
Infinity as null, since JSON has no way to write them.

Python 3.9 or later, standard library only.
"""
import argparse
import json
import re
import sys

STRING_START = re.compile(r"([rRbBuUfF]{0,2})(['\"])")
NUMBER = re.compile(
    r"0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+"
    r"|(?:[0-9][0-9_]*)?\.?[0-9][0-9_]*(?:[eE][+-]?[0-9][0-9_]*)?j?"
)
NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
HEX = re.compile(r"[0-9a-fA-F]*")
OCTAL = re.compile(r"[0-7]{1,3}")
SIMPLE_ESCAPES = {
    "n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v",
    "\\": "\\", "'": "'", '"': '"', "a": "\a",
}
PUNCTUATION = "{}[](),:-+"
SURROGATE = re.compile("[" + chr(0xD800) + "-" + chr(0xDFFF) + "]")


class PyLiteralError(ValueError):
    """The text is not a Python literal this converter can read. `position` is a character offset."""

    def __init__(self, message, position):
        super().__init__(message)
        self.message = message
        self.position = position


def _join_surrogates(s):
    # A surrogate pair written as two escapes (high half, then low half) is one character, not two broken halves.
    if not SURROGATE.search(s):
        return s
    return s.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass")


def tokenize(src):
    """Split the text into (kind, value, position) tuples: str, num, name, p (punctuation), eof."""
    toks = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        start = i
        if c in " \t\n\r":
            i += 1
            continue
        if c == "#":
            while i < n and src[i] != "\n":
                i += 1
            continue

        m = STRING_START.match(src, i)
        if m:
            prefix = m.group(1)
            raw = "r" in prefix.lower()
            is_bytes = "b" in prefix.lower()
            i += len(prefix)
            q = src[i]
            closer = q * 3 if src.startswith(q * 3, i) else q
            i += len(closer)
            body_start = i
            out = []
            while True:
                if i >= n:
                    raise PyLiteralError("Unterminated string.", body_start)
                if src.startswith(closer, i):
                    i += len(closer)
                    break
                ch = src[i]
                if ch == "\\" and i + 1 < n:
                    nxt = src[i + 1]
                    if raw:
                        out.append(ch + nxt)
                        i += 2
                        continue
                    if nxt == "\n":  # line continuation
                        i += 2
                        continue
                    hex_len = 2 if nxt == "x" else 0 if is_bytes else 4 if nxt == "u" else 8 if nxt == "U" else 0
                    if hex_len:
                        digits = src[i + 2:i + 2 + hex_len]
                        if len(digits) != hex_len or HEX.fullmatch(digits) is None:
                            raise PyLiteralError(f"A \\{nxt} escape needs exactly {hex_len} hex digits.", i)
                        code = int(digits, 16)
                        if code > 0x10FFFF:
                            raise PyLiteralError("A \\U escape cannot go past 0010FFFF, the last Unicode code point.", i)
                        out.append(chr(code))
                        i += 2 + hex_len
                        continue
                    octal = OCTAL.match(src, i + 1, i + 4)
                    if octal:
                        out.append(chr(int(octal.group(), 8)))
                        i += 1 + len(octal.group())
                        continue
                    if nxt in SIMPLE_ESCAPES:
                        out.append(SIMPLE_ESCAPES[nxt])
                        i += 2
                        continue
                    out.append(ch + nxt)  # an unknown escape keeps its backslash, as in Python
                    i += 2
                    continue
                if len(closer) == 1 and ch == "\n":
                    raise PyLiteralError("Unterminated string (newline inside quotes).", body_start)
                out.append(ch)
                i += 1
            toks.append(("str", "".join(out), start))
            continue

        m = NUMBER.match(src, i)
        if m and m.group()[:1] in tuple("0123456789."):
            text = m.group().replace("_", "")
            if text.endswith("j"):
                raise PyLiteralError("Complex numbers have no JSON equivalent.", i)
            if re.fullmatch(r"0[xXoObB]", text):
                raise PyLiteralError("A number prefix with no digits after it.", i)
            if re.match(r"0[xXoObB].", text):
                value = int(text[2:], {"x": 16, "o": 8, "b": 2}[text[1].lower()])
            elif re.fullmatch(r"[0-9]+", text):
                value = int(text, 10)  # leading zeros allowed here, unlike Python source
            else:
                value = float(text)
            toks.append(("num", value, start))
            i += len(m.group())
            continue

        m = NAME.match(src, i)
        if m:
            toks.append(("name", m.group(), start))
            i += len(m.group())
            continue
        if c in PUNCTUATION:
            toks.append(("p", c, start))
            i += 1
            continue
        raise PyLiteralError(f'Unexpected character "{c}".', i)
    toks.append(("eof", None, n))
    return toks


def _key(value, position):
    """Dict keys become JSON strings the way json.dumps converts them."""
    if isinstance(value, str):
        return value
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    raise PyLiteralError("Dictionary keys must be strings, numbers, booleans or None to become JSON.", position)


def _number(value):
    # JSON has no NaN or Infinity: they become null.
    if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
        return None
    return value


class _Parser:
    def __init__(self, toks):
        self.toks = toks
        self.i = 0

    def peek(self):
        return self.toks[self.i]

    def next(self):
        tok = self.toks[self.i]
        if tok[0] != "eof":  # never step past the end
            self.i += 1
        return tok

    def is_p(self, v):
        kind, value, _ = self.peek()
        return kind == "p" and value == v

    def pos(self):
        return self.peek()[2]

    def expect_p(self, v):
        if not self.is_p(v):
            raise PyLiteralError(f'Expected "{v}".', self.pos())
        self.i += 1

    def parse_top(self):
        value = self.parse_value()
        if self.peek()[0] != "eof":
            raise PyLiteralError("Unexpected content after the end of the value.", self.pos())
        return value

    def parse_value(self):
        kind, value, position = self.peek()
        if kind == "p":
            if value == "{":
                return self.parse_braces()
            if value in "[(":
                self.next()
                return self.parse_sequence("]" if value == "[" else ")")
            if value in "-+":
                self.next()
                n_kind, number, n_pos = self.next()
                if n_kind != "num":
                    raise PyLiteralError("Expected a number after the sign.", n_pos)
                return _number(-number if value == "-" else number)
        if kind == "str":
            parts = []
            while self.peek()[0] == "str":  # adjacent literals concatenate: 'a' 'b' is 'ab'
                parts.append(self.next()[1])
            return _join_surrogates("".join(parts))
        if kind == "num":
            self.next()
            return _number(value)
        if kind == "name":
            self.next()
            if value in ("True", "False"):
                return value == "True"
            if value in ("None", "nan", "inf"):
                return None
            if value == "float":  # float('nan'), float('inf')
                self.expect_p("(")
                self.next()
                self.expect_p(")")
                return None
            if value in ("set", "frozenset", "list", "tuple", "dict"):
                self.expect_p("(")
                inner = ({} if value == "dict" else []) if self.is_p(")") else self.parse_value()
                self.expect_p(")")
                return inner
            if value in ("OrderedDict", "defaultdict", "Counter"):
                self.expect_p("(")
                inner = {}
                while not self.is_p(")"):
                    v = self.parse_value()
                    if isinstance(v, dict):
                        inner = v
                    # OrderedDict's repr is a list of (key, value) pairs: OrderedDict([('a', 1)])
                    elif isinstance(v, list) and all(isinstance(p, list) and len(p) == 2 for p in v):
                        inner = {}
                        for k, item in v:
                            inner[_key(k, self.pos())] = item
                    if self.is_p(","):
                        self.next()
                self.expect_p(")")
                return inner
            raise PyLiteralError(f'"{value}" is a variable or unsupported name; JSON can only hold literal values.', position)
        if kind == "eof":
            raise PyLiteralError("Unexpected end of input.", position)
        raise PyLiteralError(f'Unexpected "{value}".', position)

    def parse_sequence(self, closer):
        out = []
        comma = False
        while not self.is_p(closer):
            out.append(self.parse_value())
            if self.is_p(","):
                self.next()
                comma = True
                continue
            if not self.is_p(closer):
                raise PyLiteralError(f'Expected "," or "{closer}".', self.pos())
        self.next()
        if closer == ")" and len(out) == 1 and not comma:
            return out[0]  # (1) is just 1 in brackets; only (1,) is a tuple
        return out  # tuples and sets become lists: JSON only has arrays

    def parse_braces(self):
        self.expect_p("{")
        if self.is_p("}"):
            self.next()
            return {}
        first = self.parse_value()
        if self.is_p(":"):
            self.next()
            obj = {_key(first, self.pos()): self.parse_value()}
            while self.is_p(","):
                self.next()
                if self.is_p("}"):
                    break
                k = self.parse_value()
                self.expect_p(":")
                obj[_key(k, self.pos())] = self.parse_value()
            self.expect_p("}")
            return obj
        items = [first]  # a set, kept in the order it was written
        while self.is_p(","):
            self.next()
            if self.is_p("}"):
                break
            items.append(self.parse_value())
        self.expect_p("}")
        return items


def line_column(src, position):
    before = src[:position]
    return before.count("\n") + 1, position - before.rfind("\n")


def python_to_json(src, indent=2, sort_keys=False):
    """Return JSON text for a Python literal. indent: 2, 4, "tab", or 0 for one compact line.

    Raises PyLiteralError (a ValueError) with a message and a character position.
    """
    if not src.strip():
        raise PyLiteralError("Paste a Python dict, list or other literal.", 0)
    value = _Parser(tokenize(src)).parse_top()
    if indent == 0:
        text = json.dumps(value, ensure_ascii=False, sort_keys=sort_keys, separators=(",", ":"))
    else:
        text = json.dumps(value, ensure_ascii=False, sort_keys=sort_keys, indent="\t" if indent == "tab" else indent)
    # A lone surrogate cannot be written as UTF-8, so it stays escaped, as a browser writes it.
    return SURROGATE.sub(lambda m: "\\u%04x" % ord(m.group()), text)


def main():
    p = argparse.ArgumentParser(description="Convert a printed Python dict, list or other literal into JSON.")
    p.add_argument("file", nargs="?", help="file to read (default: standard input)")
    p.add_argument("--indent", choices=["2", "4", "tab", "0"], default="2", help="indent; 0 writes one compact line")
    p.add_argument("--sort-keys", action="store_true", help="sort every object's keys")
    a = p.parse_args()

    if a.file:
        with open(a.file, encoding="utf-8", newline="") as f:
            src = f.read()
    else:
        sys.stdin.reconfigure(encoding="utf-8")
        src = sys.stdin.read()
    try:
        out = python_to_json(src, indent=a.indent if a.indent == "tab" else int(a.indent), sort_keys=a.sort_keys)
    except PyLiteralError as e:
        line, column = line_column(src, e.position)
        sys.exit(f"error: {e.message} (line {line}, column {column})")
    sys.stdout.reconfigure(encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
