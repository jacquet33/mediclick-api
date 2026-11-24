-- Tienda sin cargo (cortesía) para pruebas y farmacias piloto: la habilita el administrador de la plataforma
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS tienda_cortesia BOOLEAN NOT NULL DEFAULT false;
