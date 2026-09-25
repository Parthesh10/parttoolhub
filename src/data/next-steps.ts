/**
 * "Next step" links under a tool's result (UI round 5a): related tools that open with this tool's
 * result already filled in, so one task can continue across tools without copy and paste.
 *
 * `source` is the element whose text is handed over (a textarea's value, otherwise its text).
 * The receiving tool gets it through the same sessionStorage hand-off as src/lib/transfer.ts:
 * a tool with its own receiver (JSON to CSV, Base64, ...) handles it; any other tool gets it in
 * its first editable textarea (floating-tools.client.ts). `when` hides a link until the result
 * suits the target: `json` = an object or array, `json-array` = a top-level array (JSON to CSV
 * needs rows). Only chains where the target really takes the result as input belong here;
 * tests/next-steps.test.ts checks every slug, source id and target input.
 */
export interface NextStep {
  to: string;
  label: string;
  when?: 'json' | 'json-array';
}
export interface NextStepPlan {
  source: string;
  steps: NextStep[];
}

const TO_DOCS: NextStep[] = [
  { to: 'markdown-to-word', label: 'Make a Word document' },
  { to: 'markdown-to-google-docs', label: 'Paste into Google Docs' },
  { to: 'markdown-to-plain-text', label: 'Strip Markdown symbols' },
];

export const NEXT_STEPS: Record<string, NextStepPlan> = {
  'json-formatter': {
    source: '#output',
    steps: [
      { to: 'json-to-csv-converter', label: 'Convert to CSV', when: 'json-array' },
      { to: 'json-to-python-dict', label: 'Convert to a Python dict', when: 'json' },
      { to: 'json-diff-checker', label: 'Compare with another version', when: 'json' },
    ],
  },
  'python-dict-to-json': {
    source: '#output',
    steps: [
      { to: 'json-formatter', label: 'Explore in JSON Formatter', when: 'json' },
      { to: 'json-to-csv-converter', label: 'Convert to CSV', when: 'json-array' },
      { to: 'json-diff-checker', label: 'Compare with another version', when: 'json' },
    ],
  },
  'csv-to-json-converter': {
    source: '#output',
    steps: [
      { to: 'json-formatter', label: 'Explore in JSON Formatter', when: 'json' },
      { to: 'json-to-python-dict', label: 'Convert to a Python dict', when: 'json' },
      { to: 'json-diff-checker', label: 'Compare with another version', when: 'json' },
    ],
  },
  'json-to-csv-converter': {
    source: '#output',
    steps: [{ to: 'remove-duplicate-lines', label: 'Remove duplicate rows' }],
  },
  'ai-text-cleaner': { source: '#output', steps: TO_DOCS },
  'html-to-markdown': { source: '#output', steps: TO_DOCS },
  'google-docs-to-markdown': { source: '#output', steps: [TO_DOCS[0], TO_DOCS[2]] },
  'remove-duplicate-lines': {
    source: '#output',
    steps: [{ to: 'column-to-comma-separated-list', label: 'Join into a comma-separated list' }],
  },
  'comma-separated-list-to-column': {
    source: '#output',
    steps: [{ to: 'remove-duplicate-lines', label: 'Remove duplicate lines' }],
  },
  'base64-encode-decode': {
    source: '#output',
    steps: [{ to: 'json-formatter', label: 'Format the decoded JSON', when: 'json' }],
  },
  'url-encode-decode': {
    source: '#output',
    steps: [{ to: 'json-formatter', label: 'Format the decoded JSON', when: 'json' }],
  },
  'jwt-decoder': {
    source: '#payload-out',
    steps: [{ to: 'json-formatter', label: 'Open the payload in JSON Formatter', when: 'json' }],
  },
};
