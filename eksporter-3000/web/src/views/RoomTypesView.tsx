import React, { useMemo, useState } from 'react';
import {
  Card, CopyButton, CopyRecordButton, Empty, Expandable, FieldTable, LangTabs, PageHeader,
  PhotoGrid, SearchBox, SimpleTable,
} from '../ui';
import { ROOMTYPE_GROUPS, ROOMTYPE_TEXTS, ROOM_FIELDS } from '../fields';
import { buildDefinitionMap, matches, titleOf } from '../helpers';
import { photosZipUrl } from '../api';

export const RoomTypesView: React.FC<{ data: any }> = ({ data }) => {
  const [query, setQuery] = useState('');
  const facilityMap = useMemo(
    () => buildDefinitionMap(data.definitions ?? [], 'facilities'),
    [data.definitions],
  );

  const roomTypes: any[] = data.roomTypes ?? [];
  const filtered = roomTypes.filter(
    type => matches(titleOf(type), query) || matches(type.hotresId, query),
  );

  const allFields = ROOMTYPE_GROUPS.flatMap(group => group.fields);

  return (
    <div>
      <PageHeader
        title="Standardy"
        count={roomTypes.length}
        source="api_roomstypes + api_roomtype"
        subtitle="Typy pokoi wystawiane na sprzedaż: miejsca noclegowe, metraż, wyposażenie, opisy w każdym języku i pełna galeria. Pod każdym standardem widać przypisane do niego pokoje fizyczne."
      >
        <SearchBox value={query} onChange={setQuery} placeholder="Szukaj standardu…" />
      </PageHeader>

      {roomTypes.length === 0 ? (
        <Empty text="Brak standardów - uruchom eksport z grupą „Standardy / typy pokoi”" />
      ) : filtered.length === 0 ? (
        <Empty text={`Nic nie pasuje do „${query}”`} />
      ) : (
        <div className="space-y-2">
          {filtered.map(type => (
            <RoomTypeCard
              key={type.id}
              oid={data.oid}
              type={type}
              facilityMap={facilityMap}
              allFields={allFields}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const RoomTypeCard: React.FC<{
  oid: string;
  type: any;
  facilityMap: Map<string, string>;
  allFields: any[];
}> = ({ oid, type, facilityMap, allFields }) => {
  const langs: string[] = (type.translations ?? []).map((item: any) => item.lang);
  const [lang, setLang] = useState(langs[0] ?? 'pl');
  const translation = (type.translations ?? []).find((item: any) => item.lang === lang);

  const beds = [
    type.single && `${type.single}× pojedyncze`,
    type.double && `${type.double}× podwójne`,
    type.sofa && `${type.sofa}× sofa`,
    type.bunkBed && `${type.bunkBed}× piętrowe`,
    type.extraBed && `${type.extraBed}× dostawka`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Expandable
      header={
        <div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-base font-semibold text-white">{titleOf(type)}</span>
            <span className="text-[11px] font-mono text-slate-500">type_id {type.hotresId}</span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {[beds || 'brak łóżek', type.area && `${type.area} m²`, type.floor !== null && `piętro ${type.floor}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      }
      badge={
        <span className="text-[11px] text-slate-500 flex-shrink-0">
          {type.photos?.length ?? 0} zdj. · {type.rooms?.length ?? 0} pok.
        </span>
      }
    >
      <div className="flex justify-end">
        <CopyRecordButton fields={allFields} row={type} />
      </div>

      {ROOMTYPE_GROUPS.map(group => (
        <div key={group.title}>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
            {group.title}
          </h3>
          <FieldTable fields={group.fields} row={type} />
        </div>
      ))}

      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
          Wyposażenie ({type.facilities?.length ?? 0})
          <span className="ml-2 font-mono normal-case text-slate-600">facilities</span>
        </h3>
        {(type.facilities?.length ?? 0) === 0 ? (
          <p className="text-slate-600 text-sm italic">Brak przypisanego wyposażenia.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {type.facilities.map((facility: any) => (
                <span
                  key={facility.id}
                  className="bg-slate-800 border border-slate-700 text-slate-200 text-xs px-2.5 py-1 rounded-lg"
                >
                  {facilityMap.get(facility.facilityId) ?? `nieznane #${facility.facilityId}`}
                  <span className="ml-1.5 text-slate-500 font-mono text-[10px]">
                    {facility.facilityId}
                  </span>
                </span>
              ))}
            </div>
            <div className="mt-2">
              <CopyButton
                value={type.facilities
                  .map((facility: any) => facilityMap.get(facility.facilityId) ?? facility.facilityId)
                  .join(', ')}
                label="Kopiuj listę wyposażenia"
                className="border border-slate-700 !px-2 !py-1"
              />
            </div>
          </>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide">
            Treści i opisy
          </h3>
          <LangTabs langs={langs} active={lang} onChange={setLang} />
        </div>
        {langs.length === 0 ? (
          <p className="text-slate-600 text-sm italic">Brak treści w żadnym języku.</p>
        ) : (
          <FieldTable fields={ROOMTYPE_TEXTS} row={translation ?? {}} />
        )}
      </div>

      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
          Galeria ({type.photos?.length ?? 0})
        </h3>
        <PhotoGrid
          photos={type.photos ?? []}
          zipUrl={photosZipUrl(oid, { roomType: type.hotresId })}
        />
      </div>

      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
          Pokoje w tym standardzie ({type.rooms?.length ?? 0})
        </h3>
        {(type.rooms?.length ?? 0) === 0 ? (
          <p className="text-slate-600 text-sm italic">
            Żaden pokój fizyczny nie jest przypisany do tego standardu.
          </p>
        ) : (
          <SimpleTable
            columns={[
              { key: 'code', label: 'Numer' },
              { key: 'hotresId', label: 'room_id', mono: true },
              { key: 'state', label: 'Stan' },
              { key: 'single', label: 'Poj.' },
              { key: 'double', label: 'Podw.' },
              { key: 'extraBed', label: 'Dost.' },
            ]}
            rows={type.rooms}
          />
        )}
      </div>
    </Expandable>
  );
};

export const RoomsView: React.FC<{ data: any }> = ({ data }) => {
  const [query, setQuery] = useState('');
  const rooms: any[] = data.rooms ?? [];

  const typeTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const type of data.roomTypes ?? []) map.set(type.hotresId, titleOf(type));
    return map;
  }, [data.roomTypes]);

  const withTitles = rooms.map(room => ({
    ...room,
    typeTitle: room.typeHotresId ? typeTitles.get(room.typeHotresId) ?? null : null,
  }));

  const filtered = withTitles.filter(
    room =>
      matches(room.code, query) ||
      matches(room.hotresId, query) ||
      matches(room.typeTitle, query),
  );

  return (
    <div>
      <PageHeader
        title="Pokoje fizyczne"
        count={rooms.length}
        source="api_rooms"
        subtitle="Konkretne pokoje z numerami, stanem sprzątania i polami własnymi. To one są przypisywane do rezerwacji - standard mówi tylko, co jest sprzedawane."
      >
        <SearchBox value={query} onChange={setQuery} placeholder="Szukaj pokoju…" />
      </PageHeader>

      {rooms.length === 0 ? (
        <Empty text="Brak pokoi - uruchom eksport z grupą „Pokoje fizyczne”" />
      ) : (
        <>
          <Card title="Zestawienie">
            <SimpleTable
              columns={[
                { key: 'code', label: 'Numer / nazwa' },
                { key: 'hotresId', label: 'room_id', mono: true },
                { key: 'typeTitle', label: 'Standard' },
                { key: 'typeHotresId', label: 'type_id', mono: true },
                { key: 'state', label: 'Stan' },
                { key: 'single', label: 'Poj.' },
                { key: 'double', label: 'Podw.' },
                { key: 'sofa', label: 'Sofa' },
                { key: 'bunkBed', label: 'Piętr.' },
                { key: 'extraBed', label: 'Dost.' },
                { key: 'priority', label: 'Prio' },
              ]}
              rows={filtered}
            />
          </Card>

          <Card title="Pełne dane każdego pokoju">
            <div className="space-y-2">
              {filtered.map(room => (
                <Expandable
                  key={room.id}
                  header={
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">
                        {room.code || `pokój ${room.hotresId}`}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        room_id {room.hotresId}
                      </span>
                      {room.typeTitle && (
                        <span className="text-xs text-slate-400">→ {room.typeTitle}</span>
                      )}
                    </div>
                  }
                >
                  <div className="flex justify-end">
                    <CopyRecordButton fields={ROOM_FIELDS} row={room} />
                  </div>
                  <FieldTable fields={ROOM_FIELDS} row={room} />
                </Expandable>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
