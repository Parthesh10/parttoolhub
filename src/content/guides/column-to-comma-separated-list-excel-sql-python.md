---
title: "Column to Comma-Separated List in Excel, SQL and Python"
headline: "Turn a column into a comma-separated list in Excel, Google Sheets, SQL and Python"
description: "TEXTJOIN, string_agg, GROUP_CONCAT and a few lines of Python for joining a column into one list, plus the blank-cell, date, comma and length traps."
topic: data-formats
publishedOn: 2026-10-05
tools:
  - column-to-comma-separated-list
  - comma-separated-list-to-column
  - remove-duplicate-lines
draft: true
---

<!--
MAINTAINER CHECKLIST: delete this whole comment before publishing (a test refuses to publish while it is here).
1. Replace the TODO(maintainer) paragraph under "From my own work" with a real case, in your own words.
2. Try every Excel formula in Excel (365; 2019 too if you have it) and every Sheets formula in Google Sheets.
   Also confirm: a range copied from Excel ends with one extra line break; TEXT() on an empty cell gives 1900-01-00.
3. If you can reach PostgreSQL, MySQL or SQL Server, run those queries once. If not, tell Claude and that
   section gets rewritten to cite the official docs instead of implying it was run.
4. Read the page aloud (seo-rules §3A item 7) and change anything you would not say to a colleague.
5. Set publishedOn to the day you publish, then change draft to false.
The Python and SQLite snippets were run on 2026-09-25 (Python 3.13, SQLite 3.50) and printed the outputs quoted below.
-->

You have a column of values and you need one line: `a, b, c` for an email, `('a', 'b', 'c')` for a SQL `IN` clause, `["a", "b", "c"]` for code. Excel, Google Sheets, every major database and Python can all do it in one line. They also all break on the same inputs: blank cells, dates, values that contain a comma or a quote, and lists longer than a cell or a query can hold.

## The short version

| Where | Formula or code |
|---|---|
| Excel 2019, 2021, 365 | `=TEXTJOIN(", ", TRUE, A2:A100)` |
| Google Sheets | `=TEXTJOIN(", ", TRUE, A2:A)` |
| PostgreSQL | `SELECT string_agg(email, ', ') FROM users;` |
| MySQL, MariaDB | `SELECT GROUP_CONCAT(email SEPARATOR ', ') FROM users;` |
| SQL Server 2017+ | `SELECT STRING_AGG(email, ', ') FROM users;` |
| SQLite | `SELECT group_concat(email, ', ') FROM users;` |
| Python | `", ".join(items)` |

If the column is already on your clipboard, the [Column to Comma Separated List](/tools/column-to-comma-separated-list) tool does the same in the browser: paste, pick a preset such as **SQL IN** or **Python list**, copy the result.

## Excel: TEXTJOIN

`TEXTJOIN(delimiter, ignore_empty, range)` joins a range with a separator. The second argument is the one people leave out: `TRUE` skips empty cells, `FALSE` keeps them as empty items (`a, , b`).

```
=TEXTJOIN(", ", TRUE, A2:A100)
```

To wrap each value in quotes for SQL, build the quoted values inside the formula:

```
=TEXTJOIN(", ", TRUE, "'" & A2:A100 & "'")
```

That version has a catch. `"'" & A2:A100 & "'"` turns an empty cell into `''`, which is not empty, so `TRUE` no longer skips it. In Excel 365 and 2021, filter the blanks out first:

```
=TEXTJOIN(", ", TRUE, "'" & FILTER(A2:A100, A2:A100<>"") & "'")
```

Excel 2019 has no `FILTER`. Select a range without blank cells instead, and confirm the formula with Ctrl+Shift+Enter so Excel treats the range as an array rather than reading a single cell.

## Google Sheets

Sheets has `TEXTJOIN` with the same arguments, and it takes an open-ended range such as `A2:A`, so the formula keeps working as rows are added:

```
=TEXTJOIN(", ", TRUE, A2:A)
```

For quoted values, wrap the formula in `ARRAYFORMULA` so the `&` applies to every cell:

```
=ARRAYFORMULA(TEXTJOIN(", ", TRUE, "'" & FILTER(A2:A, A2:A<>"") & "'"))
```

`JOIN(", ", A2:A10)` also exists in Sheets, but it has no switch for blanks, so pointing it at an open range like `A2:A` leaves a long tail of separators.

## SQL: string_agg, GROUP_CONCAT and STRING_AGG

Every major database has an aggregate that joins a column into one string. The names differ, and so do the limits.

PostgreSQL:

```sql
SELECT string_agg(email, ', ' ORDER BY email) FROM users;
```

When the result is going to be pasted into another query, `quote_literal()` adds the quotes and escapes any quote inside a value:

```sql
SELECT '(' || string_agg(quote_literal(email), ', ') || ')' FROM users;
```

MySQL and MariaDB:

```sql
SELECT GROUP_CONCAT(email ORDER BY email SEPARATOR ', ') FROM users;
```

`GROUP_CONCAT` stops at `group_concat_max_len`, which defaults to 1024 bytes. Past that it cuts the result off and raises only a warning, so a list of a few hundred IDs comes back incomplete without an error. Raise the limit for the session first:

```sql
SET SESSION group_concat_max_len = 1000000;
```

SQL Server 2017 and later:

```sql
SELECT STRING_AGG(email, ', ') WITHIN GROUP (ORDER BY email) FROM users;
```

If `email` is a `varchar(n)` or `nvarchar(n)` column, the result is capped at 8,000 bytes and the query fails once it goes over. Cast the input to `nvarchar(max)` to lift the cap:

```sql
SELECT STRING_AGG(CAST(email AS nvarchar(max)), ', ') FROM users;
```

SQLite:

```sql
SELECT group_concat(email, ', ') FROM users;
```

## Python

Read the column from a file, drop blank lines, join:

```python
from pathlib import Path

lines = Path("column.txt").read_text(encoding="utf-8").splitlines()
items = [line.strip() for line in lines if line.strip()]
print(", ".join(items))
```

`splitlines()` copes with Windows line endings, which matters because a range copied out of Excel uses them and ends with one more line break after the last cell.

To drop duplicates and keep the original order (or run the column through [Remove Duplicate Lines](/tools/remove-duplicate-lines) first):

```python
items = list(dict.fromkeys(items))
```

For a one-off query in a SQL console, quote each value and double any single quote inside it, which is how SQL escapes one:

```python
quoted = ", ".join("'" + item.replace("'", "''") + "'" for item in items)
print(f"({quoted})")
```

With a column holding `o'brien@example.com`, that prints `('ana@example.com', 'ben@example.com', 'Smith, John', 'o''brien@example.com')`.

In application code, keep the values out of the SQL text altogether. Pass them as parameters and generate only the placeholders:

```python
placeholders = ", ".join("?" for _ in items)
rows = conn.execute(f"SELECT email FROM users WHERE email IN ({placeholders})", items).fetchall()
```

`?` is the `sqlite3` placeholder; psycopg and most MySQL drivers use `%s`. PostgreSQL allows at most 65,535 parameters in one statement, so for tens of thousands of values, load them into a temporary table and join against it.

## What breaks the list

**Blank cells.** A blank inside the range becomes an empty item (`a, , b`) unless something drops it: `TRUE` in `TEXTJOIN`, `if line.strip()` in Python, or **Skip blank lines** in the tool, which is on by default.

**Dates turn into numbers.** `TEXTJOIN` joins a cell's stored value, not what the cell displays, so a column of dates comes out as serial numbers, such as `45931` for 1 October 2025. Format them inside the formula, on a range without blank cells (an empty cell formats as `1900-01-00`):

```
=TEXTJOIN(", ", TRUE, TEXT(A2:A100, "yyyy-mm-dd"))
```

**A comma inside a value.** Join `Smith, John` with commas and whoever reads the list sees two names. The first Python snippet above, run on five values, prints `ana@example.com, ben@example.com, ana@example.com, Smith, John, o'brien@example.com`, which reads as six. Either use a separator that cannot appear in the data (a pipe or a tab), or quote values the way CSV does. Python's `csv` module handles the quoting:

```python
import csv, io

buf = io.StringIO()
csv.writer(buf).writerow(items)
print(buf.getvalue().strip())
```

That prints `ana@example.com,ben@example.com,"Smith, John",o'brien@example.com`.

**A quote inside a value.** The tool's **SQL IN** preset wraps each item in single quotes but does not escape quotes already in it, so `o'brien@example.com` comes out as `'o'brien@example.com'`, and the string ends early. Fix those items by hand, or use the Python version above, which doubles the quote.

**Length limits.** An Excel cell holds 32,767 characters and `TEXTJOIN` returns `#VALUE!` when the result would be longer. A Google Sheets cell holds 50,000. MySQL cuts at `group_concat_max_len` without an error. A few hundred short values fit everywhere; a full export of a table does not.

## Going the other way

To split a comma-separated list back into one value per line:

- Excel 365: `=TEXTSPLIT(A1, , ", ")`. The empty second argument means no column split; the third splits into rows.
- Google Sheets: `=ARRAYFORMULA(TRIM(TRANSPOSE(SPLIT(A1, ","))))`.
- Python: `"\n".join(part.strip() for part in text.split(",") if part.strip())`.

Or paste the list into [Comma Separated List to Column](/tools/comma-separated-list-to-column), which works out whether the separator is a comma, semicolon, pipe or tab.

## From my own work

TODO(maintainer): replace this paragraph with one real time you needed this, in your own words. Which list was it (user IDs from a spreadsheet for a SQL IN clause, emails for a script)? What went wrong the first time: a trailing space, a duplicate, a quote in a name, a GROUP_CONCAT result that stopped short? What do you do now? Two or three short paragraphs is enough. This is the part no other page on the topic has.
