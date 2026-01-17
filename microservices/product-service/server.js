import express from 'express';
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { databaseConnectionsActive, databaseQueryDuration, httpRequestDuration, httpRequestsTotal, productsCreatedTotal, productsPurchasedTotal, productsViewedTotal, stockUpdatesTotal } from './utils/customMetrics.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const serviceName = process.env.SERVICE_NAME || 'product-service';


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

// Prometheus Metrics
const register = new Registry();
register.setDefaultLabels({ service: serviceName });
collectDefaultMetrics({ register });


register.registerMetric(httpRequestsTotal);
register.registerMetric(httpRequestDuration);
register.registerMetric(databaseQueryDuration);
register.registerMetric(productsCreatedTotal);
register.registerMetric(productsViewedTotal);
register.registerMetric(productsPurchasedTotal);
register.registerMetric(stockUpdatesTotal);
register.registerMetric(databaseConnectionsActive);

const cache = new Map();

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
    res.json({
      status: 'healthy',
      service: serviceName,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      mongodb: 'connected'
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      service: serviceName,
      error: error.message
    });
  }
});

app.get('/metrics', async (req, res) => {
  try {
    const serverStatus = await db.command({ serverStatus: 1 });
    databaseConnectionsActive.set(serverStatus.connections.current || 0);
    
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error.message);
  }
});

app.get('/api/products', async (req, res) => {
  const endTimer = databaseQueryDuration.startTimer({ 
    operation: 'find', 
    collection: 'products' 
  });
  
  try {
    const { category, page = 1, limit = 10, sort = 'name', order = 'asc' } = req.query;
    const skip = (page - 1) * limit;
    
    const query = category ? { category } : {};
    const sortOrder = order === 'desc' ? -1 : 1;
    
    const cacheKey = `products:${category || 'all'}:page:${page}:limit:${limit}:sort:${sort}:order:${order}`;
    let products = cache.get(cacheKey);
    let totalProducts;
    
    if (products) {
      // Cache hit
    } else {
      // Cache miss
      products = await db.collection('products')
        .find(query)
        .sort({ [sort]: sortOrder })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();
      
      totalProducts = await db.collection('products').countDocuments(query);
      
      // Cache for 30 seconds
      cache.set(cacheKey, { products, totalProducts }, 30000);
    }
    
    products.forEach(product => {
      productsViewedTotal.inc();
    });
    
    endTimer();
    
    res.json({
      success: true,
      data: products,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalProducts || products.totalProducts,
        pages: Math.ceil((totalProducts || products.totalProducts) / limit)
      }
    });
  } catch (error) {
    endTimer();
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/:id', async (req, res) => {
  const endTimer = databaseQueryDuration.startTimer({ 
    operation: 'findOne', 
    collection: 'products' 
  });
  
  try {
    const { id } = req.params;
    
    const product = await db.collection('products').findOne(
      { _id: new ObjectId(id) }
    );
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    productsViewedTotal.inc();
    
    endTimer();
    
    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    endTimer();
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products', async (req, res) => {
  const endTimer = databaseQueryDuration.startTimer({ 
    operation: 'insert', 
    collection: 'products' 
  });
  
  try {
    const { name, price, category, stock, description } = req.body;
    
    if (!name || !price || !category) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const product = {
      name,
      price: parseFloat(price),
      category,
      stock: parseInt(stock) || 0,
      description: description || '',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await db.collection('products').insertOne(product);
    
    endTimer();
    productsCreatedTotal.inc({ category });
    
    // Clear cache
    cache.clear();
    
    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      productId: result.insertedId,
      product
    });
  } catch (error) {
    endTimer();
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/products/:id/stock', async (req, res) => {
  const endTimer = databaseQueryDuration.startTimer({ 
    operation: 'update', 
    collection: 'products' 
  });
  
  try {
    const { id } = req.params;
    const { quantity } = req.body;
    
    if (typeof quantity !== 'number') {
      return res.status(400).json({ error: 'Quantity must be a number' });
    }
    
    const result = await db.collection('products').updateOne(
      { _id: new ObjectId(id) },
      { 
        $inc: { stock: quantity },
        $set: { updatedAt: new Date() }
      }
    );
    
    endTimer();
    stockUpdatesTotal.inc();
    
    if (result.modifiedCount === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Clear cache
    cache.clear();
    
    res.json({
      success: true,
      message: 'Stock updated successfully'
    });
  } catch (error) {
    endTimer();
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products/:id/purchase', async (req, res) => {
  const endTimer = databaseQueryDuration.startTimer({ 
    operation: 'update', 
    collection: 'products' 
  });
  
  try {
    const { id } = req.params;
    const { quantity = 1 } = req.body;
    
    const product = await db.collection('products').findOne(
      { _id: new ObjectId(id) }
    );
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    if (product.stock < quantity) {
      return res.status(400).json({ 
        error: 'Insufficient stock',
        available: product.stock,
        requested: quantity
      });
    }
    
    const result = await db.collection('products').updateOne(
      { _id: new ObjectId(id), stock: { $gte: quantity } },
      { 
        $inc: { stock: -quantity },
        $set: { updatedAt: new Date() }
      }
    );
    
    endTimer();
    
    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'Failed to process purchase' });
    }
    
    // Increment purchase counter
    productsPurchasedTotal.inc({ category: product.category });
    stockUpdatesTotal.inc();
    
    // Clear cache
    cache.clear();
    
    res.json({
      success: true,
      message: 'Purchase successful',
      productId: id,
      quantity,
      remainingStock: product.stock - quantity
    });
  } catch (error) {
    endTimer();
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/analytics/summary', async (req, res) => {
  try {
    const summary = await db.collection('products').aggregate([
      {
        $group: {
          _id: '$category',
          totalProducts: { $sum: 1 },
          totalStock: { $sum: '$stock' },
          averagePrice: { $avg: '$price' },
          maxPrice: { $max: '$price' },
          minPrice: { $min: '$price' }
        }
      },
      { $sort: { totalProducts: -1 } }
    ]).toArray();
    
    res.json({
      success: true,
      data: summary,
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