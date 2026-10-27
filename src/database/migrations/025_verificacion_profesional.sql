-- 025: verificación de que el médico es médico (matrícula vigente en REFEPS o revisión manual)
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS license_status VARCHAR(20) DEFAULT 'unverified'; -- unverified | pending | verified | rejected
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS license_type VARCHAR(10);                       -- MN (nacional) | MP (provincial)
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS license_document TEXT;                          -- foto de la credencial / título (data URL)
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS license_requested_at TIMESTAMPTZ;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS license_verified_at TIMESTAMPTZ;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS license_verified_by VARCHAR(120);               -- 'refeps' o email del administrador
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS license_verification_note TEXT;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS refeps_data JSONB;                              -- respuesta de REFEPS usada para verificar

-- Firma electrónica y CUIR de cada receta
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS cuir VARCHAR(80);
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS signature_key_id VARCHAR(40);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prescriptions_cuir ON prescriptions(cuir) WHERE cuir IS NOT NULL;

-- Claves de la plataforma (firma de recetas). La privada solo si no viene por variable de entorno.
CREATE TABLE IF NOT EXISTS platform_keys (
    id VARCHAR(40) PRIMARY KEY,
    purpose VARCHAR(40) NOT NULL,
    public_key_pem TEXT NOT NULL,
    private_key_pem TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
