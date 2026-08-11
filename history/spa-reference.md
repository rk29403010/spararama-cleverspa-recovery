# CleverSpa project reference

## Spa

- Working volume for dosing: **800 L**
- Tap water: hard
- Location: south-facing patio, full sun
- Normal use: potentially daily, usually evening
- Slow-release chlorine: floating doser
- Practical dosing amounts should be given in **whole grams**. The household scales do not measure fractional grams.

## Current chemicals

### Stabilised chlorine granules

- Current granules are **NEW**. Do not attribute low chlorine readings to old granules.
- Chemical: sodium dichloroisocyanurate dihydrate (dichlor).
- User-supplied label rate: **2 g per 1000 L raises free chlorine by about 1 ppm**.
- For this 800 L spa, theoretical dose is 1.6 g per +1 ppm FC, but practical advice must use whole grams.

### Total alkalinity increaser

- User-supplied label rate: **16 g per 1000 L raises TA by 10 ppm**.
- For 800 L, theoretical dose is 12.8 g per +10 ppm TA; practical advice must use whole grams.

### pH+

- CleverSpa product.
- User-supplied label amount: **11 g per 1000 L**.
- Exact claimed pH change per label dose is not recorded; do not invent it.
- 800 L scaled theoretical dose is 8.8 g; practical advice must use whole grams.

### pH-

- CleverSpa product.
- User-supplied label amount: **11 g per 1000 L**.
- Exact claimed pH change per label dose is not recorded; do not invent it.
- 800 L scaled theoretical dose is 8.8 g; practical advice must use whole grams.

### Slow-release chlorine

- Buffered chlorine tablets used in a floating dispenser.
- Exact tablet mass / label release rate is not yet recorded.

## Baseline tap-water strip readings

- Free chlorine: 0 ppm
- pH: ~6.8
- Total alkalinity: ~40 ppm
- Total hardness: 500-1000 ppm
- Cyanuric acid: ~30-50 ppm

## Working water targets

Because the water is hard, avoid unnecessarily high pH/alkalinity.

- Free chlorine before bathing: approximately 3-5 ppm
- pH: approximately 7.2-7.6, preferably towards the lower-middle of the range
- TA: avoid chasing ambiguous strip colours once approximately within a workable range
- Remove floating tablet dispenser while bathing

## Logging rules

Persistent event log: `history/spa-events.jsonl`.

- When Robin supplies a water reading, assume it was taken **at that time** unless stated otherwise.
- Record readings with local UK date/time where available.
- Record doses as completed only when Robin says they were actually added; recommendations alone are not completed doses.
- Record filter/cartridge changes, rinses, flushes, refills, bathing/use, cover state when relevant, faults/noises, and other maintenance observations.
- Preserve uncertain strip readings as ranges/approximate values rather than forcing a single number.
- Do not invent missing historical times, quantities, or maintenance events.

## Current diagnostic context

- Persistent apparently-low FC occurred on the previous fill and again after a flush, empty/manual clean, clean refill and chlorine shock.
- Current new 7-way strips have shown low FC while a noticeable chlorine smell is present.
- A 1:1 dilution test on 11 Aug 2026 behaved normally: undiluted FC about 1 ppm, diluted FC about 0.5 ppm. This does not support high-chlorine bleaching as the explanation.
- Total-chlorine strip readings of 0 while FC is non-zero are internally inconsistent and should be treated cautiously.
- Filter/filtration area was reported rattling after only around 1-2 days of operation on the current fill; exact source is not yet identified.
