// Auth Handler
// Handles authentication callbacks and session management

import { error, json } from './app.ts';

export async function handleAuth(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Google OAuth callback
  if (path === '/auth/callback') {
    // TODO: Handle Supabase Auth callback
    // Exchange code for session
    // Set cookie/JWT
    return json({ message: 'Authentication successful' });
  }

  // Get current user
  if (path === '/auth/user') {
    // TODO: Return current user from JWT
    return json({
      id: 'temp-user',
      email: 'user@example.com',
      tier: 'free',
    });
  }

  // Sign out
  if (path === '/auth/signout') {
    // TODO: Clear session
    return json({ message: 'Signed out' });
  }

  return error('Auth endpoint not found', 404);
}

/**
 * Extract and verify JWT from request
 */
export async function authenticate(request: Request): Promise<string> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);

  // TODO: Verify JWT with Supabase
  // const { data: { user }, error } = await supabase.auth.getUser(token);
  // if (error || !user) throw new Error('Invalid token');
  // return user.id;

  return 'temp-user-id';
}
