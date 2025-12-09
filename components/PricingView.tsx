import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { Loader2, Tag } from 'lucide-react';
import { Unit, Season, SeasonalPrice } from '../types';

export const PricingView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();
  const [units, setUnits] = useState<Unit[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [prices, setPrices] = useState<SeasonalPrice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (propertyId) {
      fetchPricingData();
    }
  }, [propertyId]);

  const fetchPricingData = async () => {
    setLoading(true);
    try {
      // Fetch all required data in parallel
      const [unitsRes, seasonsRes] = await Promise.all([
        supabase.from('units').select('*').eq('property_id', propertyId).order('name'),
        supabase.from('seasons').select('*').eq('property_id', propertyId).order('start_date')
      ]);

      if (unitsRes.error) throw unitsRes.error;
      if (seasonsRes.error) throw seasonsRes.error;
      
      const fetchedUnits = unitsRes.data || [];
      const fetchedSeasons = seasonsRes.data || [];
      
      setUnits(fetchedUnits);
      setSeasons(fetchedSeasons);

      if (fetchedUnits.length > 0) {
        const unitIds = fetchedUnits.map(u => u.id);
        const { data: pricesData, error: pricesError } = await supabase
          .from('seasonal_prices')
          .select('*')
          .in('unit_id', unitIds);
        
        if (pricesError) throw pricesError;
        setPrices(pricesData || []);
      }

    } catch (error: any) {
      console.error("Error fetching pricing data:", error);
      alert(`Błąd pobierania danych: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  const priceMap = new Map<string, number>();
  prices.forEach(p => {
    priceMap.set(`${p.unit_id}-${p.season_id}`, p.price);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <Loader2 className="animate-spin mr-2" /> Ładowanie cenników...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-4">
        <h2 className="text-2xl font-bold text-white">Cenniki Sezonowe (Tylko do odczytu)</h2>
        <p className="text-slate-400 text-sm mt-1">Podgląd cen dla poszczególnych kwater w zdefiniowanych sezonach.</p>
      </div>

      {seasons.length === 0 || units.length === 0 ? (
        <div className="text-center py-16 bg-surface rounded-xl border border-border">
          <Tag size={40} className="mx-auto text-slate-600 mb-4" />
          <h3 className="font-bold text-white">Brak danych do wyświetlenia</h3>
          <p className="text-slate-400 text-sm">Aby zobaczyć cennik, najpierw zaimportuj sezony i ceny do bazy danych.</p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-900/50">
              <tr>
                <th className="px-4 py-3 font-medium text-white sticky left-0 bg-slate-900/50 z-10 w-64">Kwatera</th>
                {seasons.map(season => (
                  <th key={season.id} className="px-4 py-3 font-medium text-slate-300 text-center whitespace-nowrap">
                    <div>{season.name}</div>
                    <div className="text-xs text-slate-500 font-normal">{`${season.start_date} - ${season.end_date}`}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {units.map(unit => (
                <tr key={unit.id}>
                  <td className="px-4 py-3 font-medium text-slate-200 sticky left-0 bg-surface z-10 w-64">{unit.name}</td>
                  {seasons.map(season => {
                    const price = priceMap.get(`${unit.id}-${season.id}`);
                    return (
                      <td key={season.id} className="px-4 py-3 text-center text-slate-300 font-mono">
                        {price !== undefined ? `${price.toLocaleString('pl-PL')} PLN` : <span className="text-slate-600">-</span>}
                      </td>
                    );
  
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
