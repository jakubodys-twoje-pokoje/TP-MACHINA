import React, { useState } from 'react';
import { Building2 } from 'lucide-react';
import {
  Card, CopyRecordButton, Empty, FieldTable, LangTabs, PageHeader, PhotoGrid,
} from '../ui';
import { PROPERTY_GROUPS, PROPERTY_TEXTS } from '../fields';
import { photosZipUrl } from '../api';

export const ObjectView: React.FC<{ data: any }> = ({ data }) => {
  const langs: string[] = (data.translations ?? []).map((item: any) => item.lang);
  const [lang, setLang] = useState(langs[0] ?? 'pl');
  const translation = (data.translations ?? []).find((item: any) => item.lang === lang);

  const allFields = PROPERTY_GROUPS.flatMap(group => group.fields);

  return (
    <div>
      <PageHeader
        title="Obiekt"
        source="api_object"
        subtitle="Dane samego obiektu: kontakt, adres, dane do faktur, doba hotelowa, opisy i galeria. To jest to, co w nowym PMS-ie wypełnia kartę obiektu."
      >
        <CopyRecordButton fields={allFields} row={data} />
      </PageHeader>

      {PROPERTY_GROUPS.map(group => (
        <Card key={group.title} title={group.title}>
          <FieldTable fields={group.fields} row={data} />
        </Card>
      ))}

      <Card
        title="Opisy"
        right={<LangTabs langs={langs} active={lang} onChange={setLang} />}
      >
        {langs.length === 0 ? (
          <Empty text="Brak opisów - obiekt nie był eksportowany w żadnym języku" />
        ) : (
          <div className="space-y-5">
            {PROPERTY_TEXTS.map(field => (
              <div key={field.key}>
                <div className="flex items-baseline gap-2 mb-2">
                  <h3 className="text-sm font-medium text-slate-300">{field.label}</h3>
                  <span className="text-[11px] font-mono text-slate-600">{field.hotres}</span>
                </div>
                <FieldTable fields={[field]} row={translation ?? {}} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Galeria obiektu (${data.photos?.length ?? 0})`}>
        <PhotoGrid photos={data.photos ?? []} zipUrl={photosZipUrl(data.oid)} />
      </Card>

      {(data.photos?.length ?? 0) === 0 && (
        <p className="text-slate-600 text-xs flex items-center gap-2">
          <Building2 size={12} /> Jeśli w Hotresie są zdjęcia, a tu ich nie ma - uruchom eksport
          ponownie z zaznaczoną grupą „Obiekt".
        </p>
      )}
    </div>
  );
};
