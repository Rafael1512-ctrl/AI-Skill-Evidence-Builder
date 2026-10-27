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

const ACCENT = accentOf('PROFESSIONAL');

/**
 * Professional.
 *
 * Formal single-column layout with a colour accent, clear typographic hierarchy and rule
 * separators. Still linear for parsers, but visually structured for corporate roles.
 */
const CSS = `
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1f2937; font-size: 10.5pt; line-height: 1.5; margin: 0; }
  .cv-header { border-bottom: 3px solid ${ACCENT}; padding-bottom: 10px; margin-bottom: 16px; }
  h1 { font-size: 21pt; margin: 0; color: #111827; letter-spacing: 0.2px; }
  h2 { font-size: 11.5pt; margin: 18px 0 8px; color: ${ACCENT}; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
  h3 { font-size: 11pt; margin: 0; color: #111827; }
  p { margin: 3px 0; }
  .cv-headline { font-size: 11.5pt; margin-top: 4px; color: ${ACCENT}; font-style: italic; }
  .cv-contact { font-size: 9.5pt; margin-top: 6px; }
  .cv-section { margin-bottom: 8px; }
  .cv-entry { margin-bottom: 12px; }
  .cv-entry-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .cv-sub { font-size: 9.5pt; margin-top: 1px; }
  .cv-dates { font-size: 9.5pt; white-space: nowrap; }
  ul { margin: 4px 0 0 16px; padding: 0; }
  li { margin-bottom: 2px; }
  .cv-skill-group { margin-bottom: 4px; }
  .cv-skill-group h3 { font-size: 10pt; }
`;
export function renderProfessional(document: CvEnhancementDocument): string {
  const body = [
    headerSection(document),
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

  return renderPage({
    title: `${document.fullName} - CV`,
    bodyClass: 'tpl-professional',
    css: CSS,
    body,
  });
}
