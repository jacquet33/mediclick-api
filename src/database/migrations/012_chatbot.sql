-- ============================================================
-- MediClick - Migration 012: Chatbot FAQ configurable
-- Cada médico configura las respuestas de su chatbot
-- ============================================================

CREATE TABLE chatbot_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_doctor_id UUID NOT NULL REFERENCES organization_doctors(id) ON DELETE CASCADE,
    
    is_enabled BOOLEAN DEFAULT true,
    welcome_message TEXT DEFAULT '¡Hola! 👋 Soy el asistente de este consultorio. ¿En qué puedo ayudarte?',
    fallback_message TEXT DEFAULT 'No tengo esa información. Podés comunicarte directamente al consultorio.',
    
    -- Info general (se usa como contexto para respuestas)
    consultation_fee NUMERIC(10,2),
    accepted_insurance TEXT[],
    schedule_text TEXT,
    address_text TEXT,
    phone TEXT,
    whatsapp TEXT,
    extra_info TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_chatbot_doctor UNIQUE (org_doctor_id)
);

CREATE TABLE chatbot_faqs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chatbot_config_id UUID NOT NULL REFERENCES chatbot_config(id) ON DELETE CASCADE,
    
    question TEXT NOT NULL,          -- "¿Cuánto sale la consulta?"
    keywords TEXT[] NOT NULL,        -- {'consulta','costo','precio','valor','cuanto'}
    answer TEXT NOT NULL,            -- "La consulta tiene un valor de $15.000..."
    category VARCHAR(50),            -- 'costos', 'horarios', 'ubicacion', 'seguros', 'general'
    sort_order SMALLINT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chatbot_config_doctor ON chatbot_config(org_doctor_id);
CREATE INDEX idx_chatbot_faqs_config ON chatbot_faqs(chatbot_config_id);

CREATE TRIGGER trg_chatbot_config_upd
    BEFORE UPDATE ON chatbot_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
