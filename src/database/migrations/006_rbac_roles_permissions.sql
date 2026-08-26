-- ============================================================
-- MediClick - Migration 006: RBAC - Roles y Permisos
-- Sistema granular de roles para consultorios → hospitales
-- Backward compatible con org_role ENUM existente
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- 1. TABLAS DE ROLES Y PERMISOS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,                     -- 'medico', 'secretaria', etc.
    name VARCHAR(100) NOT NULL,                           -- Nombre para mostrar
    description TEXT,
    
    -- Clasificación
    level SMALLINT NOT NULL DEFAULT 50,                   -- 0=superadmin, 10=dirección, 20=jefatura, 30=clínico, 40=admin, 50=externo
    category VARCHAR(20) NOT NULL DEFAULT 'clinical'      -- 'directive', 'leadership', 'clinical', 'administrative', 'external'
        CHECK (category IN ('directive', 'leadership', 'clinical', 'administrative', 'external')),
    
    is_clinical BOOLEAN DEFAULT false,                    -- ¿Puede atender pacientes?
    is_system BOOLEAN DEFAULT false,                      -- ¿Rol del sistema, no borrable?
    requires_license BOOLEAN DEFAULT false,               -- ¿Requiere matrícula?
    
    -- Qué tipos de org pueden usar este rol
    allowed_org_types TEXT[] DEFAULT '{consultorio,centro_medico,clinica,hospital,individual}',
    
    -- UI
    icon VARCHAR(50),                                     -- SF Symbol name
    color VARCHAR(20),                                    -- Hex color para badges
    sort_order SMALLINT DEFAULT 99,
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(100) UNIQUE NOT NULL,                    -- 'appointments.create', 'patients.view', etc.
    name VARCHAR(150) NOT NULL,
    description TEXT,
    module VARCHAR(50) NOT NULL,                          -- 'appointments', 'patients', 'billing', etc.
    sort_order SMALLINT DEFAULT 99,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX idx_role_perms_role ON role_permissions(role_id);
CREATE INDEX idx_role_perms_perm ON role_permissions(permission_id);
CREATE INDEX idx_roles_code ON roles(code);
CREATE INDEX idx_perms_module ON permissions(module);

-- ═══════════════════════════════════════════════════════════
-- 2. TABLA DE STAFF (usuarios no-médicos)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE staff (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    dni VARCHAR(20),
    
    -- Profesional (para enfermeros, kinesiólogos, etc.)
    license_number VARCHAR(50),                           -- Matrícula si aplica
    license_province VARCHAR(100),
    specialty VARCHAR(100),
    
    avatar_url TEXT,
    
    refresh_token_hash VARCHAR(255),
    
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_staff_email ON staff(email);

-- ═══════════════════════════════════════════════════════════
-- 3. MIEMBROS DE ORGANIZACIÓN (unifica doctors + staff)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Uno u otro, no ambos
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
    
    role_id UUID NOT NULL REFERENCES roles(id),
    
    -- Backward compat con org_role viejo
    legacy_role org_role,
    is_owner BOOLEAN DEFAULT false,
    
    -- Config por org
    consultation_fee DECIMAL(10, 2),
    slot_duration_minutes INT,
    room_number VARCHAR(20),
    department VARCHAR(100),                              -- Servicio: 'Cardiología', 'Guardia', etc.
    
    is_active BOOLEAN DEFAULT true,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Un usuario solo puede tener un rol activo por org
    CONSTRAINT uq_member_doctor UNIQUE (organization_id, doctor_id),
    CONSTRAINT uq_member_staff UNIQUE (organization_id, staff_id),
    CONSTRAINT chk_member_type CHECK (
        (doctor_id IS NOT NULL AND staff_id IS NULL) OR
        (doctor_id IS NULL AND staff_id IS NOT NULL)
    )
);

CREATE INDEX idx_orgmembers_org ON organization_members(organization_id);
CREATE INDEX idx_orgmembers_doctor ON organization_members(doctor_id) WHERE doctor_id IS NOT NULL;
CREATE INDEX idx_orgmembers_staff ON organization_members(staff_id) WHERE staff_id IS NOT NULL;
CREATE INDEX idx_orgmembers_role ON organization_members(role_id);
CREATE INDEX idx_orgmembers_active ON organization_members(organization_id, is_active) WHERE is_active = true;

-- ═══════════════════════════════════════════════════════════
-- 4. VINCULAR organization_doctors CON NUEVO SISTEMA
-- ═══════════════════════════════════════════════════════════

ALTER TABLE organization_doctors ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id);

-- ═══════════════════════════════════════════════════════════
-- 5. SEED DE ROLES
-- ═══════════════════════════════════════════════════════════

INSERT INTO roles (code, name, description, level, category, is_clinical, is_system, requires_license, allowed_org_types, icon, color, sort_order) VALUES
-- Directivos
('propietario',       'Propietario',        'Control total de la organización. Facturación, configuración, eliminación.',                             10, 'directive',      false, true,  false, '{consultorio,centro_medico,clinica,hospital,individual}', 'crown.fill',                '#534AB7', 1),
('director_medico',   'Director médico',    'Supervisión clínica general. Auditoría de historias, protocolos, indicadores.',                          10, 'directive',      true,  true,  true,  '{centro_medico,clinica,hospital}',                        'stethoscope',               '#534AB7', 2),
('administrador',     'Administrador',      'Gestión operativa: horarios, invitaciones, configuración general. Sin acceso a historias clínicas.',     10, 'directive',      false, true,  false, '{consultorio,centro_medico,clinica,hospital}',            'gearshape.fill',            '#534AB7', 3),

-- Jefaturas
('jefe_guardia',      'Jefe de guardia',    'Coordina emergencias 24hs. Reasigna turnos urgentes, sobrepasar horarios, ve toda la guardia.',         20, 'leadership',     true,  true,  true,  '{clinica,hospital}',                                      'cross.case.fill',           '#0F6E56', 4),
('jefe_servicio',     'Jefe de servicio',   'Supervisa médicos de su especialidad. Valida historias, estadísticas del área, asigna guardias.',        20, 'leadership',     true,  true,  true,  '{centro_medico,clinica,hospital}',                        'person.3.fill',             '#0F6E56', 5),
('jefe_enfermeria',   'Jefe de enfermería', 'Coordina equipo de enfermería. Asigna turnos de enfermeros, supervisa signos vitales y triaje.',         20, 'leadership',     false, true,  true,  '{clinica,hospital}',                                      'heart.text.square.fill',    '#0F6E56', 6),

-- Clínicos
('medico',            'Médico',             'Atiende pacientes. Crea turnos, historias clínicas, recetas. Acceso a sus propios pacientes.',           30, 'clinical',       true,  true,  true,  '{consultorio,centro_medico,clinica,hospital,individual}', 'stethoscope',               '#639922', 7),
('residente',         'Residente',          'Médico en formación. Mismas funciones que médico pero requiere validación del jefe de servicio.',        30, 'clinical',       true,  true,  true,  '{clinica,hospital}',                                      'graduationcap.fill',        '#639922', 8),
('enfermero',         'Enfermero/a',        'Registra signos vitales, preparación de pacientes, triaje, administración de medicación.',               30, 'clinical',       false, true,  true,  '{centro_medico,clinica,hospital}',                        'cross.fill',                '#639922', 9),
('kinesiologo',       'Kinesiólogo',        'Rehabilitación y fisioterapia. Acceso limitado a historia clínica del área motora.',                     30, 'clinical',       true,  true,  true,  '{centro_medico,clinica,hospital}',                        'figure.run',                '#639922', 10),
('nutricionista',     'Nutricionista',      'Plan alimentario. Acceso a datos antropométricos y laboratorio del paciente.',                           30, 'clinical',       true,  true,  true,  '{centro_medico,clinica,hospital}',                        'leaf.fill',                 '#639922', 11),
('psicologo',         'Psicólogo/a',        'Atención psicológica. Historia clínica propia, separada de la médica.',                                 30, 'clinical',       true,  true,  true,  '{centro_medico,clinica,hospital}',                        'brain.head.profile',        '#639922', 12),
('tecnico',           'Técnico',            'Laboratorio, imágenes, otros estudios. Carga resultados, no accede a historias.',                        30, 'clinical',       false, true,  true,  '{centro_medico,clinica,hospital}',                        'testtube.2',                '#639922', 13),
('farmaceutico',      'Farmacéutico',       'Valida y dispensa recetas. Ve prescripciones activas, no historias clínicas.',                           30, 'clinical',       false, true,  true,  '{clinica,hospital}',                                      'pills.fill',                '#639922', 14),

-- Administrativos
('secretaria',        'Secretaria',         'Gestión de turnos, datos de pacientes (no clínicos), recepción, llamados.',                             40, 'administrative', false, true,  false, '{consultorio,centro_medico,clinica,hospital}',            'phone.fill',                '#BA7517', 15),
('facturacion',       'Facturación',        'Liquidación de obras sociales, nomenclador, lotes, informes financieros.',                               40, 'administrative', false, true,  false, '{centro_medico,clinica,hospital}',                        'banknote.fill',             '#BA7517', 16),
('recepcionista',     'Recepcionista',      'Check-in de pacientes, sala de espera, derivación al consultorio correcto.',                             40, 'administrative', false, true,  false, '{centro_medico,clinica,hospital}',                        'person.crop.rectangle.fill','#BA7517', 17),
('auditor',           'Auditor',            'Solo lectura de todo. Para auditorías internas o de obras sociales.',                                    40, 'administrative', false, true,  false, '{centro_medico,clinica,hospital}',                        'eye.fill',                  '#BA7517', 18),

-- Externos
('paciente',          'Paciente',           'Acceso al portal: sus turnos, recetas, chat con el médico, resultados.',                                 50, 'external',       false, true,  false, '{consultorio,centro_medico,clinica,hospital,individual}', 'person.fill',               '#D85A30', 19),
('familiar',          'Familiar autorizado','Lectura limitada de un paciente específico. Requiere autorización explícita.',                           50, 'external',       false, true,  false, '{consultorio,centro_medico,clinica,hospital}',            'person.2.fill',             '#D85A30', 20),
('derivante',         'Derivante externo',  'Médico de otra organización que envía/recibe derivaciones y puede ver resúmenes.',                       50, 'external',       false, true,  true,  '{centro_medico,clinica,hospital}',                        'arrow.triangle.branch',     '#D85A30', 21)
ON CONFLICT (code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- 6. SEED DE PERMISOS
-- ═══════════════════════════════════════════════════════════

INSERT INTO permissions (code, name, module, description, sort_order) VALUES
-- Organización
('org.view',              'Ver organización',               'organization', 'Ver datos de la organización',                      1),
('org.edit',              'Editar organización',            'organization', 'Modificar nombre, datos fiscales, dirección',        2),
('org.delete',            'Eliminar organización',          'organization', 'Eliminar permanentemente la organización',           3),
('org.invite',            'Invitar miembros',               'organization', 'Invitar nuevos médicos o staff',                     4),
('org.remove_member',     'Desvincular miembros',           'organization', 'Remover miembros de la organización',                5),
('org.manage_roles',      'Gestionar roles',                'organization', 'Asignar y cambiar roles de miembros',                6),

-- Pacientes
('patients.view_own',     'Ver sus pacientes',              'patients',     'Ver pacientes propios',                              10),
('patients.view_all',     'Ver todos los pacientes',        'patients',     'Ver cualquier paciente de la organización',           11),
('patients.create',       'Crear pacientes',                'patients',     'Registrar nuevos pacientes',                         12),
('patients.edit',         'Editar pacientes',               'patients',     'Modificar datos de pacientes',                       13),
('patients.delete',       'Eliminar pacientes',             'patients',     'Desactivar pacientes',                               14),
('patients.view_clinical','Ver datos clínicos',             'patients',     'Acceder a alergias, condiciones, medicación',        15),
('patients.export',       'Exportar pacientes',             'patients',     'Descargar listado en CSV/Excel',                     16),

-- Turnos
('appointments.view_own', 'Ver sus turnos',                 'appointments', 'Ver turnos propios',                                 20),
('appointments.view_all', 'Ver todos los turnos',           'appointments', 'Ver turnos de cualquier profesional',                 21),
('appointments.create',   'Crear turnos',                   'appointments', 'Agendar nuevos turnos',                              22),
('appointments.edit',     'Modificar turnos',               'appointments', 'Cambiar hora, estado, notas',                        23),
('appointments.cancel',   'Cancelar turnos',                'appointments', 'Cancelar turnos existentes',                         24),
('appointments.override', 'Sobrepasar horarios',            'appointments', 'Crear turnos fuera de horario configurado',          25),

-- Historia clínica
('records.view_own',      'Ver historias propias',           'records',     'Ver historias de sus pacientes',                     30),
('records.view_all',      'Ver todas las historias',         'records',     'Ver historias de cualquier paciente',                31),
('records.create',        'Crear historia clínica',          'records',     'Registrar nueva consulta/evolución',                 32),
('records.edit',          'Editar historia clínica',         'records',     'Modificar registros existentes',                     33),
('records.validate',      'Validar historias',               'records',     'Aprobar historias de residentes',                    34),
('records.audit',         'Auditar historias',               'records',     'Revisar y auditar historias clínicas',               35),

-- Recetas
('prescriptions.create',  'Crear recetas',                  'prescriptions','Emitir recetas digitales',                          40),
('prescriptions.view_own','Ver recetas propias',            'prescriptions','Ver recetas que emitió',                             41),
('prescriptions.view_all','Ver todas las recetas',          'prescriptions','Ver recetas de toda la org',                         42),
('prescriptions.dispense','Dispensar recetas',              'prescriptions','Marcar receta como dispensada',                      43),

-- Chat
('chat.view_own',         'Chat con sus pacientes',         'chat',         'Mensajería con pacientes propios',                  50),
('chat.view_all',         'Ver todos los chats',            'chat',         'Acceder a conversaciones de toda la org',           51),

-- Signos vitales / Enfermería
('vitals.record',         'Registrar signos vitales',       'vitals',       'Cargar TA, FC, temp, peso, etc.',                   60),
('vitals.view',           'Ver signos vitales',             'vitals',       'Consultar historial de signos vitales',             61),
('triage.manage',         'Gestionar triaje',               'vitals',       'Clasificar urgencia y prioridad',                   62),

-- Facturación
('billing.view',          'Ver facturación',                'billing',      'Consultar liquidaciones y estados',                 70),
('billing.create',        'Crear liquidaciones',            'billing',      'Generar lotes y presentaciones',                    71),
('billing.manage',        'Gestionar facturación',          'billing',      'Aprobar, rechazar, gestión completa',               72),

-- Horarios
('schedules.view_own',    'Ver sus horarios',               'schedules',    'Ver horarios propios',                              80),
('schedules.view_all',    'Ver todos los horarios',         'schedules',    'Ver horarios de todos',                             81),
('schedules.edit_own',    'Editar sus horarios',            'schedules',    'Modificar sus propios horarios',                    82),
('schedules.edit_all',    'Editar todos los horarios',      'schedules',    'Modificar horarios de cualquier profesional',       83),

-- Configuración
('settings.view',         'Ver configuración',              'settings',     'Consultar configuración de la org',                 90),
('settings.edit',         'Editar configuración',           'settings',     'Modificar configuración general',                   91),
('settings.booking',      'Configurar reservas online',     'settings',     'Gestionar página de reservas',                      92),

-- Reportes
('reports.basic',         'Reportes básicos',               'reports',      'Estadísticas propias',                              100),
('reports.full',          'Reportes completos',             'reports',      'Estadísticas de toda la organización',              101),
('reports.financial',     'Reportes financieros',           'reports',      'Informes de ingresos y facturación',                102)

ON CONFLICT (code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- 7. ASIGNACIÓN ROLE → PERMISOS
-- ═══════════════════════════════════════════════════════════

-- Helper: asignar múltiples permisos a un rol
DO $$
DECLARE
    v_role_id UUID;
    v_perm_code TEXT;
    v_perm_id UUID;
BEGIN

-- ─── PROPIETARIO: todo ─────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'propietario';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions
ON CONFLICT DO NOTHING;

-- ─── DIRECTOR MÉDICO ────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'director_medico';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view', 'org.edit', 'org.invite', 'org.remove_member', 'org.manage_roles',
    'patients.view_all', 'patients.create', 'patients.edit', 'patients.view_clinical', 'patients.export',
    'appointments.view_all', 'appointments.create', 'appointments.edit', 'appointments.cancel', 'appointments.override',
    'records.view_all', 'records.create', 'records.edit', 'records.validate', 'records.audit',
    'prescriptions.create', 'prescriptions.view_all',
    'chat.view_all',
    'vitals.view',
    'billing.view',
    'schedules.view_all', 'schedules.edit_all',
    'settings.view', 'settings.edit', 'settings.booking',
    'reports.full', 'reports.financial'
) ON CONFLICT DO NOTHING;

-- ─── ADMINISTRADOR ──────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'administrador';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view', 'org.edit', 'org.invite', 'org.remove_member', 'org.manage_roles',
    'patients.view_all', 'patients.create', 'patients.edit', 'patients.export',
    'appointments.view_all', 'appointments.create', 'appointments.edit', 'appointments.cancel',
    'schedules.view_all', 'schedules.edit_all',
    'billing.view', 'billing.create', 'billing.manage',
    'settings.view', 'settings.edit', 'settings.booking',
    'reports.full', 'reports.financial'
) ON CONFLICT DO NOTHING;

-- ─── JEFE DE GUARDIA ────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'jefe_guardia';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_all', 'patients.create', 'patients.edit', 'patients.view_clinical',
    'appointments.view_all', 'appointments.create', 'appointments.edit', 'appointments.cancel', 'appointments.override',
    'records.view_all', 'records.create', 'records.edit',
    'prescriptions.create', 'prescriptions.view_all',
    'chat.view_all',
    'vitals.view', 'vitals.record', 'triage.manage',
    'schedules.view_all', 'schedules.edit_all',
    'reports.basic'
) ON CONFLICT DO NOTHING;

-- ─── JEFE DE SERVICIO ───────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'jefe_servicio';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_all', 'patients.create', 'patients.edit', 'patients.view_clinical',
    'appointments.view_all', 'appointments.create', 'appointments.edit', 'appointments.cancel',
    'records.view_all', 'records.create', 'records.edit', 'records.validate',
    'prescriptions.create', 'prescriptions.view_all',
    'chat.view_all',
    'vitals.view',
    'schedules.view_all', 'schedules.edit_own',
    'reports.full'
) ON CONFLICT DO NOTHING;

-- ─── JEFE DE ENFERMERÍA ─────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'jefe_enfermeria';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_all', 'patients.view_clinical',
    'appointments.view_all',
    'vitals.view', 'vitals.record', 'triage.manage',
    'schedules.view_all', 'schedules.edit_all',
    'reports.basic'
) ON CONFLICT DO NOTHING;

-- ─── MÉDICO ─────────────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'medico';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_own', 'patients.create', 'patients.edit', 'patients.view_clinical',
    'appointments.view_own', 'appointments.create', 'appointments.edit', 'appointments.cancel',
    'records.view_own', 'records.create', 'records.edit',
    'prescriptions.create', 'prescriptions.view_own',
    'chat.view_own',
    'vitals.view',
    'schedules.view_own', 'schedules.edit_own',
    'settings.booking',
    'reports.basic'
) ON CONFLICT DO NOTHING;

-- ─── RESIDENTE ──────────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'residente';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_own', 'patients.create', 'patients.edit', 'patients.view_clinical',
    'appointments.view_own', 'appointments.create', 'appointments.edit',
    'records.view_own', 'records.create',
    'prescriptions.create', 'prescriptions.view_own',
    'chat.view_own',
    'vitals.view', 'vitals.record',
    'schedules.view_own',
    'reports.basic'
) ON CONFLICT DO NOTHING;

-- ─── ENFERMERO/A ────────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'enfermero';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_all', 'patients.view_clinical',
    'appointments.view_all',
    'vitals.view', 'vitals.record', 'triage.manage',
    'schedules.view_own',
    'reports.basic'
) ON CONFLICT DO NOTHING;

-- ─── KINESIÓLOGO ────────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'kinesiologo';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_own', 'patients.view_clinical',
    'appointments.view_own', 'appointments.create', 'appointments.edit',
    'records.view_own', 'records.create',
    'vitals.view',
    'schedules.view_own', 'schedules.edit_own',
    'reports.basic'
) ON CONFLICT DO NOTHING;

-- ─── NUTRICIONISTA ──────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'nutricionista';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_own', 'patients.view_clinical',
    'appointments.view_own', 'appointments.create', 'appointments.edit',
    'records.view_own', 'records.create',
    'vitals.view',
    'schedules.view_own', 'schedules.edit_own',
    'reports.basic'
) ON CONFLICT DO NOTHING;

-- ─── PSICÓLOGO ──────────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'psicologo';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_own', 'patients.view_clinical',
    'appointments.view_own', 'appointments.create', 'appointments.edit',
    'records.view_own', 'records.create', 'records.edit',
    'prescriptions.view_own',
    'chat.view_own',
    'schedules.view_own', 'schedules.edit_own',
    'reports.basic'
) ON CONFLICT DO NOTHING;

-- ─── TÉCNICO ────────────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'tecnico';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_all',
    'appointments.view_all',
    'reports.basic'
) ON CONFLICT DO NOTHING;

-- ─── FARMACÉUTICO ───────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'farmaceutico';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_all',
    'prescriptions.view_all', 'prescriptions.dispense',
    'reports.basic'
) ON CONFLICT DO NOTHING;

-- ─── SECRETARIA ─────────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'secretaria';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_all', 'patients.create', 'patients.edit',
    'appointments.view_all', 'appointments.create', 'appointments.edit', 'appointments.cancel',
    'schedules.view_all',
    'reports.basic'
) ON CONFLICT DO NOTHING;

-- ─── FACTURACIÓN ────────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'facturacion';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_all', 'patients.export',
    'appointments.view_all',
    'billing.view', 'billing.create', 'billing.manage',
    'reports.basic', 'reports.financial'
) ON CONFLICT DO NOTHING;

-- ─── RECEPCIONISTA ──────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'recepcionista';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_all', 'patients.create',
    'appointments.view_all',
    'schedules.view_all'
) ON CONFLICT DO NOTHING;

-- ─── AUDITOR ────────────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'auditor';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'org.view',
    'patients.view_all', 'patients.view_clinical', 'patients.export',
    'appointments.view_all',
    'records.view_all', 'records.audit',
    'prescriptions.view_all',
    'billing.view',
    'schedules.view_all',
    'reports.full', 'reports.financial'
) ON CONFLICT DO NOTHING;

-- ─── PACIENTE ───────────────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'paciente';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'appointments.view_own',
    'prescriptions.view_own',
    'chat.view_own',
    'vitals.view'
) ON CONFLICT DO NOTHING;

-- ─── FAMILIAR AUTORIZADO ────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'familiar';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'appointments.view_own',
    'prescriptions.view_own',
    'vitals.view'
) ON CONFLICT DO NOTHING;

-- ─── DERIVANTE EXTERNO ──────────────────────────────────────
SELECT id INTO v_role_id FROM roles WHERE code = 'derivante';
INSERT INTO role_permissions (role_id, permission_id)
SELECT v_role_id, id FROM permissions WHERE code IN (
    'patients.view_own',
    'records.view_own',
    'prescriptions.view_own'
) ON CONFLICT DO NOTHING;

RAISE NOTICE '✅ Permisos asignados a todos los roles';
END $$;

-- ═══════════════════════════════════════════════════════════
-- 8. MIGRAR organization_doctors EXISTENTES
-- ═══════════════════════════════════════════════════════════

-- Mapear el viejo org_role al nuevo role_id
UPDATE organization_doctors od
SET role_id = r.id
FROM roles r
WHERE od.role_id IS NULL
  AND (
    (od.role = 'owner'     AND od.is_owner = true AND r.code = 'propietario') OR
    (od.role = 'admin'     AND r.code = 'administrador') OR
    (od.role = 'doctor'    AND r.code = 'medico') OR
    (od.role = 'secretary' AND r.code = 'secretaria')
  );

-- Copiar registros existentes a organization_members para tener ambos
INSERT INTO organization_members (organization_id, doctor_id, role_id, legacy_role, is_owner, consultation_fee, slot_duration_minutes, room_number, is_active, joined_at, left_at)
SELECT od.organization_id, od.doctor_id, od.role_id, od.role, od.is_owner, od.consultation_fee, od.slot_duration_minutes, od.room_number, od.is_active, od.joined_at, od.left_at
FROM organization_doctors od
WHERE od.role_id IS NOT NULL
ON CONFLICT (organization_id, doctor_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- 9. VISTA: Miembros con rol expandido
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_org_members AS
SELECT
    om.id AS member_id,
    om.organization_id,
    om.doctor_id,
    om.staff_id,
    om.is_owner,
    om.is_active,
    om.department,
    om.room_number,
    om.consultation_fee,
    om.joined_at,
    r.id AS role_id,
    r.code AS role_code,
    r.name AS role_name,
    r.level AS role_level,
    r.category AS role_category,
    r.is_clinical,
    r.icon AS role_icon,
    r.color AS role_color,
    COALESCE(d.first_name, s.first_name) AS first_name,
    COALESCE(d.last_name, s.last_name) AS last_name,
    COALESCE(d.first_name || ' ' || d.last_name, s.first_name || ' ' || s.last_name) AS full_name,
    COALESCE(d.email, s.email) AS email,
    COALESCE(d.phone, s.phone) AS phone,
    COALESCE(d.avatar_url, s.avatar_url) AS avatar_url,
    d.medical_license,
    d.specialty,
    o.name AS org_name,
    o.type AS org_type
FROM organization_members om
JOIN roles r ON r.id = om.role_id
LEFT JOIN doctors d ON d.id = om.doctor_id
LEFT JOIN staff s ON s.id = om.staff_id
JOIN organizations o ON o.id = om.organization_id;

RAISE NOTICE '═══════════════════════════════════════';
RAISE NOTICE '✅ Migración 006 completa:';
RAISE NOTICE '   • Tabla roles: 21 roles creados';
RAISE NOTICE '   • Tabla permissions: 47 permisos';
RAISE NOTICE '   • Tabla staff: para usuarios no-médicos';
RAISE NOTICE '   • Tabla organization_members: unificada';
RAISE NOTICE '   • Vista v_org_members: consulta expandida';
RAISE NOTICE '   • Datos migrados de organization_doctors';
RAISE NOTICE '═══════════════════════════════════════';
