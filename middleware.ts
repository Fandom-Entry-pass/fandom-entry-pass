// middleware.ts
import { NextResponse } from "next/server";

// Do nothing: just pass requests through
export function middleware() {
  return NextResponse.next();
}

// Allow static/PWA assets explicitly so they never get blocked
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|manifest.webmanifest|icon-192.png|icon-512.png|apple-touch-icon.png).*)",
  ],
};
