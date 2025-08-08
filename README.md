# NotifyAI

A production-ready AI-driven notification platform built with Node.js and TypeScript. Features intelligent message scoring using OpenAI, multi-channel delivery (Slack, Email, Webhook), Redis-based job queuing, rate limiting, and comprehensive analytics.

---

## Architecture

```mermaid
graph TD
    %% Client Layer
    subgraph "Client Layer"
        A1["API Clients"] -->|"HTTP/HTTPS"| A2["REST API<br>(Express.js)"]
        A2 -->|"Authentication"| A3["Rate Limiting<br>(Redis)"]
        A2 -->|"Validation"| A4["Request Validation<br>(Express-validator)"]
    end

    %% API Layer
    subgraph "API Layer (Express.js)"
        B1["Notification Routes<br>(POST /notify)"]
        B2["Metrics Routes<br>(GET /usage)"]
        B3["Health Routes<br>(GET /health)"]
        B4["Authentication<br>Middleware"]
    end

    %% Core Services
    subgraph "Core Services"
        C1["AI Scoring<br>(OpenAI)"]
        C2["Rate Limiting<br>(Redis)"]
        C3["Retry Logic<br>(Exponential Backoff)"]
        C4["Queue Management<br>(BullMQ)"]
    end

    %% Queue Layer
    subgraph "Queue Layer (Redis + BullMQ)"
        D1["Job Queue<br>(Priority-based)"]
        D2["Worker Process<br>(Concurrent)"]
        D3["Job Scheduler<br>(Delayed Jobs)"]
    end

    %% Delivery Services
    subgraph "Delivery Services"
        E1["Slack Service<br>(chat.postMessage)"]
        E2["Email Service<br>(SendGrid)"]
        E3["Webhook Service<br>(HTTP POST)"]
    end

    %% Data Layer
    subgraph "Data Layer"
        F1["Redis<br>(Queue & Cache)"]
        F2["Usage Analytics<br>(Redis)"]
        F3["Rate Limit Data<br>(Redis)"]
    end

    %% Cross-layer connections
    A2 -->|"API Requests"| B1
    B1 -->|"Score Message"| C1
    B1 -->|"Check Limits"| C2
    B1 -->|"Add to Queue"| C4
    C4 -->|"Process Jobs"| D1
    D2 -->|"Deliver Message"| E1
    D2 -->|"Deliver Message"| E2
    D2 -->|"Deliver Message"| E3
    C2 -->|"Store Limits"| F3
    B2 -->|"Get Analytics"| F2
    C4 -->|"Queue Jobs"| F1
```

---

## System Overview

AI Notifier implements a modern microservices architecture with intelligent message processing and reliable delivery across multiple channels:

### **Client Layer**

- **REST API**: Clean HTTP endpoints for notification submission and analytics
- **Rate Limiting**: Per-user sliding window rate limiting (100 requests/hour)
- **Authentication**: User-based API access with configurable authentication
- **Validation**: Comprehensive input validation with detailed error messages

### **API Layer**

- **Notification Routes**: Handle message submission with AI scoring
- **Metrics Routes**: Provide usage statistics and analytics
- **Health Routes**: Kubernetes-ready health checks and monitoring
- **Middleware**: CORS, Helmet security, request logging

### **Core Services**

- **AI Scoring**: OpenAI integration for intelligent message prioritization (0-100 score)
- **Rate Limiting**: Redis-based sliding window algorithm
- **Retry Logic**: Exponential backoff with service-specific retry conditions
- **Queue Management**: BullMQ with priority-based job scheduling

### **Queue Layer**

- **Job Queue**: Redis-backed queue with priority and delay support
- **Worker Process**: Concurrent job processing with configurable concurrency
- **Job Scheduler**: Delayed job execution based on AI score priority

### **Delivery Services**

- **Slack Service**: Rich message formatting with attachments and priority colors
- **Email Service**: SendGrid integration with HTML templates and metadata
- **Webhook Service**: Secure HTTP delivery with validation and retry logic

### **Data Layer**

- **Redis**: Primary storage for queues, caching, and analytics
- **Usage Analytics**: Real-time statistics and delivery metrics
- **Rate Limit Data**: Per-user request tracking and limits

The system supports three delivery channels:

1. **Slack**: Direct message posting with rich formatting and priority indicators
2. **Email**: SendGrid-powered email delivery with HTML templates
3. **Webhook**: HTTP POST delivery to external endpoints

---

## Data Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant S as AI Scorer
    participant Q as Queue
    participant W as Worker
    participant D as Delivery Service
    participant R as Redis

    %% Notification Submission
    C->>A: POST /api/v1/notify
    A->>R: Check rate limit
    R-->>A: Rate limit status
    A->>S: Score message with AI
    S->>S: OpenAI API call
    S-->>A: Score & priority
    A->>Q: Add job to queue
    Q->>R: Store job data
    A-->>C: Job ID & score

    %% Job Processing
    Q->>W: Process job
    W->>W: Determine delivery service
    W->>D: Send notification
    D->>D: Retry on failure
    D-->>W: Delivery result
    W->>R: Update analytics
    W-->>Q: Job completed

    %% Analytics
    C->>A: GET /api/v1/usage
    A->>R: Get user metrics
    R-->>A: Usage statistics
    A-->>C: Analytics data
```

---

## Features

### **AI-Driven Intelligence**

- **OpenAI Integration**: Intelligent message scoring (0-100) based on content and context
- **Priority Classification**: Automatic categorization (low/medium/high/critical)
- **Smart Scheduling**: Priority-based job delays and processing order
- **Context Awareness**: Metadata and channel-specific scoring

### **Multi-Channel Delivery**

- **Slack Integration**: Rich message formatting with attachments and priority colors
- **Email Service**: SendGrid-powered delivery with HTML templates
- **Webhook Support**: HTTP POST delivery to external endpoints
- **Channel-Specific Retry**: Service-specific retry conditions and error handling

### **Reliability & Performance**

- **Redis Queue**: BullMQ-based job queuing with persistence
- **Exponential Backoff**: Configurable retry logic with service-specific conditions
- **Rate Limiting**: Per-user sliding window rate limiting
- **Graceful Shutdown**: Proper cleanup and job preservation

### **Production Features**

- **Docker Support**: Multi-stage builds with health checks
- **Kubernetes Ready**: Liveness and readiness probes
- **Comprehensive Logging**: Structured JSON logging with Winston
- **Monitoring**: Health checks, metrics, and analytics endpoints
- **Security**: Helmet security headers, CORS, input validation

### **Developer Experience**

- **TypeScript**: Full type safety and modern development
- **Clean Architecture**: Modular design with clear separation of concerns
- **Testing**: Jest setup with unit test examples
- **Documentation**: Comprehensive API documentation and examples
