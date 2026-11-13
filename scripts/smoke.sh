#!/usr/bin/env bash
# Production smoke test. Usage: scripts/smoke.sh https://<api>.onrender.com
# Uses the same `Authorization: Bearer <token>` scheme as the frontend.
# Requires: curl, python3. Creates one temporary document and deletes it at the end.
set -euo pipefail

API="${1:?usage: scripts/smoke.sh <api-base-url>}"
API="${API%/}"
PASS=0
FAIL=0

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }
check() { # check <label> <expected> <actual>
  if [[ "$2" == "$3" ]]; then PASS=$((PASS + 1)); echo "  ok   $1"; else FAIL=$((FAIL + 1)); echo "  FAIL $1 (expected $2, got $3)"; fi
}
req() { # req <method> <path> <token|-> [json-body]  -> prints "<status>\n<body>"
  local method=$1 path=$2 token=$3 body=${4:-}
  local args=(-s -o /tmp/smoke_body.$$ -w "%{http_code}" -X "$method" "$API$path" --max-time 90)
  [[ "$token" != "-" ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n "$body" ]] && args+=(-H "Content-Type: application/json" -d "$body")
  curl "${args[@]}"
}
body() { cat /tmp/smoke_body.$$; }
login() { req POST /api/auth/login/ - "{\"email\":\"$1\",\"password\":\"demo1234\"}" >/dev/null; body | json 'd["token"]'; }
trap 'rm -f /tmp/smoke_body.$$' EXIT

echo "Smoke testing $API (first request may take ~1 min if the server is asleep)"

check "health 200" 200 "$(req GET /api/health/ -)"
check "no pending migrations" False "$(body | json 'd["migrations_pending"]')"
check "anonymous /me is 401" 401 "$(req GET /api/auth/me/ -)"
check "Token scheme rejected" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Token x' "$API/api/auth/me/")"
check "bad password is 400" 400 "$(req POST /api/auth/login/ - '{"email":"alice@ajaia.test","password":"nope"}')"

ALICE=$(login alice@ajaia.test)
check "alice /me" alice@ajaia.test "$(req GET /api/auth/me/ "$ALICE" >/dev/null; body | json 'd["email"]')"

if [[ "${SMOKE_DOCS:-1}" == "1" ]]; then
  CAROL=$(login carol@ajaia.test)

  check "create doc" 201 "$(req POST /api/documents/ "$ALICE" '{"title":"Smoke test doc"}')"
  DOC=$(body | json 'd["id"]')
  check "save v1" 200 "$(req PUT "/api/documents/$DOC/content/" "$ALICE" '{"content":"<p><strong>smoke</strong></p>","version":1,"save_id":"11111111-1111-4111-8111-111111111111"}')"
  check "stale save is 409" 409 "$(req PUT "/api/documents/$DOC/content/" "$ALICE" '{"content":"<p>stale</p>","version":1,"save_id":"22222222-2222-4222-8222-222222222222"}')"
  check "reopen keeps formatting" "<p><strong>smoke</strong></p>" "$(req GET "/api/documents/$DOC/" "$ALICE" >/dev/null; body | json 'd["content"]')"
  check "carol cannot see unshared doc" 404 "$(req GET "/api/documents/$DOC/" "$CAROL")"
  check "share with carol (viewer)" 201 "$(req POST "/api/documents/$DOC/shares/" "$ALICE" '{"email":"carol@ajaia.test","role":"viewer"}')"
  SHARE=$(body | json 'd["id"]')
  check "carol can read" 200 "$(req GET "/api/documents/$DOC/" "$CAROL")"
  check "carol (viewer) cannot save" 403 "$(req PUT "/api/documents/$DOC/content/" "$CAROL" '{"content":"<p>x</p>","version":2,"save_id":"33333333-3333-4333-8333-333333333333"}')"
  check "revoke carol" 204 "$(req DELETE "/api/documents/$DOC/shares/$SHARE/" "$ALICE")"
  check "carol loses access" 404 "$(req GET "/api/documents/$DOC/" "$CAROL")"
  check "delete doc" 204 "$(req DELETE "/api/documents/$DOC/" "$ALICE")"
fi

echo "passed: $PASS  failed: $FAIL"
[[ $FAIL -eq 0 ]]
