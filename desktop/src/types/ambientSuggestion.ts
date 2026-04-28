export interface AmbientTrustCard {
  signed_manifest?: boolean;
  runtime?: string | null;
  permissions?: string[];
  capability_summary?: {
    ai?: boolean;
    network?: boolean;
    storage?: boolean;
    memory?: boolean;
    gpu?: boolean;
  };
  required_secrets?: string[];
  per_user_secrets?: string[];
  execution_receipts?: {
    enabled?: boolean;
    field?: string;
  };
}

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
  trust_card?: AmbientTrustCard;
}
