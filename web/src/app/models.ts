// Mirrors the API DTOs (HfcDemo records). Kept in one place so the contract
// is explicit and the compiler catches drift between client and server.
export interface Brand {
  id: string;
  name: string;
  tagline: string;
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
