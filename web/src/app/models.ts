// Mirrors the API DTOs (HfcDemo records). Kept in one place so the contract
// is explicit and the compiler catches drift between client and server.
export interface Brand {
  id: string;
  name: string;
  tagline: string;
}

// A franchisee is the tenancy boundary (brand is the grouping). The picker uses
// this to stand in for a B2C/Entra login: selecting one mints a scoped token.
export interface Franchisee {
  id: string;
  brandId: string;
  brandName: string;
  name: string;
  region: string;
}

export interface DevTokenResponse {
  token: string;
  franchiseeId: string;
  brandId: string;
}

export interface Slot {
  id: number;
  territoryId: number;
  territoryName: string;
  startUtc: string;
  isBooked: boolean;
}

export interface Appointment {
  id: number;
  territoryId: number;
  startUtc: string;
  customerName: string;
  service: string;
  depositCents: number;
  depositPaid: boolean;
}

export interface BookRequest {
  slotId: number;
  customerName: string;
  service: string;
}

// The typed intake draft returned by POST /api/intake/parse. Mirrors the C#
// IntakeDraft. Every field is human-verifiable in the UI before it becomes a
// booking — source/usedAi/notice make the provenance explicit.
export type Urgency = 'Routine' | 'Soon' | 'Emergency';
export type TimeOfDay = 'Any' | 'Morning' | 'Afternoon' | 'Evening';

export interface IntakeDraft {
  customerName: string | null;
  service: string;
  urgency: Urgency;
  preferredTimeOfDay: TimeOfDay;
  preferredDate: string | null;
  territoryHint: string | null;
  notes: string;
  confidence: number;
  source: 'ai' | 'heuristic';
  usedAi: boolean;
  notice: string | null;
  model: string | null;
  latencyMs: number;
}
