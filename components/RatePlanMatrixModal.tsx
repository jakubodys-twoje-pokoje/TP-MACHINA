import React from 'react';
import { X } from 'lucide-react';
import { Unit, RatePlan } from '../types';

interface RatePlanMatrixModalProps {
  units: Unit[];
  ratePlans: RatePlan[];
  /** unit_id -> Set of rate_plan_id that actually have price data for that unit */
  unitAvailablePlans: Map<string, Set<string>>;
  /** unit_id -> currently selected rate_plan_id */
  unitRatePlan: Map<string, string>;
  defaultRatePlanId: string | null;
  /** assign one rate plan to a single unit */
  onSelect: (unitId: string, ratePlanId: string) => void;
  /** assign one rate plan to every unit shown (skipping units without data) */
  onBulkSelect: (ratePlanId: string) => void;
  onClose: () => void;
}

// Shared matrix (units × rate plans) for picking the rate plan shown on the
// calendar per unit. Radio-per-row: max one plan per unit. Used both on the
// calendar (under ⚙) and in the Pricing tab.
export const RatePlanMatrixModal: React.FC<RatePlanMatrixModalProps> = ({
  units,
  ratePlans,
  unitAvailablePlans,
  unitRatePlan,
  defaultRatePlanId,
  onSelect,
  onBulkSelect,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-indigo-600">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-indigo-400 flex items-center gap-2">🗓 Cenniki na kalendarzu</h2>
            <p className="text-xs text-slate-400 mt-1">Dla każdej kwatery wybierz jeden cennik wyświetlany na kalendarzu. Przycisk „✓ wszystkim" w nagłówku ustawia dany cennik od razu wszystkim kwaterom.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1" aria-label="Zamknij">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-auto p-2 sm:p-4">
          {ratePlans.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">Brak cenników dla tego obiektu.</p>
          ) : units.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">Brak kwater do wyświetlenia.</p>
          ) : (
            <table className="border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 bg-slate-800 text-left text-slate-300 font-semibold p-2 border-b border-r border-slate-700 min-w-[120px] align-bottom">
                    Kwatera
                  </th>
                  {ratePlans.map(rp => (
                    <th
                      key={rp.id}
                      className="sticky top-0 z-20 bg-slate-800 text-slate-300 font-medium p-2 border-b border-slate-700 min-w-[80px] max-w-[120px] align-bottom"
                    >
                      <div className="truncate mb-1" title={rp.name}>{rp.name}</div>
                      <button
                        type="button"
                        onClick={() => onBulkSelect(rp.id)}
                        title={`Ustaw „${rp.name}" wszystkim kwaterom (które mają dane)`}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] font-semibold rounded px-1 py-0.5 transition"
                      >
                        ✓ wszystkim
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {units.map(unit => {
                  const availForUnit = unitAvailablePlans.get(unit.id);
                  const selectedPlanId = unitRatePlan.get(unit.id) ?? defaultRatePlanId ?? '';
                  return (
                    <tr key={unit.id} className="hover:bg-slate-700/30">
                      <td className="sticky left-0 z-10 bg-slate-800 text-white font-medium p-2 border-b border-r border-slate-700 min-w-[120px]">
                        <div className="truncate" title={unit.name}>{unit.name}</div>
                      </td>
                      {ratePlans.map(rp => {
                        // Preserve availability filtering: when we have price data for this
                        // unit, only its plans are selectable; otherwise allow all.
                        const isAvailable = availForUnit ? availForUnit.has(rp.id) : true;
                        const isSelected = selectedPlanId === rp.id;
                        return (
                          <td key={rp.id} className="text-center p-2 border-b border-slate-700">
                            <button
                              type="button"
                              disabled={!isAvailable}
                              onClick={() => onSelect(unit.id, rp.id)}
                              title={isAvailable ? rp.name : 'Brak danych cenowych dla tej kwatery'}
                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mx-auto transition ${
                                !isAvailable
                                  ? 'border-slate-700 bg-slate-700/40 cursor-not-allowed opacity-40'
                                  : isSelected
                                  ? 'border-indigo-400 bg-indigo-500 cursor-pointer'
                                  : 'border-slate-500 bg-slate-800 hover:border-indigo-400 cursor-pointer'
                              }`}
                            >
                              {isSelected && isAvailable && <span className="w-2 h-2 rounded-full bg-white" />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t border-slate-700 flex justify-end">
          <button onClick={onClose} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-5 rounded-lg transition">
            Gotowe
          </button>
        </div>
      </div>
    </div>
  );
};
