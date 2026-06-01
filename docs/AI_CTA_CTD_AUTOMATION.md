# AI Automation dla CTA/CTD - Pure n8n Workflow

## Przegląd
System automatycznie proponuje optymalne ustawienia CTA (Close To Arrival) i CTD (Close To Departure) na podstawie:
- Historii rezerwacji (lead time, długość pobytu)
- Wzorców bookingów (weekend vs weekday)
- Obecnej dostępności i luk w kalendarzu
- Obecnych restrykcji

**Koszt:** ~$0.003 (0.3 centa) per 35 powiadomień
**Czas:** 2-5 sekund

## Architektura

```
[Frontend Button "🤖 Zatrudnij AI"]
    ↓ POST notification_ids[]
[n8n Webhook]
    ↓
[Supabase: Query notifications, reservations, availability, prices]
    ↓
[Function: Build context & Gemini prompt]
    ↓
[Gemini Flash API]
    ↓
[Supabase: Insert to ai_suggestions table]
    ↓
[Frontend: Show suggestions modal]
```

## 1. Supabase Setup

### Tabela `ai_suggestions`

```sql
CREATE TABLE ai_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notification_id UUID REFERENCES notifications(id),
  property_id UUID REFERENCES properties(id),
  unit_id UUID REFERENCES units(id),
  property_name TEXT,
  unit_name TEXT,
  date_start DATE,
  date_end DATE,
  suggested_cta INT,
  suggested_ctd INT,
  suggested_min INT,
  confidence INT CHECK (confidence >= 0 AND confidence <= 100),
  reasoning TEXT,
  expected_impact TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
  applied_at TIMESTAMPTZ,
  applied_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  INDEX idx_ai_suggestions_status (status),
  INDEX idx_ai_suggestions_created_at (created_at DESC)
);

-- Enable RLS
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their suggestions
CREATE POLICY "Users can read ai_suggestions" ON ai_suggestions
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Policy: Service role can insert
CREATE POLICY "Service can insert ai_suggestions" ON ai_suggestions
  FOR INSERT WITH CHECK (true);
```

### Tabela `ai_suggestion_feedback` (opcjonalna - do uczenia)

```sql
CREATE TABLE ai_suggestion_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  suggestion_id UUID REFERENCES ai_suggestions(id),
  worked BOOLEAN, -- czy faktycznie wypełniło lukę
  gap_filled_at TIMESTAMPTZ, -- kiedy luka została wypełniona
  user_feedback TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 2. n8n Workflow Setup

### Node 1: Webhook Trigger
**Type:** Webhook
**Method:** POST
**Path:** `/webhook/ai-cta-suggestions`

**Expected Body:**
```json
{
  "notification_ids": ["uuid1", "uuid2", "..."],
  "user_id": "uuid"
}
```

---

### Node 2: Fetch Notifications
**Type:** Supabase Node
**Operation:** Get rows
**Table:** `notifications`

**Filters:**
- `id` → `in` → `{{ $json.body.notification_ids }}`

**Select fields:**
```
id, property_id, unit_id, property_name, unit_name,
change_type, start_date, end_date, created_at
```

**Sort:** `start_date` ASC

---

### Node 3: Extract IDs
**Type:** Function Node

```javascript
// Extract unique property and unit IDs
const notifications = $input.all();
const notifData = notifications.map(n => n.json);

const unitIds = [...new Set(notifData.map(n => n.unit_id))];
const propertyIds = [...new Set(notifData.map(n => n.property_id))];

return [{
  json: {
    notifications: notifData,
    unit_ids: unitIds,
    property_ids: propertyIds
  }
}];
```

---

### Node 4: Fetch Reservation History (last 6 months)
**Type:** Supabase Node
**Operation:** Get rows
**Table:** `reservations`

**Filters:**
- `unit_id` → `in` → `{{ $json.unit_ids }}`
- `check_in` → `gte` → `{{ new Date(Date.now() - 180*24*60*60*1000).toISOString().split('T')[0] }}`

**Select fields:**
```
unit_id, check_in, check_out, status, created_at, nights, total_price
```

**Sort:** `check_in` DESC

---

### Node 5: Fetch Current Availability (next 90 days)
**Type:** Supabase Node
**Operation:** Get rows
**Table:** `availability`

**Filters:**
- `unit_id` → `in` → `{{ $node["Extract IDs"].json.unit_ids }}`
- `date` → `gte` → `{{ new Date().toISOString().split('T')[0] }}`
- `date` → `lte` → `{{ new Date(Date.now() + 90*24*60*60*1000).toISOString().split('T')[0] }}`

**Select fields:**
```
unit_id, date, status
```

---

### Node 6: Fetch Current Prices/Restrictions (next 90 days)
**Type:** Supabase Node
**Operation:** Get rows
**Table:** `prices`

**Filters:**
- `unit_id` → `in` → `{{ $node["Extract IDs"].json.unit_ids }}`
- `date` → `gte` → `{{ new Date().toISOString().split('T')[0] }}`
- `date` → `lte` → `{{ new Date(Date.now() + 90*24*60*60*1000).toISOString().split('T')[0] }}`

**Select fields:**
```
unit_id, date, cta, ctd, min, price
```

---

### Node 7: Fetch Units
**Type:** Supabase Node
**Operation:** Get rows
**Table:** `units`

**Filters:**
- `id` → `in` → `{{ $node["Extract IDs"].json.unit_ids }}`

**Select fields:**
```
id, name, property_id, base_price
```

---

### Node 8: Build Context & Prompt
**Type:** Function Node

```javascript
// Collect all data
const notifications = $node["Extract IDs"].json.notifications;
const reservations = $node["Fetch Reservation History"].all().map(n => n.json);
const availability = $node["Fetch Current Availability"].all().map(n => n.json);
const prices = $node["Fetch Current Prices/Restrictions"].all().map(n => n.json);
const units = $node["Fetch Units"].all().map(n => n.json);

// Calculate statistics per unit
const unitStats = {};

units.forEach(unit => {
  const unitReservations = reservations.filter(r => r.unit_id === unit.id);
  const unitAvailability = availability.filter(a => a.unit_id === unit.id);

  // Lead time calculation
  const leadTimes = unitReservations
    .filter(r => r.created_at && r.check_in)
    .map(r => {
      const created = new Date(r.created_at);
      const checkin = new Date(r.check_in);
      return Math.floor((checkin - created) / (1000 * 60 * 60 * 24));
    })
    .filter(lt => lt >= 0 && lt < 365);

  const avgLeadTime = leadTimes.length > 0
    ? Math.round(leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length)
    : null;

  // Weekend vs weekday bookings
  const weekendBookings = unitReservations.filter(r => {
    const checkin = new Date(r.check_in);
    const day = checkin.getDay();
    return day === 5 || day === 6; // Friday or Saturday
  }).length;

  const weekendPercentage = unitReservations.length > 0
    ? Math.round((weekendBookings / unitReservations.length) * 100)
    : null;

  // Occupancy next 30 days
  const next30Days = unitAvailability.filter(a => {
    const date = new Date(a.date);
    const diff = (date - new Date()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 30;
  });

  const bookedDays = next30Days.filter(a => a.status === 'blocked').length;
  const occupancyRate = next30Days.length > 0
    ? Math.round((bookedDays / next30Days.length) * 100)
    : null;

  // Average stay length
  const avgNights = unitReservations.length > 0
    ? Math.round(unitReservations.reduce((sum, r) => sum + (r.nights || 0), 0) / unitReservations.length)
    : null;

  unitStats[unit.id] = {
    unit_name: unit.name,
    total_bookings_6m: unitReservations.length,
    avg_lead_time_days: avgLeadTime,
    weekend_booking_percentage: weekendPercentage,
    current_occupancy_30d: occupancyRate,
    avg_stay_nights: avgNights
  };
});

// Enrich notifications with context
const enrichedNotifications = notifications.map(notif => {
  const stats = unitStats[notif.unit_id] || {};

  // Get surrounding availability (±7 days)
  const notifDate = new Date(notif.start_date);
  const before7 = new Date(notifDate);
  before7.setDate(before7.getDate() - 7);
  const after7 = new Date(notifDate);
  after7.setDate(after7.getDate() + 7);

  const surroundingAvail = availability
    .filter(a => {
      const aDate = new Date(a.date);
      return a.unit_id === notif.unit_id && aDate >= before7 && aDate <= after7;
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(a => `${a.date}: ${a.status}`);

  // Current restrictions for this date
  const currentRestrictions = prices
    .filter(p =>
      p.unit_id === notif.unit_id &&
      p.date >= notif.start_date &&
      p.date <= notif.end_date
    );

  return {
    ...notif,
    stats,
    surrounding_availability: surroundingAvail.slice(0, 15),
    current_cta: currentRestrictions[0]?.cta || 'brak',
    current_ctd: currentRestrictions[0]?.ctd || 'brak',
    current_min: currentRestrictions[0]?.min || 'brak'
  };
});

// Build Gemini prompt
const prompt = `Jesteś ekspertem od revenue management dla wynajmu krótkoterminowego w Polsce.

ZADANIE: Zaproponuj optymalne ustawienia CTA (Close To Arrival) i CTD (Close To Departure) dla ${notifications.length} powiadomień o lukach w dostępności.

DEFINICJE:
- CTA = ile dni przed przyjazdem przestajemy przyjmować rezerwacje (0 = można bookować do ostatniej chwili)
- CTD = ile dni przed wyjazdem przestajemy przyjmować rezerwacje
- MIN = minimalna długość pobytu w dniach

CELE:
1. Wypełnić jednodniowe luki między rezerwacjami (NAJWYŻSZY PRIORYTET)
2. Zoptymalizować wykorzystanie kalendarza
3. Nie blokować długich, wartościowych rezerwacji
4. Uwzględnić wzorce bookingów i sezonowość

DANE O POWIADOMIENIACH:
${enrichedNotifications.map((n, i) => `
${i + 1}. ${n.property_name} - ${n.unit_name}
   Luka: ${n.start_date} do ${n.end_date} (${n.change_type})
   Obecne: CTA=${n.current_cta}, CTD=${n.current_ctd}, MIN=${n.current_min}

   Statystyki:
   - Średni lead time: ${n.stats.avg_lead_time_days || 'brak'} dni
   - Weekend bookings: ${n.stats.weekend_booking_percentage || 'brak'}%
   - Obłożenie 30d: ${n.stats.current_occupancy_30d || 'brak'}%
   - Średnia długość: ${n.stats.avg_stay_nights || 'brak'} nocy
   - Rezerwacji 6m: ${n.stats.total_bookings_6m || 0}

   Otoczenie:
${n.surrounding_availability.join('\n')}
`).join('\n')}

ZASADY OPTYMALIZACJI:
1. Jednodniowa luka między rezerwacjami:
   → CTA=7-14, CTD=0, MIN=2 (wypełni lukę + longer stays)

2. Luka 2-3 dni w sezonie:
   → CTA=3-7, CTD=0, MIN=2-3 (szansa na short break)

3. Luka 4+ dni z niskim lead time (<10):
   → CTA=0-3, CTD=0, MIN=2 (last-minute)

4. Luka w low season z długim lead time:
   → CTA=14-21, CTD=0, MIN=3-5 (dłuższe pobyty)

5. Weekend gap + >70% weekend bookings:
   → CTA=7-14, MIN=2-3

6. NIE ustawiaj agresywnych restrykcji jeśli:
   - Occupancy <40%
   - Lead time >30 dni
   - Sezon niski (styczeń-marzec, listopad)

OUTPUT: TYLKO VALID JSON, BEZ MARKDOWN
{
  "suggestions": [
    {
      "notification_id": "uuid",
      "unit_id": "uuid",
      "unit_name": "...",
      "property_name": "...",
      "date_start": "2026-06-15",
      "date_end": "2026-06-16",
      "suggested_cta": 7,
      "suggested_ctd": 0,
      "suggested_min": 2,
      "confidence": 85,
      "reasoning": "Jednodniowa luka. CTA=7 da czas na wypełnienie, CTD=0 flexibility, MIN=2 wypełni lukę.",
      "expected_impact": "Wysoka szansa na wypełnienie, zachowanie flexibility"
    }
  ]
}`;

return [{
  json: {
    prompt,
    notifications: enrichedNotifications
  }
}];
```

---

### Node 9: Call Gemini API
**Type:** HTTP Request
**Method:** POST
**URL:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={{ $env.GEMINI_API_KEY }}`

**Headers:**
```json
{
  "Content-Type": "application/json"
}
```

**Body:**
```json
{
  "contents": [{
    "parts": [{
      "text": "{{ $json.prompt }}"
    }]
  }],
  "generationConfig": {
    "temperature": 0.3,
    "topK": 40,
    "topP": 0.95,
    "maxOutputTokens": 8192,
    "responseMimeType": "application/json"
  }
}
```

---

### Node 10: Parse Gemini Response
**Type:** Function Node

```javascript
const geminiResponse = $input.item.json;
const notifications = $node["Build Context & Prompt"].json.notifications;

// Extract JSON from Gemini response
const text = geminiResponse.candidates[0].content.parts[0].text;
let parsed;

try {
  parsed = JSON.parse(text);
} catch (e) {
  // Fallback: extract JSON from markdown
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    parsed = JSON.parse(jsonMatch[0]);
  } else {
    throw new Error('Failed to parse Gemini response');
  }
}

// Enrich suggestions with full notification data
const enrichedSuggestions = parsed.suggestions.map(s => {
  const notif = notifications.find(n => n.id === s.notification_id);
  return {
    notification_id: s.notification_id,
    property_id: notif?.property_id,
    unit_id: s.unit_id,
    property_name: s.property_name,
    unit_name: s.unit_name,
    date_start: s.date_start,
    date_end: s.date_end,
    suggested_cta: s.suggested_cta,
    suggested_ctd: s.suggested_ctd,
    suggested_min: s.suggested_min,
    confidence: s.confidence,
    reasoning: s.reasoning,
    expected_impact: s.expected_impact,
    status: 'pending'
  };
});

return [{
  json: {
    suggestions: enrichedSuggestions
  }
}];
```

---

### Node 11: Insert to Supabase
**Type:** Supabase Node
**Operation:** Insert rows
**Table:** `ai_suggestions`

**Rows:** `{{ $json.suggestions }}`

**Options:**
- Return inserted rows: ✓

---

### Node 12: Response to Webhook
**Type:** Respond to Webhook

**Response Body:**
```json
{
  "success": true,
  "suggestions": "{{ $json }}",
  "count": "{{ $json.length }}",
  "generated_at": "{{ new Date().toISOString() }}"
}
```

---

## 3. Frontend Integration

### Button w Notifications List

```typescript
// components/NotificationsList.tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AISuggestionsModal } from './AISuggestionsModal';

export function NotificationsList() {
  const [selectedNotifications, setSelectedNotifications] = useState<string[]>([]);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiSuggestions, setAISuggestions] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const handleAIOptimization = async () => {
    if (selectedNotifications.length === 0) return;

    setIsLoadingAI(true);

    try {
      const response = await fetch('https://YOUR_N8N_INSTANCE.app.n8n.cloud/webhook/ai-cta-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notification_ids: selectedNotifications,
          user_id: user.id
        })
      });

      const result = await response.json();

      if (result.success) {
        setAISuggestions(result.suggestions);
        setShowModal(true);
      }
    } catch (error) {
      console.error('AI optimization failed:', error);
      toast.error('Nie udało się wygenerować sugestii AI');
    } finally {
      setIsLoadingAI(false);
    }
  };

  return (
    <div>
      {/* Notifications list with checkboxes */}

      <div className="flex gap-2 mt-4">
        <Button
          onClick={handleAIOptimization}
          disabled={selectedNotifications.length === 0 || isLoadingAI}
          className="border-yellow-400 text-yellow-600 hover:bg-yellow-50"
        >
          {isLoadingAI ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              AI pracuje...
            </>
          ) : (
            <>🤖 Zatrudnij AI ({selectedNotifications.length})</>
          )}
        </Button>
      </div>

      {showModal && (
        <AISuggestionsModal
          suggestions={aiSuggestions}
          onClose={() => setShowModal(false)}
          onApply={handleApplySuggestions}
        />
      )}
    </div>
  );
}
```

### AI Suggestions Modal

```typescript
// components/AISuggestionsModal.tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';

interface AISuggestion {
  id: string;
  notification_id: string;
  unit_name: string;
  property_name: string;
  date_start: string;
  date_end: string;
  suggested_cta: number;
  suggested_ctd: number;
  suggested_min: number;
  confidence: number;
  reasoning: string;
  expected_impact: string;
}

export function AISuggestionsModal({
  suggestions,
  onClose,
  onApply
}: {
  suggestions: AISuggestion[];
  onClose: () => void;
  onApply: (suggestions: AISuggestion[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>(
    // Pre-select high confidence suggestions
    suggestions.filter(s => s.confidence > 80).map(s => s.id)
  );
  const [isApplying, setIsApplying] = useState(false);

  const handleApplySelected = async () => {
    const toApply = suggestions.filter(s => selected.includes(s.id));
    setIsApplying(true);

    try {
      await onApply(toApply);
      onClose();
    } catch (error) {
      console.error('Failed to apply suggestions:', error);
    } finally {
      setIsApplying(false);
    }
  };

  const highConfidence = suggestions.filter(s => s.confidence > 80).length;
  const mediumConfidence = suggestions.filter(s => s.confidence >= 60 && s.confidence <= 80).length;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            🤖 Sugestie AI - Optymalizacja CTA/CTD
          </DialogTitle>
          <div className="flex gap-3 mt-2">
            <Badge variant="success">{highConfidence} wysokiej pewności</Badge>
            <Badge variant="warning">{mediumConfidence} średniej pewności</Badge>
            <Badge variant="secondary">{suggestions.length} total</Badge>
          </div>
        </DialogHeader>

        <div className="space-y-3 mt-4">
          {suggestions
            .sort((a, b) => b.confidence - a.confidence)
            .map(suggestion => (
              <Card
                key={suggestion.id}
                className={`${
                  suggestion.confidence > 80
                    ? 'border-green-300 bg-green-50/50'
                    : 'border-yellow-300 bg-yellow-50/50'
                } transition-all hover:shadow-md`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Checkbox
                          checked={selected.includes(suggestion.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelected([...selected, suggestion.id]);
                            } else {
                              setSelected(selected.filter(id => id !== suggestion.id));
                            }
                          }}
                        />
                        <span>{suggestion.property_name} - {suggestion.unit_name}</span>
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {suggestion.date_start} {suggestion.date_start !== suggestion.date_end && `→ ${suggestion.date_end}`}
                      </p>
                    </div>
                    <Badge
                      variant={suggestion.confidence > 80 ? 'success' : 'warning'}
                      className="text-base px-3 py-1"
                    >
                      {suggestion.confidence}%
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* CTA/CTD/MIN Display */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-blue-100 p-3 rounded-lg text-center">
                      <p className="text-xs text-blue-700 font-medium">CTA</p>
                      <p className="text-3xl font-bold text-blue-900">
                        {suggestion.suggested_cta}
                      </p>
                      <p className="text-xs text-blue-600">dni przed</p>
                    </div>
                    <div className="bg-purple-100 p-3 rounded-lg text-center">
                      <p className="text-xs text-purple-700 font-medium">CTD</p>
                      <p className="text-3xl font-bold text-purple-900">
                        {suggestion.suggested_ctd}
                      </p>
                      <p className="text-xs text-purple-600">dni przed</p>
                    </div>
                    <div className="bg-green-100 p-3 rounded-lg text-center">
                      <p className="text-xs text-green-700 font-medium">MIN</p>
                      <p className="text-3xl font-bold text-green-900">
                        {suggestion.suggested_min}
                      </p>
                      <p className="text-xs text-green-600">nocy min</p>
                    </div>
                  </div>

                  {/* Reasoning */}
                  <div className="bg-white p-3 rounded-lg border">
                    <p className="text-sm font-semibold text-gray-700 mb-1">
                      💡 Uzasadnienie:
                    </p>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {suggestion.reasoning}
                    </p>
                  </div>

                  {/* Expected Impact */}
                  <div className="bg-white p-3 rounded-lg border">
                    <p className="text-sm font-semibold text-gray-700 mb-1">
                      📊 Oczekiwany efekt:
                    </p>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {suggestion.expected_impact}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>

        <DialogFooter className="gap-2 mt-6">
          <Button variant="outline" onClick={onClose} disabled={isApplying}>
            Anuluj
          </Button>
          <Button
            onClick={handleApplySelected}
            disabled={selected.length === 0 || isApplying}
          >
            {isApplying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Aplikuję...
              </>
            ) : (
              `Zastosuj zaznaczone (${selected.length})`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Apply Suggestions Function

```typescript
// lib/ai-suggestions.ts
import { createClient } from '@/lib/supabase/client';

export async function applyAISuggestions(suggestions: AISuggestion[]) {
  const supabase = createClient();

  // Group by unit for batch updates
  const updatesByUnit = new Map<string, Array<{date: string, cta: number, ctd: number, min: number}>>();

  for (const suggestion of suggestions) {
    const dateStart = new Date(suggestion.date_start);
    const dateEnd = new Date(suggestion.date_end);

    // Generate all dates in range
    const dates: string[] = [];
    for (let d = new Date(dateStart); d <= dateEnd; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }

    if (!updatesByUnit.has(suggestion.unit_id)) {
      updatesByUnit.set(suggestion.unit_id, []);
    }

    dates.forEach(date => {
      updatesByUnit.get(suggestion.unit_id)!.push({
        date,
        cta: suggestion.suggested_cta,
        ctd: suggestion.suggested_ctd,
        min: suggestion.suggested_min
      });
    });
  }

  // Apply updates to prices table
  for (const [unitId, updates] of updatesByUnit) {
    for (const update of updates) {
      await supabase
        .from('prices')
        .update({
          cta: update.cta,
          ctd: update.ctd,
          min: update.min
        })
        .eq('unit_id', unitId)
        .eq('date', update.date);
    }
  }

  // Mark suggestions as applied
  const suggestionIds = suggestions.map(s => s.id);
  await supabase
    .from('ai_suggestions')
    .update({
      status: 'applied',
      applied_at: new Date().toISOString()
    })
    .in('id', suggestionIds);

  // Send to Hotres API (if needed)
  // ... your existing Hotres sync logic
}
```

## 4. Koszty & Performance

**Dla 35 powiadomień:**
- Input tokens: ~25-30K
- Output tokens: ~3-5K
- **Koszt: $0.003 (0.3 centa)**
- Czas: 2-5 sekund

**Miesięczne (5x/dzień × 30 dni):**
- 150 wywołań
- **~$0.45/miesiąc**

**ROI:** Jeśli zespół spędza 90% czasu na CTA/CTD (~10h/dzień):
- Koszt AI: $0.45/miesiąc
- Oszczędność czasu: ~80% z 10h = 8h dziennie
- Zwrot: natychmiastowy

## 5. Monitoring & Improvement

### Track effectiveness

```typescript
// Po wypełnieniu luki, zapisz feedback
async function trackSuggestionSuccess(suggestionId: string, gapFilled: boolean) {
  await supabase
    .from('ai_suggestion_feedback')
    .insert({
      suggestion_id: suggestionId,
      worked: gapFilled,
      gap_filled_at: gapFilled ? new Date().toISOString() : null
    });
}
```

### Dostosuj prompt based on results

Co miesiąc sprawdzaj:
- Ile sugestii było applied
- Ile faktycznie wypełniło luki
- Adjust prompt zasady dla lepszych wyników

## 6. Opcjonalne Ulepszenia

### Auto-apply dla bardzo wysokiej pewności
```javascript
// W Node 11 (przed insertem do DB)
const autoApply = parsed.suggestions.filter(s => s.confidence >= 95);
const needsReview = parsed.suggestions.filter(s => s.confidence < 95);

// Auto-apply immediately
if (autoApply.length > 0) {
  await applyToHotres(autoApply);
}
```

### Slack/Email notification
```javascript
// Po wygenerowaniu sugestii
if (suggestions.length > 0) {
  await fetch(SLACK_WEBHOOK, {
    method: 'POST',
    body: JSON.stringify({
      text: `🤖 AI wygenerował ${suggestions.length} sugestii CTA/CTD. ${highConfidence} z wysoką pewnością.`
    })
  });
}
```

### A/B Testing
- 50% jednostek: AI suggestions
- 50% jednostek: manual
- Compare occupancy & revenue po 30 dniach

---

## FAQ

**Q: Czy AI może coś zepsuć?**
A: Nie, sugestie wymagają manual approval (chyba że włączysz auto-apply dla >95% confidence).

**Q: Czy AI uczy się z moich decyzji?**
A: Nie automatycznie, ale możesz periodycznie adjust prompt na podstawie `ai_suggestion_feedback`.

**Q: Co jeśli Gemini zwróci złe dane?**
A: Parse function ma fallback handling. W najgorszym wypadku: error message, żadne dane nie zostaną zmienione.

**Q: Czy mogę to uruchomić automatycznie co noc?**
A: Tak! W n8n dodaj Schedule Trigger zamiast Webhook. Fetch wszystkie pending notifications i generuj sugestie.
