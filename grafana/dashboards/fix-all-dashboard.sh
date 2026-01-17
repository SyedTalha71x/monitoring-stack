#!/bin/bash

# cd ~/DevOps\ Projects/monitoring-stack/grafana/dashboards

# Backup original files
echo "Creating backup..."
mkdir -p ../backup_$(date +%Y%m%d_%H%M%S)
cp *.json ../backup_$(date +%Y%m%d_%H%M%S)/

echo "Fixing all dashboard JSON files..."

# Array of files with their titles
files=(
  "1-microservices-overview.json:Microservices Overview"
  "2-user-service.json:User Service Dashboard"
  "3-product-service.json:Product Service Dashboard"
  "4-order-service.json:Order Service Dashboard"
  "5-business-metrics.json:Business Metrics Dashboard"
  "6-infrastructure.json:Infrastructure Dashboard"
  "7-database-performance.json:Database Performance Dashboard"
  "8-alert-dashboard.json:Alert Dashboard"
)

for item in "${files[@]}"; do
  file="${item%%:*}"
  title="${item##*:}"
  
  echo "Processing: $file"
  
  # Create proper JSON structure
  cat > "$file" << EOF
{
  "title": "$title",
  "tags": ["monitoring"],
  "timezone": "browser",
  "panels": [],
  "time": {
    "from": "now-1h",
    "to": "now"
  },
  "refresh": "10s",
  "schemaVersion": 36
}
EOF
  
  echo "✓ Fixed: $file"
done

echo "All files fixed successfully!"