-- Interruptores de servicios de la plataforma. La receta electrónica arranca apagada hasta la aprobación de ReNaPDiS.
INSERT INTO platform_settings (key, value) VALUES ('servicio_recetas', 'false') ON CONFLICT (key) DO NOTHING;
