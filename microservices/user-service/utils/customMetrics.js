import { Counter, Gauge, Histogram } from "prom-client";

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'endpoint', 'status']
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'endpoint', 'status'],
  buckets: [0.1, 0.3, 0.5, 1, 2, 5]
});

const databaseQueryDuration = new Histogram({
  name: 'database_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation', 'collection'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1]
});

const userRegistrationsTotal = new Counter({
  name: 'user_registrations_total',
  help: 'Total user registrations'
});

const userLoginsTotal = new Counter({
  name: 'user_logins_total',
  help: 'Total user logins'
});

const userLoginsFailedTotal = new Counter({
  name: 'user_logins_failed_total',
  help: 'Total failed user logins'
});

const databaseConnectionsActive = new Gauge({
  name: 'database_connections_active',
  help: 'Active database connections'
});

const databaseConnectionsTotal = new Gauge({
  name: 'database_connections_total',
  help: 'Total database connections'
});

const databaseCollectionsTotal = new Gauge({
  name: 'database_collections_total',
  help: 'Total collections in database'
});

const cacheHitsTotal = new Counter({
  name: 'cache_hits_total',
  help: 'Total cache hits'
});

const cacheMissesTotal = new Counter({
  name: 'cache_misses_total',
  help: 'Total cache misses'
});


export {
    httpRequestsTotal,
    httpRequestDuration,
    databaseQueryDuration,
    userRegistrationsTotal,
    userLoginsTotal,
    userLoginsFailedTotal,
    databaseConnectionsActive,
    databaseConnectionsTotal,
    databaseCollectionsTotal,
    cacheHitsTotal,
    cacheMissesTotal
}