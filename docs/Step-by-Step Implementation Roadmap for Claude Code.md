# Step-by-Step Implementation Roadmap for Claude Code

## PHASE 1 — Integration Key Infrastructure

### Step 1.1 — Create `integration_keys` table
### Step 1.2 — Create hashing utility
### Step 1.3 — Create API key auth middleware
### Step 1.4 — Add integration audit logging

**Deliverable:**
- Keys can be created via SQL
- Integration request authenticated
- RLS respected

---

## PHASE 2 — Integration API Layer

### Step 2.1 — Create namespace routes
### Step 2.2 — Implement read endpoints
### Step 2.3 — Implement write endpoints
### Step 2.4 — Add rate limiting specific to integration

**Deliverable:**
- Postman tests pass
- No session cookies used

---

## PHASE 3 — Webhook System

### Step 3.1 — Create `webhook_endpoints` table
### Step 3.2 — Create webhook dispatcher service
### Step 3.3 — Add HMAC signing
### Step 3.4 — Retry mechanism (basic exponential retry)
### Step 3.5 — Log webhook attempts

**Deliverable:**
- Webhook fired on `lead.created`
- Signed payload validated externally

---

## PHASE 4 — Tool Manifest Endpoint

### Step 4.1 — Define tool schemas
### Step 4.2 — Expose tool manifest route
### Step 4.3 — Validate tool definitions

**Deliverable:**
- Orca can dynamically fetch tool list

---

## PHASE 5 — Hardening

### Step 5.1 — Strict stage transition rules
### Step 5.2 — Mutation rate limits
### Step 5.3 — Negative tests
### Step 5.4 — Full regression test
