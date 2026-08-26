# MediClick API — Módulo de Suscripciones

## Modelo de negocio

| Plan | Precio | Límites |
|------|--------|---------|
| **Free** | $0 | 1 organización, 50 turnos/mes, sin features avanzadas |
| **Pro** | $2.99 USD/mes | Ilimitado en todo, acceso a turno express, conflictos cross-org, lista de espera, smart overbooking |

## Endpoints

### Estado de suscripción

```
GET /api/v1/subscriptions/me
Authorization: Bearer {token}
```

**Response 200:**
```json
{
  "plan": "pro",
  "status": "active",
  "isPro": true,
  "subscriptionId": "uuid",
  "store": "apple",
  "currentPeriodStart": "2026-08-01T00:00:00Z",
  "currentPeriodEnd": "2026-09-01T00:00:00Z",
  "cancelledAt": null,
  "isTrial": false,
  "limits": {
    "maxAppointmentsPerMonth": -1,
    "maxOrganizations": -1
  },
  "usage": {
    "appointmentsThisMonth": 23,
    "organizationsCount": 3
  }
}
```

### Verificar recibo (compra/renovación)

```
POST /api/v1/subscriptions/verify
Authorization: Bearer {token}
Content-Type: application/json

{
  "store": "apple",
  "receipt": "base64-encoded-receipt-data",
  "productId": "com.mediclick.pro.monthly",
  "transactionId": "optional-transaction-id"
}
```

**Response 200:** mismo formato que GET /me con plan actualizado.

### Restaurar compras

```
POST /api/v1/subscriptions/restore
Authorization: Bearer {token}
Content-Type: application/json

{
  "store": "apple",
  "receipt": "base64-encoded-receipt-data",
  "productId": "com.mediclick.pro.monthly"
}
```

### Verificar acceso a feature

```
GET /api/v1/subscriptions/check/{feature}
Authorization: Bearer {token}
```

Features disponibles: `multi_org`, `express_appointment`, `conflict_detection`, `waitlist`, `smart_overbooking`, `unlimited_appointments`

**Response 200 (permitido):**
```json
{
  "allowed": true
}
```

**Response 200 (bloqueado):**
```json
{
  "allowed": false,
  "reason": "Turno express requiere el plan Pro ($2.99 USD/mes)."
}
```

### Webhooks (sin autenticación)

#### Apple App Store Server Notifications V2

```
POST /api/v1/subscriptions/webhooks/apple
```

Configurar en App Store Connect → App → App Store Server Notifications → URL de notificación.

#### Google Real-time Developer Notifications

```
POST /api/v1/subscriptions/webhooks/google
```

Configurar en Google Play Console → Monetización → Notificaciones en tiempo real → URL del endpoint Pub/Sub.

### Admin (requiere `is_platform_admin = true`)

#### Métricas

```
GET /api/v1/subscriptions/admin/metrics
Authorization: Bearer {admin-token}
```

#### Dar Pro manualmente

```
POST /api/v1/subscriptions/admin/grant
Authorization: Bearer {admin-token}
Content-Type: application/json

{
  "doctorId": "uuid",
  "months": 3,
  "reason": "Beta tester"
}
```

## Feature Gating (para otros módulos)

### Decorador `@RequiresPro()`

Agregar a cualquier endpoint que requiera plan Pro:

```typescript
import { RequiresPro } from '../../common/guards/pro.guard';

@RequiresPro('express_appointment')
@Post('express')
async createExpressAppointment() { ... }
```

Si el doctor es Free, el guard responde automáticamente:

```json
{
  "statusCode": 403,
  "error": "PLAN_UPGRADE_REQUIRED",
  "message": "Turno express requiere el plan Pro ($2.99 USD/mes).",
  "feature": "express_appointment",
  "currentPlan": "free",
  "upgradeUrl": "mediclick://upgrade"
}
```

La app debe interceptar `PLAN_UPGRADE_REQUIRED` y mostrar el paywall.

## Variables de entorno necesarias

```env
# Apple App Store
APPLE_SHARED_SECRET=tu-shared-secret-de-app-store-connect

# Google Play
GOOGLE_PACKAGE_NAME=com.mediclick.app
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
```

## Diagrama de flujo

```
┌─────────┐     ┌──────────┐     ┌──────────────┐
│  App     │────>│  Backend  │────>│ Apple/Google  │
│ (iOS/    │  1. verify     │  2. Validate   │  Servers      │
│ Android) │<────│  receipt  │<────│              │
│          │  4. Plan info  │  3. OK/Error   │              │
└─────────┘     └──────────┘     └──────────────┘
                     │
                     │ 5. Store in DB
                     ▼
               ┌──────────┐
               │ PostgreSQL│
               │ subscrip- │
               │ tions     │
               └──────────┘

Webhooks (async):
┌──────────────┐     ┌──────────┐     ┌──────────┐
│ Apple/Google  │────>│  Backend  │────>│ Update   │
│ Server       │     │ /webhooks │     │ status   │
│ Notifications│     │ /apple    │     │ in DB    │
└──────────────┘     └──────────┘     └──────────┘
```

## Login response (actualizado)

El endpoint `POST /api/v1/auth/login` ahora incluye info de suscripción:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "doctor": { ... },
  "organizations": [ ... ],
  "subscription": {
    "plan": "free",
    "is_pro": false,
    "max_appointments_per_month": 50,
    "max_organizations": 1
  }
}
```
