
export interface Property {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  address: string | null;
  contact_info: string | null;
  created_at: string;
}

export interface Unit {
  id: string;
  property_id: string;
  name: string;
  type: string;
  capacity: number;
  description: string | null;
  external_id?: string | null;
  external_type_id?: string | null;
  beds_single?: number | null;
  beds_double?: number | null;
  beds_sofa?: number | null;
  beds_sofa_single?: number | null;
  area?: number | null;
  max_adults?: number | null;
  bathroom_count?: number | null;
  floor?: number | null;
  facilities?: string | null;
  photos?: any | null;
  photo_url?: string | null;
}

export interface Availability {
  id: string;
  unit_id: string;
  date: string; // YYYY-MM-DD
  status: 'available' | 'booked' | 'blocked';
  reservation_id?: string | null;
}

export interface Pricing {
  id: string;
  unit_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  price_per_night: number;
  currency: string;
}

export interface RouteParams {
  propertyId?: string;
}