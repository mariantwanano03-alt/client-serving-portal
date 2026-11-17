#!/usr/bin/env bash
# apply-fixes.sh
# Run from the project root: bash apply-fixes.sh

set -e

CONTAINER="supabase_db_client-serving-portal"
DB_USER="postgres"
DB_NAME="postgres"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       ClientFlow — Applying DB Fix Migrations        ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "❌  Container '${CONTAINER}' is not running."
  echo "   Start Supabase first: npx supabase start --ignore-health-check"
  exit 1
fi

echo "✅  Database container found."
echo ""

echo "▶  1/3  fix_rls_and_schema ..."
docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
  < supabase/migrations/20261027130000_fix_rls_and_schema.sql
echo "   Done."

echo "▶  2/3  fix_profiles_and_triggers ..."
docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
  < supabase/migrations/20261027140000_fix_profiles_and_triggers.sql
echo "   Done."

echo "▶  3/3  fix_recursive_policy ..."
docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
  < supabase/migrations/20261027141000_fix_recursive_policy.sql
echo "   Done."
echo ""

echo "▶  Verifying test accounts ..."
docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -c \
  "SELECT p.full_name, p.role, p.is_active
   FROM public.profiles p
   JOIN auth.users u ON u.id = p.id
   WHERE u.email IN ('senior@test.com', 'admin@test.com');"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅  All fixes applied. Hard-refresh your browser.   ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
