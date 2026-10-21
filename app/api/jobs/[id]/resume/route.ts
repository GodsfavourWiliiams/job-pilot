import { resumeForJob } from '@/lib/service';
import { errorResponse } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const bytes = await resumeForJob(id);
    return new Response(Buffer.from(bytes), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="tailored-cv.pdf"',
        'cache-control': 'no-store',
      },
    });
  } catch (error) { return errorResponse(error, 404); }
}
