import { Counter, Gauge, Histogram } from "prom-client";


// Custom Metrics
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

const productsCreatedTotal = new Counter({
  name: 'products_created_total',
  help: 'Total products created',
  labelNames: ['category']
});

const productsViewedTotal = new Counter({
  name: 'products_viewed_total',
  help: 'Total product views'
});

const productsPurchasedTotal = new Counter({
  name: 'products_purchased_total',
  help: 'Total products purchased',
  labelNames: ['category']
});

const stockUpdatesTotal = new Counter({
  name: 'stock_updates_total',
  help: 'Total stock updates'
});

const databaseConnectionsActive = new Gauge({
  name: 'database_connections_active',
  help: 'Active database connections'
});

export {
  httpRequestsTotal,
  httpRequestDuration,
  databaseQueryDuration,
  productsCreatedTotal,
  productsViewedTotal,
  productsPurchasedTotal,
  stockUpdatesTotal,
  databaseConnectionsActive
};