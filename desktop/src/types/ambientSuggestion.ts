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

export interface AmbientMarketplaceSummary {
  eligible?: boolean;
  status?: 'ineligible' | 'unlisted' | 'open_to_offers' | 'listed' | 'sold';
  ask_price_light?: number | null;
  floor_price_light?: number | null;
  instant_buy?: boolean;
  show_metrics?: boolean;
  active_bid_count?: number;
  highest_bid_light?: number | null;
  platform_fee_at_ask_light?: number | null;
  seller_payout_at_ask_light?: number | null;
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
  marketplace?: AmbientMarketplaceSummary | null;
}
