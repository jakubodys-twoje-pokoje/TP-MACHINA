


export interface Property {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  address: string | null;
  contact_info: string | null;
  maps_link?: string | null;
  amenities?: string | null;
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

export interface Notification {
  id: string;
  user_id: string;
  property_id: string;
  unit_id: string;
  property_name: string;
  unit_name: string;
  change_type: 'available' | 'blocked';
  start_date: string;
  end_date: string;
  is_read: boolean;
  created_at: string;
}
// FIX: Add missing Season and SeasonalPrice interfaces
export interface Season {
  id: string;
  property_id: string;
  name: string;
  start_date: string;
  end_date: string;
}

export interface SeasonalPrice {
  id: string;
  unit_id: string;
  season_id: string;
  price: number;
}
