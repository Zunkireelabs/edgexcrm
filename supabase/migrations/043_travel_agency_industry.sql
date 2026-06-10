-- Migration: add travel_agency industry row
-- DO NOT APPLY manually — Opus applies this after branch review.
-- Pattern: additive INSERT with ON CONFLICT DO NOTHING, safe to re-run.

INSERT INTO industries (id, name, description, entity_type_label, entity_type_singular, icon, default_pipeline_stages)
VALUES (
  'travel_agency',
  'Travel Agency',
  'Travel agencies, tour operators, and destination management companies',
  'Destinations', 'Destination', 'Plane',
  '[
    {"name":"New Inquiry","slug":"new-inquiry","position":0,"color":"#3b82f6","is_default":true,"is_terminal":false},
    {"name":"Qualifying","slug":"qualifying","position":1,"color":"#06b6d4","is_default":false,"is_terminal":false},
    {"name":"Itinerary Sent","slug":"itinerary-sent","position":2,"color":"#a855f7","is_default":false,"is_terminal":false},
    {"name":"Revising","slug":"revising","position":3,"color":"#f97316","is_default":false,"is_terminal":false},
    {"name":"Booked","slug":"booked","position":4,"color":"#22c55e","is_default":false,"is_terminal":true},
    {"name":"Lost","slug":"lost","position":5,"color":"#ef4444","is_default":false,"is_terminal":true}
  ]'::jsonb
) ON CONFLICT (id) DO NOTHING;
