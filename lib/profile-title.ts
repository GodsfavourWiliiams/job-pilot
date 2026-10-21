/** A suggested headline from the first few lines of an uploaded CV. The user can edit it. */
export function inferProfessionalTitle(resumeText: string): string {
  const lines = resumeText.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  const heading = lines.findIndex((line) => /^(summary|profile|skills|experience|education)$/i.test(line));
  for (const line of lines.slice(1, heading > 0 ? heading : 5)) {
    const firstPart = line.split('|')[0].trim();
    if (firstPart.length <= 80 && /\b(developer|engineer|designer|analyst|manager|specialist)\b/i.test(firstPart)) {
      return firstPart;
    }
  }
  return '';
}
