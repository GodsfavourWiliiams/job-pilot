import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Job, Profile } from './types';
import { relevantSkills, selectHighlights } from './draft';

function clean(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[—–−]/g, '-').replace(/[•●▪]/g, '-')
    .replace(/[^\x20-\x7E\n]/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function resumeLines(text: string): string[] {
  const raw = text.replace(/\r/g, '').split('\n').map((item) => item.trim()).filter(Boolean);
  const headingPattern = /^(SUMMARY|PROFILE|EXPERIENCE|WORK EXPERIENCE|SKILLS|EDUCATION|PROJECTS?|SELECTED PROJECT)$/i;
  const firstSection = raw.findIndex((item) => headingPattern.test(item));
  const source = firstSection > 0 ? raw.slice(firstSection) : raw;
  const combined: string[] = [];
  for (const item of source) {
    const startsNew = headingPattern.test(item)
      || /^[•●▪*-]\s+/.test(item)
      || /\|/.test(item)
      || /^(Languages|Frontend|Backend|APIs? and integration|Quality and delivery|Performance and debugging|Domain):/i.test(item)
      || /\b(?:19|20)\d{2}\s+(?:to|[-–])\s+(?:Present|(?:19|20)\d{2})/i.test(item);
    if (!startsNew && combined.length && !headingPattern.test(combined[combined.length - 1])) combined[combined.length - 1] += ` ${item}`;
    else combined.push(item);
  }
  return combined;
}

export async function makeResumePdf(profile: Profile, job: Job): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.12, 0.18, 0.28);
  const teal = rgb(0.06, 0.48, 0.49);
  const muted = rgb(0.38, 0.44, 0.51);
  let page: PDFPage = pdf.addPage([612, 792]);
  let y = 746;
  const margin = 48;
  const width = 516;

  function paintPage() {
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(1, 1, 1) });
  }
  paintPage();

  function nextPage() {
    page = pdf.addPage([612, 792]);
    y = 744;
    paintPage();
  }
  function ensure(height: number) { if (y - height < 48) nextPage(); }
  function line(text: string, font: PDFFont, size: number, color = navy, gap = 16) {
    for (const part of wrap(text, font, size)) {
      ensure(gap);
      if (part) page.drawText(part, { x: margin, y, size, font, color });
      y -= gap;
    }
  }
  function wrap(text: string, font: PDFFont, size: number): string[] {
    const result: string[] = [];
    for (const paragraph of clean(text).split('\n')) {
      if (!paragraph) { result.push(''); continue; }
      let current = '';
      for (const word of paragraph.split(/\s+/)) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) > width && current) {
          result.push(current); current = word;
        } else current = candidate;
      }
      if (current) result.push(current);
    }
    return result;
  }
  function paragraph(text: string, options: { size?: number; indent?: number; color?: ReturnType<typeof rgb> } = {}) {
    const size = options.size ?? 9.5;
    const indent = options.indent ?? 0;
    const wrappedLines = wrap(text, regular, size);
    const totalHeight = wrappedLines.length * 13 + 5;
    if (totalHeight < 680) ensure(totalHeight);
    for (const wrapped of wrappedLines) {
      ensure(13);
      if (wrapped) page.drawText(wrapped, { x: margin + indent, y, size, font: regular, color: options.color ?? navy });
      y -= wrapped ? 13 : 7;
    }
    y -= 5;
  }
  function heading(text: string) {
    ensure(65);
    y -= 10;
    line(text.toUpperCase(), bold, 10, teal, 18);
    page.drawLine({ start: { x: margin, y: y + 8 }, end: { x: 564, y: y + 8 }, color: rgb(0.84, 0.89, 0.90), thickness: 0.7 });
    y -= 4;
  }

  line(profile.name || 'Candidate', bold, 20, navy, 27);
  if (profile.professionalTitle) line(profile.professionalTitle, bold, 11, teal, 19);
  const contact = [profile.location, profile.email, profile.phone, profile.linkedin, profile.github].filter(Boolean).join('  |  ');
  for (const part of wrap(contact, regular, 8.5)) line(part, regular, 8.5, muted, 12);
  y -= 8;
  heading('Relevant experience');
  paragraph(`Selected for: ${job.title}`, { size: 9.5, color: muted });
  const skills = relevantSkills(profile, job);
  if (skills.length) paragraph(skills.join('  •  '), { size: 9.5 });
  for (const fact of selectHighlights(profile, job)) paragraph(`• ${fact}`, { size: 9.5 });
  heading('Experience and qualifications');
  const lines = resumeLines(profile.resumeText);
  for (const sourceLine of lines) {
    if (sourceLine === profile.name || (profile.location && sourceLine.startsWith(profile.location))) continue;
    if (/^(SUMMARY|SKILLS|EXPERIENCE|EDUCATION|PROJECTS?|SELECTED PROJECT)$/i.test(sourceLine)) {
      heading(sourceLine);
    } else if (/^[•●▪*-]\s+/.test(sourceLine)) {
      paragraph(sourceLine, { size: 9.2, indent: 5 });
    } else if (/\|/.test(sourceLine) && sourceLine.length < 120) {
      ensure(20);
      line(sourceLine, bold, 9.4, navy, 14);
    } else {
      paragraph(sourceLine, { size: 9.2 });
    }
  }
  const pages = pdf.getPages();
  pages.forEach((p, index) => p.drawText(`${index + 1} / ${pages.length}`, { x: 535, y: 27, size: 8, font: regular, color: muted }));
  return pdf.save();
}
