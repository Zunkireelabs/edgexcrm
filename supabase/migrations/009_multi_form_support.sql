-- Migration 009: Multi-form support
-- Allows multiple forms per tenant with unique slugs
-- Tracks which form generated each lead

-- 1. Add slug column to form_configs
ALTER TABLE form_configs ADD COLUMN slug VARCHAR(100);

-- 2. Backfill slugs for existing form configs
UPDATE form_configs SET slug = 'enquiry'
WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'; -- Admizz

UPDATE form_configs SET slug = 'scholarship'
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'; -- RKU

-- 3. Make slug NOT NULL + unique per tenant
ALTER TABLE form_configs ALTER COLUMN slug SET NOT NULL;
ALTER TABLE form_configs ADD CONSTRAINT uq_form_configs_tenant_slug UNIQUE (tenant_id, slug);

-- 4. Rename existing Admizz form
UPDATE form_configs SET name = 'Enquiry Form'
WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88' AND slug = 'enquiry';

-- 5. Add form_config_id to leads
ALTER TABLE leads ADD COLUMN form_config_id UUID REFERENCES form_configs(id);

-- 6. Backfill existing Admizz leads with the enquiry form_config_id
UPDATE leads SET form_config_id = (
  SELECT id FROM form_configs
  WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88' AND slug = 'enquiry'
)
WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88' AND form_config_id IS NULL;

-- 7. Backfill existing RKU leads with the scholarship form_config_id
UPDATE leads SET form_config_id = (
  SELECT id FROM form_configs
  WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001' AND slug = 'scholarship'
)
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001' AND form_config_id IS NULL;

-- 8. Insert Test Prep Form for Admizz
INSERT INTO form_configs (tenant_id, name, slug, is_active, steps, branding)
VALUES (
  'febeb37c-521c-4f29-adbb-0195b2eede88',
  'Test Prep Form',
  'test-prep',
  true,
  '[
    {
      "title": "",
      "fields": [
        {
          "name": "first_name",
          "type": "text",
          "label": "First Name",
          "width": "half",
          "required": true,
          "placeholder": "First Name"
        },
        {
          "name": "last_name",
          "type": "text",
          "label": "Last Name",
          "width": "half",
          "required": true,
          "placeholder": "Last Name"
        },
        {
          "name": "email",
          "type": "email",
          "label": "Email",
          "required": true,
          "placeholder": "Email"
        },
        {
          "name": "country",
          "type": "select",
          "label": "Country",
          "width": "third",
          "options": [
            {"label": "Nepal", "value": "nepal", "dial_code": "+977"},
            {"label": "India", "value": "india", "dial_code": "+91"},
            {"label": "Bangladesh", "value": "bangladesh", "dial_code": "+880"},
            {"label": "Bhutan", "value": "bhutan", "dial_code": "+975"},
            {"label": "Sri Lanka", "value": "sri_lanka", "dial_code": "+94"},
            {"label": "Pakistan", "value": "pakistan", "dial_code": "+92"},
            {"label": "Afghanistan", "value": "afghanistan", "dial_code": "+93"},
            {"label": "Albania", "value": "albania", "dial_code": "+355"},
            {"label": "Algeria", "value": "algeria", "dial_code": "+213"},
            {"label": "Argentina", "value": "argentina", "dial_code": "+54"},
            {"label": "Armenia", "value": "armenia", "dial_code": "+374"},
            {"label": "Australia", "value": "australia", "dial_code": "+61"},
            {"label": "Austria", "value": "austria", "dial_code": "+43"},
            {"label": "Azerbaijan", "value": "azerbaijan", "dial_code": "+994"},
            {"label": "Bahrain", "value": "bahrain", "dial_code": "+973"},
            {"label": "Belarus", "value": "belarus", "dial_code": "+375"},
            {"label": "Belgium", "value": "belgium", "dial_code": "+32"},
            {"label": "Bolivia", "value": "bolivia", "dial_code": "+591"},
            {"label": "Bosnia", "value": "bosnia", "dial_code": "+387"},
            {"label": "Brazil", "value": "brazil", "dial_code": "+55"},
            {"label": "Brunei", "value": "brunei", "dial_code": "+673"},
            {"label": "Bulgaria", "value": "bulgaria", "dial_code": "+359"},
            {"label": "Cambodia", "value": "cambodia", "dial_code": "+855"},
            {"label": "Cameroon", "value": "cameroon", "dial_code": "+237"},
            {"label": "Canada", "value": "canada", "dial_code": "+1"},
            {"label": "Chile", "value": "chile", "dial_code": "+56"},
            {"label": "China", "value": "china", "dial_code": "+86"},
            {"label": "Colombia", "value": "colombia", "dial_code": "+57"},
            {"label": "Costa Rica", "value": "costa_rica", "dial_code": "+506"},
            {"label": "Croatia", "value": "croatia", "dial_code": "+385"},
            {"label": "Cuba", "value": "cuba", "dial_code": "+53"},
            {"label": "Cyprus", "value": "cyprus", "dial_code": "+357"},
            {"label": "Czech Republic", "value": "czech_republic", "dial_code": "+420"},
            {"label": "Denmark", "value": "denmark", "dial_code": "+45"},
            {"label": "Dominican Republic", "value": "dominican_republic", "dial_code": "+1"},
            {"label": "Ecuador", "value": "ecuador", "dial_code": "+593"},
            {"label": "Egypt", "value": "egypt", "dial_code": "+20"},
            {"label": "El Salvador", "value": "el_salvador", "dial_code": "+503"},
            {"label": "Estonia", "value": "estonia", "dial_code": "+372"},
            {"label": "Ethiopia", "value": "ethiopia", "dial_code": "+251"},
            {"label": "Fiji", "value": "fiji", "dial_code": "+679"},
            {"label": "Finland", "value": "finland", "dial_code": "+358"},
            {"label": "France", "value": "france", "dial_code": "+33"},
            {"label": "Georgia", "value": "georgia", "dial_code": "+995"},
            {"label": "Germany", "value": "germany", "dial_code": "+49"},
            {"label": "Ghana", "value": "ghana", "dial_code": "+233"},
            {"label": "Greece", "value": "greece", "dial_code": "+30"},
            {"label": "Guatemala", "value": "guatemala", "dial_code": "+502"},
            {"label": "Honduras", "value": "honduras", "dial_code": "+504"},
            {"label": "Hong Kong", "value": "hong_kong", "dial_code": "+852"},
            {"label": "Hungary", "value": "hungary", "dial_code": "+36"},
            {"label": "Iceland", "value": "iceland", "dial_code": "+354"},
            {"label": "Indonesia", "value": "indonesia", "dial_code": "+62"},
            {"label": "Iran", "value": "iran", "dial_code": "+98"},
            {"label": "Iraq", "value": "iraq", "dial_code": "+964"},
            {"label": "Ireland", "value": "ireland", "dial_code": "+353"},
            {"label": "Israel", "value": "israel", "dial_code": "+972"},
            {"label": "Italy", "value": "italy", "dial_code": "+39"},
            {"label": "Jamaica", "value": "jamaica", "dial_code": "+1"},
            {"label": "Japan", "value": "japan", "dial_code": "+81"},
            {"label": "Jordan", "value": "jordan", "dial_code": "+962"},
            {"label": "Kazakhstan", "value": "kazakhstan", "dial_code": "+7"},
            {"label": "Kenya", "value": "kenya", "dial_code": "+254"},
            {"label": "Kuwait", "value": "kuwait", "dial_code": "+965"},
            {"label": "Kyrgyzstan", "value": "kyrgyzstan", "dial_code": "+996"},
            {"label": "Laos", "value": "laos", "dial_code": "+856"},
            {"label": "Latvia", "value": "latvia", "dial_code": "+371"},
            {"label": "Lebanon", "value": "lebanon", "dial_code": "+961"},
            {"label": "Libya", "value": "libya", "dial_code": "+218"},
            {"label": "Lithuania", "value": "lithuania", "dial_code": "+370"},
            {"label": "Luxembourg", "value": "luxembourg", "dial_code": "+352"},
            {"label": "Macau", "value": "macau", "dial_code": "+853"},
            {"label": "Malaysia", "value": "malaysia", "dial_code": "+60"},
            {"label": "Maldives", "value": "maldives", "dial_code": "+960"},
            {"label": "Malta", "value": "malta", "dial_code": "+356"},
            {"label": "Mexico", "value": "mexico", "dial_code": "+52"},
            {"label": "Moldova", "value": "moldova", "dial_code": "+373"},
            {"label": "Mongolia", "value": "mongolia", "dial_code": "+976"},
            {"label": "Montenegro", "value": "montenegro", "dial_code": "+382"},
            {"label": "Morocco", "value": "morocco", "dial_code": "+212"},
            {"label": "Myanmar", "value": "myanmar", "dial_code": "+95"},
            {"label": "Namibia", "value": "namibia", "dial_code": "+264"},
            {"label": "Netherlands", "value": "netherlands", "dial_code": "+31"},
            {"label": "New Zealand", "value": "new_zealand", "dial_code": "+64"},
            {"label": "Nicaragua", "value": "nicaragua", "dial_code": "+505"},
            {"label": "Nigeria", "value": "nigeria", "dial_code": "+234"},
            {"label": "North Macedonia", "value": "north_macedonia", "dial_code": "+389"},
            {"label": "Norway", "value": "norway", "dial_code": "+47"},
            {"label": "Oman", "value": "oman", "dial_code": "+968"},
            {"label": "Panama", "value": "panama", "dial_code": "+507"},
            {"label": "Paraguay", "value": "paraguay", "dial_code": "+595"},
            {"label": "Peru", "value": "peru", "dial_code": "+51"},
            {"label": "Philippines", "value": "philippines", "dial_code": "+63"},
            {"label": "Poland", "value": "poland", "dial_code": "+48"},
            {"label": "Portugal", "value": "portugal", "dial_code": "+351"},
            {"label": "Qatar", "value": "qatar", "dial_code": "+974"},
            {"label": "Romania", "value": "romania", "dial_code": "+40"},
            {"label": "Russia", "value": "russia", "dial_code": "+7"},
            {"label": "Rwanda", "value": "rwanda", "dial_code": "+250"},
            {"label": "Saudi Arabia", "value": "saudi_arabia", "dial_code": "+966"},
            {"label": "Senegal", "value": "senegal", "dial_code": "+221"},
            {"label": "Serbia", "value": "serbia", "dial_code": "+381"},
            {"label": "Singapore", "value": "singapore", "dial_code": "+65"},
            {"label": "Slovakia", "value": "slovakia", "dial_code": "+421"},
            {"label": "Slovenia", "value": "slovenia", "dial_code": "+386"},
            {"label": "South Africa", "value": "south_africa", "dial_code": "+27"},
            {"label": "South Korea", "value": "south_korea", "dial_code": "+82"},
            {"label": "Spain", "value": "spain", "dial_code": "+34"},
            {"label": "Sudan", "value": "sudan", "dial_code": "+249"},
            {"label": "Sweden", "value": "sweden", "dial_code": "+46"},
            {"label": "Switzerland", "value": "switzerland", "dial_code": "+41"},
            {"label": "Syria", "value": "syria", "dial_code": "+963"},
            {"label": "Taiwan", "value": "taiwan", "dial_code": "+886"},
            {"label": "Tajikistan", "value": "tajikistan", "dial_code": "+992"},
            {"label": "Tanzania", "value": "tanzania", "dial_code": "+255"},
            {"label": "Thailand", "value": "thailand", "dial_code": "+66"},
            {"label": "Trinidad & Tobago", "value": "trinidad_tobago", "dial_code": "+1"},
            {"label": "Tunisia", "value": "tunisia", "dial_code": "+216"},
            {"label": "Turkey", "value": "turkey", "dial_code": "+90"},
            {"label": "Turkmenistan", "value": "turkmenistan", "dial_code": "+993"},
            {"label": "UAE", "value": "uae", "dial_code": "+971"},
            {"label": "Uganda", "value": "uganda", "dial_code": "+256"},
            {"label": "Ukraine", "value": "ukraine", "dial_code": "+380"},
            {"label": "United Kingdom", "value": "uk", "dial_code": "+44"},
            {"label": "United States", "value": "usa", "dial_code": "+1"},
            {"label": "Uruguay", "value": "uruguay", "dial_code": "+598"},
            {"label": "Uzbekistan", "value": "uzbekistan", "dial_code": "+998"},
            {"label": "Venezuela", "value": "venezuela", "dial_code": "+58"},
            {"label": "Vietnam", "value": "vietnam", "dial_code": "+84"},
            {"label": "Yemen", "value": "yemen", "dial_code": "+967"},
            {"label": "Zambia", "value": "zambia", "dial_code": "+260"},
            {"label": "Zimbabwe", "value": "zimbabwe", "dial_code": "+263"},
            {"label": "Other", "value": "other", "dial_code": ""}
          ],
          "required": true,
          "placeholder": "Nepal (NP)"
        },
        {
          "name": "phone",
          "type": "tel",
          "label": "Phone Number",
          "width": "two-thirds",
          "required": true,
          "placeholder": "",
          "country_field": "country"
        },
        {
          "name": "dream_destination",
          "type": "select",
          "label": "Dream Destination",
          "options": [
            {"label": "Australia", "value": "australia"},
            {"label": "Canada", "value": "canada"},
            {"label": "United Kingdom", "value": "uk"},
            {"label": "United States", "value": "usa"},
            {"label": "Germany", "value": "germany"},
            {"label": "France", "value": "france"},
            {"label": "Denmark", "value": "denmark"},
            {"label": "UAE / Dubai", "value": "uae"},
            {"label": "India", "value": "india"},
            {"label": "New Zealand", "value": "new_zealand"},
            {"label": "South Korea", "value": "south_korea"}
          ],
          "required": true,
          "placeholder": "Dream Destination"
        },
        {
          "name": "interested_study_level",
          "type": "select",
          "label": "Interested Study Level",
          "options": [
            {"label": "Diploma", "value": "diploma"},
            {"label": "Bachelors", "value": "bachelors"},
            {"label": "Masters", "value": "masters"},
            {"label": "PhD", "value": "phd"}
          ],
          "required": true,
          "placeholder": "Interested Study Level"
        },
        {
          "name": "test_preferred",
          "type": "select",
          "label": "Test Preferred",
          "options": [
            {"label": "IELTS", "value": "ielts"},
            {"label": "PTE", "value": "pte"},
            {"label": "Duolingo", "value": "duolingo"}
          ],
          "required": true,
          "placeholder": "Test Preferred"
        },
        {
          "name": "test_center",
          "type": "select",
          "label": "Test Center",
          "options": [
            {"label": "Kathmandu Office", "value": "kathmandu_office"},
            {"label": "Birgunj Office", "value": "birgunj_office"},
            {"label": "Online", "value": "online"}
          ],
          "required": true,
          "placeholder": "Test Center"
        },
        {
          "name": "terms_accepted",
          "type": "checkbox",
          "label": "I agree to the Terms & Conditions",
          "required": true,
          "placeholder": "I have read and agreed to terms & conditions"
        }
      ]
    }
  ]'::jsonb,
  '{
    "title": "Test Prep Registration",
    "subtitle": "Register for your preferred test preparation course.",
    "button_text": "Submit",
    "hide_labels": true,
    "button_color": "#F5C400",
    "primary_color": "#F5C400",
    "thank_you_title": "Thank You!",
    "thank_you_message": "Our team will get in touch with you shortly.",
    "input_border_radius": "8px"
  }'::jsonb
);

-- 9. Index for fast lookups
CREATE INDEX idx_form_configs_tenant_slug ON form_configs(tenant_id, slug);
CREATE INDEX idx_leads_form_config_id ON leads(form_config_id);
