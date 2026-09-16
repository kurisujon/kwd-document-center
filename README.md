# KWD Document Center

## Overview
The Kiblawan Water District (KWD) Document Center is a specialized application designed to streamline the management and retrieval of digital documents. It provides a simple, fast, and professional interface over KWD's existing document storage infrastructure.

## The Problem
Currently, digital document management involves a cumbersome manual workflow across Google Drive and multiple disconnected Google Sheets (e.g., Memorandum Tracker, Board Resolution Tracker). Staff must manually upload to Drive, copy links, open appropriate Sheets, and paste metadata, leading to slow retrieval and fragmented organization.

## Major Features
- **Centralized Document Registry:** Unified search and filtering across various document types.
- **Streamlined Uploads:** A single interface to upload files and enter metadata simultaneously.
- **Role-Based Access Control:** Differentiated access for Admin, Staff, and Viewers.
- **Direct Drive Integration:** Files are stored securely in Google Drive while the application manages access and metadata.

## Architecture Overview
The application acts as a thin, controlled interface between KWD staff, Supabase/PostgreSQL (authentication, authorization, and the sole application metadata registry), and Google Drive (file storage). Phase 3 implements the Admin documents flow only. Google Sheets and Accounting are out of scope. Vercel hosts the Next.js application layer.

## Technology Stack
- **Frontend/Application Layer:** Next.js, React, TypeScript
- **Authentication, Authorization & Phase 2 Application Registry:** Supabase/PostgreSQL
- **File Storage:** Google Drive API
- **Google Sheets Integration:** Not used by the Phase 3 Admin implementation
- **Deployment:** Vercel
- **Version Control:** GitHub

## Documentation Structure
- `/docs`: Core requirements, architecture, data models, and workflows.
- `/docs/architecture`: Architecture Decision Records (ADRs).
- `/docs/design`: Comprehensive design system and visual guidelines.

## Development Phases
- **Phase 0:** Requirements & Documentation (Current)
- **Phase 1:** Foundation (Next.js, Supabase, Auth)
- **Phase 2:** Document Registry (Search, filters)
- **Phase 3:** Admin Google Drive upload/open/download integration
- **Phase 4:** User Management (Roles, Admin)
- **Phase 5:** Testing & Hardening
- **Phase 6:** Deployment

## Known Pending Decisions
See `docs/02-requirements.md` for a full list of pending business questions regarding Google Drive structures, existing Sheet trackers, exact document types, and authorized users.
