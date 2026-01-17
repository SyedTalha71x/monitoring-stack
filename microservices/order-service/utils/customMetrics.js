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
  buckets: [0.1, 0.3, 0.5, 1, 2, 5, 10]
});

const databaseQueryDuration = new Histogram({
  name: 'database_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation', 'collection'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1]
});

const ordersCreatedTotal = new Counter({
  name: 'orders_created_total',
  help: 'Total orders created',
  labelNames: ['status']
});

const ordersCompletedTotal = new Counter({
  name: 'orders_completed_total',
  help: 'Total orders completed'
});

const ordersFailedTotal = new Counter({
  name: 'orders_failed_total',
  help: 'Total orders failed'
});

const revenueTotal = new Counter({
  name: 'revenue_total',
  help: 'Total revenue generated',
  labelNames: ['currency']
});

const externalApiLatency = new Histogram({
  name: 'external_api_latency_seconds',
  help: 'External API call latency',
  labelNames: ['service', 'endpoint'],
  buckets: [0.1, 0.5, 1, 2, 5]
});

const orderProcessingTime = new Histogram({
  name: 'order_processing_time_seconds',
  help: 'Order processing time in seconds',
  labelNames: ['type'],
  buckets: [0.1, 1, 5, 10, 30, 60]
});

const pendingOrders = new Gauge({
  name: 'pending_orders',
  help: 'Number of pending orders'
});

const databaseConnectionsActive = new Gauge({
  name: 'database_connections_active',
  help: 'Active database connections'
});
export {
  httpRequestsTotal,
  httpRequestDuration,
  databaseQueryDuration,
  ordersCreatedTotal,
  ordersCompletedTotal,
  ordersFailedTotal,
  revenueTotal,
  externalApiLatency,
  orderProcessingTime,
  pendingOrders,
  databaseConnectionsActive
};