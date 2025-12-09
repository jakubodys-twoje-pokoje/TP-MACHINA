import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { supabase } from '../services/supabaseClient';
import { Property } from '../types';

interface PropertyContextType {
  properties: Property[];
  loading: boolean;
  error: string | null;
  fetchProperties: () => Promise<void>;
  addProperty: (name: string, description: string | null) => Promise<Property | null>;
  deleteProperty: (id: string) => Promise<void>;
}

const PropertyContext = createContext<PropertyContextType | undefined>(undefined);

export const PropertyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProperties = async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setProperties([]); // Clear properties if user logs out
        return;
      }

      const { data, error: dbError } = await supabase
        .from('properties')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (dbError) throw dbError;
      setProperties(data || []);
    } catch (err: any) {
      setError(err.message || 'Błąd pobierania danych.');
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchProperties();

    // Listen for auth changes to refetch properties on login/logout
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
           setLoading(true);
           fetchProperties();
        }
      }
    );
    
    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const addProperty = async (name: string, description: string | null): Promise<Property | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Użytkownik nie jest zalogowany");

    const { data, error: insertError } = await supabase
      .from('properties')
      .insert([{ name, description, user_id: user.id }])
      .select()
      .single();

    if (insertError) throw insertError;
    
    // Optimistically add to state or refetch
    setProperties(prev => [data, ...prev]);
    return data;
  };

  const deleteProperty = async (id: string) => {
    const { error: deleteError } = await supabase
      .from('properties')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;
    
    // Optimistically remove from state
    setProperties(prev => prev.filter(p => p.id !== id));
  };

  const value = {
    properties,
    loading,
    error,
    fetchProperties,
    addProperty,
    deleteProperty,
  };

  return (
    <PropertyContext.Provider value={value}>
      {children}
    </PropertyContext.Provider>
  );
};

export const useProperties = () => {
  const context = useContext(PropertyContext);
  if (context === undefined) {
    throw new Error('useProperties must be used within a PropertyProvider');
  }
  return context;
};
