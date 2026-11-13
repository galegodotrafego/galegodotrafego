import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { parseMediaReference } from '@/lib/storage/media-reference';

export async function GET(request: Request) {
  try {
    const { supabase } = await getCurrentAccount();
    const url = new URL(request.url);
    const ref = parseMediaReference(`/api/storage/media${url.search}`);
    if (!ref) return NextResponse.json({ error: 'Invalid media reference' }, { status: 400 });
    // User session client, NEVER service_role: object SELECT RLS is authoritative.
    const { data, error } = await supabase.storage.from(ref.bucket).createSignedUrl(ref.path, 60);
    if (error || !data?.signedUrl) return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    return new Response(null, { status: 307, headers: { Location: data.signedUrl, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) { return toErrorResponse(error); }
}
