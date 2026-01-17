import express from 'express';
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import { MongoClient, ObjectId } from 'mongodb';
import axios from 'axios';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { databaseConnectionsActive, databaseQueryDuration, externalApiLatency, httpRequestDuration, httpRequestsTotal, orderProcessingTime, ordersCompletedTotal, ordersCreatedTotal, ordersFailedTotal, pendingOrders, revenueTotal } from './utils/customMetrics.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3002;
const serviceName = process.env.SERVICE_NAME || 'order-service';

// External service URLs (simulating service-to-service communication)
const USER_SERVICE_URL = process.env.USER_SERVICE_URL;
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL;

let db;
let client;
const connectToMongoDB = async () => {
  try {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('monitoring');
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const register = new Registry();
register.setDefaultLabels({ service: serviceName });
collectDefaultMetrics({ register });

[
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
].forEach(metric => register.registerMetric(metric));

// Simulated payment processor
const simulatePayment = async (amount, currency = 'USD') => {
  await new Promise(resolve => setTimeout(resolve, Math.random() * 2000));
  return Math.random() > 0.1; // 90% success rate
};

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  const originalEnd = res.end;

  res.end = function(...args) {
    const duration = (Date.now() - start) / 1000;
    const endpoint = req.route?.path || req.path;
    
    httpRequestsTotal.inc({
      method: req.method,
      endpoint: endpoint,
      status: res.statusCode
    });
    
    httpRequestDuration.observe({
      method: req.method,
      endpoint: endpoint,
      status: res.statusCode
    }, duration);
    
    originalEnd.apply(this, args);
  };
  
  next();
});

app.get('/health', async (req, res) => {
  try {
    await db.command({ ping: 1 });
    
    const userServiceHealth = await axios.get(`${USER_SERVICE_URL}/health`)
      .then(() => 'healthy')
      .catch(() => 'unhealthy');
    
    const productServiceHealth = await axios.get(`${PRODUCT_SERVICE_URL}/health`)
      .then(() => 'healthy')
      .catch(() => 'unhealthy');
    
    res.json({
      status: 'healthy',
      service: serviceName,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      mongodb: 'connected',
      dependencies: {
        userService: userServiceHealth,
        productService: productServiceHealth
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      service: serviceName,
      error: error.message
    });
  }
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    // Update metrics
    const serverStatus = await db.command({ serverStatus: 1 });
    databaseConnectionsActive.set(serverStatus.connections.current || 0);
    
    const pendingCount = await db.collection('orders')
      .countDocuments({ status: 'pending' });
    pendingOrders.set(pendingCount);
    
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error.message);
  }
});

// Business logic Endpoints
app.post('/api/orders', async (req, res) => {
  const processingStart = Date.now();
  const endTimer = databaseQueryDuration.startTimer({ 
    operation: 'insert', 
    collection: 'orders' 
  });
  
  try {
    const { userId, items, shippingAddress, paymentMethod } = req.body;
    
    if (!userId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid order data' });
    }
    
    const userTimer = externalApiLatency.startTimer({ 
      service: 'user-service', 
      endpoint: 'get_user' 
    });
    
    let user;
    try {
      const response = await axios.get(`${USER_SERVICE_URL}/api/users/${userId}`);
      user = response.data.data;
    } catch (error) {
      userTimer();
      return res.status(400).json({ error: 'User not found' });
    }
    userTimer();
    
    // Validate products and calculate total
    let totalAmount = 0;
    const orderItems = [];
    
    for (const item of items) {
      const productTimer = externalApiLatency.startTimer({ 
        service: 'product-service', 
        endpoint: 'get_product' 
      });
      
      try {
        const response = await axios.get(`${PRODUCT_SERVICE_URL}/api/products/${item.productId}`);
        const product = response.data.data;
        
        if (product.stock < item.quantity) {
          productTimer();
          return res.status(400).json({ 
            error: `Insufficient stock for product ${product.name}`,
            productId: item.productId,
            available: product.stock,
            requested: item.quantity
          });
        }
        
        const itemTotal = product.price * item.quantity;
        totalAmount += itemTotal;
        
        orderItems.push({
          productId: item.productId,
          name: product.name,
          price: product.price,
          quantity: item.quantity,
          subtotal: itemTotal
        });
      } catch (error) {
        productTimer();
        return res.status(400).json({ 
          error: `Product ${item.productId} not found` 
        });
      }
      
      productTimer();
    }
    
    const paymentSuccess = await simulatePayment(totalAmount);
    
    if (!paymentSuccess) {
      ordersFailedTotal.inc();
      return res.status(400).json({ error: 'Payment processing failed' });
    }
    
    const order = {
      userId: new ObjectId(userId),
      items: orderItems,
      totalAmount,
      currency: 'USD',
      shippingAddress: shippingAddress || {},
      paymentMethod: paymentMethod || 'credit_card',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await db.collection('orders').insertOne(order);
    
    for (const item of items) {
      try {
        await axios.put(
          `${PRODUCT_SERVICE_URL}/api/products/${item.productId}/stock`,
          { quantity: -item.quantity }
        );
      } catch (error) {
        console.error(`Failed to update stock for product ${item.productId}:`, error.message);
      }
    }
    
    endTimer();
    
    // Update metrics
    const processingTime = (Date.now() - processingStart) / 1000;
    orderProcessingTime.observe({ type: 'creation' }, processingTime);
    
    ordersCreatedTotal.inc({ status: 'pending' });
    revenueTotal.inc({ currency: 'USD' }, totalAmount);
    
    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      orderId: result.insertedId,
      order: {
        ...order,
        _id: result.insertedId
      }
    });
  } catch (error) {
    endTimer();
    ordersFailedTotal.inc();
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders', async (req, res) => {
  const endTimer = databaseQueryDuration.startTimer({ 
    operation: 'find', 
    collection: 'orders' 
  });
  
  try {
    const { userId, status, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    const query = {};
    if (userId) query.userId = new ObjectId(userId);
    if (status) query.status = status;
    
    const orders = await db.collection('orders')
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();
    
    const totalOrders = await db.collection('orders').countDocuments(query);
    
    endTimer();
    
    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalOrders,
        pages: Math.ceil(totalOrders / limit)
      }
    });
  } catch (error) {
    endTimer();
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  const endTimer = databaseQueryDuration.startTimer({ 
    operation: 'findOne', 
    collection: 'orders' 
  });
  
  try {
    const { id } = req.params;
    
    const order = await db.collection('orders').findOne(
      { _id: new ObjectId(id) }
    );
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    endTimer();
    
    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    endTimer();
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/orders/:id/status', async (req, res) => {
  const endTimer = databaseQueryDuration.startTimer({ 
    operation: 'update', 
    collection: 'orders' 
  });
  
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        validStatuses 
      });
    }
    
    const result = await db.collection('orders').updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          status,
          updatedAt: new Date()
        }
      }
    );
    
    endTimer();
    
    if (result.modifiedCount === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Update metrics
    if (status === 'delivered') {
      ordersCompletedTotal.inc();
    }
    
    res.json({
      success: true,
      message: `Order status updated to ${status}`
    });
  } catch (error) {
    endTimer();
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/analytics/revenue', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    
    const revenueData = await db.collection('orders').aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $in: ['delivered', 'shipped'] }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
          },
          totalRevenue: { $sum: "$totalAmount" },
          orderCount: { $sum: 1 },
          averageOrderValue: { $avg: "$totalAmount" }
        }
      },
      { $sort: { "_id.date": 1 } }
    ]).toArray();
    
    res.json({
      success: true,
      data: revenueData,
      period: `${days} days`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/analytics/top-products', async (req, res) => {
  try {
    const topProducts = await db.collection('orders').aggregate([
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.productId",
          productName: { $first: "$items.name" },
          totalQuantity: { $sum: "$items.quantity" },
          totalRevenue: { $sum: "$items.subtotal" },
          orderCount: { $sum: 1 }
        }
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 }
    ]).toArray();
    
    res.json({
      success: true,
      data: topProducts,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const startServer = async () => {
  await connectToMongoDB();
  
  app.listen(port, () => {
    console.log(`${serviceName} listening on port ${port}`);
  });
};

startServer().catch(console.error);