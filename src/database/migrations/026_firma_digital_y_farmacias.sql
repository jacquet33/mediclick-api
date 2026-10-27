-- 026: firma digital con certificado (Ley 25.506) y repositorio para farmacias (Ley 27.553)

-- Certificados de firma digital de los médicos (solo la parte pública; la clave privada nunca sale del equipo del médico)
CREATE TABLE IF NOT EXISTS doctor_certificates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    fingerprint VARCHAR(64) NOT NULL,              -- SHA-256 del certificado (DER)
    subject_cn TEXT, subject_serial TEXT,          -- titular y CUIL/CUIT (serialNumber del sujeto)
    issuer_cn TEXT, issuer_o TEXT,
    serial_number TEXT,
    not_before TIMESTAMPTZ, not_after TIMESTAMPTZ,
    issuer_recognized BOOLEAN DEFAULT false,       -- emitido por un certificador licenciado conocido
    cert_pem TEXT NOT NULL, chain_pem TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (doctor_id, fingerprint)
);

-- Sesiones de firma: el PDF con el espacio reservado para la firma, hasta que el navegador la devuelve
CREATE TABLE IF NOT EXISTS prescription_signing_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL,
    certificate_id UUID REFERENCES doctor_certificates(id),
    placeholder_pdf BYTEA NOT NULL,
    content_sha256 VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '15 minutes'
);

ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS signed_pdf BYTEA;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS digital_signed_at TIMESTAMPTZ;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS digital_certificate_id UUID REFERENCES doctor_certificates(id);

-- Farmacias habilitadas para consultar y dispensar
CREATE TABLE IF NOT EXISTS pharmacies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    cuit VARCHAR(13),
    habilitacion VARCHAR(80),                      -- N° de habilitación / REFES
    pharmacist_name VARCHAR(200),
    pharmacist_license VARCHAR(60),
    email VARCHAR(255), phone VARCHAR(30),
    address TEXT, city VARCHAR(100), province VARCHAR(100),
    api_key_hash VARCHAR(64) NOT NULL UNIQUE,      -- SHA-256 de la clave (la clave se muestra una sola vez)
    api_key_prefix VARCHAR(12) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

-- Dispensas (total o parcial por ítem)
CREATE TABLE IF NOT EXISTS prescription_dispensations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    pharmacy_id UUID NOT NULL REFERENCES pharmacies(id),
    items JSONB NOT NULL,                          -- [{itemId, cantidad, producto, lote, vencimiento}]
    pharmacist_name VARCHAR(200),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dispensations_rx ON prescription_dispensations(prescription_id);

ALTER TABLE prescription_items ADD COLUMN IF NOT EXISTS dispensed_quantity INT DEFAULT 0;

-- Registro de cada consulta de una farmacia (trazabilidad)
CREATE TABLE IF NOT EXISTS pharmacy_access_log (
    id BIGSERIAL PRIMARY KEY,
    pharmacy_id UUID REFERENCES pharmacies(id),
    prescription_id UUID,
    action VARCHAR(30) NOT NULL,
    ip VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TYPE prescription_status ADD VALUE IF NOT EXISTS 'partially_dispensed';
ALTER TYPE prescription_status ADD VALUE IF NOT EXISTS 'dispensed';
