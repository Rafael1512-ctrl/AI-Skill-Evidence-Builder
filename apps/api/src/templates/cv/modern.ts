import type { CvEnhancementDocument } from '@aseb/shared';

import { accentOf, renderPage } from './html.js';
import {
  additionalSections,
  certificationsSection,
  educationSection,
  experienceSection,
  headerSection,
  languagesSection,
  projectsSection,
  skillsSection,
  summarySection,
} from './sections.js';

const ACCENT = accentOf('MODERN');

/**
 * Modern.
 *
 * A coloured header band and a three-column skill grid. The reading order stays linear
 * (experience before skills, no tables), so the visual refresh does not break parsing.
 */
const CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #1f2937; font-size: 10.5pt; line-height: 1.5; margin: 0; }
  .cv-header { background: ${ACCENT}; color: #ffffff; padding: 20px 16mm 16px; margin-bottom: 14px; }
  .cv-header h1 { color: #ffffff; }
  .cv-content { padding: 0 16mm 16mm; }
  h1 { font-size: 21pt; margin: 0; letter-spacing: -0.2px; }
  h2 { font-size: 11.5pt; margin: 18px 0 8px; color: ${ACCENT}; letter-spacing: 0.4px; }
  h3 { font-size: 11pt; margin: 0; color: #111827; }
  p { margin: 3px 0; }
  .cv-headline { color: rgba(255, 255, 255, 0.92); font-size: 11.5pt; margin-top: 4px; }
  .cv-contact { color: rgba(255, 255, 255, 0.95); font-size: 9.5pt; margin-top: 6px; }
  .cv-section { margin-bottom: 8px; }
  .cv-entry { margin-bottom: 12px; }
  .cv-entry-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .cv-sub { font-size: 9.5pt; color: #4b5563; margin-top: 1px; }
  .cv-dates { font-size: 9.5pt; white-space: nowrap; color: #4b5563; }
  ul { margin: 4px 0 0 16px; padding: 0; }
  li { margin-bottom: 2px; }
  .cv-skills { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .cv-skill-group h3 { font-size: 10pt; color: #111827; }
`;

export function renderModern(document: CvEnhancementDocument): string {
  const rest = [
    summarySection(document),
    experienceSection(document),
    projectsSection(document),
    skillsSection(document),
    educationSection(document),
    certificationsSection(document),
    languagesSection(document),
    additionalSections(document),
  ]
    .filter((part) => part.trim() !== '')
    .join('\n');

  const body = [headerSection(document), `<div class="cv-content">${rest}</div>`].join('\n');

  return renderPage({
    title: `${document.fullName} - CV`,
    bodyClass: 'tpl-modern',
    css: CSS,
    body,
  });
}
