export interface AmbientSuggestion {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon_url?: string | null;
  similarity?: number;
  source: 'library' | 'shared' | 'marketplace';
  type: 'app' | 'skill';
  connected: boolean;
  runtime?: string;
}
