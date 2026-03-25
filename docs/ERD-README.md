# Contractor/Job Mobile App - Entity-Relationship Diagram

## Overview

This directory contains the complete Entity-Relationship Diagram (ERD) and database schema for the **Contractor/Job Mobile Application**. The schema supports a contractor/job matching platform with features for time tracking, quality control, documentation, and invoicing.

## Files

### 1. `erd-contractor-job-app.sql`
**Format:** MySQL DDL (CREATE TABLE statements)

Contains the complete database schema for the contractor/job mobile app, including:
- All 16 tables with proper relationships and indexes
- Foreign key constraints
- Field constraints and defaults
- Comments explaining field purposes

**Usage:**
```bash
mysql -u username -p database_name < erd-contractor-job-app.sql
```

### 2. `erd-contractor-job-app.dbdiagram`
**Format:** DBDiagram.io syntax

Visual ERD definition in dbdiagram.io format. Use this to:
- View the diagram visually at https://dbdiagram.io
- Copy-paste content directly into dbdiagram.io to see the visual representation
- Export the diagram to various formats (PNG, PDF, SVG)

**Quick Start:**
1. Go to https://dbdiagram.io
2. Click "Create your diagram"
3. Paste the contents of this file into the editor
4. The diagram will render automatically

## Database Structure

### Core Entities

**contractor**
- Stores contractor profiles and metadata
- Tracks verification status, ratings, and preferences
- Primary entity for the matching platform

**job**
- Job postings/assignments
- Contains location, timing, requirements, and budget info
- Linked to contractors through job_session

**job_session**
- Central entity linking contractors to jobs
- Tracks when a contractor is assigned to a job
- Records check-in/check-out times
- One-to-many relationship with all session tracking tables

### Credential & Verification Tables

- **license** - Professional licenses held by contractors
- **certification** - Certifications held by contractors  
- **insurance_policy** - Insurance coverage for contractors
- **registered_device** - Mobile devices registered for push notifications

### Session Tracking Tables

- **task** - Work tasks completed during a session
- **issue** - Problems/blockers encountered
- **field_note** - Location-based notes with GPS coordinates
- **progress_update** - Completion percentage and barriers
- **delivery** - Delivery tracking and confirmations
- **photo** - Polymorphic photo storage for sessions/tasks/issues

### Final Deliverables

- **submission** - Final work package submission (1:1 with job_session)
- **invoice** - Billing and payment tracking

## Key Design Decisions

### 1. Session-Based Architecture
- **job_session** is the central hub for all work activity
- Allows multiple sessions per job (rescheduling, retries)
- Enables complete audit trail of all work performed

### 2. Flexible Documentation
- **photo** table uses polymorphic pattern (photoable_type, photoable_id)
- Allows photos to be attached to sessions, tasks, issues, or deliveries
- Single table handles all photo storage needs

### 3. JSON Fields for Flexible Data
- **preferred_job_types**, **work_hours_preference** in contractor table
- **required_licenses**, **required_certifications** in job table
- **notification_preferences** in registered_device table
- Provides flexibility without schema migrations

### 4. Comprehensive Status Tracking
- **job_status** - Overall job state (open, assigned, in_progress, completed, cancelled)
- **session_status** - Current session state (pending, in_progress, completed, cancelled)
- **submission_status** - Work submission state (draft, pending_review, complete)
- **payment_status** - Invoice payment state (unpaid, paid, disputed)

### 5. Indexing Strategy
- Indexes on foreign keys for join performance
- Indexes on status fields for filtering/querying
- Composite indexes where beneficial (photoable_type + photoable_id)

## Answering Key Design Questions

### Multi-Session Handling
- ✅ Supports multiple sessions per job through job_session table
- Each session has independent check-in/out times, tasks, and progress

### Event-Level Logging
- ✅ task, issue, field_note, progress_update tables capture session-level events
- photo table stores visual evidence
- All tables have created_at timestamps for audit trail

### Job Quality Tracking
- ✅ Tracked through:
  - issue.issue_severity and issue_category
  - task.task_quality_rating
  - photo evidence storage
  - submission for final quality check

### Documentation Speed vs Thoroughness
- ✅ Flexible schema supports both:
  - Minimal data: Quick check-in/out, basic notes
  - Complete data: Full task breakdown, photos, detailed notes

### Client Visibility
- ✅ submission table provides final work package
- submission_status tracks visibility workflow (draft → pending_review → complete)
- Can generate reports from task and photo tables

### Disputes and Audits
- ✅ Comprehensive logging enables resolution:
  - All timestamps on every entity
  - Photo evidence linked to specific tasks/issues
  - Issue tracking with severity levels
  - Invoice linked to specific session

### Invoicing Accuracy
- ✅ invoice.session_id links billing to actual work performed
- job.quote_amount vs invoice.invoice_amount tracks variance
- session data (check_in_time, check_out_time) supports time-based billing
- task data supports task-based billing

## Usage Examples

### Find all issues for a contractor
```sql
SELECT i.* FROM issue i
JOIN job_session js ON i.session_id = js.session_id
WHERE js.contractor_id = ?
ORDER BY i.created_at DESC;
```

### Get job completion summary
```sql
SELECT 
  j.job_id,
  j.job_type,
  COUNT(js.session_id) as num_sessions,
  MAX(pu.completion_percentage) as completion_pct,
  SUM(i.invoice_amount) as total_invoiced
FROM job j
LEFT JOIN job_session js ON j.job_id = js.job_id
LEFT JOIN progress_update pu ON js.session_id = pu.session_id
LEFT JOIN invoice i ON js.session_id = i.session_id
WHERE j.job_id = ?
GROUP BY j.job_id;
```

### Find unresolved issues
```sql
SELECT * FROM issue
WHERE resolved_at IS NULL
ORDER BY issue_severity DESC, created_at DESC;
```

## Related Documentation

See the main README.md for:
- API documentation
- Frontend schema mapping
- Backend service architecture

---

**Last Updated:** March 25, 2026  
**Created by:** James Bustamante (Coding Temple TR42 Residency)  
**Contact:** [Your contact info]
