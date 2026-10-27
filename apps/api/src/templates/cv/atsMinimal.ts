import type { CvEnhancementDocument } from '@aseb/shared';

import { renderPage } from './html.js';
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

/**
 * ATS Minimal.
 *
 * One column, no colour, no tables or graphics, standard section headings. Optimised for
 * machine parsing first and human reading second.
 */
const CSS = `
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #111111; font-size: 10.5pt; line-height: 1.45; margin: 0; }
  .cv-header { margin-bottom: 14px; }
  h1 { font-size: 19pt; margin: 0 0 2px; letter-spacing: -0.2px; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 1px; margin: 18px 0 6px; border-bottom: 1px solid #111111; padding-bottom: 2px; }
  h3 { font-size: 11pt; margin: 0; }
  p { margin: 3px 0; }
  .cv-headline { font-size: 11pt; }
  .cv-contact { font-size: 9.5pt; }
  .cv-section { margin-bottom: 6px; }
  .cv-entry { margin-bottom: 10px; }
  .cv-entry-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .cv-sub { font-size: 9.5pt; }
  .cv-dates { font-size: 9.5pt; white-space: nowrap; }
  ul { margin: 3px 0 0 16px; padding: 0; }
  li { margin-bottom: 2px; }
  .cv-skill-group h3 { font-size: 10pt; margin-top: 6px; }
`;

export function renderAtsMinimal(document: CvEnhancementDocument): string {
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
    bodyClass: 'tpl-ats-minimal',
    css: CSS,
    body,
  });
}
