# builder image
FROM node:18-alpine as builder

WORKDIR /app 

COPY package*.json ./

RUN npm ci --only=production


# production image
FROM node:18-alpine AS runner

WORKDIR /app  

COPY --from=builder /app/node_modules ./node_modules
COPY . .

EXPOSE 3002

CMD [ "node", "server.js" ]
