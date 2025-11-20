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
# 2. Define image registry locations
# ================================
FIMG_BASE="us-central1-docker.pkg.dev/answerenginedemo/planbayareaanswerprototype/frontend"
BIMG_BASE="us-central1-docker.pkg.dev/answerenginedemo/planbayareaanswerprototype/backend"

# ================================
# 3. Build and push backend (inject version)
# ================================
echo "🚧 Building backend image..."
docker build \
  -t "$BIMG_BASE:$TAG" \
  --build-arg VERSION="$VERSION" \
  ./backend

docker push "$BIMG_BASE:$TAG"

# ================================
# 4. Build and push frontend (inject version)
# ================================
echo "🚧 Building frontend image..."
docker build \
  -t "$FIMG_BASE:$TAG" \
  --build-arg VERSION="$VERSION" \
  ./frontend

docker push "$FIMG_BASE:$TAG"

# ================================
# 5. Get image digests (immutable identifiers)
# ================================
FDIGEST="$(gcloud artifacts docker images describe "$FIMG_BASE:$TAG" \
  --format='value(image_summary.fully_qualified_digest)')"

BDIGEST="$(gcloud artifacts docker images describe "$BIMG_BASE:$TAG" \
  --format='value(image_summary.fully_qualified_digest)')"

echo "✅ Frontend digest: $FDIGEST"
echo "✅ Backend digest:  $BDIGEST"

# ================================
# 6. Update Kubernetes deployments
# ================================
NS=rag

echo "🚀 Deploying to namespace: $NS"

kubectl set image deploy/rag-backend server="$BDIGEST" -n "$NS"
kubectl set env deploy/rag-backend VERSION="$VERSION" -n "$NS"

kubectl set image deploy/rag-frontend web="$FDIGEST" -n "$NS"
kubectl set env deploy/rag-frontend FRONTEND_VERSION="$VERSION" -n "$NS"

# ================================
# 7. Optional stable pointer (if desired)
# ================================
# docker tag "$BIMG_BASE:$TAG" "$BIMG_BASE:stable" && docker push "$BIMG_BASE:stable"
# docker tag "$FIMG_BASE:$TAG" "$FIMG_BASE:stable" && docker push "$FIMG_BASE:stable"

echo "✅ Deployment complete."
echo "Frontend: $FIMG_BASE:$TAG"
echo "Backend:  $BIMG_BASE:$TAG"
