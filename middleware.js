import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/resume(.*)',
  '/ai-cover-letter(.*)',
  '/interview(.*)',
]);

export default clerkMiddleware(async (auth, req)=> {
    const { userId } = await auth();

    if(!userId && isProtectedRoute(req)){
        const { redirectToSignIn } = await auth();
        return redirectToSignIn(); 
    }

    // Initialize user in database when accessing protected routes
    if (userId && isProtectedRoute(req)) {
      try {
        const { checkUser } = await import('@/lib/checkUser');
        await checkUser();
      } catch (error) {
        console.error('Middleware checkUser error:', error);
        // Don't block the request if user initialization fails
      }
    }

    return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};