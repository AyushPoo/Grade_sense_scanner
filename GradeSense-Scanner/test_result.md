#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: "Build GradeSense Scanner - A mobile document scanning app for teachers to scan student answer papers"

backend:
  - task: "Health endpoint"
    implemented: true
    working: true
    file: "server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "testing"
          comment: "GET /api/health endpoint tested successfully."

  - task: "Batches endpoint"
    implemented: true
    working: true
    file: "server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "testing"
          comment: "GET /api/batches endpoint tested successfully."

  - task: "Scan session creation"
    implemented: true
    working: true
    file: "server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "testing"
          comment: "POST /api/scan-sessions/create endpoint tested successfully."

  - task: "Session status endpoint"
    implemented: true
    working: true
    file: "server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "testing"
          comment: "GET /api/scan-sessions/{session_id}/status endpoint tested successfully."

frontend:
  - task: "Page Preview with swipe and actions"
    implemented: true
    working: "pending_user_verification"
    file: "app/page-preview.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: false
          agent: "user"
          comment: "Slow to open, not clear, swipe not working, delete/retake buttons don't work"
        - working: "pending"
          agent: "main"
          comment: "Complete rewrite: Added swipe navigation with FlatList, working Delete/Retake buttons, faster image loading with better optimization, pagination dots for multiple pages"

  - task: "Scanner layout and NEXT STUDENT button visibility"
    implemented: true
    working: "pending_user_verification"
    file: "app/scanner.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: false
          agent: "user"
          comment: "NEXT STUDENT button cut off at bottom, not visible"
        - working: "pending"
          agent: "main"
          comment: "Redesigned layout: NEXT STUDENT button now prominent with student count, added ScrollView for controls, reduced camera height, made button more visible with larger text"

  - task: "Auto-rotate orientation support"
    implemented: true
    working: "pending_user_verification"
    file: "app/scanner.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "pending"
          agent: "main"
          comment: "Added expo-screen-orientation, camera auto-rotates when phone is turned, orientation indicator badge in header, camera view adjusts size for landscape"

  - task: "Done/Finish button and Review screen"
    implemented: true
    working: "pending_user_verification"
    file: "app/scanner.tsx, app/review.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "pending"
          agent: "main"
          comment: "Added prominent DONE button in scanner, navigates to Review screen showing all students with page counts, expandable cards to see thumbnails, swipe-able full-screen preview modal"

  - task: "Auto-crop document detection"
    implemented: true
    working: "pending_user_verification"
    file: "app/scanner.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Previously marked as complex. Now implemented using react-native-document-scanner-plugin"
        - working: "pending"
          agent: "main"
          comment: "Added 'SCAN WITH AUTO-CROP' button that launches native document scanner with edge detection. Automatically crops and straightens documents. Requires Dev Build to test (not Expo Go)."

  - task: "Blur detection with retake prompt"
    implemented: true
    working: "pending_user_verification"
    file: "app/scanner.tsx, src/utils/blurDetection.ts"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "pending"
          agent: "main"
          comment: "Implemented blur detection using sharpness analysis. After each capture, modal shows image quality (Sharp/Acceptable/Blurry/Very Blurry). For blurry images, shows Retake or Keep Anyway options. Sharp images auto-accepted after 1 second."

metadata:
  created_by: "main_agent"
  version: "1.2"
  test_sequence: 3
  run_ui: false

test_plan:
  current_focus:
    - "Page Preview with swipe and actions"
    - "Scanner layout and NEXT STUDENT button visibility"
    - "Auto-rotate orientation support"
    - "Done/Finish button and Review screen"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      message: "Implemented 4 out of 5 user-requested features: 1) Page preview with swipe and working buttons, 2) Fixed NEXT STUDENT button visibility, 3) Auto-rotate support, 4) Done button with full review screen. Auto-crop (item 2) requires ML-based edge detection and is complex - marked for future. All features need user verification on device."