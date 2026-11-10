import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform/admin";

/**
 * Used only to decide whether the platform link is displayed.
 * Every privileged endpoint independently verifies platform access.
 */
export async function GET() {
  try {
    await requirePlatformAdmin();
    return NextResponse.json({ isPlatformAdmin: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ isPlatformAdmin: false }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
