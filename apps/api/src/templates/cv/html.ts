import { CV_TEMPLATES } from '@aseb/shared';

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes every value interpolated into a template.
 *
 * The enhanced document is derived from an untrusted CV, so its text must never be able
 * to close a tag or inject an attribute when the HTML is rendered to PDF.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/**
 * Strict CSP for the rendering browser.
 *
 * Templates only need inline CSS: no scripts, no fonts, no remote images, no forms. The
 * policy makes that explicit even if a template forgets, so a malicious CV cannot use
 * the renderer to reach the network.
 */
export const CV_EXPORT_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

export interface PageInput {
  title: string;
  bodyClass: string;
  css: string;
  body: string;
}

export function renderPage(input: PageInput): string {
  return [
    '<!doctype html>',
    '<html lang="id">',
    '<head>',
    '<meta charset="utf-8" />',
    `<meta http-equiv="Content-Security-Policy" content="${CV_EXPORT_CSP}" />`,
    `<title>${escapeHtml(input.title)}</title>`,
    `<style>${input.css}</style>`,
    '</head>',
    `<body class="${input.bodyClass}">`,
    input.body,
    '</body>',
    '</html>',
  ].join('\n');
}

/** Template accent colour, taken from the shared template catalogue (single source of truth). */
export function accentOf(key: 'ATS_MINIMAL' | 'PROFESSIONAL' | 'MODERN'): string {
  return CV_TEMPLATES.find((template) => template.key === key)?.accent ?? '#0f172a';
}
