/**
 * JSON syntax colouring for read-only output boxes (JSON Formatter first; any tool that shows JSON
 * can reuse it). Unlike the generic tokenizer in syntax-highlight.ts, this one tells a key from a
 * string value and gives true/false, null and numbers their own token, which is what makes a
 * formatted payload scannable at a glance.
 *
 * It is a scanner, not a parser: it never rejects input, so a partial or slightly invalid document
 * still colours sensibly, and anything it does not recognise passes through as plain text. The
 * output reconstructs the input exactly (tags stripped + entities decoded === input), which the
 * highlight layer relies on to line up character-for-character under the textarea. Pure, no DOM.
 */

export type JsonTokenType = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'plain';
export interface JsonToken {
  type: JsonTokenType;
  text: string;
}

const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export function tokenizeJson(src: string): JsonToken[] {
  const out: JsonToken[] = [];
  let plain = '';
  const flush = () => {
    if (plain) out.push({ type: 'plain', text: plain });
    plain = '';
  };
  const push = (type: JsonTokenType, text: string) => {
    flush();
    out.push({ type, text });
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"' && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      if (src[j] === '"') j++;
      j = Math.min(j, src.length);
      // A string is a key when the next non-whitespace character is a colon.
      let k = j;
      while (k < src.length && (src[k] === ' ' || src[k] === '\t' || src[k] === '\r' || src[k] === '\n')) k++;
      push(src[k] === ':' ? 'key' : 'string', src.slice(i, j));
      i = j;
    } else if (c === '-' || (c >= '0' && c <= '9')) {
      NUMBER_RE.lastIndex = i;
      const m = NUMBER_RE.exec(src);
      if (m && m[0].length) {
        push('number', m[0]);
        i += m[0].length;
      } else {
        plain += c;
        i++;
      }
    } else if (src.startsWith('true', i) || src.startsWith('false', i)) {
      const word = src[i] === 't' ? 'true' : 'false';
      push('boolean', word);
      i += word.length;
    } else if (src.startsWith('null', i)) {
      push('null', 'null');
      i += 4;
    } else if ('{}[],:'.includes(c)) {
      push('punct', c);
      i++;
    } else {
      plain += c;
      i++;
    }
  }
  flush();
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML for a highlight layer: one `<span class="sy-<type>">` per token, plain text left bare. */
export function highlightJsonHtml(src: string): string {
  let html = '';
  for (const t of tokenizeJson(src)) {
    html += t.type === 'plain' ? escapeHtml(t.text) : `<span class="sy-${t.type}">${escapeHtml(t.text)}</span>`;
  }
  return html;
}
