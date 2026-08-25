# MediClick API v2 — Multi-consultorio

## Modelo de datos clave

```
┌─────────────────────────────────────────────────────────────┐
│  Un DOCTOR tiene cuenta personal única (email + matrícula)  │
│  Puede pertenecer a N organizaciones con roles distintos    │
│                                                             │
│  Dr. García ─┬── Centro Médico Norte (owner)                │
│              ├── Clínica San Martín (doctor)                 │
│              └── Consultorio propio (individual/owner)       │
│                                                             │
│  Los PACIENTES pertenecen a una organización                │
│  Los TURNOS se crean dentro de una org + doctor             │
│  La HISTORIA CLÍNICA viaja con el paciente dentro de la org │
└─────────────────────────────────────────────────────────────┘
```

## Headers requeridos

Todas las requests autenticadas llevan:

```
Authorization: Bearer <access_token>
X-Organization-Id: <uuid>          ← contexto del consultorio activo
```

El header `X-Organization-Id` determina en qué consultorio opera el doctor.
El backend valida que el doctor pertenezca a esa organización.

---

## Auth (`/api/v1/auth`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/auth/register` | Registro doctor + crea org "individual" automática |
| POST | `/auth/login` | Login → tokens + lista de organizaciones |
| POST | `/auth/refresh` | Renovar access token |
| POST | `/auth/logout` | Invalidar refresh token |
| POST | `/auth/change-password` | Cambiar contraseña |

### POST `/auth/register`

```json
{
  "email": "garcia@mail.com",
  "password": "...",
  "firstName": "Juan",
  "lastName": "García",
  "medicalLicense": "MN 12345",
  "medicalLicenseProvince": "Buenos Aires",
  "specialty": "Clínica médica"
}
```

Response: crea el doctor + una organización tipo `individual` automáticamente.

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "doctor": { "id": "...", "email": "..." },
  "organizations": [
    {
      "orgId": "...",
      "orgDoctorId": "...",
      "name": "Dr. Juan García",
      "type": "individual",
      "role": "owner"
    }
  ]
}
```

### POST `/auth/login`

Response incluye todas las organizaciones del doctor:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "doctor": { ... },
  "organizations": [
    { "orgId": "...", "name": "Centro Médico Norte", "type": "centro_medico", "role": "doctor" },
    { "orgId": "...", "name": "Dr. García", "type": "individual", "role": "owner" }
  ]
}
```

---

## Organizaciones (`/api/v1/organizations`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/organizations` | Mis organizaciones |
| POST | `/organizations` | Crear consultorio / centro médico |
| GET | `/organizations/:id` | Detalle de organización |
| PUT | `/organizations/:id` | Actualizar datos |
| GET | `/organizations/:id/doctors` | Doctores del consultorio |
| GET | `/organizations/:id/stats` | Estadísticas |

### POST `/organizations`

```json
{
  "name": "Centro Médico Norte",
  "type": "centro_medico",
  "cuit": "30-12345678-9",
  "phone": "011-4555-1234",
  "address": "Av. Corrientes 1234, CABA",
  "city": "Buenos Aires",
  "province": "Buenos Aires",
  "defaultSlotDuration": 20
}
```

El doctor que crea la org queda como `owner` automáticamente.

---

## Invitaciones (`/api/v1/invitations`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/invitations` | Invitar doctor al consultorio |
| GET | `/invitations` | Invitaciones pendientes (de mi org) |
| GET | `/invitations/received` | Invitaciones que recibí |
| POST | `/invitations/:id/accept` | Aceptar invitación |
| POST | `/invitations/:id/reject` | Rechazar invitación |
| DELETE | `/invitations/:id` | Cancelar invitación |

### POST `/invitations`

Solo `owner` o `admin` pueden invitar.

```json
{
  "email": "dra.lopez@mail.com",
  "role": "doctor"
}
```

---

## Secretarias (`/api/v1/secretaries`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/secretaries` | Crear secretaria |
| GET | `/secretaries` | Listar secretarias de la org |
| PUT | `/secretaries/:id` | Actualizar datos/permisos |
| DELETE | `/secretaries/:id` | Desactivar |

---

## Pacientes (`/api/v1/patients`)

Todos los endpoints filtran por `X-Organization-Id`.

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/patients` | Pacientes de MI org |
| GET | `/patients?updated_since=ISO` | Sync incremental |
| GET | `/patients/:id` | Detalle |
| POST | `/patients` | Crear paciente en esta org |
| PUT | `/patients/:id` | Actualizar |
| DELETE | `/patients/:id` | Soft delete |
| GET | `/patients/search?q=texto` | Buscar por nombre/DNI |
| GET | `/patients/:id/history` | Historia clínica completa |
| GET | `/patients/:id/timeline` | Línea de tiempo (turnos + consultas + recetas) |

---

## Turnos (`/api/v1/appointments`)

Vinculados a `org_doctor_id` (el vínculo doctor ↔ organización).

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/appointments?date=YYYY-MM-DD` | Agenda del día en esta org |
| GET | `/appointments?doctor_id=UUID&date=YYYY-MM-DD` | Agenda de un doctor específico |
| GET | `/appointments?from=&to=` | Rango de fechas |
| GET | `/appointments?updated_since=ISO` | Sync |
| POST | `/appointments` | Crear turno |
| PUT | `/appointments/:id` | Actualizar |
| PATCH | `/appointments/:id/status` | Cambiar estado |
| DELETE | `/appointments/:id` | Cancelar |
| GET | `/appointments/available-slots?doctor_id=&date=` | Horarios disponibles |

### POST `/appointments`

```json
{
  "patientId": "...",
  "doctorId": "...",
  "date": "2026-08-28",
  "startTime": "09:30",
  "endTime": "10:00",
  "reason": "Control mensual",
  "isFirstVisit": false
}
```

El backend resuelve `org_doctor_id` a partir de `doctorId` + `X-Organization-Id`.

---

## Horarios (`/api/v1/schedules`)

Horarios por doctor POR organización.

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/schedules?doctor_id=UUID` | Horarios de un doctor en esta org |
| PUT | `/schedules` | Configurar horarios semanales |
| POST | `/schedules/exceptions` | Agregar excepción |
| DELETE | `/schedules/exceptions/:id` | Eliminar excepción |

---

## Historia clínica (`/api/v1/medical-records`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/medical-records?patient_id=UUID` | Registros del paciente |
| POST | `/medical-records` | Crear registro |
| PUT | `/medical-records/:id` | Actualizar |

---

## Recetas (`/api/v1/prescriptions`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/prescriptions` | Recetas del doctor en esta org |
| GET | `/prescriptions?patient_id=UUID` | Recetas de un paciente |
| POST | `/prescriptions` | Crear receta + items |
| PATCH | `/prescriptions/:id/cancel` | Cancelar |
| GET | `/prescriptions/verify/:code` | Verificar (público, sin auth) |

---

## Chat (`/api/v1/conversations` + `/messages`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/conversations` | Conversaciones en esta org |
| POST | `/conversations` | Iniciar chat con paciente |
| GET | `/conversations/:id/messages` | Mensajes |
| POST | `/messages` | Enviar mensaje |
| PATCH | `/messages/read` | Marcar como leídos |

---

## Perfil (`/api/v1/profile`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/profile` | Mi perfil |
| PUT | `/profile` | Actualizar |
| POST | `/profile/avatar` | Subir foto |

---

## Selector de organización (flujo mobile)

Al hacer login, el doctor recibe su lista de organizaciones.
La app muestra un selector y guarda la org activa.

```
1. Login → recibe [{orgId, name, type, role}, ...]
2. Doctor elige "Centro Médico Norte"
3. App guarda org_id activa en SQLite local
4. Todas las requests llevan X-Organization-Id: <org_id>
5. Doctor puede cambiar de org desde el menú
```

Si el doctor tiene UNA sola organización, se auto-selecciona.
