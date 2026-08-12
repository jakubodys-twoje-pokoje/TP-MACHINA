import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Building, Settings, BedDouble, Calendar, Plus, Home, X, Globe, Type, Loader2, AlertTriangle, Bell, Kanban, BadgePercent, FileText, CheckCircle, XCircle, Trash2, ChevronDown, ChevronRight, Calculator, Search, Database } from 'lucide-react';
import { useProperties } from '../contexts/PropertyContext';

interface SidebarProps {
  onNavigate?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onNavigate }) => {
  const { properties, loading, error, addProperty, importFromHotres, unreadCount, unreadCountByProperty, syncLogs, clearSyncLogs } = useProperties();
  const navigate = useNavigate();
  const location = useLocation();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'manual' | 'import'>('manual');
  const [formData, setFormData] = useState({ name: '', oid: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());
  const [expandedProperties, setExpandedProperties] = useState<Set<string>>(new Set());
  const [propertySearch, setPropertySearch] = useState('');

  // Accent-insensitive match so "sloneczny" finds "Słoneczny" (ł needs its own
  // mapping — NFD doesn't decompose it)
  const normalizeForSearch = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');

  const filteredProperties = propertySearch.trim()
    ? properties.filter(p => normalizeForSearch(p.name).includes(normalizeForSearch(propertySearch.trim())))
    : properties;

  const pathParts = location.pathname.split('/');
  const activePropertyId = pathParts[1] === 'property' ? pathParts[2] : null;

  const handleCreateProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || (modalMode === 'import' && !formData.oid)) return;
    setIsSubmitting(true);

    try {
      const description = modalMode === 'import' ? `Zaimportowano z Hotres` : null;
      const hotresId = modalMode === 'import' ? formData.oid : null;

      let newProperty;
      try {
        newProperty = await addProperty(formData.name, description, null, null, hotresId);
      } catch (err: any) {
        throw new Error(`Błąd tworzenia obiektu w bazie: ${err.message || JSON.stringify(err)}`);
      }

      if (!newProperty) throw new Error("Nie udało się utworzyć obiektu");

      if (modalMode === 'import' && formData.oid) {
        try {
          await importFromHotres(formData.oid, newProperty.id);
        } catch (err: any) {
          throw new Error(`Obiekt utworzony, ale import z Hotres nie powiódł się: ${err.message}`);
        }
      }

      setIsModalOpen(false);
      setFormData({ name: '', oid: '' });
      setModalMode('manual');
      navigate(`/property/${newProperty.id}/calendar`);

    } catch (err: any) {
      alert(`Błąd: ${err.message}`);
      console.error('handleCreateProperty error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNavLinkClick = () => {
    if (onNavigate) onNavigate();
  };

  return (
    <>
    <div className="flex flex-col h-full">
      <div className="p-4 sm:p-5 lg:p-6 border-b border-border">
        <div className="hidden lg:flex items-center gap-3 text-indigo-400 mb-6">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
            <Building size={20} />
          </div>
          <span className="font-bold text-lg tracking-tight text-white">Machina</span>
        </div>
        <div className="relative">
          <button
            onClick={() => setIsModalOpen(true)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white p-2.5 sm:p-3 rounded-lg sm:rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-900/20 active:scale-95 text-sm sm:text-base"
          >
            <Plus size={16} className="sm:w-[18px] sm:h-[18px]" />
            <span className="font-medium">Nowy Obiekt</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-3 sm:py-4 px-2 sm:px-3 space-y-1 custom-scrollbar">
        <NavLink
          to="/"
          onClick={handleNavLinkClick}
          className={({isActive}) => `flex items-center justify-between gap-2 sm:gap-3 px-2 sm:px-3 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm transition-colors mb-1 ${isActive ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
        >
          <div className="flex items-center gap-2 sm:gap-3"><Bell size={14} className="sm:w-4 sm:h-4" /> Panel główny</div>
          {unreadCount > 0 && (
            <span className="bg-red-600 text-white text-[10px] sm:text-xs font-bold rounded-full h-4 w-4 sm:h-5 sm:w-5 flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </NavLink>

        <NavLink
          to="/workflow"
          onClick={handleNavLinkClick}
          className={({isActive}) => `flex items-center justify-between gap-2 sm:gap-3 px-2 sm:px-3 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm transition-colors mb-3 sm:mb-4 ${isActive ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
        >
          <div className="flex items-center gap-2 sm:gap-3"><Kanban size={14} className="sm:w-4 sm:h-4" /> Workflow</div>
        </NavLink>

        <div className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider px-2 sm:px-3 mb-2">Twoje Obiekty</div>
        <div className="relative px-1 sm:px-2 mb-2">
          <Search size={13} className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={propertySearch}
            onChange={e => setPropertySearch(e.target.value)}
            placeholder="Szukaj obiektu..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-7 sm:pl-8 pr-7 py-1.5 sm:py-2 text-xs sm:text-sm text-white placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {propertySearch && (
            <button
              onClick={() => setPropertySearch('')}
              className="absolute right-2.5 sm:right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              title="Wyczyść"
            >
              <X size={13} />
            </button>
          )}
        </div>
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="animate-spin text-slate-500" /></div>
        ) : error ? (
           <div className="p-2 sm:p-3 mx-1 sm:mx-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-[10px] sm:text-xs">
             <div className="flex items-center gap-1.5 sm:gap-2 font-bold mb-1"><AlertTriangle size={12} className="sm:w-3.5 sm:h-3.5" /> Błąd bazy danych</div>
             {error}
           </div>
        ) : properties.length === 0 ? (
          <div className="text-slate-500 text-xs sm:text-sm text-center py-4 italic">Brak obiektów</div>
        ) : filteredProperties.length === 0 ? (
          <div className="text-slate-500 text-xs sm:text-sm text-center py-4 italic">Brak obiektów dla „{propertySearch.trim()}"</div>
        ) : (
          filteredProperties.map(property => {
            const propertyUnreadCount = unreadCountByProperty.get(property.id) || 0;
            const isExpanded = expandedProperties.has(property.id);

            const toggleExpanded = (e: React.MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              setExpandedProperties(prev => {
                const newSet = new Set(prev);
                if (newSet.has(property.id)) {
                  newSet.delete(property.id);
                } else {
                  newSet.add(property.id);
                }
                return newSet;
              });
            };

            return (
              <div key={property.id} className="space-y-1">
                <div
                  className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm transition-colors ${activePropertyId === property.id ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
                >
                  <button
                    onClick={toggleExpanded}
                    className="hover:bg-slate-700 p-0.5 rounded transition-colors flex-shrink-0"
                  >
                    {isExpanded ? <ChevronDown size={12} className="sm:w-3.5 sm:h-3.5" /> : <ChevronRight size={12} className="sm:w-3.5 sm:h-3.5" />}
                  </button>
                  <NavLink
                    to={`/property/${property.id}/calendar`}
                    onClick={handleNavLinkClick}
                    className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0"
                  >
                    <Home size={14} className="sm:w-4 sm:h-4 flex-shrink-0" />
                    <span className="truncate">{property.name}</span>
                  </NavLink>
                  {propertyUnreadCount > 0 && (
                    <span className="bg-red-600 text-white text-[9px] sm:text-[10px] font-bold rounded-full h-4 sm:h-5 min-w-[16px] sm:min-w-[20px] px-1 sm:px-1.5 flex items-center justify-center flex-shrink-0">
                      {propertyUnreadCount}
                    </span>
                  )}
                </div>
                {isExpanded && (
                  <div className="ml-3 sm:ml-4 pl-2 sm:pl-3 border-l border-slate-700 space-y-1 my-1 animate-in slide-in-from-left-2 duration-200">
                      <NavLink to={`/property/${property.id}/calendar`} onClick={handleNavLinkClick} className={({isActive}) => `flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-md text-[10px] sm:text-xs ${isActive ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-500 hover:text-slate-300'}`}><Calendar size={12} className="sm:w-3.5 sm:h-3.5" /> Dostępność</NavLink>
                      <NavLink to={`/property/${property.id}/units`} onClick={handleNavLinkClick} className={({isActive}) => `flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-md text-[10px] sm:text-xs ${isActive ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-500 hover:text-slate-300'}`}><BedDouble size={12} className="sm:w-3.5 sm:h-3.5" /> Kwatery</NavLink>
                      <NavLink to={`/property/${property.id}/pricing`} onClick={handleNavLinkClick} className={({isActive}) => `flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-md text-[10px] sm:text-xs ${isActive ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-500 hover:text-slate-300'}`}><BadgePercent size={12} className="sm:w-3.5 sm:h-3.5" /> Cenniki</NavLink>
                      <NavLink to={`/property/${property.id}/commission`} onClick={handleNavLinkClick} className={({isActive}) => `flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-md text-[10px] sm:text-xs ${isActive ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-500 hover:text-slate-300'}`}><Calculator size={12} className="sm:w-3.5 sm:h-3.5" /> Kalkulator prowizji</NavLink>
                      <NavLink to={`/property/${property.id}/export`} onClick={handleNavLinkClick} className={({isActive}) => `flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-md text-[10px] sm:text-xs ${isActive ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-500 hover:text-slate-300'}`}><Database size={12} className="sm:w-3.5 sm:h-3.5" /> Eksport Hotres</NavLink>
                      <NavLink to={`/property/${property.id}/details`} onClick={handleNavLinkClick} className={({isActive}) => `flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-md text-[10px] sm:text-xs ${isActive ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-500 hover:text-slate-300'}`}><Settings size={12} className="sm:w-3.5 sm:h-3.5" /> Ustawienia</NavLink>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Sync Logs Link */}
      <div className="px-4 sm:px-5 lg:px-6 py-2 sm:py-3 border-t border-border">
        <button
          onClick={() => setShowLogsModal(true)}
          className="w-full text-[10px] sm:text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 sm:gap-1.5 transition-colors"
        >
          <FileText size={10} className="sm:w-3 sm:h-3" />
          Historia synchronizacji
        </button>
      </div>
    </div>

    {isModalOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4">
        <div className="bg-surface border border-border w-full max-w-md rounded-xl sm:rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
          <div className="p-3 sm:p-4 border-b border-border flex justify-between items-center bg-slate-900/50">
            <h3 className="font-bold text-sm sm:text-base text-white">Dodaj nowy obiekt</h3>
            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white"><X size={18} className="sm:w-5 sm:h-5" /></button>
          </div>
          <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
            <div className="flex bg-slate-900 p-0.5 sm:p-1 rounded-lg border border-border">
              <button type="button" onClick={() => setModalMode('manual')} className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-md transition-all ${modalMode === 'manual' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}><Type size={14} className="sm:w-4 sm:h-4" /> Ręcznie</button>
              <button type="button" onClick={() => setModalMode('import')} className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-md transition-all ${modalMode === 'import' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}><Globe size={14} className="sm:w-4 sm:h-4" /> Hotres</button>
            </div>
            <form onSubmit={handleCreateProperty} className="space-y-3 sm:space-y-4">
              <div>
                <label className="block text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">Nazwa obiektu</label>
                <input autoFocus required type="text" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 sm:p-3 text-sm sm:text-base text-white outline-none focus:ring-2 focus:ring-indigo-500" placeholder="np. Willa Nadmorska" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              {modalMode === 'import' && (
                <div className="animate-in slide-in-from-top-2">
                  <label className="block text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">ID Obiektu (OID)</label>
                  <input required type="text" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 sm:p-3 text-sm sm:text-base text-white outline-none focus:ring-2 focus:ring-indigo-500 font-mono" placeholder="np. 4268" value={formData.oid} onChange={e => setFormData({...formData, oid: e.target.value})} />
                  <p className="text-[9px] sm:text-[10px] text-slate-500 mt-1.5 sm:mt-2">System automatycznie pobierze listę pokoi z Hotres i doda je do bazy.</p>
                </div>
              )}
              <button disabled={isSubmitting} className="w-full bg-green-600 hover:bg-green-500 text-white py-2.5 sm:py-3 rounded-lg sm:rounded-xl text-sm sm:text-base font-medium shadow-lg shadow-green-900/20 transition-all active:scale-95 flex items-center justify-center gap-2 mt-3 sm:mt-4">
                {isSubmitting ? <Loader2 size={16} className="sm:w-[18px] sm:h-[18px] animate-spin" /> : <Plus size={16} className="sm:w-[18px] sm:h-[18px]" />}
                {modalMode === 'import' ? 'Importuj i Utwórz' : 'Utwórz Obiekt'}
              </button>
            </form>
          </div>
        </div>
      </div>
    )}

    {showLogsModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4">
        <div className="bg-surface border border-border w-full max-w-2xl rounded-xl sm:rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 max-h-[85vh] sm:max-h-[80vh] flex flex-col">
          <div className="p-3 sm:p-4 border-b border-border flex justify-between items-center bg-slate-900/50">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <FileText size={16} className="sm:w-[18px] sm:h-[18px]" />
              <h3 className="font-bold text-sm sm:text-base text-white">Historia synchronizacji</h3>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              {syncLogs.length > 0 && (
                <button
                  onClick={() => {
                    if (confirm('Czy na pewno chcesz wyczyścić historię?')) {
                      clearSyncLogs();
                    }
                  }}
                  className="text-[10px] sm:text-xs text-red-400 hover:text-red-300 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded hover:bg-red-500/10 transition-colors flex items-center gap-0.5 sm:gap-1"
                >
                  <Trash2 size={10} className="sm:w-3 sm:h-3" />
                  <span className="hidden sm:inline">Wyczyść</span>
                </button>
              )}
              <button onClick={() => setShowLogsModal(false)} className="text-slate-400 hover:text-white">
                <X size={18} className="sm:w-5 sm:h-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 custom-scrollbar">
            {syncLogs.length === 0 ? (
              <div className="text-center text-slate-500 py-6 sm:py-8">
                <FileText size={28} className="sm:w-8 sm:h-8 mx-auto mb-2 opacity-50" />
                <p className="text-xs sm:text-sm">Brak historii synchronizacji</p>
              </div>
            ) : (
              <div className="space-y-1.5 sm:space-y-2">
                {syncLogs.map((log, idx) => {
                  const date = new Date(log.timestamp);
                  const timeStr = date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  const dateStr = date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
                  const isExpanded = expandedLogs.has(idx);
                  const hasDetails = (log.successes && log.successes.length > 0) || (log.errors && log.errors.length > 0);

                  return (
                    <div
                      key={idx}
                      className="bg-slate-900/50 border border-slate-700 rounded-md sm:rounded-lg overflow-hidden"
                    >
                      <div
                        className={`p-2 sm:p-3 flex items-center justify-between transition-colors ${hasDetails ? 'cursor-pointer hover:bg-slate-800/50' : ''}`}
                        onClick={() => {
                          if (hasDetails) {
                            setExpandedLogs(prev => {
                              const newSet = new Set(prev);
                              if (newSet.has(idx)) {
                                newSet.delete(idx);
                              } else {
                                newSet.add(idx);
                              }
                              return newSet;
                            });
                          }
                        }}
                      >
                        <div className="flex items-center gap-2 sm:gap-3 lg:gap-4 flex-1 min-w-0">
                          <div className="text-[10px] sm:text-xs text-slate-400 font-mono flex-shrink-0">
                            <div className="font-bold">{timeStr}</div>
                            <div className="text-[8px] sm:text-[10px]">{dateStr}</div>
                          </div>
                          <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                            {log.successCount > 0 && (
                              <div className="flex items-center gap-0.5 sm:gap-1 text-green-400">
                                <CheckCircle size={12} className="sm:w-3.5 sm:h-3.5" />
                                <span className="font-bold text-[10px] sm:text-xs">{log.successCount}</span>
                              </div>
                            )}
                            {log.errorCount > 0 && (
                              <div className="flex items-center gap-0.5 sm:gap-1 text-red-400">
                                <XCircle size={12} className="sm:w-3.5 sm:h-3.5" />
                                <span className="font-bold text-[10px] sm:text-xs">{log.errorCount}</span>
                              </div>
                            )}
                          </div>
                          <div className="hidden sm:flex items-center gap-2 lg:gap-3 text-[9px] sm:text-[10px] text-slate-500 ml-auto">
                            {log.recordsCompared !== undefined && log.recordsCompared > 0 && (
                              <div className="flex items-center gap-0.5 sm:gap-1">
                                <span className="hidden lg:inline">Porównano:</span>
                                <span className="font-bold text-slate-400">{log.recordsCompared.toLocaleString()}</span>
                              </div>
                            )}
                            {log.unitsWithChanges !== undefined && log.unitsWithChanges > 0 && (
                              <div className="flex items-center gap-0.5 sm:gap-1">
                                <span className="hidden lg:inline">Zmian:</span>
                                <span className="font-bold text-yellow-400">{log.unitsWithChanges}</span>
                              </div>
                            )}
                            {log.notificationsCreated !== undefined && log.notificationsCreated > 0 && (
                              <div className="flex items-center gap-0.5 sm:gap-1">
                                <span className="hidden lg:inline">Powiadomień:</span>
                                <span className="font-bold text-blue-400">{log.notificationsCreated}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        {hasDetails && (
                          <div className="flex-shrink-0">
                            {isExpanded ? <ChevronDown size={14} className="sm:w-4 sm:h-4 text-slate-500" /> : <ChevronRight size={14} className="sm:w-4 sm:h-4 text-slate-500" />}
                          </div>
                        )}
                      </div>

                      {isExpanded && hasDetails && (
                        <div className="border-t border-slate-700 p-2 sm:p-3 bg-slate-950/50 space-y-1.5 sm:space-y-2">
                          {log.successes && log.successes.length > 0 && (
                            <div className="space-y-0.5 sm:space-y-1">
                              <div className="text-[10px] sm:text-xs font-bold text-green-400 mb-0.5 sm:mb-1">Zsynchronizowane:</div>
                              {log.successes.map((success, sIdx) => (
                                <div key={sIdx} className="text-[10px] sm:text-xs text-slate-400 pl-1.5 sm:pl-2 flex items-center gap-1.5 sm:gap-2">
                                  <CheckCircle size={9} className="sm:w-2.5 sm:h-2.5 text-green-500 flex-shrink-0" />
                                  <span className="truncate">{success.propertyName}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {log.errors && log.errors.length > 0 && (
                            <div className="space-y-0.5 sm:space-y-1">
                              <div className="text-[10px] sm:text-xs font-bold text-red-400 mb-0.5 sm:mb-1">Błędy:</div>
                              {log.errors.map((error, eIdx) => (
                                <div key={eIdx} className="text-[10px] sm:text-xs pl-1.5 sm:pl-2">
                                  <div className="flex items-center gap-1.5 sm:gap-2 text-red-400">
                                    <XCircle size={9} className="sm:w-2.5 sm:h-2.5 flex-shrink-0" />
                                    <span className="font-medium truncate">{error.propertyName}</span>
                                  </div>
                                  <div className="text-slate-500 pl-3 sm:pl-4 mt-0.5 text-[9px] sm:text-[10px] break-words">{error.error}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
};