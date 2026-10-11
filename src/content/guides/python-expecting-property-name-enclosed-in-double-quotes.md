---
title: "Expecting property name enclosed in double quotes in Python"
headline: "Fix Python's Expecting property name enclosed in double quotes, and the other dict and JSON errors"
description: "Why json.loads rejects a printed Python dict, what each JSONDecodeError and not JSON serializable message means, and the fix for each one."
topic: debugging
publishedOn: 2026-10-13
tools:
  - python-dict-to-json
  - json-to-python-dict
  - json-formatter
draft: true
---

<!--
MAINTAINER CHECKLIST: delete this whole comment before publishing (a test refuses to publish while it is here).
1. Replace the TODO(maintainer) paragraph under "From my own work" with an error you actually hit, in your own words.
2. Run any snippet you like in your own Python and compare. Every output quoted below was printed by
   Python 3.13.15 on Windows on 2026-10-11. The Python 3.12 trailing-comma message was produced by running
   CPython 3.12's own Lib/json/decoder.py; the requests lines by requests 2.34.2.
3. Read the page aloud (seo-rules §3A item 7) and change anything you would not say to a colleague.
4. Set publishedOn to the day you publish, then change draft to false.
-->

`json.loads` raises `Expecting property name enclosed in double quotes` when the text it gets is not JSON but a Python dict printed with `str()` or `print()`: `{'name': 'Ada'}` uses single quotes, and JSON only allows double quotes. Fix it where the text is made (`json.dumps(d)` instead of `str(d)`), or, if you only have the printed text, read it with `ast.literal_eval`. The same message also comes from a trailing comma on Python 3.12 and older, and the error's column number tells you which one you have.

## The short version

| Error | Usual cause | Fix |
|---|---|---|
| `Expecting property name enclosed in double quotes: line 1 column 2 (char 1)` | A printed Python dict (`str(d)`, a log line) | `json.dumps(d)` when writing; `ast.literal_eval(text)` when reading |
| The same message at the end of an object | A trailing comma, Python 3.12 or older | Remove the comma; 3.13 says `Illegal trailing comma` instead |
| `Expecting value: line 1 column 1 (char 0)` | Empty text, or an HTML error page instead of JSON | Check the status code and print `repr(text[:200])` |
| `Expecting value` pointing at `True`, `None` or `(` | Python literals inside otherwise JSON-looking text | `ast.literal_eval`, or produce it with `json.dumps` |
| `Unexpected UTF-8 BOM (decode using utf-8-sig)` | A file saved with a byte order mark | `open(path, encoding="utf-8-sig")` |
| `Extra data: line 2 column 1` | Several JSON documents, one per line (JSON Lines) | Parse line by line |
| `Object of type datetime is not JSON serializable` | A value JSON has no type for | `json.dumps(obj, default=...)` |
| `keys must be str, int, float, bool or None, not tuple` | A tuple used as a dict key | Turn the key into a string first |

## Expecting property name enclosed in double quotes

The text you are parsing came from Python's `str()`, not from `json.dumps()`. They look alike, which is why this error is so common:

```python
>>> d = {'name': 'Ada', 'active': True, 'manager': None}
>>> str(d)
"{'name': 'Ada', 'active': True, 'manager': None}"
>>> json.loads(str(d))
json.decoder.JSONDecodeError: Expecting property name enclosed in double quotes: line 1 column 2 (char 1)
```

`column 2 (char 1)` points at the first `'`, right after the `{`. JSON requires a double-quoted string as every object key, so the parser stops at the first key. An unquoted key, as in a JavaScript object literal (`{name: "Ada"}`), fails at exactly the same spot with the same message.

The usual sources are a dict written to a file or a queue with `str(d)` or an f-string, a value logged with `print(d)` and copied out of the logs, and a dict stored in a text column of a database.

If you control the code that writes the text, change it to `json.dumps(d)`. That is the only real fix: everything downstream then gets JSON. If all you have is the printed text, `ast.literal_eval` reads Python literal syntax safely (it does not run code) and gives you the dict back:

```python
>>> import ast, json
>>> text = "{'name': \"O'Brien\", 'active': True, 'manager': None}"
>>> json.dumps(ast.literal_eval(text))
'{"name": "O\'Brien", "active": true, "manager": null}'
```

The [Python Dict to JSON](/tools/python-dict-to-json) tool does the same conversion in the browser when the text is on your clipboard, including `True`/`False`/`None`, tuples, sets and trailing commas.

### The same message from a trailing comma

On Python 3.12 and older, a trailing comma inside an object raises this exact error too, and it is easy to waste time looking for single quotes that are not there:

```text
json.loads('{"a": 1, "b": 2,}')

Python 3.12: Expecting property name enclosed in double quotes: line 1 column 17 (char 16)
Python 3.13: Illegal trailing comma before end of object: line 1 column 16 (char 15)
```

The column is the giveaway. A printed dict fails at column 2, at the first key; a trailing comma fails at the very end of the object. Python 3.13 added the clearer message, and points at the comma itself. A trailing comma in a list was `Expecting value` before 3.13 and is now `Illegal trailing comma before end of array`.

## Why replacing single quotes with double quotes is not the fix

`text.replace("'", '"')` appears in a lot of answers. It works on the example in the question and breaks on real data, because an apostrophe inside a value gets replaced too:

```python
>>> s = str({'name': "O'Brien", 'city': 'Cork'})
>>> s
'{\'name\': "O\'Brien", \'city\': \'Cork\'}'
>>> json.loads(s.replace("'", '"'))
json.decoder.JSONDecodeError: Expecting ',' delimiter: line 1 column 13 (char 12)
```

`str()` switched to double quotes around `O'Brien` because the value contains a single quote, so after the replace the string ends early at `"O"` and the parser hits `Brien`. The replace also leaves `True` and `None` in place, which JSON does not have, so the next error is waiting even when no value has an apostrophe. `ast.literal_eval` has neither problem.

## Expecting value: line 1 column 1 (char 0)

There was nothing JSON-shaped at the very first character. In practice that is one of two things: the text is empty, or it is not JSON at all.

```python
>>> json.loads('')
json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
>>> json.loads('<!DOCTYPE html><html>')
json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
```

Over HTTP this usually means the server returned an error page, a login redirect or a `204 No Content` with an empty body, and the code called `.json()` without checking. With `requests`, `response.json()` raises `requests.exceptions.JSONDecodeError`, which is a subclass of `json.JSONDecodeError`, with the same message. Check `response.status_code` and `response.headers.get("Content-Type")` first, and when it still fails print `repr(response.text[:200])`: the first 200 characters, with `repr` so an empty string shows as `''` instead of nothing.

Text that is only spaces fails a few characters later: `json.loads('   ')` reports `line 1 column 4 (char 3)`.

## Expecting value at True, None or a tuple

The text is almost JSON, but contains Python values JSON has no spelling for:

```python
>>> json.loads('{"active": True, "manager": None}')
json.decoder.JSONDecodeError: Expecting value: line 1 column 12 (char 11)
```

Character 11 is the `T` of `True`. JSON spells these `true`, `false` and `null`, in lowercase. A tuple written as `(1, 2)` fails the same way at the `(`. These all come from the same place as the single quotes: something wrote `str(d)` where it should have written `json.dumps(d)`. Note that `json.dumps` turns a tuple into a JSON array, so `(1, 2)` comes back from `json.loads` as the list `[1, 2]`.

## Unexpected UTF-8 BOM and Extra data

A file saved by some Windows editors starts with a byte order mark, an invisible character before the `{`. Python names it in the error, along with the fix:

```python
>>> with open("data.json", encoding="utf-8") as f:
...     json.load(f)
json.decoder.JSONDecodeError: Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)
```

Opening with `encoding="utf-8-sig"` strips the mark if it is there and does nothing if it is not, so it is safe as a default for files from other people.

`Extra data` means one JSON value ended and more text followed. The common case is a JSON Lines file (one document per line, as many logging and export tools write), where `json.loads` on the whole file fails at `line 2 column 1 (char 9)`. Parse it a line at a time:

```python
>>> [json.loads(line) for line in text.splitlines() if line.strip()]
[{'a': 1}, {'a': 2}]
```

A `//` comment after the JSON gives `Extra data` too. JSON has no comments, so strip them before parsing.

## Object of type ... is not JSON serializable

`json.dumps` knows `dict`, `list`, `tuple`, `str`, `int`, `float`, `bool` and `None`. Anything else raises a `TypeError` naming the type: `set`, `datetime`, `Decimal`, `bytes` and `UUID` are the ones that usually turn up, from database rows and ORM objects. Pass a `default` function that converts each one the way you want:

```python
import base64, datetime, decimal, json, uuid

def to_json(o):
    if isinstance(o, datetime.date):  # datetime.datetime is a date too
        return o.isoformat()
    if isinstance(o, decimal.Decimal):
        return str(o)
    if isinstance(o, (set, frozenset)):
        return sorted(o)
    if isinstance(o, uuid.UUID):
        return str(o)
    if isinstance(o, bytes):
        return base64.b64encode(o).decode("ascii")
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")
```

For a row with one of each, `json.dumps(row, default=to_json)` printed:

```json
{"at": "2025-01-15T10:30:00", "price": "9.99", "tags": ["a", "b"], "id": "12345678-1234-5678-1234-567812345678", "raw": "AAE="}
```

The shortcut `default=str` also stops the error, but less precisely: it writes the datetime as `"2025-01-15 10:30:00"`, with a space where ISO 8601 has a `T`, and quietly turns any object you forgot about into its `repr` instead of failing. `Decimal` becomes a string either way, on purpose: converting it to `float` would turn `9.99` into a binary fraction that only looks like `9.99`.

## keys must be str, int, float, bool or None

JSON object keys are always strings. `json.dumps` converts number, boolean and `None` keys to strings for you, and refuses anything else:

```python
>>> json.dumps({(1, 2): 'a'})
TypeError: keys must be str, int, float, bool or None, not tuple
>>> json.loads(json.dumps({1: 'a'}))
{'1': 'a'}
```

The second line is the quieter problem: a dict with integer keys comes back from a round trip with string keys, so `d[1]` raises `KeyError` after loading. Convert the keys back explicitly (`{int(k): v for k, v in loaded.items()}`) when the keys are meant to be numbers. Mixing key types breaks `sort_keys=True` as well: `json.dumps({1: 'a', 'b': 2}, sort_keys=True)` raises `TypeError: '<' not supported between instances of 'str' and 'int'`.

## NaN is valid for Python, and invalid everywhere else

By default `json.dumps({'x': float('nan')})` writes `{"x": NaN}` without complaint, and `json.loads` reads it back. `NaN` is not JSON, though: JavaScript's `JSON.parse`, most other languages, and strict validators reject it. Pass `allow_nan=False` to find out before the other side does:

```python
>>> json.dumps({'x': float('nan')}, allow_nan=False)
ValueError: Out of range float values are not JSON compliant: nan
```

Then decide what the value should be, usually `None`. The [Python Dict to JSON](/tools/python-dict-to-json) tool writes `float('nan')` and `float('inf')` as `null` for this reason.

## Going the other way: JSON into Python source

`json.loads` is the right way to turn JSON text into a dict at runtime. When you want to paste a JSON response into a test or a fixture file as Python source, it has to be rewritten: `true`, `false` and `null` become `True`, `False` and `None`. `ast.literal_eval` cannot read JSON for the same reason in reverse; `ast.literal_eval('{"active": true}')` raises `ValueError: malformed node or string`. The [JSON to Python Dict](/tools/json-to-python-dict) tool does that rewrite, and the [JSON Formatter](/tools/json-formatter) shows the line and column of a syntax error before you go near Python.

## From my own work

TODO(maintainer): replace this paragraph with one real time you hit one of these errors, in your own words. Where did the text come from (a log line, a queue message, a database column, an API that returned HTML)? Which message did you get, and what did you check first? What was the actual cause, and what did you change so it does not happen again? Two or three short paragraphs is enough. This is the part no other page on the topic has.
