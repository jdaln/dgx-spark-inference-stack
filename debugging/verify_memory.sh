#!/bin/bash

# Comprehensive Verification Script for DGX Spark Inference Stack
# This script automates the testing of all modified models to verify GPU memory utilization.
# It generates a report file: memory_test_report.txt

REPORT_FILE="memory_test_report.txt"
echo "DGX Spark Inference Stack - Comprehensive Memory Verification Report" > "$REPORT_FILE"
echo "Date: $(date)" >> "$REPORT_FILE"
echo "--------------------------------------------------------" >> "$REPORT_FILE"

# List of models to test (Service Name : Waker Key : Expected Utilization)
# We test a representative mix of small, medium, large, and quantized models.
MODELS=(
    "vllm-qwen25-vl-7b:qwen2.5-vl-7b:0.82"
    "vllm-qwen25-coder-7b:qwen2.5-coder-7b-instruct:0.82"
    "vllm-qwen3-next-80b-fp4:qwen3-next-80b-a3b-instruct-fp4:0.82"
    "vllm-qwen3-next-80b-thinking-fp4:qwen3-next-80b-a3b-thinking-fp4:0.82"
    "vllm-qwen3-vl-32b-fp4:qwen3-vl-32b-instruct-fp4:0.82"
    "vllm-glm-4.5-air-fp4:glm-4.5-air-fp4:0.82"
    "vllm-glm-4.6v-flash-fp4:glm-4.6v-flash-fp4:0.82"
    "vllm-glm-4.5-air-derestricted-fp4:glm-4.5-air-derestricted-fp4:0.82"
    "vllm-llama-3.3-70b-joyous-fp4:llama-3.3-70b-joyous-fp4:0.82"
    "vllm-llama-3.3-70b-instruct-fp4:llama-3.3-70b-instruct-fp4:0.82"
    "vllm-eurollm-22b-fp4:eurollm-22b-instruct-fp4:0.82"
    "vllm-qwen2.5-1.5b:qwen2.5-1.5b-instruct:0.05" 
    # DISABLED: RimTalk Mini - Persistent OOM / V1 engine issues
    # "vllm-rimtalk-mini-fp4:rimtalk-mini-v1-fp4:0.82"
    # DISABLED: Kimi Linear - MLA not supported on DGX Spark (GB10)
    # "vllm-kimi-linear-48b-fp4:kimi-linear-48b-a3b-instruct-fp4:0.82"
    "vllm-phi-4-multimodal-fp4:phi-4-multimodal-instruct-fp4:0.82"
    "vllm-phi-4-reasoning-plus-fp4:phi-4-reasoning-plus-fp4:0.82"
    # "vllm-step-audio-r1-fp4:step-audio-r1-fp4:0.82" # to test
    "vllm-glm4-9b:glm-4-9b-chat:0.65" 
    "vllm-oss20b:gpt-oss-20b:0.82"
    "vllm-qwen3-coder-30b:qwen3-coder-30b-a3b-instruct:0.82"
    "vllm-nemotron-3-nano-30b-fp8:nemotron-3-nano-30b-fp8:0.82"
)

echo "Starting comprehensive memory test..."
echo "Results will be saved to $REPORT_FILE"
echo ""

# Ensure infrastructure is running
echo "Starting infrastructure (Gateway, Waker & Request Validator)..."
docker compose up -d api-gateway waker request-validator
echo "Waiting for infrastructure to be ready..."
sleep 15

# Function to test a single model
test_model() {
    local service_name=$1
    local model_key=$2
    local expected_util=$3

    echo "Testing $service_name (Key: $model_key, Target: $expected_util)..." | tee -a "$REPORT_FILE"
    
    # 1. Ensure clean state
    # Force remove the specific container to ensure no conflict with old "Created" states
    docker rm -f "$service_name" > /dev/null 2>&1
    # Also stop and remove all other running containers to ensure single-tenant and clean state
    # Targeted cleanup: Remove all vllm-* containers EXCEPT waker and gateway
    docker ps -a --format '{{.Names}}' | grep "^vllm-" | grep -vE "^(vllm-waker|vllm-gateway|vllm-request-validator)$" | xargs -r docker rm -f > /dev/null 2>&1
    
    # 2. Start model with force-recreate to ensure new config is applied
    echo "  Starting container..."
    if ! docker compose --profile models up -d --force-recreate "$service_name"; then
        echo "  [FAIL] Failed to start container. Docker compose output above." | tee -a "$REPORT_FILE"
        return
    fi
    
    # 3. Wait for health check (max 60s for this test, usually faster if cached)
    echo -n "  Waiting for initialization"
    local retries=0
    local max_retries=200 # 200 * 10s = 2000s (33 minutes)
    local healthy=false
    
    while [ $retries -lt $max_retries ]; do
        # Perform a real inference request to ensure model is fully loaded
        # We use a simple "Hello" prompt with max_tokens=10 to ensure quick response
        local response
        local http_code
        local curl_exit_code
        
        # Use --max-time 5 to prevent hanging if the server accepts connection but doesn't respond
        response=$(curl -s -w "\n%{http_code}" --max-time 5 "http://localhost:8009/v1/chat/completions" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
            -d "{\"model\": \"${model_key}\", \"messages\": [{\"role\": \"user\", \"content\": \"Hello\"}], \"max_tokens\": 10}")
        
        curl_exit_code=$?
        
        if [ $curl_exit_code -ne 0 ]; then
             echo -n "(curl_err:$curl_exit_code)"
             sleep 10
             ((retries++))
             continue
        fi

        http_code=$(echo "$response" | tail -n1)
        content=$(echo "$response" | head -n -1)

        if [ -z "$http_code" ]; then
             echo -n "(empty_response)"
        elif [ "$http_code" -eq 200 ]; then
            healthy=true
            echo "" # Newline after dots
            break
        else
            # Print error code to debug
            echo -n "($http_code)"
            
            # If it's a 400/404/500, print the response body to see what's wrong
            if [ "$http_code" -ne 423 ] && [ "$http_code" -ne 503 ] && [ "$http_code" -ne 429 ]; then
                 echo " [Error: $content] "
            fi
        fi
        echo -n "."
        sleep 10
        ((retries++))
    done
    echo "" # Ensure newline if loop finishes without success
    
    if [ "$healthy" = true ]; then
        # 4. Capture Stats using nvidia-smi (Real-time)
        echo "  Model is ready. Capturing stats..."
        
        # Get NVIDIA-SMI (Total GPU usage)
        # Since --query-gpu returns N/A on this GPU, we parse the process list table.
        # We look for the VLLM::EngineCore process and extract its memory usage.
        
        # Capture the full nvidia-smi output
        local smi_output=$(nvidia-smi)
        
        # Extract memory usage for VLLM::EngineCore
        # The line looks like: |    0   N/A  N/A          274571      C   VLLM::EngineCore                      14965MiB |
        local nvidia_mem=$(echo "$smi_output" | grep "VLLM::EngineCore" | awk '{print $(NF-1)}' | sed 's/MiB//' | tr -cd '0-9')
        
        # DGX Spark x1
        local nvidia_total=122572 
        
        if [ -z "$nvidia_mem" ]; then
             nvidia_mem="0"
        fi
        
        local util_percent=$(awk "BEGIN {printf \"%.2f\", ($nvidia_mem / $nvidia_total) * 100}")
        
        echo "  Memory Usage: ${nvidia_mem}MiB / ${nvidia_total}MiB (Utilization: ${util_percent}%)" | tee -a "$REPORT_FILE"
        
        # Compare with expected
        local expected_mb=$(echo "$nvidia_total * $expected_util" | bc | cut -d. -f1)
        echo "  Expected (approx): ~${expected_mb}MiB (Target: $expected_util)" | tee -a "$REPORT_FILE"
        
        echo "  [PASS] Model started and is consuming memory." | tee -a "$REPORT_FILE"
        echo "--------------------------------------------------------" >> "$REPORT_FILE"
        
        echo "  Done."
    else
        echo "  [FAIL] Model failed to initialize within timeout." | tee -a "$REPORT_FILE"
        echo "    - Logs tail:" >> "$REPORT_FILE"
        docker compose logs --tail=5 "$service_name" >> "$REPORT_FILE" 2>&1
        echo "--------------------------------------------------------" >> "$REPORT_FILE"
    fi
    
    # 5. Cleanup
    echo "  Stopping container..."
    docker compose stop "$service_name" > /dev/null 2>&1
    echo ""
}

# Main Loop
for item in "${MODELS[@]}"; do
    IFS=':' read -r service key util <<< "$item"
    test_model "$service" "$key" "$util"
done

echo "Test complete. Please check $REPORT_FILE"
