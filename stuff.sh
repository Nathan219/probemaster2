# Vars you gave
PROJECT_ID=answerenginedemo
REGION=us-central1
REPO=planbayareaanswerprototype

# 1) The node service account (Compute Engine default SA)
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "$SA_EMAIL"

# 2) Grant Artifact Registry read on your repo (preferred, repo-scoped)
gcloud artifacts repositories add-iam-policy-binding "$REPO" \
  --location="$REGION" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.reader"

# 3) Confirm it landed
gcloud artifacts repositories get-iam-policy "$REPO" --location="$REGION" \
  --flatten="bindings[].members" --filter="bindings.members:${SA_EMAIL}" \
  --format="table(bindings.role, bindings.members)"

# 4) Force a fresh image pull
kubectl rollout restart deploy/YOUR_DEPLOYMENT -n rag
