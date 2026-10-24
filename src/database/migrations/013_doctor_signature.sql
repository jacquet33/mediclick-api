-- 013: Add signature_image column to doctors table
-- Stores the doctor's handwritten signature as a base64 data URI
-- Used to embed in prescription PDFs

ALTER TABLE doctors ADD COLUMN IF NOT EXISTS signature_image TEXT;

COMMENT ON COLUMN doctors.signature_image IS 'Base64 data URI of doctor signature image for prescription PDFs';
