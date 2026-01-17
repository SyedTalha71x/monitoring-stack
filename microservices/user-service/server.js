import express from 'express';
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { cacheHitsTotal, cacheMissesTotal, databaseCollectionsTotal, databaseConnectionsActive, databaseConnectionsTotal, databaseQueryDuration, httpRequestDuration, httpRequestsTotal, userLoginsFailedTotal, userLoginsTotal, userRegistrationsTotal } from './utils/customMetrics.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const serviceName = process.env.SERVICE_NAME || 'user-service';

let db;
let client;
const connectToMongoDB = async () => {
  try {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('monitoring');
    console.log('Connected to MongoDB');
    
    // Initialize database metrics
    const collections = await db.listCollections().toArray();
    databaseCollectionsTotal.set(collections.length);
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
register.registerMetric(userRegistrationsTotal);
register.registerMetric(userLoginsTotal);
register.registerMetric(userLoginsFailedTotal);
register.registerMetric(databaseConnectionsActive);
register.registerMetric(databaseConnectionsTotal);
register.registerMetric(databaseCollectionsTotal);
register.registerMetric(cacheHitsTotal);
register.registerMetric(cacheMissesTotal);

// made my custom in memory cache
const cache = new Map();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Metrics middleware
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
    // Update active connections metric
    const serverStatus = await db.command({ serverStatus: 1 });
    databaseConnectionsActive.set(serverStatus.connections.current || 0);
    databaseConnectionsTotal.set(serverStatus.connections.available || 100);
    
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error.message);
  }
});

// Business related logic Endpoints
app.post('/api/users/register', async (req, res) => {
  const endTimer = databaseQueryDuration.startTimer({ 
    operation: 'insert', 
    collection: 'users' 
  });
  
  try {
    const { name, email, password } = req.body;
    
    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await db.collection('users').insertOne({
      name,
      email,
      password: hashedPassword,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    endTimer();
    userRegistrationsTotal.inc();
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      userId: result.insertedId
    });
  } catch (error) {
    endTimer();
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users/login', async (req, res) => {
  const endTimer = databaseQueryDuration.startTimer({ 
    operation: 'find', 
    collection: 'users' 
  });
  
  try {
    const { email, password } = req.body;
    
    const cacheKey = `user:${email}`;
    let user = cache.get(cacheKey);
    
    if (user) {
      cacheHitsTotal.inc();
    } else {
      cacheMissesTotal.inc();
      user = await db.collection('users').findOne({ email });
      if (user) {
        // Cache for 5 minutes
        cache.set(cacheKey, user, 300000);
      }
    }
    
    if (!user) {
      userLoginsFailedTotal.inc();
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      userLoginsFailedTotal.inc();
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    endTimer();
    userLoginsTotal.inc();
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    endTimer();
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users', async (req, res) => {
  const endTimer = databaseQueryDuration.startTimer({ 
    operation: 'find', 
    collection: 'users' 
  });
  
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const cacheKey = `users:page:${page}:limit:${limit}`;
    let users = cache.get(cacheKey);
    let totalUsers;
    
    if (users) {
      cacheHitsTotal.inc();
      totalUsers = cache.get('users:total') || 0;
    } else {
      cacheMissesTotal.inc();
      users = await db.collection('users')
        .find({}, { projection: { password: 0 } })
        .skip(skip)
        .limit(limit)
        .toArray();
      
      totalUsers = await db.collection('users').countDocuments();
      
      // Cache for 1 minute
      cache.set(cacheKey, users, 60000);
      cache.set('users:total', totalUsers, 60000);
    }
    
    endTimer();
    
    res.json({
      success: true,
      data: users,
      pagination: {
        page,
        limit,
        total: totalUsers,
        pages: Math.ceil(totalUsers / limit)
      }
    });
  } catch (error) {
    endTimer();
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/:id', async (req, res) => {
  const endTimer = databaseQueryDuration.startTimer({ 
    operation: 'findOne', 
    collection: 'users' 
  });
  
  try {
    const { id } = req.params;
    
    const cacheKey = `user:${id}`;
    let user = cache.get(cacheKey);
    
    if (user) {
      cacheHitsTotal.inc();
    } else {
      cacheMissesTotal.inc();
      user = await db.collection('users').findOne(
        { _id: new ObjectId(id) },
        { projection: { password: 0 } }
      );
      
      if (user) {
        // Cache for 2 minutes
        cache.set(cacheKey, user, 120000);
      }
    }
    
    endTimer();
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    endTimer();
    res.status(500).json({ error: error.message });
  }
});

// Error simulation endpoint for testing alerts
app.get('/api/users/simulate/error', (req, res) => {
  const errorRate = parseFloat(req.query.rate) || 0.5;
  
  if (Math.random() < errorRate) {
    res.status(500).json({ 
      error: 'Simulated server error',
      timestamp: new Date().toISOString()
    });
  } else {
    res.json({ 
      message: 'Request successful',
      timestamp: new Date().toISOString()
    });
  }
});

// Slow endpoint for testing latency alerts
app.get('/api/users/simulate/slow', async (req, res) => {
  const delay = parseFloat(req.query.delay) || 3;
  
  await new Promise(resolve => setTimeout(resolve, delay * 1000));
  
  res.json({
    message: 'Slow request completed',
    delay: delay,
    timestamp: new Date().toISOString()
  });
});

const startServer = async () => {
  await connectToMongoDB();
  
  app.listen(port, () => {
    console.log(`${serviceName} listening on port ${port}`);
    console.log(`Metrics available at http://localhost:${port}/metrics`);
    console.log(`Health check at http://localhost:${port}/health`);
  });
};

startServer().catch(console.error);

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (client) {
    await client.close();
  }
  process.exit(0);
});