# AI Automation dla CTA/CTD - Dokumentacja

## Przegląd
System automatycznie proponuje optymalne ustawienia CTA (Close To Arrival) i CTD (Close To Departure) na podstawie:
- Historii rezerwacji (lead time, długość pobytu)
- Wzorców bookingów (weekend vs weekday)
- Obecnej dostępności i luk w kalendarzu
- Obecnych restrykcji

## Architektura

```
[Frontend Button]
    ↓ (notification_ids[])
[n8n Webhook]
    ↓
[Supabase Edge Function: get-ai-context]
    ↓ (enriched context)
[Gemini Flash API]
    ↓ (AI suggestions)
[Frontend: Review & Apply]
```

## n8n Workflow Setup

### Node 1: Webhook Trigger
- Method: POST
- Path: `/webhook/ai-cta-suggestions`
- Body:
```json
{
  "notification_ids": ["uuid1", "uuid2", "..."],
  "user_id": "uuid"
}
```

### Node 2: Fetch Context from Supabase
- **HTTP Request Node**
- Method: POST
- URL: `https://uopdrhgkephrtpdxicts.supabase.co/functions/v1/get-ai-context`
- Headers:
  - `Authorization: Bearer [SUPABASE_ANON_KEY]`
  - `Content-Type: application/json`
- Body:
```json
{
  "notification_ids": {{ $json.body.notification_ids }}
}
```

### Node 3: Build Gemini Prompt
- **Function Node**
- Code:
```javascript
const context = $input.item.json;

// Build structured prompt
const prompt = `Jesteś ekspertem od revenue management dla wynajmu krótkoterminowego w Polsce.

ZADANIE: Zaproponuj optymalne ustawienia CTA (Close To Arrival) i CTD (Close To Departure) dla ${context.summary.total_notifications} powiadomień o lukach w dostępności.

DEFINICJE:
- CTA = ile dni przed przyjazdem przestajemy przyjmować rezerwacje (0 = można bookować do ostatniej chwili)
- CTD = ile dni przed wyjazdem przestajemy przyjmować rezerwacje
- MIN = minimalna długość pobytu w dniach

CELE:
1. Wypełnić jednodniowe luki między rezerwacjami (najwyższy priorytet)
2. Zoptymalizować wykorzystanie kalendarza
3. Nie blokować długich, wartościowych rezerwacji
4. Uwzględnić wzorce bookingów i sezonowość

DANE O POWIADOMIENIACH:
${context.notifications.map((n, i) => `
${i + 1}. ${n.property_name} - ${n.unit_name}
   - Luka: ${n.start_date} do ${n.end_date} (${n.change_type})
   - Obecne ustawienia: CTA=${n.current_restrictions[0]?.cta || 'brak'}, CTD=${n.current_restrictions[0]?.ctd || 'brak'}

   Statystyki jednostki:
   - Średni lead time: ${n.unit_stats?.avg_lead_time_days || 'brak danych'} dni
   - Rezerwacje weekend vs weekday: ${n.unit_stats?.weekend_booking_percentage || 'brak'}% weekendy
   - Obecne obłożenie (30 dni): ${n.unit_stats?.current_occupancy_30d || 'brak'}%
   - Średnia długość pobytu: ${n.unit_stats?.avg_stay_nights || 'brak'} nocy
   - Rezerwacje ostatnie 6 mies: ${n.unit_stats?.total_bookings_6m || 0}

   Otoczenie (±7 dni):
   ${n.surrounding_availability.slice(0, 15).map(a => `   ${a.date}: ${a.status}`).join('\n')}
`).join('\n')}

ZASADY OPTYMALIZACJI:
1. Jednodniowa luka między rezerwacjami:
   → CTA=7-14, CTD=0, MIN=2 (wypełni lukę, pozwoli na longer stays)

2. Luka 2-3 dni w sezonie wysokim:
   → CTA=3-7, CTD=0, MIN=2-3 (szansa na short break)

3. Luka 4+ dni z niskim lead time (<10 dni):
   → CTA=0-3, CTD=0, MIN=2 (zachęć do last-minute)

4. Luka w low season z długim lead time:
   → CTA=14-21, CTD=0, MIN=3-5 (promuj dłuższe pobyty)

5. Weekend gap (Pt-Nd):
   → Jeśli unit ma >70% weekend bookings: CTA=7-14, MIN=2-3

6. Nie ustawiaj agresywnych restrykcji jeśli:
   - Occupancy <40%
   - Lead time >30 dni
   - Sezon niski (styczeń-marzec, listopad)

OUTPUT FORMAT (JSON):
{
  "suggestions": [
    {
      "notification_id": "uuid",
      "unit_id": "uuid",
      "unit_name": "Domek 4D",
      "property_name": "DW Maryla",
      "date_range": {
        "start": "2026-06-15",
        "end": "2026-06-16"
      },
      "suggested_cta": 7,
      "suggested_ctd": 0,
      "suggested_min": 2,
      "confidence": 85,
      "reasoning": "Jednodniowa luka między rezerwacjami. CTA=7 da czas na wypełnienie, CTD=0 pozwala na check-out tego samego dnia. MIN=2 wypełni lukę i może przedłużyć wcześniejszy pobyt.",
      "expected_impact": "Wysoka szansa na wypełnienie luki, zachowanie flexibility dla longer stays"
    }
  ],
  "summary": {
    "total_suggestions": 35,
    "high_confidence": 28,
    "medium_confidence": 7,
    "avg_confidence": 82
  }
}

GENERUJ TYLKO VALID JSON, BEZ MARKDOWN.`;

return { json: { prompt } };
```

### Node 4: Call Gemini API
- **HTTP Request Node**
- Method: POST
- URL: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=[YOUR_API_KEY]`
- Headers:
  - `Content-Type: application/json`
- Body:
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

### Node 5: Parse Gemini Response
- **Function Node**
```javascript
const geminiResponse = $input.item.json;

// Extract JSON from Gemini response
const text = geminiResponse.candidates[0].content.parts[0].text;
let suggestions;

try {
  suggestions = JSON.parse(text);
} catch (e) {
  // Fallback: try to extract JSON from markdown
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    suggestions = JSON.parse(jsonMatch[0]);
  } else {
    throw new Error('Failed to parse Gemini response');
  }
}

return {
  json: {
    success: true,
    suggestions: suggestions.suggestions,
    summary: suggestions.summary,
    generated_at: new Date().toISOString()
  }
};
```

### Node 6: Response
- **Respond to Webhook Node**
- Return parsed suggestions to frontend

## Frontend Integration

### Button w notifications list
```typescript
// components/NotificationsList.tsx

const handleAIOptimization = async (selectedNotificationIds: string[]) => {
  setIsLoadingAI(true);

  try {
    const response = await fetch('https://your-n8n-instance.com/webhook/ai-cta-suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notification_ids: selectedNotificationIds,
        user_id: user.id
      })
    });

    const aiSuggestions = await response.json();

    // Show modal with suggestions
    setShowAISuggestionsModal(true);
    setAISuggestions(aiSuggestions.suggestions);

  } catch (error) {
    toast.error('AI suggestions failed');
  } finally {
    setIsLoadingAI(false);
  }
};

// Render button
<Button
  onClick={() => handleAIOptimization(selectedNotifications)}
  disabled={selectedNotifications.length === 0 || isLoadingAI}
  className="border-yellow-400 text-yellow-600"
>
  {isLoadingAI ? 'AI pracuje...' : '🤖 Zatrudnij AI'}
</Button>
```

### Modal z sugestiami
```typescript
// components/AISuggestionsModal.tsx

interface AISuggestion {
  notification_id: string;
  unit_name: string;
  property_name: string;
  date_range: { start: string; end: string };
  suggested_cta: number;
  suggested_ctd: number;
  suggested_min: number;
  confidence: number;
  reasoning: string;
  expected_impact: string;
}

const AISuggestionsModal = ({ suggestions, onApply, onClose }) => {
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);

  const handleApplyAll = async () => {
    // Apply all high confidence (>80%) suggestions
    const highConfidence = suggestions.filter(s => s.confidence > 80);
    await applyAISuggestions(highConfidence);
  };

  const handleApplySelected = async () => {
    const toApply = suggestions.filter(s =>
      selectedSuggestions.includes(s.notification_id)
    );
    await applyAISuggestions(toApply);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>🤖 Sugestie AI - CTA/CTD Optimization</DialogTitle>
          <DialogDescription>
            AI przeanalizowało {suggestions.length} powiadomień i wygenerowało sugestie
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {suggestions.map(suggestion => (
            <Card key={suggestion.notification_id} className={
              suggestion.confidence > 80 ? 'border-green-400' : 'border-yellow-400'
            }>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      {suggestion.property_name} - {suggestion.unit_name}
                    </CardTitle>
                    <p className="text-sm text-gray-500">
                      {suggestion.date_range.start} do {suggestion.date_range.end}
                    </p>
                  </div>
                  <Badge variant={suggestion.confidence > 80 ? 'success' : 'warning'}>
                    {suggestion.confidence}% pewności
                  </Badge>
                </div>
              </CardHeader>

              <CardContent>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-blue-50 p-3 rounded">
                    <p className="text-xs text-gray-600">CTA</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {suggestion.suggested_cta}
                    </p>
                  </div>
                  <div className="bg-purple-50 p-3 rounded">
                    <p className="text-xs text-gray-600">CTD</p>
                    <p className="text-2xl font-bold text-purple-600">
                      {suggestion.suggested_ctd}
                    </p>
                  </div>
                  <div className="bg-green-50 p-3 rounded">
                    <p className="text-xs text-gray-600">MIN</p>
                    <p className="text-2xl font-bold text-green-600">
                      {suggestion.suggested_min}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-semibold">Uzasadnienie:</p>
                    <p className="text-sm text-gray-700">{suggestion.reasoning}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Oczekiwany efekt:</p>
                    <p className="text-sm text-gray-700">{suggestion.expected_impact}</p>
                  </div>
                </div>

                <Checkbox
                  checked={selectedSuggestions.includes(suggestion.notification_id)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedSuggestions([...selectedSuggestions, suggestion.notification_id]);
                    } else {
                      setSelectedSuggestions(selectedSuggestions.filter(id => id !== suggestion.notification_id));
                    }
                  }}
                  className="mt-3"
                >
                  Zastosuj tę sugestię
                </Checkbox>
              </CardContent>
            </Card>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Anuluj</Button>
          <Button
            variant="secondary"
            onClick={handleApplySelected}
            disabled={selectedSuggestions.length === 0}
          >
            Zastosuj zaznaczone ({selectedSuggestions.length})
          </Button>
          <Button onClick={handleApplyAll}>
            Zastosuj wszystkie wysokie pewności
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
```

## Koszt Operacji

**Dla 35 powiadomień:**
- Context: ~25K input tokens
- Gemini response: ~5K output tokens
- **Koszt: $0.003 (0.3 centa)**
- Czas: 2-5 sekund

**Miesięcznie (5x dziennie × 30 dni):**
- ~150 wywołań
- **~$0.45/miesiąc**

## Deployment

```bash
# 1. Deploy Edge Function
supabase functions deploy get-ai-context

# 2. Setup n8n workflow (import JSON)
# 3. Get n8n webhook URL
# 4. Update frontend with webhook URL
# 5. Test with 2-3 notifications first
```

## Monitorowanie

Dodaj tabelę do śledzenia effectiveness:
```sql
CREATE TABLE ai_suggestion_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  suggestion_id UUID,
  notification_id UUID,
  applied BOOLEAN,
  worked BOOLEAN, -- czy faktycznie wypełniło lukę
  user_feedback TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

To pozwoli fine-tunować prompty based on real results.
