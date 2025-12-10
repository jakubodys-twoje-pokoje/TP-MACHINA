import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { Save, Loader2, Trash2, Plus, X } from 'lucide-react';
import { Property } from '../types';
import { useProperties } from '../contexts/PropertyContext';

export const PropertyView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { deleteProperty } = useProperties();

  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newAmenity, setNewAmenity] = useState('');

  useEffect(() => {
    if (id) fetchProperty(id);
  }, [id]);

  const fetchProperty = async (propId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('id', propId)
      .single();

    if (!error && data) {
      setProperty(data);
    }
    setLoading(false);
  };
  
  const handleAmenityChange = (newAmenities: string[]) => {
    if (property) {
      setProperty({ ...property, amenities: newAmenities.join(',') });
    }
  };

  const handleAddAmenity = () => {
    if (newAmenity.trim() === '') return;
    const currentAmenities = property?.amenities?.split(',').filter(Boolean) || [];
    if (currentAmenities.map(a => a.toLowerCase()).includes(newAmenity.trim().toLowerCase())) {
        alert("To udogodnienie już istnieje.");
        return;
    }
    handleAmenityChange([...currentAmenities, newAmenity.trim()]);
    setNewAmenity('');
  };

  const handleDeleteAmenity = (amenityToRemove: string) => {
    const currentAmenities = property?.amenities?.split(',').filter(Boolean) || [];
    handleAmenityChange(currentAmenities.filter(a => a !== amenityToRemove));
  };


  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!property || !id) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from('properties')
        .update({
          name: property.name,
          address: property.address,
          description: property.description,
          email: property.email, // Updated field
          phone: property.phone, // Updated field
          maps_link: property.maps_link,
          amenities: property.amenities,
        })
        .eq('id', id);

      if (error) throw error;
      alert('Zapisano zmiany');
    } catch (err) {
      alert('Błąd zapisu');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !confirm('Czy na pewno chcesz usunąć ten obiekt? Tej operacji nie można cofnąć.')) return;
    
    try {
      await deleteProperty(id);
      alert('Obiekt usunięty.');
      navigate('/');
    } catch (error) {
      alert('Błąd usuwania obiektu.');
      console.error(error);
    }
  };

  if (loading) return <div className="text-slate-500 flex items-center gap-2"><Loader2 className="animate-spin" /> Ładowanie obiektu...</div>;
  if (!property) return <div className="text-red-400">Nie znaleziono obiektu.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h2 className="text-2xl font-bold text-white">Ustawienia Obiektu</h2>
        <button 
          onClick={handleDelete}
          className="text-red-400 hover:text-red-300 hover:bg-red-900/20 px-3 py-2 rounded-md transition-colors flex items-center gap-2 text-sm"
        >
          <Trash2 size={16} /> Usuń obiekt
        </button>
      </div>

      <form onSubmit={handleSave} className="bg-surface p-6 rounded-xl border border-border shadow-sm space-y-6 max-w-2xl">
        <div className="grid grid-cols-1 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Nazwa obiektu</label>
            <input
              type="text"
              value={property.name}
              onChange={(e) => setProperty({...property, name: e.target.value})}
              className="w-full bg-slate-900 border border-border text-white rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Adres</label>
            <input
              type="text"
              value={property.address || ''}
              onChange={(e) => setProperty({...property, address: e.target.value})}
              placeholder="Ulica, Miasto, Kod pocztowy"
              className="w-full bg-slate-900 border border-border text-white rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Email kontaktowy</label>
              <input
                type="email"
                value={property.email || ''}
                onChange={(e) => setProperty({...property, email: e.target.value})}
                placeholder="email@example.com"
                className="w-full bg-slate-900 border border-border text-white rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Numer telefonu</label>
              <input
                type="tel"
                value={property.phone || ''}
                onChange={(e) => setProperty({...property, phone: e.target.value})}
                placeholder="+48 123 456 789"
                className="w-full bg-slate-900 border border-border text-white rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Link do Map Google</label>
            <input
              type="url"
              value={property.maps_link || ''}
              onChange={(e) => setProperty({...property, maps_link: e.target.value})}
              placeholder="https://maps.app.goo.gl/..."
              className="w-full bg-slate-900 border border-border text-white rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Udogodnienia Obiektu</label>
            <div className="bg-slate-900 border border-border rounded-lg p-3 space-y-3">
              <div className="flex flex-wrap gap-2">
                {(property.amenities || '').split(',').filter(a => a.trim()).map(amenity => (
                  <div key={amenity} className="bg-slate-700 text-slate-300 text-xs font-medium pl-3 pr-2 py-1 rounded-full flex items-center gap-2">
                    {amenity.trim()}
                    <button type="button" onClick={() => handleDeleteAmenity(amenity.trim())} className="text-slate-400 hover:text-white transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
               <div className="flex gap-2 items-center border-t border-border pt-3">
                <input
                  type="text"
                  value={newAmenity}
                  onChange={(e) => setNewAmenity(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddAmenity())}
                  placeholder="Wpisz nowe udogodnienie"
                  className="flex-grow bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button type="button" onClick={handleAddAmenity} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 text-sm font-medium rounded-lg flex items-center gap-1 transition-colors">
                  <Plus size={16} /> Dodaj
                </button>
              </div>
            </div>
          </div>


          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Opis</label>
            <textarea
              value={property.description || ''}
              onChange={(e) => setProperty({...property, description: e.target.value})}
              rows={4}
              className="w-full bg-slate-900 border border-border text-white rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
            />
          </div>
        </div>

        <div className="pt-4 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            Zapisz zmiany
          </button>
        </div>
      </form>
    </div>
  );
};