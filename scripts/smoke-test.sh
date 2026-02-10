#!/bin/bash
# Ultralight Platform Smoke Test
# Run: ./scripts/smoke-test.sh
# Requires: ULTRALIGHT_TOKEN env var or --token flag

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Config
API_URL="${ULTRALIGHT_API_URL:-https://ultralight.dev}"
TOKEN="${ULTRALIGHT_TOKEN:-}"

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --token) TOKEN="$2"; shift 2 ;;
    --url) API_URL="$2"; shift 2 ;;
    --help) echo "Usage: $0 [--token TOKEN] [--url API_URL]"; exit 0 ;;
    *) shift ;;
  esac
done

if [ -z "$TOKEN" ]; then
  echo -e "${RED}Error: No token provided. Set ULTRALIGHT_TOKEN or use --token${NC}"
  exit 1
fi

echo "╔════════════════════════════════════════╗"
echo "║    Ultralight Platform Smoke Test      ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "API: $API_URL"
echo ""

PASS=0
FAIL=0

test_result() {
  if [ "$1" = "ok" ]; then
    echo -e "${GREEN}✓ PASS${NC} - $2"
    ((PASS++))
  else
    echo -e "${RED}✗ FAIL${NC} - $2"
    ((FAIL++))
  fi
}

mcp_call() {
  local tool="$1"
  local args="$2"
  curl -sf -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    "$API_URL/mcp/platform" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}" 2>/dev/null
}

# Test 1: Health endpoint
echo -n "1. Health endpoint... "
if curl -sf "$API_URL/health" > /dev/null 2>&1; then
  test_result "ok" "Health endpoint responding"
else
  test_result "fail" "Health endpoint not responding"
fi

# Test 2: Authentication
echo -n "2. Authentication... "
PROFILE=$(mcp_call "platform.user.profile" "{}")
if echo "$PROFILE" | grep -q '"email"'; then
  EMAIL=$(echo "$PROFILE" | grep -o '"email":"[^"]*"' | cut -d'"' -f4)
  test_result "ok" "Authenticated as $EMAIL"
else
  test_result "fail" "Authentication failed"
fi

# Test 3: List apps
echo -n "3. List apps... "
APPS=$(mcp_call "platform.apps.list" "{}")
if echo "$APPS" | grep -q '"apps"'; then
  TOTAL=$(echo "$APPS" | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2)
  test_result "ok" "Found $TOTAL apps"
else
  test_result "fail" "Could not list apps"
fi

# Test 4: App discovery (semantic search)
echo -n "4. App discovery... "
DISCOVER=$(mcp_call "platform.discover" '{"query":"test"}')
if echo "$DISCOVER" | grep -q '"results"'; then
  test_result "ok" "Discovery endpoint working"
else
  test_result "fail" "Discovery endpoint failed"
fi

# Test 5: Tools list (MCP protocol)
echo -n "5. MCP tools/list... "
TOOLS=$(curl -sf -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "$API_URL/mcp/platform" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' 2>/dev/null)
if echo "$TOOLS" | grep -q '"tools"'; then
  TOOL_COUNT=$(echo "$TOOLS" | grep -o '"name"' | wc -l | tr -d ' ')
  test_result "ok" "MCP protocol working ($TOOL_COUNT tools available)"
else
  test_result "fail" "MCP protocol not responding"
fi

# Test 6: Check for personal apps (if any exist)
echo -n "6. Personal apps check... "
if [ "$TOTAL" -gt 0 ]; then
  # Extract first app ID
  FIRST_APP=$(echo "$APPS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$FIRST_APP" ]; then
    # Try to get app details
    APP_DETAILS=$(mcp_call "platform.apps.get" "{\"app_id\":\"$FIRST_APP\"}")
    if echo "$APP_DETAILS" | grep -q '"name"'; then
      APP_NAME=$(echo "$APP_DETAILS" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
      test_result "ok" "Can fetch app details (first: $APP_NAME)"
    else
      test_result "fail" "Could not fetch app details"
    fi
  else
    test_result "fail" "Could not extract app ID"
  fi
else
  echo -e "${YELLOW}⚠ SKIP${NC} - No apps deployed yet"
fi

# Test 7: Try running a function (if apps exist)
echo -n "7. Function execution... "
if [ "$TOTAL" -gt 0 ] && [ -n "$FIRST_APP" ]; then
  # Get exports from the app
  EXPORTS=$(echo "$APP_DETAILS" | grep -o '"exports":\[[^]]*\]' | head -1)
  if echo "$EXPORTS" | grep -q '"'; then
    FIRST_FN=$(echo "$EXPORTS" | grep -o '"[^"]*"' | head -1 | tr -d '"')
    if [ -n "$FIRST_FN" ]; then
      RUN_RESULT=$(mcp_call "platform.run" "{\"app_id\":\"$FIRST_APP\",\"function\":\"$FIRST_FN\"}")
      if echo "$RUN_RESULT" | grep -q '"success"'; then
        test_result "ok" "Executed $FIRST_FN on $APP_NAME"
      else
        test_result "fail" "Function execution returned error"
      fi
    else
      echo -e "${YELLOW}⚠ SKIP${NC} - No exported functions found"
    fi
  else
    echo -e "${YELLOW}⚠ SKIP${NC} - Could not parse exports"
  fi
else
  echo -e "${YELLOW}⚠ SKIP${NC} - No apps to test"
fi

# Summary
echo ""
echo "════════════════════════════════════════"
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo "════════════════════════════════════════"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
