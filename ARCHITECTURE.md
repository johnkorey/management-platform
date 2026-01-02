# 🏛️ Platform Architecture - Detailed Design

## System Components

### 1. **Management Platform** (New - Just Built)
Location: `management-platform/`

**Purpose**: Central SaaS platform for managing subscriptions and Evilginx instances

**Components**:
- PostgreSQL Database (centralized data)
- Backend API Server (Node.js/Express)
- Frontend Dashboard (React/Vue - to be built)

---

### 2. **Evilginx Instances** (Existing - To Be Modified)
Location: `core/`, `main.go`

**Purpose**: Actual phishing operation (one or more per customer)

**Modifications Needed**:
- Add PostgreSQL connector
- Add license validation
- Add session sync
- Add heartbeat reporting

---

## Data Flow Diagrams

### User Registration & Instance Creation:

```
┌─────────┐
│ Customer│
└────┬────┘
     │ 1. Sign Up
     ▼
┌────────────────┐
│ Management API │
│ (Port 3000)    │
└────┬───────────┘
     │ 2. Create User Record
     ▼
┌──────────────────┐
│   PostgreSQL     │
│   - users table  │
│   - subscription │
└────┬─────────────┘
     │ 3. Auto-create Free Trial
     ▼
┌─────────────────────┐
│ Customer Dashboard  │
│ "Create Instance"   │
└────┬────────────────┘
     │ 4. POST /api/instances
     ▼
┌────────────────────────┐
│ Docker/Kubernetes      │
│ Provision Evilginx Pod │
└────┬───────────────────┘
     │ 5. Register in DB
     ▼
┌──────────────────┐
│ PostgreSQL       │
│ instances table  │
└──────────────────┘
```

---

### Session Capture & Sync:

```
┌────────┐
│ Victim │
└───┬────┘
    │ Enters Credentials
    ▼
┌─────────────────┐
│ Evilginx        │
│ Instance #1     │
│ (User A)        │
└───┬─────────────┘
    │
    │ 1. Capture (instant)
    ▼
┌──────────────────┐
│ Local BuntDB     │ ← Fast, no network latency
│ (Evilginx cache) │
└───┬──────────────┘
    │
    │ 2. Async Sync (1-2 sec delay)
    ▼
┌─────────────────────────────┐
│ Management Platform API     │
│ POST /api/sessions/sync     │
└───┬─────────────────────────┘
    │ 3. Store permanently
    ▼
┌──────────────────────────────┐
│ Central PostgreSQL           │
│ - sessions table             │
│ - usage_stats table (update) │
└───┬──────────────────────────┘
    │
    │ 4. Customer views
    ▼
┌─────────────────────────────┐
│ Customer Portal Dashboard   │
│ "All Sessions" page         │
│ (Shows data from ALL their  │
│  instances in one view)     │
└─────────────────────────────┘
```

---

### Subscription Upgrade Flow:

```
┌──────────┐
│ Customer │
└────┬─────┘
     │ 1. Click "Upgrade to Pro"
     ▼
┌──────────────────────┐
│ Frontend Dashboard   │
└────┬─────────────────┘
     │ 2. POST /api/billing/create-checkout
     ▼
┌──────────────────────┐
│ Backend API          │
│ - Create Stripe      │
│   checkout session   │
└────┬─────────────────┘
     │ 3. Redirect URL
     ▼
┌──────────────────────┐
│ Stripe Checkout Page │
│ (Hosted by Stripe)   │
└────┬─────────────────┘
     │ 4. Customer pays
     ▼
┌──────────────────────┐
│ Stripe              │
└────┬─────────────────┘
     │ 5. Webhook: payment_success
     ▼
┌──────────────────────┐
│ Backend Webhook      │
│ Handler              │
└────┬─────────────────┘
     │ 6. Update subscription
     ▼
┌──────────────────────┐
│ PostgreSQL          │
│ UPDATE subscriptions │
│ SET status='active', │
│     plan_id='pro'    │
└────┬─────────────────┘
     │ 7. Instant access
     ▼
┌──────────────────────┐
│ Customer Portal     │
│ (Pro features now   │
│  unlocked)          │
└─────────────────────┘
```

---

### Instance Heartbeat & Monitoring:

```
Every 30 seconds:

┌─────────────────┐
│ Evilginx        │
│ Instance #1     │
└───┬─────────────┘
    │ POST /api/instances/:id/heartbeat
    │ {
    │   apiKey: "...",
    │   resourceUsage: {cpu: 45, memory: 512},
    │   health: "healthy"
    │ }
    ▼
┌─────────────────────────────┐
│ Management Platform API     │
└───┬─────────────────────────┘
    │ UPDATE instances
    │ SET last_heartbeat = NOW(),
    │     resource_usage = {...},
    │     health_status = "healthy"
    ▼
┌──────────────────────────────┐
│ PostgreSQL                   │
│ instances table              │
└───┬──────────────────────────┘
    │
    │ Admin Dashboard polls every 5 sec
    ▼
┌─────────────────────────────┐
│ Admin Panel                  │
│ "Instance Monitoring"        │
│ - Shows real-time status     │
│ - Alerts if heartbeat missed │
│ - Resource usage graphs      │
└──────────────────────────────┘
```

---

## Database Relationships:

```
users (1) ──────→ (many) subscriptions
  │
  ├──────────────→ (many) instances
  │                   │
  │                   └──→ (many) sessions
  │
  ├──────────────→ (many) payments
  ├──────────────→ (many) usage_stats
  └──────────────→ (many) api_tokens

subscription_plans (1) ──→ (many) subscriptions
```

---

## API Request Flow Example:

### Creating an Instance:

```
1. Frontend sends request:
   POST http://localhost:3000/api/instances
   Headers: { Authorization: "Bearer jwt_token" }
   Body: {
     "instanceName": "My First Instance",
     "region": "us-east-1",
     "baseDomain": "phish.example.com"
   }

2. Backend middleware chain:
   - authenticate() → Verify JWT, load user
   - requireSubscription() → Check active subscription
   - Route handler → Check limits, create instance

3. Database operations:
   - Check: COUNT instances for user
   - Compare with subscription.max_instances
   - If OK: INSERT into instances table
   - Generate unique API key for instance

4. Response:
   {
     "success": true,
     "data": {
       "id": "uuid-here",
       "instanceName": "My First Instance",
       "apiKey": "abc123...",
       "status": "provisioning"
     }
   }

5. Background (in production):
   - Docker container launched
   - Evilginx configured with instance API key
   - Instance starts and sends first heartbeat
   - Status changes from "provisioning" to "running"
```

---

## Subscription Limit Enforcement:

### How Limits Work:

```javascript
// In instances.js route:
if (currentInstances >= subscription.max_instances) {
    return 403; // Forbidden
}

// In sessions.js sync:
if (monthlySessionsCount >= subscription.max_sessions_per_month) {
    return 403; // Quota exceeded
}
```

### What Each Plan Allows:

| Action | Free | Basic | Pro | Enterprise |
|--------|------|-------|-----|------------|
| Create Instance | ✅ (1) | ✅ (3) | ✅ (10) | ✅ (∞) |
| Capture Sessions/Month | 100 | 1,000 | 10,000 | ∞ |
| Use Telegram Alerts | ❌ | ✅ | ✅ | ✅ |
| API Access | ❌ | ❌ | ✅ | ✅ |
| Custom Phishlets | ❌ | ❌ | ✅ | ✅ |

---

## Security Model:

### Three Levels of Authentication:

1. **User Authentication** (JWT)
   - Customer logs into management platform
   - Gets JWT token
   - Token expires in 24h

2. **Instance Authentication** (API Key)
   - Each Evilginx instance has unique API key
   - Used for heartbeat & session sync
   - Stored in instances table

3. **API Token Authentication** (For developers)
   - Pro/Enterprise users can create API tokens
   - Used for programmatic access
   - Scoped permissions

---

## Scaling Strategy:

### For 100 Users:
- Single PostgreSQL instance
- 2-3 backend API servers (load balanced)
- Up to 100 Evilginx containers

### For 1,000 Users:
- PostgreSQL read replicas
- 10+ backend API servers
- Kubernetes cluster for Evilginx instances
- Redis cache layer

### For 10,000+ Users:
- PostgreSQL sharding by user_id
- Global CDN
- Multi-region deployment
- Dedicated Evilginx clusters per region

---

## 📊 Monitoring Dashboards:

### Admin Should See:
- **Revenue**: MRR, ARR, growth rate
- **Users**: Total, active, churned
- **Instances**: Total running, by region, health status
- **Sessions**: Total captured, by plan tier
- **System**: API response times, error rates, database performance

### Customer Should See:
- **Instances**: Status, uptime, resource usage
- **Sessions**: Total captured, by phishlet, timeline
- **Usage**: Current month vs. limit
- **Billing**: Next payment date, invoice history

---

## 🚨 Important Notes:

1. **Database Password**: Change in production!
2. **JWT Secret**: Generate secure random string
3. **Stripe Keys**: Use test keys for development
4. **HTTPS Only**: Use in production for security
5. **Backup Strategy**: Daily PostgreSQL backups
6. **Monitoring**: Set up alerts for instance failures

---

## 🎓 Learning Resources:

- PostgreSQL: https://www.postgresql.org/docs/
- Express.js: https://expressjs.com/
- JWT: https://jwt.io/introduction
- Stripe API: https://stripe.com/docs/api
- Docker: https://docs.docker.com/

---

**The platform foundation is ready for testing and expansion!** 🎉

