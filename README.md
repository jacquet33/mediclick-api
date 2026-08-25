# MediClick API

Backend REST API para la plataforma MediClick — gestión integral para médicos clínicos, consultorios y centros médicos.

## Stack técnico (100% gratuito)

- **Runtime:** Node.js 20 + NestJS
- **Base de datos:** PostgreSQL 16
- **Cache:** Redis 7
- **Proxy + SSL:** Traefik + Let's Encrypt
- **Contenedores:** Docker + Docker Compose

## Arquitectura

```
Consultorio A ──┐
                ├── API REST ── PostgreSQL
Consultorio B ──┘       │
                       Redis
```

- **Multi-consultorio:** Un doctor puede pertenecer a N organizaciones
- **Detección de conflictos cross-org:** Si el doctor tiene turno en el Centro A, no se puede agendar en el Centro B a la misma hora
- **Offline-first:** Las apps móviles sincronizan via REST cuando hay conexión

## Módulos

| Módulo | Descripción |
|--------|-------------|
| `auth` | JWT + refresh tokens + registro con matrícula |
| `organizations` | Consultorios, centros médicos, invitaciones |
| `patients` | Fichas de pacientes por organización |
| `appointments` | Turnos con validación cross-consultorio |
| `prescriptions` | Recetas digitales con firma y código verificable |
| `chat` | Mensajería médico-paciente |
| `notifications` | Push notifications (iOS/Android) |

## Quickstart

```bash
# 1. Clonar
git clone https://github.com/TU_USUARIO/mediclick-api.git
cd mediclick-api

# 2. Configurar
cp .env.example .env
# Editar .env con tus valores (ver comentarios en el archivo)

# 3. Levantar
docker compose up -d

# 4. Verificar
curl http://localhost:3000/api/v1/health
```

## Endpoints

Ver documentación completa en [`docs/API_ENDPOINTS_v2.md`](docs/API_ENDPOINTS_v2.md)

## Base de datos

El schema se inicializa automáticamente al levantar PostgreSQL. Ver [`src/database/migrations/init.sql`](src/database/migrations/init.sql)

## Repos relacionados

- [mediclick-ios](https://github.com/TU_USUARIO/mediclick-ios) — App iOS nativa (Swift/SwiftUI)
- [mediclick-android](https://github.com/TU_USUARIO/mediclick-android) — App Android nativa (Kotlin/Compose)

## Licencia

Privado — Todos los derechos reservados.
