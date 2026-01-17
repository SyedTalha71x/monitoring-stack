db = db.getSiblingDB('monitoring');

// Create collections and indexes
db.createCollection('users');
db.createCollection('products');
db.createCollection('orders');

db.users.createIndex({ email: 1 }, { unique: true });
db.products.createIndex({ category: 1 });
db.orders.createIndex({ userId: 1, createdAt: -1 });

// Insert sample data
db.users.insertMany([
  {
    _id: ObjectId("651234567890123456789001"),
    name: "John Doe",
    email: "john@example.com",
    createdAt: new Date(),
    status: "active"
  },
  {
    _id: ObjectId("651234567890123456789002"),
    name: "Jane Smith",
    email: "jane@example.com",
    createdAt: new Date(),
    status: "active"
  }
]);

db.products.insertMany([
  {
    _id: ObjectId("651234567890123456789101"),
    name: "Laptop",
    price: 999.99,
    category: "electronics",
    stock: 50,
    createdAt: new Date()
  },
  {
    _id: ObjectId("651234567890123456789102"),
    name: "Smartphone",
    price: 699.99,
    category: "electronics",
    stock: 100,
    createdAt: new Date()
  },
  {
    _id: ObjectId("651234567890123456789103"),
    name: "Headphones",
    price: 199.99,
    category: "electronics",
    stock: 200,
    createdAt: new Date()
  }
]);