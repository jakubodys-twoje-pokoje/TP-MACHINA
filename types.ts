
export interface Property {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  hotres_id?: string | null;
  maps_link?: string | null;
  amenities?: string | null;
  availability_last_synced_at?: string | null;
  availability_sync_in_progress?: boolean;
  auto_sync_enabled?: boolean;
  auto_sync_interval?: number;
  workflow_is_active?: boolean; // Nowe
  workflow_position?: number;   // Nowe
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
  tags?: string | null;
  photos?: any | null;
  photo_url?: string | null;
}

export interface Availability {
  id: string;
  unit_id: string;
  date: string;
  status: 'available' | 'booked' | 'blocked';
  reservation_id?: string | null;
}

export interface RatePlan {
  id: string;
  property_id: string;
  external_id: string | null;
  name: string;
  description: string | null;
  board_type: string | null;
  min_stay: number;
  max_stay: number;
  photo_url: string | null;
  created_at?: string;
}

export interface WorkflowTask {
  id: string;
  user_id: string;
  title: string;
  is_active: boolean; // Nowe
  position: number;   // Nowe
  created_at: string;
}

export interface WorkflowStatus {
  id: string;
  user_id: string;
  label: string;
  color: string;
  created_at: string;
}

export interface WorkflowEntry {
  id: string;
  property_id: string;
  task_id: string;
  status_id: string | null;
  comment: string | null;
  last_updated_by_email?: string | null; // Nowe
  updated_at: string;
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
