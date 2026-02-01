// Apps Handler
// Handles app listing and discovery

import { json } from './app.ts';

export async function handleApps(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const search = url.searchParams.get('q') || '';

  // TODO: Query database for public apps
  // const apps = await db.apps.findMany({
  //   visibility: 'public',
  //   search,
  //   orderBy: { runs_30d: 'desc' }
  // });

  // Placeholder response
  const apps = [
    {
      id: 'example-1',
      name: 'Email Summarizer',
      description: 'Summarizes your unread emails',
      runs_30d: 1234,
    },
    {
      id: 'example-2',
      name: 'Daily Brief',
      description: 'Morning briefing from your calendar',
      runs_30d: 567,
    },
  ];

  return json({ apps });
}
