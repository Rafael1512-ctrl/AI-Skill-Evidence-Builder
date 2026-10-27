import type { CvEnhancementDocument } from '@aseb/shared';

import { escapeHtml } from './html.js';

type Document = CvEnhancementDocument;

function section(title: string, inner: string): string {
  if (inner.trim() === '') return '';
  return `<section class="cv-section"><h2>${escapeHtml(title)}</h2>${inner}</section>`;
}

function bullets(items: readonly string[]): string {
  if (items.length === 0) return '';
  return `<ul class="cv-bullets">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function paragraph(value: string | null | undefined): string {
  return value && value.trim() !== '' ? `<p>${escapeHtml(value)}</p>` : '';
}

/** Free-text dates from the model: never invent a value, just join what exists. */
function dateRange(start: string | null, end: string | null, current: boolean): string {
  const parts = [start, current ? 'Sekarang' : end].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  );
  return parts.length > 0 ? `<span class="cv-dates">${escapeHtml(parts.join(' – '))}</span>` : '';
}

function contactLine(document: Document): string {
  const parts = [
    document.contact.email,
    document.contact.phone,
    document.contact.location,
    document.contact.linkedinUrl,
    document.contact.githubUrl,
    document.contact.portfolioUrl,
  ].filter((part): part is string => typeof part === 'string' && part.trim() !== '');

  if (parts.length === 0) return '';
  return `<p class="cv-contact">${parts.map((part) => escapeHtml(part)).join(' · ')}</p>`;
}

export function headerSection(document: Document): string {
  const headline =
    document.headline && document.headline.trim() !== ''
      ? `<p class="cv-headline">${escapeHtml(document.headline)}</p>`
      : '';

  return [
    '<header class="cv-header">',
    `<h1>${escapeHtml(document.fullName)}</h1>`,
    headline,
    contactLine(document),
    '</header>',
  ].join('');
}

export function summarySection(document: Document): string {
  return section('Ringkasan Profesional', paragraph(document.professionalSummary));
}

export function experienceSection(document: Document): string {
  const inner = document.experience
    .map((item) => {
      const head = `<div class="cv-entry-head"><h3>${escapeHtml(item.jobTitle)}</h3>${dateRange(item.startDate, item.endDate, item.current)}</div>`;
      const sub = [item.company, item.location]
        .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
        .map((part) => escapeHtml(part))
        .join(' · ');
      return [
        '<article class="cv-entry">',
        head,
        sub ? `<p class="cv-sub">${sub}</p>` : '',
        paragraph(item.summary),
        bullets(item.bullets.map((bullet) => bullet.text)),
        '</article>',
      ].join('');
    })
    .join('');

  return section('Pengalaman Kerja', inner);
}

export function projectsSection(document: Document): string {
  const inner = document.projects
    .map((project) => {
      const head = `<div class="cv-entry-head"><h3>${escapeHtml(project.name)}</h3></div>`;
      const sub = [project.role, ...project.technologies]
        .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
        .map((part) => escapeHtml(part))
        .join(' · ');
      return [
        '<article class="cv-entry">',
        head,
        sub ? `<p class="cv-sub">${sub}</p>` : '',
        paragraph(project.description),
        project.url && project.url.trim() !== '' ? paragraph(project.url) : '',
        bullets(project.bullets.map((bullet) => bullet.text)),
        '</article>',
      ].join('');
    })
    .join('');

  return section('Proyek', inner);
}

function skillGroup(label: string, items: readonly string[]): string {
  if (items.length === 0) return '';
  return [
    '<div class="cv-skill-group">',
    `<h3>${escapeHtml(label)}</h3>`,
    `<p>${items.map((item) => escapeHtml(item)).join(', ')}</p>`,
    '</div>',
  ].join('');
}

export function skillsSection(document: Document): string {
  const groups = [
    skillGroup('Teknis', document.skills.technical),
    skillGroup('Tools', document.skills.tools),
    skillGroup('Soft skills', document.skills.soft),
  ].join('');

  const inner = groups.trim() === '' ? '' : `<div class="cv-skills">${groups}</div>`;

  return section('Keahlian', inner);
}

export function educationSection(document: Document): string {
  const inner = document.education
    .map((item) => {
      const head = `<div class="cv-entry-head"><h3>${escapeHtml(item.institution)}</h3>${dateRange(item.startDate, item.endDate, false)}</div>`;
      const sub = [item.degree, item.field, item.grade]
        .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
        .map((part) => escapeHtml(part))
        .join(' · ');
      return [
        '<article class="cv-entry">',
        head,
        sub ? `<p class="cv-sub">${sub}</p>` : '',
        bullets(item.details),
        '</article>',
      ].join('');
    })
    .join('');

  return section('Pendidikan', inner);
}

export function certificationsSection(document: Document): string {
  const inner = document.certifications
    .map((item) => {
      const meta = [item.issuer, item.issuedAt, item.credentialId]
        .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
        .map((part) => escapeHtml(part))
        .join(' · ');
      return `<article class="cv-entry"><h3>${escapeHtml(item.name)}</h3>${meta ? `<p class="cv-sub">${meta}</p>` : ''}</article>`;
    })
    .join('');

  return section('Sertifikasi', inner);
}

export function languagesSection(document: Document): string {
  if (document.languages.length === 0) return '';
  return section(
    'Bahasa',
    `<p>${document.languages.map((language) => escapeHtml(language)).join(', ')}</p>`,
  );
}

export function additionalSections(document: Document): string {
  return document.additionalSections
    .map((entry) => section(entry.title, bullets(entry.items)))
    .join('');
}
