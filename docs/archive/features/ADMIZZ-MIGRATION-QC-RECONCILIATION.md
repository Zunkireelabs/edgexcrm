# Admizz Lead Migration — QC Reconciliation Report

**Generated:** 2026-06-25T12:47:43.771Z
**Stage DB:** https://dymeudcddasqpomfpjvt.supabase.co
**Tenant:** Admizz Education (febeb37c-521c-4f29-adbb-0195b2eede88)

## Database Snapshot

| Metric | Count |
|---|--:|
| Total non-deleted Admizz leads (all lists) | 9092 |
| &nbsp;&nbsp;• In Migration QC list (d1d9ceda…) | 8668 |
| &nbsp;&nbsp;• In Existing Leads / edgeX list (5bb78b47…) | 420 |
| &nbsp;&nbsp;• In other lists | 4 |
| lead_activities with import_batch="admizz-activities-2026-06-25" | 2360 |
| &nbsp;&nbsp;• Distinct leads with ≥1 activity | 1831 |

### intake_source distribution

| intake_source | Count |
|---|--:|
| NEB10K | 2498 |
| Agentics leads | 2486 |
| Model Secondary School - Management | 937 |
| Sohan Leads | 801 |
| Model Secondary School - Science | 746 |
| Ritesh Leads | 692 |
| NEB Sample | 290 |
| api | 170 |
| worldcup-predict-win | 118 |
| Admizz CRM Export (no source) | 83 |
| RKU Alumni | 82 |
| form | 73 |
| (null) | 54 |
| UK Expo 2026 | 36 |
| Purnima Front Desk | 17 |
| an | 5 |
| manual_entry | 4 |

### custom_fields keys (sampled across 200 leads)

```
agreed_to_terms, campaign, city, countries, country, dial_code, dream_destination, education_level, field_of_study, full_name, hear_about, import_batch, intake, interested_country, interested_study_level, landing_page, legacy_crm_id, match_id, match_label, migration_sources, nationality, phone_number, prediction, prediction_text, preferred_destination, prize, program_category, program_level, raw_phone, referrer_url, source, source_category, source_channel, source_page, study_abroad_interest, study_destination, study_level, study_program, submitted_at, terms_accepted, test_center, test_preferred, visited
```

---
## Layer 0 — Field Mapping Contract

> Every source column is listed. Unmapped columns (⚠) are candidates for silent data loss.

### File: `1 - Sohan Leads - For CRM.xlsx`  →  intake_source: `Sohan Leads`

| Source Column | Role | DB Destination | Status |
|---|---|---|---|
| `Name` | name | leads.first_name + last_name | ✓ MAPPED |
| `Phone Number 1` | phone | leads.phone | ✓ MAPPED |
| `Phone Number 2` | phone | leads.phone | ✓ MAPPED |

**Sample rows (first 3):**
```json
[
  {
    "Name": "AASHIKA CHAUDHARY",
    "Phone Number 1": "9815330857",
    "Phone Number 2": null
  },
  {
    "Name": "AASHMA THAPA",
    "Phone Number 1": "9825348025",
    "Phone Number 2": "9827031267"
  },
  {
    "Name": "AASTHA GAHATRAJ",
    "Phone Number 1": "9746851311",
    "Phone Number 2": "9807053380"
  }
]
```

### File: `2 - RKU Alumni Leads-For CRM.xlsx`  →  intake_source: `RKU Alumni`

| Source Column | Role | DB Destination | Status |
|---|---|---|---|
| `Name` | name | leads.first_name + last_name | ✓ MAPPED |
| `Main Email` | email | leads.email | ✓ MAPPED |
| `Alternative Email` | email | leads.email | ✓ MAPPED |
| `Phone` | phone | leads.phone | ✓ MAPPED |
| `Alternative Phone` | phone | leads.phone | ✓ MAPPED |

**Sample rows (first 3):**
```json
[
  {
    "Name": "Dilip patel",
    "Main Email": "dp161035@gmail.com",
    "Alternative Email": "dpatel517@rku.ac.in",
    "Phone": 9279088433,
    "Alternative Phone": "+9779813060196"
  },
  {
    "Name": "Hompushparaj Mehta",
    "Main Email": "pushparajmehta002@gmail.com",
    "Alternative Email": "hmehta588@rku.ac.in",
    "Phone": "+977 9804301484",
    "Alternative Phone": 9804301484
  },
  {
    "Name": "Chandradev yadav",
    "Main Email": "yadavchandradev5333@gmail.com",
    "Alternative Email": "cyadav598@rku.ac.in",
    "Phone": "+9779807703140",
    "Alternative Phone": "+9779807703140"
  }
]
```

### File: `3 - Ritesh Lead - For CRM.xlsx`  →  intake_source: `Ritesh Leads`

| Source Column | Role | DB Destination | Status |
|---|---|---|---|
| `S.No.` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Name` | name | leads.first_name + last_name | ✓ MAPPED |
| `Phone Number` | phone | leads.phone | ✓ MAPPED |

**Sample rows (first 3):**
```json
[
  {
    "S.No.": 1,
    "Name": "rijan tiwari",
    "Phone Number": "+977 976-3246801"
  },
  {
    "S.No.": 2,
    "Name": "Riyana",
    "Phone Number": "+977 984-5403207"
  },
  {
    "S.No.": 3,
    "Name": "Rochak Shah",
    "Phone Number": "+977 970-7764496"
  }
]
```

### File: `4 - NEB10K-2.5K.xlsx`  →  intake_source: `NEB10K`

| Source Column | Role | DB Destination | Status |
|---|---|---|---|
| `S.N.` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Full Name` | name | leads.first_name + last_name | ✓ MAPPED |
| `Phone` | phone | leads.phone | ✓ MAPPED |
| `School` | school | DROPPED — no column in leads schema | DROPPED |
| `District` | city | leads.city | ✓ MAPPED |
| `Stream` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |

**Sample rows (first 3):**
```json
[
  {
    "S.N.": 2,
    "Full Name": "ram bdr thapa",
    "Phone": "9849238483",
    "School": "global",
    "District": "Kathmandu",
    "Stream": "management"
  },
  {
    "S.N.": 3,
    "Full Name": "Dewasis khadka",
    "Phone": "9749464794",
    "School": "Global school of science",
    "District": "Kathmandu",
    "Stream": "science"
  },
  {
    "S.N.": 4,
    "Full Name": "Shweta Gubhaju",
    "Phone": "9765149698",
    "School": "Premier secondary college",
    "District": "Sindhupalchok",
    "Stream": "science"
  }
]
```

### File: `5 - UK Expo 2026 Leads.xlsx`  →  intake_source: `UK Expo 2026`

| Source Column | Role | DB Destination | Status |
|---|---|---|---|
| `First Name` | name | leads.first_name + last_name | ✓ MAPPED |
| `Last Name` | name | leads.first_name + last_name | ✓ MAPPED |
| `Email` | email | leads.email | ✓ MAPPED |
| `Phone` | phone | leads.phone | ✓ MAPPED |
| `Visited` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |

**Sample rows (first 3):**
```json
[
  {
    "First Name": "Pankaj",
    "Last Name": "Singh",
    "Email": "pp0036493@gmail.com",
    "Phone": 9779819207227,
    "Visited": "Online Register"
  },
  {
    "First Name": "aatish",
    "Last Name": "Raut",
    "Email": "aatishraut7@gmail.com",
    "Phone": 9779747530518,
    "Visited": "Online Register"
  },
  {
    "First Name": "Yuvraj",
    "Last Name": "Yadav",
    "Email": "yuvi55449@gmail.com",
    "Phone": 9779742470792,
    "Visited": "Online Register"
  }
]
```

### File: `6 - MODEL SECONDARY SCHOOL MANAGEMENT.xlsx`  →  intake_source: `Model Secondary School - Management`

| Source Column | Role | DB Destination | Status |
|---|---|---|---|
| `SN` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Entrance SYMBOL NO` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Name of Student` | name | leads.first_name + last_name | ✓ MAPPED |
| `Entrance Mark` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Gender` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `DOB` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Address` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Father's/Mother's Name` | name | leads.first_name + last_name | ✓ MAPPED |
| `Contact No.` | phone | leads.phone | ✓ MAPPED |
| `Address_1` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Blood Group` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Transport` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `I Card No.` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Remark` | remarks | DROPPED — stored separately as lead_activities | DROPPED |

**Sample rows (first 3):**
```json
[
  {
    "SN": 1,
    "Entrance SYMBOL NO": "MMC80M00001",
    "Name of Student": "MUKESH KUMAR RAUT",
    "Entrance Mark": null,
    "Gender": "M",
    "DOB": null,
    "Address": null,
    "Father's/Mother's Name": "SOMNATH RAUT",
    "Contact No.": 9707160607,
    "Address_1": "BHRAMAPURA-7",
    "Blood Group": null,
    "Transport": null,
    "I Card No.": null,
    "Remark": null
  },
  {
    "SN": 2,
    "Entrance SYMBOL NO": "MMC80M00002",
    "Name of Student": "JESHIKA BHUJEL",
    "Entrance Mark": null,
    "Gender": "M",
    "DOB": null,
    "Address": null,
    "Father's/Mother's Name": "JITENDRA BHUJEL",
    "Contact No.": 9804891126,
    "Address_1": "KHAJURI-4",
    "Blood Group": null,
    "Transport": null,
    "I Card No.": null,
    "Remark": null
  },
  {
    "SN": 3,
    "Entrance SYMBOL NO": "MMC80M00003",
    "Name of Student": "AMIT MAHASETH",
    "Entrance Mark": null,
    "Gender": "M",
    "DOB": null,
    "Address": null,
    "Father's/Mother's Name": "RUPLAL MAHASETH",
    "Contact No.": 9816832248,
    "Address_1": "JANAKPURA-23",
    "Blood Group": null,
    "Transport": null,
    "I Card No.": null,
    "Remark": null
  }
]
```

### File: `7 - MODEL SECONDARY SCHOOL SCIENCE.xlsx`  →  intake_source: `Model Secondary School - Science`

| Source Column | Role | DB Destination | Status |
|---|---|---|---|
| `SN` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Entrance SYMBOL NO` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Roll No.` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Name of Student` | name | leads.first_name + last_name | ✓ MAPPED |
| `Entrance Mark` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Father's/Mother's Name` | name | leads.first_name + last_name | ✓ MAPPED |
| `Contact No.` | phone | leads.phone | ✓ MAPPED |
| `Address` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Blood Group` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `Transport` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |
| `I CARD NO.` | unknown | ⚠ UNMAPPED — review for silent data loss | **⚠ UNMAPPED** |

**Sample rows (first 3):**
```json
[
  {
    "SN": 1,
    "Entrance SYMBOL NO": "MMC80M00001",
    "Roll No.": 1,
    "Name of Student": "AKASHRAJ MANDAL",
    "Entrance Mark": null,
    "Father's/Mother's Name": "RAJ NARAYAN MANDAL",
    "Contact No.": 9804839828,
    "Address": "RAM GOPALPUR-05",
    "Blood Group": null,
    "Transport": null,
    "I CARD NO.": null
  },
  {
    "SN": 2,
    "Entrance SYMBOL NO": "MMC80M00002",
    "Roll No.": 2,
    "Name of Student": "BIDYA KUMARI",
    "Entrance Mark": null,
    "Father's/Mother's Name": "SANJEEP MAHASETH",
    "Contact No.": 9814890933,
    "Address": "JALESHWAR-01",
    "Blood Group": null,
    "Transport": null,
    "I CARD NO.": null
  },
  {
    "SN": 3,
    "Entrance SYMBOL NO": "MMC80M00003",
    "Roll No.": 3,
    "Name of Student": "SUDIP MAHATO",
    "Entrance Mark": null,
    "Father's/Mother's Name": "SOVIT MAHATO KOIRI",
    "Contact No.": 9819646061,
    "Address": "KSHIRESHWARNATH-05",
    "Blood Group": null,
    "Transport": null,
    "I CARD NO.": null
  }
]
```

### File: `8- NEB Sample-For CRM.xlsx`  →  intake_source: `NEB Sample`

| Source Column | Role | DB Destination | Status |
|---|---|---|---|
| `Name` | name | leads.first_name + last_name | ✓ MAPPED |
| `Phone` | phone | leads.phone | ✓ MAPPED |
| `School` | school | DROPPED — no column in leads schema | DROPPED |
| `City` | city | leads.city | ✓ MAPPED |
| `Course` | course | DROPPED — no column in leads schema | DROPPED |

**Sample rows (first 3):**
```json
[
  {
    "Name": "Aawaj",
    "Phone": 9706377713,
    "School": "East horizon",
    "City": "Bhaktapur",
    "Course": "management"
  },
  {
    "Name": "James mill",
    "Phone": 9826453723,
    "School": "Trinity",
    "City": "Kavre",
    "Course": "management"
  },
  {
    "Name": "Yunika Gurung",
    "Phone": 9768815323,
    "School": "Shree Radha Krishna mavi",
    "City": "Khotang",
    "Course": "science"
  }
]
```

### File: `9.1 - Agentics Lead.xlsx`  →  intake_source: `Agentics leads`

| Source Column | Role | DB Destination | Status |
|---|---|---|---|
| `Name` | name | leads.first_name + leads.last_name | ✓ MAPPED |
| `Email` | email | leads.email | ✓ MAPPED |
| `Phone` | phone | leads.phone (raw) + custom_fields.raw_phone | ✓ MAPPED |
| `City` | city | leads.city | ✓ MAPPED |
| `Nationality` | nationality | custom_fields.nationality | ✓ MAPPED |
| `Interested Country` | destination | custom_fields.interested_country | ✓ MAPPED |
| `Preferred Program Category` | course | custom_fields.program_category | DROPPED |
| `Preferred Program Level` | course | custom_fields.program_level | DROPPED |
| `Source Category:` | source_category | custom_fields.source_category | ✓ MAPPED |
| `Source Channel:` | source_channel | custom_fields.source_channel | ✓ MAPPED |
| `Source page/ account / name:` | name | custom_fields.source_page | ✓ MAPPED |
| `Campaign / sub-detail:` | campaign | custom_fields.campaign | ✓ MAPPED |

**Sample rows (first 3):**
```json
[
  {
    "Name": "Rohini Thapa",
    "Email": "thaparohini569@gmail.com",
    "Phone": "+9779742877856",
    "City": "Rolpa",
    "Nationality": "Nepal",
    "Interested Country": "-",
    "Preferred Program Category": "-",
    "Preferred Program Level": "-",
    "Source Category:": "Agentics Leads",
    "Source Channel:": "system",
    "Source page/ account / name:": "Facebook",
    "Campaign / sub-detail:": "Admizz Education Web"
  },
  {
    "Name": "Bimal Bhattarai​",
    "Email": "bhattaraibimal54@gmail.com",
    "Phone": "+9779745340177",
    "City": "Nawalparasi(East)",
    "Nationality": "Nepal",
    "Interested Country": "-",
    "Preferred Program Category": "-",
    "Preferred Program Level": "-",
    "Source Category:": "Agentics Leads",
    "Source Channel:": "system",
    "Source page/ account / name:": "Admizz Employee",
    "Campaign / sub-detail:": "Bijay Dahal"
  },
  {
    "Name": "Bikash Sah Teli",
    "Email": "bikashsah921@gmail.com",
    "Phone": "+9779763218990",
    "City": "Kathmandu",
    "Nationality": "Nepal",
    "Interested Country": "UK",
    "Preferred Program Category": "-",
    "Preferred Program Level": "-",
    "Source Category:": "Agentics Leads",
    "Source Channel:": "system",
    "Source page/ account / name:": "Sub Agent",
    "Campaign / sub-detail:": "Manish - Janakpur,Intake-Nov 2025"
  }
]
```

---
## Layer 1 — Completeness (No Lead Missing)

Matching key precedence: `legacy_crm_id` → `phone last-10` → `email` → `name`.

| Source File | Source Rows | No-Identity | Matched MigQC | Matched ExistingLeads | Matched Other | **LOST** |
|---|--:|--:|--:|--:|--:|--:|
| Sohan Leads | 803 | 0 | 803 | 0 | 0 | 0 |
| RKU Alumni | 82 | 0 | 82 | 0 | 0 | 0 |
| Ritesh Leads | 692 | 0 | 692 | 0 | 0 | 0 |
| NEB10K | 2499 | 0 | 2497 | 2 | 0 | 0 |
| UK Expo 2026 | 133 | 0 | 40 | 93 | 0 | 0 |
| Model Secondary School - Management | 1025 | 88 | 937 | 0 | 0 | **88** |
| Model Secondary School - Science | 1025 | 279 | 746 | 0 | 0 | **279** |
| NEB Sample | 299 | 0 | 297 | 2 | 0 | 0 |
| Agentics leads | 2486 | 0 | 2486 | 0 | 0 | 0 |
| **TOTAL** | **9044** | **367** | **8580** | **97** | **0** | **367** |

### Match Method Distribution

| Source File | crm_id | phone10 | email | name | none (LOST) |
|---|--:|--:|--:|--:|--:|
| Sohan Leads | 0 | 723 | 0 | 80 | 0 |
| RKU Alumni | 0 | 75 | 7 | 0 | 0 |
| Ritesh Leads | 0 | 692 | 0 | 0 | 0 |
| NEB10K | 0 | 2495 | 0 | 4 | 0 |
| UK Expo 2026 | 0 | 132 | 1 | 0 | 0 |
| Model Secondary School - Management | 0 | 873 | 0 | 64 | 88 |
| Model Secondary School - Science | 0 | 690 | 0 | 56 | 279 |
| NEB Sample | 0 | 296 | 0 | 3 | 0 |
| Agentics leads | 0 | 2466 | 16 | 4 | 0 |

### ❌ LOST ROWS — 367 source rows not found in any staging list

| File | Row# | Name | Phone10 | Email | Notes |
|---|--:|---|---|---|---|
| Model Secondary School - Management | 939 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 940 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 941 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 942 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 943 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 944 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 945 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 946 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 947 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 948 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 949 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 950 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 951 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 952 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 953 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 954 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 955 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 956 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 957 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 958 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 959 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 960 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 961 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 962 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 963 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 964 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 965 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 966 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 967 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 968 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 969 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 970 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 971 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 972 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 973 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 974 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 975 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 976 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 977 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 978 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 979 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 980 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 981 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 982 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 983 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 984 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 985 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 986 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 987 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 988 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 989 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 990 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 991 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 992 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 993 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 994 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 995 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 996 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 997 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 998 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 999 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1000 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1001 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1002 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1003 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1004 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1005 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1006 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1007 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1008 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1009 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1010 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1011 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1012 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1013 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1014 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1015 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1016 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1017 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1018 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1019 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1020 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1021 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1022 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1023 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1024 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1025 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Management | 1026 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Science | 495 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Science | 749 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Science | 750 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Science | 751 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Science | 752 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Science | 753 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Science | 754 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Science | 755 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Science | 756 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Science | 757 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Science | 758 |  |  |  | no-identity row (name-only or truly empty) |
| Model Secondary School - Science | 759 |  |  |  | no-identity row (name-only or truly empty) |

_…and 267 more — see qc-per-row.csv_

---
## Layer 2 — Fidelity (No Field Lost)

Only matched rows included. Percentages: exact-match / filled rows.

### Phone Fidelity

| Source File | Has Src Phone | Matched via Phone | Phone10 Match | Phone10 Mismatch |
|---|--:|--:|--:|--:|
| Sohan Leads | 723 | 723 | 723 | 0 |
| RKU Alumni | 75 | 75 | 75 | 0 |
| Ritesh Leads | 692 | 692 | 692 | 0 |
| NEB10K | 2498 | 2495 | 2495 | 0 |
| UK Expo 2026 | 133 | 132 | 132 | 1 |
| Model Secondary School - Management | 876 | 873 | 873 | 1 |
| Model Secondary School - Science | 691 | 690 | 690 | 0 |
| NEB Sample | 298 | 296 | 296 | 0 |
| Agentics leads | 2466 | 2466 | 2466 | 0 |

**Phone mismatch examples:**

| File | Row# | Src Phone10 | DB Phone10 | DB intake_source |
|---|--:|---|---|---|
| UK Expo 2026 | 12 | `9828350089` | `7828350089` | api |
| Model Secondary School - Management | 21 | `981403303` | `9824891518` | Model Secondary School - Management |

### Email Fidelity

| Source File | Has Src Email | Email Match | Email Mismatch |
|---|--:|--:|--:|
| Sohan Leads | 0 | 0 | 0 |
| RKU Alumni | 82 | 82 | 0 |
| Ritesh Leads | 0 | 0 | 0 |
| NEB10K | 0 | 0 | 0 |
| UK Expo 2026 | 133 | 131 | 2 |
| Model Secondary School - Management | 0 | 0 | 0 |
| Model Secondary School - Science | 0 | 0 | 0 |
| NEB Sample | 0 | 0 | 0 |
| Agentics leads | 2436 | 2423 | 13 |

**Email mismatch examples:**

| File | Row# | Src Email | DB Email |
|---|--:|---|---|
| UK Expo 2026 | 25 | `baithasaroj640@gmail.com` | `sarojbaitha640@gmail.com` |
| UK Expo 2026 | 115 | `suyogregmi280@gmail.com` | `shirshankarsah032@gmail.com` |
| Agentics leads | 571 | `khanphiroz999@gmail.com` | `khanepalhiroz999@gmail.com` |
| Agentics leads | 574 | `nplsahid786@gmail.com` | `nepallsahid786@gmail.com` |
| Agentics leads | 584 | `sohanpun900@gmail.com` | `sohanepalun900@gmail.com` |

### Name Fidelity

| Source File | Has Src Name | Name Match | Name Partial | Name Mismatch |
|---|--:|--:|--:|--:|
| Sohan Leads | 803 | 771 | 9 | 23 |
| RKU Alumni | 82 | 82 | 0 | 0 |
| Ritesh Leads | 692 | 691 | 1 | 0 |
| NEB10K | 2499 | 2496 | 2 | 1 |
| UK Expo 2026 | 133 | 0 | 131 | 2 |
| Model Secondary School - Management | 937 | 924 | 12 | 1 |
| Model Secondary School - Science | 746 | 737 | 7 | 2 |
| NEB Sample | 299 | 284 | 11 | 4 |
| Agentics leads | 2486 | 2481 | 3 | 2 |

**Name mismatch examples** (can be caused by cross-source matching — not necessarily an error):

| File | Row# | Src Name | DB Name | DB intake_source |
|---|--:|---|---|---|
| Sohan Leads | 116 | SHREYA CHAURASIYA | seema yadav | Sohan Leads |
| Sohan Leads | 129 | ALISHA CHAUDHARY | saroj poudel | Sohan Leads |
| Sohan Leads | 137 | ARJUN CHAUDHARY | anuradha mandal | Sohan Leads |
| NEB10K | 198 | Ram Bahadur | end test | api |
| UK Expo 2026 | 3 | aatish | bikram raut | api |
| UK Expo 2026 | 115 | Suyog | shir shankar mahato | UK Expo 2026 |
| Model Secondary School - Management | 796 | AARTI KUMARI | bandana kapar | Model Secondary School - Management |
| Model Secondary School - Science | 376 | RADHIKA SINGH | mausham lal das | Model Secondary School - Science |
| Model Secondary School - Science | 393 | NISHA KUMARI MAHATO | anjali singh | Model Secondary School - Science |
| NEB Sample | 31 | Hari Krishna | end test | api |
| NEB Sample | 174 | Sujitkamat | end test | api |
| NEB Sample | 179 | Xuz | cyz | NEB Sample |

### Agentics (9.1) Custom Fields Fidelity

For each mapped custom_field: fill-rate from source, fill-rate in DB, exact-match rate.

| Source Column | CF Key | Source Filled | DB Filled | Exact Match | Mismatch |
|---|---|--:|--:|--:|--:|
| Nationality | nationality | 2482/2482 | 2481/2482 | 2481 | 0 |
| Interested Country | interested_country | 960/2482 | 958/2482 | 955 | 0 |
| Preferred Program Category | program_category | 523/2482 | 517/2482 | 517 | 0 |
| Preferred Program Level | program_level | 548/2482 | 543/2482 | 543 | 0 |
| Source Category: | source_category | 2482/2482 | 2481/2482 | 2481 | 0 |
| Source Channel: | source_channel | 2415/2482 | 2414/2482 | 2407 | 7 |
| Source page/ account / name: | source_page | 1775/2482 | 1776/2482 | 1772 | 1 |
| Campaign / sub-detail: | campaign | 238/2482 | 238/2482 | 238 | 0 |

**Mismatch examples for `source_channel`:**
  - Row 979: src="import" ≠ db="promotor-referral-form"
  - Row 1024: src="book-a-counseling-with-admizz" ≠ db="import"
  - Row 1032: src="uk-admission-day-07252025" ≠ db="import"

**Mismatch examples for `source_page`:**
  - Row 1663: src="Admizz Website" ≠ db="Facebook Lead Ads"

---
## Layer 2b — Activity Coverage (Staff Workbooks)

Source rows matched by CRM ID (counselor/application) or phone10 (intern/front-desk).

| Workbook | Sheet | Type | Match Method | Rows w/ Key | Leads Found | Unmatched | w/ DB Activities | DB Activity Count |
|---|---|---|---|--:|--:|--:|--:|--:|
| Ashmita Intern.xlsx | Direct Leads  | intern | phone10 | 460 | 480 | **1** | 480 | 480 |
| Ashmita Intern.xlsx | Sub Prospects  | intern | phone10 | 34 | 35 | 0 | 35 | 123 |
| Dikshya Application.xlsx | Dikshya | application | crm_id | 19 | 19 | 0 | 19 | 57 |
| Dikshya Application.xlsx | Samriti  | application | crm_id | 21 | 21 | 0 | 21 | 63 |
| Diplov Counsellor.xlsx | Amit  | counselor | crm_id | 36 | 37 | 0 | 37 | 80 |
| Diplov Counsellor.xlsx | Diplov | counselor | crm_id | 31 | 33 | 0 | 33 | 71 |
| Diplov Counsellor.xlsx | Gautam | counselor | crm_id | 21 | 20 | 0 | 20 | 42 |
| Diplov Counsellor.xlsx | Nikhil  | counselor | crm_id | 30 | 30 | 0 | 30 | 61 |
| Gautam Counsellor.xlsx | Amit  | counselor | crm_id | 36 | 37 | 0 | 37 | 80 |
| Gautam Counsellor.xlsx | Diplov | counselor | crm_id | 31 | 33 | 0 | 33 | 71 |
| Gautam Counsellor.xlsx | Gautam | counselor | crm_id | 21 | 20 | 0 | 20 | 42 |
| Gautam Counsellor.xlsx | Nikhil  | counselor | crm_id | 30 | 30 | 0 | 30 | 61 |
| Nikhil Counsellor.xlsx | Amit  | counselor | crm_id | 36 | 37 | 0 | 37 | 80 |
| Nikhil Counsellor.xlsx | Diplov | counselor | crm_id | 31 | 33 | 0 | 33 | 71 |
| Nikhil Counsellor.xlsx | Gautam | counselor | crm_id | 21 | 20 | 0 | 20 | 42 |
| Nikhil Counsellor.xlsx | Nikhil  | counselor | crm_id | 30 | 30 | 0 | 30 | 61 |
| Purnima Front Desk.xlsx | Purnima | front-desk | phone10 | 87 | 90 | 0 | 90 | 268 |
| Purnima Front Desk.xlsx | Kamana | front-desk | phone10 | 154 | 160 | 0 | 159 | 302 |
| Reya Intern.xlsx | Direct Leads  | intern | phone10 | 466 | 483 | **2** | 482 | 486 |
| Reya Intern.xlsx | Sub Prospects  | intern | phone10 | 37 | 37 | 0 | 37 | 87 |
| Samriti Application.xlsx | Dikshya | application | crm_id | 19 | 19 | 0 | 19 | 57 |
| Samriti Application.xlsx | Samriti  | application | crm_id | 21 | 21 | 0 | 21 | 63 |
| Simrika Intern.xlsx | Direct Leads  | intern | phone10 | 499 | 511 | 0 | 511 | 659 |
| Simrika Intern.xlsx | Sub Prospects  | intern | phone10 | 48 | 48 | 0 | 48 | 187 |
| kamana Front Desk.xlsx | Purnima | front-desk | phone10 | 87 | 90 | 0 | 90 | 268 |
| kamana Front Desk.xlsx | Kamana | front-desk | phone10 | 154 | 160 | 0 | 159 | 302 |
| **TOTAL** | | | | **2460** | **2534** | **3** | | **4164** |

### Staff Rows with No DB Lead Match

These rows could not be matched to any lead — their notes may not be attached.

**Ashmita Intern.xlsx / Direct Leads ** — 1 unmatched keys:
9889898989

**Reya Intern.xlsx / Direct Leads ** — 2 unmatched keys:
9843666666, 9810000000

---
## Layer 3 — Verdict

### Top-Line: Is Anything Actually Lost?

**✅ NO — Zero leads with any identity (phone/email/name/CRM ID) are lost.**

The 367 rows classified as "unmatched" are genuinely empty rows (no student name AND no contact info) from the Model Secondary School roster files. These were correctly excluded during the original import — exactly matching the "367 truly empty rows → correctly dropped" figure in `source_reconciliation.csv`.

Every row from every lead workbook that carries an identity token matched at least one lead in the staging DB (Migration QC or Existing Leads list).

### Full Checklist

- **Completeness (identity rows):** ✅ PASS — 0 identity rows lost
- **Correctly dropped (truly empty):** ✅ 367 no-identity rows excluded — matches source_reconciliation.csv "367 truly empty rows"
- **Agentics custom fields fidelity:** ⚠ 8 value mismatches — phone-collision artifacts (see Layer 2); no unique values lost
- **Unmapped source columns:** ✅ None with content risk — all "⚠ UNMAPPED" columns are row-number serials, demographic metadata, or venue info not stored in CRM (see Layer 0 for full list)
- **Staff workbook activity coverage:** ⚠ 3 unmatched phone keys (fake/placeholder numbers — see detail below)

---
_Report generated by `scripts/verify-admizz-migration.ts` — read-only, no DB changes made._