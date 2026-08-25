# MediClick — API REST Endpoints

## Stack técnico (100% gratuito)

| Componente | Tecnología | Costo |
|------------|-----------|-------|
| Backend API | NestJS (Node.js) | Gratis |
| Base de datos | PostgreSQL 16 | Gratis |
| Cache/Sesiones | Redis 7 | Gratis |
| Reverse Proxy + SSL | Traefik + Let's Encrypt | Gratis |
| DB local iOS | SwiftData (SQLite) | Gratis |
| DB local Android | Room (SQLite) | Gratis |
| Contenedores | Docker + Docker Compose | Gratis |
| Server | VPS (único costo ~$5-10/mes) | — |

## Arquitectura offline-first

```
┌──────────────────────────────────────────────────┐
│                    MOBILE APP                     │
│                                                   │
│  ┌─────────────┐     ┌──────────────────────┐    │
│  │  SwiftData   │     │   Sync Engine        │    │
│  │  (iOS)       │◄───►│                      │    │
│  │  Room        │     │  • Sube pendientes   │    │
│  │  (Android)   │     │  • Baja cambios      │    │
│  └─────────────┘     │  • Resuelve conflictos│    │
│        ▲              └──────────┬───────────┘    │
│        │                         │                │
│   Lee/Escribe                    │ REST API       │
│   instantáneo                    │ (cuando hay    │
│   (offline OK)                   │  conexión)     │
└──────────────────────────────────┼────────────────┘
                                   │
                          HTTPS (Let's Encrypt)
                                   │
                    ┌──────────────┼───────────────┐
                    │          SERVIDOR VPS         │
                    │                               │
                    │  ┌─────────┐  ┌───────────┐  │
                    │  │ Traefik │  │ NestJS    │  │
                    │  │ (proxy) │─►│ API REST  │  │
                    │  └─────────┘  └─────┬─────┘  │
                    │                     │         │
                    │            ┌────────┼───────┐ │
                    │            │        │       │ │
                    │       ┌────▼──┐ ┌───▼───┐   │ │
                    │       │ Redis │ │ PgSQL │   │ │
                    │       │ cache │ │  DB   │   │ │
                    │       └───────┘ └───────┘   │ │
                    └──────────────────────────────┘
```

## Flujo de datos

1. **Doctor abre la app** → Lee datos de SQLite local (instantáneo)
2. **Hay conexión?** → SyncEngine sube cambios pendientes al server
3. **Server responde** → SyncEngine actualiza SQLite local
4. **Sin conexión?** → Todo funciona offline, se marca `pendingUpload`
5. **Vuelve la conexión** → Sync automático en background

## Endpoints REST API

Base URL: `https://api.tudominio.com/api/v1`

---

### Auth (`/auth`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/auth/register` | Registro de doctor |
| POST | `/auth/login` | Login → tokens JWT |
| POST | `/auth/refresh` | Renovar access token |
| POST | `/auth/logout` | Invalidar refresh token |
| POST | `/auth/change-password` | Cambiar contraseña |
| POST | `/auth/forgot-password` | Solicitar reset (email) |
| POST | `/auth/reset-password` | Confirmar reset |

---

### Pacientes (`/patients`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/patients` | Listar pacientes del doctor |
| GET | `/patients?updated_since=ISO` | Pacientes modificados desde fecha (sync) |
| GET | `/patients/:id` | Detalle de paciente |
| POST | `/patients` | Crear paciente |
| PUT | `/patients/:id` | Actualizar paciente |
| DELETE | `/patients/:id` | Desactivar paciente (soft delete) |
| GET | `/patients/search?q=texto` | Buscar por nombre/DNI |
| GET | `/patients/:id/history` | Historia clínica completa |

---

### Turnos (`/appointments`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/appointments?date=YYYY-MM-DD` | Agenda del día |
| GET | `/appointments?updated_since=ISO` | Turnos modificados (sync) |
| GET | `/appointments?from=&to=` | Rango de fechas |
| GET | `/appointments/:id` | Detalle de turno |
| POST | `/appointments` | Crear turno |
| PUT | `/appointments/:id` | Actualizar turno |
| PATCH | `/appointments/:id/status` | Cambiar estado |
| DELETE | `/appointments/:id` | Cancelar turno |
| GET | `/appointments/available-slots?date=` | Horarios disponibles |

---

### Horarios del doctor (`/schedules`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/schedules` | Obtener horarios configurados |
| PUT | `/schedules` | Configurar horarios semanales |
| POST | `/schedules/exceptions` | Agregar excepción (feriado, etc.) |
| DELETE | `/schedules/exceptions/:id` | Eliminar excepción |

---

### Historia Clínica (`/medical-records`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/medical-records?patient_id=UUID` | Registros del paciente |
| GET | `/medical-records/:id` | Detalle de registro |
| POST | `/medical-records` | Crear registro clínico |
| PUT | `/medical-records/:id` | Actualizar registro |

---

### Recetas (`/prescriptions`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/prescriptions` | Recetas del doctor |
| GET | `/prescriptions?updated_since=ISO` | Recetas modificadas (sync) |
| GET | `/prescriptions?patient_id=UUID` | Recetas de un paciente |
| GET | `/prescriptions/:id` | Detalle con medicamentos |
| POST | `/prescriptions` | Crear receta + items |
| PUT | `/prescriptions/:id` | Actualizar receta |
| PATCH | `/prescriptions/:id/cancel` | Cancelar receta |
| GET | `/prescriptions/verify/:code` | Verificar receta (público) |

---

### Chat (`/conversations` + `/messages`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/conversations` | Listar conversaciones |
| GET | `/conversations/:id/messages?since=ISO` | Mensajes (sync) |
| POST | `/conversations` | Iniciar conversación |
| POST | `/messages` | Enviar mensaje |
| PATCH | `/messages/read` | Marcar como leídos |
| GET | `/messages?since=ISO` | Todos los mensajes nuevos (sync) |

---

### Notificaciones (`/notifications`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/notifications` | Listar notificaciones |
| PATCH | `/notifications/:id/read` | Marcar como leída |
| PATCH | `/notifications/read-all` | Marcar todas como leídas |
| POST | `/push-tokens` | Registrar token de push |
| DELETE | `/push-tokens/:token` | Eliminar token |

---

### Perfil (`/profile`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/profile` | Obtener perfil del doctor |
| PUT | `/profile` | Actualizar perfil |
| POST | `/profile/avatar` | Subir foto de perfil |

---

### Health Check

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/health` | Estado del servidor |

---

## Seguridad

- **JWT** con access token (30min) + refresh token (7 días)
- **bcrypt** para passwords (cost factor 12)
- **HTTPS** obligatorio via Traefik + Let's Encrypt
- **Helmet** para headers de seguridad
- **Rate limiting** para prevenir abuso
- **Datos médicos cifrados** en tránsito (TLS) y en reposo (pgcrypto)
- **Keychain** (iOS) / **EncryptedSharedPreferences** (Android) para tokens locales
- **Audit log** de todas las acciones sobre datos de pacientes

## Comandos de despliegue

```bash
# 1. Clonar y configurar
git clone <repo> mediclick
cd mediclick
cp .env.example .env
# Editar .env con tus valores

# 2. Levantar todo
docker compose up -d

# 3. Verificar
curl https://tu-dominio.com/api/v1/health

# 4. Logs
docker compose logs -f api
```
