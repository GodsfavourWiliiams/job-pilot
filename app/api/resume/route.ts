import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dataPath, readStore } from '@/lib/store';
import { errorResponse, requireLocalMutation } from '@/lib/http';
import { replaceResume } from '@/lib/service';

export const runtime = 'nodejs';
const exec = promisify(execFile);

async function extractPdf(filePath: string): Promise<string> {
  if (process.platform === 'darwin') {
    const script = 'import Foundation; import PDFKit; let url=URL(fileURLWithPath:CommandLine.arguments[1]); print(PDFDocument(url:url)?.string ?? "")';
    const { stdout } = await exec('swift', ['-e', script, filePath], { maxBuffer: 5_000_000, timeout: 30_000 });
    return stdout.trim();
  }
  const { stdout } = await exec('pdftotext', ['-layout', filePath, '-'], { maxBuffer: 5_000_000, timeout: 30_000 });
  return stdout.trim();
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireLocalMutation(request);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.type !== 'application/pdf') throw new Error('Upload a PDF CV');
    if (file.size > 5_000_000) throw new Error('CV must be under 5 MB');
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('File is not a valid PDF');
    await mkdir(dataPath(''), { recursive: true });
    const filePath = dataPath('resume.pdf');
    await writeFile(filePath, bytes, { mode: 0o600 });
    const text = await extractPdf(filePath);
    if (text.length < 100) throw new Error('Could not extract text from this CV. Paste the CV text in Profile instead.');
    await replaceResume(text, file.name);
    return Response.json({ ok: true, state: await readStore() });
  } catch (error) {
    return errorResponse(error);
  }
}
