#!/usr/bin/env bash

set -euo pipefail

export DOCKER_DEFAULT_PLATFORM=linux/amd64

# ================================
# 1. Generate version string
# ================================
TAG="v$(date +%Y%m%d-%H%M)-$(git rev-parse --short HEAD)"
VERSION="${TAG}"   # re-used in builds and env vars

echo "🔖 Building version: $VERSION"

# ================================
# 2. Define image registry location
# ================================
PROJECT_ID="where-is-every-body"
REGISTRY_LOCATION="${REGISTRY_LOCATION:-us-central1}"
REPOSITORY="${REPOSITORY:-probemaster}"
IMAGE_NAME="${IMAGE_NAME:-frontend}"

IMG_BASE="${REGISTRY_LOCATION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}"

# ================================
# 3. Build and push frontend (inject version)
# ================================
echo "🚧 Building frontend image for linux/amd64..."
docker build \
  --platform linux/amd64 \
  -t "$IMG_BASE:$TAG" \
  --build-arg VERSION="$VERSION" \
  --build-arg TARGETPLATFORM="linux/amd64" \
  .

docker push "$IMG_BASE:$TAG"

# ================================
# 4. Get image digest (immutable identifier)
# ================================
DIGEST="$(gcloud artifacts docker images describe "$IMG_BASE:$TAG" \
  --format='value(image_summary.fully_qualified_digest)')"

echo "✅ Frontend digest: $DIGEST"

# ================================
# 5. Update Kubernetes deployments
# ================================
NS="${NAMESPACE:-default}"

echo "🚀 Deploying to namespace: $NS"

# Ensure deployment exists (create if it doesn't)
if ! kubectl get deployment probemaster-frontend -n "$NS" &>/dev/null; then
  echo "📦 Creating Kubernetes deployment..."
  kubectl apply -f k8s/deployment.yaml -n "$NS"
  kubectl apply -f k8s/service.yaml -n "$NS"
fi

# Update deployment with new image
kubectl set image deploy/probemaster-frontend web="$DIGEST" -n "$NS"
kubectl set env deploy/probemaster-frontend VERSION="$VERSION" -n "$NS"

# Wait for rollout to complete
echo "⏳ Waiting for rollout to complete..."
kubectl rollout status deployment/probemaster-frontend -n "$NS" --timeout=5m

# Get the external IP address
echo ""
echo "🌐 Getting external IP address..."
EXTERNAL_IP=""
while [ -z "$EXTERNAL_IP" ]; do
  EXTERNAL_IP=$(kubectl get service probemaster-frontend -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
  if [ -z "$EXTERNAL_IP" ]; then
    echo "   Waiting for LoadBalancer IP to be assigned..."
    sleep 5
  fi
done

echo "✅ External IP: http://$EXTERNAL_IP"

# ================================
# 7. Optional stable pointer (if desired)
# ================================
# docker tag "$IMG_BASE:$TAG" "$IMG_BASE:stable" && docker push "$IMG_BASE:stable"

echo ""
echo "✅ Deployment complete."
echo "Image: $IMG_BASE:$TAG"
echo "Digest: $DIGEST"
echo "🌐 Access your application at: http://$EXTERNAL_IP"

