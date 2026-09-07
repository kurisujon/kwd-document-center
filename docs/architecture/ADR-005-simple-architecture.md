# Architecture Decision Record: Simple Architecture

## Status
Accepted

## Context
Software projects can easily become bloated with unnecessary enterprise patterns, leading to high maintenance costs and operational complexity that a local water district cannot support.

## Decision
The project will intentionally avoid complex architectures. We will **not** use:
- Microservices
- Kubernetes / Docker Swarm
- Redis / Caching layers (unless strictly necessary for API rate limits)
- Message queues (Kafka, RabbitMQ)
- Dedicated search engines (Elasticsearch)
- Overly complex event-driven patterns

## Consequences
- **Positive:** High maintainability. Low operational cost. Easy for a single developer or small agency to hand over and maintain. Fast development speed.
- **Negative:** May require refactoring if KWD scales to millions of documents, which is highly unlikely for this specific use case.
