-- Lead Activities Table (HubSpot-style activity logging)
-- Migration: 014_lead_activities.sql

-- Create activity type enum
DO $$ BEGIN
    CREATE TYPE activity_type AS ENUM ('call', 'email', 'meeting');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create call outcome enum
DO $$ BEGIN
    CREATE TYPE call_outcome AS ENUM ('connected', 'left_voicemail', 'no_answer', 'busy', 'wrong_number');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create lead_activities table
CREATE TABLE IF NOT EXISTS lead_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),

    -- Activity type
    activity_type activity_type NOT NULL,

    -- Common fields
    subject TEXT,
    description TEXT,

    -- Call-specific fields
    call_outcome call_outcome,
    duration_minutes INTEGER CHECK (duration_minutes >= 0),

    -- Meeting-specific fields
    scheduled_at TIMESTAMPTZ,
    location TEXT,
    attendees TEXT[], -- Array of email addresses

    -- Email-specific fields
    email_subject TEXT,
    email_body TEXT,

    -- Status
    completed_at TIMESTAMPTZ,

    -- Flexible metadata
    metadata JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id ON lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_tenant_id ON lead_activities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_user_id ON lead_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_type ON lead_activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_lead_activities_created_at ON lead_activities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_activities_scheduled_at ON lead_activities(scheduled_at) WHERE scheduled_at IS NOT NULL;

-- Enable RLS
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;

-- RLS Policies using existing helper functions
CREATE POLICY "lead_activities_select" ON lead_activities
    FOR SELECT
    USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "lead_activities_insert" ON lead_activities
    FOR INSERT
    WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "lead_activities_update" ON lead_activities
    FOR UPDATE
    USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "lead_activities_delete" ON lead_activities
    FOR DELETE
    USING (is_tenant_admin(tenant_id) OR user_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER update_lead_activities_updated_at
    BEFORE UPDATE ON lead_activities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Add comment for documentation
COMMENT ON TABLE lead_activities IS 'HubSpot-style activity logging for leads (calls, emails, meetings)';
