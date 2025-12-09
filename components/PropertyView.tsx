import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { Save, Loader2, Trash2 } from 'lucide-react';
import { Property } from '../types';

export const PropertyView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
          contact_info: property.contact_info
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
    
    const { error } = await supabase.from('properties').delete().eq('id', id);
    if (!error) {
       window.location.hash = '/'; // Simple redirect after delete
    } else {
       alert('Błąd usuwania');
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

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Dane kontaktowe</label>
            <input
              type="text"
              value={property.contact_info || ''}
              onChange={(e) => setProperty({...property, contact_info: e.target.value})}
              placeholder="Telefon, Email dla gości"
              className="w-full bg-slate-900 border border-border text-white rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
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