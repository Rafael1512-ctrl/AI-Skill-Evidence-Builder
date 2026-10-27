import { type CvEnhancementDocument, type CvTemplateKey } from '@aseb/shared';

import { safeFileName } from '../../utils/text.js';
import { renderAtsMinimal } from './atsMinimal.js';
import { renderModern } from './modern.js';
import { renderProfessional } from './professional.js';

type Renderer = (document: CvEnhancementDocument) => string;

/** Every template key from the shared catalogue must have exactly one renderer. */
const RENDERERS: Readonly<Record<CvTemplateKey, Renderer>> = {
  ATS_MINIMAL: renderAtsMinimal,
  PROFESSIONAL: renderProfessional,
  MODERN: renderModern,
};

export function renderCvHtml(input: {
  document: CvEnhancementDocument;
  templateKey: CvTemplateKey;
}): string {
  return RENDERERS[input.templateKey](input.document);
}

/** Download name: `<name>-<template>.pdf`, normalised so it is safe on every filesystem. */
export function cvExportFileName(input: {
  document: CvEnhancementDocument;
  templateKey: CvTemplateKey;
}): string {
  const base = safeFileName(input.document.fullName).replace(/\.pdf$/i, '');
  return `${base}-${input.templateKey.toLowerCase()}.pdf`;
}

/**
 * Plain-text rendition of the enhanced CV.
 *
 * Stored on the generated `CvDocument` row: the PDF bytes are returned to the user and
 * not persisted (no storage provider yet), so the searchable text keeps the record useful.
 */
export function cvDocumentToPlainText(document: CvEnhancementDocument): string {
  const lines: string[] = [document.fullName];

  if (document.headline) lines.push(document.headline);

  const contact = [
    document.contact.email,
    document.contact.phone,
    document.contact.location,
    document.contact.linkedinUrl,
    document.contact.githubUrl,
    document.contact.portfolioUrl,
  ].filter((part): part is string => typeof part === 'string' && part.trim() !== '');
  if (contact.length > 0) lines.push(contact.join(' | '));

  lines.push('', 'RINGKASAN PROFESIONAL', document.professionalSummary);

  if (document.experience.length > 0) {
    lines.push('', 'PENGALAMAN KERJA');
    for (const item of document.experience) {
      const dates = [item.startDate, item.endDate].filter(Boolean).join(' - ');
      lines.push(`${item.jobTitle} - ${item.company}${dates ? ` (${dates})` : ''}`);
      for (const bullet of item.bullets) lines.push(`- ${bullet.text}`);
    }
  }

  if (document.projects.length > 0) {
    lines.push('', 'PROYEK');
    for (const project of document.projects) {
      lines.push(`${project.name}${project.role ? ` - ${project.role}` : ''}`);
      if (project.description) lines.push(project.description);
      for (const bullet of project.bullets) lines.push(`- ${bullet.text}`);
    }
  }

  const skills = [
    ...document.skills.technical,
    ...document.skills.tools,
    ...document.skills.soft,
  ];
  if (skills.length > 0) lines.push('', 'KEAHLIAN', skills.join(', '));

  if (document.education.length > 0) {
    lines.push('', 'PENDIDIKAN');
    for (const item of document.education) {
      lines.push([item.institution, item.degree, item.field].filter(Boolean).join(' - '));
    }
  }

  if (document.certifications.length > 0) {
    lines.push('', 'SERTIFIKASI');
    for (const item of document.certifications) {
      lines.push([item.name, item.issuer].filter(Boolean).join(' - '));
    }
  }

  if (document.languages.length > 0) lines.push('', 'BAHASA', document.languages.join(', '));

  for (const extra of document.additionalSections) {
    lines.push('', extra.title.toUpperCase(), ...extra.items.map((item) => `- ${item}`));
  }

  return lines.join('\n');
}
